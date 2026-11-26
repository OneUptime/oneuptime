import DataStore from "../../../Models/DatabaseModels/DataStore";
import ResourceAiAgent from "../../../Models/DatabaseModels/ResourceAiAgent";
import DataStoreService from "../../Services/DataStoreService";
import QueryHelper from "../../Types/Database/QueryHelper";
import { SubscriptionStatusUtil } from "../../../Types/Billing/SubscriptionStatus";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  DATABASE_AGENT_MAX_COLUMNS,
  DATABASE_AGENT_MAX_TABLES,
  DATABASE_AGENT_STORES_PER_POLL,
  DATABASE_AGENT_WORK_VERSION,
  DatabaseAgentDataObservabilityPosture,
  DatabaseAgentEngine,
  DatabaseAgentWork,
  isDatabaseAgentDatabaseName,
} from "../../../Utils/DataObservability/DatabaseAgent/DatabaseAgentWork";
import logger from "../Logger";
import DataCheckIngest from "./DataCheckIngest";
import DataCheckPlanner, { DataCheckAgentPlan } from "./DataCheckPlanner";
import {
  DATABASE_AGENT_KINDS,
  getDatabaseAgentEngineOfKind,
  readAgentDataObservability,
} from "./DataObservabilityDatabaseAgents";
import {
  TABLE_HEALTH_CLAIM_IN_MINUTES,
  readProbeCollectError,
  readTableHealthSnapshot,
} from "./DataObservabilityProbeCollect";
import { TableHealthSnapshot } from "./TableHealthCollector";
import TableHealthIngest, {
  IngestStore,
  TableHealthIngestResult,
} from "./TableHealthIngest";

/*
 * THE SERVER'S HALF OF A DATABASE AGENT READING DATABASES FOR DATA
 * OBSERVABILITY (#11148). See Utils/DataObservability/DatabaseAgent/
 * DatabaseAgentWork for the conversation.
 *
 * As with a probe (DataObservabilityProbeClaim), claiming moves
 * nextTableHealthCollectionAt forward in the one statement that locks the
 * stores FOR NO KEY UPDATE SKIP LOCKED, so no two polls get the same store
 * and an agent that dies holding one gives it up when the claim runs out;
 * the result sets the next time (TableHealthIngest). The agent is taken
 * from the AUTHENTICATED request: it is handed only the databases whose
 * tableHealthDatabaseServerId is the server it registered as, of its own
 * project, and is heard only about those. It is handed nothing until its
 * posture says its owner turned Data Observability on and it speaks this
 * conversation, and every item names what to read, never how and never a
 * credential.
 */

export interface ClaimedAgentStore {
  _id: string;
}

/*
 * Whether a store may be handed to its Database Agent now, over the aliases
 * `ds` (the DataStore) and `p` (its Project): watched, in Data
 * Observability, not archived, of a kind an agent reads, with the database
 * to read named, of a served project.
 */
export const AGENT_TABLE_HEALTH_COLLECTABLE_SQL: string = [
  `ds."deletedAt" IS NULL`,
  `ds."isTableHealthEnabled" = true`,
  `ds."tableHealthRemovedAt" IS NULL`,
  `ds."isArchived" = false`,
  `ds."kind" = ANY($3::text[])`,
  `ds."tableHealthDatabaseName" IS NOT NULL`,
  `ds."tableHealthDatabaseName" <> ''`,
  `p."deletedAt" IS NULL`,
  `p."isBlocked" = false`,
  `(p."paymentProviderSubscriptionStatus" IS NULL OR p."paymentProviderSubscriptionStatus" = ANY($5::text[]))`,
  `(p."paymentProviderMeteredSubscriptionStatus" IS NULL OR p."paymentProviderMeteredSubscriptionStatus" = ANY($5::text[]))`,
].join("\n    AND ");

/*
 * The server's due databases, longest overdue first - a database never
 * collected (no due time) first of all - claimed for TABLE_HEALTH_CLAIM_IN_MINUTES.
 * A range of the (tableHealthDatabaseServerId, nextTableHealthCollectionAt)
 * index. Never a transaction, so no store stays locked past it.
 */
export const CLAIM_DUE_TABLE_HEALTH_STORES_FOR_AGENT_STATEMENT: string = `WITH "due" AS (
  SELECT ds."_id" AS "_id", ds."nextTableHealthCollectionAt" AS "dueAt"
  FROM "DataStore" ds
  INNER JOIN "Project" p ON ds."projectId" = p."_id"
  WHERE ds."tableHealthDatabaseServerId" = $1
    AND ds."projectId" = $2
    AND (ds."nextTableHealthCollectionAt" IS NULL OR ds."nextTableHealthCollectionAt" <= $4)
    AND ${AGENT_TABLE_HEALTH_COLLECTABLE_SQL}
  ORDER BY ds."nextTableHealthCollectionAt" ASC NULLS FIRST
  LIMIT $6
  FOR NO KEY UPDATE OF ds SKIP LOCKED
),
"claimed" AS (
  -- ::timestamptz, so the claim is the instant it says in any time zone.
  UPDATE "DataStore" AS ds
  SET "nextTableHealthCollectionAt" = $7::timestamptz
  FROM "due"
  WHERE ds."_id" = "due"."_id"
  RETURNING ds."_id"
)
SELECT "due"."_id" AS "_id"
FROM "due"
INNER JOIN "claimed" ON "claimed"."_id" = "due"."_id"
ORDER BY "due"."dueAt" ASC NULLS FIRST`;

export async function claimDueTableHealthStoresForAgent(data: {
  databaseServerId: ObjectID;
  projectId: ObjectID;
  limit: number;
}): Promise<Array<ClaimedAgentStore>> {
  if (data.limit <= 0) {
    return [];
  }

  const now: Date = OneUptimeDate.getCurrentDate();
  const rows: unknown = await DataStoreService.getRepository().manager.query(
    CLAIM_DUE_TABLE_HEALTH_STORES_FOR_AGENT_STATEMENT,
    [
      data.databaseServerId.toString(),
      data.projectId.toString(),
      [...DATABASE_AGENT_KINDS],
      now,
      SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
      Math.floor(data.limit),
      OneUptimeDate.addRemoveMinutes(now, TABLE_HEALTH_CLAIM_IN_MINUTES),
    ],
  );

  return Array.isArray(rows) ? (rows as Array<ClaimedAgentStore>) : [];
}

// One claimed store's work, as the agent is handed it; null when no agent could do it.
export function buildDatabaseAgentWork(
  store: DataStore,
  plan: DataCheckAgentPlan,
  now: Date = OneUptimeDate.getCurrentDate(),
): DatabaseAgentWork | null {
  const engine: DatabaseAgentEngine | null = getDatabaseAgentEngineOfKind(
    store.kind,
  );

  if (
    !store.id ||
    !engine ||
    !isDatabaseAgentDatabaseName(store.tableHealthDatabaseName)
  ) {
    return null;
  }

  return {
    dataStoreId: store.id.toString(),
    engine,
    databaseName: store.tableHealthDatabaseName,
    maxTables: DATABASE_AGENT_MAX_TABLES,
    maxColumns: DATABASE_AGENT_MAX_COLUMNS,
    exclusions: (store.scanExclusions || []).filter(
      (exclusion: unknown): exclusion is string => {
        return typeof exclusion === "string";
      },
    ),
    checks: plan.checks,
    freshnessReads: plan.freshnessReads,
    waitWhenBusy: plan.waitWhenBusy,
    // Which views read which tables changes rarely: read at a collection an hour or more after the last.
    readsViewLineage: isViewLineageDue(store.tableHealthCollectedAt, now),
  };
}

const HOUR_IN_MS: number = 60 * 60 * 1000;

function isViewLineageDue(
  collectedAt: Date | string | null | undefined,
  now: Date,
): boolean {
  if (!collectedAt) {
    return true;
  }

  const time: number = new Date(collectedAt).getTime();

  return !Number.isFinite(time) || now.getTime() - time >= HOUR_IN_MS;
}

/*
 * Whether this agent may be handed work: a Database Agent whose posture says
 * Data Observability is on, in a version of the conversation this server
 * speaks, for the engine it names.
 */
export function getAgentDataObservability(
  agent: ResourceAiAgent,
): DatabaseAgentDataObservabilityPosture | null {
  if (agent.resourceType !== AiResourceType.DatabaseServer) {
    return null;
  }

  const posture: DatabaseAgentDataObservabilityPosture | null =
    readAgentDataObservability(agent);

  if (
    !posture?.isOn ||
    posture.workVersion < DATABASE_AGENT_WORK_VERSION ||
    !posture.engine
  ) {
    return null;
  }

  return posture;
}

export default class DataObservabilityAgentCollect {
  /*
   * The due databases of the agent's server, claimed for it, each as work;
   * a database whose engine is not the agent's, or whose checks cannot run,
   * is told so on its page.
   */
  public static async handOutWork(
    agent: ResourceAiAgent,
  ): Promise<Array<DatabaseAgentWork>> {
    const posture: DatabaseAgentDataObservabilityPosture | null =
      getAgentDataObservability(agent);

    if (!posture || !agent.resourceId || !agent.projectId) {
      return [];
    }

    const claimed: Array<ClaimedAgentStore> =
      await claimDueTableHealthStoresForAgent({
        databaseServerId: agent.resourceId,
        projectId: agent.projectId,
        limit: DATABASE_AGENT_STORES_PER_POLL,
      });

    if (claimed.length === 0) {
      return [];
    }

    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: {
        _id: QueryHelper.any(
          claimed.map((row: ClaimedAgentStore): string => {
            return row._id;
          }),
        ),
        projectId: agent.projectId,
        tableHealthDatabaseServerId: agent.resourceId,
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
        kind: true,
        scanExclusions: true,
        tableHealthCollectedAt: true,
        tableHealthDatabaseName: true,
      },
      limit: claimed.length,
      skip: 0,
      props: { isRoot: true },
    });

    const work: Array<DatabaseAgentWork> = [];
    const now: Date = OneUptimeDate.getCurrentDate();

    for (const store of stores) {
      if (!store.id || !store.projectId) {
        continue;
      }

      const engine: DatabaseAgentEngine | null = getDatabaseAgentEngineOfKind(
        store.kind,
      );

      if (!engine || engine !== posture.engine) {
        await TableHealthIngest.recordFailure({
          storeId: store.id,
          error: `The Database Agent of this database's server reads ${posture.engine === "mysql" ? "MySQL" : "PostgreSQL"} databases, and this database is ${store.kind}. Choose the agent of the server it is on.`,
        });
        continue;
      }

      const plan: DataCheckAgentPlan =
        await DataCheckPlanner.planDueChecksForAgent({
          dataStoreId: store.id,
          engine,
          now,
        });

      if (plan.refused.length > 0) {
        await DataCheckIngest.recordResults({
          store: {
            id: store.id,
            projectId: store.projectId,
            name: store.name || "",
            kind: store.kind || "",
          },
          results: plan.refused,
          collectedAt: now,
        });
      }

      const item: DatabaseAgentWork | null = buildDatabaseAgentWork(
        store,
        plan,
        now,
      );

      if (!item) {
        await TableHealthIngest.recordFailure({
          storeId: store.id,
          error:
            "Name the database on its server the Database Agent reads, in this database's Settings.",
        });
        continue;
      }

      work.push(item);
    }

    return work;
  }

  /*
   * One collection's report, from the agent that collected it: recorded only
   * for a database of the agent's own server and project, as a probe's is.
   */
  public static async acceptResult(
    agent: ResourceAiAgent,
    body: JSONObject,
  ): Promise<JSONObject> {
    const dataStoreId: unknown = body["dataStoreId"];

    if (typeof dataStoreId !== "string" || !ObjectID.isValidUUID(dataStoreId)) {
      throw new BadDataException("dataStoreId is missing or is not an ID.");
    }

    if (!agent.resourceId || !agent.projectId) {
      throw new BadDataException("Data store not found.");
    }

    const store: DataStore | null = await DataStoreService.findOneBy({
      query: {
        _id: new ObjectID(dataStoreId),
        projectId: agent.projectId,
        tableHealthDatabaseServerId: agent.resourceId,
      },
      select: { _id: true, projectId: true, name: true, kind: true },
      props: { isRoot: true },
    });

    if (!store?.id || !store.projectId) {
      throw new BadDataException("Data store not found.");
    }

    const error: string | null = readProbeCollectError(body["error"]);

    if (error) {
      await TableHealthIngest.recordFailure({ storeId: store.id, error });
      return { accepted: true };
    }

    const snapshot: TableHealthSnapshot | null = readTableHealthSnapshot(
      body["snapshot"],
      OneUptimeDate.getCurrentDate(),
    );

    if (!snapshot || snapshot.engine !== getDatabaseAgentEngineOfKind(store.kind)) {
      throw new BadDataException("The result is not a table health snapshot.");
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
      `Data Observability collection of store ${store.id.toString()} by the Database Agent ${agent.id?.toString() || ""}: ${snapshot.tables.length} table(s).`,
    );

    return {
      accepted: true,
      tables: snapshot.tables.length,
      schemaChanges: result.schemaChanges,
    };
  }
}
