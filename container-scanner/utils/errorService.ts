import winston from 'winston';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'wins... Remove this comment to see the full error message
import Slack from 'winston-slack-transport';

if (
    process.env.PORT &&
    process.env.SLACK_ERROR_LOG_WEBHOOK &&
    process.env.SLACK_ERROR_LOG_CHANNEL
) {
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 2.
    winston.add(Slack, {
        webhook_url: process.env.SLACK_ERROR_LOG_WEBHOOK,
        channel: '#' + process.env.SLACK_ERROR_LOG_CHANNEL,
        username: 'Error Bot',
        handleExceptions: true,
    });
}

export default {
    log: (functionName: $TSFixMe, error: $TSFixMe) => {
        error = error && error.message ? error.message : error;
        winston.error(
            JSON.stringify(
                {
                    error: String(error),
                    functionName: String(functionName),
                    stack: new Error().stack,
                },
                // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
                0,
                2
            )
        );
    },
};
