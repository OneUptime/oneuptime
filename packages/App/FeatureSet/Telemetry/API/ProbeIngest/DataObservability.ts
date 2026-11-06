import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import { ProbeExpressRequest } from "../../Types/Request";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import DataStoreService from "Common/Server/Services/DataStoreService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import {
  buildProbeCollectWork,
  ClaimedTableHealthStore,
  claimDueTableHealthStoresForProbe,
} from "Common/Server/Utils/DataObservability/DataObservabilityProbeClaim";
import {
  DATA_OBSERVABILITY_PROBE_RESULT_ROUTE,
  DATA_OBSERVABILITY_PROBE_STORES_PER_POLL,
  DATA_OBSERVABILITY_PROBE_WORK_ROUTE,
  DataObservabilityProbeStoreWork,
  readProbeCollectError,
  readTableHealthSnapshot,
} from "Common/Server/Utils/DataObservability/DataObservabilityProbeCollect";
import { TableHealthSnapshot } from "Common/Server/Utils/DataObservability/TableHealthCollector";
import TableHealthIngest, {
  IngestStore,
  TableHealthIngestResult,
} from "Common/Server/Utils/DataObservability/TableHealthIngest";
import DataCheckIngest from "Common/Server/Utils/DataObservability/DataCheckIngest";
import DataCheckPlanner, {
  DataCheckPlan,
} from "Common/Server/Utils/DataObservability/DataCheckPlanner";
import { getCollectorEngineOfKind } from "Common/Server/Utils/DataObservability/DataObservabilityEngines";
import Express, {
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ProbeCapability, {
  ProbeCapabilityUtil,
} from "Common/Types/Probe/ProbeCapability";

/*
 * The probe's side of Data Observability (see Common/Server/Utils/
 * DataObservability/DataObservabilityProbeCollect for the conversation):
 *
 *   POST /probe/data-observability/work    the self-managed databases this
 *                                          probe collects that are due,
 *                                          claimed for it
 *   POST /probe/data-observability/result  what one collection read, or
 *                                          why it could not run
 *
 * As with Data Security's routes, the probe is taken from the
 * AUTHENTICATED request, never from the body: a probe is handed only the
 * stores whose scanProbeId names it, of its own project, and is heard only
 * about those. The answer names an environment variable, never a
 * connection string. A probe that does not declare the
 * dataObservabilityCollect capability is handed nothing.
 */

const router: ExpressRouter = Express.getRouter();

function readBody(req: ProbeExpressRequest): JSONObject {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? (req.body as JSONObject)
    : {};
}

router.post(
  DATA_OBSERVABILITY_PROBE_WORK_ROUTE,
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ProbeExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const probeId: ObjectID | null = req.probe?.id || null;

      if (!probeId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      if (
        !ProbeCapabilityUtil.has(
          ProbeCapabilityUtil.parse(readBody(req)["probeCapabilities"]),
          ProbeCapability.DataObservabilityCollect,
        )
      ) {
        return Response.sendJsonObjectResponse(req, res, { stores: [] });
      }

      const claimed: Array<ClaimedTableHealthStore> =
        await claimDueTableHealthStoresForProbe({
          probeId,
          limit: DATA_OBSERVABILITY_PROBE_STORES_PER_POLL,
        });

      if (claimed.length === 0) {
        return Response.sendJsonObjectResponse(req, res, { stores: [] });
      }

      const stores: Array<DataStore> = await DataStoreService.findBy({
        query: {
          _id: QueryHelper.any(
            claimed.map((row: ClaimedTableHealthStore) => {
              return row._id;
            }),
          ),
          scanProbeId: probeId,
        },
        select: {
          _id: true,
          projectId: true,
          name: true,
          kind: true,
          probeConnectionVariable: true,
          scanExclusions: true,
          tableHealthCollectedAt: true,
        },
        limit: claimed.length,
        skip: 0,
        props: { isRoot: true },
      });

      const work: Array<DataObservabilityProbeStoreWork> = [];

      for (const store of stores) {
        if (!store.id) {
          continue;
        }

        const engine: ReturnType<typeof getCollectorEngineOfKind> =
          getCollectorEngineOfKind(store.kind);
        // The store's due checks go with its collection; one that cannot run fails here.
        const plan: DataCheckPlan = engine
          ? await DataCheckPlanner.planDueChecks({
              dataStoreId: store.id,
              engine,
              now: OneUptimeDate.getCurrentDate(),
            })
          : { planned: [], refused: [] };

        if (plan.refused.length > 0 && store.projectId) {
          await DataCheckIngest.recordResults({
            store: {
              id: store.id,
              projectId: store.projectId,
              name: store.name || "",
              kind: store.kind || "",
            },
            results: plan.refused,
            collectedAt: OneUptimeDate.getCurrentDate(),
          });
        }

        const storeWork: DataObservabilityProbeStoreWork | null =
          buildProbeCollectWork(store, plan.planned);

        if (!storeWork) {
          await TableHealthIngest.recordFailure({
            storeId: store.id,
            error: `The probe cannot read the environment variable "${String(
              store.probeConnectionVariable || "",
            ).slice(
              0,
              64,
            )}": name one of upper-case letters, digits and underscores that is not one of the probe's own settings.`,
          });
          continue;
        }

        work.push({
          ...storeWork,
          freshnessReads: plan.freshnessReads,
          waitWhenBusy: plan.waitWhenBusy,
        });
      }

      return Response.sendJsonObjectResponse(req, res, {
        stores: work as unknown as Array<JSONObject>,
      });
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  DATA_OBSERVABILITY_PROBE_RESULT_ROUTE,
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ProbeExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const probeId: ObjectID | null = req.probe?.id || null;

      if (!probeId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      const body: JSONObject = readBody(req);
      const dataStoreId: unknown = body["dataStoreId"];

      if (
        typeof dataStoreId !== "string" ||
        !ObjectID.isValidUUID(dataStoreId)
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("dataStoreId is missing or is not an ID."),
        );
      }

      // Only a store that names this probe: the middleware proves only that the caller is SOME probe.
      const store: DataStore | null = await DataStoreService.findOneBy({
        query: { _id: new ObjectID(dataStoreId), scanProbeId: probeId },
        select: { _id: true, projectId: true, name: true, kind: true },
        props: { isRoot: true },
      });

      if (!store?.id || !store.projectId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Data store not found."),
        );
      }

      const error: string | null = readProbeCollectError(body["error"]);

      if (error) {
        await TableHealthIngest.recordFailure({ storeId: store.id, error });
        return Response.sendJsonObjectResponse(req, res, { accepted: true });
      }

      const snapshot: TableHealthSnapshot | null = readTableHealthSnapshot(
        body["snapshot"],
        OneUptimeDate.getCurrentDate(),
      );

      if (!snapshot) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("The result is not a table health snapshot."),
        );
      }

      const ingestStore: IngestStore = {
        id: store.id,
        projectId: store.projectId,
        name: store.name || "",
        kind: store.kind || "",
      };
      const result: TableHealthIngestResult =
        await TableHealthIngest.recordSnapshot({
          store: ingestStore,
          snapshot,
        });

      // Only this store's checks are recorded (DataCheckIngest), whatever the report names.
      await DataCheckIngest.recordResults({
        store: ingestStore,
        results: snapshot.checkResults || [],
        collectedAt: OneUptimeDate.fromString(snapshot.collectedAt),
      });

      logger.debug(
        `Data Observability collection of store ${store.id.toString()} by probe ${probeId.toString()}: ${snapshot.tables.length} table(s).`,
      );

      return Response.sendJsonObjectResponse(req, res, {
        accepted: true,
        tables: snapshot.tables.length,
        schemaChanges: result.schemaChanges,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
