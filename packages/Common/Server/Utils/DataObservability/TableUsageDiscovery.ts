import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataAssetUsage from "../../../Models/DatabaseModels/DataAssetUsage";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import Service from "../../../Models/DatabaseModels/Service";
import { SpanKind } from "../../../Models/AnalyticsModels/Span";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../../Types/Date";
import {
  DataAssetAccessKind,
  MAX_OPERATIONS_PER_USAGE,
} from "../../../Types/DataObservability/DataAssetUsage";
import {
  DataAssetReadTracking,
  noteObservedRead,
} from "../../../Types/DataObservability/DataAssetReads";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import DataAssetService from "../../Services/DataAssetService";
import DataAssetUsageService from "../../Services/DataAssetUsageService";
import DataStoreService from "../../Services/DataStoreService";
import ServiceService from "../../Services/ServiceService";
import SpanService from "../../Services/SpanService";
import { Results } from "../../Services/AnalyticsDatabaseService";
import QueryHelper from "../../Types/Database/QueryHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import {
  getQuerySettings,
  INTERACTIVE_READ_TIME_LIMIT,
} from "../AnalyticsDatabase/QuerySettingsHelper";
import { getClickhouseDatabaseName } from "../AnalyticsDatabase/ClusterConfig";
import logger from "../Logger";
import { readTableHealthTarget, TableHealthTarget } from "./TableHealthTarget";
import {
  matchSpanTableUsage,
  SpanTableUsageRow,
  TableUsageMatch,
  UsageAsset,
  UsageStore,
} from "./TableUsageMatching";
import { ResponseJSON } from "@clickhouse/client";

/*
 * WHICH SERVICES READ AND WRITE EACH TABLE, FROM THEIR DATABASE SPANS.
 *
 * Every ten minutes, for each project whose databases Data Observability
 * reads, the last hour of client spans to a database is grouped by service,
 * database, table and operation (one ClickHouse read), each group is tied to
 * a table (TableUsageMatching), and the result is kept as DataAssetUsage
 * rows: one per table, service and way. A row not seen for
 * USAGE_RETENTION_IN_DAYS days is dropped.
 */

export const TABLE_USAGE_WINDOW_IN_MINUTES: number = 60;
export const USAGE_RETENTION_IN_DAYS: number = 30;

// The most span groups one project's read hands back.
export const MAX_USAGE_ROWS_PER_PROJECT: number = 10_000;

// The most usage rows one project keeps.
export const MAX_USAGES_PER_PROJECT: number = 20_000;

const MAX_ASSETS_PER_PROJECT: number = 50_000;
const MAX_SERVICE_NAME_LENGTH: number = 100;

// The statement verbs a span name may start with when no table attribute is set.
const NAMED_STATEMENT_PATTERN: string =
  "^(?i)(SELECT|INSERT|UPDATE|DELETE|MERGE|UPSERT|COPY|TRUNCATE) [^ ]+$";

// One table, service and way, from every span group that says so.
export interface UsageDraft {
  dataAssetId: string;
  dataStoreId: string;
  serviceId: string;
  accessKind: DataAssetAccessKind;
  operations: Array<string>;
  callCount: number;
  errorCount: number;
  lastSeenAt: Date;
}

export function getUsageKey(data: {
  serviceId: string;
  accessKind: DataAssetAccessKind;
}): string {
  return `${data.serviceId}:${data.accessKind}`;
}

// Adds one span group's match to the drafts, one per table, service and way.
export function addUsageMatch(data: {
  drafts: Map<string, UsageDraft>;
  row: SpanTableUsageRow;
  match: TableUsageMatch;
}): void {
  const key: string = `${data.match.asset.dataAssetId}:${getUsageKey({
    serviceId: data.row.serviceId,
    accessKind: data.match.accessKind,
  })}`;
  const existing: UsageDraft | undefined = data.drafts.get(key);

  if (!existing) {
    data.drafts.set(key, {
      dataAssetId: data.match.asset.dataAssetId,
      dataStoreId: data.match.asset.dataStoreId,
      serviceId: data.row.serviceId,
      accessKind: data.match.accessKind,
      operations: [data.match.operation],
      callCount: data.row.callCount,
      errorCount: data.row.errorCount,
      lastSeenAt: data.row.lastSeenAt,
    });
    return;
  }

  if (
    !existing.operations.includes(data.match.operation) &&
    existing.operations.length < MAX_OPERATIONS_PER_USAGE
  ) {
    existing.operations.push(data.match.operation);
  }

  existing.callCount += data.row.callCount;
  existing.errorCount += data.row.errorCount;

  if (data.row.lastSeenAt > existing.lastSeenAt) {
    existing.lastSeenAt = data.row.lastSeenAt;
  }
}

// ClickHouse hands DateTime64 back as "YYYY-MM-DD hh:mm:ss.ffffff", in UTC.
export function readClickhouseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const date: Date = new Date(`${value.trim().replace(" ", "T")}Z`);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function readSpanTableUsageRow(
  row: JSONObject,
): SpanTableUsageRow | null {
  const serviceId: string = String(row["serviceId"] || "");
  const lastSeenAt: Date | null = readClickhouseDate(row["lastSeenAt"]);

  if (!ObjectID.isValidUUID(serviceId) || !lastSeenAt) {
    return null;
  }

  return {
    serviceId,
    dbSystem: String(row["dbSystem"] || ""),
    dbNamespace: String(row["dbNamespace"] || ""),
    serverAddress: String(row["serverAddress"] || ""),
    collection: String(row["collection"] || ""),
    operation: String(row["operation"] || ""),
    callCount: Math.max(0, Math.round(Number(row["callCount"]) || 0)),
    errorCount: Math.max(0, Math.round(Number(row["errorCount"]) || 0)),
    lastSeenAt,
  };
}

// The read: a project's client spans to a database in the window, grouped.
export function buildTableUsageStatement(data: {
  projectId: ObjectID;
  since: Date;
  until: Date;
}): Statement {
  const statement: Statement = SQL`SELECT serviceId, dbSystem, dbNamespace, serverAddress, collection, operation, count() AS callCount, countIf(statusCode = 2) AS errorCount, max(startTime) AS lastSeenAt FROM (SELECT primaryEntityId AS serviceId, lower(multiIf(attributes['db.system.name'] != '', attributes['db.system.name'], attributes['db.system'])) AS dbSystem, multiIf(attributes['db.namespace'] != '', attributes['db.namespace'], attributes['db.name']) AS dbNamespace, multiIf(attributes['server.address'] != '', attributes['server.address'], attributes['net.peer.name']) AS serverAddress, multiIf(attributes['db.collection.name'] != '', attributes['db.collection.name'], attributes['db.sql.table'] != '', attributes['db.sql.table'], match(name, ${{
    type: TableColumnType.Text,
    value: NAMED_STATEMENT_PATTERN,
  }}), splitByChar(' ', name)[2], '') AS collection, multiIf(attributes['db.operation.name'] != '', attributes['db.operation.name'], attributes['db.operation'] != '', attributes['db.operation'], splitByChar(' ', name)[1]) AS operation, statusCode, startTime FROM `;

  statement.append(`${getClickhouseDatabaseName()}.${AnalyticsTableName.Span}`);
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND primaryEntityType = ${{
      type: TableColumnType.Text,
      value: ServiceType.OpenTelemetry,
    }} AND kind = ${{
      type: TableColumnType.Text,
      value: SpanKind.Client,
    }} AND startTime >= ${{
      type: TableColumnType.Date,
      value: data.since,
    }} AND startTime < ${{
      type: TableColumnType.Date,
      value: data.until,
    }}) WHERE dbSystem != '' AND collection != '' GROUP BY serviceId, dbSystem, dbNamespace, serverAddress, collection, operation ORDER BY callCount DESC LIMIT ${{
      type: TableColumnType.Number,
      value: MAX_USAGE_ROWS_PER_PROJECT,
    }}`,
  );
  statement.append(getQuerySettings({ ...INTERACTIVE_READ_TIME_LIMIT }));

  return statement;
}

export default class TableUsageDiscovery {
  // The projects with a database whose collection named its database.
  public static async getProjectIds(): Promise<Array<ObjectID>> {
    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: {
        isArchived: false,
        isTableHealthEnabled: true,
        tableHealthTarget: QueryHelper.notNull(),
      },
      select: { projectId: true },
      skip: 0,
      limit: 5000,
      props: { isRoot: true },
    });
    const ids: Map<string, ObjectID> = new Map();

    for (const store of stores) {
      if (store.projectId) {
        ids.set(store.projectId.toString(), store.projectId);
      }
    }

    return Array.from(ids.values());
  }

  public static async discoverProject(data: {
    projectId: ObjectID;
    now: Date;
  }): Promise<number> {
    const stores: Array<UsageStore> = await this.readStores(data.projectId);

    if (stores.length === 0) {
      return 0;
    }

    const assets: Array<UsageAsset> = await this.readAssets(data.projectId);
    const rows: Array<SpanTableUsageRow> = await this.readSpanRows({
      projectId: data.projectId,
      since: OneUptimeDate.addRemoveMinutes(
        data.now,
        -TABLE_USAGE_WINDOW_IN_MINUTES,
      ),
      until: data.now,
    });
    const drafts: Map<string, UsageDraft> = new Map();

    for (const row of rows) {
      const match: TableUsageMatch | null = matchSpanTableUsage({
        row,
        stores,
        assets,
      });

      if (match) {
        addUsageMatch({ drafts, row, match });
      }
    }

    await this.write({
      projectId: data.projectId,
      drafts: Array.from(drafts.values()),
      now: data.now,
    });

    return drafts.size;
  }

  private static async readStores(
    projectId: ObjectID,
  ): Promise<Array<UsageStore>> {
    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: {
        projectId,
        isArchived: false,
        isTableHealthEnabled: true,
        kind: new Includes([
          DataStoreKind.PostgreSql,
          DataStoreKind.MySql,
          DataStoreKind.SqlServer,
        ]),
      },
      select: { _id: true, kind: true, tableHealthTarget: true },
      skip: 0,
      limit: 1000,
      props: { isRoot: true },
    });

    const result: Array<UsageStore> = [];

    for (const store of stores) {
      const target: TableHealthTarget | null = readTableHealthTarget(
        store.tableHealthTarget,
      );

      if (store.id && store.kind && target) {
        result.push({
          dataStoreId: store.id.toString(),
          kind: store.kind,
          databaseName: target.databaseName,
          serverAddress: target.host,
        });
      }
    }

    return result;
  }

  private static async readAssets(
    projectId: ObjectID,
  ): Promise<Array<UsageAsset>> {
    const assets: Array<DataAsset> = await DataAssetService.findBy({
      query: { projectId, isDropped: false },
      select: { _id: true, dataStoreId: true, schemaName: true, name: true },
      skip: 0,
      limit: MAX_ASSETS_PER_PROJECT,
      props: { isRoot: true },
    });

    return assets
      .filter((asset: DataAsset) => {
        return Boolean(asset.id && asset.dataStoreId && asset.name);
      })
      .map((asset: DataAsset): UsageAsset => {
        return {
          dataAssetId: asset.id!.toString(),
          dataStoreId: asset.dataStoreId!.toString(),
          schemaName: asset.schemaName || "",
          name: asset.name!,
        };
      });
  }

  private static async readSpanRows(data: {
    projectId: ObjectID;
    since: Date;
    until: Date;
  }): Promise<Array<SpanTableUsageRow>> {
    const result: Results = await SpanService.executeQuery(
      buildTableUsageStatement(data),
    );
    const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();
    const rows: Array<SpanTableUsageRow> = [];

    for (const row of (response.data || []) as Array<JSONObject>) {
      const usage: SpanTableUsageRow | null = readSpanTableUsageRow(row);

      if (usage) {
        rows.push(usage);
      }
    }

    return rows;
  }

  private static async readServiceNames(
    serviceIds: Array<string>,
  ): Promise<Map<string, string>> {
    const names: Map<string, string> = new Map();

    if (serviceIds.length === 0) {
      return names;
    }

    const services: Array<Service> = await ServiceService.findBy({
      query: { _id: QueryHelper.any(serviceIds) },
      select: { _id: true, name: true },
      skip: 0,
      limit: serviceIds.length,
      props: { isRoot: true },
    });

    for (const service of services) {
      if (service.id) {
        names.set(
          service.id.toString(),
          (service.name || "").slice(0, MAX_SERVICE_NAME_LENGTH),
        );
      }
    }

    return names;
  }

  private static async write(data: {
    projectId: ObjectID;
    drafts: Array<UsageDraft>;
    now: Date;
  }): Promise<void> {
    const existing: Array<DataAssetUsage> = await DataAssetUsageService.findBy({
      query: { projectId: data.projectId },
      select: { _id: true, dataAssetId: true, usageKey: true },
      skip: 0,
      limit: MAX_USAGES_PER_PROJECT,
      props: { isRoot: true },
    });
    const byKey: Map<string, DataAssetUsage> = new Map();

    for (const usage of existing) {
      if (usage.dataAssetId && usage.usageKey) {
        byKey.set(`${usage.dataAssetId.toString()}:${usage.usageKey}`, usage);
      }
    }

    // Services that no longer exist make no row.
    const names: Map<string, string> = await this.readServiceNames(
      Array.from(
        new Set(
          data.drafts.map((draft: UsageDraft) => {
            return draft.serviceId;
          }),
        ),
      ),
    );

    for (const draft of data.drafts) {
      const serviceName: string | undefined = names.get(draft.serviceId);

      if (serviceName === undefined) {
        continue;
      }

      const usageKey: string = getUsageKey(draft);
      const known: DataAssetUsage | undefined = byKey.get(
        `${draft.dataAssetId}:${usageKey}`,
      );

      try {
        if (known?.id) {
          await DataAssetUsageService.updateColumnsByIdWithoutHooks({
            id: known.id,
            data: {
              serviceName: serviceName || "Service",
              operations: draft.operations,
              callCount: draft.callCount,
              errorCount: draft.errorCount,
              lastSeenAt: draft.lastSeenAt,
            } as never,
          });
          continue;
        }

        if (byKey.size >= MAX_USAGES_PER_PROJECT) {
          continue;
        }

        const usage: DataAssetUsage = new DataAssetUsage();
        usage.projectId = data.projectId;
        usage.dataAssetId = new ObjectID(draft.dataAssetId);
        usage.dataStoreId = new ObjectID(draft.dataStoreId);
        usage.serviceId = new ObjectID(draft.serviceId);
        usage.serviceName = serviceName || "Service";
        usage.accessKind = draft.accessKind;
        usage.usageKey = usageKey;
        usage.operations = draft.operations;
        usage.callCount = draft.callCount;
        usage.errorCount = draft.errorCount;
        usage.firstSeenAt = draft.lastSeenAt;
        usage.lastSeenAt = draft.lastSeenAt;

        const created: DataAssetUsage = await DataAssetUsageService.create({
          data: usage,
          props: { isRoot: true },
        });

        byKey.set(`${draft.dataAssetId}:${usageKey}`, created);
      } catch (error) {
        logger.error(
          `Data Observability: could not record a table usage in project ${data.projectId.toString()}`,
        );
        logger.error(error);
      }
    }

    await this.noteReads(data.projectId, data.drafts);

    await DataAssetUsageService.deleteBy({
      query: {
        projectId: data.projectId,
        lastSeenAt: QueryHelper.lessThan(
          OneUptimeDate.addRemoveDays(data.now, -USAGE_RETENTION_IN_DAYS),
        ),
      },
      limit: MAX_USAGES_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });
  }

  /*
   * A table a service was seen reading was read then: its last read moves
   * up, so a table only spans read is never called unused (DataAssetReads).
   */
  private static async noteReads(
    projectId: ObjectID,
    drafts: Array<UsageDraft>,
  ): Promise<void> {
    const lastReads: Map<string, Date> = new Map();

    for (const draft of drafts) {
      if (draft.accessKind !== DataAssetAccessKind.Read) {
        continue;
      }

      const known: Date | undefined = lastReads.get(draft.dataAssetId);

      if (!known || draft.lastSeenAt > known) {
        lastReads.set(draft.dataAssetId, draft.lastSeenAt);
      }
    }

    const ids: Array<string> = Array.from(lastReads.keys());

    for (let start: number = 0; start < ids.length; start += 500) {
      const assets: Array<DataAsset> = await DataAssetService.findBy({
        query: {
          projectId,
          _id: QueryHelper.any(ids.slice(start, start + 500)),
        },
        select: { _id: true, lastReadAt: true, unreadSince: true },
        limit: 500,
        skip: 0,
        props: { isRoot: true },
      });

      for (const asset of assets) {
        const tracking: DataAssetReadTracking = noteObservedRead(
          {
            readCount: null,
            lastReadAt: asset.lastReadAt
              ? OneUptimeDate.fromString(asset.lastReadAt)
              : null,
            unreadSince: asset.unreadSince
              ? OneUptimeDate.fromString(asset.unreadSince)
              : null,
          },
          lastReads.get(asset.id!.toString())!,
        );

        if (tracking.isChanged) {
          await DataAssetService.updateColumnsByIdWithoutHooks({
            id: asset.id!,
            data: {
              lastReadAt: tracking.state.lastReadAt,
              unreadSince: tracking.state.unreadSince,
            } as never,
          });
        }
      }
    }
  }
}
