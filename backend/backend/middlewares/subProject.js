const ProjectService = require('../services/projectService');
const ErrorService = require('../services/errorService');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const url = require('url');

module.exports = {
    // Description: Get subprojects which user belongs to.
    getSubProjects: async function(req, res, next) {
        try {
            const userId = req.user
                ? req.user.id
                : null || url.parse(req.url, true).query.userId;

            const projectId =
                req.params.projectId ||
                req.body.projectId ||
                url.parse(req.url, true).query.projectId;

            req.user.subProjects = null;

            //sanitize
            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Project id is not present.',
                });
            }

            const query =
                userId === 'API'
                    ? {
                          $or: [
                              { parentProjectId: projectId },
                              { _id: projectId },
                          ],
                      }
                    : {
                          $or: [
                              {
                                  parentProjectId: projectId,
                                  'users.userId': userId,
                              },
                              { _id: projectId, 'users.userId': userId },
                          ],
                      };
            // Fetch user subprojects
            const subProjects = await ProjectService.findBy(query);
            if (subProjects.length > 0) {
                req.user.subProjects = subProjects;
                next();
            } else {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'You are not present in any subProject.',
                });
            }
        } catch (error) {
            ErrorService.log('subProject.getSubProjects', error);
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Bad request to server',
            });
        }
    },
};
