import logger from 'CommonServer/Utils/Logger';
import App from 'CommonServer/Utils/StartServer';
import { PostgresAppInstance } from 'CommonServer/Infrastructure/PostgresDatabase';
import FetchCertificateJobs from './Jobs/FetchCertificates';

const APP_NAME: string = 'ingress';

const init: () => Promise<void> = async (): Promise<void> => {
    try {
        // init the app
        await App(APP_NAME);

        // connect to the database.
        await PostgresAppInstance.connect(
            PostgresAppInstance.getDatasourceOptions()
        );

        // init the jobs
        FetchCertificateJobs.init();
    } catch (err) {
        logger.error('App Init Failed:');
        logger.error(err);
        throw err;
    }
};

init().catch((err: Error) => {
    logger.error(err);
    logger.info('Exiting node process');
    process.exit(1);
});
