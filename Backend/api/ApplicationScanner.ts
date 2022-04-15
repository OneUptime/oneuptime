import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import ApplicationSecurityService from '../services/applicationSecurityService';
import ApplicationSecurityLogService from '../services//applicationSecurityLogService';
const router: $TSFixMe = express.getRouter();
const isAuthorizedApplicationScanner: $TSFixMe =
    require('../middlewares/applicationScannerAuthorization').isAuthorizedApplicationScanner;
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import RealtimeService from '../services/realTimeService';
import MailService from '../services/mailService';
import UserService from '../services/userService';
import ProjectService from '../services/projectService';
// Route
// Description: Updating profile setting.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.files-> {profilePic};
// Returns: 200: Success, 400: Error; 500: Server Error.

router.get(
    '/applicationSecurities',
    isAuthorizedApplicationScanner,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const response: $TSFixMe =
                await ApplicationSecurityService.getSecuritiesToScan();
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/scanning',
    isAuthorizedApplicationScanner,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const security: $TSFixMe = req.body.security;
            const applicationSecurity: $TSFixMe =
                await ApplicationSecurityService.updateOneBy(
                    {
                        _id: security._id,
                    },
                    { scanning: true }
                );

            RealtimeService.handleScanning({
                security: applicationSecurity,
            });

            return sendItemResponse(req, res, applicationSecurity);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);
router.post(
    '/failed',
    isAuthorizedApplicationScanner,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const security: $TSFixMe = req.body;
            const applicationSecurity: $TSFixMe =
                await ApplicationSecurityService.updateOneBy(
                    {
                        _id: security._id,
                    },
                    { scanning: false }
                );
            return sendItemResponse(req, res, applicationSecurity);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);
router.post(
    '/log',
    isAuthorizedApplicationScanner,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const security: $TSFixMe = req.body;
            const securityLog: $TSFixMe =
                await ApplicationSecurityLogService.create({
                    securityId: security.securityId,
                    componentId: security.componentId,
                    data: security.data,
                });

            const populateApplicationSecurityLog: $TSFixMe = [
                { path: 'componentId', select: '_id slug name slug projectId' },
                {
                    path: 'securityId',
                    select: '_id slug name slug gitRepositoryUrl gitCredential componentId resourceCategory deleted deletedAt lastScan scanned scanning',
                },
            ];

            const selectApplicationSecurityLog: $TSFixMe =
                '_id securityId componentId data';

            const findLog: $TSFixMe =
                await ApplicationSecurityLogService.findOneBy({
                    query: { _id: securityLog._id },
                    populate: populateApplicationSecurityLog,
                    select: selectApplicationSecurityLog,
                });

            const project: $TSFixMe = await ProjectService.findOneBy({
                query: { _id: findLog.componentId.projectId },
                select: '_id name users',
            });

            const userIds: $TSFixMe = project.users
                .filter((e: $TSFixMe) => {
                    return e.role !== 'Viewer';
                })
                .map((e: $TSFixMe) => {
                    return {
                        id: e.userId,
                    };
                }); // This cater for projects with multiple registered members

            project.critical = findLog.data.vulnerabilities.critical;

            project.high = findLog.data.vulnerabilities.high;

            project.moderate = findLog.data.vulnerabilities.moderate;

            project.low = findLog.data.vulnerabilities.low;

            const critical: $TSFixMe = findLog.data.advisories
                .filter((e: $TSFixMe) => {
                    return e.severity === 'critical';
                })
                .slice(0, 10);

            const high: $TSFixMe = findLog.data.advisories
                .filter((e: $TSFixMe) => {
                    return e.severity === 'high';
                })
                .slice(0, 10);

            const moderate: $TSFixMe = findLog.data.advisories
                .filter((e: $TSFixMe) => {
                    return e.severity === 'moderate';
                })
                .slice(0, 10);

            const low: $TSFixMe = findLog.data.advisories
                .filter((e: $TSFixMe) => {
                    return e.severity === 'low';
                })
                .slice(0, 10);
            const criticalWithTitle: $TSFixMe = critical.map(
                (advisories: $TSFixMe) => {
                    const filter: $TSFixMe = advisories.via.filter(
                        (e: $TSFixMe) => {
                            return e.severity === advisories.severity;
                        }
                    );
                    let filterBySeverity: $TSFixMe;
                    let filterByTitle: $TSFixMe;
                    //This is used to get the library name and description
                    if (filter.length > 0) {
                        filterBySeverity = advisories.via.find(
                            (e: $TSFixMe) => {
                                return e.severity === advisories.severity;
                            }
                        ).severity;
                        filterByTitle = advisories.via.find((e: $TSFixMe) => {
                            return e.severity === advisories.severity;
                        }).title;
                    } else {
                        filterBySeverity = 'Nil';
                        filterByTitle = 'Nil';
                    }
                    advisories.severity === filterBySeverity
                        ? (advisories.title = filterByTitle)
                        : (advisories.title = 'Nil');
                    return advisories;
                }
            );
            const highWithTitle: $TSFixMe = high.map((advisories: $TSFixMe) => {
                const filter: $TSFixMe = advisories.via.filter(
                    (e: $TSFixMe) => {
                        return e.severity === advisories.severity;
                    }
                );
                let filterBySeverity: $TSFixMe;
                let filterByTitle: $TSFixMe;
                //This is used to get the library name and description
                if (filter.length > 0) {
                    filterBySeverity = advisories.via.find((e: $TSFixMe) => {
                        return e.severity === advisories.severity;
                    }).severity;
                    filterByTitle = advisories.via.find((e: $TSFixMe) => {
                        return e.severity === advisories.severity;
                    }).title;
                } else {
                    filterBySeverity = 'Nil';
                    filterByTitle = 'Nil';
                }

                advisories.severity === filterBySeverity
                    ? (advisories.title = filterByTitle)
                    : (advisories.title = 'Nil');
                return advisories;
            });
            const moderateWithTitle: $TSFixMe = moderate.map(
                (advisories: $TSFixMe) => {
                    const filter: $TSFixMe = advisories.via.filter(
                        (e: $TSFixMe) => {
                            return e.severity === advisories.severity;
                        }
                    );
                    let filterBySeverity: $TSFixMe;
                    let filterByTitle: $TSFixMe;
                    //This is used to get the library name and description
                    if (filter.length > 0) {
                        filterBySeverity = advisories.via.find(
                            (e: $TSFixMe) => {
                                return e.severity === advisories.severity;
                            }
                        ).severity;
                        filterByTitle = advisories.via.find((e: $TSFixMe) => {
                            return e.severity === advisories.severity;
                        }).title;
                    } else {
                        filterBySeverity = 'Nil';
                        filterByTitle = 'Nil';
                    }

                    advisories.severity === filterBySeverity
                        ? (advisories.title = filterByTitle)
                        : (advisories.title = 'Nil');
                    return advisories;
                }
            );
            const lowWithTitle: $TSFixMe = low.map((advisories: $TSFixMe) => {
                const filter: $TSFixMe = advisories.via.filter(
                    (e: $TSFixMe) => {
                        return e.severity === advisories.severity;
                    }
                );
                let filterBySeverity: $TSFixMe;
                let filterByTitle: $TSFixMe;
                //This is used to get the library name and description
                if (filter.length > 0) {
                    filterBySeverity = advisories.via.find((e: $TSFixMe) => {
                        return e.severity === advisories.severity;
                    }).severity;
                    filterByTitle = advisories.via.find((e: $TSFixMe) => {
                        return e.severity === advisories.severity;
                    }).title;
                } else {
                    filterBySeverity = 'Nil';
                    filterByTitle = 'Nil';
                }

                advisories.severity === filterBySeverity
                    ? (advisories.title = filterByTitle)
                    : (advisories.title = 'Nil');
                return advisories;
            });

            project.criticalIssues = criticalWithTitle;
            project.highIssues = highWithTitle;
            project.moderateIssues = moderateWithTitle;
            project.lowIssues = lowWithTitle;

            for (let i: $TSFixMe = 0; i < userIds.length; i++) {
                const userId: $TSFixMe = userIds[i].id;
                const user: $TSFixMe = await UserService.findOneBy({
                    query: { _id: userId },
                    select: '_id email name',
                });

                MailService.sendApplicationEmail(project, user);
            }

            RealtimeService.handleLog({
                securityId: securityLog.securityId,
                securityLog: findLog,
            });

            return sendItemResponse(req, res, securityLog);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/time',
    isAuthorizedApplicationScanner,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const security: $TSFixMe = req.body;
            const updatedTime: $TSFixMe =
                await ApplicationSecurityService.updateScanTime({
                    _id: security._id,
                });
            return sendItemResponse(req, res, updatedTime);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
