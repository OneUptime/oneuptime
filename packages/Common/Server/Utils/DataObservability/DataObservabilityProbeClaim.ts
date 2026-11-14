import DataStore from "../../../Models/DatabaseModels/DataStore";
import DataStoreService from "../../Services/DataStoreService";
import { SubscriptionStatusUtil } from "../../../Types/Billing/SubscriptionStatus";
import OneUptimeDate from "../../../Types/Date";
import { DataStoreProvider } from "../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../Types/ObjectID";
import { isValidProbeConnectionVariable } from "../DataSecurity/DataSecurityProbeScan";
import {
  DATA_OBSERVABILITY_KINDS,
  getCollectorEngineOfKind,
} from "./DataObservabilityEngines";
import {
  DataObservabilityProbeStoreWork,
  TABLE_HEALTH_CLAIM_IN_MINUTES,
} from "./DataObservabilityProbeCollect";
import {
  getQueryHistoryLookbackInSeconds,
  MAX_COLUMNS_PER_COLLECTION,
  MAX_TABLES_PER_COLLECTION,
} from "./TableHealthCollector";
import { PlannedDataCheck } from "./DataCheckResults";

/*
 * HANDING A PROBE THE STORES WHOSE TABLES IT COLLECTS, EACH TO ONE POLL.
 *
 * The stores due for a table-health collection by a probe: watched, not
 * archived, self-managed, of a kind a probe can read, with a connection
 * variable, due or never collected, of an active project - and only
 * through the project's own probe, never a global one. As with Data
 * Security's scans (DataSecurityProbeClaim), claiming moves
 * nextTableHealthCollectionAt forward in the one statement that locks the
 * stores FOR NO KEY UPDATE SKIP LOCKED, so no two polls get the same store
 * and a probe that dies holding one gives it up when the claim runs out.
 * The collection's result sets the next time (TableHealthIngest).
 *
 * Never a transaction, so no store stays locked past that statement - and
 * a foreign-key check of a row that names one never waits for the claim
 * (OneUptime issue #7194). The stores come back in claim order, the
 * longest overdue first.
 */

export interface ClaimedTableHealthStore {
  _id: string;
  projectId: string;
}

export const CLAIM_DUE_TABLE_HEALTH_STORES_STATEMENT: string = `WITH "due" AS (
  SELECT ds."_id" AS "_id", ds."projectId" AS "projectId", ds."nextTableHealthCollectionAt" AS "dueAt"
  FROM "DataStore" ds
  INNER JOIN "Project" p ON ds."projectId" = p."_id"
  INNER JOIN "Probe" pr ON ds."scanProbeId" = pr."_id"
  WHERE ds."scanProbeId" = $1
    AND ds."deletedAt" IS NULL
    AND ds."isTableHealthEnabled" = true
    AND ds."isArchived" = false
    AND ds."provider" = $2
    AND ds."kind" = ANY($3::text[])
    AND ds."probeConnectionVariable" IS NOT NULL
    AND ds."probeConnectionVariable" <> ''
    AND (ds."nextTableHealthCollectionAt" IS NULL OR ds."nextTableHealthCollectionAt" <= $4)
    -- The project's own probe: a global probe never reads a store.
    AND pr."isGlobalProbe" = false
    AND pr."projectId" = ds."projectId"
    AND pr."deletedAt" IS NULL
    AND p."deletedAt" IS NULL
    AND p."isBlocked" = false
    AND p."isSampleProject" = false
    AND (p."paymentProviderSubscriptionStatus" IS NULL
         OR p."paymentProviderSubscriptionStatus" = ANY($5::text[]))
    AND (p."paymentProviderMeteredSubscriptionStatus" IS NULL
         OR p."paymentProviderMeteredSubscriptionStatus" = ANY($5::text[]))
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
SELECT "due"."_id" AS "_id", "due"."projectId" AS "projectId"
FROM "due"
INNER JOIN "claimed" ON "claimed"."_id" = "due"."_id"
ORDER BY "due"."dueAt" ASC NULLS FIRST`;

export async function claimDueTableHealthStoresForProbe(data: {
  probeId: ObjectID;
  limit: number;
}): Promise<Array<ClaimedTableHealthStore>> {
  if (data.limit <= 0) {
    return [];
  }

  const now: Date = OneUptimeDate.getCurrentDate();
  const claimedUntil: Date = OneUptimeDate.addRemoveMinutes(
    now,
    TABLE_HEALTH_CLAIM_IN_MINUTES,
  );

  const rows: unknown = await DataStoreService.getRepository().manager.query(
    CLAIM_DUE_TABLE_HEALTH_STORES_STATEMENT,
    [
      data.probeId.toString(),
      DataStoreProvider.SelfManaged,
      [...DATA_OBSERVABILITY_KINDS],
      now,
      SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
      Math.floor(data.limit),
      claimedUntil,
    ],
  );

  return Array.isArray(rows) ? (rows as Array<ClaimedTableHealthStore>) : [];
}

/*
 * The work of one claimed store, as the probe is handed it; null when no
 * probe could do it. Lineage is read back to the store's last collection
 * (tableHealthCollectedAt), at its first collection of each hour.
 */
export function buildProbeCollectWork(
  store: DataStore,
  checks: Array<PlannedDataCheck> = [],
  now: Date = OneUptimeDate.getCurrentDate(),
): DataObservabilityProbeStoreWork | null {
  const engine: ReturnType<typeof getCollectorEngineOfKind> =
    getCollectorEngineOfKind(store.kind);

  if (
    !store.id ||
    !engine ||
    !isValidProbeConnectionVariable(store.probeConnectionVariable)
  ) {
    return null;
  }

  return {
    dataStoreId: store.id.toString(),
    engine,
    probeConnectionVariable: store.probeConnectionVariable,
    maxTables: MAX_TABLES_PER_COLLECTION,
    maxColumns: MAX_COLUMNS_PER_COLLECTION,
    exclusions: (store.scanExclusions || []).filter(
      (exclusion: unknown): exclusion is string => {
        return typeof exclusion === "string";
      },
    ),
    checks,
    queryHistoryLookbackInSeconds: getQueryHistoryLookbackInSeconds(
      store.tableHealthCollectedAt,
      now,
    ),
  };
}
