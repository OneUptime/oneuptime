import { JSONObject, JSONValue } from "../JSON";

/*
 * WHAT A CLOUD ACCOUNT'S INVENTORY SAYS ABOUT A RESOURCE, BEYOND ITS METRICS.
 *
 * A cloud connection's inventory lists every resource of an account the way
 * the cloud's own index lists it - AWS Cloud Control, Azure Resource Graph,
 * Google Cloud Asset Inventory - and keeps four things on each Cloud
 * Resource besides what its metrics say:
 *
 *   - its tags (AWS tags, Azure tags, Google Cloud labels), which the label
 *     and owner rules can match;
 *   - a few properties: the ones a person reads first (an instance's type,
 *     a database's engine and version, a function's runtime) and never
 *     anything that can hold a secret - a Lambda function's environment, an
 *     instance's user data, a connection string;
 *   - its relationships: what it runs in, what it is part of, what traffic it
 *     sends on to - the edges of the account's topology;
 *   - its endpoints: the host names and addresses it answers on, which is
 *     how a website monitor is linked to the load balancer behind it.
 *
 * Everything is bounded as it is written (normalizeCloudTags,
 * pickCloudProperties, boundCloudRelationships, normalizeCloudEndpoints): a
 * resource with a thousand tags or a megabyte of configuration costs a row
 * no more than one with a few.
 */

export const CLOUD_TAGS_MAX: number = 50;
export const CLOUD_TAG_KEY_MAX_LENGTH: number = 128;
export const CLOUD_TAG_VALUE_MAX_LENGTH: number = 256;
export const CLOUD_PROPERTIES_MAX_BYTES: number = 8 * 1024;
export const CLOUD_PROPERTY_VALUE_MAX_LENGTH: number = 512;
export const CLOUD_RELATIONSHIPS_MAX: number = 100;
export const CLOUD_ENDPOINTS_MAX: number = 50;

export enum CloudRelationshipKind {
  // A resource runs in a network: an instance in a subnet or a VPC.
  RunsIn = "runs-in",
  /*
   * A resource is part of a larger one: an instance of a scaling group, a
   * database instance of its cluster, a service of its ECS cluster.
   */
  PartOf = "part-of",
  /*
   * Traffic goes on to it: a load balancer to its targets, a CDN to its
   * origin, a topic to its subscribers.
   */
  RoutesTo = "routes-to",
  // A firewall or security group guards it.
  ProtectedBy = "protected-by",
  // It is attached to another resource: a disk to a VM, an interface to it.
  AttachedTo = "attached-to",
  // Messages it cannot process go there: a queue's dead-letter queue.
  DeadLettersTo = "dead-letters-to",
}

export const CLOUD_RELATIONSHIP_LABELS: Readonly<
  Record<CloudRelationshipKind, string>
> = {
  [CloudRelationshipKind.RunsIn]: "Runs in",
  [CloudRelationshipKind.PartOf]: "Part of",
  [CloudRelationshipKind.RoutesTo]: "Sends traffic to",
  [CloudRelationshipKind.ProtectedBy]: "Protected by",
  [CloudRelationshipKind.AttachedTo]: "Attached to",
  [CloudRelationshipKind.DeadLettersTo]: "Dead letters go to",
};

export interface CloudResourceRelationship {
  kind: CloudRelationshipKind;
  /*
   * The other resource as its cloud names it: an ARN, an ARM id or a full
   * resource name - or the plain id AWS uses for network pieces
   * ("subnet-0abc", "sg-0abc"), or a host name (a CDN's origin).
   */
  target: string;
  // Its type, when the cloud says: "AWS::EC2::Subnet".
  targetType?: string | undefined;
}

export function isCloudRelationshipKind(
  value: unknown,
): value is CloudRelationshipKind {
  return (
    typeof value === "string" &&
    (Object.values(CloudRelationshipKind) as Array<string>).includes(value)
  );
}

// A value as text: strings trimmed, numbers and booleans as written.
function asText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function clamp(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

/*
 * Tags as one flat map, whichever shape the cloud wrote them in - AWS's
 * [{ Key, Value }] list, Azure's and Google Cloud's { key: value } map -
 * with at most CLOUD_TAGS_MAX entries, keys and values clamped, empty keys
 * dropped and the first spelling of a repeated key kept. AWS's own
 * `aws:` tags (aws:cloudformation:stack-name) are kept: they say which
 * stack declares the resource.
 */
export function normalizeCloudTags(raw: unknown): Record<string, string> {
  const tags: Record<string, string> = {};
  let count: number = 0;

  const add: (key: unknown, value: unknown) => void = (
    key: unknown,
    value: unknown,
  ): void => {
    if (count >= CLOUD_TAGS_MAX) {
      return;
    }

    const name: string = clamp(asText(key), CLOUD_TAG_KEY_MAX_LENGTH);

    if (!name || Object.prototype.hasOwnProperty.call(tags, name)) {
      return;
    }

    tags[name] = clamp(asText(value), CLOUD_TAG_VALUE_MAX_LENGTH);
    count++;
  };

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const record: Record<string, unknown> = entry as Record<
          string,
          unknown
        >;
        add(record["Key"] ?? record["key"], record["Value"] ?? record["value"]);
      }
    }

    return tags;
  }

  if (raw && typeof raw === "object") {
    for (const key of Object.keys(raw as Record<string, unknown>)) {
      add(key, (raw as Record<string, unknown>)[key]);
    }
  }

  return tags;
}

// The value at a dotted path ("Endpoint.Address"), or undefined.
export function readCloudPath(source: unknown, path: string): unknown {
  let current: unknown = source;

  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/*
 * A property value fit to keep: text clamped, numbers and booleans as they
 * are, a list of short values kept (clamped to twenty), anything else - an
 * object, a long list of objects - left out.
 */
function keepableValue(value: unknown): JSONValue | undefined {
  if (typeof value === "string") {
    const text: string = value.trim();
    return text ? clamp(text, CLOUD_PROPERTY_VALUE_MAX_LENGTH) : undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    const items: Array<JSONValue> = [];

    for (const item of value.slice(0, 20)) {
      const kept: JSONValue | undefined =
        typeof item === "object" ? undefined : keepableValue(item);

      if (kept !== undefined) {
        items.push(kept);
      }
    }

    return items.length > 0 ? items : undefined;
  }

  return undefined;
}

/*
 * The properties a resource keeps: only the dotted paths its type names,
 * each written under its path ("Endpoint.Address": "db.example.com"), and
 * only while the whole stays under CLOUD_PROPERTIES_MAX_BYTES. A type names
 * no path that can hold a secret, so nothing else of what the cloud
 * returned is stored.
 */
export function pickCloudProperties(
  source: unknown,
  paths: ReadonlyArray<string>,
): JSONObject {
  const kept: JSONObject = {};
  let size: number = 2;

  for (const path of paths) {
    const value: JSONValue | undefined = keepableValue(
      readCloudPath(source, path),
    );

    if (value === undefined) {
      continue;
    }

    const entrySize: number = path.length + JSON.stringify(value).length + 4;

    if (size + entrySize > CLOUD_PROPERTIES_MAX_BYTES) {
      break;
    }

    kept[path] = value;
    size += entrySize;
  }

  return kept;
}

/*
 * Relationships as they are kept: known kinds only, a target each, no two
 * alike, at most CLOUD_RELATIONSHIPS_MAX.
 */
export function boundCloudRelationships(
  relationships: ReadonlyArray<CloudResourceRelationship>,
): Array<CloudResourceRelationship> {
  const kept: Array<CloudResourceRelationship> = [];
  const seen: Set<string> = new Set<string>();

  for (const relationship of relationships) {
    if (kept.length >= CLOUD_RELATIONSHIPS_MAX) {
      break;
    }

    const target: string = clamp(
      asText(relationship.target),
      CLOUD_PROPERTY_VALUE_MAX_LENGTH,
    );

    if (!target || !isCloudRelationshipKind(relationship.kind)) {
      continue;
    }

    const key: string = `${relationship.kind}|${target.toLowerCase()}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    const entry: CloudResourceRelationship = {
      kind: relationship.kind,
      target,
    };

    const targetType: string = asText(relationship.targetType);

    if (targetType) {
      entry.targetType = clamp(targetType, 128);
    }

    kept.push(entry);
  }

  return kept;
}

// The relationships kept on a row, read back: anything malformed is skipped.
export function readCloudRelationships(
  value: unknown,
): Array<CloudResourceRelationship> {
  if (!Array.isArray(value)) {
    return [];
  }

  const relationships: Array<CloudResourceRelationship> = [];

  for (const entry of value) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const record: Record<string, unknown> = entry as Record<string, unknown>;
      const target: string = asText(record["target"]);

      if (target && isCloudRelationshipKind(record["kind"])) {
        relationships.push({
          kind: record["kind"],
          target,
          targetType: asText(record["targetType"]) || undefined,
        });
      }
    }
  }

  return relationships;
}

/*
 * A host name as it is compared: lower case, without a scheme, a path, a
 * port or the root's trailing dot ("https://Shop.example.com:443/x" ->
 * "shop.example.com"). An IPv6 address keeps its brackets' contents. "" for
 * anything that is not a host.
 */
export function normalizeCloudHost(value: unknown): string {
  let text: string = asText(value).toLowerCase();

  if (!text) {
    return "";
  }

  const scheme: number = text.indexOf("://");

  if (scheme >= 0) {
    text = text.slice(scheme + 3);
  }

  for (const separator of ["/", "?", "#"]) {
    const index: number = text.indexOf(separator);

    if (index >= 0) {
      text = text.slice(0, index);
    }
  }

  const at: number = text.lastIndexOf("@");

  if (at >= 0) {
    text = text.slice(at + 1);
  }

  if (text.startsWith("[")) {
    const close: number = text.indexOf("]");
    return close > 1 ? text.slice(1, close) : "";
  }

  const colon: number = text.indexOf(":");

  // One colon is a port; more is an IPv6 address written bare.
  if (colon >= 0 && text.indexOf(":", colon + 1) < 0) {
    text = text.slice(0, colon);
  }

  while (text.endsWith(".")) {
    text = text.slice(0, -1);
  }

  if (text.length > 253 || hasWhitespace(text)) {
    return "";
  }

  return text;
}

function hasWhitespace(value: string): boolean {
  for (const character of value) {
    if (character.trim() === "") {
      return true;
    }
  }

  return false;
}

// Endpoints as they are kept: normalized hosts, no repeats, at most the limit.
export function normalizeCloudEndpoints(
  values: ReadonlyArray<unknown>,
): Array<string> {
  const endpoints: Array<string> = [];

  for (const value of values) {
    if (endpoints.length >= CLOUD_ENDPOINTS_MAX) {
      break;
    }

    const host: string = normalizeCloudHost(value);

    if (host && !endpoints.includes(host)) {
      endpoints.push(host);
    }
  }

  return endpoints;
}

// The endpoints kept on a row, read back.
export function readCloudEndpoints(value: unknown): Array<string> {
  return Array.isArray(value) ? normalizeCloudEndpoints(value) : [];
}

// The tags kept on a row, read back.
export function readCloudTags(value: unknown): Record<string, string> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? normalizeCloudTags(value)
    : {};
}

// A properties object as "path=value" pairs, one level of nesting deep.
export function flattenCloudProperties(
  properties: unknown,
): Record<string, string> {
  const flat: Record<string, string> = {};

  if (
    !properties ||
    typeof properties !== "object" ||
    Array.isArray(properties)
  ) {
    return flat;
  }

  const visit: (value: unknown, path: string) => void = (
    value: unknown,
    path: string,
  ): void => {
    if (value === null || value === undefined || value === "") {
      return;
    }

    if (typeof value === "object" && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(
        value as Record<string, unknown>,
      )) {
        visit(child, path ? `${path}.${key}` : key);
      }
      return;
    }

    flat[path] = Array.isArray(value)
      ? value
          .map((item: unknown): string => {
            return typeof item === "object"
              ? JSON.stringify(item)
              : String(item);
          })
          .join(", ")
      : String(value);
  };

  visit(properties, "");

  return flat;
}

/*
 * A resource's tags as label and owner rules match them: each written key=value ("team=payments"), so one pattern can say a key, a value or
 * both (^team=payments$, ^env=, =production$).
 */
export function getCloudTagRuleMatchValues(tags: unknown): Array<string> {
  const normalized: Record<string, string> = readCloudTags(tags);

  return Object.keys(normalized).map((key: string): string => {
    return `${key}=${normalized[key]}`;
  });
}
