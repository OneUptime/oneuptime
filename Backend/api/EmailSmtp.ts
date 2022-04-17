import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import EmailSmtpService from '../services/emailSmtpService';
import MailService from '../services/mailService';
const router: $TSFixMe = express.getRouter();

import { isAuthorized } from '../middlewares/authorization';
const getUser: $TSFixMe = require('../middlewares/user').getUser;
const isUserMasterAdmin: $TSFixMe =
    require('../middlewares/user').isUserMasterAdmin;
const isUserOwner: $TSFixMe = require('../middlewares/project').isUserOwner;
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import UserService from '../services/userService';

router.post(
    '/test',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            let data: $TSFixMe = req.body;
            if (data.smtpToUse === 'customSmtp') {
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

                if (!data.name) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'name is required.',
                    });
                }

                if (!data.from) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'from is required.',
                    });
                }

                data.internalSmtp = false;
            } else if (data.smtpToUse === 'internalSmtp') {
                data = {
                    ...data,
                    internalSmtp: true,
                    user: process.env['INTERNAL_SMTP_USER'],
                    pass: process.env['INTERNAL_SMTP_PASSWORD'],
                    host: process.env['INTERNAL_SMTP_SERVER'],
                    port: process.env['INTERNAL_SMTP_PORT'],
                    from: process.env['INTERNAL_SMTP_FROM'],
                    name: process.env['INTERNAL_SMTP_NAME'],
                    secure: false,
                };
            }

            let response: $TSFixMe = await MailService.testSmtpConfig(data);
            response = { message: 'Email sent successfully' };
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data: $TSFixMe = req.body;
            data.projectId = req.params.projectId;
            const user: $TSFixMe = await UserService.findOneBy({
                query: { _id: req.user.id },
                select: 'email',
            });
            data.email = user.email;

            if (!data.user || !data.user.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'User Name is required.',
                });
            }

            if (!data.pass || !data.pass.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Password is required.',
                });
            }

            if (!data.host || !data.host.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'host is required.',
                });
            }

            if (!data.port || !data.port.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'port is required.',
                });
            }

            if (!data.from || !data.from.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'from is required.',
                });
            }

            if (!data.name || !data.name.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'name is required.',
                });
            }

            const testResult: $TSFixMe = await MailService.testSmtpConfig(data);
            if (!testResult.failed) {
                const emailSmtp: $TSFixMe = await EmailSmtpService.create(data);
                return sendItemResponse(req, res, emailSmtp);
            }
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
            const select: $TSFixMe =
                'projectId user pass host port from name iv secure enabled createdAt';
            const emailSmtp: $TSFixMe = await EmailSmtpService.findOneBy({
                query: { projectId },
                select,
                populate: [{ path: 'projectId', select: 'name' }],
            });
            return sendItemResponse(req, res, emailSmtp);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/:emailSmtpId',
    getUser,
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const data: $TSFixMe = req.body;
            const emailSmtpId: $TSFixMe = req.params.emailSmtpId;
            const user: $TSFixMe = await UserService.findOneBy({
                query: { _id: req.user.id },
                select: 'email',
            });
            data.email = user.email;

            if (!data.user || !data.user.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'User Name is required.',
                });
            }

            if (!data.pass || !data.pass.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Password is required.',
                });
            }

            if (!data.host || !data.host.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'host is required.',
                });
            }

            if (!data.port || !data.port.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'port is required.',
                });
            }

            if (!data.from || !data.from.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'from is required.',
                });
            }

            if (!data.name || !data.name.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'name is required.',
                });
            }

            const testResult: $TSFixMe = await MailService.testSmtpConfig(data);
            if (!testResult.failed) {
                // Call the EmailTemplateService
                const emailSmtp: $TSFixMe = await EmailSmtpService.updateOneBy(
                    { _id: emailSmtpId },
                    data
                );
                return sendItemResponse(req, res, emailSmtp);
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:projectId/:emailSmtpId',
    getUser,
    isUserOwner,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const data: $TSFixMe = req.body;
            data.deleted = true;
            data.enabled = false;
            const emailSmtpId: $TSFixMe = req.params.emailSmtpId;
            const emailSmtp: $TSFixMe = await EmailSmtpService.updateOneBy(
                { _id: emailSmtpId },
                data
            );
            return sendItemResponse(req, res, emailSmtp);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
