import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import SmsSmtpService from '../services/smsSmtpService';
import TwilioService from '../services/twilioService';
const router: $TSFixMe = express.getRouter();

import { isAuthorized } from '../middlewares/authorization';
const getUser: $TSFixMe = require('../middlewares/user').getUser;
const isUserOwner: $TSFixMe = require('../middlewares/project').isUserOwner;
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

router.post(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data: $TSFixMe = req.body;
            data.projectId = req.params.projectId;
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
            const testResult: $TSFixMe = await TwilioService.test(data);
            if (testResult && !testResult.errorCode) {
                const smsSmtp: $TSFixMe = await SmsSmtpService.create(data);
                return sendItemResponse(req, res, smsSmtp);
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId: $TSFixMe = req.params.projectId;
            const populate: $TSFixMe = [{ path: 'projectId', select: 'name' }];
            const select: $TSFixMe =
                'projectId accountSid authToken phoneNumber iv enabled createdAt deletedById';
            const smsSmtp: $TSFixMe = await SmsSmtpService.findOneBy({
                query: { projectId },
                select,
                populate,
            });
            return sendItemResponse(req, res, smsSmtp || {});
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/:smsSmtpId',
    getUser,
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const data: $TSFixMe = req.body;
            const smsSmtpId: $TSFixMe = req.params.smsSmtpId;
            const testResult: $TSFixMe = await TwilioService.test(data);
            if (testResult && !testResult.errorCode) {
                const smsSmtp: $TSFixMe = await SmsSmtpService.updateOneBy(
                    { _id: smsSmtpId },
                    data
                );
                return sendItemResponse(req, res, smsSmtp);
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:projectId/:smsSmtpId',
    getUser,
    isUserOwner,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const smsSmtpId: $TSFixMe = req.params.smsSmtpId;
            const payload: $TSFixMe = {
                enabled: false,
                accountSid: '',
                authToken: '',
                phoneNumber: '',
            };
            const smsSmtp: $TSFixMe = await SmsSmtpService.updateOneBy(
                { _id: smsSmtpId },
                payload
            );
            return sendItemResponse(req, res, smsSmtp);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
