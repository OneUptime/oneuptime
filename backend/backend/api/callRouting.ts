import express from 'express'
import { fetchPhoneNumbers } from '../services/twilioService'
import CallRoutingService from '../services/callRoutingService'
import FileService from '../services/fileService'
import { isAuthorized } from '../middlewares/authorization'
const getUser = require('../middlewares/user').getUser;
const isUserAdmin = require('../middlewares/project').isUserAdmin;
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const router = express.Router();
import multer from 'multer'
import storage from '../middlewares/upload'

const callForward = async (req, res) => {
    try {
        const body = req.body;
        const to = body['To'];
        const select =
            'projectId deleted phoneNumber locality region capabilities routingSchema sid price priceUnit countryCode numberType stripeSubscriptionId';
        const data = await CallRoutingService.findOneBy({
            query: { phoneNumber: to },
            select,
        });
        const response = await CallRoutingService.getCallResponse(
            data,
            to,
            body,
            false
        );
        res.set('Content-Type', 'text/xml');
        return res.send(response.toString());
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
};

const backupCallForward = async (req, res) => {
    try {
        const body = req.body;
        const to = body['To'];
        const select =
            'projectId deleted phoneNumber locality region capabilities routingSchema sid price priceUnit countryCode numberType stripeSubscriptionId';
        const data = await CallRoutingService.findOneBy({
            query: { phoneNumber: to },
            select,
        });
        const response = await CallRoutingService.getCallResponse(
            data,
            to,
            body,
            true
        );
        res.set('Content-Type', 'text/xml');
        return res.send(response.toString());
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
};

const callStatus = async (req, res) => {
    try {
        const body = req.body;
        const to = body['To'];
        const select =
            'projectId deleted phoneNumber locality region capabilities routingSchema sid price priceUnit countryCode numberType stripeSubscriptionId';
        const data = await CallRoutingService.findOneBy({
            query: { phoneNumber: to },
            select,
        });
        const response = await CallRoutingService.chargeRoutedCall(
            data.projectId,
            body
        );
        return res.send(response);
    } catch (error) {
        return sendErrorResponse(req, res, error);
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

router.get('/:projectId', getUser, isAuthorized, async (req, res) => {
    try {
        let { skip, limit } = req.query;
        const { projectId } = req.params;
        if (typeof skip === 'string') skip = parseInt(skip);
        if (typeof limit === 'string') limit = parseInt(limit);

        const populate = [{ path: 'projectId', select: 'name slug _id' }];
        const select =
            'projectId deleted phoneNumber locality region capabilities routingSchema sid price priceUnit countryCode numberType stripeSubscriptionId';
        const [numbers, count] = await Promise.all([
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
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/logs', getUser, isAuthorized, async (req, res) => {
    try {
        const { projectId } = req.params;
        const logs = await CallRoutingService.getCallRoutingLogs(projectId);
        return sendItemResponse(req, res, logs);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get(
    '/:projectId/routingNumbers',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { countryCode, numberType } = req.query;
            const { projectId } = req.params;
            const numbers = await fetchPhoneNumbers(
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
            } else {
                return sendErrorResponse(req, res, error);
            }
        }
    }
);

router.post('/:projectId/routingNumber', getUser, isUserAdmin, async function(
    req,
    res
) {
    try {
        const data = req.body;
        const { projectId } = req.params;
        const CallRouting = await CallRoutingService.reserveNumber(
            data,
            projectId
        );
        return sendItemResponse(req, res, CallRouting);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/:callRoutingId', getUser, isUserAdmin, async function(
    req,
    res
) {
    try {
        const { callRoutingId } = req.params;
        const data = req.body;
        data.callRoutingId = callRoutingId;
        const CallRouting = await CallRoutingService.updateRoutingSchema(data);
        return sendItemResponse(req, res, CallRouting);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put(
    '/:projectId/:callRoutingId/:audioFieldName',
    getUser,
    isUserAdmin,
    async function(req, res) {
        try {
            const { audioFieldName, callRoutingId } = req.params;
            const upload = multer({
                storage,
            }).fields([
                {
                    name: audioFieldName,
                    maxCount: 1,
                },
            ]);
            upload(req, res, async function(error) {
                if (error) {
                    return sendErrorResponse(req, res, error);
                }
                const data = {};
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
                const CallRouting = await CallRoutingService.updateRoutingSchemaAudio(
                    data
                );
                return sendItemResponse(req, res, CallRouting);
            });
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.delete(
    '/:projectId/:callRoutingId',
    getUser,
    isUserAdmin,
    async function(req, res) {
        try {
            const { projectId, callRoutingId } = req.params;
            const userId = req.user.id;
            if (!callRoutingId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Call Routing Id is required.',
                });
            }
            let data = await CallRoutingService.deleteBy(
                { _id: callRoutingId, projectId },
                userId
            );
            if (data && data[0] && data[0]._id) {
                data = data[0];
            }
            return sendItemResponse(req, res, data);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.delete(
    '/:projectId/:callRoutingId/removeAudio',
    getUser,
    isUserAdmin,
    async function(req, res) {
        try {
            const { callRoutingId, backup } = req.body;
            if (!callRoutingId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Call Routing Id is required.',
                });
            }
            let routingSchema = await CallRoutingService.findOneBy({
                query: { _id: callRoutingId },
                select: 'routingSchema',
            });
            routingSchema = routingSchema.routingSchema;
            const query = {};
            if (backup) {
                query.filename = routingSchema.backup_introAudio;
                routingSchema.backup_introAudio = null;
                routingSchema.backup_introAudioName = '';
            } else {
                query.filename = routingSchema.introAudio;
                routingSchema.introAudio = null;
                routingSchema.introAudioName = '';
            }
            const [data] = await Promise.all([
                CallRoutingService.updateOneBy(
                    { _id: callRoutingId },
                    { routingSchema }
                ),
                FileService.deleteOneBy(query),
            ]);
            return sendItemResponse(req, res, data);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

export default router;
