//add the library
var Auto = require('./automator');

//create the automator, set the save mode to false
//this is mostly useful for testing, under normal operation you will want it
//to save it's sate
var automator = new Auto.automator({save:false});

//attach some events
automator.on('debug', function(msg) {
    //console.log('-DEBUG: ' + msg);
});

automator.on('ready', function() {
    console.log('---automator started---');
});

automator.on('error', function(err) {
    console.log('-Error: ' + err);
});

automator.on('update', function(msg) {
    //console.log('-update');
    //console.log(automator.getActions());
});

automator.on('action', function(actions) {
    //console.log('Actions run: ' + JSON.stringify(actions));
});




//add a single function that takes a simple payload
automator.addFunction('test', function(msg) {
    console.log('My cmd: ' + msg);
});

//create an action that fires every second

automator.addAction({
        name: 'sec', //user definable
        date: null, //next time the action should run, set default immediately
        cmd: 'test', //cmd to call
        payload: 'tick', //payload to send to cmd
        unBuffered: null, //when true actions missed due to sync delay will be skipped
        repeat: { //set this to null to only run the action once, alternatively set limit to 1
            type:'second', // second/minute/hour/day/week/month/year/weekday/weekend
            interval: 1, //how many of the type to skip, 3=every 3rd type
            count: 0, //number of times the action has run, 0=hasn't run yet
            limit: null, //number of times the action should run, false means don't limit
            endDate: null //null = no end date
        }
});


//create an action that fires every 4 seconds, and stops after it's run 4 times
automator.addAction({
    name: '4sec', //user definable
    date: null, //next time the action should run, set default immediately
    cmd: 'test', //cmd to call
    payload: '********4 seconds********', //payload to send to cmd
    unBuffered: null, //when true actions missed due to sync delay will be skipped
    repeat: { //set this to null to only run the action once, alternatively set limit to 1
        type:'second', // second/minute/hour/day/week/month/year/weekday/weekend
        interval: 4, //how many of the type to skip, 3=every 3rd type
        count: 0, //number of times the action has run, 0=hasn't run yet
        limit: 4, //number of times the action should run, false means don't limit
        endDate: null //null = no end date
    }
});


automator.start();


