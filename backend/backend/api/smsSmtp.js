var express = require('express');
var SmsSmtpService = require('../services/smsSmtpService');
var TwilioService = require('../services/twilioService');
var router = express.Router();
const {
    isAuthorized
} = require('../middlewares/authorization');
var getUser = require('../middlewares/user').getUser;
var isUserOwner = require('../middlewares/project').isUserOwner;
var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var sendItemResponse = require('../middlewares/response').sendItemResponse;

router.post('/:projectId', getUser, isAuthorized, async function (req, res) {
    try {
        var data = req.body;
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
            var smsSmtp = await SmsSmtpService.create(data);
            return sendItemResponse(req, res, smsSmtp);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId', getUser, isAuthorized, async function (req, res) {
    try {
        var projectId = req.params.projectId;
        var smsSmtp = await SmsSmtpService.findOneBy({ projectId });
        return sendItemResponse(req, res, smsSmtp);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/:smsSmtpId', getUser, isAuthorized, async function (req, res) {
    try {
        var data = req.body;
        var smsSmtpId = req.params.smsSmtpId;
        let testResult = await TwilioService.test(data);
        if (testResult && !testResult.errorCode) {
            var smsSmtp = await SmsSmtpService.updateOneBy({_id : smsSmtpId},data);
            return sendItemResponse(req, res, smsSmtp);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }

});

router.delete('/:projectId/:smsSmtpId', getUser, isUserOwner, async function (req, res) {
    try {
        var data = req.body;
        var smsSmtpId = req.params.smsSmtpId;
        var smsSmtp = await SmsSmtpService.updateOneBy({_id : smsSmtpId},data);
        return sendItemResponse(req, res, smsSmtp);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;