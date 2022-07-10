import ApiKeyService from '../Services/ApiKeyService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
    OneUptimeRequest,
    UserType,
} from '../Utils/Express';

import ApiKey from 'Common/Models/ApiKey';
import { LessThan } from 'typeorm';
import OneUptimeDate from 'Common/Types/Date';

export default class ProjectMiddleware {
    public static getProjectId(req: ExpressRequest): ObjectID | null {
        let projectId: ObjectID | null = null;
        if (req.params && req.params['projectId']) {
            projectId = new ObjectID(req.params['projectId']);
        } else if (req.query && req.query['projectId']) {
            projectId = new ObjectID(req.query['projectId'] as string);
        } else if (req.headers && req.headers['projectid']) {
            // Header keys are automatically transformed to lowercase
            projectId = new ObjectID(req.headers['projectid'] as string);
        } else if (req.body && req.body.projectId) {
            projectId = new ObjectID(req.body.projectId as string);
        }

        return projectId;
    }

    public static getApiKey(req: ExpressRequest): ObjectID | null {
        let apiKey: ObjectID | null = null;

        if (req.query && req.query['apiKey']) {
            apiKey = new ObjectID(req.query['apiKey'] as string);
        } else if (req.headers && req.headers['apikey']) {
            apiKey = new ObjectID(req.headers['apikey'] as string);
        } else if (req.body && req.body.apiKey) {
            apiKey = req.body.apiKey;
        }

        return apiKey;
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
        const projectId: ObjectID | null = this.getProjectId(req);
        const apiKey: ObjectID | null = this.getApiKey(req);

        if (!projectId) {
            throw new BadDataException('ProjectID not found in the request');
        }

        if (!apiKey) {
            throw new BadDataException('ApiKey not found in the request');
        }

        const apiKeyModel: ApiKey | null = await ApiKeyService.findOneBy({
            query: {
                projectId: projectId,
                apiKey: apiKey,
                expiresAt: LessThan(OneUptimeDate.getCurrentDate()),
            },
        });

        if (apiKeyModel) {
            (req as OneUptimeRequest).userType = UserType.API;
            (req as OneUptimeRequest).permissions =
                apiKeyModel.permissions || [];
            (req as OneUptimeRequest).projectId = projectId;
            return next();
        }

        throw new BadDataException('Invalid Project ID or API Key');
    }
}
