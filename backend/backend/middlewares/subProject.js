var ProjectService = require('../services/projectService');
var ErrorService = require('../services/errorService');
var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var url = require('url');

module.exports = {
    // Description: Get subprojects which user belongs to.
    getSubProjects: async function (req, res, next) {
        try {
            let userId = req.user ? req.user.id : null || url.parse(req.url, true).query.userId;
    
            let projectId = req.params.projectId || req.body.projectId || url.parse(req.url, true).query.projectId;
    
            req.user.subProjects = null;
    
            //sanitize
            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code:400,
                    message:'Project id is not present.'
                });
            }
    
            // Fetch user subprojects
            var subProjects = await ProjectService.findBy({$or: [{parentProjectId: projectId, 'users.userId': userId}, {_id: projectId, 'users.userId': userId}]});
            if (subProjects.length > 0) {
                req.user.subProjects = subProjects;
                next();
            } else {
                return sendErrorResponse(req, res, {
                    code:400,
                    message:'You are not present in any subProject.'
                });
            }
        } catch (error) {
            ErrorService.log('ProjectService.findBy', error);
            return sendErrorResponse(req, res, {
                code:400,
                message:'Bad request to server'
            });
        }
    }
};