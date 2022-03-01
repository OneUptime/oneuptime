import express from 'express';
const router = express.Router();
import ContainerSecurityService from '../services/containerSecurityService';
import ContainerSecurityLogService from '../services//containerSecurityLogService';
const isAuthorizedContainerScanner = require('../middlewares/containerScannerAuthorization')
    .isAuthorizedContainerScanner;
import { sendErrorResponse, sendItemResponse } from 'common-server/utils/response';

import RealTimeService from '../services/realTimeService';
import MailService from '../services/mailService';
import UserService from '../services/userService';
import ProjectService from '../services/projectService';
import ErrorService from 'common-server/utils/error';

router.get('/containerSecurities', isAuthorizedContainerScanner, async function (
    req,
    res
) {
    try {
        const response = await ContainerSecurityService.getSecuritiesToScan();
        return sendItemResponse(req, res, response);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});
router.post('/scanning', isAuthorizedContainerScanner, async function (
    req,
    res
) {
    try {
        const security = req.body.security;
        const containerSecurity = await ContainerSecurityService.updateOneBy(
            {
                _id: security._id,
            },
            { scanning: true }
        );

        try {
            RealTimeService.handleScanning({ security: containerSecurity });
        } catch (error) {
            ErrorService.log('realtimeService.handleScanning', error);
        }
        return sendItemResponse(req, res, containerSecurity);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/failed', isAuthorizedContainerScanner, async function (
    req: Request,
    res: Response
) {
    try {
        const security = req.body;
        const containerSecurity = await ContainerSecurityService.updateOneBy(
            {
                _id: security._id,
            },
            { scanning: false }
        );
        return sendItemResponse(req, res, containerSecurity);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});
router.post('/log', isAuthorizedContainerScanner, async function (
    req: Request,
    res: Response
) {
    try {
        const security = req.body;
        const securityLog = await ContainerSecurityLogService.create({
            securityId: security.securityId,
            componentId: security.componentId,
            data: security.data,
        });

        const selectContainerLog =
            'securityId componentId data deleted deleteAt';

        const populateContainerLog = [
            { path: 'securityId', select: 'name slug' },
            { path: 'componentId', select: 'name slug projectId' },
        ];
        const findLog = await ContainerSecurityLogService.findOneBy({
            query: { _id: securityLog._id },
            select: selectContainerLog,
            populate: populateContainerLog,
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

        project.critical = findLog.data.vulnerabilityInfo.critical;

        project.high = findLog.data.vulnerabilityInfo.high;

        project.moderate = findLog.data.vulnerabilityInfo.moderate;

        project.low = findLog.data.vulnerabilityInfo.low;

        const critical = findLog.data.vulnerabilityData
            .filter((e: $TSFixMe) => e.severity === 'critical')
            .slice(0, 10);

        const high = findLog.data.vulnerabilityData
            .filter((e: $TSFixMe) => e.severity === 'high')
            .slice(0, 10);

        const moderate = findLog.data.vulnerabilityData
            .filter((e: $TSFixMe) => e.severity === 'moderate')
            .slice(0, 5);

        const low = findLog.data.vulnerabilityData
            .filter((e: $TSFixMe) => e.severity === 'low')
            .slice(0, 5);
        project.criticalIssues = critical;
        project.highIssues = high;
        project.moderateIssues = moderate;
        project.lowIssues = low;

        for (let i = 0; i < userIds.length; i++) {
            const userId = userIds[i].id;
            const user = await UserService.findOneBy({
                query: { _id: userId },
                select: '_id email name',
            });
            try {
                MailService.sendContainerEmail(project, user);
            } catch (error) {
                ErrorService.log('mailService.sendContainerEmail', error);
            }
        }
        try {
            RealTimeService.handleLog({
                securityId: security.securityId,
                securityLog: findLog,
            });
        } catch (error) {
            ErrorService.log('realtimeService.handleLog', error);
        }

        return sendItemResponse(req, res, findLog);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/time', isAuthorizedContainerScanner, async function (
    req: Request,
    res: Response
) {
    try {
        const security = req.body;
        const updatedTime = await ContainerSecurityService.updateScanTime({
            _id: security._id,
        });
        return sendItemResponse(req, res, updatedTime);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;
