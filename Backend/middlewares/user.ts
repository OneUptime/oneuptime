const jwtSecretKey = process.env['JWT_SECRET'];
import {
    ExpressResponse,
    ExpressRequest,
    NextFunction,
} from 'CommonServer/Utils/Express';
import jwt from 'jsonwebtoken';
import url from 'url';
import UserService from '../Services/userService';
import ProjectService from '../Services/projectService';
import { sendErrorResponse } from 'CommonServer/Utils/Response';

import apiMiddleware from '../middlewares/api';

import { getPlanById } from '../config/plans';

const _this = {
    // Description: Checking if user is authorized to access the page and decode jwt to get user data.
    // Params:
    // Param 1: req.headers-> {token}
    // Returns: 400: User is unauthorized since unauthorized token was present.

    getUser: async function (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ) {
        const projectId = apiMiddleware.getProjectId(req);

        if (projectId) {
            if (!apiMiddleware.isValidProjectId(projectId)) {
                return sendErrorResponse(req, res, {
                    message: 'Project Id is not valid',
                    code: 400,
                });
            }

            if (apiMiddleware.hasAPIKey(req)) {
                return apiMiddleware.isValidProjectIdAndApiKey(req, res, next);
            }
        }

        const accessToken =
            req.headers['authorization'] ||
            url.parse(req.url, true).query.accessToken;

        if (!accessToken) {
            if (res) {
                return sendErrorResponse(req, res, {
                    code: 401,
                    message: 'Session Token must be present.',
                });
            } else {
                return null;
            }
        }

        if (typeof accessToken !== 'string') {
            if (res) {
                return sendErrorResponse(req, res, {
                    code: 401,
                    message: 'Token is not of type string.',
                });
            } else {
                return null;
            }
        }

        const token = accessToken.split(' ')[1] || accessToken;

        //Decode the token
        let decoded = null;
        try {
            decoded = await jwt.verify(token, jwtSecretKey);
        } catch (err) {
            if (res) {
                return sendErrorResponse(req, res, {
                    code: 401,
                    message: 'You are unauthorized to access the page',
                });
            } else {
                return null;
            }
        }
        req.user = decoded;
        const user = await UserService.findOneBy({
            query: { _id: req.user.id },
            select: 'role',
        });
        if (!user) {
            if (res) {
                return sendErrorResponse(req, res, {
                    code: 401,
                    message: 'You are unauthorized to access the page',
                });
            } else {
                return null;
            }
        }
        if (user.role === 'master-admin') {
            req.authorizationType = 'MASTER-ADMIN';
        } else {
            req.authorizationType = 'USER';
        }

        UserService.updateOneBy(
            { _id: req.user.id },
            { lastActive: Date.now() }
        );

        if (next) {
            return next();
        } else {
            return req;
        }
    },

    checkUser: function (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ) {
        const accessToken =
            req.headers['authorization'] ||
            url.parse(req.url, true).query.accessToken;

        if (!accessToken) {
            req.user = null;
            return next();
        } else {
            if (accessToken && typeof accessToken !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 401,
                    message: 'Token is not of type string',
                });
            }

            const token = accessToken.split(' ')[1] || accessToken;

            //Decode the token
            jwt.verify(
                token,
                jwtSecretKey,
                (err: $TSFixMe, decoded: $TSFixMe) => {
                    if (err) {
                        return sendErrorResponse(req, res, {
                            code: 401,
                            message: 'You are unauthorized to access the page.',
                        });
                    } else {
                        req.authorizationType = 'USER';
                        req.user = decoded;
                        UserService.updateOneBy(
                            { _id: req.user.id },
                            { lastActive: Date.now() }
                        );
                        return next();
                    }
                }
            );
        }
    },
    checkUserBelongToProject: function (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ) {
        const accessToken =
            req.headers['authorization'] ||
            url.parse(req.url, true).query.accessToken;
        if (!accessToken) {
            req.user = null;
            return next();
        } else {
            if (accessToken && typeof accessToken !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 401,
                    message: 'Token is not of type string',
                });
            }
            const token = accessToken.split(' ')[1] || accessToken;
            jwt.verify(
                token,
                jwtSecretKey,
                async (err: $TSFixMe, decoded: $TSFixMe) => {
                    if (err) {
                        return sendErrorResponse(req, res, {
                            code: 401,
                            message: 'You are unauthorized to access the page.',
                        });
                    } else {
                        req.authorizationType = 'USER';
                        req.user = decoded;

                        const userId = req.user
                            ? req.user.id
                            : null || url.parse(req.url, true).query.userId;
                        const projectId =
                            req.params.projectId ||
                            req.body.projectId ||
                            url.parse(req.url, true).query.projectId;
                        if (!projectId) {
                            return res.status(400).send({
                                code: 400,
                                message: 'Project id is not present.',
                            });
                        }
                        const [project] = await Promise.all([
                            ProjectService.findOneBy({
                                _id: projectId,
                            }),
                            UserService.updateOneBy(
                                { _id: req.user.id },
                                { lastActive: Date.now() }
                            ),
                        ]);
                        let isUserPresentInProject = false;
                        if (project) {
                            for (let i = 0; i < project.users.length; i++) {
                                if (project.users[i].userId === userId) {
                                    isUserPresentInProject = true;
                                    break;
                                }
                            }
                        } else {
                            return sendErrorResponse(req, res, {
                                code: 400,
                                message: 'Project does not exist.',
                            });
                        }
                        if (isUserPresentInProject) {
                            return next();
                        } else {
                            return sendErrorResponse(req, res, {
                                code: 400,
                                message: 'You are not present in this project.',
                            });
                        }
                    }
                }
            );
        }
    },

    isUserMasterAdmin: async function (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ) {
        if (!req.user) {
            req = await this.getUser(req);
        }

        if (req && req.authorizationType === 'MASTER-ADMIN') {
            if (next) {
                return next();
            } else {
                return true;
            }
        } else {
            if (res) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'You are not authorized.',
                });
            } else {
                return false;
            }
        }
    },

    isScaleOrMasterAdmin: async function (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ) {
        const projectId = apiMiddleware.getProjectId(req);

        if (this.isUserMasterAdmin(req, res)) {
            if (next) {
                return next();
            } else {
                return true;
            }
        }

        if (projectId) {
            if (!apiMiddleware.isValidProjectId(projectId)) {
                return sendErrorResponse(req, res, {
                    message: 'Project Id is not valid',
                    code: 400,
                });
            }

            if (apiMiddleware.hasAPIKey(req)) {
                return apiMiddleware.isValidProjectIdAndApiKey(req, res, next);
            }
        } else {
            if (res) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Project Id is missing',
                });
            } else {
                return false;
            }
        }

        const project = await ProjectService.findOneBy({
            query: { _id: projectId },
            select: 'stripePlanId',
        });

        const isScalePlan = project?.stripePlanId
            ? getPlanById(project.stripePlanId).category === 'Scale'
            : false;

        if (isScalePlan) {
            if (next) {
                return next();
            } else {
                return true;
            }
        } else {
            if (res) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'You are not authorized.',
                });
            } else {
                return false;
            }
        }
    },
};

export default _this;
