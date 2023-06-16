import UserSMS from 'Model/Models/UserSMS';
import UserSMSService, {
    Service as UserSMSServiceType,
} from '../Services/UserSmsService';
import BaseAPI from './BaseAPI';
import UserMiddleware from '../Middleware/UserAuthorization';
import {
    ExpressRequest,
    ExpressResponse,
    OneUptimeRequest,
} from '../Utils/Express';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Response from '../Utils/Response';

export default class UserSMSAPI extends BaseAPI<UserSMS, UserSMSServiceType> {
    public constructor() {
        super(UserSMS, UserSMSService);

        this.router.post(
            `/user-sms/verify`,
            UserMiddleware.getUserMiddleware,
            async (req: ExpressRequest, res: ExpressResponse) => {
                req = req as OneUptimeRequest;

                if (!req.body.itemId) {
                    return Response.sendErrorResponse(
                        req,
                        res,
                        new BadDataException('Invalid item ID')
                    );
                }

                if (!req.body.code) {
                    return Response.sendErrorResponse(
                        req,
                        res,
                        new BadDataException('Invalid code')
                    );
                }

                // Check if the code matches and verify the phone number.
                const item: UserSMS | null = await this.service.findOneById({
                    id: req.body['itemId'],
                    props: {
                        isRoot: true,
                    },
                    select: {
                        userId: true,
                        verificationCode: true,
                    },
                });

                if (!item) {
                    return Response.sendErrorResponse(
                        req,
                        res,
                        new BadDataException('Item not found')
                    );
                }

                //cehck user id

                if (
                    item.userId?.toString() !==
                    (
                        req as OneUptimeRequest
                    )?.userAuthorization?.userId?.toString()
                ) {
                    return Response.sendErrorResponse(
                        req,
                        res,
                        new BadDataException('Invalid user ID')
                    );
                }

                if (item.verificationCode !== req.body['code']) {
                    return Response.sendErrorResponse(
                        req,
                        res,
                        new BadDataException('Invalid code')
                    );
                }

                await this.service.updateOneById({
                    id: item.id!,
                    props: {
                        isRoot: true,
                    },
                    data: {
                        isVerified: true,
                    },
                });

                return Response.sendEmptyResponse(req, res);
            }
        );

        this.router.post(
            `/user-sms/resend-verification-code`,
            UserMiddleware.getUserMiddleware,
            async (req: ExpressRequest, res: ExpressResponse) => {
                req = req as OneUptimeRequest;

                if (!req.body.itemId) {
                    return Response.sendErrorResponse(
                        req,
                        res,
                        new BadDataException('Invalid item ID')
                    );
                }

                await this.service.resendVerificationCode(req.body.itemId);

                return Response.sendEmptyResponse(req, res);
            }
        );
    }
}
