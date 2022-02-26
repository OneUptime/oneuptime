import winston from 'winston'
import Slack from 'winston-slack-webhook-transport'

if (
    process.env.PORT &&
    process.env.SLACK_ERROR_LOG_WEBHOOK &&
    process.env.SLACK_ERROR_LOG_CHANNEL
) {
    winston.add(new Slack({ webhookUrl: process.env.SLACK_ERROR_LOG_WEBHOOK }));
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
