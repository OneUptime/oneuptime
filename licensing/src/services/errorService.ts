import winston from 'winston';

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

                0,
                2
            )
        );
    },
};
