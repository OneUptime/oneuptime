const winston = require('winston');
const Slack = require('winston-slack-transport');

if (process.env.PORT) {
    winston.add(Slack, {
        webhook_url: 'https://hooks.slack.com/services/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',
        channel: '#fyipe-logs',
        username: 'Error Bot',
        handleExceptions: true
    });
}

module.exports = {
    log: (functionName, error) => {
        error = error && error.message ? error.message : error;
        winston.error(JSON.stringify({
            'error': String(error),
            'functionName': String(functionName),
            'stack': new Error().stack
        }, 0, 2));
    }
};