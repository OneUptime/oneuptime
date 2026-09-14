import { createHash, createHmac } from "crypto";
import APIException from "../../../../../Types/Exception/ApiException";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Dictionary from "../../../../../Types/Dictionary";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../DataSource/HttpFetch";
import {
  REDACTED,
  redactLogString,
  redactLogValue,
} from "../../../LogRedaction";
import { ConnectorTransport } from "../Types";

/*
 * AWS Security Hub HTTP client: a hand-rolled AWS Signature Version 4
 * signer plus the GetFindings list, with nothing from the AWS SDK.
 *
 * Contracts this file relies on, verified against AWS's references:
 *  - Signing: AWS Signature Version 4 as described in "Create a signed
 *    AWS API request" — canonical request (method, URI, sorted query,
 *    lowercased sorted headers, signed header list, hex SHA-256 of the
 *    payload), string to sign (AWS4-HMAC-SHA256, x-amz-date, credential
 *    scope YYYYMMDD/region/service/aws4_request, hex SHA-256 of the
 *    canonical request), the HMAC chain kDate → kRegion → kService →
 *    kSigning, and the Authorization header
 *    "AWS4-HMAC-SHA256 Credential=..., SignedHeaders=..., Signature=...".
 *    https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
 *    Temporary credentials add x-amz-security-token, which the page says
 *    to include in the canonical headers. The signer is checked in tests
 *    against the vectors of AWS's published SigV4 test suite (get-vanilla,
 *    post-vanilla, post-x-www-form-urlencoded, post-header-key-sort,
 *    post-sts-header-before).
 *  - GetFindings: POST /findings with a JSON body of Filters, MaxResults
 *    (1..100), NextToken and SortCriteria [{Field, SortOrder}]; the
 *    response is { Findings: [...], NextToken? }. Errors are
 *    InvalidAccessException (401 in the GetFindings reference),
 *    AccessDeniedException (403, a common error), InvalidInputException
 *    (400), LimitExceededException (429) and InternalException (500).
 *    When cross-Region aggregation is enabled, a call in the home Region
 *    also returns findings from linked Regions.
 *    https://docs.aws.amazon.com/securityhub/1.0/APIReference/API_GetFindings.html
 *  - CreatedAt is set by the finding PROVIDER ("when the security findings
 *    provider created the potential security issue"), not by Security
 *    Hub; ProcessedAt is when Security Hub received it. Delivery lags
 *    CreatedAt (GuardDuty and AWS Config: usually within five minutes;
 *    EventBridge retries a failed delivery for up to 24 hours), which is
 *    why the catalog gives this provider a 30 minute cursor overlap.
 *    https://docs.aws.amazon.com/securityhub/1.0/APIReference/API_AwsSecurityFinding.html
 *    https://docs.aws.amazon.com/securityhub/latest/userguide/securityhub-internal-providers.html
 *  - DateFilter: { Start, End } timestamps, ISO 8601 with a Z suffix and
 *    up to nine fractional digits (Date.toISOString() qualifies).
 *    https://docs.aws.amazon.com/securityhub/1.0/APIReference/API_DateFilter.html
 *    https://docs.aws.amazon.com/securityhub/1.0/APIReference/Welcome.html#timestamps
 *  - Endpoints: securityhub.{region}.amazonaws.com, including the
 *    us-gov-* Regions; GetFindings is throttled at 3 requests per second
 *    (burst 6).
 *    https://docs.aws.amazon.com/general/latest/gr/sechub.html
 *
 * Every request goes through the injected ConnectorTransport (the
 * SSRF-guarded DataSourceHttpFetch in production), carries the caller's
 * timeout, and is additionally raced against a local deadline so a
 * transport that never settles cannot pin a poll. Every error is an
 * APIException whose prefix names the step ("findings request") and
 * whose body excerpt has been through redaction, so the message can be
 * stored on the connection row and shown in the UI.
 */

export const AWS_SECURITY_HUB_SERVICE: string = "securityhub";

/*
 * GetFindings caps MaxResults at 100 (API reference). The poller's
 * 20-request budget therefore covers 2,000 findings per run.
 */
export const AWS_SECURITY_HUB_DEFAULT_PAGE_SIZE: number = 100;
export const AWS_SECURITY_HUB_MAX_PAGE_SIZE: number = 100;

export const AWS_SECURITY_HUB_DEFAULT_REQUEST_TIMEOUT_IN_MS: number = 60 * 1000;

const FINDINGS_STEP: string = "findings request";

const SIGV4_ALGORITHM: string = "AWS4-HMAC-SHA256";
const SIGV4_TERMINATOR: string = "aws4_request";

/*
 * Region codes: a partition prefix of letters, one or more hyphenated
 * words and a trailing number (us-east-1, us-gov-west-1, ap-southeast-3,
 * eu-central-2, il-central-1, mx-central-1). The value is interpolated
 * into a hostname and into the credential scope, so anything else is
 * refused before a request is built.
 */
const REGION_REGEX: RegExp = /^[a-z]{2,4}(?:-[a-z]+)+-\d+$/;

/*
 * IAM access key ids are 16-128 characters of letters and digits (the
 * AccessKeyId pattern on the IAM API is [\w]+ with those bounds); the
 * common shapes are the 20-character AKIA... (long-lived) and ASIA...
 * (temporary) ids.
 */
const ACCESS_KEY_ID_REGEX: RegExp = /^[A-Za-z0-9]{16,128}$/;

// The shape DataSourceHttpFetch throws for a non-2xx answer.
const TRANSPORT_HTTP_ERROR_REGEX: RegExp =
  /^Data source responded with HTTP (\d{3}):\s*([\s\S]*)$/;

/*
 * Error codes AWS returns when the signature itself is rejected, i.e.
 * before Security Hub's own authorization runs. They mean the access key,
 * secret, session token, clock or signing code is wrong — never the IAM
 * policy. Names from the SigV4 troubleshooting reference and the common
 * AWS error taxonomy:
 * https://docs.aws.amazon.com/IAM/latest/UserGuide/signature-v4-troubleshooting.html
 */
const SIGNATURE_ERROR_CODES: Array<string> = [
  "UnrecognizedClientException",
  "InvalidClientTokenId",
  "InvalidSignatureException",
  "SignatureDoesNotMatch",
  "IncompleteSignatureException",
  "ExpiredTokenException",
  "ExpiredToken",
  "RequestExpired",
  "RequestTimeTooSkewed",
  "MissingAuthenticationTokenException",
  "MissingAuthenticationToken",
  "InvalidAccessKeyId",
];

/*
 * The only codes that mean AWS accepted the signature and Security Hub
 * then refused the call: the IAM policy does not allow GetFindings, or
 * Security Hub is not enabled for the account in the Region.
 */
const AUTHORIZATION_ERROR_CODES: Array<string> = [
  "AccessDeniedException",
  "InvalidAccessException",
];

/*
 * REST-JSON services send the error code in the x-amzn-errortype header,
 * and the production transport (DataSourceHttpFetch) keeps only the
 * status and the body of a non-2xx answer. A signature rejection's body
 * is often just {"message": "..."}, so without this table a wrong secret
 * arrives as a code-less 403 and was once reported as valid credentials
 * with an IAM remediation. Each entry is AWS's own wording for that code,
 * checked in order (the expired-token wording before the invalid-token
 * one, which shares its prefix).
 */
const MESSAGE_ERROR_CODES: Array<{ pattern: RegExp; code: string }> = [
  {
    pattern: /security token included in the request is expired/i,
    code: "ExpiredTokenException",
  },
  {
    pattern: /security token included in the request is invalid/i,
    code: "UnrecognizedClientException",
  },
  {
    pattern: /signature we calculated does not match/i,
    code: "InvalidSignatureException",
  },
  {
    pattern: /signature expired|signature not yet current/i,
    code: "InvalidSignatureException",
  },
  {
    pattern:
      /difference between the request time and the current time is too large/i,
    code: "RequestTimeTooSkewed",
  },
  {
    pattern: /missing authentication token/i,
    code: "MissingAuthenticationTokenException",
  },
  {
    pattern: /authorization header requires|credential should be scoped to/i,
    code: "IncompleteSignatureException",
  },
  { pattern: /is not authorized to perform/i, code: "AccessDeniedException" },
  {
    pattern: /is not subscribed to AWS Security Hub/i,
    code: "InvalidAccessException",
  },
];

// A signature rejected for its time rather than its key: the host clock.
const CLOCK_MESSAGE_REGEX: RegExp =
  /signature expired|signature not yet current|request time and the current time is too large/i;

/*
 * Which side refused a failed request. "authentication": AWS rejected the
 * signature, key, token or clock. "authorization": the signature was
 * verified and Security Hub refused the call. "other": anything else,
 * including a 403 that names no code, which cannot be attributed to
 * either side and so is never reported as valid credentials.
 */
export type AwsSecurityHubFailureKind =
  | "authentication"
  | "authorization"
  | "other";

/*
 * Authorization only when the recovered code says Security Hub itself
 * refused a verified request. A code-less 403 stays "other": a wrong
 * secret behind a header-dropping transport looks exactly like that, and
 * calling it a permission problem sends the customer to IAM while the
 * credential is what is wrong. Declared before the error class and the
 * client because both use it.
 */
function classifyAwsSecurityHubFailure(
  status: number,
  code: string,
): AwsSecurityHubFailureKind {
  if (SIGNATURE_ERROR_CODES.includes(code)) {
    return "authentication";
  }

  if (AUTHORIZATION_ERROR_CODES.includes(code)) {
    return "authorization";
  }

  if (status === 401) {
    return "authentication";
  }

  return "other";
}

/*
 * Thrown for every failure that carries an HTTP status, so the connector
 * decides authentication versus permission from the recovered code
 * instead of from hint wording in the message.
 */
export class AwsSecurityHubHttpError extends APIException {
  public statusCode: number;
  public errorCode: string;
  public failureKind: AwsSecurityHubFailureKind;

  public constructor(data: {
    message: string;
    statusCode: number;
    errorCode: string;
  }) {
    super(data.message);
    this.statusCode = data.statusCode;
    this.errorCode = data.errorCode;
    this.failureKind = classifyAwsSecurityHubFailure(
      data.statusCode,
      data.errorCode,
    );
  }
}

export interface AwsSecurityHubClientOptions {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  // Only for temporary credentials (ASIA... keys from STS).
  sessionToken?: string | undefined;
  transport: ConnectorTransport;
  requestTimeoutInMs?: number | undefined;
  // Test seam: the clock used for x-amz-date. Defaults to Date.now().
  now?: (() => Date) | undefined;
}

export interface AwsSecurityHubFindingsPage {
  findings: Array<JSONObject>;
  // Opaque token for the next page, or null when this was the last page.
  nextToken: string | null;
}

export interface AwsSecurityHubFindingCount {
  // Findings on the first page (bounded by the page size asked for).
  count: number;
  // True when the API offered a further page, i.e. the real count is larger.
  hasMore: boolean;
}

/*
 * Everything the SigV4 signer needs about one request. Header names may
 * be in any case; the signer canonicalizes them. `service` and `region`
 * are parameters (not fixed to Security Hub) so the signer can be run
 * against AWS's published test vectors, which use service "service".
 */
export interface AwsSigV4SignInput {
  method: "GET" | "POST";
  host: string;
  // Absolute path starting with "/", without the query string.
  path: string;
  // Query parameters, unencoded. Sorted and URI-encoded by the signer.
  query?: Dictionary<string> | undefined;
  // Headers to sign, Host excluded (it is added from `host`).
  headers?: Dictionary<string> | undefined;
  body: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
  region: string;
  service: string;
  // The request time; x-amz-date and the credential scope derive from it.
  date: Date;
}

export interface AwsSigV4SignResult {
  // All headers to send: the caller's, host, x-amz-date, the token, Authorization.
  headers: Dictionary<string>;
  // Exposed for tests and for debugging a SignatureDoesNotMatch.
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
  amzDate: string;
  credentialScope: string;
}

export default class AwsSecurityHubClient {
  private options: AwsSecurityHubClientOptions;
  private requestTimeoutInMs: number;
  private requestCount: number = 0;

  public constructor(options: AwsSecurityHubClientOptions) {
    AwsSecurityHubClient.validateRegion(options.region);
    AwsSecurityHubClient.validateAccessKeyId(options.accessKeyId);

    if (!options.secretAccessKey) {
      throw new BadDataException("Secret access key is required.");
    }

    this.options = options;
    this.requestTimeoutInMs =
      options.requestTimeoutInMs && options.requestTimeoutInMs > 0
        ? options.requestTimeoutInMs
        : AWS_SECURITY_HUB_DEFAULT_REQUEST_TIMEOUT_IN_MS;
  }

  // Every outbound request this instance made.
  public getRequestCount(): number {
    return this.requestCount;
  }

  /*
   * ---------------------------------------------------------------------
   * Validation (shared with the connector's validateSettings)
   * ---------------------------------------------------------------------
   */

  public static validateRegion(value: string): void {
    const trimmed: string = (value || "").trim();

    if (!trimmed || !REGION_REGEX.test(trimmed)) {
      throw new BadDataException(
        "Region must be an AWS Region code such as us-east-1, eu-central-1 or us-gov-west-1.",
      );
    }
  }

  public static validateAccessKeyId(value: string): void {
    const trimmed: string = (value || "").trim();

    if (!trimmed || !ACCESS_KEY_ID_REGEX.test(trimmed)) {
      throw new BadDataException(
        "Access key ID must be 16-128 letters or digits, such as the 20-character id that starts with AKIA (long-lived) or ASIA (temporary).",
      );
    }
  }

  /*
   * ---------------------------------------------------------------------
   * URLs
   * ---------------------------------------------------------------------
   */

  /*
   * The regional endpoint from the AWS General Reference. The China
   * partition (cn-*) lives under amazonaws.com.cn; every other partition
   * (aws, aws-us-gov) uses amazonaws.com.
   */
  public static getEndpointHost(region: string): string {
    const trimmed: string = region.trim();
    const suffix: string = trimmed.startsWith("cn-")
      ? "amazonaws.com.cn"
      : "amazonaws.com";

    return `${AWS_SECURITY_HUB_SERVICE}.${trimmed}.${suffix}`;
  }

  public getEndpointHost(): string {
    return AwsSecurityHubClient.getEndpointHost(this.options.region);
  }

  public getFindingsUrl(): string {
    return `https://${this.getEndpointHost()}/findings`;
  }

  public static clampPageSize(value: number | undefined): number {
    if (!value || !Number.isFinite(value)) {
      return AWS_SECURITY_HUB_DEFAULT_PAGE_SIZE;
    }

    return Math.min(
      AWS_SECURITY_HUB_MAX_PAGE_SIZE,
      Math.max(1, Math.floor(value)),
    );
  }

  /*
   * The GetFindings body for findings CREATED in [startTime, endTime],
   * oldest first. Creation time is the poll basis (see Connectors/Types.ts
   * for why): a GuardDuty finding is created when GuardDuty evaluates the
   * activity, which can be well after FirstObservedAt, and a control
   * finding is created when the control first evaluates the resource.
   * CreatedAt is the provider's timestamp, so a finding can become
   * readable here minutes after it; the catalog's 30 minute cursor overlap
   * re-reads that span on every poll and the dedupe by finding Id drops
   * what was already imported. DateFilter bounds are inclusive, which the
   * same dedupe makes harmless. The ascending sort is what lets the
   * connector report the CreatedAt of the last finding it read as a
   * resume point when a bound stops it.
   */
  public static buildFindingsBody(data: {
    startTime: Date;
    endTime: Date;
    maxResults: number;
    nextToken?: string | null | undefined;
  }): JSONObject {
    const body: JSONObject = {
      Filters: {
        CreatedAt: [
          {
            Start: data.startTime.toISOString(),
            End: data.endTime.toISOString(),
          },
        ],
      },
      SortCriteria: [{ Field: "CreatedAt", SortOrder: "asc" }],
      MaxResults: AwsSecurityHubClient.clampPageSize(data.maxResults),
    };

    if (data.nextToken) {
      body["NextToken"] = data.nextToken;
    }

    return body;
  }

  /*
   * ---------------------------------------------------------------------
   * Signature Version 4
   * ---------------------------------------------------------------------
   */

  private static sha256Hex(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
  }

  private static hmac(key: Buffer | string, value: string): Buffer {
    return createHmac("sha256", key).update(value, "utf8").digest();
  }

  /*
   * AWS's UriEncode: RFC 3986 unreserved characters pass, everything else
   * is percent-encoded with uppercase hex. encodeURIComponent already
   * leaves A-Z a-z 0-9 - _ . ~ alone but also spares ! ' ( ) *, which AWS
   * encodes.
   */
  public static uriEncode(value: string): string {
    return encodeURIComponent(value).replace(
      /[!'()*]/g,
      (character: string): string => {
        return `%${character.charCodeAt(0).toString(16).toUpperCase()}`;
      },
    );
  }

  // YYYYMMDDTHHMMSSZ from a Date, the x-amz-date format.
  public static toAmzDate(date: Date): string {
    return date
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
  }

  /*
   * Sign one request. Pure and deterministic given `date`, so the tests
   * can compare the canonical request, the string to sign and the
   * signature against AWS's published vectors byte for byte.
   */
  public static signRequest(input: AwsSigV4SignInput): AwsSigV4SignResult {
    const amzDate: string = AwsSecurityHubClient.toAmzDate(input.date);
    const dateStamp: string = amzDate.substring(0, 8);
    const region: string = input.region.trim().toLowerCase();
    const service: string = input.service.trim().toLowerCase();

    /*
     * Headers to sign: the caller's, plus host, x-amz-date and the session
     * token. Names are lowercased and sorted; values are trimmed with
     * internal runs of whitespace collapsed, per the canonical headers
     * rules.
     */
    const headerValues: Dictionary<string> = {};

    for (const name of Object.keys(input.headers || {})) {
      const value: string | undefined = (input.headers || {})[name];

      if (value === undefined || value === null) {
        continue;
      }

      headerValues[name.toLowerCase()] = String(value);
    }

    headerValues["host"] = input.host;
    headerValues["x-amz-date"] = amzDate;

    if (input.sessionToken) {
      headerValues["x-amz-security-token"] = input.sessionToken;
    }

    const signedHeaderNames: Array<string> = Object.keys(headerValues).sort();
    const canonicalHeaders: string = signedHeaderNames
      .map((name: string): string => {
        return `${name}:${(headerValues[name] || "").trim().replace(/\s+/g, " ")}\n`;
      })
      .join("");
    const signedHeaders: string = signedHeaderNames.join(";");

    // Query: each name and value URI-encoded, then sorted by encoded name.
    const canonicalQueryString: string = Object.keys(input.query || {})
      .map((name: string): [string, string] => {
        return [
          AwsSecurityHubClient.uriEncode(name),
          AwsSecurityHubClient.uriEncode((input.query || {})[name] || ""),
        ];
      })
      .sort((a: [string, string], b: [string, string]): number => {
        if (a[0] === b[0]) {
          return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
        }

        return a[0] < b[0] ? -1 : 1;
      })
      .map((pair: [string, string]): string => {
        return `${pair[0]}=${pair[1]}`;
      })
      .join("&");

    // Path: each segment URI-encoded once; "/" itself is never encoded.
    const canonicalUri: string =
      input.path === "" || input.path === "/"
        ? "/"
        : input.path
            .split("/")
            .map((segment: string): string => {
              return AwsSecurityHubClient.uriEncode(segment);
            })
            .join("/");

    const payloadHash: string = AwsSecurityHubClient.sha256Hex(input.body);

    const canonicalRequest: string = [
      input.method,
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const credentialScope: string = `${dateStamp}/${region}/${service}/${SIGV4_TERMINATOR}`;

    const stringToSign: string = [
      SIGV4_ALGORITHM,
      amzDate,
      credentialScope,
      AwsSecurityHubClient.sha256Hex(canonicalRequest),
    ].join("\n");

    const kDate: Buffer = AwsSecurityHubClient.hmac(
      `AWS4${input.secretAccessKey}`,
      dateStamp,
    );
    const kRegion: Buffer = AwsSecurityHubClient.hmac(kDate, region);
    const kService: Buffer = AwsSecurityHubClient.hmac(kRegion, service);
    const kSigning: Buffer = AwsSecurityHubClient.hmac(
      kService,
      SIGV4_TERMINATOR,
    );

    const signature: string = createHmac("sha256", kSigning)
      .update(stringToSign, "utf8")
      .digest("hex");

    const authorization: string = `${SIGV4_ALGORITHM} Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    /*
     * Outgoing headers keep the caller's original casing for their own
     * headers (HTTP is case-insensitive; the transport does not care) and
     * add the AWS ones in their conventional spelling.
     */
    const headers: Dictionary<string> = { ...(input.headers || {}) };
    headers["X-Amz-Date"] = amzDate;

    if (input.sessionToken) {
      headers["X-Amz-Security-Token"] = input.sessionToken;
    }

    headers["Authorization"] = authorization;

    return {
      headers,
      canonicalRequest,
      stringToSign,
      signature,
      amzDate,
      credentialScope,
    };
  }

  /*
   * ---------------------------------------------------------------------
   * Findings
   * ---------------------------------------------------------------------
   */

  /*
   * One page of findings created in the window. Pass `nextToken` from the
   * previous page to continue; the filter and sort are resent unchanged
   * with it, as the API requires the same query on every page.
   */
  public async getFindings(data: {
    startTime: Date;
    endTime: Date;
    maxResults?: number | undefined;
    nextToken?: string | null | undefined;
  }): Promise<AwsSecurityHubFindingsPage> {
    const bodyObject: JSONObject = AwsSecurityHubClient.buildFindingsBody({
      startTime: data.startTime,
      endTime: data.endTime,
      maxResults: data.maxResults || AWS_SECURITY_HUB_DEFAULT_PAGE_SIZE,
      nextToken: data.nextToken,
    });
    /*
     * The body is serialized once and that exact string is both hashed
     * into the signature and sent: a re-serialization by the transport
     * would change the payload hash and fail the signature check.
     */
    const bodyText: string = JSON.stringify(bodyObject);

    const signed: AwsSigV4SignResult = AwsSecurityHubClient.signRequest({
      method: "POST",
      host: this.getEndpointHost(),
      path: "/findings",
      headers: { "Content-Type": "application/json" },
      body: bodyText,
      accessKeyId: this.options.accessKeyId.trim(),
      secretAccessKey: this.options.secretAccessKey,
      sessionToken: this.options.sessionToken || undefined,
      region: this.options.region.trim(),
      service: AWS_SECURITY_HUB_SERVICE,
      date: this.options.now ? this.options.now() : new Date(),
    });

    const response: DataSourceHttpResponse = await this.send(
      {
        method: "POST",
        url: this.getFindingsUrl(),
        headers: signed.headers,
        body: bodyText,
      },
      FINDINGS_STEP,
    );

    const body: JSONObject = this.requireJsonObject(response, FINDINGS_STEP);
    const findingsRaw: unknown = body["Findings"];

    if (!Array.isArray(findingsRaw)) {
      throw new APIException(
        `AWS Security Hub ${FINDINGS_STEP} returned an unrecognized response shape: expected a "Findings" array, received keys ${this.scrub(
          AwsSecurityHubClient.describeKeys(body),
        )}.`,
      );
    }

    const findings: Array<JSONObject> = (
      findingsRaw as Array<JSONValue>
    ).filter((item: JSONValue): boolean => {
      return Boolean(item && typeof item === "object" && !Array.isArray(item));
    }) as Array<JSONObject>;

    const nextTokenRaw: unknown = body["NextToken"];
    const nextToken: string | null =
      typeof nextTokenRaw === "string" && nextTokenRaw.trim()
        ? nextTokenRaw
        : null;

    return { findings, nextToken };
  }

  /*
   * Bounded availability count: one page of `maxResults` findings created
   * in the window plus whether a further page exists. Never walks the
   * pages — a count is for the test checklist, not for import.
   */
  public async countFindingsCreated(data: {
    startTime: Date;
    endTime: Date;
    maxResults?: number | undefined;
  }): Promise<AwsSecurityHubFindingCount> {
    const page: AwsSecurityHubFindingsPage = await this.getFindings({
      startTime: data.startTime,
      endTime: data.endTime,
      maxResults: data.maxResults || AWS_SECURITY_HUB_DEFAULT_PAGE_SIZE,
    });

    return {
      count: page.findings.length,
      hasMore: page.nextToken !== null,
    };
  }

  /*
   * ---------------------------------------------------------------------
   * Transport plumbing
   * ---------------------------------------------------------------------
   */

  // Send and require a 2xx answer.
  private async send(
    request: DataSourceHttpRequest,
    stepLabel: string,
  ): Promise<DataSourceHttpResponse> {
    const response: DataSourceHttpResponse = await this.sendRaw(
      request,
      stepLabel,
    );

    this.assertOk(response, stepLabel);

    return response;
  }

  /*
   * Send and return whatever status came back. Transport failures that
   * carry an HTTP status are folded into a response; everything else
   * (connection refused, the transport's own timeout, the local deadline)
   * throws with the step in the prefix.
   */
  private async sendRaw(
    request: DataSourceHttpRequest,
    stepLabel: string,
  ): Promise<DataSourceHttpResponse> {
    this.requestCount++;

    const timeoutSeconds: number = Math.max(
      1,
      Math.round(this.requestTimeoutInMs / 1000),
    );
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;

    const deadline: Promise<never> = new Promise(
      (
        _resolve: (value: never | PromiseLike<never>) => void,
        reject: (reason?: unknown) => void,
      ): void => {
        timer = setTimeout((): void => {
          reject(
            new APIException(
              `AWS Security Hub ${stepLabel} timed out after ${timeoutSeconds} seconds with no response.`,
            ),
          );
        }, this.requestTimeoutInMs);
      },
    );

    try {
      return await Promise.race([
        this.options.transport({
          ...request,
          timeoutInMs: this.requestTimeoutInMs,
        }),
        deadline,
      ]);
    } catch (error) {
      return this.recoverResponse(error, stepLabel);
    } finally {
      clearTimeout(timer);
    }
  }

  private assertOk(response: DataSourceHttpResponse, stepLabel: string): void {
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return;
    }

    const code: string = AwsSecurityHubClient.errorCode(response);

    throw new AwsSecurityHubHttpError({
      message: `AWS Security Hub ${stepLabel} failed (HTTP ${response.statusCode}): ${this.scrub(
        AwsSecurityHubClient.describeBody(response),
      )}${AwsSecurityHubClient.hintForFailure(
        response.statusCode,
        code,
        response.bodyText || "",
      )}`,
      statusCode: response.statusCode,
      errorCode: code,
    });
  }

  /*
   * Belt and braces over the generic redaction. redactLogString masks
   * values whose KEY names a secret and a few self-identifying token
   * shapes, but a body or proxy error that reflects the bare secret with
   * no label around it would pass straight through. This client knows the
   * exact secret values it holds, so every message it throws has them
   * replaced whatever the surrounding text looks like.
   */
  private scrub(text: string): string {
    let result: string = text;

    for (const secret of [
      this.options.secretAccessKey,
      this.options.sessionToken || "",
    ]) {
      if (secret && secret.length >= 8 && result.includes(secret)) {
        result = result.split(secret).join(REDACTED);
      }
    }

    return result;
  }

  /*
   * The production transport does not return error statuses — it throws
   * `Data source responded with HTTP <status>: <body>`. Recover the status
   * so the operator sees the same "(HTTP 403)" prefix whichever transport
   * is behind the client, and the docs' troubleshooting keys stay true.
   */
  private recoverResponse(
    error: unknown,
    stepLabel: string,
  ): DataSourceHttpResponse {
    if (error instanceof APIException) {
      throw error;
    }

    const message: string =
      error instanceof Error ? error.message : String(error || "");
    const match: RegExpMatchArray | null = message.match(
      TRANSPORT_HTTP_ERROR_REGEX,
    );

    if (match) {
      const bodyText: string = match[2] || "";
      let bodyJson: unknown = undefined;

      try {
        bodyJson = JSON.parse(bodyText);
      } catch {
        bodyJson = undefined;
      }

      return { statusCode: Number(match[1]), bodyText, bodyJson };
    }

    throw new APIException(
      `AWS Security Hub ${stepLabel} failed: ${this.scrub(
        redactLogString(message || "unknown transport error"),
      ).substring(0, 500)}`,
    );
  }

  private requireJsonObject(
    response: DataSourceHttpResponse,
    stepLabel: string,
  ): JSONObject {
    const body: unknown = response.bodyJson;

    if (body === undefined || body === null) {
      throw new APIException(
        `AWS Security Hub ${stepLabel} returned a non-JSON body: ${this.scrub(
          redactLogString((response.bodyText || "").substring(0, 200)),
        )}`,
      );
    }

    if (typeof body !== "object" || Array.isArray(body)) {
      throw new APIException(
        `AWS Security Hub ${stepLabel} returned an unrecognized response shape: expected a JSON object, received ${Array.isArray(body) ? "an array" : typeof body}.`,
      );
    }

    return body as JSONObject;
  }

  /*
   * A body excerpt safe to store: structurally redacted when it parsed as
   * JSON (so any key that names a secret is masked whatever its value
   * looks like), textually redacted otherwise, and clipped.
   */
  private static describeBody(response: {
    statusCode: number;
    bodyText: string;
    bodyJson: unknown;
  }): string {
    if (response.bodyJson !== undefined && response.bodyJson !== null) {
      const redacted: unknown = redactLogValue(response.bodyJson);
      let serialized: string = "";

      try {
        serialized = JSON.stringify(redacted);
      } catch {
        serialized = "[unserializable body]";
      }

      return serialized.substring(0, 500);
    }

    const text: string = (response.bodyText || "").trim();

    return text
      ? redactLogString(text).substring(0, 500)
      : "(empty response body)";
  }

  private static describeKeys(body: JSONObject): string {
    const keys: Array<string> = Object.keys(body).slice(0, 10);

    return keys.length ? keys.join(", ") : "(none)";
  }

  /*
   * The AWS error code of a failed response. REST-JSON services put it in
   * the x-amzn-errortype header (sometimes suffixed with ":http://..."),
   * and in the body as "__type" (sometimes namespace-qualified, e.g.
   * "com.amazon.coral.service#UnrecognizedClientException") or "Code".
   * When neither is present — the production transport drops headers —
   * the code is recovered from AWS's own message wording (see
   * MESSAGE_ERROR_CODES), so a signature rejection is still named.
   */
  public static errorCode(response: {
    bodyJson: unknown;
    bodyText?: string | undefined;
    headers?: Dictionary<string> | undefined;
  }): string {
    const fromHeader: string = String(
      (response.headers || {})["x-amzn-errortype"] || "",
    );
    const body: JSONObject | null =
      response.bodyJson &&
      typeof response.bodyJson === "object" &&
      !Array.isArray(response.bodyJson)
        ? (response.bodyJson as JSONObject)
        : null;
    const fromBody: string = body
      ? String(body["__type"] || body["Code"] || body["code"] || "")
      : "";

    const raw: string = fromHeader || fromBody;
    const withoutUri: string = raw.split(":")[0] || "";
    const hashIndex: number = withoutUri.lastIndexOf("#");
    const declared: string =
      hashIndex === -1
        ? withoutUri.trim()
        : withoutUri.substring(hashIndex + 1).trim();

    if (declared) {
      return declared;
    }

    return AwsSecurityHubClient.errorCodeFromMessage(
      AwsSecurityHubClient.messageText(response),
    );
  }

  // The code AWS's wording stands for, or "" when the text names none.
  public static errorCodeFromMessage(text: string): string {
    for (const entry of MESSAGE_ERROR_CODES) {
      if (entry.pattern.test(text)) {
        return entry.code;
      }
    }

    return "";
  }

  // The body's message field when it has one, else the raw body text.
  private static messageText(response: {
    bodyJson: unknown;
    bodyText?: string | undefined;
  }): string {
    const body: JSONObject | null =
      response.bodyJson &&
      typeof response.bodyJson === "object" &&
      !Array.isArray(response.bodyJson)
        ? (response.bodyJson as JSONObject)
        : null;
    const fromBody: unknown = body
      ? body["message"] || body["Message"]
      : undefined;

    if (typeof fromBody === "string" && fromBody.trim()) {
      return fromBody;
    }

    return response.bodyText || "";
  }

  public static isSignatureErrorCode(code: string): boolean {
    return SIGNATURE_ERROR_CODES.includes(code);
  }

  // See classifyAwsSecurityHubFailure.
  public static classifyFailure(
    status: number,
    code: string,
  ): AwsSecurityHubFailureKind {
    return classifyAwsSecurityHubFailure(status, code);
  }

  /*
   * What the status most likely means, in the operator's terms. The hint
   * never repeats the body; `bodyText` only tells a clock rejection apart
   * from a key rejection that shares its error code.
   */
  public static hintForFailure(
    status: number,
    code: string,
    bodyText: string = "",
  ): string {
    const hint: string = AwsSecurityHubClient.hintText(status, code, bodyText);

    return hint ? ` — ${hint}` : "";
  }

  private static hintText(
    status: number,
    code: string,
    bodyText: string,
  ): string {
    if (AwsSecurityHubClient.isSignatureErrorCode(code)) {
      if (
        code === "UnrecognizedClientException" ||
        code === "InvalidClientTokenId" ||
        code === "InvalidAccessKeyId"
      ) {
        return "AWS does not recognize the Access key ID (or the session token sent with it). Check the id; for temporary credentials paste the matching session token, and for a long-lived AKIA key leave the session token empty.";
      }

      if (code === "ExpiredTokenException" || code === "ExpiredToken") {
        return "The temporary credentials have expired. Issue new credentials with STS and update the connection, or use a long-lived access key.";
      }

      /*
       * "Signature expired" arrives as InvalidSignatureException, the
       * same code as a wrong secret; only the wording says the clock.
       */
      if (
        code === "RequestExpired" ||
        code === "RequestTimeTooSkewed" ||
        CLOCK_MESSAGE_REGEX.test(bodyText)
      ) {
        return "AWS rejected the request time; the OneUptime server clock is more than 5 minutes off. Fix NTP on the app and worker hosts.";
      }

      return "AWS rejected the request signature. The Secret access key does not match the Access key ID (or the session token is missing for an ASIA... key). Create a new access key and update the connection.";
    }

    if (code === "InvalidAccessException") {
      return "Security Hub is not enabled for this account in this Region, or the account is not a Security Hub administrator here. Enable Security Hub in the Region, or point the connection at the administrator account's home Region.";
    }

    if (code === "AccessDeniedException") {
      return "AWS verified the signature, but the IAM identity is not allowed to call securityhub:GetFindings. Attach a policy that allows securityhub:GetFindings (for example the AWSSecurityHubReadOnlyAccess managed policy) to the user or role.";
    }

    if (status === 403) {
      return "AWS refused the request without naming an error code, so it is not known whether the credentials or the IAM policy were rejected. Check the Access key ID, the Secret access key and the Session token first (empty for an AKIA key, required for an ASIA key), then that the identity is allowed securityhub:GetFindings.";
    }

    if (status === 401) {
      return "AWS refused the credentials. Check the Access key ID and Secret access key.";
    }

    if (status === 404) {
      return "No Security Hub endpoint answered at this Region. Check the Region code.";
    }

    if (
      status === 429 ||
      code === "LimitExceededException" ||
      code === "ThrottlingException"
    ) {
      return "Security Hub is throttling GetFindings (3 requests per second per account and Region); the next poll retries.";
    }

    if (status >= 500) {
      return "Security Hub reported a server-side problem; the next poll retries.";
    }

    if (status === 400) {
      return "Security Hub rejected the request. The findings query is built by the connector, not from your settings; report this message to OneUptime support.";
    }

    return "";
  }
}
