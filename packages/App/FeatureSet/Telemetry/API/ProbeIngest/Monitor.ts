import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import { ProbeExpressRequest } from "../../Types/Request";
import MonitorUtil from "../../Utils/Monitor";
import NetworkDeviceHydrationUtil from "Common/Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import MonitorProbeService from "Common/Server/Services/MonitorProbeService";
import Query from "Common/Server/Types/Database/Query";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
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
import MonitorTest from "Common/Models/DatabaseModels/MonitorTest";
import MonitorTestService from "Common/Server/Services/MonitorTestService";
import MonitorSecret from "Common/Models/DatabaseModels/MonitorSecret";

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

      /*
       * nextPingAt is now computed during claimMonitorProbesForProbing,
       * so no second update is needed here.
       */

      const monitors: Array<Monitor> = monitorProbes
        .map((monitorProbe: MonitorProbe) => {
          return monitorProbe.monitor!;
        })
        .filter((monitor: Monitor) => {
          return Boolean(monitor._id);
        });

      /*
       * Network Device monitors reference a NetworkDevice resource; probes
       * need the device's concrete SNMP config injected into the steps.
       */
      await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors(monitors);

      logger.debug(
        "Populating secrets",
        getLogAttributesFromRequest(req as any),
      );
      logger.debug(monitors, getLogAttributesFromRequest(req as any));

      // check if the monitor needs secrets to be filled.

      /*
       * Batch: one MonitorSecret query for every claimed monitor that
       * references {{monitorSecrets.*}} instead of one query per monitor.
       * Monitors whose steps don't reference secrets keep the lazy per-call
       * path (which won't query at all), so a conservative miss here can
       * never drop a secret — it just falls back to the old per-monitor
       * query.
       */
      const monitorIdsNeedingSecrets: Array<ObjectID> = monitors
        .filter((monitor: Monitor) => {
          return Boolean(
            monitor.id &&
              monitor.monitorSteps &&
              MonitorUtil.monitorStepsReferenceSecrets(monitor.monitorSteps),
          );
        })
        .map((monitor: Monitor) => {
          return monitor.id!;
        });

      const secretsByMonitorId: Map<
        string,
        Array<MonitorSecret>
      > = await MonitorUtil.loadMonitorSecretsForMonitors(
        monitorIdsNeedingSecrets,
      );

      const monitorIdsNeedingSecretsSet: Set<string> = new Set(
        monitorIdsNeedingSecrets.map((id: ObjectID) => {
          return id.toString();
        }),
      );

      let monitorsWithSecretPopulated: Array<Monitor> = [];
      const monitorWithSecretsPopulatePromises: Array<Promise<Monitor>> = [];

      for (const monitor of monitors) {
        const monitorKey: string | undefined = monitor.id?.toString();

        monitorWithSecretsPopulatePromises.push(
          MonitorUtil.populateSecrets(
            monitor,
            monitorKey && monitorIdsNeedingSecretsSet.has(monitorKey)
              ? secretsByMonitorId.get(monitorKey) || []
              : undefined,
          ),
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

      // Inject device SNMP config into Network Device monitor test steps.
      await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors(
        monitorTests,
      );

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
