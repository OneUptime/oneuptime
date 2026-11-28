import { JSONObject, JSONValue } from "../../Types/JSON";

/*
 * AN IAM ROLE'S TRUST POLICY, READ FOR A SECURITY CASE (#11038): who may
 * assume the role, as the policy says it - the outside AWS accounts it
 * trusts, for the Fix step "Undo what changed on the account" to name, and
 * whether the policy now is the one an attack set.
 *
 *   - IAM's GetRole writes a policy URL-encoded (RFC 3986); CloudTrail
 *     writes the one a call set as the caller sent it, spaces and all, and
 *     cut where an attribute ends. A text that is not a whole policy is
 *     none: never read in part.
 *   - A principal names its account in an ARN of IAM or STS
 *     ("arn:aws:iam::444455556666:root", ":role/...", ":user/...",
 *     "arn:aws:sts::444455556666:assumed-role/..."), or as the account's
 *     12 digits, which IAM saves as the account's root ARN; "*" is every
 *     AWS account. A principal IAM can no longer name - one deleted, which
 *     it writes as its unique id ("AROA...") - names no account, and lets
 *     nobody in.
 *   - Only what an Allow statement trusts: a Deny only narrows it, and a
 *     trust policy holds no NotPrincipal (IAM refuses one). Every Allow's
 *     principal counts, whatever its actions or conditions: reading one as
 *     trusting more than it does is safe, as less would not be.
 */

// Every AWS account: a trust policy's "*".
export const AWS_EVERY_ACCOUNT: string = "*";

// An AWS account's id: twelve digits.
const AWS_ACCOUNT_ID: RegExp = /^\d{12}$/;

// The account an IAM or STS ARN is of: arn:<partition>:iam::<account>:...
const AWS_PRINCIPAL_ARN: RegExp = /^arn:[a-z-]+:(?:iam|sts)::(\d{12}):/;

// An account's root, the form IAM saves an account id in.
const AWS_ACCOUNT_ROOT_ARN: RegExp = /^arn:[a-z-]+:iam::(\d{12}):root$/;

function isObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parsePolicy(text: string): JSONObject | null {
  try {
    const parsed: unknown = JSON.parse(text);

    return isObject(parsed) && parsed["Statement"] !== undefined
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/*
 * A policy as IAM or CloudTrail wrote it: the policy, or null for a text
 * that is not a whole one - cut short, or not a policy at all.
 */
export function readAwsPolicyDocument(
  text: string | null | undefined,
): JSONObject | null {
  const trimmed: string = (text || "").trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("{")) {
    return parsePolicy(trimmed);
  }

  // URL-encoded, as GetRole writes it: RFC 3986, or a "+" for a space.
  for (const encoded of [trimmed, trimmed.split("+").join(" ")]) {
    try {
      const policy: JSONObject | null = parsePolicy(
        decodeURIComponent(encoded),
      );

      if (policy) {
        return policy;
      }
    } catch {
      // Not URL-encoded: no policy.
    }
  }

  return null;
}

// A policy's statements: one, or a list of them.
function statementsOf(policy: JSONObject): Array<JSONObject> {
  const statement: JSONValue | undefined = policy["Statement"];
  const list: Array<JSONValue> = Array.isArray(statement)
    ? statement
    : statement === undefined
      ? []
      : [statement];

  return list.filter(isObject);
}

// One value, or a list of them, as strings.
function asStrings(value: JSONValue | undefined): Array<string> {
  if (value === undefined || value === null) {
    return [];
  }

  const list: Array<JSONValue> = Array.isArray(value) ? value : [value];

  return list
    .filter((item: JSONValue): boolean => {
      return (
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean"
      );
    })
    .map((item: JSONValue): string => {
      return String(item).trim();
    });
}

/*
 * The account a principal of a trust policy is in: its id, "*" for every
 * account, or "" when it names none - a service, a deleted principal.
 */
export function readAwsPrincipalAccount(principal: string): string {
  const text: string = principal.trim();

  if (text === AWS_EVERY_ACCOUNT) {
    return AWS_EVERY_ACCOUNT;
  }

  if (AWS_ACCOUNT_ID.test(text)) {
    return text;
  }

  return text.match(AWS_PRINCIPAL_ARN)?.[1] || "";
}

/*
 * The AWS accounts other than `accountId` - the role's own - that a trust
 * policy lets assume the role, in the order it names them, each once; "*"
 * when it trusts every AWS account.
 */
export function getAwsTrustedOutsideAccounts(
  policy: JSONObject,
  accountId: string,
): Array<string> {
  const accounts: Array<string> = [];

  for (const statement of statementsOf(policy)) {
    if (String(statement["Effect"] || "").toLowerCase() !== "allow") {
      continue;
    }

    const principal: JSONValue | undefined = statement["Principal"];
    const named: Array<string> =
      principal === AWS_EVERY_ACCOUNT
        ? [AWS_EVERY_ACCOUNT]
        : isObject(principal)
          ? asStrings(principal["AWS"])
          : [];

    for (const value of named) {
      const account: string = readAwsPrincipalAccount(value);

      if (account && account !== accountId && !accounts.includes(account)) {
        accounts.push(account);
      }
    }
  }

  return accounts;
}

// ---------- Whether two policies grant the same ----------

// A list as a set: each once, in one order.
function asSet(values: Array<string>): Array<string> {
  return Array.from(new Set(values)).sort();
}

// Any JSON with its keys in one order, so two writings of it compare.
function sortedJson(value: JSONValue | undefined): JSONValue {
  if (Array.isArray(value)) {
    return value.map(sortedJson);
  }

  if (isObject(value)) {
    const sorted: JSONObject = {};

    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortedJson(value[key]);
    }

    return sorted;
  }

  return value === undefined ? null : value;
}

/*
 * A principal as IAM reads it: "*" is every AWS principal, and an account
 * by its id or its root's ARN is one account, in whichever partition.
 */
function principalOf(value: JSONValue | undefined): JSONObject {
  if (value === AWS_EVERY_ACCOUNT) {
    return { AWS: [AWS_EVERY_ACCOUNT] };
  }

  const principal: JSONObject = {};

  if (!isObject(value)) {
    return principal;
  }

  for (const type of Object.keys(value).sort()) {
    principal[type] = asSet(
      asStrings(value[type]).map((name: string): string => {
        const root: string | undefined = name.match(AWS_ACCOUNT_ROOT_ARN)?.[1];

        return type === "AWS" && (root || AWS_ACCOUNT_ID.test(name))
          ? `account:${root || name}`
          : name;
      }),
    );
  }

  return principal;
}

// A condition block, each value a set: { operator: { key: [values] } }.
function conditionOf(value: JSONValue | undefined): JSONObject {
  const condition: JSONObject = {};

  if (!isObject(value)) {
    return condition;
  }

  for (const operator of Object.keys(value).sort()) {
    const keys: JSONValue | undefined = value[operator];
    const byKey: JSONObject = {};

    if (isObject(keys)) {
      for (const key of Object.keys(keys).sort()) {
        byKey[key] = asSet(asStrings(keys[key]));
      }
    }

    condition[operator] = byKey;
  }

  return condition;
}

/*
 * A statement as what it grants: its Sid, a label, dropped; its actions,
 * which IAM reads case aside, and its resources as sets; its principals
 * and conditions as IAM reads them; anything else as written.
 */
function statementOf(statement: JSONObject): string {
  const read: JSONObject = {};

  for (const key of Object.keys(statement).sort()) {
    const value: JSONValue | undefined = statement[key];

    switch (key) {
      case "Sid":
        break;
      case "Action":
      case "NotAction":
        read[key] = asSet(
          asStrings(value).map((action: string): string => {
            return action.toLowerCase();
          }),
        );
        break;
      case "Resource":
      case "NotResource":
        read[key] = asSet(asStrings(value));
        break;
      case "Principal":
      case "NotPrincipal":
        read[key] = principalOf(value);
        break;
      case "Condition":
        read[key] = conditionOf(value);
        break;
      default:
        read[key] = sortedJson(value);
    }
  }

  return JSON.stringify(read);
}

/*
 * Whether two policies grant the same, however each is written: its
 * statements in any order and with any Sid, an account by its id or its
 * root's ARN, a list of one or the one alone. Anything they differ in
 * beyond that, a condition among it, makes them two.
 */
export function isSameAwsPolicy(left: JSONObject, right: JSONObject): boolean {
  const read: (policy: JSONObject) => string = (policy: JSONObject): string => {
    return JSON.stringify({
      Version: String(policy["Version"] || ""),
      Statement: asSet(statementsOf(policy).map(statementOf)),
    });
  };

  return read(left) === read(right);
}
