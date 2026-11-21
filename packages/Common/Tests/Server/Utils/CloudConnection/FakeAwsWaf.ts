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
 * AWS WAF IN A TEST (#10344): WAFV2's JSON 1.1 API (X-Amz-Target
 * AWSWAF_20190729.<Action>, at wafv2.<region>.amazonaws.com), answering
 * as AWS answers - recorded from its API reference and the AWS CLI - and
 * keeping its state: each Region's and scope's IP sets and web ACLs, each
 * with the lock token its last write left.
 *
 *   - A write names the lock token of the read before it; any other is
 *     refused with WAFOptimisticLockException, as AWS refuses it, and the
 *     write leaves a new one. writeBehind() changes a set or a web ACL
 *     between OneUptime's read and its write, as another writer would.
 *   - An IP set holds one IP version and CIDRs only, at most
 *     maxAddresses (10,000); more is WAFLimitsExceededException, as is an
 *     IP set past maxIpSets (100) a Region. A set a web ACL references is
 *     not deleted (WAFAssociatedItemException).
 *   - UpdateWebACL refuses what GetWebACL answers but it does not take -
 *     ARN, Capacity, LabelNamespace, the Firewall Manager members - as a
 *     request AWS would not read; keeps those itself; refuses two rules
 *     at one priority or of one name, and a reference to an IP set that is
 *     not there (WAFNonexistentItemException), or - unavailableAfterCreate -
 *     one made a moment ago (WAFUnavailableEntityException).
 *   - CLOUDFRONT is answered in us-east-1 alone.
 *   - failNext() answers the next calls of an action with an error of
 *     AWS's: ThrottlingException, AccessDeniedException, a 500.
 *   - ListIPSets pages by Limit (or listPageSize) with NextMarker.
 */

export const FAKE_WAF_ACCOUNT_ID: string = "123456789012";

export interface FakeWafIpSet {
  name: string;
  id: string;
  arn: string;
  description: string;
  version: "IPV4" | "IPV6";
  addresses: Array<string>;
  lockToken: string;
  // The call count when it was made: unavailableAfterCreate reads it.
  madeAtCall: number;
}

export interface FakeWafWebAcl {
  webAcl: JSONObject;
  lockToken: string;
}

export interface FakeWafScopeState {
  ipSets: Map<string, FakeWafIpSet>;
  webAcls: Map<string, FakeWafWebAcl>;
}

export interface FakeAwsWafOptions {
  account?: string | undefined;
  // Each ListIPSets page holds at most this many, whatever Limit asks.
  listPageSize?: number | undefined;
  maxIpSets?: number | undefined;
  maxAddresses?: number | undefined;
  /*
   * UpdateWebACL refuses a reference to a set made within this many calls
   * of it, as AWS does while a new set is not known everywhere.
   */
  unavailableAfterCreate?: number | undefined;
  // Sampled requests by web ACL ARN and rule metric name ("<arn>|<metric>").
  sampledRequests?: Record<string, Array<JSONObject>> | undefined;
}

export interface FakeWafCall {
  action: string;
  region: string;
  body: JSONObject;
  // The account the call was signed for (an access key's: the fake's own).
  authorization: string;
}

export interface FakeAwsWaf extends FakeProviderApi {
  calls: Array<FakeWafCall>;
  actions: () => Array<string>;
  state: (region: string, scope: "REGIONAL" | "CLOUDFRONT") => FakeWafScopeState;
  addWebAcl: (data: {
    region: string;
    scope: "REGIONAL" | "CLOUDFRONT";
    name: string;
    id?: string | undefined;
    rules?: Array<JSONObject> | undefined;
    extra?: JSONObject | undefined;
  }) => FakeWafWebAcl;
  addIpSet: (data: {
    region: string;
    scope: "REGIONAL" | "CLOUDFRONT";
    name: string;
    version: "IPV4" | "IPV6";
    addresses?: Array<string> | undefined;
  }) => FakeWafIpSet;
  getIpSet: (
    region: string,
    scope: "REGIONAL" | "CLOUDFRONT",
    name: string,
  ) => FakeWafIpSet | undefined;
  getRules: (
    region: string,
    scope: "REGIONAL" | "CLOUDFRONT",
    name: string,
  ) => Array<JSONObject>;
  // The next `times` calls of an action answered with this instead.
  failNext: (action: string, response: FakeResponse, times?: number) => void;
  /*
   * Runs once, between the next read of an IP set or web ACL and the write
   * that follows it: another writer, whose write spends the token read.
   */
  writeBehind: (change: () => void, times?: number) => void;
}

export function wafError(
  code: string,
  message: string = "",
  status: number = 400,
): FakeResponse {
  return {
    status,
    body: JSON.stringify({ __type: code, Message: message }),
  };
}

export const WAF_ERRORS: {
  lock: FakeResponse;
  throttled: FakeResponse;
  denied: (action: string) => FakeResponse;
  internal: FakeResponse;
} = {
  lock: wafError(
    "WAFOptimisticLockException",
    "AWS WAF couldn’t save your changes because you tried to update or delete a resource that has changed since you last retrieved it. Get the resource again, make any changes you need to make to the new copy, and retry your operation.",
  ),
  throttled: wafError("ThrottlingException", "Rate exceeded"),
  denied: (action: string): FakeResponse => {
    return wafError(
      "AccessDeniedException",
      `User: arn:aws:iam::${FAKE_WAF_ACCOUNT_ID}:user/OneUptimeReadOnly is not authorized to perform: ${action} on resource: arn:aws:wafv2:eu-west-1:${FAKE_WAF_ACCOUNT_ID}:regional/ipset/x/y`,
    );
  },
  internal: wafError(
    "WAFInternalErrorException",
    "Your request is valid, but AWS WAF couldn’t perform the operation because of a system problem. Retry your request.",
    500,
  ),
};

let tokenCounter: number = 0;

function nextUuid(): string {
  tokenCounter++;
  const hex: string = tokenCounter.toString(16).padStart(12, "0");

  return `0000aaaa-0000-4000-8000-${hex}`;
}

const READ_ONLY_MEMBERS: Array<string> = [
  "ARN",
  "Capacity",
  "LabelNamespace",
  "ManagedByFirewallManager",
  "PreProcessFirewallManagerRuleGroups",
  "PostProcessFirewallManagerRuleGroups",
  "RetrofittedByFirewallManager",
];

function readObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

// A CIDR of the set's IP version, as AWS takes it.
function isCidrOf(address: string, version: "IPV4" | "IPV6"): boolean {
  const [ip, length] = address.split("/");

  if (!ip || length === undefined) {
    return false;
  }

  const bits: number = Number(length);

  if (!Number.isInteger(bits) || bits === 0) {
    return false;
  }

  return version === "IPV4"
    ? ip.split(".").length === 4 && bits <= 32
    : ip.includes(":") && bits <= 128;
}

function referencedArns(rules: Array<unknown>): Array<string> {
  const arns: Array<string> = [];
  const walk: (value: unknown) => void = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (value && typeof value === "object") {
      const object: JSONObject = value as JSONObject;
      const reference: JSONObject = readObject(
        object["IPSetReferenceStatement"],
      );

      if (typeof reference["ARN"] === "string") {
        arns.push(reference["ARN"] as string);
      }

      Object.values(object).forEach(walk);
    }
  };

  walk(rules);

  return arns;
}

export function createFakeAwsWaf(options: FakeAwsWafOptions = {}): FakeAwsWaf {
  const account: string = options.account || FAKE_WAF_ACCOUNT_ID;
  const states: Map<string, FakeWafScopeState> = new Map();
  const calls: Array<FakeWafCall> = [];
  const failures: Map<string, Array<FakeResponse>> = new Map();
  const behind: Array<{ change: () => void; times: number }> = [];
  let callCount: number = 0;

  const state: (
    region: string,
    scope: "REGIONAL" | "CLOUDFRONT",
  ) => FakeWafScopeState = (
    region: string,
    scope: "REGIONAL" | "CLOUDFRONT",
  ): FakeWafScopeState => {
    const key: string = `${region}|${scope}`;

    if (!states.has(key)) {
      states.set(key, { ipSets: new Map(), webAcls: new Map() });
    }

    return states.get(key)!;
  };

  const scopeWord: (scope: string) => string = (scope: string): string => {
    return scope === "CLOUDFRONT" ? "global" : "regional";
  };

  const addIpSet: FakeAwsWaf["addIpSet"] = (data) => {
    const id: string = nextUuid();
    const set: FakeWafIpSet = {
      name: data.name,
      id,
      arn: `arn:aws:wafv2:${data.region}:${account}:${scopeWord(data.scope)}/ipset/${data.name}/${id}`,
      description: "",
      version: data.version,
      addresses: [...(data.addresses || [])],
      lockToken: nextUuid(),
      madeAtCall: -1000,
    };

    state(data.region, data.scope).ipSets.set(data.name, set);

    return set;
  };

  const addWebAcl: FakeAwsWaf["addWebAcl"] = (data) => {
    const id: string = data.id || nextUuid();
    const acl: FakeWafWebAcl = {
      webAcl: {
        Name: data.name,
        Id: id,
        ARN: `arn:aws:wafv2:${data.region}:${account}:${scopeWord(data.scope)}/webacl/${data.name}/${id}`,
        DefaultAction: { Allow: {} },
        Rules: (data.rules || []) as Array<JSONValue>,
        VisibilityConfig: {
          SampledRequestsEnabled: true,
          CloudWatchMetricsEnabled: true,
          MetricName: data.name,
        },
        Capacity: 3,
        LabelNamespace: `awswaf:${account}:webacl:${data.name}:`,
        ManagedByFirewallManager: false,
        ...(data.extra || {}),
      },
      lockToken: nextUuid(),
    };

    state(data.region, data.scope).webAcls.set(id, acl);

    return acl;
  };

  const runBehind: () => void = (): void => {
    const next: { change: () => void; times: number } | undefined = behind[0];

    if (next) {
      next.change();
      next.times--;

      if (next.times <= 0) {
        behind.shift();
      }
    }
  };

  const respond: (action: string, region: string, body: JSONObject) => FakeResponse = (
    action: string,
    region: string,
    body: JSONObject,
  ): FakeResponse => {
    const scope: "REGIONAL" | "CLOUDFRONT" =
      body["Scope"] === "CLOUDFRONT" ? "CLOUDFRONT" : "REGIONAL";

    if (scope === "CLOUDFRONT" && region !== "us-east-1") {
      return wafError(
        "WAFInvalidParameterException",
        "Error reason: The scope is not valid., field: SCOPE_VALUE, parameter: CLOUDFRONT",
      );
    }

    const here: FakeWafScopeState = state(region, scope);
    const findSet: () => FakeWafIpSet | undefined = () => {
      return Array.from(here.ipSets.values()).find((set: FakeWafIpSet) => {
        return set.id === body["Id"] && set.name === body["Name"];
      });
    };
    const findAcl: () => FakeWafWebAcl | undefined = () => {
      const acl: FakeWafWebAcl | undefined = here.webAcls.get(
        String(body["Id"]),
      );

      return acl && acl.webAcl["Name"] === body["Name"] ? acl : undefined;
    };
    const nonexistent: FakeResponse = wafError(
      "WAFNonexistentItemException",
      "AWS WAF couldn’t perform the operation because your resource doesn’t exist.",
    );

    switch (action) {
      case "ListIPSets": {
        const all: Array<FakeWafIpSet> = Array.from(here.ipSets.values());
        const start: number = body["NextMarker"]
          ? Number(body["NextMarker"])
          : 0;
        const size: number = Math.min(
          Number(body["Limit"] || 100),
          options.listPageSize || 100,
        );
        const page: Array<FakeWafIpSet> = all.slice(start, start + size);

        return json({
          IPSets: page.map((set: FakeWafIpSet): JSONObject => {
            return {
              Name: set.name,
              Id: set.id,
              Description: set.description,
              LockToken: set.lockToken,
              ARN: set.arn,
            };
          }),
          ...(start + size < all.length
            ? { NextMarker: String(start + size) }
            : {}),
        });
      }
      case "GetIPSet": {
        const set: FakeWafIpSet | undefined = findSet();

        if (!set) {
          return nonexistent;
        }

        const answer: FakeResponse = json({
          IPSet: {
            Name: set.name,
            Id: set.id,
            ARN: set.arn,
            Description: set.description,
            IPAddressVersion: set.version,
            Addresses: [...set.addresses],
          },
          LockToken: set.lockToken,
        });

        runBehind();

        return answer;
      }
      case "CreateIPSet": {
        const name: string = String(body["Name"]);

        if (here.ipSets.has(name)) {
          return wafError(
            "WAFDuplicateItemException",
            "AWS WAF couldn’t perform the operation because some resource in your request is a duplicate of an existing one.",
          );
        }

        if (here.ipSets.size >= (options.maxIpSets ?? 100)) {
          return wafError(
            "WAFLimitsExceededException",
            "AWS WAF couldn’t perform the operation because you exceeded your resource limit. For example, the maximum number of WebACL objects that you can create for an AWS account.",
          );
        }

        const version: "IPV4" | "IPV6" =
          body["IPAddressVersion"] === "IPV6" ? "IPV6" : "IPV4";
        const addresses: Array<string> = (
          (body["Addresses"] as Array<string>) || []
        ).map(String);

        if (
          addresses.some((address: string): boolean => {
            return !isCidrOf(address, version);
          })
        ) {
          return wafError(
            "WAFInvalidParameterException",
            "Error reason: The parameter contains formatting that is not valid., field: IP_ADDRESS",
          );
        }

        const set: FakeWafIpSet = addIpSet({
          region,
          scope,
          name,
          version,
          addresses,
        });

        set.description = String(body["Description"] || "");
        set.madeAtCall = callCount;

        return json({
          Summary: {
            Name: set.name,
            Id: set.id,
            Description: set.description,
            LockToken: set.lockToken,
            ARN: set.arn,
          },
        });
      }
      case "UpdateIPSet": {
        const set: FakeWafIpSet | undefined = findSet();

        if (!set) {
          return nonexistent;
        }

        if (body["LockToken"] !== set.lockToken) {
          return WAF_ERRORS.lock;
        }

        const addresses: Array<string> = (
          (body["Addresses"] as Array<string>) || []
        ).map(String);

        if (addresses.length > (options.maxAddresses ?? 10000)) {
          return wafError(
            "WAFLimitsExceededException",
            "AWS WAF couldn’t perform the operation because you exceeded your resource limit.",
          );
        }

        if (
          addresses.some((address: string): boolean => {
            return !isCidrOf(address, set.version);
          })
        ) {
          return wafError(
            "WAFInvalidParameterException",
            "Error reason: The parameter contains formatting that is not valid., field: IP_ADDRESS",
          );
        }

        set.addresses = addresses;
        set.description = String(body["Description"] || set.description);
        set.lockToken = nextUuid();

        return json({ NextLockToken: set.lockToken });
      }
      case "DeleteIPSet": {
        const set: FakeWafIpSet | undefined = findSet();

        if (!set) {
          return nonexistent;
        }

        if (body["LockToken"] !== set.lockToken) {
          return WAF_ERRORS.lock;
        }

        const isReferenced: boolean = Array.from(here.webAcls.values()).some(
          (acl: FakeWafWebAcl): boolean => {
            return referencedArns(
              (acl.webAcl["Rules"] as Array<unknown>) || [],
            ).includes(set.arn);
          },
        );

        if (isReferenced) {
          return wafError(
            "WAFAssociatedItemException",
            "AWS WAF couldn’t perform the operation because your resource is being used by another resource or it’s associated with another resource.",
          );
        }

        here.ipSets.delete(set.name);

        return json({});
      }
      case "GetWebACL": {
        const acl: FakeWafWebAcl | undefined = findAcl();

        if (!acl) {
          return nonexistent;
        }

        const answer: FakeResponse = json({
          WebACL: JSON.parse(JSON.stringify(acl.webAcl)) as JSONObject,
          LockToken: acl.lockToken,
          ApplicationIntegrationURL: "https://example.edge.sdk.awswaf.com/",
        });

        runBehind();

        return answer;
      }
      case "UpdateWebACL": {
        const acl: FakeWafWebAcl | undefined = findAcl();

        if (!acl) {
          return nonexistent;
        }

        const readOnly: Array<string> = READ_ONLY_MEMBERS.filter(
          (member: string): boolean => {
            return body[member] !== undefined;
          },
        );

        if (readOnly.length > 0) {
          return wafError(
            "SerializationException",
            `Unknown members in UpdateWebACL: ${readOnly.join(", ")}`,
          );
        }

        if (body["LockToken"] !== acl.lockToken) {
          return WAF_ERRORS.lock;
        }

        const rules: Array<JSONObject> = (
          (body["Rules"] as Array<JSONObject>) || []
        ).map(readObject);
        const priorities: Array<unknown> = rules.map((rule: JSONObject) => {
          return rule["Priority"];
        });
        const names: Array<unknown> = rules.map((rule: JSONObject) => {
          return rule["Name"];
        });

        if (
          new Set(priorities).size !== priorities.length ||
          new Set(names).size !== names.length
        ) {
          return wafError(
            "WAFInvalidParameterException",
            "Error reason: Your request contains fields that must be unique, but they aren't., field: RULE",
          );
        }

        for (const arn of referencedArns(rules)) {
          const set: FakeWafIpSet | undefined = Array.from(
            here.ipSets.values(),
          ).find((candidate: FakeWafIpSet): boolean => {
            return candidate.arn === arn;
          });

          if (!set) {
            return nonexistent;
          }

          if (
            options.unavailableAfterCreate &&
            callCount - set.madeAtCall <= options.unavailableAfterCreate
          ) {
            return wafError(
              "WAFUnavailableEntityException",
              "AWS WAF couldn’t retrieve a resource that you specified for this operation. If you've just created a resource that you're using in this operation, you might just need to wait a few minutes.",
            );
          }
        }

        const kept: JSONObject = {};

        for (const member of READ_ONLY_MEMBERS) {
          if (acl.webAcl[member] !== undefined) {
            kept[member] = acl.webAcl[member] as JSONValue;
          }
        }

        const next: JSONObject = { ...kept };

        for (const [member, value] of Object.entries(body)) {
          if (member !== "Scope" && member !== "LockToken") {
            next[member] = value as JSONValue;
          }
        }

        acl.webAcl = next;
        acl.lockToken = nextUuid();

        return json({ NextLockToken: acl.lockToken });
      }
      case "GetSampledRequests": {
        const key: string = `${String(body["WebAclArn"])}|${String(body["RuleMetricName"])}`;

        return json({
          SampledRequests: (options.sampledRequests || {})[key] || [],
          PopulationSize: ((options.sampledRequests || {})[key] || []).length,
          TimeWindow: body["TimeWindow"] || {},
        });
      }
      default:
        return wafError("UnknownOperationException", action);
    }
  };

  const api: FakeProviderApi = createFakeProviderApi([
    {
      path: "/",
      method: "POST",
      respond: (request: DataSourceHttpRequest, url: URL): FakeResponse => {
        const target: string = String(
          Object.entries(request.headers || {}).find(
            ([name]: [string, unknown]): boolean => {
              return name.toLowerCase() === "x-amz-target";
            },
          )?.[1] || "",
        );
        const action: string = target.replace("AWSWAF_20190729.", "");
        const region: string = url.host.split(".")[1] || "";
        const body: JSONObject = bodyOf(request);

        callCount++;
        calls.push({
          action,
          region,
          body,
          authorization: String(
            Object.entries(request.headers || {}).find(
              ([name]: [string, unknown]): boolean => {
                return name.toLowerCase() === "authorization";
              },
            )?.[1] || "",
          ),
        });

        const failing: Array<FakeResponse> | undefined = failures.get(action);

        if (failing && failing.length > 0) {
          return failing.shift()!;
        }

        return respond(action, region, body);
      },
    },
  ]);

  return {
    ...api,
    calls,
    actions: (): Array<string> => {
      return calls.map((call: FakeWafCall): string => {
        return call.action;
      });
    },
    state,
    addWebAcl,
    addIpSet,
    getIpSet: (region: string, scope: "REGIONAL" | "CLOUDFRONT", name: string) => {
      return state(region, scope).ipSets.get(name);
    },
    getRules: (region: string, scope: "REGIONAL" | "CLOUDFRONT", name: string) => {
      const acl: FakeWafWebAcl | undefined = Array.from(
        state(region, scope).webAcls.values(),
      ).find((candidate: FakeWafWebAcl): boolean => {
        return candidate.webAcl["Name"] === name;
      });

      return ((acl?.webAcl["Rules"] as Array<JSONObject>) || []).map(readObject);
    },
    failNext: (action: string, response: FakeResponse, times: number = 1) => {
      failures.set(action, [
        ...(failures.get(action) || []),
        ...Array.from({ length: times }, (): FakeResponse => {
          return response;
        }),
      ]);
    },
    writeBehind: (change: () => void, times: number = 1) => {
      behind.push({ change, times });
    },
  };
}

// Another writer's write: the set's token spent, its addresses as given.
export function bumpIpSet(set: FakeWafIpSet, addresses?: Array<string>): void {
  if (addresses) {
    set.addresses = [...addresses];
  }

  set.lockToken = nextUuid();
}

// Another writer's write of a web ACL: its token spent, its rules as given.
export function bumpWebAcl(acl: FakeWafWebAcl, rules?: Array<JSONObject>): void {
  if (rules) {
    acl.webAcl["Rules"] = rules;
  }

  acl.lockToken = nextUuid();
}
