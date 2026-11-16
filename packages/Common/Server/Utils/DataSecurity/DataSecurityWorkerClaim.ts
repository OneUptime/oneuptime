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
 * Measured, not assumed (OneUptime issue #8392). Against 245,000 stores -
 * 180,000 of kinds no worker samples (telemetry, RDS, DynamoDB, Redshift),
 * 25,000 switched off or of a suspended project, 500 due and scannable -
 * this statement was one sequential read of the table from cache: 5,878
 * buffers, 71 ms, every five minutes, writing nothing but the 50 it
 * claims. The probes' set-aside does not fit this range:
 *
 * - Its bounds hold aside at most SET_ASIDE_PER_CLAIM x
 *   SET_ASIDE_ROUNDS_PER_CLAIM rows per claim, and here a claim runs every
 *   five minutes while a row set aside comes back in a quarter of an hour.
 *   About 8,000 rows can be aside at once; the other 207,000 stay due at
 *   the head of the range, and the claim, now in index order, walks them
 *   all: 231,000 buffers and 85 ms, worse than the read it replaced.
 * - Each row it moves is an update of every index the table has (17):
 *   about 57 buffers a row, 28 ms a round of 500. Keeping a range like this
 *   one aside would rewrite every refused store every quarter of an hour,
 *   for good, to save a cached read every five minutes.
 *
 * A probe's claims run per probe, from every replica, several times a
 * minute, over a range of that probe's own: there the set-aside pays. Here
 * it does not.
 *
 * What does: a range of only the kinds a worker samples (OneUptime issue
 * #8450). DataStore has an index of ("kind", "nextContentScanAt") over the
 * stores no probe scans, and with it Postgres reads this statement as a
 * bitmap of `kind = ANY($2) AND (nextContentScanAt IS NULL OR <= $1)`: each
 * sampled kind's due rows, and none of the telemetry and unsampled cloud
 * kinds that are most of the table. The statement is the same; the plan is
 * not. Measured on the fixture above (25,000 refused split evenly between
 * switched off and suspended, Postgres 15, cached), with the claim's own
 * write of the 50 it holds - about 2,800 buffers either way - included:
 *
 * - 245,000 stores: 52 ms and 7,986 buffers before, 11 ms and 3,561
 *   after. All 25,000 refused stores switched off: 66 to 10 ms; all of
 *   suspended projects: 70 to 18 ms.
 * - 2,450,000 stores: 626 ms and 56,177 buffers before, 126 ms and 9,797
 *   after. The read no longer grows with the stores no worker samples,
 *   only with the due stores of the kinds it does.
 * - The index costs a write too: 4 to 10% more buffers for an insert or a
 *   write no HOT update can take, none for one that can. It moves no
 *   store's HOT updates, since its columns are indexed already.
 *
 * Reading each kind apart (unnest the kinds, a LATERAL range of each) was
 * slower, 244 ms at 245,000: the planner read "never scanned" by a
 * sequential scan of the table for each kind.
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
