
module.exports = {

    findBy: async function (query, limit, skip) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof (skip) === 'string') skip = parseInt(skip);

        if (typeof (limit) === 'string') limit = parseInt(limit);

        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        try {
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
            var monitorCount = await MonitorService.countBy({ _id: data.monitorId });

            if (monitorCount > 0) {
                var incident = new IncidentModel();
                incident.projectId = data.projectId || null;
                incident.monitorId = data.monitorId || null;
                incident.createdById = data.createdById || null;
                incident.notClosedBy = users;
                if (data.incidentType) {
                    incident.incidentType = data.incidentType;
                    MonitorStatusService.create({
                        status: data.incidentType,
                        monitorId: data.monitorId
                    });
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
                incident = await incident.save();
                incident = await _this.findOneBy({ _id: incident._id });
                await _this._sendIncidentCreatedAlert(incident);

                return incident;
            } else {
                let error = new Error('Monitor is not present.');
                ErrorService.log('IncidentService.create', error);
                error.code = 400;

                throw error;
            }
        } catch (error) {
            if (error.message.indexOf('at path "_id" for model "Monitor"') !== -1) {
                ErrorService.log('MonitorService.countBy', error);
            } else if (error.message.indexOf('at path "_id" for model "Project"') !== -1) {
                ErrorService.log('ProjectService.findOneBy', error);
            } else {
                ErrorService.log('IncidentService.create', error);
            }
            throw error;
        }
    },

    countBy: async function (query) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        try {
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

    updateBy: async function (query, data) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        var _this = this;
        try {
            var oldIncident = await _this.findOneBy({ _id: query._id, deleted: { $ne: null } });

            var notClosedBy = oldIncident.notClosedBy;
            if (data.notClosedBy) {
                data.notClosedBy = notClosedBy.concat(data.notClosedBy);
            }
            data.manuallyCreated = data.manuallyCreated || oldIncident.manuallyCreated || false;

            var updatedIncident = await IncidentModel.findOneAndUpdate(query, {
                $set: data
            }, { new: true });
        } catch (error) {
            ErrorService.log('IncidentModel.findOneAndUpdate', error);
            throw error;
        }
        return updatedIncident;
    },

    async _sendIncidentCreatedAlert(incident) {
        try {
            await AlertService.sendIncidentCreated(incident);
            await AlertService.sendIncidentCreatedToSubscribers(incident);
            await ZapierService.pushToZapier('incident_created', incident);
            await RealTimeService.sendIncidentCreated(incident);

            if (!incident.createdById) {
                let msg = `A New Incident was created for ${incident.monitorId.name} by Fyipe`;
                let slackMsg = `A New Incident was created for *${incident.monitorId.name}* by *Fyipe*`;
                await NotificationService.create(incident.projectId, msg, 'fyipe', 'warning');
                // send slack notification
                await SlackService.sendNotification(incident.projectId, incident._id, null, slackMsg, false);
                // Ping webhook
                await WebHookService.sendNotification(incident.projectId, msg, incident.monitorId);
            } else {
                let msg = `A New Incident was created for ${incident.monitorId.name} by ${incident.createdById.name}`;
                let slackMsg = `A New Incident was created for *${incident.monitorId.name}* by *${incident.createdById.name}*`;
                await NotificationService.create(incident.projectId, msg, incident.createdById.name, 'warning');
                // send slack notification
                await SlackService.sendNotification(incident.projectId, incident._id, null, slackMsg, false);
                // Ping webhook
                await WebHookService.sendNotification(incident.projectId, msg, incident.monitorId);
            }
        } catch (error) {
            if (error.message.indexOf('Notification') !== -1) {
                ErrorService.log('NotificationService.create', error);
            } else if (error.message.indexOf('Slack') !== -1) {
                ErrorService.log('SlackService.sendNotification', error);
            } else if (error.message.indexOf('WebHook') !== -1) {
                ErrorService.log('WebHookService.sendNotification', error);
            } else if (error.message.indexOf('for model "Zapier"') !== -1) {
                ErrorService.log('ZapierService.pushToZapier', error);
            } else {
                ErrorService.log('IncidentService._sendIncidentCreatedAlert', error);
            }
            throw error;
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
            if (incident) {
                incident = await _this.updateBy({
                    _id: incident._id
                }, {
                    acknowledged: true,
                    acknowledgedBy: userId,
                    acknowledgedAt: Date.now(),
                    acknowledgedByZapier: zapier
                });
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

                // send slack notification
                await NotificationService.create(incident.projectId, `An Incident was acknowledged by ${name}`, userId, 'acknowledge');
                await SlackService.sendNotification(incident.projectId, incident._id, userId, slackMsg, incident);
                // Ping webhook
                var monitor = await MonitorService.findOneBy({ _id: incident.monitorId });
                incident = await _this.findOneBy({ _id: incident._id });

                await WebHookService.sendNotification(incident.projectId, msg, monitor);
                await RealTimeService.incidentAcknowledged(incident);
                await ZapierService.pushToZapier('incident_acknowledge', incident);
            } else {
                incident = await _this.findOneBy({ _id: incidentId, acknowledged: true });
            }
        } catch (error) {
            if (error.message.indexOf('Notification') !== -1) {
                ErrorService.log('NotificationService.create', error);
            } else if (error.message.indexOf('Slack') !== -1) {
                ErrorService.log('SlackService.sendNotification', error);
            } else if (error.message.indexOf('WebHook') !== -1) {
                ErrorService.log('WebHookService.sendNotification', error);
            } else if (error.message.indexOf('for model "Zapier"') !== -1) {
                ErrorService.log('ZapierService.pushToZapier', error);
            } else {
                ErrorService.log('IncidentService.acknowledge', error);
            }
            throw error;
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

            incident = await _this.updateBy({ _id: incidentId }, data);
            incident = await _this.findOneBy({ _id: incident._id });

            await _this.sendIncidentResolvedNotification(incident, name);
            await RealTimeService.incidentResolved(incident);
            await ZapierService.pushToZapier('incident_resolve', incident);
        } catch (error) {
            ErrorService.log('IncidentService.resolve', error);
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
                return _this.updateBy({ _id: incident._id }, { notClosedBy: [userId] });
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

                await NotificationService.create(incident.projectId, msg, resolvedincident.resolvedBy._id, 'success');
                // send slack notification
                await SlackService.sendNotification(incident.projectId, incident._id, null, slackMsg, false);
                // Ping webhook
                await WebHookService.sendNotification(incident.projectId, msg, resolvedincident.monitorId);
            }
            else {
                msg = `${resolvedincident.monitorId.name} monitor was down for ${downtimestring} and is now resolved by ${name || 'fyipe'}`;
                slackMsg = `*${resolvedincident.monitorId.name}* monitor was down for _${downtimestring}_ and is now resolved by *${name || 'fyipe'}*`;

                await NotificationService.create(incident.projectId, msg, 'fyipe', 'success');
                // send slack notification
                await SlackService.sendNotification(incident.projectId, incident._id, null, slackMsg, false);
                // Ping webhook
                await WebHookService.sendNotification(incident.projectId, msg, resolvedincident.monitorId);
            }
        } catch (error) {
            if (error.message.indexOf('Notification') !== -1) {
                ErrorService.log('NotificationService.create', error);
            } else if (error.message.indexOf('Slack') !== -1) {
                ErrorService.log('SlackService.sendNotification', error);
            } else if (error.message.indexOf('WebHook') !== -1) {
                ErrorService.log('WebHookService.sendNotification', error);
            } else if (error.message.indexOf('for model "Zapier"') !== -1) {
                ErrorService.log('ZapierService.pushToZapier', error);
            } else {
                ErrorService.log('IncidentService.sendIncidentResolvedNotification', error);
            }
            throw error;
        }
    },

    getMonitorsWithIncidentsBy: async function (query) {
        var thisObj = this;
        var newmonitors = [];
        var limit = 3;
        try {
            var monitors = await MonitorService.findBy(query.query, query.limit, query.skip);

            if (monitors.length) {
                await Promise.all(monitors.map(async (element) => {
                    if (element && element._doc) {
                        element = element._doc;
                    }
                    var count = await thisObj.countBy({ monitorId: element._id });

                    if (count && count._doc) {
                        count = count._doc;
                    }
                    var inc = await thisObj.findBy({ monitorId: element._id }, limit);
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
        } catch (error) {
            if (error.message.indexOf('for model "Monitor"') !== -1) {
                ErrorService.log('MonitorService.findBy', error);
            } else {
                ErrorService.log('IncidentService.getMonitorsWithIncidentsBy', error);
            }
            throw error;
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

    restoreBy: async function (query) {
        const _this = this;
        query.deleted = true;
        let incident = await _this.findBy(query);
        if (incident && incident.length > 1) {
            const incidents = await Promise.all(incident.map(async (incident) => {
                const incidentId = incident._id;
                incident = await _this.updateBy({
                    _id: incidentId
                }, {
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
                return incident;
            }));
            return incidents;
        } else {
            incident = incident[0];
            if (incident) {
                const incidentId = incident._id;
                incident = await _this.updateBy({
                    _id: incidentId
                }, {
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