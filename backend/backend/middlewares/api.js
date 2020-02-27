/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const ProjectService = require('../services/projectService');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
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
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID not found.',
            });
        }

        if (req.query.apiKey) {
            apiKey = req.query.apiKey;
        } else if (req.headers.apikey) {
            apiKey = req.headers.apikey;
        } else if (req.body.apiKey) {
            apiKey = req.body.apiKey;
        } else {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'API Key not found.',
            });
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

            next();
        } else {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'No Project found with this API Key and Project ID.',
            });
        }
    },

    hasProjectIdAndApiKey: function(req, res) {
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
            return false;
        }

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
};
