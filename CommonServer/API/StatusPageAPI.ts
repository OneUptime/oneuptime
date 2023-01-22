import ObjectID from 'Common/Types/ObjectID';
import StatusPage from 'Model/Models/StatusPage';
import UserMiddleware from '../Middleware/UserAuthorization';
import StatusPageService, {
    Service as StatusPageServiceType,
} from '../Services/StatusPageService';
import Populate from '../Types/Database/Populate';
import Select from '../Types/Database/Select';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from '../Utils/Express';
import BaseAPI from './BaseAPI';
import Response from '../Utils/Response';
import NotAuthorizedException from 'Common/Types/Exception/NotAuthorizedException';
import BadDataException from 'Common/Types/Exception/BadDataException';
import StatusPageFooterLinkService from '../Services/StatusPageFooterLinkService';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import StatusPageFooterLink from 'Model/Models/StatusPageFooterLink';
import StatusPageHeaderLinkService from '../Services/StatusPageHeaderLinkService';
import StatusPageHeaderLink from 'Model/Models/StatusPageHeaderLink';
import StatusPageDomain from 'Model/Models/StatusPageDomain';
import StatusPageDomainService from '../Services/StatusPageDomainService';
import { JSONObject } from 'Common/Types/JSON';
import StatusPageGroup from 'Model/Models/StatusPageGroup';
import StatusPageGroupService from '../Services/StatusPageGroupService';
import StatusPageResource from 'Model/Models/StatusPageResource';
import StatusPageResourceService from '../Services/StatusPageResourceService';
import MonitorStatusService from '../Services/MonitorStatusService';
import OneUptimeDate from 'Common/Types/Date';
import MonitorStatusTimelineService from '../Services/MonitorStatusTimelineService';
import QueryHelper from '../Types/Database/QueryHelper';
import SortOrder from 'Common/Types/Database/SortOrder';
import IncidentService from '../Services/IncidentService';
import IncidentPublicNote from 'Model/Models/IncidentPublicNote';
import IncidentPublicNoteService from '../Services/IncidentPublicNoteService';
import StatusPageAnnouncementService from '../Services/StatusPageAnnouncementService';
import ScheduledMaintenanceService from '../Services/ScheduledMaintenanceService';
import ScheduledMaintenancePublicNoteService from '../Services/ScheduledMaintenancePublicNoteService';
import ScheduledMaintenancePublicNote from 'Model/Models/ScheduledMaintenancePublicNote';
import MonitorStatus from 'Model/Models/MonitorStatus';
import MonitorStatusTimeline from 'Model/Models/MonitorStatusTimeline';
import Incident from 'Model/Models/Incident';
import StatusPageAnnouncement from 'Model/Models/StatusPageAnnouncement';
import ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';
import IncidentStateTimeline from 'Model/Models/IncidentStateTimeline';
import IncidentStateTimelineService from '../Services/IncidentStateTimelineService';
import ScheduledMaintenanceStateTimeline from 'Model/Models/ScheduledMaintenanceStateTimeline';
import ScheduledMaintenanceStateTimelineService from '../Services/ScheduledMaintenanceStateTimelineService';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import Query from '../Types/Database/Query';
import JSONFunctions from 'Common/Types/JSONFunctions';
import GreenlockChallenge from 'Model/Models/GreenlockChallenge';
import GreenlockChallengeService from '../Services/GreenlockChallengeService';
import NotFoundException from 'Common/Types/Exception/NotFoundException';
import logger from '../Utils/Logger';

export default class StatusPageAPI extends BaseAPI<
    StatusPage,
    StatusPageServiceType
> {
    public constructor() {
        super(StatusPage, StatusPageService);

        // CNAME verification api
        this.router.get(
            `${new this.entityType()
                .getCrudApiPath()
                ?.toString()}/status-page-api/cname-verification/:token`,
            async (req: ExpressRequest, res: ExpressResponse) => {
                const host: string | undefined = req.get('host');

                if (!host) {
                    throw new BadDataException('Host not found');
                }

                const token: string = req.params['token'] as string;

                logger.info(
                    `CNAME Verification: Host:${host}  - Token:${token}`
                );

                const domain: StatusPageDomain | null =
                    await StatusPageDomainService.findOneBy({
                        query: {
                            cnameVerificationToken: token,
                            fullDomain: host,
                        },
                        select: {
                            _id: true,
                        },
                        props: {
                            isRoot: true,
                        },
                    });

                if (!domain) {
                    return Response.sendErrorResponse(
                        req,
                        res,
                        new BadDataException('Invalid token.')
                    );
                }

                return Response.sendEmptyResponse(req, res);
            }
        );

        // ACME Challenge Validation.
        this.router.get(
            `${new this.entityType()
                .getCrudApiPath()
                ?.toString()}/.well-known/acme-challenge/:token`,
            async (req: ExpressRequest, res: ExpressResponse) => {
                const challenge: GreenlockChallenge | null =
                    await GreenlockChallengeService.findOneBy({
                        query: {
                            token: req.params['token'] as string,
                        },
                        select: {
                            challenge: true,
                        },
                        props: {
                            isRoot: true,
                        },
                    });

                if (!challenge) {
                    return Response.sendErrorResponse(
                        req,
                        res,
                        new NotFoundException('Challenge not found')
                    );
                }

                return Response.sendTextResponse(
                    req,
                    res,
                    challenge.challenge as string
                );
            }
        );

        this.router.post(
            `${new this.entityType().getCrudApiPath()?.toString()}/domain`,
            UserMiddleware.getUserMiddleware,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    if (!req.body['domain']) {
                        throw new BadDataException(
                            'domain is required in request body'
                        );
                    }

                    const domain: string = req.body['domain'] as string;

                    const statusPageDomain: StatusPageDomain | null =
                        await StatusPageDomainService.findOneBy({
                            query: {
                                fullDomain: domain,
                                domain: {
                                    isVerified: true,
                                } as any,
                            },
                            select: {
                                statusPageId: true,
                            },
                            props: {
                                isRoot: true,
                            },
                        });

                    if (!statusPageDomain) {
                        throw new BadDataException(
                            'No status page found with this domain'
                        );
                    }

                    const objectId: ObjectID = statusPageDomain.statusPageId!;

                    return Response.sendJsonObjectResponse(req, res, {
                        statusPageId: objectId.toString(),
                    });
                } catch (err) {
                    next(err);
                }
            }
        );

        this.router.post(
            `${new this.entityType()
                .getCrudApiPath()
                ?.toString()}/master-page/:statusPageId`,
            UserMiddleware.getUserMiddleware,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    const objectId: ObjectID = new ObjectID(
                        req.params['statusPageId'] as string
                    );

                    const select: Select<StatusPage> = {
                        _id: true,
                        slug: true,
                        coverImageFileId: true,
                        logoFileId: true,
                        showAnouncementsPage: true,
                        showFooter: true,
                        showHeader: true,
                        showIncidentsPage: true,
                        showNavbar: true,
                        showOverviewPage: true,
                        showRssPage: true,
                        showScheduledMaintenancePage: true,
                        pageTextColor: true,
                        footerTextColor: true,
                        headerTextColor: true,
                        navBarTextColor: true,
                        pageTitle: true,
                        pageDescription: true,
                        pageBackgroundColor: true,
                        bannerBackgroundColor: true,
                        footerBackgroundColor: true,
                        headerBackgroundColor: true,
                        navBarBackgroundColor: true,
                        copyrightText: true,
                        customCSS: true,
                        customJavaScript: true,
                        headerHTML: true,
                        footerHTML: true,
                        enableSubscribers: true,
                        isPublicStatusPage: true,
                    };

                    const populate: Populate<StatusPage> = {
                        coverImageFile: {
                            file: true as any,
                            _id: true,
                            type: true,
                            name: true,
                        } as any,
                        faviconFile: {
                            file: true as any,
                            _id: true,
                            type: true,
                            name: true,
                        } as any,
                        logoFile: {
                            file: true as any,
                            _id: true,
                            type: true,
                            name: true,
                        } as any,
                    };

                    const item: StatusPage | null =
                        await this.service.findOneById({
                            id: objectId,
                            select,
                            populate,
                            props: {
                                isRoot: true,
                            },
                        });

                    if (!item) {
                        throw new BadDataException('Status Page not found');
                    }

                    const footerLinks: Array<StatusPageFooterLink> =
                        await StatusPageFooterLinkService.findBy({
                            query: {
                                statusPageId: objectId,
                            },
                            select: {
                                _id: true,
                                link: true,
                                title: true,
                            },
                            populate: {},
                            limit: LIMIT_PER_PROJECT,
                            skip: 0,
                            props: {
                                isRoot: true,
                            },
                        });

                    const headerLinks: Array<StatusPageHeaderLink> =
                        await StatusPageHeaderLinkService.findBy({
                            query: {
                                statusPageId: objectId,
                            },
                            select: {
                                _id: true,
                                link: true,
                                title: true,
                            },
                            limit: LIMIT_PER_PROJECT,
                            skip: 0,
                            props: {
                                isRoot: true,
                            },
                        });

                    const response: JSONObject = {
                        statusPage: JSONFunctions.toJSON(item, StatusPage),
                        footerLinks: JSONFunctions.toJSONArray(
                            footerLinks,
                            StatusPageFooterLink
                        ),
                        headerLinks: JSONFunctions.toJSONArray(
                            headerLinks,
                            StatusPageHeaderLink
                        ),
                    };

                    return Response.sendJsonObjectResponse(req, res, response);
                } catch (err) {
                    next(err);
                }
            }
        );

        this.router.post(
            `${new this.entityType()
                .getCrudApiPath()
                ?.toString()}/overview/:statusPageId`,
            UserMiddleware.getUserMiddleware,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    const objectId: ObjectID = new ObjectID(
                        req.params['statusPageId'] as string
                    );

                    if (
                        !(await this.service.hasReadAccess(
                            objectId,
                            await this.getDatabaseCommonInteractionProps(req),
                            req
                        ))
                    ) {
                        throw new NotAuthorizedException(
                            'You are not authorize to access this status page'
                        );
                    }

                    const statusPage: StatusPage | null =
                        await StatusPageService.findOneBy({
                            query: {
                                _id: objectId.toString(),
                            },
                            select: {
                                _id: true,
                                projectId: true,
                                isPublicStatusPage: true,
                            },
                            props: {
                                isRoot: true,
                            },
                        });

                    if (!statusPage) {
                        throw new BadDataException('Status Page not found');
                    }

                    //get monitor statuses

                    const monitorStatuses: Array<MonitorStatus> =
                        await MonitorStatusService.findBy({
                            query: {
                                projectId: statusPage.projectId!,
                            },
                            select: {
                                name: true,
                                color: true,
                                priority: true,
                                isOperationalState: true,
                            },
                            sort: {
                                priority: SortOrder.Ascending,
                            },
                            skip: 0,
                            limit: LIMIT_PER_PROJECT,
                            props: {
                                isRoot: true,
                            },
                        });

                    // get resource groups.

                    const groups: Array<StatusPageGroup> =
                        await StatusPageGroupService.findBy({
                            query: {
                                statusPageId: objectId,
                            },
                            select: {
                                name: true,
                                order: true,
                                description: true,
                                isExpandedByDefault: true,
                            },
                            sort: {
                                order: SortOrder.Ascending,
                            },
                            skip: 0,
                            limit: LIMIT_PER_PROJECT,
                            props: {
                                isRoot: true,
                            },
                        });

                    // get monitors on status page.
                    const statusPageResources: Array<StatusPageResource> =
                        await StatusPageResourceService.findBy({
                            query: {
                                statusPageId: objectId,
                            },
                            select: {
                                statusPageGroupId: true,
                                monitorId: true,
                                displayTooltip: true,
                                displayDescription: true,
                                displayName: true,
                                showStatusHistoryChart: true,
                                showCurrentStatus: true,
                            },
                            populate: {
                                monitor: {
                                    _id: true,
                                    currentMonitorStatusId: true,
                                },
                            },
                            skip: 0,
                            limit: LIMIT_PER_PROJECT,
                            props: {
                                isRoot: true,
                            },
                        });

                    // get monitor status charts.
                    const monitorsOnStatusPage: Array<ObjectID> =
                        statusPageResources.map(
                            (monitor: StatusPageResource) => {
                                return monitor.monitorId!;
                            }
                        );

                    const monitorsOnStatusPageForTimeline: Array<ObjectID> =
                        statusPageResources
                            .filter((monitor: StatusPageResource) => {
                                return monitor.showStatusHistoryChart;
                            })
                            .map((monitor: StatusPageResource) => {
                                return monitor.monitorId!;
                            });

                    const startDate: Date = OneUptimeDate.getSomeDaysAgo(90);
                    const endDate: Date = OneUptimeDate.getCurrentDate();

                    let monitorStatusTimelines: Array<MonitorStatusTimeline> =
                        [];

                    if (monitorsOnStatusPageForTimeline.length > 0) {
                        monitorStatusTimelines =
                            await MonitorStatusTimelineService.findBy({
                                query: {
                                    monitorId: QueryHelper.in(
                                        monitorsOnStatusPageForTimeline
                                    ),
                                    createdAt: QueryHelper.inBetween(
                                        startDate,
                                        endDate
                                    ),
                                },
                                select: {
                                    monitorId: true,
                                    createdAt: true,
                                },
                                sort: {
                                    createdAt: SortOrder.Ascending,
                                },
                                populate: {
                                    monitorStatus: {
                                        name: true,
                                        color: true,
                                        priority: true,
                                    },
                                },
                                skip: 0,
                                limit: LIMIT_PER_PROJECT,
                                props: {
                                    isRoot: true,
                                },
                            });
                    }

                    // check if status page has active incident.
                    let activeIncidents: Array<Incident> = [];
                    if (monitorsOnStatusPage.length > 0) {
                        activeIncidents = await IncidentService.findBy({
                            query: {
                                monitors: monitorsOnStatusPage as any,
                                currentIncidentState: {
                                    isResolvedState: false,
                                } as any,
                                projectId: statusPage.projectId!,
                            },
                            select: {
                                createdAt: true,
                                title: true,
                                description: true,
                                _id: true,
                            },
                            sort: {
                                createdAt: SortOrder.Ascending,
                            },
                            populate: {
                                incidentSeverity: {
                                    name: true,
                                    color: true,
                                },
                                currentIncidentState: {
                                    name: true,
                                    color: true,
                                },
                                monitors: {
                                    _id: true,
                                },
                            },
                            skip: 0,
                            limit: LIMIT_PER_PROJECT,
                            props: {
                                isRoot: true,
                            },
                        });
                    }

                    const incidentsOnStausPage: Array<ObjectID> =
                        activeIncidents.map((incident: Incident) => {
                            return incident.id!;
                        });

                    let incidentPublicNotes: Array<IncidentPublicNote> = [];

                    if (incidentsOnStausPage.length > 0) {
                        incidentPublicNotes =
                            await IncidentPublicNoteService.findBy({
                                query: {
                                    incidentId:
                                        QueryHelper.in(incidentsOnStausPage),
                                    projectId: statusPage.projectId!,
                                },
                                select: {
                                    note: true,
                                    incidentId: true,
                                },
                                sort: {
                                    createdAt: SortOrder.Descending, // new note first
                                },
                                skip: 0,
                                limit: LIMIT_PER_PROJECT,
                                props: {
                                    isRoot: true,
                                },
                            });
                    }

                    let incidentStateTimelines: Array<IncidentStateTimeline> =
                        [];

                    if (incidentsOnStausPage.length > 0) {
                        incidentStateTimelines =
                            await IncidentStateTimelineService.findBy({
                                query: {
                                    incidentId:
                                        QueryHelper.in(incidentsOnStausPage),
                                    projectId: statusPage.projectId!,
                                },
                                select: {
                                    _id: true,
                                    createdAt: true,
                                    incidentId: true,
                                },
                                populate: {
                                    incidentState: {
                                        _id: true,
                                        name: true,
                                        color: true,
                                        isCreatedState: true,
                                        isResolvedState: true,
                                        isAcknowledgedState: true,
                                    },
                                },
                                sort: {
                                    createdAt: SortOrder.Descending, // new note first
                                },
                                skip: 0,
                                limit: LIMIT_PER_PROJECT,
                                props: {
                                    isRoot: true,
                                },
                            });
                    }

                    // check if status page has actuve announcement.

                    const today: Date = OneUptimeDate.getCurrentDate();

                    const activeAnnouncements: Array<StatusPageAnnouncement> =
                        await StatusPageAnnouncementService.findBy({
                            query: {
                                statusPages: objectId as any,
                                showAnnouncementAt: QueryHelper.lessThan(today),
                                endAnnouncementAt:
                                    QueryHelper.greaterThan(today),
                                projectId: statusPage.projectId!,
                            },
                            select: {
                                createdAt: true,
                                title: true,
                                description: true,
                                _id: true,
                            },
                            skip: 0,
                            limit: LIMIT_PER_PROJECT,
                            props: {
                                isRoot: true,
                            },
                        });

                    // check if status page has active scheduled events.

                    const scheduledMaintenanceEvents: Array<ScheduledMaintenance> =
                        await ScheduledMaintenanceService.findBy({
                            query: {
                                currentScheduledMaintenanceState: {
                                    isOngoingState: true,
                                } as any,
                                statusPages: objectId as any,
                                projectId: statusPage.projectId!,
                            },
                            select: {
                                createdAt: true,
                                title: true,
                                description: true,
                                _id: true,
                                endsAt: true,
                            },
                            sort: {
                                createdAt: SortOrder.Ascending,
                            },
                            populate: {
                                currentScheduledMaintenanceState: {
                                    name: true,
                                    color: true,
                                    isScheduledState: true,
                                    isResolvedState: true,
                                    isOngoingState: true,
                                },
                                monitors: {
                                    _id: true,
                                },
                            },
                            skip: 0,
                            limit: LIMIT_PER_PROJECT,
                            props: {
                                isRoot: true,
                            },
                        });

                    const futureScheduledMaintenanceEvents: Array<ScheduledMaintenance> =
                        await ScheduledMaintenanceService.findBy({
                            query: {
                                currentScheduledMaintenanceState: {
                                    isScheduledState: true,
                                } as any,
                                statusPages: objectId as any,
                                projectId: statusPage.projectId!,
                            },
                            select: {
                                createdAt: true,
                                title: true,
                                description: true,
                                _id: true,
                                endsAt: true,
                                startsAt: true,
                            },
                            sort: {
                                createdAt: SortOrder.Ascending,
                            },
                            populate: {
                                currentScheduledMaintenanceState: {
                                    name: true,
                                    color: true,
                                    isScheduledState: true,
                                    isResolvedState: true,
                                    isOngoingState: true,
                                },
                                monitors: {
                                    _id: true,
                                },
                            },
                            skip: 0,
                            limit: LIMIT_PER_PROJECT,
                            props: {
                                isRoot: true,
                            },
                        });

                    futureScheduledMaintenanceEvents.forEach(
                        (event: ScheduledMaintenance) => {
                            scheduledMaintenanceEvents.push(event);
                        }
                    );

                    const scheduledMaintenanceEventsOnStausPage: Array<ObjectID> =
                        scheduledMaintenanceEvents.map(
                            (event: ScheduledMaintenance) => {
                                return event.id!;
                            }
                        );

                    let scheduledMaintenanceEventsPublicNotes: Array<ScheduledMaintenancePublicNote> =
                        [];

                    if (scheduledMaintenanceEventsOnStausPage.length > 0) {
                        scheduledMaintenanceEventsPublicNotes =
                            await ScheduledMaintenancePublicNoteService.findBy({
                                query: {
                                    scheduledMaintenanceId: QueryHelper.in(
                                        scheduledMaintenanceEventsOnStausPage
                                    ),
                                    projectId: statusPage.projectId!,
                                },
                                select: {
                                    note: true,
                                    scheduledMaintenanceId: true,
                                },
                                sort: {
                                    createdAt: SortOrder.Ascending,
                                },
                                skip: 0,
                                limit: LIMIT_PER_PROJECT,
                                props: {
                                    isRoot: true,
                                },
                            });
                    }

                    let scheduledMaintenanceStateTimelines: Array<ScheduledMaintenanceStateTimeline> =
                        [];

                    if (scheduledMaintenanceEventsOnStausPage.length > 0) {
                        scheduledMaintenanceStateTimelines =
                            await ScheduledMaintenanceStateTimelineService.findBy(
                                {
                                    query: {
                                        scheduledMaintenanceId: QueryHelper.in(
                                            scheduledMaintenanceEventsOnStausPage
                                        ),
                                        projectId: statusPage.projectId!,
                                    },
                                    select: {
                                        _id: true,
                                        createdAt: true,
                                        scheduledMaintenanceId: true,
                                    },
                                    populate: {
                                        scheduledMaintenanceState: {
                                            _id: true,
                                            color: true,
                                            name: true,
                                            isScheduledState: true,
                                            isResolvedState: true,
                                            isOngoingState: true,
                                        },
                                    },
                                    sort: {
                                        createdAt: SortOrder.Descending, // new note first
                                    },
                                    skip: 0,
                                    limit: LIMIT_PER_PROJECT,
                                    props: {
                                        isRoot: true,
                                    },
                                }
                            );
                    }

                    const response: JSONObject = {
                        scheduledMaintenanceEventsPublicNotes:
                            JSONFunctions.toJSONArray(
                                scheduledMaintenanceEventsPublicNotes,
                                ScheduledMaintenancePublicNote
                            ),
                        scheduledMaintenanceEvents: JSONFunctions.toJSONArray(
                            scheduledMaintenanceEvents,
                            ScheduledMaintenance
                        ),
                        activeAnnouncements: JSONFunctions.toJSONArray(
                            activeAnnouncements,
                            StatusPageAnnouncement
                        ),
                        incidentPublicNotes: JSONFunctions.toJSONArray(
                            incidentPublicNotes,
                            IncidentPublicNote
                        ),
                        activeIncidents: JSONFunctions.toJSONArray(
                            activeIncidents,
                            Incident
                        ),
                        monitorStatusTimelines: JSONFunctions.toJSONArray(
                            monitorStatusTimelines,
                            MonitorStatusTimeline
                        ),
                        resourceGroups: JSONFunctions.toJSONArray(
                            groups,
                            StatusPageGroup
                        ),
                        monitorStatuses: JSONFunctions.toJSONArray(
                            monitorStatuses,
                            MonitorStatus
                        ),
                        statusPageResources: JSONFunctions.toJSONArray(
                            statusPageResources,
                            StatusPageResource
                        ),
                        incidentStateTimelines: JSONFunctions.toJSONArray(
                            incidentStateTimelines,
                            IncidentStateTimeline
                        ),
                        scheduledMaintenanceStateTimelines:
                            JSONFunctions.toJSONArray(
                                scheduledMaintenanceStateTimelines,
                                ScheduledMaintenanceStateTimeline
                            ),
                    };

                    return Response.sendJsonObjectResponse(req, res, response);
                } catch (err) {
                    next(err);
                }
            }
        );

        this.router.post(
            `${new this.entityType()
                .getCrudApiPath()
                ?.toString()}/incidents/:statusPageId`,
            UserMiddleware.getUserMiddleware,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    const objectId: ObjectID = new ObjectID(
                        req.params['statusPageId'] as string
                    );

                    const response: JSONObject = await this.getIncidents(
                        objectId,
                        null,
                        await this.getDatabaseCommonInteractionProps(req),
                        req
                    );

                    return Response.sendJsonObjectResponse(req, res, response);
                } catch (err) {
                    next(err);
                }
            }
        );

        this.router.post(
            `${new this.entityType()
                .getCrudApiPath()
                ?.toString()}/scheduled-maintenance-events/:statusPageId`,
            UserMiddleware.getUserMiddleware,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    const objectId: ObjectID = new ObjectID(
                        req.params['statusPageId'] as string
                    );

                    const response: JSONObject =
                        await this.getScheduledMaintenanceEvents(
                            objectId,
                            null,
                            await this.getDatabaseCommonInteractionProps(req),
                            req
                        );

                    return Response.sendJsonObjectResponse(req, res, response);
                } catch (err) {
                    next(err);
                }
            }
        );

        this.router.post(
            `${new this.entityType()
                .getCrudApiPath()
                ?.toString()}/announcements/:statusPageId`,
            UserMiddleware.getUserMiddleware,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    const objectId: ObjectID = new ObjectID(
                        req.params['statusPageId'] as string
                    );

                    const response: JSONObject = await this.getAnnouncements(
                        objectId,
                        null,
                        await this.getDatabaseCommonInteractionProps(req),
                        req
                    );

                    return Response.sendJsonObjectResponse(req, res, response);
                } catch (err) {
                    next(err);
                }
            }
        );

        this.router.post(
            `${new this.entityType()
                .getCrudApiPath()
                ?.toString()}/incidents/:statusPageId/:incidentId`,
            UserMiddleware.getUserMiddleware,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    const objectId: ObjectID = new ObjectID(
                        req.params['statusPageId'] as string
                    );

                    const incidentId: ObjectID = new ObjectID(
                        req.params['incidentId'] as string
                    );

                    const response: JSONObject = await this.getIncidents(
                        objectId,
                        incidentId,
                        await this.getDatabaseCommonInteractionProps(req),
                        req
                    );

                    return Response.sendJsonObjectResponse(req, res, response);
                } catch (err) {
                    next(err);
                }
            }
        );

        this.router.post(
            `${new this.entityType()
                .getCrudApiPath()
                ?.toString()}/scheduled-maintenance-events/:statusPageId/:scheduledMaintenanceId`,
            UserMiddleware.getUserMiddleware,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    const objectId: ObjectID = new ObjectID(
                        req.params['statusPageId'] as string
                    );

                    const scheduledMaintenanceId: ObjectID = new ObjectID(
                        req.params['scheduledMaintenanceId'] as string
                    );

                    const response: JSONObject =
                        await this.getScheduledMaintenanceEvents(
                            objectId,
                            scheduledMaintenanceId,
                            await this.getDatabaseCommonInteractionProps(req),
                            req
                        );

                    return Response.sendJsonObjectResponse(req, res, response);
                } catch (err) {
                    next(err);
                }
            }
        );

        this.router.post(
            `${new this.entityType()
                .getCrudApiPath()
                ?.toString()}/announcements/:statusPageId/:announcementId`,
            UserMiddleware.getUserMiddleware,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    const objectId: ObjectID = new ObjectID(
                        req.params['statusPageId'] as string
                    );

                    const announcementId: ObjectID = new ObjectID(
                        req.params['announcementId'] as string
                    );

                    const response: JSONObject = await this.getAnnouncements(
                        objectId,
                        announcementId,
                        await this.getDatabaseCommonInteractionProps(req),
                        req
                    );

                    return Response.sendJsonObjectResponse(req, res, response);
                } catch (err) {
                    next(err);
                }
            }
        );
    }

    public async getScheduledMaintenanceEvents(
        statusPageId: ObjectID,
        scheduledMaintenanceId: ObjectID | null,
        props: DatabaseCommonInteractionProps,
        req: ExpressRequest
    ): Promise<JSONObject> {
        if (!(await this.service.hasReadAccess(statusPageId, props, req))) {
            throw new NotAuthorizedException(
                'You are not authorize to access this status page'
            );
        }

        const statusPage: StatusPage | null = await StatusPageService.findOneBy(
            {
                query: {
                    _id: statusPageId.toString(),
                },
                select: {
                    _id: true,
                    projectId: true,
                },
                props: {
                    isRoot: true,
                },
            }
        );

        if (!statusPage) {
            throw new BadDataException('Status Page not found');
        }

        // get monitors on status page.
        const statusPageResources: Array<StatusPageResource> =
            await StatusPageResourceService.findBy({
                query: {
                    statusPageId: statusPageId,
                },
                select: {
                    statusPageGroupId: true,
                    monitorId: true,
                    displayTooltip: true,
                    displayDescription: true,
                    displayName: true,
                },
                populate: {
                    monitor: {
                        _id: true,
                        currentMonitorStatusId: true,
                    },
                },
                skip: 0,
                limit: LIMIT_PER_PROJECT,
                props: {
                    isRoot: true,
                },
            });

        // check if status page has active scheduled events.
        const today: Date = OneUptimeDate.getCurrentDate();
        const last14Days: Date = OneUptimeDate.getSomeDaysAgo(14);

        let query: Query<ScheduledMaintenance> = {
            startsAt: QueryHelper.inBetween(last14Days, today),
            statusPages: [statusPageId] as any,
            projectId: statusPage.projectId!,
        };

        if (scheduledMaintenanceId) {
            query = {
                _id: scheduledMaintenanceId.toString(),
                statusPages: [statusPageId] as any,
                projectId: statusPage.projectId!,
            };
        }

        const scheduledMaintenanceEvents: Array<ScheduledMaintenance> =
            await ScheduledMaintenanceService.findBy({
                query: query,
                select: {
                    createdAt: true,
                    title: true,
                    description: true,
                    _id: true,
                    endsAt: true,
                    startsAt: true,
                },
                sort: {
                    startsAt: SortOrder.Descending,
                },
                populate: {
                    currentScheduledMaintenanceState: {
                        name: true,
                        color: true,
                        isScheduledState: true,
                        isResolvedState: true,
                        isOngoingState: true,
                    },
                    monitors: {
                        _id: true,
                    },
                },
                skip: 0,
                limit: LIMIT_PER_PROJECT,
                props: {
                    isRoot: true,
                },
            });

        const futureScheduledMaintenanceEvents: Array<ScheduledMaintenance> =
            await ScheduledMaintenanceService.findBy({
                query: {
                    currentScheduledMaintenanceState: {
                        isScheduledState: true,
                    } as any,
                    statusPages: [statusPageId] as any,
                    projectId: statusPage.projectId!,
                },
                select: {
                    createdAt: true,
                    title: true,
                    description: true,
                    _id: true,
                    endsAt: true,
                    startsAt: true,
                },
                sort: {
                    createdAt: SortOrder.Ascending,
                },
                populate: {
                    currentScheduledMaintenanceState: {
                        name: true,
                        color: true,
                        isScheduledState: true,
                        isResolvedState: true,
                        isOngoingState: true,
                    },
                    monitors: {
                        _id: true,
                    },
                },
                skip: 0,
                limit: LIMIT_PER_PROJECT,
                props: {
                    isRoot: true,
                },
            });

        futureScheduledMaintenanceEvents.forEach(
            (event: ScheduledMaintenance) => {
                scheduledMaintenanceEvents.push(event);
            }
        );

        const scheduledMaintenanceEventsOnStausPage: Array<ObjectID> =
            scheduledMaintenanceEvents.map((event: ScheduledMaintenance) => {
                return event.id!;
            });

        let scheduledMaintenanceEventsPublicNotes: Array<ScheduledMaintenancePublicNote> =
            [];

        if (scheduledMaintenanceEventsOnStausPage.length > 0) {
            scheduledMaintenanceEventsPublicNotes =
                await ScheduledMaintenancePublicNoteService.findBy({
                    query: {
                        scheduledMaintenanceId: QueryHelper.in(
                            scheduledMaintenanceEventsOnStausPage
                        ),
                        projectId: statusPage.projectId!,
                    },
                    select: {
                        note: true,
                        scheduledMaintenanceId: true,
                    },
                    sort: {
                        createdAt: SortOrder.Ascending,
                    },
                    skip: 0,
                    limit: LIMIT_PER_PROJECT,
                    props: {
                        isRoot: true,
                    },
                });
        }

        let scheduledMaintenanceStateTimelines: Array<ScheduledMaintenanceStateTimeline> =
            [];

        if (scheduledMaintenanceEventsOnStausPage.length > 0) {
            scheduledMaintenanceStateTimelines =
                await ScheduledMaintenanceStateTimelineService.findBy({
                    query: {
                        scheduledMaintenanceId: QueryHelper.in(
                            scheduledMaintenanceEventsOnStausPage
                        ),
                        projectId: statusPage.projectId!,
                    },
                    select: {
                        _id: true,
                        createdAt: true,
                        scheduledMaintenanceId: true,
                    },
                    populate: {
                        scheduledMaintenanceState: {
                            name: true,
                            color: true,
                            isScheduledState: true,
                            isResolvedState: true,
                            isOngoingState: true,
                        },
                    },
                    sort: {
                        createdAt: SortOrder.Descending, // new note first
                    },
                    skip: 0,
                    limit: LIMIT_PER_PROJECT,
                    props: {
                        isRoot: true,
                    },
                });
        }

        const response: JSONObject = {
            scheduledMaintenanceEventsPublicNotes: JSONFunctions.toJSONArray(
                scheduledMaintenanceEventsPublicNotes,
                ScheduledMaintenancePublicNote
            ),
            scheduledMaintenanceEvents: JSONFunctions.toJSONArray(
                scheduledMaintenanceEvents,
                ScheduledMaintenance
            ),
            statusPageResources: JSONFunctions.toJSONArray(
                statusPageResources,
                StatusPageResource
            ),
            scheduledMaintenanceStateTimelines: JSONFunctions.toJSONArray(
                scheduledMaintenanceStateTimelines,
                ScheduledMaintenanceStateTimeline
            ),
        };

        return response;
    }

    public async getAnnouncements(
        statusPageId: ObjectID,
        announcementId: ObjectID | null,
        props: DatabaseCommonInteractionProps,
        req: ExpressRequest
    ): Promise<JSONObject> {
        if (!(await this.service.hasReadAccess(statusPageId, props, req))) {
            throw new NotAuthorizedException(
                'You are not authorize to access this status page'
            );
        }

        const statusPage: StatusPage | null = await StatusPageService.findOneBy(
            {
                query: {
                    _id: statusPageId.toString(),
                },
                select: {
                    _id: true,
                    projectId: true,
                },
                props: {
                    isRoot: true,
                },
            }
        );

        if (!statusPage) {
            throw new BadDataException('Status Page not found');
        }

        // check if status page has actuve announcement.

        const today: Date = OneUptimeDate.getCurrentDate();
        const last14Days: Date = OneUptimeDate.getSomeDaysAgo(14);

        let query: Query<StatusPageAnnouncement> = {
            statusPages: [statusPageId] as any,
            showAnnouncementAt: QueryHelper.inBetween(last14Days, today),
            projectId: statusPage.projectId!,
        };

        if (announcementId) {
            query = {
                statusPages: [statusPageId] as any,
                _id: announcementId.toString(),
                projectId: statusPage.projectId!,
            };
        }

        const announcements: Array<StatusPageAnnouncement> =
            await StatusPageAnnouncementService.findBy({
                query: query,
                select: {
                    createdAt: true,
                    title: true,
                    description: true,
                    _id: true,
                    showAnnouncementAt: true,
                    endAnnouncementAt: true,
                },
                skip: 0,
                limit: LIMIT_PER_PROJECT,
                props: {
                    isRoot: true,
                },
            });

        // get monitors on status page.
        const statusPageResources: Array<StatusPageResource> =
            await StatusPageResourceService.findBy({
                query: {
                    statusPageId: statusPageId,
                },
                select: {
                    statusPageGroupId: true,
                    monitorId: true,
                    displayTooltip: true,
                    displayDescription: true,
                    displayName: true,
                },
                populate: {
                    monitor: {
                        _id: true,
                        currentMonitorStatusId: true,
                    },
                },
                skip: 0,
                limit: LIMIT_PER_PROJECT,
                props: {
                    isRoot: true,
                },
            });

        const response: JSONObject = {
            announcements: JSONFunctions.toJSONArray(
                announcements,
                StatusPageAnnouncement
            ),
            statusPageResources: JSONFunctions.toJSONArray(
                statusPageResources,
                StatusPageResource
            ),
        };

        return response;
    }

    public async getIncidents(
        statusPageId: ObjectID,
        incidentId: ObjectID | null,
        props: DatabaseCommonInteractionProps,
        req: ExpressRequest
    ): Promise<JSONObject> {
        if (!(await this.service.hasReadAccess(statusPageId, props, req))) {
            throw new NotAuthorizedException(
                'You are not authorize to access this status page'
            );
        }

        const statusPage: StatusPage | null = await StatusPageService.findOneBy(
            {
                query: {
                    _id: statusPageId.toString(),
                },
                select: {
                    _id: true,
                    projectId: true,
                },
                props: {
                    isRoot: true,
                },
            }
        );

        if (!statusPage) {
            throw new BadDataException('Status Page not found');
        }

        // get monitors on status page.
        const statusPageResources: Array<StatusPageResource> =
            await StatusPageResourceService.findBy({
                query: {
                    statusPageId: statusPageId,
                },
                select: {
                    statusPageGroupId: true,
                    monitorId: true,
                    displayTooltip: true,
                    displayDescription: true,
                    displayName: true,
                },
                populate: {
                    monitor: {
                        _id: true,
                        currentMonitorStatusId: true,
                    },
                },
                skip: 0,
                limit: LIMIT_PER_PROJECT,
                props: {
                    isRoot: true,
                },
            });

        // get monitor status charts.
        const monitorsOnStatusPage: Array<ObjectID> = statusPageResources.map(
            (monitor: StatusPageResource) => {
                return monitor.monitorId!;
            }
        );

        const today: Date = OneUptimeDate.getCurrentDate();
        const last14Days: Date = OneUptimeDate.getSomeDaysAgo(14);

        let incidentQuery: Query<Incident> = {
            monitors: monitorsOnStatusPage as any,
            projectId: statusPage.projectId!,
            createdAt: QueryHelper.inBetween(last14Days, today),
        };

        if (incidentId) {
            incidentQuery = {
                monitors: monitorsOnStatusPage as any,
                projectId: statusPage.projectId!,
                _id: incidentId.toString(),
            };
        }

        // check if status page has active incident.
        let incidents: Array<Incident> = [];
        if (monitorsOnStatusPage.length > 0) {
            incidents = await IncidentService.findBy({
                query: incidentQuery,
                select: {
                    createdAt: true,
                    title: true,
                    description: true,
                    _id: true,
                },
                sort: {
                    createdAt: SortOrder.Descending,
                },
                populate: {
                    incidentSeverity: {
                        name: true,
                        color: true,
                    },
                    currentIncidentState: {
                        name: true,
                        color: true,
                    },
                    monitors: {
                        _id: true,
                    },
                },
                skip: 0,
                limit: LIMIT_PER_PROJECT,
                props: {
                    isRoot: true,
                },
            });
        }

        const incidentsOnStausPage: Array<ObjectID> = incidents.map(
            (incident: Incident) => {
                return incident.id!;
            }
        );

        let incidentPublicNotes: Array<IncidentPublicNote> = [];

        if (incidentsOnStausPage.length > 0) {
            incidentPublicNotes = await IncidentPublicNoteService.findBy({
                query: {
                    incidentId: QueryHelper.in(incidentsOnStausPage),
                    projectId: statusPage.projectId!,
                },
                select: {
                    note: true,
                    incidentId: true,
                },
                sort: {
                    createdAt: SortOrder.Descending, // new note first
                },
                skip: 0,
                limit: LIMIT_PER_PROJECT,
                props: {
                    isRoot: true,
                },
            });
        }

        let incidentStateTimelines: Array<IncidentStateTimeline> = [];

        if (incidentsOnStausPage.length > 0) {
            incidentStateTimelines = await IncidentStateTimelineService.findBy({
                query: {
                    incidentId: QueryHelper.in(incidentsOnStausPage),
                    projectId: statusPage.projectId!,
                },
                select: {
                    _id: true,
                    createdAt: true,
                    incidentId: true,
                },
                sort: {
                    createdAt: SortOrder.Descending, // new note first
                },
                populate: {
                    incidentState: {
                        name: true,
                        color: true,
                    },
                },
                skip: 0,
                limit: LIMIT_PER_PROJECT,
                props: {
                    isRoot: true,
                },
            });
        }

        const response: JSONObject = {
            incidentPublicNotes: JSONFunctions.toJSONArray(
                incidentPublicNotes,
                IncidentPublicNote
            ),
            incidents: JSONFunctions.toJSONArray(incidents, Incident),
            statusPageResources: JSONFunctions.toJSONArray(
                statusPageResources,
                StatusPageResource
            ),
            incidentStateTimelines: JSONFunctions.toJSONArray(
                incidentStateTimelines,
                IncidentStateTimeline
            ),
        };

        return response;
    }
}
