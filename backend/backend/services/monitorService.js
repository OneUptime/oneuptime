/* eslint-disable quotes, indent */

module.exports = {
    //Description: Upsert function for monitor.
    //Params:
    //Param 1: data: MonitorModal.
    //Returns: promise with monitor model or error.
    create: async function(data) {
        try {
            const _this = this;
            let subProject = null;
            const existingMonitor = await _this.findBy({
                name: data.name,
                componentId: data.componentId,
                projectId: data.projectId,
            });
            if (existingMonitor && existingMonitor.length > 0) {
                const error = new Error(
                    'Monitor with that name already exists.'
                );
                error.code = 400;
                ErrorService.log('monitorService.create', error);
                throw error;
            }
            let project = await ProjectService.findOneBy({
                _id: data.projectId,
            });
            if (project.parentProjectId) {
                subProject = project;
                project = await ProjectService.findOneBy({
                    _id: subProject.parentProjectId,
                });
            }
            let subProjectIds = [];
            const subProjects = await ProjectService.findBy({
                parentProjectId: project._id,
            });
            let userCount = 0;
            if (subProjects && subProjects.length > 0) {
                const userId = [];
                subProjectIds = subProjects.map(project => project._id);
                subProjects.map(subProject => {
                    subProject.users.map(user => {
                        if (!userId.includes(user.userId)) {
                            userId.push(user.userId);
                        }
                        return user;
                    });
                    return subProject;
                });
                userCount = userId.length;
            } else {
                userCount = project.users.length;
            }
            subProjectIds.push(project._id);
            const count = await _this.countBy({
                projectId: { $in: subProjectIds },
            });
            const monitorCategory = await MonitorCategoryService.findBy({
                _id: data.monitorCategoryId,
            });
            let plan = Plans.getPlanById(project.stripePlanId);
            // null plan => enterprise plan
            plan = plan && plan.category ? plan : { category: 'Enterprise' };

            if (!plan && IS_SAAS_SERVICE) {
                const error = new Error('Invalid project plan.');
                error.code = 400;
                ErrorService.log('monitorService.create', error);
                throw error;
            } else {
                const unlimitedMonitor = ['Scale', 'Enterprise'];
                const monitorCount =
                    plan.category === 'Startup'
                        ? 5
                        : plan.category === 'Growth'
                        ? 10
                        : 0;
                if (
                    count < userCount * monitorCount ||
                    !IS_SAAS_SERVICE ||
                    unlimitedMonitor.includes(plan.category)
                ) {
                    let monitor = new MonitorModel();
                    monitor.name = data.name;
                    monitor.type = data.type;
                    monitor.createdById = data.createdById;
                    if (data.type === 'url' || data.type === 'api') {
                        monitor.data = {};
                        monitor.data.url = data.data.url;
                    } else if (data.type === 'manual') {
                        monitor.data = {};
                        monitor.data.description =
                            data.data.description || null;
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
                    monitor.componentId = data.componentId;
                    monitor.projectId = data.projectId;
                    if (
                        data.type === 'url' ||
                        data.type === 'api' ||
                        data.type === 'server-monitor' ||
                        data.type === 'script'
                    ) {
                        monitor.criteria = _.isEmpty(data.criteria)
                            ? MonitorCriteriaService.create(data.type)
                            : data.criteria;
                    }
                    if (data.type === 'api') {
                        if (data.method && data.method.length)
                            monitor.method = data.method;
                        if (data.bodyType && data.bodyType.length)
                            monitor.bodyType = data.bodyType;
                        if (data.text && data.text.length)
                            monitor.text = data.text;
                        if (data.formData && data.formData.length)
                            monitor.formData = data.formData;
                        if (data.headers && data.headers.length)
                            monitor.headers = data.headers;
                    }
                    const savedMonitor = await monitor.save();
                    monitor = await _this.findOneBy({ _id: savedMonitor._id });
                    return monitor;
                } else {
                    const error = new Error(
                        "You can't add any more monitors. Please upgrade your account."
                    );
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

    updateOneBy: async function(query, data, unsetData) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let monitor = await MonitorModel.findOneAndUpdate(
                query,
                { $set: data },
                {
                    new: true,
                }
            );
            if (unsetData) {
                monitor = await MonitorModel.findOneAndUpdate(
                    query,
                    { $unset: unsetData },
                    {
                        new: true,
                    }
                );
            }
            monitor = await this.findOneBy(query);

            await RealTimeService.monitorEdit(monitor);

            return monitor;
        } catch (error) {
            ErrorService.log('monitorService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedData = await MonitorModel.updateMany(query, {
                $set: data,
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

            if (typeof skip === 'string') {
                skip = parseInt(skip);
            }

            if (typeof limit === 'string') {
                limit = parseInt(limit);
            }

            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const monitors = await MonitorModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name')
                .populate('monitorCategoryId', 'name');
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
            const monitor = await MonitorModel.findOne(query)
                .populate('projectId', 'name')
                .populate('monitorCategoryId', 'name');
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
            const count = await MonitorModel.countDocuments(query).populate(
                'project',
                'name'
            );
            return count;
        } catch (error) {
            ErrorService.log('monitorService.countBy', error);
            throw error;
        }
    },

    deleteBy: async function(query, userId) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const monitor = await MonitorModel.findOneAndUpdate(
                query,
                {
                    $set: {
                        deleted: true,
                        deletedAt: Date.now(),
                        deletedById: userId,
                    },
                },
                { new: true }
            ).populate('deletedById', 'name');

            if (monitor) {
                let subProject = null;
                let project = await ProjectService.findOneBy({
                    _id: monitor.projectId,
                });
                if (project.parentProjectId) {
                    subProject = project;
                    project = await ProjectService.findOneBy({
                        _id: subProject.parentProjectId,
                    });
                }

                let subProjectIds = [];
                const subProjects = await ProjectService.findBy({
                    parentProjectId: project._id,
                });
                if (subProjects && subProjects.length > 0) {
                    subProjectIds = subProjects.map(project => project._id);
                }
                subProjectIds.push(project._id);
                const monitorsCount = await this.countBy({
                    projectId: { $in: subProjectIds },
                });
                let projectSeats = project.seats;
                if (typeof projectSeats === 'string') {
                    projectSeats = parseInt(projectSeats);
                }
                const projectUsers = await TeamService.getTeamMembersBy({
                    parentProjectId: project._id,
                }); // eslint-disable-next-line no-console
                const seats = await TeamService.getSeats(projectUsers);
                // check if project seats are more based on users in project or by count of monitors
                if (
                    !IS_SAAS_SERVICE ||
                    (projectSeats &&
                        projectSeats > seats &&
                        monitorsCount > 0 &&
                        monitorsCount <= (projectSeats - 1) * 5)
                ) {
                    projectSeats = projectSeats - 1;
                    if (IS_SAAS_SERVICE) {
                        await PaymentService.changeSeats(
                            project.stripeSubscriptionId,
                            projectSeats
                        );
                    }
                    await ProjectService.updateOneBy(
                        { _id: project._id },
                        { seats: projectSeats.toString() }
                    );
                }
                const incidents = await IncidentService.findBy({
                    monitorId: monitor._id,
                });

                await Promise.all(
                    incidents.map(async incident => {
                        await IncidentService.deleteBy(
                            { _id: incident._id },
                            userId
                        );
                    })
                );
                const alerts = await AlertService.findBy({
                    query: { monitorId: monitor._id },
                });

                await Promise.all(
                    alerts.map(async alert => {
                        await AlertService.deleteBy({ _id: alert._id }, userId);
                    })
                );
                await StatusPageService.removeMonitor(monitor._id);
                await ScheduleService.removeMonitor(monitor._id);
                await IntegrationService.removeMonitor(monitor._id, userId);
                await NotificationService.create(
                    monitor.projectId,
                    `A Monitor ${monitor.name} was deleted from the project by ${monitor.deletedById.name}`,
                    monitor.deletedById._id,
                    'monitoraddremove'
                );
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

    async getMonitorsBySubprojects(subProjectIds, limit, skip) {
        try {
            if (typeof limit === 'string') limit = parseInt(limit);
            if (typeof skip === 'string') skip = parseInt(skip);
            const _this = this;

            const subProjectMonitors = await Promise.all(
                subProjectIds.map(async id => {
                    const monitors = await _this.findBy(
                        { projectId: id },
                        limit,
                        skip
                    );
                    const count = await _this.countBy({ projectId: id });
                    return { monitors, count, _id: id, skip, limit };
                })
            );
            return subProjectMonitors;
        } catch (error) {
            ErrorService.log('monitorService.getMonitorsBySubprojects', error);
            throw error;
        }
    },

    async getProbeMonitors(date) {
        try {
            const newdate = new Date();
            const monitors = await MonitorModel.find({
                pollTime: { $lt: date },
                deleted: false,
            });
            if (monitors && monitors.length) {
                await MonitorModel.update(
                    { pollTime: { $lt: date }, deleted: false },
                    { $set: { pollTime: newdate } },
                    { multi: true }
                );
                return monitors;
            } else {
                return [];
            }
        } catch (error) {
            ErrorService.log('monitorService.getProbeMonitors', error);
            throw error;
        }
    },

    async updateMonitorPingTime(id) {
        try {
            const newdate = new Date();
            const thisObj = this;
            const monitor = await thisObj.updateOneBy(
                {
                    _id: id,
                },
                { $set: { lastPingTime: newdate } },
                { multi: false }
            );
            return monitor;
        } catch (error) {
            ErrorService.log('monitorService.updateMonitorPingTime', error);
            throw error;
        }
    },

    async updateDeviceMonitorPingTime(projectId, deviceId) {
        try {
            const thisObj = this;
            let monitor = await thisObj.findOneBy({
                projectId: projectId,
                data: { deviceId: deviceId },
            });

            if (!monitor) {
                const error = new Error(
                    'Monitor with this Device ID not found in this Project.'
                );
                error.code = 400;
                ErrorService.log(
                    'monitorService.updateDeviceMonitorPingTime',
                    error
                );
                throw error;
            } else {
                monitor = await thisObj.updateMonitorPingTime(monitor._id);
                return monitor;
            }
        } catch (error) {
            ErrorService.log(
                'monitorService.updateDeviceMonitorPingTime',
                error
            );
            throw error;
        }
    },

    async getMonitorLogs(monitorId, startDate, endDate) {
        try {
            const start = moment(startDate).toDate();
            const end = moment(endDate).toDate();
            const intervalInDays = moment(endDate).diff(
                moment(startDate),
                'days'
            );

            const monitor = await this.findOneBy({ _id: monitorId });
            const isNewMonitor =
                moment(endDate).diff(moment(monitor.createdAt), 'days') < 2;

            let probes;
            const probeLogs = [];
            if (monitor.type === 'server-monitor') {
                probes = [undefined];
            } else {
                probes = await ProbeService.findBy({});
            }

            for (const probe of probes) {
                const query = {
                    monitorId,
                    createdAt: { $gte: start, $lte: end },
                };
                if (typeof probe !== 'undefined') {
                    query.probeId = probe._id;
                }

                let monitorLogs;

                if (intervalInDays > 30 && !isNewMonitor) {
                    monitorLogs = await MonitorLogByWeekService.findBy(query);
                } else if (intervalInDays > 2 && !isNewMonitor) {
                    monitorLogs = await MonitorLogByDayService.findBy(query);
                } else {
                    if (
                        moment(endDate).diff(
                            moment(monitor.createdAt),
                            'minutes'
                        ) > 60
                    ) {
                        monitorLogs = await MonitorLogByHourService.findBy(
                            query
                        );
                    } else {
                        monitorLogs = await MonitorLogService.findBy(query);
                    }
                }

                if (monitorLogs && monitorLogs.length > 0) {
                    probeLogs.push({
                        _id: typeof probe !== 'undefined' ? probe._id : null,
                        logs: monitorLogs,
                    });
                }
            }

            return probeLogs;
        } catch (error) {
            ErrorService.log('monitorService.getMonitorLogs', error);
            throw error;
        }
    },

    async getMonitorLogsByDay(monitorId, startDate, endDate) {
        try {
            const start = moment(startDate).toDate();
            const end = moment(endDate).toDate();
            const monitor = await this.findOneBy({ _id: monitorId });
            let probes;
            if (monitor.type === 'server-monitor') {
                probes = [undefined];
            } else {
                probes = await ProbeService.findBy({});
            }
            const probeLogs = [];
            for (const probe of probes) {
                const query = {
                    monitorId,
                    createdAt: { $gte: start, $lte: end },
                };
                if (typeof probe !== 'undefined') {
                    query.probeId = probe._id;
                }
                const monitorLogs = await MonitorLogByDayService.findBy(query);
                if (monitorLogs && monitorLogs.length > 0) {
                    probeLogs.push({
                        _id: typeof probe !== 'undefined' ? probe._id : null,
                        logs: monitorLogs,
                    });
                }
            }
            return probeLogs;
        } catch (error) {
            ErrorService.log('monitorService.getMonitorLogs', error);
            throw error;
        }
    },

    async getMonitorStatuses(monitorId, startDate, endDate) {
        try {
            const start = moment(startDate).toDate();
            const end = moment(endDate).toDate();
            const monitor = await this.findOneBy({ _id: monitorId });

            let probes;
            const probeStatuses = [];
            if (
                monitor.type === 'server-monitor' ||
                monitor.type === 'manual'
            ) {
                probes = [undefined];
            } else {
                probes = await ProbeService.findBy({});
            }

            for (const probe of probes) {
                const query = {
                    monitorId,
                    $or: [
                        { startTime: { $gte: start, $lte: end } },
                        {
                            $or: [
                                { endTime: { $gte: start, $lte: end } },
                                { endTime: null },
                            ],
                        },
                    ],
                };
                if (typeof probe !== 'undefined') {
                    // return manually created statuses in every probe
                    query.probeId = { $in: [probe._id, null] };
                }

                const monitorStatuses = await MonitorStatusService.findBy(
                    query
                );

                if (monitorStatuses && monitorStatuses.length > 0) {
                    probeStatuses.push({
                        _id: typeof probe !== 'undefined' ? probe._id : null,
                        statuses: monitorStatuses,
                    });
                }
            }

            return probeStatuses;
        } catch (error) {
            ErrorService.log('monitorService.getMonitorStatuses', error);
            throw error;
        }
    },

    addSeat: async function(query) {
        try {
            const project = await ProjectService.findOneBy(query);
            let projectSeats = project.seats;
            if (typeof projectSeats === 'string') {
                projectSeats = parseInt(projectSeats);
            }
            projectSeats = projectSeats + 1;
            if (IS_SAAS_SERVICE) {
                await PaymentService.changeSeats(
                    project.stripeSubscriptionId,
                    projectSeats
                );
            }
            project.seats = projectSeats.toString();
            await ProjectService.saveProject(project);
            return 'A new seat added. Now you can add a monitor';
        } catch (error) {
            ErrorService.log('monitorService.addSeat', error);
            throw error;
        }
    },

    addSiteUrl: async function(query, data) {
        try {
            let monitor = await this.findOneBy(query);

            if (
                (monitor.siteUrls &&
                    monitor.siteUrls.length > 0 &&
                    monitor.siteUrls.includes(data.siteUrl)) ||
                (monitor.data &&
                    monitor.data.url &&
                    monitor.data.url === data.siteUrl)
            ) {
                const error = new Error('Site URL already exists.');
                error.code = 400;
                ErrorService.log('monitorService.addSiteUrl', error);
                throw error;
            }

            const siteUrls = [data.siteUrl, ...monitor.siteUrls];

            monitor = await this.updateOneBy(query, { siteUrls });

            return monitor;
        } catch (error) {
            ErrorService.log('monitorService.addSiteUrl', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query) {
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
            const _this = this;
            const monitorTime = await _this.findOneBy({ _id: monitorId });
            const monitorIncidents = await IncidentService.findBy({
                monitorId,
            });
            const dateNow = moment().utc();
            let days = moment(dateNow)
                .utc()
                .startOf('day')
                .diff(
                    moment(monitorTime.createdAt)
                        .utc()
                        .startOf('day'),
                    'days'
                );

            if (days > 89) days = 89;
            const times = [];
            for (let i = days; i >= 0; i--) {
                let incidents = [];
                const temp = {};
                let status = 'online';
                temp.date = moment(dateNow)
                    .utc()
                    .subtract(i, 'days');
                temp.monitorId = monitorId;
                if (monitorIncidents && monitorIncidents.length) {
                    incidents = monitorIncidents.filter(inc => {
                        const creatediff = moment(temp.date)
                            .utc()
                            .startOf('day')
                            .diff(
                                moment(inc.createdAt)
                                    .utc()
                                    .startOf('day'),
                                'days'
                            );
                        const resolveddiff = moment(temp.date)
                            .utc()
                            .startOf('day')
                            .diff(
                                moment(inc.resolvedAt)
                                    .utc()
                                    .startOf('day'),
                                'days'
                            );
                        if (creatediff > -1 && resolveddiff < 1) return true;
                        else return false;
                    });
                    status = incidents.some(inc =>
                        inc.resolvedAt
                            ? moment(inc.resolvedAt)
                                  .utc()
                                  .startOf('day')
                                  .diff(
                                      moment(temp.date)
                                          .utc()
                                          .startOf('day'),
                                      'days'
                                  ) > 0
                            : true
                    )
                        ? 'offline'
                        : 'online';

                    incidents = incidents.map(inc => {
                        const creatediff = moment(temp.date)
                            .utc()
                            .startOf('day')
                            .diff(
                                moment(inc.createdAt)
                                    .utc()
                                    .startOf('day'),
                                'days'
                            );
                        const resolveddiff = inc.resolvedAt
                            ? moment(temp.date)
                                  .utc()
                                  .startOf('day')
                                  .diff(
                                      moment(inc.resolvedAt)
                                          .utc()
                                          .startOf('day'),
                                      'days'
                                  )
                            : moment(temp.date)
                                  .utc()
                                  .startOf('day')
                                  .diff(
                                      moment()
                                          .utc()
                                          .startOf('day'),
                                      'days'
                                  );
                        if (creatediff > 0 && resolveddiff < 0) {
                            return 1440;
                        } else if (creatediff === 0 && resolveddiff !== 0) {
                            return moment(temp.date)
                                .utc()
                                .endOf('day')
                                .diff(moment(inc.createdAt).utc(), 'minutes');
                        } else if (creatediff !== 0 && resolveddiff === 0) {
                            return moment(temp.date)
                                .utc()
                                .startOf('day')
                                .diff(moment(inc.resolvedAt).utc(), 'minutes');
                        } else if (creatediff === 0 && resolveddiff === 0) {
                            return moment(temp.resolvedAt)
                                .utc()
                                .diff(moment(inc.createdAt).utc(), 'minutes');
                        }
                        return null;
                    });
                }
                if (incidents.length) {
                    const reduced = incidents.reduce((inc, val) => inc + val);
                    temp.downTime = reduced < 1440 ? reduced : 1440;
                    temp.upTime = reduced < 1440 ? 1440 - reduced : 0;
                } else {
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

    restoreBy: async function(query) {
        const _this = this;
        query.deleted = true;
        let monitor = await _this.findBy(query);
        if (monitor && monitor.length > 1) {
            const monitors = await Promise.all(
                monitor.map(async monitor => {
                    const monitorId = monitor._id;
                    monitor = await _this.updateOneBy(
                        { _id: monitorId, deleted: true },
                        {
                            deleted: false,
                            deletedAt: null,
                            deleteBy: null,
                        }
                    );
                    await IncidentService.restoreBy({
                        monitorId,
                        deleted: true,
                    });
                    await AlertService.restoreBy({ monitorId, deleted: true });
                    return monitor;
                })
            );
            return monitors;
        } else {
            monitor = monitor[0];
            if (monitor) {
                const monitorId = monitor._id;
                monitor = await _this.updateOneBy(
                    { _id: monitorId, deleted: true },
                    {
                        deleted: false,
                        deletedAt: null,
                        deleteBy: null,
                    }
                );
                await IncidentService.restoreBy({ monitorId, deleted: true });
                await AlertService.restoreBy({ monitorId, deleted: true });
            }
            return monitor;
        }
    },
};

const MonitorModel = require('../models/monitor');
const ProbeService = require('./probeService');
const MonitorStatusService = require('./monitorStatusService');
const MonitorLogService = require('./monitorLogService');
const MonitorLogByHourService = require('./monitorLogByHourService');
const MonitorLogByDayService = require('./monitorLogByDayService');
const MonitorLogByWeekService = require('./monitorLogByWeekService');
const MonitorCategoryService = require('./monitorCategoryService');
const MonitorCriteriaService = require('./monitorCriteriaService');
const Plans = require('./../config/plans');
const RealTimeService = require('./realTimeService');
const NotificationService = require('./notificationService');
const ProjectService = require('./projectService');
const PaymentService = require('./paymentService');
const IncidentService = require('./incidentService');
const AlertService = require('./alertService');
const StatusPageService = require('./statusPageService');
const ScheduleService = require('./scheduleService');
const IntegrationService = require('./integrationService');
const TeamService = require('./teamService');
const ErrorService = require('./errorService');
const moment = require('moment');
const _ = require('lodash');
const { IS_SAAS_SERVICE } = require('../config/server');
