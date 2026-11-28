import DataAssetService from "../../../Services/DataAssetService";
import DataAssetUsageService from "../../../Services/DataAssetUsageService";
import DataSecurityCustomDataTypeService from "../../../Services/DataSecurityCustomDataTypeService";
import DataStoreFindingService from "../../../Services/DataStoreFindingService";
import DataStoreService from "../../../Services/DataStoreService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import { DataStoreLocationKind } from "../../DataSecurity/DataSecurityScanTypes";
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
import ProductionReviewScope, {
  ProductionReviewRumApplication,
} from "./ProductionReviewScope";
import {
  SensitiveDataCandidate,
  toLeakPoint,
} from "./SensitiveData/SensitiveDataCandidate";
import { ProjectDataTypeHints } from "./SensitiveData/SensitiveDataNames";
import SensitiveDataRules, {
  SensitiveDataRulesResult,
} from "./SensitiveData/SensitiveDataRules";
import DataAsset from "../../../../Models/DatabaseModels/DataAsset";
import DataAssetUsage from "../../../../Models/DatabaseModels/DataAssetUsage";
import DataSecurityCustomDataType from "../../../../Models/DatabaseModels/DataSecurityCustomDataType";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import Includes from "../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import {
  EXPOSURES_A_COLUMN_INHERITS,
  ProductionReviewLeakHeldBeforeJSON,
  ProductionReviewLeakJSON,
  ProductionReviewLeakProductionJSON,
  ProductionReviewLeakStoreJSON,
  ProductionReviewLeakTableColumnJSON,
  ProductionReviewLeakTableJSON,
  ProductionReviewSensitiveDataJSON,
  PUBLIC_BY_DESIGN_CHECK_IDS,
  PUBLIC_STORE_CHECK_IDS,
  SENSITIVE_DATA_LIMITS,
  SensitiveDataLeakKind,
  SensitiveDataSink,
} from "../../../../Types/CodeRepository/ProductionReviewSensitiveData";
import { customDataTypeId } from "../../../../Types/DataSecurity/CustomDataTypeId";
import DataCategory from "../../../../Types/DataSecurity/DataCategory";
import {
  readTelemetryDataStoreKeyOwnerId,
  telemetryDataStoreKey,
} from "../../../../Types/DataSecurity/DataStoreKey";
import {
  getDataSecurityCheck,
  isFindingCounted,
} from "../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataStoreEnvironment from "../../../../Types/DataSecurity/DataStoreEnvironment";
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
import { getRumSessionPart } from "../../../../Types/DataSecurity/RumSessionPlaces";
import {
  getRumTelemetryLeakSignal,
  TelemetryLeakFixOwnerKind,
  TelemetryLeakSignal,
} from "../../../../Types/DataSecurity/TelemetryLeakFix";
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
 *     Security's findings on the service's telemetry stores, and, for a
 *     web or mobile app's front-end code (#11395), on its RUM
 *     application's session replays - a browser log's
 *     `logs.attributes.user.email`, a session's user
 *     `sessions.identifiedUserLabel`, a session's tag
 *     `sessions.tags.customer` (#11458; ProductionReviewScope says which
 *     code is a front end's); and whether a scrub rule already masks it
 *     at ingest, which is still a point: the code writes it, and every
 *     place that reads it before ingest - the collector, a log file,
 *     another vendor - reads it whole;
 *   - infrastructure: the project's store the resource is, found by the
 *     names the diff knows it by - its sensitivity says how bad the point
 *     is, and a store marked Public By Design makes no point for being
 *     public at all;
 *   - migrations (#10779), for a private repository alone: the store the
 *     table a column is added to is in - by Data Security's findings in its
 *     columns, and by the tables Data Observability watches in it, the
 *     repository's own services' first - what that store holds, whether it
 *     is reachable from outside or unencrypted, which the new column then
 *     is too, and the table's columns already found holding what the new
 *     one is for. It says nothing of how bad the point is: the new column's
 *     own data says that.
 *
 * Everything production knows is kept apart from what the diff shows
 * (ProductionReviewLeakJSON.production), so a public repository's comment,
 * and a reader who may not read Data Security, are shown the point
 * without it. Read as OneUptime: what a reader may see of it is decided
 * where the review is read (ProductionReviewReadFilter).
 */

/*
 * How each sink's writes reach production's telemetry: the store kinds
 * that hold them - a service's, and a RUM application's session replays
 * for what a web or mobile app's front end writes (#11395): its browser
 * logs, its browser spans and its sessions' users.
 */
export const STORE_KINDS_OF_SINK: Readonly<
  Record<SensitiveDataSink, ReadonlyArray<DataStoreKind>>
> = {
  [SensitiveDataSink.Log]: [
    DataStoreKind.TelemetryLogs,
    DataStoreKind.TelemetrySessionReplays,
  ],
  [SensitiveDataSink.Span]: [
    DataStoreKind.TelemetryTraces,
    DataStoreKind.TelemetryExceptions,
    DataStoreKind.TelemetrySessionReplays,
  ],
  [SensitiveDataSink.Metric]: [DataStoreKind.TelemetryMetrics],
  [SensitiveDataSink.AiPrompt]: [DataStoreKind.TelemetryAiConversations],
  // An exception's message and what reports it: the service's exceptions (#10778).
  [SensitiveDataSink.Exception]: [DataStoreKind.TelemetryExceptions],
  // Who a recorded session is: a RUM application's sessions, never a service's.
  [SensitiveDataSink.Session]: [DataStoreKind.TelemetrySessionReplays],
};

/*
 * Where in a RUM application's session replays a sink's write lands
 * (#11395): the store holds three kinds of record, so a point is matched
 * only to findings of its own kind - a browser log's attribute to a Log
 * point, a session's user to a Session point - at its place with that
 * kind's prefix (`attributes.user.email` is `logs.attributes.user.email`;
 * a session's place, `sessions.identifiedUserLabel`, is its own).
 */
export const SESSION_REPLAY_PLACE_OF_SINK: Readonly<
  Partial<
    Record<SensitiveDataSink, { signal: TelemetryLeakSignal; prefix: string }>
  >
> = {
  [SensitiveDataSink.Log]: {
    signal: TelemetryLeakSignal.RumLogs,
    prefix: "logs.",
  },
  [SensitiveDataSink.Span]: {
    signal: TelemetryLeakSignal.RumSpans,
    prefix: "spans.",
  },
  [SensitiveDataSink.Session]: {
    signal: TelemetryLeakSignal.RumSessions,
    prefix: "",
  },
};

// The places of production one point names: the nearest few.
const MAX_HELD_BEFORE: number = 2;

// The findings of the services' telemetry read for one review.
const MAX_FINDINGS_READ: number = 500;

// The stores read for one review's resources.
const MAX_STORES_READ: number = 50;

// A store's own data types it names, the most sensitive first.
const MAX_STORE_DATA_TYPES: number = 3;

// The tables of one review's migrations looked up (#10779).
const MAX_TABLES_READ: number = 5;

// The findings of one table's columns read.
const MAX_TABLE_FINDINGS_READ: number = 200;

// The watched tables of one review's table names read.
const MAX_TABLE_ASSETS_READ: number = 50;

// The columns a migration's point names of what its table already holds.
const MAX_SAME_DATA_COLUMNS: number = 3;

// A table's kinds of data a point names, the most sensitive first.
const MAX_TABLE_DATA_TYPES: number = 3;

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
    /*
     * Whether the repository is private, as its host says - asked only when
     * a migration's point could be told what Data Security knows of its
     * table (#10779), which a public repository's review never is. Unset:
     * not private.
     */
    isRepositoryPrivate?: (() => Promise<boolean>) | undefined;
    /*
     * The RUM applications the repository is the front end of
     * (ProductionReviewScope.getRumApplications) - asked only when a
     * telemetry point could have been written by a web or mobile app's
     * code (#11395). Unset: none.
     */
    rumApplications?:
      | (() => Promise<Array<ProductionReviewRumApplication>>)
      | undefined;
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
        rumApplications: data.rumApplications,
      });

    // A migration's table, for a private repository alone (#10779).
    const tables: TableKnowledge =
      ProductionReviewSensitiveData.getTableNames(rules.candidates).length >
        0 &&
      data.isRepositoryPrivate &&
      (await data.isRepositoryPrivate())
        ? await ProductionReviewSensitiveData.readTableKnowledge({
            projectId: data.projectId,
            candidates: rules.candidates,
            services: data.services,
          })
        : NO_TABLES;

    const points: Array<ProductionReviewLeakJSON> = [];
    const occurrences: Map<string, number> = new Map<string, number>();

    for (const candidate of rules.candidates) {
      const point: ProductionReviewLeakJSON | null =
        ProductionReviewSensitiveData.toPoint({
          candidate,
          stores,
          telemetry,
          tables,
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
   * their telemetry stores, and on the session replays of the RUM
   * applications whose front end a point's file may be (#11395) - and the
   * project's scrub rules.
   */
  public static async readTelemetryKnowledge(data: {
    projectId: ObjectID;
    candidates: Array<SensitiveDataCandidate>;
    services: Array<CodeAgentScopedService>;
    now: Date;
    rumApplications?:
      | (() => Promise<Array<ProductionReviewRumApplication>>)
      | undefined;
  }): Promise<TelemetryKnowledge> {
    const none: TelemetryKnowledge = {
      servicesByPath: new Map<string, Array<CodeAgentScopedService>>(),
      applicationsByPath: new Map<
        string,
        Array<ProductionReviewRumApplication>
      >(),
      stores: [],
      findings: [],
      coverage: { rules: [] },
    };
    const telemetryCandidates: Array<SensitiveDataCandidate> =
      data.candidates.filter((candidate: SensitiveDataCandidate): boolean => {
        return candidate.kind === SensitiveDataLeakKind.Telemetry;
      });

    if (telemetryCandidates.length === 0) {
      return none;
    }

    // The services each file's code runs in: its own, in a monorepo.
    const servicesByPath: Map<string, Array<CodeAgentScopedService>> = new Map<
      string,
      Array<CodeAgentScopedService>
    >();

    for (const candidate of telemetryCandidates) {
      if (data.services.length === 0 || servicesByPath.has(candidate.path)) {
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

    const applicationsByPath: Map<
      string,
      Array<ProductionReviewRumApplication>
    > = await ProductionReviewSensitiveData.readApplicationsByPath({
      candidates: telemetryCandidates,
      rumApplications: data.rumApplications,
    });

    const serviceIds: Array<string> = [];

    for (const services of servicesByPath.values()) {
      for (const service of services) {
        if (!serviceIds.includes(service.id)) {
          serviceIds.push(service.id);
        }
      }
    }

    const applicationIds: Array<string> = [];

    for (const applications of applicationsByPath.values()) {
      for (const application of applications) {
        if (!applicationIds.includes(application.id)) {
          applicationIds.push(application.id);
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

    if (serviceIds.length === 0 && applicationIds.length === 0) {
      return { ...none, servicesByPath, applicationsByPath };
    }

    try {
      const stores: Array<DataStore> =
        serviceIds.length > 0
          ? await DataStoreService.findBy({
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
            })
          : [];

      // A RUM application's session replays: no service's, keyed by the application (#11395).
      if (applicationIds.length > 0) {
        stores.push(
          ...(await DataStoreService.findBy({
            query: {
              projectId: data.projectId,
              kind: DataStoreKind.TelemetrySessionReplays,
              storeKey: QueryHelper.any(
                applicationIds.map((id: string): string => {
                  return telemetryDataStoreKey({
                    serviceId: id,
                    kind: DataStoreKind.TelemetrySessionReplays,
                  });
                }),
              ),
            },
            select: { _id: true, kind: true, storeKey: true },
            skip: 0,
            limit: MAX_STORES_READ,
            props: { isRoot: true },
          })),
        );
      }

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

      return { servicesByPath, applicationsByPath, stores, findings, coverage };
    } catch (error) {
      logger.warn(
        `Production review: what production's telemetry holds could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );

      return { ...none, servicesByPath, applicationsByPath };
    }
  }

  /*
   * The RUM applications each telemetry point's file may be the front end
   * of (#11395, ProductionReviewScope.getFrontEndApplications): asked of
   * the repository only when a point writes where a front end can - a
   * log, a span or a session's user - from a file a browser or a mobile
   * app may run. None when they cannot be read: the points stand.
   */
  public static async readApplicationsByPath(data: {
    candidates: Array<SensitiveDataCandidate>;
    rumApplications?:
      | (() => Promise<Array<ProductionReviewRumApplication>>)
      | undefined;
  }): Promise<Map<string, Array<ProductionReviewRumApplication>>> {
    const byPath: Map<string, Array<ProductionReviewRumApplication>> = new Map<
      string,
      Array<ProductionReviewRumApplication>
    >();
    const frontEndCandidates: Array<SensitiveDataCandidate> =
      data.candidates.filter((candidate: SensitiveDataCandidate): boolean => {
        return (
          candidate.kind === SensitiveDataLeakKind.Telemetry &&
          candidate.sink !== undefined &&
          SESSION_REPLAY_PLACE_OF_SINK[candidate.sink] !== undefined &&
          ProductionReviewScope.mayBeFrontEnd(candidate.path)
        );
      });

    if (frontEndCandidates.length === 0 || !data.rumApplications) {
      return byPath;
    }

    let applications: Array<ProductionReviewRumApplication> = [];

    try {
      applications = await data.rumApplications();
    } catch (error) {
      logger.debug(
        `Production review: the RUM applications could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (applications.length === 0) {
      return byPath;
    }

    for (const candidate of frontEndCandidates) {
      if (!byPath.has(candidate.path)) {
        byPath.set(
          candidate.path,
          ProductionReviewScope.getFrontEndApplications({
            path: candidate.path,
            applications,
          }),
        );
      }
    }

    return byPath;
  }

  /*
   * The tables the migration candidates add columns to, as their rules
   * name them, in lower case, each once - as many as a review looks up.
   */
  public static getTableNames(
    candidates: Array<SensitiveDataCandidate>,
  ): Array<string> {
    const tables: Array<string> = [];

    for (const candidate of candidates) {
      const table: string = (candidate.where || "").trim().toLowerCase();

      if (
        candidate.kind === SensitiveDataLeakKind.Migration &&
        table &&
        !tables.includes(table)
      ) {
        tables.push(table);
      }
    }

    return tables.slice(0, MAX_TABLES_READ);
  }

  /*
   * What Data Security knows of the tables the migration candidates add
   * columns to (#10779): the findings in their columns, the watched tables
   * named like them - and which of those the repository's own services
   * read or write - and the stores they are all in. Read as OneUptime: who
   * may see it is decided where the review is read. Nothing when it cannot
   * be read: the points stand as the diff alone says them.
   */
  public static async readTableKnowledge(data: {
    projectId: ObjectID;
    candidates: Array<SensitiveDataCandidate>;
    services: Array<CodeAgentScopedService>;
  }): Promise<TableKnowledge> {
    const tables: Array<string> = ProductionReviewSensitiveData.getTableNames(
      data.candidates,
    );

    if (tables.length === 0) {
      return NO_TABLES;
    }

    try {
      const findings: Array<DataStoreFinding> = [];

      // A table at a time: its name followed by a column, in any schema.
      for (const table of tables) {
        const read: Array<DataStoreFinding> =
          await DataStoreFindingService.findBy({
            query: {
              projectId: data.projectId,
              locationKind: DataStoreLocationKind.Column,
              location: QueryHelper.search(`${table}.`),
              isSuppressed: false,
            },
            select: {
              _id: true,
              dataStoreId: true,
              dataTypeId: true,
              dataTypeName: true,
              sensitivity: true,
              location: true,
              lastSeenAt: true,
              matchCount: true,
              isConfirmed: true,
              isAiSuggested: true,
              isSuppressed: true,
            },
            sort: { lastSeenAt: SortOrder.Descending },
            skip: 0,
            limit: MAX_TABLE_FINDINGS_READ,
            props: { isRoot: true },
          });

        findings.push(
          ...read.filter((finding: DataStoreFinding): boolean => {
            return (
              isFindingCounted(finding) &&
              parseColumnLocation(finding.location || "", table) !== null
            );
          }),
        );
      }

      const assets: Array<DataAsset> = await DataAssetService.findBy({
        query: {
          projectId: data.projectId,
          isDropped: false,
          name: QueryHelper.findWithSameTextAnyOf(tables),
        },
        select: { _id: true, name: true, schemaName: true, dataStoreId: true },
        skip: 0,
        limit: MAX_TABLE_ASSETS_READ,
        props: { isRoot: true },
      });

      // The watched tables the repository's own services read or write.
      const usedAssetIds: Set<string> = new Set<string>();
      const assetIds: Array<ObjectID> = assets
        .map((asset: DataAsset): ObjectID | undefined => {
          return asset.id || undefined;
        })
        .filter((id: ObjectID | undefined): id is ObjectID => {
          return Boolean(id);
        });

      if (assetIds.length > 0 && data.services.length > 0) {
        const usages: Array<DataAssetUsage> =
          await DataAssetUsageService.findBy({
            query: {
              projectId: data.projectId,
              dataAssetId: new Includes(assetIds),
              serviceId: new Includes(
                data.services.map((service: CodeAgentScopedService) => {
                  return new ObjectID(service.id);
                }),
              ),
            },
            select: { dataAssetId: true },
            skip: 0,
            limit: MAX_TABLE_ASSETS_READ * 2,
            props: { isRoot: true },
          });

        for (const usage of usages) {
          usedAssetIds.add(usage.dataAssetId?.toString().toLowerCase() || "");
        }
      }

      const storeIds: Array<string> = [];

      for (const id of [
        ...findings.map((finding: DataStoreFinding): string => {
          return finding.dataStoreId?.toString() || "";
        }),
        ...assets.map((asset: DataAsset): string => {
          return asset.dataStoreId?.toString() || "";
        }),
      ]) {
        if (id && !storeIds.includes(id)) {
          storeIds.push(id);
        }
      }

      const stores: Array<DataStore> =
        storeIds.length > 0
          ? await DataStoreService.findBy({
              query: {
                projectId: data.projectId,
                _id: QueryHelper.any(storeIds.slice(0, MAX_STORES_READ)),
              },
              select: {
                _id: true,
                name: true,
                kind: true,
                sensitivity: true,
                sensitivityOverride: true,
                dataTypeIds: true,
                exposure: true,
                posture: true,
                environment: true,
                isArchived: true,
              },
              skip: 0,
              limit: MAX_STORES_READ,
              props: { isRoot: true },
            })
          : [];

      return {
        stores: stores.filter((store: DataStore): boolean => {
          return store.isArchived !== true;
        }),
        findings,
        assets: assets.map((asset: DataAsset): TableAsset => {
          return {
            dataStoreId: asset.dataStoreId?.toString() || "",
            name: asset.name || "",
            schemaName: asset.schemaName || "",
            isUsedByRepository: usedAssetIds.has(
              asset.id?.toString().toLowerCase() || "",
            ),
          };
        }),
      };
    } catch (error) {
      logger.warn(
        `Production review: what Data Security knows of a migration's tables could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );

      return NO_TABLES;
    }
  }

  /*
   * What Data Security knows of a migration candidate's table: the store
   * it is in - the one the repository's own services use, else one of
   * production's, else the one whose columns were found holding data most
   * lately - and what that store and the table hold. Null when no store of
   * the project is known to hold a table of that name.
   */
  public static readTableKnown(
    candidate: SensitiveDataCandidate,
    knowledge: TableKnowledge,
  ): {
    store: ProductionReviewLeakStoreJSON;
    table: ProductionReviewLeakTableJSON;
  } | null {
    const table: string = (candidate.where || "").trim().toLowerCase();

    if (candidate.kind !== SensitiveDataLeakKind.Migration || !table) {
      return null;
    }

    const findings: Array<DataStoreFinding> = knowledge.findings.filter(
      (finding: DataStoreFinding): boolean => {
        return parseColumnLocation(finding.location || "", table) !== null;
      },
    );
    const assets: Array<TableAsset> = knowledge.assets.filter(
      (asset: TableAsset): boolean => {
        return asset.name.toLowerCase() === table && Boolean(asset.dataStoreId);
      },
    );
    const storeIdOf: (value: ObjectID | string | undefined) => string = (
      value: ObjectID | string | undefined,
    ): string => {
      return (value || "").toString().toLowerCase();
    };
    const holding: Array<DataStore> = knowledge.stores.filter(
      (store: DataStore): boolean => {
        const id: string = storeIdOf(store.id || undefined);

        return (
          Boolean(id) &&
          (findings.some((finding: DataStoreFinding): boolean => {
            return storeIdOf(finding.dataStoreId) === id;
          }) ||
            assets.some((asset: TableAsset): boolean => {
              return storeIdOf(asset.dataStoreId) === id;
            }))
        );
      },
    );

    if (holding.length === 0) {
      return null;
    }

    const rankOf: (store: DataStore) => Array<number> = (
      store: DataStore,
    ): Array<number> => {
      const id: string = storeIdOf(store.id || undefined);
      const own: Array<DataStoreFinding> = findings.filter(
        (finding: DataStoreFinding): boolean => {
          return storeIdOf(finding.dataStoreId) === id;
        },
      );
      const newest: number = own.reduce(
        (latest: number, finding: DataStoreFinding): number => {
          const at: number = finding.lastSeenAt
            ? new Date(finding.lastSeenAt).getTime()
            : 0;

          return Math.max(latest, Number.isFinite(at) ? at : 0);
        },
        0,
      );

      return [
        assets.some((asset: TableAsset): boolean => {
          return (
            storeIdOf(asset.dataStoreId) === id && asset.isUsedByRepository
          );
        })
          ? 1
          : 0,
        store.environment === DataStoreEnvironment.Production ? 1 : 0,
        own.length > 0 ? 1 : 0,
        newest,
      ];
    };

    const ranked: Array<DataStore> = [...holding].sort(
      (a: DataStore, b: DataStore): number => {
        const rankA: Array<number> = rankOf(a);
        const rankB: Array<number> = rankOf(b);

        for (let index: number = 0; index < rankA.length; index++) {
          if (rankA[index] !== rankB[index]) {
            return rankB[index]! - rankA[index]!;
          }
        }

        return (a.name || "").localeCompare(b.name || "");
      },
    );
    const store: DataStore = ranked[0]!;
    const storeId: string = storeIdOf(store.id || undefined);
    const inStore: Array<DataStoreFinding> = findings
      .filter((finding: DataStoreFinding): boolean => {
        return storeIdOf(finding.dataStoreId) === storeId;
      })
      .sort((a: DataStoreFinding, b: DataStoreFinding): number => {
        return timeOf(b.lastSeenAt) - timeOf(a.lastSeenAt);
      });
    const asset: TableAsset | undefined = assets.find(
      (each: TableAsset): boolean => {
        return storeIdOf(each.dataStoreId) === storeId;
      },
    );
    const typeIds: Set<string> = new Set<string>(
      candidate.dataTypes.map((type: { id: string }): string => {
        return type.id;
      }),
    );
    const located: ParsedColumnLocation | null = inStore[0]
      ? parseColumnLocation(inStore[0].location || "", table)
      : null;

    return {
      store: {
        ...ProductionReviewSensitiveData.toStoreJSON(
          store,
          effectiveSensitivity(store),
        ),
        ...(store.exposure &&
        EXPOSURES_A_COLUMN_INHERITS.includes(store.exposure)
          ? { exposure: store.exposure }
          : {}),
        ...(store.posture?.encryptedAtRest === false
          ? { isNotEncryptedAtRest: true }
          : {}),
      },
      table: {
        name: (
          located?.table ||
          (asset
            ? [asset.schemaName, asset.name].filter(Boolean).join(".")
            : "") ||
          candidate.where ||
          ""
        ).slice(0, 200),
        dataTypeNames: namesBySensitivity(inStore).slice(
          0,
          MAX_TABLE_DATA_TYPES,
        ),
        sameData: inStore
          .filter((finding: DataStoreFinding): boolean => {
            return typeIds.has(finding.dataTypeId || "");
          })
          .slice(0, MAX_SAME_DATA_COLUMNS)
          .map(
            (
              finding: DataStoreFinding,
            ): ProductionReviewLeakTableColumnJSON => {
              return {
                location: (finding.location || "").slice(0, 300),
                dataTypeName: (finding.dataTypeName || "").slice(0, 100),
                lastSeenAt: finding.lastSeenAt
                  ? new Date(finding.lastSeenAt).toISOString()
                  : "",
              };
            },
          ),
        otherStoreCount: ranked.length - 1,
      },
    };
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
    // What Data Security knows of migrations' tables: none for a public repository.
    tables?: TableKnowledge | undefined;
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

    /*
     * A migration's table: the store it is in and what it holds - which
     * sharpens what the point says, never how bad it is.
     */
    if (candidate.kind === SensitiveDataLeakKind.Migration && data.tables) {
      const known: {
        store: ProductionReviewLeakStoreJSON;
        table: ProductionReviewLeakTableJSON;
      } | null = ProductionReviewSensitiveData.readTableKnown(
        candidate,
        data.tables,
      );

      if (known) {
        production.store = known.store;
        production.table = known.table;
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
   * Where production's telemetry held what a telemetry candidate writes,
   * the nearest places first - its own location before another of the same
   * kind of data - and the scrub rule that masks it at ingest, if one does:
   * the services' telemetry, and the session replays of the RUM
   * applications whose front end the candidate's file may be (#11395) -
   * there, only the findings of the candidate's own kind of record, at its
   * place with that record's prefix (SESSION_REPLAY_PLACE_OF_SINK).
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
    const applications: Array<ProductionReviewRumApplication> =
      telemetry.applicationsByPath?.get(candidate.path) || [];
    const kinds: ReadonlyArray<DataStoreKind> = candidate.sink
      ? STORE_KINDS_OF_SINK[candidate.sink]
      : [];
    const replayPlace: { signal: TelemetryLeakSignal; prefix: string } | null =
      (candidate.sink && SESSION_REPLAY_PLACE_OF_SINK[candidate.sink]) || null;
    const replayLocation: string = replayPlace
      ? `${replayPlace.prefix}${candidate.location || "body"}`
      : "";
    const typeIds: Set<string> = new Set<string>(
      candidate.dataTypes.map((type: { id: string }): string => {
        return type.id;
      }),
    );
    const placesByStore: Map<string, HeldPlace> = new Map<string, HeldPlace>();

    for (const store of telemetry.stores) {
      const storeId: string = store.id?.toString() || "";

      if (!storeId || !kinds.includes(store.kind as DataStoreKind)) {
        continue;
      }

      // A RUM application's session replays: the application its key names.
      if (store.kind === DataStoreKind.TelemetrySessionReplays) {
        const ownerId: string = (
          readTelemetryDataStoreKeyOwnerId(store.storeKey) || ""
        ).toLowerCase();
        const application: ProductionReviewRumApplication | undefined =
          applications.find((each: ProductionReviewRumApplication): boolean => {
            return each.id === ownerId;
          });

        if (application && replayPlace) {
          placesByStore.set(storeId, {
            store,
            ownerId: application.id,
            ownerName: application.name,
            ownerKind: TelemetryLeakFixOwnerKind.RumApplication,
            location: replayLocation.toLowerCase(),
            signal: replayPlace.signal,
          });
        }

        continue;
      }

      const serviceId: string = store.serviceId?.toString().toLowerCase() || "";
      const service: CodeAgentScopedService | undefined = services.find(
        (each: CodeAgentScopedService): boolean => {
          return each.id === serviceId;
        },
      );

      if (service) {
        placesByStore.set(storeId, {
          store,
          ownerId: service.id,
          ownerName: service.name,
          ownerKind: null,
          location: (candidate.location || "").toLowerCase(),
          signal: null,
        });
      }
    }

    const placeOf: (finding: DataStoreFinding) => HeldPlace | undefined = (
      finding: DataStoreFinding,
    ): HeldPlace | undefined => {
      return placesByStore.get(finding.dataStoreId?.toString() || "");
    };
    const isAtItsPlace: (finding: DataStoreFinding) => boolean = (
      finding: DataStoreFinding,
    ): boolean => {
      return (
        (finding.location || "").toLowerCase() === placeOf(finding)?.location
      );
    };
    const matching: Array<DataStoreFinding> = telemetry.findings.filter(
      (finding: DataStoreFinding): boolean => {
        const place: HeldPlace | undefined = placeOf(finding);

        return Boolean(
          place &&
            typeIds.has(finding.dataTypeId || "") &&
            // A session replay's finding of the candidate's own kind of record alone.
            (place.signal === null ||
              (getRumTelemetryLeakSignal(place.store.kind, finding.location) ===
                place.signal &&
                /*
                 * And of a session, its own part (#11458): a tag's point is
                 * told of what the sessions' tags held, a user's of what
                 * their users' details held - two audiences apart.
                 */
                (place.signal !== TelemetryLeakSignal.RumSessions ||
                  getRumSessionPart(finding.location) ===
                    getRumSessionPart(place.location)))),
        );
      },
    );
    const sameLocationFirst: Array<DataStoreFinding> = [
      ...matching.filter(isAtItsPlace),
      ...matching.filter((finding: DataStoreFinding): boolean => {
        return !isAtItsPlace(finding);
      }),
    ];

    const heldBefore: Array<ProductionReviewLeakHeldBeforeJSON> = [];
    let maskedBy: string | null = null;

    for (const finding of sameLocationFirst) {
      if (heldBefore.length >= MAX_HELD_BEFORE) {
        break;
      }

      const place: HeldPlace | undefined = placeOf(finding);

      if (!place || !finding.location) {
        continue;
      }

      heldBefore.push({
        serviceId: place.ownerId,
        serviceName: place.ownerName,
        ...(place.ownerKind ? { ownerKind: place.ownerKind } : {}),
        storeKind: place.store.kind || "",
        location: finding.location.slice(0, 300),
        dataTypeName: (finding.dataTypeName || "").slice(0, 100),
        lastSeenAt: finding.lastSeenAt
          ? new Date(finding.lastSeenAt).toISOString()
          : "",
      });

      if (finding.isScrubbed && maskedBy === null && isAtItsPlace(finding)) {
        maskedBy = "";
      }
    }

    // A scrub rule of the service, or of every service, that reaches the place.
    for (const service of services) {
      for (const kind of kinds) {
        if (kind === DataStoreKind.TelemetrySessionReplays) {
          continue;
        }

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

    /*
     * A front end's records are no service's: only a rule of every
     * service reaches its browser logs and spans (#11395), and of a
     * session's details its tags alone (#11458) - none a session's user.
     */
    if (
      replayPlace &&
      applications.length > 0 &&
      kinds.includes(DataStoreKind.TelemetrySessionReplays)
    ) {
      for (const type of candidate.dataTypes) {
        const rule: CoveringScrubRule | null = findCoveringScrubRule(
          telemetry.coverage,
          {
            kind: DataStoreKind.TelemetrySessionReplays,
            dataTypeId: type.id,
            location: replayLocation,
          },
        );

        if (rule) {
          return { heldBefore, maskedBy: rule.name.slice(0, 200) };
        }
      }
    }

    return { heldBefore, maskedBy };
  }
}

// One store a telemetry candidate's writes reach: whose it is, and where in it they land.
interface HeldPlace {
  store: DataStore;
  // A service's, or a RUM application's (ownerKind).
  ownerId: string;
  ownerName: string;
  ownerKind: TelemetryLeakFixOwnerKind | null;
  // Where in the store, lower case: `attributes.email`, `logs.attributes.email`.
  location: string;
  // A session replay store's kind of record the write is; null for a service's store.
  signal: TelemetryLeakSignal | null;
}

// What a review reads of production's telemetry for its telemetry points.
export interface TelemetryKnowledge {
  servicesByPath: Map<string, Array<CodeAgentScopedService>>;
  /*
   * The RUM applications each file may be the front end of (#11395), whose
   * session replays `stores` holds too. Unset: none.
   */
  applicationsByPath?:
    | Map<string, Array<ProductionReviewRumApplication>>
    | undefined;
  stores: Array<DataStore>;
  findings: Array<DataStoreFinding>;
  coverage: ScrubCoverage;
}

// A table Data Observability watches, named like a migration's.
export interface TableAsset {
  dataStoreId: string;
  name: string;
  schemaName: string;
  // A service the repository serves reads or writes it.
  isUsedByRepository: boolean;
}

/*
 * What a review reads of the tables its migrations add columns to
 * (#10779): the stores that hold them, the findings in their columns, and
 * the watched tables named like them.
 */
export interface TableKnowledge {
  stores: Array<DataStore>;
  findings: Array<DataStoreFinding>;
  assets: Array<TableAsset>;
}

export const NO_TABLES: TableKnowledge = {
  stores: [],
  findings: [],
  assets: [],
};

// A column's location, read for a table: the table as the store names it, and the column.
export interface ParsedColumnLocation {
  // The table with what comes before it: "public.customers".
  table: string;
  column: string;
}

/*
 * A finding's location of a database column - "schema.table.column", a
 * warehouse's "table.column", a database's "db.schema.table.column" - read
 * for `table`: null when it is a column of another table.
 */
export function parseColumnLocation(
  location: string,
  table: string,
): ParsedColumnLocation | null {
  const parts: Array<string> = location.split(".");
  const wanted: string = table.trim().toLowerCase();

  // The table is one of the first three parts, and a column follows it.
  for (let index: number = 0; index < Math.min(3, parts.length - 1); index++) {
    if ((parts[index] || "").toLowerCase() === wanted) {
      const column: string = parts.slice(index + 1).join(".");

      return column
        ? { table: parts.slice(0, index + 1).join("."), column }
        : null;
    }
  }

  return null;
}

function timeOf(value: Date | string | undefined): number {
  const time: number = value ? new Date(value).getTime() : 0;

  return Number.isFinite(time) ? time : 0;
}

// The kinds of data findings name, the most sensitive first, each once.
function namesBySensitivity(findings: Array<DataStoreFinding>): Array<string> {
  const ranked: Array<DataStoreFinding> = [...findings].sort(
    (a: DataStoreFinding, b: DataStoreFinding): number => {
      const rankA: number = isDataSensitivity(a.sensitivity)
        ? DATA_SENSITIVITY_RANK[a.sensitivity]
        : 0;
      const rankB: number = isDataSensitivity(b.sensitivity)
        ? DATA_SENSITIVITY_RANK[b.sensitivity]
        : 0;

      return rankB - rankA;
    },
  );
  const names: Array<string> = [];

  for (const finding of ranked) {
    const name: string = (finding.dataTypeName || "").slice(0, 100);

    if (name && !names.includes(name)) {
      names.push(name);
    }
  }

  return names;
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
