import UserNotificationLogTimeline from 'Model/Models/UserNotificationLogTimeline';
import UserNotificationLogTimelineService, {
    Service as UserNotificationLogTimelineServiceType,
} from '../Services/UserNotificationLogTimelineService';
import BaseAPI from './BaseAPI';
import {
    ExpressRequest,
    ExpressResponse,
    OneUptimeRequest,
} from '../Utils/Express';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Response from '../Utils/Response';
import ObjectID from 'Common/Types/ObjectID';
import { JSONObject } from 'Common/Types/JSON';
import NotificationMiddleware from '../Middleware/NotificationMiddleware';
import OneUptimeDate from 'Common/Types/Date';
import URL from 'Common/Types/API/URL';
import { DashboardRoute, Domain, HttpProtocol } from '../Config';

export default class UserNotificationLogTimelineAPI extends BaseAPI<
    UserNotificationLogTimeline,
    UserNotificationLogTimelineServiceType
> {
    public constructor() {
        super(UserNotificationLogTimeline, UserNotificationLogTimelineService);

        this.router.post(
            `/call/gather-input/:itemId`,
            NotificationMiddleware.isValidCallNotificationRequest,
            async (req: ExpressRequest, res: ExpressResponse) => {
                req = req as OneUptimeRequest;

                if (!req.params['itemId']) {
                    return Response.sendErrorResponse(
                        req,
                        res,
                        new BadDataException('Invalid item ID')
                    );
                }

                const token: JSONObject = (req as any).callTokenData;

                const itemId: ObjectID = new ObjectID(req.params['itemId']);

                const timelineItem: UserNotificationLogTimeline | null =
                    await this.service.findOneById({
                        id: itemId,
                        select: {
                            _id: true,
                            projectId: true,
                            triggeredByIncidentId: true,
                        },
                        props: {
                            isRoot: true,
                        },
                    });

                if (!timelineItem) {
                    return Response.sendErrorResponse(
                        req,
                        res,
                        new BadDataException('Invalid item Id')
                    );
                }

                // check digits.

                if (req.body['Digits'] === '1') {
                    // then ack incident
                    await this.service.updateOneById({
                        id: itemId,
                        data: {
                            acknowledgedAt: OneUptimeDate.getCurrentDate(),
                            isAcknowledged: true,
                        },
                        props: {
                            isRoot: true,
                        },
                    });
                }

                return NotificationMiddleware.sendResponse(
                    req,
                    res,
                    token as any
                );
            }
        );

        this.router.post(
            `/acknowledge/:itemId`,
            async (req: ExpressRequest, res: ExpressResponse) => {
                req = req as OneUptimeRequest;

                if (!req.params['itemId']) {
                    return Response.sendErrorResponse(
                        req,
                        res,
                        new BadDataException('Invalid item ID')
                    );
                }

                const itemId: ObjectID = new ObjectID(req.params['itemId']);

                const timelineItem: UserNotificationLogTimeline | null =
                    await this.service.findOneById({
                        id: itemId,
                        select: {
                            _id: true,
                            projectId: true,
                            triggeredByIncidentId: true,
                        },
                        props: {
                            isRoot: true,
                        },
                    });

                if (!timelineItem) {
                    return Response.sendErrorResponse(
                        req,
                        res,
                        new BadDataException('Invalid item Id')
                    );
                }

                await this.service.updateOneById({
                    id: itemId,
                    data: {
                        acknowledgedAt: OneUptimeDate.getCurrentDate(),
                        isAcknowledged: true,
                    },
                    props: {
                        isRoot: true,
                    },
                });

                // redirect to dashboard to incidents page.
                return Response.redirect(
                    req,
                    res,
                    new URL(
                        HttpProtocol,
                        Domain,
                        DashboardRoute.addRoute(
                            `/${timelineItem.projectId?.toString()}/incidents/${timelineItem.triggeredByIncidentId!.toString()}`
                        )
                    )
                );
            }
        );
    }
}
