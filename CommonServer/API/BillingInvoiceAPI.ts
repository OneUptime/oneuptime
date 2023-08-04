import BadDataException from 'Common/Types/Exception/BadDataException';
import { JSONObject } from 'Common/Types/JSON';
import JSONFunctions from 'Common/Types/JSONFunctions';
import Permission, { UserPermission } from 'Common/Types/Permission';
import BillingInvoice from 'Model/Models/BillingInvoice';
import Project from 'Model/Models/Project';
import { IsBillingEnabled } from '../Config';
import UserMiddleware from '../Middleware/UserAuthorization';
import BillingInvoiceService, {
    Service as BillingInvoiceServiceType,
} from '../Services/BillingInvoiceService';
import BillingService, { Invoice } from '../Services/BillingService';
import ProjectService from '../Services/ProjectService';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from '../Utils/Express';
import Response from '../Utils/Response';
import BaseAPI from './BaseAPI';
import SubscriptionStatus from 'Common/Types/Billing/SubscriptionStatus';

export default class UserAPI extends BaseAPI<
    BillingInvoice,
    BillingInvoiceServiceType
> {
    public constructor() {
        super(BillingInvoice, BillingInvoiceService);

        this.router.post(
            `${new this.entityType().getCrudApiPath()?.toString()}/pay`,
            UserMiddleware.getUserMiddleware,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    if (!IsBillingEnabled) {
                        throw new BadDataException(
                            'Billing is not enabled for this server'
                        );
                    }

                    if (req.body['projectId']) {
                        throw new BadDataException(
                            'projectId is required in request body'
                        );
                    }

                    const userPermissions: Array<UserPermission> = (
                        await this.getPermissionsForTenant(req)
                    ).filter((permission: UserPermission) => {
                        return (
                            permission.permission.toString() ===
                                Permission.ProjectOwner.toString() ||
                            permission.permission.toString() ===
                                Permission.CanEditInvoices.toString()
                        );
                    });

                    if (userPermissions.length === 0) {
                        throw new BadDataException(
                            `You need ${Permission.ProjectOwner} or ${Permission.CanEditInvoices} permission to pay invoices.`
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
                                paymentProviderSubscriptionId: true,
                                paymentProviderMeteredSubscriptionId: true,
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

                    if (!project.paymentProviderSubscriptionId) {
                        throw new BadDataException(
                            'Payment Provider subscription not found'
                        );
                    }

                    const body: JSONObject = req.body;

                    const item: BillingInvoice =
                        JSONFunctions.fromJSON<BillingInvoice>(
                            body['data'] as JSONObject,
                            this.entityType
                        ) as BillingInvoice;

                    if (!item.paymentProviderInvoiceId) {
                        throw new BadDataException('Invoice ID not found');
                    }

                    if (!item.paymentProviderCustomerId) {
                        throw new BadDataException('Customer ID not found');
                    }

                    const invoice: Invoice = await BillingService.payInvoice(
                        item.paymentProviderCustomerId!,
                        item.paymentProviderInvoiceId!
                    );

                    // save updated status.

                    await this.service.updateOneBy({
                        query: {
                            paymentProviderInvoiceId: invoice.id!,
                        },
                        props: {
                            isRoot: true,
                            ignoreHooks: true,
                        },
                        data: {
                            status: invoice.status,
                        },
                    });

                    // refresh subscription status.
                    const subscriptionState: SubscriptionStatus =
                        await BillingService.getSubscriptionStatus(
                            project.paymentProviderSubscriptionId as string
                        );

                    const meteredSubscriptionState: SubscriptionStatus =
                        await BillingService.getSubscriptionStatus(
                            project.paymentProviderMeteredSubscriptionId as string
                        );

                    await ProjectService.updateOneById({
                        id: project.id!,
                        data: {
                            paymentProviderSubscriptionStatus:
                                subscriptionState,
                            paymentProviderMeteredSubscriptionStatus:
                                meteredSubscriptionState,
                        },
                        props: {
                            isRoot: true,
                            ignoreHooks: true,
                        },
                    });

                    return Response.sendEmptyResponse(req, res);
                } catch (err) {
                    next(err);
                }
            }
        );
    }
}
