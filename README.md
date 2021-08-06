# jw-automator

Package for automating events. Designed for automating IoT devices, such as logging the temperature every 15 minutes, or turning lights on/off at certain times, but could also be used as a full calendaring system or to schedule anything else you might need to happen at certain times.  

Because of it's intended use, the minimum interval is 1 second. If you need to automate something that runs more often then that you should probably just use the native __setInterval()__ function. That being said there is a way to leverage the extra features of jw-automator for millisecond-interval level events, which will be discussed later in the readme.  

## Basic Usage ##  
``` javascript
    //Import the library
    var Auto = require('jw-automator'); 

    //Create the automator
    var automator = new Auto.automator();

    //add a function that takes a simple payload (you can only use a single param)
    automator.addFunction('testFunc', (msg) => {
        console.log('Automator says: ' + msg);
    });

    //Add an action to the automator 
    automator.addAction({
        name: 'hello', //The name of this action
        cmd: 'testFunc', //cmd to call
        payload: 'Hello World', //payload to send to cmd
        repeat: { //if you don't provide the repeat param the action will only run once, immediately
            type:'second', // second/minute/hour/day/week/month/year/weekday/weekend
            interval: 5, //how many of the type to skip, 2=every other time
        }
});
```

Result:
Every 5 seconds the console will log 'Automator says: Hello World'

## Constructor Options ##  
``` javascript
     var automator = new Auto.automator(options);
```
__options.save__
_boolean_ 
Should the automator save its current state as a local JSON file. 
Default = true  

The save file will be overwritten by any addAction() calls in your code, so be aware of that. The automator is either designed to be used in a code-focused way, i.e. a simple program to log temperature data, or a user-controlled way, i.e. the backend to allow end-users to setup smart-light routines. As such the save file should probably only be used if you expect end-users to modify the actions.

---

__options.saveFile__
_string_
Alternate path for the save file.  
Default = '.actions.json'  

---

## Public Functions ##  

__start__  
Starts the Automator   

---

__getActions__  
Returns a listing of the current actions and their states  

---

__removeActionByID__  
Removes an action by the internal ID. You must use getActions() to determine the ID.  
_params_
1. ID _number_: The ID number for the action

---

__removeActionByName__  
Removes an action by the name you provided in the .name option when you created it.  
_params_  
1. name _string_: The action name  

---

__executeActionByID__  
Forces a given action to run immediately.  
_params_  
1. ID _number_: the action ID  
2. increment _boolean_: if true, this run will count towards the limit and count. Default = false  

---

__executeActionByName__  
Forces a given action to run immediately.  
_params_  
1. name _string_: the action name
2. increment _boolean_: if true, this run will count towards the limit and count. Default = false  

---

__getActionsInRange__  
Generates an array of all the action objects that would run during a particular range of time. Every time an action will run will have an index in an array. This is useful if you're using the automator as the backend of a calendaring system and you want to display everything that will happen in a period of time, like for a week/month calendar display. Because actions can be set to repeat for a given limit or until a given date has occurred, the only way to generate this information is to simulate the actions and see what happens, as such it may take a few CPU cycles to generate the information. Therefore, this routine runs asynchronously and a callback must be used to retrieve the result.  
_params_  
1. start _Date_: the date/time to start the range  
2. end _Date_: the date/time to end the range
3. callback _function_: the callback function to run, returns an array with every action that will run, and the time it will run  

---

__updateActionByID__  
Updates an action by it's ID. Use to change an action in some way, like to modify it's interval or end date, etc.  
_params_  
1. ID _number_: the action ID  
2. newAction _object_: a new action object. It does not need to be a complete action, this will just overwrite the existing action with the new values you provide.  

---

__updateActionByName__  
Updates an action by it's name. Use to change an action in some way, like to modify it's interval or end date, etc.  
_params_  
1. name _string_: the action name  
2. newAction _object_: a new action object. It does not need to be a complete action, this will just overwrite the existing action with the new values you provide.  

---

__addAction__  
Adds a new action to the automator.  
_params:_
1. action _object_: The action object, see below for details.

---

## Action Options ##

---

__name__ _required_   
_string_  
The name of the action.  

---

__date__  
_Date_  
The first time the action should run, leave blank or set to null to run immediately. The date can be in the past if needed, useful if the action is only supposed to run a set number of times and it should have started running already.  

---

__cmd__ _required_  
_string_  
The name of the function to run, must match a name added with the addAction() command.  

---

__payload__
_any_  
An immutable payload to send the command. This is useful when you are using a command that is used by more than one action. As an example, if you have a function that logs some sort of data from various sensors, you could use the payload param to indicate which sensor to log. Honestly though, it's probably better to put whatever information you need in the automator action itself and then use that to call your theoretical logging function.  

---

__unBuffered__  
_boolean_  
In a perfect world your action will run exactly when it is supposed to. In the real world it is possible that your CPU will be busy with other tasks during the entire second that the action was supposed to run. By default actions are buffered, so the action will run as soon as possible, which for most intended uses is what would be wanted. For example, if your action was meant to turn on the living room lights at exactly 9:00:00am, but due to CPU overhead they actually got turned on at 9:00:01am that would be fine, and desireable. There may be some cases, for example if you were running an action every single second, that missing a time might be better than running the same action several times at once when the CPU became free from whatever tasks were occupying it. If that's the case, set unBuffered=true  

---

__repeat__  
_object_  
The repeat object is the key part of the action as it specifies how the action should repeat! You can have an action that repeats forever at a specified interval, you can have an action that repeats until a certain date/time and/or you can have an action that repeats a certain number of times.

---

__repeat.type__
_string_
Valid options: second, minute, hour, day, week, month, year, weekday, weekend  
Weekdays are Monday-Friday and Weekends are Saturday-Sunday. If you have an action repeat every 1 weekday it will repeat every day, Mon-Fri, then skip the weekend, then run again on Monday, etc.  
Each Weekday or Weekend (day) counts as one day, so if you have an action repeat every 2 weekend days starting on the first upcoming Saturday it will run Saturday, then will skip the next 2 weekend days (Sunday, Saturday next week) and run on Sunday (week 2), then skip the following Saturday and Sunday (week 3) and run again on Saturday (week 4).  

---

__interval__ _required_  
_number_  
The interval of the action. 1 = every time, 2=every other time, 3=every other 3rd time, etc.  
So, if you have an action starting at 6:00am, running every minute with an interval of 3, the action will run at:  
6:00am  
6:03am  
6:06am  
6:09am  
etc.  

---

__limit__
_number_
how many times the action should run. If you want an action to run every 15 minutes for an hour you can set a limit of 5 and the action will run:
01:00  
01:15  
01:30  
01:45  
02:00  
And then stop.  
If you want an action to only run a certain number of times you can use __limit__ or __endDate__ as makes the most sense for your needs. Whichever comes first will be when the action stops.  

___

__endDate__  
_Date_  
The date and time the action should stop.  
If you want an action to only run a certain number of times you can use __limit__ or __endDate__ as makes the most sense for your needs. Whichever comes first will be when the action stops.  

---

__count__
_number_  
This is how many times the action has already run. Only useful if a limit is set and you want to override the default starting count. I can't think of any reason to do this outside of a debug environment.    
__NOTE:__ If you specify a limit and a start date in the past, the automator will simulate all the times the action should have run without actually running it, so if you create an action on Wednesday that is set to have started on Monday and should run every day, 5 times, it will run on Wednesday (today), Thursday and Friday. If you set a different count, like say 0, then it will run Wed,Thurs, Fri, Sat, Sun instead since you overrode the count.  

---

__Here is a complete copy/paste version of the complete action object to use in your code:__
```javascript
var action = {
    name: '', //user definable
    date: null, //next time the action should run, set null for immediately
    cmd: null, //function to call
    payload: null, //payload to send to function
    unBuffered: null, //when true actions missed due to sync delay will be skipped
    repeat: { //set this to null to only run the action once, alternatively set limit to 1
        type:'minute', // second/minute/hour/day/week/month/year/weekday/weekend
        interval: 1, //how many of the type to skip, 3=every 3rd type
        count: 0, //number of times the action has run, 0=hasn't run yet
        limit: null, //number of times the action should run, false means don't limit
        endDate: null //null = no end date
    }
};
```

## Emitters ##  
The automator will emit the following events, use with:

```javascript
    automator.on('emitterName', (payload)=>  {
        console.log(payload);
    });
```

__debug__  
Emits debug notifications  

---

__ready__  
Fires when the automator object is ready for use after being declared. The automator always fires exactly on the second so it may take up to 999 milliseconds for the automator to start. There may also be an async file read when you declare the automator.

---

__error__  
Emits error messages  

---

__update__  
Fires when the action list is updated via updateAction() or addAction()  

---

__action__
Returns a list of actions that were run in that second.


## Advanced Use ##

You can use the automator to add actions to itself or to run millisecond interval events using the functions called from a primary action.  

__example #1__  

A primary action runs every hour which creates a secondary action that runs every minute for 5 minutes to read a sensor for the purpose of averaging the readings. This is also an example of a reason to use the limit option instead of the endDate option.

__example #2__  

Same as #1, but this time your sensor has millisecond level speed and instead of creating a secondary action you have 2 primary actions, 1 that starts a setInterval() call using a sub-second interval and one that stops the interval some time in the future.  

