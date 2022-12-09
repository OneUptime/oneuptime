import App from 'CommonServer/Utils/StartServer';
import Express, {
    ExpressApplication,
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';
import { PostgresAppInstance } from 'CommonServer/Infrastructure/PostgresDatabase';
import GreenlockChallengeService from 'CommonServer/Services/GreenlockChallengeService';
import GreenlockChallenge from 'Model/Models/GreenlockChallenge';
import Response from 'CommonServer/Utils/Response';
import NotFoundException from 'Common/Types/Exception/NotFoundException';
import BadDataException from 'Common/Types/Exception/BadDataException';
import StatusPageDomain from 'Model/Models/StatusPageDomain';
import StatusPageDomainService from 'CommonServer/Services/StatusPageDomainService';
import Port from 'Common/Types/Port';
import tls from 'tls';
import GreenlockCertificateService from 'CommonServer/Services/GreenlockCertificateService';
import GreenlockCertificate from 'Model/Models/GreenlockCertificate';

export const APP_NAME: string = 'status-page';

const app: ExpressApplication = Express.getExpressApp();

// ACME Challenge Validation.
app.get(
    '/.well-known/acme-challenge/:token',
    async (req: ExpressRequest, res: ExpressResponse) => {
        const challenge: GreenlockChallenge | null =
            await GreenlockChallengeService.findOneBy({
                query: {
                    token: req.params['token'] as string,
                },
                select: {
                    challenge: true,
                },
                props: {
                    isRoot: true,
                },
            });

        if (!challenge) {
            return Response.sendErrorResponse(
                req,
                res,
                new NotFoundException('Challenge not found')
            );
        }

        return Response.sendTextResponse(
            req,
            res,
            challenge.challenge as string
        );
    }
);

app.get(
    '/status-page-api/cname-verification/:token',
    async (req: ExpressRequest, res: ExpressResponse) => {
        logger.info('HERE!');
        const host: string | undefined = req.get('host');

        if (!host) {
            throw new BadDataException('Host not found');
        }

        const domain: StatusPageDomain | null =
            await StatusPageDomainService.findOneBy({
                query: {
                    cnameVerificationToken: req.params['token'] as string,
                    fullDomain: host,
                },
                select: {
                    _id: true,
                },
                props: {
                    isRoot: true,
                },
            });

        if (!domain) {
            return Response.sendErrorResponse(
                req,
                res,
                new BadDataException('Invalid token.')
            );
        }

        return Response.sendEmptyResponse(req, res);
    }
);

const init: Function = async (): Promise<void> => {
    try {
        // init the app
        await App(APP_NAME, new Port(3106), {
            port: new Port(3108),
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
