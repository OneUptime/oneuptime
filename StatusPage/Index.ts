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

export const APP_NAME: string = 'status-page-api';

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
        await App(APP_NAME, new Port(3106));

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
