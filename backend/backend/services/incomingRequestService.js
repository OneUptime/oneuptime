const IncomingRequestModel = require('../models/incomingRequest');
const IncidentService = require('../services/incidentService');
const MonitorService = require('../services/monitorService');
const ErrorService = require('../services/errorService');
const createDOMPurify = require('dompurify');
const jsdom = require('jsdom').jsdom;
const window = jsdom('').defaultView;
const DOMPurify = createDOMPurify(window);
const { isEmpty } = require('lodash');
const IncidentMessageService = require('../services/incidentMessageService');
const IncidentPrioritiesService = require('../services/incidentPrioritiesService');
const IncidentSettingsService = require('../services/incidentSettingsService');
const joinNames = require('../utils/joinNames');
// const RealTimeService = require('./realTimeService');

module.exports = {
    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const incomingRequest = await IncomingRequestModel.findOne(query)
                .populate({
                    path: 'monitors.monitorId',
                    select: 'name customFields componentId deleted',
                    populate: {
                        path: 'componentId',
                        select: 'name',
                    },
                })
                .populate('projectId', 'name')
                .lean();

            return incomingRequest;
        } catch (error) {
            ErrorService.log('incomingRequestService.findOneBy', error);
            throw error;
        }
    },

    create: async function(data) {
        const _this = this;
        try {
            if (
                !data.selectAllMonitors &&
                data.createIncident &&
                (!data.monitors || data.monitors.length === 0)
            ) {
                const error = new Error(
                    'You need at least one monitor to create an incoming request'
                );
                error.code = 400;
                throw error;
            }

            if (
                !data.selectAllMonitors &&
                data.createIncident &&
                !isArrayUnique(data.monitors)
            ) {
                const error = new Error(
                    'You cannot have multiple selection of a monitor'
                );
                error.code = 400;
                throw error;
            }

            if (data.createIncident) {
                // reassign data.monitors with a restructured monitor data
                data.monitors = data.monitors.map(monitor => ({
                    monitorId: monitor,
                }));
            }

            if (data.incidentTitle) {
                data.incidentTitle = DOMPurify.sanitize(data.incidentTitle);
            }

            if (data.incidentDescription) {
                data.incidentDescription = DOMPurify.sanitize(
                    data.incidentDescription
                );
            }

            // if (data.filterText) {
            //     data.filterText = DOMPurify.sanitize(data.filterText);
            // }
            if (data.filters && data.filters.length > 0) {
                data.filters = data.filters.map(filter => {
                    filter.filterText = DOMPurify.sanitize(filter.filterText);
                    return filter;
                });
            }

            if (data.dynamicIncidentType) {
                data.incidentType = DOMPurify.sanitize(data.customIncidentType);
            }

            if (data.dynamicIncidentPriority) {
                data.incidentPriority = DOMPurify.sanitize(
                    data.customIncidentPriority
                );
            }

            if (data.customFields && data.customFields.length > 0) {
                const customFields = [...data.customFields];
                data.customFields = customFields.map(field => ({
                    fieldName: field.fieldName,
                    fieldType: field.fieldType,
                    uniqueField: field.uniqueField,
                    fieldValue:
                        typeof field.fieldValue === 'number'
                            ? field.fieldValue
                            : DOMPurify.sanitize(field.fieldValue),
                }));
            }

            let incomingRequest = await IncomingRequestModel.create({
                ...data,
            });

            incomingRequest = await _this.findOneBy({
                _id: incomingRequest._id,
            });

            // await RealTimeService.addScheduledEvent(incomingRequest);

            return incomingRequest;
        } catch (error) {
            ErrorService.log('incomingRequestService.create', error);
            throw error;
        }
    },

    getRequestUrl: async function(projectId, requestId) {
        // create a unique request url
        // update incomingRequest collection with the new url
        const _this = this;
        const requestUrl = `${global.apiHost}/incoming-request/${projectId}/request/${requestId}`;
        const updatedIncomingRequest = await _this.updateOneBy(
            { requestId, projectId },
            { url: requestUrl },
            true
        );
        return updatedIncomingRequest;
    },

    updateOneBy: async function(query, data, excludeMonitors) {
        const _this = this;
        let unsetData = {};
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;

        try {
            if (!excludeMonitors && data.createIncident) {
                if (
                    !data.selectAllMonitors &&
                    (!data.monitors || data.monitors.length === 0)
                ) {
                    const error = new Error(
                        'You need at least one monitor to update a scheduled event'
                    );
                    error.code = 400;
                    throw error;
                }

                if (!data.selectAllMonitors && !isArrayUnique(data.monitors)) {
                    const error = new Error(
                        'You cannot have multiple selection of a monitor'
                    );
                    error.code = 400;
                    throw error;
                }

                // reassign data.monitors with a restructured monitor data
                data.monitors = data.monitors.map(monitor => ({
                    monitorId: monitor,
                }));
            }

            if (data.createIncident) {
                unsetData = {
                    updateIncidentNote: '',
                    updateInternalNote: '',
                    incidentState: '',
                    noteContent: '',
                    acknowledgeIncident: '',
                    resolveIncident: '',
                };
            }

            if (data.acknowledgeIncident) {
                unsetData = {
                    resolveIncident: '',
                };
            }

            if (data.resolveIncident) {
                unsetData = {
                    acknowledgeIncident: '',
                };
            }

            if (data.acknowledgeIncident || data.resolveIncident) {
                unsetData = {
                    ...unsetData,
                    createIncident: '',
                    updateIncidentNote: '',
                    updateInternalNote: '',
                    incidentState: '',
                    noteContent: '',
                    monitors: '',
                    incidentPriority: '',
                    incidentTitle: '',
                    incidentType: '',
                    incidentDescription: '',
                    customFields: '',
                    selectAllMonitors: '',
                };
            }

            if (data.updateIncidentNote) {
                unsetData = {
                    createIncident: '',
                    updateInternalNote: '',
                };
            }

            if (data.updateInternalNote) {
                unsetData = {
                    createIncident: '',
                    updateIncidentNote: '',
                };
            }

            if (data.updateInternalNote || data.updateIncidentNote) {
                unsetData = {
                    ...unsetData,
                    monitors: '',
                    incidentPriority: '',
                    incidentTitle: '',
                    incidentType: '',
                    incidentDescription: '',
                    customFields: '',
                    acknowledgeIncident: '',
                    resolveIncident: '',
                    selectAllMonitors: '',
                };
            }

            if (data.incidentTitle) {
                data.incidentTitle = DOMPurify.sanitize(data.incidentTitle);
            }

            if (data.incidentDescription) {
                data.incidentDescription = DOMPurify.sanitize(
                    data.incidentDescription
                );
            }

            // if (data.filterText) {
            //     data.filterText = DOMPurify.sanitize(data.filterText);
            // }
            if (data.filters && data.filters.length > 0) {
                data.filters = data.filters.map(filter => {
                    filter.filterText = DOMPurify.sanitize(filter.filterText);
                    return filter;
                });
            }

            if (data.dynamicIncidentType) {
                data.incidentType = DOMPurify.sanitize(data.customIncidentType);
            }

            if (data.dynamicIncidentPriority) {
                data.incidentPriority = DOMPurify.sanitize(
                    data.customIncidentPriority
                );
            }

            if (data.customFields && data.customFields.length > 0) {
                const customFields = [...data.customFields];
                data.customFields = customFields.map(field => ({
                    fieldName: field.fieldName,
                    fieldType: field.fieldType,
                    uniqueField: field.uniqueField,
                    fieldValue:
                        typeof field.fieldValue === 'number'
                            ? field.fieldValue
                            : DOMPurify.sanitize(field.fieldValue),
                }));
            }

            let updatedIncomingRequest = await IncomingRequestModel.findOneAndUpdate(
                { _id: query.requestId },
                {
                    $set: data,
                },
                { new: true }
            );

            if (!isEmpty(unsetData)) {
                updatedIncomingRequest = await IncomingRequestModel.findOneAndUpdate(
                    { _id: query.requestId },
                    { $unset: unsetData },
                    { new: true }
                );
            }

            if (!updatedIncomingRequest) {
                const error = new Error(
                    'Incoming request not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            updatedIncomingRequest = await _this.findOneBy({
                _id: query.requestId,
            });

            // await RealTimeService.updateScheduledEvent(updatedIncomingRequest);

            return updatedIncomingRequest;
        } catch (error) {
            ErrorService.log('incomingRequestService.updateOneBy', error);
            throw error;
        }
    },

    updateCustomFieldBy: async function(query, data) {
        try {
            const incomingRequest = await IncomingRequestModel.findOneAndUpdate(
                query,
                { $set: data },
                { new: true }
            );
            return incomingRequest;
        } catch (error) {
            ErrorService.log(
                'incomingRequestService.updateCustomFieldBy',
                error
            );
            throw error;
        }
    },

    findBy: async function(query, limit, skip) {
        try {
            if (!skip || isNaN(skip)) skip = 0;

            if (!limit || isNaN(limit)) limit = 0;

            if (typeof skip === 'string') {
                skip = Number(skip);
            }

            if (typeof limit === 'string') {
                limit = Number(limit);
            }

            if (!query) {
                query = {};
            }

            query.deleted = false;
            const allIncomingRequest = await IncomingRequestModel.find(query)
                .limit(limit)
                .skip(skip)
                .sort({ createdAt: -1 })
                .populate({
                    path: 'monitors.monitorId',
                    select: 'name customFields componentId deleted',
                    populate: {
                        path: 'componentId',
                        select: 'name',
                    },
                })
                .populate('projectId', 'name')
                .lean();

            return allIncomingRequest;
        } catch (error) {
            ErrorService.log('incomingRequestService.findBy', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;
            const count = await IncomingRequestModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('incomingRequestService.countBy', error);
            throw error;
        }
    },

    deleteBy: async function(query) {
        try {
            const incomingRequest = await IncomingRequestModel.findOneAndUpdate(
                query,
                {
                    $set: {
                        deleted: true,
                        deletedAt: Date.now(),
                    },
                },
                { new: true }
            );

            if (!incomingRequest) {
                const error = new Error(
                    'Incoming request not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            // await RealTimeService.deleteScheduledEvent(incomingRequest);

            return incomingRequest;
        } catch (error) {
            ErrorService.log('incomingRequestService.deleteBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updateIncomingRequest = await IncomingRequestModel.updateMany(
                query,
                {
                    $set: data,
                }
            );
            updateIncomingRequest = await this.findBy(query);
            return updateIncomingRequest;
        } catch (error) {
            ErrorService.log('incomingRequestService.updateMany', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query) {
        try {
            await IncomingRequestModel.deleteMany(query);
            return 'Incoming request(s) removed successfully!';
        } catch (error) {
            ErrorService.log('incomingRequestService.hardDeleteBy', error);
            throw error;
        }
    },

    /**
     * @description removes a particular monitor from incoming request
     * @description if no monitor remains after deletion, then the incoming request is deleted
     * @param {string} monitorId the id of the monitor
     * @param {string} userId the id of the user
     */
    removeMonitor: async function(monitorId) {
        try {
            const allIncomingRequest = await this.findBy({
                'monitors.monitorId': monitorId,
            });

            await Promise.all(
                allIncomingRequest.map(async incomingRequest => {
                    // remove the monitor from incomingRequest monitors list
                    incomingRequest.monitors = incomingRequest.monitors.filter(
                        monitor =>
                            String(monitor.monitorId._id) !== String(monitorId)
                    );

                    if (incomingRequest.monitors.length > 0) {
                        let updatedIncomingRequest = await IncomingRequestModel.findOneAndUpdate(
                            { _id: incomingRequest._id },
                            { $set: { monitors: incomingRequest.monitors } },
                            { new: true }
                        );
                        updatedIncomingRequest = await updatedIncomingRequest
                            .populate('monitors.monitorId', 'name')
                            .populate('projectId', 'name')
                            .execPopulate();

                        // await RealTimeService.updateScheduledEvent(
                        //     updatedIncomingRequest
                        // );
                        return updatedIncomingRequest;
                    } else {
                        // delete the incomingRequest when:
                        // 1. No monitor is remaining in the monitors array
                        // 2. It does not select all monitors
                        if (!incomingRequest.selectAllMonitors) {
                            let deletedIncomingRequest = await IncomingRequestModel.findOneAndUpdate(
                                { _id: incomingRequest._id },
                                {
                                    $set: {
                                        monitors: incomingRequest.monitors,
                                        deleted: true,
                                        deletedAt: Date.now(),
                                    },
                                },
                                { new: true }
                            );
                            deletedIncomingRequest = await deletedIncomingRequest
                                .populate('monitors.monitorId', 'name')
                                .populate('projectId', 'name')
                                .execPopulate();

                            // await RealTimeService.deleteScheduledEvent(
                            //     deletedIncomingRequest
                            // );
                            return deletedIncomingRequest;
                        }
                    }
                })
            );
        } catch (error) {
            ErrorService.log('incomingRequestService.removeMonitor', error);
            throw error;
        }
    },

    handleIncomingRequestAction: async function(data) {
        const _this = this;
        try {
            const [
                incidentPriorities,
                incidentSettings,
                incomingRequest,
            ] = await Promise.all([
                IncidentPrioritiesService.findBy({
                    projectId: data.projectId,
                }),
                IncidentSettingsService.findOne({
                    projectId: data.projectId,
                    isDefault: true,
                }),
                _this.findOneBy({
                    _id: data.requestId,
                    projectId: data.projectId,
                }),
            ]);

            const filterMatch = incomingRequest.filterMatch;
            const filters = incomingRequest.filters;

            if (incomingRequest && incomingRequest.createIncident) {
                const incidentResponse = [],
                    monitorsWithIncident = [];

                data.incidentType = incomingRequest.incidentType;
                data.incidentPriority = incomingRequest.incidentPriority;
                data.title = incomingRequest.incidentTitle;
                data.description = incomingRequest.incidentDescription;
                data.customFields = incomingRequest.customFields;
                data.createdByIncomingHttpRequest = incomingRequest._id;

                data.reason = [
                    `Created by: ${incomingRequest.name}`,
                    `Reason: This incident was created by an incoming HTTP request`,
                ];
                if (
                    data.title &&
                    data.title.trim() &&
                    data.description &&
                    data.description.trim() &&
                    data.incidentPriority
                ) {
                    data.manuallyCreated = true;
                }

                let monitors = [];
                if (incomingRequest.selectAllMonitors) {
                    monitors = await MonitorService.findBy({
                        query: { projectId: data.projectId },
                        select: '_id customFields componentId projectId name',
                        populate: [
                            { path: 'componentId', select: 'name' },
                            { path: 'projectId', select: 'name' },
                        ],
                    });
                } else {
                    monitors = incomingRequest.monitors
                        .map(monitor => monitor.monitorId)
                        .filter(monitor => !monitor.deleted);
                }

                if (filters && filters.length > 0) {
                    // if template variables are used
                    // update the values for filterText
                    const updatedFilters = filters.map(filter => {
                        if (filter.filterText) {
                            const dataConfig = {
                                request: data.request,
                            };
                            filter.filterText = handleVariable(
                                filter.filterText,
                                dataConfig
                            );
                        }
                        return filter;
                    });
                    const newMonitorList = [];
                    monitors.forEach(monitor => {
                        let matchedFields = 0;
                        const monitorCustomFields = monitor.customFields || [];

                        updatedFilters.forEach(filter => {
                            const filterCondition = filter.filterCondition;
                            for (const field of monitorCustomFields) {
                                if (filterCondition === 'equalTo') {
                                    if (
                                        field.fieldName ===
                                            filter.filterCriteria &&
                                        field.fieldValue === filter.filterText
                                    ) {
                                        matchedFields += 1;
                                        break;
                                    }
                                } else if (filterCondition === 'notEqualTo') {
                                    if (
                                        field.fieldName ===
                                            filter.filterCriteria &&
                                        field.fieldValue !== filter.filterText
                                    ) {
                                        matchedFields += 1;
                                        break;
                                    }
                                } else if (
                                    !isNaN(parseFloat(filter.filterText))
                                ) {
                                    // handle the case when filterText is a number
                                    // (<, >, <= and >=) will only apply to numeric filterText value with respect to variable array
                                    if (filterCondition === 'lessThan') {
                                        if (
                                            field.fieldName ===
                                                filter.filterCriteria &&
                                            field.fieldValue < filter.filterText
                                        ) {
                                            matchedFields += 1;
                                            break;
                                        }
                                    } else if (
                                        filterCondition === 'greaterThan'
                                    ) {
                                        if (
                                            field.fieldName ===
                                                filter.filterCriteria &&
                                            field.fieldValue > filter.filterText
                                        ) {
                                            matchedFields += 1;
                                            break;
                                        }
                                    } else if (
                                        filterCondition === 'lessThanOrEqualTo'
                                    ) {
                                        if (
                                            field.fieldName ===
                                                filter.filterCriteria &&
                                            field.fieldValue <=
                                                filter.filterText
                                        ) {
                                            matchedFields += 1;
                                            break;
                                        }
                                    } else if (
                                        filterCondition ===
                                        'greaterThanOrEqualTo'
                                    ) {
                                        if (
                                            field.fieldName ===
                                                filter.filterCriteria &&
                                            field.fieldValue >=
                                                filter.filterText
                                        ) {
                                            matchedFields += 1;
                                            break;
                                        }
                                    }
                                }
                            }
                        });
                        if (filterMatch === 'all') {
                            if (updatedFilters.length === matchedFields) {
                                newMonitorList.push(monitor);
                            }
                        } else {
                            if (matchedFields > 0) {
                                newMonitorList.push(monitor);
                            }
                        }
                    });

                    monitors = newMonitorList;
                }

                if (incomingRequest.createSeparateIncident) {
                    for (const monitor of monitors) {
                        const dataConfig = {
                            monitorName: monitor.name,
                            projectName: monitor.projectId.name,
                            componentName: monitor.componentId.name,
                            request: data.request,
                        };

                        let _incident;
                        if (data.customFields && data.customFields.length > 0) {
                            for (const field of data.customFields) {
                                if (
                                    field.uniqueField &&
                                    field.fieldValue &&
                                    field.fieldValue.trim()
                                ) {
                                    _incident = await IncidentService.findOneBy(
                                        {
                                            query: {
                                                customFields: {
                                                    $elemMatch: {
                                                        fieldName:
                                                            field.fieldName,
                                                        fieldType:
                                                            field.fieldType,
                                                        uniqueField:
                                                            field.uniqueField,
                                                        fieldValue: handleVariable(
                                                            field.fieldValue,
                                                            dataConfig
                                                        ),
                                                    },
                                                },
                                            },
                                            select: '_id',
                                        }
                                    );
                                }
                            }
                        }

                        data.title = handleVariable(data.title, dataConfig);
                        data.description = handleVariable(
                            data.description,
                            dataConfig
                        );
                        const incidentType = handleVariable(
                            data.incidentType,
                            dataConfig
                        ).toLowerCase();
                        data.incidentType = [
                            'offline',
                            'online',
                            'degraded',
                        ].includes(incidentType)
                            ? incidentType
                            : 'offline';

                        const incidentPriority = handleVariable(
                            data.incidentPriority,
                            dataConfig
                        ).toLowerCase();
                        const priorityObj = {};
                        incidentPriorities.forEach(
                            priority =>
                                (priorityObj[priority.name.toLowerCase()] =
                                    priority._id)
                        );
                        data.incidentPriority =
                            priorityObj[incidentPriority] ||
                            incidentSettings.incidentPriority;

                        data.customFields = data.customFields.map(field => ({
                            ...field,
                            fieldValue: handleVariable(
                                String(field.fieldValue),
                                dataConfig
                            ),
                        }));

                        if (
                            !monitorsWithIncident.includes(String(monitor._id))
                        ) {
                            let incident;
                            if (_incident) {
                                incident = await IncidentService.updateOneBy(
                                    { _id: _incident._id },
                                    data
                                );
                            } else {
                                data.monitors = [monitor._id];
                                incident = await IncidentService.create(data);
                            }
                            incidentResponse.push(incident);
                            monitorsWithIncident.push(String(monitor._id));
                        }
                    }
                } else {
                    if (monitors && monitors.length > 0) {
                        const monitorNames = monitors.map(
                            monitor => monitor.name
                        );
                        const componentNames = [];
                        monitors.forEach(monitor => {
                            if (
                                !componentNames.includes(
                                    monitor.componentId.name
                                )
                            ) {
                                componentNames.push(monitor.componentId.name);
                            }
                        });
                        const dataConfig = {
                            monitorName: joinNames(monitorNames),
                            projectName: incomingRequest.projectId.name,
                            componentName: joinNames(componentNames),
                            request: data.request,
                        };
                        let _incident;
                        if (data.customFields && data.customFields.length > 0) {
                            for (const field of data.customFields) {
                                if (
                                    field.uniqueField &&
                                    field.fieldValue &&
                                    field.fieldValue.trim()
                                ) {
                                    _incident = await IncidentService.findOneBy(
                                        {
                                            query: {
                                                customFields: {
                                                    $elemMatch: {
                                                        fieldName:
                                                            field.fieldName,
                                                        fieldType:
                                                            field.fieldType,
                                                        uniqueField:
                                                            field.uniqueField,
                                                        fieldValue: handleVariable(
                                                            field.fieldValue,
                                                            dataConfig
                                                        ),
                                                    },
                                                },
                                            },
                                            select: '_id',
                                        }
                                    );
                                }
                            }
                        }
                        data.title = handleVariable(data.title, dataConfig);
                        data.description = handleVariable(
                            data.description,
                            dataConfig
                        );
                        const incidentType = handleVariable(
                            data.incidentType,
                            dataConfig
                        ).toLowerCase();
                        data.incidentType = [
                            'offline',
                            'online',
                            'degraded',
                        ].includes(incidentType)
                            ? incidentType
                            : 'offline';

                        const incidentPriority = handleVariable(
                            data.incidentPriority,
                            dataConfig
                        ).toLowerCase();
                        const priorityObj = {};
                        incidentPriorities.forEach(
                            priority =>
                                (priorityObj[priority.name.toLowerCase()] =
                                    priority._id)
                        );
                        data.incidentPriority =
                            priorityObj[incidentPriority] ||
                            incidentSettings.incidentPriority;

                        data.customFields = data.customFields.map(field => ({
                            ...field,
                            fieldValue: handleVariable(
                                String(field.fieldValue),
                                dataConfig
                            ),
                        }));
                        data.monitors = monitors.map(monitor => monitor._id);
                        let incident;
                        if (_incident) {
                            incident = await IncidentService.updateOneBy(
                                { _id: _incident._id },
                                data
                            );
                        } else {
                            incident = await IncidentService.create(data);
                        }
                        incidentResponse.push(incident);
                    }
                }

                let created_incidents = new Set(
                    incidentResponse.map(response => response.idNumber)
                );
                created_incidents = [...created_incidents];
                return {
                    status: 'success',
                    created_incidents,
                };
            }

            if (
                incomingRequest &&
                (incomingRequest.updateIncidentNote ||
                    incomingRequest.updateInternalNote)
            ) {
                const noteResponse = [],
                    incidentsWithNote = [];

                data.incident_state = incomingRequest.incidentState;
                data.type = incomingRequest.updateIncidentNote
                    ? 'investigation'
                    : 'internal';
                data.content = incomingRequest.noteContent;

                let incidents = [],
                    updatedFilters = [];
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
                    { path: 'probes.probeId', select: 'name _id' },
                ];
                const select =
                    'notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

                if (!filters || filters.length === 0) {
                    incidents = await IncidentService.findBy({
                        query: { projectId: incomingRequest.projectId },
                        select,
                        populate,
                    });
                } else {
                    updatedFilters = filters.map(filter => {
                        if (filter.filterText) {
                            const dataConfig = {
                                request: data.request,
                            };
                            filter.filterText = handleVariable(
                                filter.filterText,
                                dataConfig
                            );
                        }
                        return filter;
                    });

                    const incidentArray = [];
                    for (const filter of updatedFilters) {
                        const filterCriteria = filter.filterCriteria,
                            filterCondition = filter.filterCondition,
                            filterText = filter.filterText;

                        if (
                            filterCriteria &&
                            filterCondition &&
                            ((!isNaN(filterText) &&
                                parseFloat(filterText) >= 0) ||
                                (filterText && filterText.trim()))
                        ) {
                            if (
                                filterCriteria &&
                                filterCriteria === 'incidentId' &&
                                filterText
                            ) {
                                data.incidentId = Number(filterText);
                            }

                            if (
                                filterCriteria &&
                                filterCriteria !== 'incidentId' &&
                                filterText
                            ) {
                                data.fieldName = filterCriteria;
                                data.fieldValue = filterText;
                            }

                            let incidents = [];
                            if (filterCondition === 'equalTo') {
                                if (
                                    data.incidentId &&
                                    filterCriteria === 'incidentId'
                                ) {
                                    incidents = await IncidentService.findBy({
                                        query: {
                                            projectId:
                                                incomingRequest.projectId,
                                            idNumber: data.incidentId,
                                        },
                                        select,
                                        populate,
                                    });
                                }

                                if (data.fieldName && data.fieldValue) {
                                    incidents = await IncidentService.findBy({
                                        query: {
                                            projectId:
                                                incomingRequest.projectId,
                                            'customFields.fieldName':
                                                data.fieldName,
                                            'customFields.fieldValue':
                                                data.fieldValue,
                                        },
                                        select,
                                        populate,
                                    });
                                }
                            }

                            if (filterCondition === 'notEqualTo') {
                                if (
                                    data.incidentId &&
                                    filterCriteria === 'incidentId'
                                ) {
                                    incidents = await IncidentService.findBy({
                                        query: {
                                            projectId:
                                                incomingRequest.projectId,
                                            idNumber: { $ne: data.incidentId },
                                        },
                                        select,
                                        populate,
                                    });
                                }

                                if (data.fieldName && data.fieldValue) {
                                    incidents = await IncidentService.findBy({
                                        query: {
                                            projectId:
                                                incomingRequest.projectId,
                                            'customFields.fieldName':
                                                data.fieldName,
                                            'customFields.fieldValue': {
                                                $ne: data.fieldValue,
                                            },
                                        },
                                        select,
                                        populate,
                                    });
                                }
                            }

                            if (!isNaN(parseFloat(filterText))) {
                                // handle the case when filterText is a number
                                // (<, >, <= and >=) will only apply to numeric filterText value with respect to variable array
                                data.fieldValue = Number(filterText);
                                if (filterCondition === 'lessThan') {
                                    if (
                                        data.incidentId &&
                                        filterCriteria === 'incidentId'
                                    ) {
                                        incidents = await IncidentService.findBy(
                                            {
                                                query: {
                                                    projectId:
                                                        incomingRequest.projectId,
                                                    idNumber: {
                                                        $lt: data.incidentId,
                                                    },
                                                },
                                                select,
                                                populate,
                                            }
                                        );
                                    }

                                    if (data.fieldName && data.fieldValue) {
                                        incidents = await IncidentService.findBy(
                                            {
                                                query: {
                                                    projectId:
                                                        incomingRequest.projectId,
                                                    'customFields.fieldName':
                                                        data.fieldName,
                                                    'customFields.fieldValue': {
                                                        $lt: data.fieldValue,
                                                    },
                                                },
                                                select,
                                                populate,
                                            }
                                        );
                                    }
                                } else if (filterCondition === 'greaterThan') {
                                    if (
                                        data.incidentId &&
                                        filterCriteria === 'incidentId'
                                    ) {
                                        incidents = await IncidentService.findBy(
                                            {
                                                query: {
                                                    projectId:
                                                        incomingRequest.projectId,
                                                    idNumber: {
                                                        $gt: data.incidentId,
                                                    },
                                                },
                                                select,
                                                populate,
                                            }
                                        );
                                    }

                                    if (data.fieldName && data.fieldValue) {
                                        incidents = await IncidentService.findBy(
                                            {
                                                query: {
                                                    projectId:
                                                        incomingRequest.projectId,
                                                    'customFields.fieldName':
                                                        data.fieldName,
                                                    'customFields.fieldValue': {
                                                        $gt: data.fieldValue,
                                                    },
                                                },
                                                select,
                                                populate,
                                            }
                                        );
                                    }
                                } else if (
                                    filterCondition === 'lessThanOrEqualTo'
                                ) {
                                    if (
                                        data.incidentId &&
                                        filterCriteria === 'incidentId'
                                    ) {
                                        incidents = await IncidentService.findBy(
                                            {
                                                query: {
                                                    projectId:
                                                        incomingRequest.projectId,
                                                    idNumber: {
                                                        $lte: data.incidentId,
                                                    },
                                                },
                                                select,
                                                populate,
                                            }
                                        );
                                    }

                                    if (data.fieldName && data.fieldValue) {
                                        incidents = await IncidentService.findBy(
                                            {
                                                query: {
                                                    projectId:
                                                        incomingRequest.projectId,
                                                    'customFields.fieldName':
                                                        data.fieldName,
                                                    'customFields.fieldValue': {
                                                        $lte: data.fieldValue,
                                                    },
                                                },
                                                select,
                                                populate,
                                            }
                                        );
                                    }
                                } else if (
                                    filterCondition === 'greaterThanOrEqualTo'
                                ) {
                                    if (
                                        data.incidentId &&
                                        filterCriteria === 'incidentId'
                                    ) {
                                        incidents = await IncidentService.findBy(
                                            {
                                                query: {
                                                    projectId:
                                                        incomingRequest.projectId,
                                                    idNumber: {
                                                        $gte: data.incidentId,
                                                    },
                                                },
                                                select,
                                                populate,
                                            }
                                        );
                                    }

                                    if (data.fieldName && data.fieldValue) {
                                        incidents = await IncidentService.findBy(
                                            {
                                                query: {
                                                    projectId:
                                                        incomingRequest.projectId,
                                                    'customFields.fieldName':
                                                        data.fieldName,
                                                    'customFields.fieldValue': {
                                                        $gte: data.fieldValue,
                                                    },
                                                },
                                                select,
                                                populate,
                                            }
                                        );
                                    }
                                }
                            }

                            incidentArray.push(...incidents);
                        }
                    }

                    incidents = incidentArray;
                }

                // only have unique incidents
                const filtered = [];
                incidents = incidents.filter(incident => {
                    if (filtered.indexOf(String(incident._id)) < 0) {
                        filtered.push(String(incident._id));
                        return true;
                    }
                    return false;
                });

                if (filters || filters.length > 0) {
                    const newIncidentList = [];
                    incidents.forEach(incident => {
                        let matchedFields = 0;
                        const incidentCustomFields =
                            incident.customFields || [];
                        // automatically create incident id custom field
                        incidentCustomFields.push({
                            fieldName: 'incidentId',
                            fieldValue: String(incident.idNumber),
                            fieldType: 'string',
                        });

                        updatedFilters.forEach(filter => {
                            for (const field of incidentCustomFields) {
                                const filterCriteria = filter.filterCriteria,
                                    filterCondition = filter.filterCondition,
                                    filterText = filter.filterText;

                                if (
                                    filterCriteria &&
                                    filterCondition &&
                                    ((!isNaN(filterText) &&
                                        parseFloat(filterText) >= 0) ||
                                        (filterText && filterText.trim()))
                                ) {
                                    if (filterCondition === 'equalTo') {
                                        if (
                                            field.fieldName ===
                                                filter.filterCriteria &&
                                            field.fieldValue ===
                                                filter.filterText
                                        ) {
                                            matchedFields += 1;
                                            break;
                                        }
                                    }

                                    if (filterCondition === 'notEqualTo') {
                                        if (
                                            field.fieldName ===
                                                filterCriteria &&
                                            field.fieldValue !== filterText
                                        ) {
                                            matchedFields += 1;
                                            break;
                                        }
                                    }

                                    if (!isNaN(parseFloat(filterText))) {
                                        // handle the case when filterText is a number
                                        // (<, >, <= and >=) will only apply to numeric filterText value with respect to variable array
                                        data.fieldValue = Number(filterText);
                                        if (filterCondition === 'lessThan') {
                                            if (
                                                field.fieldName ===
                                                    filterCriteria &&
                                                field.fieldValue < filterText
                                            ) {
                                                matchedFields += 1;
                                                break;
                                            }
                                        } else if (
                                            filterCondition === 'greaterThan'
                                        ) {
                                            if (
                                                field.fieldName ===
                                                    filterCriteria &&
                                                field.fieldValue > filterText
                                            ) {
                                                matchedFields += 1;
                                                break;
                                            }
                                        } else if (
                                            filterCondition ===
                                            'lessThanOrEqualTo'
                                        ) {
                                            if (
                                                field.fieldName ===
                                                    filterCriteria &&
                                                field.fieldValue <= filterText
                                            ) {
                                                matchedFields += 1;
                                                break;
                                            }
                                        } else if (
                                            filterCondition ===
                                            'greaterThanOrEqualTo'
                                        ) {
                                            if (
                                                field.fieldName ===
                                                    filterCriteria &&
                                                field.fieldValue >= filterText
                                            ) {
                                                matchedFields += 1;
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        });

                        if (filterMatch === 'all') {
                            if (updatedFilters.length === matchedFields) {
                                newIncidentList.push(incident);
                            }
                        } else {
                            if (matchedFields > 0) {
                                newIncidentList.push(incident);
                            }
                        }
                    });

                    incidents = newIncidentList;
                }

                if (incidents && incidents.length > 0) {
                    for (const incident of incidents) {
                        data.incidentId = incident._id;
                        if (!incidentsWithNote.includes(String(incident._id))) {
                            data.monitors = incident.monitors.map(
                                monitor => monitor.monitorId
                            );
                            await IncidentMessageService.create(data);
                            noteResponse.push(incident);
                            incidentsWithNote.push(String(incident._id));
                        } else {
                            data.monitors = incident.monitors.map(
                                monitor => monitor.monitorId
                            );
                            await IncidentMessageService.create(data);
                            noteResponse.push(incident);
                        }
                    }
                }

                return {
                    status: 'success',
                    notes_addedTo: noteResponse.map(res => res.idNumber),
                };
            }

            if (
                incomingRequest &&
                (incomingRequest.acknowledgeIncident ||
                    incomingRequest.resolveIncident)
            ) {
                const resolveResponse = [],
                    acknowledgeResponse = [],
                    resolvedIncidents = [],
                    acknowledgedIncidents = [];

                let incidentQuery = {};
                if (incomingRequest.resolveIncident) {
                    incidentQuery = { resolvedAt: { $exists: false } };
                }
                if (incomingRequest.acknowledgeIncident) {
                    incidentQuery = {
                        acknowledgedAt: { $exists: false },
                    };
                }

                let incidents = [],
                    updatedFilters = [];
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
                    { path: 'probes.probeId', select: 'name _id' },
                ];
                const select =
                    'notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

                if (!filters || filters.length === 0) {
                    incidents = await IncidentService.findBy({
                        query: {
                            projectId: incomingRequest.projectId,
                            ...incidentQuery,
                        },
                        select,
                        populate,
                    });
                } else {
                    updatedFilters = filters.map(filter => {
                        if (filter.filterText) {
                            const dataConfig = {
                                request: data.request,
                            };
                            filter.filterText = handleVariable(
                                filter.filterText,
                                dataConfig
                            );
                        }
                        return filter;
                    });

                    const incidentArray = [];
                    for (const filter of updatedFilters) {
                        const filterCriteria = filter.filterCriteria,
                            filterCondition = filter.filterCondition,
                            filterText = filter.filterText;

                        if (
                            filterCriteria &&
                            filterCondition &&
                            ((!isNaN(filterText) &&
                                parseFloat(filterText) >= 0) ||
                                (filterText && filterText.trim()))
                        ) {
                            if (
                                filterCriteria &&
                                filterCriteria === 'incidentId' &&
                                filterText
                            ) {
                                data.incidentId = Number(filterText);
                            }

                            if (
                                filterCriteria &&
                                filterCriteria !== 'incidentId' &&
                                filterText
                            ) {
                                data.fieldName = filterCriteria;
                                data.fieldValue = filterText;
                            }

                            let incidents = [];
                            if (filterCondition === 'equalTo') {
                                if (data.incidentId) {
                                    incidents = await IncidentService.findBy({
                                        query: {
                                            projectId:
                                                incomingRequest.projectId,
                                            idNumber: data.incidentId,
                                            ...incidentQuery,
                                        },
                                        select,
                                        populate,
                                    });
                                }

                                if (data.fieldName && data.fieldValue) {
                                    incidents = await IncidentService.findBy({
                                        query: {
                                            projectId:
                                                incomingRequest.projectId,
                                            'customFields.fieldName':
                                                data.fieldName,
                                            'customFields.fieldValue':
                                                data.fieldValue,
                                            ...incidentQuery,
                                        },
                                        select,
                                        populate,
                                    });
                                }
                            }

                            if (filterCondition === 'notEqualTo') {
                                if (data.incidentId) {
                                    incidents = await IncidentService.findBy({
                                        query: {
                                            projectId:
                                                incomingRequest.projectId,
                                            idNumber: { $ne: data.incidentId },
                                            ...incidentQuery,
                                        },
                                        select,
                                        populate,
                                    });
                                }

                                if (data.fieldName && data.fieldValue) {
                                    incidents = await IncidentService.findBy({
                                        query: {
                                            projectId:
                                                incomingRequest.projectId,
                                            'customFields.fieldName':
                                                data.fieldName,
                                            'customFields.fieldValue': {
                                                $ne: data.fieldValue,
                                            },
                                            ...incidentQuery,
                                        },
                                        select,
                                        populate,
                                    });
                                }
                            }

                            if (!isNaN(parseFloat(filterText))) {
                                // handle the case when filterText is a number
                                // (<, >, <= and >=) will only apply to numeric filterText value with respect to variable array
                                data.fieldValue = Number(filterText);
                                if (filterCondition === 'lessThan') {
                                    if (
                                        data.incidentId &&
                                        filterCriteria === 'incidentId'
                                    ) {
                                        incidents = await IncidentService.findBy(
                                            {
                                                query: {
                                                    projectId:
                                                        incomingRequest.projectId,
                                                    idNumber: {
                                                        $lt: data.incidentId,
                                                    },
                                                    ...incidentQuery,
                                                },
                                                select,
                                                populate,
                                            }
                                        );
                                    }

                                    if (data.fieldName && data.fieldValue) {
                                        incidents = await IncidentService.findBy(
                                            {
                                                query: {
                                                    projectId:
                                                        incomingRequest.projectId,
                                                    'customFields.fieldName':
                                                        data.fieldName,
                                                    'customFields.fieldValue': {
                                                        $lt: data.fieldValue,
                                                    },
                                                    ...incidentQuery,
                                                },
                                                select,
                                                populate,
                                            }
                                        );
                                    }
                                } else if (filterCondition === 'greaterThan') {
                                    if (
                                        data.incidentId &&
                                        filterCriteria === 'incidentId'
                                    ) {
                                        incidents = await IncidentService.findBy(
                                            {
                                                query: {
                                                    projectId:
                                                        incomingRequest.projectId,
                                                    idNumber: {
                                                        $gt: data.incidentId,
                                                    },
                                                    ...incidentQuery,
                                                },
                                                select,
                                                populate,
                                            }
                                        );
                                    }

                                    if (data.fieldName && data.fieldValue) {
                                        incidents = await IncidentService.findBy(
                                            {
                                                query: {
                                                    projectId:
                                                        incomingRequest.projectId,
                                                    'customFields.fieldName':
                                                        data.fieldName,
                                                    'customFields.fieldValue': {
                                                        $gt: data.fieldValue,
                                                    },
                                                    ...incidentQuery,
                                                },
                                                select,
                                                populate,
                                            }
                                        );
                                    }
                                } else if (
                                    filterCondition === 'lessThanOrEqualTo'
                                ) {
                                    if (
                                        data.incidentId &&
                                        filterCriteria === 'incidentId'
                                    ) {
                                        incidents = await IncidentService.findBy(
                                            {
                                                query: {
                                                    projectId:
                                                        incomingRequest.projectId,
                                                    idNumber: {
                                                        $lte: data.incidentId,
                                                    },
                                                    ...incidentQuery,
                                                },
                                                select,
                                                populate,
                                            }
                                        );
                                    }

                                    if (data.fieldName && data.fieldValue) {
                                        incidents = await IncidentService.findBy(
                                            {
                                                query: {
                                                    projectId:
                                                        incomingRequest.projectId,
                                                    'customFields.fieldName':
                                                        data.fieldName,
                                                    'customFields.fieldValue': {
                                                        $lte: data.fieldValue,
                                                    },
                                                    ...incidentQuery,
                                                },
                                                select,
                                                populate,
                                            }
                                        );
                                    }
                                } else if (
                                    filterCondition === 'greaterThanOrEqualTo'
                                ) {
                                    if (data.incidentId) {
                                        incidents = await IncidentService.findBy(
                                            {
                                                query: {
                                                    projectId:
                                                        incomingRequest.projectId,
                                                    idNumber: {
                                                        $gte: data.incidentId,
                                                    },
                                                    ...incidentQuery,
                                                },
                                                select,
                                                populate,
                                            }
                                        );
                                    }

                                    if (data.fieldName && data.fieldValue) {
                                        incidents = await IncidentService.findBy(
                                            {
                                                query: {
                                                    projectId:
                                                        incomingRequest.projectId,
                                                    'customFields.fieldName':
                                                        data.fieldName,
                                                    'customFields.fieldValue': {
                                                        $gte: data.fieldValue,
                                                    },
                                                    ...incidentQuery,
                                                },
                                                select,
                                                populate,
                                            }
                                        );
                                    }
                                }
                            }

                            incidentArray.push(...incidents);
                        }
                    }

                    incidents = incidentArray;
                }

                // only have unique incidents
                const filtered = [];
                incidents = incidents.filter(incident => {
                    if (filtered.indexOf(String(incident._id)) < 0) {
                        filtered.push(String(incident._id));
                        return true;
                    }
                    return false;
                });

                if (filters || filters.length > 0) {
                    const newIncidentList = [];
                    incidents.forEach(incident => {
                        let matchedFields = 0;
                        const incidentCustomFields =
                            incident.customFields || [];
                        // automatically create incident id custom field
                        incidentCustomFields.push({
                            fieldName: 'incidentId',
                            fieldValue: String(incident.idNumber),
                            fieldType: 'string',
                        });

                        updatedFilters.forEach(filter => {
                            for (const field of incidentCustomFields) {
                                const filterCriteria = filter.filterCriteria,
                                    filterCondition = filter.filterCondition,
                                    filterText = filter.filterText;

                                if (
                                    filterCriteria &&
                                    filterCondition &&
                                    ((!isNaN(filterText) &&
                                        parseFloat(filterText) >= 0) ||
                                        (filterText && filterText.trim()))
                                ) {
                                    if (filterCondition === 'equalTo') {
                                        if (
                                            field.fieldName ===
                                                filter.filterCriteria &&
                                            field.fieldValue ===
                                                filter.filterText
                                        ) {
                                            matchedFields += 1;
                                            break;
                                        }
                                    }

                                    if (filterCondition === 'notEqualTo') {
                                        if (
                                            field.fieldName ===
                                                filterCriteria &&
                                            field.fieldValue !== filterText
                                        ) {
                                            matchedFields += 1;
                                            break;
                                        }
                                    }

                                    if (!isNaN(parseFloat(filterText))) {
                                        // handle the case when filterText is a number
                                        // (<, >, <= and >=) will only apply to numeric filterText value with respect to variable array
                                        data.fieldValue = Number(filterText);
                                        if (filterCondition === 'lessThan') {
                                            if (
                                                field.fieldName ===
                                                    filterCriteria &&
                                                field.fieldValue < filterText
                                            ) {
                                                matchedFields += 1;
                                                break;
                                            }
                                        } else if (
                                            filterCondition === 'greaterThan'
                                        ) {
                                            if (
                                                field.fieldName ===
                                                    filterCriteria &&
                                                field.fieldValue > filterText
                                            ) {
                                                matchedFields += 1;
                                                break;
                                            }
                                        } else if (
                                            filterCondition ===
                                            'lessThanOrEqualTo'
                                        ) {
                                            if (
                                                field.fieldName ===
                                                    filterCriteria &&
                                                field.fieldValue <= filterText
                                            ) {
                                                matchedFields += 1;
                                                break;
                                            }
                                        } else if (
                                            filterCondition ===
                                            'greaterThanOrEqualTo'
                                        ) {
                                            if (
                                                field.fieldName ===
                                                    filterCriteria &&
                                                field.fieldValue >= filterText
                                            ) {
                                                matchedFields += 1;
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        });

                        if (filterMatch === 'all') {
                            if (updatedFilters.length === matchedFields) {
                                newIncidentList.push(incident);
                            }
                        } else {
                            if (matchedFields > 0) {
                                newIncidentList.push(incident);
                            }
                        }
                    });

                    incidents = newIncidentList;
                }

                if (incidents && incidents.length > 0) {
                    for (const incident of incidents) {
                        if (incomingRequest.acknowledgeIncident) {
                            if (
                                !acknowledgedIncidents.includes(
                                    String(incident._id)
                                )
                            ) {
                                const incidentData = await IncidentService.acknowledge(
                                    incident._id,
                                    null,
                                    null,
                                    null,
                                    null,
                                    incomingRequest
                                );
                                acknowledgeResponse.push(incidentData);
                                acknowledgedIncidents.push(
                                    String(incident._id)
                                );
                            } else {
                                const incidentData = await IncidentService.acknowledge(
                                    incident._id,
                                    null,
                                    null,
                                    null,
                                    null,
                                    incomingRequest
                                );
                                acknowledgeResponse.push(incidentData);
                            }
                        }
                        if (incomingRequest.resolveIncident) {
                            if (
                                !resolvedIncidents.includes(
                                    String(incident._id)
                                )
                            ) {
                                const incidentData = await IncidentService.resolve(
                                    incident._id,
                                    null,
                                    null,
                                    null,
                                    null,
                                    incomingRequest
                                );
                                resolveResponse.push(incidentData);
                                resolvedIncidents.push(String(incident._id));
                            } else {
                                const incidentData = await IncidentService.resolve(
                                    incident._id,
                                    null,
                                    null,
                                    null,
                                    null,
                                    incomingRequest
                                );
                                resolveResponse.push(incidentData);
                            }
                        }
                    }
                }

                if (
                    resolveResponse &&
                    resolveResponse.length > 0 &&
                    incomingRequest.resolveIncident
                ) {
                    return {
                        status: 'success',
                        resolved_incidents: resolveResponse.map(
                            res => res.idNumber
                        ),
                    };
                } else if (
                    resolveResponse &&
                    resolveResponse.length === 0 &&
                    incomingRequest.resolveIncident
                ) {
                    return {
                        status: 'success',
                        resolved_incidents: [],
                    };
                }

                if (
                    acknowledgeResponse &&
                    acknowledgeResponse.length > 0 &&
                    incomingRequest.acknowledgeIncident
                ) {
                    return {
                        status: 'success',
                        acknowledged_incidents: acknowledgeResponse.map(
                            res => res.idNumber
                        ),
                    };
                } else if (
                    acknowledgeResponse &&
                    acknowledgeResponse.length === 0 &&
                    incomingRequest.acknowledgeIncident
                ) {
                    return {
                        status: 'success',
                        acknowledged_incidents: [],
                    };
                }
            }
        } catch (error) {
            ErrorService.log(
                'incomingRequestService.handleIncomingRequestAction',
                error
            );
            throw error;
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

/**
 * @description transforms a template variable into an actual value
 * @param {string} variable template like string eg: {{request.body.name}}
 * @param {object} data an object containing the key-value pairs to work with
 */
function handleVariable(variable, data) {
    const regex = /\{\{([^}]+)\}\}/g;

    if (regex.test(variable)) {
        variable = variable.replace(regex, function(match) {
            // Remove the wrapping curly braces
            match = match.slice(2, -2);

            // Check if the item has sub-properties
            const sub = match.split('.');

            // If the item has a sub-property, loop through until you get it
            if (sub.length > 1) {
                let temp = data;
                const altSub = [];
                sub.forEach(item => {
                    if (item.indexOf('[') >= 0) {
                        const key = item.slice(0, item.indexOf('['));
                        const arrayIndex = item.slice(item.indexOf('['));

                        altSub.push(key);
                        // grab all the numeric values from the index
                        const index = arrayIndex
                            .replace(/[[\]]+/g, '')
                            .split('');
                        altSub.push(...index);
                    } else {
                        altSub.push(item);
                    }
                });

                altSub.forEach(function(item) {
                    // Make sure the item exists
                    if (!temp[item]) {
                        temp = '{{' + match + '}}';
                        return;
                    }

                    // Update temp
                    temp = temp[item];
                });

                return temp;
            } else {
                if (!data[match]) return '{{' + match + '}}';
                return data[match];
            }
        });
    }
    return variable;
}
