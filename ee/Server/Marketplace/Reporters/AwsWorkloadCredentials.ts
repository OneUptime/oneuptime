import fs from "fs";
import AwsSecurityHubClient from "Common/Server/Utils/SecurityEvent/Connectors/AwsSecurityHub/AwsSecurityHubClient";
import MarketplaceApiError from "../../CloudMarketplace/MarketplaceApiError";
import {
  MarketplaceHttp,
  MarketplaceHttpClient,
  MarketplaceHttpResponse,
  defaultMarketplaceHttpClient,
} from "Common/Server/Utils/Marketplace/MarketplaceHttp";

/*
 * AWS credentials for a self-hosted OneUptime that runs in the buyer's own
 * Amazon EKS cluster - the AWS Marketplace container product. It calls the
 * AWS Marketplace Metering Service as the buyer's AWS account, with the IAM
 * role the buyer attached to OneUptime's Kubernetes service account, never
 * with a key anybody types in:
 *
 *   - IAM roles for service accounts (IRSA): EKS mounts a projected service
 *     account token into the pod and sets AWS_ROLE_ARN and
 *     AWS_WEB_IDENTITY_TOKEN_FILE. The token is traded with STS
 *     AssumeRoleWithWebIdentity - an unsigned call - for temporary
 *     credentials.
 *   - EKS Pod Identity: the Pod Identity agent on the node serves the
 *     credentials at AWS_CONTAINER_CREDENTIALS_FULL_URI, for the token in
 *     AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE.
 *   - Keys in AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (and
 *     AWS_SESSION_TOKEN), last, as every AWS SDK takes them.
 *
 * Credentials are cached until five minutes before they expire. The token
 * files are read again for every exchange, because the kubelet rotates them.
 *
 * https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html
 * https://docs.aws.amazon.com/eks/latest/userguide/pod-identities.html
 * https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRoleWithWebIdentity.html
 */

export interface AwsWorkloadCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string | null;
  // Null for keys from the environment, which do not expire on their own.
  expiresAt: Date | null;
}

export type AwsWorkloadCredentialSource =
  | "web-identity"
  | "pod-identity"
  | "environment";

export type AwsWorkloadEnvironment = Record<string, string | undefined>;

// How long before they expire cached credentials are replaced.
export const AWS_WORKLOAD_CREDENTIALS_REFRESH_BEFORE_EXPIRY_IN_MS: number =
  5 * 60 * 1000;

// The longest session STS is asked for; a role may allow less, never more than this by default.
export const AWS_WEB_IDENTITY_SESSION_DURATION_IN_SECONDS: number = 3600;

/*
 * The hosts an EKS Pod Identity (or ECS) credentials URI may name over plain
 * http, as every AWS SDK allows: the agents' link-local addresses and the
 * loopback interface. Any other host must be https.
 */
const PLAIN_HTTP_CREDENTIAL_HOSTS: ReadonlyArray<string> = [
  "169.254.170.23",
  "[fd00:ec2::23]",
  "169.254.170.2",
  "127.0.0.1",
  "[::1]",
  "localhost",
];

const ROLE_SESSION_NAME_PREFIX: string = "oneuptime-marketplace";

export interface AwsWorkloadCredentialsProviderOptions {
  env?: AwsWorkloadEnvironment | undefined;
  readFile?: ((path: string) => Promise<string>) | undefined;
  httpClient?: MarketplaceHttpClient | undefined;
  now?: (() => Date) | undefined;
}

const defaultReadFile: (path: string) => Promise<string> = (
  path: string,
): Promise<string> => {
  return fs.promises.readFile(path, "utf8");
};

const readEnv: (env: AwsWorkloadEnvironment, name: string) => string | null = (
  env: AwsWorkloadEnvironment,
  name: string,
): string | null => {
  const value: string | undefined = env[name];

  if (typeof value !== "string") {
    return null;
  }

  const trimmed: string = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export default class AwsWorkloadCredentialsProvider {
  private env: AwsWorkloadEnvironment;
  private readFile: (path: string) => Promise<string>;
  private httpClient: MarketplaceHttpClient;
  private now: () => Date;
  private cached: AwsWorkloadCredentials | null = null;
  private inFlight: Promise<AwsWorkloadCredentials> | null = null;

  public constructor(options?: AwsWorkloadCredentialsProviderOptions) {
    this.env = options?.env || process.env;
    this.readFile = options?.readFile || defaultReadFile;
    this.httpClient = options?.httpClient || defaultMarketplaceHttpClient;
    this.now =
      options?.now ||
      ((): Date => {
        return new Date();
      });
  }

  /*
   * Where credentials would come from in this pod, or null when it has none
   * of the three - which on EKS means the service account has no IAM role.
   */
  public static getSource(
    env: AwsWorkloadEnvironment,
  ): AwsWorkloadCredentialSource | null {
    if (
      readEnv(env, "AWS_ROLE_ARN") &&
      readEnv(env, "AWS_WEB_IDENTITY_TOKEN_FILE")
    ) {
      return "web-identity";
    }

    if (readEnv(env, "AWS_CONTAINER_CREDENTIALS_FULL_URI")) {
      return "pod-identity";
    }

    if (
      readEnv(env, "AWS_ACCESS_KEY_ID") &&
      readEnv(env, "AWS_SECRET_ACCESS_KEY")
    ) {
      return "environment";
    }

    return null;
  }

  /*
   * The AWS Region this pod runs in, as EKS tells it (the IRSA webhook sets
   * AWS_REGION and AWS_DEFAULT_REGION), or `fallback`. Null when neither is
   * a Region code.
   */
  public static getRegion(
    env: AwsWorkloadEnvironment,
    fallback?: string | null | undefined,
  ): string | null {
    const candidates: Array<string | null> = [
      readEnv(env, "AWS_REGION"),
      readEnv(env, "AWS_DEFAULT_REGION"),
      fallback ? fallback.trim() : null,
    ];

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }

      try {
        AwsSecurityHubClient.validateRegion(candidate);
        return candidate;
      } catch {
        // Not a Region code; try the next one.
      }
    }

    return null;
  }

  /*
   * The STS endpoint of `region`. EKS asks for regional STS endpoints
   * (AWS_STS_REGIONAL_ENDPOINTS=regional), which also keeps the exchange in
   * the cluster's own Region.
   */
  public static getStsHost(region: string): string {
    const trimmed: string = region.trim();
    const suffix: string = trimmed.startsWith("cn-")
      ? "amazonaws.com.cn"
      : "amazonaws.com";

    return `sts.${trimmed}.${suffix}`;
  }

  /*
   * True when `uri` may be asked for credentials: https anywhere, or plain
   * http to one of the credential agents' own addresses.
   */
  public static isAllowedCredentialsUri(uri: string): boolean {
    let parsed: URL;

    try {
      parsed = new URL(uri);
    } catch {
      return false;
    }

    if (parsed.protocol === "https:") {
      return true;
    }

    if (parsed.protocol !== "http:") {
      return false;
    }

    return PLAIN_HTTP_CREDENTIAL_HOSTS.includes(parsed.hostname.toLowerCase());
  }

  public getSource(): AwsWorkloadCredentialSource | null {
    return AwsWorkloadCredentialsProvider.getSource(this.env);
  }

  public getRegion(fallback?: string | null | undefined): string | null {
    return AwsWorkloadCredentialsProvider.getRegion(this.env, fallback);
  }

  /*
   * Credentials to sign the next request with: the cached ones while they
   * are good for more than five minutes, otherwise fresh ones. Concurrent
   * callers share one exchange.
   */
  public async getCredentials(): Promise<AwsWorkloadCredentials> {
    if (this.cached && this.isUsable(this.cached)) {
      return this.cached;
    }

    if (this.inFlight) {
      return await this.inFlight;
    }

    const exchange: Promise<AwsWorkloadCredentials> = this.fetchCredentials()
      .then((credentials: AwsWorkloadCredentials): AwsWorkloadCredentials => {
        this.cached = credentials;
        return credentials;
      })
      .finally((): void => {
        this.inFlight = null;
      });

    this.inFlight = exchange;

    return await exchange;
  }

  // Forgets the cached credentials, so the next call fetches new ones.
  public invalidate(): void {
    this.cached = null;
  }

  private isUsable(credentials: AwsWorkloadCredentials): boolean {
    if (!credentials.expiresAt) {
      return true;
    }

    return (
      credentials.expiresAt.getTime() -
        AWS_WORKLOAD_CREDENTIALS_REFRESH_BEFORE_EXPIRY_IN_MS >
      this.now().getTime()
    );
  }

  private async fetchCredentials(): Promise<AwsWorkloadCredentials> {
    const source: AwsWorkloadCredentialSource | null = this.getSource();

    if (source === "web-identity") {
      return await this.fetchWebIdentityCredentials();
    }

    if (source === "pod-identity") {
      return await this.fetchPodIdentityCredentials();
    }

    if (source === "environment") {
      return {
        accessKeyId: readEnv(this.env, "AWS_ACCESS_KEY_ID") as string,
        secretAccessKey: readEnv(this.env, "AWS_SECRET_ACCESS_KEY") as string,
        sessionToken: readEnv(this.env, "AWS_SESSION_TOKEN"),
        expiresAt: null,
      };
    }

    throw new MarketplaceApiError({
      message:
        "This pod has no AWS credentials. Give OneUptime's Kubernetes service account an IAM role (IAM roles for service accounts or EKS Pod Identity) that may call the AWS Marketplace Metering Service.",
      status: null,
      isRetryable: false,
    });
  }

  private async fetchWebIdentityCredentials(): Promise<AwsWorkloadCredentials> {
    const roleArn: string = readEnv(this.env, "AWS_ROLE_ARN") as string;
    const tokenFile: string = readEnv(
      this.env,
      "AWS_WEB_IDENTITY_TOKEN_FILE",
    ) as string;
    const region: string | null = this.getRegion();

    if (!region) {
      throw new MarketplaceApiError({
        message:
          "The pod has an IAM role but no AWS Region (AWS_REGION is not set), so STS cannot be called.",
        status: null,
        isRetryable: false,
      });
    }

    const token: string = await this.readTokenFile(tokenFile);
    const host: string = AwsWorkloadCredentialsProvider.getStsHost(region);

    const body: string = new URLSearchParams({
      Action: "AssumeRoleWithWebIdentity",
      Version: "2011-06-15",
      RoleArn: roleArn,
      RoleSessionName:
        readEnv(this.env, "AWS_ROLE_SESSION_NAME") ||
        `${ROLE_SESSION_NAME_PREFIX}-${this.now().getTime()}`,
      WebIdentityToken: token,
      DurationSeconds: String(AWS_WEB_IDENTITY_SESSION_DURATION_IN_SECONDS),
    }).toString();

    let response: MarketplaceHttpResponse;

    try {
      response = await this.httpClient({
        method: "POST",
        url: `https://${host}/`,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
          Accept: "application/json",
        },
        body: body,
      });
    } catch (err) {
      throw new MarketplaceApiError({
        message: `AWS STS AssumeRoleWithWebIdentity request failed: ${(err as Error).message}`,
        status: null,
        isRetryable: true,
      });
    }

    if (!MarketplaceHttp.isSuccess(response.status)) {
      const errorCode: string = AwsWorkloadCredentialsProvider.readStsErrorCode(
        response.body,
      );

      throw new MarketplaceApiError({
        message: `AWS STS AssumeRoleWithWebIdentity failed (HTTP ${response.status}${errorCode ? `, ${errorCode}` : ""}): ${MarketplaceHttp.summarize(response.body)}`,
        status: response.status,
        isRetryable:
          MarketplaceHttp.isRetryable(response.status) ||
          errorCode === "Throttling" ||
          errorCode === "IDPCommunicationError",
        body: response.body,
      });
    }

    const credentials: AwsWorkloadCredentials | null =
      AwsWorkloadCredentialsProvider.readStsCredentials(response.body);

    if (!credentials) {
      throw new MarketplaceApiError({
        message:
          "AWS STS AssumeRoleWithWebIdentity answered without credentials.",
        status: response.status,
        isRetryable: true,
      });
    }

    return credentials;
  }

  private async fetchPodIdentityCredentials(): Promise<AwsWorkloadCredentials> {
    const uri: string = readEnv(
      this.env,
      "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    ) as string;

    if (!AwsWorkloadCredentialsProvider.isAllowedCredentialsUri(uri)) {
      throw new MarketplaceApiError({
        message:
          "AWS_CONTAINER_CREDENTIALS_FULL_URI must be https, or http to the EKS Pod Identity agent (169.254.170.23).",
        status: null,
        isRetryable: false,
      });
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    const tokenFile: string | null = readEnv(
      this.env,
      "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE",
    );
    const inlineToken: string | null = readEnv(
      this.env,
      "AWS_CONTAINER_AUTHORIZATION_TOKEN",
    );

    if (tokenFile) {
      headers["Authorization"] = await this.readTokenFile(tokenFile);
    } else if (inlineToken) {
      headers["Authorization"] = inlineToken;
    }

    let response: MarketplaceHttpResponse;

    try {
      response = await this.httpClient({
        method: "GET",
        url: uri,
        headers: headers,
        timeoutInMs: 5_000,
      });
    } catch (err) {
      throw new MarketplaceApiError({
        message: `The EKS Pod Identity agent did not answer: ${(err as Error).message}`,
        status: null,
        isRetryable: true,
      });
    }

    if (!MarketplaceHttp.isSuccess(response.status)) {
      throw new MarketplaceApiError({
        message: `The EKS Pod Identity agent refused (HTTP ${response.status}): ${MarketplaceHttp.summarize(response.body)}`,
        status: response.status,
        isRetryable: MarketplaceHttp.isRetryable(response.status),
      });
    }

    const parsed: Record<string, unknown> | null =
      MarketplaceHttp.parseJsonObject(response.body);
    const credentials: AwsWorkloadCredentials | null = parsed
      ? AwsWorkloadCredentialsProvider.toCredentials({
          accessKeyId: parsed["AccessKeyId"],
          secretAccessKey: parsed["SecretAccessKey"],
          sessionToken: parsed["Token"],
          expiration: parsed["Expiration"],
        })
      : null;

    if (!credentials) {
      throw new MarketplaceApiError({
        message: "The EKS Pod Identity agent answered without credentials.",
        status: response.status,
        isRetryable: true,
      });
    }

    return credentials;
  }

  private async readTokenFile(path: string): Promise<string> {
    let token: string;

    try {
      token = (await this.readFile(path)).trim();
    } catch (err) {
      throw new MarketplaceApiError({
        message: `Could not read the service account token at ${path}: ${(err as Error).message}`,
        status: null,
        isRetryable: true,
      });
    }

    if (!token) {
      throw new MarketplaceApiError({
        message: `The service account token at ${path} is empty.`,
        status: null,
        isRetryable: true,
      });
    }

    return token;
  }

  /*
   * The credentials in an AssumeRoleWithWebIdentity answer: JSON when STS
   * honoured Accept: application/json, otherwise its XML. Null when either
   * key is missing.
   */
  public static readStsCredentials(
    body: string,
  ): AwsWorkloadCredentials | null {
    const trimmed: string = (body || "").trim();

    if (trimmed.startsWith("{")) {
      const parsed: Record<string, unknown> | null =
        MarketplaceHttp.parseJsonObject(trimmed);
      const response: unknown = parsed?.["AssumeRoleWithWebIdentityResponse"];
      const result: unknown =
        response && typeof response === "object"
          ? (response as Record<string, unknown>)[
              "AssumeRoleWithWebIdentityResult"
            ]
          : null;
      const credentials: unknown =
        result && typeof result === "object"
          ? (result as Record<string, unknown>)["Credentials"]
          : null;

      if (!credentials || typeof credentials !== "object") {
        return null;
      }

      const record: Record<string, unknown> = credentials as Record<
        string,
        unknown
      >;

      return AwsWorkloadCredentialsProvider.toCredentials({
        accessKeyId: record["AccessKeyId"],
        secretAccessKey: record["SecretAccessKey"],
        sessionToken: record["SessionToken"],
        expiration: record["Expiration"],
      });
    }

    return AwsWorkloadCredentialsProvider.toCredentials({
      accessKeyId: AwsWorkloadCredentialsProvider.readXmlElement(
        trimmed,
        "AccessKeyId",
      ),
      secretAccessKey: AwsWorkloadCredentialsProvider.readXmlElement(
        trimmed,
        "SecretAccessKey",
      ),
      sessionToken: AwsWorkloadCredentialsProvider.readXmlElement(
        trimmed,
        "SessionToken",
      ),
      expiration: AwsWorkloadCredentialsProvider.readXmlElement(
        trimmed,
        "Expiration",
      ),
    });
  }

  // The error code of an STS error answer (XML or JSON), or "".
  public static readStsErrorCode(body: string): string {
    const trimmed: string = (body || "").trim();

    if (trimmed.startsWith("{")) {
      const parsed: Record<string, unknown> | null =
        MarketplaceHttp.parseJsonObject(trimmed);
      const error: unknown = parsed?.["Error"];

      if (error && typeof error === "object") {
        const code: unknown = (error as Record<string, unknown>)["Code"];
        return typeof code === "string" ? code : "";
      }

      return "";
    }

    return AwsWorkloadCredentialsProvider.readXmlElement(trimmed, "Code") || "";
  }

  /*
   * The text of the first <name>...</name> in a short XML answer, with the
   * five predefined entities decoded. Found with indexOf: the elements STS
   * returns hold text only.
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

  private static toCredentials(data: {
    accessKeyId: unknown;
    secretAccessKey: unknown;
    sessionToken: unknown;
    expiration: unknown;
  }): AwsWorkloadCredentials | null {
    if (
      typeof data.accessKeyId !== "string" ||
      !data.accessKeyId ||
      typeof data.secretAccessKey !== "string" ||
      !data.secretAccessKey
    ) {
      return null;
    }

    return {
      accessKeyId: data.accessKeyId,
      secretAccessKey: data.secretAccessKey,
      sessionToken:
        typeof data.sessionToken === "string" && data.sessionToken
          ? data.sessionToken
          : null,
      expiresAt: AwsWorkloadCredentialsProvider.readExpiration(data.expiration),
    };
  }

  // STS's JSON gives seconds since the epoch; its XML and Pod Identity give ISO 8601.
  private static readExpiration(value: unknown): Date | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      return new Date(value * 1000);
    }

    if (typeof value === "string" && value) {
      const date: Date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    return null;
  }
}
