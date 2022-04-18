import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/utils/Express';
import IncidentService from '../services/incidentService';
import UserService from '../services/userService';
import {
    sendIncidentCreatedCall,
    sendVerificationSMS,
    test,
} from '../services/twilioService';

import { isAuthorized } from '../middlewares/authorization';
const getUser: $TSFixMe = require('../middlewares/user').getUser;
const isUserMasterAdmin: $TSFixMe =
    require('../middlewares/user').isUserMasterAdmin;
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

const router: ExpressRouter = Express.getRouter();
import SmsCountService from '../services/smsCountService';

/**
 * @param { accessToken, projectId, incidentId }: Come in the query string, passed in twilio service.
 * @description Route Description: XMl for Twilio voice Api.
 * @description Twilio gets user message from this API, we send with input Gather set to take a single key press.
 * @returns Twiml with 'Content-Type', 'text/xml' in headers for twilio to understand.
 */

router.get(
    '/voice/status',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const {
                accessToken,
                monitorName,
                projectId,
                incidentId,
                CallStatus,
                To,
                redialCount,
            } = req.query;
            const incident: $TSFixMe = await IncidentService.findOneBy({
                query: { _id: incidentId },
                select: 'acknowledged',
            });

            const newRedialCount: $TSFixMe = parseInt(redialCount) + 1;

            switch (CallStatus) {
                case 'failed':
                case 'busy':
                case 'no-answer':
                    // Redial call in 45 seconds. upon 5 times.
                    if (newRedialCount > 5) {
                        return sendItemResponse(req, res, {
                            status: 'call redial reached maximum',
                        });
                    }
                    setTimeout(() => {
                        return sendIncidentCreatedCall(
                            null,
                            monitorName,
                            To,
                            accessToken,
                            incidentId,
                            projectId,
                            newRedialCount
                        );
                    }, 1000 * 60);
                    return sendItemResponse(req, res, {
                        status: 'call redial success',
                    });
                default:
                    // Call is okay. check if incident was not ack, if not redial upto 5 times else  Exit with no redial
                    if (
                        incident &&
                        !incident.acknowledged &&
                        newRedialCount < 6
                    ) {
                        setTimeout(() => {
                            return sendIncidentCreatedCall(
                                null,
                                monitorName,
                                To,
                                accessToken,
                                incidentId,
                                projectId,
                                newRedialCount
                            );
                        }, 1000 * 60);
                        return sendItemResponse(req, res, {
                            status: 'call redial success',
                        });
                    }
                    return sendItemResponse(req, res, {
                        staus: 'initial call was okay',
                    });
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

/**
 * @param {string} accessToken : Access token for accessing this endpoint.
 * @param {string} projectId : Id of the project whose monitor had incident created
 * @param {string} incidentId : Id of the incident to change.
 * @description Resolves or Acks an incident based on what key is hit by user.
 * @returns Twiml with with action status.
 */

router.post(
    '/sms/sendVerificationToken',
    getUser,
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const { to }: $TSFixMe = req.body;

            const userId: $TSFixMe = req.user ? req.user.id : null;
            const projectId: $TSFixMe = req.query.projectId;
            const validationResult: $TSFixMe =
                await SmsCountService.validateResend(userId);
            const sendVerifyToken: $TSFixMe = await sendVerificationSMS(
                to,
                userId,
                projectId,
                validationResult
            );
            return sendItemResponse(req, res, sendVerifyToken);
        } catch (error) {
            return sendErrorResponse(
                req,
                res,
                error.message
                    ? { statusCode: 400, message: error.message }
                    : { status: 'action failed' }
            );
        }
    }
);

router.post(
    '/sms/verify',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { to, code }: $TSFixMe = req.body;

            const userId: $TSFixMe = req.user ? req.user.id : null;
            if (!to) {
                sendErrorResponse(req, res, {
                    statusCode: 400,
                    message: 'to field must be present.',
                });
            }
            if (!code) {
                sendErrorResponse(req, res, {
                    statusCode: 400,
                    message: 'code field must be present.',
                });
            }
            const tempAlertPhoneNumber: $TSFixMe = to.startsWith('+')
                ? to
                : `+${to}`;
            const user: $TSFixMe = await UserService.findOneBy({
                query: {
                    _id: userId,
                    tempAlertPhoneNumber,
                    alertPhoneVerificationCode: code,
                    alertPhoneVerificationCodeRequestTime: {
                        $gte: new Date(new Date().getTime() - 5 * 60 * 1000),
                    },
                },
                select: '_id',
            });
            if (!user) {
                throw new Error('Invalid code !');
            }
            await UserService.updateBy(
                { _id: userId },
                {
                    alertPhoneNumber: tempAlertPhoneNumber,
                    tempAlertPhoneNumber: null,
                    alertPhoneVerificationCode: null,
                    alertPhoneVerificationCodeRequestTime: null,
                }
            );
            return sendItemResponse(req, res, { valid: true });
        } catch (error) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: error.message,
            });
        }
    }
);

router.post(
    '/sms/test',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data: $TSFixMe = req.body;

            if (!data.accountSid) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Account Sid is required.',
                });
            }

            if (!data.authToken) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Auth Token is required.',
                });
            }

            if (!data.phoneNumber) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Phone Number is required.',
                });
            }

            let testResult: $TSFixMe = await test(data);
            testResult = { message: 'SMS sent successfully' };
            return sendItemResponse(req, res, testResult);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
