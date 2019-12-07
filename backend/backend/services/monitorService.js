module.exports = {
    //Description: Upsert function for monitor.
    //Params:
    //Param 1: data: MonitorModal.
    //Returns: promise with monitor model or error.
    create: async function (data) {
        var _this = this;
        var subProject = null;
        try {
            var project = await ProjectService.findOneBy({ _id: data.projectId });
            if (project.parentProjectId) {
                subProject = project;
                project = await ProjectService.findOneBy({ _id: subProject.parentProjectId });
            }
            var subProjectIds = [];
            var subProjects = await ProjectService.findBy({ parentProjectId: project._id });
            if (subProjects && subProjects.length > 0) {
                subProjectIds = subProjects.map(project => project._id);
            }
            subProjectIds.push(project._id);
            var count = await _this.countBy({ projectId: { $in: subProjectIds } });
            var monitorCategory = await MonitorCategoryService.findBy({ _id: data.monitorCategoryId });
            var plan = await Plans.getPlanById(project.stripePlanId);
            var projectSeats = project.seats;
            if (typeof (projectSeats) === 'string') {
                projectSeats = parseInt(projectSeats);
            }
            if (!plan) {
                let error = new Error('Invalid project plan.');
                error.code = 400;
                ErrorService.log('MonitorService.create', error);
                throw error;
            }
            else {
                if (count < (projectSeats * 5)) {
                    var monitor = new MonitorModel();
                    monitor.name = data.name;
                    monitor.type = data.type;
                    monitor.createdById = data.createdById;
                    if (data.type === 'url' || data.type === 'api') {
                        monitor.data = {};
                        monitor.data.url = data.data.url;
                    } else if (data.type === 'manual') {
                        monitor.data = {};
                        monitor.data.description = data.data.description || null;
                    } else if (data.type === 'device') {
                        monitor.data = {};
                        monitor.data.deviceId = data.data.deviceId;
                    } else if (data.type === 'script') {
                        monitor.data = {};
                        monitor.data.script = data.data.script;
                    }
                    if (monitorCategory) {
                        monitor.monitorCategoryId = data.monitorCategoryId;
                    }
                    monitor.visibleOnStatusPage = data.visibleOnStatusPage;
                    monitor.projectId = data.projectId;
                    if (data.type === 'url' || data.type === 'api' || data.type === 'server-monitor' || data.type === 'script') {
                        monitor.criteria = _.isEmpty(data.criteria) ? MonitorCriteriaService.create(data.type) : data.criteria;
                    }
                    if (data.type === 'api') {
                        if (data.method && data.method.length) monitor.method = data.method;
                        if (data.bodyType && data.bodyType.length) monitor.bodyType = data.bodyType;
                        if (data.text && data.text.length) monitor.text = data.text;
                        if (data.formData && data.formData.length) monitor.formData = data.formData;
                        if (data.headers && data.headers.length) monitor.headers = data.headers;
                    }
                    var savedMonitor = await monitor.save();
                    var fetchedMonitor = await IncidentService.getMonitorsWithIncidentsBy({
                        query: { _id: savedMonitor._id },
                        skip: 0,
                        limit: 0
                    });
                    return fetchedMonitor;
                }
                else {
                    let error = new Error('You can\'t add any more monitors. Please add an extra seat to add more monitors.');
                    error.code = 400;
                    ErrorService.log('MonitorService.create', error);
                    throw error;
                }
            }
        } catch (error) {
            if (error.message.indexOf('for model "MonitorCategory"') !== -1) {
                ErrorService.log('MonitorCategory.findBy', error);
            } else if (error.message.indexOf('for model "Alert"') !== -1) {
                ErrorService.log('AlertService.findBy', error);
            } else if (error.message.indexOf('for model "Incident"') !== -1) {
                ErrorService.log('IncidentService.findBy', error);
            } else {
                ErrorService.log('MonitorService.create', error);
            }
            throw error;
        }
    },

    update: async function (query, data) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;

        try {
            var monitor = await MonitorModel.findOneAndUpdate(query,
                { $set: data },
                {
                    new: true
                })
                .populate('projectId', 'name');
            monitor = await IncidentService.getMonitorsWithIncidentsBy({
                query: { _id: monitor._id },
                skip: 0,
                limit: 0
            });
            await RealTimeService.monitorEdit(monitor);
        } catch (error) {
            ErrorService.log('MonitorService.update', error);
            throw error;
        }

        return monitor;
    },

    //Description: Gets all monitors by project.
    //Params:
    //Param 1: data: MonitorModal.
    //Returns: promise with monitor model or error.
    async findBy(query, limit, skip) {

        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof (skip) === 'string') {
            skip = parseInt(skip);
        }

        if (typeof (limit) === 'string') {
            limit = parseInt(limit);
        }

        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        try {
            var monitors = await MonitorModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name');
        } catch (error) {
            ErrorService.log('MonitorModel.find', error);
            throw error;
        }
        return monitors;
    },

    async findOneBy(query) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        try {
            var monitor = await MonitorModel.findOne(query)
                .populate('projectId', 'name');
        } catch (error) {
            ErrorService.log('MonitorModel.findOne', error);
            throw error;
        }
        return monitor;
    },

    async countBy(query) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        try {
            var count = await MonitorModel.count(query)
                .populate('project', 'name');
        } catch (error) {
            ErrorService.log('MonitorModel.count', error);
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
            var monitor = await MonitorModel.findOneAndUpdate(query, { $set: { deleted: true, deletedAt: Date.now(), deletedById: userId } }, { new: true }).populate('deletedById', 'name');

            if (monitor) {
                var subProject = null;
                var project = await ProjectService.findOneBy({ _id: monitor.projectId });
                if (project.parentProjectId) {
                    subProject = project;
                    project = await ProjectService.findOneBy({ _id: subProject.parentProjectId });
                }

                var subProjectIds = [];
                var subProjects = await ProjectService.findBy({ parentProjectId: project._id });
                if (subProjects && subProjects.length > 0) {
                    subProjectIds = subProjects.map(project => project._id);
                }
                subProjectIds.push(project._id);
                var monitorsCount = await this.countBy({ projectId: { $in: subProjectIds } });
                var projectSeats = project.seats;
                if (typeof (projectSeats) === 'string') {
                    projectSeats = parseInt(projectSeats);
                }
                var projectUsers = await TeamService.getTeamMembersBy({ parentProjectId: project._id });            // eslint-disable-next-line no-console
                var seats = await TeamService.getSeats(projectUsers);
                // check if project seats are more based on users in project or by count of monitors
                if (projectSeats && projectSeats > seats && monitorsCount > 0 && monitorsCount <= ((projectSeats - 1) * 5)) {
                    projectSeats = projectSeats - 1;
                    await PaymentService.changeSeats(project.stripeSubscriptionId, (projectSeats));
                    await ProjectService.update({ _id: project._id, seats: projectSeats.toString() });
                }
                var incidents = await IncidentService.findBy({ monitorId: monitor._id });

                await Promise.all(incidents.map(async (incident) => {
                    await IncidentService.deleteBy({ _id: incident._id }, userId);
                }));
                var alerts = await AlertService.findBy({ monitorId: monitor._id }, userId);

                await Promise.all(alerts.map(async (alert) => {
                    await AlertService.deleteBy({ _id: alert._id }, userId);
                }));
                await StatusPageService.removeMonitor(monitor._id);
                await ScheduleService.removeMonitor(monitor._id);
                await IntegrationService.removeMonitor(monitor._id);
                await NotificationService.create(monitor.projectId, `A Monitor ${monitor.name} was deleted from the project by ${monitor.deletedById.name}`, monitor.deletedById._id, 'monitoraddremove');
                await RealTimeService.sendMonitorDelete(monitor);

                return monitor;
            } else {
                return null;
            }
        } catch (error) {
            if (error.message.indexOf('for model "Notification"') !== -1) {
                ErrorService.log('NotificationService.create', error);
            } else if (error.message.indexOf('for model "Alert"') !== -1) {
                ErrorService.log('AlertService.findBy', error);
            } else if (error.message.indexOf('for model "Incident"') !== -1) {
                ErrorService.log('IncidentService.findBy', error);
            } else {
                ErrorService.log('MonitorService.deleteBy', error);
            }
            throw error;
        }
    },

    async getMonitors(subProjectIds, skip, limit) {
        if (typeof skip === 'string') skip = parseInt(skip);
        if (typeof limit === 'string') limit = parseInt(limit);
        var _this = this;
        let subProjectMonitors = await Promise.all(subProjectIds.map(async (id) => {
            let monitors = await IncidentService.getMonitorsWithIncidentsBy({
                query: { projectId: id },
                skip,
                limit
            });
            let count = await _this.countBy({ projectId: id });
            return { monitors, count, _id: id, skip, limit };
        }));
        return subProjectMonitors;
    },

    async getProbeMonitors(date) {
        var newdate = new Date();
        try {
            var monitors = await MonitorModel.find({ 'pollTime': { $lt: date }, deleted: false });
            if (monitors && monitors.length) {
                await MonitorModel.update(
                    { 'pollTime': { $lt: date }, deleted: false },
                    { $set: { 'pollTime': newdate } },
                    { multi: true }
                );
                return monitors;
            }
            else {
                return [];
            }
        } catch (error) {
            ErrorService.log('MonitorModel.getProbeMonitors', error);
            throw error;
        }
    },

    async updateMonitorPingTime(id) {
        var newdate = new Date();
        var thisObj = this;
        try {
            var monitors = await thisObj.update({
                _id: id, deleted: false
            }, { $set: { 'lastPingTime': newdate } }, { multi: false });
        } catch (error) {
            ErrorService.log('MonitorService.update', error);
            throw error;
        }
        if (monitors.length > 0) {
            return (monitors[0]);
        } else {
            return (null);
        }
    },

    async updateDeviceMonitorPingTime(projectId, deviceId) {
        var thisObj = this;
        try {
            var monitor = thisObj.findOneBy({ projectId: projectId, deviceId: deviceId });
            if (!monitor) {
                let error = new Error('Monitor with this Device ID not found in this Project.');
                error.code = 400;
                ErrorService.log('MonitorService.updateDeviceMonitorPingTime', error);
                throw error;
            } else {
                monitor = await thisObj.updateMonitorPingTime(monitor._id);
                return monitor;
            }
        } catch (error) {
            ErrorService.log('MonitoService.updateDeviceMonitorPingTime', error);
            throw error;
        }
    },

    async getMonitorLogs(monitorId, startDate, endDate) {
        try {
            var monitorData = await MonitorLogModel.find({ monitorId: monitorId, createdAt: { $gte: startDate, $lte: endDate } })
                .sort([['createdAt', -1]]);
        } catch (error) {
            ErrorService.log('monitorLogModel.find', error);
            throw error;
        }

        return monitorData;
    },

    async sendResponseTime(monitorsData) {
        try {
            var monitor = await MonitorModel.findOne({ _id: monitorsData.monitorId, deleted: false });
            if (monitor) {
                await RealTimeService.updateResponseTime(monitorsData, monitor.projectId);
            }
        } catch (error) {
            if (error.message.indexOf('for model "Monitor"') !== -1) {
                ErrorService.log('MonitorModel.findOne', error);
            } else {
                ErrorService.log('RealTimeService.sendResponseTime', error);
            }
            throw error;
        }
    },

    async sendMonitorLog(data) {
        try {
            var monitor = await MonitorModel.findOne({ _id: data.monitorId, deleted: false });
            if (monitor) {
                await RealTimeService.updateMonitorLog(data, monitor._id, monitor.projectId);
            }
        } catch (error) {
            if (error.message.indexOf('at path "_id"') !== -1) {
                ErrorService.log('MonitorModel.findOne', error);
            } else {
                ErrorService.log('RealTimeService.updateMonitorLog', error);
            }
            throw error;
        }
    },

    addSeat: async function (query) {
        try {
            var project = await ProjectService.findOneBy(query);
            var projectSeats = project.seats;
            if (typeof (projectSeats) === 'string') {
                projectSeats = parseInt(projectSeats);
            }
            projectSeats = projectSeats + 1;
            await PaymentService.changeSeats(project.stripeSubscriptionId, (projectSeats));
            project.seats = projectSeats.toString();
            await ProjectService.saveProject(project);
        } catch (error) {
            ErrorService.log('MonitorService.addSeat', error);
            throw error;
        }
        return 'A new seat added. Now you can add a monitor';
    },

    hardDeleteBy: async function (query) {
        try {
            await MonitorModel.deleteMany(query);
        } catch (error) {
            ErrorService.log('MonitorModel.deleteMany', error);
            throw error;
        }
        return 'Monitor(s) removed successfully!';
    },
    // yet to be edited
    async getManualMonitorTime(monitorId) {
        var _this = this;
        try {
            var monitorTime = await _this.findOneBy({ _id: monitorId });
            var monitorIncidents = await IncidentService.findBy({ monitorId });
        } catch (error) {
            ErrorService.log('MonitorService.getManualMonitorTime', error);
            throw error;
        }
        var dateNow = moment().utc();
        var days = moment(dateNow).utc().startOf('day').diff(moment(monitorTime.createdAt).utc().startOf('day'), 'days');
        if (days > 89) days = 89;
        var times = [];
        for (var i = days; i >= 0; i--) {
            var incidents = [];
            var temp = {};
            var status = 'online';
            temp.date = moment(dateNow).utc().subtract(i, 'days');
            temp.monitorId = monitorId;
            if (monitorIncidents && monitorIncidents.length) {
                incidents = monitorIncidents.filter(inc => {
                    let creatediff = moment(temp.date).utc().startOf('day').diff(moment(inc.createdAt).utc().startOf('day'), 'days');
                    let resolveddiff = moment(temp.date).utc().startOf('day').diff(moment(inc.resolvedAt).utc().startOf('day'), 'days');
                    if (creatediff > -1 && resolveddiff < 1) return true;
                    else return false;
                });
                status = incidents.some(inc => inc.resolvedAt ? moment(inc.resolvedAt).utc().startOf('day').diff(moment(temp.date).utc().startOf('day'), 'days') > 0 : true) ? 'offline' : 'online';

                incidents = incidents.map(inc => {
                    let creatediff = moment(temp.date).utc().startOf('day').diff(moment(inc.createdAt).utc().startOf('day'), 'days');
                    let resolveddiff = inc.resolvedAt ? moment(temp.date).utc().startOf('day').diff(moment(inc.resolvedAt).utc().startOf('day'), 'days') : moment(temp.date).utc().startOf('day').diff(moment().utc().startOf('day'), 'days');
                    if (creatediff > 0 && resolveddiff < 0) {
                        return 1440;
                    }
                    else if (creatediff === 0 && resolveddiff !== 0) {
                        return moment(temp.date).utc().endOf('day').diff(moment(inc.createdAt).utc(), 'minutes');
                    }
                    else if (creatediff !== 0 && resolveddiff === 0) {
                        return moment(temp.date).utc().startOf('day').diff(moment(inc.resolvedAt).utc(), 'minutes');
                    }
                    else if (creatediff === 0 && resolveddiff === 0) {
                        return moment(temp.resolvedAt).utc().diff(moment(inc.createdAt).utc(), 'minutes');
                    }
                });
            }
            if (incidents.length) {
                var reduced = incidents.reduce((inc, val) => inc + val);
                temp.downTime = reduced < 1440 ? reduced : 1440;
                temp.upTime = reduced < 1440 ? 1440 - reduced : 0;
            }
            else {
                temp.downTime = 0;
                temp.upTime = 1440;
            }
            temp.status = status;
            times.unshift(temp);
        }
        return times;
    },

    restoreBy: async function (query) {
        const _this = this;
        query.deleted = true;
        let monitor = await _this.findBy(query);
        if (monitor && monitor.length > 1) {
            const monitors = await Promise.all(monitor.map(async (monitor) => {
                const monitorId = monitor._id;
                monitor = await _this.update({ _id: monitorId, deleted: true }, {
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
                await IncidentService.restoreBy({ monitorId, deleted: true });
                await AlertService.restoreBy({ monitorId, deleted: true });
                return monitor;
            }));
            return monitors;
        } else {
            monitor = monitor[0];
            if (monitor) {
                const monitorId = monitor._id;
                monitor = await _this.update({ _id: monitorId, deleted: true }, {
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
                await IncidentService.restoreBy({ monitorId, deleted: true });
                await AlertService.restoreBy({ monitorId, deleted: true });
            }
            return monitor;
        }
    }
};

var MonitorModel = require('../models/monitor');
var MonitorLogModel = require('../models/monitorLog');
var MonitorCategoryService = require('../services/monitorCategoryService');
var MonitorCriteriaService = require('../services/monitorCriteriaService');
var Plans = require('./../config/plans');
var RealTimeService = require('./realTimeService');
var NotificationService = require('./notificationService');
var ProjectService = require('./projectService');
var PaymentService = require('./paymentService');
var IncidentService = require('../services/incidentService');
var AlertService = require('../services/alertService');
var StatusPageService = require('../services/statusPageService');
var ScheduleService = require('../services/scheduleService');
var IntegrationService = require('../services/integrationService');
var TeamService = require('../services/teamService');
var ErrorService = require('../services/errorService');
var moment = require('moment');
var _ = require('lodash');
