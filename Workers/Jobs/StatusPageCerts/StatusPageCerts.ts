import {
    EVERY_FIVE_MINUTE,
    EVERY_HOUR,
    EVERY_MINUTE,
} from 'Common/Utils/CronTime';
import RunCron from '../../Utils/Cron';
import { IsDevelopment } from 'CommonServer/Config';
import StatusPageDomain from 'Model/Models/StatusPageDomain';
import StatusPageDomainService from 'CommonServer/Services/StatusPageDomainService';
// @ts-ignore
import Greenlock from 'greenlock';
import logger from 'CommonServer/Utils/Logger';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
} from 'CommonServer/Utils/Express';
import JSONFunctions from 'Common/Types/JSONFunctions';
import ClusterKeyAuthorization from 'CommonServer/Middleware/ClusterKeyAuthorization';
import { JSONObject } from 'Common/Types/JSON';
import Response from 'CommonServer/Utils/Response';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import axios, { AxiosResponse } from 'axios';
import GreenlockCertificate from 'Model/Models/GreenlockCertificate';
import GreenlockCertificateService from 'CommonServer/Services/GreenlockCertificateService';
import fs from 'fs';
import SelfSignedSSL from '../../Utils/SelfSignedSSL';

const router: ExpressRouter = Express.getRouter();

const greenlock: any = Greenlock.create({
    configFile: '/greenlockrc',
    packageRoot: `/usr/src/app`,
    manager: '/usr/src/app/Utils/Greenlock/Manager.ts',
    approveDomains: async (opts: any) => {
        const domain: StatusPageDomain | null =
            await StatusPageDomainService.findOneBy({
                query: {
                    fullDomain: opts.domain,
                },
                select: {
                    _id: true,
                    fullDomain: true,
                },
                props: {
                    isRoot: true,
                },
            });

        if (!domain) {
            throw new BadDataException(
                `Domain ${opts.domain} does not exist in StatusPageDomain`
            );
        }

        return opts; // or Promise.resolve(opts);
    },
    store: {
        module: '/usr/src/app/Utils/Greenlock/Store.ts',
    },
    // Staging for testing environments
    // staging: IsDevelopment,

    // This should be the contact who receives critical bug and security notifications
    // Optionally, you may receive other (very few) updates, such as important new features
    maintainerEmail: 'lets-encrypt@oneuptime.com',

    // for an RFC 8555 / RFC 7231 ACME client user agent
    packageAgent: 'oneuptime/1.0.0',

    notify: function (event: string, details: any) {
        if ('error' === event) {
            logger.error('Greenlock Notify: ' + event);
            logger.error(details);
        }
        logger.info('Greenlock Notify: ' + event);
        logger.info(details);
    },

    agreeToTerms: true,
    challenges: {
        'http-01': {
            module: '/usr/src/app/Utils/Greenlock/HttpChallenge.ts',
        },
    },
});

// Delete
router.delete(
    `/certs`,
    ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
    async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
            const body: JSONObject = req.body;

            if (!body['domain']) {
                throw new BadDataException('Domain is required');
            }

            await greenlock.remove({
                subject: body['domain'],
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
    async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
            const body: JSONObject = req.body;

            if (!body['domain']) {
                throw new BadDataException('Domain is required');
            }

            await greenlock.add({
                subject: body['domain'],
                altnames: [body['domain']],
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
    async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
            const body: JSONObject = req.body;

            if (!body['domain']) {
                throw new BadDataException('Domain is required');
            }

            const site: JSONObject = await greenlock.get({
                servername: body['domain'] as string,
            });

            return Response.sendJsonObjectResponse(req, res, site);
        } catch (err) {
            next(err);
        }
    }
);

RunCron(
    'StatusPageCerts:RenewCerts',
    { schedule: IsDevelopment ? EVERY_MINUTE : EVERY_HOUR, runOnStartup: true },
    async () => {
        logger.info('Renewing Certs...');
        await greenlock.renew();
        logger.info('Renew Completed...');
    }
);

RunCron(
    'StatusPageCerts:OrderCerts',
    { schedule: IsDevelopment ? EVERY_MINUTE : EVERY_HOUR, runOnStartup: true },
    async () => {
        // Fetch all domains where certs are added to greenlock.

        const domains: Array<StatusPageDomain> =
            await StatusPageDomainService.findBy({
                query: {
                    isAddedToGreenlock: true,
                    isSslProvisioned: false,
                },
                select: {
                    _id: true,
                    greenlockConfig: true,
                    fullDomain: true,
                },
                limit: LIMIT_MAX,
                skip: 0,
                props: {
                    isRoot: true,
                },
            });

        for (const domain of domains) {
            logger.info(
                `StatusPageCerts:OrderCerts - Ordering Certificate ${domain.fullDomain}`
            );

            await greenlock.order(domain.greenlockConfig);
        }
    }
);

RunCron(
    'StatusPageCerts:AddCerts',
    { schedule: IsDevelopment ? EVERY_MINUTE : EVERY_HOUR, runOnStartup: true },
    async () => {
        const domains: Array<StatusPageDomain> =
            await StatusPageDomainService.findBy({
                query: {
                    isAddedToGreenlock: false,
                },
                select: {
                    _id: true,
                    fullDomain: true,
                    cnameVerificationToken: true,
                },
                limit: LIMIT_MAX,
                skip: 0,
                props: {
                    isRoot: true,
                },
            });

        for (const domain of domains) {
            logger.info(
                `StatusPageCerts:AddCerts - Checking CNAME ${domain.fullDomain}`
            );

            // Check CNAME validation and if that fails. Remove certs from Greenlock.
            const isValid: boolean = await checkCnameValidation(
                domain.fullDomain!,
                domain.cnameVerificationToken!
            );

            if (isValid) {
                logger.info(
                    `StatusPageCerts:AddCerts - CNAME for ${domain.fullDomain} is valid. Adding domain to greenlock.`
                );

                await StatusPageDomainService.updateOneById({
                    id: domain.id!,
                    data: {
                        isCnameVerified: true,
                    },
                    props: {
                        isRoot: true,
                    },
                });

                await greenlock.add({
                    subject: domain.fullDomain,
                    altnames: [domain.fullDomain],
                });

                await StatusPageDomainService.updateOneById({
                    id: domain.id!,
                    data: {
                        isAddedToGreenlock: true,
                    },
                    props: {
                        isRoot: true,
                    },
                });

                logger.info(
                    `StatusPageCerts:AddCerts - ${domain.fullDomain} added to greenlock.`
                );
            } else {
                logger.info(
                    `StatusPageCerts:AddCerts - CNAME for ${domain.fullDomain} is invalid. Removing cert`
                );
            }
        }
    }
);

RunCron(
    'StatusPageCerts:RemoveCerts',
    { schedule: IsDevelopment ? EVERY_MINUTE : EVERY_HOUR, runOnStartup: true },
    async () => {
        // Fetch all domains where certs are added to greenlock.

        const domains: Array<StatusPageDomain> =
            await StatusPageDomainService.findBy({
                query: {
                    isAddedToGreenlock: true,
                },
                select: {
                    _id: true,
                    fullDomain: true,
                    cnameVerificationToken: true,
                },
                limit: LIMIT_MAX,
                skip: 0,
                props: {
                    isRoot: true,
                },
            });

        for (const domain of domains) {
            logger.info(
                `StatusPageCerts:RemoveCerts - Checking CNAME ${domain.fullDomain}`
            );

            // Check CNAME validation and if that fails. Remove certs from Greenlock.
            const isValid: boolean = await checkCnameValidation(
                domain.fullDomain!,
                domain.cnameVerificationToken!
            );

            if (!isValid) {
                logger.info(
                    `StatusPageCerts:RemoveCerts - CNAME for ${domain.fullDomain} is invalid. Removing domain from greenlock.`
                );

                await greenlock.remove({
                    subject: domain.fullDomain,
                });

                await StatusPageDomainService.updateOneById({
                    id: domain.id!,
                    data: {
                        isAddedToGreenlock: false,
                        isCnameVerified: false,
                    },
                    props: {
                        isRoot: true,
                    },
                });

                logger.info(
                    `StatusPageCerts:RemoveCerts - ${domain.fullDomain} removed from greenlock.`
                );
            } else {
                logger.info(
                    `StatusPageCerts:RemoveCerts - CNAME for ${domain.fullDomain} is valid`
                );
            }
        }
    }
);

RunCron(
    'StatusPageCerts:WriteSelfSignedCertsToDisk',
    { schedule: IsDevelopment ? EVERY_MINUTE : EVERY_FIVE_MINUTE, runOnStartup: true },
    async () => {
        // Fetch all domains where certs are added to greenlock.

        const certs: Array<GreenlockCertificate> =
            await GreenlockCertificateService.findBy({
                query: {},
                select: {
                    key: true,
                },
                limit: LIMIT_MAX,
                skip: 0,
                props: {
                    isRoot: true,
                },
            });

        const statusPageDomains: Array<StatusPageDomain> =
            await StatusPageDomainService.findBy({
                query: {
                    isSelfSignedSslGenerated: false,
                },
                select: {
                    fullDomain: true,
                    _id: true,
                },
                limit: LIMIT_MAX,
                skip: 0,
                props: {
                    isRoot: true,
                    ignoreHooks: true,
                },
            });

        const greenlockCertDomains: Array<string | undefined> = certs.map(
            (cert: GreenlockCertificate) => {
                return cert.key;
            }
        );

        // Generate self signed certs
        for (const domain of statusPageDomains) {
            if (greenlockCertDomains.includes(domain.fullDomain)) {
                continue;
            }

            if (!domain.fullDomain) {
                continue;
            }

            await SelfSignedSSL.generate(
                '/usr/src/Certs/StatusPageCerts',
                domain.fullDomain
            );

            await StatusPageDomainService.updateOneById({
                id: domain.id!,
                data: {
                    isSelfSignedSslGenerated: true,
                },
                props: {
                    ignoreHooks: true,
                    isRoot: true,
                },
            });
        }
    }
);

RunCron(
    'StatusPageCerts:WriteGreelockCertsToDisk',
    { schedule: IsDevelopment ? EVERY_MINUTE : EVERY_HOUR, runOnStartup: true },
    async () => {
        // Fetch all domains where certs are added to greenlock.

        const certs: Array<GreenlockCertificate> =
            await GreenlockCertificateService.findBy({
                query: {},
                select: {
                    isKeyPair: true,
                    key: true,
                    blob: true,
                },
                limit: LIMIT_MAX,
                skip: 0,
                props: {
                    isRoot: true,
                },
            });

        for (const cert of certs) {
            if (!cert.isKeyPair) {
                continue;
            }

            const certBlob: GreenlockCertificate | undefined = certs.find(
                (i: GreenlockCertificate) => {
                    return i.key === cert.key && !i.isKeyPair;
                }
            );

            if (!certBlob) {
                continue;
            }

            const key: string = JSONFunctions.parse(cert.blob || '{}')[
                'privateKeyPem'
            ] as string;
            let crt: string = JSONFunctions.parse(certBlob.blob || '{}')[
                'cert'
            ] as string;

            if (JSONFunctions.parse(certBlob.blob || '{}')['chain'] as string) {
                crt += ('\n' +
                    '\n' +
                    JSONFunctions.parse(certBlob.blob || '{}')[
                        'chain'
                    ]) as string;
            }

            // Write to disk.
            fs.writeFileSync(
                `/usr/src/Certs/StatusPageCerts/${cert.key}.crt`,
                crt
            );
            fs.writeFileSync(
                `/usr/src/Certs/StatusPageCerts/${cert.key}.key`,
                key
            );
        }
    }
);

RunCron(
    'StatusPageCerts:CheckSslProvisioningStatus',
    { schedule: IsDevelopment ? EVERY_MINUTE : EVERY_HOUR, runOnStartup: true },
    async () => {
        // Fetch all domains where certs are added to greenlock.

        const domains: Array<StatusPageDomain> =
            await StatusPageDomainService.findBy({
                query: {
                    isAddedToGreenlock: true,
                },
                select: {
                    _id: true,
                    fullDomain: true,
                    cnameVerificationToken: true,
                },
                limit: LIMIT_MAX,
                skip: 0,
                props: {
                    isRoot: true,
                },
            });

        for (const domain of domains) {
            logger.info(
                `StatusPageCerts:RemoveCerts - Checking CNAME ${domain.fullDomain}`
            );

            // Check CNAME validation and if that fails. Remove certs from Greenlock.
            const isValid: boolean = await isSslProvisioned(
                domain.fullDomain!,
                domain.cnameVerificationToken!
            );

            if (!isValid) {
                await StatusPageDomainService.updateOneById({
                    id: domain.id!,
                    data: {
                        isSslProvisioned: false,
                    },
                    props: {
                        isRoot: true,
                    },
                });
            } else {
                await StatusPageDomainService.updateOneById({
                    id: domain.id!,
                    data: {
                        isSslProvisioned: true,
                    },
                    props: {
                        isRoot: true,
                    },
                });
            }
        }
    }
);

const checkCnameValidation: Function = async (
    fulldomain: string,
    token: string
): Promise<boolean> => {
    try {
        const result: AxiosResponse = await axios.get(
            'http://' +
                fulldomain +
                '/status-page-api/cname-verification/' +
                token
        );

        if (result.status === 200) {
            return true;
        }
        return false;
    } catch (err) {
        logger.info('Failed checking for CNAME ' + fulldomain);
        logger.info('Token: ' + token);
        logger.info(err);
        return false;
    }
};

const isSslProvisioned: Function = async (
    fulldomain: string,
    token: string
): Promise<boolean> => {
    try {
        const result: AxiosResponse = await axios.get(
            'https://' +
                fulldomain +
                '/status-page-api/cname-verification/' +
                token
        );

        if (result.status === 200) {
            return true;
        }
        return false;
    } catch (err) {
        return false;
    }
};

export default router;
