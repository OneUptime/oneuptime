import { generateKeyPairSync } from "crypto";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  bodyOf,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";

/*
 * GOOGLE CLOUD ARMOR IN A TEST (#10349): Compute Engine's security policy
 * methods, Network Security's address groups and Resource Manager's
 * testIamPermissions as Google answers them - recorded from their REST
 * references and gcloud compute security-policies describe - keeping
 * each policy's rules and each project's address groups.
 *
 *   - A policy is read whole; its rules change only through addRule,
 *     patchRule?priority= and removeRule?priority=, each answered with a
 *     compute#operation that operations/{op}/wait answers DONE. The policy
 *     itself is never written whole: a PATCH of it is not routed.
 *   - addRule refuses a priority a rule has (400, as Compute does), and a
 *     rule of more than 10 ranges (400). patchRule and removeRule of a
 *     priority no rule has is 400 "does not contain a rule with priority".
 *   - Address groups keep their type, capacity and items; addItems past
 *     the capacity is 400; a group a policy's rule names is not deleted.
 *   - changeBehind() changes a policy or a group as someone else would,
 *     in the console or with gcloud.
 *   - failNext() answers the next call of a method with an error of Google's.
 */

export const FAKE_GCP_PROJECT: string = "acme-prod";
export const FAKE_ARMOR_POLICY_ID: string =
  "projects/acme-prod/global/securityPolicies/prod-lb";
export const FAKE_REGIONAL_ARMOR_POLICY_ID: string =
  "projects/acme-prod/regions/europe-west1/securityPolicies/eu-lb";
export const FAKE_EDGE_ARMOR_POLICY_ID: string =
  "projects/acme-prod/global/securityPolicies/prod-cdn";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

export const FAKE_GCP_SERVICE_ACCOUNT_EMAIL: string =
  "oneuptime-read-only@acme-prod.iam.gserviceaccount.com";

export const FAKE_GCP_KEY: string = JSON.stringify({
  type: "service_account",
  project_id: FAKE_GCP_PROJECT,
  client_email: FAKE_GCP_SERVICE_ACCOUNT_EMAIL,
  private_key: privateKey,
  token_uri: "https://oauth2.googleapis.com/token",
});

// The default rule every policy ends on: priority 2147483647, allow.
export function defaultRule(action: string = "allow"): JSONObject {
  return {
    kind: "compute#securityPolicyRule",
    description: "Default rule, higher priority overrides it",
    priority: 2147483647,
    match: { versionedExpr: "SRC_IPS_V1", config: { srcIpRanges: ["*"] } },
    action,
    preview: false,
  };
}

// A global backend security policy as Compute answers it: a geo rule, an allow rule, the default.
export function recordedBackendPolicy(
  rules?: Array<JSONObject> | undefined,
): JSONObject {
  return {
    kind: "compute#securityPolicy",
    id: "4185461328963209711",
    creationTimestamp: "2026-03-02T01:12:44.010-08:00",
    name: "prod-lb",
    description: "",
    rules: rules || [
      {
        kind: "compute#securityPolicyRule",
        description: "Block North Korea",
        priority: 1000,
        match: { expr: { expression: "origin.region_code == 'KP'" } },
        action: "deny(403)",
        preview: false,
      },
      {
        kind: "compute#securityPolicyRule",
        description: "Allow the office",
        priority: 2000,
        match: {
          versionedExpr: "SRC_IPS_V1",
          config: { srcIpRanges: ["203.0.113.0/24"] },
        },
        action: "allow",
        preview: false,
      },
      defaultRule(),
    ],
    adaptiveProtectionConfig: { layer7DdosDefenseConfig: { enable: false } },
    advancedOptionsConfig: {
      jsonParsing: "DISABLED",
      logLevel: "NORMAL",
      userIpRequestHeaders: ["X-Client-IP"],
    },
    fingerprint: "VbqP8Ex1Rxw=",
    selfLink:
      "https://www.googleapis.com/compute/v1/projects/acme-prod/global/securityPolicies/prod-lb",
    type: "CLOUD_ARMOR",
    labelFingerprint: "42WmSpB8rSM=",
  };
}

// An edge security policy (Cloud CDN): basic matches only, the address that connected alone.
export function recordedEdgePolicy(): JSONObject {
  return {
    ...recordedBackendPolicy([defaultRule()]),
    id: "7721843960412355902",
    name: "prod-cdn",
    selfLink:
      "https://www.googleapis.com/compute/v1/projects/acme-prod/global/securityPolicies/prod-cdn",
    type: "CLOUD_ARMOR_EDGE",
    advancedOptionsConfig: undefined,
  };
}

// A regional backend security policy.
export function recordedRegionalPolicy(): JSONObject {
  return {
    ...recordedBackendPolicy([defaultRule()]),
    id: "1532187602394112408",
    name: "eu-lb",
    region:
      "https://www.googleapis.com/compute/v1/projects/acme-prod/regions/europe-west1",
    selfLink:
      "https://www.googleapis.com/compute/v1/projects/acme-prod/regions/europe-west1/securityPolicies/eu-lb",
  };
}

export interface FakeArmorGroup {
  name: string;
  type: "IPV4" | "IPV6";
  capacity: number;
  items: Array<string>;
  description: string;
  purpose: Array<string>;
}

export interface FakeCloudArmor extends FakeProviderApi {
  policy: (id: string) => JSONObject;
  rules: (id: string) => Array<JSONObject>;
  ruleAt: (id: string, priority: number) => JSONObject | undefined;
  group: (name: string) => FakeArmorGroup | undefined;
  // The methods called, in order: "addRule prod-lb", "addItems oneuptime-...".
  calls: () => Array<string>;
  changeBehind: (id: string, change: (policy: JSONObject) => void) => void;
  deleteGroupBehind: (name: string) => void;
  failNext: (method: string, response: FakeResponse) => void;
  setTier: (tier: string | null) => void;
  setGranted: (permissions: Array<string> | null) => void;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function googleError(status: number, message: string, reason?: string): FakeResponse {
  return json(
    {
      error: {
        code: status,
        message,
        errors: [{ message, domain: "global", reason: reason || "invalid" }],
      },
    },
    status,
  );
}

// The ranges a rule matches, basic or as inIpRange() terms.
function rangesOf(rule: JSONObject): number {
  const match: JSONObject = readObject(rule["match"]);
  const ranges: unknown = readObject(match["config"])["srcIpRanges"];

  if (Array.isArray(ranges)) {
    return ranges.length;
  }

  const expression: string = String(
    readObject(match["expr"])["expression"] || "",
  );

  return expression.split("inIpRange(").length - 1;
}

export function createFakeCloudArmor(
  options: {
    policies?: Array<{ id: string; policy: JSONObject }> | undefined;
    tier?: string | null | undefined;
  } = {},
): FakeCloudArmor {
  const policies: Map<string, JSONObject> = new Map();
  const groups: Map<string, FakeArmorGroup> = new Map();
  const calls: Array<string> = [];
  const failures: Map<string, Array<FakeResponse>> = new Map();
  let tier: string | null =
    options.tier === undefined ? "CA_STANDARD" : options.tier;
  let granted: Array<string> | null = null;
  let operations: number = 0;

  for (const item of options.policies || [
    { id: FAKE_ARMOR_POLICY_ID, policy: recordedBackendPolicy() },
  ]) {
    policies.set(item.id, clone(item.policy));
  }

  const failed: (method: string) => FakeResponse | null = (
    method: string,
  ): FakeResponse | null => {
    const queued: Array<FakeResponse> | undefined = failures.get(method);

    return queued && queued.length > 0 ? queued.shift()! : null;
  };

  const operation: (policyId: string, type: string) => JSONObject = (
    policyId: string,
    type: string,
  ): JSONObject => {
    operations++;

    return {
      kind: "compute#operation",
      id: String(8000000000 + operations),
      name: `operation-1764000000000-${operations}`,
      operationType: type,
      targetLink: `https://www.googleapis.com/compute/v1/${policyId}`,
      status: "RUNNING",
      progress: 0,
    };
  };

  const rulesOf: (policy: JSONObject) => Array<JSONObject> = (
    policy: JSONObject,
  ): Array<JSONObject> => {
    if (!Array.isArray(policy["rules"])) {
      policy["rules"] = [];
    }

    return policy["rules"] as Array<JSONObject>;
  };

  const bumpFingerprint: (policy: JSONObject) => void = (
    policy: JSONObject,
  ): void => {
    operations++;
    policy["fingerprint"] = `fp-${operations}`;
  };

  // A security policy's path, without /compute/v1/: "projects/p/global/securityPolicies/n".
  const policyOfPath: (
    path: string,
  ) => { id: string; method: string } | null = (
    path: string,
  ): { id: string; method: string } | null => {
    const rest: string = decodeURIComponent(path.slice("/compute/v1/".length));

    for (const id of policies.keys()) {
      if (rest === id) {
        return { id, method: "get" };
      }

      if (rest.startsWith(`${id}/`)) {
        return { id, method: rest.slice(id.length + 1) };
      }
    }

    return null;
  };

  const compute: (
    request: DataSourceHttpRequest,
    url: URL,
  ) => FakeResponse = (request: DataSourceHttpRequest, url: URL): FakeResponse => {
    const path: string = url.pathname;

    // The project, for its Cloud Armor tier.
    if (path === `/compute/v1/projects/${FAKE_GCP_PROJECT}`) {
      calls.push("projects.get");

      return (
        failed("projects.get") ||
        json(tier ? { name: FAKE_GCP_PROJECT, cloudArmorTier: tier } : { name: FAKE_GCP_PROJECT })
      );
    }

    // Waiting for an operation: done.
    if (path.includes("/operations/") && path.endsWith("/wait")) {
      calls.push("operations.wait");

      return (
        failed("operations.wait") || json({ kind: "compute#operation", status: "DONE" })
      );
    }

    const target: { id: string; method: string } | null = policyOfPath(path);

    if (!target) {
      return googleError(404, `The resource '${path}' was not found`, "notFound");
    }

    const policy: JSONObject = policies.get(target.id)!;
    const name: string = String(policy["name"]);
    const priority: number = Number(url.searchParams.get("priority"));
    const rules: Array<JSONObject> = rulesOf(policy);
    const at: number = rules.findIndex((rule: JSONObject): boolean => {
      return rule["priority"] === priority;
    });

    calls.push(`${target.method} ${name}`);

    const failure: FakeResponse | null = failed(target.method);

    if (failure) {
      return failure;
    }

    if (target.method === "get" && request.method === "GET") {
      return json(clone(policy));
    }

    if (target.method === "getRule" && request.method === "GET") {
      return at >= 0
        ? json(clone(rules[at]!))
        : googleError(
            400,
            `Invalid value for field 'priority': '${priority}'. The security policy does not contain a rule with the specified priority.`,
          );
    }

    if (target.method === "addRule" && request.method === "POST") {
      const rule: JSONObject = bodyOf(request);

      if (
        rules.some((candidate: JSONObject): boolean => {
          return candidate["priority"] === rule["priority"];
        })
      ) {
        return googleError(
          400,
          `Invalid value for field 'resource.priority': '${String(rule["priority"])}'. A rule with this priority already exists.`,
        );
      }

      if (rangesOf(rule) > 10) {
        return googleError(
          400,
          "Invalid value for field 'resource.match.config.srcIpRanges': too many IP ranges. A rule can have at most 10.",
        );
      }

      rules.push({ kind: "compute#securityPolicyRule", ...clone(rule) });
      rules.sort((a: JSONObject, b: JSONObject): number => {
        return Number(a["priority"]) - Number(b["priority"]);
      });
      bumpFingerprint(policy);

      return json(operation(target.id, "addRule"));
    }

    if (target.method === "patchRule" && request.method === "POST") {
      if (at < 0) {
        return googleError(
          400,
          `Invalid value for field 'priority': '${priority}'. The security policy does not contain a rule with the specified priority.`,
        );
      }

      const rule: JSONObject = bodyOf(request);

      if (rangesOf(rule) > 10) {
        return googleError(
          400,
          "Invalid value for field 'resource.match.config.srcIpRanges': too many IP ranges. A rule can have at most 10.",
        );
      }

      rules[at] = { kind: "compute#securityPolicyRule", ...clone(rule) };
      bumpFingerprint(policy);

      return json(operation(target.id, "patchRule"));
    }

    if (target.method === "removeRule" && request.method === "POST") {
      if (at < 0) {
        return googleError(
          400,
          `Invalid value for field 'priority': '${priority}'. The security policy does not contain a rule with the specified priority.`,
        );
      }

      rules.splice(at, 1);
      bumpFingerprint(policy);

      return json(operation(target.id, "removeRule"));
    }

    return googleError(405, `${request.method} ${path} is not a method this fake answers`);
  };

  const GROUPS_PATH: string = `/v1/projects/${FAKE_GCP_PROJECT}/locations/global/addressGroups`;

  const isNamedByAPolicy: (name: string) => boolean = (name: string): boolean => {
    return Array.from(policies.values()).some((policy: JSONObject): boolean => {
      return rulesOf(policy).some((rule: JSONObject): boolean => {
        return String(
          readObject(readObject(rule["match"])["expr"])["expression"] || "",
        ).includes(`'${name}'`);
      });
    });
  };

  const networkSecurity: (
    request: DataSourceHttpRequest,
    url: URL,
  ) => FakeResponse = (request: DataSourceHttpRequest, url: URL): FakeResponse => {
    const path: string = decodeURIComponent(url.pathname);

    if (path.startsWith(`/v1/projects/${FAKE_GCP_PROJECT}/locations/global/operations/`)) {
      calls.push("operations.get");
      return json({ name: path.slice(4), done: true });
    }

    if (path === GROUPS_PATH && request.method === "POST") {
      const name: string = url.searchParams.get("addressGroupId") || "";
      calls.push(`createAddressGroup ${name}`);

      const failure: FakeResponse | null = failed("createAddressGroup");

      if (failure) {
        return failure;
      }

      if (groups.has(name)) {
        return googleError(409, `Address group ${name} already exists.`, "alreadyExists");
      }

      const body: JSONObject = bodyOf(request);

      groups.set(name, {
        name,
        type: body["type"] === "IPV6" ? "IPV6" : "IPV4",
        capacity: Number(body["capacity"]),
        items: [],
        description: String(body["description"] || ""),
        purpose: (body["purpose"] as Array<string>) || [],
      });

      return json({
        name: `projects/${FAKE_GCP_PROJECT}/locations/global/operations/operation-create-${name}`,
        done: false,
      });
    }

    if (!path.startsWith(`${GROUPS_PATH}/`)) {
      return googleError(404, `${path} not found`, "notFound");
    }

    const rest: string = path.slice(GROUPS_PATH.length + 1);
    const [name, action] = rest.split(":") as [string, string | undefined];
    const group: FakeArmorGroup | undefined = groups.get(name);

    if (request.method === "GET") {
      calls.push(`getAddressGroup ${name}`);

      return group
        ? json({
            name: `projects/${FAKE_GCP_PROJECT}/locations/global/addressGroups/${name}`,
            type: group.type,
            capacity: group.capacity,
            items: [...group.items],
            description: group.description,
            purpose: [...group.purpose],
          })
        : googleError(404, `Address group ${name} not found.`, "notFound");
    }

    if (request.method === "DELETE") {
      calls.push(`deleteAddressGroup ${name}`);

      if (!group) {
        return googleError(404, `Address group ${name} not found.`, "notFound");
      }

      if (isNamedByAPolicy(name)) {
        return googleError(
          400,
          `Address group ${name} is in use by a security policy rule.`,
          "failedPrecondition",
        );
      }

      groups.delete(name);

      return json({
        name: `projects/${FAKE_GCP_PROJECT}/locations/global/operations/operation-delete-${name}`,
        done: false,
      });
    }

    if (request.method === "POST" && (action === "addItems" || action === "removeItems")) {
      calls.push(`${action} ${name}`);

      const failure: FakeResponse | null = failed(action);

      if (failure) {
        return failure;
      }

      if (!group) {
        return googleError(404, `Address group ${name} not found.`, "notFound");
      }

      const items: Array<string> = (bodyOf(request)["items"] as Array<string>) || [];

      if (action === "addItems") {
        const next: Array<string> = Array.from(new Set([...group.items, ...items]));

        if (next.length > group.capacity) {
          return googleError(
            400,
            `Address group ${name} would exceed its capacity of ${group.capacity}.`,
          );
        }

        group.items = next;
      } else {
        group.items = group.items.filter((item: string): boolean => {
          return !items.includes(item);
        });
      }

      return json({
        name: `projects/${FAKE_GCP_PROJECT}/locations/global/operations/operation-${action}-${calls.length}`,
        done: false,
      });
    }

    return googleError(405, `${request.method} ${path} is not a method this fake answers`);
  };

  const api: FakeProviderApi = createFakeProviderApi([
    {
      host: "oauth2.googleapis.com",
      path: "/token",
      method: "POST",
      respond: (): FakeResponse => {
        return json({
          access_token: "ya29.fake-access-token",
          expires_in: 3599,
          token_type: "Bearer",
        });
      },
    },
    {
      host: "compute.googleapis.com",
      path: /^\/compute\/v1\//,
      respond: compute,
    },
    {
      host: "networksecurity.googleapis.com",
      path: /^\/v1\//,
      respond: networkSecurity,
    },
    {
      host: "cloudresourcemanager.googleapis.com",
      path: /:testIamPermissions$/,
      method: "POST",
      respond: (request: DataSourceHttpRequest): FakeResponse => {
        calls.push("testIamPermissions");

        const asked: Array<JSONValue> =
          (bodyOf(request)["permissions"] as Array<JSONValue>) || [];

        return json({
          permissions: asked.filter((permission: JSONValue): boolean => {
            return granted === null || granted.includes(String(permission));
          }),
        });
      },
    },
  ]);

  return {
    ...api,
    policy: (id: string): JSONObject => {
      return clone(policies.get(id)!);
    },
    rules: (id: string): Array<JSONObject> => {
      return clone(rulesOf(policies.get(id)!));
    },
    ruleAt: (id: string, priority: number): JSONObject | undefined => {
      const found: JSONObject | undefined = rulesOf(policies.get(id)!).find(
        (rule: JSONObject): boolean => {
          return rule["priority"] === priority;
        },
      );

      return found ? clone(found) : undefined;
    },
    group: (name: string): FakeArmorGroup | undefined => {
      const found: FakeArmorGroup | undefined = groups.get(name);
      return found ? clone(found) : undefined;
    },
    calls: (): Array<string> => {
      return [...calls];
    },
    changeBehind: (id: string, change: (policy: JSONObject) => void): void => {
      const policy: JSONObject = policies.get(id)!;
      change(policy);
      bumpFingerprint(policy);
    },
    deleteGroupBehind: (name: string): void => {
      groups.delete(name);
    },
    failNext: (method: string, response: FakeResponse): void => {
      failures.set(method, [...(failures.get(method) || []), response]);
    },
    setTier: (next: string | null): void => {
      tier = next;
    },
    setGranted: (next: Array<string> | null): void => {
      granted = next;
    },
  };
}
