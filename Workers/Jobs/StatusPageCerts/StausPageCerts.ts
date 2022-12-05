import { EVERY_HOUR, EVERY_MINUTE } from '../../Utils/CronTime';
import RunCron from '../../Utils/Cron';
import { IsDevelopment } from 'CommonServer/Config';
import StatusPageDomain from 'Model/Models/StatusPageDomain';
import https from 'https';
import StatusPageDomainService from 'CommonServer/Services/StatusPageDomainService';
// @ts-ignore
import Greenlock from 'greenlock';
import HTTPChallenge from '../../Utils/Greenlock/HttpChallenge';
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
import LIMIT_MAX from 'Common/Types/Database/LimitMax';

const router: ExpressRouter = Express.getRouter();

const greenlock = Greenlock.create({
    configFile: '/greenlockrc',
    packageRoot: `/usr/src/app`,
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


RunCron('StatusPageCerts:Renew', IsDevelopment ? EVERY_MINUTE : EVERY_HOUR, async () => {
    // fetch all domains wiht expired certs. 
    await greenlock.renew({});
});

RunCron('StatusPageCerts:AddCerts', IsDevelopment ? EVERY_MINUTE : EVERY_HOUR, async () => {

    const domains: Array<StatusPageDomain> = await StatusPageDomainService.findBy({
        query: {
            isAddedtoGreenlock: false,
        },
        select: {
            _id: true,
            fullDomain: true,
            cnameVerificationToken: true
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
            isRoot: true,
        }
    });

     for (const domain of domains) {

        logger.info(`StatusPageCerts:AddCerts - Checking CNAME ${domain.fullDomain}`);

        // Check CNAME validation and if that fails. Remove certs from Greenlock.
        const isValid = await checkCnameValidation(domain.fullDomain!, domain.cnameVerificationToken!);

        if (isValid) {
            logger.info(`StatusPageCerts:AddCerts - CNAME for ${domain.fullDomain} is valid. Adding domain to greenlock.`);

            await greenlock.add({
                subject: domain.fullDomain
            });

            await StatusPageDomainService.updateOneById({
                id: domain.id!, 
                data: {
                    isAddedtoGreenlock: true, 
                    isCnameVerified: true
                },
                props: {
                    isRoot: true
                }
            })


            logger.info(`StatusPageCerts:AddCerts - ${domain.fullDomain} added to greenlock.`);

        } else {
        
            logger.info(`StatusPageCerts:AddCerts - CNAME for ${domain.fullDomain} is invalid. Removing cert`);
        }
         
         

    }
});


RunCron('StatusPageCerts:RemoveCerts', IsDevelopment ? EVERY_MINUTE : EVERY_HOUR, async () => {

    // Fetch all domains where certs are added to greenlock. 

    const domains: Array<StatusPageDomain> = await StatusPageDomainService.findBy({
        query: {
            isAddedtoGreenlock: true,
        },
        select: {
            _id: true,
            fullDomain: true,
            cnameVerificationToken: true
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
            isRoot: true,
        }
    });

    for (const domain of domains) {

        logger.info(`StatusPageCerts:RemoveCerts - Checking CNAME ${domain.fullDomain}`);

        // Check CNAME validation and if that fails. Remove certs from Greenlock.
        const isValid = await checkCnameValidation(domain.fullDomain!, domain.cnameVerificationToken!);

        if (!isValid) {
            logger.info(`StatusPageCerts:RemoveCerts - CNAME for ${domain.fullDomain} is invalid. Removing domain from greenlock.`);

            await greenlock.remove({
                subject: domain.fullDomain
            });

            await StatusPageDomainService.updateOneById({
                id: domain.id!, 
                data: {
                    isAddedtoGreenlock: false, 
                    isCnameVerified: false
                },
                props: {
                    isRoot: true
                }
            })

            logger.info(`StatusPageCerts:RemoveCerts - ${domain.fullDomain} removed from greenlock.`);

        } else {
            logger.info(`StatusPageCerts:RemoveCerts - CNAME for ${domain.fullDomain} is valid`);
        }

    }
});


const checkCnameValidation = (fulldomain: string, token: string): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        try {
            https.request({
                host: fulldomain,
                port: 443,
                path: '/cname-verification/' + token,
                method: 'GET',
                rejectUnauthorized: false,
                agent: false
            }, (res) => {
                if (res.statusCode === 200) {
                    return resolve(true);
                }

                return resolve(false);

            });
        } catch (err) {
            reject(err);
        }
    })

}

export default router;