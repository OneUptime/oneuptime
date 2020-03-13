/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const SmsTemplateService = require('../services/smsTemplateService');

const router = express.Router();

const createDOMPurify = require('dompurify');
const jsdom = require('jsdom').jsdom;
const window = jsdom('').defaultView;
const DOMPurify = createDOMPurify(window);

const { isAuthorized } = require('../middlewares/authorization');
const getUser = require('../middlewares/user').getUser;
const isUserOwner = require('../middlewares/project').isUserOwner;

const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

router.post('/:projectId', getUser, isAuthorized, async function(req, res) {
    try {
        const data = req.body;
        data.projectId = req.params.projectId;

        if (!data.body) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'SMS body is required.',
            });
        }

        data.body = await DOMPurify.sanitize(data.body);
        const smsTemplate = await SmsTemplateService.create(data);
        return sendItemResponse(req, res, smsTemplate);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get(
    '/:projectId/:templateId/reset',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const projectId = req.params.projectId;
            const templateId = req.params.templateId;
            await SmsTemplateService.resetTemplate(projectId, templateId);
            const templates = await SmsTemplateService.getTemplates(projectId);
            return sendItemResponse(req, res, templates);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get('/:projectId', getUser, isAuthorized, async function(req, res) {
    try {
        const projectId = req.params.projectId;
        const templates = await SmsTemplateService.getTemplates(projectId);
        return sendItemResponse(req, res, templates);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get(
    '/:projectId/smsTemplate/:smsTemplateId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const smsTemplateId = req.params.smsTemplateId;
            const smsTemplates = await SmsTemplateService.findOneBy({
                _id: smsTemplateId,
            });
            return sendItemResponse(req, res, smsTemplates);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.put(
    '/:projectId/smsTemplate/:smsTemplateId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const data = req.body;
            const smsTemplateId = req.params.smsTemplateId;
            // Call the SMSTemplateService
            data.body = await DOMPurify.sanitize(data.body);
            const smsTemplate = await SmsTemplateService.updateOneBy(
                { _id: smsTemplateId },
                data
            );
            return sendItemResponse(req, res, smsTemplate);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.put('/:projectId', getUser, isAuthorized, async function(req, res) {
    try {
        const data = [];
        for (const value of req.body) {
            if (!value.body) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'SMS body is required.',
                });
            }
            // sanitize template markup
            value.projectId = req.params.projectId;
            value.body = await DOMPurify.sanitize(value.body);
            data.push(value);
        }
        for (const value of data) {
            const smsTemplate = await SmsTemplateService.findOneBy({
                projectId: value.projectId,
                smsType: value.smsType,
            });
            if (smsTemplate) {
                await SmsTemplateService.updateOneBy({ _id: value._id }, value);
            } else {
                await SmsTemplateService.create(value);
            }
        }
        const smsTemplates = await SmsTemplateService.getTemplates(
            req.params.projectId
        );
        return sendItemResponse(req, res, smsTemplates);
    } catch (error) {
        sendErrorResponse(req, res, error);
    }
});

router.delete(
    '/:projectId/smsTemplate/:smsTemplateId',
    getUser,
    isUserOwner,
    async function(req, res) {
        try {
            const smsTemplateId = req.params.smsTemplateId;
            const userId = req.user.id;
            const smsTemplate = await SmsTemplateService.deleteBy(
                { _id: smsTemplateId },
                userId
            );
            return sendItemResponse(req, res, smsTemplate);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;
