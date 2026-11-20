import crypto from "crypto";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import {
  AWS_EXTERNAL_ID_DIGITS,
  formatAwsExternalId,
  getAwsExternalIdConditionText,
  getAwsExternalIdForProject,
} from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
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
 *   - A pass holds a day from when the role was checked, so the customer's
 *     CloudTrail shows one AccessDenied a day per OneUptime server, not one
 *     per read, and a trust policy that loses the condition is caught on
 *     the next day's check. It is kept only once the sign-in it allowed
 *     worked: a role that let nobody in when it was checked is checked
 *     again before anyone is let in.
 *   - A refusal holds an hour: a fixed trust policy is used within the
 *     hour, and a role that takes any id is not signed in to on every read.
 *   - A check AWS throttled or did not answer, or answered with anything
 *     but AccessDenied, is no pass: nothing is kept, and the next try
 *     checks again.
 *   - A test (noCache) checks afresh and keeps nothing.
 *
 * The probe is not Cloud Connect's alone: anything that signs in to a
 * customer's role with OneUptime's identity (a project's Amazon SES role,
 * #7378) calls assumeRole with its own connection id, and is checked the
 * same way.
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
 * as the trust policy of the setup command has it.
 */
export function getRoleWithoutExternalIdMessage(projectId: string): string {
  return `This role lets OneUptime sign in without your project's external ID, so any project that knows its ARN could read your AWS account through OneUptime. OneUptime does not use it until its trust policy requires the external ID: add ${getAwsExternalIdConditionText(
    getAwsExternalIdForProject(projectId),
  )} to the statement that trusts OneUptime, or run the setup command again and connect the role it prints.`;
}

function roleWithoutExternalId(projectId: string): LlmProviderError {
  return new LlmProviderError({
    message: getRoleWithoutExternalIdMessage(projectId),
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
 * A sign-in or a check that failed, in OneUptime's words. AWS's own answer
 * to OneUptime's identity names that identity ("User: arn:aws:iam::...
 * is not authorized to perform: sts:AssumeRole"), so it goes to the
 * server's log and never to the project. The kind, status and body stay on
 * the error for the caller: a credential of the server's that AWS no
 * longer takes is fetched again (AwsServerIdentity.refusedBy).
 */
function describeRoleFailure(data: {
  error: unknown;
  roleArn: string;
  step: "check" | "sign-in";
}): unknown {
  // The read's budget spent, and anything else that is not AWS's answer: as it is.
  if (!(data.error instanceof LlmProviderError)) {
    return data.error;
  }

  const error: LlmProviderError = data.error;
  const isCheck: boolean = data.step === "check";
  const doing: string = isCheck
    ? "checked that the role requires your project's external ID"
    : "signed in to the role";
  let kind: CloudConnectionFailureKind = error.kind;
  let message: string;

  switch (error.kind) {
    case CloudConnectionFailureKind.RateLimited:
      message = `AWS asked OneUptime to slow down while it ${doing}, so nothing was read through it. OneUptime tries again on the next read.`;
      break;
    case CloudConnectionFailureKind.Unavailable:
      message = `AWS did not answer while OneUptime ${doing}, so nothing was read through it. OneUptime tries again on the next read.`;
      break;
    case CloudConnectionFailureKind.Authentication:
      // OneUptime's own credential, not the role: nothing the project can change.
      kind = CloudConnectionFailureKind.Unavailable;
      message =
        "AWS did not take the credentials this OneUptime signs in to roles with, so it could not sign in to the role. That is not the role's setup: OneUptime tries again on the next read, and the server's log says why.";
      break;
    case CloudConnectionFailureKind.Permission:
      message = isCheck
        ? "OneUptime could not check that the role requires your project's external ID, so it does not sign in to it. Check that the role ARN is right, then test the connection again."
        : "OneUptime could not sign in to the role. Check that the role exists and trusts OneUptime with your project's external ID: run the setup command again.";
      break;
    default:
      message = isCheck
        ? "OneUptime could not check that the role requires your project's external ID, so it does not sign in to it. Check that the role ARN is right, then test the connection again."
        : "AWS did not let OneUptime sign in to the role. Check that the role ARN is right and that the role trusts OneUptime with your project's external ID: run the setup command again.";
  }

  const logged: string = `Cloud connections: ${
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

    throw describeRoleFailure({ error, roleArn, step: "check" });
  }

  return "takes-any-external-id";
}

/*
 * The last check of each connection's role (AssumedRoleCache.keyOf), while
 * it holds: a pass ROLE_CHECK_PASS_MS from when the role was checked, a
 * refusal ROLE_CHECK_REFUSAL_MS. In this process only.
 */
export class AwsRoleCheckCache {
  private static verdicts: Map<
    string,
    { verdict: AwsRoleCheckVerdict; checkedAtMs: number }
  > = new Map();

  public static get(key: string): AwsRoleCheckVerdict | undefined {
    const entry:
      | { verdict: AwsRoleCheckVerdict; checkedAtMs: number }
      | undefined = this.verdicts.get(key);

    if (!entry) {
      return undefined;
    }

    const holdsForMs: number =
      entry.verdict === "requires-external-id"
        ? ROLE_CHECK_PASS_MS
        : ROLE_CHECK_REFUSAL_MS;
    const ageMs: number = Date.now() - entry.checkedAtMs;

    // A clock that went back is no reason to trust an old check longer.
    if (ageMs < 0 || ageMs >= holdsForMs) {
      this.verdicts.delete(key);
      return undefined;
    }

    return entry.verdict;
  }

  public static set(
    key: string,
    verdict: AwsRoleCheckVerdict,
    checkedAtMs: number,
  ): void {
    // A bound: one entry per connection, and connections are few.
    if (this.verdicts.size > 10000) {
      this.verdicts.clear();
    }

    this.verdicts.set(key, { verdict, checkedAtMs });
  }

  public static clear(): void {
    this.verdicts.clear();
  }
}

/*
 * A customer's role, signed in to with OneUptime's identity and this
 * project's external id - always the project's own, never one a request
 * names - once the role is known to require it: checked first
 * (probeRoleExternalId) unless a check of this connection's role still
 * holds (AwsRoleCheckCache), and refused with the condition to add when it
 * lets any id in. Every way into a customer's AWS account - a test, every
 * read (metrics, inventory, changes and health, costs and savings), a live
 * read, Data Security's reads and its responses - signs in here, through
 * AwsCloudConnector.getCredentials.
 */
export async function assumeRole(data: {
  transport: CloudConnectorTransport;
  // OneUptime's own credential, never the customer's.
  credentials: AwsCredentials;
  roleArn: string;
  projectId: string;
  connectionId: string;
  region: string;
  now?: (() => Date) | undefined;
  timeoutInMs?: number | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  budget?: CloudReadBudget | undefined;
  // A test checks afresh, and keeps nothing.
  noCache?: boolean | undefined;
}): Promise<AwsAssumedRole> {
  const roleArn: string = data.roleArn.trim();
  const key: string = AssumedRoleCache.keyOf(data);
  const roleSessionName: string = getRoleSessionName(data.connectionId);
  const kept: AwsRoleCheckVerdict | undefined = data.noCache
    ? undefined
    : AwsRoleCheckCache.get(key);
  // When this sign-in checked the role itself: kept as a pass once it works.
  let checkedAtMs: number | null = null;

  if (kept === "takes-any-external-id") {
    throw roleWithoutExternalId(data.projectId);
  }

  if (kept !== "requires-external-id") {
    checkedAtMs = Date.now();

    const verdict: AwsRoleCheckVerdict = await probeRoleExternalId({
      transport: data.transport,
      credentials: data.credentials,
      roleArn,
      roleSessionName,
      region: data.region,
      now: data.now,
      timeoutInMs: data.timeoutInMs,
      sleep: data.sleep,
      budget: data.budget,
    });

    if (verdict === "takes-any-external-id") {
      logger.warn(
        `Cloud connections: role ${roleArn} (project ${data.projectId}, connection ${data.connectionId}) let this OneUptime sign in with an external id no project has, so it is not used: its trust policy needs the sts:ExternalId condition. The session AWS handed out was dropped unread.`,
      );

      if (!data.noCache) {
        AwsRoleCheckCache.set(key, verdict, checkedAtMs);
      }

      throw roleWithoutExternalId(data.projectId);
    }
  }

  let text: string;

  try {
    text = await requestRoleSession({
      transport: data.transport,
      credentials: data.credentials,
      roleArn,
      roleSessionName,
      // Always this project's own: never one a request names.
      externalId: getAwsExternalIdForProject(data.projectId),
      durationSeconds: ASSUMED_ROLE_SESSION_SECONDS,
      region: data.region,
      step: "role sign-in",
      now: data.now,
      timeoutInMs: data.timeoutInMs,
      sleep: data.sleep,
      budget: data.budget,
    });
  } catch (error) {
    throw describeRoleFailure({ error, roleArn, step: "sign-in" });
  }

  const accessKeyId: string = readXmlTag(text, "AccessKeyId");
  const secretAccessKey: string = readXmlTag(text, "SecretAccessKey");
  const sessionToken: string = readXmlTag(text, "SessionToken");
  const expiration: number = Date.parse(readXmlTag(text, "Expiration"));

  if (!accessKeyId || !secretAccessKey || !sessionToken) {
    throw new LlmProviderError({
      message: "AWS did not return credentials for the role.",
      kind: CloudConnectionFailureKind.Other,
    });
  }

  if (checkedAtMs !== null && !data.noCache) {
    AwsRoleCheckCache.set(key, "requires-external-id", checkedAtMs);
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
 * every read. A session is handed out only while the check that let it be
 * made holds (AwsRoleCheckCache): a day after it, the role is checked
 * again before its next session. In this process only.
 */
export class AssumedRoleCache {
  private static sessions: Map<string, AwsAssumedRole> = new Map();

  public static keyOf(data: {
    projectId: string;
    connectionId: string;
    roleArn: string;
  }): string {
    return `${data.projectId}|${data.connectionId}|${data.roleArn.trim()}`;
  }

  public static get(key: string): AwsCredentials | undefined {
    const session: AwsAssumedRole | undefined = this.sessions.get(key);

    if (!session) {
      return undefined;
    }

    if (
      AwsRoleCheckCache.get(key) !== "requires-external-id" ||
      session.expiresAtMs - SESSION_REUSE_MARGIN_MS <= Date.now()
    ) {
      this.sessions.delete(key);
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

  // Both caches: the sessions, and the checks that let them be made.
  public static clear(): void {
    this.sessions.clear();
    AwsRoleCheckCache.clear();
  }
}
