
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

const { getUser, checkUser } = require('../middlewares/user');
const { isUserAdmin } = require('../middlewares/project');
const { isAuthorized } = require('../middlewares/authorization');

module.exports = ({
    router,
    deleteApiProps,
    createApiProps,
    updateApiProps,
    getApiProps,
    listApiProps, 
    isResourceByProject,
    friendlyResourceName,
    resourceName,
    validationProps,
    requiredFields,
    service
}) => {



    const getMiddlewares = (props) => {
        const functionChain = [];
        if (props.isAuthorized) {
            functionChain.push(getUser);
            functionChain.push(isAuthorized);
        }

        if (props.roles.includes('admin')) {
            functionChain.push(isUserAdmin);
        }

        return functionChain;
    }


    // Create API. 

    if (createApiProps && createApiProps.enabled) {

        let createApiPath = "/";

        if (isResourceByProject) {
            createApiPath = '/:projectId';
        }

        const middlewares = getMiddlewares(createApiProps);


        middlewares.push(async function (
            req,
            res
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
        })

        router.post(createApiPath, ...middlewares);
    }


    if (getApiProps && getApiProps.enabled) {

        let getApiProps = "/:id";

        if (isResourceByProject) {
            getApiProps = '/:projectId/:id';
        }

        const middlewares = getMiddlewares(getApiProps);


        middlewares.push(async function (
            req,
            res
        ) {
            try {
                const {
                    data,
                    count,
                } = await StatusPageService.getStatusPagesByProjectId({
                    projectId: req.params.projectId,
                    skip: req.query.skip,
                    limit: req.query.limit,
                });
                return sendListResponse(req, res, data, count);
            } catch (error) {
                return sendErrorResponse(req, res, error);
            }
        })

        router.get(getApiProps, ...middlewares);
    }

    return router;
}