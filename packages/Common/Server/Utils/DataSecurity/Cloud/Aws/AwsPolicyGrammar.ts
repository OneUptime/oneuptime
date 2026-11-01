import { DataStorePrincipalType } from "../../../../../Types/DataSecurity/DataStoreAccess";
import { JSONObject } from "../../../../../Types/JSON";
import { readObject } from "../../../LlmObservability/LlmProviderHttp";

/*
 * THE GRAMMAR OF AN AWS POLICY, AS DATA SECURITY READS IT.
 *
 * A bucket's or a domain's policy (AwsDataSecurityReader) and an identity's
 * own policies (AwsIamAccess) are written in one language: statements of
 * an Effect, an Action or NotAction, a Resource or NotResource, a
 * Principal and Conditions. These read it the way IAM does - its "*" and
 * "?" wildcards with case ignored, a value or a list of values, the
 * principals a statement names - and never with a regular expression:
 * every pattern here is the customer's own.
 */

// Twelve digits: an AWS account id.
export function isAccountId(text: string): boolean {
  if (text.length !== 12) {
    return false;
  }

  for (const character of text) {
    if (character < "0" || character > "9") {
      return false;
    }
  }

  return true;
}

/*
 * Condition keys that hold a grant to "*" to known callers - an
 * organization, an account, a network, an endpoint - so AWS does not count
 * it public (the rules of S3's own public policy check).
 */
export const RESTRICTING_CONDITION_KEYS: Array<string> = [
  "aws:sourceip",
  "aws:sourcevpc",
  "aws:sourcevpce",
  "aws:sourcevpcarn",
  "aws:sourcearn",
  "aws:sourceaccount",
  "aws:sourceowner",
  "aws:sourceorgid",
  "aws:sourceorgpaths",
  "aws:principalarn",
  "aws:principalaccount",
  "aws:principalorgid",
  "aws:principalorgpaths",
  "aws:principalservicename",
  "aws:userid",
  "aws:username",
  "aws:vpceaccount",
  "aws:vpceorgid",
  "aws:vpceorgpaths",
  "s3:dataaccesspointarn",
  "s3:dataaccesspointaccount",
];

// A policy value as strings: "x", ["x", "y"], numbers and booleans written out.
export function policyValues(value: unknown): Array<string> {
  const values: Array<unknown> = Array.isArray(value) ? value : [value];

  return values
    .map((item: unknown): string => {
      if (typeof item === "string") {
        return item.trim();
      }

      if (typeof item === "number" || typeof item === "boolean") {
        return String(item);
      }

      return "";
    })
    .filter((item: string): boolean => {
      return item.length > 0;
    });
}

/*
 * IAM's wildcards: "*" any run of characters, "?" one, case ignored. A
 * scan with backtracking to the last "*", no regular expression: patterns
 * come from the customer's policy.
 */
export function wildcardMatches(pattern: string, value: string): boolean {
  const p: string = pattern.toLowerCase();
  const v: string = value.toLowerCase();
  let pi: number = 0;
  let vi: number = 0;
  let star: number = -1;
  let mark: number = 0;

  while (vi < v.length) {
    if (
      pi < p.length &&
      (p.charAt(pi) === "?" || p.charAt(pi) === v.charAt(vi))
    ) {
      pi++;
      vi++;
    } else if (pi < p.length && p.charAt(pi) === "*") {
      star = pi;
      mark = vi;
      pi++;
    } else if (star >= 0) {
      pi = star + 1;
      mark++;
      vi = mark;
    } else {
      return false;
    }
  }

  while (pi < p.length && p.charAt(pi) === "*") {
    pi++;
  }

  return pi === p.length;
}

// Whether a statement's Action (or NotAction) covers any of the samples.
export function coversAny(
  actions: Array<string>,
  notActions: Array<string>,
  samples: Array<string>,
): boolean {
  if (actions.length > 0) {
    return samples.some((sample: string): boolean => {
      return actions.some((action: string): boolean => {
        return wildcardMatches(action, sample);
      });
    });
  }

  if (notActions.length > 0) {
    return samples.some((sample: string): boolean => {
      return !notActions.some((action: string): boolean => {
        return wildcardMatches(action, sample);
      });
    });
  }

  return false;
}

// A value with a wildcard or a policy variable is not a fixed restriction.
export function isFixedValue(value: string): boolean {
  return !value.includes("*") && !value.includes("?") && !value.includes("${");
}

// A CIDR wider than /8 (IPv4) or /32 (IPv6) lets most of the internet in.
export function isBroadCidr(value: string): boolean {
  const slash: number = value.indexOf("/");

  if (slash < 0) {
    return false;
  }

  const prefix: number = Number(value.slice(slash + 1));

  if (!Number.isFinite(prefix)) {
    return true;
  }

  return value.includes(":") ? prefix < 32 : prefix < 8;
}

/*
 * Whether a statement's conditions hold it to known callers. A negated
 * test, a Null test, an ...IfExists test (which a request without the key
 * passes) and a ForAllValues test (which an empty set passes) restrict
 * nothing.
 */
export function hasRestrictingCondition(conditions: JSONObject): boolean {
  for (const operator of Object.keys(conditions)) {
    const op: string = operator.toLowerCase();

    if (
      op.includes("not") ||
      op === "null" ||
      op.endsWith("ifexists") ||
      op.startsWith("forallvalues:")
    ) {
      continue;
    }

    const block: JSONObject = readObject(conditions[operator]);

    for (const key of Object.keys(block)) {
      const name: string = key.toLowerCase();

      if (!RESTRICTING_CONDITION_KEYS.includes(name)) {
        continue;
      }

      const values: Array<string> = policyValues(block[key]);

      if (values.length === 0 || !values.every(isFixedValue)) {
        continue;
      }

      if (name === "aws:sourceip" && values.some(isBroadCidr)) {
        continue;
      }

      return true;
    }
  }

  return false;
}

export interface PolicyPrincipal {
  kind: "public" | "AWS" | "Service" | "CanonicalUser" | "Federated";
  value: string;
}

export function readPrincipals(statement: JSONObject): Array<PolicyPrincipal> {
  // Allowed to everyone but the principals named.
  if (statement["NotPrincipal"] !== undefined) {
    return [{ kind: "public", value: "*" }];
  }

  const principal: unknown = statement["Principal"];

  if (principal === "*") {
    return [{ kind: "public", value: "*" }];
  }

  const named: JSONObject = readObject(principal);
  const principals: Array<PolicyPrincipal> = [];

  for (const kind of ["AWS", "Service", "CanonicalUser", "Federated"] as Array<
    PolicyPrincipal["kind"]
  >) {
    for (const value of policyValues(named[kind])) {
      principals.push(
        value === "*" ? { kind: "public", value } : { kind, value },
      );
    }
  }

  return principals;
}

/*
 * A named principal as an access entry's principal: an account id or its
 * root, a role (or a session of one), a user, a service, a canonical user.
 */
export function describePrincipal(principal: PolicyPrincipal): {
  principal: string;
  principalName?: string | undefined;
  principalType: DataStorePrincipalType;
  accountId: string;
} {
  const value: string = principal.value;

  if (principal.kind === "Service") {
    return {
      principal: value,
      principalType: DataStorePrincipalType.Service,
      accountId: "",
    };
  }

  if (principal.kind === "CanonicalUser") {
    return {
      principal: value,
      principalType: DataStorePrincipalType.Account,
      accountId: "",
    };
  }

  if (isAccountId(value)) {
    return {
      principal: value,
      principalType: DataStorePrincipalType.Account,
      accountId: value,
    };
  }

  if (!value.startsWith("arn:")) {
    // A role or user since deleted, which IAM shows by its unique id.
    return {
      principal: value,
      principalType: value.startsWith("AIDA")
        ? DataStorePrincipalType.User
        : DataStorePrincipalType.Role,
      accountId: "",
    };
  }

  const parts: Array<string> = value.split(":");
  const account: string = parts[4] || "";
  const resource: string = parts.slice(5).join(":");
  const lastName: string = resource.split("/").pop() || resource;

  // An AWS-owned principal (arn:aws:iam::cloudfront:user/...): a service.
  if (!isAccountId(account)) {
    return {
      principal: value,
      principalName: lastName,
      principalType: DataStorePrincipalType.Service,
      accountId: "",
    };
  }

  if (resource.startsWith("role/")) {
    return {
      principal: value,
      principalName: lastName,
      principalType: DataStorePrincipalType.Role,
      accountId: account,
    };
  }

  if (resource.startsWith("assumed-role/")) {
    return {
      principal: value,
      principalName: resource.split("/")[1] || lastName,
      principalType: DataStorePrincipalType.Role,
      accountId: account,
    };
  }

  if (resource.startsWith("user/") || resource.startsWith("federated-user/")) {
    return {
      principal: value,
      principalName: lastName,
      principalType: DataStorePrincipalType.User,
      accountId: account,
    };
  }

  return {
    principal: value,
    principalName: account,
    principalType: DataStorePrincipalType.Account,
    accountId: account,
  };
}
