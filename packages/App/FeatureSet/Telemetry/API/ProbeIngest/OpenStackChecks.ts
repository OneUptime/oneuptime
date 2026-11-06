import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import TelemetryQueueService from "../../Services/Queue/TelemetryQueueService";
import { ProbeExpressRequest } from "../../Types/Request";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import { AppVersion } from "Common/Server/EnvironmentConfig";
import OpenStackCloudCheckService from "Common/Server/Services/OpenStackCloudCheckService";
import Express, {
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import { OpenStackCheckReportOutcome } from "Common/Server/Utils/OpenStack/OpenStackCheckStore";
import OpenStackProbeMetrics, {
  OpenStackProbeMetricsPayload,
} from "Common/Server/Utils/OpenStack/OpenStackProbeMetrics";
import Response from "Common/Server/Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import {
  OPENSTACK_PROBE_API_CHECK_CONCURRENCY,
  OPENSTACK_PROBE_LIFECYCLE_CHECK_CONCURRENCY,
  OpenStackApiCheckJob,
  OpenStackCheckReport,
  OpenStackLifecycleCheckJob,
} from "Common/Types/OpenStack/OpenStackCheck";
import { readRunningOpenStackCloudIds } from "./OpenStackCollection";

/*
 * The probe's side of checking clouds from outside (see Types/OpenStack/OpenStackCheck for the
 * conversation):
 *
 *   POST /probe/openstack/checks/work    the checks due for this probe
 *   POST /probe/openstack/checks/report  what one check found
 *
 * As with collections, each route takes the probe from the AUTHENTICATED request and never from the
 * body, and every read and write is keyed on it. What a check found goes through the same ingest as
 * everything else a cloud sends, stamped with the cloud's name by the server, so monitors read it as
 * they read the rest.
 */

// What these routes need of the database: OpenStackCloudCheckService, over OpenStackCheckStore.
export interface OpenStackCheckWorkStore {
  claimApiChecks: (data: {
    probeId: ObjectID;
    runningIds: Array<string>;
    limit: number;
  }) => Promise<Array<OpenStackApiCheckJob>>;
  claimLifecycleChecks: (data: {
    probeId: ObjectID;
    runningIds: Array<string>;
    limit: number;
  }) => Promise<Array<OpenStackLifecycleCheckJob>>;
  recordReport: (data: {
    probeId: ObjectID;
    report: OpenStackCheckReport;
    scopeVersion: string;
  }) => Promise<OpenStackCheckReportOutcome>;
}

export const OPENSTACK_CHECK_WORK_STORE: OpenStackCheckWorkStore = {
  claimApiChecks: async (data: {
    probeId: ObjectID;
    runningIds: Array<string>;
    limit: number;
  }): Promise<Array<OpenStackApiCheckJob>> => {
    return await OpenStackCloudCheckService.claimApiChecks(data);
  },
  claimLifecycleChecks: async (data: {
    probeId: ObjectID;
    runningIds: Array<string>;
    limit: number;
  }): Promise<Array<OpenStackLifecycleCheckJob>> => {
    return await OpenStackCloudCheckService.claimLifecycleChecks(data);
  },
  recordReport: async (data: {
    probeId: ObjectID;
    report: OpenStackCheckReport;
    scopeVersion: string;
  }): Promise<OpenStackCheckReportOutcome> => {
    return await OpenStackCloudCheckService.recordReport(data);
  },
};

function readBody(req: ProbeExpressRequest): JSONObject {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? (req.body as JSONObject)
    : {};
}

export function createOpenStackCheckRouter(
  store: OpenStackCheckWorkStore,
): ExpressRouter {
  const router: ExpressRouter = Express.getRouter();

  router.post(
    "/probe/openstack/checks/work",
    ProbeAuthorization.isAuthorizedServiceMiddleware,
    async (
      req: ProbeExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      try {
        const probeId: ObjectID | undefined | null = req.probe?.id;

        if (!probeId) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Probe not found"),
          );
        }

        /*
         * With telemetry ingestion switched off, what a check found could only be thrown away, and
         * a run that writes to someone's cloud should not happen for nothing.
         */
        if (TelemetryIngestionDisabled.isDisabled()) {
          return Response.sendJsonObjectResponse(req, res, {
            apiChecks: [],
            lifecycleChecks: [],
          });
        }

        const body: JSONObject = readBody(req);
        const runningApiIds: Array<string> = readRunningOpenStackCloudIds(
          body["runningApiCheckIds"],
        );
        const runningLifecycleIds: Array<string> = readRunningOpenStackCloudIds(
          body["runningLifecycleCheckIds"],
        );

        const apiChecks: Array<OpenStackApiCheckJob> =
          await store.claimApiChecks({
            probeId: probeId,
            runningIds: runningApiIds,
            limit: Math.max(
              0,
              OPENSTACK_PROBE_API_CHECK_CONCURRENCY - runningApiIds.length,
            ),
          });

        const lifecycleChecks: Array<OpenStackLifecycleCheckJob> =
          await store.claimLifecycleChecks({
            probeId: probeId,
            runningIds: runningLifecycleIds,
            limit: Math.max(
              0,
              OPENSTACK_PROBE_LIFECYCLE_CHECK_CONCURRENCY -
                runningLifecycleIds.length,
            ),
          });

        return Response.sendJsonObjectResponse(req, res, {
          apiChecks: apiChecks as unknown as Array<JSONObject>,
          lifecycleChecks: lifecycleChecks as unknown as Array<JSONObject>,
        });
      } catch (err) {
        return next(err);
      }
    },
  );

  router.post(
    "/probe/openstack/checks/report",
    ProbeAuthorization.isAuthorizedServiceMiddleware,
    async (
      req: ProbeExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      try {
        const probeId: ObjectID | undefined | null = req.probe?.id;

        if (!probeId) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Probe not found"),
          );
        }

        const report: OpenStackCheckReport = readBody(
          req,
        ) as unknown as OpenStackCheckReport;

        const outcome: OpenStackCheckReportOutcome = await store.recordReport({
          probeId: probeId,
          report: report,
          scopeVersion: AppVersion,
        });

        if (!outcome.accepted || !outcome.projectId) {
          return Response.sendJsonObjectResponse(req, res, {
            accepted: false,
            reason: outcome.reason || "The report was not accepted.",
          });
        }

        let queuedResourceCount: number = 0;

        if (!TelemetryIngestionDisabled.isDisabled()) {
          const payload: OpenStackProbeMetricsPayload =
            OpenStackProbeMetrics.prepare({
              resourceMetrics: outcome.resourceMetrics,
              cloudName: outcome.cloudName || "",
            });

          if (payload.resourceCount > 0) {
            await TelemetryQueueService.addMetricIngestJob({
              projectId: outcome.projectId,
              body: { resourceMetrics: payload.resourceMetrics },
              headers: {},
              productType: ProductType.Metrics,
            } as unknown as TelemetryRequest);

            queuedResourceCount = payload.resourceCount;
          }
        }

        logger.debug(
          `OpenStack check ${report.openStackCloudCheckId} by probe ${probeId.toString()}: ${report.kind}, ${queuedResourceCount} resource(s) queued for ingest.`,
        );

        return Response.sendJsonObjectResponse(req, res, {
          accepted: true,
          queuedResourceCount: queuedResourceCount,
        });
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}

export default createOpenStackCheckRouter(OPENSTACK_CHECK_WORK_STORE);
