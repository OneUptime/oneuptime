import DataStoreService from "../../Services/DataStoreService";
import { SubscriptionStatusUtil } from "../../../Types/Billing/SubscriptionStatus";
import OneUptimeDate from "../../../Types/Date";
import { DataStoreProvider } from "../../../Types/DataSecurity/DataStoreKind";
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
 * - The project is served (ProjectService.getActiveProjectStatusQuery):
 *   not deleted, not blocked, not a sample, and its subscriptions not
 *   inactive.
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
    `p."deletedAt" IS NULL`,
    `p."isBlocked" = false`,
    `p."isSampleProject" = false`,
    `(p."paymentProviderSubscriptionStatus" IS NULL OR p."paymentProviderSubscriptionStatus" = ANY(${parameters.statusesParameter}::text[]))`,
    `(p."paymentProviderMeteredSubscriptionStatus" IS NULL OR p."paymentProviderMeteredSubscriptionStatus" = ANY(${parameters.statusesParameter}::text[]))`,
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
 * Sets aside the probe's due stores whose content nothing may scan now
 * (Utils/Probe/ClaimSetAside): content scanning off on the store or for the
 * project, archived, not self-managed or of a kind a probe cannot sample,
 * without a connection variable, on a probe that is not the project's own,
 * or of a suspended, blocked, sample or deleted project. Each is judged
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
        [...PROBE_SCANNABLE_KINDS],
        SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
      ],
    }),
  );

  return readSetAsideCounts(rows);
}

export async function claimDueDataStoresForProbe(data: {
  probeId: ObjectID;
  limit: number;
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
      [...PROBE_SCANNABLE_KINDS],
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
      });
    },
  });

  return Array.isArray(rows) ? (rows as Array<ClaimedDataStore>) : [];
}
