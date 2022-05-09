import ProjectServiceType from '../Services/ProjectService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';
import {
    AuthorizationType,
    ExpressRequest,
    ExpressResponse,
    NextFunction,
    OneUptimeRequest,
} from '../Utils/Express';
import Services from '../Services/Index';
import PositiveNumber from 'Common/Types/PositiveNumber';

const ProjectService: ProjectServiceType = Services.ProjectService;

export default class ProjectMiddleware {

    public static getProjectId(req: ExpressRequest): ObjectID | null {

        let projectId: ObjectID | null = null;
        if (req.params && req.params['projectId']) {
            projectId = new ObjectID(req.params['projectId']);
        } else if (req.query && req.query['projectId']) {
            projectId = new ObjectID(req.query['projectId'] as string);
        } else if (
            req.headers &&
            req.headers['projectid']
        ) {
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
        } else if (
            req.headers &&
            req.headers['apikey']
        ) {
            apiKey = new ObjectID(req.headers['apikey'] as string)
        } else if (req.body && req.body.apiKey) {
            apiKey = req.body.apiKey;
        }

        return apiKey;
    }

    public static hasApiKey(req: ExpressRequest): boolean {
        return !!this.getApiKey(req);
    }

    public static hasProjectID(req: ExpressRequest): boolean {
        return !!this.getProjectId(req);
    } 

    public static async isValidProjectIdAndApiKeyMiddleware(
        req: ExpressRequest,
        _res: ExpressResponse,
        next: NextFunction
    ): Promise<void> {

        let projectId: ObjectID | null = this.getProjectId(req);
        let apiKey: ObjectID | null = this.getApiKey(req);

        if (!projectId) {
            throw new BadDataException("ProjectID not found in the request");
        }

        if (!apiKey) {
            throw new BadDataException("ApiKey not found in the request");
        }

        const projectCount: PositiveNumber = await ProjectService.countBy({
            query: {
                _id: projectId.toString(),
                apiKey: apiKey,
            }
        });

        if (projectCount.toNumber() > 0) {
            (req as OneUptimeRequest).authorizationType = AuthorizationType.API;
            return next();
        }

        throw new BadDataException("Invalid Project ID or API Key");

    }

}