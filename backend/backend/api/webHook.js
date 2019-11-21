var express = require('express');
var IntegrationService = require('../services/integrationService');
var getUser = require('../middlewares/user').getUser;
var isUserAdmin = require('../middlewares/project').isUserAdmin;
var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var sendListResponse = require('../middlewares/response').sendListResponse;
var sendItemResponse = require('../middlewares/response').sendItemResponse;


var router = express.Router();

router.post('/:projectId/create', getUser, isUserAdmin, async function (req, res) {

    let projectId = req.params.projectId;
    let body = req.body;
    let userId = req.user ? req.user.id : null;

    let monitorIds = body.monitorIds;
    let endpoint = body.endpoint;
    let endpointType = body.endpointType;

    if(!projectId) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'projectId missing in body, must be present'
        });
    }

    if(!endpoint) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'endpoint missing in body, must be present'
        });
    }

    if(!monitorIds) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'monitorIds missing in body, must be present'
        });
    }

    try{
        var data = {userId: userId, endpoint, endpointType, monitorIds};
        var integrationType = 'webhook';
        var slack = await IntegrationService.create(projectId, userId, data, integrationType);
        return sendItemResponse(req, res, slack);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

// update webhook
router.put('/:projectId/:integrationId', getUser, isUserAdmin, async function (req, res) {

    let data = req.body;
    data.projectId = req.params.projectId;
    data.userId = req.user ? req.user.id : null;
    data._id = req.params.integrationId;

    if(!data.projectId) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'projectId missing in body, must be present'
        });
    }

    if(!data.endpoint) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'endpoint missing in body, must be present'
        });
    }

    if(!data.monitorIds) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'monitorIds missing in body, must be present'
        });
    }
    try{
        var webhook = await IntegrationService.update(data);
        return sendItemResponse(req, res, webhook);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

// req => params => {teamId, projectId}
router.delete('/:projectId/delete/:integrationId', getUser, isUserAdmin, async function (req, res) {

    var projectId = req.params.projectId;
    var integrationId = req.params.integrationId;
    var userId = req.user ? req.user.id : null;

    try{
        var data = await IntegrationService.deleteBy({_id: integrationId, projectId: projectId}, userId);
        return sendItemResponse(req, res, data);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

// req => params => {projectId}
router.get('/:projectId/hooks', getUser, async function (req, res) {

    var projectId = req.params.projectId;
    var integrationType = 'webhook';

    try{
        var integrations = await IntegrationService.findBy({projectId: projectId, integrationType: integrationType}, req.query.skip || 0, req.query.limit || 10);
        var count = await IntegrationService.countBy({projectId: projectId, integrationType: integrationType});
        return sendListResponse(req, res, integrations, count);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
