import express, {
    ExpressRequest,
    ExpressResponse,
} from 'common-server/utils/express';
import SmsTemplateService from '../services/smsTemplateService';

const router = express.getRouter();

import createDOMPurify from 'dompurify';
const jsdom = require('jsdom').jsdom;
const window = jsdom('').defaultView;
const DOMPurify = createDOMPurify(window);

import { isAuthorized } from '../middlewares/authorization';
const getUser = require('../middlewares/user').getUser;
const isUserOwner = require('../middlewares/project').isUserOwner;

import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';

router.post(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
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
    }
);

router.get(
    '/:projectId/:templateId/reset',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
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

router.get(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId = req.params.projectId;
            const templates = await SmsTemplateService.getTemplates(projectId);
            return sendItemResponse(req, res, templates);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get(
    '/:projectId/smsTemplate/:smsTemplateId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const smsTemplateId = req.params.smsTemplateId;
            const populate = [{ path: 'projectId', select: 'name' }];
            const select = 'projectId body smsType allowedVariables';
            const smsTemplates = await SmsTemplateService.findOneBy({
                query: { _id: smsTemplateId },
                populate,
                select,
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
    async (req: ExpressRequest, res: ExpressResponse) => {
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

router.put(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data = [];
            const { projectId } = req.params;
            for (const value of req.body) {
                if (!value.body) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'SMS body is required.',
                    });
                }
                // sanitize template markup
                value.projectId = projectId;
                value.body = await DOMPurify.sanitize(value.body);
                data.push(value);
            }

            const templateData = [];
            for (const value of data) {
                const smsTemplate = await SmsTemplateService.findOneBy({
                    query: {
                        projectId: value.projectId,
                        smsType: value.smsType,
                    },
                    select: '_id',
                });
                if (smsTemplate) {
                    await SmsTemplateService.updateOneBy(
                        { _id: value._id },
                        value
                    );
                } else {
                    templateData.push(value);
                }
            }
            await SmsTemplateService.createMany(templateData);

            const smsTemplates = await SmsTemplateService.getTemplates(
                projectId
            );
            return sendItemResponse(req, res, smsTemplates);
        } catch (error) {
            sendErrorResponse(req, res, error);
        }
    }
);

router.delete(
    '/:projectId/smsTemplate/:smsTemplateId',
    getUser,
    isUserOwner,
    async (req: ExpressRequest, res: ExpressResponse) => {
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

export default router;
