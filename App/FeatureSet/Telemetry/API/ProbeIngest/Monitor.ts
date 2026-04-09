import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import { ProbeExpressRequest } from "../../Types/Request";
import MonitorUtil from "../../Utils/Monitor";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import MonitorProbeService from "Common/Server/Services/MonitorProbeService";
import Query from "Common/Server/Types/Database/Query";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import CronTab from "Common/Server/Utils/CronTab";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger, {
  getLogAttributesFromRequest,
} from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorProbe from "Common/Models/DatabaseModels/MonitorProbe";
import MonitorService from "Common/Server/Services/MonitorService";
import ProjectService from "Common/Server/Services/ProjectService";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorTest from "Common/Models/DatabaseModels/MonitorTest";
import MonitorTestService from "Common/Server/Services/MonitorTestService";

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
      ...MonitorService.getEnabledMonitorQuery(),
    },
    project: {
      ...ProjectService.getActiveProjectStatusQuery(),
    },
  };

  return monitorFetchQuery;
};

router.get(
  "/monitor/pending-list/by-probe/:probeId",
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
          query: {
            ...getMonitorFetchQuery(new ObjectID(req.params["probeId"])),
            nextPingAt: QueryHelper.lessThanEqualToOrNull(
              OneUptimeDate.addRemoveMinutes(
                OneUptimeDate.getCurrentDate(),
                -3,
              ),
            ),
          },
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
              projectId: true,
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

router.get(
  "/monitor/pending-count/incoming-request",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      // get count of incoming request monitors which are not checked for heartbeat in last 2 minutes
      const incomingMonitorPendingCount: PositiveNumber =
        await MonitorService.countBy({
          query: {
            ...MonitorService.getEnabledMonitorQuery(),
            monitorType: MonitorType.IncomingRequest,
            project: {
              ...ProjectService.getActiveProjectStatusQuery(),
            },
            incomingRequestMonitorHeartbeatCheckedAt:
              QueryHelper.lessThanEqualToOrNull(
                OneUptimeDate.addRemoveMinutes(
                  OneUptimeDate.getCurrentDate(),
                  -2,
                ),
              ),
          },
          props: {
            isRoot: true,
          },
        });

      const firstMonitorToBeFetched: Monitor | null =
        await MonitorService.findOneBy({
          query: {
            ...MonitorService.getEnabledMonitorQuery(),
            monitorType: MonitorType.IncomingRequest,
            project: {
              ...ProjectService.getActiveProjectStatusQuery(),
            },
            incomingRequestMonitorHeartbeatCheckedAt:
              QueryHelper.lessThanEqualToOrNull(
                OneUptimeDate.addRemoveMinutes(
                  OneUptimeDate.getCurrentDate(),
                  -2,
                ),
              ),
          },
          select: {
            incomingRequestMonitorHeartbeatCheckedAt: true,
            monitorSteps: true,
            monitorType: true,
            monitoringInterval: true,
          },
          sort: {
            incomingRequestMonitorHeartbeatCheckedAt: SortOrder.Ascending,
          },
          props: {
            isRoot: true,
          },
        });

      return Response.sendJsonObjectResponse(req, res, {
        incomingMonitorPendingCount: incomingMonitorPendingCount.toNumber(),
        firstMonitorToBeFetched: firstMonitorToBeFetched,
        incomingRequestMonitorHeartbeatCheckedAt:
          firstMonitorToBeFetched?.incomingRequestMonitorHeartbeatCheckedAt,
        friendlyIncomingRequestMonitorHeartbeatCheckedAt:
          firstMonitorToBeFetched?.incomingRequestMonitorHeartbeatCheckedAt
            ? OneUptimeDate.getDateAsFormattedStringInMultipleTimezones({
                date: firstMonitorToBeFetched?.incomingRequestMonitorHeartbeatCheckedAt,
              })
            : "",
      });
    } catch (err) {
      return next(err);
    }
  },
);

// This API returns the count of the monitor waiting to be monitored.
router.get(
  "/monitor/pending-count/by-probe/:probeId",
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
          query: {
            ...getMonitorFetchQuery(new ObjectID(req.params["probeId"])),
            nextPingAt: QueryHelper.lessThanEqualToOrNull(
              OneUptimeDate.addRemoveMinutes(
                OneUptimeDate.getCurrentDate(),
                -3,
              ),
            ),
          },
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

/*
 * This API returns the count of monitors pending to be probed for the authenticated probe.
 * Used by KEDA for autoscaling probes based on pending monitor count.
 */
router.post(
  "/monitor/pending-count",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (
        !(req as ProbeExpressRequest).probe ||
        !(req as ProbeExpressRequest).probe?.id
      ) {
        logger.error(
          "Probe not found for pending-count request",
          getLogAttributesFromRequest(req as any),
        );

        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      const probeId: ObjectID = (req as ProbeExpressRequest).probe!.id!;

      if (!probeId) {
        logger.error(
          "Probe ID not found for pending-count request",
          getLogAttributesFromRequest(req as any),
        );

        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      // Get count of monitors pending to be probed
      const monitorProbesCount: PositiveNumber =
        await MonitorProbeService.countBy({
          query: getMonitorFetchQuery(probeId),
          props: {
            isRoot: true,
          },
        });

      logger.debug(
        `Pending monitor count for probe ${probeId.toString()}: ${monitorProbesCount.toNumber()}`,
        getLogAttributesFromRequest(req as any),
      );

      return Response.sendJsonObjectResponse(req, res, {
        count: monitorProbesCount.toNumber(),
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
    logger.debug(
      "Monitor list API called",
      getLogAttributesFromRequest(req as any),
    );

    try {
      const data: JSONObject = req.body;
      const limit: number = (data["limit"] as number) || 100;

      logger.debug(
        "Monitor list API called with limit: " + limit,
        getLogAttributesFromRequest(req as any),
      );
      logger.debug("Data:", getLogAttributesFromRequest(req as any));
      logger.debug(data, getLogAttributesFromRequest(req as any));

      if (
        !(req as ProbeExpressRequest).probe ||
        !(req as ProbeExpressRequest).probe?.id
      ) {
        logger.error(
          "Probe not found",
          getLogAttributesFromRequest(req as any),
        );

        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      const probeId: ObjectID = (req as ProbeExpressRequest).probe!.id!;

      if (!probeId) {
        logger.error(
          "Probe not found",
          getLogAttributesFromRequest(req as any),
        );

        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      //get list of monitors to be monitored

      logger.debug(
        "Fetching monitor list for probes",
        getLogAttributesFromRequest(req as any),
      );

      /*
       * Atomically claim monitors for this probe instance using FOR UPDATE SKIP LOCKED
       * This prevents multiple instances of the same probe from picking up the same monitors
       */
      const claimedMonitorProbeIds: Array<ObjectID> =
        await MonitorProbeService.claimMonitorProbesForProbing({
          probeId: probeId,
          limit: limit,
        });

      logger.debug(
        `Claimed ${claimedMonitorProbeIds.length} monitor probes for probing`,
        getLogAttributesFromRequest(req as any),
      );

      if (claimedMonitorProbeIds.length === 0) {
        logger.debug(
          "No monitors to probe",
          getLogAttributesFromRequest(req as any),
        );
        return Response.sendEntityArrayResponse(
          req,
          res,
          [],
          new PositiveNumber(0),
          Monitor,
        );
      }

      // Fetch the full monitor details for the claimed monitors
      const monitorProbes: Array<MonitorProbe> =
        await MonitorProbeService.findBy({
          query: {
            _id: QueryHelper.any(claimedMonitorProbeIds),
          },
          select: {
            nextPingAt: true,
            probeId: true,
            monitorId: true,
            monitor: {
              monitorSteps: true,
              monitorType: true,
              monitoringInterval: true,
              projectId: true,
            },
          },
          limit: limit,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

      logger.debug(
        "Fetched monitor list",
        getLogAttributesFromRequest(req as any),
      );
      logger.debug(monitorProbes, getLogAttributesFromRequest(req as any));

      // Update the nextPingAt based on the actual monitoring interval
      const updatePromises: Array<Promise<void>> = [];

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
          logger.error(err, getLogAttributesFromRequest(req as any));
        }

        updatePromises.push(
          MonitorProbeService.updateOneById({
            id: monitorProbe.id!,
            data: {
              nextPingAt: nextPing,
            },
            props: {
              isRoot: true,
            },
          }),
        );
      }

      // Update nextPingAt in parallel - this refines the temporary value set during claiming
      await Promise.all(updatePromises);

      const monitors: Array<Monitor> = monitorProbes
        .map((monitorProbe: MonitorProbe) => {
          return monitorProbe.monitor!;
        })
        .filter((monitor: Monitor) => {
          return Boolean(monitor._id);
        });

      logger.debug(
        "Populating secrets",
        getLogAttributesFromRequest(req as any),
      );
      logger.debug(monitors, getLogAttributesFromRequest(req as any));

      // check if the monitor needs secrets to be filled.

      let monitorsWithSecretPopulated: Array<Monitor> = [];
      const monitorWithSecretsPopulatePromises: Array<Promise<Monitor>> = [];

      for (const monitor of monitors) {
        monitorWithSecretsPopulatePromises.push(
          MonitorUtil.populateSecrets(monitor),
        );
      }

      monitorsWithSecretPopulated = await Promise.all(
        monitorWithSecretsPopulatePromises,
      );

      logger.debug(
        "Populated secrets",
        getLogAttributesFromRequest(req as any),
      );
      logger.debug(
        monitorsWithSecretPopulated,
        getLogAttributesFromRequest(req as any),
      );

      // return the list of monitors to be monitored

      logger.debug("Sending response", getLogAttributesFromRequest(req as any));

      return Response.sendEntityArrayResponse(
        req,
        res,
        monitorsWithSecretPopulated,
        new PositiveNumber(monitorsWithSecretPopulated.length),
        Monitor,
      );
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/monitor-test/list",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    logger.debug(
      "Monitor test list API called",
      getLogAttributesFromRequest(req as any),
    );

    try {
      const data: JSONObject = req.body;
      const limit: number = (data["limit"] as number) || 100;

      logger.debug(
        "Monitor test list API called with limit: " + limit,
        getLogAttributesFromRequest(req as any),
      );
      logger.debug("Data:", getLogAttributesFromRequest(req as any));
      logger.debug(data, getLogAttributesFromRequest(req as any));

      if (
        !(req as ProbeExpressRequest).probe ||
        !(req as ProbeExpressRequest).probe?.id
      ) {
        logger.error(
          "Probe not found",
          getLogAttributesFromRequest(req as any),
        );

        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      const probeId: ObjectID = (req as ProbeExpressRequest).probe!.id!;

      if (!probeId) {
        logger.error(
          "Probe not found",
          getLogAttributesFromRequest(req as any),
        );

        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      //get list of monitors to be monitored

      logger.debug(
        "Fetching test monitor list",
        getLogAttributesFromRequest(req as any),
      );

      /*
       * Atomically claim monitor tests with FOR UPDATE SKIP LOCKED to prevent
       * duplicate test execution across concurrent probe replicas.
       */
      const claimedMonitorTestIds: Array<ObjectID> =
        await MonitorTestService.claimMonitorTestsForProbing({
          probeId: probeId,
          limit: limit,
        });

      logger.debug(
        `Claimed ${claimedMonitorTestIds.length} monitor tests for probing`,
        getLogAttributesFromRequest(req as any),
      );

      if (claimedMonitorTestIds.length === 0) {
        logger.debug(
          "No monitor tests to probe",
          getLogAttributesFromRequest(req as any),
        );
        return Response.sendEntityArrayResponse(
          req,
          res,
          [],
          new PositiveNumber(0),
          MonitorTest,
        );
      }

      const monitorTests: Array<MonitorTest> = await MonitorTestService.findBy({
        query: {
          _id: QueryHelper.any(claimedMonitorTestIds),
        },
        sort: {
          createdAt: SortOrder.Ascending,
        },
        skip: 0,
        limit: limit,
        select: {
          monitorType: true,
          monitorSteps: true,
          _id: true,
          projectId: true,
          monitorId: true,
        },
        props: {
          isRoot: true,
        },
      });

      logger.debug(
        "Fetched monitor tests",
        getLogAttributesFromRequest(req as any),
      );
      logger.debug(monitorTests, getLogAttributesFromRequest(req as any));

      logger.debug(
        "Populating secrets",
        getLogAttributesFromRequest(req as any),
      );
      logger.debug(monitorTests, getLogAttributesFromRequest(req as any));

      // check if the monitor needs secrets to be filled.

      let monitorTestsWithSecretPopulated: Array<MonitorTest> = [];
      const monitorTestsWithSecretsPopulatePromises: Array<
        Promise<MonitorTest>
      > = [];

      for (const monitorTest of monitorTests) {
        monitorTestsWithSecretsPopulatePromises.push(
          MonitorUtil.populateSecretsOnMonitorTest(monitorTest),
        );
      }

      monitorTestsWithSecretPopulated = await Promise.all(
        monitorTestsWithSecretsPopulatePromises,
      );

      logger.debug(
        "Populated secrets",
        getLogAttributesFromRequest(req as any),
      );
      logger.debug(
        monitorTestsWithSecretPopulated,
        getLogAttributesFromRequest(req as any),
      );

      // return the list of monitors to be monitored

      logger.debug("Sending response", getLogAttributesFromRequest(req as any));

      return Response.sendEntityArrayResponse(
        req,
        res,
        monitorTestsWithSecretPopulated,
        new PositiveNumber(monitorTestsWithSecretPopulated.length),
        MonitorTest,
      );
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
