/**
 *
 * Copyright HackerBay, Inc.
 *
 */

let express = require('express');
let EmailSmtpService = require('../services/emailSmtpService');
let MailService = require('../services/mailService');
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
        let testResult = await MailService.testSmtpConfig(data);
        if (!testResult.failed) {

            let emailSmtp = await EmailSmtpService.create(data);
            return sendItemResponse(req, res, emailSmtp);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId', getUser, isAuthorized, async function (req, res) {
    try {
        let projectId = req.params.projectId;
        let emailSmtp = await EmailSmtpService.findOneBy({ projectId });
        return sendItemResponse(req, res, emailSmtp);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/:emailSmtpId', getUser, isAuthorized, async function (req, res) {
    try {
        let data = req.body;
        let emailSmtpId = req.params.emailSmtpId;
        data.email = req.user.email;
        let testResult = await MailService.testSmtpConfig(data);
        if (!testResult.failed) {
            // Call the EmailTemplateService
            let emailSmtp = await EmailSmtpService.updateOneBy({ _id: emailSmtpId }, data);
            return sendItemResponse(req, res, emailSmtp);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }

});

router.delete('/:projectId/:emailSmtpId', getUser, isUserOwner, async function (req, res) {
    try {
        let data = req.body;
        let emailSmtpId = req.params.emailSmtpId;
        let emailSmtp = await EmailSmtpService.updateOneBy({ _id: emailSmtpId }, data);
        return sendItemResponse(req, res, emailSmtp);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;