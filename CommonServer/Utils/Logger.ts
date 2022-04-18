import winston from 'winston';

const consoleTransport: winston.transports.ConsoleTransportInstance =
    new winston.transports.Console({
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

const transports: Array<winston.transports.ConsoleTransportInstance> = [];

// Configure transports (defined above)
transports.push(consoleTransport);

const logger: winston.Logger = winston.createLogger({
    transports,
});

export default logger;
