import { createLogger, format, Logger, transports } from 'winston';

const { combine, timestamp, errors, colorize, cli } = format;

const logger: Logger = createLogger({
    format: combine(
        colorize(),
        cli({
            colors: {
                error: 'red',
                warn: 'yellow',
                info: 'blue',
                http: 'green',
                verbose: 'cyan',
                debug: 'white',
            },
        }),
        errors({ stack: true }), // <-- use errors format
        timestamp()
    ),
    transports: [new transports.Console()],
});

export default logger;
