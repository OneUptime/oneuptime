import { JSONObject, JSONValue } from "../../Types/JSON";

/*
 * AN IAM ROLE'S TRUST POLICY, READ FOR A SECURITY CASE (#11038): who may
 * assume the role, as the policy says it - the outside AWS accounts it
 * trusts, and the identity providers it lets in with what their conditions
 * hold them to (#11378), for the Fix step "Undo what changed on the
 * account" to name - and whether the policy now is the one an attack set.
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

// ---------- The identity providers a trust policy lets in (#11378) ----------

/*
 * A trust policy also lets people and workloads in through an identity
 * provider: a "Federated" principal of an Allow statement - an OIDC
 * provider in the account (arn:aws:iam::<account>:oidc-provider/<its
 * URL>, GitHub Actions' token.actions.githubusercontent.com among them),
 * one built into AWS (accounts.google.com, cognito-identity.amazonaws.com,
 * graph.facebook.com, www.amazon.com), or a SAML provider in the account
 * (saml-provider/<its name>). Whom it lets in is what its conditions hold
 * the token's claims to:
 *
 *   - a shared provider - one every organization gets its tokens from,
 *     AWS's list below - is held to an organization of yours only by its
 *     tenancy claim (GitHub Actions' sub, Amazon Cognito's aud): without
 *     it, anyone with a token from it, in any organization, may assume
 *     the role;
 *   - a provider of your own (an EKS cluster's, your company's) is held to
 *     whom it signs in by sub, or to one app by aud - never by
 *     sts.amazonaws.com, the audience AWS's own tokens all carry;
 *   - a SAML provider signs in whomever it allows as the role.
 *
 * A claim is held only by StringEquals, StringEqualsIgnoreCase or
 * StringLike (also with ForAnyValue:, ForAllValues: or IfExists), with
 * values none of which lets anything in: under StringLike, a value of
 * wildcards alone, or one whose organization has a wildcard ("repo:*",
 * "repo:octo-*" - anyone can make an organization of such a name), or,
 * for a claim that names an organization whole (aud, app_id), any
 * wildcard. Like the outside accounts, every Allow's provider counts,
 * whatever its actions: reading one as letting in more than it does is
 * safe, as less would not be.
 */

export enum AwsIdentityProviderKind {
  // An OIDC provider in IAM, or one built into AWS.
  Oidc = "Oidc",
  // A SAML provider in IAM.
  Saml = "Saml",
}

// How far a provider lets people in, as the trust policy holds it.
export enum AwsIdentityProviderReach {
  // Only tokens whose claim matches the values it names.
  Limited = "Limited",
  // Anyone with a token from a shared provider, in any organization: its tenancy claim is not held.
  AnyOrganization = "AnyOrganization",
  // Anyone with a token from a provider of your own: neither sub nor an app's aud is held.
  Anyone = "Anyone",
  // A SAML provider: whomever it signs in as the role.
  SignedIn = "SignedIn",
}

export interface AwsTrustedIdentityProvider {
  // As the trust policy names it: the provider's ARN, or a built-in provider's host.
  principal: string;
  // As a person reads it: the provider's URL, or a SAML provider's name.
  name: string;
  kind: AwsIdentityProviderKind;
  reach: AwsIdentityProviderReach;
  // The token's claim that says who - sub, aud, app_id - or "" for SAML.
  claim: string;
  // What the claim is held to, as written, each once: none unless Limited.
  values: Array<string>;
}

// The audience AWS STS's tokens carry from many issuers: holding aud to it holds nobody out.
const AWS_STS_AUDIENCE: string = "sts.amazonaws.com";

/*
 * The identity providers every organization gets its tokens from, by
 * their URL, and the claims that tell organizations apart: the ones built
 * into AWS, and AWS's "Identity-provider controls for shared OIDC
 * providers" (IAM User Guide), whose required claims IAM checks when a
 * trust policy is written - but not in one written before it did. A claim
 * with a colon is a key of its own (Azure Sentinel's sts:RoleSessionName);
 * any other is the provider's: "<URL>:sub".
 */
export const AWS_SHARED_IDENTITY_PROVIDERS: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  // Built into AWS.
  "cognito-identity.amazonaws.com": ["aud"],
  "accounts.google.com": ["aud"],
  "graph.facebook.com": ["app_id"],
  "www.amazon.com": ["app_id"],
  // AWS's list of shared OIDC providers.
  "sts.windows.net/33e01921-4d64-4f8c-a055-5bdaffd5e33d": [
    "sts:RoleSessionName",
  ],
  "agent.buildkite.com": ["sub"],
  "oidc.codefresh.io": ["sub"],
  "studio.datachain.ai/api": ["sub"],
  "token.actions.githubusercontent.com": ["sub", "job_workflow_ref"],
  "oidc-configuration.audit-log.githubusercontent.com": ["sub"],
  "vstoken.actions.githubusercontent.com": ["sub"],
  "gitlab.com": ["sub"],
  "rh-oidc.s3.us-east-1.amazonaws.com/22ejnvnnturfmt6km08idd0nt4hekbn7": [
    "sub",
  ],
  "rh-oidc.s3.us-east-1.amazonaws.com/23e3sd27sju1hoou6ohfs68vbno607tr": [
    "sub",
  ],
  "rh-oidc.s3.us-east-1.amazonaws.com/23ne21h005qjl3n33d8dui5dlrmv2tmg": [
    "sub",
  ],
  "rh-oidc.s3.us-east-1.amazonaws.com/24jrf12m5dj7ljlfb4ta2frhrcoadm26": [
    "sub",
  ],
  "oidc.op1.openshiftapps.com/2f785sojlpb85i7402pk3qogugim5nfb": ["sub"],
  "oidc.op1.openshiftapps.com/2c51blsaqa9gkjt0o9rt11mle8mmropu": ["sub"],
  "api.pulumi.com/oidc": ["aud"],
  "sandboxes.cloud": ["aud"],
  "scalr.io": ["sub"],
  "tokens.cloud.shisho.dev": ["sub"],
  "app.terraform.io": ["sub"],
  "proidc.upbound.io": ["sub"],
  "oidc.vercel.com": ["aud"],
};

// The claims of a provider of your own that say whom it lets in.
const OWN_PROVIDER_CLAIMS: ReadonlyArray<string> = ["sub", "aud"];

// The claims that name an organization whole, where any wildcard lets in others.
const WHOLE_ORGANIZATION_CLAIMS: ReadonlyArray<string> = [
  "aud",
  "app_id",
  "sts:rolesessionname",
];

// The operators that hold a claim to the values they name, with ForAnyValue: and the like aside.
const HOLDING_OPERATORS: ReadonlyArray<string> = [
  "stringequals",
  "stringequalsignorecase",
  "stringlike",
];

// An IAM OIDC or SAML provider's ARN: arn:<partition>:iam::<account>:oidc-provider/<URL>.
const AWS_PROVIDER_ARN: RegExp =
  /^arn:[a-z-]+:iam::\d{12}:(oidc-provider|saml-provider)\/(.+)$/i;

// A condition value's wildcards, as StringLike reads them: any character, and any run of them.
const WILDCARD: RegExp = /[*?]/;
const ONLY_WILDCARDS: RegExp = /^[*?]*$/;

// A provider's URL as IAM writes it in its ARN and its condition keys: no scheme, no slash at its end.
function readProviderUrl(text: string): string {
  return text
    .trim()
    .replace(/^https:\/\//i, "")
    .replace(/\/+$/, "");
}

/*
 * A Federated principal as a person reads it: its kind, and its URL as
 * written (an EKS cluster's id keeps its case) or SAML name - and its URL
 * as condition keys match it, case aside. A principal IAM writes no other
 * way is an OIDC provider by what it says.
 */
export function readAwsFederatedPrincipal(principal: string): {
  kind: AwsIdentityProviderKind;
  name: string;
  url: string;
} {
  const match: RegExpMatchArray | null = principal
    .trim()
    .match(AWS_PROVIDER_ARN);

  if (match && match[1]!.toLowerCase() === "saml-provider") {
    return {
      kind: AwsIdentityProviderKind.Saml,
      name: match[2]!,
      url: "",
    };
  }

  const name: string = readProviderUrl(match ? match[2]! : principal);

  return { kind: AwsIdentityProviderKind.Oidc, name, url: name.toLowerCase() };
}

// Only wildcards, or nothing: it holds the claim to nothing at all.
function isOnlyWildcards(value: string): boolean {
  return ONLY_WILDCARDS.test(value.trim());
}

/*
 * The organization a sub-like claim's value names: what follows its own
 * name, up to the next "/" or ":" - repo:<organization>/..., organization:
 * <organization>:..., project_path:<group>/... - or, with no name before
 * it (a job_workflow_ref: <organization>/<repository>/...), up to the
 * first "/".
 */
function readOrganization(value: string): string {
  const text: string = value.trim();
  const colon: number = text.indexOf(":");
  const rest: string = colon >= 0 ? text.slice(colon + 1) : text;
  const end: number = rest.search(colon >= 0 ? /[/:]/ : /\//);

  return end >= 0 ? rest.slice(0, end) : rest;
}

/*
 * Whether a value a claim is held to lets in more than its owner's: under
 * StringLike, wildcards alone - for a shared provider, also one whose
 * organization has a wildcard, or, for a claim that names one whole, any
 * wildcard. A value of your own provider's aud that is AWS STS's own
 * audience holds nobody out. StringEquals reads "*" as itself.
 */
function isLooseValue(data: {
  value: string;
  isLike: boolean;
  claim: string;
  isShared: boolean;
}): boolean {
  const value: string = data.value.trim();
  const claim: string = data.claim.toLowerCase();

  if (!data.isShared && claim === "aud" && value === AWS_STS_AUDIENCE) {
    return true;
  }

  if (!data.isLike) {
    return false;
  }

  if (isOnlyWildcards(value)) {
    return true;
  }

  if (!data.isShared) {
    return false;
  }

  if (WHOLE_ORGANIZATION_CLAIMS.includes(claim)) {
    return WILDCARD.test(value);
  }

  const organization: string = readOrganization(value);

  return !organization || WILDCARD.test(organization);
}

// A condition operator as IAM reads it: case aside, its ForAnyValue: or ForAllValues: and its IfExists put aside.
function readOperator(operator: string): string {
  return operator
    .trim()
    .toLowerCase()
    .replace(/^for(anyvalue|allvalues):/, "")
    .replace(/ifexists$/, "");
}

/*
 * The values a statement holds one claim to, or null when it holds it to
 * none: one holding operator whose values each hold it is enough, the
 * statement's conditions all being met at once.
 */
function readHeldValues(
  condition: JSONValue | undefined,
  data: { key: string; claim: string; isShared: boolean },
): Array<string> | null {
  if (!isObject(condition)) {
    return null;
  }

  let held: Array<string> | null = null;

  for (const operator of Object.keys(condition)) {
    const read: string = readOperator(operator);
    const keys: JSONValue | undefined = condition[operator];

    if (!HOLDING_OPERATORS.includes(read) || !isObject(keys)) {
      continue;
    }

    for (const key of Object.keys(keys)) {
      if (key.trim().toLowerCase() !== data.key) {
        continue;
      }

      const values: Array<string> = asStrings(keys[key]);
      const isHolding: boolean =
        values.length > 0 &&
        !values.some((value: string): boolean => {
          return isLooseValue({
            value,
            isLike: read === "stringlike",
            claim: data.claim,
            isShared: data.isShared,
          });
        });

      if (isHolding) {
        held = [...(held || []), ...values];
      }
    }
  }

  return held;
}

// How far one statement lets a provider's tokens in: held by its first claim held, else open.
function readProviderReach(data: {
  principal: string;
  read: { kind: AwsIdentityProviderKind; name: string; url: string };
  condition: JSONValue | undefined;
}): AwsTrustedIdentityProvider {
  const { read } = data;
  const base: Pick<AwsTrustedIdentityProvider, "principal" | "name" | "kind"> =
    { principal: data.principal, name: read.name, kind: read.kind };

  if (read.kind === AwsIdentityProviderKind.Saml) {
    return {
      ...base,
      reach: AwsIdentityProviderReach.SignedIn,
      claim: "",
      values: [],
    };
  }

  const shared: ReadonlyArray<string> | undefined =
    AWS_SHARED_IDENTITY_PROVIDERS[read.url];
  const claims: ReadonlyArray<string> = shared || OWN_PROVIDER_CLAIMS;

  for (const claim of claims) {
    const values: Array<string> | null = readHeldValues(data.condition, {
      key: (claim.includes(":") ? claim : `${read.url}:${claim}`).toLowerCase(),
      claim,
      isShared: Boolean(shared),
    });

    if (values) {
      return {
        ...base,
        reach: AwsIdentityProviderReach.Limited,
        claim,
        values: Array.from(new Set(values)),
      };
    }
  }

  return {
    ...base,
    reach: shared
      ? AwsIdentityProviderReach.AnyOrganization
      : AwsIdentityProviderReach.Anyone,
    claim: claims[0]!,
    values: [],
  };
}

/*
 * One provider however a trust policy names it - its ARN, or a built-in
 * one's host, case aside - for two policies to be compared by.
 */
export function getAwsIdentityProviderId(
  provider: Pick<AwsTrustedIdentityProvider, "kind" | "name">,
): string {
  return `${provider.kind}:${provider.name.toLowerCase()}`;
}

/*
 * One provider named by two statements: as far as the looser lets it in -
 * each statement is a way in of its own - or, both held, to every value
 * either names under the first's claim.
 */
function loosestReach(
  left: AwsTrustedIdentityProvider,
  right: AwsTrustedIdentityProvider,
): AwsTrustedIdentityProvider {
  if (right.reach !== AwsIdentityProviderReach.Limited) {
    return left.reach === AwsIdentityProviderReach.Limited ? right : left;
  }

  if (left.reach !== AwsIdentityProviderReach.Limited) {
    return left;
  }

  return left.claim === right.claim
    ? {
        ...left,
        values: Array.from(new Set([...left.values, ...right.values])),
      }
    : left;
}

/*
 * The identity providers an Allow statement of a trust policy names, each
 * once, in the policy's order, with how far each lets people in.
 */
export function getAwsTrustedIdentityProviders(
  policy: JSONObject,
): Array<AwsTrustedIdentityProvider> {
  const providers: Map<string, AwsTrustedIdentityProvider> = new Map();

  for (const statement of statementsOf(policy)) {
    if (String(statement["Effect"] || "").toLowerCase() !== "allow") {
      continue;
    }

    const principal: JSONValue | undefined = statement["Principal"];
    const federated: Array<string> = isObject(principal)
      ? asStrings(principal["Federated"])
      : [];

    for (const named of federated) {
      if (!named) {
        continue;
      }

      const read: { kind: AwsIdentityProviderKind; name: string; url: string } =
        readAwsFederatedPrincipal(named);
      const id: string = getAwsIdentityProviderId(read);
      const found: AwsTrustedIdentityProvider = readProviderReach({
        principal: named,
        read,
        condition: statement["Condition"],
      });
      const known: AwsTrustedIdentityProvider | undefined = providers.get(id);

      providers.set(id, known ? loosestReach(known, found) : found);
    }
  }

  return Array.from(providers.values());
}

/*
 * Whether a provider lets in anyone: every organization's tokens, or every
 * token of a provider of your own - what the step marks as open (#11378).
 */
export function isAwsIdentityProviderOpen(
  provider: Pick<AwsTrustedIdentityProvider, "reach">,
): boolean {
  return (
    provider.reach === AwsIdentityProviderReach.AnyOrganization ||
    provider.reach === AwsIdentityProviderReach.Anyone
  );
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
