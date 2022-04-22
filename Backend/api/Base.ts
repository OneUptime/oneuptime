import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from 'CommonServer/Utils/Express';

import {
    sendErrorResponse,
    sendListResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

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
}: $TSFixMe): void => {
    const getItemMiddleware: Function = async (
        req: ExpressRequest,
        res: ExpressResponse
    ): void => {
        try {
            let item: $TSFixMe = null;

            if (req.role === 'member') {
                item = await service.getItemForMember({
                    query: {
                        _id: req.params['id'],
                    },
                });
            } else if (req.role === 'admin' || req.role === 'owner') {
                item = await service.getItemForAdmin({
                    query: {
                        _id: req.params['id'],
                    },
                });
            } else if (req.role === 'viewer') {
                item = await service.getItemForViewer({
                    query: {
                        _id: req.params['id'],
                    },
                });
            } else {
                item = await service.getItemForPublic({
                    query: {
                        _id: req.params['id'],
                    },
                });
            }

            return sendItemResponse(req, res, item);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    };

    const listItemMiddleware: Function = async (
        req: ExpressRequest,
        res: ExpressResponse
    ): void => {
        try {
            let query: $TSFixMe = req.data.query;
            let skip: $TSFixMe = req.data.skip;
            let sort: $TSFixMe = req.data.sort;
            let limit: $TSFixMe = req.data.limit;

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

            const promises: $TSFixMe = [service.countBy({ query })];

            if (req.role === 'member') {
                promises.push(
                    service.getListForMember({
                        query: {
                            _id: req.params['id'],
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
                            _id: req.params['id'],
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
                            _id: req.params['id'],
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
                            _id: req.params['id'],
                        },
                        limit,
                        skip,
                        sort,
                    })
                );
            }

            const [count, list]: $TSFixMe = await Promise.all(promises);

            return sendListResponse(req, res, list, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    };

    const createItemMiddleware: Function = async (
        req: ExpressRequest,
        res: ExpressResponse
    ): void => {
        try {
            const data: $TSFixMe = req.body;

            if (isResourceInProject) {
                data.projectId = req.params['projectId'];
            }

            const item: $TSFixMe = await service.create(data);

            return sendItemResponse(req, res, item);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    };

    const deleteItemMiddleware: Function = async (
        req: ExpressRequest,
        res: ExpressResponse
    ): void => {
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
                    _id: req.params['id'],
                },
                deletedByUserId: req.user._id,
            });

            return sendItemResponse(req, res, {
                deleted: true,
            });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    };

    const updateItemMiddleware: $TSFixMe = async function (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): void {
        try {
            if (!req.apiProps.authorizedByRole.includes(req.role)) {
                return sendErrorResponse(req, res, {
                    code: 401,
                    message: `You are unauthorized to update ${friendlyResourceName}. You should be ${req.apiProps.authorizedByRole.join(
                        ','
                    )}`,
                });
            }

            const data: $TSFixMe = req.data.data;

            // Update

            await service.updateOneBy({
                query: {
                    _id: req.params['id'],
                },
                updatedValues: data,
            });

            return next();
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    };

    const getMiddlewares: Function = (props: $TSFixMe): void => {
        const functionChain: $TSFixMe = [];

        const apiPropsMiddleware: Function = (
            req: ExpressRequest,
            res: ExpressResponse,
            next: NextFunction
        ): void => {
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
        let createApiPath: $TSFixMe = '/create';

        if (isResourceInProject) {
            createApiPath = '/:projectId/create';
        }

        const middlewares: $TSFixMe = getMiddlewares(createApiProps);

        middlewares.push(createItemMiddleware);

        router.post(createApiPath, ...middlewares);
    }

    if (getApiProps && getApiProps.enabled) {
        let getApiProps: $TSFixMe = '/:id';

        if (isResourceInProject) {
            getApiProps = '/:projectId/:id';
        }

        const middlewares: $TSFixMe = getMiddlewares(getApiProps);

        middlewares.push(getItemMiddleware);

        router.get(getApiProps, ...middlewares);
    }

    if (listApiProps && listApiProps.enabled) {
        let listApiProps: $TSFixMe = '/list';

        if (isResourceInProject) {
            listApiProps = '/:projectId/list';
        }

        const middlewares: $TSFixMe = getMiddlewares(listApiProps);

        middlewares.push(listItemMiddleware);

        router.post(listApiProps, ...middlewares);
    }

    if (updateApiProps && updateApiProps.enabled) {
        let updateApiProps: $TSFixMe = '/:id';

        if (isResourceInProject) {
            updateApiProps = '/:projectId/:id';
        }

        const middlewares: $TSFixMe = getMiddlewares(updateApiProps);

        middlewares.push(updateItemMiddleware);
        middlewares.push(getItemMiddleware);

        router.post(updateApiProps, ...middlewares);
    }

    if (deleteApiProps && deleteApiProps.enabled) {
        let deleteApiProps: $TSFixMe = '/:id';

        if (isResourceInProject) {
            deleteApiProps = '/:projectId/:id';
        }

        const middlewares: $TSFixMe = getMiddlewares(deleteApiProps);

        middlewares.push(deleteItemMiddleware);

        router.post(deleteApiProps, ...middlewares);
    }

    return router;
};
