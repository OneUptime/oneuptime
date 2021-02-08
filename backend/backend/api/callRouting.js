/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const { fetchPhoneNumbers } = require('../services/twilioService');
const CallRoutingService = require('../services/callRoutingService');
const { isAuthorized } = require('../middlewares/authorization');
const getUser = require('../middlewares/user').getUser;
const isUserAdmin = require('../middlewares/project').isUserAdmin;
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const router = express.Router();

const callForward = async (req, res) => {
    try {
        const body = req.body;
        const to = body['To'];
        const fromNumber = body['From'];
        const data = await CallRoutingService.findOneBy({
            phoneNumber: to,
        });
        const response = await CallRoutingService.getCallResponse(
            data,
            fromNumber,
            to
        );
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
});

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

module.exports = router;
