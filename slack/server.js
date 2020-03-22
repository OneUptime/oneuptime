const slackin = require('slackin-extended');

slackin
    .default({
        token:
            'xoxp-369430749728-370026359715-370129302482-08f43c6a1306d2e8f4be4b0d8abbdb80', // Fyipe Legacy token - required
        interval: 24 * 60 * 60 * 1000, //check slack registered users every day.
        org: 'fyipehelp', // fyipehelp.slack.com - required
        silent: false, // suppresses warning
        accent: 'black',
    })
    .listen(1267);
