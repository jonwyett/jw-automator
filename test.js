var amtr = require('./automator');

var auto = new amtr.automator({save: false, debug: true});

auto.on('ready', function() {
    console.log('Automator ready');
});

auto.on('error', function(err) {
    console.log('Automator error: ' + err);
});

auto.on('update', function() {

});


/*
auto.on('action',function(actions) {
    if (actions) {
        console.log('Automator ran the following actions:');
        actions.forEach(function(action) {
            console.log('   -' + action.name);
        });
    } else {
        console.log('no actions to run');
    }
});

*/


/*
auto.AddAction({
    name: 'test1', //user definable
    date: null, //next time the action should run, set default immediately
    cmd: 'test1', //cmd to call
    payload: null, //payload to send to cmd
    repeat: { //set this to null to only run the action once, alternatively set limit to 1
        type:'second', // second/minute/hour/day/week/month/year/weekday/weekend
        interval: 5, //how many of the type to skip, 1=every type
        count: 0, //number of times the action has run, 0=hasn't run yet
        limit: false, //number of times the action should run, false means don't limit
        endDate: null //null = no end date
    }
});

auto.AddAction({
    name: 'test2', //user definable
    date: null, //next time the action should run, set default immediately
    cmd: 'test2', //cmd to call
    payload: null, //payload to send to cmd
    repeat: { //set this to null to only run the action once, alternatively set limit to 1
        type:'second', // second/minute/hour/day/week/month/year/weekday/weekend
        interval: 7, //how many of the type to skip, 1=every type
        count: 0, //number of times the action has run, 0=hasn't run yet
        limit: false, //number of times the action should run, false means don't limit
        endDate: null //null = no end date
    }
});
*/
auto.addFunction('test1', function() {
    console.log('---RUN TEST1 (5secs)---');
});

auto.addFunction('test2', function() {
    console.log('---RUN TEST2 (7secs)---');
});

auto.addAction({
    name: 'delay', //user definable
    date: null, //next time the action should run, set default immediately
    cmd: 'delay', //cmd to call
    payload: null, //payload to send to cmd
    repeat: { //set this to null to only run the action once, alternatively set limit to 1
        type:'second', // second/minute/hour/day/week/month/year/weekday/weekend
        interval: 5, //how many of the type to skip, 1=every type
        count: 0, //number of times the action has run, 0=hasn't run yet
        limit: false, //number of times the action should run, false means don't limit
        endDate: null //null = no end date
    }
});

var foo = auto.getActions();

auto.addAction({
    name: '1sec', //user definable
    date: null, //next time the action should run, set default immediately
    cmd: 'sec', //cmd to call
    payload: null, //payload to send to cmd
    unBuffered: true,
    repeat: { //set this to null to only run the action once, alternatively set limit to 1
        type:'second', // second/minute/hour/day/week/month/year/weekday/weekend
        interval: 1, //how many of the type to skip, 1=every type
        count: 0, //number of times the action has run, 0=hasn't run yet
        limit: false, //number of times the action should run, false means don't limit
        endDate: null //null = no end date
    }
});

var sec = 0;
auto.addFunction('sec', function() {
    sec++;
    console.log('sec(' + sec + ')');
});
auto.addFunction('delay', function() {
    
    console.log('Delay start...');
    for (var a=0; a<10000; a++) {
        for (var b=0; b<100000; b++) {
            if (a*b === 12345) { console.log('FOUND IT!'); }
        }
    }
    console.log('...delay end.');
    
});