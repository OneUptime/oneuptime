import winston from 'winston'
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'wins... Remove this comment to see the full error message
import logstash from 'winston-logstash-transport'
import Slack from 'winston-slack-webhook-transport'

const MESSAGE = Symbol.for('message');
const LEVEL = Symbol.for('level');

const errorToLog = (log: $TSFixMe) => {
    // convert an instance of the Error class to a formatted log
    const formatted = {
        message: null,
        level: 'error',
    };
    // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    formatted[LEVEL] = 'error';
    if (log.message) {
        // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'null'.
        formatted.message = `${log.message}: \n${log.stack}`;
    } else {
        formatted.message = log.stack;
    }
    // formatted.message = log.stack;
    return formatted;
};

// TODO:
// add a handler for normal info logs
const logFormatter = (logEntry: $TSFixMe) => {
    if (logEntry instanceof Error) {
        // an error object was passed in
        return errorToLog(logEntry);
    }
    if (logEntry.stack) {
        // an error object was passed in addition to an error message
        // logEntry.message = `${logEntry.message}: \n${logEntry.stack}`;
        logEntry.message = logEntry.stack;
    }
    if (logEntry.message && typeof logEntry.message === 'object') {
        if (logEntry.message?.err instanceof Error) {
            // Ugh. So here we are with a log message that is an instance of the Error class
            return errorToLog(logEntry.message.err);
        } else {
            // here we have an object as the log message but it's not an Error object
            logEntry.message = JSON.stringify(logEntry.message);
        }
    }

    return logEntry;
};

const consoleTransport = new winston.transports.Console({
    format: winston.format.combine(
        winston.format.colorize(),
        winston.format.cli({
            colors: {
                error: 'red',
                warn: 'yellow',
                info: 'blue',
                http: 'green',
                verbose: 'cyan',
                debug: 'white',
            },
        })
    ),
    handleExceptions: true,
});

const logstashTransport = new logstash.LogstashTransport({
    host: process.env.LOGSTASH_HOST,
    port: process.env.LOGSTASH_PORT,
});

const envTag = (logEntry: $TSFixMe) => {
    const tag = {
        env: process.env.NODE_ENV || 'development',
        containerName: process.env.CONTAINER_NAME,
        deploymentName: process.env.DEPLOYMENT_NAME,
    };
    const taggedLog = Object.assign(tag, logEntry);
    logEntry[MESSAGE] = JSON.stringify(taggedLog);
    return logEntry;
};

const transports = [];

// configure transports (defined above)
transports.push(consoleTransport);
transports.push(logstashTransport);

const logger = winston.createLogger({
    format: winston.format.combine(
        winston.format(logFormatter)(),
        winston.format(envTag)()
    ),
    transports,
});

if (
    process.env.PORT &&
    process.env.SLACK_ERROR_LOG_WEBHOOK &&
    process.env.SLACK_ERROR_LOG_CHANNEL
) {
    winston.add(new Slack({ webhookUrl: process.env.SLACK_ERROR_LOG_WEBHOOK }));
}

logger.stream = {
    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ write: (message: any, _encoding: any) => v... Remove this comment to see the full error message
    // eslint-disable-next-line no-unused-vars
    write: function(message: $TSFixMe, _encoding: $TSFixMe) {
        logger.http(message);
    },
};

export default logger;
