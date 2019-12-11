/**
 *
 * Copyright HackerBay, Inc.
 *
 */

var jwtKey = require('../config/keys');
var jwt = require('jsonwebtoken');
var url = require('url');
var UserService = require('../services/userService');
var ErrorService = require('../services/errorService');
var ProjectService = require('../services/projectService');
var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var apiMiddleware = require('../middlewares/api');

module.exports = {
    // Description: Checking if user is authorized to access the page and decode jwt to get user data.
    // Params:
    // Param 1: req.headers-> {token}
    // Returns: 400: User is unauthorized since unauthorized token was present.
    getUser: function (req, res, next) {
        try {
            if( apiMiddleware.hasProjectIdAndApiKey(req)){
                return apiMiddleware.isValidProjectIdAndApiKey(req, res, next);
            }

            const accessToken = req.headers['authorization'] || url.parse(req.url, true).query.accessToken;

            if (!accessToken) {
                return sendErrorResponse(req, res, {
                    code: 401,
                    message: 'Session Token must be present.'
                });
            }

            if (typeof accessToken !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 401,
                    message: 'Token is not of type string.'
                });
            }

            let token = accessToken.split(' ')[1] || accessToken;

            //Decode the token
            jwt.verify(token, jwtKey.jwtSecretKey, (err, decoded) => {
                if (err) {
                    return sendErrorResponse(req, res, {
                        code: 401,
                        message:'You are unauthorized to access the page'
                    });
                } else {
                    req.user = decoded;
                    UserService.findOneBy({_id: req.user.id }).then((user)=>{
                        if(user.role === 'master-admin'){
                            req.authorizationType = 'MASTER-ADMIN';
                        }else{
                            req.authorizationType = 'USER';
                        }
                        UserService.updateBy({ _id: req.user.id},{ lastActive: Date.now() });
                        next();
                    });
                }
            });
        } catch (error) {
            ErrorService.log('user.getUser', error);
            throw error;
        }
    },

    checkUser: function (req, res, next) {
        try {
            const accessToken = req.headers['authorization'] || url.parse(req.url, true).query.accessToken;

            if (!accessToken) {
                req.user = null;
                next();
            }
            else {
                if (accessToken && typeof accessToken !== 'string') {
                    return sendErrorResponse(req, res, {
                        code: 401,
                        message:'Token is not of type string'
                    });
                }

                let token = accessToken.split(' ')[1] || accessToken;

                //Decode the token
                jwt.verify(token, jwtKey.jwtSecretKey, (err, decoded) => {
                    if (err) {
                        return sendErrorResponse(req, res, {
                            code: 401,
                            message:'You are unauthorized to access the page.'
                        });
                    } else {
                        req.authorizationType = 'USER';
                        req.user = decoded;
                        UserService.updateBy({ _id: req.user.id},{ lastActive: Date.now() });
                        next();
                    }
                });
            }
        } catch (error) {
            ErrorService.log('user.checkUser', error);
            throw error;
        }
    },
    checkUserBelongToProject: function (req, res, next) {
        try {
            const accessToken = req.headers['authorization'] || url.parse(req.url, true).query.accessToken;
            if (!accessToken) {
                req.user = null;
                next();
            }
            else {
                if (accessToken && typeof accessToken !== 'string') {
                    return sendErrorResponse(req, res, {
                        code: 401,
                        message:'Token is not of type string'
                    });
                }
                let token = accessToken.split(' ')[1] || accessToken;
                jwt.verify(token, jwtKey.jwtSecretKey, async (err, decoded) => {
                    if (err) {
                        return sendErrorResponse(req, res, {
                            code: 401,
                            message:'You are unauthorized to access the page.'
                        });
                    } else {
                        req.authorizationType = 'USER';
                        req.user = decoded;
                        UserService.updateBy({ _id: req.user.id},{ lastActive: Date.now() });
                        var userId = req.user ? req.user.id : null || url.parse(req.url, true).query.userId;
                        var projectId = req.params.projectId || req.body.projectId || url.parse(req.url, true).query.projectId;
                        if (!projectId) {
                            return res.status(400).send({code: 400, message:'Project id is not present.'});
                        }
                        var project = await ProjectService.findOneBy({_id: projectId});
                        var isUserPresentInProject = false;
                        if (project) {
                            for (var i = 0; i < project.users.length; i++) {
                                if (project.users[i].userId === userId) {
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
                });
            }
        } catch (error) {
            ErrorService.log('user.checkUserBelongToProject', error);
            throw error;
        }
    },
    isUserMasterAdmin: async function (req, res, next){
        if(req.authorizationType === 'MASTER-ADMIN'){
            next();
        }else{
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'You are not authorized.'
            });
        }
    }
};
