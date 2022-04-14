import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import SmsTemplateService from '../services/smsTemplateService';

const router: $TSFixMe = express.getRouter();

import createDOMPurify from 'dompurify';
const jsdom: $TSFixMe = require('jsdom').jsdom;
const window: $TSFixMe = jsdom('').defaultView;
const DOMPurify: $TSFixMe = createDOMPurify(window);

import { isAuthorized } from '../middlewares/authorization';
const getUser: $TSFixMe = require('../middlewares/user').getUser;
const isUserOwner: $TSFixMe = require('../middlewares/project').isUserOwner;

import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

router.post(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data: $TSFixMe = req.body;
            data.projectId = req.params.projectId;

            if (!data.body) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'SMS body is required.',
                });
            }

            data.body = await DOMPurify.sanitize(data.body);
            const smsTemplate: $TSFixMe = await SmsTemplateService.create(data);
            return sendItemResponse(req, res, smsTemplate);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/:templateId/reset',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId: $TSFixMe = req.params.projectId;
            const templateId: $TSFixMe = req.params.templateId;
            await SmsTemplateService.resetTemplate(projectId, templateId);
            const templates: $TSFixMe = await SmsTemplateService.getTemplates(projectId);
            return sendItemResponse(req, res, templates);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId: $TSFixMe = req.params.projectId;
            const templates: $TSFixMe = await SmsTemplateService.getTemplates(projectId);
            return sendItemResponse(req, res, templates);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/smsTemplate/:smsTemplateId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const smsTemplateId: $TSFixMe = req.params.smsTemplateId;
            const populate: $TSFixMe = [{ path: 'projectId', select: 'name' }];
            const select: string = 'projectId body smsType allowedVariables';
            const smsTemplates: $TSFixMe = await SmsTemplateService.findOneBy({
                query: { _id: smsTemplateId },
                populate,
                select,
            });
            return sendItemResponse(req, res, smsTemplates);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/smsTemplate/:smsTemplateId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data: $TSFixMe = req.body;
            const smsTemplateId: $TSFixMe = req.params.smsTemplateId;
            // Call the SMSTemplateService
            data.body = await DOMPurify.sanitize(data.body);
            const smsTemplate: $TSFixMe = await SmsTemplateService.updateOneBy(
                { _id: smsTemplateId },
                data
            );
            return sendItemResponse(req, res, smsTemplate);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data: $TSFixMe = [];
            const { projectId }: $TSFixMe = req.params;
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

            const templateData: $TSFixMe = [];
            for (const value of data) {
                const smsTemplate: $TSFixMe = await SmsTemplateService.findOneBy({
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

            const smsTemplates: $TSFixMe = await SmsTemplateService.getTemplates(
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
            const smsTemplateId: $TSFixMe = req.params.smsTemplateId;

            const userId: $TSFixMe = req.user.id;
            const smsTemplate: $TSFixMe = await SmsTemplateService.deleteBy(
                { _id: smsTemplateId },
                userId
            );
            return sendItemResponse(req, res, smsTemplate);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
