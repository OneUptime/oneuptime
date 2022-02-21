module.exports = {
    findBy: async function({ query, limit, skip, populate, select }) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = parseInt(skip);

        if (typeof limit === 'string') limit = parseInt(limit);

        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;

        let incidentQuery = IncidentModel.find(query)
            .lean()
            .limit(limit)
            .skip(skip)
            .sort({ createdAt: 'desc' });

        incidentQuery = handleSelect(select, incidentQuery);
        incidentQuery = handlePopulate(populate, incidentQuery);

        const incidents = await incidentQuery;
        return incidents;
    },

    create: async function(data) {
        const _this = this;

        if (!data.monitors || data.monitors.length === 0) {
            const error = new Error(
                'You need at least one monitor to create an incident'
            );
            error.code = 400;
            throw error;
        }
        if (!isArrayUnique(data.monitors)) {
            const error = new Error(
                'You cannot have multiple selection of the same monitor'
            );
            error.code = 400;
            throw error;
        }

        let monitors = await MonitorService.findBy({
            query: { _id: { $in: data.monitors } },
            select: 'disabled name _id shouldNotMonitor',
        });
        monitors = monitors.filter(monitor => !monitor.disabled);
        if (monitors.length === 0) {
            const error = new Error(
                'You need at least one enabled monitor to create an incident'
            );
            error.code = 400;
            throw error;
        }
        const monitorNames = monitors.map(monitor => monitor.name);
        monitors = monitors
            .filter(monitor => !monitor.shouldNotMonitor)
            .map(monitor => ({
                monitorId: monitor._id,
            }));
        if (monitors.length === 0) {
            const error = new Error(
                'You need at least one monitor not undergoing scheduled maintenance'
            );
            error.code = 400;
            throw error;
        }
        if (monitors && monitors.length > 0) {
            const { matchedCriterion } = data;

            const project = await ProjectService.findOneBy({
                query: { _id: data.projectId },
                select: 'users parentProjectId name',
            });
            const users =
                project && project.users && project.users.length
                    ? project.users.map(({ userId }) => userId)
                    : [];

            let errorMsg;
            if (data.customFields && data.customFields.length > 0) {
                for (const field of data.customFields) {
                    if (
                        field.uniqueField &&
                        field.fieldValue &&
                        field.fieldValue.trim()
                    ) {
                        const incident = await _this.findOneBy({
                            query: {
                                customFields: {
                                    $elemMatch: {
                                        fieldName: field.fieldName,
                                        fieldType: field.fieldType,
                                        fieldValue: field.fieldValue,
                                    },
                                },
                            },
                            select: '_id',
                        });

                        if (incident) {
                            errorMsg = `The field ${field.fieldName} must be unique for all incidents`;
                        }
                    }
                }
            }

            if (errorMsg) {
                const error = new Error(errorMsg);
                error.code = 400;
                throw error;
            }

            let incident = new IncidentModel();
            let parentCount = 0,
                deletedParentCount = 0;
            if (project && project.parentProjectId) {
                const [pCount, dpCount] = await Promise.all([
                    _this.countBy({
                        projectId:
                            project.parentProjectId._id ||
                            project.parentProjectId,
                    }),
                    _this.countBy({
                        projectId:
                            project.parentProjectId._id ||
                            project.parentProjectId,
                        deleted: true,
                    }),
                ]);
                parentCount = pCount;
                deletedParentCount = dpCount;
            }
            const [
                incidentsCountInProject,
                deletedIncidentsCountInProject,
            ] = await Promise.all([
                _this.countBy({
                    projectId: data.projectId,
                }),
                _this.countBy({
                    projectId: data.projectId,
                    deleted: true,
                }),
            ]);

            incident.projectId = data.projectId || null;
            incident.monitors = monitors;
            incident.createdById = data.createdById;
            incident.createdByApi = data.createdByApi;
            incident.notClosedBy = users;
            incident.incidentType = data.incidentType;
            incident.manuallyCreated = data.manuallyCreated || false;
            if (data.reason && data.reason.length > 0) {
                incident.reason = data.reason.join('\n');
            }
            incident.response = data.response || null;
            incident.idNumber =
                incidentsCountInProject +
                deletedIncidentsCountInProject +
                parentCount +
                deletedParentCount +
                1;

            incident.slug = getSlug(incident.idNumber); // create incident slug from the idNumber

            incident.customFields = data.customFields;
            incident.createdByIncomingHttpRequest =
                data.createdByIncomingHttpRequest;

            const templatesInput = {
                incidentType: data.incidentType,
                projectName: project?.name,
                time: Moment().format('h:mm:ss a'),
                date: Moment().format('MMM Do YYYY'),
                monitorName: joinNames(monitorNames),
            };

            if (!incident.manuallyCreated) {
                const select =
                    'projectId title description incidentPriority isDefault name';
                const query = {
                    projectId: data.projectId,
                    isDefault: true,
                };
                const incidentSettings = await IncidentSettingsService.findOne({
                    query,
                    select,
                });

                const titleTemplate = Handlebars.compile(
                    incidentSettings.title
                );
                const descriptionTemplate = Handlebars.compile(
                    incidentSettings.description
                );

                incident.title =
                    matchedCriterion && matchedCriterion.title
                        ? matchedCriterion.title
                        : titleTemplate(templatesInput);
                incident.description =
                    matchedCriterion && matchedCriterion.description
                        ? matchedCriterion.description
                        : descriptionTemplate(templatesInput);
                incident.criterionCause = {
                    ...matchedCriterion,
                };

                incident.incidentPriority = incidentSettings.incidentPriority;

                if (data.probeId) {
                    incident.probes = [
                        {
                            probeId: data.probeId,
                            updatedAt: Date.now(),
                            status: true,
                            reportedStatus: data.incidentType,
                        },
                    ];
                }
            } else {
                const titleTemplate = Handlebars.compile(data.title);
                const descriptionTemplate = Handlebars.compile(
                    data.description
                );

                incident.title = titleTemplate(templatesInput);
                incident.description = descriptionTemplate(templatesInput);
                incident.incidentPriority = data.incidentPriority;
            }

            incident = await incident.save();

            // update all monitor status in the background to match incident type
            MonitorService.updateAllMonitorStatus(
                { _id: { $in: data.monitors } },
                { monitorStatus: data.incidentType.toLowerCase() }
            ).catch(error => {
                ErrorService.log(
                    'MonitorService.updateAllMonitorStatus',
                    error
                );
            });

            // ********* TODO ************
            // notification is an array of notifications
            // ***************************

            let populate = [
                {
                    path: 'monitors.monitorId',
                    select: 'name slug componentId projectId type',
                    populate: [
                        { path: 'componentId', select: 'name slug' },
                        { path: 'projectId', select: 'name slug' },
                    ],
                },
                { path: 'createdById', select: 'name' },
                { path: 'projectId', select: 'name slug' },
                { path: 'resolvedBy', select: 'name' },
                { path: 'acknowledgedBy', select: 'name' },
                { path: 'incidentPriority', select: 'name' },
            ];
            let select =
                'slug idNumber notifications _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted';
            const populatedIncident = await _this.findOneBy({
                query: { _id: incident._id },
                populate,
                select,
            });
            const notifications = await _this._sendIncidentCreatedAlert(
                populatedIncident
            );

            incident.notifications = notifications.map(notification => ({
                notificationId: notification._id,
            }));
            incident = await incident.save();

            populate = [
                {
                    path: 'monitors.monitorId',
                    select: 'name slug componentId projectId type',
                    populate: [
                        { path: 'componentId', select: 'name slug' },
                        { path: 'projectId', select: 'name slug' },
                    ],
                },
                { path: 'createdById', select: 'name' },
                { path: 'projectId', select: 'name slug' },
                { path: 'resolvedBy', select: 'name' },
                { path: 'acknowledgedBy', select: 'name' },
                { path: 'incidentPriority', select: 'name color' },
                {
                    path: 'acknowledgedByIncomingHttpRequest',
                    select: 'name',
                },
                { path: 'resolvedByIncomingHttpRequest', select: 'name' },
                { path: 'createdByIncomingHttpRequest', select: 'name' },
                {
                    path: 'probes.probeId',
                    select: 'probeName _id probeImage',
                },
            ];
            select =
                'slug notifications reason acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';
            incident = await _this.findOneBy({
                query: { _id: incident._id },
                select,
                populate,
            });

            try {
                // run in the background
                RealTimeService.sendCreatedIncident(incident);
            } catch (error) {
                ErrorService.log('realtimeService.sendCreatedIncident', error);
            }

            // run in the background
            IncidentMessageService.create({
                content: incident.description,
                incidentId: incident._id,
                createdById: incident.createdById?._id || incident.createdById,
                type: 'investigation',
                incident_state: 'Identified',
                post_statuspage: true,
            }).catch(error => {
                ErrorService.log('IncidentMessageService.create', error);
            });

            await IncidentTimelineService.create({
                incidentId: incident._id,
                createdById: data.createdById,
                probeId: data.probeId,
                status: data.incidentType,
                createdByApi: data.createdByApi,
            });

            // ********* TODO ************
            // handle multiple monitors for this
            // it should now accept array of monitors id
            // ***************************
            _this.startInterval(data.projectId, monitors, incident);

            return incident;
        }
    },

    countBy: async function(query) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        const count = await IncidentModel.countDocuments(query);
        return count;
    },

    deleteBy: async function(query, userId) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const incident = await IncidentModel.findOneAndUpdate(query, {
            $set: {
                deleted: true,
                deletedAt: Date.now(),
                deletedById: userId,
            },
        });

        if (incident) {
            this.clearInterval(incident._id); // clear any existing sla interval

            const monitorStatuses = await MonitorStatusService.findBy({
                query: { incidentId: incident._id },
                select: '_id',
            });
            for (const monitorStatus of monitorStatuses) {
                const { _id } = monitorStatus;
                await MonitorStatusService.deleteBy({ _id }, userId);
            }

            const monitors = incident.monitors.map(
                monitor => monitor.monitorId._id || monitor.monitorId
            );

            // update all monitor status in the background to match incident type
            MonitorService.updateAllMonitorStatus(
                { _id: { $in: monitors } },
                { monitorStatus: 'online' }
            ).catch(error => {
                ErrorService.log(
                    'MonitorService.updateAllMonitorStatus',
                    error
                );
            });

            const populateIncTimeline = [
                { path: 'createdById', select: 'name' },
                {
                    path: 'probeId',
                    select: 'probeName probeImage',
                },
            ];
            const selectIncTimeline =
                'incidentId createdById probeId createdByZapier createdAt status incident_state';
            const incidentTimeline = await IncidentTimelineService.findBy({
                query: { incidentId: incident._id },
                select: selectIncTimeline,
                populate: populateIncTimeline,
            });
            for (const event of incidentTimeline) {
                await IncidentTimelineService.deleteBy(
                    { _id: event._id },
                    userId
                );
            }
        }
        return incident;
    },

    // Description: Get Incident by incident Id.
    // Params:
    // Param 1: monitorId: monitor Id
    // Returns: promise with incident or error.
    findOneBy: async function({ query, populate, select }) {
        if (!query) {
            query = {};
        }

        query.deleted = false;

        let incidentQuery = IncidentModel.findOne(query).lean();

        incidentQuery = handleSelect(select, incidentQuery);
        incidentQuery = handlePopulate(populate, incidentQuery);

        const incident = await incidentQuery;
        return incident;
    },

    updateOneBy: async function(query, data) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        const _this = this;
        const oldIncident = await _this.findOneBy({
            query: { _id: query._id, deleted: { $ne: null } },
            select: 'notClosedBy manuallyCreated',
        });

        const notClosedBy = oldIncident && oldIncident.notClosedBy;
        if (data.notClosedBy) {
            data.notClosedBy = notClosedBy.concat(data.notClosedBy);
        }
        data.manuallyCreated =
            data.manuallyCreated ||
            (oldIncident && oldIncident.manuallyCreated) ||
            false;

        if (
            data.reason &&
            Array.isArray(data.reason) &&
            data.reason.length > 0
        ) {
            data.reason = data.reason.join('\n');
        }

        let updatedIncident = await IncidentModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            { new: true }
        );

        const populate = [
            {
                path: 'monitors.monitorId',
                select: 'name slug componentId projectId type',
                populate: [
                    { path: 'componentId', select: 'name slug' },
                    { path: 'projectId', select: 'name slug' },
                ],
            },
            { path: 'createdById', select: 'name' },
            { path: 'projectId', select: 'name slug' },
            { path: 'resolvedBy', select: 'name' },
            { path: 'acknowledgedBy', select: 'name' },
            { path: 'incidentPriority', select: 'name color' },
            {
                path: 'acknowledgedByIncomingHttpRequest',
                select: 'name',
            },
            { path: 'resolvedByIncomingHttpRequest', select: 'name' },
            { path: 'createdByIncomingHttpRequest', select: 'name' },
            { path: 'probes.probeId', select: 'probeName _id probeImage' },
        ];
        const select =
            'slug notifications reason response hideIncident acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

        updatedIncident = await _this.findOneBy({
            query: { _id: updatedIncident._id },
            select,
            populate,
        });

        RealTimeService.updateIncident(updatedIncident);

        return updatedIncident;
    },

    updateBy: async function(query, data) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let updatedData = await IncidentModel.updateMany(query, {
            $set: data,
        });

        const populate = [
            {
                path: 'monitors.monitorId',
                select: 'name slug componentId projectId type',
                populate: [
                    { path: 'componentId', select: 'name slug' },
                    { path: 'projectId', select: 'name slug' },
                ],
            },
            { path: 'createdById', select: 'name' },
            { path: 'projectId', select: 'name slug' },
            { path: 'resolvedBy', select: 'name' },
            { path: 'acknowledgedBy', select: 'name' },
            { path: 'incidentPriority', select: 'name color' },
            {
                path: 'acknowledgedByIncomingHttpRequest',
                select: 'name',
            },
            { path: 'resolvedByIncomingHttpRequest', select: 'name' },
            { path: 'createdByIncomingHttpRequest', select: 'name' },
            { path: 'probes.probeId', select: 'probeName _id probeImage' },
        ];
        const select =
            'slug notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

        updatedData = await this.findBy({ query, populate, select });
        return updatedData;
    },

    async _sendIncidentCreatedAlert(incident) {
        ZapierService.pushToZapier('incident_created', incident).catch(
            error => {
                ErrorService.log('ZapierService.pushToZapier', error);
            }
        );
        // await RealTimeService.sendCreatedIncident(incident);

        const notifications = [];

        const monitors = incident.monitors.map(monitor => monitor.monitorId);

        // handle this asynchronous operation in the background
        AlertService.sendCreatedIncidentToSubscribers(incident, monitors).catch(
            error => {
                ErrorService.log(
                    'AlertService.sendCreatedIncidentToSubscribers',
                    error
                );
            }
        );

        for (const monitor of monitors) {
            AlertService.sendCreatedIncident(incident, monitor).catch(error => {
                ErrorService.log('AlertService.sendCreatedIncident', error);
            });

            let notification = {};
            // send slack notification
            SlackService.sendNotification(
                incident.projectId._id || incident.projectId,
                incident,
                monitor,
                INCIDENT_CREATED,
                monitor.componentId
            ).catch(error => {
                ErrorService.log('SlackService.sendNotification', error);
            });
            // send webhook notification
            WebHookService.sendIntegrationNotification(
                incident.projectId._id || incident.projectId,
                incident,
                monitor,
                INCIDENT_CREATED,
                monitor.componentId
            ).catch(error => {
                ErrorService.log(
                    'WebHookService.sendIntegrationNotification',
                    error
                );
            });
            // send Ms Teams notification
            MsTeamsService.sendNotification(
                incident.projectId._id || incident.projectId,
                incident,
                monitor,
                INCIDENT_CREATED,
                monitor.componentId
            ).catch(error => {
                ErrorService.log('MsTeamsService.sendNotification', error);
            });

            const meta = {
                type: 'Incident',
                componentId: monitor.componentId._id || monitor.componentId,
                incidentId: incident._id,
            };
            try {
                if (!incident.createdById) {
                    if (incident.createdByIncomingHttpRequest) {
                        const msg = `New ${incident.incidentType} Incident was created for ${monitor.name} by Incoming HTTP Request`;
                        notification = await NotificationService.create(
                            incident.projectId._id || incident.projectId,
                            msg,
                            'incoming http request',
                            'warning',
                            meta
                        );
                    } else {
                        const msg = `New ${incident.incidentType} Incident was created for ${monitor.name} by OneUptime`;
                        notification = await NotificationService.create(
                            incident.projectId._id || incident.projectId,
                            msg,
                            'oneuptime',
                            'warning',
                            meta
                        );
                    }
                } else {
                    const msg = `New ${incident.incidentType} Incident was created for ${monitor.name} by ${incident.createdById.name}`;
                    notification = await NotificationService.create(
                        incident.projectId._id || incident.projectId,
                        msg,
                        incident.createdById.name,
                        'warning',
                        meta
                    );
                }
            } catch (error) {
                ErrorService.log(
                    'incidentService._sendIncidentCreatedAlert',
                    error
                );
            }

            notifications.push(notification);
        }
        return notifications;
    },

    /**
     * @param {object} incidentId incident id
     * @param {string} userId Id of user performing the action.
     * @param {string} name Name of user performing the action.
     * @returns {object} Promise with incident or error.
     */
    acknowledge: async function(
        incidentId,
        userId,
        name,
        probeId,
        zapier,
        httpRequest = {},
        acknowledgedByApi = false
    ) {
        const _this = this;
        let incident = await _this.findOneBy({
            query: { _id: incidentId, acknowledged: false },
            select: '_id',
        });
        if (incident) {
            incident = await _this.updateOneBy(
                {
                    _id: incident._id,
                },
                {
                    acknowledged: true,
                    acknowledgedBy: userId,
                    acknowledgedAt: Date.now(),
                    acknowledgedByZapier: zapier,
                    acknowledgedByIncomingHttpRequest: httpRequest?._id,
                    acknowledgedByApi,
                }
            );

            const downtimestring = IncidentUtilitiy.calculateHumanReadableDownTime(
                incident.createdAt
            );

            try {
                if (isEmpty(httpRequest)) {
                    NotificationService.create(
                        incident.projectId._id || incident.projectId,
                        `An Incident was acknowledged by ${name}`,
                        userId,
                        'acknowledge'
                    );
                } else {
                    NotificationService.create(
                        incident.projectId._id || incident.projectId,
                        `An Incident was acknowledged by an incoming HTTP request ${httpRequest.name}`,
                        userId,
                        'acknowledge'
                    );
                }
            } catch (error) {
                ErrorService.log('notificationService.create', error);
            }

            // Ping webhook
            const monitors = incident.monitors.map(
                monitor => monitor.monitorId
            );

            // assuming all the monitors in the incident is from the same component
            // which makes sense, since having multiple component will make things more complicated

            const populateComponent = [
                { path: 'projectId', select: 'name' },
                { path: 'componentCategoryId', select: 'name' },
            ];

            const selectComponent =
                '_id createdAt name createdById projectId slug componentCategoryId';
            const component = await ComponentService.findOneBy({
                query: {
                    _id:
                        monitors[0] &&
                        monitors[0].componentId &&
                        monitors[0].componentId._id
                            ? monitors[0].componentId._id
                            : monitors[0].componentId,
                },
                select: selectComponent,
                populate: populateComponent,
            });

            // automatically create acknowledgement incident note
            IncidentMessageService.create({
                content: 'This incident has been acknowledged',
                incidentId,
                createdById: userId,
                type: 'investigation',
                incident_state: 'Acknowledged',
                post_statuspage: true,
                monitors,
                ignoreCounter: true,
            }).catch(error => {
                ErrorService.log('IncidentMessageService.create', error);
            });

            await IncidentTimelineService.create({
                incidentId: incidentId,
                createdById: userId,
                probeId: probeId,
                createdByZapier: zapier,
                status: 'acknowledged',
                createdByApi: acknowledgedByApi,
            });

            _this.refreshInterval(incidentId);

            AlertService.sendAcknowledgedIncidentToSubscribers(
                incident,
                monitors
            ).catch(error => {
                ErrorService.log(
                    'AlertService.sendAcknowledgedIncidentToSubscribers',
                    error
                );
            });

            for (const monitor of monitors) {
                WebHookService.sendIntegrationNotification(
                    incident.projectId._id || incident.projectId,
                    incident,
                    monitor,
                    INCIDENT_ACKNOWLEDGED,
                    component,
                    downtimestring
                ).catch(error => {
                    ErrorService.log(
                        'WebHookService.sendIntegrationNotification',
                        error
                    );
                });

                SlackService.sendNotification(
                    incident.projectId._id || incident.projectId,
                    incident,
                    monitor,
                    INCIDENT_ACKNOWLEDGED,
                    component,
                    downtimestring
                ).catch(error => {
                    ErrorService.log('SlackService.sendNotification', error);
                });

                MsTeamsService.sendNotification(
                    incident.projectId._id || incident.projectId,
                    incident,
                    monitor,
                    INCIDENT_ACKNOWLEDGED,
                    component,
                    downtimestring
                ).catch(error => {
                    ErrorService.log('MsTeamsService.sendNotification', error);
                });

                AlertService.sendAcknowledgedIncidentMail(
                    incident,
                    monitor
                ).catch(error => {
                    ErrorService.log(
                        'AlertService.sendAcknowledgedIncidentMail',
                        error
                    );
                });
            }

            ZapierService.pushToZapier('incident_acknowledge', incident).catch(
                error => {
                    ErrorService.log('ZapierService.pushToZapier', error);
                }
            );
            RealTimeService.incidentAcknowledged(incident);
        } else {
            const populate = [
                {
                    path: 'monitors.monitorId',
                    select: 'name slug componentId projectId type',
                    populate: [
                        { path: 'componentId', select: 'name slug' },
                        { path: 'projectId', select: 'name slug' },
                    ],
                },
                { path: 'createdById', select: 'name' },
                { path: 'projectId', select: 'name slug' },
                { path: 'resolvedBy', select: 'name' },
                { path: 'acknowledgedBy', select: 'name' },
                { path: 'incidentPriority', select: 'name color' },
                {
                    path: 'acknowledgedByIncomingHttpRequest',
                    select: 'name',
                },
                { path: 'resolvedByIncomingHttpRequest', select: 'name' },
                { path: 'createdByIncomingHttpRequest', select: 'name' },
                {
                    path: 'probes.probeId',
                    select: 'probeName _id probeImage',
                },
            ];
            const select =
                'slug notifications reason response acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

            incident = await _this.findOneBy({
                query: { _id: incidentId, acknowledged: true },
                populate,
                select,
            });
        }

        return incident;
    },

    // Description: Update user who resolved incident.
    // Params:
    // Param 1: data: {incidentId}
    // Returns: promise with incident or error.
    resolve: async function(
        incidentId,
        userId,
        name,
        probeId,
        zapier,
        httpRequest = {},
        resolvedByApi = false
    ) {
        const _this = this;
        const data = {};
        let incident = await _this.findOneBy({
            query: { _id: incidentId },
            select: '_id acknowledged',
        });

        if (!incident) {
            return;
        }

        if (!incident.acknowledged) {
            data.acknowledged = true;
            data.acknowledgedBy = userId;
            data.acknowledgedAt = Date.now();
            data.acknowledgedByZapier = zapier;
            data.acknowledgedByIncomingHttpRequest = httpRequest?._id;
            data.acknowledgedByApi = resolvedByApi;

            await IncidentTimelineService.create({
                incidentId: incidentId,
                createdById: userId,
                probeId: probeId,
                createdByZapier: zapier,
                status: 'acknowledged',
                createdByApi: resolvedByApi,
            });
        }
        data.resolved = true;
        data.resolvedBy = userId;
        data.resolvedAt = Date.now();
        data.resolvedByZapier = zapier;
        data.resolvedByIncomingHttpRequest = httpRequest?._id;
        data.resolvedByApi = resolvedByApi;

        incident = await _this.updateOneBy({ _id: incidentId }, data);

        const monitors = incident.monitors.map(
            monitor => monitor.monitorId._id || monitor.monitorId
        );

        // update all monitor status in the background to match incident type
        MonitorService.updateAllMonitorStatus(
            { _id: { $in: monitors } },
            { monitorStatus: 'online' }
        ).catch(error => {
            ErrorService.log('MonitorService.updateAllMonitorStatus', error);
        });

        // automatically create resolved incident note
        await IncidentMessageService.create({
            content: 'This incident has been resolved',
            incidentId,
            createdById: userId,
            type: 'investigation',
            incident_state: 'Resolved',
            post_statuspage: true,
            monitors,
            ignoreCounter: true,
        });

        await IncidentTimelineService.create({
            incidentId: incidentId,
            createdById: userId,
            probeId: probeId,
            createdByZapier: zapier,
            status: 'resolved',
            createdByApi: resolvedByApi,
        });

        _this.clearInterval(incidentId);

        const statusData = [];
        // send notificaton to subscribers
        AlertService.sendResolvedIncidentToSubscribers(
            incident,
            monitors
        ).catch(error => {
            ErrorService.log(
                'AlertService.sendResolvedIncidentToSubscribers',
                error
            );
        });
        for (const monitor of monitors) {
            if (incident.probes && incident.probes.length > 0) {
                for (const probe of incident.probes) {
                    statusData.push({
                        monitorId: monitor._id,
                        probeId: probe.probeId ? probe.probeId._id : null,
                        manuallyCreated: userId ? true : false,
                        status: 'online',
                    });
                }
            } else {
                statusData.push({
                    monitorId: monitor._id,
                    probeId,
                    manuallyCreated: userId ? true : false,
                    status: 'online',
                });
            }

            // run this in the background
            _this.sendIncidentResolvedNotification(incident, name, monitor);
        }
        await MonitorStatusService.createMany(statusData);

        RealTimeService.incidentResolved(incident);
        ZapierService.pushToZapier('incident_resolve', incident).catch(
            error => {
                ErrorService.log('ZapierService.pushToZapier', error);
            }
        );

        return incident;
    },

    //
    close: async function(incidentId, userId) {
        const incident = await IncidentModel.findByIdAndUpdate(incidentId, {
            $pull: { notClosedBy: userId },
        });

        return incident;
    },

    getUnresolvedIncidents: async function(
        subProjectIds,
        userId,
        isHome = false
    ) {
        const _this = this;
        let incidentsUnresolved = await _this.findBy({
            query: { projectId: { $in: subProjectIds }, resolved: false },
            select: '_id notClosedBy',
        });
        incidentsUnresolved = incidentsUnresolved.map(incident => {
            if (incident.notClosedBy.indexOf(userId) < 0) {
                return _this.updateOneBy(
                    { _id: incident._id },
                    { notClosedBy: [userId] }
                );
            } else {
                return incident;
            }
        });
        await Promise.all(incidentsUnresolved);
        const populate = [
            {
                path: 'monitors.monitorId',
                select: 'name slug componentId projectId type',
                populate: [
                    { path: 'componentId', select: 'name slug' },
                    { path: 'projectId', select: 'name slug' },
                ],
            },
            { path: 'createdById', select: 'name' },
            { path: 'projectId', select: 'name slug' },
            { path: 'resolvedBy', select: 'name' },
            { path: 'acknowledgedBy', select: 'name' },
            { path: 'incidentPriority', select: 'name color' },
            {
                path: 'acknowledgedByIncomingHttpRequest',
                select: 'name',
            },
            { path: 'resolvedByIncomingHttpRequest', select: 'name' },
            { path: 'createdByIncomingHttpRequest', select: 'name' },
            { path: 'probes.probeId', select: 'probeName _id probeImage' },
        ];
        const select =
            'slug createdAt notifications reason response acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

        incidentsUnresolved = await _this.findBy({
            query: { projectId: { $in: subProjectIds }, resolved: false },
            populate,
            select,
        });
        const incidentsResolved = await _this.findBy({
            query: {
                projectId: { $in: subProjectIds },
                resolved: true,
                notClosedBy: userId,
            },
            populate,
            select,
        });

        return isHome
            ? incidentsUnresolved
            : incidentsUnresolved.concat(incidentsResolved);
    },

    getSubProjectIncidents: async function(projectId) {
        const _this = this;
        const populate = [
            {
                path: 'monitors.monitorId',
                select: 'name slug componentId projectId type',
                populate: [
                    { path: 'componentId', select: 'name slug' },
                    { path: 'projectId', select: 'name slug' },
                ],
            },
            { path: 'createdById', select: 'name' },
            { path: 'projectId', select: 'name slug' },
            { path: 'resolvedBy', select: 'name' },
            { path: 'acknowledgedBy', select: 'name' },
            { path: 'incidentPriority', select: 'name color' },
            {
                path: 'acknowledgedByIncomingHttpRequest',
                select: 'name',
            },
            { path: 'resolvedByIncomingHttpRequest', select: 'name' },
            { path: 'createdByIncomingHttpRequest', select: 'name' },
            { path: 'probes.probeId', select: 'probeName _id probeImage' },
        ];
        const select =
            'slug notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

        const monitors = await MonitorService.findBy({
            query: { projectId },
            select: '_id',
        });
        const monitorIds = monitors.map(monitor => monitor._id);

        const query = {
            'monitors.monitorId': { $in: monitorIds },
        };

        const [incidents, count] = await Promise.all([
            _this.findBy({
                query,
                limit: 10,
                skip: 0,
                select,
                populate,
            }),
            _this.countBy(query),
        ]);

        return [{ incidents, count, _id: projectId, skip: 0, limit: 10 }];
    },

    getComponentIncidents: async function(projectId, componentId) {
        const _this = this;
        const monitors = await MonitorService.findBy({
            query: { projectId, componentId },
            select: '_id',
        });
        const monitorIds = monitors.map(monitor => monitor._id);

        const query = {
            'monitors.monitorId': { $in: monitorIds },
        };

        const populate = [
            {
                path: 'monitors.monitorId',
                select: 'name slug componentId projectId type',
                populate: [
                    { path: 'componentId', select: 'name slug' },
                    { path: 'projectId', select: 'name slug' },
                ],
            },
            { path: 'createdById', select: 'name' },
            { path: 'projectId', select: 'name slug' },
            { path: 'resolvedBy', select: 'name' },
            { path: 'acknowledgedBy', select: 'name' },
            { path: 'incidentPriority', select: 'name color' },
            {
                path: 'acknowledgedByIncomingHttpRequest',
                select: 'name',
            },
            { path: 'resolvedByIncomingHttpRequest', select: 'name' },
            { path: 'createdByIncomingHttpRequest', select: 'name' },
            { path: 'probes.probeId', select: 'probeName _id probeImage' },
        ];
        const select =
            'slug notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

        const [incidents, count] = await Promise.all([
            _this.findBy({ query, limit: 10, skip: 0, select, populate }),
            _this.countBy(query),
        ]);
        const componentIncidents = [
            { incidents, _id: projectId, count, skip: 0, limit: 10 },
        ];
        return componentIncidents;
    },

    getProjectComponentIncidents: async function(
        projectId,
        componentId,
        limit,
        skip
    ) {
        const _this = this;
        const monitors = await MonitorService.findBy({
            query: { componentId: componentId },
            select: '_id',
        });
        const monitorIds = monitors.map(monitor => monitor._id);

        const query = {
            projectId,
            'monitors.monitorId': { $in: monitorIds },
        };

        const populate = [
            {
                path: 'monitors.monitorId',
                select: 'name slug componentId projectId type',
                populate: [
                    { path: 'componentId', select: 'name slug' },
                    { path: 'projectId', select: 'name slug' },
                ],
            },
            { path: 'createdById', select: 'name' },
            { path: 'projectId', select: 'name slug' },
            { path: 'resolvedBy', select: 'name' },
            { path: 'acknowledgedBy', select: 'name' },
            { path: 'incidentPriority', select: 'name color' },
            {
                path: 'acknowledgedByIncomingHttpRequest',
                select: 'name',
            },
            { path: 'resolvedByIncomingHttpRequest', select: 'name' },
            { path: 'createdByIncomingHttpRequest', select: 'name' },
            { path: 'probes.probeId', select: 'probeName _id probeImage' },
        ];
        const select =
            'slug notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

        const [incidents, count] = await Promise.all([
            _this.findBy({ query, limit, skip, select, populate }),
            _this.countBy(query),
        ]);
        return { incidents, count, _id: projectId };
    },
    sendIncidentResolvedNotification: async function(incident, name, monitor) {
        const _this = this;
        const populateComponent = [
            { path: 'projectId', select: 'name' },
            { path: 'componentCategoryId', select: 'name' },
        ];

        const selectComponent =
            '_id createdAt name createdById projectId slug componentCategoryId';
        const component = await ComponentService.findOneBy({
            query: {
                _id:
                    monitor.componentId && monitor.componentId._id
                        ? monitor.componentId._id
                        : monitor.componentId,
            },
            select: selectComponent,
            populate: populateComponent,
        });
        const resolvedincident = await _this.findOneBy({
            query: { _id: incident._id },
            select: 'createdAt resolvedBy',
            populate: [{ path: 'resolvedBy', select: 'name _id' }],
        });
        const downtimestring = IncidentUtilitiy.calculateHumanReadableDownTime(
            resolvedincident.createdAt
        );

        // send slack notification
        SlackService.sendNotification(
            incident.projectId._id || incident.projectId,
            incident,
            monitor,
            INCIDENT_RESOLVED,
            component,
            downtimestring
        ).catch(error => {
            ErrorService.log('SlackService.sendNotification', error);
        });
        // Ping webhook
        WebHookService.sendIntegrationNotification(
            incident.projectId._id || incident.projectId,
            incident,
            monitor,
            INCIDENT_RESOLVED,
            component,
            downtimestring
        ).catch(error => {
            ErrorService.log(
                'WebHookService.sendIntegrationNotification',
                error
            );
        });
        // Ms Teams
        MsTeamsService.sendNotification(
            incident.projectId._id || incident.projectId,
            incident,
            monitor,
            INCIDENT_RESOLVED,
            component,
            downtimestring
        ).catch(error => {
            ErrorService.log('MsTeamsService.sendNotification', error);
        });

        AlertService.sendResolveIncidentMail(incident, monitor).catch(error => {
            ErrorService.log('AlertService.sendResolveIncidentMail', error);
        });

        const msg = `${
            monitor.name
        } monitor was down for ${downtimestring} and is now resolved by ${name ||
            (resolvedincident.resolvedBy && resolvedincident.resolvedBy.name) ||
            'oneuptime'}`;

        try {
            NotificationService.create(
                incident.projectId._id || incident.projectId,
                msg,
                resolvedincident.resolvedBy
                    ? resolvedincident.resolvedBy._id
                    : 'oneuptime',
                'success'
            );
        } catch (error) {
            ErrorService.log(
                'incidentService.sendIncidentResolvedNotification',
                error
            );
        }
    },

    sendIncidentNoteAdded: async function(projectId, incident, data) {
        const monitors = incident.monitors.map(monitor => monitor.monitorId);
        for (const monitor of monitors) {
            SlackService.sendIncidentNoteNotification(
                projectId,
                incident,
                data,
                monitor
            ).catch(error => {
                ErrorService.log(
                    'SlackService.sendIncidentNoteNotification',
                    error
                );
            });

            MsTeamsService.sendIncidentNoteNotification(
                projectId,
                incident,
                data,
                monitor
            ).catch(error => {
                ErrorService.log(
                    'MsTeamsService.sendIncidentNoteNotification',
                    error
                );
            });
        }

        ZapierService.pushToZapier('incident_note', incident, data).catch(
            error => {
                ErrorService.log('ZapierService.pushToZapier', error);
            }
        );
    },

    hardDeleteBy: async function(query) {
        await IncidentModel.deleteMany(query);
        return 'Incident(s) removed successfully!';
    },

    restoreBy: async function(query) {
        const _this = this;
        query.deleted = true;
        let incident = await _this.findBy({ query, select: '_id' });
        if (incident && incident.length > 0) {
            const incidents = await Promise.all(
                incident.map(async incident => {
                    const incidentId = incident._id;
                    incident = await _this.updateOneBy(
                        {
                            _id: incidentId,
                            deleted: true,
                        },
                        {
                            deleted: false,
                            deletedAt: null,
                            deleteBy: null,
                        }
                    );
                    return incident;
                })
            );
            return incidents;
        } else {
            incident = incident[0];
            if (incident) {
                const incidentId = incident._id;
                incident = await _this.updateOneBy(
                    {
                        _id: incidentId,
                    },
                    {
                        deleted: false,
                        deletedAt: null,
                        deleteBy: null,
                    }
                );
            }
            return incident;
        }
    },

    /**
     * @description removes a particular monitor from incident and deletes the incident
     * @param {string} monitorId the id of the monitor
     * @param {string} userId the id of the user
     */
    removeMonitor: async function(monitorId, userId) {
        const _this = this;
        const incidents = await this.findBy({
            query: { 'monitors.monitorId': monitorId },
            select: 'monitors _id',
        });

        await Promise.all(
            incidents.map(async incident => {
                // only delete the incident, since the monitor can be restored
                const monitors = incident.monitors
                    .map(monitor => ({
                        monitorId: monitor.monitorId._id || monitor.monitorId,
                    }))
                    .filter(
                        monitor =>
                            String(monitor.monitorId) !== String(monitorId)
                    );

                let updatedIncident = null;
                if (monitors.length === 0) {
                    // no more monitor in monitors array
                    // delete incident
                    updatedIncident = await IncidentModel.findOneAndUpdate(
                        {
                            _id: incident._id,
                        },
                        {
                            $set: {
                                deleted: true,
                                deletedAt: Date.now(),
                                deletedById: userId,
                                monitors,
                            },
                        },
                        { new: true }
                    );
                } else {
                    updatedIncident = await IncidentModel.findOneAndUpdate(
                        {
                            _id: incident._id,
                        },
                        {
                            $set: {
                                monitors,
                            },
                        },
                        { new: true }
                    );
                }

                const populate = [
                    {
                        path: 'monitors.monitorId',
                        select: 'name slug componentId projectId type',
                        populate: [
                            { path: 'componentId', select: 'name slug' },
                            { path: 'projectId', select: 'name slug' },
                        ],
                    },
                    { path: 'createdById', select: 'name' },
                    { path: 'projectId', select: 'name slug' },
                    { path: 'resolvedBy', select: 'name' },
                    { path: 'acknowledgedBy', select: 'name' },
                    { path: 'incidentPriority', select: 'name color' },
                    {
                        path: 'acknowledgedByIncomingHttpRequest',
                        select: 'name',
                    },
                    {
                        path: 'resolvedByIncomingHttpRequest',
                        select: 'name',
                    },
                    {
                        path: 'createdByIncomingHttpRequest',
                        select: 'name',
                    },
                    {
                        path: 'probes.probeId',
                        select: 'probeName _id probeImage',
                    },
                ];
                const select =
                    'slug notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

                updatedIncident = await _this.findOneBy({
                    query: { _id: updatedIncident._id, deleted: true },
                    select,
                    populate,
                });

                try {
                    // run in the background
                    if (updatedIncident) {
                        RealTimeService.deleteIncident(updatedIncident);
                    }
                } catch (error) {
                    ErrorService.log('realtimeService.deleteIncident', error);
                }
            })
        );
    },

    startInterval: async function(projectId, monitors, incident) {
        const _this = this;

        monitors = monitors.map(monitor => monitor.monitorId);
        const [monitorList, currentIncident] = await Promise.all([
            MonitorService.findBy({
                query: { _id: { $in: monitors } },
                select: 'incidentCommunicationSla',
                populate: [
                    {
                        path: 'incidentCommunicationSla',
                        select: '_id duration deleted',
                    },
                ],
            }),
            // refetch the incident
            _this.findOneBy({
                query: { _id: incident._id },
                select: 'breachedCommunicationSla _id projectId',
            }),
        ]);

        if (!currentIncident.breachedCommunicationSla) {
            const slaList = {};
            let fetchedDefault = false;

            for (const monitor of monitorList) {
                let sla = monitor.incidentCommunicationSla;
                // don't fetch default communication sla twice
                if (!sla && !fetchedDefault) {
                    sla = await IncidentCommunicationSlaService.findOneBy({
                        query: { projectId: projectId, isDefault: true },
                        select: '_id duration deleted',
                    });
                    fetchedDefault = true;
                }
                if (sla && !slaList[sla._id] && !sla.deleted) {
                    slaList[sla._id] = sla;
                }
            }

            // grab the lowest sla and apply to the incident
            let lowestSla = {};
            for (const [, value] of Object.entries(slaList)) {
                if (!lowestSla.duration) {
                    lowestSla = value;
                } else {
                    lowestSla =
                        Number(value.duration) < Number(lowestSla.duration)
                            ? value
                            : lowestSla;
                }
            }

            if (!isEmpty(lowestSla)) {
                const incidentCommunicationSla = lowestSla;

                if (
                    incidentCommunicationSla &&
                    !incidentCommunicationSla.deleted
                ) {
                    let countDown = incidentCommunicationSla.duration * 60;
                    const alertTime = incidentCommunicationSla.alertTime * 60;

                    const data = {
                        projectId,
                        incidentCommunicationSla,
                        incident: currentIncident,
                        alertTime,
                    };

                    // count down every second
                    const intervalId = setInterval(async () => {
                        countDown -= 1;

                        // const minutes = Math.floor(countDown / 60);
                        // let seconds = countDown % 60;
                        // seconds =
                        //     seconds < 10 && seconds !== 0 ? `0${seconds}` : seconds;

                        // await was left out here because we care about the slaCountDown
                        // and also to ensure that it was delivered successfully
                        try {
                            RealTimeService.sendSlaCountDown(
                                currentIncident,
                                `${countDown}`
                            );
                        } catch (error) {
                            ErrorService.log(
                                'realtimeService.sendSlaCountDown',
                                error
                            );
                        }

                        if (countDown === alertTime) {
                            // send mail to team
                            AlertService.sendSlaEmailToTeamMembers(data).catch(
                                error => {
                                    ErrorService.log(
                                        'AlertService.sendSlaEmailToTeamMembers',
                                        error
                                    );
                                }
                            );
                        }

                        if (countDown === 0) {
                            _this.clearInterval(currentIncident._id);

                            await _this.updateOneBy(
                                { _id: currentIncident._id },
                                { breachedCommunicationSla: true }
                            );

                            // send mail to team
                            AlertService.sendSlaEmailToTeamMembers(
                                data,
                                true
                            ).catch(error => {
                                ErrorService.log(
                                    'AlertService.sendSlaEmailToTeamMembers',
                                    error
                                );
                            });
                        }
                    }, 1000);

                    intervals.push({
                        incidentId: currentIncident._id,
                        intervalId,
                    });
                }
            }
        }
    },

    clearInterval: function(incidentId) {
        intervals = intervals.filter(interval => {
            if (String(interval.incidentId) === String(incidentId)) {
                clearInterval(interval.intervalId);
                return false;
            }
            return true;
        });
    },

    refreshInterval: async function(incidentId) {
        const _this = this;
        for (const interval of intervals) {
            if (String(interval.incidentId) === String(incidentId)) {
                _this.clearInterval(incidentId);

                const incident = await _this.findOneBy({
                    query: { _id: incidentId },
                    select: 'monitors projectId _id',
                });
                await _this.startInterval(
                    incident.projectId._id || incident.projectId,
                    incident.monitors,
                    incident
                );
                break;
            }
        }
    },
};

/**
 * @description checks if an array contains duplicate values
 * @param {array} myArray the array to be checked
 * @returns {boolean} true or false
 */
function isArrayUnique(myArray) {
    return myArray.length === new Set(myArray).size;
}

let intervals = [];

const IncidentModel = require('../models/incident');
const IncidentTimelineService = require('./incidentTimelineService');
const MonitorService = require('./monitorService');
const AlertService = require('./alertService');
const RealTimeService = require('./realTimeService');
const NotificationService = require('./notificationService');
const WebHookService = require('./webHookService');
const MsTeamsService = require('./msTeamsService');
const SlackService = require('./slackService');
const ZapierService = require('./zapierService');
const ProjectService = require('./projectService');
const ErrorService = require('../../../common-server/utils/errorService');
const MonitorStatusService = require('./monitorStatusService');
const ComponentService = require('./componentService');
const IncidentSettingsService = require('./incidentSettingsService');
const Handlebars = require('handlebars');
const Moment = require('moment');
const IncidentMessageService = require('./incidentMessageService');
const {
    INCIDENT_CREATED,
    INCIDENT_ACKNOWLEDGED,
    INCIDENT_RESOLVED,
} = require('../constants/incidentEvents');
const IncidentUtilitiy = require('../utils/incident');
const IncidentCommunicationSlaService = require('./incidentCommunicationSlaService');
const { isEmpty } = require('lodash');
const joinNames = require('../utils/joinNames');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');
const getSlug = require('../utils/getSlug');
