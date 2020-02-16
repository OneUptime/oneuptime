let express = require('express');
let SmsSmtpService = require('../services/smsSmtpService');
let TwilioService = require('../services/twilioService');
let router = express.Router();
const {
    isAuthorized
} = require('../middlewares/authorization');
let getUser = require('../middlewares/user').getUser;
let isUserOwner = require('../middlewares/project').isUserOwner;
let sendErrorResponse = require('../middlewares/response').sendErrorResponse;
let sendItemResponse = require('../middlewares/response').sendItemResponse;

router.post('/:projectId', getUser, isAuthorized, async function (req, res) {
    try {
        let data = req.body;
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
        let testResult = await TwilioService.test(data);
        if (testResult && !testResult.errorCode) {
            let smsSmtp = await SmsSmtpService.create(data);
            return sendItemResponse(req, res, smsSmtp);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId', getUser, isAuthorized, async function (req, res) {
    try {
        let projectId = req.params.projectId;
        let smsSmtp = await SmsSmtpService.findOneBy({ projectId });
        return sendItemResponse(req, res, smsSmtp);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/:smsSmtpId', getUser, isAuthorized, async function (req, res) {
    try {
        let data = req.body;
        let smsSmtpId = req.params.smsSmtpId;
        let testResult = await TwilioService.test(data);
        if (testResult && !testResult.errorCode) {
            let smsSmtp = await SmsSmtpService.updateOneBy({_id : smsSmtpId},data);
            return sendItemResponse(req, res, smsSmtp);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }

});

router.delete('/:projectId/:smsSmtpId', getUser, isUserOwner, async function (req, res) {
    try {
        let data = req.body;
        let smsSmtpId = req.params.smsSmtpId;
        let smsSmtp = await SmsSmtpService.updateOneBy({_id : smsSmtpId},data);
        return sendItemResponse(req, res, smsSmtp);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;