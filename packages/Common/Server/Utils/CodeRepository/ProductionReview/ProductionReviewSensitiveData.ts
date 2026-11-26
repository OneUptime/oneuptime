import DataSecurityCustomDataTypeService from "../../../Services/DataSecurityCustomDataTypeService";
import DataStoreFindingService from "../../../Services/DataStoreFindingService";
import DataStoreService from "../../../Services/DataStoreService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import { CodeAgentScopedService } from "../../AI/CodeFix/CodeAgentTelemetryScope";
import {
  CoveringScrubRule,
  findCoveringScrubRule,
  getScrubCoverage,
  ScrubCoverage,
} from "../../DataSecurity/Telemetry/TelemetryScrubCoverage";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { CodeHostChangedFile } from "../CodeHost/CodeHostTypes";
import { ChangedCode } from "./ProductionReviewDiff";
import ProductionReviewScope from "./ProductionReviewScope";
import {
  SensitiveDataCandidate,
  toLeakPoint,
} from "./SensitiveData/SensitiveDataCandidate";
import { ProjectDataTypeHints } from "./SensitiveData/SensitiveDataNames";
import SensitiveDataRules, {
  SensitiveDataRulesResult,
} from "./SensitiveData/SensitiveDataRules";
import DataSecurityCustomDataType from "../../../../Models/DatabaseModels/DataSecurityCustomDataType";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import {
  ProductionReviewLeakHeldBeforeJSON,
  ProductionReviewLeakJSON,
  ProductionReviewLeakProductionJSON,
  ProductionReviewLeakStoreJSON,
  ProductionReviewSensitiveDataJSON,
  PUBLIC_BY_DESIGN_CHECK_IDS,
  PUBLIC_STORE_CHECK_IDS,
  SENSITIVE_DATA_LIMITS,
  SensitiveDataLeakKind,
  SensitiveDataSink,
} from "../../../../Types/CodeRepository/ProductionReviewSensitiveData";
import { customDataTypeId } from "../../../../Types/DataSecurity/CustomDataTypeId";
import DataCategory from "../../../../Types/DataSecurity/DataCategory";
import { getDataSecurityCheck } from "../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataSensitivity, {
  DATA_SENSITIVITY_RANK,
  isDataSensitivity,
} from "../../../../Types/DataSecurity/DataSensitivity";
import {
  DataStoreKind,
  DataStoreKindInfo,
  DataStoreProvider,
  getDataStoreKindInfo,
} from "../../../../Types/DataSecurity/DataStoreKind";
import DataTypeNamer from "../../../../Types/DataSecurity/DataTypeNamer";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import ObjectID from "../../../../Types/ObjectID";
import SecuritySeverity from "../../../../Types/SecuritySeverity";

/*
 * THE SENSITIVE DATA SECTION OF A PRODUCTION REVIEW (#10376).
 *
 * The rules over the diff (SensitiveData/SensitiveDataRules) say what the
 * change writes to telemetry, does to a store or adds a column for. What
 * the project already knows in production makes each point sharper:
 *
 *   - telemetry: where the service's own telemetry held the same kind of
 *     data in the last SENSITIVE_DATA_LIMITS.heldBeforeDays days - its
 *     logs' `attributes.email`, its spans' `user.ssn` - from Data
 *     Security's findings on the service's telemetry stores; and whether a
 *     scrub rule already masks it at ingest, which is still a point: the
 *     code writes it, and every place that reads it before ingest - the
 *     collector, a log file, another vendor - reads it whole;
 *   - infrastructure: the project's store the resource is, found by the
 *     names the diff knows it by - its sensitivity says how bad the point
 *     is, and a store marked Public By Design makes no point for being
 *     public at all.
 *
 * Everything production knows is kept apart from what the diff shows
 * (ProductionReviewLeakJSON.production), so a public repository's comment,
 * and a reader who may not read Data Security, are shown the point
 * without it. Read as OneUptime: what a reader may see of it is decided
 * where the review is read (ProductionReviewReadFilter).
 */

// How each sink's writes reach the service's telemetry: the store kinds that hold them.
const STORE_KINDS_OF_SINK: Readonly<
  Record<SensitiveDataSink, ReadonlyArray<DataStoreKind>>
> = {
  [SensitiveDataSink.Log]: [DataStoreKind.TelemetryLogs],
  [SensitiveDataSink.Span]: [
    DataStoreKind.TelemetryTraces,
    DataStoreKind.TelemetryExceptions,
  ],
  [SensitiveDataSink.Metric]: [DataStoreKind.TelemetryMetrics],
  [SensitiveDataSink.AiPrompt]: [DataStoreKind.TelemetryAiConversations],
};

// The places of production one point names: the nearest few.
const MAX_HELD_BEFORE: number = 2;

// The findings of the services' telemetry read for one review.
const MAX_FINDINGS_READ: number = 500;

// The stores read for one review's resources.
const MAX_STORES_READ: number = 50;

// A store's own data types it names, the most sensitive first.
const MAX_STORE_DATA_TYPES: number = 3;

// A resource's cloud, by how its type is written: aws_..., AWS::..., aws.s3...
function providerOfResource(type: string): DataStoreProvider | null {
  const lower: string = type.toLowerCase();

  if (lower.startsWith("aws")) {
    return DataStoreProvider.Aws;
  }

  if (
    lower.startsWith("azurerm") ||
    lower.startsWith("microsoft.") ||
    lower.startsWith("azure")
  ) {
    return DataStoreProvider.Azure;
  }

  if (lower.startsWith("google") || lower.startsWith("gcp")) {
    return DataStoreProvider.Gcp;
  }

  return null;
}

function effectiveSensitivity(store: DataStore): DataSensitivity {
  const level: unknown = store.sensitivityOverride || store.sensitivity;

  return isDataSensitivity(level) ? level : DataSensitivity.Public;
}

function isSensitive(sensitivity: DataSensitivity): boolean {
  return (
    DATA_SENSITIVITY_RANK[sensitivity] >=
    DATA_SENSITIVITY_RANK[DataSensitivity.Confidential]
  );
}

export default class ProductionReviewSensitiveData {
  /*
   * The section for a pull request's files, or one with no points when the
   * rules find nothing. `isFailOn` is the repository's switch: a blocking
   * point fails the check only while it is on.
   */
  @CaptureSpan()
  public static async find(data: {
    projectId: ObjectID;
    files: Array<CodeHostChangedFile>;
    // The services the repository serves (ProductionReviewScope).
    services: Array<CodeAgentScopedService>;
    isFailOn: boolean;
    now: Date;
  }): Promise<ProductionReviewSensitiveDataJSON> {
    const projectTypes: Array<ProjectDataTypeHints> =
      await ProductionReviewSensitiveData.readProjectTypes(data.projectId);

    const rules: SensitiveDataRulesResult = SensitiveDataRules.find({
      files: data.files.map((file: CodeHostChangedFile) => {
        return {
          filename: file.filename,
          status: file.status,
          patch: file.patch,
        };
      }),
      projectTypes,
    });

    if (rules.candidates.length === 0) {
      return {
        points: [],
        moreCount: rules.moreCount,
        droppedCount: 0,
        isFailOn: data.isFailOn,
        isAiRead: false,
      };
    }

    const stores: Array<DataStore> =
      await ProductionReviewSensitiveData.readResourceStores({
        projectId: data.projectId,
        candidates: rules.candidates,
      });

    const telemetry: TelemetryKnowledge =
      await ProductionReviewSensitiveData.readTelemetryKnowledge({
        projectId: data.projectId,
        candidates: rules.candidates,
        services: data.services,
        now: data.now,
      });

    const points: Array<ProductionReviewLeakJSON> = [];
    const occurrences: Map<string, number> = new Map<string, number>();

    for (const candidate of rules.candidates) {
      const point: ProductionReviewLeakJSON | null =
        ProductionReviewSensitiveData.toPoint({
          candidate,
          stores,
          telemetry,
          isFailOn: data.isFailOn,
          occurrences,
        });

      if (point) {
        points.push(point);
      }
    }

    return {
      points,
      moreCount: rules.moreCount,
      droppedCount: 0,
      isFailOn: data.isFailOn,
      isAiRead: false,
    };
  }

  /*
   * The project's own data types, by their hints: what the rules read
   * besides the catalog. None when they cannot be read - the catalog's
   * still are.
   */
  public static async readProjectTypes(
    projectId: ObjectID,
  ): Promise<Array<ProjectDataTypeHints>> {
    try {
      const rows: Array<DataSecurityCustomDataType> =
        await DataSecurityCustomDataTypeService.findBy({
          query: { projectId, isEnabled: true },
          select: {
            _id: true,
            name: true,
            sensitivity: true,
            category: true,
            nameHints: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        });

      return rows
        .filter((row: DataSecurityCustomDataType): boolean => {
          return Boolean(
            row.id &&
              isDataSensitivity(row.sensitivity) &&
              Array.isArray(row.nameHints) &&
              row.nameHints.length > 0,
          );
        })
        .map((row: DataSecurityCustomDataType): ProjectDataTypeHints => {
          return {
            id: customDataTypeId(row.id!.toString()),
            name: (row.name || "").slice(0, 100),
            sensitivity: row.sensitivity as DataSensitivity,
            category: (row.category as DataCategory) || null,
            nameHints: (row.nameHints || []).filter(
              (hint: unknown): hint is string => {
                return typeof hint === "string";
              },
            ),
          };
        });
    } catch (error) {
      logger.warn(
        `Production review: the project's own data types could not be read, so only the catalog's are: ${error instanceof Error ? error.message : String(error)}`,
      );

      return [];
    }
  }

  /*
   * The project's stores the infrastructure points' resources are, by the
   * names the diff knows them by: a store of that name, of the resource's
   * cloud. None when none is known, or they cannot be read.
   */
  public static async readResourceStores(data: {
    projectId: ObjectID;
    candidates: Array<SensitiveDataCandidate>;
  }): Promise<Array<DataStore>> {
    const names: Array<string> = [];

    for (const candidate of data.candidates) {
      if (candidate.kind !== SensitiveDataLeakKind.Infrastructure) {
        continue;
      }

      for (const name of candidate.resourceNames || []) {
        if (name && !names.includes(name)) {
          names.push(name);
        }
      }
    }

    if (names.length === 0) {
      return [];
    }

    try {
      return await DataStoreService.findBy({
        query: {
          projectId: data.projectId,
          name: QueryHelper.findWithSameTextAnyOf(names.slice(0, 100)),
        },
        select: {
          _id: true,
          name: true,
          kind: true,
          sensitivity: true,
          sensitivityOverride: true,
          isPublicByDesign: true,
          dataTypeIds: true,
        },
        skip: 0,
        limit: MAX_STORES_READ,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.warn(
        `Production review: the stores a change's infrastructure declares could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );

      return [];
    }
  }

  /*
   * What the services' telemetry already holds of the kinds of data the
   * telemetry points write - Data Security's findings of the last days on
   * their telemetry stores - and the project's scrub rules.
   */
  public static async readTelemetryKnowledge(data: {
    projectId: ObjectID;
    candidates: Array<SensitiveDataCandidate>;
    services: Array<CodeAgentScopedService>;
    now: Date;
  }): Promise<TelemetryKnowledge> {
    const none: TelemetryKnowledge = {
      servicesByPath: new Map<string, Array<CodeAgentScopedService>>(),
      stores: [],
      findings: [],
      coverage: { rules: [] },
    };
    const telemetryCandidates: Array<SensitiveDataCandidate> =
      data.candidates.filter((candidate: SensitiveDataCandidate): boolean => {
        return candidate.kind === SensitiveDataLeakKind.Telemetry;
      });

    if (telemetryCandidates.length === 0 || data.services.length === 0) {
      return none;
    }

    // The services each file's code runs in: its own, in a monorepo.
    const servicesByPath: Map<string, Array<CodeAgentScopedService>> = new Map<
      string,
      Array<CodeAgentScopedService>
    >();

    for (const candidate of telemetryCandidates) {
      if (servicesByPath.has(candidate.path)) {
        continue;
      }

      const changed: ChangedCode = {
        files: [
          {
            path: candidate.path,
            status: "modified",
            baseLines: [],
            functionNames: [],
            routes: [],
            hasPatch: true,
          },
        ],
        fileCount: 1,
        codeFileCount: 1,
        isTruncated: false,
      };

      servicesByPath.set(
        candidate.path,
        ProductionReviewScope.getTouchedServices({
          services: data.services,
          changed,
        }),
      );
    }

    const serviceIds: Array<string> = [];

    for (const services of servicesByPath.values()) {
      for (const service of services) {
        if (!serviceIds.includes(service.id)) {
          serviceIds.push(service.id);
        }
      }
    }

    const dataTypeIds: Array<string> = [];

    for (const candidate of telemetryCandidates) {
      for (const type of candidate.dataTypes) {
        if (!dataTypeIds.includes(type.id)) {
          dataTypeIds.push(type.id);
        }
      }
    }

    if (serviceIds.length === 0) {
      return { ...none, servicesByPath };
    }

    try {
      const stores: Array<DataStore> = await DataStoreService.findBy({
        query: {
          projectId: data.projectId,
          serviceId: QueryHelper.any(serviceIds),
          kind: QueryHelper.any([
            DataStoreKind.TelemetryLogs,
            DataStoreKind.TelemetryTraces,
            DataStoreKind.TelemetryExceptions,
            DataStoreKind.TelemetryMetrics,
            DataStoreKind.TelemetryAiConversations,
          ]),
        },
        select: { _id: true, kind: true, serviceId: true },
        skip: 0,
        limit: MAX_STORES_READ,
        props: { isRoot: true },
      });

      const storeIds: Array<string> = stores
        .map((store: DataStore): string => {
          return store.id?.toString() || "";
        })
        .filter(Boolean);

      const since: Date = new Date(
        data.now.getTime() -
          SENSITIVE_DATA_LIMITS.heldBeforeDays * 24 * 60 * 60 * 1000,
      );

      const findings: Array<DataStoreFinding> =
        storeIds.length > 0 && dataTypeIds.length > 0
          ? await DataStoreFindingService.findBy({
              query: {
                projectId: data.projectId,
                dataStoreId: QueryHelper.any(storeIds),
                dataTypeId: QueryHelper.any(dataTypeIds),
                lastSeenAt: QueryHelper.greaterThanEqualTo(since),
                isSuppressed: false,
              },
              select: {
                _id: true,
                dataStoreId: true,
                dataTypeId: true,
                dataTypeName: true,
                location: true,
                lastSeenAt: true,
                isScrubbed: true,
              },
              sort: { lastSeenAt: SortOrder.Descending },
              skip: 0,
              limit: MAX_FINDINGS_READ,
              props: { isRoot: true },
            })
          : [];

      let coverage: ScrubCoverage = { rules: [] };

      try {
        coverage = await getScrubCoverage(data.projectId);
      } catch (error) {
        logger.debug(
          `Production review: the scrub rules could not be read: ${error}`,
        );
      }

      return { servicesByPath, stores, findings, coverage };
    } catch (error) {
      logger.warn(
        `Production review: what production's telemetry holds could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );

      return { ...none, servicesByPath };
    }
  }

  /*
   * A candidate as the point the review keeps - or null when what the
   * project knows says it is none: a store marked Public By Design, made
   * public; a store whose data Data Security would raise nothing for.
   */
  public static toPoint(data: {
    candidate: SensitiveDataCandidate;
    stores: Array<DataStore>;
    telemetry: TelemetryKnowledge;
    isFailOn: boolean;
    occurrences: Map<string, number>;
  }): ProductionReviewLeakJSON | null {
    const candidate: SensitiveDataCandidate = data.candidate;
    let sensitivity: DataSensitivity = candidate.sensitivity;
    let isBlocking: boolean = candidate.isBlocking;
    const production: ProductionReviewLeakProductionJSON = {};

    if (candidate.kind === SensitiveDataLeakKind.Infrastructure) {
      const store: DataStore | null = ProductionReviewSensitiveData.findStore(
        candidate,
        data.stores,
      );

      if (store) {
        if (
          store.isPublicByDesign === true &&
          PUBLIC_BY_DESIGN_CHECK_IDS.includes(candidate.checkId)
        ) {
          return null;
        }

        sensitivity = effectiveSensitivity(store);

        // Data Security raises no issue on this store for it: no point either.
        if (severityOrNull(candidate.checkId, sensitivity) === null) {
          return null;
        }

        isBlocking =
          PUBLIC_STORE_CHECK_IDS.includes(candidate.checkId) &&
          isSensitive(sensitivity);
        production.store = ProductionReviewSensitiveData.toStoreJSON(
          store,
          sensitivity,
        );
      }
    }

    if (candidate.kind === SensitiveDataLeakKind.Telemetry) {
      const known: {
        heldBefore: Array<ProductionReviewLeakHeldBeforeJSON>;
        maskedBy: string | null;
      } = ProductionReviewSensitiveData.readHeldBefore(
        candidate,
        data.telemetry,
      );

      if (known.heldBefore.length > 0) {
        production.heldBefore = known.heldBefore;
      }

      if (known.maskedBy !== null) {
        production.maskedAtIngestBy = known.maskedBy;
      }
    }

    return toLeakPoint({
      candidate,
      knownSensitivity: sensitivity,
      isBlocking,
      isFailOn: data.isFailOn,
      occurrences: data.occurrences,
      production,
    });
  }

  /*
   * The store an infrastructure candidate's resource is: one whose name is
   * one the diff knows the resource by, of the resource's cloud when the
   * resource's type says which.
   */
  public static findStore(
    candidate: SensitiveDataCandidate,
    stores: Array<DataStore>,
  ): DataStore | null {
    const names: Array<string> = (candidate.resourceNames || []).map(
      (name: string): string => {
        return name.toLowerCase();
      },
    );

    if (names.length === 0) {
      return null;
    }

    const provider: DataStoreProvider | null = providerOfResource(
      candidate.resourceType || "",
    );

    for (const name of names) {
      const store: DataStore | undefined = stores.find(
        (each: DataStore): boolean => {
          if ((each.name || "").toLowerCase() !== name) {
            return false;
          }

          const info: DataStoreKindInfo | undefined = getDataStoreKindInfo(
            each.kind,
          );

          return !provider || !info || info.provider === provider;
        },
      );

      if (store) {
        return store;
      }
    }

    return null;
  }

  private static toStoreJSON(
    store: DataStore,
    sensitivity: DataSensitivity,
  ): ProductionReviewLeakStoreJSON {
    const namer: DataTypeNamer = DataTypeNamer.withoutCustomTypes();

    return {
      dataStoreId: store.id?.toString() || "",
      name: (store.name || "").slice(0, 200),
      sensitivity,
      dataTypeNames: (Array.isArray(store.dataTypeIds) ? store.dataTypeIds : [])
        .slice(0, MAX_STORE_DATA_TYPES)
        .map((id: string): string => {
          return namer.nameOf(id);
        }),
    };
  }

  /*
   * Where the services' telemetry held what a telemetry candidate writes,
   * the nearest places first - its own location before another of the same
   * kind of data - and the scrub rule that masks it at ingest, if one does.
   */
  public static readHeldBefore(
    candidate: SensitiveDataCandidate,
    telemetry: TelemetryKnowledge,
  ): {
    heldBefore: Array<ProductionReviewLeakHeldBeforeJSON>;
    maskedBy: string | null;
  } {
    const services: Array<CodeAgentScopedService> =
      telemetry.servicesByPath.get(candidate.path) || [];
    const kinds: ReadonlyArray<DataStoreKind> = candidate.sink
      ? STORE_KINDS_OF_SINK[candidate.sink]
      : [];
    const typeIds: Set<string> = new Set<string>(
      candidate.dataTypes.map((type: { id: string }): string => {
        return type.id;
      }),
    );
    const storesById: Map<string, DataStore> = new Map<string, DataStore>();

    for (const store of telemetry.stores) {
      const serviceId: string = store.serviceId?.toString().toLowerCase() || "";

      if (
        kinds.includes(store.kind as DataStoreKind) &&
        services.some((service: CodeAgentScopedService): boolean => {
          return service.id === serviceId;
        })
      ) {
        storesById.set(store.id?.toString() || "", store);
      }
    }

    const location: string = (candidate.location || "").toLowerCase();
    const matching: Array<DataStoreFinding> = telemetry.findings.filter(
      (finding: DataStoreFinding): boolean => {
        return (
          storesById.has(finding.dataStoreId?.toString() || "") &&
          typeIds.has(finding.dataTypeId || "")
        );
      },
    );
    const sameLocationFirst: Array<DataStoreFinding> = [
      ...matching.filter((finding: DataStoreFinding): boolean => {
        return (finding.location || "").toLowerCase() === location;
      }),
      ...matching.filter((finding: DataStoreFinding): boolean => {
        return (finding.location || "").toLowerCase() !== location;
      }),
    ];

    const heldBefore: Array<ProductionReviewLeakHeldBeforeJSON> = [];
    let maskedBy: string | null = null;

    for (const finding of sameLocationFirst) {
      if (heldBefore.length >= MAX_HELD_BEFORE) {
        break;
      }

      const store: DataStore | undefined = storesById.get(
        finding.dataStoreId?.toString() || "",
      );
      const serviceId: string =
        store?.serviceId?.toString().toLowerCase() || "";
      const service: CodeAgentScopedService | undefined = services.find(
        (each: CodeAgentScopedService): boolean => {
          return each.id === serviceId;
        },
      );

      if (!store || !service || !finding.location) {
        continue;
      }

      heldBefore.push({
        serviceId: service.id,
        serviceName: service.name,
        storeKind: store.kind || "",
        location: finding.location.slice(0, 300),
        dataTypeName: (finding.dataTypeName || "").slice(0, 100),
        lastSeenAt: finding.lastSeenAt
          ? new Date(finding.lastSeenAt).toISOString()
          : "",
      });

      if (
        finding.isScrubbed &&
        maskedBy === null &&
        (finding.location || "").toLowerCase() === location
      ) {
        maskedBy = "";
      }
    }

    // A scrub rule of the service, or of every service, that reaches the place.
    for (const service of services) {
      for (const kind of kinds) {
        for (const type of candidate.dataTypes) {
          const rule: CoveringScrubRule | null = findCoveringScrubRule(
            telemetry.coverage,
            {
              kind,
              dataTypeId: type.id,
              location: candidate.location || "body",
              serviceId: service.id,
            },
          );

          if (rule) {
            return { heldBefore, maskedBy: rule.name.slice(0, 200) };
          }
        }
      }
    }

    return { heldBefore, maskedBy };
  }
}

// What a review reads of production's telemetry for its telemetry points.
export interface TelemetryKnowledge {
  servicesByPath: Map<string, Array<CodeAgentScopedService>>;
  stores: Array<DataStore>;
  findings: Array<DataStoreFinding>;
  coverage: ScrubCoverage;
}

/*
 * The severity the catalog gives a check at a store's sensitivity, or null
 * where Data Security raises no issue for it at all: no point either.
 */
function severityOrNull(
  checkId: string,
  sensitivity: DataSensitivity,
): SecuritySeverity | null {
  return (
    getDataSecurityCheck(checkId)?.severityBySensitivity[sensitivity] ?? null
  );
}
