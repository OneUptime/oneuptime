import fs from "fs";
import { isAwsRegion } from "../../../Types/Cloud/AwsRegionCode";

/*
 * THE SERVER'S OWN AWS CREDENTIALS, FOUND WHERE EVERY AWS SDK FINDS THEM.
 *
 * A OneUptime that runs on AWS can sign its requests as the IAM role AWS
 * gives it, so no access key is stored anywhere and none has to be rotated
 * by hand (#7000). This looks for credentials in the order of the AWS SDKs'
 * default credential provider chain, and takes the first source that is
 * there:
 *
 *   1. Environment: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, with
 *      AWS_SESSION_TOKEN for temporary ones.
 *   2. Web identity: AWS_ROLE_ARN and AWS_WEB_IDENTITY_TOKEN_FILE - IAM
 *      roles for service accounts (IRSA) on Amazon EKS, or any OIDC
 *      provider the role trusts. The token is traded with STS
 *      AssumeRoleWithWebIdentity, a call that is not signed, at the STS
 *      endpoint of the server's own Region (AWS_REGION). The file is read
 *      again for every exchange: the kubelet rotates the token in it.
 *   3. Container credentials: AWS_CONTAINER_CREDENTIALS_RELATIVE_URI, a path
 *      on Amazon ECS's endpoint (169.254.170.2) that serves the task role;
 *      or AWS_CONTAINER_CREDENTIALS_FULL_URI, such as the EKS Pod Identity
 *      agent (169.254.170.23), with the Authorization token from
 *      AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE (read again every time) or
 *      AWS_CONTAINER_AUTHORIZATION_TOKEN. A full URI is plain http only to a
 *      loopback address or one of those agents, as the SDKs allow.
 *   4. The EC2 instance profile, from the instance metadata service, with an
 *      IMDSv2 session token on every read - unless AWS_EC2_METADATA_DISABLED
 *      is true. AWS_EC2_METADATA_SERVICE_ENDPOINT or
 *      AWS_EC2_METADATA_SERVICE_ENDPOINT_MODE=IPv6 point it elsewhere.
 *
 * Credentials that expire are reused until five minutes before they do,
 * and callers that ask at the same time share one fetch. A failure that
 * would fail the same way again (no role, a role that may not be assumed)
 * is remembered for ten seconds, so a burst of email does not ask STS or
 * the metadata service a thousand times. Every failure is an
 * AwsCredentialChainError whose message says what to change - never a key,
 * a token or a secret.
 *
 * These are the server's credentials. Only the server's own settings may
 * sign in with them, never a project's (AmazonSesMailProvider refuses).
 *
 * https://docs.aws.amazon.com/sdkref/latest/guide/standardized-credentials.html
 * https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html
 * https://docs.aws.amazon.com/eks/latest/userguide/pod-identities.html
 * https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html
 * https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-metadata-security-credentials.html
 */

export type AwsCredentialSource =
  | "environment"
  | "web-identity"
  | "container"
  | "instance-profile";

export interface AwsChainCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string | null;
  // When they stop working; null for keys that do not expire on their own.
  expiresAt: Date | null;
  source: AwsCredentialSource;
}

export type AwsChainEnvironment = Record<string, string | undefined>;

export interface AwsChainHttpRequest {
  method: "GET" | "PUT" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: string | undefined;
  timeoutMs: number;
}

export interface AwsChainHttpResponse {
  status: number;
  bodyText: string;
}

/*
 * One request to a credential source. Throws an AwsChainHttpError when no
 * answer came; any answer, whatever its status, is returned.
 */
export type AwsChainHttpClient = (
  request: AwsChainHttpRequest,
) => Promise<AwsChainHttpResponse>;

export interface AwsDefaultCredentialChainOptions {
  env?: AwsChainEnvironment | undefined;
  readFile?: ((path: string) => Promise<string>) | undefined;
  httpClient?: AwsChainHttpClient | undefined;
  now?: (() => Date) | undefined;
}

// What went wrong getting credentials, in words that say what to change.
export class AwsCredentialChainError extends Error {
  // Whether asking again could work: the source was busy or did not answer.
  public readonly isRetryable: boolean;
  // Where the credentials were looked for; null when nothing was there.
  public readonly source: AwsCredentialSource | null;

  public constructor(
    message: string,
    options: { isRetryable: boolean; source: AwsCredentialSource | null },
  ) {
    super(message);
    this.name = "AwsCredentialChainError";
    this.isRetryable = options.isRetryable;
    this.source = options.source;
  }
}

// A request that got no answer: the network, or the time it was given ran out.
export class AwsChainHttpError extends Error {
  public readonly isTimeout: boolean;

  public constructor(message: string, isTimeout: boolean) {
    super(message);
    this.name = "AwsChainHttpError";
    this.isTimeout = isTimeout;
  }
}

export const AWS_ACCESS_KEY_ID_ENV: string = "AWS_ACCESS_KEY_ID";
export const AWS_SECRET_ACCESS_KEY_ENV: string = "AWS_SECRET_ACCESS_KEY";
export const AWS_SESSION_TOKEN_ENV: string = "AWS_SESSION_TOKEN";
export const AWS_ROLE_ARN_ENV: string = "AWS_ROLE_ARN";
export const AWS_WEB_IDENTITY_TOKEN_FILE_ENV: string =
  "AWS_WEB_IDENTITY_TOKEN_FILE";
export const AWS_ROLE_SESSION_NAME_ENV: string = "AWS_ROLE_SESSION_NAME";
export const AWS_CONTAINER_CREDENTIALS_RELATIVE_URI_ENV: string =
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI";
export const AWS_CONTAINER_CREDENTIALS_FULL_URI_ENV: string =
  "AWS_CONTAINER_CREDENTIALS_FULL_URI";
export const AWS_CONTAINER_AUTHORIZATION_TOKEN_ENV: string =
  "AWS_CONTAINER_AUTHORIZATION_TOKEN";
export const AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE_ENV: string =
  "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE";
export const AWS_EC2_METADATA_DISABLED_ENV: string =
  "AWS_EC2_METADATA_DISABLED";
export const AWS_EC2_METADATA_SERVICE_ENDPOINT_ENV: string =
  "AWS_EC2_METADATA_SERVICE_ENDPOINT";
export const AWS_EC2_METADATA_SERVICE_ENDPOINT_MODE_ENV: string =
  "AWS_EC2_METADATA_SERVICE_ENDPOINT_MODE";
export const AWS_REGION_ENV: string = "AWS_REGION";
export const AWS_DEFAULT_REGION_ENV: string = "AWS_DEFAULT_REGION";

// Amazon ECS's credentials endpoint: RELATIVE_URI is a path on it.
export const ECS_CREDENTIALS_ENDPOINT: string = "http://169.254.170.2";

export const EC2_METADATA_ENDPOINT_IPV4: string = "http://169.254.169.254";
export const EC2_METADATA_ENDPOINT_IPV6: string = "http://[fd00:ec2::254]";

// IMDSv2: a session token is asked for with a PUT, then sent on every read.
export const EC2_METADATA_TOKEN_PATH: string = "/latest/api/token";
export const EC2_METADATA_CREDENTIALS_PATH: string =
  "/latest/meta-data/iam/security-credentials/";
export const EC2_METADATA_TOKEN_TTL_HEADER: string =
  "X-aws-ec2-metadata-token-ttl-seconds";
export const EC2_METADATA_TOKEN_HEADER: string = "X-aws-ec2-metadata-token";
// Six hours, as the SDKs ask; one token serves the three reads of a fetch.
export const EC2_METADATA_TOKEN_TTL_SECONDS: number = 21600;

// Credentials are fetched again this long before they expire.
export const AWS_CREDENTIALS_REFRESH_BEFORE_EXPIRY_MS: number = 5 * 60 * 1000;

// Credentials a source gave without an expiry are fetched again after this.
export const AWS_CREDENTIALS_WITHOUT_EXPIRY_REUSE_MS: number = 15 * 60 * 1000;

// A failure that would fail the same way again is remembered this long.
export const AWS_CREDENTIALS_FAILURE_MEMO_MS: number = 10 * 1000;

// How long each source may take to answer one request.
export const STS_TIMEOUT_MS: number = 5000;
export const CONTAINER_CREDENTIALS_TIMEOUT_MS: number = 2000;
export const EC2_METADATA_TIMEOUT_MS: number = 2000;

// The longest token file read, and the longest answer kept.
export const MAX_TOKEN_FILE_LENGTH: number = 64 * 1024;
export const MAX_ANSWER_LENGTH: number = 64 * 1024;

// How much of a source's own words goes into a message.
const MAX_DETAIL_LENGTH: number = 300;

const ROLE_SESSION_NAME_PREFIX: string = "oneuptime";

// What STS takes as a RoleSessionName (2 to 64 of these characters).
const ROLE_SESSION_NAME_PATTERN: RegExp = /^[\w+=,.@-]{2,64}$/;

// An IAM role or instance profile name, as IAM allows it.
const IAM_ROLE_NAME_PATTERN: RegExp = /^[\w+=,.@-]{1,128}$/;

// One part of a dotted IPv4 address.
const IPV4_OCTET_PATTERN: RegExp = /^\d{1,3}$/;

// Words that already end as a sentence does.
const SENTENCE_END_PATTERN: RegExp = /[.!?…]$/;

// What every message about missing credentials starts with.
export const NO_AWS_CREDENTIALS_MESSAGE: string =
  "This server has no AWS credentials. Give it an IAM role: IAM roles for service accounts or EKS Pod Identity on Amazon EKS, a task role on Amazon ECS, or an instance profile on Amazon EC2.";

// The hosts a full container credentials URI may name over plain http.
const PLAIN_HTTP_CONTAINER_HOSTS: ReadonlyArray<string> = [
  "169.254.170.2",
  "169.254.170.23",
  "[fd00:ec2::23]",
  "localhost",
  "[::1]",
];

const EKS_POD_IDENTITY_HOSTS: ReadonlyArray<string> = [
  "169.254.170.23",
  "[fd00:ec2::23]",
];

const readEnv: (env: AwsChainEnvironment, name: string) => string = (
  env: AwsChainEnvironment,
  name: string,
): string => {
  const value: unknown = env[name];

  return typeof value === "string" ? value.trim() : "";
};

/*
 * Whether a value can go into an HTTP header as it is: one line of
 * printable text. A key or a token with a line break in it would end the
 * header it is written into.
 */
export const isHeaderSafe: (value: string) => boolean = (
  value: string,
): boolean => {
  if (!value) {
    return false;
  }

  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (code < 0x20 || code === 0x7f) {
      return false;
    }
  }

  return true;
};

/*
 * Node's fetch says only "fetch failed"; the reason (ECONNREFUSED,
 * EHOSTUNREACH, a certificate it would not trust) is on its cause. Read by
 * shape: the error is not an Error of this realm everywhere.
 */
const describeNetworkError: (error: unknown) => string = (
  error: unknown,
): string => {
  if (!error || typeof error !== "object") {
    return String(error);
  }

  const cause: unknown = (error as { cause?: unknown }).cause;

  if (cause && typeof cause === "object") {
    const code: unknown = (cause as { code?: unknown }).code;

    if (typeof code === "string" && code) {
      return code;
    }

    const message: unknown = (cause as { message?: unknown }).message;

    if (typeof message === "string" && message) {
      return message;
    }
  }

  const message: unknown = (error as { message?: unknown }).message;

  return typeof message === "string" && message
    ? message
    : "the request failed";
};

// A time limit in words: "2 seconds", "1 second", "500 milliseconds".
export const describeTimeLimit: (milliseconds: number) => string = (
  milliseconds: number,
): string => {
  if (milliseconds < 1000) {
    return `${milliseconds} ${milliseconds === 1 ? "millisecond" : "milliseconds"}`;
  }

  const seconds: number = Math.round(milliseconds / 1000);

  return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
};

/*
 * An answer's text, read no further than MAX_ANSWER_LENGTH. Credentials
 * are a few hundred bytes; an answer that runs on is cut there, not held
 * whole, and the rest is never downloaded.
 */
const readAnswerText: (response: Response) => Promise<string> = async (
  response: Response,
): Promise<string> => {
  if (!response.body) {
    return "";
  }

  const reader: ReadableStreamDefaultReader<Uint8Array> =
    response.body.getReader();
  const decoder: TextDecoder = new TextDecoder();
  let text: string = "";

  try {
    while (text.length < MAX_ANSWER_LENGTH) {
      const part: ReadableStreamReadResult<Uint8Array> = await reader.read();

      if (part.done) {
        text += decoder.decode();
        break;
      }

      text += decoder.decode(part.value, { stream: true });
    }
  } finally {
    reader.cancel().catch(() => {
      // Already closed: nothing is left to stop.
    });
  }

  return text.length > MAX_ANSWER_LENGTH
    ? text.slice(0, MAX_ANSWER_LENGTH)
    : text;
};

/*
 * The request each source is asked with: fetch, given the time it may
 * take, never following a redirect (a credentials endpoint has no reason
 * to send one, and the next host would get the request's token).
 */
export const defaultAwsChainHttpClient: AwsChainHttpClient = async (
  request: AwsChainHttpRequest,
): Promise<AwsChainHttpResponse> => {
  const controller: AbortController = new AbortController();
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
    controller.abort();
  }, request.timeoutMs);

  try {
    const response: Response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body ?? null,
      redirect: "error",
      signal: controller.signal,
    });

    return {
      status: response.status,
      bodyText: await readAnswerText(response),
    };
  } catch (error) {
    if (
      controller.signal.aborted ||
      (error as { name?: unknown } | null)?.name === "AbortError"
    ) {
      throw new AwsChainHttpError(
        `timed out after ${describeTimeLimit(request.timeoutMs)}`,
        true,
      );
    }

    throw new AwsChainHttpError(describeNetworkError(error), false);
  } finally {
    clearTimeout(timer);
  }
};

const defaultReadFile: (path: string) => Promise<string> = (
  path: string,
): Promise<string> => {
  return fs.promises.readFile(path, "utf8");
};

interface CachedCredentials {
  credentials: AwsChainCredentials;
  // When they are fetched again (ms since the epoch).
  refreshAtMs: number;
}

export default class AwsDefaultCredentialChain {
  private static shared: AwsDefaultCredentialChain | null = null;

  private readonly env: AwsChainEnvironment;
  private readonly readFile: (path: string) => Promise<string>;
  private readonly httpClient: AwsChainHttpClient;
  private readonly now: () => Date;
  private cached: CachedCredentials | null = null;
  private inFlight: Promise<AwsChainCredentials> | null = null;
  private lastFailure: {
    error: AwsCredentialChainError;
    untilMs: number;
  } | null = null;

  public constructor(options?: AwsDefaultCredentialChainOptions) {
    this.env = options?.env || process.env;
    this.readFile = options?.readFile || defaultReadFile;
    this.httpClient = options?.httpClient || defaultAwsChainHttpClient;
    this.now =
      options?.now ||
      ((): Date => {
        return new Date();
      });
  }

  /*
   * The one chain of this process, over its environment: what it fetches is
   * shared by everything that signs as the server.
   */
  public static getShared(): AwsDefaultCredentialChain {
    if (!AwsDefaultCredentialChain.shared) {
      AwsDefaultCredentialChain.shared = new AwsDefaultCredentialChain();
    }

    return AwsDefaultCredentialChain.shared;
  }

  // Forget the shared chain, and what it holds (tests).
  public static resetShared(): void {
    AwsDefaultCredentialChain.shared = null;
  }

  /*
   * Where credentials would come from, without fetching them: the first
   * source the environment sets up, the instance profile when nothing else
   * is (it can only be known by asking), or null when the metadata service
   * is turned off too.
   */
  public getSource(): AwsCredentialSource | null {
    if (
      readEnv(this.env, AWS_ACCESS_KEY_ID_ENV) ||
      readEnv(this.env, AWS_SECRET_ACCESS_KEY_ENV)
    ) {
      return "environment";
    }

    if (
      readEnv(this.env, AWS_ROLE_ARN_ENV) &&
      readEnv(this.env, AWS_WEB_IDENTITY_TOKEN_FILE_ENV)
    ) {
      return "web-identity";
    }

    if (
      readEnv(this.env, AWS_CONTAINER_CREDENTIALS_RELATIVE_URI_ENV) ||
      readEnv(this.env, AWS_CONTAINER_CREDENTIALS_FULL_URI_ENV)
    ) {
      return "container";
    }

    if (this.isInstanceMetadataDisabled()) {
      return null;
    }

    return "instance-profile";
  }

  /*
   * The server's Region, as the platform tells it (EKS, ECS and Lambda set
   * AWS_REGION), or null.
   */
  public getRegion(): string | null {
    for (const name of [AWS_REGION_ENV, AWS_DEFAULT_REGION_ENV]) {
      const value: string = readEnv(this.env, name).toLowerCase();

      if (value && isAwsRegion(value)) {
        return value;
      }
    }

    return null;
  }

  /*
   * Credentials to sign the next request with. `regionHint` is the Region
   * the request goes to: STS is asked there when the server does not say
   * which Region it runs in.
   */
  public async getCredentials(options?: {
    regionHint?: string | undefined;
  }): Promise<AwsChainCredentials> {
    const source: AwsCredentialSource | null = this.getSource();

    // Keys in the environment are read as they are, every time.
    if (source === "environment") {
      return this.fromEnvironment();
    }

    const nowMs: number = this.now().getTime();

    if (this.cached && this.cached.refreshAtMs > nowMs) {
      return this.cached.credentials;
    }

    if (this.lastFailure && this.lastFailure.untilMs > nowMs) {
      throw this.lastFailure.error;
    }

    if (this.inFlight) {
      return await this.inFlight;
    }

    const fetching: Promise<AwsChainCredentials> = this.fetchFrom(
      source,
      options?.regionHint,
    )
      .then((credentials: AwsChainCredentials): AwsChainCredentials => {
        const fetchedAtMs: number = this.now().getTime();

        this.cached = {
          credentials: credentials,
          refreshAtMs: AwsDefaultCredentialChain.getRefreshAtMs(
            credentials,
            fetchedAtMs,
          ),
        };
        this.lastFailure = null;

        return credentials;
      })
      .catch((error: unknown): never => {
        if (error instanceof AwsCredentialChainError && !error.isRetryable) {
          this.lastFailure = {
            error: error,
            untilMs: this.now().getTime() + AWS_CREDENTIALS_FAILURE_MEMO_MS,
          };
        }

        throw error;
      })
      .finally((): void => {
        this.inFlight = null;
      });

    this.inFlight = fetching;

    return await fetching;
  }

  /*
   * Forget the credentials and any failure remembered, so the next call
   * fetches again: AWS said the ones in hand expired or are not known.
   */
  public invalidate(): void {
    this.cached = null;
    this.lastFailure = null;
  }

  /*
   * When credentials fetched at `fetchedAtMs` are fetched again: five
   * minutes before they expire, or - for ones that expire sooner than that
   * - halfway to it, so short-lived credentials are not fetched for every
   * request. Ones without an expiry are reused for fifteen minutes.
   */
  public static getRefreshAtMs(
    credentials: AwsChainCredentials,
    fetchedAtMs: number,
  ): number {
    if (!credentials.expiresAt) {
      return fetchedAtMs + AWS_CREDENTIALS_WITHOUT_EXPIRY_REUSE_MS;
    }

    const expiresAtMs: number = credentials.expiresAt.getTime();

    if (expiresAtMs - AWS_CREDENTIALS_REFRESH_BEFORE_EXPIRY_MS > fetchedAtMs) {
      return expiresAtMs - AWS_CREDENTIALS_REFRESH_BEFORE_EXPIRY_MS;
    }

    return (
      fetchedAtMs + Math.max(0, Math.floor((expiresAtMs - fetchedAtMs) / 2))
    );
  }

  /*
   * The STS endpoint of a Region: sts.{region}.amazonaws.com, or
   * amazonaws.com.cn in the China partition.
   */
  public static getStsHost(region: string): string {
    const value: string = region.trim().toLowerCase();

    return `sts.${value}.${value.startsWith("cn-") ? "amazonaws.com.cn" : "amazonaws.com"}`;
  }

  /*
   * Whether a full container credentials URI may be asked: https anywhere,
   * or plain http to a loopback address or the ECS or EKS Pod Identity
   * agent. Anything else could hand the authorization token, and the
   * credentials, to whoever answers on the way.
   */
  public static isAllowedContainerCredentialsUri(uri: string): boolean {
    let parsed: URL;

    try {
      parsed = new URL(uri);
    } catch {
      return false;
    }

    if (parsed.username || parsed.password) {
      return false;
    }

    if (parsed.protocol === "https:") {
      return true;
    }

    if (parsed.protocol !== "http:") {
      return false;
    }

    const host: string = parsed.hostname.toLowerCase();

    if (PLAIN_HTTP_CONTAINER_HOSTS.includes(host)) {
      return true;
    }

    // The loopback block, 127.0.0.0/8.
    const octets: Array<string> = host.split(".");

    return (
      octets.length === 4 &&
      octets[0] === "127" &&
      octets.every((octet: string): boolean => {
        return IPV4_OCTET_PATTERN.test(octet) && Number(octet) <= 255;
      })
    );
  }

  private isInstanceMetadataDisabled(): boolean {
    return (
      readEnv(this.env, AWS_EC2_METADATA_DISABLED_ENV).toLowerCase() === "true"
    );
  }

  private async fetchFrom(
    source: AwsCredentialSource | null,
    regionHint: string | undefined,
  ): Promise<AwsChainCredentials> {
    if (source === "web-identity") {
      return await this.fromWebIdentity(regionHint);
    }

    if (source === "container") {
      return await this.fromContainer();
    }

    if (source === "instance-profile") {
      return await this.fromInstanceProfile();
    }

    throw new AwsCredentialChainError(NO_AWS_CREDENTIALS_MESSAGE, {
      isRetryable: false,
      source: null,
    });
  }

  private fromEnvironment(): AwsChainCredentials {
    const accessKeyId: string = readEnv(this.env, AWS_ACCESS_KEY_ID_ENV);
    const secretAccessKey: string = readEnv(
      this.env,
      AWS_SECRET_ACCESS_KEY_ENV,
    );
    const sessionToken: string = readEnv(this.env, AWS_SESSION_TOKEN_ENV);

    if (!accessKeyId || !secretAccessKey) {
      const set: string = accessKeyId
        ? AWS_ACCESS_KEY_ID_ENV
        : AWS_SECRET_ACCESS_KEY_ENV;
      const missing: string = accessKeyId
        ? AWS_SECRET_ACCESS_KEY_ENV
        : AWS_ACCESS_KEY_ID_ENV;

      throw new AwsCredentialChainError(
        `${set} is set on this server, but ${missing} is not. Set both, or neither to use the server's IAM role.`,
        { isRetryable: false, source: "environment" },
      );
    }

    if (
      !isHeaderSafe(accessKeyId) ||
      !isHeaderSafe(secretAccessKey) ||
      (sessionToken && !isHeaderSafe(sessionToken))
    ) {
      throw new AwsCredentialChainError(
        `${AWS_ACCESS_KEY_ID_ENV}, ${AWS_SECRET_ACCESS_KEY_ENV} or ${AWS_SESSION_TOKEN_ENV} holds a line break or another control character. Set them again, each on one line.`,
        { isRetryable: false, source: "environment" },
      );
    }

    return {
      accessKeyId: accessKeyId,
      secretAccessKey: secretAccessKey,
      sessionToken: sessionToken || null,
      expiresAt: null,
      source: "environment",
    };
  }

  /*
   * IRSA, or any OIDC provider the role trusts: the token in the file,
   * traded at STS for an hour of the role's credentials.
   */
  private async fromWebIdentity(
    regionHint: string | undefined,
  ): Promise<AwsChainCredentials> {
    const roleArn: string = readEnv(this.env, AWS_ROLE_ARN_ENV);
    const tokenFile: string = readEnv(
      this.env,
      AWS_WEB_IDENTITY_TOKEN_FILE_ENV,
    );

    if (!roleArn.startsWith("arn:") || !isHeaderSafe(roleArn)) {
      throw new AwsCredentialChainError(
        `${AWS_ROLE_ARN_ENV} is not the ARN of an IAM role. Set it to one, such as arn:aws:iam::111122223333:role/oneuptime.`,
        { isRetryable: false, source: "web-identity" },
      );
    }

    const token: string = await this.readTokenFile(
      tokenFile,
      "web identity token",
      "web-identity",
    );

    const hint: string = (regionHint || "").trim().toLowerCase();
    const region: string =
      this.getRegion() || (hint && isAwsRegion(hint) ? hint : "us-east-1");
    const host: string = AwsDefaultCredentialChain.getStsHost(region);
    const sessionName: string = readEnv(this.env, AWS_ROLE_SESSION_NAME_ENV);

    const body: string = new URLSearchParams({
      Action: "AssumeRoleWithWebIdentity",
      Version: "2011-06-15",
      RoleArn: roleArn,
      RoleSessionName: ROLE_SESSION_NAME_PATTERN.test(sessionName)
        ? sessionName
        : `${ROLE_SESSION_NAME_PREFIX}-${this.now().getTime()}`,
      WebIdentityToken: token,
    }).toString();

    let answer: AwsChainHttpResponse;

    try {
      answer = await this.httpClient({
        method: "POST",
        url: `https://${host}/`,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
          Accept: "application/json",
        },
        body: body,
        timeoutMs: STS_TIMEOUT_MS,
      });
    } catch (error) {
      throw new AwsCredentialChainError(
        `AWS STS could not be reached at ${host}: ${AwsDefaultCredentialChain.reasonOf(error)}. Check that this server can reach it over HTTPS (port 443).`,
        { isRetryable: true, source: "web-identity" },
      );
    }

    if (answer.status < 200 || answer.status >= 300) {
      throw AwsDefaultCredentialChain.explainStsError(answer, {
        roleArn: roleArn,
        secrets: [token],
      });
    }

    const credentials: AwsChainCredentials | null =
      AwsDefaultCredentialChain.readStsCredentials(answer.bodyText);

    if (!credentials) {
      throw new AwsCredentialChainError(
        `AWS STS answered without credentials for the role ${roleArn}. It is asked again on the next try.`,
        { isRetryable: true, source: "web-identity" },
      );
    }

    return credentials;
  }

  /*
   * Amazon ECS's task role, or the EKS Pod Identity agent: one GET, its
   * answer the credentials.
   */
  private async fromContainer(): Promise<AwsChainCredentials> {
    const relative: string = readEnv(
      this.env,
      AWS_CONTAINER_CREDENTIALS_RELATIVE_URI_ENV,
    );
    let url: string;

    if (relative) {
      if (!relative.startsWith("/") || !isHeaderSafe(relative)) {
        throw new AwsCredentialChainError(
          `${AWS_CONTAINER_CREDENTIALS_RELATIVE_URI_ENV} is not a path on Amazon ECS's credentials endpoint. Leave it as Amazon ECS sets it.`,
          { isRetryable: false, source: "container" },
        );
      }

      url = `${ECS_CREDENTIALS_ENDPOINT}${relative}`;
    } else {
      url = readEnv(this.env, AWS_CONTAINER_CREDENTIALS_FULL_URI_ENV);

      if (
        !AwsDefaultCredentialChain.isAllowedContainerCredentialsUri(url) ||
        !isHeaderSafe(url)
      ) {
        throw new AwsCredentialChainError(
          `${AWS_CONTAINER_CREDENTIALS_FULL_URI_ENV} must be an https address, or http to a loopback address or the ECS or EKS Pod Identity agent (169.254.170.2, 169.254.170.23).`,
          { isRetryable: false, source: "container" },
        );
      }
    }

    const endpoint: string =
      AwsDefaultCredentialChain.describeContainerEndpoint(url);
    const headers: Record<string, string> = { Accept: "application/json" };
    const tokenFile: string = readEnv(
      this.env,
      AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE_ENV,
    );
    const inlineToken: string = readEnv(
      this.env,
      AWS_CONTAINER_AUTHORIZATION_TOKEN_ENV,
    );
    let authorization: string = "";

    if (tokenFile) {
      authorization = await this.readTokenFile(
        tokenFile,
        "container authorization token",
        "container",
      );
    } else if (inlineToken) {
      authorization = inlineToken;
    }

    if (authorization) {
      if (!isHeaderSafe(authorization)) {
        throw new AwsCredentialChainError(
          `The container authorization token holds a line break or another control character, so ${endpoint} cannot be asked with it.`,
          { isRetryable: false, source: "container" },
        );
      }

      headers["Authorization"] = authorization;
    }

    let answer: AwsChainHttpResponse;

    try {
      answer = await this.httpClient({
        method: "GET",
        url: url,
        headers: headers,
        timeoutMs: CONTAINER_CREDENTIALS_TIMEOUT_MS,
      });
    } catch (error) {
      throw new AwsCredentialChainError(
        `${AwsDefaultCredentialChain.capitalize(endpoint)} did not answer: ${AwsDefaultCredentialChain.reasonOf(error)}.`,
        { isRetryable: true, source: "container" },
      );
    }

    if (answer.status < 200 || answer.status >= 300) {
      throw new AwsCredentialChainError(
        `${AwsDefaultCredentialChain.capitalize(endpoint)} refused to give this server credentials (HTTP ${answer.status}).${AwsDefaultCredentialChain.saidPart(answer.bodyText, [authorization])}`,
        {
          isRetryable: AwsDefaultCredentialChain.isRetryableStatus(
            answer.status,
          ),
          source: "container",
        },
      );
    }

    const record: Record<string, unknown> | null =
      AwsDefaultCredentialChain.parseJsonObject(answer.bodyText);
    const credentials: AwsChainCredentials | null = record
      ? AwsDefaultCredentialChain.toCredentials(
          {
            accessKeyId: record["AccessKeyId"],
            secretAccessKey: record["SecretAccessKey"],
            sessionToken: record["Token"],
            expiration: record["Expiration"],
          },
          "container",
        )
      : null;

    if (!credentials) {
      throw new AwsCredentialChainError(
        `${AwsDefaultCredentialChain.capitalize(endpoint)} answered without credentials. It is asked again on the next try.`,
        { isRetryable: true, source: "container" },
      );
    }

    return credentials;
  }

  /*
   * The EC2 instance profile: a session token (IMDSv2), the role's name,
   * then its credentials - three requests to the metadata service.
   */
  private async fromInstanceProfile(): Promise<AwsChainCredentials> {
    const endpoint: string = this.getInstanceMetadataEndpoint();
    const service: string = `the EC2 instance metadata service (${AwsDefaultCredentialChain.hostOf(endpoint)})`;

    const ask: (
      request: Omit<AwsChainHttpRequest, "timeoutMs">,
      isFirst: boolean,
    ) => Promise<AwsChainHttpResponse> = async (
      request: Omit<AwsChainHttpRequest, "timeoutMs">,
      isFirst: boolean,
    ): Promise<AwsChainHttpResponse> => {
      try {
        return await this.httpClient({
          ...request,
          timeoutMs: EC2_METADATA_TIMEOUT_MS,
        });
      } catch (error) {
        const reason: string = AwsDefaultCredentialChain.reasonOf(error);

        if (!isFirst) {
          // It answered a moment ago: it is there, and may answer again.
          throw new AwsCredentialChainError(
            `${AwsDefaultCredentialChain.capitalize(service)} stopped answering (${reason}). It is asked again on the next try.`,
            { isRetryable: true, source: "instance-profile" },
          );
        }

        /*
         * Off EC2 nothing answers at that address. On EC2, a container whose
         * answers are one hop further than the instance allows (its metadata
         * hop limit) gets none either.
         */
        throw new AwsCredentialChainError(
          `${NO_AWS_CREDENTIALS_MESSAGE} ${AwsDefaultCredentialChain.capitalize(service)} did not answer (${reason}); in a container on Amazon EC2, the instance's metadata hop limit must be 2 or more.`,
          { isRetryable: false, source: "instance-profile" },
        );
      }
    };

    const tokenAnswer: AwsChainHttpResponse = await ask(
      {
        method: "PUT",
        url: `${endpoint}${EC2_METADATA_TOKEN_PATH}`,
        headers: {
          [EC2_METADATA_TOKEN_TTL_HEADER]: String(
            EC2_METADATA_TOKEN_TTL_SECONDS,
          ),
        },
      },
      true,
    );
    const sessionToken: string = tokenAnswer.bodyText.trim();

    if (
      tokenAnswer.status !== 200 ||
      !sessionToken ||
      !isHeaderSafe(sessionToken)
    ) {
      throw new AwsCredentialChainError(
        `${NO_AWS_CREDENTIALS_MESSAGE} ${AwsDefaultCredentialChain.capitalize(service)} did not give a session token (HTTP ${tokenAnswer.status}).`,
        {
          isRetryable: AwsDefaultCredentialChain.isRetryableStatus(
            tokenAnswer.status,
          ),
          source: "instance-profile",
        },
      );
    }

    const tokenHeader: Record<string, string> = {
      [EC2_METADATA_TOKEN_HEADER]: sessionToken,
    };

    const roleAnswer: AwsChainHttpResponse = await ask(
      {
        method: "GET",
        url: `${endpoint}${EC2_METADATA_CREDENTIALS_PATH}`,
        headers: tokenHeader,
      },
      false,
    );

    if (roleAnswer.status === 404) {
      throw new AwsCredentialChainError(
        "This EC2 instance has no IAM role. Attach an instance profile to it, or give the server an IAM role another way.",
        { isRetryable: false, source: "instance-profile" },
      );
    }

    const roleName: string =
      roleAnswer.bodyText
        .split("\n")
        .map((line: string): string => {
          return line.trim();
        })
        .find((line: string): boolean => {
          return line.length > 0;
        }) || "";

    if (roleAnswer.status !== 200 || !IAM_ROLE_NAME_PATTERN.test(roleName)) {
      throw new AwsCredentialChainError(
        `${AwsDefaultCredentialChain.capitalize(service)} did not name the instance's IAM role (HTTP ${roleAnswer.status}).`,
        {
          isRetryable: AwsDefaultCredentialChain.isRetryableStatus(
            roleAnswer.status,
          ),
          source: "instance-profile",
        },
      );
    }

    const credentialsAnswer: AwsChainHttpResponse = await ask(
      {
        method: "GET",
        url: `${endpoint}${EC2_METADATA_CREDENTIALS_PATH}${roleName}`,
        headers: tokenHeader,
      },
      false,
    );

    const record: Record<string, unknown> | null =
      credentialsAnswer.status === 200
        ? AwsDefaultCredentialChain.parseJsonObject(credentialsAnswer.bodyText)
        : null;
    const code: unknown = record?.["Code"];
    const credentials: AwsChainCredentials | null =
      record && (code === undefined || code === "Success")
        ? AwsDefaultCredentialChain.toCredentials(
            {
              accessKeyId: record["AccessKeyId"],
              secretAccessKey: record["SecretAccessKey"],
              sessionToken: record["Token"],
              expiration: record["Expiration"],
            },
            "instance-profile",
          )
        : null;

    if (!credentials) {
      throw new AwsCredentialChainError(
        `${AwsDefaultCredentialChain.capitalize(service)} did not give the credentials of the IAM role ${roleName} (HTTP ${credentialsAnswer.status}${typeof code === "string" && code ? `, ${code.slice(0, 60)}` : ""}). It is asked again on the next try.`,
        { isRetryable: true, source: "instance-profile" },
      );
    }

    return credentials;
  }

  /*
   * Where the metadata service is: AWS_EC2_METADATA_SERVICE_ENDPOINT, the
   * IPv6 address with AWS_EC2_METADATA_SERVICE_ENDPOINT_MODE=IPv6, or
   * 169.254.169.254. Without a trailing slash.
   */
  private getInstanceMetadataEndpoint(): string {
    const configured: string = readEnv(
      this.env,
      AWS_EC2_METADATA_SERVICE_ENDPOINT_ENV,
    );

    if (configured) {
      let parsed: URL | null = null;

      try {
        parsed = new URL(configured);
      } catch {
        parsed = null;
      }

      if (
        !parsed ||
        (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
        parsed.username ||
        parsed.password ||
        !isHeaderSafe(configured)
      ) {
        throw new AwsCredentialChainError(
          `${AWS_EC2_METADATA_SERVICE_ENDPOINT_ENV} is not an http or https address, such as http://169.254.169.254.`,
          { isRetryable: false, source: "instance-profile" },
        );
      }

      return `${parsed.protocol}//${parsed.host}`;
    }

    return readEnv(
      this.env,
      AWS_EC2_METADATA_SERVICE_ENDPOINT_MODE_ENV,
    ).toLowerCase() === "ipv6"
      ? EC2_METADATA_ENDPOINT_IPV6
      : EC2_METADATA_ENDPOINT_IPV4;
  }

  private async readTokenFile(
    path: string,
    what: string,
    source: AwsCredentialSource,
  ): Promise<string> {
    let token: string;

    try {
      token = (await this.readFile(path)).trim();
    } catch (error) {
      // Mounted by the platform, and rotated: a moment later it may be there.
      throw new AwsCredentialChainError(
        `The ${what} at ${path} could not be read: ${AwsDefaultCredentialChain.reasonOf(error)}.`,
        { isRetryable: true, source: source },
      );
    }

    if (!token) {
      throw new AwsCredentialChainError(`The ${what} at ${path} is empty.`, {
        isRetryable: true,
        source: source,
      });
    }

    if (token.length > MAX_TOKEN_FILE_LENGTH || !isHeaderSafe(token)) {
      throw new AwsCredentialChainError(
        `The ${what} at ${path} is not a token: it is longer than ${MAX_TOKEN_FILE_LENGTH / 1024} KB or holds a line break.`,
        { isRetryable: false, source: source },
      );
    }

    return token;
  }

  /*
   * An STS refusal, in words that say what to change: the role's trust
   * policy, the token's issuer, or nothing (STS was busy). The token never
   * reaches the message, whatever STS echoes.
   */
  public static explainStsError(
    answer: AwsChainHttpResponse,
    options: { roleArn: string; secrets: Array<string> },
  ): AwsCredentialChainError {
    const error: { code: string; message: string } =
      AwsDefaultCredentialChain.readStsError(answer.bodyText);
    const status: string = `HTTP ${answer.status}${error.code ? ` ${error.code}` : ""}`;
    const said: string = AwsDefaultCredentialChain.saidPart(
      error.message,
      options.secrets,
      "AWS STS said",
    );

    const isRetryable: boolean =
      AwsDefaultCredentialChain.isRetryableStatus(answer.status) ||
      error.code === "Throttling" ||
      error.code === "IDPCommunicationError" ||
      error.code === "ExpiredTokenException";

    let meaning: string = `AWS STS did not give this server credentials for the role ${options.roleArn} (${status}).`;

    if (error.code === "AccessDenied") {
      meaning = `AWS STS did not let this server assume the role ${options.roleArn} (${status}). Check that the role's trust policy allows sts:AssumeRoleWithWebIdentity for this cluster's OIDC provider and OneUptime's service account.`;
    } else if (error.code === "InvalidIdentityToken") {
      meaning = `AWS STS did not accept this server's web identity token for the role ${options.roleArn} (${status}). Check that the token's issuer, the cluster's OIDC provider, is an identity provider in IAM.`;
    } else if (error.code === "ExpiredTokenException") {
      meaning = `This server's web identity token has expired (${status}). It is read again on the next try.`;
    } else if (error.code === "IDPRejectedClaim") {
      meaning = `AWS STS did not accept a claim in this server's web identity token for the role ${options.roleArn} (${status}). Check the conditions in the role's trust policy.`;
    } else if (error.code === "RegionDisabledException") {
      meaning = `AWS STS is not turned on in this server's Region for the account of the role ${options.roleArn} (${status}). Turn it on in IAM's account settings.`;
    } else if (isRetryable) {
      meaning = `AWS STS could not give this server credentials just now (${status}). It is asked again on the next try.`;
    }

    return new AwsCredentialChainError(`${meaning}${said}`, {
      isRetryable: isRetryable,
      source: "web-identity",
    });
  }

  // An STS error's code and words, from its JSON or its XML.
  public static readStsError(body: string): { code: string; message: string } {
    const trimmed: string = (body || "").trim();

    if (trimmed.startsWith("{")) {
      const parsed: Record<string, unknown> | null =
        AwsDefaultCredentialChain.parseJsonObject(trimmed);
      const error: unknown = parsed?.["Error"];
      const record: Record<string, unknown> =
        error && typeof error === "object"
          ? (error as Record<string, unknown>)
          : {};

      return {
        code: typeof record["Code"] === "string" ? record["Code"] : "",
        message: typeof record["Message"] === "string" ? record["Message"] : "",
      };
    }

    return {
      code: AwsDefaultCredentialChain.readXmlElement(trimmed, "Code") || "",
      message:
        AwsDefaultCredentialChain.readXmlElement(trimmed, "Message") || "",
    };
  }

  /*
   * The credentials in an AssumeRoleWithWebIdentity answer: JSON when STS
   * honoured Accept: application/json, otherwise its XML. Null when either
   * key is missing.
   */
  public static readStsCredentials(body: string): AwsChainCredentials | null {
    const trimmed: string = (body || "").trim();

    if (trimmed.startsWith("{")) {
      const parsed: Record<string, unknown> | null =
        AwsDefaultCredentialChain.parseJsonObject(trimmed);
      const credentials: unknown = AwsDefaultCredentialChain.dig(parsed, [
        "AssumeRoleWithWebIdentityResponse",
        "AssumeRoleWithWebIdentityResult",
        "Credentials",
      ]);

      if (!credentials || typeof credentials !== "object") {
        return null;
      }

      const record: Record<string, unknown> = credentials as Record<
        string,
        unknown
      >;

      return AwsDefaultCredentialChain.toCredentials(
        {
          accessKeyId: record["AccessKeyId"],
          secretAccessKey: record["SecretAccessKey"],
          sessionToken: record["SessionToken"],
          expiration: record["Expiration"],
        },
        "web-identity",
      );
    }

    return AwsDefaultCredentialChain.toCredentials(
      {
        accessKeyId: AwsDefaultCredentialChain.readXmlElement(
          trimmed,
          "AccessKeyId",
        ),
        secretAccessKey: AwsDefaultCredentialChain.readXmlElement(
          trimmed,
          "SecretAccessKey",
        ),
        sessionToken: AwsDefaultCredentialChain.readXmlElement(
          trimmed,
          "SessionToken",
        ),
        expiration: AwsDefaultCredentialChain.readXmlElement(
          trimmed,
          "Expiration",
        ),
      },
      "web-identity",
    );
  }

  /*
   * The text of the first <name>...</name> in a short XML answer, with the
   * five predefined entities decoded. Found with indexOf: the elements read
   * hold text only.
   */
  public static readXmlElement(xml: string, name: string): string | null {
    const open: string = `<${name}>`;
    const close: string = `</${name}>`;
    const start: number = xml.indexOf(open);

    if (start === -1) {
      return null;
    }

    const end: number = xml.indexOf(close, start + open.length);

    if (end === -1) {
      return null;
    }

    return xml
      .substring(start + open.length, end)
      .split("&lt;")
      .join("<")
      .split("&gt;")
      .join(">")
      .split("&quot;")
      .join('"')
      .split("&apos;")
      .join("'")
      .split("&amp;")
      .join("&")
      .trim();
  }

  /*
   * Credentials as a source wrote them, or null when a key is missing or
   * would not fit in a header.
   */
  private static toCredentials(
    data: {
      accessKeyId: unknown;
      secretAccessKey: unknown;
      sessionToken: unknown;
      expiration: unknown;
    },
    source: AwsCredentialSource,
  ): AwsChainCredentials | null {
    const accessKeyId: string =
      typeof data.accessKeyId === "string" ? data.accessKeyId.trim() : "";
    const secretAccessKey: string =
      typeof data.secretAccessKey === "string"
        ? data.secretAccessKey.trim()
        : "";
    const sessionToken: string =
      typeof data.sessionToken === "string" ? data.sessionToken.trim() : "";

    if (
      !isHeaderSafe(accessKeyId) ||
      !isHeaderSafe(secretAccessKey) ||
      (sessionToken && !isHeaderSafe(sessionToken))
    ) {
      return null;
    }

    return {
      accessKeyId: accessKeyId,
      secretAccessKey: secretAccessKey,
      sessionToken: sessionToken || null,
      expiresAt: AwsDefaultCredentialChain.readExpiration(data.expiration),
      source: source,
    };
  }

  // STS's JSON gives seconds since the epoch; its XML, ECS, EKS and EC2 ISO 8601.
  private static readExpiration(value: unknown): Date | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      return new Date(value * 1000);
    }

    if (typeof value === "string" && value.trim()) {
      const date: Date = new Date(value.trim());
      return Number.isNaN(date.getTime()) ? null : date;
    }

    return null;
  }

  private static parseJsonObject(text: string): Record<string, unknown> | null {
    try {
      const parsed: unknown = JSON.parse(text);

      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  private static dig(value: unknown, path: Array<string>): unknown {
    let current: unknown = value;

    for (const key of path) {
      if (!current || typeof current !== "object") {
        return undefined;
      }

      current = (current as Record<string, unknown>)[key];
    }

    return current;
  }

  // Throttled, timed out on the source's side, or the source's own failure.
  private static isRetryableStatus(status: number): boolean {
    return status === 429 || status === 408 || status >= 500;
  }

  /*
   * " <who> said: <words>." from a source's answer, made safe to show:
   * every secret replaced, whitespace collapsed, cut to a line. Empty when
   * it said nothing.
   */
  private static saidPart(
    text: string,
    secrets: Array<string>,
    who: string = "It said",
  ): string {
    let said: string = text || "";

    for (const secret of secrets) {
      if (secret && secret.length >= 4) {
        said = said.split(secret).join("[redacted]");
      }
    }

    said = said.replace(/\s+/g, " ").trim();

    if (!said) {
      return "";
    }

    if (said.length > MAX_DETAIL_LENGTH) {
      said = `${said.slice(0, MAX_DETAIL_LENGTH)}…`;
    }

    // The message ends as a sentence, whatever the source's words end with.
    return ` ${who}: ${said}${SENTENCE_END_PATTERN.test(said) ? "" : "."}`;
  }

  private static reasonOf(error: unknown): string {
    const message: unknown = (error as { message?: unknown } | null)?.message;

    return typeof message === "string" && message
      ? message
      : "the request failed";
  }

  // Which agent a container credentials address is, in words.
  private static describeContainerEndpoint(url: string): string {
    const host: string = AwsDefaultCredentialChain.hostOf(url);

    if (host === "169.254.170.2") {
      return "the Amazon ECS credentials endpoint (169.254.170.2)";
    }

    if (EKS_POD_IDENTITY_HOSTS.includes(host)) {
      return `the EKS Pod Identity agent (${host})`;
    }

    return `the container credentials endpoint (${host})`;
  }

  private static hostOf(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }

  private static capitalize(text: string): string {
    return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
  }
}
