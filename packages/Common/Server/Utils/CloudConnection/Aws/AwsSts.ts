import crypto from "crypto";
import { AWS_ROLE_WITHOUT_EXTERNAL_ID_REFUSAL } from "../../../../Types/CloudConnection/AwsRoleExternalIdRefusal";
import {
  AwsRoleSignInWords,
  CLOUD_CONNECT_ROLE_SIGN_IN_WORDS,
} from "../../../../Types/CloudConnection/AwsRoleSignInFailures";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import {
  AWS_EXTERNAL_ID_DIGITS,
  formatAwsExternalId,
  getAwsExternalIdConditionText,
  getAwsExternalIdForProject,
} from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { getAwsSesExternalIdForProject } from "../../../../Types/Email/AmazonSesRoleExternalId";
import {
  AMAZON_SES_ROLE_SIGN_IN_WORDS,
  AMAZON_SES_ROLE_WITHOUT_EXTERNAL_ID,
} from "../../../../Types/Email/AmazonSesRoleWords";
import { getRefusalText } from "../../../../Types/Exception/RefusalWithValues";
import GlobalCache from "../../../Infrastructure/GlobalCache";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import logger from "../../Logger";
import {
  CloudConnectorTransport,
  CloudReadBudget,
} from "../CloudConnectorTypes";
import {
  AwsCredentials,
  AwsPartition,
  awsErrorCodeOf,
  getAwsPartition,
  readXmlTag,
  sendAwsRequest,
} from "./AwsApi";

/*
 * AWS Security Token Service, the two calls a connection makes, over STS's
 * query protocol (XML answers):
 *
 *   GetCallerIdentity -> <Account>, <Arn>      who the credential is; it
 *                                              needs no permission at all
 *   AssumeRole        -> <Credentials>         an hour of temporary
 *       RoleArn, RoleSessionName, ExternalId,  credentials for a customer's
 *       DurationSeconds                        role
 *
 * Calls go to the Regional endpoint of the partition the connection reads
 * (sts.us-east-1.amazonaws.com, sts.us-gov-west-1..., sts.cn-north-1...).
 *
 * THE ONE WAY INTO A CUSTOMER'S ROLE (#10405). OneUptime signs in to a role
 * with the project's external id, but AWS holds it to that id only when
 * the role's trust policy has the sts:ExternalId condition. A role made by
 * hand without it lets OneUptime in for any project that knows its ARN:
 * another customer's role, or one in the account of OneUptime's own
 * identity, read - or, with Data Security Response, changed - by a project
 * that is not its own (the "confused deputy"). So a role is signed in to
 * once with an external id no project has before it is used
 * (probeRoleExternalId): AWS refusing that is the pass, and AWS taking it
 * means the role takes any id. It is refused, and the session AWS handed
 * out is dropped unread. assumeRole is the only call here that signs in to
 * a role, and it checks first; AssumedRoleCache hands a session out only
 * while the check that let it be made holds. AwsRoleSignInGuard.test.ts
 * holds every sign-in to this file.
 *
 * What a check found - its verdict - is kept per project, connection and
 * role ARN (AssumedRoleCache.keyOf): no project's verdict ever stands for
 * another's, and one role ARN connected by two projects is checked for
 * each. It is kept for every OneUptime server (AwsRoleCheckCache, in the
 * shared cache, #10424), so a connection is checked once, not once by each
 * app and worker that reads it:
 *
 *   - A pass holds a day from when the role was checked, so the customer's
 *     CloudTrail shows about one AccessDenied a day per connection, not one
 *     per read or per server, and a trust policy that loses the condition
 *     is caught on the next day's check. It is kept only once the sign-in
 *     it allowed worked: a role that let nobody in when it was checked is
 *     checked again before anyone is let in.
 *   - A refusal holds an hour: a role that takes any id is not signed in
 *     to on every read.
 *   - A check AWS throttled or did not answer, or answered with anything
 *     but AccessDenied, is no pass: nothing is kept, and the next try
 *     checks again.
 *   - A test (noCache) checks afresh, whatever was kept. A test of a saved
 *     connection keeps what it found for that connection's reads on every
 *     server (keepsVerdict): once a fixed role passes a test, every read
 *     uses it at once, and a role found taking any id is read no more. A
 *     test of settings never saved keeps nothing.
 *   - When the shared cache cannot be reached, a server keeps to what its
 *     own last check found, or checks afresh: never to a pass it did not
 *     find. A value read back that is not a verdict of this file's writing
 *     is none, and the role is checked again.
 *   - A refusal a server found stands for it until a check made after it
 *     passes: neither a write of it that did not reach the shared cache,
 *     nor a pass of an older check written there after it, lets that
 *     server use a role it found taking any id.
 *
 * The probe is not Cloud Connect's alone: anything that signs in to a
 * customer's role with OneUptime's identity says what for (AwsRolePurpose)
 * and is checked the same way. A project's Amazon SES role (#7378) signs in
 * with its config's id and a purpose of its own, which picks the external
 * id (email's, from a label of its own: a role made for a project's email
 * cannot be read through by its Cloud Connect connections, nor the other
 * way round), the words a failure is said in, and a key space of its own
 * for the verdicts and sessions: a Cloud Connect verdict never stands for
 * an email one, or the other way round.
 */

const STS_SERVICE: string = "sts";
const STS_VERSION: string = "2011-06-15";
const PROVIDER_TITLE: string = "AWS";

// A session lasts an hour; it is reused until five minutes before that.
export const ASSUMED_ROLE_SESSION_SECONDS: number = 3600;
const SESSION_REUSE_MARGIN_MS: number = 5 * 60 * 1000;

/*
 * The check's session, should AWS hand one out: the shortest AWS gives,
 * and allowed nothing by its session policy, which can only take
 * permissions away from the role's.
 */
export const ROLE_CHECK_SESSION_SECONDS: number = 900;
export const ROLE_CHECK_SESSION_POLICY: string = JSON.stringify({
  Version: "2012-10-17",
  Statement: [{ Effect: "Deny", Action: "*", Resource: "*" }],
});

// How long a check holds: a pass a day, a refusal an hour.
export const ROLE_CHECK_PASS_MS: number = 24 * 60 * 60 * 1000;
export const ROLE_CHECK_REFUSAL_MS: number = 60 * 60 * 1000;

// What AWS answers a sign-in the role's trust policy does not allow.
const TRUST_REFUSAL_CODE: string = "AccessDenied";

export const STS_HOME_REGIONS: Record<AwsPartition, string> = {
  aws: "us-east-1",
  "aws-us-gov": "us-gov-west-1",
  "aws-cn": "cn-north-1",
};

export interface AwsCallerIdentity {
  account: string;
  arn: string;
}

export interface AwsAssumedRole {
  credentials: AwsCredentials;
  expiresAtMs: number;
}

/*
 * What a role's check found: it holds OneUptime to the project's external
 * id, or it let OneUptime in with an id no project has.
 */
export type AwsRoleCheckVerdict =
  | "requires-external-id"
  | "takes-any-external-id";

/*
 * WHAT A SIGN-IN TO A CUSTOMER'S ROLE IS FOR. Every caller of assumeRole
 * names one, and it picks:
 *
 *   - the external id the role is signed in to with, derived here from
 *     the project's own id with the purpose's own label - never one a
 *     request names (getRolePurposeExternalId);
 *   - what the project is told when the role lets any id in, or when the
 *     check or the sign-in fails, in the purpose's words;
 *   - where its verdicts and sessions are kept: each purpose a key space
 *     of its own (AssumedRoleCache.keyOf), so a verdict of one purpose
 *     never stands for another's, even for the same project and role.
 */
export enum AwsRolePurpose {
  // Cloud Connect: a connection's reads and test, Data Security's reads and responses.
  CloudConnect = "cloud-connect",
  // A project's Amazon SES config that signs in with a role in its own account (#7378).
  AmazonSes = "amazon-ses",
}

interface AwsRolePurposeRules {
  // The project's own external id for this purpose.
  getExternalId: (projectId: string) => string;
  // What the project is told of a role that lets OneUptime in with any id.
  getRoleWithoutExternalIdMessage: (projectId: string) => string;
  // What it is told when the check or the sign-in fails.
  words: AwsRoleSignInWords;
  /*
   * Before every key of the purpose's verdicts and sessions. Cloud
   * Connect's keys are as they were before there were purposes, so the
   * verdicts every server keeps for them hold across an upgrade.
   */
  keyPrefix: string;
  // How the server's log names the purpose.
  logLabel: string;
  // What the id beside the project is, in the server's log.
  recordLabel: string;
}

const ROLE_PURPOSES: Record<AwsRolePurpose, AwsRolePurposeRules> = {
  [AwsRolePurpose.CloudConnect]: {
    getExternalId: (projectId: string): string => {
      return getAwsExternalIdForProject(projectId);
    },
    getRoleWithoutExternalIdMessage: (projectId: string): string => {
      return getRoleWithoutExternalIdMessage(projectId);
    },
    words: CLOUD_CONNECT_ROLE_SIGN_IN_WORDS,
    keyPrefix: "",
    logLabel: "Cloud connections",
    recordLabel: "connection",
  },
  [AwsRolePurpose.AmazonSes]: {
    getExternalId: (projectId: string): string => {
      return getAwsSesExternalIdForProject(projectId);
    },
    getRoleWithoutExternalIdMessage: (): string => {
      return AMAZON_SES_ROLE_WITHOUT_EXTERNAL_ID;
    },
    words: AMAZON_SES_ROLE_SIGN_IN_WORDS,
    keyPrefix: "amazon-ses|",
    logLabel: "Amazon SES",
    recordLabel: "SMTP config",
  },
};

/*
 * The external id a project's role of a purpose trusts OneUptime with:
 * always the project's own, derived from its id alone, and never the same
 * for two purposes.
 */
export function getRolePurposeExternalId(
  purpose: AwsRolePurpose,
  projectId: string,
): string {
  return ROLE_PURPOSES[purpose].getExternalId(projectId);
}

// The words a purpose's failures are said in.
export function getRolePurposeWords(
  purpose: AwsRolePurpose,
): AwsRoleSignInWords {
  return ROLE_PURPOSES[purpose].words;
}

// The STS Region for a connection: its first Region's partition home.
export function getStsRegion(regions: Array<string>): string {
  return STS_HOME_REGIONS[getAwsPartition(regions[0] || "us-east-1")];
}

export async function getCallerIdentity(data: {
  transport: CloudConnectorTransport;
  credentials: AwsCredentials;
  region: string;
  now?: (() => Date) | undefined;
  timeoutInMs?: number | undefined;
  budget?: CloudReadBudget | undefined;
}): Promise<AwsCallerIdentity> {
  const answer: { text: string } = await sendAwsRequest({
    transport: data.transport,
    credentials: data.credentials,
    service: STS_SERVICE,
    region: data.region,
    body: { Action: "GetCallerIdentity", Version: STS_VERSION },
    step: "sign-in check",
    providerTitle: PROVIDER_TITLE,
    now: data.now,
    timeoutInMs: data.timeoutInMs,
    budget: data.budget,
  });

  const account: string = readXmlTag(answer.text, "Account");

  if (!account) {
    throw new LlmProviderError({
      message: "AWS did not say which account the credential belongs to.",
      kind: CloudConnectionFailureKind.Other,
    });
  }

  return { account, arn: readXmlTag(answer.text, "Arn") };
}

// Anything but a letter or a digit: one class, no repeat.
const NOT_ALPHANUMERIC_REGEX: RegExp = /[^A-Za-z0-9]/g;

/*
 * The session name AWS records in CloudTrail for every call the role
 * makes, so the customer can see which connection read what.
 */
export function getRoleSessionName(connectionId: string): string {
  const id: string = (connectionId || "test").replace(
    NOT_ALPHANUMERIC_REGEX,
    "",
  );

  return `OneUptime-${id}`.slice(0, 64);
}

/*
 * An external id no project has, written as every project's is
 * (formatAwsExternalId): a trust policy that lets in any id of that shape
 * lets this one in too, and so is caught.
 */
export function getRoleCheckExternalId(): string {
  return formatAwsExternalId(
    crypto.randomBytes(AWS_EXTERNAL_ID_DIGITS / 2).toString("hex"),
  );
}

/*
 * What a project is told of a role that lets OneUptime in with any
 * external id: what that lets happen, and the condition to add, written
 * as the trust policy of the setup command has it. In English, as every
 * refusal is sent; the Dashboard says it in its reader's language
 * (AwsRoleExternalIdRefusal, #10425).
 */
export function getRoleWithoutExternalIdMessage(projectId: string): string {
  return getRefusalText(AWS_ROLE_WITHOUT_EXTERNAL_ID_REFUSAL, {
    condition: getAwsExternalIdConditionText(
      getAwsExternalIdForProject(projectId),
    ),
  });
}

function roleWithoutExternalId(
  purpose: AwsRolePurpose,
  projectId: string,
): LlmProviderError {
  return new LlmProviderError({
    message: ROLE_PURPOSES[purpose].getRoleWithoutExternalIdMessage(projectId),
    kind: CloudConnectionFailureKind.Settings,
  });
}

/*
 * One sts:AssumeRole, signed with OneUptime's own credential: the answer's
 * text (the session, unread), or the failure as AWS gave it. Never called
 * but through assumeRole and the check it makes first.
 */
async function requestRoleSession(data: {
  transport: CloudConnectorTransport;
  credentials: AwsCredentials;
  roleArn: string;
  roleSessionName: string;
  externalId: string;
  durationSeconds: number;
  // A session policy: it can only take permissions away from the role's.
  policy?: string | undefined;
  region: string;
  step: string;
  now?: (() => Date) | undefined;
  timeoutInMs?: number | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  budget?: CloudReadBudget | undefined;
}): Promise<string> {
  const answer: { text: string } = await sendAwsRequest({
    transport: data.transport,
    credentials: data.credentials,
    service: STS_SERVICE,
    region: data.region,
    body: {
      Action: "AssumeRole",
      Version: STS_VERSION,
      RoleArn: data.roleArn,
      RoleSessionName: data.roleSessionName,
      ExternalId: data.externalId,
      DurationSeconds: String(data.durationSeconds),
      ...(data.policy ? { Policy: data.policy } : {}),
    },
    step: data.step,
    providerTitle: PROVIDER_TITLE,
    now: data.now,
    timeoutInMs: data.timeoutInMs,
    sleep: data.sleep,
    budget: data.budget,
    // A sign-in hands out a session and changes nothing: asked again as a read is.
    isSafeToRepeat: true,
  });

  return answer.text;
}

/*
 * A sign-in or a check that failed, in OneUptime's words - its purpose's
 * (AwsRoleSignInWords), each a key of the Dashboard's locales, so the
 * reader gets it in their language (#10474). AWS's own answer to
 * OneUptime's identity names that identity ("User: arn:aws:iam::... is not
 * authorized to perform: sts:AssumeRole"), so it goes to the server's log
 * and never to the project. The kind, status and body stay on the error
 * for the caller: a credential of the server's that AWS no longer takes is
 * fetched again (AwsServerIdentity.refusedBy).
 */
function describeRoleFailure(data: {
  error: unknown;
  roleArn: string;
  step: "check" | "sign-in";
  purpose: AwsRolePurpose;
}): unknown {
  // The read's budget spent, and anything else that is not AWS's answer: as it is.
  if (!(data.error instanceof LlmProviderError)) {
    return data.error;
  }

  const error: LlmProviderError = data.error;
  const isCheck: boolean = data.step === "check";
  const rules: AwsRolePurposeRules = ROLE_PURPOSES[data.purpose];
  const words: AwsRoleSignInWords = rules.words;
  let kind: CloudConnectionFailureKind = error.kind;
  let message: string;

  switch (error.kind) {
    case CloudConnectionFailureKind.RateLimited:
      message = isCheck ? words.checkRateLimited : words.signInRateLimited;
      break;
    case CloudConnectionFailureKind.Unavailable:
      message = isCheck ? words.checkUnanswered : words.signInUnanswered;
      break;
    case CloudConnectionFailureKind.Authentication:
      // OneUptime's own credential, not the role: nothing the project can change.
      kind = CloudConnectionFailureKind.Unavailable;
      message = words.serverCredentialsRefused;
      break;
    case CloudConnectionFailureKind.Permission:
      message = isCheck ? words.checkFailed : words.signInNotPermitted;
      break;
    default:
      message = isCheck ? words.checkFailed : words.signInRefused;
  }

  const logged: string = `${rules.logLabel}: ${
    isCheck
      ? `could not check that role ${data.roleArn} requires its project's external id, so it was not signed in to`
      : `could not sign in to role ${data.roleArn}`
  }. ${error.message}`;

  // A role that does not trust OneUptime is the customer's setup, said to them; anything else is the server's to look at.
  if (
    !isCheck &&
    awsErrorCodeOf(error.responseBody || "") === TRUST_REFUSAL_CODE
  ) {
    logger.debug(logged);
  } else {
    logger.warn(logged);
  }

  return new LlmProviderError({
    message,
    kind,
    statusCode: error.statusCode,
    retryAfterSeconds: error.retryAfterSeconds,
    responseBody: error.responseBody,
  });
}

/*
 * Whether a role holds OneUptime to the project's external id: one
 * sts:AssumeRole as the sign-in asks it - the same role, session name,
 * Region and OneUptime identity - but with an external id no project has,
 * for the shortest session, under a session policy that allows nothing.
 * AccessDenied is the pass. A session AWS hands out is dropped unread.
 * Anything else - throttled, unanswered, refused for another reason - is
 * no verdict at all, and throws.
 */
export async function probeRoleExternalId(data: {
  transport: CloudConnectorTransport;
  // OneUptime's own credential, never the customer's.
  credentials: AwsCredentials;
  roleArn: string;
  roleSessionName: string;
  region: string;
  // Whose words a failure is said in: Cloud Connect's when left out.
  purpose?: AwsRolePurpose | undefined;
  now?: (() => Date) | undefined;
  timeoutInMs?: number | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  budget?: CloudReadBudget | undefined;
}): Promise<AwsRoleCheckVerdict> {
  const roleArn: string = data.roleArn.trim();

  try {
    await requestRoleSession({
      transport: data.transport,
      credentials: data.credentials,
      roleArn,
      roleSessionName: data.roleSessionName,
      externalId: getRoleCheckExternalId(),
      durationSeconds: ROLE_CHECK_SESSION_SECONDS,
      policy: ROLE_CHECK_SESSION_POLICY,
      region: data.region,
      step: "role check",
      now: data.now,
      timeoutInMs: data.timeoutInMs,
      sleep: data.sleep,
      budget: data.budget,
    });
  } catch (error) {
    if (
      error instanceof LlmProviderError &&
      awsErrorCodeOf(error.responseBody || "") === TRUST_REFUSAL_CODE
    ) {
      return "requires-external-id";
    }

    throw describeRoleFailure({
      error,
      roleArn,
      step: "check",
      purpose: data.purpose || AwsRolePurpose.CloudConnect,
    });
  }

  return "takes-any-external-id";
}

// A check's verdict as it is kept: what it found, and when the role was checked.
interface KeptRoleCheck {
  verdict: AwsRoleCheckVerdict;
  checkedAtMs: number;
}

const ROLE_CHECK_VERDICTS: ReadonlyArray<AwsRoleCheckVerdict> = [
  "requires-external-id",
  "takes-any-external-id",
];

/*
 * Where every server keeps the verdicts, in the shared cache. Named here
 * alone and never exported: AwsRoleSignInGuard holds every write of a
 * verdict to AwsRoleCheckCache.set.
 */
const ROLE_CHECK_CACHE_NAMESPACE: string = "cloud-aws-role-check";

// How long a verdict holds from its check: a pass a day, a refusal an hour.
function getRoleCheckLifetimeMs(verdict: AwsRoleCheckVerdict): number {
  return verdict === "requires-external-id"
    ? ROLE_CHECK_PASS_MS
    : ROLE_CHECK_REFUSAL_MS;
}

// Whether a kept check holds now. A clock that went back is no reason to trust an old check longer.
function holdsNow(kept: KeptRoleCheck, nowMs: number): boolean {
  const ageMs: number = nowMs - kept.checkedAtMs;

  return ageMs >= 0 && ageMs < getRoleCheckLifetimeMs(kept.verdict);
}

/*
 * A verdict as the shared cache gave it back: one of the two verdicts,
 * with the time of its check, that holds now. Anything else - a value cut
 * short, another shape, a verdict this file does not write, a time that is
 * not one - is no verdict at all, and the role is checked again.
 */
function readKeptRoleCheck(
  value: string | null,
  nowMs: number,
): KeptRoleCheck | null {
  if (!value) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const verdict: unknown = (parsed as Record<string, unknown>)["verdict"];
  const checkedAtMs: unknown = (parsed as Record<string, unknown>)[
    "checkedAtMs"
  ];

  if (
    !ROLE_CHECK_VERDICTS.includes(verdict as AwsRoleCheckVerdict) ||
    typeof checkedAtMs !== "number" ||
    !Number.isSafeInteger(checkedAtMs) ||
    checkedAtMs <= 0
  ) {
    return null;
  }

  const kept: KeptRoleCheck = {
    verdict: verdict as AwsRoleCheckVerdict,
    checkedAtMs,
  };

  return holdsNow(kept, nowMs) ? kept : null;
}

function describeCacheError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/*
 * The last check of each connection's role (AssumedRoleCache.keyOf), while
 * it holds: a pass ROLE_CHECK_PASS_MS from when the role was checked, a
 * refusal ROLE_CHECK_REFUSAL_MS.
 *
 * Kept in the shared cache (GlobalCache), for every server, and read back
 * from it while it can be reached: whichever server checked a connection's
 * role last, and a test of it, decides for all (#10424). Each server also
 * keeps the verdicts of its own checks: what it keeps to when the shared
 * cache cannot be reached, and a refusal of its own that stands over an
 * older pass the shared cache gives back. A verdict it only read is never
 * one of them, so an outage hands no server a pass it did not find.
 */
export class AwsRoleCheckCache {
  // This server's own checks: what it keeps to while the shared cache is down.
  private static ownVerdicts: Map<string, KeptRoleCheck> = new Map();

  // Whether a check is a refusal this server found, that holds now.
  private static isOwnRefusal(
    own: KeptRoleCheck | undefined,
  ): own is KeptRoleCheck {
    return own?.verdict === "takes-any-external-id";
  }

  public static async get(
    key: string,
  ): Promise<AwsRoleCheckVerdict | undefined> {
    let shared: string | null;

    try {
      shared = await GlobalCache.getString(ROLE_CHECK_CACHE_NAMESPACE, key);
    } catch (error) {
      logger.debug(
        `Cloud connections: the shared cache could not be reached, so this server keeps to its own last check of role ${key} (${describeCacheError(
          error,
        )}).`,
      );

      return this.getOwn(key)?.verdict;
    }

    const kept: KeptRoleCheck | null = readKeptRoleCheck(shared, Date.now());
    const own: KeptRoleCheck | undefined = this.getOwn(key);

    /*
     * A refusal this server found stands until a check made after it
     * passed: its write may not have reached the shared cache, or a pass of
     * an older check may have been written there after it.
     */
    if (
      this.isOwnRefusal(own) &&
      (!kept || kept.checkedAtMs <= own.checkedAtMs)
    ) {
      return own.verdict;
    }

    // Otherwise the shared cache's verdict is the one: none is none.
    return kept?.verdict;
  }

  public static async set(
    key: string,
    verdict: AwsRoleCheckVerdict,
    checkedAtMs: number,
  ): Promise<void> {
    const kept: KeptRoleCheck = { verdict, checkedAtMs };

    // A bound: one entry per connection, and connections are few.
    if (this.ownVerdicts.size > 10000 && !this.ownVerdicts.has(key)) {
      this.ownVerdicts.clear();
    }

    this.ownVerdicts.set(key, kept);

    // Kept for every server as long as it holds from its check, and no longer.
    const lifetimeMs: number = getRoleCheckLifetimeMs(verdict);
    const leftMs: number = Math.min(
      lifetimeMs,
      lifetimeMs - (Date.now() - checkedAtMs),
    );

    try {
      await GlobalCache.setString(
        ROLE_CHECK_CACHE_NAMESPACE,
        key,
        JSON.stringify(kept),
        { expiresInSeconds: Math.max(1, Math.ceil(leftMs / 1000)) },
      );
    } catch (error) {
      logger.debug(
        `Cloud connections: the shared cache could not be reached, so the check of role ${key} is kept by this server alone (${describeCacheError(
          error,
        )}).`,
      );
    }
  }

  // This server's own checks, forgotten (tests). The shared cache's expire on their own.
  public static clear(): void {
    this.ownVerdicts.clear();
  }

  // This server's own last check of a key, while it holds.
  private static getOwn(key: string): KeptRoleCheck | undefined {
    const kept: KeptRoleCheck | undefined = this.ownVerdicts.get(key);

    if (!kept) {
      return undefined;
    }

    if (!holdsNow(kept, Date.now())) {
      this.ownVerdicts.delete(key);
      return undefined;
    }

    return kept;
  }
}

/*
 * A customer's role, signed in to with OneUptime's identity and this
 * project's external id for the purpose - always the project's own, never
 * one a request names (getRolePurposeExternalId) - once the role is known
 * to require it: checked first (probeRoleExternalId) unless a check of
 * this connection's role still holds (AwsRoleCheckCache), and refused with
 * the condition to add when it lets any id in. Every way into a customer's
 * AWS account - a test, every read (metrics, inventory, changes and
 * health, costs and savings), a live read, Data Security's reads and its
 * responses - signs in here, through AwsCloudConnector.getCredentials; a
 * project's Amazon SES role through AmazonSesProjectRole.
 */
export async function assumeRole(data: {
  // What the sign-in is for: the external id, the words, the key space.
  purpose: AwsRolePurpose;
  transport: CloudConnectorTransport;
  // OneUptime's own credential, never the customer's.
  credentials: AwsCredentials;
  roleArn: string;
  projectId: string;
  // The connection's id - for Amazon SES, the SMTP config's.
  connectionId: string;
  region: string;
  now?: (() => Date) | undefined;
  timeoutInMs?: number | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  budget?: CloudReadBudget | undefined;
  // A test checks afresh, whatever was kept, and keeps nothing...
  noCache?: boolean | undefined;
  /*
   * ...but a test of a saved connection (its own connectionId) keeps what
   * it found, for that connection's reads on every server: once a fixed
   * role passes a test, every read uses it at once (#10424). Only what the
   * check found is kept - a pass once the sign-in it allowed worked.
   */
  keepsVerdict?: boolean | undefined;
}): Promise<AwsAssumedRole> {
  const roleArn: string = data.roleArn.trim();
  const rules: AwsRolePurposeRules = ROLE_PURPOSES[data.purpose];
  const key: string = AssumedRoleCache.keyOf(data);
  const roleSessionName: string = getRoleSessionName(data.connectionId);
  const keeps: boolean = !data.noCache || data.keepsVerdict === true;
  const kept: AwsRoleCheckVerdict | undefined = data.noCache
    ? undefined
    : await AwsRoleCheckCache.get(key);
  // When this sign-in checked the role itself: kept as a pass once it works.
  let checkedAtMs: number | null = null;

  if (kept === "takes-any-external-id") {
    throw roleWithoutExternalId(data.purpose, data.projectId);
  }

  if (kept !== "requires-external-id") {
    checkedAtMs = Date.now();

    const verdict: AwsRoleCheckVerdict = await probeRoleExternalId({
      transport: data.transport,
      credentials: data.credentials,
      roleArn,
      roleSessionName,
      region: data.region,
      purpose: data.purpose,
      now: data.now,
      timeoutInMs: data.timeoutInMs,
      sleep: data.sleep,
      budget: data.budget,
    });

    if (verdict === "takes-any-external-id") {
      logger.warn(
        `${rules.logLabel}: role ${roleArn} (project ${data.projectId}, ${rules.recordLabel} ${data.connectionId}) let this OneUptime sign in with an external id no project has, so it is not used: its trust policy needs the sts:ExternalId condition. The session AWS handed out was dropped unread.`,
      );

      if (keeps) {
        await AwsRoleCheckCache.set(key, verdict, checkedAtMs);
      }

      throw roleWithoutExternalId(data.purpose, data.projectId);
    }
  }

  let text: string;

  try {
    text = await requestRoleSession({
      transport: data.transport,
      credentials: data.credentials,
      roleArn,
      roleSessionName,
      // Always this project's own, for this purpose: never one a request names.
      externalId: getRolePurposeExternalId(data.purpose, data.projectId),
      durationSeconds: ASSUMED_ROLE_SESSION_SECONDS,
      region: data.region,
      step: "role sign-in",
      now: data.now,
      timeoutInMs: data.timeoutInMs,
      sleep: data.sleep,
      budget: data.budget,
    });
  } catch (error) {
    throw describeRoleFailure({
      error,
      roleArn,
      step: "sign-in",
      purpose: data.purpose,
    });
  }

  const accessKeyId: string = readXmlTag(text, "AccessKeyId");
  const secretAccessKey: string = readXmlTag(text, "SecretAccessKey");
  const sessionToken: string = readXmlTag(text, "SessionToken");
  const expiration: number = Date.parse(readXmlTag(text, "Expiration"));

  if (!accessKeyId || !secretAccessKey || !sessionToken) {
    throw new LlmProviderError({
      message: rules.words.noCredentialsReturned,
      kind: CloudConnectionFailureKind.Other,
    });
  }

  // A test's pass replaces a refusal kept for the key: every server reads through the role from now.
  if (checkedAtMs !== null && keeps) {
    await AwsRoleCheckCache.set(key, "requires-external-id", checkedAtMs);
  }

  return {
    credentials: { accessKeyId, secretAccessKey, sessionToken },
    expiresAtMs: Number.isFinite(expiration)
      ? expiration
      : Date.now() + ASSUMED_ROLE_SESSION_SECONDS * 1000,
  };
}

/*
 * Assumed roles, per connection and role, reused until shortly before
 * they expire: a read every few minutes signs in once an hour, not on
 * every read. A session is handed out only while a pass of its role's
 * check holds (AwsRoleCheckCache, for every server): a day after the
 * check, the role is checked again before its next session, and a role a
 * test found taking any id is read through no more, by any server. The
 * sessions themselves are kept in this process only.
 */
export class AssumedRoleCache {
  private static sessions: Map<string, AwsAssumedRole> = new Map();

  /*
   * A role's key, per purpose, project, connection (or SMTP config) and
   * role ARN: Cloud Connect's when no purpose is named, as it was before
   * there were purposes. Another purpose's keys start with its own prefix,
   * which no project id does, so no key of one purpose is another's.
   */
  public static keyOf(data: {
    purpose?: AwsRolePurpose | undefined;
    projectId: string;
    connectionId: string;
    roleArn: string;
  }): string {
    const prefix: string =
      ROLE_PURPOSES[data.purpose || AwsRolePurpose.CloudConnect].keyPrefix;

    return `${prefix}${data.projectId}|${data.connectionId}|${data.roleArn.trim()}`;
  }

  /*
   * A session dropped before it expires: one AWS no longer takes (a
   * service answered ExpiredToken or an unknown token for it), so the next
   * call signs in again. Its role's check stands.
   */
  public static forget(key: string, session?: AwsCredentials): void {
    const kept: AwsAssumedRole | undefined = this.sessions.get(key);

    // Not one a sign-in made meanwhile.
    if (
      kept &&
      (!session || kept.credentials.accessKeyId === session.accessKeyId)
    ) {
      this.sessions.delete(key);
    }
  }

  public static async get(key: string): Promise<AwsCredentials | undefined> {
    const session: AwsAssumedRole | undefined = this.sessions.get(key);

    if (!session) {
      return undefined;
    }

    if (
      session.expiresAtMs - SESSION_REUSE_MARGIN_MS <= Date.now() ||
      (await AwsRoleCheckCache.get(key)) !== "requires-external-id"
    ) {
      // Not one a sign-in made meanwhile.
      if (this.sessions.get(key) === session) {
        this.sessions.delete(key);
      }

      return undefined;
    }

    return session.credentials;
  }

  public static set(key: string, session: AwsAssumedRole): void {
    // A bound: one entry per connection, and connections are few.
    if (this.sessions.size > 10000) {
      this.sessions.clear();
    }

    this.sessions.set(key, session);
  }

  // Both of this process's caches: the sessions, and its own checks.
  public static clear(): void {
    this.sessions.clear();
    AwsRoleCheckCache.clear();
  }
}
