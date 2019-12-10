/**
 *
 * Copyright HackerBay, Inc.
 *
 */

var express = require('express');
var IncidentService = require('../services/incidentService');

var router = express.Router();

const {
    isAuthorized
} = require('../middlewares/authorization');
var isUserAdmin = require('../middlewares/project').isUserAdmin;
var getUser = require('../middlewares/user').getUser;

var getSubProjects = require('../middlewares/subProject').getSubProjects;

var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var sendListResponse = require('../middlewares/response').sendListResponse;
var sendItemResponse = require('../middlewares/response').sendItemResponse;


// Route
// Description: Creating incident.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.body-> {monitorId, projectId}
// Returns: 200: Incident, 400: Error; 500: Server Error.
router.post('/:projectId/:monitorId', getUser, isAuthorized, async function (req, res) {
    try {
        var monitorId = req.params.monitorId;
        var projectId = req.params.projectId;
        var incidentType = req.body.incidentType;
        var userId = req.user ? req.user.id : null;
    
        if (!monitorId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor ID must be present.'
            });
        }
    
        if (typeof monitorId !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor ID  is not in string type.'
            });
        }
    
        if (!projectId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID must be present.'
            });
        }
    
        if (typeof monitorId !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project ID  is not in string type.'
            });
        }
    
        if (incidentType) {
            if (!(['offline', 'online', 'degraded'].includes(incidentType))) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Invalid incident type.'
                });
            }
        }
        // Call the IncidentService
        var incident = await IncidentService.create({ projectId: projectId, monitorId: monitorId, createdById: userId, manuallyCreated: true, incidentType });
        return sendItemResponse(req, res, incident);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }

});

// Route
// Description: Getting all the incidents by monitor Id.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.params-> {monitorId}
// Returns: 200: incidents, 400: Error; 500: Server Error.
router.get('/:projectId/monitor/:monitorId', getUser, isAuthorized, async function (req, res) {
    try{
        // Call the IncidentService.
        var incidents = await IncidentService.findBy({ monitorId: req.params.monitorId, projectId: req.params.projectId }, req.query.limit || 3, req.query.skip || 0);
        var count = await IncidentService.countBy({ monitorId: req.params.monitorId, projectId: req.params.projectId });
        return sendListResponse(req, res, incidents, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Fetch incidents by projectId
router.get('/:projectId', getUser, isAuthorized, getSubProjects, async function (req, res) {
    try{
        var subProjectIds = req.user.subProjects ? req.user.subProjects.map(project => project._id) : null;
        var incidents = await IncidentService.getSubProjectIncidents(subProjectIds);
        return sendItemResponse(req, res, incidents); // frontend expects sendItemResponse
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/incident', getUser, isAuthorized, async function(req, res){
    try{
        var projectId = req.params.projectId;
        var incident = await IncidentService.findBy({projectId}, req.query.limit || 10, req.query.skip || 0);
        var count = await IncidentService.countBy({projectId});
        return sendListResponse(req, res, incident, count); // frontend expects sendListResponse
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

// Route
// Description: Getting incident.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.params-> {incidentId}
// Returns: 200: incidents, 400: Error; 500: Server Error.
router.get('/:projectId/incident/:incidentId', getUser, isAuthorized, async function (req, res) {

    // Call the IncidentService.

    try {
        var incident = await IncidentService.findOneBy({ _id: req.params.incidentId });
        return sendItemResponse(req, res, incident);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/unresolvedincidents', getUser, isAuthorized, getSubProjects, async function (req, res) {
    try {
        var subProjectIds = req.user.subProjects ? req.user.subProjects.map(project => project._id) : null;
        // Call the IncidentService.
        var userId = req.user ? req.user.id : null;
        var incident = await IncidentService.getUnresolvedIncidents(subProjectIds,userId);
        return sendItemResponse(req, res, incident);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/:projectId/acknowledge/:incidentId', getUser, isAuthorized, async function (req, res) {
    try {
        var userId = req.user ? req.user.id : null;
        // Call the IncidentService
        var incident = await IncidentService.acknowledge(req.params.incidentId, userId, req.user.name);
        return sendItemResponse(req, res, incident);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Route
// Description: Updating user who resolved incident.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.body-> {incidentId, projectId}
// Returns: 200: incident, 400: Error; 500: Server Error.
router.post('/:projectId/resolve/:incidentId', getUser, isAuthorized, async function (req, res) {
    try {
        var userId = req.user ? req.user.id : null;
        // Call the IncidentService
        var incident = await IncidentService.resolve(req.params.incidentId, userId);
        return sendItemResponse(req, res, incident);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/:projectId/close/:incidentId', getUser, isAuthorized, async function (req, res) {
    try {
        var userId = req.user ? req.user.id : null;
        // Call the IncidentService
        var incident = await IncidentService.close(req.params.incidentId, userId);
        return sendItemResponse(req, res, incident);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Routes
// Description: Updating internal and investigation notes.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.body-> {incidentId, projectId, internalNote, investigationNote}
// Returns: 200: incident, 400: Error; 500: Server Error.
router.put('/:projectId/incident/:incidentId', getUser, isAuthorized, async function (req, res) {
    try {
        var data = req.body;
        data._id = req.params.incidentId;
    
    
        if (data.internalNote && typeof data.internalNote !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Internal Note  is not in string type.'
            });
        }
    
        if (data.investigationNote && typeof data.investigationNote !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Investigation note is not in string type.'
            });
        }
        // Call the IncidentService
        var incident = await IncidentService.update(data);
        if (incident && incident._id) {
            incident = await IncidentService.findOneBy({ _id: incident._id, projectId: incident.projectId });
        }
        return sendItemResponse(req, res, incident);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }

});

router.delete('/:projectId/:incidentId', getUser, isUserAdmin, async function(req, res){
    try {
        const { projectId, incidentId } = req.params;
        var incident = await IncidentService.deleteBy({ _id: incidentId, projectId }, req.user.id);
        if (incident) {
            return sendItemResponse(req, res, incident);
        } else {
            return sendErrorResponse(req, res, { message: 'Incident not found' });
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});


module.exports = router;