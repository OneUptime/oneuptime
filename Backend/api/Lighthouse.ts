import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import ProbeService from '../services/probeService';
import MonitorService from '../services/monitorService';
import LighthouseLogService from '../services/lighthouseLogService';
const router: $TSFixMe = express.getRouter();
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import { sendListResponse } from 'CommonServer/Utils/response';
const {
    isAuthorizedLighthouse,
} = require('../middlewares/lighthouseAuthorization');
import MailService from '../services/mailService';
import UserService from '../services/userService';
import ProjectService from '../services/projectService';
import ErrorService from 'CommonServer/Utils/error';

// Route
// Description: Updating profile setting.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.files-> {profilePic};
// Returns: 200: Success, 400: Error; 500: Server Error.

router.get(
    '/monitors',
    isAuthorizedLighthouse,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const monitors: $TSFixMe =
                await MonitorService.getUrlMonitorsNotScannedByLightHouseInPastOneDay();

            return sendListResponse(
                req,
                res,
                JSON.stringify(monitors),
                monitors.length
            );
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/ping/:monitorId',
    isAuthorizedLighthouse,
    async (req: $TSFixMe, response: $TSFixMe): void => {
        try {
            const { monitor, resp }: $TSFixMe = req.body;

            let log: $TSFixMe,
                data: $TSFixMe = {};

            data = req.body;

            data.lighthouseScanStatus =
                resp && resp.lighthouseScanStatus
                    ? resp.lighthouseScanStatus
                    : null;

            data.performance =
                resp && resp.performance ? resp.performance : null;

            data.accessibility =
                resp && resp.accessibility ? resp.accessibility : null;

            data.bestPractices =
                resp && resp.bestPractices ? resp.bestPractices : null;

            data.seo = resp && resp.seo ? resp.seo : null;

            data.pwa = resp && resp.pwa ? resp.pwa : null;

            data.lighthouseData =
                resp && resp.lighthouseData ? resp.lighthouseData : null;

            data.monitorId = req.params.monitorId || monitor._id;

            const probeId: $TSFixMe = await ProbeService.findBy({
                query: {},
                select: '_id',
            });

            data.probeId = probeId ? probeId[0]._id : null;

            if (data.lighthouseScanStatus === 'scanning') {
                await MonitorService.updateLighthouseScanStatus(
                    data.monitorId,

                    data.lighthouseScanStatus
                );

                await LighthouseLogService.updateAllLighthouseLogs(
                    data.monitor.projectId,

                    data.monitorId,
                    {
                        scanning: true,
                    }
                );
            } else {
                await MonitorService.updateLighthouseScanStatus(
                    data.monitorId,

                    data.lighthouseScanStatus,

                    data.probeId
                );

                if (data.lighthouseData) {
                    // The scanned results are published

                    data.scanning = false;
                    log = await ProbeService.saveLighthouseLog(data);

                    /* For Email Service */

                    const project: $TSFixMe = await ProjectService.findOneBy({
                        query: { _id: data.monitor.projectId },
                        select: '_id name users',
                    });

                    project.monitor = data.monitor.name;
                    const userIds: $TSFixMe = project.users
                        .filter((e: $TSFixMe) => {
                            return e.role !== 'Viewer';
                        })
                        .map((e: $TSFixMe) => {
                            return {
                                id: e.userId,
                            };
                        }); // This cater for projects with multiple registered members

                    const performance: $TSFixMe = data.performance;

                    const accessibility: $TSFixMe = data.accessibility;

                    const bestPractices: $TSFixMe = data.bestPractices;

                    const seo: $TSFixMe = data.seo;

                    const pwa: $TSFixMe = data.pwa;

                    const performanceIssues: $TSFixMe =
                        data.lighthouseData.issues.performance
                            .slice(0, 10)
                            .map((desc: $TSFixMe) => {
                                const splitDescription: $TSFixMe =
                                    desc.description.split(/\[Learn more\]/i);
                                const url: $TSFixMe = splitDescription[1]
                                    ? splitDescription[1].replace(
                                          /^\(|\)|\.$/gi,
                                          ''
                                      )
                                    : '';
                                desc.description = splitDescription[0];
                                desc.url = url;

                                return desc;
                            });

                    const accessibilityIssues: $TSFixMe =
                        data.lighthouseData.issues.accessibility
                            .slice(0, 10)
                            .map((desc: $TSFixMe) => {
                                const splitDescription: $TSFixMe =
                                    desc.description.split(/\[Learn more\]/i);
                                const url: $TSFixMe = splitDescription[1]
                                    ? splitDescription[1].replace(
                                          /^\(|\)|\.$/gi,
                                          ''
                                      )
                                    : '';
                                desc.description = splitDescription[0];
                                desc.url = url;

                                return desc;
                            });

                    const bestPracticesIssues: $TSFixMe =
                        data.lighthouseData.issues['best-practices']
                            .slice(0, 10)
                            .map((desc: $TSFixMe) => {
                                const splitDescription: $TSFixMe =
                                    desc.description.split(/\[Learn more\]/i);
                                const url: $TSFixMe = splitDescription[1]
                                    ? splitDescription[1].replace(
                                          /^\(|\)|\.$/gi,
                                          ''
                                      )
                                    : '';
                                desc.description = splitDescription[0];
                                desc.url = url;

                                return desc;
                            });

                    const seoIssues: $TSFixMe = data.lighthouseData.issues.seo
                        .slice(0, 10)
                        .map((desc: $TSFixMe) => {
                            const splitDescription: $TSFixMe =
                                desc.description.split(/\[Learn more\]/i);
                            const url: $TSFixMe = splitDescription[1]
                                ? splitDescription[1].replace(
                                      /^\(|\)|\.$/gi,
                                      ''
                                  )
                                : '';
                            desc.description = splitDescription[0];
                            desc.url = url;

                            return desc;
                        });

                    const pwaIssues: $TSFixMe = data.lighthouseData.issues.pwa
                        .slice(0, 10)
                        .map((desc: $TSFixMe) => {
                            const splitDescription: $TSFixMe =
                                desc.description.split(/\[Learn more\]/i);
                            const url: $TSFixMe = splitDescription[1]
                                ? splitDescription[1].replace(
                                      /^\(|\)|\.$/gi,
                                      ''
                                  )
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

                    for (let i: $TSFixMe = 0; i < userIds.length; i++) {
                        const userId: $TSFixMe = userIds[i].id;
                        const user: $TSFixMe = await UserService.findOneBy({
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
    }
);

export default router;
