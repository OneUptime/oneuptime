import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";

/*
 * ONE SEARCH ACROSS EVERY KIND OF RESOURCE AN INCIDENT, AN ALERT OR A
 * MAINTENANCE EVENT CAN AFFECT.
 *
 * Issue #5341: a customer read the Affected Resources picker as "a lookup
 * against Hosts" - a project with hosts and network devices found its
 * hosts, and nothing else, because routers and switches could not be
 * linked at all, and every kind the picker did search was asked for twice
 * per keystroke (its name, then its description), about thirty requests a
 * letter. The picker now asks once (POST /affected-resources/search), and
 * the server reads each kind with the person's own rights: a kind they may
 * not read is named, never listed, and labels and owned scope narrow the
 * rest as a list of that kind would.
 *
 * This module is the request and the answer, read the same way on both
 * sides: the kinds (the picker's AffectedResourceType values), the limits,
 * and the parsers that keep a malformed request out of the server and a
 * malformed answer out of the picker. React-free and server-free.
 */

export enum AffectedResourceKind {
  Monitor = "Monitor",
  Host = "Host",
  NetworkDevice = "NetworkDevice",
  KubernetesCluster = "KubernetesCluster",
  DockerHost = "DockerHost",
  PodmanHost = "PodmanHost",
  ProxmoxCluster = "ProxmoxCluster",
  VMwareVCenter = "VMwareVCenter",
  CephCluster = "CephCluster",
  StorageArray = "StorageArray",
  DockerSwarmCluster = "DockerSwarmCluster",
  IoTFleet = "IoTFleet",
  DatabaseServer = "DatabaseServer",
  CloudResource = "CloudResource",
  NetworkSite = "NetworkSite",
  Service = "Service",
}

// Every kind, in the order the enum lists them.
export const AFFECTED_RESOURCE_KINDS: ReadonlyArray<AffectedResourceKind> =
  Object.values(AffectedResourceKind);

// The route the picker, the API and an API key ask.
export const AFFECTED_RESOURCE_SEARCH_ROUTE: string =
  "/affected-resources/search";

/*
 * How many of each kind one answer lists: a page of suggestions per kind
 * while every kind is shown, more once the person narrows to one.
 */
export const AFFECTED_RESOURCE_SEARCH_DEFAULT_LIMIT: number = 15;
export const AFFECTED_RESOURCE_SEARCH_MAX_LIMIT: number = 50;

/*
 * The longest text searched for. A name is at most a few hundred
 * characters; anything longer is cut rather than refused, so a pasted line
 * still finds the resource it starts with.
 */
export const AFFECTED_RESOURCE_SEARCH_MAX_TEXT_LENGTH: number = 200;

export interface AffectedResourceSearchRequest {
  // What the person typed. Empty asks for suggestions: the first by name.
  search: string;
  // The kinds to list, in the order the picker shows them. At least one.
  kinds: Array<AffectedResourceKind>;
  // How many of each kind to list, 1 to AFFECTED_RESOURCE_SEARCH_MAX_LIMIT.
  limitPerKind: number;
  /*
   * Kinds that are only counted, never listed: the monitors a search for
   * "api" in Other Affected Resources also matches, so the picker can say
   * where monitors are picked. Never a kind of `kinds`.
   */
  countKinds: Array<AffectedResourceKind>;
}

// One resource of a kind, as the picker lists it.
export interface AffectedResourceSearchMatch {
  _id: string;
  name: string;
  // What tells two of one name apart - a network device's address.
  detail?: string | undefined;
}

export interface AffectedResourceSearchKindResult {
  kind: AffectedResourceKind;
  // How many of the kind match, all of them - not only the listed ones.
  count: number;
  matches: Array<AffectedResourceSearchMatch>;
}

export interface AffectedResourceSearchCount {
  kind: AffectedResourceKind;
  count: number;
}

export interface AffectedResourceSearchResult {
  // One per readable kind asked for, in the order asked for.
  kinds: Array<AffectedResourceSearchKindResult>;
  // One per readable count-only kind.
  counts: Array<AffectedResourceSearchCount>;
  // The kinds asked for (listed or counted) the caller may not read.
  unreadableKinds: Array<AffectedResourceKind>;
}

export function isAffectedResourceKind(
  value: unknown,
): value is AffectedResourceKind {
  return (
    typeof value === "string" &&
    AFFECTED_RESOURCE_KINDS.includes(value as AffectedResourceKind)
  );
}

// Each kind once, in the order first given.
function readKinds(value: unknown, name: string): Array<AffectedResourceKind> {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new BadDataException(`${name} must be a list of resource kinds.`);
  }

  const kinds: Array<AffectedResourceKind> = [];

  for (const item of value) {
    if (!isAffectedResourceKind(item)) {
      throw new BadDataException(
        `${name} lists ${JSON.stringify(item)?.substring(0, 60) || "nothing"}, which is not a kind of resource. Use one of: ${AFFECTED_RESOURCE_KINDS.join(", ")}.`,
      );
    }

    if (!kinds.includes(item)) {
      kinds.push(item);
    }
  }

  return kinds;
}

/*
 * A request as the server takes it: the kinds checked (an unknown one is
 * refused, naming the ones there are), each kind once, the text trimmed and
 * cut to its limit, the limit held between 1 and the maximum, and a kind
 * both listed and counted listed only.
 */
export function readAffectedResourceSearchRequest(
  body: unknown,
): AffectedResourceSearchRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BadDataException(
      "The search must be a JSON object with search and kinds.",
    );
  }

  const json: JSONObject = body as JSONObject;
  const rawSearch: unknown = json["search"];

  if (
    rawSearch !== undefined &&
    rawSearch !== null &&
    typeof rawSearch !== "string"
  ) {
    throw new BadDataException("search must be text.");
  }

  const search: string = (typeof rawSearch === "string" ? rawSearch : "")
    .trim()
    .substring(0, AFFECTED_RESOURCE_SEARCH_MAX_TEXT_LENGTH)
    .trim();

  const kinds: Array<AffectedResourceKind> = readKinds(json["kinds"], "kinds");

  if (kinds.length === 0) {
    throw new BadDataException(
      "kinds must name at least one kind of resource to search.",
    );
  }

  const countKinds: Array<AffectedResourceKind> = readKinds(
    json["countKinds"],
    "countKinds",
  ).filter((kind: AffectedResourceKind): boolean => {
    return !kinds.includes(kind);
  });

  const rawLimit: unknown = json["limitPerKind"];
  let limitPerKind: number = AFFECTED_RESOURCE_SEARCH_DEFAULT_LIMIT;

  if (rawLimit !== undefined && rawLimit !== null) {
    const parsed: number =
      typeof rawLimit === "number" ? rawLimit : Number(rawLimit);

    if (!Number.isFinite(parsed)) {
      throw new BadDataException("limitPerKind must be a number.");
    }

    limitPerKind = Math.min(
      AFFECTED_RESOURCE_SEARCH_MAX_LIMIT,
      Math.max(1, Math.floor(parsed)),
    );
  }

  return { search, kinds, limitPerKind, countKinds };
}

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

/*
 * An answer as the picker reads it: an entry it cannot read (no kind, no
 * id) is dropped rather than shown half, and a count is never below the
 * matches listed.
 */
export function readAffectedResourceSearchResult(
  data: unknown,
): AffectedResourceSearchResult {
  const json: JSONObject =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as JSONObject)
      : {};

  const kinds: Array<AffectedResourceSearchKindResult> = [];

  for (const entry of Array.isArray(json["kinds"]) ? json["kinds"] : []) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const kindJson: JSONObject = entry as JSONObject;
    const kind: unknown = kindJson["kind"];

    if (!isAffectedResourceKind(kind)) {
      continue;
    }

    const matches: Array<AffectedResourceSearchMatch> = [];
    const rawMatches: unknown = kindJson["matches"];

    for (const match of Array.isArray(rawMatches) ? rawMatches : []) {
      if (!match || typeof match !== "object" || Array.isArray(match)) {
        continue;
      }

      const matchJson: JSONObject = match as JSONObject;
      const id: unknown = matchJson["_id"];

      if (typeof id !== "string" || !ObjectID.isValidUUID(id)) {
        continue;
      }

      const name: unknown = matchJson["name"];
      const detail: unknown = matchJson["detail"];
      const read: AffectedResourceSearchMatch = {
        _id: id,
        name: typeof name === "string" ? name : "",
      };

      if (typeof detail === "string" && detail.trim()) {
        read.detail = detail.trim();
      }

      matches.push(read);
    }

    kinds.push({
      kind: kind,
      count: Math.max(readCount(kindJson["count"]), matches.length),
      matches: matches,
    });
  }

  const counts: Array<AffectedResourceSearchCount> = [];

  for (const entry of Array.isArray(json["counts"]) ? json["counts"] : []) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const countJson: JSONObject = entry as JSONObject;
    const kind: unknown = countJson["kind"];

    if (isAffectedResourceKind(kind)) {
      counts.push({ kind: kind, count: readCount(countJson["count"]) });
    }
  }

  const unreadableKinds: Array<AffectedResourceKind> = [];

  for (const kind of Array.isArray(json["unreadableKinds"])
    ? json["unreadableKinds"]
    : []) {
    if (isAffectedResourceKind(kind) && !unreadableKinds.includes(kind)) {
      unreadableKinds.push(kind);
    }
  }

  return { kinds, counts, unreadableKinds };
}

// The answer as JSON, as the route sends it.
export function toAffectedResourceSearchResultJSON(
  result: AffectedResourceSearchResult,
): JSONObject {
  return {
    kinds: result.kinds.map(
      (kind: AffectedResourceSearchKindResult): JSONObject => {
        return {
          kind: kind.kind,
          count: kind.count,
          matches: kind.matches.map(
            (match: AffectedResourceSearchMatch): JSONObject => {
              const json: JSONObject = { _id: match._id, name: match.name };

              if (match.detail) {
                json["detail"] = match.detail;
              }

              return json;
            },
          ),
        };
      },
    ),
    counts: result.counts.map(
      (count: AffectedResourceSearchCount): JSONObject => {
        return { kind: count.kind, count: count.count };
      },
    ),
    unreadableKinds: [...result.unreadableKinds],
  };
}
