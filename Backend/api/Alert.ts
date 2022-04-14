import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import alertService from '../services/alertService';
import IncidentService from '../services/incidentService';
import alertChargeService from '../services/alertChargeService';
import path from 'path';
import fs from 'fs';

const router: $TSFixMe = express.getRouter();

import { isAuthorized } from '../middlewares/authorization';
const getUser: $TSFixMe = require('../middlewares/user').getUser;
const getSubProjects: $TSFixMe =
    require('../middlewares/subProject').getSubProjects;
const isUserOwner: $TSFixMe = require('../middlewares/project').isUserOwner;

import {
    sendErrorResponse,
    sendListResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

router.post(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId: $TSFixMe = req.params.projectId;

            const userId: $TSFixMe = req.user.id;
            const data: $TSFixMe = req.body;
            data.projectId = projectId;
            const alert: $TSFixMe = await alertService.create({
                projectId,
                monitorId: data.monitorId,
                alertVia: data.alertVia,
                userId: userId,
                incidentId: data.incidentId,
                eventType: data.eventType,
            });
            return sendItemResponse(req, res, alert);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Fetch alerts by projectId
router.get(
    '/:projectId',
    getUser,
    isAuthorized,
    getSubProjects,
    async (req, res): void => {
        try {
            const subProjectIds: $TSFixMe = req.user.subProjects
                ? req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;
            const alerts: $TSFixMe = await alertService.getSubProjectAlerts(
                subProjectIds
            );
            return sendItemResponse(req, res, alerts); // frontend expects sendItemResponse
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/alert',
    getUser,
    isAuthorized,
    async (req, res): void => {
        try {
            const projectId: $TSFixMe = req.params.projectId;
            const populateAlert: $TSFixMe = [
                { path: 'userId', select: 'name' },
                { path: 'monitorId', select: 'name' },
                { path: 'projectId', select: 'name' },
            ];

            const selectColumns: $TSFixMe =
                '_id projectId userId alertVia alertStatus eventType monitorId createdAt incidentId onCallScheduleStatus schedule escalation error errorMessage alertProgress deleted deletedAt deletedById';

            const [alerts, count]: $TSFixMe = await Promise.all([
                alertService.findBy({
                    query: { projectId },
                    skip: req.query['skip'] || 0,
                    limit: req.query['limit'] || 10,
                    populate: populateAlert,
                    select: selectColumns,
                }),
                alertService.countBy({ projectId }),
            ]);
            return sendListResponse(req, res, alerts, count); // frontend expects sendListResponse
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/incident/:incidentSlug',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const incidentSlug: $TSFixMe = req.params.incidentSlug;
            // const projectId: $TSFixMe = req.params.projectId;
            let incidentId = await IncidentService.findOneBy({
                // query: { projectId, slug: incidentSlug },
                query: { slug: incidentSlug },
                select: '_id',
            });
            const skip: $TSFixMe = req.query['skip'] || 0;
            const limit: $TSFixMe = req.query['limit'] || 10;

            let alerts = [],
                count = 0;
            if (incidentId) {
                incidentId = incidentId._id;
                const populateAlert: $TSFixMe = [
                    { path: 'userId', select: 'name email' },
                    { path: 'monitorId', select: 'name' },
                    { path: 'projectId', select: 'name' },
                ];

                const selectColumns: $TSFixMe =
                    '_id projectId userId alertVia alertStatus eventType monitorId createdAt incidentId onCallScheduleStatus schedule escalation error errorMessage alertProgress deleted deletedAt deletedById';

                const [allAlerts, allCount]: $TSFixMe = await Promise.all([
                    alertService.findBy({
                        query: { incidentId: incidentId },
                        skip,
                        limit,
                        populate: populateAlert,
                        select: selectColumns,
                    }),
                    alertService.countBy({
                        incidentId: incidentId,
                    }),
                ]);

                alerts = allAlerts;
                count = allCount;
            }
            return sendListResponse(req, res, alerts, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Mark alert as viewed. This is for Email.
router.get(
    '/:projectId/:alertId/viewed',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const alertId: $TSFixMe = req.params.alertId;
            const projectId: $TSFixMe = req.params.projectId;
            await alertService.updateOneBy(
                { _id: alertId, projectId: projectId },
                { alertStatus: 'Viewed' }
            );
            const filePath: $TSFixMe = path.join(
                __dirname,
                '..',
                '..',
                'views',
                'img',
                'vou-wb.png'
            );
            const img: $TSFixMe = fs.readFileSync(filePath);

            res.set('Content-Type', 'image/png');
            res.status(200);
            res.end(img, 'binary');
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:projectId',
    getUser,
    isUserOwner,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId: $TSFixMe = req.params.projectId;

            const userId: $TSFixMe = req.user.id;
            const alert: $TSFixMe = await alertService.deleteBy(
                { projectId: projectId },
                userId
            );
            if (!alert) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Alert not found',
                });
            }
            return sendItemResponse(req, res, alert);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/alert/charges',
    getUser,
    isAuthorized,
    async (req, res): void => {
        try {
            const projectId: $TSFixMe = req.params.projectId;

            //Important! Always pass required field(s)
            const populate: $TSFixMe = [
                { path: 'alertId', select: 'alertVia' },
                { path: 'subscriberAlertId', select: 'alertVia' },
                { path: 'monitorId', select: 'name slug' },
                { path: 'incidentId', select: 'idNumber slug' },
            ];

            const select: $TSFixMe =
                'alertId subscriberAlertId monitorId incidentId closingAccountBalance chargeAmount';

            const [alertCharges, count]: $TSFixMe = await Promise.all([
                alertChargeService.findBy({
                    query: { projectId },
                    skip: req.query['skip'],
                    limit: req.query['limit'],
                    sort: false,
                    populate,
                    select,
                }),
                alertChargeService.countBy({ projectId }),
            ]);
            return sendListResponse(req, res, alertCharges, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
