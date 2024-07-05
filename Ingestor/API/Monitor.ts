import ProbeAuthorization from "../Middleware/ProbeAuthorization";
import { ProbeExpressRequest } from "../Types/Request";
import MonitorUtil from "../Utils/Monitor";
import BaseModel from "Common/Models/BaseModel";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import SubscriptionStatus from "Common/Types/Billing/SubscriptionStatus";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import Semaphore, {
  SemaphoreMutex,
} from "CommonServer/Infrastructure/Semaphore";
import ClusterKeyAuthorization from "CommonServer/Middleware/ClusterKeyAuthorization";
import MonitorProbeService from "CommonServer/Services/MonitorProbeService";
import Query from "CommonServer/Types/Database/Query";
import QueryHelper from "CommonServer/Types/Database/QueryHelper";
import CronTab from "CommonServer/Utils/CronTab";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  OneUptimeRequest,
} from "CommonServer/Utils/Express";
import logger from "CommonServer/Utils/Logger";
import Response from "CommonServer/Utils/Response";
import Monitor from "Model/Models/Monitor";
import MonitorProbe from "Model/Models/MonitorProbe";

const router: ExpressRouter = Express.getRouter();

type GetMonitorFetchQueryFunction = (probeId: ObjectID) => Query<MonitorProbe>;

const getMonitorFetchQuery: GetMonitorFetchQueryFunction = (
  probeId: ObjectID,
): Query<MonitorProbe> => {
  const monitorFetchQuery: Query<MonitorProbe> = {
    probeId: probeId,
    isEnabled: true,
    nextPingAt: QueryHelper.lessThanEqualToOrNull(
      OneUptimeDate.getCurrentDate(),
    ),
    monitor: {
      disableActiveMonitoring: false, // do not fetch if disabled is true.
      disableActiveMonitoringBecauseOfManualIncident: false,
      disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: false,
    },

    project: {
      // get only active projects
      paymentProviderSubscriptionStatus: QueryHelper.equalToOrNull([
        SubscriptionStatus.Active,
        SubscriptionStatus.Trialing,
      ]),
      paymentProviderMeteredSubscriptionStatus: QueryHelper.equalToOrNull([
        SubscriptionStatus.Active,
        SubscriptionStatus.Trialing,
      ]),
    },
  };

  return monitorFetchQuery;
};

router.get(
  "/monitor/pending-list/:probeId",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.params["probeId"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      //get list of monitors to be monitored
      const monitorProbes: Array<MonitorProbe> =
        await MonitorProbeService.findBy({
          query: getMonitorFetchQuery(new ObjectID(req.params["probeId"])),
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
        Monitor,
      );
    } catch (err) {
      return next(err);
    }
  },
);

// This API returns the count of the monitor waiting to be monitored.
router.get(
  "/monitor/pending-count/:probeId",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.params["probeId"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      //get list of monitors to be monitored
      const monitorProbesCount: PositiveNumber =
        await MonitorProbeService.countBy({
          query: getMonitorFetchQuery(new ObjectID(req.params["probeId"])),
          props: {
            isRoot: true,
          },
        });

      //get list of monitors to be monitored
      const firstMonitorToBeFetched: MonitorProbe | null =
        await MonitorProbeService.findOneBy({
          query: getMonitorFetchQuery(new ObjectID(req.params["probeId"])),
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
          ? BaseModel.toJSONObject(firstMonitorToBeFetched, MonitorProbe)
          : null,
        count: monitorProbesCount.toNumber(),
        nextPingAt: firstMonitorToBeFetched?.nextPingAt,
        friendlyNextPingAt: firstMonitorToBeFetched?.nextPingAt
          ? OneUptimeDate.getDateAsFormattedStringInMultipleTimezones({
              date: firstMonitorToBeFetched?.nextPingAt,
            })
          : "",
      });
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/monitor/list",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    let mutex: SemaphoreMutex | null = null;

    logger.debug("Monitor list API called");

    try {
      const data: JSONObject = req.body;
      const limit: number = (data["limit"] as number) || 100;

      logger.debug("Monitor list API called with limit: " + limit);
      logger.debug("Data:");
      logger.debug(data);

      if (
        !(req as ProbeExpressRequest).probe ||
        !(req as ProbeExpressRequest).probe?.id
      ) {
        logger.error("Probe not found");

        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      const probeId: ObjectID = (req as ProbeExpressRequest).probe!.id!;

      if (!probeId) {
        logger.error("Probe not found");

        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      try {
        mutex = await Semaphore.lock({
          key: probeId.toString(),
        });
      } catch (err) {
        logger.error(err);
      }

      //get list of monitors to be monitored

      logger.debug("Fetching monitor list");

      const monitorProbes: Array<MonitorProbe> =
        await MonitorProbeService.findBy({
          query: getMonitorFetchQuery((req as OneUptimeRequest).probe!.id!),
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

      logger.debug("Fetched monitor list");
      logger.debug(monitorProbes);

      // update the lastMonitoredAt field of the monitors

      for (const monitorProbe of monitorProbes) {
        if (!monitorProbe.monitor) {
          continue;
        }

        let nextPing: Date = OneUptimeDate.addRemoveMinutes(
          OneUptimeDate.getCurrentDate(),
          1,
        );

        try {
          nextPing = CronTab.getNextExecutionTime(
            monitorProbe?.monitor?.monitoringInterval as string,
          );
        } catch (err) {
          logger.error(err);
        }

        await MonitorProbeService.updateOneById({
          id: monitorProbe.id!,
          data: {
            lastPingAt: OneUptimeDate.getCurrentDate(),
            nextPingAt: nextPing,
          },
          props: {
            isRoot: true,
          },
        });
      }

      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (err) {
          logger.error(err);
        }
      }

      const monitors: Array<Monitor> = monitorProbes
        .map((monitorProbe: MonitorProbe) => {
          return monitorProbe.monitor!;
        })
        .filter((monitor: Monitor) => {
          return Boolean(monitor._id);
        });

      logger.debug("Populating secrets");
      logger.debug(monitors);

      // check if the monitor needs secrets to be filled.

      const monitorsWithSecretPopulated: Array<Monitor> = [];

      for (const monitor of monitors) {
        const monitorWithSecrets: Monitor =
          await MonitorUtil.populateSecrets(monitor);

        monitorsWithSecretPopulated.push(monitorWithSecrets);
      }

      logger.debug("Populated secrets");
      logger.debug(monitorsWithSecretPopulated);

      // return the list of monitors to be monitored

      return Response.sendEntityArrayResponse(
        req,
        res,
        monitorsWithSecretPopulated,
        new PositiveNumber(monitorsWithSecretPopulated.length),
        Monitor,
      );
    } catch (err) {
      try {
        if (mutex) {
          await Semaphore.release(mutex);
        }
      } catch (err) {
        logger.error(err);
      }

      return next(err);
    }
  },
);

export default router;
