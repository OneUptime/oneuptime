import { createLogger, Logger, transports } from 'winston';

const logger: Logger = createLogger({
    transports: [new transports.Console()],
});

export default logger;
