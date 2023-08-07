import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
    OneUptimeRequest,
} from 'CommonServer/Utils/Express';
import Response from 'CommonServer/Utils/Response';
import ProbeAuthorization from '../Middleware/ProbeAuthorization';
import MonitorProbe from 'Model/Models/MonitorProbe';
import MonitorProbeService from 'CommonServer/Services/MonitorProbeService';
import QueryHelper from 'CommonServer/Types/Database/QueryHelper';
import OneUptimeDate from 'Common/Types/Date';
import { ProbeExpressRequest } from '../Types/Request';
import BadDataException from 'Common/Types/Exception/BadDataException';
import CronTab from 'CommonServer/Utils/CronTab';
import Monitor from 'Model/Models/Monitor';
import PositiveNumber from 'Common/Types/PositiveNumber';
import { JSONObject } from 'Common/Types/JSON';
import SubscriptionStatus from 'Common/Types/Billing/SubscriptionStatus';
import ObjectID from 'Common/Types/ObjectID';
import ClusterKeyAuthorization from 'CommonServer/Middleware/ClusterKeyAuthorization';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import SortOrder from 'Common/Types/Database/SortOrder';
import Query from 'CommonServer/Types/Database/Query';
import JSONFunctions from 'Common/Types/JSONFunctions';

const router: ExpressRouter = Express.getRouter();

const getMonitorFetchQuery: Function = (
    probeId: ObjectID
): Query<MonitorProbe> => {
    const monitorFetchQuery: Query<MonitorProbe> = {
        probeId: probeId,
        isEnabled: true,
        nextPingAt: QueryHelper.lessThanEqualToOrNull(
            OneUptimeDate.getCurrentDate()
        ),
        monitor: {
            disableActiveMonitoring: false, // do not fetch if disabled is true.
        },

        project: {
            // get only active projects
            paymentProviderSubscriptionStatus: QueryHelper.equalToOrNull([
                SubscriptionStatus.Active,
                SubscriptionStatus.Trialing,
            ]),
            paymentProviderMeteredSubscriptionStatus: QueryHelper.equalToOrNull(
                [SubscriptionStatus.Active, SubscriptionStatus.Trialing]
            ),
        },
    };

    return monitorFetchQuery;
};

router.get(
    '/monitor/pending-list/:probeId',
    ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            if (!req.params['probeId']) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadDataException('Probe not found')
                );
            }

            //get list of monitors to be monitored
            const monitorProbes: Array<MonitorProbe> =
                await MonitorProbeService.findBy({
                    query: getMonitorFetchQuery(
                        new ObjectID(req.params['probeId'])
                    ),
                    sort: {
                        nextPingAt: SortOrder.Ascending,
                    },
                    select: {
                        nextPingAt: true,
                        probeId: true,
                        monitorId: true,
                        monitor: {
                            monitorSteps: true,
                            monitorType: true,
                            monitoringInterval: true,
                        },
                    },
                    skip: 0,
                    limit: LIMIT_MAX,
                    props: {
                        isRoot: true,
                    },
                });

            const monitors: Array<Monitor> = monitorProbes
                .map((monitorProbe: MonitorProbe) => {
                    return monitorProbe.monitor!;
                })
                .filter((monitor: Monitor) => {
                    return Boolean(monitor._id);
                });

            // return the list of monitors to be monitored

            return Response.sendEntityArrayResponse(
                req,
                res,
                monitors,
                new PositiveNumber(monitors.length),
                Monitor
            );
        } catch (err) {
            return next(err);
        }
    }
);

// This API returns the count of the monitor waiting to be monitored.
router.get(
    '/monitor/pending-count/:probeId',
    ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            if (!req.params['probeId']) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadDataException('Probe not found')
                );
            }

            //get list of monitors to be monitored
            const monitorProbesCount: PositiveNumber =
                await MonitorProbeService.countBy({
                    query: getMonitorFetchQuery(
                        new ObjectID(req.params['probeId'])
                    ),
                    props: {
                        isRoot: true,
                    },
                });

            //get list of monitors to be monitored
            const firstMonitorToBeFetched: MonitorProbe | null =
                await MonitorProbeService.findOneBy({
                    query: getMonitorFetchQuery(
                        new ObjectID(req.params['probeId'])
                    ),
                    select: {
                        nextPingAt: true,
                        monitorId: true,
                    },
                    sort: {
                        nextPingAt: SortOrder.Ascending,
                    },
                    props: {
                        isRoot: true,
                    },
                });

            return Response.sendJsonObjectResponse(req, res, {
                firstMonitorToBeFetched: firstMonitorToBeFetched
                    ? JSONFunctions.toJSONObject(
                          firstMonitorToBeFetched,
                          MonitorProbe
                      )
                    : null,
                count: monitorProbesCount.toNumber(),
                nextPingAt: firstMonitorToBeFetched?.nextPingAt,
                friendlyNextPingAt: firstMonitorToBeFetched?.nextPingAt
                    ? OneUptimeDate.getDateAsFormattedStringInMultipleTimezones(
                          firstMonitorToBeFetched?.nextPingAt
                      )
                    : '',
            });
        } catch (err) {
            return next(err);
        }
    }
);

router.post(
    '/monitor/list',
    ProbeAuthorization.isAuthorizedServiceMiddleware,
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            const data: JSONObject = req.body;
            const limit: number = (data['limit'] as number) || 100;

            if (
                !(req as ProbeExpressRequest).probe ||
                !(req as ProbeExpressRequest).probe?.id
            ) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadDataException('Probe not found')
                );
            }

            //get list of monitors to be monitored
            const monitorProbes: Array<MonitorProbe> =
                await MonitorProbeService.findBy({
                    query: getMonitorFetchQuery(
                        (req as OneUptimeRequest).probe?.id
                    ),
                    sort: {
                        nextPingAt: SortOrder.Ascending,
                    },
                    skip: 0,
                    limit: limit,
                    select: {
                        nextPingAt: true,
                        probeId: true,
                        monitorId: true,
                        monitor: {
                            monitorSteps: true,
                            monitorType: true,
                            monitoringInterval: true,
                        },
                    },
                    props: {
                        isRoot: true,
                    },
                });

            // update the lastMonitoredAt field of the monitors

            for (const monitorProbe of monitorProbes) {
                if (!monitorProbe.monitor) {
                    continue;
                }

                await MonitorProbeService.updateOneById({
                    id: monitorProbe.id!,
                    data: {
                        lastPingAt: OneUptimeDate.getCurrentDate(),
                        nextPingAt: CronTab.getNextExecutionTime(
                            monitorProbe?.monitor?.monitoringInterval as string
                        ),
                    },
                    props: {
                        isRoot: true,
                    },
                });
            }

            const monitors: Array<Monitor> = monitorProbes
                .map((monitorProbe: MonitorProbe) => {
                    return monitorProbe.monitor!;
                })
                .filter((monitor: Monitor) => {
                    return Boolean(monitor._id);
                });

            // return the list of monitors to be monitored

            return Response.sendEntityArrayResponse(
                req,
                res,
                monitors,
                new PositiveNumber(monitors.length),
                Monitor
            );
        } catch (err) {
            return next(err);
        }
    }
);

export default router;
