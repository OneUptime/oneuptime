/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const EmailTemplateService = require('../services/emailTemplateService');

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
        if (!data.subject) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Email subject is required.',
            });
        }

        if (!data.body) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Email body is required.',
            });
        }

        // sanitize template markup
        data.subject = await DOMPurify.sanitize(data.subject);
        data.body = await DOMPurify.sanitize(data.body, {
            WHOLE_DOCUMENT: true,
        });
        const emailTemplate = await EmailTemplateService.create(data);
        return sendItemResponse(req, res, emailTemplate);
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
            await EmailTemplateService.resetTemplate(projectId, templateId);
            const templates = await EmailTemplateService.getTemplates(
                projectId
            );
            return sendItemResponse(req, res, templates);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get('/:projectId', getUser, isAuthorized, async function(req, res) {
    try {
        const projectId = req.params.projectId;
        const templates = await EmailTemplateService.getTemplates(projectId);
        return sendItemResponse(req, res, templates);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get(
    '/:projectId/emailTemplate/:emailTemplateId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const emailTemplateId = req.params.emailTemplateId;
            const emailTemplates = await EmailTemplateService.findOneBy({
                _id: emailTemplateId,
            });
            return sendItemResponse(req, res, emailTemplates);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.put(
    '/:projectId/emailTemplate/:emailTemplateId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const data = req.body;
            const Id = req.params.emailTemplateId;
            // Call the EmailTemplateService
            const emailTemplate = await EmailTemplateService.updateOneBy(
                { _id: Id },
                data
            );
            return sendItemResponse(req, res, emailTemplate);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.put('/:projectId', getUser, isAuthorized, async function(req, res) {
    try {
        const data = [];
        for (const value of req.body) {
            if (!value.subject) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Email subject is required.',
                });
            }

            if (!value.body) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Email body is required.',
                });
            }
            // sanitize template markup
            value.projectId = req.params.projectId;
            value.subject = await DOMPurify.sanitize(value.subject);
            value.body = await DOMPurify.sanitize(value.body, {
                WHOLE_DOCUMENT: true,
            });
            data.push(value);
        }
        for (const value of data) {
            await EmailTemplateService.updateOneBy({ _id: value._id }, value);
        }
        const emailTemplates = await EmailTemplateService.getTemplates(
            req.params.projectId
        );
        return sendItemResponse(req, res, emailTemplates);
    } catch (error) {
        sendErrorResponse(req, res, error);
    }
});

router.delete(
    '/:projectId/emailTemplate/:emailTemplateId',
    getUser,
    isUserOwner,
    async function(req, res) {
        try {
            const emailTemplateId = req.params.emailTemplateId;
            const userId = req.user.id;
            const emailTemplate = await EmailTemplateService.deleteBy(
                { _id: emailTemplateId },
                userId
            );
            return sendItemResponse(req, res, emailTemplate);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;
