import express from 'express'
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
import MonitorService from '../services/monitorService'
import ProbeService from '../services/probeService'
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../middlewares/serviceAuthorization"' has... Remove this comment to see the full error message
import { isAuthorizedService } from '../middlewares/serviceAuthorization'

const router = express.Router();

// get all script monitors for script-runner
router.get('/monitors', isAuthorizedService, async (req, res) => {
    try {
        //get top 10 monitors.
        const allScriptMonitors = await MonitorService.getScriptMonitors({
            limit: 10,
            skip: 0,
        });

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
            matchedCriterion: matchedUpCriterion
        }: $TSFixMe =
            monitor && monitor.criteria && monitor.criteria.up
                ? await ProbeService.scriptConditions(resp, monitor.criteria.up)
                : { stat: false, successReasons: [], failedReasons: [] };

        // determine if monitor is down and reasons therefore
        const {
            stat: validDown,
            successReasons: downSuccessReasons,
            failedReasons: downFailedReasons,
            matchedCriterion: matchedDownCriterion
        }: $TSFixMe =
            monitor && monitor.criteria && monitor.criteria.down
                ? await ProbeService.scriptConditions(resp, [
                      ...monitor.criteria.down.filter(
                          (criterion: $TSFixMe) => criterion.default !== true
                      ),
                  ])
                : { stat: false, successReasons: [], failedReasons: [] };

        // determine if monitor is degraded and reasons therefore
        const {
            stat: validDegraded,
            successReasons: degradedSuccessReasons,
            failedReasons: degradedFailedReasons,
            matchedCriterion: matchedDegradedCriterion
        }: $TSFixMe =
            monitor && monitor.criteria && monitor.criteria.degraded
                ? await ProbeService.scriptConditions(
                      resp,
                      monitor.criteria.degraded
                  )
                : { stat: false, successReasons: [], failedReasons: [] };

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
                    (criterion: $TSFixMe) => criterion.default === true
                );
            }
        }

        // update monitor to save the last matched criterion
        await MonitorService.updateCriterion(monitor._id, matchedCriterion);

        // aggregate data for logging
        data = req.body;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type '{}'.
        data.status = status;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
        data.reason = reason;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'matchedCriterion' does not exist on type... Remove this comment to see the full error message
        data.matchedCriterion = matchedCriterion;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'responseStatus' does not exist on type '... Remove this comment to see the full error message
        data.responseStatus = resp && resp.status ? resp.status : null;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'scriptMetadata' does not exist on type '... Remove this comment to see the full error message
        data.scriptMetadata = {
            executionTime: resp.executionTime,
            consoleLogs: resp.consoleLogs,
            error: resp.error,
            statusText: resp.statusText,
        };

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type '{}'.
        data.monitorId = req.params.monitorId || monitor._id;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
        data.reason =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
            data && data.reason && data.reason.length
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                ? data.reason.filter(
                      (item: $TSFixMe, pos: $TSFixMe, self: $TSFixMe) => self.indexOf(item) === pos
                  )
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'reason' does not exist on type '{}'.
                : data.reason;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'matchedUpCriterion' does not exist on ty... Remove this comment to see the full error message
        data.matchedUpCriterion =
            monitor && monitor.criteria && monitor.criteria.up;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'matchedDownCriterion' does not exist on ... Remove this comment to see the full error message
        data.matchedDownCriterion =
            monitor && monitor.criteria && monitor.criteria.down;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'matchedDegradedCriterion' does not exist... Remove this comment to see the full error message
        data.matchedDegradedCriterion =
            monitor && monitor.criteria && monitor.criteria.degraded;

        // save monitor log
        // update script run status
        const [log] = await Promise.all([
            ProbeService.saveMonitorLog(data),
            MonitorService.updateBy(
                { _id: monitor._id },
                {
                    scriptRunStatus: 'completed',
                }
            ),
        ]);

        return sendItemResponse(req, res, log);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;
