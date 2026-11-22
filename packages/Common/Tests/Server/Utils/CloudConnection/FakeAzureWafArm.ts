import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import { CloudConnectorTransport } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { JSONObject, JSONValue } from "../../../../Types/JSON";

/*
 * AZURE WAF POLICIES IN A TEST (#10348): Azure Resource Manager as it
 * answers for Application Gateway and Front Door WAF policies - recorded
 * from the ARM REST reference and az network ... waf-policy show - keeping
 * each policy's state and ETag.
 *
 *   - GET answers the policy whole: its etag, its settings, managed rules
 *     and custom rules, and what Azure keeps itself (provisioningState,
 *     resourceState, what the policy is attached to, a managed rule set's
 *     computedDisabledRules, a custom rule's etag).
 *   - PUT writes it whole. If-Match must name the current etag, or Azure
 *     answers 412 PreconditionFailed; a body that carries what Azure keeps
 *     itself is refused 400, as ARM refuses to set a read-only property.
 *     An Application Gateway policy answers 200, applied; a Front Door
 *     policy answers 202 and reads Updating for frontDoorApplyingReads
 *     reads, then Succeeded - the edges have it.
 *   - writeBehind() writes the policy as someone else would - the portal,
 *     Terraform - between OneUptime's read and its write: the write meets
 *     a new etag.
 *   - failNextPut() answers the next PUT with an error of Azure's.
 *   - permissions answers Microsoft.Authorization/permissions at the policy.
 */

export const FAKE_AZURE_TENANT: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
export const FAKE_AZURE_CLIENT: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
export const FAKE_AZURE_SECRET: string = "client-secret~value";
export const FAKE_AZURE_SUBSCRIPTION: string =
  "d0cfe6b2-9ac0-4464-9919-dccaee2e48c0";

export const FAKE_GATEWAY_POLICY_ID: string = `/subscriptions/${FAKE_AZURE_SUBSCRIPTION}/resourceGroups/rg-prod/providers/Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies/prod-waf`;
export const FAKE_FRONT_DOOR_POLICY_ID: string = `/subscriptions/${FAKE_AZURE_SUBSCRIPTION}/resourceGroups/rg-edge/providers/Microsoft.Network/FrontDoorWebApplicationFirewallPolicies/edgewaf`;

// What Azure keeps of a policy itself, never written by a caller.
const GATEWAY_READ_ONLY: Array<string> = [
  "provisioningState",
  "resourceState",
  "applicationGateways",
  "httpListeners",
  "pathBasedRules",
];
const FRONT_DOOR_READ_ONLY: Array<string> = [
  "provisioningState",
  "resourceState",
  "frontendEndpointLinks",
  "routingRuleLinks",
  "securityPolicyLinks",
];

// An Application Gateway WAF policy as GET answers it: a bot rule, an Allow rule, OWASP 3.2.
export function recordedGatewayPolicy(
  customRules?: Array<JSONObject> | undefined,
): JSONObject {
  return {
    name: "prod-waf",
    id: FAKE_GATEWAY_POLICY_ID,
    etag: 'W/"6f3c0b8e-1b2a-4c5d-9e8f-0a1b2c3d4e5f"',
    type: "Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies",
    location: "westeurope",
    tags: { team: "edge" },
    properties: {
      provisioningState: "Succeeded",
      resourceState: "Enabled",
      customRules: customRules || [
        {
          name: "BlockBadBots",
          priority: 10,
          ruleType: "MatchRule",
          action: "Block",
          state: "Enabled",
          matchConditions: [
            {
              matchVariables: [
                { variableName: "RequestHeaders", selector: "User-Agent" },
              ],
              operator: "Contains",
              negationConditon: false,
              matchValues: ["evilbot"],
              transforms: ["Lowercase"],
            },
          ],
          etag: 'W/"a1"',
        },
        {
          name: "AllowOffice",
          priority: 50,
          ruleType: "MatchRule",
          action: "Allow",
          state: "Enabled",
          matchConditions: [
            {
              matchVariables: [{ variableName: "RemoteAddr" }],
              operator: "IPMatch",
              negationConditon: false,
              matchValues: ["203.0.113.0/24"],
              transforms: [],
            },
          ],
          etag: 'W/"a2"',
        },
      ],
      policySettings: {
        requestBodyCheck: true,
        maxRequestBodySizeInKb: 128,
        fileUploadLimitInMb: 100,
        state: "Enabled",
        mode: "Prevention",
        requestBodyInspectLimitInKB: 128,
        fileUploadEnforcement: true,
        requestBodyEnforcement: true,
        jsChallengeCookieExpirationInMins: 30,
      },
      managedRules: {
        managedRuleSets: [
          {
            ruleSetType: "OWASP",
            ruleSetVersion: "3.2",
            ruleGroupOverrides: [],
            computedDisabledRules: [
              {
                ruleGroupName: "REQUEST-920-PROTOCOL-ENFORCEMENT",
                rules: ["920300"],
              },
            ],
          },
        ],
        exclusions: [],
      },
      applicationGateways: [
        {
          id: `/subscriptions/${FAKE_AZURE_SUBSCRIPTION}/resourceGroups/rg-prod/providers/Microsoft.Network/applicationGateways/prod-agw`,
        },
      ],
      httpListeners: [],
      pathBasedRules: [],
    },
  };
}

// A Front Door WAF policy as GET answers it: a geo rule, an Allow rule, the Default Rule Set.
export function recordedFrontDoorPolicy(
  customRules?: Array<JSONObject> | undefined,
): JSONObject {
  return {
    id: `/subscriptions/${FAKE_AZURE_SUBSCRIPTION}/resourcegroups/rg-edge/providers/Microsoft.Network/frontdoorwebapplicationfirewallpolicies/edgewaf`,
    type: "Microsoft.Network/frontdoorwebapplicationfirewallpolicies",
    name: "edgewaf",
    location: "Global",
    tags: {},
    sku: { name: "Premium_AzureFrontDoor" },
    etag: '"0b003ef6-0000-0300-0000-6655a1b20000"',
    properties: {
      policySettings: {
        enabledState: "Enabled",
        mode: "Prevention",
        redirectUrl: null,
        customBlockResponseStatusCode: 403,
        customBlockResponseBody: null,
        requestBodyCheck: "Enabled",
        javascriptChallengeExpirationInMinutes: 30,
      },
      customRules: {
        rules: customRules || [
          {
            name: "GeoBlock",
            enabledState: "Enabled",
            priority: 5,
            ruleType: "MatchRule",
            rateLimitDurationInMinutes: 1,
            rateLimitThreshold: 100,
            matchConditions: [
              {
                matchVariable: "SocketAddr",
                selector: null,
                operator: "GeoMatch",
                negateCondition: false,
                matchValue: ["KP"],
                transforms: [],
              },
            ],
            action: "Block",
          },
          {
            name: "AllowPartners",
            enabledState: "Enabled",
            priority: 20,
            ruleType: "MatchRule",
            rateLimitDurationInMinutes: 1,
            rateLimitThreshold: 100,
            matchConditions: [
              {
                matchVariable: "RemoteAddr",
                selector: null,
                operator: "IPMatch",
                negateCondition: false,
                matchValue: ["198.51.100.0/24"],
                transforms: [],
              },
            ],
            action: "Allow",
          },
        ],
      },
      managedRules: {
        managedRuleSets: [
          {
            ruleSetType: "Microsoft_DefaultRuleSet",
            ruleSetVersion: "2.1",
            ruleSetAction: "Block",
            exclusions: [],
            ruleGroupOverrides: [],
          },
        ],
      },
      frontendEndpointLinks: [],
      routingRuleLinks: [],
      securityPolicyLinks: [
        {
          id: `/subscriptions/${FAKE_AZURE_SUBSCRIPTION}/resourcegroups/rg-edge/providers/Microsoft.Cdn/profiles/edge-afd/securitypolicies/waf-sp`,
        },
      ],
      provisioningState: "Succeeded",
      resourceState: "Enabled",
    },
  };
}

// ARM's 412, as it answers a write whose If-Match is not the policy's etag.
const PRECONDITION_FAILED: JSONObject = {
  error: {
    code: "PreconditionFailed",
    message:
      "The condition specified using HTTP conditional header(s) is not met.",
  },
};

export interface FakeAzureWafPolicy {
  id: string;
  kind: "gateway" | "frontDoor";
  policy: JSONObject;
  etagCount: number;
  // Reads left while Front Door applies the last write.
  applyingReads: number;
}

export interface FakeAzureWafArm {
  transport: CloudConnectorTransport;
  requests: Array<DataSourceHttpRequest>;
  policy: (id: string) => JSONObject;
  // The custom rules a policy holds now.
  customRules: (id: string) => Array<JSONObject>;
  puts: (id: string) => Array<JSONObject>;
  writeBehind: (id: string, change: (policy: JSONObject) => void) => void;
  // Someone else writes the policy just before each of the next `times` PUTs.
  writeBehindNextPuts: (
    id: string,
    times: number,
    change: (policy: JSONObject) => void,
  ) => void;
  failNextPut: (status: number, body: JSONObject) => void;
  failReads: (status: number, body: JSONObject) => void;
  setPermissions: (
    permissions: Array<{ actions: Array<string>; notActions: Array<string> }>,
  ) => void;
}

export interface FakeAzureWafArmOptions {
  policies: Array<{
    id: string;
    kind: "gateway" | "frontDoor";
    policy: JSONObject;
  }>;
  // How many reads a Front Door policy reads Updating after a write.
  frontDoorApplyingReads?: number | undefined;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function answer(status: number, body: JSONValue): DataSourceHttpResponse {
  return {
    statusCode: status,
    bodyText: JSON.stringify(body),
    bodyJson: body,
    headers: {},
  };
}

function header(request: DataSourceHttpRequest, name: string): string {
  for (const [key, value] of Object.entries(request.headers || {})) {
    if (key.toLowerCase() === name.toLowerCase()) {
      return String(value);
    }
  }

  return "";
}

export function createFakeAzureWafArm(
  options: FakeAzureWafArmOptions,
): FakeAzureWafArm {
  const requests: Array<DataSourceHttpRequest> = [];
  const policies: Map<string, FakeAzureWafPolicy> = new Map();
  const putsOf: Map<string, Array<JSONObject>> = new Map();
  const behind: Map<
    string,
    { times: number; change: (policy: JSONObject) => void }
  > = new Map();
  let nextPutFailure: { status: number; body: JSONObject } | null = null;
  let readFailure: { status: number; body: JSONObject } | null = null;
  let permissions: Array<{
    actions: Array<string>;
    notActions: Array<string>;
  }> = [{ actions: ["*"], notActions: [] }];

  for (const item of options.policies) {
    policies.set(item.id.toLowerCase(), {
      id: item.id,
      kind: item.kind,
      policy: clone(item.policy),
      etagCount: 1,
      applyingReads: 0,
    });
    putsOf.set(item.id.toLowerCase(), []);
  }

  const find: (id: string) => FakeAzureWafPolicy = (
    id: string,
  ): FakeAzureWafPolicy => {
    const found: FakeAzureWafPolicy | undefined = policies.get(
      id.toLowerCase(),
    );

    if (!found) {
      throw new Error(`No fake policy ${id}`);
    }

    return found;
  };

  // A write lands: a new etag, and what Azure keeps itself kept.
  const land: (state: FakeAzureWafPolicy, written: JSONObject) => void = (
    state: FakeAzureWafPolicy,
    written: JSONObject,
  ): void => {
    const before: JSONObject = readObject(state.policy["properties"]);
    const after: JSONObject = clone(written);
    const properties: JSONObject = readObject(after["properties"]);
    const readOnly: Array<string> =
      state.kind === "gateway" ? GATEWAY_READ_ONLY : FRONT_DOOR_READ_ONLY;

    for (const key of readOnly) {
      if (before[key] !== undefined) {
        properties[key] = clone(before[key]!);
      }
    }

    after["properties"] = properties;
    state.etagCount++;
    after["etag"] = `W/"etag-${state.etagCount}"`;
    state.policy = after;
  };

  // Someone else's write: whatever they changed, read-only state included, and a new etag.
  const writeAsSomeoneElse: (
    state: FakeAzureWafPolicy,
    change: (policy: JSONObject) => void,
  ) => void = (
    state: FakeAzureWafPolicy,
    change: (policy: JSONObject) => void,
  ): void => {
    const changed: JSONObject = clone(state.policy);
    change(changed);
    state.etagCount++;
    changed["etag"] = `W/"etag-${state.etagCount}"`;
    state.policy = changed;
  };

  const transport: CloudConnectorTransport = async (
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> => {
    requests.push(request);

    const url: URL = new URL(request.url);

    if (url.host === "login.microsoftonline.com") {
      return answer(200, {
        access_token: "arm-access-token",
        expires_in: 3599,
      });
    }

    if (url.host !== "management.azure.com") {
      return answer(404, { error: { code: "NotFound", message: url.host } });
    }

    const path: string = url.pathname.toLowerCase();
    const permissionsSuffix: string =
      "/providers/microsoft.authorization/permissions";

    if (path.endsWith(permissionsSuffix)) {
      const state: FakeAzureWafPolicy | undefined = policies.get(
        path.slice(0, path.length - permissionsSuffix.length),
      );

      return state
        ? answer(200, { value: clone(permissions) as unknown as JSONValue })
        : answer(404, { error: { code: "ResourceNotFound", message: path } });
    }

    const state: FakeAzureWafPolicy | undefined = policies.get(path);

    if (!state) {
      return answer(404, {
        error: {
          code: "ResourceNotFound",
          message: `The Resource '${url.pathname}' was not found.`,
        },
      });
    }

    if (request.method === "GET") {
      if (readFailure) {
        return answer(readFailure.status, readFailure.body);
      }

      const read: JSONObject = clone(state.policy);

      if (state.kind === "frontDoor" && state.applyingReads > 0) {
        state.applyingReads--;
        readObject(read["properties"])["provisioningState"] = "Updating";
      }

      return answer(200, read);
    }

    if (request.method === "PUT") {
      const body: JSONObject =
        typeof request.body === "string"
          ? (JSON.parse(request.body) as JSONObject)
          : (readObject(request.body) as JSONObject);
      const queued:
        | { times: number; change: (policy: JSONObject) => void }
        | undefined = behind.get(path);

      if (queued && queued.times > 0) {
        queued.times--;
        writeAsSomeoneElse(state, queued.change);
      }

      putsOf.get(path)!.push(clone(body));

      if (nextPutFailure) {
        const failure: { status: number; body: JSONObject } = nextPutFailure;
        nextPutFailure = null;
        return answer(failure.status, failure.body);
      }

      if (header(request, "If-Match") !== String(state.policy["etag"] || "")) {
        return answer(412, PRECONDITION_FAILED);
      }

      const properties: JSONObject = readObject(body["properties"]);
      const readOnly: Array<string> =
        state.kind === "gateway" ? GATEWAY_READ_ONLY : FRONT_DOOR_READ_ONLY;
      const sent: Array<string> = readOnly.filter((key: string): boolean => {
        return properties[key] !== undefined;
      });

      if (sent.length > 0 || body["etag"] !== undefined) {
        return answer(400, {
          error: {
            code: "InvalidRequestContent",
            message: `Cannot set read-only properties: ${[...sent, ...(body["etag"] !== undefined ? ["etag"] : [])].join(", ")}`,
          },
        });
      }

      land(state, body);

      if (state.kind === "frontDoor") {
        state.applyingReads = options.frontDoorApplyingReads ?? 0;
        return answer(202, clone(state.policy));
      }

      return answer(200, clone(state.policy));
    }

    return answer(405, { error: { code: "MethodNotAllowed", message: "" } });
  };

  return {
    transport,
    requests,
    policy: (id: string): JSONObject => {
      return clone(find(id).policy);
    },
    customRules: (id: string): Array<JSONObject> => {
      const state: FakeAzureWafPolicy = find(id);
      const properties: JSONObject = readObject(state.policy["properties"]);
      const rules: unknown =
        state.kind === "gateway"
          ? properties["customRules"]
          : readObject(properties["customRules"])["rules"];

      return clone(Array.isArray(rules) ? (rules as Array<JSONObject>) : []);
    },
    puts: (id: string): Array<JSONObject> => {
      return clone(putsOf.get(id.toLowerCase()) || []);
    },
    writeBehind: (id: string, change: (policy: JSONObject) => void): void => {
      writeAsSomeoneElse(find(id), change);
    },
    writeBehindNextPuts: (
      id: string,
      times: number,
      change: (policy: JSONObject) => void,
    ): void => {
      behind.set(id.toLowerCase(), { times, change });
    },
    failNextPut: (status: number, body: JSONObject): void => {
      nextPutFailure = { status, body };
    },
    failReads: (status: number, body: JSONObject): void => {
      readFailure = { status, body };
    },
    setPermissions: (
      next: Array<{ actions: Array<string>; notActions: Array<string> }>,
    ): void => {
      permissions = next;
    },
  };
}
