import {
    ExpressResponse,
    ExpressRequest,
    NextFunction,
    OneUptimeRequest,
    userType,
} from '../Utils/Express';
import UserService from '../Services/UserService';
import ProjectMiddleware from './ProjectAuthorization';
import JSONWebToken from '../Utils/JsonWebToken';
import ObjectID from 'Common/Types/ObjectID';
import UserRole from 'Common/Types/UserRole';
import OneUptimeDate from 'Common/Types/Date';
import Permission from 'Common/Types/Permission';

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

        if (accessToken?.includes(' ')) {
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
        const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

        if (projectId) {
            oneuptimeRequest.projectId = projectId;

            if (ProjectMiddleware.hasApiKey(req)) {
                return await ProjectMiddleware.isValidProjectIdAndApiKeyMiddleware(
                    req,
                    res,
                    next
                );
            }
        }

        const accessToken: string | null = UserMiddleware.getAccessToken(req);

        if (!accessToken) {
            oneuptimeRequest.userType = userType.Public;
            return next();
        }

        oneuptimeRequest.userAuthorization = JSONWebToken.decode(accessToken);

        if (oneuptimeRequest.userAuthorization.isMasterAdmin) {
            oneuptimeRequest.userType = userType.MasterAdmin;
        } else {
            oneuptimeRequest.userType = userType.User;
        }

        await UserService.updateOneBy({
            query: {
                _id: oneuptimeRequest.userAuthorization.userId.toString(),
            },
            data: { lastActive: OneUptimeDate.getCurrentDate() },
        });

        const userRole: UserRole | undefined | null =
            projectId &&
            oneuptimeRequest.userAuthorization.roles.find((role: UserRole) => {
                return role.projectId.toString() === role.projectId.toString();
            });

        if (userRole) {
            oneuptimeRequest.permissions = [userRole.permission];
        } else if (
            oneuptimeRequest.userType === userType.User
        ) {
            oneuptimeRequest.permissions = [Permission.User];
        }

        return next();
    }
}
