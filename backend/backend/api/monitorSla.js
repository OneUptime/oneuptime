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
        const { name, frequency, monitorUptime } = req.body;

        if (!name || !name.trim()) {
            const error = new Error('SLA name is required');
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }

        if (!monitorUptime || !monitorUptime.trim()) {
            const error = new Error('Monitor uptime is required');
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }

        if (frequency && isNaN(frequency)) {
            const error = new Error('Please use numeric values for frequency');
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }

        if (frequency && Number(frequency) < 1) {
            const error = new Error('At lease a single day is needed');
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }

        if (monitorUptime && isNaN(monitorUptime)) {
            const error = new Error(
                'Please use numeric values for monitor uptime'
            );
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }

        if (monitorUptime && Number(monitorUptime) < 1) {
            const error = new Error(
                'Monitor Uptime less than 1 is not allowed'
            );
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }

        if (monitorUptime && Number(monitorUptime) > 100) {
            const error = new Error(
                'Monitor Uptime greater than 100 is not allowed'
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
        const { name, handleDefault, frequency, monitorUptime } = req.body;

        if (!handleDefault && (!name || !name.trim())) {
            const error = new Error('SLA name is required');
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }

        if (!handleDefault && (!monitorUptime || !monitorUptime.trim())) {
            const error = new Error('Monitor uptime is required');
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }

        if (!handleDefault && frequency && isNaN(frequency)) {
            const error = new Error('Please use numeric values for frequency');
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }

        if (!handleDefault && frequency && Number(frequency) < 1) {
            const error = new Error('At lease a single day is needed');
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }

        if (!handleDefault && monitorUptime && isNaN(monitorUptime)) {
            const error = new Error(
                'Please use numeric values for monitor uptime'
            );
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }

        if (!handleDefault && monitorUptime && Number(monitorUptime) < 1) {
            const error = new Error(
                'Monitor Uptime less than 1 is not allowed'
            );
            error.code = 400;
            return sendErrorResponse(req, res, error);
        }

        if (!handleDefault && monitorUptime && Number(monitorUptime) > 100) {
            const error = new Error(
                'Monitor Uptime greater than 100 is not allowed'
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

router.get(
    '/:projectId/defaultMonitorSla',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { projectId } = req.params;
            const defaultMonitorSla = await MonitorSlaService.findOneBy({
                projectId,
                isDefault: true,
            });

            return sendItemResponse(req, res, defaultMonitorSla);
        } catch (error) {
            return sendErrorResponse(error);
        }
    }
);

module.exports = router;
