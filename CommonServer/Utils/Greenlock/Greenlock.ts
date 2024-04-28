import BadDataException from 'Common/Types/Exception/BadDataException';
import { JSONObject } from 'Common/Types/JSON';
import { LetsEncryptNotificationEmail } from '../../EnvironmentConfig';
import StatusPageDomainService from '../../Services/StatusPageDomainService';
import logger from '../Logger';
import StatusPageDomain from 'Model/Models/StatusPageDomain';
// @ts-ignore
import Greenlock from 'greenlock';

export default class GreenlockUtil {
    private static greenLockInstance: any = null;

    public static getGreenlockInstance(): any {
        if (this.greenLockInstance) {
            return this.greenLockInstance;
        }

        this.greenLockInstance = Greenlock.create({
            configFile: '/usr/src/Common/FeatureSet/Workers/greenlockrc',
            packageRoot: `/usr/src/app/greenlock`,
            manager:
                '/usr/src/app/FeatureSet/Workers/Utils/Greenlock/Manager.ts',
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
                module: '/usr/src/app/FeatureSet/Workers/Utils/Greenlock/Store.ts',
            },
            // Staging for testing environments
            // staging: IsDevelopment,

            // This should be the contact who receives critical bug and security notifications
            // Optionally, you may receive other (very few) updates, such as important new features
            maintainerEmail: LetsEncryptNotificationEmail.toString(),

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
                    module: '/usr/src/app/FeatureSet/Workers/Utils/Greenlock/HttpChallenge.ts',
                },
            },
        });

        return this.greenLockInstance;
    }

    public static async removeDomain(domain: string): Promise<void> {
        await this.getGreenlockInstance().remove({
            subject: domain,
        });
    }

    public static async addDomain(domain: string): Promise<void> {
        await this.getGreenlockInstance().add({
            subject: domain,
            altnames: [domain],
        });
    }

    public static async getCert(domain: string): Promise<JSONObject> {
        const site: JSONObject = await this.getGreenlockInstance().get({
            servername: domain,
        });

        return site;
    }

    public static async renewAllCerts(): Promise<void> {
        await this.getGreenlockInstance().renew();
    }

    public static async orderCert(greenlockConfig: JSONObject): Promise<void> {
        await this.getGreenlockInstance().order(greenlockConfig);
    }
}
