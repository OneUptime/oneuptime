import ProjectService from '../Services/projectService';
import { sendErrorResponse } from 'CommonServer/Utils/Response';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from 'CommonServer/Utils/Express';
import MonitorService from '../Services/monitorService';

export default {
    /*
     * Description: Checking if user is authorized to access the page and decode jwt to get user data.
     * Params:
     * Param 1: req.headers-> {token}
     * Returns: 400: User is unauthorized since unauthorized token was present.
     */
    isValidProjectIdAndApiKey: async function (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): void {
        //Get project id
        let projectId: $TSFixMe, apiKey: $TSFixMe;

        if (req.params && req.params['projectId']) {
            projectId = req.params['projectId'];
        } else if (req.query && req.query['projectId']) {
            projectId = req.query['projectId'];
        } else if (
            req.headers &&
            (req.headers.projectId || req.headers.projectid)
        ) {
            // Header keys are automatically transformed to lowercase
            projectId = req.headers.projectId;
        } else if (req.body && req.body.projectId) {
            projectId = req.body.projectId;
        } else {
            if (res) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Project ID not found.',
                });
            }
            return false;
        }

        if (req.query && req.query['apiKey']) {
            apiKey = req.query['apiKey'];
        } else if (req.headers && (req.headers.apikey || req.headers.apiKey)) {
            apiKey = req.headers.apikey || req.headers.apiKey;
        } else if (req.body && req.body.apiKey) {
            apiKey = req.body.apiKey;
        } else {
            if (res) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'API Key not found.',
                });
            }
            return false;
        }

        const projectCount: $TSFixMe = await ProjectService.countBy({
            _id: projectId,
            apiKey: apiKey,
        });

        if (projectCount > 0) {
            req.authorizationType = 'API';

            //Set user Id to API.

            req.user = {};
            req.user.id = 'API';

            if (next) {
                return next();
            }
            return true;
        }
        if (res) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'No Project found with this API Key and Project ID.',
            });
        }
        return false;
    },

    isValidProjectId: function (projectId: ObjectID): void {
        if (!ObjectID.isValid(projectId)) {
            return false;
        }
        return true;
    },
    hasAPIKey: function (req: $TSFixMe): void {
        if (req.query && req.query['apiKey']) {
            return true;
        } else if (req.headers && (req.headers.apiKey || req.headers.apikey)) {
            return true;
        } else if (req.body && req.body.apiKey) {
            return true;
        }

        return false;
    },

    getProjectId: function (req: $TSFixMe): void {
        // Get Project Id, If Available
        let projectId: $TSFixMe;

        if (req.params && req.params['projectId']) {
            projectId = req.params['projectId'];
        } else if (req.query && req.query['projectId']) {
            projectId = req.query['projectId'];
        } else if (
            req.headers &&
            (req.headers.projectId || req.headers.projectid)
        ) {
            // Header keys are automatically transformed to lowercase
            projectId = req.headers.projectId || req.headers.projectid;
        } else if (req.body && req.body.projectId) {
            projectId = req.body.projectId;
        } else {
            return null;
        }

        return projectId;
    },

    getStatusPageId: function (req: $TSFixMe): void {
        const statusPageId: $TSFixMe =
            req.params?.statusPageId ||
            req.query?.statusPageId ||
            req.headers?.statuspageid ||
            req.headers?.statusPageId ||
            req.body?.statusPageId;

        return statusPageId;
    },

    getStatusPageSlug: function (req: $TSFixMe): void {
        const statusPageSlug: $TSFixMe =
            req.params?.statusPageSlug ||
            req.query?.statusPageSlug ||
            req.headers?.statuspageslug ||
            req.headers?.statusPageSlug ||
            req.body?.statusPageSlug;

        return statusPageSlug;
    },

    getStatusPageUrl: function (req: $TSFixMe): void {
        const statusPageUrl: $TSFixMe =
            req.params?.url ||
            req.query?.url ||
            req.headers?.url ||
            req.body?.url;

        return statusPageUrl;
    },

    isValidMonitor: async function (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): void {
        const id: $TSFixMe = req.params['id'];
        let monitor: $TSFixMe = await MonitorService.findBy({
            query: {
                type: 'incomingHttpRequest',

                'data.link': `${global.apiHost}/incomingHttpRequest/${id}`,
            },
            select: 'lastPingTime criteria type _id',
        });
        if (monitor && monitor.length) {
            monitor = monitor && monitor[0] ? monitor[0] : monitor;
            if (monitor && monitor.disabled) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message:
                        'Sorry this monitor is disabled. Please enable it to start monitoring again.',
                });
            }
            req.monitor = monitor;
            return next();
        }
        return sendErrorResponse(
            req,
            res,
            new BadDataException('No Monitor found with this ID.')
        );
    },
};
