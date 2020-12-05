/**
 *
 * Copyright HackerBay, Inc.
 *
 */
const mongoose = require('../config/db');
const ProjectService = require('../services/projectService');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const ObjectID = mongoose.Types.ObjectId;
const MonitorService = require('../services/monitorService');
/* eslint-disable no-unused-vars */
module.exports = {
    // Description: Checking if user is authorized to access the page and decode jwt to get user data.
    // Params:
    // Param 1: req.headers-> {token}
    // Returns: 400: User is unauthorized since unauthorized token was present.
    isValidProjectIdAndApiKey: async function(req, res, next) {
        //get project id
        let projectId, apiKey;

        if (req.params.projectId) {
            projectId = req.params.projectId;
        } else if (req.query.projectId) {
            projectId = req.query.projectId;
        } else if (req.headers['projectId']) {
            projectId = req.headers['projectId'];
        } else if (req.body.projectId) {
            projectId = req.body.projectId;
        } else {
            if (res) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Project ID not found.',
                });
            } else {
                return false;
            }
        }

        if (req.query.apiKey) {
            apiKey = req.query.apiKey;
        } else if (req.headers.apikey) {
            apiKey = req.headers.apikey;
        } else if (req.body.apiKey) {
            apiKey = req.body.apiKey;
        } else {
            if (res) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'API Key not found.',
                });
            } else {
                return false;
            }
        }

        const project = await ProjectService.findOneBy({
            _id: projectId,
            apiKey: apiKey,
        });
        if (project) {
            req.authorizationType = 'API';

            //set user Id to API.

            req.user = {};
            req.user.id = 'API';

            if (next) next();
            else return true;
        } else {
            if (res) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message:
                        'No Project found with this API Key and Project ID.',
                });
            } else {
                return false;
            }
        }
    },

    isValidProjectId: function(projectId) {
        if (!ObjectID.isValid(projectId)) {
            return false;
        }
        return true;
    },
    hasAPIKey: function(req) {
        let apiKey;
        if (req.query.apiKey) {
            apiKey = req.query.apiKey;
        } else if (req.headers.apikey || req.headers.apiKey) {
            apiKey = req.headers.apikey;
        } else if (req.body.apiKey) {
            apiKey = req.body.apiKey;
        } else {
            return false;
        }

        return true;
    },

    getProjectId: function(req, res) {
        // Get Project Id, If Available
        let projectId;

        if (req.params.projectId) {
            projectId = req.params.projectId;
        } else if (req.query.projectId) {
            projectId = req.query.projectId;
        } else if (req.headers['projectId']) {
            projectId = req.headers['projectId'];
        } else if (req.body.projectId) {
            projectId = req.body.projectId;
        } else {
            return null;
        }

        return projectId;
    },
    isValidMonitor: async function(req, res, next) {
        const id = req.params.id;
        const monitor = await MonitorService.findBy({
            type: 'incomingHttpRequest',
            'data.link': `${global.apiHost}/incomingHttpRequest/${id}`,
        });
        if (monitor && monitor.length) {
            req.monitor = monitor && monitor[0] ? monitor[0] : monitor;
            next();
        } else {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'No Monitor found with this ID.',
            });
        }
    },
};
