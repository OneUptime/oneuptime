import IncomingRequestModel from '../Models/incomingRequest';
import ObjectID from 'Common/Types/ObjectID';
import IncidentService from './IncidentService';
import MonitorService from './MonitorService.ts.temp';
import AlertService from './AlertService';
import ErrorService from '../Utils/error';
import ProjectService from './ProjectService';

import createDOMPurify from 'dompurify';
const jsdom: $TSFixMe = require('jsdom').jsdom;
const window: $TSFixMe = jsdom('').defaultView;
const DOMPurify: $TSFixMe = createDOMPurify(window);

import { isEmpty } from 'lodash';
import IncidentMessageService from './IncidentMessageService';
import IncidentPrioritiesService from './IncidentPrioritiesService';
import IncidentSettingsService from './IncidentSettingsService';
import joinNames from '../Utils/joinNames';
import vm from 'vm';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';
// Import RealTimeService from './realTimeService'

export default class Service {
    public async findOneBy({ query, select, populate, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const incomingRequestQuery: $TSFixMe = IncomingRequestModel.findOne(
            query
        )
            .sort(sort)
            .lean();

        incomingRequestQuery.select(select);
        incomingRequestQuery.populate(populate);
        const result: $TSFixMe = await incomingRequestQuery;

        return result;
    }

    public async create(data: $TSFixMe): void {
        if (
            !data.selectAllMonitors &&
            data.createIncident &&
            (!data.monitors || data.monitors.length === 0)
        ) {
            const error: $TSFixMe = new Error(
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
            const error: $TSFixMe = new Error(
                'You cannot have multiple selection of a monitor'
            );

            error.code = 400;
            throw error;
        }

        if (data.createIncident) {
            // Reassign data.monitors with a restructured monitor data
            data.monitors = data.monitors.map((monitor: $TSFixMe) => {
                return {
                    monitorId: monitor,
                };
            });
        }

        if (data.incidentTitle) {
            data.incidentTitle = DOMPurify.sanitize(data.incidentTitle);
        }

        if (data.incidentDescription) {
            data.incidentDescription = DOMPurify.sanitize(
                data.incidentDescription
            );
        }

        /*
         * If (data.filterText) {
         *     Data.filterText = DOMPurify.sanitize(data.filterText);
         * }
         */
        if (data.filters && data.filters.length > 0) {
            data.filters = data.filters.map((filter: $TSFixMe) => {
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
            const customFields: $TSFixMe = [...data.customFields];
            data.customFields = customFields.map((field: $TSFixMe) => {
                return {
                    fieldName: field.fieldName,
                    fieldType: field.fieldType,
                    uniqueField: field.uniqueField,
                    fieldValue:
                        typeof field.fieldValue === 'number'
                            ? field.fieldValue
                            : DOMPurify.sanitize(field.fieldValue),
                };
            });
        }
        data.enabled = true;
        const select: $TSFixMe =
            'name projectId monitors isDefault selectAllMonitors createIncident acknowledgeIncident resolveIncident updateIncidentNote updateInternalNote noteContent incidentState url enabled incidentTitle incidentType incidentPriority incidentDescription customFields filterMatch filters createSeparateIncident post_statuspage deleted';

        const populate: $TSFixMe = [
            {
                path: 'monitors.monitorId',
                select: 'name customFields componentId deleted',
                populate: [{ path: 'componentId', select: 'name' }],
            },
            { path: 'projectId', select: 'name' },
        ];

        let incomingRequest: $TSFixMe = await IncomingRequestModel.create({
            ...data,
        });

        incomingRequest = await this.findOneBy({
            query: { _id: incomingRequest._id },
            select,
            populate,
        });

        // Await RealTimeService.addScheduledEvent(incomingRequest);

        return incomingRequest;
    }

    public async getRequestUrl(projectId: ObjectID, requestId: $TSFixMe): void {
        /*
         * Create a unique request url
         * Update incomingRequest collection with the new url
         */

        const requestUrl: string = `${global.apiHost}/incoming-request/${projectId}/request/${requestId}`;
        const updatedIncomingRequest: $TSFixMe = await this.updateOneBy(
            { requestId, projectId },
            { url: requestUrl },
            true
        );
        return updatedIncomingRequest;
    }

    public async updateOneBy(
        query: Query,
        data: $TSFixMe,
        excludeMonitors: $TSFixMe
    ): void {
        let unsetData: $TSFixMe = {};
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.deleted = false;
        }

        if (!excludeMonitors && data.createIncident) {
            if (
                !data.selectAllMonitors &&
                (!data.monitors || data.monitors.length === 0)
            ) {
                const error: $TSFixMe = new Error(
                    'You need at least one monitor to update a scheduled event'
                );

                error.code = 400;
                throw error;
            }

            if (!data.selectAllMonitors && !isArrayUnique(data.monitors)) {
                const error: $TSFixMe = new Error(
                    'You cannot have multiple selection of a monitor'
                );

                error.code = 400;
                throw error;
            }

            // Reassign data.monitors with a restructured monitor data
            data.monitors = data.monitors.map((monitor: $TSFixMe) => {
                return {
                    monitorId: monitor,
                };
            });
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

        /*
         * If (data.filterText) {
         *     Data.filterText = DOMPurify.sanitize(data.filterText);
         * }
         */
        if (data.filters && data.filters.length > 0) {
            data.filters = data.filters.map((filter: $TSFixMe) => {
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
            const customFields: $TSFixMe = [...data.customFields];
            data.customFields = customFields.map((field: $TSFixMe) => {
                return {
                    fieldName: field.fieldName,
                    fieldType: field.fieldType,
                    uniqueField: field.uniqueField,
                    fieldValue:
                        typeof field.fieldValue === 'number'
                            ? field.fieldValue
                            : DOMPurify.sanitize(field.fieldValue),
                };
            });
        }

        let updatedIncomingRequest: $TSFixMe =
            await IncomingRequestModel.findOneAndUpdate(
                { _id: query.requestId },
                {
                    $set: data,
                },
                { new: true }
            );

        if (!isEmpty(unsetData)) {
            updatedIncomingRequest =
                await IncomingRequestModel.findOneAndUpdate(
                    { _id: query.requestId },
                    { $unset: unsetData },
                    { new: true }
                );
        }

        if (!updatedIncomingRequest) {
            const error: $TSFixMe = new Error(
                'Incoming request not found or does not exist'
            );

            error.code = 400;
            throw error;
        }
        const select: $TSFixMe =
            'name projectId monitors isDefault selectAllMonitors createIncident acknowledgeIncident resolveIncident updateIncidentNote updateInternalNote noteContent incidentState url enabled incidentTitle incidentType incidentPriority incidentDescription customFields filterMatch filters createSeparateIncident post_statuspage deleted';

        const populate: $TSFixMe = [
            {
                path: 'monitors.monitorId',
                select: 'name customFields componentId deleted',
                populate: [{ path: 'componentId', select: 'name' }],
            },
            { path: 'projectId', select: 'name' },
        ];

        updatedIncomingRequest = await this.findOneBy({
            query: { _id: query.requestId },
            select,
            populate,
        });

        // Await RealTimeService.updateScheduledEvent(updatedIncomingRequest);

        return updatedIncomingRequest;
    }

    public async updateCustomFieldBy(query: Query, data: $TSFixMe): void {
        const incomingRequest: $TSFixMe =
            await IncomingRequestModel.findOneAndUpdate(
                query,
                { $set: data },
                { new: true }
            );
        return incomingRequest;
    }

    public async findBy({
        query,
        limit,
        skip,
        populate,
        select,
        sort,
    }: FindBy): void {
        if (!skip || isNaN(skip)) {
            skip = 0;
        }

        if (!limit || isNaN(limit)) {
            limit = 0;
        }

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
        const allIncomingRequest: $TSFixMe = IncomingRequestModel.find(query)
            .limit(limit.toNumber())
            .skip(skip.toNumber())
            .sort(sort)
            .lean();

        allIncomingRequest.select(select);
        allIncomingRequest.populate(populate);
        const result: $TSFixMe = await allIncomingRequest;

        return result;
    }

    public async countBy(query: Query): void {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        const count: $TSFixMe = await IncomingRequestModel.countDocuments(
            query
        );
        return count;
    }

    public async deleteBy(query: Query): void {
        const incomingRequest: $TSFixMe =
            await IncomingRequestModel.findOneAndUpdate(
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
            const error: $TSFixMe = new Error(
                'Incoming request not found or does not exist'
            );

            error.code = 400;
            throw error;
        }

        // Await RealTimeService.deleteScheduledEvent(incomingRequest);

        return incomingRequest;
    }

    public async updateBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.deleted = false;
        }
        let updateIncomingRequest: $TSFixMe =
            await IncomingRequestModel.updateMany(query, {
                $set: data,
            });

        const select: $TSFixMe =
            'name projectId monitors isDefault selectAllMonitors createIncident acknowledgeIncident resolveIncident updateIncidentNote updateInternalNote noteContent incidentState url enabled incidentTitle incidentType incidentPriority incidentDescription customFields filterMatch filters createSeparateIncident post_statuspage deleted';

        const populate: $TSFixMe = [
            {
                path: 'monitors.monitorId',
                select: 'name customFields componentId deleted',
                populate: [{ path: 'componentId', select: 'name' }],
            },
            { path: 'projectId', select: 'name' },
        ];
        updateIncomingRequest = await this.findBy({
            query,
            select,
            populate,
        });
        return updateIncomingRequest;
    }

    /**
     * @description removes a particular monitor from incoming request
     * @description if no monitor remains after deletion, then the incoming request is deleted
     * @param {string} monitorId the id of the monitor
     * @param {string} userId the id of the user
     */
    public async removeMonitor(monitorId: $TSFixMe): void {
        const allIncomingRequest: $TSFixMe = await this.findBy({
            query: { 'monitors.monitorId': monitorId },
            select: 'monitors',
        });

        await Promise.all(
            allIncomingRequest.map(async (incomingRequest: $TSFixMe) => {
                // Remove the monitor from incomingRequest monitors list
                incomingRequest.monitors = incomingRequest.monitors.filter(
                    (monitor: $TSFixMe) => {
                        return (
                            String(
                                monitor.monitorId._id || monitor.monitorId
                            ) !== String(monitorId)
                        );
                    }
                );

                if (incomingRequest.monitors.length > 0) {
                    let updatedIncomingRequest: $TSFixMe =
                        await IncomingRequestModel.findOneAndUpdate(
                            { _id: incomingRequest._id },
                            { $set: { monitors: incomingRequest.monitors } },
                            { new: true }
                        );
                    updatedIncomingRequest = await updatedIncomingRequest
                        .populate('monitors.monitorId', 'name')
                        .populate('projectId', 'name')
                        .execPopulate();

                    /*
                     * Await RealTimeService.updateScheduledEvent(
                     *     UpdatedIncomingRequest
                     * );
                     */
                    return updatedIncomingRequest;
                }
                /*
                 * Delete the incomingRequest when:
                 * 1. No monitor is remaining in the monitors array
                 * 2. It does not select all monitors
                 */
                if (!incomingRequest.selectAllMonitors) {
                    let deletedIncomingRequest: $TSFixMe =
                        await IncomingRequestModel.findOneAndUpdate(
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

                    /*
                     * Await RealTimeService.deleteScheduledEvent(
                     *     DeletedIncomingRequest
                     * );
                     */
                    return deletedIncomingRequest;
                }
            })
        );
    }

    public async handleIncomingRequestAction(data: $TSFixMe): void {
        const selectIncPriority: $TSFixMe =
            'projectId name color createdAt deletedAt deleted deletedById';
        const selectIncSettings: $TSFixMe =
            'projectId title description incidentPriority isDefault name createdAt';
        const selectInRequest: $TSFixMe =
            'name projectId monitors isDefault selectAllMonitors createIncident acknowledgeIncident resolveIncident updateIncidentNote updateInternalNote noteContent incidentState url enabled incidentTitle incidentType incidentPriority incidentDescription customFields filterMatch filters createSeparateIncident post_statuspage deleted';

        const populateInRequest: $TSFixMe = [
            {
                path: 'monitors.monitorId',
                select: 'name customFields componentId deleted',
                populate: [{ path: 'componentId', select: 'name' }],
            },
            { path: 'projectId', select: 'name' },
        ];
        const [
            incidentPriorities,
            incidentSettings,
            incomingRequest,
        ]: $TSFixMe = await Promise.all([
            IncidentPrioritiesService.findBy({
                query: { projectId: data.projectId },
                select: selectIncPriority,
            }),
            IncidentSettingsService.findOne({
                query: {
                    projectId: data.projectId,
                    isDefault: true,
                },
                select: selectIncSettings,
            }),
            this.findOneBy({
                query: { _id: data.requestId, projectId: data.projectId },
                select: selectInRequest,
                populate: populateInRequest,
            }),
        ]);

        // Grab value for posting to status page
        data.post_statuspage = incomingRequest.post_statuspage ? true : false;
        const filterMatch: $TSFixMe = incomingRequest.filterMatch;
        const filters: $TSFixMe = incomingRequest.filters;

        if (incomingRequest && incomingRequest.enabled === false) {
            return {
                status: 'disabled',
            };
        }

        if (
            incomingRequest &&
            incomingRequest.createIncident &&
            incomingRequest.enabled
        ) {
            const incidentResponse: $TSFixMe = [],
                monitorsWithIncident: $TSFixMe = [];

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

            let monitors: $TSFixMe = [];
            if (incomingRequest.selectAllMonitors) {
                const projectIds: $TSFixMe = await ProjectService.findBy({
                    query: { parentProjectId: data.projectId },
                    select: '_id',
                });
                projectIds.push(data.projectId);
                monitors = await MonitorService.findBy({
                    query: { projectId: { $in: projectIds } },
                    select: '_id customFields componentId projectId name',
                    populate: [
                        { path: 'componentId', select: 'name' },
                        { path: 'projectId', select: 'name' },
                    ],
                });
            } else {
                monitors = incomingRequest.monitors
                    .map((monitor: $TSFixMe) => {
                        return monitor.monitorId;
                    })
                    .filter((monitor: $TSFixMe) => {
                        return !monitor.deleted;
                    });
            }

            if (filters && filters.length > 0) {
                /*
                 * If template variables are used
                 * Update the values for filterText
                 */
                const updatedFilters: $TSFixMe = filters.map(
                    (filter: $TSFixMe) => {
                        if (filter.filterText) {
                            const dataConfig: $TSFixMe = {
                                request: data.request,
                            };
                            filter.filterText = analyseVariable(
                                filter.filterText,
                                dataConfig
                            );
                        }
                        return filter;
                    }
                );
                const newMonitorList: $TSFixMe = [];
                monitors.forEach((monitor: $TSFixMe) => {
                    let matchedFields: $TSFixMe = 0;
                    const monitorCustomFields: $TSFixMe =
                        monitor.customFields || [];

                    updatedFilters.forEach((filter: $TSFixMe) => {
                        const filterCondition: $TSFixMe =
                            filter.filterCondition;
                        for (const field of monitorCustomFields) {
                            if (filterCondition === 'equalTo') {
                                if (
                                    field.fieldName === filter.filterCriteria &&
                                    field.fieldValue === filter.filterText
                                ) {
                                    matchedFields += 1;
                                    break;
                                }
                            } else if (filterCondition === 'notEqualTo') {
                                if (
                                    field.fieldName === filter.filterCriteria &&
                                    field.fieldValue !== filter.filterText
                                ) {
                                    matchedFields += 1;
                                    break;
                                }
                            } else if (!isNaN(parseFloat(filter.filterText))) {
                                /*
                                 * Handle the case when filterText is a number
                                 * (<, >, <= and >=) will only apply to numeric filterText value with respect to variable array
                                 */
                                if (filterCondition === 'lessThan') {
                                    if (
                                        field.fieldName ===
                                            filter.filterCriteria &&
                                        field.fieldValue < filter.filterText
                                    ) {
                                        matchedFields += 1;
                                        break;
                                    }
                                } else if (filterCondition === 'greaterThan') {
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
                                        field.fieldValue <= filter.filterText
                                    ) {
                                        matchedFields += 1;
                                        break;
                                    }
                                } else if (
                                    filterCondition === 'greaterThanOrEqualTo'
                                ) {
                                    if (
                                        field.fieldName ===
                                            filter.filterCriteria &&
                                        field.fieldValue >= filter.filterText
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
                    } else if (matchedFields > 0) {
                        newMonitorList.push(monitor);
                    }
                });

                monitors = newMonitorList;
            }

            if (incomingRequest.createSeparateIncident) {
                for (const monitor of monitors) {
                    const dataConfig: $TSFixMe = {
                        monitorName: monitor.name,
                        projectName: monitor.projectId.name,
                        componentName: monitor.componentId.name,
                        request: data.request,
                    };

                    let _incident: $TSFixMe;
                    if (data.customFields && data.customFields.length > 0) {
                        for (const field of data.customFields) {
                            if (
                                field.uniqueField &&
                                field.fieldValue &&
                                field.fieldValue.trim()
                            ) {
                                _incident = await IncidentService.findOneBy({
                                    query: {
                                        customFields: {
                                            $elemMatch: {
                                                fieldName: field.fieldName,
                                                fieldType: field.fieldType,
                                                uniqueField: field.uniqueField,
                                                fieldValue: analyseVariable(
                                                    field.fieldValue,
                                                    dataConfig
                                                ),
                                            },
                                        },
                                    },
                                    select: '_id',
                                });
                            }
                        }
                    }

                    data.title = analyseVariable(data.title, dataConfig);
                    data.description = analyseVariable(
                        data.description,
                        dataConfig
                    );
                    const incidentType: $TSFixMe = analyseVariable(
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

                    const incidentPriority: $TSFixMe = analyseVariable(
                        String(data.incidentPriority),
                        dataConfig
                    ).toLowerCase();
                    const priorityObj: $TSFixMe = {};
                    incidentPriorities.forEach((priority: $TSFixMe) => {
                        return (priorityObj[priority.name.toLowerCase()] =
                            priority._id);
                    });
                    data.incidentPriority =
                        priorityObj[incidentPriority] ||
                        incidentSettings.incidentPriority;

                    data.customFields = data.customFields.map(
                        (field: $TSFixMe) => {
                            return {
                                ...field,

                                fieldValue: analyseVariable(
                                    String(field.fieldValue),
                                    dataConfig
                                ),
                            };
                        }
                    );

                    if (!monitorsWithIncident.includes(String(monitor._id))) {
                        let incident: $TSFixMe;
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
            } else if (monitors && monitors.length > 0) {
                const monitorNames: $TSFixMe = monitors.map(
                    (monitor: $TSFixMe) => {
                        return monitor.name;
                    }
                );
                const componentNames: $TSFixMe = [];
                monitors.forEach((monitor: $TSFixMe) => {
                    if (!componentNames.includes(monitor.componentId.name)) {
                        componentNames.push(monitor.componentId.name);
                    }
                });
                const dataConfig: $TSFixMe = {
                    monitorName: joinNames(monitorNames),
                    projectName: incomingRequest.projectId.name,
                    componentName: joinNames(componentNames),
                    request: data.request,
                };
                let _incident: $TSFixMe;
                if (data.customFields && data.customFields.length > 0) {
                    for (const field of data.customFields) {
                        if (
                            field.uniqueField &&
                            field.fieldValue &&
                            field.fieldValue.trim()
                        ) {
                            _incident = await IncidentService.findOneBy({
                                query: {
                                    customFields: {
                                        $elemMatch: {
                                            fieldName: field.fieldName,
                                            fieldType: field.fieldType,
                                            uniqueField: field.uniqueField,
                                            fieldValue: analyseVariable(
                                                field.fieldValue,
                                                dataConfig
                                            ),
                                        },
                                    },
                                },
                                select: '_id',
                            });
                        }
                    }
                }
                data.title = analyseVariable(data.title, dataConfig);
                data.description = analyseVariable(
                    data.description,
                    dataConfig
                );
                const incidentType: $TSFixMe = analyseVariable(
                    data.incidentType,
                    dataConfig
                ).toLowerCase();
                data.incidentType = ['offline', 'online', 'degraded'].includes(
                    incidentType
                )
                    ? incidentType
                    : 'offline';

                const incidentPriority: $TSFixMe = analyseVariable(
                    String(data.incidentPriority),
                    dataConfig
                ).toLowerCase();
                const priorityObj: $TSFixMe = {};
                incidentPriorities.forEach((priority: $TSFixMe) => {
                    return (priorityObj[priority.name.toLowerCase()] =
                        priority._id);
                });
                data.incidentPriority =
                    priorityObj[incidentPriority] ||
                    incidentSettings.incidentPriority;

                data.customFields = data.customFields.map((field: $TSFixMe) => {
                    return {
                        ...field,

                        fieldValue: analyseVariable(
                            String(field.fieldValue),
                            dataConfig
                        ),
                    };
                });
                data.monitors = monitors.map((monitor: $TSFixMe) => {
                    return monitor._id;
                });
                let incident: $TSFixMe;
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

            let created_incidents: $TSFixMe = new Set(
                incidentResponse.map((response: $TSFixMe) => {
                    return response.idNumber;
                })
            );

            created_incidents = [...created_incidents];
            return {
                status: 'success',
                created_incidents,
            };
        }

        if (
            incomingRequest &&
            incomingRequest.enabled &&
            (incomingRequest.updateIncidentNote ||
                incomingRequest.updateInternalNote)
        ) {
            let subProjectIds: $TSFixMe = [];

            const subProjects: $TSFixMe = await ProjectService.findBy({
                query: {
                    parentProjectId:
                        incomingRequest.projectId._id ||
                        incomingRequest.projectId,
                },
                select: '_id',
            });
            if (subProjects && subProjects.length > 0) {
                subProjectIds = subProjects.map((project: $TSFixMe) => {
                    return project._id;
                });
            }
            subProjectIds.push(incomingRequest.projectId);

            const noteResponse: $TSFixMe = [],
                incidentsWithNote: $TSFixMe = [];

            data.incident_state = incomingRequest.incidentState;
            data.type = incomingRequest.updateIncidentNote
                ? 'investigation'
                : 'internal';
            data.content = incomingRequest.noteContent;

            let incidents: $TSFixMe = [],
                updatedFilters: $TSFixMe = [];
            const populate: $TSFixMe = [
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
            const select: $TSFixMe =
                'slug notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

            if (!filters || filters.length === 0) {
                incidents = await IncidentService.findBy({
                    query: {
                        projectId: { $in: subProjectIds }, // Handle for both project and subProjects
                    },
                    select,
                    populate,
                });
            } else {
                updatedFilters = filters.map((filter: $TSFixMe) => {
                    if (filter.filterText) {
                        const dataConfig: $TSFixMe = {
                            request: data.request,
                        };
                        filter.filterText = analyseVariable(
                            filter.filterText,
                            dataConfig
                        );
                    }
                    return filter;
                });

                const incidentArray: $TSFixMe = [];
                for (const filter of updatedFilters) {
                    const filterCriteria: $TSFixMe = filter.filterCriteria,
                        filterCondition: $TSFixMe = filter.filterCondition,
                        filterText: $TSFixMe = filter.filterText;

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

                        let incidents: $TSFixMe = [];
                        if (filterCondition === 'equalTo') {
                            if (
                                data.incidentId &&
                                filterCriteria === 'incidentId'
                            ) {
                                incidents = await IncidentService.findBy({
                                    query: {
                                        projectId: { $in: subProjectIds }, // Handle for both project and subProjects
                                        idNumber: data.incidentId,
                                    },
                                    select,
                                    populate,
                                });
                            }

                            if (data.fieldName && data.fieldValue) {
                                incidents = await IncidentService.findBy({
                                    query: {
                                        projectId: { $in: subProjectIds }, // Handle for both project and subProjects
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
                                        projectId: { $in: subProjectIds }, // Handle for both project and subProjects
                                        idNumber: { $ne: data.incidentId },
                                    },
                                    select,
                                    populate,
                                });
                            }

                            if (data.fieldName && data.fieldValue) {
                                incidents = await IncidentService.findBy({
                                    query: {
                                        projectId: { $in: subProjectIds }, // Handle for both project and subProjects
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
                            /*
                             * Handle the case when filterText is a number
                             * (<, >, <= and >=) will only apply to numeric filterText value with respect to variable array
                             */
                            data.fieldValue = Number(filterText);
                            if (filterCondition === 'lessThan') {
                                if (
                                    data.incidentId &&
                                    filterCriteria === 'incidentId'
                                ) {
                                    incidents = await IncidentService.findBy({
                                        query: {
                                            projectId: {
                                                $in: subProjectIds,
                                            }, // Handle for both project and subProjects
                                            idNumber: {
                                                $lt: data.incidentId,
                                            },
                                        },
                                        select,
                                        populate,
                                    });
                                }

                                if (data.fieldName && data.fieldValue) {
                                    incidents = await IncidentService.findBy({
                                        query: {
                                            projectId: {
                                                $in: subProjectIds,
                                            }, // Handle for both project and subProjects
                                            'customFields.fieldName':
                                                data.fieldName,
                                            'customFields.fieldValue': {
                                                $lt: data.fieldValue,
                                            },
                                        },
                                        select,
                                        populate,
                                    });
                                }
                            } else if (filterCondition === 'greaterThan') {
                                if (
                                    data.incidentId &&
                                    filterCriteria === 'incidentId'
                                ) {
                                    incidents = await IncidentService.findBy({
                                        query: {
                                            projectId: {
                                                $in: subProjectIds,
                                            }, // Handle for both project and subProjects
                                            idNumber: {
                                                $gt: data.incidentId,
                                            },
                                        },
                                        select,
                                        populate,
                                    });
                                }

                                if (data.fieldName && data.fieldValue) {
                                    incidents = await IncidentService.findBy({
                                        query: {
                                            projectId: {
                                                $in: subProjectIds,
                                            }, // Handle for both project and subProjects
                                            'customFields.fieldName':
                                                data.fieldName,
                                            'customFields.fieldValue': {
                                                $gt: data.fieldValue,
                                            },
                                        },
                                        select,
                                        populate,
                                    });
                                }
                            } else if (
                                filterCondition === 'lessThanOrEqualTo'
                            ) {
                                if (
                                    data.incidentId &&
                                    filterCriteria === 'incidentId'
                                ) {
                                    incidents = await IncidentService.findBy({
                                        query: {
                                            projectId: {
                                                $in: subProjectIds,
                                            }, // Handle for both project and subProjects
                                            idNumber: {
                                                $lte: data.incidentId,
                                            },
                                        },
                                        select,
                                        populate,
                                    });
                                }

                                if (data.fieldName && data.fieldValue) {
                                    incidents = await IncidentService.findBy({
                                        query: {
                                            projectId: {
                                                $in: subProjectIds,
                                            }, // Handle for both project and subProjects
                                            'customFields.fieldName':
                                                data.fieldName,
                                            'customFields.fieldValue': {
                                                $lte: data.fieldValue,
                                            },
                                        },
                                        select,
                                        populate,
                                    });
                                }
                            } else if (
                                filterCondition === 'greaterThanOrEqualTo'
                            ) {
                                if (
                                    data.incidentId &&
                                    filterCriteria === 'incidentId'
                                ) {
                                    incidents = await IncidentService.findBy({
                                        query: {
                                            projectId: {
                                                $in: subProjectIds,
                                            }, // Handle for both project and subProjects
                                            idNumber: {
                                                $gte: data.incidentId,
                                            },
                                        },
                                        select,
                                        populate,
                                    });
                                }

                                if (data.fieldName && data.fieldValue) {
                                    incidents = await IncidentService.findBy({
                                        query: {
                                            projectId: {
                                                $in: subProjectIds,
                                            }, // Handle for both project and subProjects
                                            'customFields.fieldName':
                                                data.fieldName,
                                            'customFields.fieldValue': {
                                                $gte: data.fieldValue,
                                            },
                                        },
                                        select,
                                        populate,
                                    });
                                }
                            }
                        }

                        incidentArray.push(...incidents);
                    }
                }

                incidents = incidentArray;
            }

            // Only have unique incidents
            const filtered: $TSFixMe = [];
            incidents = incidents.filter((incident: $TSFixMe) => {
                if (filtered.indexOf(String(incident._id)) < 0) {
                    filtered.push(String(incident._id));
                    return true;
                }
                return false;
            });

            if (filters || filters.length > 0) {
                const newIncidentList: $TSFixMe = [];
                incidents.forEach((incident: $TSFixMe) => {
                    let matchedFields: $TSFixMe = 0;
                    const incidentCustomFields: $TSFixMe =
                        incident.customFields || [];
                    // Automatically create incident id custom field
                    incidentCustomFields.push({
                        fieldName: 'incidentId',
                        fieldValue: String(incident.idNumber),
                        fieldType: 'string',
                    });

                    updatedFilters.forEach((filter: $TSFixMe) => {
                        for (const field of incidentCustomFields) {
                            const filterCriteria: $TSFixMe =
                                    filter.filterCriteria,
                                filterCondition: $TSFixMe =
                                    filter.filterCondition,
                                filterText: $TSFixMe = filter.filterText;

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
                                        field.fieldValue === filter.filterText
                                    ) {
                                        matchedFields += 1;
                                        break;
                                    }
                                }

                                if (filterCondition === 'notEqualTo') {
                                    if (
                                        field.fieldName === filterCriteria &&
                                        field.fieldValue !== filterText
                                    ) {
                                        matchedFields += 1;
                                        break;
                                    }
                                }

                                if (!isNaN(parseFloat(filterText))) {
                                    /*
                                     * Handle the case when filterText is a number
                                     * (<, >, <= and >=) will only apply to numeric filterText value with respect to variable array
                                     */
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
                                        filterCondition === 'lessThanOrEqualTo'
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
                    } else if (matchedFields > 0) {
                        newIncidentList.push(incident);
                    }
                });

                incidents = newIncidentList;
            }

            if (incidents && incidents.length > 0) {
                for (const incident of incidents) {
                    const monitors: $TSFixMe = incident.monitors.map(
                        (monitorObj: $TSFixMe) => {
                            return monitorObj.monitorId;
                        }
                    );
                    const monitorNames: $TSFixMe = monitors.map(
                        (monitor: $TSFixMe) => {
                            return monitor.name;
                        }
                    );
                    const componentNames: $TSFixMe = [];
                    monitors.forEach((monitor: $TSFixMe) => {
                        if (
                            !componentNames.includes(monitor.componentId.name)
                        ) {
                            componentNames.push(monitor.componentId.name);
                        }
                    });
                    const dataConfig: $TSFixMe = {
                        monitorName: joinNames(monitorNames),
                        projectName: incomingRequest.projectId.name,
                        componentName: joinNames(componentNames),
                        request: data.request,
                    };

                    // Update the data with actual values (only for templates)
                    data.content = analyseVariable(data.content, dataConfig);
                    data.incident_state = analyseVariable(
                        data.incident_state,
                        dataConfig
                    );

                    data.incidentId = incident._id;
                    if (!incidentsWithNote.includes(String(incident._id))) {
                        data.monitors = incident.monitors.map(
                            (monitor: $TSFixMe) => {
                                return monitor.monitorId;
                            }
                        );
                        await IncidentMessageService.create(data);
                        if (data.post_statuspage) {
                            AlertService.sendInvestigationNoteToSubscribers(
                                incident,
                                data,
                                'created',
                                data.projectId
                            ).catch((error: Error) => {
                                ErrorService.log(
                                    'AlertService.sendInvestigationNoteToSubscriber',
                                    error
                                );
                            });
                        }
                        noteResponse.push(incident);
                        incidentsWithNote.push(String(incident._id));
                    } else {
                        data.monitors = incident.monitors.map(
                            (monitor: $TSFixMe) => {
                                return monitor.monitorId;
                            }
                        );
                        await IncidentMessageService.create(data);
                        if (data.post_statuspage) {
                            AlertService.sendInvestigationNoteToSubscribers(
                                incident,
                                data,
                                'created',
                                data.projectId
                            ).catch((error: Error) => {
                                ErrorService.log(
                                    'AlertService.sendInvestigationNoteToSubscribers',
                                    error
                                );
                            });
                        }
                        noteResponse.push(incident);
                    }
                }
            }

            return {
                status: 'success',
                notes_addedTo: noteResponse.map((res: $TSFixMe) => {
                    return res.idNumber;
                }),
            };
        }

        if (
            incomingRequest &&
            incomingRequest.enabled &&
            (incomingRequest.acknowledgeIncident ||
                incomingRequest.resolveIncident)
        ) {
            let subProjectIds: $TSFixMe = [];

            const subProjects: $TSFixMe = await ProjectService.findBy({
                query: {
                    parentProjectId:
                        incomingRequest.projectId._id ||
                        incomingRequest.projectId,
                },
                select: '_id',
            });
            if (subProjects && subProjects.length > 0) {
                subProjectIds = subProjects.map((project: $TSFixMe) => {
                    return project._id;
                });
            }
            subProjectIds.push(incomingRequest.projectId);

            const resolveResponse: $TSFixMe = [],
                acknowledgeResponse: $TSFixMe = [],
                resolvedIncidents: $TSFixMe = [],
                acknowledgedIncidents: $TSFixMe = [];

            let incidentQuery: $TSFixMe = {};
            if (incomingRequest.resolveIncident) {
                incidentQuery = { resolvedAt: { $exists: false } };
            }
            if (incomingRequest.acknowledgeIncident) {
                incidentQuery = {
                    acknowledgedAt: { $exists: false },
                };
            }

            let incidents: $TSFixMe = [],
                updatedFilters: $TSFixMe = [];
            const populate: $TSFixMe = [
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
            const select: $TSFixMe =
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
                updatedFilters = filters.map((filter: $TSFixMe) => {
                    if (filter.filterText) {
                        const dataConfig: $TSFixMe = {
                            request: data.request,
                        };
                        filter.filterText = analyseVariable(
                            filter.filterText,
                            dataConfig
                        );
                    }
                    return filter;
                });

                const incidentArray: $TSFixMe = [];
                for (const filter of updatedFilters) {
                    const filterCriteria: $TSFixMe = filter.filterCriteria,
                        filterCondition: $TSFixMe = filter.filterCondition,
                        filterText: $TSFixMe = filter.filterText;

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

                        let incidents: $TSFixMe = [];
                        if (filterCondition === 'equalTo') {
                            if (data.incidentId) {
                                incidents = await IncidentService.findBy({
                                    query: {
                                        projectId: { $in: subProjectIds }, // Handle for both project and subProjects
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
                                        projectId: { $in: subProjectIds }, // Handle for both project and subProjects
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
                                        projectId: { $in: subProjectIds }, // Handle for both project and subProjects
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
                                        projectId: { $in: subProjectIds }, // Handle for both project and subProjects
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
                            /*
                             * Handle the case when filterText is a number
                             * (<, >, <= and >=) will only apply to numeric filterText value with respect to variable array
                             */
                            data.fieldValue = Number(filterText);
                            if (filterCondition === 'lessThan') {
                                if (
                                    data.incidentId &&
                                    filterCriteria === 'incidentId'
                                ) {
                                    incidents = await IncidentService.findBy({
                                        query: {
                                            projectId: {
                                                $in: subProjectIds,
                                            }, // Handle for both project and subProjects
                                            idNumber: {
                                                $lt: data.incidentId,
                                            },
                                            ...incidentQuery,
                                        },
                                        select,
                                        populate,
                                    });
                                }

                                if (data.fieldName && data.fieldValue) {
                                    incidents = await IncidentService.findBy({
                                        query: {
                                            projectId: {
                                                $in: subProjectIds,
                                            }, // Handle for both project and subProjects
                                            'customFields.fieldName':
                                                data.fieldName,
                                            'customFields.fieldValue': {
                                                $lt: data.fieldValue,
                                            },
                                            ...incidentQuery,
                                        },
                                        select,
                                        populate,
                                    });
                                }
                            } else if (filterCondition === 'greaterThan') {
                                if (
                                    data.incidentId &&
                                    filterCriteria === 'incidentId'
                                ) {
                                    incidents = await IncidentService.findBy({
                                        query: {
                                            projectId: {
                                                $in: subProjectIds,
                                            }, // Handle for both project and subProjects
                                            idNumber: {
                                                $gt: data.incidentId,
                                            },
                                            ...incidentQuery,
                                        },
                                        select,
                                        populate,
                                    });
                                }

                                if (data.fieldName && data.fieldValue) {
                                    incidents = await IncidentService.findBy({
                                        query: {
                                            projectId: {
                                                $in: subProjectIds,
                                            }, // Handle for both project and subProjects
                                            'customFields.fieldName':
                                                data.fieldName,
                                            'customFields.fieldValue': {
                                                $gt: data.fieldValue,
                                            },
                                            ...incidentQuery,
                                        },
                                        select,
                                        populate,
                                    });
                                }
                            } else if (
                                filterCondition === 'lessThanOrEqualTo'
                            ) {
                                if (
                                    data.incidentId &&
                                    filterCriteria === 'incidentId'
                                ) {
                                    incidents = await IncidentService.findBy({
                                        query: {
                                            projectId: {
                                                $in: subProjectIds,
                                            }, // Handle for both project and subProjects
                                            idNumber: {
                                                $lte: data.incidentId,
                                            },
                                            ...incidentQuery,
                                        },
                                        select,
                                        populate,
                                    });
                                }

                                if (data.fieldName && data.fieldValue) {
                                    incidents = await IncidentService.findBy({
                                        query: {
                                            projectId: {
                                                $in: subProjectIds,
                                            }, // Handle for both project and subProjects
                                            'customFields.fieldName':
                                                data.fieldName,
                                            'customFields.fieldValue': {
                                                $lte: data.fieldValue,
                                            },
                                            ...incidentQuery,
                                        },
                                        select,
                                        populate,
                                    });
                                }
                            } else if (
                                filterCondition === 'greaterThanOrEqualTo'
                            ) {
                                if (data.incidentId) {
                                    incidents = await IncidentService.findBy({
                                        query: {
                                            projectId: {
                                                $in: subProjectIds,
                                            }, // Handle for both project and subProjects
                                            idNumber: {
                                                $gte: data.incidentId,
                                            },
                                            ...incidentQuery,
                                        },
                                        select,
                                        populate,
                                    });
                                }

                                if (data.fieldName && data.fieldValue) {
                                    incidents = await IncidentService.findBy({
                                        query: {
                                            projectId: {
                                                $in: subProjectIds,
                                            }, // Handle for both project and subProjects
                                            'customFields.fieldName':
                                                data.fieldName,
                                            'customFields.fieldValue': {
                                                $gte: data.fieldValue,
                                            },
                                            ...incidentQuery,
                                        },
                                        select,
                                        populate,
                                    });
                                }
                            }
                        }

                        incidentArray.push(...incidents);
                    }
                }

                incidents = incidentArray;
            }

            // Only have unique incidents
            const filtered: $TSFixMe = [];
            incidents = incidents.filter((incident: $TSFixMe) => {
                if (filtered.indexOf(String(incident._id)) < 0) {
                    filtered.push(String(incident._id));
                    return true;
                }
                return false;
            });

            if (filters || filters.length > 0) {
                const newIncidentList: $TSFixMe = [];
                incidents.forEach((incident: $TSFixMe) => {
                    let matchedFields: $TSFixMe = 0;
                    const incidentCustomFields: $TSFixMe =
                        incident.customFields || [];
                    // Automatically create incident id custom field
                    incidentCustomFields.push({
                        fieldName: 'incidentId',
                        fieldValue: String(incident.idNumber),
                        fieldType: 'string',
                    });

                    updatedFilters.forEach((filter: $TSFixMe) => {
                        for (const field of incidentCustomFields) {
                            const filterCriteria: $TSFixMe =
                                    filter.filterCriteria,
                                filterCondition: $TSFixMe =
                                    filter.filterCondition,
                                filterText: $TSFixMe = filter.filterText;

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
                                        field.fieldValue === filter.filterText
                                    ) {
                                        matchedFields += 1;
                                        break;
                                    }
                                }

                                if (filterCondition === 'notEqualTo') {
                                    if (
                                        field.fieldName === filterCriteria &&
                                        field.fieldValue !== filterText
                                    ) {
                                        matchedFields += 1;
                                        break;
                                    }
                                }

                                if (!isNaN(parseFloat(filterText))) {
                                    /*
                                     * Handle the case when filterText is a number
                                     * (<, >, <= and >=) will only apply to numeric filterText value with respect to variable array
                                     */
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
                                        filterCondition === 'lessThanOrEqualTo'
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
                    } else if (matchedFields > 0) {
                        newIncidentList.push(incident);
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
                            const incidentData: $TSFixMe =
                                await IncidentService.acknowledge(
                                    incident._id,
                                    null,
                                    null,
                                    null,
                                    null,
                                    incomingRequest
                                );
                            acknowledgeResponse.push(incidentData);
                            acknowledgedIncidents.push(String(incident._id));
                        } else {
                            const incidentData: $TSFixMe =
                                await IncidentService.acknowledge(
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
                        if (!resolvedIncidents.includes(String(incident._id))) {
                            const incidentData: $TSFixMe =
                                await IncidentService.resolve(
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
                            const incidentData: $TSFixMe =
                                await IncidentService.resolve(
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
                    resolved_incidents: resolveResponse.map((res: $TSFixMe) => {
                        return res.idNumber;
                    }),
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
                        (res: $TSFixMe) => {
                            return res.idNumber;
                        }
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
    }
}

/**
 * @description checks if an array contains duplicate values
 * @param {array} myArray the array to be checked
 * @returns {boolean} true or false
 */
function isArrayUnique(myArray: $TSFixMe): void {
    return myArray.length === new Set(myArray).size;
}

/**
 * @description transforms a template variable into an actual value
 * @param {string} variable template like string eg: {{request.body.name}}
 * @param {object} data an object containing the key-value pairs to work with
 */

/*
 * If for example request.body.name is passed without the double curly braces,
 * It should work as expected and return the value
 */
function analyseVariable(variable: $TSFixMe, data: $TSFixMe): void {
    try {
        const matchRegex: $TSFixMe = /[^{{]+(?=}\})/g;
        const replaceRegex: $TSFixMe = /\{\{([^}]+)\}\}/g;

        const matched: $TSFixMe = variable.match(matchRegex);
        if (!matched || matched.length === 0) {
            // Handles the part where variable is passed without double curly braces
            return variable;
        }

        let ctx: $TSFixMe = Object.create(null); // Fix against prototype vulnerability
        ctx = { ...data };

        const processedValues: $TSFixMe = matched.map((item: $TSFixMe) => {
            return vm.runInNewContext(item, ctx);
        });

        if (!processedValues || processedValues.length === 0) {
            /*
             * Empty value means that the probable value(s) are not available in the data object
             * Therefore return the original variable back
             */
            return variable;
        }

        // Remove any double currly braces from variable
        variable = variable.replace(replaceRegex, (match: $TSFixMe): void => {
            match = match.slice(2, -2);
            return match;
        });

        // Replace variable with processedValues
        let currentValue: $TSFixMe = variable;
        matched.forEach((item: $TSFixMe, index: $TSFixMe) => {
            currentValue = currentValue.replace(item, processedValues[index]);
        });

        return currentValue;
    } catch (error) {
        /*
         * At this point it was unable to resolve this
         * Return the variable back
         */
        return variable;
    }
}
