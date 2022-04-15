import ProjectService from '../Services/projectService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import url from 'url';
import { sendErrorResponse } from 'CommonServer/Utils/Response';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from 'CommonServer/Utils/Express';
import apiMiddleware from '../middlewares/api';

export default {
    /*
     * Description: Checks if user belongs to the project.
     *
     * Params:
     * Param 1: req.params-> {projectId}; req.user-> {id}
     * Returns: 400: Project does not exist or User is not present in this project; 500: Server Error
     */
    doesUserBelongToProject: async function (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): void {
        try {
            // Authorize if user is master-admin
            if (req.authorizationType === 'MASTER-ADMIN') {
                return next();
            } else {
                const userId: $TSFixMe = req.user
                    ? req.user.id
                    : null || url.parse(req.url, true).query.userId;
                const projectId: $TSFixMe =
                    req.params.projectId ||
                    req.body.projectId ||
                    url.parse(req.url, true).query.projectId;
                //Sanitize
                if (!projectId) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Project id is not present.',
                    });
                }
                // Calls the ProjectService

                const project: $TSFixMe = await ProjectService.findOneBy({
                    query: { _id: projectId },
                    select: '_id users',
                });

                let isUserPresentInProject: $TSFixMe = false;

                if (project) {
                    const projectUsers: $TSFixMe = project.users;

                    for (let i: $TSFixMe = 0; i < projectUsers.length; i++) {
                        if (projectUsers[i].userId === userId) {
                            isUserPresentInProject = true;
                            return next();
                        }
                    }

                    // If not in project, look at subprojects.

                    const subProjects: $TSFixMe = await ProjectService.findBy({
                        query: { parentProjectId: project._id },
                        select: 'users _id',
                    });

                    if (subProjects && subProjects.length > 0) {
                        for (const subProject of subProjects) {
                            // 'for in' iterate over the keys while 'for of' iterate over the values
                            const subProjectUsers: $TSFixMe = subProject.users; // Using 'for in' made subProject.users === undefined

                            for (
                                let i: $TSFixMe = 0;
                                i < subProjectUsers.length;
                                i++
                            ) {
                                if (subProjectUsers[i].userId === userId) {
                                    isUserPresentInProject = true;
                                    return next();
                                }
                            }
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
        } catch (error) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Bad request to server')
            );
        }
    },

    /*
     * Description: Checks if user is admin.
     *
     * Params:
     * Param 1: req.params-> {projectId}; req.user-> {id}
     * Returns: 400: You are not authorized to add member to project. Only admin can add.; 500: Server Error
     */
    isUserAdmin: async function (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): void {
        try {
            const projectId: $TSFixMe = apiMiddleware.getProjectId(req);

            if (projectId) {
                if (!apiMiddleware.isValidProjectId(projectId)) {
                    return sendErrorResponse(req, res, {
                        message: 'Project Id is not valid',
                        code: 400,
                    });
                }

                if (apiMiddleware.hasAPIKey(req)) {
                    return apiMiddleware.isValidProjectIdAndApiKey(
                        req,
                        res,
                        next
                    );
                }
            }

            /*
             * Authorize if user is master-admin
             *
             */
            if (req.authorizationType === 'MASTER-ADMIN') {
                return next();
            } else {
                const userId: $TSFixMe = req.user ? req.user.id : null;

                const project: $TSFixMe = await ProjectService.findOneBy({
                    query: {
                        'users.userId': userId,
                        _id: req.params.projectId,
                    },
                    select: 'users',
                });
                if (project) {
                    let role: $TSFixMe;
                    for (const user of project.users) {
                        if (user.userId === userId) {
                            role = user.role;
                            break;
                        }
                    }
                    if (role !== 'Administrator' && role !== 'Owner') {
                        return sendErrorResponse(req, res, {
                            code: 400,
                            message:
                                "You cannot edit the project because you're not an admin.",
                        });
                    } else {
                        return next();
                    }
                } else {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: "You're not authorized.",
                    });
                }
            }
        } catch (error) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Bad request to server')
            );
        }
    },

    isUserOwner: async function (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): void {
        try {
            // Authorize if user is master-admin
            if (req.authorizationType === 'MASTER-ADMIN') {
                return next();
            } else {
                const UserId: $TSFixMe = req.user ? req.user.id : null;

                const project: $TSFixMe = await ProjectService.findOneBy({
                    query: {
                        'users.userId': UserId,
                        _id: req.params.projectId,
                    },
                    select: 'users',
                });
                if (project) {
                    let role: $TSFixMe;
                    for (const user of project.users) {
                        if (user.userId === UserId) {
                            role = user.role;
                            break;
                        }
                    }
                    if (role !== 'Owner') {
                        return sendErrorResponse(req, res, {
                            code: 400,
                            message:
                                "You cannot edit the project because you're not an owner.",
                        });
                    } else {
                        return next();
                    }
                } else {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: "You're not authorized.",
                    });
                }
            }
        } catch (error) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Bad request to server')
            );
        }
    },

    getUserRole: async function (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): void {
        try {
            const UserId: $TSFixMe = req.user ? req.user.id : null;

            const project: $TSFixMe = await ProjectService.findOneBy({
                query: {
                    'users.userId': UserId,
                    _id: req.params.projectId,
                },
                select: 'users',
            });
            if (project) {
                let role: $TSFixMe;

                for (const user of project.users) {
                    if (user.userId === UserId) {
                        role = user.role;
                        break;
                    }
                }

                req.project = project;
                req.role = role;
            }

            return next();
        } catch (error) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Bad request to server')
            );
        }
    },
};
