/*
Current Version 0.1.25 18-03-27
0.1.25
    -added try-catch to executAction()
    -switched to SemVer
1.24
  -added delayed start so tick is exactly on the minute
  -added 'executed' to action.repeat toshow actual number of times the cmd has been run
  -added save file read/write

*/
'use strict';

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var fs = require('fs');

function Automator(callback) {
    //if (typeof functions != 'object') { functions = {}; }

    var _self = this;

    this.actions = []; //The actions to be automated
    this.functions = {}; //the functions to be run by the automator
    this.savePath = '.actions.json'; //the location of the save file, default is program root
    
    //The timer always runs but it may be muted, i.e. will execute no actions, they
    //will however have their counters updated as if they were being run and will be
    //removed if their end dates pass
    //can be set directly by the client 
    this.mute = false;     
    
    //holds the timer reference
    var _autoTimer = null;

    //startup function to start the tick interval
    function startUp() {
        _autoTimer = setInterval(function tick() { 
            //run all the actions with:
            //  -Date.now() set as the tick time with the seconds set to 0
            //  -the opposite of this.mute set as the execute flag, so exicute if this.mute = false
            //  -run the callback with the list of actions run during this tick passed back
            _self.actions = executeAllActions(_self.actions, clearSeconds(Date.now()), !_self.mute, function(actionsUpdated, actionsRun) {
                if (actionsUpdated) {
                    _self.emit('update'); //tell the client that the action list has updated
                    //this emit is a good oportunity for the client to save the _self.actions object to a file/database/etc.
                    saveActions(_self.actions);
                }
                if (actionsRun.length > 0) {
                    _self.emit('action', actionsRun); //emit to any listening clients the list of actions run
                } 
            });
            //this is a self invoking function, so we need to return itself
            return tick;
        }(), 1000 * 60); //Timer runs every minute, 1 "tick" of the automator
    }

    //first load the actions from file.
    //we're going to do this in sync mode because we want to garuntee that the file is loaded
    //before we start the automator and possible accept a new action that is then overwritten
    //by the save file.
    try {
        _self.actions = JSON.parse(fs.readFileSync(_self.savePath, 'utf8'));
    } catch (err) {
        console.log('Automator: No Save File');
    }
        
    // we want the tick to run exactly on the minute, so calcuate a wait period before starting
    var wait = 60-new Date(Date.now()).getSeconds(); //60-the current seconds = the seconds to wait
    console.log('Automator waiting: ' + wait + ' seconds before starting...');
    setTimeout(function() {
        console.log('Automator Starting...');
        startUp();
        //run the startup callback after the automator has actually started
        if (typeof callback === 'function') {
            callback(true);
        }
    }, wait * 1000);    


    /*****************************************************************/
    /*****************************************************************/

    function saveActions(actions) {
        //saves the actions object to a file
        // we're using a pased reference instead of self to support saving multiple versions
        // in the future. (why?)

        fs.writeFile(_self.savePath, JSON.stringify(actions), function(err) {
            if(err) {
                console.log('Error saving actions: ' + err);
            }
        });
    }

    function executeAllActions(actions, now, shouldExecute, callback) {
        console.log('--execute actions--');
        console.log(JSON.stringify(actions));

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
            actions[i].date = clearSeconds(actions[i].date);
            //check if the date is in the past
            //pre-set the dateOld test for the while loop
            dateOld = dateToMilliseconds(actions[i].date) < dateToMilliseconds(now); //true if in the past 
            while (dateOld) {
                //while the next action date is still in the past, increment it untill it isn't
                //the action count will increse as if the action was run, but the action will not execute
                actionsUpdated = true; //something has changed, in this case the date of at least one action.
                //the false flag will keep the action from running, but will update it's timing
                //update the action, but don't run it's command, do increment its counter
                actions[i] = executeAction(actions[i], false, true); 
                dateOld = dateToMilliseconds(actions[i].date) < dateToMilliseconds(now); //check again
            }
            //the current action date is now in the future (or now)
            //check if the action's date is this tick
            if (dateToMilliseconds(actions[i].date) === dateToMilliseconds(now)) {
                //run the action command and increment the counter 
                actions[i] = executeAction(actions[i], shouldExecute, true); 
                actionsUpdated = true; //something has changed, in this case an action has run and it's date has updated
                //create a new actionInfo obj and add it to the list of actions that have run
                actionInfo = {};
                actionInfo.id = actions[i].id;
                actionInfo.name = actions[i].name;
                actionInfo.date = now;
                actionsRun.push(actionInfo);
            }

            //now we will test if the actions are old/past limits, if either are true, remove it
            //also remove if repeat is set to false
            //pass the provided tick time as the "current" date in case the time is simulated
            if (checkActionLimit(actions[i]) || checkActionEndDate(actions[i], now) || !actions[i].repeat) {
                console.log('>>>> Removed action: ' + actions[i].name + ' - ' + actions[i].id);
                console.log(">>>> Limit: " + checkActionLimit(actions[i]));
                console.log(">>>> Date: " + checkActionEndDate(actions[i], now));
                console.log('>>>> Type: ' + typeof actions[i].repeat);
                actions.splice(i,1); //remove the offending action 
                actionsUpdated = true; //something has changed, in this case the action list
                
            }
        } //END MAIN LOOP
        
        if (typeof callback === 'function') {
            callback(actionsUpdated, actionsRun); //callback with the list of actions run this tick
        }

        return actions; //return the updated actions object
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
            console.log('Time: ' + printDate(Date.now()));
            console.log('--> AUTOMATOR: Executing Action "' + action.name + '"...');

            //update the execute var even if there is no function to run
            action.repeat.executed ++;

            //run the cmd with the payload (make sure the cmd is a function first)
            //it will obviously not be if the cmd is not defined at all or if the user
            //didn't pass a "functions" object into the automator
            if (typeof _self.functions[action.cmd] === 'function') {
                try {
                    _self.functions[action.cmd](action.payload);
                } catch (err) {
                    console.log('Problem executing action: ' + err);
                }
            }
        }

        return action; //return the modified action
    }

    function dateToMilliseconds(date) {
        //converts dates and date strings to milliseconds
        //more robust then Date.parse()
        return(Date.parse(new Date(date).toString()));
    }
    
    function clearSeconds(date) {
        //returns a date object with the seconds set to 0
        date = new Date(date); //force a date object
        date.setSeconds(0); //clear the seconds
        date.setMilliseconds(0); //clear the milliseconds
        return date;
    }
    
    function getNextActionTime(start, repeat) {
        //returns a new date based on a start date (may be a string) and a repeat options object.
    
        //if a repeat obect isn't supplied or is false, return the start (same) time
        if (typeof repeat === 'undefined') { return new Date(start); }
    
        var dateStart = new Date(start); //convert input to valid date object
        dateStart.setSeconds(0); //since the minumum tick is 1 minute;
        dateStart.setMilliseconds(0);
        start = Date.parse(dateStart.toString()); //convert to milliseconds
        var nextTime = null; //by default there will be no next action time
        var inc = 0; //the number of milliseconds to incriment by
        var i = 0;
        switch (repeat.type) {
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
                    //appropriate ammount to the next weekday.
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
                    //similar to weekdays we will incement manually through each day, but this time
                    //we will jump the weekdays by adding the number of days neccesary to get to the
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





    /*****************************************************************/
    /*****************************************************************/
    /*****************************************************************/
    /*****************************************************************/

    this.AddAction = function(action) {
        action.date = clearSeconds(action.date); //force a date object and clear the seconds
        if (action.repeat) {
            action.repeat.endDate = clearSeconds(action.repeat.endDate); 
            action.repeat.executed = 0;
        }

        action.id = Date.now(); //will always be a unique ID
        _self.actions.push(action); //add the new action to the global list
        saveActions(_self.actions); //save the new actions to a file

        //run the newly added action if its first tick is now
        if (dateToMilliseconds(action.date) === dateToMilliseconds(clearSeconds(Date.now()))) {
            action = executeAction(action, true);
            //emit a list of just this one action being run to the client
            _self.emit('action', [{
                id: action.id,
                name: action.name,
                date: clearSeconds(Date.now())
            }]); 
        } 
    };

    this.GetActions = function() {
        //this function is not currently needed as the action object is public, but in case it ever
        //isn't and for potential code clarity, here it is.
        return _self.actions;
    };
    
    this.AddFunction = function(name, cmd) {
        //add a new function to the functions object
        //due to the nature of Javascript you may use this function to modify an existing function too.
        //Currently there is no way to remove a function, but since you can modify it or set it to null
        //there's really no need/benifit of "removing" it completely.
        //this function is largly redundant since the functions object is public, but that may change
        _self.functions[name] = cmd;
    };

    this.RemoveActionByID = function(ID) {
        //removes an action from the list based on the ActionID
        //returns true if the action was successfully removed
        //Returns false if not
        //ActionID's should be unique, but this will remove all matches just in case
        var removed = false;
        for (var i = _self.actions.length; i--;) {
            if (_self.actions[i].id === ID) {
                _self.actions.splice(i,1);
                removed = true;    
            }
        }
        _self.emit('update'); //tell the clients that the actions have changed
        saveActions(_self.actions); //save the new actions to a file
        return removed;
    };

    this.RemoveActionByName = function(name) {
        //removes an action from the list based on the action name
        //returns true if the action was successfully removed
        //Returns false if not
        //this will remove all matches, so useful if you want to use the "name" field
        //as more of a "type" field, so for example this could remove all your "Backup" actions
        var removed = false;
        for (var i = _self.actions.length; i--;) {
            if (_self.actions[i].name === name) {
                _self.actions.splice(i,1);
                removed = true;    
            }
        }
        _self.emit('update'); //tell the clients that the actions have changed
        saveActions(_self.actions); //save the new actions to a file
        return removed;
    };

    this.ExecuteActionByID = function(ID, increment) {
        //executes an action based on it's action ID
        //retuns true if the action is run
        //this shouldn't ever happen, but if more then one action shares an ID, run all

        //assume we dont want this to count against the total
        if (typeof increment === 'undefined') { increment = false; } 

        for (var i=0; i<_self.actions.length; i++) {
             if(_self.actions[i].id === parseInt(ID)) {
                _self.actions[i] = executeAction(_self.actions[i], true, increment);
                _self.emit('action', [{
                    id: _self.actions[i].id,
                    name: _self.actions[i].name,
                    date: clearSeconds(Date.now())
                }]); 
                saveActions(_self.actions); //save the new actions to a file
                return true;
            }
        }
        return false;
    };

    this.ExecuteActionsByName = function(name, increment) {
        console.log('Execute by name: ' + name);
        console.log(JSON.stringify(_self.actions));
        //executes an action based on it's action ID
        //retuns true if the action is run
        //will run all matching actions.

        //assume we dont want this to count against the total
        if (typeof increment === 'undefined') { increment = false; } 

        var actionRan = false;
        var actionsRun = [];
        var actionInfo = {};

        for (var i=0; i<_self.actions.length; i++) {
            if(_self.actions[i].name === name) {
                _self.actions[i] = executeAction(_self.actions[i], true, increment);
                actionRan = true;
                //since more then one action may run we're going to create the actionRun list
                //to emit to the client
                actionInfo = {};
                actionInfo.id = _self.actions[i].id;
                actionInfo.name = _self.actions[i].name;
                actionInfo.date = clearSeconds(Date.now());
                actionsRun.push(actionInfo);
            }
        }
        if (actionRan) {
            _self.emit('action', actionsRun); //emit the list of actions run
            saveActions(_self.actions); //save the new actions to a file
        }
       
        return actionRan;
    };

    this.GetActionsInRange = function(start, end, callback) {
        //returns an array of scheduled actions within the specified date range.
        //This is for simulation or for showing upcoming actions on a calendar.
        
        var tick = clearSeconds(new Date(start)); //the tick time for our virtual automator
        end = clearSeconds(new Date(end)); //the date/time to stop the simulation
        var actionList = []; //the list of actions to return
        //This will create a unique copy of the global _self.actions list
        //it wont copy the functions, but we're not running them anyway
        var actions = JSON.parse(JSON.stringify(_self.actions));  
        
        while (dateToMilliseconds(tick) <= dateToMilliseconds(end)) {
            //run the actions in non-execute mode with a copy actions object
            actions = executeAllActions(actions, tick, false, function(actionsUpdated, actionsRun) {
                //instead of emiting the action list, we're going to add them to our master list
                //of actions run durring the simulation
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
        //return actionList; //let's use/requrie a callback instead

        if (typeof callback === 'function') {
            callback(actionList);
        }
    };

    /*****************************************************************/
    /*****************************************************************/
} //END OF AUTOMATOR



//Automator API. Set your var = to this function to get a pre-filled
//action obtect.

function Action() {
    var action = {
        name: '', //user definable
        date: null, //next time the action should run, set default immediately
        cmd: null, //cmd to call
        payload: null, //payload to send to cmd
        repeat: {
            //type: the way the repeat "counts"
            //  -minute: the minimum "tick" is a minute
            //  -hour
            //  -day
            //  -week
            //  -month
            //  -year
            //  -weekday: Mon-Fri. When using this mode the weekends don't exist
            //      from the perspective of the counter.
            //  -weekend: opposite of weekday
            type:'minute', //defaults to every minute
    
            //interval: how many to skip (where 1=no skip)
            //Technically fractions will but it's outside design ideology.
            //Fractional Month, year and weekday/end may have unexpected results.
            interval: 1, //default 
    
            //number of times the action should have run, this is for limited actions.
            //the count will be incremented based on simulated runs if the action is
            //added after the start date.
            count: 0, 

            //number of times the action has actually been run.
            executed: 0, 
    
            //number of times the action should run, false means don't limit
            limit: null, 
    
            //date at which the action should cease
            endDate: null
        }
    };

    return action;
}
/**************************************************************************************** */

//Here's a copy/paste version of the action object:

var action = {
    name: '', //user definable
    cmd: null, //cmd to call
    date: null, //next time the action should run, set default immediately
    payload: null, //payload to send to cmd
    repeat: { //set this to null to only run the action once, alternatively set limit to 1
        type:'minute', // minute/hour/day/week/month/year/weekday/weekend
        interval: 1, //how many of the type to skip, 1=every type
        count: 0, //number of times the action has run, 0=hasn't run yet
        limit: false, //number of times the action should run, false means don't limit
        endDate: null //null = no end date
    }
};

/**************************************************************************************** */

util.inherits(Automator, EventEmitter);


exports.Automator = Automator;
exports.Action = Action;




