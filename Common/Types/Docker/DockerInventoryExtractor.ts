import OneUptimeDate from "../Date";
import { JSONObject } from "../JSON";
import { ParsedDockerResource } from "../../Server/Services/DockerResourceService";

/*
 * ------------------------------------------------------------------
 *                     DockerInventoryExtractor
 * ------------------------------------------------------------------
 *
 * Parses a single inventory log record emitted by the OneUptime
 * Docker Agent's snapshot script. The script polls the local Docker
 * daemon every 5 minutes for containers / images / networks /
 * volumes and emits one JSON object per line into a log file that
 * the OTel filelog receiver forwards as an OTLP log.
 *
 * The agreed wire format is a JSON envelope:
 *
 *   {
 *     "kind":  "Container" | "Image" | "Network" | "Volume",
 *     "data":  { ...native docker payload... }
 *   }
 *
 * The kind discriminator is set as a log record attribute by the
 * agent's filelog operator chain, but we also keep it inside the
 * envelope so the parser can sanity-check.
 *
 * Each kind has a small dedicated parser that pulls out the fields
 * we promote to first-class columns on `DockerResource` (name,
 * containerId, imageName, state, labels, creation timestamp). The
 * full payload is *not* persisted — it lives on the original log
 * record in ClickHouse if a user ever needs the raw blob.
 *
 * ------------------------------------------------------------------
 */

export const INVENTORY_KIND_ATTRIBUTE: string = "oneuptime.docker.kind";

export const INVENTORIED_DOCKER_KINDS: ReadonlyArray<string> = [
  "Container",
  "Image",
  "Network",
  "Volume",
];

const INVENTORIED_KIND_SET: Set<string> = new Set(
  INVENTORIED_DOCKER_KINDS.map((k: string) => {
    return k.toLowerCase();
  }),
);

export function isInventoriedDockerKind(kind: string): boolean {
  return INVENTORIED_KIND_SET.has(kind.toLowerCase());
}

/*
 * Map a kind in any common form (lowercase plural, lowercase
 * singular, or PascalCase) to the canonical PascalCase kind we store
 * in the database. Returns null for anything we don't model.
 */
export function canonicalDockerKind(raw: string): string | null {
  const trimmed: string = (raw || "").trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  const map: Record<string, string> = {
    container: "Container",
    containers: "Container",
    image: "Image",
    images: "Image",
    network: "Network",
    networks: "Network",
    volume: "Volume",
    volumes: "Volume",
  };
  return map[trimmed] || null;
}

function parseLogBody(logBody: string): JSONObject | null {
  try {
    const parsed: unknown = JSON.parse(logBody);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as JSONObject;
    }
    return null;
  } catch {
    return null;
  }
}

function readString(obj: JSONObject, key: string): string | null {
  const v: unknown = obj[key];
  if (typeof v === "string" && v.trim().length > 0) {
    return v.trim();
  }
  return null;
}

function readJSONObject(obj: JSONObject, key: string): JSONObject | null {
  const v: unknown = obj[key];
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as JSONObject;
  }
  return null;
}

function parseTimestamp(raw: string | null): Date | null {
  if (!raw) {
    return null;
  }
  try {
    const d: Date = OneUptimeDate.fromString(raw);
    if (isNaN(d.getTime())) {
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

/*
 * Container shape emitted by `docker container ls --format json` plus
 * a few enrichments the agent script adds:
 *   { Id, Names, Image, State, Status, CreatedAt, Labels }
 *
 * Names from the Docker CLI is a slash-prefixed comma-joined string
 * ("/web,/web-1"). We strip the leading slash and take the first
 * entry — that's what `docker_stats` reports as `container.name` in
 * metric attributes, so the row keys stay consistent across paths.
 */
function parseContainer(
  data: JSONObject,
  lastSeenAt: Date,
): ParsedDockerResource | null {
  const rawNames: string | null = readString(data, "Names");
  const rawName: string | null = readString(data, "Name");
  const namesField: string = rawNames || rawName || "";
  const firstName: string = namesField
    .split(",")
    .map((n: string) => {
      return n.trim().replace(/^\//, "");
    })
    .filter((n: string) => {
      return n.length > 0;
    })[0]!;

  if (!firstName) {
    return null;
  }

  const idRaw: string | null = readString(data, "Id");
  const containerId: string | null = idRaw ? idRaw.substring(0, 12) : null;
  const imageName: string | null = readString(data, "Image");
  const state: string | null = readString(data, "State");
  const labels: JSONObject | null = readJSONObject(data, "Labels");
  const created: Date | null = parseTimestamp(readString(data, "CreatedAt"));

  return {
    kind: "Container",
    name: firstName,
    containerId,
    imageName,
    state: state ? state.toLowerCase() : null,
    labels,
    resourceCreationTimestamp: created,
    lastSeenAt,
  };
}

/*
 * Image shape from `docker image ls --format json`:
 *   { ID, Repository, Tag, CreatedAt, Labels }
 *
 * Name = Repository:Tag (matches what container.image.name emits).
 * Skip dangling images (Repository=<none> with no tag) — they would
 * collide on the unique key and are noise in a list view.
 */
function parseImage(
  data: JSONObject,
  lastSeenAt: Date,
): ParsedDockerResource | null {
  const repository: string | null = readString(data, "Repository");
  const tag: string | null = readString(data, "Tag");
  const explicitName: string | null = readString(data, "Name");

  let name: string | null = explicitName;
  if (!name && repository && repository !== "<none>") {
    name = tag && tag !== "<none>" ? `${repository}:${tag}` : repository;
  }

  if (!name) {
    return null;
  }

  const idRaw: string | null = readString(data, "ID") || readString(data, "Id");
  const containerId: string | null = idRaw
    ? idRaw.replace(/^sha256:/, "").substring(0, 12)
    : null;
  const labels: JSONObject | null = readJSONObject(data, "Labels");
  const created: Date | null = parseTimestamp(readString(data, "CreatedAt"));

  return {
    kind: "Image",
    name,
    containerId,
    imageName: null,
    state: null,
    labels,
    resourceCreationTimestamp: created,
    lastSeenAt,
  };
}

/*
 * Network shape from `docker network ls --format json`:
 *   { ID, Name, Driver, Scope, CreatedAt, Labels }
 */
function parseNetwork(
  data: JSONObject,
  lastSeenAt: Date,
): ParsedDockerResource | null {
  const name: string | null = readString(data, "Name");
  if (!name) {
    return null;
  }
  const idRaw: string | null = readString(data, "ID") || readString(data, "Id");
  const driver: string | null = readString(data, "Driver");
  const scope: string | null = readString(data, "Scope");
  const labels: JSONObject | null = readJSONObject(data, "Labels");
  const created: Date | null = parseTimestamp(readString(data, "CreatedAt"));

  /*
   * Driver and scope are surfaced in the State column in the widget
   * (e.g. "bridge / local"). Encoded as "driver/scope" so we don't
   * need a new column on the table.
   */
  const stateParts: Array<string> = [];
  if (driver) {
    stateParts.push(driver);
  }
  if (scope) {
    stateParts.push(scope);
  }

  return {
    kind: "Network",
    name,
    containerId: idRaw ? idRaw.substring(0, 12) : null,
    imageName: null,
    state: stateParts.length > 0 ? stateParts.join("/") : null,
    labels,
    resourceCreationTimestamp: created,
    lastSeenAt,
  };
}

/*
 * Volume shape from `docker volume ls --format json`:
 *   { Name, Driver, Mountpoint, Scope, Labels, CreatedAt }
 */
function parseVolume(
  data: JSONObject,
  lastSeenAt: Date,
): ParsedDockerResource | null {
  const name: string | null = readString(data, "Name");
  if (!name) {
    return null;
  }
  const driver: string | null = readString(data, "Driver");
  const scope: string | null = readString(data, "Scope");
  const labels: JSONObject | null = readJSONObject(data, "Labels");
  const created: Date | null = parseTimestamp(readString(data, "CreatedAt"));

  const stateParts: Array<string> = [];
  if (driver) {
    stateParts.push(driver);
  }
  if (scope) {
    stateParts.push(scope);
  }

  return {
    kind: "Volume",
    name,
    containerId: null,
    imageName: null,
    state: stateParts.length > 0 ? stateParts.join("/") : null,
    labels,
    resourceCreationTimestamp: created,
    lastSeenAt,
  };
}

export interface ExtractedDockerInventoryRecord {
  resource: ParsedDockerResource;
}

/**
 * Parse a single inventory log line. Returns null when the body is
 * malformed or the kind is not modeled — callers should swallow nulls
 * silently rather than fail the whole batch.
 */
export function extractDockerInventoryResource(data: {
  kind: string;
  logBody: string;
  lastSeenAt: Date;
}): ExtractedDockerInventoryRecord | null {
  const canonical: string | null = canonicalDockerKind(data.kind);
  if (!canonical) {
    return null;
  }

  const body: JSONObject | null = parseLogBody(data.logBody);
  if (!body) {
    return null;
  }

  /*
   * The agent wraps the native docker payload in `{ kind, data }`.
   * Older snapshot lines or test inputs may be the raw payload — we
   * accept either by pulling `data` if present, else using the body
   * directly.
   */
  const inner: JSONObject =
    (readJSONObject(body, "data") as JSONObject) || body;

  let parsed: ParsedDockerResource | null = null;
  if (canonical === "Container") {
    parsed = parseContainer(inner, data.lastSeenAt);
  } else if (canonical === "Image") {
    parsed = parseImage(inner, data.lastSeenAt);
  } else if (canonical === "Network") {
    parsed = parseNetwork(inner, data.lastSeenAt);
  } else if (canonical === "Volume") {
    parsed = parseVolume(inner, data.lastSeenAt);
  }

  if (!parsed) {
    return null;
  }

  return { resource: parsed };
}
