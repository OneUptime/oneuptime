import {
    ExpressResponse,
    ExpressRequest,
    NextFunction,
    OneUptimeRequest,
} from '../Utils/Express';
import UserService from '../Services/UserService';
import ProjectMiddleware from './ProjectAuthorization';
import JSONWebToken from '../Utils/JsonWebToken';
import ObjectID from 'Common/Types/ObjectID';
import OneUptimeDate from 'Common/Types/Date';
import UserType from 'Common/Types/UserType';
import {
    UserGlobalAccessPermission,
    UserProjectAccessPermission,
} from 'Common/Types/Permission';
import AccessTokenService from '../Services/AccessTokenService';
import { JSONFunctions, JSONObject } from 'Common/Types/JSON';
import HashedString from 'Common/Types/HashedString';

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
        const tenantId: ObjectID | null = ProjectMiddleware.getProjectId(req);
        const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

        if (tenantId) {
            oneuptimeRequest.tenantId = tenantId;

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
            oneuptimeRequest.userType = UserType.Public;
            return next();
        }

        oneuptimeRequest.userAuthorization = JSONWebToken.decode(accessToken);

        if (oneuptimeRequest.userAuthorization.isMasterAdmin) {
            oneuptimeRequest.userType = UserType.MasterAdmin;
        } else {
            oneuptimeRequest.userType = UserType.User;
        }

        await UserService.updateOneBy({
            query: {
                _id: oneuptimeRequest.userAuthorization.userId.toString(),
            },
            props: { isRoot: true },
            data: { lastActive: OneUptimeDate.getCurrentDate() },
        });

        let userGlobalAccessPermission: UserGlobalAccessPermission | null =
            await AccessTokenService.getUserGlobalAccessPermission(
                oneuptimeRequest.userAuthorization.userId
            );

        if (!userGlobalAccessPermission) {
            userGlobalAccessPermission =
                await AccessTokenService.refreshUserGlobalAccessPermission(
                    oneuptimeRequest.userAuthorization.userId
                );
        }

        oneuptimeRequest.userGlobalAccessPermission =
            userGlobalAccessPermission;

        if (tenantId) {
            // get project level permissions if projectid exists in request.

            let userProjectAccessPermission: UserProjectAccessPermission | null =
                await AccessTokenService.getUserProjectAccessPermission(
                    oneuptimeRequest.userAuthorization.userId,
                    tenantId
                );
            if (!userProjectAccessPermission) {
                userProjectAccessPermission =
                    await AccessTokenService.refreshUserProjectAccessPermission(
                        oneuptimeRequest.userAuthorization.userId,
                        tenantId
                    );
            }

            if (userProjectAccessPermission) {
                oneuptimeRequest.userProjectAccessPermission =
                    userProjectAccessPermission;
            }
        }

        // set permission hash.

        if (oneuptimeRequest.userGlobalAccessPermission) {
            const serializedValue: JSONObject = JSONFunctions.serialize(
                oneuptimeRequest.userGlobalAccessPermission
            );
            const globalValue: string = JSON.stringify(serializedValue);
            const globalPermissionsHash: string = await HashedString.hashValue(
                globalValue,
                null
            );
            res.set('global-permissions', globalValue);
            res.set('global-permissions-hash', globalPermissionsHash);

            if (
                !(
                    req.headers &&
                    req.headers['global-permissions-hash'] &&
                    req.headers['global-permissions-hash'] ===
                        globalPermissionsHash
                )
            ) {
                res.set('project-permissions', globalValue);
                res.set('project-permissions-hash', globalPermissionsHash);
            }
        }

        // set project permissions hash.
        if (oneuptimeRequest.userProjectAccessPermission) {
            const projectValue: string = JSON.stringify(
                JSONFunctions.serialize(
                    oneuptimeRequest.userProjectAccessPermission
                )
            );
            const projectPermissionsHash: string = await HashedString.hashValue(
                projectValue,
                null
            );

            if (
                !(
                    req.headers &&
                    req.headers['project-permissions-hash'] &&
                    req.headers['project-permissions-hash'] ===
                        projectPermissionsHash
                )
            ) {
                res.set('project-permissions', projectValue);
                res.set('project-permissions-hash', projectPermissionsHash);
            }
        }

        return next();
    }
}
