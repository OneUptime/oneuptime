const express = require('express');
const SmsSmtpService = require('../services/smsSmtpService');
const TwilioService = require('../services/twilioService');
const router = express.Router();
const {
    isAuthorized
} = require('../middlewares/authorization');
const getUser = require('../middlewares/user').getUser;
const isUserOwner = require('../middlewares/project').isUserOwner;
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

router.post('/:projectId', getUser, isAuthorized, async function (req, res) {
    try {
        const data = req.body;
        data.projectId = req.params.projectId;
        if (!data.accountSid) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Account Sid is required.'
            });
        }

        if (!data.authToken) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Auth Token is required.'
            });
        }

        if (!data.phoneNumber) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Phone Number is required.'
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

router.get('/:projectId', getUser, isAuthorized, async function (req, res) {
    try {
        const projectId = req.params.projectId;
        const smsSmtp = await SmsSmtpService.findOneBy({ projectId });
        return sendItemResponse(req, res, smsSmtp);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/:smsSmtpId', getUser, isAuthorized, async function (req, res) {
    try {
        const data = req.body;
        const smsSmtpId = req.params.smsSmtpId;
        const testResult = await TwilioService.test(data);
        if (testResult && !testResult.errorCode) {
            const smsSmtp = await SmsSmtpService.updateOneBy({_id : smsSmtpId},data);
            return sendItemResponse(req, res, smsSmtp);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }

});

router.delete('/:projectId/:smsSmtpId', getUser, isUserOwner, async function (req, res) {
    try {
        const data = req.body;
        const smsSmtpId = req.params.smsSmtpId;
        const smsSmtp = await SmsSmtpService.updateOneBy({_id : smsSmtpId},data);
        return sendItemResponse(req, res, smsSmtp);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;