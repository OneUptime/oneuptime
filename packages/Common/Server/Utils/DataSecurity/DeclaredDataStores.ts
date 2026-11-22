import DataStore from "../../../Models/DatabaseModels/DataStore";
import LogScrubRule from "../../../Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "../../../Models/DatabaseModels/TraceScrubRule";
import NetworkFlow from "../../../Models/AnalyticsModels/NetworkFlow";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import Includes from "../../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../../Types/Date";
import { DataSecurityDeclaredStore } from "../../../Types/DataSecurity/DataSecurityApiTypes";
import { getBuiltInDataType } from "../../../Types/DataSecurity/DataTypeCatalog";
import {
  DECLARED_DATA_STORE_KINDS,
  DataStoreKind,
  DataStoreKindInfo,
  getDataStoreKindInfo,
} from "../../../Types/DataSecurity/DataStoreKind";
import { DataStoreExposure } from "../../../Types/DataSecurity/DataStorePosture";
import {
  DECLARED_DATA_STORES,
  DECLARED_STORE_PURPOSE,
  DeclaredDataStoreInfo,
  DeclaredStoreReaders,
  DeclaredStoreRetentionBasis,
  getDeclaredDataStore,
  getDeclaredRetentionText,
  getFixedDeclaredRetentionInDays,
} from "../../../Types/DataSecurity/DeclaredDataStore";
import LogScrubAction from "../../../Types/Log/LogScrubAction";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../Types/ObjectID";
import Permission, { PermissionHelper } from "../../../Types/Permission";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import DataStoreService from "../../Services/DataStoreService";
import LogScrubRuleService from "../../Services/LogScrubRuleService";
import NetworkFlowService from "../../Services/NetworkFlowService";
import SecurityEventService from "../../Services/SecurityEventService";
import TraceScrubRuleService from "../../Services/TraceScrubRuleService";
import SecurityEventRetention from "../SecurityEvent/SecurityEventRetention";
import SecurityEventsReadTelemetry from "../SecurityEvent/SecurityEventsReadTelemetry";
import logger from "../Logger";

/*
 * THE STORES ONEUPTIME KEEPS FOR A PROJECT'S SECURITY, DECLARED (#10398).
 *
 * Security Events' events, the network flows a project's devices report
 * and Security Events' address vault (#10395) hold IP addresses by design
 * (Types/DataSecurity/DeclaredDataStore). A record of processing that left
 * them out would be incomplete exactly where an auditor asks. So each is a
 * data store of the project - one row, keyed by its kind - from the first
 * time the project has such data until it has none left:
 *
 *   - Security Events: while the project keeps a security event, asked of
 *     the table with SELECT 1 ... LIMIT 1 (existsBy), which reads no event;
 *   - Network Flows: while it keeps a flow, asked the same way;
 *   - Security Address Vault: never asked of the vault, which nothing but
 *     Security Events' scans and ingest's writer may reach
 *     (SecurityAddressVaultGuard). Ingest writes it while an enabled IP
 *     Address rule hashes the logs or traces Security Events reads
 *     (SecurityAddressVaultWriter.startBatch), so the store is declared
 *     while that holds, and kept until every address written then is past
 *     the vault's 30 days.
 *
 * A project that stops - turns its Security Events sources off, deletes
 * its devices, removes its Hash rule - keeps its store until its data is
 * gone, since the data is still held until then; then it is archived, with
 * its history and the team's purpose and retention, and comes back with
 * them if the data does.
 *
 * Declared, never scanned: no content scan claims these kinds, no check
 * applies to them, and the evaluator, the compliance scores, the Overview,
 * criticality and OneUptime AI's owner proposals all leave them out. A read
 * that fails leaves the store as it was - never declared from nothing,
 * never archived for a hiccup.
 *
 * Discovery declares them every quarter of an hour; the record of
 * processing does too, at most once a minute a project, so the record an
 * auditor exports is never missing a store the project holds.
 */

// How a declared store says it was found: OneUptime declares it.
export const DECLARED_STORE_DISCOVERED_FROM: string = "OneUptime";

// How long after the vault was last written its store is kept: its 30 days, and a day for the schedule.
export const ADDRESS_VAULT_STORE_GRACE_IN_DAYS: number = 1;

// How often a held store's lastSeenAt is written again.
export const DECLARED_STORE_SEEN_REFRESH_IN_MS: number = 60 * 60 * 1000;

// How long a project is not declared again for its record.
export const DECLARE_ON_READ_INTERVAL_MS: number = 60 * 1000;

const MAX_CACHED_PROJECTS: number = 10_000;

const declaredRecently: InMemoryTTLCache<true> = new InMemoryTTLCache<true>(
  MAX_CACHED_PROJECTS,
);

export enum DeclaredStoreChange {
  Created = "created",
  Restored = "restored",
  Refreshed = "refreshed",
  Archived = "archived",
  Unchanged = "unchanged",
  // Whether the project holds such data could not be read: left as it was.
  Unknown = "unknown",
}

export type DeclaredStoresResult = Partial<
  Record<DataStoreKind, DeclaredStoreChange>
>;

// The columns a declared store's row is compared and kept by.
const DECLARED_ROW_SELECT: {
  _id: true;
  kind: true;
  storeKey: true;
  isArchived: true;
  lastSeenAt: true;
  dataTypeIds: true;
  dataCategories: true;
  sensitivity: true;
  exposure: true;
} = {
  _id: true,
  kind: true,
  storeKey: true,
  isArchived: true,
  lastSeenAt: true,
  dataTypeIds: true,
  dataCategories: true,
  sensitivity: true,
  exposure: true,
};

function sameList(
  a: ReadonlyArray<string> | undefined | null,
  b: ReadonlyArray<string>,
): boolean {
  const left: Array<string> = [...(a || [])].sort();
  const right: Array<string> = [...b].sort();

  return (
    left.length === right.length &&
    left.every((value: string, index: number): boolean => {
      return value === right[index];
    })
  );
}

export default class DeclaredDataStores {
  /*
   * Declares the project's stores as its data says: made the first time,
   * brought back and kept up to date while it holds such data, archived
   * once it holds none. Never throws.
   */
  public static async declareProject(
    projectId: ObjectID,
    options: { now?: Date | undefined } = {},
  ): Promise<DeclaredStoresResult> {
    const now: Date = options.now || OneUptimeDate.getCurrentDate();
    const result: DeclaredStoresResult = {};
    let rows: Array<DataStore>;

    try {
      rows = await DataStoreService.findBy({
        query: {
          projectId,
          kind: new Includes([...DECLARED_DATA_STORE_KINDS]),
        },
        select: DECLARED_ROW_SELECT,
        skip: 0,
        limit: DECLARED_DATA_STORE_KINDS.length * 4,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `DataSecurity: could not read the declared stores of project ${projectId.toString()}:`,
      );
      logger.error(error);
      return result;
    }

    for (const info of DECLARED_DATA_STORES) {
      const row: DataStore | undefined = rows.find(
        (candidate: DataStore): boolean => {
          return candidate.storeKey === info.storeKey;
        },
      );

      try {
        result[info.kind] = await this.declareStore({
          projectId,
          info,
          row,
          now,
        });
      } catch (error) {
        result[info.kind] = DeclaredStoreChange.Unknown;
        logger.error(
          `DataSecurity: could not declare the ${info.kind} store of project ${projectId.toString()}:`,
        );
        logger.error(error);
      }
    }

    return result;
  }

  /*
   * As declareProject, for a reader of the record: at most once a
   * DECLARE_ON_READ_INTERVAL_MS a project on this server, and never in the
   * way of the read.
   */
  public static async declareBeforeRead(projectId: ObjectID): Promise<void> {
    const key: string = projectId.toString();

    if (declaredRecently.get(key)) {
      return;
    }

    declaredRecently.set(key, true, DECLARE_ON_READ_INTERVAL_MS);

    try {
      await this.declareProject(projectId);
    } catch (error) {
      logger.error(error);
    }
  }

  // Forget which projects were declared lately, so a test declares again.
  public static clearCache(): void {
    declaredRecently.clear();
  }

  /*
   * Whether the project holds data of a declared kind: true or false, or
   * null when that could not be read.
   */
  public static async holdsData(
    projectId: ObjectID,
    kind: DataStoreKind,
  ): Promise<boolean | null> {
    try {
      switch (kind) {
        case DataStoreKind.SecurityEvents:
          return await SecurityEventService.existsBy({
            query: { projectId },
            props: { isRoot: true },
          });
        case DataStoreKind.NetworkFlows:
          return await NetworkFlowService.existsBy({
            query: { projectId },
            props: { isRoot: true },
          });
        case DataStoreKind.SecurityAddressVault:
          return await this.isAddressVaultWritten(projectId);
        default:
          return false;
      }
    } catch (error) {
      logger.warn(
        `DataSecurity: could not read whether project ${projectId.toString()} holds ${kind}; its store is left as it was.`,
      );
      logger.warn(error);
      return null;
    }
  }

  /*
   * Whether ingest keeps the project's hashed addresses for Security
   * Events' address vault, by the rule ingest keeps them by
   * (SecurityAddressVaultWriter.startBatch) - an enabled IP Address rule
   * that hashes logs Security Events reads, or traces - and never by
   * reading the vault.
   */
  public static async isAddressVaultWritten(
    projectId: ObjectID,
  ): Promise<boolean> {
    const hashing: {
      projectId: ObjectID;
      isEnabled: true;
      patternType: LogScrubPatternType;
      scrubAction: LogScrubAction;
    } = {
      projectId,
      isEnabled: true,
      patternType: LogScrubPatternType.IPAddress,
      scrubAction: LogScrubAction.Hash,
    };

    const logRule: LogScrubRule | null = await LogScrubRuleService.findOneBy({
      query: hashing,
      select: { _id: true },
      props: { isRoot: true },
    });

    if (
      logRule &&
      (await SecurityEventsReadTelemetry.readsProjectTelemetry({
        projectId,
        signal: "log",
      }))
    ) {
      return true;
    }

    const traceRule: TraceScrubRule | null =
      await TraceScrubRuleService.findOneBy({
        query: hashing,
        select: { _id: true },
        props: { isRoot: true },
      });

    return Boolean(
      traceRule &&
        (await SecurityEventsReadTelemetry.readsProjectTelemetry({
          projectId,
          signal: "trace",
        })),
    );
  }

  /*
   * What OneUptime declares of a store: its own purpose and retention -
   * the retention read now, so a change since the store was declared is
   * the one said - whether the team changed either, and who can read it.
   * Null for a store OneUptime does not declare.
   */
  public static async describe(data: {
    projectId: ObjectID;
    store: DataStore;
  }): Promise<DataSecurityDeclaredStore | null> {
    const info: DeclaredDataStoreInfo | undefined = getDeclaredDataStore(
      data.store.kind,
    );

    if (!info) {
      return null;
    }

    const retentionInDays: number = await this.readRetentionInDays({
      projectId: data.projectId,
      basis: info.retentionBasis,
    });
    const readPermissions: Array<Permission> = this.getReadPermissions(
      info.kind,
    );

    return {
      kind: info.kind,
      purpose: DECLARED_STORE_PURPOSE,
      retentionInDays: retentionInDays,
      retentionBasis: info.retentionBasis,
      retentionText: getDeclaredRetentionText({
        basis: info.retentionBasis,
        retentionInDays,
      }),
      isPurposeTheTeams: Boolean(data.store.purpose?.trim()),
      isRetentionTheTeams: Boolean(data.store.retention?.trim()),
      readers: info.readers,
      readPermissions: readPermissions.map((permission: Permission): string => {
        return permission;
      }),
      readerNames: PermissionHelper.getPermissionTitles(readPermissions),
      dataTypeNames: info.dataTypeIds.map((dataTypeId: string): string => {
        return getBuiltInDataType(dataTypeId)?.name || dataTypeId;
      }),
      fields: [...info.fields],
    };
  }

  // The store's Purpose and Retention as the record says them: the team's, else OneUptime's.
  public static getRecordedPurposeAndRetention(data: {
    store: DataStore;
    declared: DataSecurityDeclaredStore;
  }): { purpose: string; retention: string } {
    return {
      purpose: data.store.purpose?.trim() || data.declared.purpose,
      retention: data.store.retention?.trim() || data.declared.retentionText,
    };
  }

  /*
   * How many days the table keeps the project's data: the flows' and the
   * vault's own, or the project's retention for security events, read now
   * (Settings, Telemetry), as ingest stamps an event whose source has no
   * retention of its own.
   */
  public static async readRetentionInDays(data: {
    projectId: ObjectID;
    basis: DeclaredStoreRetentionBasis;
  }): Promise<number> {
    const fixed: number | null = getFixedDeclaredRetentionInDays(data.basis);

    if (fixed !== null) {
      return fixed;
    }

    return await SecurityEventRetention.getRetentionInDays(data.projectId, {
      isFresh: true,
    });
  }

  /*
   * Who can read a declared store: its table's read permissions, product
   * levels included, as every read of it is held to - none for the vault,
   * which only Security Events' scans read.
   */
  public static getReadPermissions(kind: DataStoreKind): Array<Permission> {
    const info: DeclaredDataStoreInfo | undefined = getDeclaredDataStore(kind);

    if (!info || info.readers !== DeclaredStoreReaders.Roles) {
      return [];
    }

    switch (kind) {
      case DataStoreKind.SecurityEvents:
        return [...new SecurityEvent().getReadPermissions()];
      case DataStoreKind.NetworkFlows:
        return [...new NetworkFlow().getReadPermissions()];
      default:
        return [];
    }
  }

  private static async declareStore(data: {
    projectId: ObjectID;
    info: DeclaredDataStoreInfo;
    row: DataStore | undefined;
    now: Date;
  }): Promise<DeclaredStoreChange> {
    const { projectId, info, row, now } = data;
    const holds: boolean | null = await this.holdsData(projectId, info.kind);

    if (holds === null) {
      return DeclaredStoreChange.Unknown;
    }

    if (holds) {
      return row?.id
        ? await this.keep({ projectId, info, row, now })
        : await this.create({ projectId, info, now });
    }

    if (!row?.id || row.isArchived || !this.isPastItsData(info, row, now)) {
      return DeclaredStoreChange.Unchanged;
    }

    await DataStoreService.updateColumnsByIdWithoutHooks({
      id: row.id,
      data: { isArchived: true } as never,
    });

    // Its Timeline says why it left the everyday lists.
    await DataStoreService.writeArchivedFeed({
      projectId,
      dataStoreId: row.id,
      discoveredFrom: DECLARED_STORE_DISCOVERED_FROM,
    }).catch((error: Error) => {
      logger.error(error);
    });

    return DeclaredStoreChange.Archived;
  }

  /*
   * Whether a store that holds nothing now has no data left: at once for
   * the tables that were asked, and for the vault once every address
   * written while it was last declared is past the vault's retention.
   */
  private static isPastItsData(
    info: DeclaredDataStoreInfo,
    row: DataStore,
    now: Date,
  ): boolean {
    if (info.retentionBasis !== DeclaredStoreRetentionBasis.AddressVault) {
      return true;
    }

    if (!row.lastSeenAt) {
      return true;
    }

    const keptForDays: number =
      (getFixedDeclaredRetentionInDays(info.retentionBasis) || 0) +
      ADDRESS_VAULT_STORE_GRACE_IN_DAYS;

    return (
      OneUptimeDate.addRemoveDurationInDays(
        new Date(row.lastSeenAt),
        keptForDays,
      ).getTime() <= now.getTime()
    );
  }

  private static async keep(data: {
    projectId: ObjectID;
    info: DeclaredDataStoreInfo;
    row: DataStore;
    now: Date;
  }): Promise<DeclaredStoreChange> {
    const { projectId, info, row, now } = data;
    const wasArchived: boolean = Boolean(row.isArchived);
    const columns: Record<string, unknown> = {};

    if (wasArchived) {
      columns["isArchived"] = false;
    }

    // What it holds is OneUptime's to say, kept as the code says it now.
    if (!sameList(row.dataTypeIds, info.dataTypeIds)) {
      columns["dataTypeIds"] = [...info.dataTypeIds];
    }

    if (!sameList(row.dataCategories, info.dataCategories)) {
      columns["dataCategories"] = [...info.dataCategories];
    }

    if (row.sensitivity !== info.sensitivity) {
      columns["sensitivity"] = info.sensitivity;
    }

    if (row.exposure !== DataStoreExposure.Private) {
      columns["exposure"] = DataStoreExposure.Private;
    }

    const lastSeenAt: number = row.lastSeenAt
      ? new Date(row.lastSeenAt).getTime()
      : 0;

    if (
      Object.keys(columns).length > 0 ||
      now.getTime() - lastSeenAt >= DECLARED_STORE_SEEN_REFRESH_IN_MS
    ) {
      columns["lastSeenAt"] = now;
    }

    if (Object.keys(columns).length === 0) {
      return DeclaredStoreChange.Unchanged;
    }

    await DataStoreService.updateColumnsByIdWithoutHooks({
      id: row.id!,
      data: columns as never,
    });

    if (!wasArchived) {
      return DeclaredStoreChange.Refreshed;
    }

    // Its data is back: so is the store, with the team's purpose and retention.
    await DataStoreService.writeRestoredFeed({
      projectId,
      dataStoreId: row.id!,
    }).catch((error: Error) => {
      logger.error(error);
    });

    return DeclaredStoreChange.Restored;
  }

  private static async create(data: {
    projectId: ObjectID;
    info: DeclaredDataStoreInfo;
    now: Date;
  }): Promise<DeclaredStoreChange> {
    const { projectId, info, now } = data;
    const kindInfo: DataStoreKindInfo | undefined = getDataStoreKindInfo(
      info.kind,
    );
    const row: DataStore = new DataStore();

    row.projectId = projectId;
    row.storeKey = info.storeKey;
    row.name = info.name;
    row.kind = info.kind;

    if (kindInfo) {
      row.provider = kindInfo.provider;
      row.family = kindInfo.family;
    }

    row.discoveredFrom = DECLARED_STORE_DISCOVERED_FROM;
    row.dataTypeIds = [...info.dataTypeIds];
    row.dataCategories = [...info.dataCategories];
    row.sensitivity = info.sensitivity;
    row.exposure = DataStoreExposure.Private;
    // Never scanned: nothing in it is read but by its own product.
    row.isContentScanEnabled = false;
    row.firstSeenAt = now;
    row.lastSeenAt = now;

    try {
      await DataStoreService.create({ data: row, props: { isRoot: true } });
      return DeclaredStoreChange.Created;
    } catch (error) {
      // Another server declared it first - or it could not be made at all.
      const raced: DataStore | null = await DataStoreService.findOneBy({
        query: { projectId, storeKey: info.storeKey },
        select: { _id: true },
        props: { isRoot: true },
      });

      if (!raced?.id) {
        throw error;
      }

      return DeclaredStoreChange.Unchanged;
    }
  }
}
