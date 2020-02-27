/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const EmailSmtpService = require('../services/emailSmtpService');
const MailService = require('../services/mailService');
const router = express.Router();
const { isAuthorized } = require('../middlewares/authorization');
const getUser = require('../middlewares/user').getUser;
const isUserOwner = require('../middlewares/project').isUserOwner;
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

router.post('/:projectId', getUser, isAuthorized, async function(req, res) {
    try {
        const data = req.body;
        data.projectId = req.params.projectId;
        data.email = req.user.email;
        if (!data.user) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'User Name is required.',
            });
        }

        if (!data.pass) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Password is required.',
            });
        }

        if (!data.host) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'host is required.',
            });
        }

        if (!data.port) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'port is required.',
            });
        }

        if (!data.from) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'from is required.',
            });
        }
        const testResult = await MailService.testSmtpConfig(data);
        if (!testResult.failed) {
            const emailSmtp = await EmailSmtpService.create(data);
            return sendItemResponse(req, res, emailSmtp);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId', getUser, isAuthorized, async function(req, res) {
    try {
        const projectId = req.params.projectId;
        const emailSmtp = await EmailSmtpService.findOneBy({ projectId });
        return sendItemResponse(req, res, emailSmtp);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/:emailSmtpId', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        const data = req.body;
        const emailSmtpId = req.params.emailSmtpId;
        data.email = req.user.email;
        const testResult = await MailService.testSmtpConfig(data);
        if (!testResult.failed) {
            // Call the EmailTemplateService
            const emailSmtp = await EmailSmtpService.updateOneBy(
                { _id: emailSmtpId },
                data
            );
            return sendItemResponse(req, res, emailSmtp);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete('/:projectId/:emailSmtpId', getUser, isUserOwner, async function(
    req,
    res
) {
    try {
        const data = req.body;
        const emailSmtpId = req.params.emailSmtpId;
        const emailSmtp = await EmailSmtpService.updateOneBy(
            { _id: emailSmtpId },
            data
        );
        return sendItemResponse(req, res, emailSmtp);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
