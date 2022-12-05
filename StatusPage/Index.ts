import App from 'CommonServer/Utils/StartServer';
import path from 'path';
import Express, {
    ExpressApplication,
    ExpressRequest,
    ExpressResponse,
    ExpressStatic,
} from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';
import { PostgresAppInstance } from 'CommonServer/Infrastructure/PostgresDatabase';
import GreenlockChallengeService from "CommonServer/Services/GreenlockChallengeService";
import GreenlockChallenge from 'Model/Models/GreenlockChallenge';
import Response from 'CommonServer/Utils/Response';
import NotFoundException from 'Common/Types/Exception/NotFoundException';

export const APP_NAME: string = 'status-page';

const app: ExpressApplication = Express.getExpressApp();

app.use(ExpressStatic(path.join(__dirname, 'public')));

app.use(`/${APP_NAME}`, ExpressStatic(path.join(__dirname, 'public')));

app.use(
    [`/${APP_NAME}/assets`, `/${APP_NAME}/${APP_NAME}/assets`],
    ExpressStatic(path.join(__dirname, 'dist'))
);

// ACME Challenge Validation. 
app.get('/.well-known/acme-challenge/:token', async (
    req: ExpressRequest,
    res: ExpressResponse
) => {
    const challenge : GreenlockChallenge | null = await GreenlockChallengeService.findOneBy({
        query: {
            key: req.params['token'] as string
        },
        select: {
            challenge: true,
        },
        props: {
            isRoot: true, 
        }
    })

    if (!challenge) {
        return Response.sendErrorResponse(req, res, new NotFoundException("Challenge not found"));
    }

    return Response.sendTextResponse(req, res, challenge.challenge as string);
});

app.get('/*', (_req: ExpressRequest, res: ExpressResponse) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const init: Function = async (): Promise<void> => {
    try {
        // init the app
        await App(APP_NAME);

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
