import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import EmailTemplateService from '../services/emailTemplateService';

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
            const [subject, body]: $TSFixMe = await Promise.all([
                DOMPurify.sanitize(data.subject),
                DOMPurify.sanitize(data.body, {
                    WHOLE_DOCUMENT: true,
                }),
            ]);
            data.subject = subject;
            data.body = body;
            const emailTemplate: $TSFixMe = await EmailTemplateService.create(data);
            return sendItemResponse(req, res, emailTemplate);
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
            await EmailTemplateService.resetTemplate(projectId, templateId);
            const templates: $TSFixMe = await EmailTemplateService.getTemplates(
                projectId
            );
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
            const templates: $TSFixMe = await EmailTemplateService.getTemplates(
                projectId
            );
            return sendItemResponse(req, res, templates);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/emailTemplate/:emailTemplateId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const emailTemplateId: $TSFixMe = req.params.emailTemplateId;
            const select: string =
                'projectId subject body emailType allowedVariables';
            const emailTemplates: $TSFixMe = await EmailTemplateService.findOneBy({
                query: { _id: emailTemplateId },
                select,
                populate: [{ path: 'projectId', select: 'nmae' }],
            });
            return sendItemResponse(req, res, emailTemplates);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/emailTemplate/:emailTemplateId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data: $TSFixMe = req.body;
            const Id: $TSFixMe = req.params.emailTemplateId;
            // Call the EmailTemplateService
            const emailTemplate: $TSFixMe = await EmailTemplateService.updateOneBy(
                { _id: Id },
                data
            );
            return sendItemResponse(req, res, emailTemplate);
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
                value.projectId = projectId;
                const [subject, body]: $TSFixMe = await Promise.all([
                    DOMPurify.sanitize(value.subject),
                    DOMPurify.sanitize(value.body, {
                        WHOLE_DOCUMENT: true,
                    }),
                ]);
                value.subject = subject;
                value.body = body;
                data.push(value);
            }
            const select: string =
                'projectId subject body emailType allowedVariables';
            for (const value of data) {
                const emailTemplate: $TSFixMe = await EmailTemplateService.findOneBy({
                    query: {
                        projectId: value.projectId,
                        emailType: value.emailType,
                    },
                    select,
                    populate: [{ path: 'projectId', select: 'nmae' }],
                });
                if (emailTemplate) {
                    await EmailTemplateService.updateOneBy(
                        { _id: value._id },
                        value
                    );
                } else {
                    await EmailTemplateService.create(value);
                }
            }
            const emailTemplates: $TSFixMe = await EmailTemplateService.getTemplates(
                projectId
            );
            return sendItemResponse(req, res, emailTemplates);
        } catch (error) {
            sendErrorResponse(req, res, error);
        }
    }
);

router.delete(
    '/:projectId/emailTemplate/:emailTemplateId',
    getUser,
    isUserOwner,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const emailTemplateId: $TSFixMe = req.params.emailTemplateId;

            const userId: $TSFixMe = req.user.id;
            const emailTemplate: $TSFixMe = await EmailTemplateService.deleteBy(
                { _id: emailTemplateId },
                userId
            );
            return sendItemResponse(req, res, emailTemplate);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
