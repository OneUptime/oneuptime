/**
 *
 * Copyright HackerBay, Inc.
 *
 */

var express = require('express');
var EmailSmtpService = require('../services/emailSmtpService');
var MailService = require('../services/mailService');
var router = express.Router();
const {
    isAuthorized
} = require('../middlewares/authorization');
var getUser = require('../middlewares/user').getUser;
var isUserOwner = require('../middlewares/project').isUserOwner;
var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var sendItemResponse = require('../middlewares/response').sendItemResponse;

router.post('/:projectId', getUser, isAuthorized, async function (req, res) {
    var data = req.body;
    data.projectId = req.params.projectId;
    data.email = req.user.email;
    if (!data.user) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'User Name is required.'
        });
    }

    if (!data.pass) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Password is required.'
        });
    }

    if (!data.host) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'host is required.'
        });
    }

    if (!data.port) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'port is required.'
        });
    }

    if (!data.from) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'from is required.'
        });
    }
    try {
        let testResult = await MailService.testSmtpConfig(data);
        if (!testResult.failed) {

            var emailSmtp = await EmailSmtpService.create(data);
            return sendItemResponse(req, res, emailSmtp);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId', getUser, isAuthorized, async function (req, res) {
    var projectId = req.params.projectId;
    try {
        var emailSmtp = await EmailSmtpService.findOneBy({ projectId });
        return sendItemResponse(req, res, emailSmtp);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/:emailSmtpId', getUser, isAuthorized, async function (req, res) {
    var data = req.body;
    var emailSmtpId = req.params.emailSmtpId;
    data.email = req.user.email;
    try {
        let testResult = await MailService.testSmtpConfig(data);
        if (!testResult.failed) {
        // Call the EmailTemplateService
            var emailSmtp = await EmailSmtpService.updateBy({_id : emailSmtpId},data);
            return sendItemResponse(req, res, emailSmtp);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }

});

router.delete('/:projectId/:emailSmtpId', getUser, isUserOwner, async function (req, res) {
    var data = req.body;
    var emailSmtpId = req.params.emailSmtpId;
    try {
        var emailSmtp = await EmailSmtpService.updateBy({_id : emailSmtpId},data);
        return sendItemResponse(req, res, emailSmtp);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;