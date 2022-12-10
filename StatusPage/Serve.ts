import App from 'CommonServer/Utils/StartServer';
import path from 'path';
import Express, {
    ExpressApplication,
    ExpressRequest,
    ExpressResponse,
    ExpressStatic,
} from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';
import Port from 'Common/Types/Port';
import tls from 'tls';
import { PostgresAppInstance } from 'CommonServer/Infrastructure/PostgresDatabase';
import GreenlockCertificateService from 'CommonServer/Services/GreenlockCertificateService';
import GreenlockCertificate from 'Model/Models/GreenlockCertificate';
export const APP_NAME: string = 'status-page';

const app: ExpressApplication = Express.getExpressApp();

app.use(ExpressStatic(path.join(__dirname, 'public')));

app.use(`/${APP_NAME}`, ExpressStatic(path.join(__dirname, 'public')));

app.get('/*', (_req: ExpressRequest, res: ExpressResponse) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const init: Function = async (): Promise<void> => {
    try {
        // init the app
        await App(APP_NAME, new Port(3105), {
            port: new Port(3107),
            sniCallback: (serverName: string, callback: Function) => {
                logger.info("SNI CALLBACK " + serverName);
               
                GreenlockCertificateService.findBy({
                    query: {
                        key: serverName,
                    },
                    select: {
                        blob: true,
                        isKeyPair: true
                    },
                    skip: 0, 
                    limit: 10,
                    props: {
                        isRoot: true,
                    },
                }).then((result: Array<GreenlockCertificate>) => {
                    if (result.length === 0) {
                        return callback(null, null);
                    }
        
                    const certBlob = JSON.parse(result.find((i) => !i.isKeyPair)?.blob || '{}');
                    const keyBlob = JSON.parse(result.find((i) => i.isKeyPair)?.blob || '{}');

                    callback(null, tls.createSecureContext({
                        cert: certBlob.cert,
                        key: keyBlob.privateKeyPem,
                    }));
                }).catch((err: Error) => {
                    logger.error(err);
                    return callback("Server Error. Please try again later.");
                });
            }
        });

        // connect to the database.
        await PostgresAppInstance.connect(
            PostgresAppInstance.getDatasourceOptions()
        );

    } catch (err) {
        logger.error('App Init Failed:');
        logger.error(err);
    }
};

init();

export default app;
