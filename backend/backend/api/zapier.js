/**
 *
 * Copyright HackerBay, Inc.
 *
 */

var express = require('express');
var ZapierService = require('../services/zapierService');
var MonitorService = require('../services/monitorService');
var ProjectService = require('../services/projectService');
const {
    isAuthorized
} = require('../middlewares/authorization');
var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var sendItemResponse = require('../middlewares/response').sendItemResponse;
var sendEmptyResponse = require('../middlewares/response').sendEmptyResponse;

var router = express.Router();

router.get('/test', isAuthorized, async function (req, res) {
    var apiKey = req.query.apiKey;
    var projectId = req.query.projectId;

    try{
        var response = await ZapierService.test(projectId, apiKey);
        return sendItemResponse(req, res, response);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.get('/monitors', isAuthorized, async function (req, res) {
    var projectId = req.query.projectId;

    try{
        var projects = await ProjectService.findBy({ $or: [{_id: projectId}, {parentProjectId: projectId}] });
        var projectIds = projects.map(project => project._id);
        var monitors = await MonitorService.findBy({projectId: { $in: projectIds } });
        if (monitors) {
            if(monitors.length){
                monitors = monitors.map(resp => {return {id:resp._id,name:resp.name};});
            }
            return sendItemResponse(req, res, monitors); //zapier expects this as an item response and not a list response.
        }else{
            return sendItemResponse(req, res, []);
        }
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.post('/incident/createIncident', isAuthorized, async function (req, res){
    const monitors = req.body.monitors || [];
    try{
        var incident = await ZapierService.createIncident(monitors);
        return sendItemResponse(req, res, incident);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.get('/incidents', isAuthorized, async function (req, res) {
    var projectId = req.query.projectId;

    try{
        // We return all the incidents to zapier because it gives user an option to configure zapier properly with all the steps.
        var incidents = await ZapierService.getIncidents(projectId);
        // zapier expects this as an item response and not a list response.
        return sendItemResponse(req, res, incidents); 
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.get('/incident/resolved', isAuthorized, async function (req, res) {
    var projectId = req.query.projectId;

    try{
        // We return all the incidents to zapier because it gives user an option to configure zapier properly with all the steps.
        var incidents = await ZapierService.getResolvedIncidents(projectId);
        // zapier expects this as an item response and not a list response.
        if (incidents) return sendItemResponse(req, res, incidents);
        else return sendItemResponse(req, res, []);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.post('/incident/resolveLastIncident', isAuthorized, async function (req, res) {
    const monitors = req.body.monitors || [];
    try{
        var incident = await ZapierService.resolveLastIncident(monitors);
        if (incident) return sendItemResponse(req, res, incident);
        else return sendItemResponse(req, res, {});
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.post('/incident/resolveAllIncidents', isAuthorized, async function (req, res) {
    const monitors = req.body.monitors || [];
    try{
        var incidents = await ZapierService.resolveAllIncidents(monitors);
        // zapier expects this as an item response and not a list response.;
        if (incidents) return sendItemResponse(req, res, incidents);
        else return sendItemResponse(req, res, {});
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.post('/incident/resolveIncident', isAuthorized, async function (req, res) {
    const incidents = req.body.incidents || [];
    try{
        var resolvedIncidents = await ZapierService.resolveIncident(incidents);
        // zapier expects this as an item response and not a list response.
        if (resolvedIncidents) return sendItemResponse(req, res, resolvedIncidents);
        else return sendItemResponse(req, res, {});
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.get('/incident/acknowledged', isAuthorized, async function (req, res) {
    var projectId = req.query.projectId;

    try{
        // We return all the incidents to zapier because it gives user an option to configure zapier properly with all the steps.
        var incidents = await ZapierService.getAcknowledgedIncidents(projectId, true, false);
        // zapier expects this as an item response and not a list response.
        if (incidents) return sendItemResponse(req, res, incidents);
        else return sendItemResponse(req, res, []);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.post('/incident/acknowledgeLastIncident', isAuthorized, async function (req, res) {
    const monitors = req.body.monitors || [];
    try{
        var incident = await ZapierService.acknowledgeLastIncident(monitors);
        if (incident) return sendItemResponse(req, res, incident);
        else return sendItemResponse(req, res, {});
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.post('/incident/acknowledgeAllIncidents', isAuthorized, async function (req, res) {
    const monitors = req.body.monitors || [];
    try{
        var incidents = await ZapierService.acknowledgeAllIncidents(monitors);
        // zapier expects this as an item response and not a list response.;
        if (incidents) return sendItemResponse(req, res, incidents);
        else return sendItemResponse(req, res, {});
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.post('/incident/acknowledgeIncident', isAuthorized, async function (req, res) {
    const incidents = req.body.incidents || [];
    try{
        var acknowledgedIncidents = await ZapierService.acknowledgeIncident(incidents);
        // zapier expects this as an item response and not a list response.
        if (acknowledgedIncidents) return sendItemResponse(req, res, acknowledgedIncidents);
        else return sendItemResponse(req, res, {});
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.post('/subscribe', isAuthorized, async function (req, res) {
    var url = req.body.url;
    var type = req.body.type;
    var monitors = req.body.input && req.body.input.monitors ? req.body.input.monitors : [];
    var projectId = req.query.projectId;
    if (!url) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'We are not able to complete your subscription request because hookUrl is null.'
        });
    }

    if (!type) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'We are not able to complete your subscription request because trigger type is null.'
        });
    }

    try{
        var response = await ZapierService.subscribe(projectId, url, type, monitors);
        return sendItemResponse(req, res, response);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.delete('/unsubscribe/:id', isAuthorized, async function (req, res) {
    var id = req.params.id;

    try{
        await ZapierService.unsubscribe(id);
        return sendEmptyResponse(req, res);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;