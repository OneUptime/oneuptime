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
        } catch (error) {
            ErrorService.log('ProjectService.findOneBy', error);
            throw error;
        }
        if (project.parentProjectId) {
            subProject = project;
            try {
                project = await ProjectService.findOneBy({ _id: subProject.parentProjectId });
            } catch (error) {
                ErrorService.log('ProjectService.findOneBy', error);
                throw error;
            }
        }
        var subProjectIds = [];
        var subProjects = await ProjectService.findBy({ parentProjectId: project._id });
        if (subProjects && subProjects.length > 0) {
            subProjectIds = subProjects.map(project => project._id);
        }
        subProjectIds.push(project._id);
        try {
            var count = await _this.countBy({ projectId: { $in: subProjectIds } });
        } catch (error) {
            ErrorService.log('MonitorService.countBy', error);
            throw error;
        }
        try {
            var monitorCategory = await MonitorCategoryService.findBy({ _id: data.monitorCategoryId });
        } catch (error) {
            ErrorService.log('MonitorCategory.findBy', error);
            throw error;
        }
        try {
            var plan = await Plans.getPlanById(project.stripePlanId);
        } catch (error) {
            ErrorService.log('Plans.getPlanById', error);
            throw error;
        }
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
                if (data.type === 'url' || data.type === 'manual' || data.type === 'api') {
                    monitor.data = {};
                    monitor.data.url = data.data.url || null;
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
                if (data.type === 'url' || data.type === 'api') {
                    monitor.criteria = data.criteria || {};
                }
                if (data.type === 'api') {
                    if (data.method && data.method.length) monitor.method = data.method;
                    if (data.bodyType && data.bodyType.length) monitor.bodyType = data.bodyType;
                    if (data.text && data.text.length) monitor.text = data.text;
                    if (data.formData && data.formData.length) monitor.formData = data.formData;
                    if (data.headers && data.headers.length) monitor.headers = data.headers;
                }
                try {
                    var savedMonitor = await monitor.save();
                } catch (error) {
                    ErrorService.log('monitor.save', error);
                    throw error;
                }
                var fetchedMonitor = await IncidentService.getMonitorsWithIncidentsBy({
                    query: {_id: savedMonitor._id},
                    skip:0,
                    limit:0
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
    },

    update: async function (query, data) {
        if (!query) {
            query = {};
        }

        if(!query.deleted) query.deleted = false;

        try {
            var monitor = await MonitorModel.findOneAndUpdate(query,
                { $set: data },
                {
                    new: true
                })
                .populate('projectId', 'name');
        } catch (error) {
            ErrorService.log('MonitorModel.findOneAndUpdate', error);
            throw error;
        }
        monitor = await IncidentService.getMonitorsWithIncidentsBy({
            query: {_id: monitor._id},
            skip:0,
            limit:0
        });
        try {
            await RealTimeService.monitorEdit(monitor);
        } catch (error) {
            ErrorService.log('RealTimeService.monitorEdit', error);
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

        if(!query.deleted) query.deleted = false;
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

        if(!query.deleted) query.deleted = false;
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

        if(!query.deleted) query.deleted = false;
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
        } catch (error) {
            ErrorService.log('MonitorModel.findOneAndUpdate', error);
            throw error;
        }
        if (monitor) {
            var subProject = null;
            try {
                var project = await ProjectService.findOneBy({ _id: monitor.projectId });
            } catch (error) {
                ErrorService.log('ProjectService.findOneBy', error);
                throw error;
            }
            if (project.parentProjectId) {
                subProject = project;
                try {
                    project = await ProjectService.findOneBy({ _id: subProject.parentProjectId });
                } catch (error) {
                    ErrorService.log('ProjectService.findOneBy', error);
                    throw error;
                }
            }
            var subProjectIds = [];
            var subProjects = await ProjectService.findBy({ parentProjectId: project._id });
            if (subProjects && subProjects.length > 0) {
                subProjectIds = subProjects.map(project => project._id);
            }
            subProjectIds.push(project._id);
            try {
                var monitorsCount = await this.countBy({ projectId: { $in: subProjectIds } });
            } catch (error) {
                ErrorService.log('MonitorService.countBy', error);
                throw error;
            }
            var projectSeats = project.seats;
            if (typeof (projectSeats) === 'string') {
                projectSeats = parseInt(projectSeats);
            }
            var projectUsers = await TeamService.getTeamMembersBy({ parentProjectId: project._id });            // eslint-disable-next-line no-console
            var seats = await TeamService.getSeats(projectUsers);
            // check if project seats are more based on users in project or by count of monitors
            if (projectSeats && projectSeats > seats && monitorsCount > 0 && monitorsCount <= ((projectSeats - 1) * 5)) {
                projectSeats = projectSeats - 1;
                try {
                    await PaymentService.changeSeats(project.stripeExtraUserSubscriptionId, (projectSeats));
                } catch (error) {
                    ErrorService.log('PaymentService.changeSeats', error);
                    throw error;
                }
                try {
                    await ProjectService.update({ _id: project._id, seats: projectSeats.toString() });
                } catch (error) {
                    ErrorService.log('ProjectService.update', error);
                    throw error;
                }
            }
            try {
                var incidents = await IncidentService.findBy({ monitorId: monitor._id });
            } catch (error) {
                ErrorService.log('IncidentService.findBy', error);
                throw error;
            }
            await Promise.all(incidents.map(async (incident) => {
                await IncidentService.deleteBy({ _id: incident._id }, userId);
            }));
            try {
                var alerts = await AlertService.findBy({ monitorId: monitor._id }, userId);
            } catch (error) {
                ErrorService.log('AlertService.findBy', error);
                throw error;
            }
            await Promise.all(alerts.map(async (alert) => {
                await AlertService.deleteBy({ _id: alert._id }, userId);
            }));
            try {
                await StatusPageService.removeMonitor(monitor._id);
            } catch (error) {
                ErrorService.log('StatusPageService.removeMonitor', error);
                throw error;
            }
            try {
                await ScheduleService.removeMonitor(monitor._id);
            } catch (error) {
                ErrorService.log('ScheduleService.deleteBy', error);
                throw error;
            }
            try {
                await IntegrationService.removeMonitor(monitor._id);
            } catch (error) {
                ErrorService.log('IntegrationService.removeMonitor', error);
                throw error;
            }
            try {
                await NotificationService.create(monitor.projectId, `A Monitor ${monitor.name} was deleted from the project by ${monitor.deletedById.name}`, monitor.deletedById._id, 'monitoraddremove');
            } catch (error) {
                ErrorService.log('NotificationService.create', error);
                throw error;
            }
            try {
                await RealTimeService.sendMonitorDelete(monitor);
            } catch (error) {
                ErrorService.log('RealTimeService.sendMonitorDelete', error);
                throw error;
            }
            return monitor;
        } else {
            return null;
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
        } catch (error) {
            ErrorService.log('MonitorModel.find', error);
            throw error;
        }
        if (monitors && monitors.length) {
            try {
                await MonitorModel.update({
                    'pollTime': { $lt: date }, deleted: false
                }, { $set: { 'pollTime': newdate } }, { multi: true });
            } catch (error) {
                ErrorService.log('MonitorModel.update', error);
                throw error;
            }
            return monitors;
        }
        else {
            return [];
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
        } catch (error) {
            ErrorService.log('MonitorService.findOneBy', error);
            throw error;
        }
        if (!monitor) {
            let error = new Error('Monitor with this Device ID not found in this Project.');
            error.code = 400;
            ErrorService.log('MonitorService.updateDeviceMonitorPingTime', error);
            throw error;
        } else {
            try {
                monitor = await thisObj.updateMonitorPingTime(monitor._id);
            } catch (error) {
                ErrorService.log('MonitoService.updateMonitorPingTime', error);
                throw error;
            }
            return monitor;
        }
    },

    async sendResponseTime(monitorsData) {
        try {
            var monitor = await MonitorModel.findOne({ _id: monitorsData.monitorId, deleted: false });
        } catch (error) {
            ErrorService.log('MonitorModel.findOne', error);
            throw error;
        }
        if (monitor) {
            try {
                await RealTimeService.updateResponseTime(monitorsData, monitor.projectId);
            } catch (error) {
                ErrorService.log('RealTimeService.updateResponseTime', error);
                throw error;
            }
        }
    },

    // Get monitor times from database
    async getMonitorTime(monitorId, date) {
        try {
            var monitorTime = await MonitorTimeModel.find({ monitorId: monitorId, timestamp: { $lt: date } });
        } catch (error) {
            ErrorService.log('MonitorTimeModel.find', error);
            throw error;
        }
        return monitorTime;
    },

    addSeat: async function (query) {
        try {
            var project = await ProjectService.findOneBy(query);
        } catch (error) {
            ErrorService.log('ProjectService.findOneBy', error);
            throw error;
        }
        var projectSeats = project.seats;
        if (typeof (projectSeats) === 'string') {
            projectSeats = parseInt(projectSeats);
        }
        projectSeats = projectSeats + 1;
        try {
            await PaymentService.changeSeats(project.stripeExtraUserSubscriptionId, (projectSeats));
        } catch (error) {
            ErrorService.log('PaymentService.changeSeats', error);
            throw error;
        }
        project.seats = projectSeats.toString();
        try {
            await ProjectService.saveProject(project);
        } catch (error) {
            ErrorService.log('ProjectService.saveProject', error);
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
        } catch (error) {
            ErrorService.log('MonitorService.findOneBy', error);
            throw error;
        }
        try {
            var monitorIncidents = await IncidentService.findBy({ monitorId });
        } catch (error) {
            ErrorService.log('IncidentService.findBy', error);
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

    addUpTime: async function (monitor) {
        if (monitor && monitor._doc) {
            monitor = monitor._doc;
        }
        var _this = this;
        var time = [];
        var responseTime = 0;
        try {
            time = await StatusPageService.getMonitorTime(monitor._id);
        } catch (error) {
            ErrorService.log('StatusPageService.getMonitorTime', error);
            throw error;
        }
        try {
            responseTime = await _this.getResponseTime(monitor._id);
        } catch (error) {
            ErrorService.log('MonitorService.getResponseTime', error);
            throw error;
        }
        var uptime = 0;
        var downtime = 0;
        var status = 'offline';
        var uptimePercent = 0;

        time.forEach(el => {
            uptime += el.upTime;
            downtime += el.downTime;
        });
        if (uptime === 0 && downtime === 0) {
            uptimePercent = 100;
        }
        else {
            uptimePercent = uptime / (uptime + downtime) * 100;
        }
        if (time && time[time.length - 1] && time[time.length - 1].status) {
            status = time[time.length - 1].status;
        }
        let updatedMonitor = Object.assign({}, monitor, { time, responseTime, uptimePercent, status });
        return updatedMonitor;
    },
    restoreBy: async function(query){
        const _this = this;
        query.deleted = true;
        let monitor = await _this.findBy(query);
        if(monitor && monitor.length > 1){
            const monitors = await Promise.all(monitor.map(async (monitor) => {
                const monitorId = monitor._id;
                monitor = await _this.update({_id: monitorId, deleted: true}, {
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
                await IncidentService.restoreBy({monitorId, deleted: true});
                await AlertService.restoreBy({monitorId, deleted: true});
                return monitor;
            }));
            return monitors;
        }else{
            monitor = monitor[0];
            if(monitor){
                const monitorId = monitor._id;
                monitor = await _this.update({_id: monitorId, deleted: true}, {
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
                await IncidentService.restoreBy({monitorId, deleted: true});
                await AlertService.restoreBy({monitorId, deleted: true});
            }
            return monitor;
        }
    }
};

var MonitorModel = require('../models/monitor');
var MonitorTimeModel = require('../models/monitorTime');
var MonitorCategoryService = require('../services/monitorCategoryService');
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
