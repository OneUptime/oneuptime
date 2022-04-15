import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';

import { fetchPhoneNumbers } from '../services/twilioService';
import CallRoutingService from '../services/callRoutingService';
import FileService from '../services/fileService';

import { isAuthorized } from '../middlewares/authorization';
const getUser: $TSFixMe = require('../middlewares/user').getUser;
const isUserAdmin: $TSFixMe = require('../middlewares/project').isUserAdmin;
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

const router: $TSFixMe = express.getRouter();
import multer from 'multer';
import storage from '../middlewares/upload';

const callForward: Function = async (
    req: ExpressRequest,
    res: ExpressResponse
): void => {
    try {
        const body: $TSFixMe = req.body;
        const to: $TSFixMe = body.To;
        const select: $TSFixMe =
            'projectId deleted phoneNumber locality region capabilities routingSchema sid price priceUnit countryCode numberType stripeSubscriptionId';
        const data: $TSFixMe = await CallRoutingService.findOneBy({
            query: { phoneNumber: to },
            select,
        });
        const response: $TSFixMe = await CallRoutingService.getCallResponse(
            data,
            to,
            body,
            false
        );
        res.set('Content-Type', 'text/xml');
        return res.send(response.toString());
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
};

const backupCallForward: Function = async (
    req: ExpressRequest,
    res: ExpressResponse
): void => {
    try {
        const body: $TSFixMe = req.body;
        const to: $TSFixMe = body.To;
        const select: $TSFixMe =
            'projectId deleted phoneNumber locality region capabilities routingSchema sid price priceUnit countryCode numberType stripeSubscriptionId';
        const data: $TSFixMe = await CallRoutingService.findOneBy({
            query: { phoneNumber: to },
            select,
        });
        const response: $TSFixMe = await CallRoutingService.getCallResponse(
            data,
            to,
            body,
            true
        );
        res.set('Content-Type', 'text/xml');
        return res.send(response.toString());
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
};

const callStatus: Function = async (
    req: ExpressRequest,
    res: ExpressResponse
): void => {
    try {
        const body: $TSFixMe = req.body;
        const to: $TSFixMe = body.To;
        const select: $TSFixMe =
            'projectId deleted phoneNumber locality region capabilities routingSchema sid price priceUnit countryCode numberType stripeSubscriptionId';
        const data: $TSFixMe = await CallRoutingService.findOneBy({
            query: { phoneNumber: to },
            select,
        });
        const response: $TSFixMe = await CallRoutingService.chargeRoutedCall(
            data.projectId,
            body
        );
        return res.send(response);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
};

// Route for connecting caller to specific team member.
router.get('/routeCalls', callForward);
router.post('/routeCalls', callForward);

// Route for connecting caller to specific team member.
router.get('/routeBackupCall', backupCallForward);
router.post('/routeBackupCall', backupCallForward);

// Route for status callback from twilio.
router.get('/statusCallback', callStatus);
router.post('/statusCallback', callStatus);

router.get(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            let { skip, limit }: $TSFixMe = req.query;
            const { projectId }: $TSFixMe = req.params;

            if (typeof skip === 'string') {
                skip = parseInt(skip);
            }

            if (typeof limit === 'string') {
                limit = parseInt(limit);
            }

            const populate: $TSFixMe = [
                { path: 'projectId', select: 'name slug _id' },
            ];
            const select: $TSFixMe =
                'projectId deleted phoneNumber locality region capabilities routingSchema sid price priceUnit countryCode numberType stripeSubscriptionId';
            const [numbers, count]: $TSFixMe = await Promise.all([
                CallRoutingService.findBy({
                    query: { projectId },
                    skip,
                    limit,
                    select,
                    populate,
                }),
                CallRoutingService.countBy({ projectId }),
            ]);

            return sendItemResponse(req, res, { numbers, count, skip, limit });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/logs',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId }: $TSFixMe = req.params;
            const logs: $TSFixMe = await CallRoutingService.getCallRoutingLogs(
                projectId
            );
            return sendItemResponse(req, res, logs);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/routingNumbers',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { countryCode, numberType }: $TSFixMe = req.query;
            const { projectId }: $TSFixMe = req.params;
            const numbers: $TSFixMe = await fetchPhoneNumbers(
                projectId,
                countryCode,
                numberType
            );
            return sendItemResponse(req, res, numbers);
        } catch (error) {
            if (
                (error &&
                    error.message &&
                    error.message.includes('not found')) ||
                error.includes('not found')
            ) {
                return sendErrorResponse(req, res, {
                    statusCode: 400,
                    message: 'Requested resource not available.',
                });
            }
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId/routingNumber',
    getUser,
    isUserAdmin,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const data: $TSFixMe = req.body;
            const { projectId }: $TSFixMe = req.params;
            const CallRouting: $TSFixMe =
                await CallRoutingService.reserveNumber(data, projectId);
            return sendItemResponse(req, res, CallRouting);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/:callRoutingId',
    getUser,
    isUserAdmin,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const { callRoutingId }: $TSFixMe = req.params;
            const data: $TSFixMe = req.body;
            data.callRoutingId = callRoutingId;
            const CallRouting: $TSFixMe =
                await CallRoutingService.updateRoutingSchema(data);
            return sendItemResponse(req, res, CallRouting);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/:callRoutingId/:audioFieldName',
    getUser,
    isUserAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { audioFieldName, callRoutingId }: $TSFixMe = req.params;
            const upload: $TSFixMe = multer({
                storage,
            }).fields([
                {
                    name: audioFieldName,
                    maxCount: 1,
                },
            ]);
            upload(req, res, async (error: $TSFixMe): void => {
                if (error) {
                    return sendErrorResponse(req, res, error as Exception);
                }
                const data: $TSFixMe = {};

                data.audioFieldName = audioFieldName;

                data.callRoutingId = callRoutingId;
                if (
                    req.files &&
                    req.files[audioFieldName] &&
                    req.files[audioFieldName][0].filename
                ) {
                    data.file = req.files[audioFieldName][0].filename;

                    data.fileName = req.files[audioFieldName][0].originalname;
                }
                const CallRouting: $TSFixMe =
                    await CallRoutingService.updateRoutingSchemaAudio(data);
                return sendItemResponse(req, res, CallRouting);
            });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:projectId/:callRoutingId',
    getUser,
    isUserAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId, callRoutingId }: $TSFixMe = req.params;

            const userId: $TSFixMe = req.user.id;
            if (!callRoutingId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Call Routing Id is required.',
                });
            }
            let data: $TSFixMe = await CallRoutingService.deleteBy(
                { _id: callRoutingId, projectId },
                userId
            );
            if (data && data[0] && data[0]._id) {
                data = data[0];
            }
            return sendItemResponse(req, res, data);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:projectId/:callRoutingId/removeAudio',
    getUser,
    isUserAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { callRoutingId, backup }: $TSFixMe = req.body;
            if (!callRoutingId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Call Routing Id is required.',
                });
            }
            let routingSchema: $TSFixMe = await CallRoutingService.findOneBy({
                query: { _id: callRoutingId },
                select: 'routingSchema',
            });
            routingSchema = routingSchema.routingSchema;
            const query: $TSFixMe = {};
            if (backup) {
                query.filename = routingSchema.backup_introAudio;
                routingSchema.backup_introAudio = null;
                routingSchema.backup_introAudioName = '';
            } else {
                query.filename = routingSchema.introAudio;
                routingSchema.introAudio = null;
                routingSchema.introAudioName = '';
            }
            const [data]: $TSFixMe = await Promise.all([
                CallRoutingService.updateOneBy(
                    { _id: callRoutingId },
                    { routingSchema }
                ),
                FileService.deleteOneBy(query),
            ]);
            return sendItemResponse(req, res, data);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
