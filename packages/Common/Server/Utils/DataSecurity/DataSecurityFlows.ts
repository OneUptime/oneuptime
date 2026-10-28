import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DataSecurityFlow from "../../../Models/DatabaseModels/DataSecurityFlow";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "../../../Models/DatabaseModels/InventoryItemRelationship";
import CloudResourceService from "../../Services/CloudResourceService";
import DatabaseServerService from "../../Services/DatabaseServerService";
import DataSecurityFlowService from "../../Services/DataSecurityFlowService";
import InventoryItemRelationshipService from "../../Services/InventoryItemRelationshipService";
import InventoryItemService from "../../Services/InventoryItemService";
import SpanService from "../../Services/SpanService";
import { estimateOverlap } from "./Fingerprint";
import logger from "../Logger";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import {
  getQuerySettings,
  INTERACTIVE_READ_TIME_LIMIT,
} from "../AnalyticsDatabase/QuerySettingsHelper";
import { Results } from "../../Services/AnalyticsDatabaseService";
import { getClickhouseDatabaseName } from "../AnalyticsDatabase/ClusterConfig";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import EntityType from "../../../Types/Telemetry/EntityType";
import DataSensitivity, {
  DATA_SENSITIVITY_RANK,
} from "../../../Types/DataSecurity/DataSensitivity";
import DataStoreEnvironment from "../../../Types/DataSecurity/DataStoreEnvironment";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import {
  telemetryDataStoreKey,
  tracedDatabaseDataStoreKey,
} from "../../../Types/DataSecurity/DataStoreKey";
import { ResponseJSON } from "@clickhouse/client";

/*
 * WHERE A PROJECT'S SENSITIVE DATA GOES.
 *
 * Three kinds of edge, each from evidence OneUptime already has:
 *
 *  - Uses: a service talks to a store. The service map (InventoryItem and
 *    InventoryItemRelationship, recomputed from client spans every ten
 *    minutes) already says which service calls which database; this ties
 *    each database node to its store by name, address or endpoint.
 *  - AI provider and external host: a service sends data out. LLM spans
 *    name the provider; the service map's remote services name the host.
 *  - Copy: one store holds values of another, found by comparing their
 *    fingerprints (Fingerprint.ts) - never the values themselves. A copy
 *    runs from production to non-production when environments differ, and
 *    from the older store to the newer otherwise.
 *
 * Flows not seen again for FLOW_RETENTION_IN_DAYS days are dropped.
 */

export const FLOW_RETENTION_IN_DAYS: number = 30;

// Two stores share data when their fingerprints overlap by at least this.
export const COPY_OVERLAP_THRESHOLD: number = 0.5;

// The most stores whose fingerprints are compared with each other.
const MAX_FINGERPRINTED_STORES: number = 400;

const AI_WINDOW_IN_DAYS: number = 7;

interface FlowDraft {
  flowKey: string;
  kind: string;
  sourceDataStoreId?: ObjectID | undefined;
  serviceId?: ObjectID | undefined;
  destinationDataStoreId?: ObjectID | undefined;
  destination?: string | undefined;
  dataTypeIds: Array<string>;
  sensitivity: DataSensitivity;
  isConfirmed: boolean;
  overlapPercent: number;
  callCount: number;
}

export default class DataSecurityFlows {
  public static readonly USES: string = "Uses";
  public static readonly AI_PROVIDER: string = "AI Provider";
  public static readonly EXTERNAL_HOST: string = "External Host";
  public static readonly COPY: string = "Copy";

  public static async computeProjectFlows(
    projectId: ObjectID,
    stores: Array<DataStore>,
  ): Promise<void> {
    const drafts: Map<string, FlowDraft> = new Map();
    const add: (draft: FlowDraft) => void = (draft: FlowDraft): void => {
      drafts.set(draft.flowKey, draft);
    };

    for (const draft of this.copyFlows(stores)) {
      add(draft);
    }

    try {
      for (const draft of await this.serviceMapFlows(projectId, stores)) {
        add(draft);
      }
    } catch (error) {
      logger.error(
        `DataSecurity: could not read the service map of project ${projectId.toString()}:`,
      );
      logger.error(error);
    }

    try {
      for (const draft of await this.aiProviderFlows(projectId, stores)) {
        add(draft);
      }
    } catch (error) {
      logger.error(
        `DataSecurity: could not read AI provider calls of project ${projectId.toString()}:`,
      );
      logger.error(error);
    }

    await this.write(projectId, [...drafts.values()]);
  }

  private static sensitivityOf(store: DataStore | undefined): DataSensitivity {
    return (
      (store?.sensitivityOverride as DataSensitivity | undefined) ||
      (store?.sensitivity as DataSensitivity | undefined) ||
      DataSensitivity.Public
    );
  }

  public static copyFlows(stores: Array<DataStore>): Array<FlowDraft> {
    const fingerprinted: Array<DataStore> = stores
      .filter((store: DataStore) => {
        return (
          store.fingerprints &&
          Object.keys(store.fingerprints as JSONObject).length > 0
        );
      })
      .slice(0, MAX_FINGERPRINTED_STORES);
    const drafts: Array<FlowDraft> = [];

    for (let i: number = 0; i < fingerprinted.length; i++) {
      for (let j: number = i + 1; j < fingerprinted.length; j++) {
        const a: DataStore = fingerprinted[i]!;
        const b: DataStore = fingerprinted[j]!;
        const aPrints: JSONObject = a.fingerprints as JSONObject;
        const bPrints: JSONObject = b.fingerprints as JSONObject;
        let best: number = 0;
        const shared: Array<string> = [];

        for (const dataTypeId of Object.keys(aPrints)) {
          const left: unknown = aPrints[dataTypeId];
          const right: unknown = bPrints[dataTypeId];

          if (!Array.isArray(left) || !Array.isArray(right)) {
            continue;
          }

          const overlap: number = estimateOverlap(
            left as Array<number>,
            right as Array<number>,
          );

          if (overlap >= COPY_OVERLAP_THRESHOLD) {
            shared.push(dataTypeId);
            best = Math.max(best, overlap);
          }
        }

        if (shared.length === 0) {
          continue;
        }

        const [source, destination] = this.copyDirection(a, b);
        const sensitivity: DataSensitivity =
          DATA_SENSITIVITY_RANK[this.sensitivityOf(a)] >=
          DATA_SENSITIVITY_RANK[this.sensitivityOf(b)]
            ? this.sensitivityOf(a)
            : this.sensitivityOf(b);

        drafts.push({
          flowKey: `copy:${source.id!.toString()}:${destination.id!.toString()}`,
          kind: this.COPY,
          sourceDataStoreId: source.id!,
          destinationDataStoreId: destination.id!,
          dataTypeIds: shared.sort(),
          sensitivity,
          isConfirmed: true,
          overlapPercent: Math.round(best * 100),
          callCount: 0,
        });
      }
    }

    return drafts;
  }

  // Production first; otherwise the store OneUptime knew of first.
  private static copyDirection(a: DataStore, b: DataStore): [DataStore, DataStore] {
    const aProduction: boolean =
      a.environment === DataStoreEnvironment.Production;
    const bProduction: boolean =
      b.environment === DataStoreEnvironment.Production;

    if (aProduction !== bProduction) {
      return aProduction ? [a, b] : [b, a];
    }

    const aSeen: number = a.firstSeenAt?.getTime() || 0;
    const bSeen: number = b.firstSeenAt?.getTime() || 0;

    return aSeen <= bSeen ? [a, b] : [b, a];
  }

  private static async serviceMapFlows(
    projectId: ObjectID,
    stores: Array<DataStore>,
  ): Promise<Array<FlowDraft>> {
    const edges: Array<InventoryItemRelationship> =
      await InventoryItemRelationshipService.findBy({
        query: { projectId },
        select: { fromEntityKey: true, toEntityKey: true, callCount: true },
        skip: 0,
        limit: 5000,
        props: { isRoot: true },
      });

    if (edges.length === 0) {
      return [];
    }

    const keys: Set<string> = new Set();

    for (const edge of edges) {
      if (edge.fromEntityKey) {
        keys.add(edge.fromEntityKey);
      }

      if (edge.toEntityKey) {
        keys.add(edge.toEntityKey);
      }
    }

    const items: Array<InventoryItem> = await InventoryItemService.findBy({
      query: { projectId, entityKey: new Includes([...keys].slice(0, 5000)) },
      select: {
        entityKey: true,
        entityType: true,
        displayName: true,
        identifyingAttributes: true,
        resourceType: true,
        resourceId: true,
      },
      skip: 0,
      limit: 5000,
      props: { isRoot: true },
    });
    const byKey: Map<string, InventoryItem> = new Map();

    for (const item of items) {
      if (item.entityKey) {
        byKey.set(item.entityKey, item);
      }
    }

    const storeOfAddress: Map<string, DataStore> = await this.storesByAddress(
      projectId,
      stores,
    );
    const storeByKey: Map<string, DataStore> = new Map(
      stores.map((store: DataStore): [string, DataStore] => {
        return [store.storeKey || "", store];
      }),
    );
    const drafts: Array<FlowDraft> = [];

    for (const edge of edges) {
      const from: InventoryItem | undefined = byKey.get(edge.fromEntityKey || "");
      const to: InventoryItem | undefined = byKey.get(edge.toEntityKey || "");

      if (!from || !to || from.entityType !== EntityType.Service) {
        continue;
      }

      const serviceId: ObjectID | undefined =
        from.resourceType === "Service" && from.resourceId
          ? from.resourceId
          : undefined;
      const attributes: JSONObject =
        (to.identifyingAttributes as JSONObject | undefined) || {};
      const address: string = String(attributes["server.address"] || "")
        .trim()
        .toLowerCase();

      if (to.entityType === EntityType.Database) {
        const store: DataStore | undefined =
          storeByKey.get(
            tracedDatabaseDataStoreKey({
              system: String(attributes["db.system.name"] || ""),
              address,
              namespace: attributes["db.namespace"]
                ? String(attributes["db.namespace"])
                : undefined,
            }),
          ) || (address ? storeOfAddress.get(address) : undefined);

        if (!store?.id) {
          continue;
        }

        drafts.push({
          flowKey: `uses:${store.id.toString()}:${edge.fromEntityKey}`,
          kind: this.USES,
          sourceDataStoreId: store.id,
          serviceId,
          destination: from.displayName || undefined,
          dataTypeIds: (store.dataTypeIds || []).slice(0, 50),
          sensitivity: this.sensitivityOf(store),
          isConfirmed: false,
          overlapPercent: 0,
          callCount: edge.callCount || 0,
        });
      } else if (to.entityType === EntityType.RemoteService && address) {
        drafts.push({
          flowKey: `external:${edge.fromEntityKey}:${address}`,
          kind: this.EXTERNAL_HOST,
          serviceId,
          destination: address,
          dataTypeIds: [],
          sensitivity: DataSensitivity.Public,
          isConfirmed: false,
          overlapPercent: 0,
          callCount: edge.callCount || 0,
        });
      }
    }

    return drafts;
  }

  /*
   * Database stores by the addresses services reach them at: a monitored
   * database's server address, and a cloud database's endpoints.
   */
  private static async storesByAddress(
    projectId: ObjectID,
    stores: Array<DataStore>,
  ): Promise<Map<string, DataStore>> {
    const byAddress: Map<string, DataStore> = new Map();
    const byDatabaseServer: Map<string, DataStore> = new Map();
    const byCloudResource: Map<string, DataStore> = new Map();

    for (const store of stores) {
      if (store.databaseServerId) {
        byDatabaseServer.set(store.databaseServerId.toString(), store);
      }

      if (store.cloudResourceId) {
        byCloudResource.set(store.cloudResourceId.toString(), store);
      }
    }

    if (byDatabaseServer.size > 0) {
      const servers: Array<DatabaseServer> = await DatabaseServerService.findBy({
        query: {
          projectId,
          _id: new Includes(
            [...byDatabaseServer.keys()].map((id: string) => {
              return new ObjectID(id);
            }),
          ),
        },
        select: { _id: true, serverAddress: true },
        skip: 0,
        limit: byDatabaseServer.size,
        props: { isRoot: true },
      });

      for (const server of servers) {
        const store: DataStore | undefined = byDatabaseServer.get(
          server.id?.toString() || "",
        );

        if (store && server.serverAddress) {
          byAddress.set(server.serverAddress.trim().toLowerCase(), store);
        }
      }
    }

    if (byCloudResource.size > 0) {
      const resources: Array<CloudResource> = await CloudResourceService.findBy({
        query: {
          projectId,
          _id: new Includes(
            [...byCloudResource.keys()].map((id: string) => {
              return new ObjectID(id);
            }),
          ),
        },
        select: { _id: true, cloudEndpoints: true },
        skip: 0,
        limit: byCloudResource.size,
        props: { isRoot: true },
      });

      for (const resource of resources) {
        const store: DataStore | undefined = byCloudResource.get(
          resource.id?.toString() || "",
        );

        for (const endpoint of resource.cloudEndpoints || []) {
          if (store) {
            byAddress.set(
              endpoint.replace(/:[0-9]{1,5}$/, "").trim().toLowerCase(),
              store,
            );
          }
        }
      }
    }

    return byAddress;
  }

  private static async aiProviderFlows(
    projectId: ObjectID,
    stores: Array<DataStore>,
  ): Promise<Array<FlowDraft>> {
    const storeByKey: Map<string, DataStore> = new Map(
      stores.map((store: DataStore): [string, DataStore] => {
        return [store.storeKey || "", store];
      }),
    );
    const since: Date = OneUptimeDate.addRemoveDays(
      OneUptimeDate.getCurrentDate(),
      -AI_WINDOW_IN_DAYS,
    );
    const statement: Statement = SQL`SELECT primaryEntityId, llmSystem, count() AS calls FROM `;
    statement.append(
      `${getClickhouseDatabaseName()}.${AnalyticsTableName.Span}`,
    );
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: projectId,
      }} AND startTime >= ${{
        type: TableColumnType.Date,
        value: since,
      }} AND isLlmSpan = 1 AND retentionDate >= now() GROUP BY primaryEntityId, llmSystem LIMIT 1000`,
    );
    statement.append(getQuerySettings({ ...INTERACTIVE_READ_TIME_LIMIT }));

    const result: Results = await SpanService.executeQuery(statement);
    const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();
    const drafts: Array<FlowDraft> = [];

    for (const row of (response.data || []) as Array<JSONObject>) {
      const serviceId: string = String(row["primaryEntityId"] || "");
      const provider: string = String(row["llmSystem"] || "").trim();

      if (!ObjectID.isValidUUID(serviceId) || !provider) {
        continue;
      }

      const store: DataStore | undefined = storeByKey.get(
        telemetryDataStoreKey({
          serviceId,
          kind: DataStoreKind.TelemetryAiConversations,
        }),
      );
      const sensitivity: DataSensitivity = this.sensitivityOf(store);

      drafts.push({
        flowKey: `ai:${serviceId}:${provider.toLowerCase()}`,
        kind: this.AI_PROVIDER,
        sourceDataStoreId: store?.id || undefined,
        serviceId: new ObjectID(serviceId),
        destination: provider,
        dataTypeIds: (store?.dataTypeIds || []).slice(0, 50),
        sensitivity,
        isConfirmed:
          DATA_SENSITIVITY_RANK[sensitivity] >=
          DATA_SENSITIVITY_RANK[DataSensitivity.Confidential],
        overlapPercent: 0,
        callCount: Number(row["calls"]) || 0,
      });
    }

    return drafts;
  }

  private static async write(
    projectId: ObjectID,
    drafts: Array<FlowDraft>,
  ): Promise<void> {
    const now: Date = OneUptimeDate.getCurrentDate();
    const existing: Array<DataSecurityFlow> = await DataSecurityFlowService.findBy(
      {
        query: { projectId },
        select: { _id: true, flowKey: true, lastSeenAt: true },
        skip: 0,
        limit: 10000,
        props: { isRoot: true },
      },
    );
    const byKey: Map<string, DataSecurityFlow> = new Map();

    for (const flow of existing) {
      if (flow.flowKey) {
        byKey.set(flow.flowKey, flow);
      }
    }

    for (const draft of drafts) {
      const columns: JSONObject = {
        kind: draft.kind,
        dataTypeIds: draft.dataTypeIds,
        sensitivity: draft.sensitivity,
        isConfirmed: draft.isConfirmed,
        overlapPercent: draft.overlapPercent,
        callCount: Math.min(draft.callCount, 2_000_000_000),
        lastSeenAt: now,
      };

      if (draft.destination) {
        columns["destination"] = draft.destination.slice(0, 500);
      }

      try {
        const row: DataSecurityFlow | undefined = byKey.get(draft.flowKey);

        if (row?.id) {
          await DataSecurityFlowService.updateColumnsByIdWithoutHooks({
            id: row.id,
            data: columns as never,
          });
          continue;
        }

        const flow: DataSecurityFlow = new DataSecurityFlow();
        flow.projectId = projectId;
        flow.flowKey = draft.flowKey.slice(0, 500);
        flow.firstSeenAt = now;

        if (draft.sourceDataStoreId) {
          flow.sourceDataStoreId = draft.sourceDataStoreId;
        }

        if (draft.destinationDataStoreId) {
          flow.destinationDataStoreId = draft.destinationDataStoreId;
        }

        if (draft.serviceId) {
          flow.serviceId = draft.serviceId;
        }

        for (const [column, value] of Object.entries(columns)) {
          flow.setColumnValue(column, value);
        }

        await DataSecurityFlowService.create({
          data: flow,
          props: { isRoot: true },
        });
      } catch (error) {
        logger.error(`DataSecurity: could not write flow ${draft.flowKey}:`);
        logger.error(error);
      }
    }

    // Flows nobody has seen for a month are gone - not the ones seen just now.
    const cutoff: Date = OneUptimeDate.addRemoveDays(now, -FLOW_RETENTION_IN_DAYS);
    const seenNow: Set<string> = new Set(
      drafts.map((draft: FlowDraft) => {
        return draft.flowKey;
      }),
    );

    for (const flow of existing) {
      if (
        flow.id &&
        flow.lastSeenAt &&
        flow.lastSeenAt.getTime() < cutoff.getTime() &&
        !seenNow.has(flow.flowKey || "")
      ) {
        await DataSecurityFlowService.deleteOneById({
          id: flow.id,
          props: { isRoot: true },
        });
      }
    }
  }
}
