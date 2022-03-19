import express, {
    Request,
    Response,
    NextFunction,
} from 'common-server/utils/express';
import SmsSmtpService from '../services/smsSmtpService';
import TwilioService from '../services/twilioService';
const router = express.getRouter();

import { isAuthorized } from '../middlewares/authorization';
const getUser = require('../middlewares/user').getUser;
const isUserOwner = require('../middlewares/project').isUserOwner;
import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';

router.post('/:projectId', getUser, isAuthorized, async function(
    req: Request,
    res: Response
) {
    try {
        const data = req.body;
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
        const testResult = await TwilioService.test(data);
        if (testResult && !testResult.errorCode) {
            const smsSmtp = await SmsSmtpService.create(data);
            return sendItemResponse(req, res, smsSmtp);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId', getUser, isAuthorized, async function(
    req: Request,
    res: Response
) {
    try {
        const projectId = req.params.projectId;
        const populate = [{ path: 'projectId', select: 'name' }];
        const select =
            'projectId accountSid authToken phoneNumber iv enabled createdAt deletedById';
        const smsSmtp = await SmsSmtpService.findOneBy({
            query: { projectId },
            select,
            populate,
        });
        return sendItemResponse(req, res, smsSmtp || {});
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/:smsSmtpId', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        const data = req.body;
        const smsSmtpId = req.params.smsSmtpId;
        const testResult = await TwilioService.test(data);
        if (testResult && !testResult.errorCode) {
            const smsSmtp = await SmsSmtpService.updateOneBy(
                { _id: smsSmtpId },
                data
            );
            return sendItemResponse(req, res, smsSmtp);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete('/:projectId/:smsSmtpId', getUser, isUserOwner, async function(
    req,
    res
) {
    try {
        const smsSmtpId = req.params.smsSmtpId;
        const payload = {
            enabled: false,
            accountSid: '',
            authToken: '',
            phoneNumber: '',
        };
        const smsSmtp = await SmsSmtpService.updateOneBy(
            { _id: smsSmtpId },
            payload
        );
        return sendItemResponse(req, res, smsSmtp);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;
