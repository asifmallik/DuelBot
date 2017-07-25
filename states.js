var MongoClient = require('mongodb-bluebird');
var path = require('path');
var fs = require('fs');

var config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

Date.prototype.addHours = function(h) {
   this.setTime(this.getTime() + (h*60*60*1000));
   return this;
}

var reviewIntervals = [
    {label: "1 hour", hours: 1, points: 5},
    {label: "2 hours", hours: 2, points: 5},
    {label: "4 hours", hours: 4, points: 10},
    {label: "1 day", hours: 24, points: 10},
    {label: "2 days", hours: 48, points: 15},
    {label: "4 days", hours: 96, points: 15},
    {label: "1 week", hours: 168, points: 20},
    {label: "2 weeks", hours: 336, points: 20},
    {label: "1 month", hours: 720, points: 25},
];

//for testing
// var reviewIntervals = [
//     {label: "1 hour", hours: 1/60, points: 5},
//     {label: "2 hours", hours: 2/60, points: 5},
//     {label: "4 hours", hours: 3/60, points: 10},
//     {label: "1 day", hours: 5/60, points: 10},
//     {label: "2 days", hours: 5/60, points: 15},
//     {label: "4 days", hours: 5/60, points: 15},
//     {label: "1 week", hours: 5/60, points: 20},
//     {label: "2 weeks", hours: 5/60, points: 20},
//     {label: "1 month", hours: 5/60, points: 25}
// ];


var setsCollection, flashcardsCollection, roomsCollection, usersCollection, progressesCollection, reviewsCollection, reviewNotificationsCollection, metaCollection;

MongoClient.connect("mongodb://localhost:27017/DuelBot").then(function(database) {
    console.log("We are connected");
    setsCollection = database.collection('sets');
    flashcardsCollection = database.collection('flashcards');
    roomsCollection = database.collection('rooms');
    usersCollection = database.collection('users');
    reviewNotificationsCollection = database.collection('reviewNotifications');
    reviewsCollection = database.collection('reviews');
    progressesCollection = database.collection('progresses');
    metaCollection = database.collection('meta');
});

function getObjectByProperty(array, propertyName, propertyValue){
    for(var i = 0; i < array.length; i++){
        if(array[i][propertyName] == propertyValue) return array[i];
    }
    return false;
}

function getIndexByProperty(array, propertyName, propertyValue){
    for(var i = 0; i < array.length; i++){
        if(array[i][propertyName] == propertyValue) return i;
    }
    return false;
}

function sortObjectsByProperty(array, propertyName, descending){
    array.sort(function(a, b){
        if(descending) return b[propertyName] - a[propertyName];
        return a[propertyName] - b[propertyName];
    });
}

function deletePropertiesArray(array, properties){
    for(var i = 0; i < array.length; i++){
        deleteProperties(array[i], properties);
    }
}

function joinLines(lines){
    var string = "";
    for(var i = 0; i < lines.length; i++){
        var line = lines[i].line ? lines[i].line : lines[i];
        if(!lines[i].line || (lines[i].line && lines[i].show)){
            string += line;
            if(i < lines.length - 1) string += "  \n ";
        }
    }
    return string;
}

function generateToken(){
  var token = "";
  var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  for (var i = 0; i < 6; i++) token += possible.charAt(Math.floor(Math.random() * possible.length));

  return token;
}

function validateString(string){
    if(typeof string != "string" || string.trim() == "") return false;
    return true;
}

function getRandomItem(arr){
    return arr[Math.floor(Math.random()*arr.length)];
}

function filterCards(cards, property, value){
    return cards.filter(function(card){
        return card[property] == value;
    });
}

function deleteProperties(obj, properties){
    for(var i = 0; i < properties.length; i++){
        delete obj[properties[i]];
    }
}

function joinWithConjunction(strings, conjunction, bold){
    var formattedStrings = strings.map(function(str){ //makes each string bold or just makes a copy
        return (bold ? "**" + str + "**" : str);
    });
    var joinedString = "";
    while(formattedStrings.length > 2){ //appends to string with commas until only 2 strings lefts
        joinedString += formattedStrings.shift() + ", ";
    }
    joinedString += formattedStrings[0];
    if(formattedStrings.length == 2){
        joinedString += " " + conjunction + " " + formattedStrings[1];
    }
    return joinedString;
}

function getMentionString(email, displayName){
    return '<@personEmail:' + email + '|' + displayName + '>';
}

function updateState(roomId, state){
    roomStates[roomId] = state;
    return roomsCollection.update({roomId: roomId}, state, {upsert: true});
}

function removeState(roomId){
    delete roomStates[roomId];
    return roomsCollection.remove({roomId: roomId});
}

function getBotByRoomId(roomId){
    for(var i = 0; i < module.exports.bots.length; i++){
        if(module.exports.bots[i].room.id == roomId){
            return module.exports.bots[i];
        }
    }
    return false;
}

function learnCard(bot, roomState){
    var unlearntCards = filterCards(roomState.cards, "learnt", false);
    if(unlearntCards.length == 0){
        return false; //learning is over
    }
    var selectedCard = getRandomItem(unlearntCards);
    selectedCard.learnt = true;
    return bot.say(joinLines([
        'Q- ' + selectedCard.front,
        'A- ' + selectedCard.back
    ]));
}

function reviewCard(bot, roomState){ //first all the cards with 2 reviews left are sent followed by 1 to increase the average gap between showing the same card
    var toReviewCards = filterCards(roomState.cards, "reviewsLeft", roomState.reviewsLeft);
    if(toReviewCards.length == 0){ //check if no more reviews left on this level
        if(--roomState.reviewsLeft == 0){ //reduce level by 1 and check if all has been reviewed
            return false;
        }
        return reviewCard(bot, roomState);
    }
    roomState.reviewingCard = getRandomItem(toReviewCards);
    return bot.say('Q- ' + roomState.reviewingCard.front);
}

function sendGameCard(bot, roomState, prefix){
    if(roomState.turnsLeft-- == 0) return false;
    var currentTurn = roomState.turnsLeft;
    roomState.currentCard = roomState.cards.splice(Math.floor(Math.random()*roomState.cards.length), 1)[0];
    setTimeout(function(){
        if(currentTurn == roomState.turnsLeft){
            if(!sendGameCard(bot, roomState, "Time's up, moving to the next question.  \n ")) gameOver(bot, roomState);
        }
    }, 60000);
    var message = 'Q- ' + roomState.currentCard.front;
    if(prefix) message = prefix + message;
    return bot.say(message);
}

function incrementDmPoints(email, points){
    var dmBot = getObjectByProperty(module.exports.bots, "isDirectTo", email);
    if(dmBot){
        var dmRoomState = roomStates[dmBot.room.id];
        if(dmRoomState.points){
            dmRoomState.points += points;
        }else{
            dmRoomState.points = points;
        }
        updateState(dmBot.room.id, dmRoomState);
    }
}

function gameOver(bot, roomState){
    bot.implode();
    var parentBot = getBotByRoomId(roomState.parentRoomId);
    var parentRoomState = roomStates[roomState.parentRoomId];
    var message = [];
    sortObjectsByProperty(roomState.players, "points", true);
    message.push(getMentionString(roomState.players[0].email, roomState.players[0].displayName) + " has won!");
    for(var i = 0; i < roomState.players.length; i++){
        var player = roomState.players[i];
        var parentPlayer = getObjectByProperty(parentRoomState.leaderboard, "email", player.email);
        incrementDmPoints(player.email, player.points);
        if(!parentPlayer){
            parentRoomState.leaderboard.push(player);
        }else{
            parentPlayer.points += player.points;
        }
        message.push((i+1).toString() + ". " + getMentionString(player.email, player.displayName) + " - " + player.points.toString() + " points");
    }
    parentBot.say(joinLines(message));
    updateState(parentRoomState.roomId, parentRoomState);
    removeState(roomState.roomId);
}

function proceedToReview(bot, roomState){ //from learning
    roomState.cards.forEach(function(card){
        delete card.learnt;
        card.reviewsLeft = 2;
        card.level = -1;
    });
    roomState.reviewsLeft = 2;
    roomState.id = "review";
    roomState.origin = "learn";
    return bot.say(joinLines(["We will start reviewing the cards now", "**/giveup**: to get the answer", "**/exit**: to exit to practice"])).then(function(){
        reviewCard(bot, roomState);
    });
}

function getReviewTimes(){
    return reviewIntervals.map(function(interval){
        return (new Date()).addHours(interval.hours);
    });
}

function getReviewsCount(email, setId){
    return reviewsCollection.count({
        email: email,
        setId: setId,
        nextReviewTime: {
            $lte: new Date()
        }
    });
}

function prepareSetsMessage(bot, roomState, prefixLine){
    var message = prefixLine ? [prefixLine] : [];
    var indexCondition = roomState.other ? {$gte: 1001} : {$lte: 1000};
    return setsCollection.find({
        index: indexCondition
    }, {}, {
        sort: 'index'
    }).then(function(sets){
        for(var i = 0; i < sets.length; i++){
            message.push("**" + (roomState.other ?  sets[i].index - 1000 : sets[i].index).toString() + "**: " + sets[i].name + " - " + sets[i].cardsCount.toString() + " cards");
        }
        message.push(roomState.other ? '**back**: go back to official flashcard sets' : '**other**: check out other user made flashcard sets');
        if(bot.isDirect){
            if(!roomState.createSetToken) roomState.createSetToken = generateToken();
            message.push('[Click here]('+ config.rootUrl + '/create/' + roomState.roomId + '/'+ roomState.createSetToken + ') to create a new set');
        }
        return joinLines(message);
    });
}

function validatePracticeCommand(bot, arg, origin){
    if(!arg || isNaN(parseInt(arg))){
        bot.say('Invalid command, a **number** must be followed by **' + origin + '** indicating how many cards you would like to learn in this session');
        return false;
    }else if(parseInt(arg) > 50 || 1 > parseInt(arg)){
        bot.say('Invalid command, the number of cards must be between 1 and 50');
        return false;
    }
    return true;
}

function getRange(rangeString, max){ //validates and returns range
    if(rangeString == "all") return "all";
    var range = rangeString.split("-");
    if(range.length != 2) return false;
    for(var i = 0; i < 2; i++){
        range[i] = parseInt(range[i]);
        if(isNaN(range[i])) return false;
        if(range[i] < 1) return false;
    }
    if(range[0] >= range[1]) return false;
    if(range[1] > max) return false;
    return range;
}

var skipInitialization = {};
var roomStates = {};

 module.exports = {
     bots: [],
     roomStates: roomStates,
     updateState: updateState,
     chooseSet: function(bot, trigger, roomState){
        if(trigger.raw == "other" && !roomState.other){
            roomState.other = true;
            return prepareSetsMessage(bot, roomState).then(function(message){
                bot.say(message);
            });
        }else if(trigger.raw == "back" && roomState.other){
            roomState.other = false;
            return prepareSetsMessage(bot, roomState).then(function(message){
                bot.say(message);
            });
        }
        var setIndex = parseInt(trigger.raw);
        if(roomState.other) setIndex += 1000;
        return setsCollection.findOne({index: setIndex}).then(function(data){
            bot.say(joinLines([
                'You have chosen %s',
                '- **practice**: start a practice session',
                {line: '- **challenge [range] [number]**: challenge everyone to a game of [number] turns from [range] of cards in the set, examples for [range] would be 1-30 so all cards within that range will be included, [range] can also be "all"', show: !bot.isDirect},
                {line: '- **pledge** to earn extra points, at least two users required', show: !bot.isDirect},
                {line: '    - **start [number]**: start a pledge to review [number] cards', show: !bot.isDirect},
                {line: '    - **join**: join a pledge', show: !bot.isDirect},
                {line: '    - **withdraw**: withdraw from a pledge', show: !bot.isDirect},
                {line: '    - **stop**: end a pledge, only the initiator is authorized', show: !bot.isDirect},
                {line: '- **leaderboard**: show ranking of users in this space', show: !bot.isDirect},
                '- **exit**: exit this flashcard set']), data.name);
            roomState.set = data;
            roomState.id = "setMenu";
            delete roomState.other;
        }).catch(function(){
            bot.say('The flashcard set you requested could not be found');
        });
    },
    setMenu: function(bot, trigger, roomState){
        if(trigger.raw == "practice"){
            skipInitialization[trigger.personEmail] = true;
            return getReviewsCount(trigger.personEmail, roomState.set.index).then(function(numCardsToReview){
                return bot.dm(trigger.personEmail, joinLines([
                    'You have entered practice mode for ' + roomState.set.name,
                    'You have ' + numCardsToReview + ' cards to review',
                    '- **learn [number]**: to learn [number] cards',
                    '- **review [number]** to review [number] cards'
                ])).then(function(message){
                    if(message.roomId == bot.room.id){
                        roomState.id = "practice";
                        delete roomState.parentRoomId;
                    }else{
                        updateState(message.roomId, {
                            id: "practice",
                            roomId: message.roomId,
                            set: roomState.set,
                            parentRoomId: roomState.roomId
                        });
                    }
                });
            });
        }else if(trigger.args[0] == "pledge" && !bot.isDirect){
            switch(trigger.args[1]) {
                case "start":
                    if(roomState.pledge){
                        bot.say('There is already an ongoing pledge, you will have to stop it before starting a new one');
                        return false;
                    }
                    var pledgedReviews = parseInt(trigger.args[2]);
                    if(isNaN(pledgedReviews) || pledgedReviews <= 0){
                        bot.say('Please follow "pledge start" with a number.');
                        return false;
                    }
                    roomState.pledge = {
                        pledgedReviews: pledgedReviews,
                        players: [{displayName: trigger.personDisplayName, email: trigger.personEmail, reviewsCount: 0}],
                        initiator: trigger.personEmail,
                        checkTime: (new Date()).addHours(24),
                        streak: 0
                    }
                    bot.say(getMentionString(trigger.personEmail, trigger.personDisplayName) + ' has pledged to review ' + pledgedReviews + ' cards each day');
                    break;
                case "join":
                    if(!getObjectByProperty(roomState.pledge.players, "email", trigger.personEmail)){
                        roomState.pledge.players.push({
                            displayName: trigger.personDisplayName,
                            email: trigger.personEmail,
                            reviewsCount: 0
                        });
                        bot.say(getMentionString(trigger.personEmail, trigger.personDisplayName) + ' has pledged to review ' + roomState.pledge.pledgedReviews + ' cards each day');
                    }else{
                        bot.say('You have already pledged!');
                        return false;
                    }
                    break;
                case "withdraw":
                    var index = getIndexByProperty(roomState.pledge.players, "email", trigger.personEmail);
                    if(index || index == 0){
                        roomState.pledge.players.splice(index, 1);
                        bot.say(getMentionString(trigger.personEmail, trigger.personDisplayName) + ' has withdrawn from the pledge');
                    }else{
                        bot.say('You did not pledge!');
                    }
                    break;
                case "stop":
                    if(trigger.personEmail != roomState.pledge.initiator){
                        bot.say("You are not authorized to end the pledge!");
                        return false;
                    }
                    delete roomState.pledge;
                    bot.say('The pledge has been deleted');
                    break;
                default:
                    break;
            }

        }else if(trigger.args[0] == "challenge" && !bot.isDirect){
            var genericErrorMessage = 'Invalid command, you have not specified the range and/or the number properly';
            if(!trigger.args[1] || !trigger.args[2]){
                bot.say(genericErrorMessage);
                return false;
            }
            var range = getRange(trigger.args[1], roomState.set.cardsCount);
            if(!range){
                bot.say('The range specified is invalid');
                return false;
            }
            var rangeValue = range[1] - range[0] + 1;
            var numCardsForGame = parseInt(trigger.args[2]);
            if(isNaN(numCardsForGame)){
                bot.say(genericErrorMessage);
                return false;
            }
            if(range != "all" && numCardsForGame < 10){
                bot.say('The game must have at least 10 turns');
                return false;
            }
            if(rangeValue < numCardsForGame){
                bot.say('The range is too small, it must be greater than the specified number of cards');
                return false;
            }
            bot.say(joinLines([
                getMentionString(trigger.personEmail, trigger.personDisplayName) + ' has challenged everyone to a game!',
                '- **accept**: to accept the game',
                '- **start**: to start the game (only the challenger is authorized)',
                '- **exit**: to exit to set menu'
            ]));
            roomState.id = "challenge";
            roomState.challenge = {
                challenger: trigger.personEmail,
                players: [{email: trigger.personEmail, displayName: trigger.personDisplayName, points: 0}],
                turns: numCardsForGame
            }
            if(range == "all"){
                roomState.challenge.allRange = true;
            }else{
                roomState.challenge.range = range;
            }
        }else if(trigger.raw == "leaderboard"){
            if(roomState.leaderboard.length == 0){
                bot.say("No one has participated in games or practiced cards from this group.");
            }else{
                sortObjectsByProperty(roomState.leaderboard, "points", true);
                var message = ["The leaderboard only displays users who participated in games or practiced cards within this group"];
                for(var i = 0; i < roomState.leaderboard.length; i++){
                    var player = roomState.leaderboard[i];
                    message.push((i+1).toString() + ". " + getMentionString(player.email, player.displayName) + " - " + player.points.toString() + " points");
                }
                bot.say(joinLines(message));
            }
        }else if(trigger.raw == "exit"){
            roomState.id = "chooseSet";
            var setName = roomState.set.name;
            roomState.set = {};
            return prepareSetsMessage(bot, roomState, 'Exited %s, What would you like to learn?').then(function(message){
                bot.say(message, setName);
            });
        }else{
            bot.say(joinLines([
                'Unknown command, use any of the following:',
                '- **practice**: start a practice session',
                {line: '- **challenge [range] [number]**: challenge everyone to a game of [number] turns from [range] of cards in the set, examples for [range] would be 1-30 so all cards within that range will be included, [range] can also be "all"', show: !bot.isDirect},
                {line: '- **pledge** to earn extra points, at least two users required', show: !bot.isDirect},
                {line: '    - **start [number]**: start a pledge to review [number] cards', show: !bot.isDirect},
                {line: '    - **join**: join a pledge', show: !bot.isDirect},
                {line: '    - **withdraw**: withdraw from a pledge', show: !bot.isDirect},
                {line: '    - **stop**: end a pledge, only the initiator is authorized', show: !bot.isDirect},
                {line: '- **leaderboard**: show ranking of users in this space', show: !bot.isDirect},
                '- **exit**: exit this flashcard set'
            ]));
            return false;
        }
    },
    practice: function(bot, trigger, roomState){
        if(trigger.args[0] == "learn"){
            if(!validatePracticeCommand(bot, trigger.args[1], "learn")) return false;
            return progressesCollection.findOne({
                email: bot.isDirectTo,
                setId: roomState.set.index
            }).then(function(progress){
                var startingRank = progress ? progress.learnedCount : 0;
                return flashcardsCollection.find({
                    rank: {
                        $gte: startingRank + 1,
                        $lte: startingRank + parseInt(trigger.args[1])
                    },
                    setId: roomState.set.index
                }).then(function(cards){
                    if(cards.length == 0){
                        return bot.say("You have completed this set! There are no more cards to learn.");
                    }
                    cards.forEach(function(card){
                        delete card._id;
                        card.learnt = false;
                        card.email = bot.isDirectTo;
                    });
                    roomState.cards = cards;
                    roomState.id = "learn";
                    return bot.say(joinLines([
                        "First, you will be shown all the cards",
                        "- **next**: To proceed to the next card",
                        "- **skip**: To skip viewing cards and review only instead",
                        "- **exit**: To exit to practice menu, all progress will be lost"
                    ])).then(function(){
                        learnCard(bot, roomState);
                    }); //This is returned so that the database is only updated once learnCard() is run
                });
            });
        }else if(trigger.args[0] == "review"){
            if(!validatePracticeCommand(bot, trigger.args[1], "review")) return false;
            return reviewsCollection.find({
                email: trigger.personEmail,
                setId: roomState.set.index,
                nextReviewTime: {
                    $lte: new Date()
                }
            }, {}, {
                limit: parseInt(trigger.args[1])
            }).then(function(cards){
                if(cards.length == 0){
                    return bot.say("You have no cards left to review!");
                }
                roomState.cards = cards;
                var ids = [];
                roomState.cards.forEach(function(card){
                    ids.push(card._id);
                    delete card._id;
                    card.reviewsLeft = 1;
                });
                reviewsCollection.remove({_id: {$in: ids}});
                roomState.reviewsLeft = 1;
                roomState.id = "review";
                roomState.origin = "review";
                return bot.say("We will start reviewing the cards now").then(function(){
                    reviewCard(bot, roomState);
                });
            });
        }else if(trigger.args[0] == "exit"){
            roomState.id = "setMenu";
            return bot.say('Exited practice mode');
        }
    },
    learn: function(bot, trigger, roomState){
        if(trigger.args[0] == "next"){
            if(!learnCard(bot, roomState)){
                return proceedToReview(bot, roomState);
            }
        }else if(trigger.args[0] == "skip"){
            return proceedToReview(bot, roomState);
        }else if(trigger.args[0] == "exit"){
            roomState.id = "practice";
            delete roomState.cards;
        }
    },
    review: function(bot, trigger, roomState){
        if(trigger.raw == "/giveup"){
            roomState.reviewingCard = getRandomItem(filterCards(roomState.cards, "reviewsLeft", roomState.reviewsLeft));
            bot.say(joinLines(['The correct answer(s) is ' + joinWithConjunction(roomState.reviewingCard.answers, "or", true), 'Q- ' + roomState.reviewingCard.front]));
            return;
        }else if(trigger.raw == "/exit"){
            roomState.id = "practice";
            bot.say('Exited ' + roomState.origin + 'ing session');
            deletePropertiesArray(roomState.cards, ["reviewsLeft", "mistaken"]);
            reviewsCollection.insert(roomState.cards);
            deleteProperties(roomState, ["reviewingCard","reviewsLeft","cards","origin"]);
            return;
        }
        if(roomState.reviewingCard.answers.indexOf(trigger.raw) > -1){
            roomState.reviewingCard.reviewsLeft--;
            return bot.say("You are correct!").then(function(){
                if(!reviewCard(bot, roomState)){ //no more cards left to review
                    var levels = [];
                    var reviewTimes = getReviewTimes();
                    var reviewsCount = 0;
                    if(!roomState.points) roomState.points = 0;
                    var points = 0;
                    roomState.cards.forEach(function(card){ //processes all the cards
                        if(card.mistaken){
                            card.level = 0;
                        }else{
                            reviewsCount++;
                            card.level++;
                            if(card.level < reviewIntervals.length){
                                points += reviewIntervals[card.level].points;
                            }else{
                                points += 50;
                            }
                        }
                        if(levels.indexOf(card.level) == -1 && card.level < reviewIntervals.length){
                            levels.push(card.level);
                        }
                        deleteProperties(card, ["reviewsLeft", "mistaken"]);
                        card.nextReviewTime = reviewTimes[card.level];
                    });

                    if(roomState.parentRoomId && reviewsCount > 0){
                        var messageSuffix = "";
                        var parentBot = getBotByRoomId(roomState.parentRoomId);
                        var parentRoomState = roomStates[roomState.parentRoomId];
                        var parentPlayer = getObjectByProperty(parentRoomState.leaderboard, "email", bot.isDirectTo);
                        var parentPlayerPledge;

                        if(parentRoomState.pledge){
                             parentPlayerPledge = getObjectByProperty(parentRoomState.pledge.players, "email", bot.isDirectTo);
                        }

                        if(parentPlayer){
                            parentPlayer.points += points;
                        }else{
                            parentRoomState.leaderboard.push({
                                points: points,
                                displayName: trigger.personDisplayName,
                                email: trigger.personEmail
                            });
                        }
                        if(parentPlayerPledge){
                            parentPlayerPledge.reviewsCount += reviewsCount;
                            if(parentPlayerPledge.reviewsCount >= parentRoomState.pledge.pledgedReviews){
                                messageSuffix = "  \n They have completed the pledged number of reviews";
                            }
                        }
                        updateState(parentRoomState.roomId, parentRoomState);
                        parentBot.say(getMentionString(trigger.personEmail, trigger.personDisplayName) + " has earned " + points.toString() + " points by " + roomState.origin + "ing " + roomState.cards.length.toString() + " cards" + messageSuffix);
                    }
                    if(roomState.points){
                        roomState.points += points;
                    }else{
                        roomState.points = points;
                    }

                    //save reviews and notifications to database
                    var reviewTimeLabels = levels.map(function(level){
                        return reviewIntervals[level].label;
                    });

                    var longTermCount = 0;

                    reviewNotificationsCollection.insert(levels.map(function(level){
                        var review = {
                            email: bot.isDirectTo,
                            setId: roomState.set.index
                        };
                        if(level < reviewIntervals.length){
                            review.time = reviewTimes[level];
                        }else{
                            longTermCount++;
                            review.longTerm = true;
                        }
                        return review;
                    }));
                    reviewsCollection.insert(roomState.cards);
                    if(roomState.origin == "learn"){
                        progressesCollection.update({
                            setId: roomState.set.index,
                            email: bot.isDirectTo
                        }, {
                            $inc: {learnedCount: roomState.cards.length}
                        }, {upsert: true});
                    }else if(longTermCount > 0){ //since origin must be review if not learn, so no need to check explicitly
                        progressesCollection.update({
                            setId: roomState.set.index,
                            email:bot.isDirectTo
                        }, {
                            $inc: {longTermCount: longTermCount}
                        });
                    }

                    roomState.id = "practice";
                    deleteProperties(roomState, ["reviewingCard","reviewsLeft","cards","origin"]);

                    bot.say("You have successfully completed the session! The review session(s) is after " + joinWithConjunction(reviewTimeLabels, "and", false) + ". You are back to practice menu.");
                }
            });
        }else{
            roomState.reviewingCard.reviewsLeft = 2;
            roomState.reviewsLeft = 2;
            roomState.reviewingCard.mistaken = true;
            return bot.say("You are wrong! The correct answer(s) is " + joinWithConjunction(roomState.reviewingCard.answers, "or", true)).then(function(){
                reviewCard(bot, roomState);
            });
        }
    },
    challenge: function(bot, trigger, roomState){
        if(trigger.raw == "accept"){
            if(!getObjectByProperty(roomState.challenge.players, "email", trigger.personEmail)){
                roomState.challenge.players.push({
                    email: trigger.personEmail,
                    displayName: trigger.personDisplayName,
                    points: 0
                });
                bot.say(getMentionString(trigger.personEmail, trigger.personDisplayName) + ' accepted the challenge!');
            }else{
                bot.say('You already accepted the challenge!');
                return false;
            }
        }else if(trigger.raw == "start"){
            if(trigger.personEmail != roomState.challenge.challenger){
                bot.say("You are not authorized to start the challenge!");
                return false;
            }else if(roomState.challenge.players.length == 1){
                bot.say("No one has accepted the challenge yet, need at least 2 players to start a game");
                return false;
            }
            return bot.newRoom(bot.room.title + ": Game", roomState.challenge.players.map(function(player){
                return player.email;
            })).then(function(gameBot){
                var gameRoomState = roomStates[gameBot.room.id];
                gameRoomState.id = "game";
                gameRoomState.players = roomState.challenge.players;
                gameRoomState.set = roomState.set;
                gameRoomState.parentRoomId = roomState.roomId;
                var match = {
                    setId: roomState.set.index
                };
                if(!roomState.challenge.allRange){
                    match.rank = {
                        $gte: roomState.challenge.range[0],
                        $lte: roomState.challenge.range[1],
                    };
                }
                return flashcardsCollection.aggregate([
                    {$match: match},
                    {$sample: {size: roomState.challenge.turns} },
                ], {}).then(function(cards){
                    gameRoomState.cards = cards;
                    gameRoomState.turnsLeft = roomState.challenge.turns;
                    sendGameCard(gameBot, gameRoomState, "The first person to answer the question correctly gets 10 points. If you answer incorrectly, you will lose 5 points. You have one minute to answer a question. The game starts now!  \n ");
                    updateState(gameBot.room.id, gameRoomState);
                    delete roomState.challenge;
                    roomState.id = "setMenu";
                });
            })
        }else if(trigger.raw == "exit"){
            delete roomState.challenge;
            roomState.id = "setMenu";
            bot.say("Exited challenge.");
        }
    },
    game: function(bot, trigger, roomState){
        var player = getObjectByProperty(roomState.players, "email", trigger.personEmail);
        if(!player) return;
        if(roomState.currentCard.answers.indexOf(trigger.raw) > -1){
            player.points += 10;
            if(!sendGameCard(bot, roomState, getMentionString(player.email, player.displayName) + " You are correct  \n ")) gameOver(bot, roomState);
        }else{
            if(player.points > 0) player.points -= 5;
            bot.say(getMentionString(player.email, player.displayName) + " You are wrong");
        }
    },
    spawn: function(bot){
        console.log("spawned");
        roomsCollection.findOne({
            roomId: bot.room.id
        }).then(function(room){ //retrieve room states from database into memory
            if(room){
                delete room._id;
                roomStates[bot.room.id] = room;
            }else{
                if(!bot.isDirect || !skipInitialization[bot.isDirectTo]){
                    var roomState = {id: "chooseSet", leaderboard: [], roomId: bot.room.id};
                    updateState(bot.room.id, roomState);
                    prepareSetsMessage(bot, roomState, 'What would you like to learn?').then(function(message){
                        bot.say(message);
                    });
                }
            }
        })
    },
    createSetPage: function(req, res) {
        if(!roomStates[req.params.roomId] || roomStates[req.params.roomId].createSetToken != req.params.token){
            return;
        }
        res.sendFile(path.join(__dirname + '/web/create.html'));
    },
    createSet: function(req, res){
        var roomId = req.body.roomId;
        var token = req.body.token;
        var name = req.body.name;
        var cards = JSON.parse(req.body.cards);
        var incorrectJSONResponse = JSON.stringify({error: 'You did not properly fill up the form'});
        if(!token || !name || !Array.isArray(cards)){
            res.send(incorrectJSONResponse);
            return;
        }
        if(!roomStates[roomId] || roomStates[roomId].createSetToken != token){
            res.send(JSON.stringify({error: 'Link has expired'}));
            return;
        }
        if(cards.length < 10){
            res.send(JSON.stringify({error: 'You need at least 10 cards to create a set'}));
            return;
        }
        for(var i = 0; i < cards.length; i++){
            var card = cards[i];
            if(!Array.isArray(card.answers)){
                res.send(incorrectJSONResponse);
                return;
            }
            if(!validateString(card.front) || !validateString(card.back)){
                res.send(incorrectJSONResponse);
                return;
            }
            for(var j = 0; j < card.answers.length; j++){
                if(!validateString(card.answers[j])){
                    res.send(incorrectJSONResponse);
                    return;
                }
            }
        }
        res.end();
        metaCollection.findAndModify({
            id: 'userMadeSets'
        },{},{
            $inc: {count:1}
        }).then(function(userMadeSets){
            var index = userMadeSets.value.count+1001;
            for(var i = 0; i < cards.length; i++){
                cards[i].setId = index;
                cards[i].rank = i+1;
            }
            setsCollection.insert({
                name: name,
                index: index,
                cardsCount: cards.length
            });
            flashcardsCollection.insert(cards);
        });
    }
};


setInterval(function(){ //checks and sends notifications for reviews
    reviewNotificationsCollection.find({
        time: {
            $lte: new Date()
        }
    }).then(function(notifications){
        var ids = [];
        notifications.forEach(function(notification){
            module.exports.bots.forEach(function(bot){
                bot.memberships.forEach(function(person){
                    if(person.personEmail == notification.email && roomStates[bot.room.id].set && roomStates[bot.room.id].set.index == notification.setId && roomStates[bot.room.id].id == "setMenu"){
                        getReviewsCount(notification.email, notification.setId).then(function(count){
                            if(count > 0){
                                bot.say(getMentionString(notification.email, person.personDisplayName) + ' You have ' + count + ' cards to review');
                            }
                        });
                    }
                });
            });
            ids.push(notification._id);
        });
        reviewNotificationsCollection.remove({_id: {$in: ids}});
    });
    module.exports.bots.forEach(function(bot){
        var roomState = roomStates[bot.room.id];
        if(!roomState) return;
        if(!roomState.pledge) return;
        if(new Date() < roomState.pledge.checkTime) return;
        var completed = true;
        var notCompletedPlayers = [];
        if(roomState.pledge.players.length > 1){
            for(var i = 0; i < roomState.pledge.players.length; i++){
                if(roomState.pledge.players[i].reviewsCount < roomState.pledge.pledgedReviews){
                    completed = false;
                    notCompletedPlayers.push(getMentionString(roomState.pledge.players[i].email, roomState.pledge.players[i].displayName));
                }
                roomState.pledge.players[i].reviewsCount = 0;
            }
        }else{
            roomState.pledge.players[0].reviewsCount = 0;
            roomState.pledge.streak = 0;
            roomState.pledge.checkTime = (new Date()).addHours(24);
            updateState(bot.room.id, roomState);
            return;
        }
        if(completed){
            roomState.pledge.streak++;
            var points = (((roomState.pledge.players.length > 10) ? 10 : roomState.pledge.players.length) + ((roomState.pledge.streak > 10) ? 10 : roomState.pledge.streak) + roomState.pledge.pledgedReviews) * 5;
            for(var i = 0; i < roomState.pledge.players.length; i++){
                var player = roomState.pledge.players[i];
                var leaderboardPlayer = getObjectByProperty(roomState.leaderboard, "email", player.email);
                if(leaderboardPlayer){
                    leaderboardPlayer.points += points;
                }else{
                    roomState.leaderboard.push({
                        email: player.email,
                        displayName: player.displayName,
                        points: points
                    });
                }
                incrementDmPoints(player.email, points);
            }
            bot.say('The pledge was fulfilled today, each player will earn ' + points + ' points! There is a ' + roomState.pledge.streak + ' day(s) streak!');
        }else{
            bot.say('The pledge was not fulfilled. ' + joinWithConjunction(notCompletedPlayers, "and", false) + ' did not review the pledged number of cards today.');
            roomState.pledge.streak = 0;
        }
        roomState.pledge.checkTime = (new Date()).addHours(24);
        updateState(bot.room.id, roomState);
    });
}, 60000);
