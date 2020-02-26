

module.exports = {

    findBy: async function (query, limit, skip) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof (skip) === 'string') skip = parseInt(skip);

            if (typeof (limit) === 'string') limit = parseInt(limit);

            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const incidents = await IncidentModel.find(query)
                .limit(limit)
                .skip(skip)
                .populate('acknowledgedBy', 'name')
                .populate('monitorId', 'name')
                .populate('resolvedBy', 'name')
                .populate('createdById', 'name')
                .populate('probes.probeId', 'probeName')
                .sort({ createdAt: 'desc' });
            return incidents;
        } catch (error) {
            ErrorService.log('incidentService.findBy', error);
            throw error;
        }
    },

    create: async function (data) {
        try {
            const _this = this;
            //create a promise;
            const project = await ProjectService.findOneBy({ _id: data.projectId });
            const users = project && project.users && project.users.length ? project.users.map(({ userId }) => userId) : [];
            const monitorCount = await MonitorService.countBy({ _id: data.monitorId });

            if (monitorCount > 0) {
                let incident = new IncidentModel();

                incident.projectId = data.projectId || null;
                incident.monitorId = data.monitorId || null;
                incident.createdById = data.createdById || null;
                incident.notClosedBy = users;
                incident.incidentType = data.incidentType;
                incident.manuallyCreated = data.manuallyCreated || false;

                if (data.probeId) {
                    incident.probes = [{
                        probeId: data.probeId,
                        updatedAt: Date.now(),
                        status: true,
                        reportedStatus: data.incidentType
                    }];
                }

                incident = await incident.save();
                incident = await _this.findOneBy({ _id: incident._id });
                await _this._sendIncidentCreatedAlert(incident);

                await IncidentTimelineService.create({
                    incidentId: incident._id,
                    createdById: data.createdById,
                    probeId: data.probeId,
                    status: data.incidentType
                });

                return incident;
            } else {
                const error = new Error('Monitor is not present.');
                ErrorService.log('incidentService.create', error);
                error.code = 400;
                throw error;
            }
        } catch (error) {
            ErrorService.log('incidentService.create', error);
            throw error;
        }
    },

    countBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const count = await IncidentModel.count(query);
            return count;
        } catch (error) {
            ErrorService.log('incidentService.countBy', error);
            throw error;
        }
    },

    deleteBy: async function (query, userId) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const incidents = await IncidentModel.findOneAndUpdate(query, { $set: { deleted: true, deletedAt: Date.now(), deletedById: userId } });
            return incidents;
        } catch (error) {
            ErrorService.log('incidentService.findOneAndUpdate', error);
            throw error;
        }
    },

    // Description: Get Incident by incident Id.
    // Params:
    // Param 1: monitorId: monitor Id
    // Returns: promise with incident or error.
    findOneBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const incident = await IncidentModel.findOne(query)
                .populate('acknowledgedBy', 'name')
                .populate('monitorId', 'name')
                .populate('resolvedBy', 'name')
                .populate('createdById', 'name')
                .populate('probes.probeId', 'probeName');
            return incident;
        } catch (error) {
            ErrorService.log('incidentService.findOne', error);
            throw error;
        }
    },

    updateOneBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const _this = this;
            const oldIncident = await _this.findOneBy({ _id: query._id, deleted: { $ne: null } });

            const notClosedBy = oldIncident.notClosedBy;
            if (data.notClosedBy) {
                data.notClosedBy = notClosedBy.concat(data.notClosedBy);
            }
            data.manuallyCreated = data.manuallyCreated || oldIncident.manuallyCreated || false;

            const updatedIncident = await IncidentModel.findOneAndUpdate(query, {
                $set: data
            }, { new: true });
            return updatedIncident;
        } catch (error) {
            ErrorService.log('incidentService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedData = await IncidentModel.updateMany(query, {
                $set: data
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('incidentService.updateMany', error);
            throw error;
        }
    },

    async _sendIncidentCreatedAlert(incident) {
        try {
            await AlertService.sendCreatedIncident(incident);
            await AlertService.sendCreatedIncidentToSubscribers(incident);
            await ZapierService.pushToZapier('incident_created', incident);
            await RealTimeService.sendCreatedIncident(incident);

            if (!incident.createdById) {
                const msg = `A New Incident was created for ${incident.monitorId.name} by Fyipe`;
                const slackMsg = `A New Incident was created for *${incident.monitorId.name}* by *Fyipe*`;
                await NotificationService.create(incident.projectId, msg, 'fyipe', 'warning');
                // send slack notification
                await SlackService.sendNotification(incident.projectId, incident._id, null, slackMsg, false);
                // Ping webhook
                await WebHookService.sendNotification(incident.projectId, incident, incident.monitorId, 'created');
            } else {
                const msg = `A New Incident was created for ${incident.monitorId.name} by ${incident.createdById.name}`;
                const slackMsg = `A New Incident was created for *${incident.monitorId.name}* by *${incident.createdById.name}*`;
                await NotificationService.create(incident.projectId, msg, incident.createdById.name, 'warning');
                // send slack notification
                await SlackService.sendNotification(incident.projectId, incident._id, null, slackMsg, false);
                // Ping webhook
                await WebHookService.sendNotification(incident.projectId, incident, incident.monitorId, 'created');
            }
        } catch (error) {
            ErrorService.log('incidentService._sendIncidentCreatedAlert', error);
            throw error;
        }
    },

    /**
     * @param {object} incidentId incident id
     * @param {string} userId Id of user performing the action.
     * @param {string} name Name of user performing the action.
     * @returns {object} Promise with incident or error.
     */
    acknowledge: async function (incidentId, userId, name, probeId, zapier) {
        try {
            const _this = this;
            let incident = await _this.findOneBy({ _id: incidentId, acknowledged: false });
            if (incident) {
                incident = await _this.updateOneBy({
                    _id: incident._id
                }, {
                    acknowledged: true,
                    acknowledgedBy: userId,
                    acknowledgedAt: Date.now(),
                    acknowledgedByZapier: zapier
                });
                const downtime = (new Date().getTime() - new Date(incident.createdAt).getTime()) / (1000 * 60);
                let downtimestring = `${Math.ceil(downtime)} minutes`;
                if (downtime < 1) {
                    downtimestring = 'less than a minute';
                }
                if (downtime > 60) {
                    downtimestring = `${Math.floor(downtime / 60)} hours ${Math.floor(downtime % 60)} minutes`;
                }

                const slackMsg = `*${incident.monitorId.name}* monitor was acknowledged by *${name}* after being down for _${downtimestring}_`;

                // send slack notification
                await NotificationService.create(incident.projectId, `An Incident was acknowledged by ${name}`, userId, 'acknowledge');
                await SlackService.sendNotification(incident.projectId, incident._id, userId, slackMsg, incident);
                // Ping webhook
                const monitor = await MonitorService.findOneBy({ _id: incident.monitorId });
                incident = await _this.findOneBy({ _id: incident._id });

                await IncidentTimelineService.create({
                    incidentId: incidentId,
                    createdById: userId,
                    probeId: probeId,
                    createdByZapier: zapier,
                    status: 'acknowledged'
                });

                await AlertService.sendAcknowledgedIncidentToSubscribers(incident);

                await WebHookService.sendNotification(incident.projectId, incident, monitor, 'acknowledged');
                await RealTimeService.incidentAcknowledged(incident);
                await ZapierService.pushToZapier('incident_acknowledge', incident);
            } else {
                incident = await _this.findOneBy({ _id: incidentId, acknowledged: true });
            }

            return incident;
        } catch (error) {
            ErrorService.log('incidentService.acknowledge', error);
            throw error;
        }
    },

    // Description: Update user who resolved incident.
    // Params:
    // Param 1: data: {incidentId}
    // Returns: promise with incident or error.
    resolve: async function (incidentId, userId, name, probeId, zapier) {
        try {
            const _this = this;
            const data = {};
            let incident = await _this.findOneBy({ _id: incidentId });

            if (!incident) {
                return;
            }

            if (!incident.acknowledged) {
                data.acknowledged = true;
                data.acknowledgedBy = userId;
                data.acknowledgedAt = Date.now();
                data.acknowledgedByZapier = zapier;

                await IncidentTimelineService.create({
                    incidentId: incidentId,
                    createdById: userId,
                    probeId: probeId,
                    createdByZapier: zapier,
                    status: 'acknowledged'
                });
            }
            data.resolved = true;
            data.resolvedBy = userId;
            data.resolvedAt = Date.now();
            data.resolvedByZapier = zapier;

            incident = await _this.updateOneBy({ _id: incidentId }, data);
            incident = await _this.findOneBy({ _id: incident._id });

            if (incident.probes && incident.probes.length > 0) {
                incident.probes.forEach(async probe => {
                    await MonitorStatusService.create({
                        monitorId: incident.monitorId._id,
                        probeId: probe.probeId._id,
                        manuallyCreated: userId ? true : false,
                        status: 'online'
                    });
                });
            } else {
                await MonitorStatusService.create({
                    monitorId: incident.monitorId._id,
                    probeId,
                    manuallyCreated: userId ? true : false,
                    status: 'online'
                });
            }

            await IncidentTimelineService.create({
                incidentId: incidentId,
                createdById: userId,
                probeId: probeId,
                createdByZapier: zapier,
                status: 'resolved'
            });

            await _this.sendIncidentResolvedNotification(incident, name);
            await RealTimeService.incidentResolved(incident);
            await ZapierService.pushToZapier('incident_resolve', incident);

            return incident;
        } catch (error) {
            ErrorService.log('incidentService.resolve', error);
            throw error;
        }
    },

    //
    close: async function (incidentId, userId) {
        try {
            const incident = await IncidentModel.findByIdAndUpdate(incidentId, {
                $pull: { notClosedBy: userId }
            });

            return incident;
        } catch (error) {
            ErrorService.log('incidentService.close', error);
            throw error;
        }
    },

    getUnresolvedIncidents: async function (subProjectIds, userId) {
        const _this = this;
        let incidentsUnresolved = await _this.findBy({ projectId: { $in: subProjectIds }, resolved: false });
        incidentsUnresolved = incidentsUnresolved.map(incident => {
            if (incident.notClosedBy.indexOf(userId) < 0) {
                return _this.updateOneBy({ _id: incident._id }, { notClosedBy: [userId] });
            }
            else {
                return incident;
            }
        });
        await Promise.all(incidentsUnresolved);
        incidentsUnresolved = await _this.findBy({ projectId: { $in: subProjectIds }, resolved: false });
        const incidentsResolved = await _this.findBy({ projectId: { $in: subProjectIds }, resolved: true, notClosedBy: userId });

        return incidentsUnresolved.concat(incidentsResolved);
    },

    getSubProjectIncidents: async function (subProjectIds) {
        const _this = this;
        const subProjectIncidents = await Promise.all(subProjectIds.map(async (id) => {
            const incidents = await _this.findBy({ projectId: id }, 10, 0);
            const count = await _this.countBy({ projectId: id });
            return { incidents, count, _id: id, skip: 0, limit: 10 };
        }));
        return subProjectIncidents;
    },

    sendIncidentResolvedNotification: async function (incident, name) {
        try {
            const _this = this;
            const resolvedincident = await _this.findOneBy({ _id: incident._id });
            const downtime = (new Date().getTime() - new Date(resolvedincident.createdAt).getTime()) / (1000 * 60);
            let downtimestring = `${Math.ceil(downtime)} minutes`;
            let msg, slackMsg;
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
                await WebHookService.sendNotification(incident.projectId, incident, resolvedincident.monitorId, 'resolved');
                await AlertService.sendResolvedIncidentToSubscribers(incident);
            }
            else {
                msg = `${resolvedincident.monitorId.name} monitor was down for ${downtimestring} and is now resolved by ${name || 'fyipe'}`;
                slackMsg = `*${resolvedincident.monitorId.name}* monitor was down for _${downtimestring}_ and is now resolved by *${name || 'fyipe'}*`;

                await NotificationService.create(incident.projectId, msg, 'fyipe', 'success');
                // send slack notification
                await SlackService.sendNotification(incident.projectId, incident._id, null, slackMsg, false);
                // Ping webhook
                await WebHookService.sendNotification(incident.projectId, incident, resolvedincident.monitorId, 'resolved');
                await AlertService.sendResolvedIncidentToSubscribers(incident);
            }
        } catch (error) {
            ErrorService.log('incidentService.sendIncidentResolvedNotification', error);
            throw error;
        }
    },

    hardDeleteBy: async function (query) {
        try {
            await IncidentModel.deleteMany(query);
            return 'Incident(s) removed successfully!';
        } catch (error) {
            ErrorService.log('incidentService.deleteMany', error);
            throw error;
        }
    },

    restoreBy: async function (query) {
        const _this = this;
        query.deleted = true;
        let incident = await _this.findBy(query);
        if (incident && incident.length > 1) {
            const incidents = await Promise.all(incident.map(async (incident) => {
                const incidentId = incident._id;
                incident = await _this.updateOneBy({
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
                incident = await _this.updateOneBy({
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

const IncidentModel = require('../models/incident');
const IncidentTimelineService = require('./incidentTimelineService');
const MonitorService = require('./monitorService');
const AlertService = require('./alertService');
const RealTimeService = require('./realTimeService');
const NotificationService = require('./notificationService');
const WebHookService = require('./webHookService');
const SlackService = require('./slackService');
const ZapierService = require('./zapierService');
const ProjectService = require('./projectService');
const ErrorService = require('./errorService');
const MonitorStatusService = require('./monitorStatusService');


