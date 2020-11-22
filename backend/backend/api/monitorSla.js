const express = require('express');
const getUser = require('../middlewares/user').getUser;
const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const MonitorSlaService = require('../services/monitorSlaService');

const router = express.Router();

router.get('/:projectId', getUser, isAuthorized, async function(req, res) {
    try {
        const { projectId } = req.params;
        const { limit, skip } = req.query;
        const monitorSlas = await MonitorSlaService.findBy(
            {
                projectId,
            },
            limit,
            skip
        );
        const count = await MonitorSlaService.countBy({
            projectId,
        });

        return sendListResponse(req, res, monitorSlas, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/:projectId', getUser, isAuthorized, async function(req, res) {
    try {
        const { projectId } = req.params;
        const { name, alertTime, frequency } = req.body;

        if (!name || !name.trim()) {
            const error = new Error('SLA name is required');
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }

        if (frequency && isNaN(frequency)) {
            const error = new Error('Please use numeric values for frequency');
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }

        if (!alertTime || !alertTime.trim()) {
            const error = new Error('Please set alert time for this SLA');
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }

        if (isNaN(alertTime)) {
            const error = new Error('Please use numeric values for alert time');
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }

        if (Number(alertTime) >= Number(frequency)) {
            const error = new Error(
                'Alert time should always be less than frequency'
            );
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }

        const data = { ...req.body };
        data.projectId = projectId;
        const monitorSla = await MonitorSlaService.create(data);
        return sendItemResponse(req, res, monitorSla);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/:monitorSlaId', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        const { projectId, monitorSlaId } = req.params;
        const { name, handleDefault, alertTime, frequency } = req.body;

        if (!handleDefault && (!name || !name.trim())) {
            const error = new Error('SLA name is required');
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }

        if (!handleDefault && frequency && isNaN(frequency)) {
            const error = new Error('Please use numeric values for frequency');
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }

        if (!handleDefault && (!alertTime || !alertTime.trim())) {
            const error = new Error('Please set alert time for this SLA');
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }

        if (!handleDefault && isNaN(alertTime)) {
            const error = new Error('Please use numeric values for alert time');
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }

        if (!handleDefault && Number(alertTime) >= Number(frequency)) {
            const error = new Error(
                'Alert time should be always less than frequency'
            );
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }

        const data = { ...req.body };
        const monitorSla = await MonitorSlaService.updateOneBy(
            { projectId, _id: monitorSlaId },
            data
        );
        return sendItemResponse(req, res, monitorSla);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete(
    '/:projectId/:monitorSlaId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { projectId, monitorSlaId } = req.params;

            const deletedMonitorSla = await MonitorSlaService.deleteBy({
                _id: monitorSlaId,
                projectId,
            });
            return sendItemResponse(req, res, deletedMonitorSla);
        } catch (error) {
            return sendErrorResponse(error);
        }
    }
);

module.exports = router;
