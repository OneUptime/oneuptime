import axios from 'axios';
import ProjectService from './ProjectService';
import IncidentService from './IncidentService';
import IncidentTimelineService from './IncidentTimelineService';
import MonitorService from './MonitorService';
import ZapierModel from '../Models/zapier';
import IncidentModel from '../Models/incident';
import NotificationService from './NotificationService';
import RealTimeService from './realTimeService';
import IncidentMessageService from './IncidentMessageService';
import IncidentMessageModel from '../Models/incidentMessage';

import FindOneBy from '../Types/DB/FindOneBy';
export default class Service {
    async findBy({ query, select, populate, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }
        query['deleted'] = false;
        const zapierQuery = ZapierModel.find(query).sort(sort).lean();

        zapierQuery.select(select);
        zapierQuery.populate(populate);

        const zap = await zapierQuery;
        return zap;
    }

    async test(projectId: string, apiKey: string) {
        const project = await ProjectService.findOneBy({
            query: { apiKey: apiKey, _id: projectId },
            select: 'name',
        });
        if (project)
            return await Object.assign({}, project, {
                projectName: project.name,
            });
        else {
            const error = new Error(
                'We are not able to authenticate you because your `API Key` or `Project ID` is not valid. Please go to your project settings and retrieve your API key and Project ID.'
            );

            error.code = 400;
            throw error;
        }
    }

    async getIncidents(projectId: string) {
        const zapierResponseArray = [];
        const zapierResponse = {};

        const project = await ProjectService.findOneBy({
            query: { _id: projectId },
            select: 'name _id',
        });

        if (project) {
            zapierResponse.projectName = project.name;

            zapierResponse.projectId = project._id;

            const projects = await ProjectService.findBy({
                query: {
                    $or: [{ _id: projectId }, { parentProjectId: projectId }],
                },
                select: '_id',
            });
            const projectIds = projects.map((project: $TSFixMe) => project._id);
            const findquery = {
                projectId: { $in: projectIds },
                acknowledged: false,
                resolved: false,
            };
            const incidents = await IncidentService.findBy({
                query: findquery,
                select: 'slug _id acknowledgedAt acknowledged acknowledgedBy resolved resolvedBy resolvedAt idNumber internalNote investigationNote createdAt createdById',
                populate: [
                    { path: 'acknowledgedBy', select: 'name' },
                    { path: 'resolvedBy', select: 'name' },
                    { path: 'createdById', select: 'name' },
                ],
            });
            for (const incident of incidents) {
                const monitors = incident.monitors.map(
                    (monitor: $TSFixMe) => monitor.monitorId
                );
                for (const monitor of monitors) {
                    zapierResponseArray.push(
                        await this.mapIncidentToResponse(
                            incident,
                            zapierResponse,
                            null,
                            monitor
                        )
                    );
                }
            }

            return zapierResponseArray;
        } else {
            return [];
        }
    }

    async getIncidentsNotes(projectId: string) {
        const zapierResponseArray: $TSFixMe = [];
        const zapierResponse = {};

        const project = await ProjectService.findOneBy({
            query: { _id: projectId },
            select: 'name _id',
        });

        if (project) {
            zapierResponse.projectName = project.name;

            zapierResponse.projectId = project._id;

            const projects = await ProjectService.findBy({
                query: {
                    $or: [{ _id: projectId }, { parentProjectId: projectId }],
                },
                select: '_id',
            });
            const projectIds = projects.map((project: $TSFixMe) => project._id);
            const findquery = {
                projectId: { $in: projectIds },
            };
            const incidents = await IncidentService.findBy({
                query: findquery,
                select: '_id',
            });
            const incidentIds = incidents.map(
                (incident: $TSFixMe) => incident._id
            );

            const populateIncidentMessage = [
                {
                    path: 'incidentId',
                    select: 'idNumber name slug',
                },
                { path: 'createdById', select: 'name' },
            ];

            const selectIncidentMessage =
                '_id updated postOnStatusPage createdAt content incidentId createdById type incident_state';
            const incidentMessages = await IncidentMessageService.findBy({
                query: { incidentId: { $in: incidentIds } },
                select: selectIncidentMessage,
                populate: populateIncidentMessage,
            });
            await Promise.all(
                incidentMessages.map(async (incidentNote: $TSFixMe) => {
                    zapierResponseArray.push(
                        await this.mapIncidentToResponse(
                            null,
                            zapierResponse,
                            incidentNote
                        )
                    );
                })
            );

            return zapierResponseArray;
        } else {
            return [];
        }
    }

    async createIncidentNote(data: $TSFixMe) {
        const zapierResponse = {};
        const incidentNoteArr: $TSFixMe = [];
        const populateIncidentMessage = [
            {
                path: 'incidentId',
                select: 'idNumber name slug',
            },
            { path: 'createdById', select: 'name' },
        ];

        const selectIncidentMessage =
            '_id updated postOnStatusPage createdAt content incidentId createdById type incident_state';
        await Promise.all(
            data.incidents.map(async (incidentId: $TSFixMe) => {
                let incidentMessage = new IncidentMessageModel();

                incidentMessage.incidentId = incidentId;

                incidentMessage.createdByZapier = true;

                incidentMessage.type = data.type;

                incidentMessage.content = data.content;
                incidentMessage = await incidentMessage.save();
                IncidentService.refreshInterval(incidentId);

                incidentMessage = await IncidentMessageService.findOneBy({
                    query: { _id: incidentMessage._id },
                    select: selectIncidentMessage,
                    populate: populateIncidentMessage,
                });
                // run in the background
                RealTimeService.addIncidentNote(incidentMessage);

                incidentNoteArr.push(incidentMessage);
            })
        );

        zapierResponse.incidentMessage = incidentNoteArr;
        return zapierResponse;
    }

    async getAcknowledgedIncidents(projectId: string) {
        const zapierResponseArray = [];
        const zapierResponse = {};

        const project = await ProjectService.findOneBy({
            query: { _id: projectId },
            select: 'name _id',
        });
        if (project) {
            zapierResponse.projectName = project.name;

            zapierResponse.projectId = project._id;

            const projects = await ProjectService.findBy({
                query: {
                    $or: [{ _id: projectId }, { parentProjectId: projectId }],
                },
                select: '_id',
            });
            const projectIds = projects.map((project: $TSFixMe) => project._id);
            const findquery = {
                projectId: { $in: projectIds },
                acknowledged: true,
                resolved: false,
            };
            const incidents = await IncidentService.findBy({
                query: findquery,
                select: 'slug _id acknowledgedAt acknowledged acknowledgedBy resolved resolvedBy resolvedAt idNumber internalNote investigationNote createdAt createdById',
                populate: [
                    { path: 'acknowledgedBy', select: 'name' },
                    { path: 'resolvedBy', select: 'name' },
                    { path: 'createdById', select: 'name' },
                ],
            });
            for (const incident of incidents) {
                const monitors = incident.monitors.map(
                    (monitor: $TSFixMe) => monitor.monitorId
                );
                for (const monitor of monitors) {
                    zapierResponseArray.push(
                        await this.mapIncidentToResponse(
                            incident,
                            zapierResponse,
                            null,
                            monitor
                        )
                    );
                }
            }

            return zapierResponseArray;
        } else {
            return [];
        }
    }

    async getResolvedIncidents(projectId: string) {
        const zapierResponseArray = [];
        const zapierResponse = {};

        const project = await ProjectService.findOneBy({
            query: { _id: projectId },
            select: 'name _id',
        });
        if (project) {
            zapierResponse.projectName = project.name;

            zapierResponse.projectId = project._id;

            const projects = await ProjectService.findBy({
                query: {
                    $or: [{ _id: projectId }, { parentProjectId: projectId }],
                },
                select: '_id',
            });
            const projectIds = projects.map((project: $TSFixMe) => project._id);
            const findquery = {
                projectId: { $in: projectIds },
                acknowledged: true,
                resolved: true,
            };
            const incidents = await IncidentService.findBy({
                query: findquery,
                select: 'slug _id acknowledgedAt acknowledged acknowledgedBy resolved resolvedBy resolvedAt idNumber internalNote investigationNote createdAt createdById',
                populate: [
                    { path: 'acknowledgedBy', select: 'name' },
                    { path: 'resolvedBy', select: 'name' },
                    { path: 'createdById', select: 'name' },
                ],
            });
            for (const incident of incidents) {
                const monitors = incident.monitors.map(
                    (monitor: $TSFixMe) => monitor.monitorId
                );
                for (const monitor of monitors) {
                    zapierResponseArray.push(
                        await this.mapIncidentToResponse(
                            incident,
                            zapierResponse,
                            null,
                            monitor
                        )
                    );
                }
            }

            return zapierResponseArray;
        } else {
            return [];
        }
    }

    async createIncident(monitors: $TSFixMe) {
        const zapierResponse = {};
        const incidentArr: $TSFixMe = [];
        await Promise.all(
            monitors.map(async (monitor: $TSFixMe) => {
                const monitorObj = await MonitorService.findOneBy({
                    query: { _id: monitor },
                    select: 'name projectId _id',
                    populate: [{ path: 'projectId', select: '_id' }],
                });
                let incident = new IncidentModel();

                incident.projectId = monitorObj.projectId._id;

                incident.monitors = [{ monitorId: monitorObj._id }];

                incident.createdByZapier = true;
                incident = await incident.save();

                await IncidentTimelineService.create({
                    incidentId: incident._id,
                    createdByZapier: true,
                    status: 'created',
                });

                const msg = `A New Incident was created for ${monitorObj.name} by Zapier`;

                NotificationService.create(
                    incident.projectId,
                    msg,
                    null,
                    'warning'
                );

                // run in the background
                RealTimeService.sendCreatedIncident(incident);

                let project = await ProjectService.findOneBy({
                    query: { _id: monitorObj.project._id },
                    select: 'parentProjectId',
                });
                if (project.parentProjectId) {
                    project = await ProjectService.findOneBy({
                        query: {
                            _id:
                                project.parentProjectId._id ||
                                project.parentProjectId,
                        },
                        select: 'name _id',
                    });
                }

                zapierResponse.projectName = project.name;

                zapierResponse.projectId = project._id;
                incidentArr.push(incident);
            })
        );

        zapierResponse.incidents = incidentArr;
        return zapierResponse;
    }

    async acknowledgeLastIncident(monitors: $TSFixMe) {
        const zapierResponse = {};
        const incidentArr: $TSFixMe = [];
        await Promise.all(
            monitors.map(async (monitor: $TSFixMe) => {
                let lastIncident = await IncidentService.findOneBy({
                    query: {
                        'monitors.monitorId': monitor,
                        acknowledged: false,
                    },
                    select: '_id',
                });
                lastIncident = await IncidentService.acknowledge(
                    lastIncident._id,
                    null,
                    'Zapier',
                    null,
                    true
                );
                const monitorObj = await MonitorService.findOneBy({
                    query: { _id: monitor },
                    select: 'projectId',
                    populate: [{ path: 'projectId', select: '_id' }],
                });

                let project = await ProjectService.findOneBy({
                    query: { _id: monitorObj.projectId._id },
                    select: 'parentProjectId',
                });
                if (project.parentProjectId) {
                    project = await ProjectService.findOneBy({
                        query: {
                            _id:
                                project.parentProjectId._id ||
                                project.parentProjectId,
                        },
                        select: 'name _id',
                    });
                }

                zapierResponse.projectName = project.name;

                zapierResponse.projectId = project._id;
                incidentArr.push(lastIncident);
            })
        );

        zapierResponse.incidents = incidentArr;
        return zapierResponse;
    }

    async acknowledgeAllIncidents(monitors: $TSFixMe) {
        const zapierResponse = {};
        let incidentArr: $TSFixMe = [];
        await Promise.all(
            monitors.map(async (monitor: $TSFixMe) => {
                let incidents = await IncidentService.findBy({
                    query: {
                        'monitors.monitorId': monitor,
                        acknowledged: false,
                    },
                    select: '_id',
                });
                incidents = await Promise.all(
                    incidents.map(async (incident: $TSFixMe) => {
                        return await IncidentService.acknowledge(
                            incident._id,
                            null,
                            'Zapier',
                            null,
                            true
                        );
                    })
                );
                const monitorObj = await MonitorService.findOneBy({
                    query: { _id: monitor },
                    select: 'projectId',
                    populate: [{ path: 'projectId', select: '_id' }],
                });

                let project = await ProjectService.findOneBy({
                    query: { _id: monitorObj.projectId._id },
                    select: 'parentProjectId',
                });
                if (project.parentProjectId) {
                    project = await ProjectService.findOneBy({
                        query: {
                            _id:
                                project.parentProjectId._id ||
                                project.parentProjectId,
                        },
                        select: 'name _id',
                    });
                }

                zapierResponse.projectName = project.name;

                zapierResponse.projectId = project._id;
                incidentArr = incidents;
            })
        );

        zapierResponse.incidents = incidentArr;
        return zapierResponse;
    }

    async acknowledgeIncident(incidents: $TSFixMe) {
        const zapierResponse = {};
        const incidentArr: $TSFixMe = [];
        const populate = [
            {
                path: 'monitors.monitorId',
                select: 'name slug componentId projectId type',
                populate: { path: 'componentId', select: 'name slug' },
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
            'slug notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

        await Promise.all(
            incidents.map(async (incident: $TSFixMe) => {
                await IncidentService.acknowledge(
                    incident,
                    null,
                    'Zapier',
                    null,
                    true
                );
                const incidentObj = await IncidentService.findOneBy({
                    query: { _id: incident },
                    select,
                    populate,
                });

                let project = await ProjectService.findOneBy({
                    query: {
                        _id: incidentObj.projectId._id || incidentObj.projectId,
                    },
                    select: 'parentProjectId',
                });
                if (project.parentProjectId) {
                    project = await ProjectService.findOneBy({
                        query: {
                            _id:
                                project.parentProjectId._id ||
                                project.parentProjectId,
                        },
                        select: 'name _id',
                    });
                }

                zapierResponse.projectName = project.name;

                zapierResponse.projectId = project._id;
                incidentArr.push(incidentObj);
            })
        );

        zapierResponse.incidents = incidentArr;
        return zapierResponse;
    }

    async resolveLastIncident(monitors: $TSFixMe) {
        const zapierResponse = {};
        const incidentArr: $TSFixMe = [];
        const populate = [
            {
                path: 'monitors.monitorId',
                select: 'name slug componentId projectId type',
                populate: { path: 'componentId', select: 'name slug' },
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
            'slug notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

        await Promise.all(
            monitors.map(async (monitor: $TSFixMe) => {
                let lastIncident = await IncidentService.findOneBy({
                    query: {
                        'monitors.monitorId': monitor,
                        resolved: false,
                    },
                    select,
                    populate,
                });
                lastIncident = await IncidentService.resolve(
                    lastIncident._id,
                    null,
                    'Zapier',
                    null,
                    true
                );
                const monitorObj = await MonitorService.findOneBy({
                    query: { _id: monitor },
                    select: 'projectId',
                    populate: [{ path: 'projectId', select: '_id' }],
                });

                let project = await ProjectService.findOneBy({
                    query: { _id: monitorObj.projectId._id },
                    select: 'parentProjectId',
                });
                if (project.parentProjectId) {
                    project = await ProjectService.findOneBy({
                        query: {
                            _id:
                                project.parentProjectId._id ||
                                project.parentProjectId,
                        },
                        select: 'name _id',
                    });
                }

                zapierResponse.projectName = project.name;

                zapierResponse.projectId = project._id;
                incidentArr.push(lastIncident);
            })
        );

        zapierResponse.incidents = incidentArr;
        return zapierResponse;
    }

    async resolveAllIncidents(monitors: $TSFixMe) {
        const zapierResponse = {};
        let incidentArr: $TSFixMe = [];
        const populate = [
            {
                path: 'monitors.monitorId',
                select: 'name slug componentId projectId type',
                populate: { path: 'componentId', select: 'name slug' },
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
            'slug notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

        await Promise.all(
            monitors.map(async (monitor: $TSFixMe) => {
                let incidents = await IncidentService.findBy({
                    query: {
                        'monitors.monitorId': monitor,
                        resolved: false,
                    },
                    select,
                    populate,
                });
                incidents = await Promise.all(
                    incidents.map(async (incident: $TSFixMe) => {
                        return await IncidentService.resolve(
                            incident._id,
                            null,
                            'Zapier',
                            null,
                            true
                        );
                    })
                );
                const monitorObj = await MonitorService.findOneBy({
                    query: { _id: monitor },
                    select: 'projectId',
                    populate: [{ path: 'projectId', select: '_id' }],
                });

                let project = await ProjectService.findOneBy({
                    query: { _id: monitorObj.projectId._id },
                    select: 'parentProjectId',
                });
                if (project.parentProjectId) {
                    project = await ProjectService.findOneBy({
                        query: {
                            _id:
                                project.parentProjectId._id ||
                                project.parentProjectId,
                        },
                        select: 'name _id',
                    });
                }

                zapierResponse.projectName = project.name;

                zapierResponse.projectId = project._id;
                incidentArr = incidents;
            })
        );

        zapierResponse.incidents = incidentArr;
        return zapierResponse;
    }

    async resolveIncident(incidents: $TSFixMe) {
        const zapierResponse = {};
        const incidentArr: $TSFixMe = [];
        const populate = [
            {
                path: 'monitors.monitorId',
                select: 'name slug componentId projectId type',
                populate: { path: 'componentId', select: 'name slug' },
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
            'slug notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

        await Promise.all(
            incidents.map(async (incident: $TSFixMe) => {
                await IncidentService.resolve(
                    incident,
                    null,
                    'Zapier',
                    null,
                    true
                );
                const incidentObj = await IncidentService.findOneBy({
                    query: { _id: incident },
                    select,
                    populate,
                });

                let project = await ProjectService.findOneBy({
                    query: {
                        _id: incidentObj.projectId._id || incidentObj.projectId,
                    },
                    select: 'parentProjectId',
                });
                if (project.parentProjectId) {
                    project = await ProjectService.findOneBy({
                        query: {
                            _id:
                                project.parentProjectId._id ||
                                project.parentProjectId,
                        },
                        select: 'name _id',
                    });
                }

                zapierResponse.projectName = project.name;

                zapierResponse.projectId = project._id;
                incidentArr.push(incidentObj);
            })
        );

        zapierResponse.incidents = incidentArr;
        return zapierResponse;
    }

    async mapIncidentToResponse(
        incident: $TSFixMe,
        incidentObj: $TSFixMe,
        incidentNote: $TSFixMe,
        monitor: $TSFixMe
    ) {
        if (incidentNote) {
            incidentObj.content = incidentNote.content;
            incidentObj.incident_state = incidentNote.incident_state;
            incidentObj.type = incidentNote.type;
            incidentObj.createdBy =
                incidentNote.createdById && incidentNote.createdById.name;
            incidentObj.createdAt = incidentNote.createdAt;
            incidentObj.incidentId =
                incidentNote.incidentId && incidentNote.incidentId._id;
            incidentObj.id = incidentNote._id;
        } else {
            if (incident) {
                if (incident.acknowledged) {
                    incidentObj.acknowledgedAt = incident.acknowledgedAt;
                    incidentObj.acknowledgedBy = incident.acknowledgedBy
                        ? incident.acknowledgedBy.name
                        : 'OneUptime';
                }
                if (incident.resolved) {
                    incidentObj.resolvedAt = incident.resolvedAt;
                    incidentObj.resolvedBy = incident.resolvedBy
                        ? incident.resolvedBy.name
                        : 'OneUptime';
                }
                incidentObj.id = incident._id;
                incidentObj.incidentId = incident._id;
                incidentObj.idNumber = incident.idNumber;
                incidentObj.slug = incident.slug;
                incidentObj.acknowledged = incident.acknowledged;
                incidentObj.resolved = incident.resolved;
                incidentObj.internalNote = incident.internalNote;
                incidentObj.investigationNote = incident.investigationNote;
                incidentObj.createdAt = incident.createdAt;
                incidentObj.createdById = incident.createdById
                    ? incident.createdById.name
                    : 'OneUptime';
                // const monitor = await MonitorService.findOneBy({
                //     _id: incident.monitorId,
                // });
                incidentObj.monitorName = monitor.name;
                incidentObj.monitorType = monitor.type;
                incidentObj.monitorData = monitor.data[monitor.type];
            } else {
                return;
            }
        }
        return incidentObj;
    }

    async subscribe(
        projectId: string,
        url: URL,
        type: $TSFixMe,
        monitors: $TSFixMe
    ) {
        const zapier = new ZapierModel();

        zapier.projectId = projectId;

        zapier.url = url;

        zapier.type = type;

        zapier.monitors = monitors;
        const zap = await zapier.save();
        return { id: zap._id };
    }

    async unsubscribe(id: $TSFixMe) {
        await ZapierModel.findOneAndUpdate(
            { _id: id },
            {
                $set: { deleted: true },
            },
            {
                new: true,
            }
        );
        return;
    }

    async pushToZapier(
        type: $TSFixMe,
        incident: $TSFixMe,
        incidentNote: $TSFixMe
    ) {
        const projectId = incident.projectId._id || incident.projectId;

        let project = await ProjectService.findOneBy({
            query: { _id: projectId },
            select: 'parentProjectId _id name',
        });

        let zap = [];
        if (project) {
            if (project.parentProjectId) {
                project = await ProjectService.findOneBy({
                    query: {
                        _id:
                            project.parentProjectId._id ||
                            project.parentProjectId,
                    },
                    select: 'name _id',
                });
            }
            const monitorIds = incident.monitors.map(
                (monitor: $TSFixMe) => monitor.monitorId._id
            );
            zap = await this.findBy({
                query: {
                    projectId: project._id,
                    type: type,
                    // $or: [{ monitors: incident.monitorId._id }, { monitors: [] }],
                    $or: [{ monitors: { $all: monitorIds } }, { monitors: [] }],
                },
                select: 'url',
            });
        }

        if (zap && zap.length) {
            for (const z of zap) {
                let zapierResponse = {};
                if (project) {
                    zapierResponse.projectName = project.name;

                    zapierResponse.projectId = project._id;
                    if (incident) {
                        const monitors = incident.monitors.map(
                            (monitor: $TSFixMe) => monitor.monitorId
                        );
                        for (const monitor of monitors) {
                            zapierResponse = await this.mapIncidentToResponse(
                                incident,
                                zapierResponse,
                                incidentNote,
                                monitor
                            );
                            axios({
                                method: 'POST',
                                url: z.url,
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                                data: JSON.stringify([zapierResponse]),
                            });
                        }
                    }
                }
            }
        }
    }
}
