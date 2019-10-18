
module.exports = {

    findBy: async function (query, limit, skip) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof (skip) === 'string') skip = parseInt(skip);

        if (typeof (limit) === 'string') limit = parseInt(limit);

        if (!query) {
            query = {};
        }

        if(!query.deleted) query.deleted = false;
        try{
            var incidents = await IncidentModel.find(query)
                .limit(limit)
                .skip(skip)
                .populate('acknowledgedBy', 'name')
                .populate('monitorId', 'name')
                .populate('resolvedBy', 'name')
                .populate('createdById', 'name')
                .populate('probes.probeId', 'probeName')
                .sort({ createdAt: 'desc' });
        } catch (error) {
            ErrorService.log('IncidentModel.find', error);
            throw error;
        }

        return incidents;
    },

    create: async function (data) {
        var _this = this;
        //create a promise;
        try {
            var project = await ProjectService.findOneBy({ _id: data.projectId });
            var users = project && project.users && project.users.length ? project.users.map(({ userId }) => userId) : [];
        } catch (error) {
            ErrorService.log('ProjectService.findOneBy', error);
            throw error;
        }
        try {
            var monitorCount = await MonitorService.countBy({ _id: data.monitorId });
        } catch (error) {
            ErrorService.log('MonitorService.countBy', error);
            throw error;
        }
        if (monitorCount > 0) {
            var incident = new IncidentModel();
            incident.projectId = data.projectId || null;
            incident.monitorId = data.monitorId || null;
            incident.createdById = data.createdById || null;
            incident.notClosedBy = users;
            if (data.incidentType || data.type) {
                incident.incidentType = data.incidentType || data.type;
            }
            if (data.probeId) {
                incident.probes = [{
                    probeId: data.probeId,
                    updatedAt: Date.now(),
                    status: true
                }];
            }
            if (data.manuallyCreated) {
                incident.manuallyCreated = true;
            }
            else {
                incident.manuallyCreated = false;
            }
            if (data.type) {
                incident.type = data.type;
                await MonitorStatusService.create({
                    status: data.type,
                    monitorId: data.monitorId
                });
            }
            try {
                incident = await incident.save();
            } catch (error) {
                ErrorService.log('incident.save', error);
                throw error;
            }
            try {
                incident = await _this.findOneBy({ _id: incident._id });
            } catch (error) {
                ErrorService.log('IncidentService.findOneBy', error);
                throw error;
            }
            try {
                await _this._sendIncidentCreatedAlert(incident);
            } catch (error) {
                ErrorService.log('IncidentService._sendIncidentCreatedAlert', error);
                throw error;
            }
            return incident;

        } else {
            let error = new Error('Monitor is not present.');
            ErrorService.log('IncidentService.create', error);
            error.code = 400;

            throw error;
        }
    },

    countBy: async function (query) {
        if (!query) {
            query = {};
        }

        if(!query.deleted) query.deleted = false;
        try{
            var count = await IncidentModel.count(query);
        } catch (error) {
            ErrorService.log('IncidentModel.count', error);
            throw error;
        }

        return count;
    },

    deleteBy: async function (query, userId) {

        if (!query) {
            query = {};
        }

        query.deleted = false;
        try {
            var incidents = await IncidentModel.findOneAndUpdate(query, { $set: { deleted: true, deletedAt: Date.now(), deletedById: userId } });
        } catch (error) {
            ErrorService.log('IncidentModel.findOneAndUpdate', error);
            throw error;
        }

        return incidents;
    },

    // Description: Get Incident by incident Id.
    // Params:
    // Param 1: monitorId: monitor Id
    // Returns: promise with incident or error.
    findOneBy: async function (query) {

        if (!query) {
            query = {};
        }

        query.deleted = false;
        try {
            var incident = await IncidentModel.findOne(query)
                .populate('acknowledgedBy', 'name')
                .populate('monitorId', 'name')
                .populate('resolvedBy', 'name')
                .populate('createdById', 'name')
                .populate('probes.probeId', 'probeName');
        } catch (error) {
            ErrorService.log('IncidentModel.findOne', error);
            throw error;
        }
        return incident;
    },

    update: async function (data) {
        var _this = this;
        if (!data._id) {
            try {
                var incident = await _this.create(data);
            } catch (error) {
                ErrorService.log('IncidentService.create', error);
                throw error;
            }
            return incident;
        }else{
            try{
                var oldIncident = await _this.findOneBy({_id: data._id, deleted: { $ne: null }});
            }catch(error){
                ErrorService.log('IncidentService.findOneBy', error);
                throw error;
            }
            var projectId = data.projectId || oldIncident.projectId;
            var monitorId = data.monitorId || oldIncident.monitorId;
            var acknowledge = data.acknowledged || oldIncident.acknowledged;
            var acknowledgedBy = data.acknowledgedBy || oldIncident.acknowledgedBy;
            var acknowledgedAt = data.acknowledgedAt || oldIncident.acknowledgedAt;
            var resolved = data.resolved || oldIncident.resolved;
            var resolvedBy = data.resolvedBy || oldIncident.resolvedBy;
            var resolvedAt = data.resolvedAt || oldIncident.resolvedAt;
            var internalNote = data.internalNote || oldIncident.internalNote;
            var investigationNote = data.investigationNote || oldIncident.investigationNote;
            var createdById = data.createdById || oldIncident.createdById;
            var notClosedBy = oldIncident.notClosedBy;
            var acknowledgedByZapier = data.acknowledgedByZapier || oldIncident.acknowledgedByZapier;
            var resolvedByZapier = data.resolvedByZapier || oldIncident.resolvedByZapier;
            var createdByZapier = data.createdByZapier || oldIncident.createdByZapier;
            var incidentType = data.incidentType || oldIncident.incidentType;
            var probes = data.probes || oldIncident.probes;
            if (data.notClosedBy) {
                notClosedBy = notClosedBy.concat(data.notClosedBy);
            }
            var manuallyCreated = data.manuallyCreated || oldIncident.manuallyCreated || false;
            var deleted = oldIncident.deleted;
            var deletedById = oldIncident.deletedById;
            var deletedAt = oldIncident.deletedAt;

            if(data.deleted === false){
                deleted = false;
                deletedById = null;
                deletedAt = null;
            }
            try{
                var updatedIncident = await IncidentModel.findByIdAndUpdate(data._id, {
                    $set: {
                        projectId: projectId,
                        monitorId: monitorId,
                        acknowledged: acknowledge,
                        acknowledgedBy: acknowledgedBy,
                        acknowledgedAt: acknowledgedAt,
                        resolved: resolved,
                        resolvedBy: resolvedBy,
                        resolvedAt: resolvedAt,
                        internalNote: internalNote,
                        investigationNote: investigationNote,
                        createdById: createdById,
                        notClosedBy: notClosedBy,
                        manuallyCreated: manuallyCreated,
                        acknowledgedByZapier: acknowledgedByZapier,
                        resolvedByZapier: resolvedByZapier,
                        createdByZapier: createdByZapier,
                        incidentType,
                        probes,
                        deleted,
                        deletedById,
                        deletedAt
                    }
                }, { new: true });
            } catch (error) {
                ErrorService.log('IncidentModel.findByIdAndUpdate', error);
                throw error;
            }
            return updatedIncident;
        }
    },

    async _sendIncidentCreatedAlert(incident) {
        try {
            await AlertService.sendIncidentCreated(incident);
        } catch (error) {
            ErrorService.log('AlertService.sendIncidentCreated', error);
            throw error;
        }
        try {
            await AlertService.sendIncidentCreatedToSubscribers(incident);
        } catch (error) {
            ErrorService.log('AlertService.sendIncidentCreatedToSubscribers', error);
            throw error;
        }
        try {
            await ZapierService.pushToZapier('incident_created', incident);
        } catch (error) {
            ErrorService.log('ZapierService.pushToZapier', error);
            throw error;
        }
        try {
            await RealTimeService.sendIncidentCreated(incident);
        } catch (error) {
            ErrorService.log('RealTimeService.sendIncidentCreated', error);
            throw error;
        }
        if (!incident.createdById) {
            let msg = `A New Incident was created for ${incident.monitorId.name} by Fyipe`;
            let slackMsg = `A New Incident was created for *${incident.monitorId.name}* by *Fyipe*`;
            try {
                await NotificationService.create(incident.projectId, msg, 'fyipe', 'warning');
            } catch (error) {
                ErrorService.log('NotificationService.create', error);
                throw error;
            }
            try {
                // send slack notification
                await SlackService.sendNotification(incident.projectId, incident._id, null, slackMsg, false);
            } catch (error) {
                ErrorService.log('SlackService.sendNotification', error);
                throw error;
            }
            try {
                // Ping webhook
                await WebHookService.sendNotification(incident.projectId, msg, incident.monitorId);
            } catch (error) {
                ErrorService.log('WebHookService.sendNotification', error);
                throw error;
            }
        } else {
            let msg = `A New Incident was created for ${incident.monitorId.name} by ${incident.createdById.name}`;
            let slackMsg = `A New Incident was created for *${incident.monitorId.name}* by *${incident.createdById.name}*`;
            try {
                await NotificationService.create(incident.projectId, msg, incident.createdById.name, 'warning');
            } catch (error) {
                ErrorService.log('NotificationService.create', error);
                throw error;
            }
            try {
                // send slack notification
                await SlackService.sendNotification(incident.projectId, incident._id, null, slackMsg, false);
            } catch (error) {
                ErrorService.log('SlackService.sendNotification', error);
                throw error;
            }
            try {
                // Ping webhook
                await WebHookService.sendNotification(incident.projectId, msg, incident.monitorId);
            } catch (error) {
                ErrorService.log('WebHookService.sendNotification', error);
                throw error;
            }
        }
    },

    /**
     * @param {object} incidentId incident id
     * @param {string} userId Id of user performing the action.
     * @param {string} name Name of user performing the action.
     * @returns {object} Promise with incident or error.
     */
    acknowledge: async function (incidentId, userId, name, zapier) {
        var _this = this;
        try {
            var incident = await _this.findOneBy({ _id: incidentId, acknowledged: false });
        } catch (error) {
            ErrorService.log('IncidentService.findOneBy', error);
            throw error;
        }
        if (incident) {
            try {
                incident = await _this.update({
                    _id: incident._id,
                    acknowledged: true,
                    acknowledgedBy: userId,
                    acknowledgedAt: Date.now(),
                    acknowledgedByZapier: zapier
                });
            } catch (error) {
                ErrorService.log('IncidentService.update', error);
                throw error;
            }
            var downtime = (new Date().getTime() - new Date(incident.createdAt).getTime()) / (1000 * 60);
            var downtimestring = `${Math.ceil(downtime)} minutes`;
            if (downtime < 1) {
                downtimestring = 'less than a minute';
            }
            if (downtime > 60) {
                downtimestring = `${Math.floor(downtime / 60)} hours ${Math.floor(downtime % 60)} minutes`;
            }

            var msg = `${incident.monitorId.name} monitor was acknowledged by ${name}`;
            var slackMsg = `*${incident.monitorId.name}* monitor was acknowledged by *${name}* after being down for _${downtimestring}_`;

            try {
                // send slack notification
                await NotificationService.create(incident.projectId, `An Incident was acknowledged by ${name}`, userId, 'acknowledge');
            } catch (error) {
                ErrorService.log('NotificationService.create', error);
                throw error;
            }
            try {
                await SlackService.sendNotification(incident.projectId, incident._id, userId, slackMsg, incident);
            } catch (error) {
                ErrorService.log('SlackService.sendNotification', error);
                throw error;
            }
            try {
                // Ping webhook
                var monitor = await MonitorService.findOneBy({ _id: incident.monitorId });
            } catch (error) {
                ErrorService.log('MonitorService.findOneBy', error);
                throw error;
            }
            try {
                incident = await _this.findOneBy({ _id: incident._id });
            } catch (error) {
                ErrorService.log('IncidentService.this.findOneBy', error);
                throw error;
            }
            try {
                await WebHookService.sendNotification(incident.projectId, msg, monitor);
            } catch (error) {
                ErrorService.log('WebHookService.sendNotification', error);
                throw error;
            }
            try {
                await RealTimeService.incidentAcknowledged(incident);
            } catch (error) {
                ErrorService.log('RealTimeService.incidentAcknowledged', error);
                throw error;
            }
            try {
                await ZapierService.pushToZapier('incident_acknowledge', incident);
            } catch (error) {
                ErrorService.log('ZapierService.pushToZapier', error);
                throw error;
            }
        } else {
            try {
                incident = await _this.findOneBy({ _id: incidentId, acknowledged: true });
            } catch (error) {
                ErrorService.log('IncidentService.findOneBy', error);
                throw error;
            }
        }

        return incident;
    },

    // Description: Update user who resolved incident.
    // Params:
    // Param 1: data: {incidentId}
    // Returns: promise with incident or error.
    resolve: async function (incidentId, userId, name, zapier) {
        var _this = this;
        var data = {};

        try {
            var incident = await _this.findOneBy({ _id: incidentId });
        } catch (error) {
            ErrorService.log('IncidentService.findOneBy', error);
            throw error;
        }
        if (!incident.acknowledged) {
            data.acknowledged = true;
            data.acknowledgedBy = userId;
            data.acknowledgedAt = Date.now();
            data.acknowledgedByZapier = zapier;
        }
        data.resolved = true;
        data.resolvedBy = userId;
        data.resolvedAt = Date.now();
        data.resolvedByZapier = zapier;
        data._id = incidentId;
        try {
            incident = await _this.update(data);
        } catch (error) {
            ErrorService.log('IncidentService.update', error);
            throw error;
        }
        try {
            incident = await _this.findOneBy({ _id: incident._id });
        } catch (error) {
            ErrorService.log('IncidentService.findOneBy', error);
            throw error;
        }
        try {
            await _this.sendIncidentResolvedNotification(incident, name);
        } catch (error) {
            ErrorService.log('IncidentService.sendIncidentResolvedNotification', error);
            throw error;
        }
        try {
            await RealTimeService.incidentResolved(incident);
        } catch (error) {
            ErrorService.log('RealTimeService.incidentResolved', error);
            throw error;
        }
        try {
            await ZapierService.pushToZapier('incident_resolve', incident);
        } catch (error) {
            ErrorService.log('ZapierService.pushToZapier', error);
            throw error;
        }
        return incident;
    },

    //
    close: async function (incidentId, userId) {
        var incident = await IncidentModel.findByIdAndUpdate(incidentId, {
            $pull: { notClosedBy: userId }
        });
        return incident;
    },

    getUnresolvedIncidents: async function (subProjectIds, userId) {
        var _this = this;
        var incidentsUnresolved = await _this.findBy({ projectId: { $in: subProjectIds }, resolved: false });
        incidentsUnresolved = incidentsUnresolved.map(incident => {
            if (incident.notClosedBy.indexOf(userId) < 0) {
                return _this.update({ _id: incident._id, notClosedBy: [userId] });
            }
            else {
                return incident;
            }
        });
        await Promise.all(incidentsUnresolved);
        incidentsUnresolved = await _this.findBy({ projectId: { $in: subProjectIds }, resolved: false });
        var incidentsResolved = await _this.findBy({ projectId: { $in: subProjectIds }, resolved: true, notClosedBy: userId });

        return incidentsUnresolved.concat(incidentsResolved);
    },

    getSubProjectIncidents: async function (subProjectIds) {
        var _this = this;
        let subProjectIncidents = await Promise.all(subProjectIds.map(async (id) => {
            let incidents = await _this.findBy({ projectId: id }, 10, 0);
            let count = await _this.countBy({ projectId: id });
            return { incidents, count, _id: id, skip: 0, limit: 10 };
        }));
        return subProjectIncidents;
    },

    sendIncidentResolvedNotification: async function (incident, name) {
        var _this = this;
        try {
            var resolvedincident = await _this.findOneBy({ _id: incident._id });
        } catch (error) {
            ErrorService.log('IncidentService.findOneBy', error);
            throw error;
        }
        var downtime = (new Date().getTime() - new Date(resolvedincident.createdAt).getTime()) / (1000 * 60);
        var downtimestring = `${Math.ceil(downtime)} minutes`;
        var msg, slackMsg;
        if (downtime < 1) {
            downtimestring = 'less than a minute';
        }
        if (downtime > 60) {
            downtimestring = `${Math.floor(downtime / 60)} hours ${Math.floor(downtime % 60)} minutes`;
        }
        if (resolvedincident.resolvedBy) {
            msg = `${resolvedincident.monitorId.name} monitor was down for ${downtimestring} and is now resolved by ${name || resolvedincident.resolvedBy.name}`;
            slackMsg = `*${resolvedincident.monitorId.name}* monitor was down for _${downtimestring}_ and is now resolved by *${name || resolvedincident.resolvedBy.name}*`;
            try {
                await NotificationService.create(incident.projectId, msg, resolvedincident.resolvedBy._id, 'success');
            } catch (error) {
                ErrorService.log('NotificationService.create', error);
                throw error;
            }
            try {
                // send slack notification
                await SlackService.sendNotification(incident.projectId, incident._id, null, slackMsg, false);
            } catch (error) {
                ErrorService.log('SlackService.sendNotification', error);
                throw error;
            }
            try {
                // Ping webhook
                await WebHookService.sendNotification(incident.projectId, msg, resolvedincident.monitorId);
            } catch (error) {
                ErrorService.log('WebHookService.sendNotification', error);
                throw error;
            }
        }
        else {
            msg = `${resolvedincident.monitorId.name} monitor was down for ${downtimestring} and is now resolved by ${name || 'fyipe'}`;
            slackMsg = `*${resolvedincident.monitorId.name}* monitor was down for _${downtimestring}_ and is now resolved by *${name || 'fyipe'}*`;
            try {
                await NotificationService.create(incident.projectId, msg, 'fyipe', 'success');
            } catch (error) {
                ErrorService.log('NotificationService.create', error);
                throw error;
            }
            try {
                // send slack notification
                await SlackService.sendNotification(incident.projectId, incident._id, null, slackMsg, false);
            } catch (error) {
                ErrorService.log('SlackService.sendNotification', error);
                throw error;
            }
            try {
                // Ping webhook
                await WebHookService.sendNotification(incident.projectId, msg, resolvedincident.monitorId);
            } catch (error) {
                ErrorService.log('WebHookService.sendNotification', error);
                throw error;
            }
        }
    },
    
    getMonitorsWithIncidentsBy: async function (query) {
        var thisObj = this;
        var newmonitors = [];
        var limit = 3;
        try {
            var monitors = await MonitorService.findBy(query.query, query.limit, query.skip);
        } catch (error) {
            ErrorService.log('MonitorService.findBy', error);
            throw error;
        }
        if (monitors.length) {
            await Promise.all(monitors.map(async (element) => {
                if (element && element._doc) {
                    element = element._doc;
                }
                try {
                    var count = await thisObj.countBy({ monitorId: element._id });
                } catch (error) {
                    ErrorService.log('IncidentService.countBy', error);
                    throw error;
                }
                if (count && count._doc) {
                    count = count._doc;
                }
                try {
                    var inc = await thisObj.findBy({ monitorId: element._id }, limit);
                } catch (error) {
                    ErrorService.log('IncidentService.findBy', error);
                    throw error;
                }
                if (inc && inc._doc) {
                    inc = inc._doc;
                }
                element.probes = await ProbeService.getMonitorData(element._id || element.id);
                element.count = count;
                element.incidents = inc;
                element.skip = 0;
                element.limit = 3;
                newmonitors.push(element);
            }));
            return newmonitors;

        } else {
            return [];
        }
    },

    hardDeleteBy: async function (query) {
        try {
            await IncidentModel.deleteMany(query);
        } catch (error) {
            ErrorService.log('IncidentModel.deleteMany', error);
            throw error;
        }
        return 'Incident(s) removed successfully!';
    },

    restoreBy: async function(query){
        const _this = this;
        query.deleted = true;
        let incident = await _this.findBy(query);
        if(incident && incident.length > 1){
            const incidents = await Promise.all(incident.map(async (incident) => {
                const incidentId = incident._id;
                incident = await _this.update({
                    _id: incidentId,
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
                return incident;
            }));
            return incidents;
        }else{
            incident = incident[0];
            if(incident){
                const incidentId = incident._id;
                incident = await _this.update({
                    _id: incidentId,
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
            }
            return incident;
        }
    }
};

var IncidentModel = require('../models/incident');
var MonitorService = require('./monitorService');
var AlertService = require('./alertService');
var RealTimeService = require('./realTimeService');
var NotificationService = require('./notificationService');
var WebHookService = require('./webHookService');
var SlackService = require('./slackService');
var ZapierService = require('./zapierService');
var ProjectService = require('../services/projectService');
var ProbeService = require('../services/probeService');
var ErrorService = require('../services/errorService');
var MonitorStatusService = require('../services/monitorStatusService');