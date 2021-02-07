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
            const resourceCategory = await ResourceCategoryService.findBy({
                _id: data.resourceCategory,
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
                    monitor.monitorSla = data.monitorSla;
                    monitor.incidentCommunicationSla =
                        data.incidentCommunicationSla;
                    monitor.customFields = data.customFields;
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
                    } else if (data.type === 'incomingHttpRequest') {
                        monitor.data = {};
                        monitor.data.link = data.data.link;
                    }
                    if (resourceCategory) {
                        monitor.resourceCategory = data.resourceCategory;
                    }
                    monitor.visibleOnStatusPage = data.visibleOnStatusPage;
                    monitor.componentId = data.componentId;
                    monitor.projectId = data.projectId;
                    if (data.agentlessConfig) {
                        monitor.agentlessConfig = data.agentlessConfig;
                    }
                    if (
                        data.type === 'url' ||
                        data.type === 'api' ||
                        data.type === 'server-monitor' ||
                        data.type === 'script' ||
                        data.type === 'incomingHttpRequest' ||
                        data.type === 'kubernetes'
                    ) {
                        monitor.criteria = _.isEmpty(data.criteria)
                            ? MonitorCriteriaService.create(data.type)
                            : data.criteria;
                    }

                    if (data.type === 'kubernetes') {
                        monitor.kubernetesConfig = data.kubernetesConfig;
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
                    if (data.type === 'url') {
                        monitor.siteUrls = [monitor.data.url];
                    }
                    const savedMonitor = await monitor.save();
                    monitor = await _this.findOneBy({ _id: savedMonitor._id });
                    if (data.type === 'manual') {
                        await MonitorStatusService.create({
                            monitorId: monitor._id,
                            manuallyCreated: true,
                            status: 'online',
                        });
                    }
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

            await this.updateMonitorSlaStat(query);

            if (data) {
                await MonitorModel.findOneAndUpdate(
                    query,
                    { $set: data },
                    {
                        new: true,
                    }
                );
            }

            if (unsetData) {
                await MonitorModel.findOneAndUpdate(
                    query,
                    { $unset: unsetData },
                    {
                        new: true,
                    }
                );
            }
            query.deleted = false;
            const monitor = await this.findOneBy(query);
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
                .populate('componentId', 'name')
                .populate('resourceCategory', 'name')
                .populate('incidentCommunicationSla')
                .populate('monitorSla');
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
                .populate('componentId', 'name')
                .populate('resourceCategory', 'name')
                .populate('incidentCommunicationSla')
                .populate('monitorSla');
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

                if (project) {
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
                    });
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
                }

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
                await ScheduledEventService.removeMonitor(monitor._id, userId);
                await IncomingRequestService.removeMonitor(monitor._id);
                await IncidentService.removeMonitor(monitor._id, userId);
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

                    const monitorsWithSchedules = await Promise.all(
                        monitors.map(async monitor => {
                            const monitorSchedules = await ScheduleService.findBy(
                                {
                                    monitorIds: monitor._id,
                                }
                            );
                            return {
                                ...monitor.toObject(),
                                schedules: monitorSchedules,
                            };
                        })
                    );

                    const count = await _this.countBy({ projectId: id });
                    return {
                        monitors: monitorsWithSchedules,
                        count,
                        _id: id,
                        skip,
                        limit,
                    };
                })
            );
            return subProjectMonitors;
        } catch (error) {
            ErrorService.log('monitorService.getMonitorsBySubprojects', error);
            throw error;
        }
    },

    async getProbeMonitors(probeId, date) {
        try {
            const newdate = new Date();
            const monitors = await MonitorModel.find({
                $and: [
                    {
                        deleted: false,
                        disabled: false,
                        scriptRunStatus: { $nin: ['inProgress'] },
                    },
                    {
                        $or: [
                            {
                                $and: [
                                    {
                                        type: {
                                            $in: ['server-monitor', 'script'],
                                        },
                                    },
                                    {
                                        $or: [
                                            {
                                                pollTime: { $size: 0 },
                                            },
                                            {
                                                //Avoid monitors that has been pinged during the last interval of time.
                                                pollTime: {
                                                    $not: {
                                                        $elemMatch: {
                                                            date: {
                                                                $gt: date,
                                                            },
                                                        },
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                ],
                            },
                            {
                                $and: [
                                    {
                                        type: {
                                            $in: [
                                                'url',
                                                'device',
                                                'api',
                                                'incomingHttpRequest',
                                                'kubernetes',
                                            ],
                                        },
                                    },
                                    {
                                        $or: [
                                            {
                                                pollTime: {
                                                    $elemMatch: {
                                                        probeId,
                                                        date: { $lt: date },
                                                    },
                                                },
                                            },
                                            {
                                                //pollTime doesn't include the probeId yet.
                                                pollTime: {
                                                    $not: {
                                                        $elemMatch: {
                                                            probeId,
                                                        },
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            });

            if (monitors && monitors.length) {
                await monitors.map(async m => {
                    if (m.type === 'script') {
                        await MonitorModel.updateOne(
                            { _id: m._id, deleted: false },
                            { $set: { scriptRunStatus: 'inProgress' } },
                            { multi: true }
                        );
                    }
                    return m;
                });
                for (const monitor of monitors) {
                    if (
                        monitor.pollTime.length === 0 ||
                        !monitor.pollTime.some(
                            pt => String(pt.probeId) === String(probeId)
                        )
                    ) {
                        await MonitorModel.updateOne(
                            { _id: monitor._id },
                            { $push: { pollTime: { probeId, date: newdate } } }
                        );
                    } else {
                        await MonitorModel.updateOne(
                            {
                                _id: monitor._id,
                                pollTime: {
                                    $elemMatch: {
                                        probeId,
                                    },
                                },
                            },
                            { $set: { 'pollTime.$.date': newdate } }
                        );
                    }
                }
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
                { lastPingTime: newdate }
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

            await this.updateMonitorSlaStat({ _id: monitorId });

            const monitor = await this.findOneBy({ _id: monitorId });
            const isNewMonitor =
                moment(endDate).diff(moment(monitor.createdAt), 'days') < 2;

            let probes;
            const probeLogs = [];
            if (monitor.type === 'server-monitor' && !monitor.agentlessConfig) {
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

    async getMonitorLogsByDay(monitorId, startDate, endDate, filter) {
        try {
            const start = moment(startDate).toDate();
            const end = moment(endDate).toDate();
            const monitor = await this.findOneBy({ _id: monitorId });
            let probes;
            if (monitor.type === 'server-monitor' && !monitor.agentlessConfig) {
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
                const monitorLogs = await MonitorLogByDayService.findBy(
                    query,
                    null,
                    null,
                    filter
                );
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
                (monitor.type === 'server-monitor' &&
                    !monitor.agentlessConfig) ||
                monitor.type === 'manual'
            ) {
                probes = [undefined];
            } else {
                probes = await ProbeService.findBy({});
            }

            for (const probe of probes) {
                const query = {
                    monitorId,
                    $and: [
                        { startTime: { $lte: end } },
                        {
                            $or: [
                                { endTime: { $gte: start } },
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
                monitor.siteUrls &&
                monitor.siteUrls.length > 0 &&
                monitor.siteUrls.includes(data.siteUrl)
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

    removeSiteUrl: async function(query, data) {
        try {
            let monitor = await this.findOneBy(query);
            const siteUrlIndex =
                monitor.siteUrls && monitor.siteUrls.length > 0
                    ? monitor.siteUrls.indexOf(data.siteUrl)
                    : -1;

            if (siteUrlIndex === -1) {
                const error = new Error('Site URL does not exist.');
                error.code = 400;
                ErrorService.log('monitorService.removeSiteUrl', error);
                throw error;
            }

            if (monitor.siteUrls && monitor.siteUrls.length > 0) {
                monitor.siteUrls.splice(siteUrlIndex, 1);
            }
            const siteUrls = monitor.siteUrls;

            monitor = await this.updateOneBy(query, { siteUrls });

            return monitor;
        } catch (error) {
            ErrorService.log('monitorService.removeSiteUrl', error);
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
        const monitor = await _this.findBy(query);
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
        }
    },

    // checks if the monitor uptime stat is within the defined uptime on monitor sla
    // then update the monitor => breachedMonitorSla
    updateMonitorSlaStat: async function(query) {
        try {
            const _this = this;
            const currentDate = moment().format();
            let startDate = moment(currentDate).subtract(30, 'days'); // default frequency
            const monitor = await this.findOneBy(query);
            if (monitor) {
                // eslint-disable-next-line prefer-const
                let { monitorSla, projectId } = monitor;

                if (!monitorSla) {
                    monitorSla = await MonitorSlaService.findOneBy({
                        projectId: projectId._id,
                        isDefault: true,
                    });
                }

                if (monitorSla) {
                    startDate = moment(currentDate)
                        .subtract(Number(monitorSla.frequency), 'days')
                        .format();

                    const monitorStatus = await _this.getMonitorStatuses(
                        monitor._id,
                        startDate,
                        currentDate
                    );
                    const { uptimePercent } = await _this.calculateTime(
                        monitorStatus[0].statuses,
                        startDate,
                        Number(monitorSla.frequency)
                    );

                    const monitorUptime =
                        uptimePercent !== 100 && !isNaN(uptimePercent)
                            ? uptimePercent.toFixed(3)
                            : '100';
                    const slaUptime = Number(monitorSla.monitorUptime).toFixed(
                        3
                    );

                    if (Number(monitorUptime) < Number(slaUptime)) {
                        // monitor sla is breached for this monitor
                        await MonitorModel.findOneAndUpdate(
                            { _id: monitor._id },
                            { $set: { breachedMonitorSla: true } }
                        );
                    } else {
                        await MonitorModel.findOneAndUpdate(
                            { _id: monitor._id },
                            { $set: { breachedMonitorSla: false } }
                        );
                    }

                    const monitorData = await this.findOneBy({
                        _id: monitor._id,
                    });
                    await RealTimeService.monitorEdit(monitorData);
                }
            }
        } catch (error) {
            ErrorService.log('monitorService.updateMonitorSlaStat', error);
            throw error;
        }
    },

    calculateTime: async function(statuses, start, range) {
        const timeBlock = [];
        let totalUptime = 0;
        let totalTime = 0;

        let dayStart = moment(start).startOf('day');

        const reversedStatuses = statuses.slice().reverse();

        for (let i = 0; i < range; i++) {
            const dayStartIn = dayStart;
            const dayEnd =
                i && i > 0 ? dayStart.clone().endOf('day') : moment(Date.now());

            const timeObj = {
                date: dayStart.toISOString(),
                downTime: 0,
                upTime: 0,
                degradedTime: 0,
            };
            /**
             * If two incidents of the same time overlap, we merge them
             * If two incidents of different type overlap, The priority will be:
             * offline, degraded and online.
             *      if the less important incident starts after and finish before the other incident, we remove it.
             *      if the less important incident overlaps with the other incident, we update its start/end time.
             *      if the less important incident start before and finish after the other incident, we divide it into two parts
             *          the first part ends before the important incident,
             *          the second part start after the important incident.
             * The time report will be generate after the following steps:
             * 1- selecting the incident that happendend during the selected day.
             *   In other words: The incidents that overlap with `dayStartIn` and `dayEnd`.
             * 2- Sorting them, to reduce the complexity of the next step (https://www.geeksforgeeks.org/merging-intervals/).
             * 3- Checking for overlaps between incidents. Merge incidents of the same type, reduce the time of the less important incidents.
             * 4- Fill the timeObj
             */
            //First step
            let incidentsHappenedDuringTheDay = [];
            reversedStatuses.forEach(monitorStatus => {
                if (monitorStatus.endTime === null) {
                    monitorStatus.endTime = new Date().toISOString();
                }

                if (
                    moment(monitorStatus.startTime).isBefore(dayEnd) &&
                    moment(monitorStatus.endTime).isAfter(dayStartIn)
                ) {
                    const start = moment(monitorStatus.startTime).isBefore(
                        dayStartIn
                    )
                        ? dayStartIn
                        : moment(monitorStatus.startTime);
                    const end = moment(monitorStatus.endTime).isAfter(dayEnd)
                        ? dayEnd
                        : moment(monitorStatus.endTime);
                    incidentsHappenedDuringTheDay.push({
                        start,
                        end,
                        status: monitorStatus.status,
                    });
                }
            });
            //Second step
            incidentsHappenedDuringTheDay.sort((a, b) =>
                moment(a.start).isSame(b.start)
                    ? 0
                    : moment(a.start).isAfter(b.start)
                    ? 1
                    : -1
            );
            //Third step
            for (let i = 0; i < incidentsHappenedDuringTheDay.length - 1; i++) {
                const firstIncidentIndex = i;
                const nextIncidentIndex = i + 1;
                const firstIncident =
                    incidentsHappenedDuringTheDay[firstIncidentIndex];
                const nextIncident =
                    incidentsHappenedDuringTheDay[nextIncidentIndex];
                if (
                    moment(firstIncident.end).isSameOrBefore(nextIncident.start)
                )
                    continue;

                if (firstIncident.status === nextIncident.status) {
                    const end = moment(firstIncident.end).isAfter(
                        nextIncident.end
                    )
                        ? firstIncident.end
                        : nextIncident.end;
                    firstIncident.end = end;
                    incidentsHappenedDuringTheDay.splice(nextIncidentIndex, 1);
                } else {
                    //if the firstIncident has a higher priority
                    if (
                        firstIncident.status === 'offline' ||
                        (firstIncident.status === 'degraded' &&
                            nextIncident.status === 'online')
                    ) {
                        if (
                            moment(firstIncident.end).isAfter(nextIncident.end)
                        ) {
                            incidentsHappenedDuringTheDay.splice(
                                nextIncidentIndex,
                                1
                            );
                        } else {
                            nextIncident.start = firstIncident.end;
                            //we will need to shift the next incident to keep the array sorted.
                            incidentsHappenedDuringTheDay.splice(
                                nextIncidentIndex,
                                1
                            );
                            let j = nextIncidentIndex;
                            while (j < incidentsHappenedDuringTheDay.length) {
                                if (
                                    moment(nextIncident.start).isBefore(
                                        incidentsHappenedDuringTheDay[j].start
                                    )
                                )
                                    break;
                                j += 1;
                            }
                            incidentsHappenedDuringTheDay.splice(
                                j,
                                0,
                                nextIncident
                            );
                        }
                    } else {
                        if (
                            moment(firstIncident.end).isBefore(nextIncident.end)
                        ) {
                            firstIncident.end = nextIncident.start;
                        } else {
                            /**
                             * The firstIncident is less important than the next incident,
                             * it also starts before and ends after the nextIncident.
                             * In the case The first incident needs to be devided into to two parts.
                             * The first part comes before the nextIncident,
                             * the second one comes after the nextIncident.
                             */
                            const newIncident = {
                                start: nextIncident.end,
                                end: firstIncident.end,
                                status: firstIncident.status,
                            };
                            firstIncident.end = nextIncident.start;
                            let j = nextIncidentIndex + 1;
                            while (j < incidentsHappenedDuringTheDay.length) {
                                if (
                                    moment(newIncident.start).isBefore(
                                        incidentsHappenedDuringTheDay[j].start
                                    )
                                )
                                    break;
                                j += 1;
                            }
                            incidentsHappenedDuringTheDay.splice(
                                j,
                                0,
                                newIncident
                            );
                        }
                    }
                }
                i--;
            }
            //Remove events having start and end time equal.
            incidentsHappenedDuringTheDay = incidentsHappenedDuringTheDay.filter(
                event => !moment(event.start).isSame(event.end)
            );
            //Last step
            for (const incident of incidentsHappenedDuringTheDay) {
                const { start, end, status } = incident;
                if (status === 'offline') {
                    timeObj.downTime =
                        timeObj.downTime + end.diff(start, 'seconds');
                    timeObj.date = end.toISOString();
                }
                if (status === 'degraded') {
                    timeObj.degradedTime =
                        timeObj.degradedTime + end.diff(start, 'seconds');
                }
                if (status === 'online') {
                    timeObj.upTime =
                        timeObj.upTime + end.diff(start, 'seconds');
                }
            }

            totalUptime = totalUptime + timeObj.upTime;
            totalTime =
                totalTime +
                timeObj.upTime +
                timeObj.degradedTime +
                timeObj.downTime;

            timeBlock.push(Object.assign({}, timeObj));

            dayStart = dayStart.subtract(1, 'days');
        }

        return { timeBlock, uptimePercent: (totalUptime / totalTime) * 100 };
    },

    closeBreachedMonitorSla: async function(projectId, monitorId, userId) {
        try {
            const monitor = await MonitorModel.findOneAndUpdate(
                {
                    _id: monitorId,
                    projectId,
                    breachedMonitorSla: true,
                    deleted: false,
                },
                {
                    $push: { breachClosedBy: userId },
                },
                { new: true }
            );

            return monitor;
        } catch (error) {
            ErrorService.log('monitorService.closeBreachedMonitorSla', error);
            throw error;
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
const ResourceCategoryService = require('./resourceCategoryService');
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
const ScheduledEventService = require('./scheduledEventService');
const MonitorSlaService = require('./monitorSlaService');
const IncomingRequestService = require('./incomingRequestService');
