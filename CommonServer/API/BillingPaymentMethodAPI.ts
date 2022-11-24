import BadDataException from 'Common/Types/Exception/BadDataException';
import Permission from 'Common/Types/Permission';
import BillingPaymentMethod from 'Model/Models/BillingPaymentMethod';
import Project from 'Model/Models/Project';
import { IsBillingEnabled } from '../Config';
import UserMiddleware from '../Middleware/UserAuthorization';
import BillingPaymentMethodService, {
    Service as BillingPaymentMethodServiceType,
} from '../Services/BillingPaymentMethodService';
import BillingService from '../Services/BillingService';
import ProjectService from '../Services/ProjectService';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from '../Utils/Express';
import Response from '../Utils/Response';
import BaseAPI from './BaseAPI';

export default class UserAPI extends BaseAPI<
    BillingPaymentMethod,
    BillingPaymentMethodServiceType
> {
    public constructor() {
        super(BillingPaymentMethod, BillingPaymentMethodService);

        this.router.post(
            `/${new this.entityType().getCrudApiPath()?.toString()}/setup`,
            UserMiddleware.getUserMiddleware,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    if (!IsBillingEnabled) {
                        throw new BadDataException(
                            'Billign is not enabled for this server'
                        );
                    }

                    if (req.body['projectId']) {
                        throw new BadDataException(
                            'projectId is required in request body'
                        );
                    }

                    const userPermissions = (
                        await this.getPermissionsForTenant(req)
                    ).filter((permission) => {
                        console.log(permission.permission);
                        //FIX: Change "Project"
                        return (
                            permission.permission.toString() ===
                                Permission.ProjectOwner.toString() ||
                            permission.permission.toString() ===
                                Permission.CanCreateBillingPaymentMethod.toString()
                        );
                    });

                    if (userPermissions.length === 0) {
                        throw new BadDataException(
                            'Only Project owner can add payment methods.'
                        );
                    }

                    const project: Project | null =
                        await ProjectService.findOneById({
                            id: this.getTenantId(req)!,
                            props: {
                                isRoot: true,
                            },
                            select: {
                                _id: true,
                                paymentProviderCustomerId: true,
                            },
                        });

                    if (!project) {
                        throw new BadDataException('Project not found');
                    }

                    if (!project) {
                        throw new BadDataException('Project not found');
                    }

                    if (!project.paymentProviderCustomerId) {
                        throw new BadDataException(
                            'Payment Provider customer not found'
                        );
                    }

                    const setupIntent: string =
                        await BillingService.getSetupIntentSecret(
                            project.paymentProviderCustomerId
                        );

                    return Response.sendJsonObjectResponse(req, res, {
                        setupIntent: setupIntent,
                    });
                } catch (err) {
                    next(err);
                }
            }
        );
    }
}
