import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    OneUptimeRequest,
} from '../Utils/Express';
import UserMiddleware from '../Middleware/UserAuthorization';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Response from '../Utils/Response';
import NotificationService from '../Services/NotificationService';
import ObjectID from 'Common/Types/ObjectID';
import JSONFunctions from 'Common/Types/JSONFunctions';
import Permission, { UserPermission } from 'Common/Types/Permission';
import Exception from 'Common/Types/Exception/Exception';

const router: ExpressRouter = Express.getRouter();

router.post(
    '/notification/recharge',
    UserMiddleware.getUserMiddleware,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const amount: number = req.body.amount;
            const projectId: ObjectID = JSONFunctions.deserializeValue(
                req.body.projectId
            ) as ObjectID;

            if (!amount || typeof amount !== 'number') {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadDataException('Invalid amount')
                );
            }

            if (amount > 1000) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadDataException('Amount cannot be greater than 1000')
                );
            }

            if (amount < 20) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadDataException('Amount cannot be less than 20')
                );
            }

            if (!projectId || !projectId.toString()) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadDataException('Invalid projectId')
                );
            }

            // get permissions. if user has permission to recharge, then recharge

            if (
                !(req as OneUptimeRequest).userTenantAccessPermission ||
                !(req as OneUptimeRequest).userTenantAccessPermission![
                    projectId.toString()
                ]
            ) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadDataException('Permission for this user not found')
                );
            }

            const permissions: Array<Permission> = (
                req as OneUptimeRequest
            ).userTenantAccessPermission![
                projectId.toString()
            ]!.permissions.map((permission: UserPermission) => {
                return permission.permission;
            });

            if (
                permissions.includes(Permission.ProjectOwner) ||
                permissions.includes(Permission.CanManageProjectBilling)
            ) {
                await NotificationService.rechargeBalance(projectId, amount);
            } else {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadDataException(
                        'User does not have permission to recharge. You need any one of these permissions - ProjectOwner, CanManageProjectBilling'
                    )
                );
            }
        } catch (err: any) {
            return Response.sendErrorResponse(req, res, err as Exception);
        }
    }
);

export default router;
