import { EVERY_HOUR, EVERY_MINUTE } from '../../Utils/CronTime';
import RunCron from '../../Utils/Cron';
import { IsDevelopment } from 'CommonServer/Config';
import StatusPageDomain from 'Model/Models/StatusPageDomain';
import StatusPageDomainService from 'CommonServer/Services/StatusPageDomainService';
// @ts-ignore
import Greenlock from 'greenlock';
import HTTPChallenge from '../../Utils/Greenlock/HTTPChallenge';
import logger from 'CommonServer/Utils/Logger';
import Store from '../../Utils/Greenlock/Store';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
} from 'CommonServer/Utils/Express';
import ClusterKeyAuthorization from 'CommonServer/Middleware/ClusterKeyAuthorization';
import { JSONObject } from 'Common/Types/JSON';
import Response from 'CommonServer/Utils/Response';

const router: ExpressRouter = Express.getRouter();

const greenlock = Greenlock.create({
    configDir: './greenlock.d/',
    packageRoot: `../../${__dirname}`,
    manager: './Utils/Greenlock/Manager.ts',
    approveDomains: async (opts: any) => {
        const domain: StatusPageDomain | null = await StatusPageDomainService.findOneBy({
            query: {
                fullDomain: opts.domain,
            },
            select: {
                _id: true,
                fullDomain: true
            },
            props: {
                isRoot: true,
            }
        });

        if (!domain) {
            throw new BadDataException(`Domain ${opts.domain} does not exist in StatusPageDomain`);
        }


        return opts; // or Promise.resolve(opts);
    },
    store: Store,
    // Staging for testing environments
    staging: IsDevelopment,

    // This should be the contact who receives critical bug and security notifications
    // Optionally, you may receive other (very few) updates, such as important new features
    maintainerEmail: 'lets-encrypt@oneuptime.com',

    // for an RFC 8555 / RFC 7231 ACME client user agent
    packageAgent: "oneuptime/1.0.0",
    notify: function (event: string, details: any) {
        if ('error' === event) {
            logger.error(details);
        }
    },

    agreeToTerms: true,
    challenges: {
        'http-01': HTTPChallenge
    },
});


// Delete
router.delete(
    `/certs`,
    ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ) => {
        try {
            const body: JSONObject = req.body;
            
            if (!body['domain']) {
                throw new BadDataException("Domain is required");
            }

            await greenlock.remove({
                subject: body['domain']
            });

            return Response.sendEmptyResponse(req, res);
        } catch (err) {
            next(err);
        }
    }
);


// Create
router.post(
    `/certs`,
    ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ) => {
        try {
            const body: JSONObject = req.body;
            
            if (!body['domain']) {
                throw new BadDataException("Domain is required");
            }

            await greenlock.add({
                subject: body['domain']
            });

            return Response.sendEmptyResponse(req, res);
        } catch (err) {
            next(err);
        }
    }
);

// Create
router.get(
    `/certs`,
    ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ) => {
        try {
            const body: JSONObject = req.body;
            
            if (!body['domain']) {
                throw new BadDataException("Domain is required");
            }

            const site = await greenlock.get({ servername: body['domain'] as string });

            return Response.sendJsonObjectResponse(req, res, site);
        } catch (err) {
            next(err);
        }
    }
);


RunCron('StatusPage:Certs', IsDevelopment ? EVERY_MINUTE : EVERY_HOUR, async () => {
    // fetch all domains wiht expired certs. 
    await greenlock.renew({});
});

export default router;