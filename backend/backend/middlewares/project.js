/**
 * 
 * Copyright HackerBay, Inc. 
 * 
 */

var ProjectService = require('../services/projectService');
var ErrorService = require('../services/errorService');
var url = require('url');
var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var apiMiddleware = require('../middlewares/api');

module.exports = {
    // Description: Checks if user belongs to the project.
    //             
    // Params:
    // Param 1: req.params-> {projectId}; req.user-> {id}
    // Returns: 400: Project does not exist or User is not present in this project; 500: Server Error
    doesUserBelongToProject: async function (req, res, next) {
        // authorize if user is master-admin
        if(req.authorizationType === 'MASTER-ADMIN'){
            next();
        }else {
 
            let userId = req.user ? req.user.id : null || url.parse(req.url, true).query.userId;

            let projectId = req.params.projectId || req.body.projectId || url.parse(req.url, true).query.projectId;
            //sanitize
            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code:400,
                    message:'Project id is not present.'
                });
            }

            // Calls the ProjectService
            try{
                var project = await ProjectService.findOneBy({_id: projectId});
            }catch(error){
                ErrorService.log('ProjectService.findOneBy', error);
                return sendErrorResponse(req, res, {
                    code:400,
                    message:'Bad request to server'
                });
            }

            let isUserPresentInProject = false;

            if (project) {
                var subProjects = await ProjectService.findBy({ parentProjectId: project._id });
                var projectUsers = project.users;
                if(subProjects && subProjects.length > 0){
                    var subProjectUsers = subProjects.map(subProject => subProject.users);
                    subProjectUsers.map((users)=>{
                        projectUsers = projectUsers.concat(users);
                    });
                }
                for (let i = 0; i < projectUsers.length; i++) {
                    if (projectUsers[i].userId === userId) {
                        isUserPresentInProject = true;
                        break;
                    }
                }

            } else {
                return sendErrorResponse(req, res, {
                    code:400,
                    message:'Project does not exist.'
                });
            }

            if (isUserPresentInProject) {
                next();
            } else {
                return sendErrorResponse(req, res, {
                    code:400,
                    message:'You are not present in this project.'
                });
            }
        }
    },

    // Description: Checks if user is admin.
    //             
    // Params:
    // Param 1: req.params-> {projectId}; req.user-> {id}
    // Returns: 400: You are not authorized to add member to project. Only admin can add.; 500: Server Error
    isUserAdmin: async function (req, res, next) {

        if( apiMiddleware.hasProjectIdAndApiKey(req)){
            return apiMiddleware.isValidProjectIdAndApiKey(req, res, next);
        }

        // authorize if user is master-admin
        if(req.authorizationType === 'MASTER-ADMIN'){
            next();
        }else{
            var userId = req.user ? req.user.id : null;
            try{
                var project = await ProjectService.findOneBy({'users.userId': userId, _id: req.params.projectId});
            }catch(error){
                ErrorService.log('ProjectService.findOneBy', error);
                return sendErrorResponse(req, res, {
                    code:400,
                    message:'Bad request to server'
                });
            }
            if(project){
                let role;
                for(let user of project.users){
                    if(user.userId === userId){
                        role = user.role;
                        break;
                    }
                }
                if (role !== 'Administrator' && role !== 'Owner') {
                    return sendErrorResponse(req, res, {
                        code:400,
                        message:'You cannot edit the project because you\'re not an admin.'
                    });
                } else {
                    next();
                }
            }else{
                return sendErrorResponse(req, res, {
                    code:400,
                    message:'You\'re not authorized.'
                });
            }
        }
    },

    isUserOwner: async function (req, res, next) {
        // authorize if user is master-admin
        if(req.authorizationType === 'MASTER-ADMIN'){
            next();
        }else{
            var UserId = req.user ? req.user.id : null;
            try{
                var project = await ProjectService.findOneBy({'users.userId': UserId, _id: req.params.projectId});
            }catch(error){
                ErrorService.log('ProjectService.findOneBy', error);
                return sendErrorResponse(req, res, {
                    code: 400,
                    message:'Bad request to server'
                });
            }
            if(project){
                var role;
                for(let user of project.users){
                    if(user.userId === UserId){
                        role = user.role;
                        break;
                    }
                }
                if (role !== 'Owner') {
                    return sendErrorResponse(req, res, {
                        code:400,
                        message:'You cannot edit the project because you\'re not an owner.'
                    });
                } else {
                    next();
                }
            }else{
                return sendErrorResponse(req, res, {
                    code:400,
                    message:'You\'re not authorized.'
                });
            }
        }
    }
};