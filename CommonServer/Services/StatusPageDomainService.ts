import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import DatabaseService from './DatabaseService';
import { OnCreate, OnDelete, OnUpdate } from '../Types/Database/Hooks';
import CreateBy from '../Types/Database/CreateBy';
import DomainService from './DomainService';
import Domain from 'Model/Models/Domain';
import BadDataException from 'Common/Types/Exception/BadDataException';
import DeleteBy from '../Types/Database/DeleteBy';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import ObjectID from 'Common/Types/ObjectID';
import StatusPageDomain from 'Model/Models/StatusPageDomain';
import GreenlockUtil from '../Utils/Greenlock/Greenlock';
import { JSONObject } from 'Common/Types/JSON';
import logger from '../Utils/Logger';
import API from 'Common/Utils/API';
import URL from 'Common/Types/API/URL';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import UpdateBy from '../Types/Database/UpdateBy';

export class Service extends DatabaseService<StatusPageDomain> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(StatusPageDomain, postgresDatabase);
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<StatusPageDomain>
    ): Promise<OnCreate<StatusPageDomain>> {
        const domain: Domain | null = await DomainService.findOneBy({
            query: {
                _id:
                    createBy.data.domainId?.toString() ||
                    createBy.data.domain?._id ||
                    '',
            },
            select: { domain: true, isVerified: true },
            props: {
                isRoot: true,
            },
        });

        if (!domain?.isVerified) {
            throw new BadDataException(
                'This domain is not verified. Please verify it by going to Settings > Domains'
            );
        }

        if (domain) {
            createBy.data.fullDomain =
                createBy.data.subdomain + '.' + domain.domain;
        }

        createBy.data.cnameVerificationToken = ObjectID.generate().toString();

        return { createBy, carryForward: null };
    }

    protected override async onBeforeDelete(
        deleteBy: DeleteBy<StatusPageDomain>
    ): Promise<OnDelete<StatusPageDomain>> {
        const domains: Array<StatusPageDomain> = await this.findBy({
            query: {
                ...deleteBy.query,
                isAddedToGreenlock: true,
            },

            skip: 0,
            limit: LIMIT_MAX,
            select: { fullDomain: true },
            props: {
                isRoot: true,
            },
        });

        return { deleteBy, carryForward: domains };
    }

    protected override async onDeleteSuccess(
        onDelete: OnDelete<StatusPageDomain>,
        _itemIdsBeforeDelete: ObjectID[]
    ): Promise<OnDelete<StatusPageDomain>> {
        for (const domain of onDelete.carryForward) {
            await this.removeDomainFromGreenlock(domain.fullDomain as string);
        }

        return onDelete;
    }

    public async removeDomainFromGreenlock(domain: string): Promise<void> {
        await GreenlockUtil.removeDomain(domain);
    }

    public async orderCert(statusPageDomain: StatusPageDomain): Promise<void> {
        return await GreenlockUtil.orderCert(
            statusPageDomain.greenlockConfig as JSONObject
        );
    }

    public async orderCertsForAllDomainsWithNoSSLProvisioned(): Promise<void> {
        const domains: Array<StatusPageDomain> = await this.findBy({
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

        logger.info(`Certificates to Order: ${domains.length}`);

        for (const domain of domains) {
            logger.info(
                `StatusPageCerts:OrderCerts - Ordering Certificate ${domain.fullDomain}`
            );

            this.orderCert(domain).catch((err: any) => {
                logger.error(
                    `StatusPageCerts:OrderCerts - Failed for domain ${domain.fullDomain}`
                );
                logger.error(err);
            });
        }
    }

    public async cleanupDomainFromGreenlock(
        domain: StatusPageDomain
    ): Promise<void> {
        // this function will remove the domain from greenlock if the CNAME does not match. It cleans up the domains that are not valid anymore.

        if (!domain.id) {
            throw new BadDataException('Domain ID is required');
        }

        const statusPageDomain: StatusPageDomain | null = await this.findOneBy({
            query: {
                _id: domain.id?.toString(),
            },
            select: {
                _id: true,
                fullDomain: true,
                cnameVerificationToken: true,
            },
            props: {
                isRoot: true,
            },
        });

        if (!statusPageDomain) {
            throw new BadDataException('Domain not found');
        }

        logger.info(
            `StatusPageCerts:RemoveCerts - Checking CNAME ${statusPageDomain.fullDomain}`
        );

        // Check CNAME validation and if that fails. Remove certs from Greenlock.
        const isValid: boolean = await this.isCnameValid(
            statusPageDomain.fullDomain!,
            statusPageDomain.cnameVerificationToken!
        );

        if (!isValid) {
            logger.info(
                `StatusPageCerts:RemoveCerts - CNAME for ${statusPageDomain.fullDomain} is invalid. Removing domain from greenlock.`
            );

            await GreenlockUtil.removeDomain(statusPageDomain.fullDomain!);

            await this.updateOneById({
                id: statusPageDomain.id!,
                data: {
                    isAddedToGreenlock: false,
                    isCnameVerified: false,
                },
                props: {
                    isRoot: true,
                },
            });

            logger.info(
                `StatusPageCerts:RemoveCerts - ${statusPageDomain.fullDomain} removed from greenlock.`
            );
        } else {
            logger.info(
                `StatusPageCerts:RemoveCerts - CNAME for ${statusPageDomain.fullDomain} is valid`
            );
        }
    }

    public async addDomainsWhichAreNotAddedToGreenlock(): Promise<void> {
        const domains: Array<StatusPageDomain> = await this.findBy({
            query: {
                isAddedToGreenlock: false,
            },
            select: {
                _id: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: {
                isRoot: true,
            },
        });

        for (const domain of domains) {
            await this.addDomainToGreenlock(domain);
        }
    }

    public async cleanupAllDomainFromGreenlock(): Promise<void> {
        const domains: Array<StatusPageDomain> = await this.findBy({
            query: {
                isAddedToGreenlock: true,
            },
            select: {
                _id: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: {
                isRoot: true,
            },
        });

        for (const domain of domains) {
            await this.cleanupDomainFromGreenlock(domain);
        }
    }

    public async addDomainToGreenlock(domain: StatusPageDomain): Promise<void> {
        logger.info(
            `StatusPageCerts:AddCerts - Checking CNAME ${domain.fullDomain}`
        );

        if (!domain.id) {
            throw new BadDataException('Domain ID is required');
        }

        const statusPageDomain: StatusPageDomain | null = await this.findOneBy({
            query: {
                _id: domain.id?.toString(),
            },
            select: {
                _id: true,
                fullDomain: true,
                cnameVerificationToken: true,
            },
            props: {
                isRoot: true,
            },
        });

        if (!statusPageDomain) {
            throw new BadDataException('Domain not found');
        }

        // Check CNAME validation and if that fails. Remove certs from Greenlock.
        const isValid: boolean = await this.isCnameValid(
            statusPageDomain.fullDomain!,
            statusPageDomain.cnameVerificationToken!
        );

        if (isValid) {
            logger.info(
                `StatusPageCerts:AddCerts - CNAME for ${statusPageDomain.fullDomain} is valid. Adding domain to greenlock.`
            );

            await this.updateOneById({
                id: statusPageDomain.id!,
                data: {
                    isCnameVerified: true,
                },
                props: {
                    isRoot: true,
                },
            });

            await GreenlockUtil.addDomain(statusPageDomain.fullDomain!);

            await this.updateOneById({
                id: statusPageDomain.id!,
                data: {
                    isAddedToGreenlock: true,
                },
                props: {
                    isRoot: true,
                },
            });

            logger.info(
                `StatusPageCerts:AddCerts - ${statusPageDomain.fullDomain} added to greenlock.`
            );
        } else {
            logger.info(
                `StatusPageCerts:AddCerts - CNAME for ${statusPageDomain.fullDomain} is invalid. Removing cert`
            );
        }
    }

    private async isSSLProvisioned(
        fulldomain: string,
        token: string
    ): Promise<boolean> {
        try {
            const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
                await API.get(
                    URL.fromString(
                        'https://' +
                            fulldomain +
                            '/status-page-api/cname-verification/' +
                            token
                    )
                );

            if (result.isFailure()) {
                return false;
            }

            return false;
        } catch (err) {
            return false;
        }
    }

    public async isCnameValid(
        fullDomain: string,
        token: string
    ): Promise<boolean> {
        try {
            const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
                await API.get(
                    URL.fromString(
                        'http://' +
                            fullDomain +
                            '/status-page-api/cname-verification/' +
                            token
                    )
                );

            if (result.isSuccess()) {
                return true;
            }

            return false;
        } catch (err) {
            logger.info('Failed checking for CNAME ' + fullDomain);
            logger.info('Token: ' + token);
            logger.info(err);
            return false;
        }
    }

    public async updateSslProvisioningStatusForAllDomains(): Promise<void> {
        const domains: Array<StatusPageDomain> = await this.findBy({
            query: {
                isAddedToGreenlock: true,
            },
            select: {
                _id: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: {
                isRoot: true,
            },
        });

        for (const domain of domains) {
            await this.updateSslProvisioningStatus(domain);
        }
    }

    public async updateSslProvisioningStatus(
        domain: StatusPageDomain
    ): Promise<void> {
        if (!domain.id) {
            throw new BadDataException('Domain ID is required');
        }

        const statusPageDomain: StatusPageDomain | null = await this.findOneBy({
            query: {
                _id: domain.id?.toString(),
            },
            select: {
                _id: true,
                fullDomain: true,
                cnameVerificationToken: true,
            },
            props: {
                isRoot: true,
            },
        });

        if (!statusPageDomain) {
            throw new BadDataException('Domain not found');
        }

        logger.info(
            `StatusPageCerts:RemoveCerts - Checking CNAME ${statusPageDomain.fullDomain}`
        );

        // Check CNAME validation and if that fails. Remove certs from Greenlock.
        const isValid: boolean = await this.isSSLProvisioned(
            statusPageDomain.fullDomain!,
            statusPageDomain.cnameVerificationToken!
        );

        if (!isValid) {
            await this.updateOneById({
                id: statusPageDomain.id!,
                data: {
                    isSslProvisioned: false,
                },
                props: {
                    isRoot: true,
                },
            });
        } else {
            await this.updateOneById({
                id: statusPageDomain.id!,
                data: {
                    isSslProvisioned: true,
                },
                props: {
                    isRoot: true,
                },
            });
        }
    }

    public async renewCertsWhichAreExpiringSoon(): Promise<void> {
        await GreenlockUtil.renewAllCerts();
    }
}
export default new Service();
