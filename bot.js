var Flint = require('node-flint');
var webhook = require('node-flint/webhook');
var express = require('express');
var bodyParser = require('body-parser');
var MongoClient = require('mongodb-bluebird');
var fs = require('fs');
var states = require('./states.js');
var path = require('path');

var config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

config.webhookUrl = config.rootUrl + '/bot';

var app = express();
app.use(bodyParser.json()); // support json encoded bodies
app.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies

// init flint
var flint = new Flint(config);
flint.debugger = console.log;
flint.start();
flint.messageFormat = 'markdown';

// add flint event listeners
flint.on('message', function(bot, trigger, id) {
    // flint.debug('"%s" said "%s" in room "%s"', trigger.personEmail, trigger.text, trigger.roomTitle);
    // console.log(trigger);
    if(trigger.personEmail != config.email){
        trigger.text = trigger.text.replace(config.botName, "").trim().toLowerCase();
        trigger.raw = trigger.raw.replace(config.botName, "").trim().toLowerCase();
        trigger.args = trigger.text.split(" ");
        var roomState = states.roomStates[bot.room.id];
        var promise = states[roomState.id](bot, trigger, roomState);
        if(promise){
            promise.then(function(){
                console.log("updated by promise");
                states.updateState(bot.room.id, roomState);
            });
        }else if(typeof promise === 'boolean' && promise === false){ //when no change is made to roomState
            console.log("not updated");
        }else{
            console.log("updated synchronously");
            states.updateState(bot.room.id, roomState);
        }
    }
});

flint.on('initialized', function() {
    flint.debug('initialized %s rooms', flint.bots.length);
    states.bots = flint.bots;
});

flint.on('spawn', states.spawn);

// define express path for incoming webhooks
app.post('/bot', webhook(flint));

//define express path for other webpages
app.get('/create/:roomId/:token', states.createSetPage);
app.post('/create', states.createSet);

// start express server
var server = app.listen(config.port, function () {
  flint.debug('Flint listening on port %s', config.port);
});

// gracefully shutdown (ctrl-c)
process.on('SIGINT', function() {
  flint.debug('stoppping...');
  server.close();
  flint.stop().then(function() {
    process.exit();
  });
});
