/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const { fetchNumbers } = require('../services/twilioService');
const CallRoutingService = require('../services/callRoutingService');
const CallRoutingLogService = require('../services/callRoutingLogService');
const { isAuthorized } = require('../middlewares/authorization');
const getUser = require('../middlewares/user').getUser;
const isUserMasterAdmin = require('../middlewares/user').isUserMasterAdmin;
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const twilio = require('twilio');
const router = express.Router();

const callForward = async (req, res) => {
    try {
        const body = req.body;
        const to = body['To'];
        const fromNumber = body['From'];
        let memberId = null;
        const response = new twilio.twiml.VoiceResponse();
        const data = await CallRoutingService.findOneBy({
            phoneNumber: to,
        });
        if (
            data &&
            data.routingSchema &&
            data.routingSchema.type &&
            data.routingSchema.type.length &&
            data.routingSchema.id &&
            data.routingSchema.id.length
        ) {
            const {
                forwardingNumber,
                error,
                userId,
            } = await CallRoutingService.resolveSchedule(
                data.routingSchema.type,
                data.routingSchema.id
            );
            if (userId) {
                memberId = userId;
            }
            if (forwardingNumber && (!error || (error && error.length))) {
                response.dial(forwardingNumber);
            } else if (!forwardingNumber && error && error.length) {
                response.say(error);
            }
        } else {
            response.say('Sorry could not find anyone on duty');
        }
        if (data && data._id) {
            await CallRoutingLogService.create({
                callRoutingId: data && data._id ? data._id : null,
                calledFrom: fromNumber,
                calledTo: to,
                forwardedToId: memberId,
            });
        }
        response.say('Goodbye');
        res.set('Content-Type', 'text/xml');
        return res.send(response.toString());
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
};

// Route for connecting caller to specific team member.
router.get('/routeCalls', callForward);
router.post('/routeCalls', callForward);

router.get('/:projectId', getUser, isAuthorized, async (req, res) => {
    try {
        const { projectId } = req.params;
        const numbers = await CallRoutingService.findBy({ projectId });
        return sendItemResponse(req, res, numbers);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get(
    '/:projectId/fetchnumbers',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { countryCode, numberType } = req.query;
            const { projectId } = req.params;
            const numbers = await fetchNumbers(
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
router.get(
    '/:projectId/getTeamAndSchedules',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { projectId } = req.params;
            const teamAndSchedules = await CallRoutingService.getTeamAndSchedules(
                projectId
            );
            return sendItemResponse(req, res, teamAndSchedules);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post('/:projectId/addNumber', getUser, isUserMasterAdmin, async function(
    req,
    res
) {
    try {
        const data = req.body;
        const userId = req.user.id || req.user._id;
        const CallRouting = await CallRoutingService.reserveNumber(
            data,
            userId
        );
        return sendItemResponse(req, res, CallRouting);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post(
    '/:projectId/:callRoutingId/addCallRoutingSchedule',
    getUser,
    isUserMasterAdmin,
    async function(req, res) {
        try {
            const { callRoutingId } = req.params;
            const data = req.body;
            const routingSchema = {};
            routingSchema.type = data.type;
            if (data.type && data.type === 'TeamMember') {
                routingSchema.id = data.teamMemberId;
            } else if (data.type && data.type === 'Schedule') {
                routingSchema.id = data.scheduleId;
            }
            const CallRouting = await CallRoutingService.updateOneBy(
                { _id: callRoutingId },
                { routingSchema }
            );
            return sendItemResponse(req, res, CallRouting);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.delete(
    '/:projectId/:callRoutingId',
    getUser,
    isUserMasterAdmin,
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

module.exports = router;
