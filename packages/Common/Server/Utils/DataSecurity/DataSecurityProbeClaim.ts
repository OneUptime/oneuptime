import DataStoreService from "../../Services/DataStoreService";
import { SubscriptionStatusUtil } from "../../../Types/Billing/SubscriptionStatus";
import OneUptimeDate from "../../../Types/Date";
import {
  DataStoreKind,
  DataStoreProvider,
} from "../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../Types/ObjectID";
import {
  DATA_SECURITY_PROBE_CLAIM_IN_MINUTES,
  PROBE_SCANNABLE_KINDS,
} from "./DataSecurityProbeScan";
import {
  SetAsideCounts,
  getClaimSetAsideParameters,
  getClaimSetAsideStatement,
  readSetAsideCounts,
  setAsideAfterClaim,
} from "../Probe/ClaimSetAside";

/*
 * HANDING A PROBE THE STORES IT SCANS, EACH TO ONE POLL ONLY.
 *
 * The stores due for a scan by a probe: content scanning on, not archived,
 * self-managed, of a kind a probe samples, with a connection variable, due
 * or never scanned, of a project whose Data Security scans content and
 * that is active - and only through the project's own probe, never a
 * global one. Claiming moves nextContentScanAt forward by
 * DATA_SECURITY_PROBE_CLAIM_IN_MINUTES in the same statement that locks
 * the stores FOR NO KEY UPDATE SKIP LOCKED, so two polls - of this probe or
 * any other - never get the same store, and a probe that dies holding one
 * gives it up when the claim runs out. The scan's result sets the next
 * scan's time (DataSecurityFindingWriter).
 *
 * One self-committing statement, never a transaction (OneUptime issue
 * #7194). A transaction held each claimed store FOR UPDATE across its round
 * trips, and every write about those stores - a finding that names one, the
 * last scan's result - waited for its COMMIT. FOR NO KEY UPDATE is the lock
 * the UPDATE takes anyway, and a foreign-key check does not wait for it.
 * The stores come back in claim order, the longest overdue first.
 *
 * `nextContentScanAt <= now`, oldest first, is a range of the
 * (scanProbeId, nextContentScanAt) index in its own order, which stops at
 * the limit; `IS NULL OR` and `NULLS FIRST` made it read and sort every due
 * store of the probe. After each claim, the due stores it stepped over
 * because nothing may scan them are set aside for a quarter of an hour, and
 * the probe's stores with no due time made due (setAsideUnscannableStores,
 * Utils/Probe/ClaimSetAside); a write that makes a store scannable makes it
 * due at once (DataStoreService, DataSecuritySettingService).
 */

export interface ClaimedDataStore {
  _id: string;
  projectId: string;
}

/*
 * Whether the project `p` is served (ProjectService.getActiveProjectStatusQuery):
 * not deleted, not blocked, and its subscriptions not inactive, with the
 * served subscription statuses bound as the parameter named. Every Data
 * Security path that reads a store's content holds a project to it - the
 * probe's claim, the workers' claim and their scan (DataSecurityWorkerClaim),
 * and the hourly telemetry scan (DataSecurityTelemetryScanRule) - so nothing
 * of a suspended or blocked project is read. Read through a LEFT JOIN, a
 * missing project is NULL here, never true.
 */
export function getServedProjectSql(statusesParameter: string): Array<string> {
  return [
    `p."deletedAt" IS NULL`,
    `p."isBlocked" = false`,
    `(p."paymentProviderSubscriptionStatus" IS NULL OR p."paymentProviderSubscriptionStatus" = ANY(${statusesParameter}::text[]))`,
    `(p."paymentProviderMeteredSubscriptionStatus" IS NULL OR p."paymentProviderMeteredSubscriptionStatus" = ANY(${statusesParameter}::text[]))`,
  ];
}

/*
 * Whether a store's content may be handed to its probe to scan now, as SQL
 * over the aliases the claim's statements use - `ds` (the DataStore), `p`
 * (its Project), `pr` (its scan Probe) and `s` (the project's Data Security
 * settings, if it has them) - with the self-managed provider, the kinds a
 * probe samples and the served subscription statuses bound as the
 * parameters named. The claim keeps the stores it is true for and the
 * set-aside moves the ones it is not true for: one definition, so a store
 * the claim would hand out is never one the set-aside moves. Read through
 * LEFT JOINs, a missing project or probe is NULL here, never true.
 *
 * - Not deleted, content scanning on, not archived, self-managed, of a kind
 *   a probe samples, with the connection variable the probe reads.
 * - The project scans content (on unless its settings say otherwise).
 * - The project's own probe: a global probe never reads a store.
 * - The project is served (getServedProjectSql).
 */
export function getContentScannableSql(parameters: {
  providerParameter: string;
  kindsParameter: string;
  statusesParameter: string;
}): string {
  return [
    `ds."deletedAt" IS NULL`,
    `ds."isContentScanEnabled" = true`,
    `ds."isArchived" = false`,
    `ds."provider" = ${parameters.providerParameter}`,
    `ds."kind" = ANY(${parameters.kindsParameter}::text[])`,
    `ds."probeConnectionVariable" IS NOT NULL`,
    `ds."probeConnectionVariable" <> ''`,
    `COALESCE(s."isContentScanEnabled", true) = true`,
    `pr."isGlobalProbe" = false`,
    `pr."projectId" = ds."projectId"`,
    `pr."deletedAt" IS NULL`,
    ...getServedProjectSql(parameters.statusesParameter),
  ].join("\n    AND ");
}

export const CLAIM_DUE_DATA_STORES_STATEMENT: string = `WITH "due" AS (
  SELECT ds."_id" AS "_id", ds."projectId" AS "projectId", ds."nextContentScanAt" AS "dueAt"
  FROM "DataStore" ds
  INNER JOIN "Project" p ON ds."projectId" = p."_id"
  INNER JOIN "Probe" pr ON ds."scanProbeId" = pr."_id"
  LEFT JOIN "DataSecuritySetting" s
    ON s."projectId" = ds."projectId" AND s."deletedAt" IS NULL
  WHERE ds."scanProbeId" = $1
    AND ds."nextContentScanAt" <= $4
    AND ${getContentScannableSql({
      providerParameter: "$2",
      kindsParameter: "$3",
      statusesParameter: "$5",
    })}
  ORDER BY ds."nextContentScanAt" ASC
  LIMIT $6
  FOR NO KEY UPDATE OF ds SKIP LOCKED
),
"claimed" AS (
  -- ::timestamptz, so the claim is the instant it says in any time zone.
  UPDATE "DataStore" AS ds
  SET "nextContentScanAt" = $7::timestamptz
  FROM "due"
  WHERE ds."_id" = "due"."_id"
  RETURNING ds."_id"
)
SELECT "due"."_id" AS "_id", "due"."projectId" AS "projectId"
FROM "due"
INNER JOIN "claimed" ON "claimed"."_id" = "due"."_id"
ORDER BY "due"."dueAt" ASC`;

/*
 * The one store, if its probe may still scan its content: the claim's rule
 * (getContentScannableSql) for the store named, through the probe named,
 * whatever its due time. A probe scans in the customer's network for
 * minutes after its claim (up to DATA_SECURITY_PROBE_SCAN_TIME_LIMIT_IN_
 * SECONDS), and the result route asks this before it records anything of
 * that scan (OneUptime issue #8391): a store whose Scan Content, or whose
 * project's, was turned off in that time, or whose project was suspended,
 * blocked or deleted, keeps no finding and no masked sample of it, as the
 * workers' scan and the telemetry scan keep none (#8323, #8325).
 * Parameters: $1 the store, $2 the probe, $3 the self-managed provider,
 * $4 the kinds a probe samples, $5 the served subscription statuses.
 */
export const DATA_STORE_SCANNABLE_BY_PROBE_STATEMENT: string = `SELECT ds."_id" AS "_id"
FROM "DataStore" ds
INNER JOIN "Project" p ON ds."projectId" = p."_id"
INNER JOIN "Probe" pr ON ds."scanProbeId" = pr."_id"
LEFT JOIN "DataSecuritySetting" s
  ON s."projectId" = ds."projectId" AND s."deletedAt" IS NULL
WHERE ds."_id" = $1
  AND ds."scanProbeId" = $2
  AND ${getContentScannableSql({
    providerParameter: "$3",
    kindsParameter: "$4",
    statusesParameter: "$5",
  })}`;

// Whether this probe may still scan this store's content, and keep what it found.
export async function isDataStoreContentScannableByProbe(data: {
  probeId: ObjectID;
  dataStoreId: ObjectID;
}): Promise<boolean> {
  const rows: unknown = await DataStoreService.getRepository().manager.query(
    DATA_STORE_SCANNABLE_BY_PROBE_STATEMENT,
    [
      data.dataStoreId.toString(),
      data.probeId.toString(),
      DataStoreProvider.SelfManaged,
      [...PROBE_SCANNABLE_KINDS],
      SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
    ],
  );

  return Array.isArray(rows) && rows.length > 0;
}

/*
 * Sets aside the probe's due stores whose content nothing may scan now
 * (Utils/Probe/ClaimSetAside): content scanning off on the store or for the
 * project, archived, not self-managed or of a kind a probe cannot sample,
 * without a connection variable, on a probe that is not the project's own,
 * or of a suspended, blocked or deleted project. Each is judged
 * again by the claim's own rule (getContentScannableSql, IS NOT TRUE), so a
 * store the claim would hand out is never moved. Makes due the probe's
 * stores with no nextContentScanAt at all.
 *
 * Only ever the stores of the probe's own scanProbeId range, which no
 * worker scans (DataSecurityRunner claims only stores with no scan probe).
 *
 * Returns how many it set aside, and how many it made due.
 */
export async function setAsideUnscannableStores(data: {
  probeId: ObjectID;
  currentDate: Date;
  // The kinds this probe may be handed (getProbeClaimableKinds): every kind a probe samples unless said.
  kinds?: ReadonlyArray<DataStoreKind> | undefined;
}): Promise<SetAsideCounts> {
  const rows: unknown = await DataStoreService.getRepository().manager.query(
    getClaimSetAsideStatement({
      table: "DataStore",
      alias: "ds",
      dueColumn: "nextContentScanAt",
      sources: [{ from: `"DataStore" ds`, where: `ds."scanProbeId" = $1` }],
      joins: `LEFT JOIN "Project" p ON ds."projectId" = p."_id"
        LEFT JOIN "Probe" pr ON ds."scanProbeId" = pr."_id"
        LEFT JOIN "DataSecuritySetting" s
          ON s."projectId" = ds."projectId" AND s."deletedAt" IS NULL`,
      isProbesRow: `ds."scanProbeId" = $1`,
      claimable: getContentScannableSql({
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
        [...(data.kinds || PROBE_SCANNABLE_KINDS)],
        SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
      ],
    }),
  );

  return readSetAsideCounts(rows);
}

export async function claimDueDataStoresForProbe(data: {
  probeId: ObjectID;
  limit: number;
  /*
   * The kinds this probe may be handed, by what it declares
   * (getProbeClaimableKinds): a search cluster only to a probe whose build
   * reads one (#11140). Every kind a probe samples unless said.
   */
  kinds?: ReadonlyArray<DataStoreKind> | undefined;
}): Promise<Array<ClaimedDataStore>> {
  if (data.limit <= 0) {
    return [];
  }

  const now: Date = OneUptimeDate.getCurrentDate();
  const claimedUntil: Date = OneUptimeDate.addRemoveMinutes(
    now,
    DATA_SECURITY_PROBE_CLAIM_IN_MINUTES,
  );

  const rows: unknown = await DataStoreService.getRepository().manager.query(
    CLAIM_DUE_DATA_STORES_STATEMENT,
    [
      data.probeId.toString(),
      DataStoreProvider.SelfManaged,
      [...(data.kinds || PROBE_SCANNABLE_KINDS)],
      now,
      SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
      Math.floor(data.limit),
      claimedUntil,
    ],
  );

  await setAsideAfterClaim({
    claim: "claimDueDataStoresForProbe",
    probeId: data.probeId,
    rows: "data stores whose content nothing may scan now",
    round: async (): Promise<SetAsideCounts> => {
      return await setAsideUnscannableStores({
        probeId: data.probeId,
        currentDate: now,
        kinds: data.kinds,
      });
    },
  });

  return Array.isArray(rows) ? (rows as Array<ClaimedDataStore>) : [];
}
