import express from 'express'
import ProbeService from '../services/probeService'
import MonitorService from '../services/monitorService'
import LighthouseLogService from '../services/lighthouseLogService'
const router = express.Router();
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const {
    isAuthorizedLighthouse,
} = require('../middlewares/lighthouseAuthorization');
import MailService from '../services/mailService'
import UserService from '../services/userService'
import ProjectService from '../services/projectService'
import ErrorService from 'common-server/utils/error'

// Route
// Description: Updating profile setting.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.files-> {profilePic};
// Returns: 200: Success, 400: Error; 500: Server Error.

router.get('/monitors', isAuthorizedLighthouse, async function(req, res) {
    try {
        const monitors = await MonitorService.getUrlMonitorsNotScannedByLightHouseInPastOneDay();

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

router.post('/ping/:monitorId', isAuthorizedLighthouse, async function(
    req,
    response
) {
    try {
        const { monitor, resp } = req.body;

        let log,
            data = {};

        data = req.body;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'lighthouseScanStatus' does not exist on ... Remove this comment to see the full error message
        data.lighthouseScanStatus =
            resp && resp.lighthouseScanStatus
                ? resp.lighthouseScanStatus
                : null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'performance' does not exist on type '{}'... Remove this comment to see the full error message
        data.performance = resp && resp.performance ? resp.performance : null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'accessibility' does not exist on type '{... Remove this comment to see the full error message
        data.accessibility =
            resp && resp.accessibility ? resp.accessibility : null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'bestPractices' does not exist on type '{... Remove this comment to see the full error message
        data.bestPractices =
            resp && resp.bestPractices ? resp.bestPractices : null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'seo' does not exist on type '{}'.
        data.seo = resp && resp.seo ? resp.seo : null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'pwa' does not exist on type '{}'.
        data.pwa = resp && resp.pwa ? resp.pwa : null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'lighthouseData' does not exist on type '... Remove this comment to see the full error message
        data.lighthouseData =
            resp && resp.lighthouseData ? resp.lighthouseData : null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type '{}'.
        data.monitorId = req.params.monitorId || monitor._id;
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: {}; select: string; }' ... Remove this comment to see the full error message
        const probeId = await ProbeService.findBy({ query: {}, select: '_id' });
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeId' does not exist on type '{}'.
        data.probeId = probeId ? probeId[0]._id : null;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'lighthouseScanStatus' does not exist on ... Remove this comment to see the full error message
        if (data.lighthouseScanStatus === 'scanning') {
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await MonitorService.updateLighthouseScanStatus(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type '{}'.
                data.monitorId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'lighthouseScanStatus' does not exist on ... Remove this comment to see the full error message
                data.lighthouseScanStatus
            );

            await LighthouseLogService.updateAllLighthouseLogs(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type '{}'.
                data.monitor.projectId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type '{}'.
                data.monitorId,
                {
                    scanning: true,
                }
            );
        } else {
            await MonitorService.updateLighthouseScanStatus(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type '{}'.
                data.monitorId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'lighthouseScanStatus' does not exist on ... Remove this comment to see the full error message
                data.lighthouseScanStatus,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeId' does not exist on type '{}'.
                data.probeId
            );

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'lighthouseData' does not exist on type '... Remove this comment to see the full error message
            if (data.lighthouseData) {
                // The scanned results are published
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'scanning' does not exist on type '{}'.
                data.scanning = false;
                log = await ProbeService.saveLighthouseLog(data);

                /* For Email Service */
                // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { _id: any; }; select: ... Remove this comment to see the full error message
                const project = await ProjectService.findOneBy({
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type '{}'.
                    query: { _id: data.monitor.projectId },
                    select: '_id name users',
                });
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type '{}'.
                project.monitor = data.monitor.name;
                const userIds = project.users
                    .filter((e: $TSFixMe) => e.role !== 'Viewer')
                    .map((e: $TSFixMe) => ({
                    id: e.userId
                })); // This cater for projects with multiple registered members
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'performance' does not exist on type '{}'... Remove this comment to see the full error message
                const performance = data.performance;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'accessibility' does not exist on type '{... Remove this comment to see the full error message
                const accessibility = data.accessibility;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'bestPractices' does not exist on type '{... Remove this comment to see the full error message
                const bestPractices = data.bestPractices;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'seo' does not exist on type '{}'.
                const seo = data.seo;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'pwa' does not exist on type '{}'.
                const pwa = data.pwa;

                // @ts-expect-error ts-migrate(2339) FIXME: Property 'lighthouseData' does not exist on type '... Remove this comment to see the full error message
                const performanceIssues = data.lighthouseData.issues.performance
                    .slice(0, 10)
                    .map((desc: $TSFixMe) => {
                        const splitDescription = desc.description.split(
                            /\[Learn more\]/i
                        );
                        const url = splitDescription[1]
                            ? splitDescription[1].replace(/^\(|\)|\.$/gi, '')
                            : '';
                        desc.description = splitDescription[0];
                        desc.url = url;

                        return desc;
                    });

                // @ts-expect-error ts-migrate(2339) FIXME: Property 'lighthouseData' does not exist on type '... Remove this comment to see the full error message
                const accessibilityIssues = data.lighthouseData.issues.accessibility
                    .slice(0, 10)
                    .map((desc: $TSFixMe) => {
                        const splitDescription = desc.description.split(
                            /\[Learn more\]/i
                        );
                        const url = splitDescription[1]
                            ? splitDescription[1].replace(/^\(|\)|\.$/gi, '')
                            : '';
                        desc.description = splitDescription[0];
                        desc.url = url;

                        return desc;
                    });

                // @ts-expect-error ts-migrate(2339) FIXME: Property 'lighthouseData' does not exist on type '... Remove this comment to see the full error message
                const bestPracticesIssues = data.lighthouseData.issues[
                    'best-practices'
                ]
                    .slice(0, 10)
                    .map((desc: $TSFixMe) => {
                        const splitDescription = desc.description.split(
                            /\[Learn more\]/i
                        );
                        const url = splitDescription[1]
                            ? splitDescription[1].replace(/^\(|\)|\.$/gi, '')
                            : '';
                        desc.description = splitDescription[0];
                        desc.url = url;

                        return desc;
                    });

                // @ts-expect-error ts-migrate(2339) FIXME: Property 'lighthouseData' does not exist on type '... Remove this comment to see the full error message
                const seoIssues = data.lighthouseData.issues.seo
                    .slice(0, 10)
                    .map((desc: $TSFixMe) => {
                        const splitDescription = desc.description.split(
                            /\[Learn more\]/i
                        );
                        const url = splitDescription[1]
                            ? splitDescription[1].replace(/^\(|\)|\.$/gi, '')
                            : '';
                        desc.description = splitDescription[0];
                        desc.url = url;

                        return desc;
                    });
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'lighthouseData' does not exist on type '... Remove this comment to see the full error message
                const pwaIssues = data.lighthouseData.issues.pwa
                    .slice(0, 10)
                    .map((desc: $TSFixMe) => {
                        const splitDescription = desc.description.split(
                            /\[Learn more\]/i
                        );
                        const url = splitDescription[1]
                            ? splitDescription[1].replace(/^\(|\)|\.$/gi, '')
                            : '';
                        desc.description = splitDescription[0];
                        desc.url = url;

                        return desc;
                    });

                project.performance = performance;
                project.accessibility = accessibility;
                project.bestPractices = bestPractices;
                project.seo = seo;
                project.pwa = pwa;

                project.performanceIssues = performanceIssues;
                project.accessibilityIssues = accessibilityIssues;
                project.bestPracticesIssues = bestPracticesIssues;
                project.seoIssues = seoIssues;
                project.pwaIssues = pwaIssues;

                for (let i = 0; i < userIds.length; i++) {
                    const userId = userIds[i].id;
                    const user = await UserService.findOneBy({
                        query: { _id: userId },
                        select: '_id email name',
                    });
                    try {
                        MailService.sendLighthouseEmail(project, user);
                    } catch (error) {
                        ErrorService.log(
                            'mailservice.sendLighthouseEmail',
                            error
                        );
                    }
                }
            }
        }
        return sendItemResponse(req, response, log);
    } catch (error) {
        return sendErrorResponse(req, response, error);
    }
});

export default router;
