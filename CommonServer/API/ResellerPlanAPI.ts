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
import { AccountsRoute, Domain, HttpProtocol } from '../Config';
import PromoCode from 'Model/Models/PromoCode';
import PromoCodeService from '../Services/PromoCodeService';
import StatusCode from 'Common/Types/API/StatusCode';

export default class ResellerPlanAPI extends BaseAPI<
    ResellerPlan,
    ResellerPlanServiceType
> {
    public constructor() {
        super(ResellerPlan, ResellerPlanService);

        // Reseller Plan Action API
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
                    const resellerId = req.params['resellerId'];

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

                    const action = req.body.action;

                    const resellerPlanId = req.body.plan_id;

                    if (!resellerPlanId) {
                        throw new BadDataException('Invalid reseller plan id.');
                    }

                    // check reseller Plan.

                    const resellerPlan = await ResellerPlanService.findOneBy({
                        query: {
                            planId: resellerPlanId,
                        },
                        select: {
                            _id: true,
                            planId: true,
                            reseller: {
                                resellerId: true,
                            },
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

                    const licenseKey = req.body.uuid;

                    const userEmail = new Email(req.body.activation_email);

                    if (action === 'activate') {
                        // generate a coupon code. Billing is handled by the reseller so OneUptime will have 100% discount on its plans.

                        const couponcode: string =
                            await BillingService.generateCouponCode({
                                name: resellerId + ' ' + licenseKey,
                                percentOff: 100,
                                maxRedemptions: 1,
                                durationInMonths: 12 * 20, // 20 years.
                                metadata: {
                                    licenseKey: licenseKey,
                                    resellerPlanId:
                                        resellerPlan?.id?.toString() || '',
                                },
                            });

                        // save this in promocode table.

                        const promoCode: PromoCode = new PromoCode();

                        promoCode.promoCodeId = couponcode;
                        promoCode.resellerId = resellerPlan?.reseller.id!;
                        promoCode.resellerPlanId = resellerPlan?.id!;
                        promoCode.userEmail = userEmail;
                        promoCode.planType = resellerPlan?.planType!;
                        promoCode.resellerLicenseId = licenseKey;

                        await PromoCodeService.create({
                            data: promoCode,
                            props: {
                                isRoot: true,
                            },
                        });

                        // now redirect to accounts sign up page with this promocode.

                        return Response.sendJsonObjectResponse(req, res, {
                            "message": "product activated",
                            "redirect_url": new URL(HttpProtocol, Domain, AccountsRoute)
                                .addRoute('/register')
                                .addQueryParams({
                                    email: userEmail.toString(),
                                    promoCode: couponcode,
                                }).toString()
                        }, {
                            statusCode: new StatusCode(201)
                        })

                    } else {

                    }



                    throw new BadDataException('Invalid action.');
                } catch (err) {
                    next(err);
                }
            }
        );
    }
}
