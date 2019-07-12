function merge(obj1, obj2) {
    var oldKeys = Object.keys(obj1);
    var newKeys = Object.keys(obj2);

    Object.keys(obj2).forEach(function(key) {
        obj1[key] = obj2[key];
    });
}

var obj1 = {
    hello:'world',
    foo:'bar'
};

var obj2 = {
    foo:'FOO!',
    yay:{me:'friend',you:'enemy'}
};

merge(obj1, obj2);

console.log(JSON.stringify(obj1));