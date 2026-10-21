import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { getAwsExternalIdForProject } from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import { CloudConnectorTransport, CloudReadBudget } from "../CloudConnectorTypes";
import {
  AwsCredentials,
  AwsPartition,
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
 */

const STS_SERVICE: string = "sts";
const STS_VERSION: string = "2011-06-15";
const PROVIDER_TITLE: string = "AWS";

// A session lasts an hour; it is reused until five minutes before that.
export const ASSUMED_ROLE_SESSION_SECONDS: number = 3600;
const SESSION_REUSE_MARGIN_MS: number = 5 * 60 * 1000;

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
  budget?: CloudReadBudget | undefined;
}): Promise<AwsAssumedRole> {
  let answer: { text: string };

  try {
    answer = await sendAwsRequest({
      transport: data.transport,
      credentials: data.credentials,
      service: STS_SERVICE,
      region: data.region,
      body: {
        Action: "AssumeRole",
        Version: STS_VERSION,
        RoleArn: data.roleArn.trim(),
        RoleSessionName: getRoleSessionName(data.connectionId),
        // Always this project's own: never one a request names.
        ExternalId: getAwsExternalIdForProject(data.projectId),
        DurationSeconds: String(ASSUMED_ROLE_SESSION_SECONDS),
      },
      step: "role sign-in",
      providerTitle: PROVIDER_TITLE,
      now: data.now,
      timeoutInMs: data.timeoutInMs,
      budget: data.budget,
    });
  } catch (error) {
    /*
     * AWS answers a role that does not trust OneUptime, or that trusts it
     * with another external id, or that does not exist, with AccessDenied
     * on sts:AssumeRole. That is the role's setup, not OneUptime's key.
     */
    if (
      error instanceof LlmProviderError &&
      (error.kind === CloudConnectionFailureKind.Permission ||
        error.kind === CloudConnectionFailureKind.Authentication)
    ) {
      throw new LlmProviderError({
        message: `${error.message} Check that the role exists and trusts OneUptime with this project's external id: run the setup command again.`,
        kind: CloudConnectionFailureKind.Permission,
        statusCode: error.statusCode,
        responseBody: error.responseBody,
      });
    }

    throw error;
  }

  const accessKeyId: string = readXmlTag(answer.text, "AccessKeyId");
  const secretAccessKey: string = readXmlTag(answer.text, "SecretAccessKey");
  const sessionToken: string = readXmlTag(answer.text, "SessionToken");
  const expiration: number = Date.parse(readXmlTag(answer.text, "Expiration"));

  if (!accessKeyId || !secretAccessKey || !sessionToken) {
    throw new LlmProviderError({
      message: "AWS did not return credentials for the role.",
      kind: CloudConnectionFailureKind.Other,
    });
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
 * every read. In this process only.
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

    if (session.expiresAtMs - SESSION_REUSE_MARGIN_MS <= Date.now()) {
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

  public static clear(): void {
    this.sessions.clear();
  }
}
