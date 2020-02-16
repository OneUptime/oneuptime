let express = require('express');
let router = express.Router();

const { isAuthorized } = require('../middlewares/authorization');

let { getUser, checkUserBelongToProject } = require('../middlewares/user');
let { isUserAdmin }  = require('../middlewares/project');

let ScheduledEventService = require('../services/scheduledEventService');

let sendErrorResponse = require('../middlewares/response').sendErrorResponse;
let sendListResponse = require('../middlewares/response').sendListResponse;
let sendItemResponse = require('../middlewares/response').sendItemResponse;


router.post('/:projectId/:monitorId', getUser, isAuthorized, isUserAdmin, async function (req, res) {
    try {
        let projectId = req.params.projectId;
        let monitorId = req.params.monitorId;

        let data = req.body;
        data.createdById = req.user ? req.user.id : null;


        if (!data) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Values can\'t be null'
            });
        }

        if (!data.name) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Event name is required.'
            });
        }

        if (typeof data.name !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Event name is not of string type.'
            });
        }

        if (!projectId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID is required.'
            });
        }

        if (typeof projectId !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID  is not of string type.'
            });
        }
        if (!monitorId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor ID is required.'
            });
        }

        if (typeof monitorId !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor ID  is not of string type.'
            });
        }

        if(!data.startDate){
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Start timestamp is required.'
            });
        }

        if(!data.endDate){
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'End timestamp is required.'
            });
        }

        if (!data.description) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Event description is required.'
            });
        }

        if (typeof data.description !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Event description is not of string type.'
            });
        }
        let scheduledEvent = await ScheduledEventService.create({projectId, monitorId}, data);
        return sendItemResponse(req, res, scheduledEvent);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/:eventId', getUser, isAuthorized, isUserAdmin, async function (req, res) {
    try {
        let data = req.body;
        let eventId = req.params.eventId;
        let scheduledEvent = await ScheduledEventService.updateOneBy({_id:eventId},data);
        if (scheduledEvent) {
            return sendItemResponse(req, res, scheduledEvent);
        } else {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Event not found.'
            });
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});


router.delete('/:projectId/:eventId', getUser, isAuthorized, isUserAdmin, async function (req, res) {
    try {
        let userId = req.user ? req.user.id : null;
        let event = await ScheduledEventService.deleteBy({ _id: req.params.eventId }, userId);
        if (event) {
            return sendItemResponse(req, res, event);
        }
        else {
            return sendErrorResponse(req, res, {
                code:400,
                message: 'Event not found'
            });
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});


router.get('/:projectId/:monitorId', getUser, isAuthorized, async function (req, res) {
    try {
        let projectId = req.params.projectId;
        let monitorId = req.params.monitorId;

        let query = req.query;

        if (!projectId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID is required.'
            });
        }

        if (typeof projectId !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID is not of string type.'
            });
        }

        if (!monitorId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor ID is required.'
            });
        }

        if (typeof monitorId !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor ID is not of string type.'
            });
        }
        let events = await ScheduledEventService.findBy({ projectId, monitorId }, query.limit, query.skip);
        let count = await ScheduledEventService.countBy({ projectId, monitorId});
        return sendListResponse(req, res, events, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/:monitorId/statusPage', checkUserBelongToProject,  async function (req, res) {
    try {
        let projectId = req.params.projectId;
        let monitorId = req.params.monitorId;

        let query = req.query;

        if (!projectId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID is required.'
            });
        }

        if (typeof projectId !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID is not of string type.'
            });
        }

        if (!monitorId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor ID is required.'
            });
        }

        if (typeof monitorId !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor ID is not of string type.'
            });
        }
        let events = await ScheduledEventService.findBy({ projectId, monitorId, showEventOnStatusPage: true }, query.limit, query.skip);
        let count = await ScheduledEventService.countBy({ projectId, monitorId, showEventOnStatusPage: true });
        return sendListResponse(req, res, events, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;