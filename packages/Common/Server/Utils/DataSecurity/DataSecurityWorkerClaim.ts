import DataStoreService from "../../Services/DataStoreService";
import { SubscriptionStatusUtil } from "../../../Types/Billing/SubscriptionStatus";
import OneUptimeDate from "../../../Types/Date";
import { WORKER_CLAIMED_DATA_STORE_KINDS } from "../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../Types/ObjectID";
import {
  ClaimedDataStore,
  getServedProjectSql,
} from "./DataSecurityProbeClaim";

/*
 * HANDING ONEUPTIME'S WORKERS THE STORES WHOSE CONTENT THEY SCAN, EACH TO
 * ONE WORKER ONLY - AND NONE THAT A PERSON TURNED SCANNING OFF FOR.
 *
 * The stores no probe scans (scanProbeId IS NULL) whose content is due:
 * content scanning on, not archived, of a kind a worker samples, of a
 * project whose Data Security scans content and that is served
 * (getServedProjectSql). One self-committing statement, like the probe's
 * (DataSecurityProbeClaim): the longest overdue first (a store never
 * scanned before any other), locked FOR NO KEY UPDATE SKIP LOCKED, and
 * held DATA_SECURITY_WORKER_CLAIM_IN_HOURS on in the same statement, so two
 * runs never get one store. The scan's result sets the next scan's time
 * (DataSecurityFindingWriter).
 *
 * The workers' claim read far less than this (OneUptime issue #8325): it
 * never read the project, so a suspended, blocked or sample project's
 * stores had their content sampled, and it never read the project's
 * content switch, so every store of a project that turned content
 * scanning off was claimed, held for an hour and dropped, forever. It had
 * no order, so with more due stores than one run takes the ones claimed
 * were whatever Postgres found first, those dropped ones among them.
 *
 * A store nothing may scan keeps its due time, so it is scanned the first
 * run after it may be - a project served again, its content switch turned
 * back on. The claim steps over such stores in the order it reads, once
 * every five minutes from one worker: no set-aside (Utils/Probe/
 * ClaimSetAside) is needed for that.
 *
 * The scan reads the same rule again for the store it was handed
 * (isDataStoreContentScannableByWorkers) before it reads any content, so
 * a switch turned off, or a project suspended, after the claim - or a
 * scan queued by Scan Now - reads nothing.
 */

// How long a claimed store is held for the worker that took it.
export const DATA_SECURITY_WORKER_CLAIM_IN_HOURS: number = 1;

/*
 * Whether a store's content may be scanned by OneUptime's workers now, as
 * SQL over the aliases the statements here use - `ds` (the DataStore), `p`
 * (its Project) and `s` (the project's Data Security settings, if it has
 * them) - with the kinds a worker samples and the served subscription
 * statuses bound as the parameters named. The claim hands out the stores
 * it is true for, and the scan reads it again before it samples one. Read
 * through a LEFT JOIN, missing settings are the defaults (content scanning
 * on).
 *
 * - Not deleted, content scanning on, not archived, of a kind a worker
 *   samples (WORKER_CLAIMED_DATA_STORE_KINDS).
 * - The project scans content (on unless its settings say otherwise).
 * - The project is served (getServedProjectSql).
 */
export function getWorkerContentScannableSql(parameters: {
  kindsParameter: string;
  statusesParameter: string;
}): string {
  return [
    `ds."deletedAt" IS NULL`,
    `ds."isContentScanEnabled" = true`,
    `ds."isArchived" = false`,
    `ds."kind" = ANY(${parameters.kindsParameter}::text[])`,
    `COALESCE(s."isContentScanEnabled", true) = true`,
    ...getServedProjectSql(parameters.statusesParameter),
  ].join("\n    AND ");
}

/*
 * Parameters: $1 now, $2 the kinds a worker samples, $3 the served
 * subscription statuses, $4 the most stores to claim, $5 when the hold
 * runs out.
 */
export const CLAIM_DUE_DATA_STORES_FOR_WORKERS_STATEMENT: string = `WITH "due" AS (
  SELECT ds."_id" AS "_id", ds."projectId" AS "projectId", ds."nextContentScanAt" AS "dueAt"
  FROM "DataStore" ds
  INNER JOIN "Project" p ON ds."projectId" = p."_id"
  LEFT JOIN "DataSecuritySetting" s
    ON s."projectId" = ds."projectId" AND s."deletedAt" IS NULL
  WHERE ds."scanProbeId" IS NULL
    AND (ds."nextContentScanAt" IS NULL OR ds."nextContentScanAt" <= $1)
    AND ${getWorkerContentScannableSql({
      kindsParameter: "$2",
      statusesParameter: "$3",
    })}
  ORDER BY ds."nextContentScanAt" ASC NULLS FIRST
  LIMIT $4
  FOR NO KEY UPDATE OF ds SKIP LOCKED
),
"claimed" AS (
  -- ::timestamptz, so the hold is the instant it says in any time zone.
  UPDATE "DataStore" AS ds
  SET "nextContentScanAt" = $5::timestamptz
  FROM "due"
  WHERE ds."_id" = "due"."_id"
  RETURNING ds."_id"
)
SELECT "due"."_id" AS "_id", "due"."projectId" AS "projectId"
FROM "due"
INNER JOIN "claimed" ON "claimed"."_id" = "due"."_id"
ORDER BY "due"."dueAt" ASC NULLS FIRST`;

/*
 * The one store, if a worker may scan its content now: the claim's rule,
 * of the project named, with no scan probe. Parameters: $1 the store, $2
 * its project, $3 the kinds a worker samples, $4 the served subscription
 * statuses.
 */
export const DATA_STORE_SCANNABLE_BY_WORKERS_STATEMENT: string = `SELECT ds."_id" AS "_id"
FROM "DataStore" ds
INNER JOIN "Project" p ON ds."projectId" = p."_id"
LEFT JOIN "DataSecuritySetting" s
  ON s."projectId" = ds."projectId" AND s."deletedAt" IS NULL
WHERE ds."_id" = $1
  AND ds."projectId" = $2
  AND ds."scanProbeId" IS NULL
  AND ${getWorkerContentScannableSql({
    kindsParameter: "$3",
    statusesParameter: "$4",
  })}`;

export async function claimDueDataStoresForWorkers(data: {
  limit: number;
}): Promise<Array<ClaimedDataStore>> {
  if (data.limit <= 0) {
    return [];
  }

  const now: Date = OneUptimeDate.getCurrentDate();

  const rows: unknown = await DataStoreService.getRepository().manager.query(
    CLAIM_DUE_DATA_STORES_FOR_WORKERS_STATEMENT,
    [
      now,
      [...WORKER_CLAIMED_DATA_STORE_KINDS],
      SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
      Math.floor(data.limit),
      OneUptimeDate.addRemoveHours(now, DATA_SECURITY_WORKER_CLAIM_IN_HOURS),
    ],
  );

  return Array.isArray(rows) ? (rows as Array<ClaimedDataStore>) : [];
}

// Whether OneUptime's workers may read this store's content now.
export async function isDataStoreContentScannableByWorkers(data: {
  projectId: ObjectID;
  dataStoreId: ObjectID;
}): Promise<boolean> {
  const rows: unknown = await DataStoreService.getRepository().manager.query(
    DATA_STORE_SCANNABLE_BY_WORKERS_STATEMENT,
    [
      data.dataStoreId.toString(),
      data.projectId.toString(),
      [...WORKER_CLAIMED_DATA_STORE_KINDS],
      SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
    ],
  );

  return Array.isArray(rows) && rows.length > 0;
}
