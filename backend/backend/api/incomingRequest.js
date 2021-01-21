const express = require('express');
const getUser = require('../middlewares/user').getUser;
const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const IncomingRequestService = require('../services/incomingRequestService');

const router = express.Router();

router.get(
    '/:projectId/all-incoming-request',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { projectId } = req.params;
            const { limit, skip } = req.query;
            const allIncomingRequest = await IncomingRequestService.findBy(
                {
                    projectId,
                },
                limit,
                skip
            );
            const count = await IncomingRequestService.countBy({
                projectId,
            });

            return sendListResponse(req, res, allIncomingRequest, count);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post(
    '/:projectId/create-request-url',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { projectId } = req.params;
            const data = req.body;

            if (!data.name || !data.name.trim()) {
                const error = new Error(
                    'Please specify a name for the incoming request'
                );
                error.code = 400;
                throw error;
            }

            let incomingRequest = await IncomingRequestService.findOneBy({
                name: data.name,
                projectId,
            });
            if (incomingRequest) {
                const error = new Error(
                    'Incoming request with this name already exist'
                );
                error.code = 400;
                throw error;
            }

            data.projectId = projectId;
            incomingRequest = await IncomingRequestService.create(data);
            // requestUrl contains the whole incoming request object with the updated url
            const requestUrl = await IncomingRequestService.getRequestUrl(
                projectId,
                incomingRequest._id
            );

            return sendItemResponse(req, res, requestUrl);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.put(
    '/:projectId/update/:requestId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { projectId, requestId } = req.params;
            const data = req.body;

            if (!data.name || !data.name.trim()) {
                const error = new Error(
                    'Please specify a name for the incoming request'
                );
                error.code = 400;
                throw error;
            }

            let incomingRequest = await IncomingRequestService.findOneBy({
                name: data.name,
                projectId,
            });
            if (
                incomingRequest &&
                String(incomingRequest._id) !== String(requestId)
            ) {
                const error = new Error(
                    'Incoming request with this name already exist'
                );
                error.code = 400;
                throw error;
            }

            incomingRequest = await IncomingRequestService.updateOneBy(
                { requestId, projectId },
                data
            );
            return sendItemResponse(req, res, incomingRequest);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.delete(
    '/:projectId/remove/:requestId',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { projectId, requestId } = req.params;

            const incomingRequest = await IncomingRequestService.deleteBy({
                _id: requestId,
                projectId,
            });
            return sendItemResponse(req, res, incomingRequest);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// process incoming http request from post request
router.post('/:projectId/request/:requestId', async function(req, res) {
    try {
        // request object for use in variables
        const request = {
            body: { ...req.body },
            query: { ...req.query },
            headers: { ...req.headers },
        };

        const { projectId, requestId } = req.params;
        const data = { projectId, requestId, request };

        const response = await IncomingRequestService.handleIncomingRequestAction(
            data
        );
        return sendItemResponse(req, res, response);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// process incoming http request from get request
router.get('/:projectId/request/:requestId', async function(req, res) {
    try {
        // request object for use in variables
        // request body won't be available for a get request
        const request = {
            query: { ...req.query },
            headers: { ...req.headers },
        };

        const { projectId, requestId } = req.params;
        const data = { projectId, requestId, request };

        const response = await IncomingRequestService.handleIncomingRequestAction(
            data
        );
        return sendItemResponse(req, res, response);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
