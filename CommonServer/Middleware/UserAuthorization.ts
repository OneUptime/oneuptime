import {
    ExpressResponse,
    ExpressRequest,
    NextFunction,
    OneUptimeRequest,
    AuthorizationType,
} from '../Utils/Express';
import Service from '../Services/Index';
import UserServiceType from '../Services/UserService';
import ProjectMiddleware from './ProjectAuthorization';
import { ObjectID } from 'typeorm';
import BadDataException from 'Common/Types/Exception/BadDataException';
import JSONWebToken from '../Utils/JsonWebToken';

const UserService: UserServiceType = Service.UserService;

export default class UserMiddleware {

    /*
     * Description: Checking if user is authorized to access the page and decode jwt to get user data.
     * Params:
     * Param 1: req.headers-> {token}
     * Returns: 401: User is unauthorized since unauthorized token was present.
     */

    public static getAccessToken(req: ExpressRequest): string | null {

        let accessToken: string | null = null;

        if (req.headers['authorization']) {
            accessToken = req.headers['authorization'] as string;
        }

        if (req.query['accessToken']) {
            accessToken = req.query['accessToken'] as string;
        }

        if (accessToken?.includes(" ")) {
            accessToken = accessToken.split(' ')[1] || '';
        }

        return accessToken;
    }

    public static async getUserMiddleware(
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> {
        const projectId: ObjectID | null = ProjectMiddleware.getProjectId(req);

        if (projectId) {
            if (ProjectMiddleware.hasApiKey(req)) {
                return await ProjectMiddleware.isValidProjectIdAndApiKeyMiddleware(req, res, next);
            }
        }

        const accessToken: string | null = this.getAccessToken(req);

        if (!accessToken) {
            throw new BadDataException("AccessToken not found in request");
        }

        const oneuptimeRequest = (req as OneUptimeRequest);
        oneuptimeRequest.userAuthorization = JSONWebToken.decode(accessToken);


        if (oneuptimeRequest.userAuthorization.isMasterAdmin) {
            oneuptimeRequest.authorizationType = AuthorizationType.MasterAdmin;
        } else {
            oneuptimeRequest.authorizationType = AuthorizationType.User;
        }

        UserService.updateOneBy({
            query: { _id: oneuptimeRequest.userAuthorization.userId.toString() },
            data: { lastActive: Date.now() }
        });

        return next();

    }
}
