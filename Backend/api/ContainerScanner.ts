import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/utils/Express';
const router: ExpressRouter = Express.getRouter();
import ContainerSecurityService from '../services/containerSecurityService';
import ContainerSecurityLogService from '../services//containerSecurityLogService';
const isAuthorizedContainerScanner: $TSFixMe =
    require('../middlewares/containerScannerAuthorization').isAuthorizedContainerScanner;
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import RealTimeService from '../services/realTimeService';
import MailService from '../services/mailService';
import UserService from '../services/userService';
import ProjectService from '../services/projectService';

router.get(
    '/containerSecurities',
    isAuthorizedContainerScanner,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const response: $TSFixMe =
                await ContainerSecurityService.getSecuritiesToScan();
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);
router.post(
    '/scanning',
    isAuthorizedContainerScanner,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const security: $TSFixMe = req.body.security;
            const containerSecurity: $TSFixMe =
                await ContainerSecurityService.updateOneBy(
                    {
                        _id: security._id,
                    },
                    { scanning: true }
                );

            RealTimeService.handleScanning({ security: containerSecurity });

            return sendItemResponse(req, res, containerSecurity);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/failed',
    isAuthorizedContainerScanner,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const security: $TSFixMe = req.body;
            const containerSecurity: $TSFixMe =
                await ContainerSecurityService.updateOneBy(
                    {
                        _id: security._id,
                    },
                    { scanning: false }
                );
            return sendItemResponse(req, res, containerSecurity);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);
router.post(
    '/log',
    isAuthorizedContainerScanner,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const security: $TSFixMe = req.body;
            const securityLog: $TSFixMe =
                await ContainerSecurityLogService.create({
                    securityId: security.securityId,
                    componentId: security.componentId,
                    data: security.data,
                });

            const selectContainerLog: $TSFixMe =
                'securityId componentId data deleted deleteAt';

            const populateContainerLog: $TSFixMe = [
                { path: 'securityId', select: 'name slug' },
                { path: 'componentId', select: 'name slug projectId' },
            ];
            const findLog: $TSFixMe =
                await ContainerSecurityLogService.findOneBy({
                    query: { _id: securityLog._id },
                    select: selectContainerLog,
                    populate: populateContainerLog,
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

            project.critical = findLog.data.vulnerabilityInfo.critical;

            project.high = findLog.data.vulnerabilityInfo.high;

            project.moderate = findLog.data.vulnerabilityInfo.moderate;

            project.low = findLog.data.vulnerabilityInfo.low;

            const critical: $TSFixMe = findLog.data.vulnerabilityData
                .filter((e: $TSFixMe) => {
                    return e.severity === 'critical';
                })
                .slice(0, 10);

            const high: $TSFixMe = findLog.data.vulnerabilityData
                .filter((e: $TSFixMe) => {
                    return e.severity === 'high';
                })
                .slice(0, 10);

            const moderate: $TSFixMe = findLog.data.vulnerabilityData
                .filter((e: $TSFixMe) => {
                    return e.severity === 'moderate';
                })
                .slice(0, 5);

            const low: $TSFixMe = findLog.data.vulnerabilityData
                .filter((e: $TSFixMe) => {
                    return e.severity === 'low';
                })
                .slice(0, 5);
            project.criticalIssues = critical;
            project.highIssues = high;
            project.moderateIssues = moderate;
            project.lowIssues = low;

            for (let i: $TSFixMe = 0; i < userIds.length; i++) {
                const userId: $TSFixMe = userIds[i].id;
                const user: $TSFixMe = await UserService.findOneBy({
                    query: { _id: userId },
                    select: '_id email name',
                });

                MailService.sendContainerEmail(project, user);
            }

            RealTimeService.handleLog({
                securityId: security.securityId,
                securityLog: findLog,
            });

            return sendItemResponse(req, res, findLog);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/time',
    isAuthorizedContainerScanner,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const security: $TSFixMe = req.body;
            const updatedTime: $TSFixMe =
                await ContainerSecurityService.updateScanTime({
                    _id: security._id,
                });
            return sendItemResponse(req, res, updatedTime);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
