import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import ZapierService from '../services/zapierService';
import MonitorService from '../services/monitorService';
import ProjectService from '../services/projectService';

import { isAuthorized } from '../middlewares/authorization';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import { sendEmptyResponse } from 'CommonServer/Utils/response';

const router: $TSFixMe = express.getRouter();

router.get(
    '/test',
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const apiKey: $TSFixMe = req.query.apiKey;
            const projectId: $TSFixMe = req.query.projectId;
            const response: $TSFixMe = await ZapierService.test(
                projectId,
                apiKey
            );
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/monitors',
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId: $TSFixMe = req.query.projectId;

            const projects: $TSFixMe = await ProjectService.findBy({
                query: {
                    $or: [{ _id: projectId }, { parentProjectId: projectId }],
                },
                select: '_id',
            });
            const projectIds: $TSFixMe = projects.map((project: $TSFixMe) => {
                return project._id;
            });
            let monitors: $TSFixMe = await MonitorService.findBy({
                query: { projectId: { $in: projectIds } },
                select: '_id name',
            });
            if (monitors) {
                if (monitors.length) {
                    monitors = monitors.map((resp: $TSFixMe) => {
                        return { id: resp._id, name: resp.name };
                    });
                }
                return sendItemResponse(req, res, monitors); //zapier expects this as an item response and not a list response.
            } else {
                return sendItemResponse(req, res, []);
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/incident/createIncident',
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const monitors: $TSFixMe = req.body.monitors || [];
            const incident: $TSFixMe = await ZapierService.createIncident(
                monitors
            );
            return sendItemResponse(req, res, incident);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/incidents',
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId: $TSFixMe = req.query.projectId;
            // We return all the incidents to zapier because it gives user an option to configure zapier properly with all the steps.
            const incidents: $TSFixMe = await ZapierService.getIncidents(
                projectId
            );
            // zapier expects this as an item response and not a list response.
            return sendItemResponse(req, res, incidents);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/incident-note',
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId: $TSFixMe = req.query.projectId;
            // We return all the incidents to zapier because it gives user an option to configure zapier properly with all the steps.
            const incidents: $TSFixMe = await ZapierService.getIncidentsNotes(
                projectId
            );
            // zapier expects this as an item response and not a list response.
            return sendItemResponse(req, res, incidents);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/incident/incident-note',
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { data }: $TSFixMe = req.body;
            const incidentNote: $TSFixMe =
                await ZapierService.createIncidentNote(data);
            return sendItemResponse(req, res, incidentNote);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/incident/resolved',
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId: $TSFixMe = req.query.projectId;
            // We return all the incidents to zapier because it gives user an option to configure zapier properly with all the steps.
            const incidents: $TSFixMe =
                await ZapierService.getResolvedIncidents(projectId);
            // zapier expects this as an item response and not a list response.
            if (incidents) {
                return sendItemResponse(req, res, incidents);
            } else {
                return sendItemResponse(req, res, []);
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/incident/resolveLastIncident',
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const monitors: $TSFixMe = req.body.monitors || [];
            const incident: $TSFixMe = await ZapierService.resolveLastIncident(
                monitors
            );
            if (incident) {
                return sendItemResponse(req, res, incident);
            } else {
                return sendItemResponse(req, res, {});
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/incident/resolveAllIncidents',
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const monitors: $TSFixMe = req.body.monitors || [];
            const incidents: $TSFixMe = await ZapierService.resolveAllIncidents(
                monitors
            );
            // zapier expects this as an item response and not a list response.;
            if (incidents) {
                return sendItemResponse(req, res, incidents);
            } else {
                return sendItemResponse(req, res, {});
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/incident/resolveIncident',
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const incidents: $TSFixMe = req.body.incidents || [];
            const resolvedIncidents: $TSFixMe =
                await ZapierService.resolveIncident(incidents);
            // zapier expects this as an item response and not a list response.
            if (resolvedIncidents) {
                return sendItemResponse(req, res, resolvedIncidents);
            } else {
                return sendItemResponse(req, res, {});
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/incident/acknowledged',
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId: $TSFixMe = req.query.projectId;
            // We return all the incidents to zapier because it gives user an option to configure zapier properly with all the steps.
            const incidents: $TSFixMe =
                await ZapierService.getAcknowledgedIncidents(
                    projectId,

                    true,
                    false
                );
            // zapier expects this as an item response and not a list response.
            if (incidents) {
                return sendItemResponse(req, res, incidents);
            } else {
                return sendItemResponse(req, res, []);
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/incident/acknowledgeLastIncident',
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const monitors: $TSFixMe = req.body.monitors || [];
            const incident: $TSFixMe =
                await ZapierService.acknowledgeLastIncident(monitors);
            if (incident) {
                return sendItemResponse(req, res, incident);
            } else {
                return sendItemResponse(req, res, {});
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/incident/acknowledgeAllIncidents',
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const monitors: $TSFixMe = req.body.monitors || [];
            const incidents: $TSFixMe =
                await ZapierService.acknowledgeAllIncidents(monitors);
            // zapier expects this as an item response and not a list response.;
            if (incidents) {
                return sendItemResponse(req, res, incidents);
            } else {
                return sendItemResponse(req, res, {});
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/incident/acknowledgeIncident',
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const incidents: $TSFixMe = req.body.incidents || [];
            const acknowledgedIncidents: $TSFixMe =
                await ZapierService.acknowledgeIncident(incidents);
            // zapier expects this as an item response and not a list response.
            if (acknowledgedIncidents) {
                return sendItemResponse(req, res, acknowledgedIncidents);
            } else {
                return sendItemResponse(req, res, {});
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/subscribe',
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const url: $TSFixMe = req.body.url;
            const type: $TSFixMe = req.body.type;
            const monitors: $TSFixMe =
                req.body.input && req.body.input.monitors
                    ? req.body.input.monitors
                    : [];
            const projectId: $TSFixMe = req.query.projectId;
            if (!url) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message:
                        'We are not able to complete your subscription request because hookUrl is null.',
                });
            }

            if (!type) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message:
                        'We are not able to complete your subscription request because trigger type is null.',
                });
            }
            const response: $TSFixMe = await ZapierService.subscribe(
                projectId,
                url,
                type,
                monitors
            );
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/unsubscribe/:id',
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const id: $TSFixMe = req.params.id;
            await ZapierService.unsubscribe(id);
            return sendEmptyResponse(req, res);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
