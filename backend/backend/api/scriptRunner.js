const express = require('express');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const MonitorService = require('../services/monitorService');
const ProbeService = require('../services/probeService');
const { isAuthorizedService } = require('../middlewares/serviceAuthorization');

const router = express.Router();

// get all script monitors for script-runner
router.get('/monitors', isAuthorizedService, async (req, res) => {
    try {
        const allScriptMonitors = await MonitorService.getScriptMonitors();

        return sendListResponse(
            req,
            res,
            JSON.stringify(allScriptMonitors),
            allScriptMonitors.length
        );
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// ping script monitor
router.post('/ping/:monitorId', isAuthorizedService, async function(req, res) {
    try {
        const { monitor, resp } = req.body;

        let status,
            reason,
            data = {};
        let matchedCriterion;

        // determine if monitor is up and reasons therefore
        const {
            stat: validUp,
            successReasons: upSuccessReasons,
            failedReasons: upFailedReasons,
            matchedCriterion: matchedUpCriterion,
        } = await (monitor && monitor.criteria && monitor.criteria.up
            ? ProbeService.scriptConditions(resp, monitor.criteria.up)
            : { stat: false, successReasons: [], failedReasons: [] });

        // determine if monitor is down and reasons therefore
        const {
            stat: validDown,
            successReasons: downSuccessReasons,
            failedReasons: downFailedReasons,
            matchedCriterion: matchedDownCriterion,
        } = await (monitor && monitor.criteria && monitor.criteria.down
            ? ProbeService.scriptConditions(resp, [
                  ...monitor.criteria.down.filter(
                      criterion => criterion.default !== true
                  ),
              ])
            : { stat: false, successReasons: [], failedReasons: [] });

        // determine if monitor is degraded and reasons therefore
        const {
            stat: validDegraded,
            successReasons: degradedSuccessReasons,
            failedReasons: degradedFailedReasons,
            matchedCriterion: matchedDegradedCriterion,
        } = await (monitor && monitor.criteria && monitor.criteria.degraded
            ? ProbeService.scriptConditions(resp, monitor.criteria.degraded)
            : { stat: false, successReasons: [], failedReasons: [] });

        // normalize response
        if (validUp) {
            status = 'online';
            reason = upSuccessReasons;
            matchedCriterion = matchedUpCriterion;
        } else if (validDown) {
            status = 'offline';
            reason = [...downSuccessReasons, ...upFailedReasons];
            matchedCriterion = matchedDownCriterion;
        } else if (validDegraded) {
            status = 'degraded';
            reason = [
                ...degradedSuccessReasons,
                ...upFailedReasons,
                ...downFailedReasons,
            ];
            matchedCriterion = matchedDegradedCriterion;
        } else {
            // if no match use default criteria
            status = 'offline';
            reason = [
                ...downFailedReasons,
                ...upFailedReasons,
                ...degradedFailedReasons,
            ];
            if (monitor.criteria.down) {
                matchedCriterion = monitor.criteria.down.find(
                    criterion => criterion.default === true
                );
            }
        }

        // update monitor to save the last matched criterion
        await MonitorService.updateOneBy(
            {
                _id: monitor._id,
            },
            {
                lastMatchedCriterion: matchedCriterion,
            }
        );

        // aggregate data for logging
        data = req.body;
        data.status = status;
        data.reason = reason;
        data.matchedCriterion = matchedCriterion;
        data.responseStatus = resp && resp.status ? resp.status : null;

        data.scriptMetadata = {
            executionTime: resp.executionTime,
            consoleLogs: resp.consoleLogs,
            error: resp.error,
            statusText: resp.statusText,
        };

        data.monitorId = req.params.monitorId || monitor._id;
        data.reason =
            data && data.reason && data.reason.length
                ? data.reason.filter(
                      (item, pos, self) => self.indexOf(item) === pos
                  )
                : data.reason;

        data.matchedUpCriterion =
            monitor && monitor.criteria && monitor.criteria.up;
        data.matchedDownCriterion =
            monitor && monitor.criteria && monitor.criteria.down;
        data.matchedDegradedCriterion =
            monitor && monitor.criteria && monitor.criteria.degraded;

        // save monitor log
        const log = await ProbeService.saveMonitorLog(data);

        // update script run status
        await MonitorService.updateBy(
            { _id: monitor._id },
            {
                scriptRunStatus: 'completed',
            }
        );

        return sendItemResponse(req, res, log);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
