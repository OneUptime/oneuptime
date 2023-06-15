import UserEmail from 'Model/Models/UserEmail';
import UserEmailService, {
    Service as UserEmailServiceType,
} from '../Services/UserEmailService';
import BaseAPI from './BaseAPI';
import {
    ExpressRequest,
    ExpressResponse,
    OneUptimeRequest,
} from '../Utils/Express';
import UserMiddleware from '../Middleware/UserAuthorization';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Response from '../Utils/Response';

export default class UserEmailAPI extends BaseAPI<
    UserEmail,
    UserEmailServiceType
> {
    public constructor() {
        super(UserEmail, UserEmailService);

        this.router.post(
            `${new this.entityType().getCrudApiPath()?.toString()}/verify`,
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

                // Check if the code matches and verify the email.
                const item = await this.service.findOneById({
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
            `${new this.entityType()
                .getCrudApiPath()
                ?.toString()}/resend-verification-code`,
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

                this.service.resendVerificationCode(req.body.itemId);

                return Response.sendEmptyResponse(req, res);
            }
        );
    }
}
