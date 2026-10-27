import fs from "fs";
import {
  CloudHttpResponse,
  CloudSender,
  isPlainObject,
  isPlatformHost,
  parseJsonBody,
  readString,
  shortenCloudText,
} from "./CloudHttp";
import {
  AWS_ACCOUNT_PATTERN,
  AwsClient,
  STS_API_VERSION,
  accountOfArn,
  stsEndpoint,
} from "./AwsApi";
import { AwsSigningCredentials } from "./AwsSigV4";
import { XmlElement, xmlFind, xmlText } from "./CloudXml";

/*
 * Where the AWS Cloud AI agent's credentials come from, and the
 * short-lived ones it makes for each change.
 *
 * The base credentials, in the order the AWS SDKs look:
 *   1. AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (+ AWS_SESSION_TOKEN);
 *   2. the ECS container credentials endpoint — the task role the setup
 *      command gives the agent's Fargate task:
 *      AWS_CONTAINER_CREDENTIALS_RELATIVE_URI on http://169.254.170.2, or
 *      AWS_CONTAINER_CREDENTIALS_FULL_URI (plain http only to a loopback
 *      or ECS/EKS link-local address, as the SDKs allow) with the
 *      Authorization header from AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE or
 *      AWS_CONTAINER_AUTHORIZATION_TOKEN.
 * Container credentials are reused until five minutes before they expire.
 *
 * With ONEUPTIME_AI_AWS_WRITE_ROLE_ARN set, every change assumes that role
 * (STS AssumeRole, 15 minutes) with a session policy that allows only that
 * change's IAM actions: its changes on its one resource, its reads (which
 * support no resource-level permission) on "*". The session's credentials
 * are used for that one command and never kept.
 */

export const AWS_ACCESS_KEY_ID_ENV: string = "AWS_ACCESS_KEY_ID";
export const AWS_SECRET_ACCESS_KEY_ENV: string = "AWS_SECRET_ACCESS_KEY";
export const AWS_SESSION_TOKEN_ENV: string = "AWS_SESSION_TOKEN";
export const AWS_CONTAINER_CREDENTIALS_RELATIVE_URI_ENV: string =
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI";
export const AWS_CONTAINER_CREDENTIALS_FULL_URI_ENV: string =
  "AWS_CONTAINER_CREDENTIALS_FULL_URI";
export const AWS_CONTAINER_AUTHORIZATION_TOKEN_ENV: string =
  "AWS_CONTAINER_AUTHORIZATION_TOKEN";
export const AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE_ENV: string =
  "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE";
export const AWS_REGION_ENV: string = "AWS_REGION";
export const AWS_DEFAULT_REGION_ENV: string = "AWS_DEFAULT_REGION";

// The ECS container credentials endpoint (RELATIVE_URI is a path on it).
export const ECS_CREDENTIALS_HOST: string = "169.254.170.2";

// Credentials are refreshed this long before they expire.
export const CREDENTIAL_REFRESH_MARGIN_MS: number = 5 * 60 * 1000;

// How long a change's assumed-role session lasts (the shortest STS allows).
export const WRITE_SESSION_DURATION_SECONDS: number = 900;

export const SESSION_POLICY_VERSION: string = "2012-10-17";

// The largest authorization token file read.
const MAX_TOKEN_FILE_BYTES: number = 16 * 1024;

// An IAM action that only reads (and so takes no resource ARN in a session policy).
const READ_ACTION_PATTERN: RegExp = /^(?:Describe|List|Get)/;

const REGION_PATTERN: RegExp =
  /^[a-z]{2}(?:-gov|-iso|-isob)?-[a-z]{2,12}-[0-9]{1,2}$/;

export interface AwsCredentials extends AwsSigningCredentials {
  // When they stop working (ms since the epoch); null for long-term keys.
  expiresAtMs: number | null;
  // Where they came from, for messages.
  source: string;
}

function readTrimmed(env: NodeJS.ProcessEnv, name: string): string {
  const value: unknown = env[name];
  return typeof value === "string" ? value.trim() : "";
}

// The agent's own Region (AWS_REGION, else AWS_DEFAULT_REGION), or null.
export function readAwsRegion(env: NodeJS.ProcessEnv): string | null {
  for (const name of [AWS_REGION_ENV, AWS_DEFAULT_REGION_ENV]) {
    const value: string = readTrimmed(env, name);

    if (REGION_PATTERN.test(value)) {
      return value;
    }
  }

  return null;
}

// A header value must be one line of printable text.
function isHeaderSafe(value: string): boolean {
  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (code < 0x20 || code === 0x7f) {
      return false;
    }
  }

  return value.length > 0;
}

/*
 * The base credentials, read once and reused until shortly before they
 * expire. get() throws an Error whose message tells an operator what to set.
 */
export class AwsCredentialProvider {
  private cached: AwsCredentials | null = null;

  public constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly nowMs: () => number,
    private readonly readFile: (path: string) => string = (
      path: string,
    ): string => {
      const stat: fs.Stats = fs.statSync(path);

      if (!stat.isFile() || stat.size > MAX_TOKEN_FILE_BYTES) {
        throw new Error(
          `it is not a file of at most ${MAX_TOKEN_FILE_BYTES} bytes`,
        );
      }

      return fs.readFileSync(path, "utf8");
    },
  ) {}

  // Where the credentials come from, without reading them.
  public describeSource(): string {
    if (readTrimmed(this.env, AWS_ACCESS_KEY_ID_ENV)) {
      return `the access key in ${AWS_ACCESS_KEY_ID_ENV}`;
    }

    if (readTrimmed(this.env, AWS_CONTAINER_CREDENTIALS_RELATIVE_URI_ENV)) {
      return "the ECS task role";
    }

    if (readTrimmed(this.env, AWS_CONTAINER_CREDENTIALS_FULL_URI_ENV)) {
      return `the container credentials endpoint (${AWS_CONTAINER_CREDENTIALS_FULL_URI_ENV})`;
    }

    return "no credentials";
  }

  public async get(send: CloudSender): Promise<AwsCredentials> {
    const now: number = this.nowMs();

    if (
      this.cached &&
      (this.cached.expiresAtMs === null ||
        this.cached.expiresAtMs - CREDENTIAL_REFRESH_MARGIN_MS > now)
    ) {
      return this.cached;
    }

    const fromEnvironment: AwsCredentials | null = this.fromEnvironment();

    if (fromEnvironment) {
      this.cached = fromEnvironment;
      return fromEnvironment;
    }

    const fromContainer: AwsCredentials = await this.fromContainer(send);
    this.cached = fromContainer;
    return fromContainer;
  }

  // Forget the cached credentials (AWS said they expired).
  public invalidate(): void {
    this.cached = null;
  }

  private fromEnvironment(): AwsCredentials | null {
    const accessKeyId: string = readTrimmed(this.env, AWS_ACCESS_KEY_ID_ENV);
    const secretAccessKey: string = readTrimmed(
      this.env,
      AWS_SECRET_ACCESS_KEY_ENV,
    );
    const sessionToken: string = readTrimmed(this.env, AWS_SESSION_TOKEN_ENV);

    if (!accessKeyId && !secretAccessKey) {
      return null;
    }

    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        `${accessKeyId ? AWS_ACCESS_KEY_ID_ENV : AWS_SECRET_ACCESS_KEY_ENV} is set but ${
          accessKeyId ? AWS_SECRET_ACCESS_KEY_ENV : AWS_ACCESS_KEY_ID_ENV
        } is not. Set both, or neither to use the ECS task role.`,
      );
    }

    if (
      !isHeaderSafe(accessKeyId) ||
      !isHeaderSafe(secretAccessKey) ||
      (sessionToken && !isHeaderSafe(sessionToken))
    ) {
      throw new Error(
        `${AWS_ACCESS_KEY_ID_ENV}, ${AWS_SECRET_ACCESS_KEY_ENV} or ${AWS_SESSION_TOKEN_ENV} holds a line break or another control character.`,
      );
    }

    return {
      accessKeyId,
      secretAccessKey,
      sessionToken: sessionToken || null,
      expiresAtMs: null,
      source: `the access key in ${AWS_ACCESS_KEY_ID_ENV}`,
    };
  }

  // The endpoint and Authorization header of the container credentials, or why none.
  private containerEndpoint(): { url: string; authorization: string | null } {
    const relative: string = readTrimmed(
      this.env,
      AWS_CONTAINER_CREDENTIALS_RELATIVE_URI_ENV,
    );

    if (relative) {
      if (!relative.startsWith("/") || !isHeaderSafe(relative)) {
        throw new Error(
          `${AWS_CONTAINER_CREDENTIALS_RELATIVE_URI_ENV} is not a path on the ECS credentials endpoint.`,
        );
      }

      return {
        url: `http://${ECS_CREDENTIALS_HOST}${relative}`,
        authorization: null,
      };
    }

    const full: string = readTrimmed(
      this.env,
      AWS_CONTAINER_CREDENTIALS_FULL_URI_ENV,
    );

    if (!full) {
      throw new Error(
        `The agent has no AWS credentials to sign with. Run it as an ECS task with a task role (the setup command does), or set ${AWS_ACCESS_KEY_ID_ENV} and ${AWS_SECRET_ACCESS_KEY_ENV}.`,
      );
    }

    let parsed: URL;

    try {
      parsed = new URL(full);
    } catch {
      throw new Error(
        `${AWS_CONTAINER_CREDENTIALS_FULL_URI_ENV} is not a URL.`,
      );
    }

    if (
      parsed.username ||
      parsed.password ||
      !(
        parsed.protocol === "https:" ||
        (parsed.protocol === "http:" && isPlatformHost(parsed.hostname))
      )
    ) {
      throw new Error(
        `${AWS_CONTAINER_CREDENTIALS_FULL_URI_ENV} must be an https:// URL, or http:// to a loopback or ECS/EKS link-local address.`,
      );
    }

    const tokenFile: string = readTrimmed(
      this.env,
      AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE_ENV,
    );
    let authorization: string = readTrimmed(
      this.env,
      AWS_CONTAINER_AUTHORIZATION_TOKEN_ENV,
    );

    if (tokenFile) {
      try {
        authorization = this.readFile(tokenFile).trim();
      } catch (err: unknown) {
        throw new Error(
          `${AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE_ENV}="${tokenFile}" cannot be read: ${
            err instanceof Error ? err.message : String(err)
          }.`,
        );
      }
    }

    if (authorization && !isHeaderSafe(authorization)) {
      throw new Error(
        "The container credentials' authorization token holds a line break or another control character.",
      );
    }

    return { url: parsed.toString(), authorization: authorization || null };
  }

  private async fromContainer(send: CloudSender): Promise<AwsCredentials> {
    const endpoint: { url: string; authorization: string | null } =
      this.containerEndpoint();
    const headers: Record<string, string> = { Accept: "application/json" };

    if (endpoint.authorization) {
      headers["Authorization"] = endpoint.authorization;
    }

    let response: CloudHttpResponse;

    try {
      response = await send({
        method: "GET",
        url: endpoint.url,
        headers,
        body: null,
      });
    } catch (err: unknown) {
      throw new Error(
        `The ECS container credentials endpoint did not answer: ${
          err instanceof Error ? err.message : String(err)
        }.`,
      );
    }

    const json: unknown = parseJsonBody(response);
    const object: Record<string, unknown> | null = isPlainObject(json)
      ? json
      : null;

    if (response.status !== 200 || !object) {
      throw new Error(
        `The ECS container credentials endpoint answered HTTP ${response.status}${
          object && readString(object, "message")
            ? `: ${shortenCloudText(readString(object, "message") || "")}`
            : ""
        }. Check that the agent's task has a task role.`,
      );
    }

    const accessKeyId: string | null = readString(object, "AccessKeyId");
    const secretAccessKey: string | null = readString(
      object,
      "SecretAccessKey",
    );
    const token: string | null = readString(object, "Token");
    const expiration: string | null = readString(object, "Expiration");
    const expiresAtMs: number = expiration ? Date.parse(expiration) : NaN;

    if (
      !accessKeyId ||
      !secretAccessKey ||
      !isHeaderSafe(accessKeyId) ||
      !isHeaderSafe(secretAccessKey) ||
      (token !== null && !isHeaderSafe(token))
    ) {
      throw new Error(
        "The ECS container credentials endpoint answered without usable credentials.",
      );
    }

    const roleArn: string | null = readString(object, "RoleArn");

    return {
      accessKeyId,
      secretAccessKey,
      sessionToken: token,
      // Without an expiration, they are asked for again in five minutes.
      expiresAtMs: Number.isFinite(expiresAtMs)
        ? expiresAtMs
        : this.nowMs() + 2 * CREDENTIAL_REFRESH_MARGIN_MS,
      source: roleArn ? `the ECS task role ${roleArn}` : "the ECS task role",
    };
  }
}

// ---- The caller's identity, and the write role --------------------------------

export interface AwsCallerIdentity {
  account: string;
  arn: string;
}

// STS GetCallerIdentity with these credentials.
export async function getAwsCallerIdentity(data: {
  send: CloudSender;
  credentials: AwsCredentials;
  region: string | null;
  nowMs: () => number;
  userAgent: string;
}): Promise<AwsCallerIdentity> {
  const sts: { host: string; region: string } = stsEndpoint(data.region);
  const client: AwsClient = new AwsClient({
    send: data.send,
    credentials: data.credentials,
    nowMs: data.nowMs,
    userAgent: data.userAgent,
    identityName: data.credentials.source,
    describeMissingPermission: (): string => {
      return "Every identity may call STS GetCallerIdentity, so this is not about a permission: an SCP or a VPC endpoint policy may block STS.";
    },
  });
  const root: XmlElement = await client.query({
    endpointPrefix: "sts",
    signingName: "sts",
    region: sts.region,
    host: sts.host,
    action: "GetCallerIdentity",
    version: STS_API_VERSION,
    permission: "sts:GetCallerIdentity",
  });
  const result: XmlElement | null = xmlFind(root, "GetCallerIdentityResult");
  const account: string | null = xmlText(result, "Account");
  const arn: string | null = xmlText(result, "Arn");

  if (!account || !AWS_ACCOUNT_PATTERN.test(account) || !arn) {
    throw new Error("STS GetCallerIdentity answered without an account.");
  }

  return { account, arn };
}

// IAM actions a session policy grants on "*": the reads, which take no resource ARN.
export function isAwsReadAction(action: string): boolean {
  const name: string = action.slice(action.indexOf(":") + 1);
  return READ_ACTION_PATTERN.test(name);
}

/*
 * The session policy of one change: its changes on its resources, its
 * reads on "*" (they support no resource-level permission). Compact JSON,
 * well under STS's 2048-character limit.
 */
export function buildAwsSessionPolicy(data: {
  permissions: ReadonlyArray<string>;
  writeResources: ReadonlyArray<string>;
}): string {
  const unique: Array<string> = Array.from(new Set<string>(data.permissions));
  const writes: Array<string> = unique.filter((action: string): boolean => {
    return !isAwsReadAction(action);
  });
  const reads: Array<string> = unique.filter((action: string): boolean => {
    return isAwsReadAction(action);
  });
  const statements: Array<Record<string, unknown>> = [];

  if (writes.length > 0 && data.writeResources.length > 0) {
    statements.push({
      Sid: "OneUptimeAiChange",
      Effect: "Allow",
      Action: writes,
      Resource: Array.from(new Set<string>(data.writeResources)),
    });
  }

  if (reads.length > 0) {
    statements.push({
      Sid: "OneUptimeAiRead",
      Effect: "Allow",
      Action: reads,
      Resource: "*",
    });
  }

  // A policy must hold a statement; this one allows nothing.
  if (statements.length === 0) {
    statements.push({
      Sid: "OneUptimeAiNothing",
      Effect: "Deny",
      Action: "*",
      Resource: "*",
    });
  }

  return JSON.stringify({
    Version: SESSION_POLICY_VERSION,
    Statement: statements,
  });
}

/*
 * oneuptime-ai-<operation>-<8 hex>: what CloudTrail shows as the session
 * name (2-64 characters of [\w+=,.@-]).
 */
export function buildRoleSessionName(
  operation: string,
  suffix: string,
): string {
  return `oneuptime-ai-${operation}-${suffix}`
    .replace(/[^A-Za-z0-9+=,.@_-]/g, "-")
    .slice(0, 64);
}

export interface AwsAssumedRole {
  credentials: AwsCredentials;
  // arn:aws:sts::<account>:assumed-role/<role>/<session>
  assumedRoleArn: string;
  account: string;
}

// STS AssumeRole of the write role, for one change, with its session policy.
export async function assumeAwsWriteRole(data: {
  send: CloudSender;
  base: AwsCredentials;
  roleArn: string;
  sessionName: string;
  policy: string;
  region: string | null;
  nowMs: () => number;
  userAgent: string;
}): Promise<AwsAssumedRole> {
  const sts: { host: string; region: string } = stsEndpoint(data.region);
  const client: AwsClient = new AwsClient({
    send: data.send,
    credentials: data.base,
    nowMs: data.nowMs,
    userAgent: data.userAgent,
    identityName: data.base.source,
    describeMissingPermission: (): string => {
      return `The agent's own identity (${data.base.source}) may not assume ${data.roleArn}: the write role's trust policy must name the agent's task role, and the task role needs sts:AssumeRole on the write role (the setup command sets up both).`;
    },
  });
  const root: XmlElement = await client.query({
    endpointPrefix: "sts",
    signingName: "sts",
    region: sts.region,
    host: sts.host,
    action: "AssumeRole",
    version: STS_API_VERSION,
    params: [
      ["RoleArn", data.roleArn],
      ["RoleSessionName", data.sessionName],
      ["DurationSeconds", String(WRITE_SESSION_DURATION_SECONDS)],
      ["Policy", data.policy],
    ],
    permission: "sts:AssumeRole",
  });
  const result: XmlElement | null = xmlFind(root, "AssumeRoleResult");
  const accessKeyId: string | null = xmlText(
    result,
    "Credentials",
    "AccessKeyId",
  );
  const secretAccessKey: string | null = xmlText(
    result,
    "Credentials",
    "SecretAccessKey",
  );
  const sessionToken: string | null = xmlText(
    result,
    "Credentials",
    "SessionToken",
  );
  const expiration: string | null = xmlText(
    result,
    "Credentials",
    "Expiration",
  );
  const assumedRoleArn: string | null = xmlText(
    result,
    "AssumedRoleUser",
    "Arn",
  );
  const account: string | null = accountOfArn(assumedRoleArn);
  const expiresAtMs: number = expiration ? Date.parse(expiration) : NaN;

  if (
    !accessKeyId ||
    !secretAccessKey ||
    !sessionToken ||
    !assumedRoleArn ||
    !account ||
    !isHeaderSafe(accessKeyId) ||
    !isHeaderSafe(secretAccessKey) ||
    !isHeaderSafe(sessionToken)
  ) {
    throw new Error(
      `STS AssumeRole of ${data.roleArn} answered without credentials.`,
    );
  }

  return {
    credentials: {
      accessKeyId,
      secretAccessKey,
      sessionToken,
      expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : null,
      source: assumedRoleArn,
    },
    assumedRoleArn,
    account,
  };
}
