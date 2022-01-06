const logger = require('../config/logger');

module.exports = {
    log: (functionName, err) => {
        const error = new Error(`${functionName} ${err}`);
        logger.error(error);
    },
};
