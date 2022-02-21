const logger = require('./logger');

module.exports = {
    // logdata would be undefined for some logs
    // eg: realtimeservice logs, etc
    log: (functionName, err, logdata = {}) => {
        const error = new Error(`${functionName} ${err}`);

        logdata.message = `${functionName} ${error}`;
        logdata.trace = error;
        logdata.level = 'error';

        logger.error(logdata);
    },
};
