import {
  DiscoveredDeviceShow,
  DiscoveredDeviceSort,
  DiscoveredDeviceSortOrder,
  MAX_DISCOVERED_DEVICE_SEARCH_WORDS,
} from "../../../Types/NetworkDevice/DiscoveredDevice";
import { getMacSearchHex } from "../../../Utils/NetworkDevice/DiscoveredDeviceIdentity";

/*
 * THE STATEMENTS THE DISCOVERED DEVICES LIST RUNS (OneUptime issue #5775).
 *
 * One project's NetworkEndpoint rows, each classified in the database the
 * way the topology map classifies it (NetworkTopologyUtil's endpoint
 * adoption):
 *
 *   - monitored by MAC: a live, unarchived device whose MAC is the row's,
 *     compared as twelve hex digits so a MAC typed with dashes or dots
 *     still matches the colon form a switch's table is stored in;
 *   - monitored by address: while the sighting is current, a live device
 *     polled at the row's address IN THE SAME SITE - every branch has a
 *     10.0.0.5, and no site on either side is a site of its own;
 *   - hidden: the map has a suppression for the row's endpoint node.
 *
 * Built as text plus positional parameters, never with a value in the
 * text, so a search is data however it is spelled. The pieces are pure so
 * the unit suite can read them; DiscoveredDeviceListPostgres.test.ts runs
 * them on Postgres.
 *
 * What the bulk actions write - the map's suppressions - DiscoveredDevices
 * writes itself, where it records each one in the audit log by the person
 * who hid or showed it (StatementParams builds those statements too).
 *
 * Devices are joined by hash rather than per row: a site may hold
 * thousands of endpoints, and NetworkDevice has no index on its MAC, so a
 * lookup per row would read every device once per endpoint.
 */

export interface DiscoveredDeviceStatement {
  sql: string;
  params: Array<unknown>;
}

export interface DiscoveredDeviceScope {
  projectId: string;
  siteId?: string | undefined;
  endpointIds?: Array<string> | undefined;
  // A sighting at or after these is current: a walk's, a controller's.
  walkSeenSince: Date;
  controllerSeenSince: Date;
}

export interface DiscoveredDeviceRowsQuery {
  scope: DiscoveredDeviceScope;
  search: string;
  show: DiscoveredDeviceShow;
  sort: DiscoveredDeviceSort;
  sortOrder: DiscoveredDeviceSortOrder;
  limit: number;
  skip: number;
}

// A strict dotted quad: only these are cast to inet to sort by address.
const IPV4_SQL_PATTERN: string =
  "^(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])([.](25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])){3}$";

// The columns a row is drawn from.
const ROW_COLUMNS: string = [
  `c."id"`,
  `c."macAddress"`,
  `c."ipAddress"`,
  `c."hostname"`,
  `c."vendor"`,
  `c."classification"`,
  `c."attachedNetworkDeviceId"`,
  `c."attachedPortName"`,
  `c."vlanId"`,
  `c."siteId"`,
  `c."firstSeenAt"`,
  `c."lastSeenAt"`,
  `c."isFromController"`,
  `c."isSeenRecently"`,
  `c."isHidden"`,
  `c."monitoredDeviceId"`,
  `c."monitoredBy"`,
].join(", ");

export class StatementParams {
  public readonly values: Array<unknown> = [];

  public add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

// "!" escapes LIKE's wildcards, so a search for "10_0" means what it says.
export function escapeLikePattern(text: string): string {
  return text.replace(/[!%_]/g, (character: string): string => {
    return `!${character}`;
  });
}

export function getSearchWords(search: string): Array<string> {
  return search
    .split(/\s+/)
    .map((word: string): string => {
      return word.trim();
    })
    .filter((word: string): boolean => {
      return word.length > 0;
    })
    .slice(0, MAX_DISCOVERED_DEVICE_SEARCH_WORDS);
}

/*
 * The classified rows, as a WITH clause ending in "classified". Its
 * parameters are added first, so it is always built before anything that
 * reads it.
 */
export function buildClassifiedRows(
  scope: DiscoveredDeviceScope,
  params: StatementParams,
): string {
  const project: string = params.add(scope.projectId);
  const walkSince: string = params.add(scope.walkSeenSince);
  const controllerSince: string = params.add(scope.controllerSeenSince);

  const endpointFilters: Array<string> = [
    `e."projectId" = ${project}::uuid`,
    `e."deletedAt" IS NULL`,
  ];

  if (scope.siteId) {
    endpointFilters.push(`e."siteId" = ${params.add(scope.siteId)}::uuid`);
  }

  if (scope.endpointIds) {
    endpointFilters.push(
      `e."_id" = ANY(${params.add(scope.endpointIds)}::uuid[])`,
    );
  }

  return `WITH devices AS (
  SELECT d."_id", d."createdAt",
    regexp_replace(lower(COALESCE(d."macAddress", '')), '[^0-9a-f]', '', 'g') AS "macKey",
    btrim(COALESCE(d."hostname", '')) AS "address",
    COALESCE(d."siteId"::text, '') AS "siteKey"
  FROM "NetworkDevice" d
  WHERE d."projectId" = ${project}::uuid
    AND d."deletedAt" IS NULL
    AND COALESCE(d."isArchived", false) = false
),
mac_devices AS (
  SELECT DISTINCT ON (dm."macKey") dm."macKey", dm."_id"
  FROM devices dm
  WHERE length(dm."macKey") = 12
  ORDER BY dm."macKey", dm."createdAt" ASC, dm."_id" ASC
),
address_devices AS (
  SELECT DISTINCT ON (da."siteKey", da."address") da."siteKey", da."address", da."_id"
  FROM devices da
  WHERE da."address" <> ''
  ORDER BY da."siteKey", da."address", da."createdAt" ASC, da."_id" ASC
),
hidden AS (
  SELECT DISTINCT s."nodeKey"
  FROM "NetworkTopologySuppression" s
  WHERE s."projectId" = ${project}::uuid
    AND s."deletedAt" IS NULL
    AND s."nodeKey" LIKE 'endpoint:%'
),
sighted AS (
  SELECT e."_id" AS "id", e."macAddress", e."ipAddress", e."hostname",
    e."vendor", e."classification", e."attachedNetworkDeviceId",
    e."attachedPortName", e."vlanId", e."siteId", e."firstSeenAt",
    e."lastSeenAt",
    (COALESCE(e."attachmentSource", '') <> '') AS "isFromController",
    (
      e."lastSeenAt" IS NOT NULL
      AND e."lastSeenAt" >= CASE
        WHEN COALESCE(e."attachmentSource", '') = '' THEN ${walkSince}::timestamptz
        ELSE ${controllerSince}::timestamptz
      END
    ) AS "isSeenRecently",
    regexp_replace(lower(COALESCE(e."macAddress", '')), '[^0-9a-f]', '', 'g') AS "macKey",
    btrim(COALESCE(e."ipAddress", '')) AS "address",
    COALESCE(e."siteId"::text, '') AS "siteKey"
  FROM "NetworkEndpoint" e
  WHERE ${endpointFilters.join("\n    AND ")}
),
classified AS (
  SELECT r.*,
    COALESCE(
      md."_id",
      CASE WHEN r."isSeenRecently" THEN ad."_id" END
    ) AS "monitoredDeviceId",
    CASE
      WHEN md."_id" IS NOT NULL THEN 'macAddress'
      WHEN r."isSeenRecently" AND ad."_id" IS NOT NULL THEN 'ipAddress'
    END AS "monitoredBy",
    (h."nodeKey" IS NOT NULL) AS "isHidden",
    lower(COALESCE(
      NULLIF(btrim(r."classification"), ''),
      NULLIF(btrim(r."hostname"), ''),
      NULLIF(r."address", ''),
      r."macAddress"
    )) AS "sortName"
  FROM sighted r
  LEFT JOIN mac_devices md
    ON length(r."macKey") = 12 AND md."macKey" = r."macKey"
  LEFT JOIN address_devices ad
    ON r."address" <> '' AND ad."address" = r."address" AND ad."siteKey" = r."siteKey"
  LEFT JOIN hidden h
    ON h."nodeKey" = 'endpoint:' || r."id"::text
)`;
}

/*
 * Every word must match one of the row's names, its address, its maker or
 * its MAC - as stored, or as hex digits when the word reads as part of a
 * MAC however it is separated.
 */
export function buildSearchCondition(
  search: string,
  params: StatementParams,
): string {
  const words: Array<string> = getSearchWords(search);

  if (words.length === 0) {
    return "TRUE";
  }

  return words
    .map((word: string): string => {
      const pattern: string = params.add(`%${escapeLikePattern(word)}%`);
      const matches: Array<string> = [
        `c."classification"`,
        `c."hostname"`,
        `c."ipAddress"`,
        `c."vendor"`,
        `c."macAddress"`,
      ].map((column: string): string => {
        return `${column} ILIKE ${pattern} ESCAPE '!'`;
      });

      const hex: string | null = getMacSearchHex(word);

      if (hex) {
        matches.push(`c."macKey" LIKE ${params.add(`%${hex}%`)}`);
      }

      return `(${matches.join(" OR ")})`;
    })
    .join(" AND ");
}

export function buildShowCondition(show: DiscoveredDeviceShow): string {
  switch (show) {
    case DiscoveredDeviceShow.NotMonitored:
      return `c."monitoredDeviceId" IS NULL`;
    case DiscoveredDeviceShow.Monitored:
      return `c."monitoredDeviceId" IS NOT NULL`;
    case DiscoveredDeviceShow.Hidden:
      return `(c."monitoredDeviceId" IS NULL AND c."isHidden")`;
    case DiscoveredDeviceShow.All:
      return "TRUE";
  }
}

// Ties fall to the row id, so a page never repeats or skips a row.
export function buildOrder(
  sort: DiscoveredDeviceSort,
  sortOrder: DiscoveredDeviceSortOrder,
): string {
  const direction: string = sortOrder === "asc" ? "ASC" : "DESC";

  let primary: string;

  switch (sort) {
    case DiscoveredDeviceSort.LastSeen:
      primary = `c."lastSeenAt" ${direction} NULLS LAST`;
      break;
    case DiscoveredDeviceSort.FirstSeen:
      primary = `c."firstSeenAt" ${direction} NULLS LAST`;
      break;
    case DiscoveredDeviceSort.Name:
      primary = `c."sortName" ${direction} NULLS LAST`;
      break;
    case DiscoveredDeviceSort.Vendor:
      primary = `lower(NULLIF(btrim(c."vendor"), '')) ${direction} NULLS LAST`;
      break;
    case DiscoveredDeviceSort.IpAddress:
      /*
       * By address as a number, so 10.0.0.9 comes before 10.0.0.10; what
       * is not a dotted quad (v6, or nothing) after, as text.
       */
      primary = `(CASE WHEN c."address" ~ '${IPV4_SQL_PATTERN}' THEN c."address"::inet END) ${direction} NULLS LAST, NULLIF(c."address", '') ${direction} NULLS LAST`;
      break;
  }

  return `${primary}, c."id" ASC`;
}

// How many rows each `show` holds, for one search.
export function buildCountsStatement(data: {
  scope: DiscoveredDeviceScope;
  search: string;
}): DiscoveredDeviceStatement {
  const params: StatementParams = new StatementParams();
  const classified: string = buildClassifiedRows(data.scope, params);
  const search: string = buildSearchCondition(data.search, params);

  return {
    sql: `${classified}
SELECT
  COUNT(*)::int AS "all",
  COUNT(*) FILTER (WHERE c."monitoredDeviceId" IS NULL)::int AS "notMonitored",
  COUNT(*) FILTER (WHERE c."monitoredDeviceId" IS NOT NULL)::int AS "monitored",
  COUNT(*) FILTER (WHERE c."monitoredDeviceId" IS NULL AND c."isHidden")::int AS "hidden"
FROM classified c
WHERE ${search}`,
    params: params.values,
  };
}

// One page of rows.
export function buildRowsStatement(
  query: DiscoveredDeviceRowsQuery,
): DiscoveredDeviceStatement {
  const params: StatementParams = new StatementParams();
  const classified: string = buildClassifiedRows(query.scope, params);
  const search: string = buildSearchCondition(query.search, params);
  const limit: string = params.add(Math.max(1, Math.floor(query.limit)));
  const skip: string = params.add(Math.max(0, Math.floor(query.skip)));

  return {
    sql: `${classified}
SELECT ${ROW_COLUMNS}
FROM classified c
WHERE ${search}
  AND ${buildShowCondition(query.show)}
ORDER BY ${buildOrder(query.sort, query.sortOrder)}
LIMIT ${limit} OFFSET ${skip}`,
    params: params.values,
  };
}

// Every matching row, up to `limit`, in the list's order: enough to name it.
export function buildIdsStatement(data: {
  scope: DiscoveredDeviceScope;
  search: string;
  show: DiscoveredDeviceShow;
  sort: DiscoveredDeviceSort;
  sortOrder: DiscoveredDeviceSortOrder;
  limit: number;
}): DiscoveredDeviceStatement {
  const params: StatementParams = new StatementParams();
  const classified: string = buildClassifiedRows(data.scope, params);
  const search: string = buildSearchCondition(data.search, params);
  const limit: string = params.add(Math.max(1, Math.floor(data.limit)));

  return {
    sql: `${classified}
SELECT c."id", c."classification", c."hostname", c."ipAddress", c."macAddress", c."monitoredDeviceId"
FROM classified c
WHERE ${search}
  AND ${buildShowCondition(data.show)}
ORDER BY ${buildOrder(data.sort, data.sortOrder)}
LIMIT ${limit}`,
    params: params.values,
  };
}

/*
 * How long the project keeps a device nothing sees any more (issue #6389):
 * what the list says about it. Read with the list, as the list's other
 * statements are, so anyone who may read the list reads it too.
 */
export function buildRetentionStatement(
  projectId: string,
): DiscoveredDeviceStatement {
  const params: StatementParams = new StatementParams();
  const project: string = params.add(projectId);

  return {
    sql: `SELECT p."discoveredDeviceRetentionInDays" AS "retentionInDays"
FROM "Project" p
WHERE p."_id" = ${project}::uuid`,
    params: params.values,
  };
}

// The rows of these ids, classified: what a bulk action acts on.
export function buildClassifyStatement(
  scope: DiscoveredDeviceScope,
): DiscoveredDeviceStatement {
  const params: StatementParams = new StatementParams();
  const classified: string = buildClassifiedRows(scope, params);

  return {
    sql: `${classified}
SELECT ${ROW_COLUMNS}
FROM classified c
ORDER BY c."id" ASC`,
    params: params.values,
  };
}
