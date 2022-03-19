import winston from 'winston';
import logger from 'common-server/utils/logger';
export default {
    log: (functionName: $TSFixMe, error: $TSFixMe) => {
        error = error && error.message ? error.message : error;
        logger.error(error);
        winston.error(
            JSON.stringify(
                {
                    error: String(error),
                    functionName: String(functionName),
                    stack: new Error().stack,
                },

                0,
                2
            )
        );
    },
};
