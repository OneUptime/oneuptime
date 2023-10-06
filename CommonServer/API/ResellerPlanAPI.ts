import ResellerPlan from 'Model/Models/ResellerPlan';
import ResellerPlanService, {
    Service as ResellerPlanServiceType,
} from '../Services/ResellerPlanService';
import BaseAPI from './BaseAPI';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from '../Utils/Express';
import BearerTokenAuthorization from '../Middleware/BearerTokenAuthorization';
import Email from 'Common/Types/Email';
import BadDataException from 'Common/Types/Exception/BadDataException';
import BillingService from '../Services/BillingService';
import Response from '../Utils/Response';
import URL from 'Common/Types/API/URL';
import PromoCode from 'Model/Models/PromoCode';
import PromoCodeService from '../Services/PromoCodeService';
import StatusCode from 'Common/Types/API/StatusCode';
import Project from 'Model/Models/Project';
import ProjectService from '../Services/ProjectService';
import DatabaseConfig from '../DatabaseConfig';
import { PlanSelect } from 'Common/Types/Billing/SubscriptionPlan';
import ObjectID from 'Common/Types/ObjectID';

export default class ResellerPlanAPI extends BaseAPI<
    ResellerPlan,
    ResellerPlanServiceType
> {
    public constructor() {
        super(ResellerPlan, ResellerPlanService);

        // Reseller Plan Action API
        // TODO: Reafactor this APi and make it partner specific.
        this.router.post(
            `${new this.entityType()
                .getCrudApiPath()
                ?.toString()}/action/:resellerId`,
            BearerTokenAuthorization.isAuthorizedBearerToken,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    const resellerId: string | undefined =
                        req.params['resellerId'];

                    if (!resellerId) {
                        throw new Error('Invalid reseller id.');
                    }

                    if (
                        resellerId.trim().toLowerCase() !==
                        (req as any).bearerTokenData?.resellerId
                            ?.trim()
                            .toLowerCase()
                    ) {
                        throw new Error(
                            'Invalid reseller id found in access token'
                        );
                    }

                    const action: string = req.body.action;

                    if (!action) {
                        throw new BadDataException('Invalid action.');
                    }

                    const resellerPlanId: string | undefined = req.body.plan_id;

                    if (!resellerPlanId) {
                        throw new BadDataException('Invalid reseller plan id.');
                    }

                    // check reseller Plan.

                    const resellerPlan: ResellerPlan | null =
                        await ResellerPlanService.findOneBy({
                            query: {
                                planId: resellerPlanId,
                            },
                            select: {
                                _id: true,
                                planId: true,
                                reseller: {
                                    resellerId: true,
                                },
                                teamMemberLimit: true,
                                monitorLimit: true,
                                planType: true,
                            },
                            props: {
                                isRoot: true,
                            },
                        });

                    if (!resellerPlan) {
                        throw new BadDataException('Invalid reseller plan id.');
                    }

                    if (resellerPlan.reseller?.resellerId !== resellerId) {
                        throw new BadDataException(
                            'This plan does not belong to reseller: ' +
                                resellerId
                        );
                    }

                    const licenseKey: string | undefined = req.body.uuid;

                    if (!licenseKey) {
                        throw new BadDataException('Invalid license key.');
                    }

                    const userEmail: Email = new Email(
                        req.body.activation_email
                    );

                    if (action === 'activate') {
                        // generate a coupon code. Billing is handled by the reseller so OneUptime will have 100% discount on its plans.

                        const couponcode: string =
                            await BillingService.generateCouponCode({
                                name: resellerId,
                                percentOff: 100,
                                maxRedemptions: 2,
                                durationInMonths: 12 * 20, // 20 years.
                                metadata: {
                                    licenseKey: licenseKey || '',
                                    resellerPlanId:
                                        resellerPlan?.id?.toString() || '',
                                },
                            });

                        // save this in promocode table.

                        const promoCode: PromoCode = new PromoCode();

                        promoCode.promoCodeId = couponcode;
                        promoCode.resellerId = resellerPlan?.reseller
                            .id as ObjectID;
                        promoCode.resellerPlanId = resellerPlan?.id as ObjectID;
                        promoCode.userEmail = userEmail;
                        promoCode.planType =
                            resellerPlan?.planType as PlanSelect;
                        promoCode.resellerLicenseId = licenseKey || '';

                        await PromoCodeService.create({
                            data: promoCode,
                            props: {
                                isRoot: true,
                            },
                        });

                        // now redirect to accounts sign up page with this promocode.

                        const accountUrl: URL =
                            await DatabaseConfig.getAccountsUrl();

                        return Response.sendJsonObjectResponse(
                            req,
                            res,
                            {
                                message: 'product activated',
                                redirect_url: URL.fromString(
                                    accountUrl.toString()
                                )
                                    .addRoute('/register')
                                    .addQueryParams({
                                        email: userEmail.toString(),
                                        promoCode: couponcode,
                                        partnerId: resellerId,
                                    })
                                    .toString(),
                            },
                            {
                                statusCode: new StatusCode(201),
                            }
                        );
                    } else if (
                        action === 'enhance_tier' ||
                        action === 'reduce_tier'
                    ) {
                        // update monitor and team seat limits.

                        const project: Project | null =
                            await ProjectService.findOneBy({
                                query: {
                                    resellerLicenseId: licenseKey,
                                },
                                select: {
                                    _id: true,
                                },
                                props: {
                                    isRoot: true,
                                },
                            });

                        if (!project) {
                            throw new BadDataException(
                                'Project not found with this license key'
                            );
                        }

                        // update limits.

                        await ProjectService.updateOneById({
                            id: project.id!,
                            data: {
                                activeMonitorsLimit: resellerPlan.monitorLimit!,
                                seatLimit: resellerPlan.teamMemberLimit!,
                                resellerPlanId: resellerPlan.id!,
                            },
                            props: {
                                isRoot: true,
                            },
                        });

                        return Response.sendJsonObjectResponse(req, res, {
                            message:
                                action === 'enhance_tier'
                                    ? 'product enhanced'
                                    : 'product reduced',
                        });
                    } else if (action === 'refund') {
                        // delete this project.

                        const project: Project | null =
                            await ProjectService.findOneBy({
                                query: {
                                    resellerLicenseId: licenseKey,
                                },
                                select: {
                                    _id: true,
                                },
                                props: {
                                    isRoot: true,
                                },
                            });

                        if (!project) {
                            // maybe already deleted. so, we just issue a refund and return.
                            return Response.sendJsonObjectResponse(req, res, {
                                message: 'product refunded',
                            });
                        }

                        await ProjectService.deleteOneBy({
                            query: {
                                resellerLicenseId: licenseKey,
                                _id: project.id?.toString() as string,
                            },
                            props: {
                                isRoot: true,
                            },
                        });

                        return Response.sendJsonObjectResponse(req, res, {
                            message: 'product refunded',
                        });
                    }

                    throw new BadDataException('Invalid action.');
                } catch (err) {
                    next(err);
                }
            }
        );
    }
}
