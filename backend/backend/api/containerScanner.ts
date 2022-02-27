import express from 'express';
const router = express.Router();
import ContainerSecurityService from '../services/containerSecurityService';
import ContainerSecurityLogService from '../services//containerSecurityLogService';
const isAuthorizedContainerScanner = require('../middlewares/containerScannerAuthorization')
    .isAuthorizedContainerScanner;
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
import RealTimeService from '../services/realTimeService';
import MailService from '../services/mailService';
import UserService from '../services/userService';
import ProjectService from '../services/projectService';
import ErrorService from 'common-server/utils/error';

router.get('/containerSecurities', isAuthorizedContainerScanner, async function(
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
router.post('/scanning', isAuthorizedContainerScanner, async function(
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

router.post('/failed', isAuthorizedContainerScanner, async function(req, res) {
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
router.post('/log', isAuthorizedContainerScanner, async function(req, res) {
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
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            query: { _id: securityLog._id },
            select: selectContainerLog,
            populate: populateContainerLog,
        });
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { _id: any; }; select: ... Remove this comment to see the full error message
        const project = await ProjectService.findOneBy({
            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
            query: { _id: findLog.componentId.projectId },
            select: '_id name users',
        });
        const userIds = project.users
            .filter((e: $TSFixMe) => e.role !== 'Viewer')
            .map((e: $TSFixMe) => ({
                id: e.userId,
            })); // This cater for projects with multiple registered members
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        project.critical = findLog.data.vulnerabilityInfo.critical;
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        project.high = findLog.data.vulnerabilityInfo.high;
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        project.moderate = findLog.data.vulnerabilityInfo.moderate;
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        project.low = findLog.data.vulnerabilityInfo.low;
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        const critical = findLog.data.vulnerabilityData
            .filter((e: $TSFixMe) => e.severity === 'critical')
            .slice(0, 10);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        const high = findLog.data.vulnerabilityData
            .filter((e: $TSFixMe) => e.severity === 'high')
            .slice(0, 10);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        const moderate = findLog.data.vulnerabilityData
            .filter((e: $TSFixMe) => e.severity === 'moderate')
            .slice(0, 5);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

router.post('/time', isAuthorizedContainerScanner, async function(req, res) {
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
