import { createLogger, Logger, transports, format } from 'winston';

const { combine, timestamp, errors, prettyPrint } = format;

const logger: Logger = createLogger({
    format: combine(
        errors({ stack: true }), // <-- use errors format
        timestamp(),
        prettyPrint()
    ),
    transports: [new transports.Console()],
});

export default logger;
