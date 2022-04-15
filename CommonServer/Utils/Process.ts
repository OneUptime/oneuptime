/* eslint-disable no-console */
import logger from './Logger';
process.on('exit', () => {
    logger.info('Server Shutting Shutdown');
});

process.on('unhandledRejection', (err: $TSFixMe) => {
    logger.error('Unhandled rejection in server process occurred');
    logger.error(err);
});

process.on('uncaughtException', (err: $TSFixMe) => {
    logger.error('Uncaught exception in server process occurred');
    logger.error(err);
});
