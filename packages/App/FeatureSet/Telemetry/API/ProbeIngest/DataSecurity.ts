import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import { ProbeExpressRequest } from "../../Types/Request";
import DataSecurityCustomDataType from "Common/Models/DatabaseModels/DataSecurityCustomDataType";
import DataSecuritySetting from "Common/Models/DatabaseModels/DataSecuritySetting";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import DataSecurityCustomDataTypeService from "Common/Server/Services/DataSecurityCustomDataTypeService";
import DataSecuritySettingService from "Common/Server/Services/DataSecuritySettingService";
import DataStoreService from "Common/Server/Services/DataStoreService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import DataSecurityFindingWriter, {
  CustomDataTypeSummary,
  DataSecurityScanKind,
  RecordContentScanOutput,
} from "Common/Server/Utils/DataSecurity/DataSecurityFindingWriter";
import {
  ClaimedDataStore,
  claimDueDataStoresForProbe,
} from "Common/Server/Utils/DataSecurity/DataSecurityProbeClaim";
import {
  DATA_SECURITY_PROBE_RESULT_ROUTE,
  DATA_SECURITY_PROBE_SCAN_TIME_LIMIT_IN_SECONDS,
  DATA_SECURITY_PROBE_STORES_PER_POLL,
  DATA_SECURITY_PROBE_WORK_ROUTE,
  DataSecurityProbeStoreWork,
  getDatabaseEngineOfKind,
  isValidProbeConnectionVariable,
  readProbeScanResult,
} from "Common/Server/Utils/DataSecurity/DataSecurityProbeScan";
import { ContentScanResult } from "Common/Server/Utils/DataSecurity/DataSecurityScanTypes";
import { getFingerprintKey } from "Common/Server/Utils/DataSecurity/DataSecurityRunner";
import Express, {
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import OneUptimeDate from "Common/Types/Date";
import { getBuiltInDataType } from "Common/Types/DataSecurity/DataTypeCatalog";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ProbeCapability, {
  ProbeCapabilityUtil,
} from "Common/Types/Probe/ProbeCapability";
import {
  CustomDataTypeDefinition,
  CustomDataTypeValidator,
  customDataTypeId,
} from "Common/Utils/DataSecurity/CustomDataTypeDetector";

/*
 * The probe's side of Data Security (see Common/Server/Utils/DataSecurity/
 * DataSecurityProbeScan for the conversation):
 *
 *   POST /probe/data-security/work    the self-managed databases this probe
 *                                     scans that are due, claimed for it
 *   POST /probe/data-security/result  what one scan found, or why it could
 *                                     not run
 *
 * Every route takes the probe from the AUTHENTICATED request, never from
 * the body, and every read and write is keyed on it: a probe is handed only
 * the stores whose scanProbeId names it - and only stores of its own
 * project, never through a global probe - and is heard only about those.
 *
 * The answer names the probe's environment variable that holds a store's
 * connection string, never a connection string: the one a person may have
 * saved on the store is for OneUptime's own workers and is never read
 * here. A probe that does not declare the dataSecurityScan capability is
 * handed nothing.
 */

const router: ExpressRouter = Express.getRouter();

// How soon a scan that could not run is tried again, at the longest.
export const FAILED_SCAN_RETRY_IN_HOURS: number = 6;

// How far back a scan's reported start may be before it is read as now.
const MAX_SCAN_AGE_IN_HOURS: number = 24;

const DEFAULT_SCAN_INTERVAL_IN_HOURS: number = 24;

function readBody(req: ProbeExpressRequest): JSONObject {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? (req.body as JSONObject)
    : {};
}

function getProbeId(req: ProbeExpressRequest): ObjectID | null {
  return req.probe?.id || null;
}

/*
 * When the probe says the scan started: a date within the last day and not
 * in the future, or now.
 */
export function readStartedAt(value: unknown): Date {
  const now: Date = OneUptimeDate.getCurrentDate();

  if (typeof value !== "string") {
    return now;
  }

  const startedAt: Date = new Date(value);
  const oldest: number = now.getTime() - MAX_SCAN_AGE_IN_HOURS * 3600 * 1000;

  if (
    Number.isNaN(startedAt.getTime()) ||
    startedAt.getTime() > now.getTime() ||
    startedAt.getTime() < oldest
  ) {
    return now;
  }

  return startedAt;
}

async function getCustomDataTypes(
  projectId: ObjectID,
): Promise<Array<DataSecurityCustomDataType>> {
  return await DataSecurityCustomDataTypeService.findBy({
    query: { projectId, isEnabled: true },
    select: {
      _id: true,
      name: true,
      category: true,
      sensitivity: true,
      pattern: true,
      ignoreCase: true,
      keywords: true,
      requiresKeyword: true,
      nameHints: true,
      validator: true,
    },
    limit: 200,
    skip: 0,
    props: { isRoot: true },
  });
}

export function toCustomDataTypeDefinition(
  row: DataSecurityCustomDataType,
): CustomDataTypeDefinition | null {
  if (!row.id) {
    return null;
  }

  return {
    dataTypeId: customDataTypeId(row.id.toString()),
    pattern: row.pattern || undefined,
    ignoreCase: Boolean(row.ignoreCase),
    keywords: row.keywords || [],
    requiresKeyword: Boolean(row.requiresKeyword),
    nameHints: row.nameHints || [],
    validator:
      (row.validator as CustomDataTypeValidator | undefined) ||
      CustomDataTypeValidator.None,
  };
}

function summarizeCustomDataTypes(
  rows: Array<DataSecurityCustomDataType>,
): Map<string, CustomDataTypeSummary> {
  const summaries: Map<string, CustomDataTypeSummary> = new Map();

  for (const row of rows) {
    if (row.id && row.name && row.category && row.sensitivity) {
      summaries.set(customDataTypeId(row.id.toString()), {
        name: row.name,
        category: row.category,
        sensitivity: row.sensitivity,
      });
    }
  }

  return summaries;
}

// The work of one claimed store, as the probe is handed it.
export function buildStoreWork(data: {
  store: DataStore;
  settings: DataSecuritySetting;
  customDataTypes: Array<DataSecurityCustomDataType>;
}): DataSecurityProbeStoreWork | null {
  const engine: ReturnType<typeof getDatabaseEngineOfKind> =
    getDatabaseEngineOfKind(data.store.kind);

  if (
    !data.store.id ||
    !data.store.projectId ||
    !engine ||
    !isValidProbeConnectionVariable(data.store.probeConnectionVariable)
  ) {
    return null;
  }

  const customDataTypes: Array<CustomDataTypeDefinition> = [];

  for (const row of data.customDataTypes) {
    const definition: CustomDataTypeDefinition | null =
      toCustomDataTypeDefinition(row);

    if (definition) {
      customDataTypes.push(definition);
    }
  }

  return {
    dataStoreId: data.store.id.toString(),
    kind: data.store.kind || "",
    engine,
    probeConnectionVariable: data.store.probeConnectionVariable,
    limits: {
      maxRowsPerTable: data.settings.maxRowsPerTable || 1000,
      maxTables: data.settings.maxTablesPerScan || 200,
      maxBytesTotal: data.settings.maxBytesPerScan || 50 * 1024 * 1024,
      timeLimitInSeconds: DATA_SECURITY_PROBE_SCAN_TIME_LIMIT_IN_SECONDS,
    },
    exclusions: (data.store.scanExclusions || []).filter(
      (exclusion: unknown): exclusion is string => {
        return typeof exclusion === "string";
      },
    ),
    customDataTypes,
    disabledDataTypeIds: data.settings.disabledDataTypeIds || [],
    allowedValues: data.settings.allowedValues || [],
    // The key a worker's scan of the project uses, so the two compare.
    fingerprintKey: getFingerprintKey(data.store.projectId),
  };
}

router.post(
  DATA_SECURITY_PROBE_WORK_ROUTE,
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ProbeExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const probeId: ObjectID | null = getProbeId(req);

      if (!probeId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      // A probe that cannot scan is handed nothing, and nothing is claimed.
      if (
        !ProbeCapabilityUtil.has(
          ProbeCapabilityUtil.parse(readBody(req)["probeCapabilities"]),
          ProbeCapability.DataSecurityScan,
        )
      ) {
        return Response.sendJsonObjectResponse(req, res, { stores: [] });
      }

      /*
       * Claimed in one transaction (DataSecurityProbeClaim), so two polls
       * never get the same store.
       */
      const claimed: Array<ClaimedDataStore> = await claimDueDataStoresForProbe(
        {
          probeId,
          limit: DATA_SECURITY_PROBE_STORES_PER_POLL,
        },
      );

      if (claimed.length === 0) {
        return Response.sendJsonObjectResponse(req, res, { stores: [] });
      }

      const stores: Array<DataStore> = await DataStoreService.findBy({
        query: {
          _id: QueryHelper.any(
            claimed.map((row: ClaimedDataStore) => {
              return row._id;
            }),
          ),
          scanProbeId: probeId,
        },
        select: {
          _id: true,
          projectId: true,
          kind: true,
          probeConnectionVariable: true,
          scanExclusions: true,
        },
        limit: claimed.length,
        skip: 0,
        props: { isRoot: true },
      });

      const work: Array<DataSecurityProbeStoreWork> = [];

      for (const store of stores) {
        if (!store.id || !store.projectId) {
          continue;
        }

        const settings: DataSecuritySetting =
          await DataSecuritySettingService.getOrCreateForProject(
            store.projectId,
          );
        const storeWork: DataSecurityProbeStoreWork | null = buildStoreWork({
          store,
          settings,
          customDataTypes: await getCustomDataTypes(store.projectId),
        });

        if (!storeWork) {
          /*
           * A variable name no probe reads (lower case, a probe's own
           * setting): said on the store, instead of a scan that cannot run.
           */
          await DataSecurityFindingWriter.recordFailedScan({
            projectId: store.projectId,
            dataStoreId: store.id,
            probeId,
            kind: DataSecurityScanKind.Content,
            startedAt: OneUptimeDate.getCurrentDate(),
            errorMessage: `The probe cannot read the environment variable "${String(
              store.probeConnectionVariable || "",
            ).slice(
              0,
              64,
            )}": name one of upper-case letters, digits and underscores that is not one of the probe's own settings.`,
          });
          continue;
        }

        work.push(storeWork);
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
  DATA_SECURITY_PROBE_RESULT_ROUTE,
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ProbeExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const probeId: ObjectID | null = getProbeId(req);

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

      /*
       * Scoped to the authenticated probe: the middleware proves only that
       * the caller is SOME probe, so a store is found only when it names
       * this one.
       */
      const store: DataStore | null = await DataStoreService.findOneBy({
        query: { _id: new ObjectID(dataStoreId), scanProbeId: probeId },
        select: { _id: true, projectId: true },
        props: { isRoot: true },
      });

      if (!store?.id || !store.projectId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Data store not found."),
        );
      }

      const startedAt: Date = readStartedAt(body["startedAt"]);
      const settings: DataSecuritySetting =
        await DataSecuritySettingService.getOrCreateForProject(store.projectId);
      const interval: number =
        settings.contentScanIntervalInHours || DEFAULT_SCAN_INTERVAL_IN_HOURS;
      const error: unknown = body["error"];

      if (typeof error === "string" && error.trim().length > 0) {
        await DataSecurityFindingWriter.recordFailedScan({
          projectId: store.projectId,
          dataStoreId: store.id,
          probeId,
          kind: DataSecurityScanKind.Content,
          startedAt,
          errorMessage: error.trim().slice(0, 500),
        });

        await DataStoreService.updateColumnsByIdWithoutHooks({
          id: store.id,
          data: {
            nextContentScanAt: OneUptimeDate.addRemoveHours(
              OneUptimeDate.getCurrentDate(),
              Math.min(interval, FAILED_SCAN_RETRY_IN_HOURS),
            ),
          } as never,
        });

        return Response.sendJsonObjectResponse(req, res, {
          accepted: true,
          findingsWritten: 0,
        });
      }

      const customDataTypes: Map<string, CustomDataTypeSummary> =
        summarizeCustomDataTypes(await getCustomDataTypes(store.projectId));
      const result: ContentScanResult | null = readProbeScanResult(
        body["result"],
        (dataTypeId: string): boolean => {
          return (
            Boolean(getBuiltInDataType(dataTypeId)) ||
            customDataTypes.has(dataTypeId)
          );
        },
      );

      if (!result) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("The result is not a content scan result."),
        );
      }

      const written: RecordContentScanOutput =
        await DataSecurityFindingWriter.recordContentScan({
          projectId: store.projectId,
          dataStoreId: store.id,
          kind: DataSecurityScanKind.Content,
          result,
          startedAt,
          probeId,
          keepMaskedSamples: settings.keepMaskedSamples !== false,
          contentScanIntervalInHours: interval,
          customDataTypes,
        });

      logger.debug(
        `Data Security scan of store ${store.id.toString()} by probe ${probeId.toString()}: ${written.findingsWritten} finding(s).`,
      );

      return Response.sendJsonObjectResponse(req, res, {
        accepted: true,
        findingsWritten: written.findingsWritten,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
