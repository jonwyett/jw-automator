/*
ver 1.0.2 19-11-13
    -fixed DST-Standard time changeover bug
ver 1.0.1 19-07-18
    -bug-fixes, 1.0.0 was actually non-functional...
ver 1.0.0 19-06-27
*/

'use strict';

var fs = require('fs'); //for saving state

/**
 * Creates an automator
 * 
 * @param {object} [options] - startup options  
 * @param {Boolean} [options.save] - Should the automator save it's state
 * @param {string} [options.saveFile] - alternate path/file for save
 */
function automator(options) {
    if (typeof options === 'undefined') { options = {}; }
    var _self = this;

    var _actions = []; //The actions to be automated
    var _functions = {}; //the functions that the automator can run
    var _saveFile = '.actions.json'; //default save path
    var _saveState = true;
    var _lastTickTime = Date.now(); //this works with action.unBuffered to prevent actions from being missed
    var _newTickTime = Date.now();

    if (options.saveFile) { _saveFile = options.saveFile; }
    if (!options.save) { _saveState = false; }

    //The timer always runs but it may be muted, i.e. will execute no actions, they
    //will however have their counters updated as if they were being run and will be
    //removed if their end dates pass
    //can be set directly by the client 
    this.mute = false;  

    //holds the timer reference
    //var _autoTimer = null;

    /*******************   Custom Emitter Code  **************************************************/
    //this is for potential browser compatibility
    var _events = {};
    this.on = function(event, callback) {
        //attaches a callback function to an event
        _events[event] = callback;    
    };
    function emit(event, payload) {
        if (typeof _events[event] === 'function') { //the client has registered the event
            _events[event](payload); //run the event function provided
        }   
    }
    /*******************************************************************************************/

    function debug(msg) {
        emit('debug', msg); 
    }

    function startUp() {
        //first load the actions from file.
        //we're going to do this in sync mode because we want to guarantee that the file is loaded
        //before we start the automator and possibly accept a new action that is then overwritten
        //by the save file.
        if (_saveState) {
            try {
                _actions = JSON.parse(fs.readFileSync(_saveFile, 'utf8'));
                debug('Loaded save file');
            } catch (err) {
                debug('Save file does not exist yet.');
            }
        }
        
        // we want the tick to run exactly on the second, so calculate a wait period before starting
        var wait = 1000 - new Date(Date.now()).getMilliseconds(); 
        debug('Waiting ' + wait + ' milliseconds...');
        setTimeout(function() {
            emit('ready');
            tick();
        }, wait);  
    }

    function tick() {
        _lastTickTime = _newTickTime;
        _newTickTime = Date.now();
        //run all the actions with:
        //  -Date.now() set as the tick time with the milliseconds set to 0
        //  -the opposite of this.mute set as the execute flag, so execute if this.mute = false
        //  -run the callback with the list of actions run during this tick passed back
        
        _actions = executeAllActions(_actions, clearMilliSeconds(Date.now()), !_self.mute, function(actionsUpdated, actionsRun) {
            if (actionsUpdated) {
                emit('update'); //tell the client that the action list has updated
                if (_saveState) { saveActions(_actions); }
            }
            if (actionsRun.length > 0) {
                emit('action', actionsRun); //emit to any listening clients the list of actions run
            }         
        });

        var wait = 1000-new Date(Date.now()).getMilliseconds(); 
        setTimeout(function() {
            tick();
        },wait);
    }

    function saveActions(actions) {
        //saves the actions object to a file
        fs.writeFile(_saveFile, JSON.stringify(actions), function(err) {
            if(err) { emit('error', 'Error saving actions: ' + err); }
        });
    }

    function clearMilliSeconds(date) {
        //returns a date object with the milliseconds set to 0
        date = new Date(date); //force a date object
        date.setMilliseconds(0); //clear the milliseconds
        return date;
    }

    function dateToMilliseconds(date) {
        //converts dates and date strings to milliseconds
        //more robust then Date.parse()
        return(Date.parse(new Date(date).toString()));
    }

    function checkActionLimit(action) {
        var removeAction = false;
        if (action.repeat) {
            //limit will be FALSE if it doesn't exist and also check if the limit is 0 (=no limit)
            if (action.repeat.limit && action.repeat.limit > 0) { 
                if (action.repeat.count >= action.repeat.limit) {
                    removeAction = true;
                }
            }
        }

        return removeAction;
    }

    function checkActionEndDate(action, now) {
        var removeAction = false;
        if (action.repeat) {
            if (action.repeat.endDate) { //endDate will be FALSE if it doesn't exist
            if (dateToMilliseconds(action.repeat.endDate < dateToMilliseconds(now))) {
                    removeAction = true;
                }
            }
        }

        return removeAction;
    }
    
    function executeAllActions(actions, now, shouldExecute, callback) {
        //debug('execute actions...');
        //debug(JSON.stringify(actions));

        if (typeof shouldExecute === 'undefined') { shouldExecute = false; }
        
        //actions: the actions object to work with
        //now: the time of the tick (may be a virtual or test time)
        //shouldExecute: should the action actually run or just update
        //callback: function to execute when we complete
             
        var actionsUpdated = false; //to emit only when something changed
        var actionsRun = []; //a list of all the actions run this tick
        var actionInfo = {}; //the object saved in the actionRun array
        var dateOld = false; //test var for updating passed actions to the next tick in the future

        //MAIN LOOP:
        //we're going to iterate down so we can remove elements without messing up the iteration
        for (var i = actions.length; i--;) { 
            //sanitize date (and force .date into a date object)
            actions[i].date = clearMilliSeconds(actions[i].date);
            
            //it's possible that we have failed to run actions that were proscribed, so what
            //we're going to do is virtually run this action until it's next run time is now
            //or in the future. This is important for actions that were intended to run for
            //a certain amount of executions starting at a particular time. Say every hour
            //for 4 hours starting at noon. If the automator is started at 3:00 it should only 
            //run the action twice.
            //check if the date is in the past
            //pre-set the dateOld test for the while loop
            dateOld = dateToMilliseconds(actions[i].date) < dateToMilliseconds(now); //true if in the past 
            while (dateOld) {
                //debug('date is in the past: ' + actions[i].date); 
                //while the next action date is still in the past, increment it until it isn't
                //the action count will increase as if the action was run, but the action will not execute
                actionsUpdated = true; //something has changed, in this case the date of at least one action.
    
                //the false flag will keep the action from running, but will update it's timing
                //update the action, but don't run it's command, do increment its counter
                var run = false;
                //go ahead and run the action if it was missed and unBuffered = false
                if (actions[i].date > _lastTickTime && !actions[i].unBuffered) {
                    run = true;
                } else {

                } 
                actions[i] = executeAction(actions[i], run, true); 
                dateOld = dateToMilliseconds(actions[i].date) < dateToMilliseconds(now); //check again
            }
            //the current action date is now in the future (or now, now being the time passed to the function)
            //check if the action's date is this tick
            if (dateToMilliseconds(actions[i].date) === dateToMilliseconds(now)) {
                //run the action command and increment the counter 
                actions[i] = executeAction(actions[i], shouldExecute, true); 
                actionsUpdated = true; //something has changed, in this case an action has run and it's date has updated
                //create a new actionInfo obj and add it to the list of actions that have run
                actionInfo = {
                    id: actions[i].id,
                    name: actions[i].name,
                    date: now
                };
                actionsRun.push(actionInfo);
            }

            //now we will test if the actions are old/past limits, if either are true, remove it
            //also remove if repeat is set to false
            //pass the provided tick time as the "current" date in case the time is simulated
            if (checkActionLimit(actions[i]) || checkActionEndDate(actions[i], now) || !actions[i].repeat) {
                debug('>>>> Removed action: ' + actions[i].name + ' - ' + actions[i].id);
                debug(">>>> Limit: " + checkActionLimit(actions[i]));
                debug(">>>> Date: " + checkActionEndDate(actions[i], now));
                debug('>>>> Type: ' + typeof actions[i].repeat);
                actions.splice(i,1); //remove the offending action 
                actionsUpdated = true; //something has changed, in this case the action list
                
            }
        } //END MAIN LOOP
        
        if (typeof callback === 'function') {
            callback(actionsUpdated, actionsRun); //callback with the list of actions run this tick
        }

        return actions; //return the updated actions object
    }
    

    function executeAction(action, execute, increment) {
        if (typeof execute === 'undefined') { execute = false; }
        if (typeof increment === 'undefined') { increment = true; }
        
        if (action.repeat) { //if the action has a repeat object
            //update the count, even if the action isn't set to run
            //set this to false if you are manually executing the action and don't want
            //this time to count against the total runs
            if (increment) {
                action.repeat.count++; 
            }
            
            //get/set the next run time
            action.date = getNextActionTime(action.date, action.repeat);
        }

        if (execute) {
            debug('Time: ' + printDate(Date.now()));
            debug('Executing Action "' + action.name + '"...');

            //update the execute var even if there is no function to run
            action.repeat.executed ++;

            //run the cmd with the payload (make sure the cmd is a function first)
            //it will obviously not be if the cmd is not defined at all or if the user
            //didn't pass a "functions" object into the automator
            if (typeof _functions[action.cmd] === 'function') {
                try {
                    _functions[action.cmd](action.payload);
                } catch (err) {
                    emit('error','Problem executing action ' + action.name + ': ' + err);
                }
            } else {
                //emit('error', action.name + ' has no function.');
            }
        }

        return action; //return the modified action
    }

    function getNextActionTime(start, repeat) {
        //returns a new date based on a start date (may be a string) and a repeat options object.
    
        //if a repeat object isn't supplied or is false, return the start (same) time
        if (typeof repeat === 'undefined') { return new Date(start); }
    
        var dateStart = new Date(start); //convert input to valid date object
        
        //the following call breaks the DST->Standard time crossover, so for now don't do it
        //potentially if a user sets an action start time and includes milliseconds it might
        //break the action, not sure
        //dateStart.setMilliseconds(0); //since the minimum tick is 1 second;

        start = Date.parse(dateStart.toString()); //convert to milliseconds
        var nextTime = null; //by default there will be no next action time
        var inc = 0; //the number of milliseconds to increment by
        var i = 0;
        switch (repeat.type) {
            case 'second':
                inc = 1000 * repeat.interval;
                break;
            case 'minute':
                inc = (1000 * 60) * repeat.interval;
                break;
            case 'hour':
                inc = (1000 * 60 * 60) * repeat.interval;
                break;
            case 'day':
                inc = (1000 * 60 * 60 * 24) * repeat.interval;
                break;
            case 'week':
                inc = (1000 * 60 * 60 * 24 * 7) * repeat.interval;
                break;
            case 'month':
                dateStart.setMonth(dateStart.getMonth() + repeat.interval);
                start = Date.parse(dateStart.toString()); 
                inc = 0;
                break;
            case 'year':
                //12 months in a year    
                dateStart.setMonth(dateStart.getMonth() + (repeat.interval * 12));
                start = Date.parse(dateStart.toString()); 
                inc = 0;
                break;
            case 'weekday':
                while (i<repeat.interval) {
                    //we're going to iterate ahead 1 day at a time manually until we get to the interval
                    //if we hit a weekend date (Sun=0, Sat=6) then we're going to jump ahead the
                    //appropriate amount to the next weekday.
                    dateStart.setDate(dateStart.getDate() + 1); //increment the day by one

                    if (dateStart.getDay() == 0) { //we've hit sun, extra inc by 1 day
                        dateStart.setDate(dateStart.getDate() + 1);
                    }
                    if (dateStart.getDay() == 6) { //we've hit sat, extra inc by 2 day
                        dateStart.setDate(dateStart.getDate() + 2);
                    }
                    i++; //next day
                }
                start = Date.parse(dateStart.toString()); 
                inc = 0;
                break;
            case 'weekend':
                while (i<repeat.interval) {
                    //similar to weekdays we will increment manually through each day, but this time
                    //we will jump the weekdays by adding the number of days necessary to get to the
                    //next weekend
                    dateStart.setDate(dateStart.getDate() + 1); //increment the day by one
                    //if the day is 1-5 (Mon-Fri)
                    if (dateStart.getDay() > 0 && dateStart.getDay() < 6) {
                        //add the needed days to get to the weekend (6 minus today's day#)
                        dateStart.setDate(dateStart.getDate() + (6-dateStart.getDay()));
                    }
                    i++; //next day
                }
                start = Date.parse(dateStart.toString()); 
                inc = 0;
                break;
    
        }
    
        nextTime = new Date(start + inc); 
        return nextTime; //returns a date object
    }


    function printDate(date) {
        date = new Date(date);
        var days = ['Sun','Mon','Tues','Wed','Thurs','Fri','Sat'];
        var ds = days[date.getDay()] + ' ' + date.getFullYear() + '/' + parseInt(date.getMonth() + 1) + '/';
        if (date.getDate() < 10) { ds +=0; }
        ds += date.getDate();
        ds += ' ' + date.getHours() + ':';
        if (date.getMinutes() < 10) { ds +=0; }
        ds += date.getMinutes() + ':';
        if (date.getSeconds() < 10) { ds +=0; }
        ds += date.getSeconds();
    
        return ds; //a string
    }

    function updateAction(oldAction, newAction) {
        Object.keys(newAction).forEach(function(key) {
            oldAction[key] = newAction[key];
        });
    }


    /*******************   Public functions  **************************************************/

    /**
     * Start the Automator
     */
    this.start = function() {
        startUp();
    };

    /**
     * Add an action to the automator
     * @param {object} action
     * @param {string} action.name - Name of the action
     * @param {string|object} [action.date] - The start time. Blank for now
     * @param {string} [action.cmd] - The name of the function (from addFunction)
     * @param {string} [action.payload] - The param to pass to the cmd (use JSON for multi-var)
     * @param {boolean} [action.unBuffered] - If true actions missed due to delays will be skipped
     * @param {object} [action.repeat] - Define how the action should repeat
     * @param {'second'|'minute'|'hour'|'day'|'week'|'month'|'year'|'weekday'|'weekend'} [action.repeat.type] - How should the action repeat
     * @param {number} [action.repeat.interval] - 3 means run every 3rd interval, etc...
     * @param {number} [action.repeat.count] - Usually not needed, how many times the action has already run
     * @param {number|boolean} [action.repeat.limit] - Total number of times to run
     * @param {string} [action.repeat.endDate] - The date/time to remove the action
     */
    this.addAction = function(action) {
        if (!action.date) { 
            action.date = new Date();
            action.date.setSeconds(action.date.getSeconds() + 1 );
        }
        /* should we allow undefined actions? Maybe yes for calendar entry support....
        if (!action.cmd) { 
            emit('error','No action cmd provided');
            return undefined;
        }
        */
        action.date = clearMilliSeconds(action.date); //force a date object and clear the seconds
        if (action.repeat) {
            if (action.repeat.endDate) {
                action.repeat.endDate = clearMilliSeconds(action.repeat.endDate); 
            }
            // @ts-ignore
            action.repeat.executed = 0;
        }

        // @ts-ignore
        action.id = Date.now(); //will always be a unique ID
        _actions.push(action); //add the new action to the global list
        if (_saveState) { saveActions(_actions); }//save the new actions to a file

        //run the newly added action if its first tick is now
        //actually, don't. This causes more problems then it solves and the need is minimal
        /*
        if (dateToMilliseconds(action.date) === dateToMilliseconds(clearMilliSeconds(Date.now()))) {
            action = executeAction(action, true);
            //emit a list of just this one action being run to the client
            emit('action', 
                [
                    {
                        // @ts-ignore
                        id: action.id,
                        name: action.name,
                        date: clearMilliSeconds(Date.now())
                    }
                ]
            );    
        } 
        */
       
    };

    /**
     * @returns {object} - A copy of the automator actions
     */
    this.getActions = function() {
        //return a copy not the actual object
        return JSON.parse(JSON.stringify(_actions));
    };
    
    /**
     * Add a function to the automator
     * @param {string} name - Common name for the function
     * @param {Function} cmd - The function
     */
    this.addFunction = function(name, cmd) {
        //add a new function to the functions object
        //due to the nature of Javascript you may use this function to modify an existing function too.
        //Currently there is no way to remove a function, but since you can modify it or set it to null
        //there's really no need/benefit of "removing" it completely.
        _functions[name] = cmd;
    };

    /**
     * Remove an action by it's ID
     * @param {Number|string} ID - The ID of the action
     */
    this.removeActionByID = function(ID) {
        //removes an action from the list based on the ActionID
        //returns true if the action was successfully removed
        //Returns false if not
        //ActionID's should be unique, but this will remove all matches just in case
        var removed = false;
        for (var i = _actions.length; i--;) {
            if (_actions[i].id === ID) {
                _actions.splice(i,1);
                removed = true;    
            }
        }
        _self.emit('update'); //tell the clients that the actions have changed
        if (_saveState) { saveActions(_actions); } //save the new actions to a file
        return removed;
    };

    /**
     * Remove an action by it's name
     * @param {string} name - The name of the action
     */
    this.removeActionByName = function(name) {
        //removes an action from the list based on the action name
        //returns true if the action was successfully removed
        //Returns false if not
        //this will remove all matches, so useful if you want to use the "name" field
        //as more of a "type" field, so for example this could remove all your "Backup" actions
        var removed = false;
        for (var i = _actions.length; i--;) {
            if (_actions[i].name === name) {
                _actions.splice(i,1);
                removed = true;    
            }
        }
        _self.emit('update'); //tell the clients that the actions have changed
        if (_saveState) { saveActions(_actions); } //save the new actions to a file
        return removed;
    };

    /**
     * Execute an action by it's ID
     * @param {Number|string} ID - The action ID
     * @param {Boolean} increment - Should this execution count towards the action's total
     * 
     * @returns {Boolean} - Did the action(s) run
     */
    this.executeActionByID = function(ID, increment) {
        //executes an action based on it's action ID
        //returns true if the action is run
        //this shouldn't ever happen, but if more then one action shares an ID, run all

        //assume we don't want this to count against the total
        if (typeof increment === 'undefined') { increment = false; } 

        for (var i=0; i<_actions.length; i++) {
             // @ts-ignore
             if(_actions[i].id === parseInt(ID)) {
                _actions[i] = executeAction(_actions[i], true, increment);
                _self.emit('action', [{
                    id: _actions[i].id,
                    name: _actions[i].name,
                    date: clearMilliSeconds(Date.now())
                }]); 
                if (_saveState) { saveActions(_actions); } //save the new actions to a file
                return true;
            }
        }
        return false;
    };

    /**
     * Execute an action by it's name
     * @param {string} name - The action name
     * @param {Boolean} increment - Should this execution count towards the action's total
     * 
     * @returns {Boolean} - Did the action run?
     */
    this.executeActionByName = function(name, increment) {
        debug('Execute by name: ' + name);
        //executes an action based on it's name
        //returns true if the action is run
        //will run all matching actions.

        //assume we don't want this to count against the total
        if (typeof increment === 'undefined') { increment = false; } 

        var actionRan = false;
        var actionsRun = [];
        var actionInfo = {};

        for (var i=0; i<_actions.length; i++) {
            if(_actions[i].name === name) {
                _actions[i] = executeAction(_actions[i], true, increment);
                actionRan = true;
                //since more then one action may run we're going to create the actionRun list
                //to emit to the client
                // @ts-ignore
                actionInfo = {};
                actionInfo.id = _actions[i].id;
                actionInfo.name = _actions[i].name;
                actionInfo.date = clearMilliSeconds(Date.now());
                actionsRun.push(actionInfo);
            }
        }
        if (actionRan) {
            _self.emit('action', actionsRun); //emit the list of actions run
            if (_saveState) { saveActions(_actions); } //save the new actions to a file
        }
       
        return actionRan;
    };

    /**
     * This is for simulation/debugging or for showing upcoming actions on a calendar.
     * @param {string|Date} start - Start date
     * @param {string|Date} end - End date
     * @param {Function} [callback] - Array of scheduled actions within the specified date range
     */
    this.GetActionsInRange = function(start, end, callback) {
        //returns an array of scheduled actions within the specified date range.
        //This is for simulation or for showing upcoming actions on a calendar.
        
        var tick = clearMilliSeconds(new Date(start)); //the tick time for our virtual automator
        end = clearMilliSeconds(new Date(end)); //the date/time to stop the simulation
        var actionList = []; //the list of actions to return
        //This will create a unique copy of the global _actions list
        //it wont copy the functions, but we're not running them anyway
        var actions = JSON.parse(JSON.stringify(_actions));  
        
        while (dateToMilliseconds(tick) <= dateToMilliseconds(end)) {
            //run the actions in non-execute mode with a copy actions object
            actions = executeAllActions(actions, tick, false, function(actionsUpdated, actionsRun) {
                //instead of emitting the action list, we're going to add them to our master list
                //of actions run during the simulation
                if (actionsUpdated) {
                    for (var i=0; i<actionsRun.length; i++) {
                        actionList.push(JSON.parse(JSON.stringify(actionsRun[i])));
                    }
                }
            });
            tick.setMinutes(tick.getMinutes() + 1); //add a minute to the virtual tick
            if (actions.length === 0) { //if there are no remaining actions, quit.
                if (typeof callback === 'function') {
                    callback(actionList);
                }
            }
        }
              
        //we should now have a list of every action run within the specified period listed by
        //id and name and the tick-time they would have run
        //return actionList; //let's use/require a callback instead

        if (typeof callback === 'function') {
            callback(actionList);
        }
    };

    /**
     * Updates an action by it's name
     * @param {string} name - Name of the action
     * @param {object} newAction - The modified action object
     */
    this.updateActionByName = function(name, newAction) {
        for (var i=0; i<_actions.length; i++) {
            if(_actions[i].name === name) {
                updateAction(_actions[i], newAction);
            }
        }
    };

    /**
     * Updates an action by it's ID
     * @param {string} ID - ID of the action
     * @param {object} newAction - The modified action object
     */
    this.updateActionByID = function(ID, newAction) {
        for (var i=0; i<_actions.length; i++) {
            if(_actions[i].id === ID) {
                updateAction(_actions[i], newAction);
            }
        }
    };    
}

exports.automator = automator;






/**************************************************************************************** */

//Here's a copy/paste version of the action object:

var action = {
    name: '', //user definable
    date: null, //next time the action should run, set default immediately
    cmd: null, //cmd to call
    payload: null, //payload to send to cmd
    unBuffered: null, //when true actions missed due to sync delay will be skipped
    repeat: { //set this to null to only run the action once, alternatively set limit to 1
        type:'minute', // second/minute/hour/day/week/month/year/weekday/weekend
        interval: 1, //how many of the type to skip, 3=every 3rd type
        count: 0, //number of times the action has run, 0=hasn't run yet
        limit: null, //number of times the action should run, false means don't limit
        endDate: null //null = no end date
    }
};

/**************************************************************************************** */