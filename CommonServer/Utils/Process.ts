/* eslint-disable no-console */
import logger from './Logger';
process.on('exit', () => {
    logger.info('Server Shutting Shutdown');
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection in server process occurred');
    logger.error(reason);
    logger.error(promise);
});

process.on('uncaughtException', (err: Error) => {
    logger.error('Uncaught exception in server process occurred');
    logger.error(err);
});
