/* eslint-disable no-console */
import logger from './Logger';
process.on('exit', () => {
    logger.info('Server Shutting Shutdown');
});

process.on('unhandledRejection', (err: Error) => {
    logger.error('Unhandled rejection in server process occurred');
    logger.error(err);
});

process.on('uncaughtException', (err: Error) => {
    logger.error('Uncaught exception in server process occurred');
    logger.error(err);
});
