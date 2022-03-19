import express, { Request, Response } from 'common-server/utils/express';
import ApplicationSecurityService from '../services/applicationSecurityService';
import ApplicationSecurityLogService from '../services//applicationSecurityLogService';
const router = express.getRouter();
const isAuthorizedApplicationScanner =
    require('../middlewares/applicationScannerAuthorization').isAuthorizedApplicationScanner;
import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';

import RealtimeService from '../services/realTimeService';
import MailService from '../services/mailService';
import UserService from '../services/userService';
import ProjectService from '../services/projectService';
import ErrorService from 'common-server/utils/error';

// Route
// Description: Updating profile setting.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.files-> {profilePic};
// Returns: 200: Success, 400: Error; 500: Server Error.

router.get(
    '/applicationSecurities',
    isAuthorizedApplicationScanner,
    async function (req: Request, res: Response) {
        try {
            const response =
                await ApplicationSecurityService.getSecuritiesToScan();
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post(
    '/scanning',
    isAuthorizedApplicationScanner,
    async function (req, res) {
        try {
            const security = req.body.security;
            const applicationSecurity =
                await ApplicationSecurityService.updateOneBy(
                    {
                        _id: security._id,
                    },
                    { scanning: true }
                );

            try {
                RealtimeService.handleScanning({
                    security: applicationSecurity,
                });
            } catch (error) {
                ErrorService.log('realtimeService.handleScanning', error);
            }
            return sendItemResponse(req, res, applicationSecurity);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);
router.post(
    '/failed',
    isAuthorizedApplicationScanner,
    async function (req, res) {
        try {
            const security = req.body;
            const applicationSecurity =
                await ApplicationSecurityService.updateOneBy(
                    {
                        _id: security._id,
                    },
                    { scanning: false }
                );
            return sendItemResponse(req, res, applicationSecurity);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);
router.post(
    '/log',
    isAuthorizedApplicationScanner,
    async function (req: Request, res: Response) {
        try {
            const security = req.body;
            const securityLog = await ApplicationSecurityLogService.create({
                securityId: security.securityId,
                componentId: security.componentId,
                data: security.data,
            });

            const populateApplicationSecurityLog = [
                { path: 'componentId', select: '_id slug name slug projectId' },
                {
                    path: 'securityId',
                    select: '_id slug name slug gitRepositoryUrl gitCredential componentId resourceCategory deleted deletedAt lastScan scanned scanning',
                },
            ];

            const selectApplicationSecurityLog =
                '_id securityId componentId data';

            const findLog = await ApplicationSecurityLogService.findOneBy({
                query: { _id: securityLog._id },
                populate: populateApplicationSecurityLog,
                select: selectApplicationSecurityLog,
            });

            const project = await ProjectService.findOneBy({
                query: { _id: findLog.componentId.projectId },
                select: '_id name users',
            });

            const userIds = project.users
                .filter((e: $TSFixMe) => e.role !== 'Viewer')
                .map((e: $TSFixMe) => ({
                    id: e.userId,
                })); // This cater for projects with multiple registered members

            project.critical = findLog.data.vulnerabilities.critical;

            project.high = findLog.data.vulnerabilities.high;

            project.moderate = findLog.data.vulnerabilities.moderate;

            project.low = findLog.data.vulnerabilities.low;

            const critical = findLog.data.advisories
                .filter((e: $TSFixMe) => e.severity === 'critical')
                .slice(0, 10);

            const high = findLog.data.advisories
                .filter((e: $TSFixMe) => e.severity === 'high')
                .slice(0, 10);

            const moderate = findLog.data.advisories
                .filter((e: $TSFixMe) => e.severity === 'moderate')
                .slice(0, 10);

            const low = findLog.data.advisories
                .filter((e: $TSFixMe) => e.severity === 'low')
                .slice(0, 10);
            const criticalWithTitle = critical.map((advisories: $TSFixMe) => {
                const filter = advisories.via.filter(
                    (e: $TSFixMe) => e.severity === advisories.severity
                );
                let filterBySeverity;
                let filterByTitle;
                //This is used to get the library name and description
                if (filter.length > 0) {
                    filterBySeverity = advisories.via.find(
                        (e: $TSFixMe) => e.severity === advisories.severity
                    ).severity;
                    filterByTitle = advisories.via.find(
                        (e: $TSFixMe) => e.severity === advisories.severity
                    ).title;
                } else {
                    filterBySeverity = 'Nil';
                    filterByTitle = 'Nil';
                }
                advisories.severity === filterBySeverity
                    ? (advisories.title = filterByTitle)
                    : (advisories.title = 'Nil');
                return advisories;
            });
            const highWithTitle = high.map((advisories: $TSFixMe) => {
                const filter = advisories.via.filter(
                    (e: $TSFixMe) => e.severity === advisories.severity
                );
                let filterBySeverity;
                let filterByTitle;
                //This is used to get the library name and description
                if (filter.length > 0) {
                    filterBySeverity = advisories.via.find(
                        (e: $TSFixMe) => e.severity === advisories.severity
                    ).severity;
                    filterByTitle = advisories.via.find(
                        (e: $TSFixMe) => e.severity === advisories.severity
                    ).title;
                } else {
                    filterBySeverity = 'Nil';
                    filterByTitle = 'Nil';
                }

                advisories.severity === filterBySeverity
                    ? (advisories.title = filterByTitle)
                    : (advisories.title = 'Nil');
                return advisories;
            });
            const moderateWithTitle = moderate.map((advisories: $TSFixMe) => {
                const filter = advisories.via.filter(
                    (e: $TSFixMe) => e.severity === advisories.severity
                );
                let filterBySeverity;
                let filterByTitle;
                //This is used to get the library name and description
                if (filter.length > 0) {
                    filterBySeverity = advisories.via.find(
                        (e: $TSFixMe) => e.severity === advisories.severity
                    ).severity;
                    filterByTitle = advisories.via.find(
                        (e: $TSFixMe) => e.severity === advisories.severity
                    ).title;
                } else {
                    filterBySeverity = 'Nil';
                    filterByTitle = 'Nil';
                }

                advisories.severity === filterBySeverity
                    ? (advisories.title = filterByTitle)
                    : (advisories.title = 'Nil');
                return advisories;
            });
            const lowWithTitle = low.map((advisories: $TSFixMe) => {
                const filter = advisories.via.filter(
                    (e: $TSFixMe) => e.severity === advisories.severity
                );
                let filterBySeverity;
                let filterByTitle;
                //This is used to get the library name and description
                if (filter.length > 0) {
                    filterBySeverity = advisories.via.find(
                        (e: $TSFixMe) => e.severity === advisories.severity
                    ).severity;
                    filterByTitle = advisories.via.find(
                        (e: $TSFixMe) => e.severity === advisories.severity
                    ).title;
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

            for (let i = 0; i < userIds.length; i++) {
                const userId = userIds[i].id;
                const user = await UserService.findOneBy({
                    query: { _id: userId },
                    select: '_id email name',
                });
                try {
                    MailService.sendApplicationEmail(project, user);
                } catch (error) {
                    ErrorService.log('mailService.sendApplicationEmail', error);
                }
            }

            try {
                RealtimeService.handleLog({
                    securityId: securityLog.securityId,
                    securityLog: findLog,
                });
            } catch (error) {
                ErrorService.log('realtimeService.handleLog', error);
            }
            return sendItemResponse(req, res, securityLog);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post(
    '/time',
    isAuthorizedApplicationScanner,
    async function (req: Request, res: Response) {
        try {
            const security = req.body;
            const updatedTime = await ApplicationSecurityService.updateScanTime(
                {
                    _id: security._id,
                }
            );
            return sendItemResponse(req, res, updatedTime);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

export default router;
