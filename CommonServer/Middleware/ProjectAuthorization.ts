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
import Response from '../Utils/Response';
import QueryHelper from '../Types/Database/QueryHelper';

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
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> {
        const tenantId: ObjectID | null = this.getProjectId(req);

        console.log(tenantId);

        const apiKey: ObjectID | null = this.getApiKey(req);

        console.log(apiKey);

        if (!tenantId) {
            throw new BadDataException('tenantId not found in the request');
        }

        if (!apiKey) {
            throw new BadDataException('ApiKey not found in the request');
        }

        const apiKeyModel: ApiKey | null = await ApiKeyService.findOneBy({
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
            (req as OneUptimeRequest).tenantId = tenantId;
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
                (req as OneUptimeRequest).userTenantAccessPermission = {};
                (
                    (req as OneUptimeRequest)
                        .userTenantAccessPermission as Dictionary<UserTenantAccessPermission>
                )[tenantId.toString()] = userTenantAccessPermission;

                return next();
            }
        }

        return Response.sendErrorResponse(
            req,
            res,
            new BadDataException('Invalid Project ID or API Key')
        );
    }
}
