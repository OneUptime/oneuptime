const IncomingRequestModel = require('../models/incomingRequest');
const IncidentService = require('../services/incidentService');
const MonitorService = require('../services/monitorService');
const ErrorService = require('../services/errorService');
const createDOMPurify = require('dompurify');
const jsdom = require('jsdom').jsdom;
const window = jsdom('').defaultView;
const DOMPurify = createDOMPurify(window);
const Handlebars = require('handlebars');
const { isEmpty } = require('lodash');
const IncidentMessageService = require('../services/incidentMessageService');
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
                    select: 'name customFields componentId',
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
                !data.isDefault &&
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
                !data.isDefault &&
                data.createIncident &&
                !isArrayUnique(data.monitors)
            ) {
                const error = new Error(
                    'You cannot have multiple selection of a monitor'
                );
                error.code = 400;
                throw error;
            }

            if (data.isDefault) {
                const incomingRequest = await _this.findOneBy({
                    isDefault: true,
                    projectId: data.projectId,
                });

                if (incomingRequest) {
                    // reset any other default incoming request to false
                    await _this.updateOneBy(
                        { requestId: incomingRequest._id },
                        { isDefault: false },
                        true
                    );
                }
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

            if (data.filterText) {
                data.filterText = DOMPurify.sanitize(data.filterText);
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
                    fieldValue:
                        typeof field.fieldValue === 'number'
                            ? field.fieldValue
                            : DOMPurify.sanitize(field.fieldValue),
                }));
            }

            let incomingRequest = await IncomingRequestModel.create({
                ...data,
            });

            incomingRequest = await incomingRequest
                .populate('monitors.monitorId', 'name')
                .populate('projectId', 'name')
                .execPopulate();

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
                    !data.isDefault &&
                    (!data.monitors || data.monitors.length === 0)
                ) {
                    const error = new Error(
                        'You need at least one monitor to update a scheduled event'
                    );
                    error.code = 400;
                    throw error;
                }

                if (!data.isDefault && !isArrayUnique(data.monitors)) {
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
                    isDefault: '',
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
                    isDefault: '',
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

            if (data.filterText) {
                data.filterText = DOMPurify.sanitize(data.filterText);
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
                    fieldValue:
                        typeof field.fieldValue === 'number'
                            ? field.fieldValue
                            : DOMPurify.sanitize(field.fieldValue),
                }));
            }

            if (data.isDefault && data.createIncident) {
                const incomingRequest = await _this.findOneBy({
                    isDefault: true,
                    projectId: query.projectId,
                });

                if (
                    incomingRequest &&
                    String(incomingRequest._id) !== String(query.requestId)
                ) {
                    // reset any other default incoming request to false
                    await _this.updateOneBy(
                        { requestId: incomingRequest._id },
                        { isDefault: false },
                        true
                    );
                }
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

            updatedIncomingRequest = await updatedIncomingRequest
                .populate('monitors.monitorId', 'name')
                .populate('projectId', 'name')
                .execPopulate();

            if (!updatedIncomingRequest) {
                const error = new Error(
                    'Incoming request not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            // await RealTimeService.updateScheduledEvent(updatedIncomingRequest);

            return updatedIncomingRequest;
        } catch (error) {
            ErrorService.log('incomingRequestService.updateOneBy', error);
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
                    select: 'name customFields componentId',
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
                        // 2. It is not the default incoming request
                        if (!incomingRequest.isDefault) {
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
            let incomingRequest = null;
            if (isNaN(filter)) {
                if (filter && filter.trim()) {
                    incomingRequest = await _this.findOneBy({
                        _id: data.requestId,
                        projectId: data.projectId,
                        filterText: filter,
                    });
                } else {
                    incomingRequest = await _this.findOneBy({
                        _id: data.requestId,
                        projectId: data.projectId,
                    });
                }
            } else {
                incomingRequest = await _this.findOneBy({
                    _id: data.requestId,
                    projectId: data.projectId,
                    filterText: Number(filter),
                });
            }

            const incomingRequest = await _this.findOneBy({
                _id: data.requestId,
                projectId: data.projectId,
            });

            let titleTemplate,
                descriptionTemplate,
                incidentTypeTemplate,
                incidentPriorityTemplate,
                filterTextTemplate,
                customFieldTemplates = [];
            if (incomingRequest && incomingRequest.createIncident) {
                data.incidentType = incomingRequest.incidentType;
                data.incidentPriority = incomingRequest.incidentPriority;
                data.title = incomingRequest.incidentTitle;
                data.description = incomingRequest.incidentDescription;
                data.customFields = incomingRequest.customFields;

                data.reason = [
                    `Created by: ${incomingRequest.name}`,
                    `Reason: This incident was created by incoming HTTP request`,
                ];

                if (
                    data.title &&
                    data.title.trim() &&
                    data.description &&
                    data.description.trim() &&
                    data.incidentPriority
                ) {
                    data.manuallyCreated = true;

                    // handle template variables
                    titleTemplate = Handlebars.compile(data.title);
                    descriptionTemplate = Handlebars.compile(data.description);
                }

                if (data.customFields && data.customFields.length > 0) {
                    customFieldTemplates = data.customFields.map(field => ({
                        ...field,
                        fieldValue: Handlebars.compile(
                            String(field.fieldValue)
                        ),
                    }));
                }

                if (data.incidentType) {
                    incidentTypeTemplate = Handlebars.compile(
                        data.incidentType
                    );
                }
                if (data.incidentPriority) {
                    incidentPriorityTemplate = Handlebars.compile(
                        data.incidentPriority
                    );
                }
                if (incomingRequest.filterText) {
                    const dataConfig = {
                        request: data.request,
                    };
                    filterTextTemplate = Handlebars.compile(
                        incomingRequest.filterText
                    );
                    filterTextTemplate = filterTextTemplate(dataConfig);
                }

                const filterCriteria = incomingRequest.filterCriteria,
                    filterCondition = incomingRequest.filterCondition,
                    filterText = filterTextTemplate;

                const incidentResponse = [];
                if (
                    filterCriteria &&
                    filterCondition &&
                    ((!isNaN(filterText) && parseFloat(filterText) >= 0) ||
                        (filterText && filterText.trim()))
                ) {
                    if (incomingRequest.isDefault) {
                        let monitors = [];
                        if (filterCondition === 'equalTo') {
                            monitors = await MonitorService.findBy({
                                projectId: data.projectId,
                                'customFields.fieldName': filterCriteria,
                                'customFields.fieldValue': filterText,
                            });
                        } else if (filterCondition === 'notEqualTo') {
                            monitors = await MonitorService.findBy({
                                projectId: data.projectId,
                                'customFields.fieldName': filterCriteria,
                                'customFields.fieldValue': { $ne: filterText },
                            });
                        } else if (!isNaN(filterText)) {
                            // handle the case when filterText is a number
                            // (<, >, <= and >=) will only apply to numeric filterText value with respect to variable array
                            if (!isNaN(filter)) {
                                if (filterCondition === 'lessThan') {
                                    monitors = await MonitorService.findBy({
                                        projectId: data.projectId,
                                        'customFields.fieldName': filterCriteria,
                                        'customFields.fieldValue': {
                                            $lt: filterText,
                                        },
                                    });
                                } else if (filterCondition === 'greaterThan') {
                                    monitors = await MonitorService.findBy({
                                        projectId: data.projectId,
                                        'customFields.fieldName': filterCriteria,
                                        'customFields.fieldValue': {
                                            $gt: filterText,
                                        },
                                    });
                                } else if (
                                    filterCondition === 'lessThanOrEqualTo'
                                ) {
                                    monitors = await MonitorService.findBy({
                                        projectId: data.projectId,
                                        'customFields.fieldName': filterCriteria,
                                        'customFields.fieldValue': {
                                            $lte: filterText,
                                        },
                                    });
                                } else if (
                                    filterCondition === 'greaterThanOrEqualTo'
                                ) {
                                    monitors = await MonitorService.findBy({
                                        projectId: data.projectId,
                                        'customFields.fieldName': filterCriteria,
                                        'customFields.fieldValue': {
                                            $gte: filterText,
                                        },
                                    });
                                }
                            }
                        }

                        monitors = await MonitorService.findBy({
                            projectId: data.projectId,
                        });
                        for (const monitor of monitors) {
                            const dataConfig = {
                                monitorName: monitor.name,
                                projectName: monitor.projectId.name,
                                componentName: monitor.componentId.name,
                                request: data.request,
                            };

                            if (titleTemplate) {
                                data.title = titleTemplate(dataConfig);
                            }
                            if (descriptionTemplate) {
                                data.description = descriptionTemplate(
                                    dataConfig
                                );
                            }
                            if (
                                customFieldTemplates &&
                                customFieldTemplates.length > 0
                            ) {
                                data.customFields = customFieldTemplates.map(
                                    field => ({
                                        ...field,
                                        fieldValue: field.fieldValue(
                                            dataConfig
                                        ),
                                    })
                                );
                            }

                            data.monitorId = monitor._id;
                            const incident = await IncidentService.create(data);
                            incidentResponse.push(incident);
                        }
                    } else {
                        // grab the monitor from monitorId {_id, name, customFields}
                        let monitors = incomingRequest.monitors.map(
                            monitor => monitor.monitorId
                        );
                        if (filterCondition === 'equalTo') {
                            const matchedMonitor = [];
                            monitors.forEach(monitor => {
                                let added = false;
                                monitor.customFields.forEach(field => {
                                    if (
                                        field.fieldName === filterCriteria &&
                                        field.fieldValue === filterText &&
                                        !added
                                    ) {
                                        matchedMonitor.push(monitor);
                                        added = true;
                                    }
                                });
                            });
                            monitors = matchedMonitor;
                        } else if (filterCondition === 'notEqualTo') {
                            const matchedMonitor = [];
                            monitors.forEach(monitor => {
                                let added = false;
                                monitor.customFields.forEach(field => {
                                    if (
                                        field.fieldName === filterCriteria &&
                                        field.fieldValue !== filterText &&
                                        !added
                                    ) {
                                        matchedMonitor.push(monitor);
                                        added = true;
                                    }
                                });
                            });
                            monitors = matchedMonitor;
                        } else if (!isNaN(filterText)) {
                            // handle the case when filterText is a number
                            // (<, >, <= and >=) will only apply to numeric filterText value with respect to variable array
                            if (!isNaN(filter)) {
                                if (filterCondition === 'lessThan') {
                                    const matchedMonitor = [];
                                    monitors.forEach(monitor => {
                                        let added = false;
                                        monitor.customFields.forEach(field => {
                                            if (
                                                field.fieldName ===
                                                    filterCriteria &&
                                                field.fieldValue < filterText &&
                                                !added
                                            ) {
                                                matchedMonitor.push(monitor);
                                                added = true;
                                            }
                                        });
                                    });
                                    monitors = matchedMonitor;
                                } else if (filterCondition === 'greaterThan') {
                                    const matchedMonitor = [];
                                    monitors.forEach(monitor => {
                                        let added = false;
                                        monitor.customFields.forEach(field => {
                                            if (
                                                field.fieldName ===
                                                    filterCriteria &&
                                                field.fieldValue > filterText &&
                                                !added
                                            ) {
                                                matchedMonitor.push(monitor);
                                                added = true;
                                            }
                                        });
                                    });
                                    monitors = matchedMonitor;
                                } else if (
                                    filterCondition === 'lessThanOrEqualTo'
                                ) {
                                    const matchedMonitor = [];
                                    monitors.forEach(monitor => {
                                        let added = false;
                                        monitor.customFields.forEach(field => {
                                            if (
                                                field.fieldName ===
                                                    filterCriteria &&
                                                field.fieldValue <=
                                                    filterText &&
                                                !added
                                            ) {
                                                matchedMonitor.push(monitor);
                                                added = true;
                                            }
                                        });
                                    });
                                    monitors = matchedMonitor;
                                } else if (
                                    filterCondition === 'greaterThanOrEqualTo'
                                ) {
                                    const matchedMonitor = [];
                                    monitors.forEach(monitor => {
                                        let added = false;
                                        monitor.customFields.forEach(field => {
                                            if (
                                                field.fieldName ===
                                                    filterCriteria &&
                                                field.fieldValue >=
                                                    filterText &&
                                                !added
                                            ) {
                                                matchedMonitor.push(monitor);
                                                added = true;
                                            }
                                        });
                                    });
                                    monitors = matchedMonitor;
                                }
                            }
                        }

                        for (const monitor of monitors) {
                            const dataConfig = {
                                monitorName: monitor.name,
                                componentName: monitor.componentId.name,
                                projectName: incomingRequest.projectId.name,
                                request: data.request,
                            };
                            if (titleTemplate) {
                                data.title = titleTemplate(dataConfig);
                            }
                            if (descriptionTemplate) {
                                data.description = descriptionTemplate(
                                    dataConfig
                                );
                            }
                            if (
                                customFieldTemplates &&
                                customFieldTemplates.length > 0
                            ) {
                                data.customFields = customFieldTemplates.map(
                                    field => ({
                                        ...field,
                                        fieldValue: field.fieldValue(
                                            dataConfig
                                        ),
                                    })
                                );
                            }

                            data.monitorId = monitor._id;
                            const incident = await IncidentService.create(data);
                            incidentResponse.push(incident);
                        }
                    }
                } else {
                    if (incomingRequest.isDefault) {
                        const monitors = await MonitorService.findBy({
                            projectId: data.projectId,
                        });
                        for (const monitor of monitors) {
                            const dataConfig = {
                                monitorName: monitor.name,
                                projectName: monitor.projectId.name,
                                componentName: monitor.componentId.name,
                                request: data.request,
                            };

                            if (titleTemplate) {
                                data.title = titleTemplate(dataConfig);
                            }
                            if (descriptionTemplate) {
                                data.description = descriptionTemplate(
                                    dataConfig
                                );
                            }
                            if (
                                customFieldTemplates &&
                                customFieldTemplates.length > 0
                            ) {
                                data.customFields = customFieldTemplates.map(
                                    field => ({
                                        ...field,
                                        fieldValue: field.fieldValue(
                                            dataConfig
                                        ),
                                    })
                                );
                            }
                            data.monitorId = monitor._id;
                            const incident = await IncidentService.create(data);
                            incidentResponse.push(incident);
                        }
                    } else {
                        // grab the monitor from monitorId {_id, name}
                        const monitors = incomingRequest.monitors.map(
                            monitor => monitor.monitorId
                        );
                        for (const monitor of monitors) {
                            const dataConfig = {
                                monitorName: monitor.name,
                                componentName: monitor.componentId.name,
                                projectName: incomingRequest.projectId.name,
                                request: data.request,
                            };
                            if (titleTemplate) {
                                data.title = titleTemplate(dataConfig);
                            }
                            if (descriptionTemplate) {
                                data.description = descriptionTemplate(
                                    dataConfig
                                );
                            }
                            if (
                                customFieldTemplates &&
                                customFieldTemplates.length > 0
                            ) {
                                data.customFields = customFieldTemplates.map(
                                    field => ({
                                        ...field,
                                        fieldValue: field.fieldValue(
                                            dataConfig
                                        ),
                                    })
                                );
                            }

                            data.monitorId = monitor._id;
                            const incident = await IncidentService.create(data);
                            incidentResponse.push(incident);
                        }
                    }
                }

                return {
                    status: 'success',
                    created_incidents: incidentResponse.map(
                        response => response.idNumber
                    ),
                };
            }

            if (
                incomingRequest &&
                (incomingRequest.updateIncidentNote ||
                    incomingRequest.updateInternalNote)
            ) {
                data.incident_state = incomingRequest.incidentState;
                data.type = incomingRequest.updateIncidentNote
                    ? 'investigation'
                    : 'internal';
                data.content = incomingRequest.noteContent;

                const filterCriteria = incomingRequest.filterCriteria,
                    filterCondition = incomingRequest.filterCondition,
                    filterText = incomingRequest.filterText;

                const noteResponse = [];
                if (
                    filterCriteria &&
                    filterCondition &&
                    ((!isNaN(filterText) && parseFloat(filterText) >= 0) ||
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

                    let incidents;
                    if (filterCondition === 'equalTo') {
                        if (data.incidentId) {
                            incidents = await IncidentService.findBy({
                                projectId: incomingRequest.projectId,
                                idNumber: data.incidentId,
                            });
                        }

                        if (data.fieldName && data.fieldValue) {
                            incidents = await IncidentService.findBy({
                                projectId: incomingRequest.projectId,
                                'customFields.fieldName': data.fieldName,
                                'customFields.fieldValue': data.fieldValue,
                            });
                        }
                    }

                    if (filterCondition === 'notEqualTo') {
                        if (data.incidentId) {
                            incidents = await IncidentService.findBy({
                                projectId: incomingRequest.projectId,
                                idNumber: { $ne: data.incidentId },
                            });
                        }

                        if (data.fieldName && data.fieldValue) {
                            incidents = await IncidentService.findBy({
                                projectId: incomingRequest.projectId,
                                'customFields.fieldName': data.fieldName,
                                'customFields.fieldValue': {
                                    $ne: data.fieldValue,
                                },
                            });
                        }
                    }

                    if (incidents && incidents.length > 0) {
                        for (const incident of incidents) {
                            data.incidentId = incident._id;
                            await IncidentMessageService.create(data);
                            noteResponse.push(incident);
                        }
                    }
                } else {
                    const incidents = await IncidentService.findBy({
                        projectId: incomingRequest.projectId,
                    });

                    for (const incident of incidents) {
                        data.incidentId = incident._id;
                        await IncidentMessageService.create(data);
                        noteResponse.push(incident);
                    }
                }

                return {
                    status: 'success',
                    internalNotes_addedTo: noteResponse.map(
                        res => res.idNumber
                    ),
                };
            }

            if (
                incomingRequest &&
                (incomingRequest.acknowledgeIncident ||
                    incomingRequest.resolveIncident)
            ) {
                const filterCriteria = incomingRequest.filterCriteria,
                    filterCondition = incomingRequest.filterCondition,
                    filterText = incomingRequest.filterText;

                const resolveResponse = [],
                    acknowledgeResponse = [];
                if (
                    filterCriteria &&
                    filterCondition &&
                    ((!isNaN(filterText) && parseFloat(filterText) >= 0) ||
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

                    let incidents;
                    if (filterCondition === 'equalTo') {
                        if (data.incidentId) {
                            incidents = await IncidentService.findBy({
                                projectId: incomingRequest.projectId,
                                idNumber: data.incidentId,
                            });
                        }

                        if (data.fieldName && data.fieldValue) {
                            incidents = await IncidentService.findBy({
                                projectId: incomingRequest.projectId,
                                'customFields.fieldName': data.fieldName,
                                'customFields.fieldValue': data.fieldValue,
                            });
                        }
                    }

                    if (filterCondition === 'notEqualTo') {
                        if (data.incidentId) {
                            incidents = await IncidentService.findBy({
                                projectId: incomingRequest.projectId,
                                idNumber: { $ne: data.incidentId },
                            });
                        }

                        if (data.fieldName && data.fieldValue) {
                            incidents = await IncidentService.findBy({
                                projectId: incomingRequest.projectId,
                                'customFields.fieldName': data.fieldName,
                                'customFields.fieldValue': {
                                    $ne: data.fieldValue,
                                },
                            });
                        }
                    }

                    if (incidents && incidents.length > 0) {
                        for (const incident of incidents) {
                            if (incomingRequest.acknowledgeIncident) {
                                const incidentData = await IncidentService.acknowledge(
                                    incident._id,
                                    null,
                                    'fyipe'
                                );
                                acknowledgeResponse.push(incidentData);
                            }
                            if (incomingRequest.resolveIncident) {
                                const incidentData = await IncidentService.resolve(
                                    incident._id,
                                    null,
                                    'fyipe'
                                );
                                resolveResponse.push(incidentData);
                            }
                        }
                    }
                } else {
                    const incidents = await IncidentService.findBy({
                        projectId: incomingRequest.projectId,
                    });

                    for (const incident of incidents) {
                        if (incomingRequest.acknowledgeIncident) {
                            const incidentData = await IncidentService.acknowledge(
                                incident._id,
                                null,
                                'fyipe'
                            );
                            acknowledgeResponse.push(incidentData);
                        }
                        if (incomingRequest.resolveIncident) {
                            const incidentData = await IncidentService.resolve(
                                incident._id,
                                null,
                                'fyipe'
                            );
                            resolveResponse.push(incidentData);
                        }
                    }
                }

                if (resolveResponse && resolveResponse.length > 0) {
                    return {
                        status: 'success',
                        resolved_incidents: resolveResponse.map(
                            res => res.idNumber
                        ),
                    };
                }
                if (acknowledgeResponse && acknowledgeResponse.length > 0) {
                    return {
                        status: 'success',
                        acknowledged_incidents: acknowledgeResponse.map(
                            res => res.idNumber
                        ),
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
