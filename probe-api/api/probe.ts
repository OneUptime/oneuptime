// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'expr... Remove this comment to see the full error message
import express from 'express';
import MonitorService from '../services/monitorService';
const router = express.Router();
const isAuthorizedProbe = require('../middlewares/probeAuthorization')
    .isAuthorizedProbe;
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;

router.get('/monitors', isAuthorizedProbe, async function(
    req: $TSFixMe,
    res: $TSFixMe
) {
    try {
        const { limit = 10 } = req.query;
        const monitors = await MonitorService.getProbeMonitors(
            req.probe.id,
            limit
        );

        return sendListResponse(
            req,
            res,
            JSON.stringify(monitors),
            monitors.length
        );
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;
