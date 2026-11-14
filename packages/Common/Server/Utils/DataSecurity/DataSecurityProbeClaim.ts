import DataStoreService from "../../Services/DataStoreService";
import { SubscriptionStatusUtil } from "../../../Types/Billing/SubscriptionStatus";
import OneUptimeDate from "../../../Types/Date";
import { DataStoreProvider } from "../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../Types/ObjectID";
import {
  DATA_SECURITY_PROBE_CLAIM_IN_MINUTES,
  PROBE_SCANNABLE_KINDS,
} from "./DataSecurityProbeScan";

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
 */

export interface ClaimedDataStore {
  _id: string;
  projectId: string;
}

export const CLAIM_DUE_DATA_STORES_STATEMENT: string = `WITH "due" AS (
  SELECT ds."_id" AS "_id", ds."projectId" AS "projectId", ds."nextContentScanAt" AS "dueAt"
  FROM "DataStore" ds
  INNER JOIN "Project" p ON ds."projectId" = p."_id"
  INNER JOIN "Probe" pr ON ds."scanProbeId" = pr."_id"
  LEFT JOIN "DataSecuritySetting" s
    ON s."projectId" = ds."projectId" AND s."deletedAt" IS NULL
  WHERE ds."scanProbeId" = $1
    AND ds."deletedAt" IS NULL
    AND ds."isContentScanEnabled" = true
    AND ds."isArchived" = false
    AND ds."provider" = $2
    AND ds."kind" = ANY($3::text[])
    AND ds."probeConnectionVariable" IS NOT NULL
    AND ds."probeConnectionVariable" <> ''
    AND (ds."nextContentScanAt" IS NULL OR ds."nextContentScanAt" <= $4)
    AND COALESCE(s."isContentScanEnabled", true) = true
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
  ORDER BY ds."nextContentScanAt" ASC NULLS FIRST
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
ORDER BY "due"."dueAt" ASC NULLS FIRST`;

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

  return Array.isArray(rows) ? (rows as Array<ClaimedDataStore>) : [];
}
