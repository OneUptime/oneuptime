import { EntityManager } from "typeorm";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DataStoreService from "../../Services/DataStoreService";
import { SubscriptionStatusUtil } from "../../../Types/Billing/SubscriptionStatus";
import OneUptimeDate from "../../../Types/Date";
import { DataStoreProvider } from "../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../Types/ObjectID";
import {
  getDatabaseEngineOfKind,
  isValidProbeConnectionVariable,
  PROBE_SCANNABLE_KINDS,
} from "../DataSecurity/DataSecurityProbeScan";
import {
  DataObservabilityProbeStoreWork,
  TABLE_HEALTH_CLAIM_IN_MINUTES,
} from "./DataObservabilityProbeCollect";
import {
  MAX_COLUMNS_PER_COLLECTION,
  MAX_TABLES_PER_COLLECTION,
} from "./TableHealthCollector";

/*
 * HANDING A PROBE THE STORES WHOSE TABLES IT COLLECTS, EACH TO ONE POLL.
 *
 * The stores due for a table-health collection by a probe: watched, not
 * archived, self-managed, of a kind a probe can read, with a connection
 * variable, due or never collected, of an active project - and only
 * through the project's own probe, never a global one. As with Data
 * Security's scans (DataSecurityProbeClaim), claiming moves
 * nextTableHealthCollectionAt forward in the same transaction as the
 * SELECT ... FOR UPDATE SKIP LOCKED, so no two polls get the same store and
 * a probe that dies holding one gives it up when the claim runs out. The
 * collection's result sets the next time (TableHealthIngest).
 */

export interface ClaimedTableHealthStore {
  _id: string;
  projectId: string;
}

export const CLAIM_DUE_TABLE_HEALTH_STORES_STATEMENT: string = `SELECT ds."_id" AS "_id", ds."projectId" AS "projectId"
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
  AND (p."paymentProviderSubscriptionStatus" IS NULL
       OR p."paymentProviderSubscriptionStatus" = ANY($5::text[]))
  AND (p."paymentProviderMeteredSubscriptionStatus" IS NULL
       OR p."paymentProviderMeteredSubscriptionStatus" = ANY($5::text[]))
ORDER BY ds."nextTableHealthCollectionAt" ASC NULLS FIRST
LIMIT $6
FOR UPDATE OF ds SKIP LOCKED`;

// ::timestamptz, so the claim is the instant it says in any time zone.
export const HOLD_CLAIMED_TABLE_HEALTH_STORES_STATEMENT: string = `UPDATE "DataStore" SET "nextTableHealthCollectionAt" = $1::timestamptz
WHERE "_id" = ANY($2::uuid[])`;

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

  return await DataStoreService.executeTransaction(
    async (manager: EntityManager): Promise<Array<ClaimedTableHealthStore>> => {
      const rows: Array<ClaimedTableHealthStore> = await manager.query(
        CLAIM_DUE_TABLE_HEALTH_STORES_STATEMENT,
        [
          data.probeId.toString(),
          DataStoreProvider.SelfManaged,
          [...PROBE_SCANNABLE_KINDS],
          now,
          SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
          Math.floor(data.limit),
        ],
      );

      if (rows.length === 0) {
        return [];
      }

      await manager.query(HOLD_CLAIMED_TABLE_HEALTH_STORES_STATEMENT, [
        claimedUntil,
        rows.map((row: ClaimedTableHealthStore) => {
          return row._id;
        }),
      ]);

      return rows;
    },
  );
}

// The work of one claimed store, as the probe is handed it; null when no probe could do it.
export function buildProbeCollectWork(
  store: DataStore,
): DataObservabilityProbeStoreWork | null {
  const engine: ReturnType<typeof getDatabaseEngineOfKind> =
    getDatabaseEngineOfKind(store.kind);

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
  };
}
