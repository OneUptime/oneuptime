import winston from 'winston';

const consoleTransport: $TSFixMe = new winston.transports.Console({
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

const transports: $TSFixMe = [];

// Configure transports (defined above)
transports.push(consoleTransport);

const logger: $TSFixMe = winston.createLogger({
    transports,
});

export default logger;
