/**
 *
 * Copyright HackerBay, Inc.
 *
 */

module.exports = {

    findBy: async function (query) {
        try {
            if(!query){
                query = {};
            }
            query.deleted = false;
            var zap = await ZapierModel.find(query);

            return zap;
        } catch (error) {
            ErrorService.log('ZapierService.findBy', error);
            throw error;
        }

    },

    test: async function (projectId, apiKey) {
        try{
            var project = await ProjectService.findOneBy({ apiKey: apiKey, _id: projectId });
            if (project) return await Object.assign({}, project, {projectName: project.name});
            else {
                let error = new Error('We are not able to authenticate you because your `API Key` or `Project ID` is not valid. Please go to your project settings and retrieve your API key and Project ID.');
                error.code = 400;
                ErrorService.log('ZapierService.test', error);
                throw error;
            }
        } catch (error) {
            ErrorService.log('ZapierService.test', error);
            throw error;
        }
    },

    getIncidents: async function( projectId ){ 
        try {
            var zapierResponseArray = [];
            var zapierResponse = {};
            var _this = this;
            var project = await ProjectService.findOneBy({_id: projectId});
            
            if (project) {
                zapierResponse.projectName = project.name;
                zapierResponse.projectId = project._id;
                var projects = await ProjectService.findBy({ $or: [{_id: projectId}, { parentProjectId: projectId }] });
                var projectIds = projects.map(project => project._id);
                var findquery = { projectId: { $in: projectIds }, acknowledged: false, resolved: false };
                var incidents = await IncidentService.findBy(findquery);
                await Promise.all(incidents.map(async (incident)=>{
                    zapierResponseArray.push(await _this.mapIncidentToResponse(incident, zapierResponse));
                }));
                
                return zapierResponseArray;
            }
            else {
                return [];
            }
        } catch (error) {
            ErrorService.log('ZapierService.getIncidents', error);
            throw error;
        }
    },

    getAcknowledgedIncidents: async function( projectId ){
        try {
            var zapierResponseArray = [];
            var zapierResponse = {};
            var _this = this;
            var project = await ProjectService.findOneBy({_id: projectId});
            if (project) {
                zapierResponse.projectName = project.name;
                zapierResponse.projectId = project._id;
                var projects = await ProjectService.findBy({ $or: [{_id: projectId}, { parentProjectId: projectId }] });
                var projectIds = projects.map(project => project._id);
                var findquery = { projectId: { $in: projectIds }, acknowledged: true, resolved: false };
                var incidents = await IncidentService.findBy(findquery);
                await Promise.all(incidents.map(async (incident)=>{
                    zapierResponseArray.push(await _this.mapIncidentToResponse(incident, zapierResponse));
                }));
                
                return zapierResponseArray;
            }
            else {
                return [];
            }
        } catch (error) {
            ErrorService.log('ZapierService.getAcknowledgedIncidents', error);
            throw error;
        }
    },

    getResolvedIncidents: async function( projectId ){
        try {
            var zapierResponseArray = [];
            var zapierResponse = {};
            var _this = this;
            var project = await ProjectService.findOneBy({_id: projectId});
            if (project) {
                zapierResponse.projectName = project.name;
                zapierResponse.projectId = project._id;
                var projects = await ProjectService.findBy({ $or: [{_id: projectId}, { parentProjectId: projectId }] });
                var projectIds = projects.map(project => project._id);
                var findquery = { projectId: { $in: projectIds }, acknowledged: true, resolved: true };
                var incidents = await IncidentService.findBy(findquery);
                    
                await Promise.all(incidents.map(async (incident)=>{
                    zapierResponseArray.push(await _this.mapIncidentToResponse(incident, zapierResponse));
                }));
                
                return zapierResponseArray;
            }
            else {
                return [];
            }
        } catch (error) {
            ErrorService.log('ZapierService.getResolvedIncidents', error);
            throw error;
        }
    },

    createIncident: async function (monitors){
        let zapierResponse = {};
        let incidentArr = [];
        await Promise.all(monitors.map(async (monitor)=>{
            const monitorObj = await MonitorService.findOneBy({_id: monitor});
            let incident = new IncidentModel();
            incident.projectId = monitorObj.projectId._id;
            incident.monitorId = monitorObj._id;
            incident.createdByZapier = true;
            incident = await incident.save();
            let msg = `A New Incident was created for ${monitorObj.name} by Zapier`;
            await NotificationService.create(incident.projectId, msg, null, 'warning');
            await RealTimeService.sendIncidentCreated(incident);

            let project = await ProjectService.findOneBy({_id: monitorObj.project._id});
            if(project.parentProjectId){
                project = await ProjectService.findOneBy({_id: project.parentProjectId._id});
            }
            zapierResponse.projectName = project.name;
            zapierResponse.projectId = project._id;
            incidentArr.push(incident);
        }));
        zapierResponse.incidents = incidentArr;
        return zapierResponse;
    },

    acknowledgeLastIncident: async function (monitors){
        let zapierResponse = {};
        let incidentArr = [];
        await Promise.all(monitors.map(async (monitor)=>{
            let lastIncident = await IncidentService.findOneBy({monitorId: monitor, acknowledged: false});
            lastIncident = await IncidentService.acknowledge(lastIncident._id, null, 'Zapier', true);
            const monitorObj = await MonitorService.findOneBy({_id: monitor});
            let project = await ProjectService.findOneBy({_id: monitorObj.project._id});
            if(project.parentProjectId){
                project = await ProjectService.findOneBy({_id: project.parentProjectId._id});
            }
            zapierResponse.projectName = project.name;
            zapierResponse.projectId = project._id;
            incidentArr.push(lastIncident);
        }));
        zapierResponse.incidents = incidentArr;
        return zapierResponse;
    },

    acknowledgeAllIncidents: async function (monitors){
        let zapierResponse = {};
        let incidentArr = [];
        await Promise.all(monitors.map(async (monitor)=>{
            let incidents = await IncidentService.findBy({monitorId: monitor, acknowledged: false});
            incidents = await Promise.all(incidents.map(async (incident)=>{
                return await IncidentService.acknowledge(incident._id, null, 'Zapier', true);
            }));
            const monitorObj = await MonitorService.findOneBy({_id: monitor});
            let project = await ProjectService.findOneBy({_id: monitorObj.project._id});
            if(project.parentProjectId){
                project = await ProjectService.findOneBy({_id: project.parentProjectId._id});
            }
            zapierResponse.projectName = project.name;
            zapierResponse.projectId = project._id;
            incidentArr = incidents;
        }));
        zapierResponse.incidents = incidentArr;
        return zapierResponse;
    },

    acknowledgeIncident: async function (incidents){
        let zapierResponse = {};
        let incidentArr = [];
        await Promise.all(incidents.map(async (incident)=>{
            await IncidentService.acknowledge(incident, null, 'Zapier', true);
            const incidentObj = await IncidentService.findOneBy({_id: incident});
            let project = await ProjectService.findOneBy({_id: incidentObj.projectId});
            if(project.parentProjectId){
                project = await ProjectService.findOneBy({_id: project.parentProjectId._id});
            }
            zapierResponse.projectName = project.name;
            zapierResponse.projectId = project._id;
            incidentArr.push(incidentObj);
        }));
        zapierResponse.incidents = incidentArr;
        return zapierResponse;
    },

    resolveLastIncident: async function (monitors){
        let zapierResponse = {};
        let incidentArr = [];
        await Promise.all(monitors.map(async (monitor)=>{
            let lastIncident = await IncidentService.findOneBy({monitorId: monitor, resolved: false});
            lastIncident = await IncidentService.resolve(lastIncident._id, null, 'Zapier', true);
            const monitorObj = await MonitorService.findOneBy({_id: monitor});
            let project = await ProjectService.findOneBy({_id: monitorObj.project._id});
            if(project.parentProjectId){
                project = await ProjectService.findOneBy({_id: project.parentProjectId._id});
            }
            zapierResponse.projectName = project.name;
            zapierResponse.projectId = project._id;
            incidentArr.push(lastIncident);
        }));
        zapierResponse.incidents = incidentArr;
        return zapierResponse;
    },

    resolveAllIncidents: async function (monitors){
        let zapierResponse = {};
        let incidentArr = [];
        await Promise.all(monitors.map(async (monitor)=>{
            let incidents = await IncidentService.findBy({monitorId: monitor, resolved: false});
            incidents = await Promise.all(incidents.map(async (incident)=>{
                return await IncidentService.resolve(incident._id, null, 'Zapier', true);
            }));
            const monitorObj = await MonitorService.findOneBy({_id: monitor});
            let project = await ProjectService.findOneBy({_id: monitorObj.project._id});
            if(project.parentProjectId){
                project = await ProjectService.findOneBy({_id: project.parentProjectId._id});
            }
            zapierResponse.projectName = project.name;
            zapierResponse.projectId = project._id;
            incidentArr = incidents;
        }));
        zapierResponse.incidents = incidentArr;
        return zapierResponse;
    },

    resolveIncident: async function (incidents){
        let zapierResponse = {};
        let incidentArr = [];
        await Promise.all(incidents.map(async (incident)=>{
            await IncidentService.resolve(incident, null, 'Zapier', true);
            const incidentObj = await IncidentService.findOneBy({_id: incident});
            let project = await ProjectService.findOneBy({_id: incidentObj.projectId});
            if(project.parentProjectId){
                project = await ProjectService.findOneBy({_id: project.parentProjectId._id});
            }
            zapierResponse.projectName = project.name;
            zapierResponse.projectId = project._id;
            incidentArr.push(incidentObj);
        }));
        zapierResponse.incidents = incidentArr;
        return zapierResponse;
    },

    mapIncidentToResponse: async function (incident, incidentObj){
        try {
            if (incident) {
                if (incident.acknowledged) {
                    incidentObj.acknowledgedAt = incident.acknowledgedAt;
                    incidentObj.acknowledgedBy = incident.acknowledgedBy ? incident.acknowledgedBy.name : 'Fyipe';
                }
                if(incident.resolved){
                    incidentObj.resolvedAt = incident.resolvedAt;
                    incidentObj.resolvedBy = incident.resolvedBy ? incident.resolvedBy.name : 'Fyipe';
                }
                incidentObj.id = incident._id;
                incidentObj.incidentId = incident._id;
                incidentObj.acknowledged = incident.acknowledged;
                incidentObj.resolved = incident.resolved;
                incidentObj.internalNote = incident.internalNote;
                incidentObj.investigationNote = incident.investigationNote;
                incidentObj.createdAt = incident.createdAt;
                incidentObj.createdById = incident.createdById ? incident.createdById.name : 'Fyipe';
                var monitor = await MonitorService.findOneBy({ _id: incident.monitorId });
                incidentObj.monitorName = monitor.name;
                incidentObj.monitorType = monitor.type;
                incidentObj.monitorData = monitor.data[monitor.type];
                return (incidentObj);
            }
            else {
                return;
            }
        } catch (error) {
            ErrorService.log('ZapierService.mapIncidentToResponse', error);
            throw error;
        }
    },

    subscribe: async function (projectId, url, type, monitors) {
        try {
            var zapier = new ZapierModel();
            zapier.projectId = projectId;
            zapier.url = url;
            zapier.type = type;
            zapier.monitors = monitors;
            var zap = await zapier.save();
            return({ id: zap._id });
        } catch (error) {
            ErrorService.log('ZapierService.subscribe', error);
            throw error;
        }
    },

    unsubscribe: async function (id) {
        try {
            await ZapierModel.findOneAndUpdate({ _id: id }, 
                {
                    $set: {deleted: true} 
                }, 
                {
                    new: true
                });
            return;
        } catch (error) {
            ErrorService.log('ZapierService.unsubscribe', error);
            throw error;
        }
    },

    pushToZapier: async function (type, incident) {
        try {
            var _this = this;
            var projectId = incident.projectId._id || incident.projectId;
            var project = await ProjectService.findOneBy({_id: projectId});
            
            if (project.parentProjectId) {
                project = await ProjectService.findOneBy({_id: project.parentProjectId._id});
            }
            var zap = await _this.findBy({ projectId: project._id, type: type, $or: [{monitors: incident.monitorId._id},{monitors:[]}]});
            
            if (zap && zap.length) {
                zap.map(async z => {
                    var zapierResponse = {};
                    if (project) {
                        zapierResponse.projectName = project.name;
                        zapierResponse.projectId = project._id;
                        if (incident) {
                            zapierResponse = await _this.mapIncidentToResponse(incident, zapierResponse);
                            axios({
                                method: 'POST',
                                url: z.url,
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                data: JSON.stringify([zapierResponse])
                            });
                        }
    
                    }
    
                });
            }
        } catch (error) {
            ErrorService.log('ZapierService.pushToZapier', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query){
        try {
            await ZapierModel.deleteMany(query);
            return 'Zapier(s) removed successfully';
        } catch (error) {
            ErrorService.log('ZapierService.hardDeleteBy', error);
            throw error;
        }
    },
};

var axios = require('axios');
var ProjectService = require('./projectService');
var ErrorService = require('./errorService');
var IncidentService = require('./incidentService');
var MonitorService = require('./monitorService');
var ZapierModel = require('../models/zapier');
var IncidentModel = require('../models/incident');
var NotificationService = require('./notificationService');
var RealTimeService = require('./realTimeService');
