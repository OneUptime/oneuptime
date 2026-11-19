import DataStoreService from "../../Services/DataStoreService";
import { SubscriptionStatusUtil } from "../../../Types/Billing/SubscriptionStatus";
import {
  DataStoreKind,
  TELEMETRY_DATA_STORE_KINDS,
  isDataStoreKind,
} from "../../../Types/DataSecurity/DataStoreKind";
import { readTelemetryDataStoreKeyOwnerId } from "../../../Types/DataSecurity/DataStoreKey";
import ObjectID from "../../../Types/ObjectID";
import { getServedProjectSql } from "./DataSecurityProbeClaim";
import { TelemetryOwnersNotScanned } from "./Telemetry/TelemetryDataScanner";

/*
 * WHAT THE HOURLY TELEMETRY SCAN MAY READ: A PROJECT THAT IS SERVED AND
 * SCANS TELEMETRY, AND OF IT ONLY THE SERVICES WHOSE STORE STILL SCANS.
 *
 * A service's logs, traces, exceptions, replays, AI conversations and metrics are
 * each a data store of their own, read by the project's telemetry scan
 * (DataSecurityRunner.scanTelemetry) rather than handed out by a claim.
 * It read every service of every project, whatever it was told
 * (OneUptime issue #8323): a store's own Scan Content switch did nothing,
 * so someone who turned it off to stop OneUptime sampling a service's logs
 * got findings with masked samples all the same, and a suspended or
 * blocked project's telemetry was read like any other.
 *
 * Now, before it reads anything, the scan asks whether the project may be
 * read (getTelemetryProjectScannableSql: served, and its telemetry
 * scanning on), and which of its telemetry stores turned content scanning
 * off (getTelemetryStoreScannableSql, IS NOT TRUE): those services' records
 * of that kind are left out of every read, so their content never leaves
 * ClickHouse. It asks both again before it writes what it found, so a
 * switch turned off while it ran is honoured too.
 *
 * A store's being archived does not stop the scan: archived means no longer
 * found, and the scan finds the service again and brings its store back
 * (DataSecurityDiscovery.ensureTelemetryStore). A store deleted is made
 * again the next time its service sends telemetry, its switch on.
 */

/*
 * The most switched-off telemetry stores one read takes. A project with
 * more is not read at all, rather than read in part: past this the scan
 * cannot tell which services it must leave out.
 */
export const MAX_TELEMETRY_STORES_NOT_SCANNED: number = 50_000;

/*
 * Whether a project's telemetry may be scanned now, as SQL over `p` (the
 * Project) and `s` (its Data Security settings, if it has them), with the
 * served subscription statuses bound as the parameter named.
 *
 * - The project scans telemetry (on unless its settings say otherwise).
 *   Its Scan Content switch is the stores' and their claims', not this.
 * - The project is served (getServedProjectSql).
 */
export function getTelemetryProjectScannableSql(parameters: {
  statusesParameter: string;
}): string {
  return [
    `COALESCE(s."isTelemetryScanEnabled", true) = true`,
    ...getServedProjectSql(parameters.statusesParameter),
  ].join("\n    AND ");
}

/*
 * Whether a telemetry store's content may be read, as SQL over `ds`: its
 * own Scan Content switch on.
 */
export function getTelemetryStoreScannableSql(): string {
  return [`ds."isContentScanEnabled" = true`].join("\n    AND ");
}

// Parameters: $1 the project, $2 the served subscription statuses.
export const PROJECT_TELEMETRY_SCANNABLE_STATEMENT: string = `SELECT p."_id" AS "_id"
FROM "Project" p
LEFT JOIN "DataSecuritySetting" s
  ON s."projectId" = p."_id" AND s."deletedAt" IS NULL
WHERE p."_id" = $1
  AND ${getTelemetryProjectScannableSql({ statusesParameter: "$2" })}`;

/*
 * The project's telemetry stores whose content may not be read. IS NOT
 * TRUE, so a switch that is NULL is read as off. Parameters: $1 the
 * project, $2 the telemetry kinds, $3 the most rows.
 */
export const TELEMETRY_STORES_NOT_SCANNED_STATEMENT: string = `SELECT ds."storeKey" AS "storeKey", ds."kind" AS "kind"
FROM "DataStore" ds
WHERE ds."projectId" = $1
  AND ds."deletedAt" IS NULL
  AND ds."kind" = ANY($2::text[])
  AND (${getTelemetryStoreScannableSql()}) IS NOT TRUE
LIMIT $3`;

// Whether the project's telemetry may be read now.
export async function isProjectTelemetryScannable(
  projectId: ObjectID,
): Promise<boolean> {
  const rows: unknown = await DataStoreService.getRepository().manager.query(
    PROJECT_TELEMETRY_SCANNABLE_STATEMENT,
    [
      projectId.toString(),
      SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
    ],
  );

  return Array.isArray(rows) && rows.length > 0;
}

/*
 * The services - for session replays, the RUM applications - whose
 * telemetry of each kind the scan must leave out, their ids in lower case.
 * Throws when it cannot tell: the caller then reads nothing.
 */
export async function getTelemetryOwnersNotScanned(
  projectId: ObjectID,
): Promise<TelemetryOwnersNotScanned> {
  const rows: unknown = await DataStoreService.getRepository().manager.query(
    TELEMETRY_STORES_NOT_SCANNED_STATEMENT,
    [
      projectId.toString(),
      [...TELEMETRY_DATA_STORE_KINDS],
      MAX_TELEMETRY_STORES_NOT_SCANNED,
    ],
  );

  if (!Array.isArray(rows)) {
    throw new Error(
      "The telemetry stores whose content scanning is off could not be read.",
    );
  }

  if (rows.length >= MAX_TELEMETRY_STORES_NOT_SCANNED) {
    throw new Error(
      `The project has ${MAX_TELEMETRY_STORES_NOT_SCANNED} or more telemetry stores whose content scanning is off, so the scan cannot tell which services to leave out.`,
    );
  }

  const notScanned: Map<DataStoreKind, Set<string>> = new Map();

  for (const row of rows as Array<{ storeKey?: unknown; kind?: unknown }>) {
    const ownerId: string | null = readTelemetryDataStoreKeyOwnerId(
      typeof row.storeKey === "string" ? row.storeKey : null,
    );

    if (!ownerId || !isDataStoreKind(row.kind)) {
      continue;
    }

    const owners: Set<string> = notScanned.get(row.kind) || new Set();
    owners.add(ownerId.toLowerCase());
    notScanned.set(row.kind, owners);
  }

  return notScanned;
}

// Whether the scan must leave this service's telemetry of this kind out.
export function isTelemetryOwnerNotScanned(
  notScanned: TelemetryOwnersNotScanned,
  kind: DataStoreKind,
  ownerId: string,
): boolean {
  return Boolean(notScanned.get(kind)?.has(ownerId.toLowerCase()));
}
