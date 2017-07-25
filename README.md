# DuelBot
This cisco spark chatbot helps users learn using flashcards. Using pledges, spaced repetitions and games, it keeps users engaged.

## Inspiration

The problem with traditional flashcard applications such as Anki is that it is too cumbersome to set up and it is boring so users do not come back after the first few days. To solve this, I came up with DuelBot, which makes learning with flashcards more interesting by making it into a game. Users can compete against each other for points and get points by pledging to review a number of cards each day.

## What it does

It is a spaced repetition flashcard program packaged as a chat bot with additional features such as games and pledges. Users can either use default flashcards sets, usermade sets or they can create their own. Spaced repetition works by reviewing each card at an increasing interval of time as the user answers the flashcard correctly greater number of times. So, at first, the review interval is 1 hour, which then increases to 2 hours, then 4 hours, then 1 day and so on. If the user makes a mistake, the interval falls back to 1 hour once again.

Once you select a flashcard set in a room, you can challenge everyone to a game by using the command "challenge [range] [number]" The range indicates the section of the flashcard set you want in the game, for example, 1-30 will take cards from 1 to 30 whereas the [number] indicates the number of turns. So, a turn of 10 with range 1-30 means, 10 cards will be shown between the 1st and 30th card.

Pledges can be started by using "pledge start [number]" where the [number] indicates the pledged number of reviews each day. If and only if everyone who pledges, completes it on a day, everyone earns equal extra points. The points is determined by the following formula- (number_of_people_pledged + streak_days_length + number_of_reviews_pledged) * 5. As a result, as the streak increases so does the extra points which keeps everyone to continue reviewing everyday.

## How I built it

I used node-flint mostly for the bot and a bit of AngularJS for the flashcard form.

## Challenges I ran into

The complicated part was getting different rooms to speak to each other. For example, it was challenging to update the information from one room to another during games.

## What I learned

This is the first chat bot I wrote so basically I learned how chat bots work and how to use them.


##Run

In order to run the bot, first install the dependencies
`npm install node-flint express body-parser`
then simply run it with node 
`node bot.js`
