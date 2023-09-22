import ApiKeyService from '../Services/ApiKeyService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
    OneUptimeRequest,
} from '../Utils/Express';

import ApiKey from 'Model/Models/ApiKey';
import OneUptimeDate from 'Common/Types/Date';
import UserType from 'Common/Types/UserType';
import AccessTokenService from '../Services/AccessTokenService';
import { UserTenantAccessPermission } from 'Common/Types/Permission';
import Dictionary from 'Common/Types/Dictionary';
import QueryHelper from '../Types/Database/QueryHelper';
import GlobalConfigService from '../Services/GlobalConfigService';
import User from 'Model/Models/User';
import UserService from '../Services/UserService';
import GlobalConfig from 'Model/Models/GlobalConfig';
import logger from '../Utils/Logger';

export default class ProjectMiddleware {
    public static getProjectId(req: ExpressRequest): ObjectID | null {
        let projectId: ObjectID | null = null;
        if (req.params && req.params['tenantid']) {
            projectId = new ObjectID(req.params['tenantid']);
        } else if (req.query && req.query['tenantid']) {
            projectId = new ObjectID(req.query['tenantid'] as string);
        } else if (req.headers && req.headers['tenantid']) {
            // Header keys are automatically transformed to lowercase
            projectId = new ObjectID(req.headers['tenantid'] as string);
        } else if (req.headers && req.headers['projectid']) {
            // Header keys are automatically transformed to lowercase
            projectId = new ObjectID(req.headers['projectid'] as string);
        } else if (req.body && req.body.projectId) {
            projectId = new ObjectID(req.body.projectId as string);
        }

        return projectId;
    }

    public static getApiKey(req: ExpressRequest): ObjectID | null {
        if (req.headers && req.headers['apikey']) {
            return new ObjectID(req.headers['apikey'] as string);
        }

        return null;
    }

    public static hasApiKey(req: ExpressRequest): boolean {
        return Boolean(this.getApiKey(req));
    }

    public static hasProjectID(req: ExpressRequest): boolean {
        return Boolean(this.getProjectId(req));
    }

    public static async isValidProjectIdAndApiKeyMiddleware(
        req: ExpressRequest,
        _res: ExpressResponse,
        next: NextFunction
    ): Promise<void> {
        try {
            const tenantId: ObjectID | null = this.getProjectId(req);

            logger.info('tenantId', tenantId);

            const apiKey: ObjectID | null = this.getApiKey(req);

            if (tenantId) {
                (req as OneUptimeRequest).tenantId = tenantId;
            }

            if (!apiKey) {
                throw new BadDataException('ApiKey not found in the request');
            }

            let apiKeyModel: ApiKey | null = null;

            if (tenantId) {
                apiKeyModel = await ApiKeyService.findOneBy({
                    query: {
                        projectId: tenantId,
                        apiKey: apiKey,
                        expiresAt: QueryHelper.greaterThan(
                            OneUptimeDate.getCurrentDate()
                        ),
                    },
                    select: {
                        _id: true,
                    },
                    props: { isRoot: true },
                });

                if (apiKeyModel) {
                    (req as OneUptimeRequest).userType = UserType.API;
                    // TODO: Add API key permissions.
                    // (req as OneUptimeRequest).permissions =
                    //     apiKeyModel.permissions || [];
                    (req as OneUptimeRequest).userGlobalAccessPermission =
                        await AccessTokenService.getDefaultApiGlobalPermission(
                            tenantId
                        );

                    const userTenantAccessPermission: UserTenantAccessPermission | null =
                        await AccessTokenService.getApiTenantAccessPermission(
                            tenantId,
                            apiKeyModel.id!
                        );

                    if (userTenantAccessPermission) {
                        (req as OneUptimeRequest).userTenantAccessPermission =
                            {};
                        (
                            (req as OneUptimeRequest)
                                .userTenantAccessPermission as Dictionary<UserTenantAccessPermission>
                        )[tenantId.toString()] = userTenantAccessPermission;

                        return next();
                    }
                }
            }

            if (!apiKeyModel) {
                // check master key.
                const masterKeyGlobalConfig: GlobalConfig | null =
                    await GlobalConfigService.findOneBy({
                        query: {
                            _id: ObjectID.getZeroObjectID().toString(),
                            isMasterApiKeyEnabled: true,
                            masterApiKey: apiKey,
                        },
                        props: {
                            isRoot: true,
                        },
                        select: {
                            _id: true,
                        },
                    });

                if (masterKeyGlobalConfig) {
                    (req as OneUptimeRequest).userType = UserType.MasterAdmin;

                    // get master admin user

                    const user: User | null = await UserService.findOneBy({
                        query: {
                            isMasterAdmin: true,
                        },
                        select: {
                            _id: true,
                            email: true,
                            name: true,
                        },
                        props: {
                            isRoot: true,
                        },
                    });

                    if (!user) {
                        throw new BadDataException(
                            'Master Admin user not found. Please make sure you have created a master admin user.'
                        );
                    }

                    (req as OneUptimeRequest).userAuthorization = {
                        userId: user.id!,
                        isMasterAdmin: true,
                        email: user.email!,
                        name: user.name!,
                    };

                    return next();
                }
            }

            if (!tenantId) {
                throw new BadDataException(
                    'ProjectID not found in the request header.'
                );
            }

            throw new BadDataException('Invalid Project ID or API Key');
        } catch (err) {
            next(err);
        }
    }
}
