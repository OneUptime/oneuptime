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
               
            
                GreenlockCertificateService.findOneBy({
                    query: {
                        key: serverName,
                    },
                    select: {
                        blob: true,
                    },
                    props: {
                        isRoot: true,
                    },
                }).then((result: GreenlockCertificate | null) => {
                    if (!result) {
                        return callback("Certificate not found");
                    }

                    const blob = JSON.parse(result.blob as string);

                    callback(null, new (tls as any).createSecureContext({
                        cert: blob.cert as string,
                        key: blob.key as string,
                    }));
                }).catch((err: Error) => {
                    logger.error(err);
                    return callback("Server Error. Please try again later.");
                });
            }
        });
    } catch (err) {
        logger.error('App Init Failed:');
        logger.error(err);
    }
};

init();

export default app;
