module.exports = {
    //Description: Upsert function for monitor.
    //Params:
    //Param 1: data: MonitorModal.
    //Returns: promise with monitor model or error.
    create: async function(data) {
        try {
            const _this = this;
            let subProject = null;

            const query = {
                name: data.name,
                componentId: data.componentId,
                projectId: data.projectId,
            };
            const select = 'name _id';
            const existingMonitor = await _this.findBy({
                query,
                select,
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
                query: { _id: data.projectId },
                select: 'parentProjectId _id users stripePlanId',
            });
            if (project.parentProjectId) {
                subProject = project;
                project = await ProjectService.findOneBy({
                    query: { _id: subProject.parentProjectId },
                    select: '_id users stripePlanId',
                });
            }
            let subProjectIds = [];
            const selectResourceCat = 'projectId name createdById createdAt';
            const [subProjects, count, resourceCategory] = await Promise.all([
                ProjectService.findBy({
                    query: { parentProjectId: project._id },
                    select: '_id users', // Subprojects require it for monitor creation
                }),
                _this.countBy({
                    projectId: { $in: subProjectIds },
                }),
                ResourceCategoryService.findBy({
                    query: { _id: data.resourceCategory },
                    select: selectResourceCat,
                }),
            ]);
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
                    monitor.scripts = data.scripts || [];
                    if (data.type === 'url' || data.type === 'api') {
                        monitor.data = {};
                        monitor.data.url = data.data.url;
                    } else if (data.type === 'manual') {
                        monitor.data = {};
                        monitor.data.description =
                            data.data.description || null;
                    } else if (data.type === 'script') {
                        monitor.data = {};
                        monitor.data.script = data.data.script;
                    } else if (data.type === 'incomingHttpRequest') {
                        monitor.data = {};
                        monitor.data.link = data.data.link;
                    } else if (data.type === 'ip') {
                        monitor.data = {};
                        monitor.data.IPAddress = data.data.IPAddress;
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
                        data.type === 'kubernetes' ||
                        data.type === 'ip'
                    ) {
                        monitor.criteria = _.isEmpty(data.criteria)
                            ? MonitorCriteriaService.create(data.type)
                            : data.criteria;
                    }

                    if (data.type === 'kubernetes') {
                        monitor.kubernetesConfig = data.kubernetesConfig;
                        monitor.kubernetesNamespace = data.kubernetesNamespace;
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
                    if (data && data.name) {
                        monitor.slug = getSlug(data.name);
                    }
                    const savedMonitor = await monitor.save();

                    const select =
                        '_id name slug data type monitorSla breachedMonitorSla breachClosedBy componentId projectId incidentCommunicationSla criteria agentlessConfig lastPingTime lastMatchedCriterion method bodyType formData text headers disabled pollTime updateTime customFields';
                    const populate = [
                        {
                            path: 'monitorSla',
                            select: 'frequency _id',
                        },
                        { path: 'componentId', select: 'name' },
                        { path: 'incidentCommunicationSla', select: '_id' },
                    ];
                    monitor = await _this.findOneBy({
                        query: { _id: savedMonitor._id },
                        select,
                        populate,
                    });
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

    markMonitorsAsShouldNotMonitor: async function(monitorIds) {
        await MonitorModel.updateMany(
            {
                _id: { $in: monitorIds },
            },
            {
                $set: { shouldNotMonitor: true },
            }
        );
    },

    markMonitorsAsShouldMonitor: async function(monitorIds) {
        await MonitorModel.updateMany(
            {
                _id: { $in: monitorIds },
            },
            {
                $set: { shouldNotMonitor: false },
            }
        );
    },

    unsetColumnsOfManyMonitors: async function(monitorIds, columns) {
        await MonitorModel.updateMany(
            {
                _id: { $in: monitorIds },
            },
            {
                $unset: { ...columns },
            }
        );
    },

    updateManyIncidentCommunicationSla: async function(
        monitorIds,
        incidentCommunicationSlaId
    ) {
        await MonitorModel.updateMany(
            {
                _id: { $in: monitorIds },
            },
            {
                $set: { incidentCommunicationSla: incidentCommunicationSlaId },
            }
        );
    },

    updateManyMonitorSla: async function(monitorIds, monitorSlaId) {
        await MonitorModel.updateMany(
            {
                _id: { $in: monitorIds },
            },
            {
                $set: { monitorSla: monitorSlaId },
            }
        );
    },

    updateCriterion: async function(_id, lastMatchedCriterion) {
        await MonitorModel.updateOne(
            { _id },
            { $set: { lastMatchedCriterion } },
            {
                new: true,
            }
        );
    },

    updateLighthouseScanStatus: async function(
        _id,
        lighthouseScanStatus,
        lighthouseScannedBy
    ) {
        const updateData = {};

        if (lighthouseScanStatus !== 'scanning') {
            updateData.lighthouseScannedAt = Date.now();
            updateData.lighthouseScannedBy = lighthouseScannedBy;
        } else {
            updateData.fetchLightHouse = null;
        }

        await MonitorModel.updateOne(
            { _id },
            {
                $set: {
                    lighthouseScanStatus,
                    ...updateData,
                },
            },
            {
                new: true,
            }
        );

        const select =
            '_id name slug data type monitorSla breachedMonitorSla breachClosedBy componentId projectId incidentCommunicationSla criteria agentlessConfig lastPingTime lastMatchedCriterion method bodyType formData text headers disabled pollTime updateTime customFields siteUrls lighthouseScanStatus';
        const query = { _id };

        const monitor = await this.findOneBy({ query, select });
        RealTimeService.monitorEdit(monitor);
        return monitor;
    },

    disableMonitor: async function(_id, isDisabledOrEnable) {
        await MonitorModel.updateOne(
            { _id },
            {
                $set: {
                    disabled: isDisabledOrEnable,
                },
            }
        );
    },

    updateScriptStatus: async function(_id, scriptRunStatus, scriptRunBy) {
        await MonitorModel.updateOne(
            { _id },
            {
                $set: {
                    scriptRunStatus,
                    scriptRunBy,
                },
            },
            {
                new: true,
            }
        );
    },

    updateOneBy: async function(query, data, unsetData) {
        const _this = this;

        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;

            await this.updateMonitorSlaStat(query);

            let errorMsg;
            if (data && data.customFields && data.customFields.length > 0) {
                const select = '_id';
                const monitor = await _this.findOneBy({ query, select });
                for (const field of data.customFields) {
                    if (field.uniqueField) {
                        const query = {
                            customFields: {
                                $elemMatch: {
                                    fieldName: field.fieldName,
                                    fieldType: field.fieldType,
                                    fieldValue: field.fieldValue,
                                },
                            },
                        };
                        const _monitor = await _this.findOneBy({
                            query,
                            select,
                        });

                        if (
                            _monitor &&
                            String(monitor._id) !== String(_monitor._id)
                        ) {
                            errorMsg = `The field ${field.fieldName} should be unique. It already exists on another monitor.`;
                        }
                    }
                }
            }

            if (errorMsg) {
                const error = new Error(errorMsg);
                error.code = 400;
                throw error;
            }

            if (data) {
                if (data.name) {
                    data.slug = getSlug(data.name);
                }
                await MonitorModel.updateOne(
                    query,
                    { $set: data },
                    {
                        new: true,
                    }
                );
            }

            if (unsetData) {
                await MonitorModel.updateOne(
                    query,
                    { $unset: unsetData },
                    {
                        new: true,
                    }
                );
            }
            query.deleted = false;

            const select =
                '_id name slug data type monitorSla breachedMonitorSla breachClosedBy componentId projectId incidentCommunicationSla criteria agentlessConfig lastPingTime lastMatchedCriterion method bodyType formData text headers disabled pollTime updateTime customFields siteUrls lighthouseScanStatus';
            const populate = [
                {
                    path: 'monitorSla',
                    select: 'frequency _id',
                },
                { path: 'componentId', select: 'name slug' },
                { path: 'incidentCommunicationSla', select: '_id' },
            ];
            const monitor = await this.findOneBy({ query, select, populate });
            // run in the background
            RealTimeService.monitorEdit(monitor);

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
            const select =
                '_id name slug data type monitorSla breachedMonitorSla breachClosedBy componentId projectId incidentCommunicationSla criteria agentlessConfig lastPingTime lastMatchedCriterion method bodyType formData text headers disabled pollTime updateTime customFields';
            const populate = [
                {
                    path: 'monitorSla',
                    select: 'frequency _id',
                },
                { path: 'componentId', select: 'name' },
                { path: 'incidentCommunicationSla', select: '_id' },
            ];
            updatedData = await this.findBy({ query, select, populate });
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
    async findBy({ query, limit, skip, populate = null, select }) {
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

            let monitorQuery = MonitorModel.find(query)
                .lean()
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);

            monitorQuery = handleSelect(select, monitorQuery);
            monitorQuery = handlePopulate(populate, monitorQuery);

            const monitors = await monitorQuery;
            return monitors;
        } catch (error) {
            ErrorService.log('monitorService.findBy', error);
            throw error;
        }
    },

    async findOneBy({ query, populate = null, select }) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;

            let monitorQuery = MonitorModel.findOne(query).lean();

            monitorQuery = handleSelect(select, monitorQuery);
            monitorQuery = handlePopulate(populate, monitorQuery);

            const monitor = await monitorQuery;
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
            const count = await MonitorModel.countDocuments(query);
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
                    query: { _id: monitor.projectId._id || monitor.projectId },
                    select: 'parentProjectId _id seats stripeSubscriptionId',
                });

                if (project) {
                    if (project.parentProjectId) {
                        subProject = project;
                        project = await ProjectService.findOneBy({
                            query: { _id: subProject.parentProjectId },
                            select: '_id seats stripeSubscriptionId',
                        });
                    }

                    let subProjectIds = [];
                    const subProjects = await ProjectService.findBy({
                        query: { parentProjectId: project._id },
                        select: '_id',
                    });
                    if (subProjects && subProjects.length > 0) {
                        subProjectIds = subProjects.map(project => project._id);
                    }
                    subProjectIds.push(project._id);
                    const [monitorsCount, projectUsers] = await Promise.all([
                        this.countBy({
                            projectId: { $in: subProjectIds },
                        }),
                        TeamService.getTeamMembersBy({
                            parentProjectId: project._id,
                        }),
                    ]);
                    let projectSeats = project.seats;
                    if (typeof projectSeats === 'string') {
                        projectSeats = parseInt(projectSeats);
                    }
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
                    select: '_id userId',
                });

                await Promise.all(
                    alerts.map(async alert => {
                        await AlertService.deleteBy({ _id: alert._id }, userId);
                    })
                );

                NotificationService.create(
                    monitor.projectId,
                    `A Monitor ${monitor.name} was deleted from the project by ${monitor.deletedById.name}`,
                    monitor.deletedById._id,
                    'monitoraddremove'
                );

                // run in the background
                // no need to delay request
                StatusPageService.removeMonitor(monitor._id);
                ScheduleService.removeMonitor(monitor._id);
                ScheduledEventService.removeMonitor(monitor._id, userId);
                IncomingRequestService.removeMonitor(monitor._id);
                IncidentService.removeMonitor(monitor._id, userId);
                IntegrationService.removeMonitor(monitor._id, userId);
                RealTimeService.sendMonitorDelete(monitor);

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

            const select =
                '_id name slug resourceCategory data type monitorSla breachedMonitorSla breachClosedBy componentId projectId incidentCommunicationSla criteria agentlessConfig lastPingTime lastMatchedCriterion method bodyType formData text headers disabled pollTime updateTime customFields siteUrls lighthouseScanStatus';
            const populate = [
                {
                    path: 'monitorSla',
                    select: 'frequency _id',
                },
                { path: 'componentId', select: 'name' },
                { path: 'incidentCommunicationSla', select: '_id' },
                { path: 'resourceCategory', select: 'name' },
            ];
            const subProjectMonitors = await Promise.all(
                subProjectIds.map(async id => {
                    const [monitors, count] = await Promise.all([
                        _this.findBy({
                            query: { projectId: id },
                            limit,
                            skip,
                            select,
                            populate,
                        }),
                        _this.countBy({ projectId: id }),
                    ]);

                    const monitorsWithStatus = await Promise.all(
                        monitors.map(async monitor => {
                            let monitorStatus;

                            const incidentList = [];

                            const monitorIncidents = await IncidentService.findBy(
                                {
                                    query: {
                                        'monitors.monitorId': monitor._id,
                                        resolved: false,
                                    },
                                    select: 'incidentType',
                                }
                            );

                            for (const incident of monitorIncidents) {
                                incidentList.push(incident.incidentType);
                            }

                            if (monitor.disabled) {
                                monitorStatus = 'disabled';
                            } else if (incidentList.includes('offline')) {
                                monitorStatus = 'offline';
                            } else if (incidentList.includes('degraded')) {
                                monitorStatus = 'degraded';
                            } else {
                                monitorStatus = 'online';
                            }

                            return {
                                ...monitor,
                                status: monitorStatus,
                            };
                        })
                    );

                    const populateSchedule = [
                        { path: 'userIds', select: 'name' },
                        { path: 'createdById', select: 'name' },
                        { path: 'monitorIds', select: 'name' },
                        {
                            path: 'projectId',
                            select: '_id name slug',
                        },
                        {
                            path: 'escalationIds',
                            select: 'teams',
                            populate: {
                                path: 'teams.teamMembers.userId',
                                select: 'name email',
                            },
                        },
                    ];

                    const selectSchedule =
                        '_id name slug projectId createdById monitorsIds escalationIds createdAt isDefault userIds';
                    const monitorsWithSchedules = await Promise.all(
                        monitorsWithStatus.map(async monitor => {
                            const monitorSchedules = await ScheduleService.findBy(
                                {
                                    query: { monitorIds: monitor._id },
                                    select: selectSchedule,
                                    populate: populateSchedule,
                                }
                            );
                            return {
                                ...monitor,
                                schedules: monitorSchedules,
                            };
                        })
                    );

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
                    },
                    {
                        $or: [
                            {
                                // This block only applies to server-monitors.
                                $and: [
                                    {
                                        type: {
                                            $in: ['server-monitor'],
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
                                                'api',
                                                'incomingHttpRequest',
                                                'kubernetes',
                                                'ip',
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
                const updatePromises = [];
                const createNewPollTimeMonitorIds = [];
                const updatePollTimeMonitorIds = [];

                for (const monitor of monitors) {
                    if (
                        monitor.pollTime.length === 0 ||
                        !monitor.pollTime.some(
                            pt => String(pt.probeId) === String(probeId)
                        )
                    ) {
                        createNewPollTimeMonitorIds.push(monitor._id);
                    } else {
                        updatePollTimeMonitorIds.push(monitor._id);
                    }
                }

                updatePromises.push(
                    MonitorModel.updateMany(
                        { _id: { $in: createNewPollTimeMonitorIds } },
                        {
                            $push: {
                                pollTime: { probeId, date: newdate },
                            },
                        }
                    )
                );

                updatePromises.push(
                    MonitorModel.updateMany(
                        {
                            _id: { $in: updatePollTimeMonitorIds },
                            pollTime: {
                                $elemMatch: {
                                    probeId,
                                },
                            },
                        },
                        { $set: { 'pollTime.$.date': newdate } }
                    )
                );

                await Promise.all(updatePromises);

                return monitors;
            } else {
                return [];
            }
        } catch (error) {
            ErrorService.log('monitorService.getProbeMonitors', error);
            throw error;
        }
    },

    async getScriptMonitors() {
        const moment = require('moment');
        try {
            const monitors = await MonitorModel.find({
                $and: [
                    {
                        deleted: false,
                        disabled: false,
                        type: 'script',
                    },
                    {
                        $or: [
                            {
                                // ignore scripts that are running / inProgress
                                scriptRunStatus: {
                                    $nin: ['inProgress'],
                                },
                            },
                            // runaway script monitors that have been running for too long (10mins)**
                            // or weren't completed due to a crash
                            {
                                lastPingTime: {
                                    $lte: moment()
                                        .subtract(10, 'minutes')
                                        .toDate(),
                                },
                            },
                        ],
                    },
                ],
            });

            // update state of selected script monitors to inProgress
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

                return monitors;
            } else {
                return [];
            }
        } catch (error) {
            ErrorService.log('monitorService.getProbeMonitors', error);
            throw error;
        }
    },

    async getUrlMonitorsNotScannedByLightHouseInPastOneDay() {
        try {
            const oneDay = moment()
                .subtract(1, 'days')
                .toDate();

            const monitors = await MonitorModel.find({
                $and: [
                    {
                        deleted: false,
                        disabled: false,
                        type: 'url',
                    },
                    {
                        $or: [
                            {
                                lighthouseScanStatus: {
                                    $exists: false, // Lighthouse scan status does not exist
                                },
                            },
                            {
                                lighthouseScanStatus: {
                                    $exists: true,
                                    $nin: ['scanning', 'scanned'], // Lighthouse scan status exist but 'failed' or the 'scan' button is clicked from UI
                                },
                            },
                            { lighthouseScannedAt: { $lt: oneDay } },
                        ],
                    },
                ],
            });

            return monitors;
        } catch (error) {
            ErrorService.log(
                'monitorService.getUrlMonitorsNotScannedByLightHouseInPastOneDay',
                error
            );
            throw error;
        }
    },

    async updateMonitorPingTime(id) {
        try {
            const newdate = new Date();

            const monitor = await MonitorModel.findOneAndUpdate(
                {
                    _id: id,
                },
                { $set: { lastPingTime: newdate } }
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
                query: { projectId: projectId, data: { deviceId: deviceId } },
                select: '_id',
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

            const select = 'type agentlessConfig createdAt';
            const monitor = await this.findOneBy({
                query: { _id: monitorId },
                select,
            });

            let probes;
            const probeLogs = [];
            if (monitor) {
                const isNewMonitor =
                    moment(endDate).diff(moment(monitor.createdAt), 'days') < 2;
                if (
                    monitor.type === 'server-monitor' &&
                    !monitor.agentlessConfig
                ) {
                    probes = [undefined];
                } else {
                    probes = await ProbeService.findBy({
                        query: {},
                        select: '_id',
                    });
                }

                const selectMonitorLogBy =
                    'monitorId probeId status responseTime responseStatus cpuLoad avgCpuLoad cpuCores memoryUsed totalMemory swapUsed storageUsed totalStorage storageUsage mainTemp maxTemp createdAt intervalDate maxResponseTime maxCpuLoad maxMemoryUsed maxStorageUsed maxMainTemp sslCertificate kubernetesLog';

                const selectMonitorLog =
                    'monitorId probeId status responseTime responseStatus responseBody responseHeader cpuLoad avgCpuLoad cpuCores memoryUsed totalMemory swapUsed storageUsed totalStorage storageUsage mainTemp maxTemp incidentIds createdAt sslCertificate  kubernetesLog scriptMetadata';

                const populateMonitorLog = [
                    {
                        path: 'probeId',
                        select:
                            'createdAt lastAlive probeKey probeName version probeImage deleted',
                    },
                ];

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
                        monitorLogs = await MonitorLogByWeekService.findBy({
                            query,
                            select: selectMonitorLogBy,
                        });
                    } else if (intervalInDays > 2 && !isNewMonitor) {
                        monitorLogs = await MonitorLogByDayService.findBy({
                            query,
                            select: selectMonitorLogBy,
                        });
                    } else {
                        if (
                            moment(endDate).diff(
                                moment(monitor.createdAt),
                                'minutes'
                            ) > 60
                        ) {
                            monitorLogs = await MonitorLogByHourService.findBy({
                                query,
                                select: selectMonitorLogBy,
                            });
                        } else {
                            monitorLogs = await MonitorLogService.findBy({
                                query,
                                select: selectMonitorLog,
                                populate: populateMonitorLog,
                            });
                        }
                    }

                    if (monitorLogs && monitorLogs.length > 0) {
                        probeLogs.push({
                            _id:
                                typeof probe !== 'undefined' ? probe._id : null,
                            logs: monitorLogs,
                        });
                    }
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
            const monitor = await this.findOneBy({
                query: { _id: monitorId },
                select: 'type agentlessConfig',
            });
            let probes;
            if (monitor.type === 'server-monitor' && !monitor.agentlessConfig) {
                probes = [undefined];
            } else {
                probes = await ProbeService.findBy({
                    query: {},
                    select: '_id',
                });
            }

            const selectMonitorLogBy =
                'monitorId probeId status responseTime responseStatus cpuLoad avgCpuLoad cpuCores memoryUsed totalMemory swapUsed storageUsed totalStorage storageUsage mainTemp maxTemp createdAt intervalDate maxResponseTime maxCpuLoad maxMemoryUsed maxStorageUsed maxMainTemp sslCertificate kubernetesLog';

            const probeLogs = [];
            for (const probe of probes) {
                const query = {
                    monitorId,
                    createdAt: { $gte: start, $lte: end },
                };
                if (typeof probe !== 'undefined') {
                    query.probeId = probe._id;
                }
                const monitorLogs = await MonitorLogByDayService.findBy({
                    query,
                    limit: null,
                    skip: null,
                    filter,
                    select: selectMonitorLogBy,
                });
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
            const monitor = await this.findOneBy({
                query: { _id: monitorId },
                select: 'type agentlessConfig',
            });

            let probes;
            const probeStatuses = [];
            if (
                (monitor &&
                    monitor.type === 'server-monitor' &&
                    !monitor.agentlessConfig) ||
                (monitor && monitor.type === 'manual')
            ) {
                probes = [undefined];
            } else {
                probes = await ProbeService.findBy({
                    query: {},
                    select: '_id',
                });
            }

            for (const probe of probes) {
                const query = {
                    monitorId,
                    $and: [
                        { startTime: { $gte: start } },
                        {
                            $or: [
                                { endTime: { $lte: end } },
                                { endTime: null },
                                { endTime: { $exists: false } },
                            ],
                        },
                    ],
                };
                if (typeof probe !== 'undefined') {
                    // return manually created statuses in every probe
                    query.probeId = { $in: [probe._id, null] };
                }

                const select =
                    '_id monitorId probeId incidentId status manuallyCreated startTime endTime lastStatus createdAt deleted';
                const monitorStatuses = await MonitorStatusService.findBy({
                    query,
                    select,
                });

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
            const project = await ProjectService.findOneBy({
                query,
                select: 'seats stripeSubscriptionId _id',
            });
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
            await ProjectService.updateOneBy(
                { _id: project._id },
                { seats: String(projectSeats) }
            );
            return 'A new seat added. Now you can add a monitor';
        } catch (error) {
            ErrorService.log('monitorService.addSeat', error);
            throw error;
        }
    },

    addSiteUrl: async function(query, data) {
        try {
            let monitor = await this.findOneBy({ query, select: 'siteUrls' });

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
            let monitor = await this.findOneBy({ query, select: 'siteUrls' });
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
            const [monitorTime, monitorIncidents] = await Promise.all([
                _this.findOneBy({
                    query: { _id: monitorId },
                    select: 'createdAt',
                }),
                IncidentService.findBy({
                    query: { 'monitors.monitorId': monitorId },
                    select: 'createdAt resolvedAt',
                }),
            ]);
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
        const select = '_id';
        const monitor = await _this.findBy({ query, select });
        if (monitor && monitor.length > 0) {
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
                    await Promise.all([
                        IncidentService.restoreBy({
                            'monitors.monitorId': monitorId,
                            deleted: true,
                        }),
                        AlertService.restoreBy({ monitorId, deleted: true }),
                    ]);
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
            const populate = [
                { path: 'monitorSla', select: 'frequency monitorUptime' },
            ];
            const monitor = await this.findOneBy({
                query,
                select: '_id monitorSla projectId',
                populate,
            });
            if (monitor) {
                // eslint-disable-next-line prefer-const
                let { monitorSla, projectId } = monitor;

                if (!monitorSla) {
                    monitorSla = await MonitorSlaService.findOneBy({
                        query: {
                            projectId: projectId._id || projectId,
                            isDefault: true,
                        },
                        select: 'frequency monitorUptime',
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
                    if (monitorStatus && monitorStatus.length > 0) {
                        const { uptimePercent } = await _this.calculateTime(
                            monitorStatus[0].statuses,
                            startDate,
                            Number(monitorSla.frequency)
                        );

                        const monitorUptime =
                            uptimePercent !== 100 && !isNaN(uptimePercent)
                                ? uptimePercent.toFixed(3)
                                : '100';
                        const slaUptime = Number(
                            monitorSla.monitorUptime
                        ).toFixed(3);

                        if (Number(monitorUptime) < Number(slaUptime)) {
                            // monitor sla is breached for this monitor
                            await MonitorModel.updateOne(
                                { _id: monitor._id },
                                { $set: { breachedMonitorSla: true } }
                            );
                        } else {
                            await MonitorModel.updateOne(
                                { _id: monitor._id },
                                { $set: { breachedMonitorSla: false } }
                            );
                        }
                    }

                    const select =
                        '_id name slug data type monitorSla breachedMonitorSla breachClosedBy componentId projectId incidentCommunicationSla criteria lastPingTime lastMatchedCriterion method disabled customFields';

                    const monitorData = await this.findOneBy({
                        query: { _id: monitor._id },
                        select,
                    });
                    // run in the background
                    RealTimeService.monitorEdit(monitorData);
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

    changeMonitorComponent: async function(projectId, monitorId, componentId) {
        const [monitor, component] = await Promise.all([
            this.findOneBy({ query: { _id: monitorId }, select: 'projectId' }),
            componentService.findOneBy({
                query: { _id: componentId },
                select: 'projectId',
            }),
        ]);

        // ensure monitor and component belong to same project
        if (
            String(monitor.projectId) !== String(projectId) ||
            String(component.projectId) !== String(projectId)
        ) {
            throw new Error(
                'Monitor and component do not belong to the same project or sub-project'
            );
        }

        const updatedMonitor = await this.updateOneBy(
            { _id: monitorId },
            { componentId }
        );

        return updatedMonitor;
    },

    calcTime: async function(statuses, start, range) {
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
                disabledTime: 0,
                status: null,
                emptytime: dayStart.toISOString(),
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
            reversedStatuses.forEach(monitor => {
                const monitorStatus = Object.assign({}, monitor);
                if (monitorStatus.endTime === null) {
                    monitorStatus.endTime = new Date().toISOString();
                }

                if (
                    moment(monitorStatus.startTime).isBefore(dayEnd) &&
                    moment(monitorStatus.endTime).isAfter(dayStartIn)
                ) {
                    if (
                        monitor.endTime === null &&
                        (monitor.status === 'offline' ||
                            (monitorStatus.status === 'degraded' &&
                                timeObj.status !== 'offline') ||
                            timeObj.status === null)
                    ) {
                        timeObj.status = monitorStatus.status;
                    }

                    if (
                        monitor.endTime === null &&
                        monitor.status === 'disabled'
                    ) {
                        timeObj.status = monitor.status;
                    }
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

                    timeObj.date = end.toISOString();
                    timeObj.emptytime = null;
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
                        firstIncident.status === 'disabled' ||
                        (firstIncident.status === 'offline' &&
                            nextIncident.status !== 'disabled') ||
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
                if (status === 'disabled') {
                    timeObj.disabledTime =
                        timeObj.disabledTime + end.diff(start, 'seconds');
                    timeObj.date = end.toISOString();
                }
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
                timeObj.downTime +
                timeObj.disabledTime;
            if (timeObj.status === null || timeObj.status === 'online') {
                if (timeObj.disabledTime > 0) timeObj.status = 'disabled';
                else if (timeObj.downTime > 0) timeObj.status = 'offline';
                else if (timeObj.degradedTime > 0) timeObj.status = 'degraded';
                else if (timeObj.upTime > 0) timeObj.status = 'online';
            }
            timeBlock.push(Object.assign({}, timeObj));

            dayStart = dayStart.subtract(1, 'days');
        }

        return { timeBlock, uptimePercent: (totalUptime / totalTime) * 100 };
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
const componentService = require('./componentService');
const getSlug = require('../utils/getSlug');
const handlePopulate = require('../utils/populate');
const handleSelect = require('../utils/select');
