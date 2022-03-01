import Express from 'common-server/utils/express';
const express = Express.getLibrary();

const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

import { getUser } from '../middlewares/user';

import { getUserRole } from '../middlewares/project';

import { isAuthorized } from '../middlewares/authorization';

export default ({
    router,
    deleteApiProps,
    createApiProps,
    updateApiProps,
    getApiProps,
    listApiProps,
    isResourceInProject,
    friendlyResourceName,
    service,
}: $TSFixMe) => {
    const getItemMiddleware = async function(
        req: express.Request,
        res: express.Response
    ) {
        try {
            let item = null;

            if (req.role === 'member') {
                item = await service.getItemForMember({
                    query: {
                        _id: req.params.id,
                    },
                });
            } else if (req.role === 'admin' || req.role === 'owner') {
                item = await service.getItemForAdmin({
                    query: {
                        _id: req.params.id,
                    },
                });
            } else if (req.role === 'viewer') {
                item = await service.getItemForViewer({
                    query: {
                        _id: req.params.id,
                    },
                });
            } else {
                item = await service.getItemForPublic({
                    query: {
                        _id: req.params.id,
                    },
                });
            }

            return sendItemResponse(req, res, item);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    };

    const listItemMiddleware = async function(
        req: express.Request,
        res: express.Response
    ) {
        try {
            let query = req.data.query;
            let skip = req.data.skip;
            let sort = req.data.sort;
            let limit = req.data.limit;

            if (!query) {
                query = {};
            }

            if (!skip) {
                skip = 0;
            }

            if (!sort) {
                sort = [['createdAt', -1]];
            }

            if (!limit) {
                limit = 10;
            }

            const promises = [service.countBy({ query })];

            if (req.role === 'member') {
                promises.push(
                    service.getListForMember({
                        query: {
                            _id: req.params.id,
                        },
                        limit,
                        skip,
                        sort,
                    })
                );
            } else if (req.role === 'admin' || req.role === 'owner') {
                promises.push(
                    service.getListForAdmin({
                        query: {
                            _id: req.params.id,
                        },
                        limit,
                        skip,
                        sort,
                    })
                );
            } else if (req.role === 'viewer') {
                promises.push(
                    service.getListForViewer({
                        query: {
                            _id: req.params.id,
                        },
                        limit,
                        skip,
                        sort,
                    })
                );
            } else {
                promises.push(
                    service.getListForPulic({
                        query: {
                            _id: req.params.id,
                        },
                        limit,
                        skip,
                        sort,
                    })
                );
            }

            const [count, list] = await Promise.all(promises);

            return sendListResponse(req, res, list, count);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    };

    const createItemMiddleware = async function(
        req: express.Request,
        res: express.Response
    ) {
        try {
            const data = req.body;

            if (isResourceInProject) {
                data.projectId = req.params.projectId;
            }

            const item = await service.create(data);

            return sendItemResponse(req, res, item);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    };

    const deleteItemMiddleware = async function(
        req: express.Request,
        res: express.Response
    ) {
        try {
            if (!req.apiProps.authorizedByRole.includes(req.role)) {
                return sendErrorResponse(req, res, {
                    code: 401,
                    message: `You are unauthorized to delete ${friendlyResourceName}. You should be ${req.apiProps.authorizedByRole.join(
                        ','
                    )}`,
                });
            }

            await service.deleteOneBy({
                query: {
                    _id: req.params.id,
                },
                deletedByUserId: req.user._id,
            });

            return sendItemResponse(req, res, {
                deleted: true,
            });
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    };

    const updateItemMiddleware = async function(
        req: express.Request,
        res: express.Response,
        next: express.RequestHandler
    ) {
        try {
            if (!req.apiProps.authorizedByRole.includes(req.role)) {
                return sendErrorResponse(req, res, {
                    code: 401,
                    message: `You are unauthorized to update ${friendlyResourceName}. You should be ${req.apiProps.authorizedByRole.join(
                        ','
                    )}`,
                });
            }

            const data = req.data.data;

            // update

            await service.updateOneBy({
                query: {
                    _id: req.params.id,
                },
                updatedValues: data,
            });

            return next();
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    };

    const getMiddlewares = (props: $TSFixMe) => {
        const functionChain = [];

        const apiPropsMiddleware = (
            req: express.Request,
            res: express.Response,
            next: express.RequestHandler
        ) => {
            req.apiProps = props;
            return next();
        };

        functionChain.push(apiPropsMiddleware);

        if (props.isAuthorized) {
            functionChain.push(getUser);
            functionChain.push(isAuthorized);
            functionChain.push(getUserRole);
        }

        return functionChain;
    };

    // Create API.

    if (createApiProps && createApiProps.enabled) {
        let createApiPath = '/create';

        if (isResourceInProject) {
            createApiPath = '/:projectId/create';
        }

        const middlewares = getMiddlewares(createApiProps);

        middlewares.push(createItemMiddleware);

        router.post(createApiPath, ...middlewares);
    }

    if (getApiProps && getApiProps.enabled) {
        let getApiProps = '/:id';

        if (isResourceInProject) {
            getApiProps = '/:projectId/:id';
        }

        const middlewares = getMiddlewares(getApiProps);

        middlewares.push(getItemMiddleware);

        router.get(getApiProps, ...middlewares);
    }

    if (listApiProps && listApiProps.enabled) {
        let listApiProps = '/list';

        if (isResourceInProject) {
            listApiProps = '/:projectId/list';
        }

        const middlewares = getMiddlewares(listApiProps);

        middlewares.push(listItemMiddleware);

        router.post(listApiProps, ...middlewares);
    }

    if (updateApiProps && updateApiProps.enabled) {
        let updateApiProps = '/:id';

        if (isResourceInProject) {
            updateApiProps = '/:projectId/:id';
        }

        const middlewares = getMiddlewares(updateApiProps);

        middlewares.push(updateItemMiddleware);
        middlewares.push(getItemMiddleware);

        router.post(updateApiProps, ...middlewares);
    }

    if (deleteApiProps && deleteApiProps.enabled) {
        let deleteApiProps = '/:id';

        if (isResourceInProject) {
            deleteApiProps = '/:projectId/:id';
        }

        const middlewares = getMiddlewares(deleteApiProps);

        middlewares.push(deleteItemMiddleware);

        router.post(deleteApiProps, ...middlewares);
    }

    return router;
};
