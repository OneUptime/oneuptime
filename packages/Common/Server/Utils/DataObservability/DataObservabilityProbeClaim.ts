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
import {
  SetAsideCounts,
  getClaimSetAsideParameters,
  getClaimSetAsideStatement,
  readSetAsideCounts,
  setAsideAfterClaim,
} from "../Probe/ClaimSetAside";

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
 *
 * `nextTableHealthCollectionAt <= now`, oldest first, is a range of the
 * (scanProbeId, nextTableHealthCollectionAt) index in its own order, which
 * stops at the limit; `IS NULL OR` and `NULLS FIRST` made it read and sort
 * every due store of the probe. After each claim, the due stores it stepped
 * over because nothing may collect them are set aside for a quarter of an
 * hour, and the probe's stores with no due time made due
 * (setAsideUncollectableTableHealthStores, Utils/Probe/ClaimSetAside); a
 * write that makes a store collectable makes it due at once
 * (DataStoreService).
 */

export interface ClaimedTableHealthStore {
  _id: string;
  projectId: string;
}

/*
 * Whether a store's tables may be handed to its probe to collect now, as
 * SQL over the aliases the claim's statements use - `ds` (the DataStore),
 * `p` (its Project) and `pr` (its scan Probe) - with the self-managed
 * provider, the kinds a probe collects and the served subscription
 * statuses bound as the parameters named. The claim keeps the stores it is
 * true for and the set-aside moves the ones it is not true for: one
 * definition, so a store the claim would hand out is never one the
 * set-aside moves. Read through LEFT JOINs, a missing project or probe is
 * NULL here, never true.
 *
 * - Not deleted, watched, not archived, self-managed, of a kind a probe can
 *   read, with the connection variable the probe reads.
 * - The project's own probe: a global probe never reads a store.
 * - The project is served (ProjectService.getActiveProjectStatusQuery):
 *   not deleted, not blocked, not a sample, and its subscriptions not
 *   inactive.
 */
export function getTableHealthCollectableSql(parameters: {
  providerParameter: string;
  kindsParameter: string;
  statusesParameter: string;
}): string {
  return [
    `ds."deletedAt" IS NULL`,
    `ds."isTableHealthEnabled" = true`,
    `ds."isArchived" = false`,
    `ds."provider" = ${parameters.providerParameter}`,
    `ds."kind" = ANY(${parameters.kindsParameter}::text[])`,
    `ds."probeConnectionVariable" IS NOT NULL`,
    `ds."probeConnectionVariable" <> ''`,
    `pr."isGlobalProbe" = false`,
    `pr."projectId" = ds."projectId"`,
    `pr."deletedAt" IS NULL`,
    `p."deletedAt" IS NULL`,
    `p."isBlocked" = false`,
    `p."isSampleProject" = false`,
    `(p."paymentProviderSubscriptionStatus" IS NULL OR p."paymentProviderSubscriptionStatus" = ANY(${parameters.statusesParameter}::text[]))`,
    `(p."paymentProviderMeteredSubscriptionStatus" IS NULL OR p."paymentProviderMeteredSubscriptionStatus" = ANY(${parameters.statusesParameter}::text[]))`,
  ].join("\n    AND ");
}

export const CLAIM_DUE_TABLE_HEALTH_STORES_STATEMENT: string = `WITH "due" AS (
  SELECT ds."_id" AS "_id", ds."projectId" AS "projectId", ds."nextTableHealthCollectionAt" AS "dueAt"
  FROM "DataStore" ds
  INNER JOIN "Project" p ON ds."projectId" = p."_id"
  INNER JOIN "Probe" pr ON ds."scanProbeId" = pr."_id"
  WHERE ds."scanProbeId" = $1
    AND ds."nextTableHealthCollectionAt" <= $4
    AND ${getTableHealthCollectableSql({
      providerParameter: "$2",
      kindsParameter: "$3",
      statusesParameter: "$5",
    })}
  ORDER BY ds."nextTableHealthCollectionAt" ASC
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
ORDER BY "due"."dueAt" ASC`;

/*
 * Sets aside the probe's due stores whose tables nothing may collect now
 * (Utils/Probe/ClaimSetAside): not watched, archived, not self-managed or
 * of a kind a probe cannot read, without a connection variable, on a probe
 * that is not the project's own, or of a suspended, blocked, sample or
 * deleted project. Each is judged again by the claim's own rule
 * (getTableHealthCollectableSql, IS NOT TRUE), so a store the claim would
 * hand out is never moved. Makes due the probe's stores with no
 * nextTableHealthCollectionAt at all.
 *
 * Only ever the stores of the probe's own scanProbeId range, which no
 * worker collects (DataObservabilityRunner leaves a probe's store to it).
 *
 * Returns how many it set aside, and how many it made due.
 */
export async function setAsideUncollectableTableHealthStores(data: {
  probeId: ObjectID;
  currentDate: Date;
}): Promise<SetAsideCounts> {
  const rows: unknown = await DataStoreService.getRepository().manager.query(
    getClaimSetAsideStatement({
      table: "DataStore",
      alias: "ds",
      dueColumn: "nextTableHealthCollectionAt",
      sources: [{ from: `"DataStore" ds`, where: `ds."scanProbeId" = $1` }],
      joins: `LEFT JOIN "Project" p ON ds."projectId" = p."_id"
        LEFT JOIN "Probe" pr ON ds."scanProbeId" = pr."_id"`,
      isProbesRow: `ds."scanProbeId" = $1`,
      claimable: getTableHealthCollectableSql({
        providerParameter: "$6",
        kindsParameter: "$7",
        statusesParameter: "$8",
      }),
    }),
    getClaimSetAsideParameters({
      probeId: data.probeId,
      currentDate: data.currentDate,
      ruleParameters: [
        DataStoreProvider.SelfManaged,
        [...DATA_OBSERVABILITY_KINDS],
        SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
      ],
    }),
  );

  return readSetAsideCounts(rows);
}

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

  await setAsideAfterClaim({
    claim: "claimDueTableHealthStoresForProbe",
    probeId: data.probeId,
    rows: "data stores whose tables nothing may collect now",
    round: async (): Promise<SetAsideCounts> => {
      return await setAsideUncollectableTableHealthStores({
        probeId: data.probeId,
        currentDate: now,
      });
    },
  });

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
