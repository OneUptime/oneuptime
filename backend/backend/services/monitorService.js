module.exports = {
    //Description: Upsert function for monitor.
    //Params:
    //Param 1: data: MonitorModal.
    //Returns: promise with monitor model or error.
    create: async function (data) {
        try {
            var _this = this;
            var subProject = null;
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
                ErrorService.log('monitorService.create', error);
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
                    ErrorService.log('monitorService.create', error);
                    throw error;
                }
            }
        } catch (error) {
            ErrorService.log('monitorService.create', error);
            throw error;
        }
    },

    updateOneBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
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
            return monitor;
        } catch (error) {
            ErrorService.log('monitorService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            var updatedData = await MonitorModel.updateMany(query, {
                $set: data
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('monitorService.updateMany', error);
            throw error;
        }
    },

    //Description: Gets all monitors by project.
    //Params:
    //Param 1: data: MonitorModal.
    //Returns: promise with monitor model or error.
    async findBy(query, limit, skip) {
        try {
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
            var monitors = await MonitorModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name');
            return monitors;
        } catch (error) {
            ErrorService.log('monitorService.findBy', error);
            throw error;
        }
    },

    async findOneBy(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            var monitor = await MonitorModel.findOne(query)
                .populate('projectId', 'name');
            return monitor;
        } catch (error) {
            ErrorService.log('monitorService.findOneBy', error);
            throw error;
        }
    },

    async countBy(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            var count = await MonitorModel.count(query)
                .populate('project', 'name');
            return count;
        } catch (error) {
            ErrorService.log('monitorService.countBy', error);
            throw error;
        }
    },

    deleteBy: async function (query, userId) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
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
                    await ProjectService.updateOneBy({ _id: project._id }, { seats: projectSeats.toString() });
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
                await IntegrationService.removeMonitor(monitor._id, userId);
                await NotificationService.create(monitor.projectId, `A Monitor ${monitor.name} was deleted from the project by ${monitor.deletedById.name}`, monitor.deletedById._id, 'monitoraddremove');
                await RealTimeService.sendMonitorDelete(monitor);

                return monitor;
            } else {
                return null;
            }
        } catch (error) {
            ErrorService.log('monitorService.deleteBy', error);
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
        try {
            var newdate = new Date();
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
            ErrorService.log('monitorService.getProbeMonitors', error);
            throw error;
        }
    },

    async updateMonitorPingTime(id) {
        try {
            var newdate = new Date();
            var thisObj = this;
            var monitors = await thisObj.updateOneBy({
                _id: id, deleted: false
            }, { $set: { 'lastPingTime': newdate } }, { multi: false });
            if (monitors.length > 0) {
                return (monitors[0]);
            } else {
                return (null);
            }
        } catch (error) {
            ErrorService.log('monitorService.updateMonitorPingTime', error);
            throw error;
        }
    },

    async updateDeviceMonitorPingTime(projectId, deviceId) {
        try {
            var thisObj = this;
            var monitor = await thisObj.findOneBy({ projectId: projectId, data: { deviceId: deviceId } });

            if (!monitor) {
                let error = new Error('Monitor with this Device ID not found in this Project.');
                error.code = 400;
                ErrorService.log('monitorService.updateDeviceMonitorPingTime', error);
                throw error;
            } else {
                monitor = await thisObj.updateMonitorPingTime(monitor._id);
                return monitor;
            }
        } catch (error) {
            ErrorService.log('monitorService.updateDeviceMonitorPingTime', error);
            throw error;
        }
    },

    async getMonitorLogs(monitorId, startDate, endDate) {
        try {
            const start = moment(startDate).toDate();
            const end = moment(endDate).toDate();
            const intervalInDays = (moment(endDate)).diff(moment(startDate), 'days');

            const monitor = await this.findOneBy({ _id: monitorId });
            const isNewMonitor = (moment(endDate)).diff(moment(monitor.createdAt), 'days') < 2;

            let probes, probeLogs = [];
            if (monitor.type === 'server-monitor') {
                probes = [undefined];
            } else {
                probes = await ProbeService.findBy({});
            }

            for (const probe of probes) {
                let query = (typeof probe !== 'undefined') ? {
                    probeId: probe._id, monitorId, createdAt: { $gte: start, $lte: end }
                } : { monitorId, createdAt: { $gte: start, $lte: end } };

                let monitorLogs;

                if (intervalInDays > 30 && !isNewMonitor) {
                    monitorLogs = await MonitorLogByWeekService.findBy(query);
                } else if (intervalInDays > 2 && !isNewMonitor) {
                    monitorLogs = await MonitorLogByDayService.findBy(query);
                } else {
                    if ((moment(endDate)).diff(moment(monitor.createdAt), 'minutes') > 60) {
                        monitorLogs = await MonitorLogByHourService.findBy(query);
                    } else {
                        monitorLogs = await MonitorLogService.findBy(query);
                    }
                }

                if (monitorLogs && monitorLogs.length > 0) {
                    probeLogs.push({ _id: typeof probe !== 'undefined' ? probe._id : null, logs: monitorLogs });
                }
            }

            return probeLogs;
        } catch (error) {
            ErrorService.log('monitorService.getMonitorLogs', error);
            throw error;
        }
    },

    async sendResponseTime(monitorsData) {
        try {
            var monitor = await MonitorModel.findOne({ _id: monitorsData.monitorId, deleted: false });
            if (monitor) {
                await RealTimeService.updateResponseTime(monitorsData, monitor.projectId);
            }
        } catch (error) {
            ErrorService.log('monitorService.sendResponseTime', error);
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
            ErrorService.log('monitorService.sendMonitorLog', error);
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
            return 'A new seat added. Now you can add a monitor';
        } catch (error) {
            ErrorService.log('monitorService.addSeat', error);
            throw error;
        }
    },

    hardDeleteBy: async function (query) {
        try {
            await MonitorModel.deleteMany(query);
            return 'Monitor(s) removed successfully!';
        } catch (error) {
            ErrorService.log('monitorService.hardDeleteBy', error);
            throw error;
        }
    },
    // yet to be edited
    async getManualMonitorTime(monitorId) {
        try {
            var _this = this;
            var monitorTime = await _this.findOneBy({ _id: monitorId });
            var monitorIncidents = await IncidentService.findBy({ monitorId });
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
        } catch (error) {
            ErrorService.log('monitorService.getManualMonitorTime', error);
            throw error;
        }
    },

    restoreBy: async function (query) {
        const _this = this;
        query.deleted = true;
        let monitor = await _this.findBy(query);
        if (monitor && monitor.length > 1) {
            const monitors = await Promise.all(monitor.map(async (monitor) => {
                const monitorId = monitor._id;
                monitor = await _this.updateOneBy({ _id: monitorId, deleted: true }, {
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
                monitor = await _this.updateOneBy({ _id: monitorId, deleted: true }, {
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
var ProbeService = require('./probeService');
var MonitorLogService = require('./monitorLogService');
let MonitorLogByHourService = require('./monitorLogByHourService');
let MonitorLogByDayService = require('./monitorLogByDayService');
let MonitorLogByWeekService = require('./monitorLogByWeekService');
var MonitorCategoryService = require('./monitorCategoryService');
var MonitorCriteriaService = require('./monitorCriteriaService');
var Plans = require('./../config/plans');
var RealTimeService = require('./realTimeService');
var NotificationService = require('./notificationService');
var ProjectService = require('./projectService');
var PaymentService = require('./paymentService');
var IncidentService = require('./incidentService');
var AlertService = require('./alertService');
var StatusPageService = require('./statusPageService');
var ScheduleService = require('./scheduleService');
var IntegrationService = require('./integrationService');
var TeamService = require('./teamService');
var ErrorService = require('./errorService');
var moment = require('moment');
var _ = require('lodash');
