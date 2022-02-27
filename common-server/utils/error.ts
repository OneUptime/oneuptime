import logger from './logger';

export default {
    // logdata would be undefined for some logs
    // eg: realtimeservice logs, etc
    log: (functionName: $TSFixMe, err: $TSFixMe, logdata = {}) => {
        const error = new Error(`${functionName} ${err}`);

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'message' does not exist on type '{}'.
        logdata.message = `${functionName} ${error}`;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'trace' does not exist on type '{}'.
        logdata.trace = error;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'level' does not exist on type '{}'.
        logdata.level = 'error';

        logger.error(logdata);
    },
};
