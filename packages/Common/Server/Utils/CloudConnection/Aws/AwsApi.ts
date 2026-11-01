import { createHash } from "crypto";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { DataSourceHttpResponse } from "../../DataSource/HttpFetch";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import LlmProviderHttp, {
  LLM_PROVIDER_DEFAULT_TIMEOUT_IN_MS,
} from "../../LlmObservability/LlmProviderHttp";
import AwsSecurityHubClient, {
  AwsSigV4SignResult,
} from "../../SecurityEvent/Connectors/AwsSecurityHub/AwsSecurityHubClient";
import {
  CLOUD_DEFAULT_SLEEP,
  CloudConnectorTransport,
  CloudReadBudget,
  CloudReadBudgetSpent,
} from "../CloudConnectorTypes";

/*
 * ONE SIGNED REQUEST TO AN AWS API, the way every AWS call of a cloud
 * connection is made: signed with Signature Version 4 (the signer the AWS
 * Security Hub connector checks against AWS's published test vectors),
 * sent through the injected transport, retried a few times when AWS asks
 * to slow down, and answered as a JSON object - or an LlmProviderError
 * whose message names the step and carries no secret, classified by the
 * error code AWS answered with.
 *
 * Two protocols are spoken:
 *
 *   - JSON (CloudWatch's AWS JSON 1.0, the Resource Groups Tagging API's
 *     1.1): POST / with X-Amz-Target and a JSON body; errors carry
 *     "__type": "...#Code".
 *   - Query (STS): POST / with a form body; answers and errors are XML,
 *     read here with a plain tag scan.
 *
 * and, for the APIs addressed by their path (S3, S3 Control, OpenSearch
 * Service, EFS), REST: sendAwsRestRequest below.
 */

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
}

// The partitions OneUptime reads, and their domain.
export type AwsPartition = "aws" | "aws-us-gov" | "aws-cn";

export function getAwsPartition(region: string): AwsPartition {
  const value: string = region.trim().toLowerCase();

  if (value.startsWith("cn-")) {
    return "aws-cn";
  }

  if (value.startsWith("us-gov-")) {
    return "aws-us-gov";
  }

  return "aws";
}

export function getAwsHost(service: string, region: string): string {
  const trimmed: string = region.trim();

  return `${service}.${trimmed}.${
    getAwsPartition(trimmed) === "aws-cn" ? "amazonaws.com.cn" : "amazonaws.com"
  }`;
}

// The error codes that mean the credential or its signature was refused.
const AUTHENTICATION_CODES: Array<string> = [
  "UnrecognizedClientException",
  "InvalidClientTokenId",
  "InvalidSignatureException",
  "SignatureDoesNotMatch",
  "IncompleteSignature",
  "IncompleteSignatureException",
  "ExpiredToken",
  "ExpiredTokenException",
  "MissingAuthenticationToken",
  "MissingAuthenticationTokenException",
  "RequestExpired",
  "AuthFailure",
];

const PERMISSION_CODES: Array<string> = [
  "AccessDenied",
  "AccessDeniedException",
  "UnauthorizedOperation",
  "AuthorizationError",
];

const THROTTLING_CODES: Array<string> = [
  "Throttling",
  "ThrottlingException",
  "ThrottledException",
  "TooManyRequestsException",
  "RequestLimitExceeded",
  "LimitExceededException",
];

// Retries after a throttled answer, and the first wait.
const THROTTLE_RETRIES: number = 3;
const THROTTLE_FIRST_WAIT_MS: number = 1000;

/*
 * The text between <tag> and </tag>, first occurrence, with the five XML
 * entities decoded - "" when absent. A linear scan with indexOf: the text
 * is a provider's answer.
 */
export function readXmlTag(xml: string, tag: string): string {
  const open: string = `<${tag}>`;
  const start: number = xml.indexOf(open);

  if (start < 0) {
    return "";
  }

  const valueStart: number = start + open.length;
  const end: number = xml.indexOf(`</${tag}>`, valueStart);

  if (end < 0) {
    return "";
  }

  return xml
    .slice(valueStart, end)
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
 * The error code of an AWS answer: JSON's "__type" after '#'
 * ("com.amazonaws...#AccessDeniedException"), or XML's <Code>. "" when the
 * answer names none.
 */
export function awsErrorCodeOf(body: string): string {
  const text: string = (body || "").trim();

  if (text.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(text);
      const type: unknown =
        parsed && typeof parsed === "object"
          ? (parsed as JSONObject)["__type"] || (parsed as JSONObject)["code"]
          : "";

      if (typeof type === "string") {
        const hashIndex: number = type.lastIndexOf("#");
        return hashIndex >= 0 ? type.substring(hashIndex + 1) : type;
      }
    } catch {
      return "";
    }

    return "";
  }

  return readXmlTag(text, "Code");
}

// What a failed AWS call means, read from the code it answered with.
export function classifyAwsError(data: {
  error: unknown;
  step: string;
  providerTitle: string;
  secretValues: Array<string>;
}): LlmProviderError {
  const failure: LlmProviderError =
    data.error instanceof LlmProviderError
      ? data.error
      : LlmProviderError.from({
          error: data.error,
          step: data.step,
          providerTitle: data.providerTitle,
          secretValues: data.secretValues,
        });

  const code: string = awsErrorCodeOf(failure.responseBody || "");

  let kind: CloudConnectionFailureKind = failure.kind;

  if (AUTHENTICATION_CODES.includes(code)) {
    kind = CloudConnectionFailureKind.Authentication;
  } else if (PERMISSION_CODES.includes(code)) {
    kind = CloudConnectionFailureKind.Permission;
  } else if (THROTTLING_CODES.includes(code)) {
    kind = CloudConnectionFailureKind.RateLimited;
  }

  return new LlmProviderError({
    message: failure.message,
    kind,
    statusCode: failure.statusCode,
    responseBody: failure.responseBody,
  });
}

export interface AwsRequest {
  transport: CloudConnectorTransport;
  credentials: AwsCredentials;
  service: string;
  region: string;
  /*
   * The host, for a service with one global endpoint that is not
   * service.region.amazonaws.com (IAM: iam.amazonaws.com, signed for
   * us-east-1). Every other call is sent to its Region's own host.
   */
  host?: string | undefined;
  // JSON protocol: the X-Amz-Target; query protocol: absent.
  target?: string | undefined;
  // "1.0" (CloudWatch) or "1.1" (Tagging API); JSON protocol only.
  jsonVersion?: "1.0" | "1.1" | undefined;
  // JSON protocol: the request object; query protocol: the form fields.
  body: JSONObject | Dictionary<string>;
  step: string;
  providerTitle: string;
  now?: (() => Date) | undefined;
  timeoutInMs?: number | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  budget?: CloudReadBudget | undefined;
}

function formEncode(fields: Dictionary<string>): string {
  return Object.keys(fields)
    .map((key: string): string => {
      return `${AwsSecurityHubClient.uriEncode(key)}=${AwsSecurityHubClient.uriEncode(
        fields[key] || "",
      )}`;
    })
    .join("&");
}

/*
 * Sends one signed request; JSON protocol answers are parsed, query
 * protocol answers are returned as text (XML).
 */
export async function sendAwsRequest(
  request: AwsRequest,
): Promise<{ json: JSONObject; text: string }> {
  const isJson: boolean = Boolean(request.target);
  const host: string =
    request.host || getAwsHost(request.service, request.region);
  const body: string = isJson
    ? JSON.stringify(request.body)
    : formEncode(request.body as Dictionary<string>);
  const headers: Dictionary<string> = isJson
    ? {
        "Content-Type": `application/x-amz-json-${request.jsonVersion || "1.0"}`,
        "X-Amz-Target": request.target!,
        Accept: "application/json",
      }
    : {
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        Accept: "application/xml",
      };
  const secrets: Array<string> = [
    request.credentials.secretAccessKey,
    ...(request.credentials.sessionToken
      ? [request.credentials.sessionToken]
      : []),
  ];
  const sleep: (milliseconds: number) => Promise<void> =
    request.sleep || CLOUD_DEFAULT_SLEEP;

  for (let attempt: number = 0; ; attempt++) {
    if (request.budget && !request.budget.take()) {
      throw new CloudReadBudgetSpent();
    }

    const signed: AwsSigV4SignResult = AwsSecurityHubClient.signRequest({
      method: "POST",
      host,
      path: "/",
      headers,
      body,
      accessKeyId: request.credentials.accessKeyId.trim(),
      secretAccessKey: request.credentials.secretAccessKey,
      sessionToken: request.credentials.sessionToken,
      region: request.region.trim(),
      service: request.service,
      date: request.now ? request.now() : new Date(),
    });

    try {
      const response: DataSourceHttpResponse = await LlmProviderHttp.send({
        transport: request.transport,
        method: "POST",
        url: `https://${host}/`,
        headers: signed.headers,
        body,
        timeoutInMs: request.timeoutInMs,
        step: request.step,
        providerTitle: request.providerTitle,
        secretValues: secrets,
      });

      const json: JSONObject =
        response.bodyJson &&
        typeof response.bodyJson === "object" &&
        !Array.isArray(response.bodyJson)
          ? (response.bodyJson as JSONObject)
          : {};

      return { json, text: response.bodyText || "" };
    } catch (error) {
      const failure: LlmProviderError = classifyAwsError({
        error,
        step: request.step,
        providerTitle: request.providerTitle,
        secretValues: secrets,
      });

      if (
        failure.kind === CloudConnectionFailureKind.RateLimited &&
        attempt < THROTTLE_RETRIES
      ) {
        await sleep(THROTTLE_FIRST_WAIT_MS * Math.pow(2, attempt));
        continue;
      }

      throw failure;
    }
  }
}

/*
 * XML ELEMENTS, EVERY ONE OF THEM: the repeated <Bucket> of a listing, the
 * <Grant> of an ACL, the <DBInstance> of a page. readXmlTag above reads
 * one value; these read a document the way the answers of S3, RDS and
 * Redshift are written:
 *
 *   - an element may carry attributes (<Grantee xsi:type="Group">, an
 *     xmlns on the root) and may be empty (<LocationConstraint/>);
 *   - a name is matched whole: <Bucket> is never <Buckets>, <Cluster>
 *     never <ClusterNode>;
 *   - an element of the same name inside another is counted, so the outer
 *     one ends at its own closing tag;
 *   - a leaf's text comes back with the five entities decoded and trimmed,
 *     like readXmlTag's; a parent's content comes back as it is, for its
 *     own leaves to be read - decoded once, never twice.
 *
 * Linear scans with indexOf: the text is a provider's answer.
 */

function isXmlNameEnd(character: string): boolean {
  return (
    character === "" ||
    character === ">" ||
    character === "/" ||
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r"
  );
}

function decodeXmlText(text: string): string {
  return text
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

// A leaf's text decoded; a parent's content as written.
function xmlContent(content: string): string {
  return content.indexOf("<") >= 0 ? content.trim() : decodeXmlText(content);
}

// The longest element name read: AWS's are a few dozen characters.
const MAX_XML_NAME_LENGTH: number = 256;

// The name of the element whose "<" is at `start`, or "" when none is there.
function readXmlName(xml: string, start: number): string {
  let end: number = start + 1;

  while (
    end < xml.length &&
    end - start <= MAX_XML_NAME_LENGTH &&
    !isXmlNameEnd(xml.charAt(end))
  ) {
    end++;
  }

  return xml.slice(start + 1, end);
}

/*
 * Where the element named `name` that opens at `start` has its content and
 * ends: past "/>" for an empty one, else past its own closing tag, with
 * elements of the same name inside it counted. Null when it never closes.
 */
function findXmlElement(
  xml: string,
  start: number,
  name: string,
): { contentStart: number; contentEnd: number; end: number } | null {
  const openEnd: number = xml.indexOf(">", start);

  if (openEnd < 0) {
    return null;
  }

  if (xml.charAt(openEnd - 1) === "/") {
    return {
      contentStart: openEnd + 1,
      contentEnd: openEnd + 1,
      end: openEnd + 1,
    };
  }

  const open: string = `<${name}`;
  const close: string = `</${name}>`;
  let depth: number = 1;
  let cursor: number = openEnd + 1;

  for (;;) {
    const nextClose: number = xml.indexOf(close, cursor);

    if (nextClose < 0) {
      return null;
    }

    // An element of the same name opened inside, before this closing tag.
    let nested: number = -1;
    let search: number = cursor;

    for (;;) {
      const candidate: number = xml.indexOf(open, search);

      if (candidate < 0 || candidate >= nextClose) {
        break;
      }

      if (isXmlNameEnd(xml.charAt(candidate + open.length))) {
        const candidateEnd: number = xml.indexOf(">", candidate);

        if (candidateEnd > 0 && xml.charAt(candidateEnd - 1) !== "/") {
          nested = candidate;
          break;
        }
      }

      search = candidate + open.length;
    }

    if (nested >= 0) {
      depth++;
      cursor = xml.indexOf(">", nested) + 1;
      continue;
    }

    depth--;

    if (depth === 0) {
      return {
        contentStart: openEnd + 1,
        contentEnd: nextClose,
        end: nextClose + close.length,
      };
    }

    cursor = nextClose + close.length;
  }
}

// Every <tag> element of the text, at any depth, in document order.
export function readXmlTags(xml: string, tag: string): Array<string> {
  const values: Array<string> = [];
  const open: string = `<${tag}`;
  const text: string = xml || "";
  let cursor: number = 0;

  for (;;) {
    const start: number = text.indexOf(open, cursor);

    if (start < 0) {
      return values;
    }

    if (!isXmlNameEnd(text.charAt(start + open.length))) {
      cursor = start + open.length;
      continue;
    }

    const element: {
      contentStart: number;
      contentEnd: number;
      end: number;
    } | null = findXmlElement(text, start, tag);

    if (!element) {
      return values;
    }

    values.push(
      xmlContent(text.slice(element.contentStart, element.contentEnd)),
    );
    cursor = element.end;
  }
}

/*
 * The <tag> elements directly inside the content given - an item's own
 * fields, never the ones of an element inside it (RDS and Redshift repeat
 * BackupRetentionPeriod and PubliclyAccessible inside PendingModifiedValues,
 * a change not yet made).
 */
export function readXmlChildren(xml: string, tag: string): Array<string> {
  const values: Array<string> = [];
  const text: string = xml || "";
  let cursor: number = 0;

  while (cursor < text.length) {
    const start: number = text.indexOf("<", cursor);

    if (start < 0) {
      break;
    }

    const next: string = text.charAt(start + 1);

    // A declaration, a comment or a stray closing tag: not an element.
    if (next === "?" || next === "!" || next === "/") {
      const end: number = text.indexOf(">", start);

      if (end < 0) {
        break;
      }

      cursor = end + 1;
      continue;
    }

    const name: string = readXmlName(text, start);

    if (!name) {
      cursor = start + 1;
      continue;
    }

    const element: {
      contentStart: number;
      contentEnd: number;
      end: number;
    } | null = findXmlElement(text, start, name);

    if (!element) {
      break;
    }

    if (name === tag) {
      values.push(
        xmlContent(text.slice(element.contentStart, element.contentEnd)),
      );
    }

    cursor = element.end;
  }

  return values;
}

/*
 * ONE SIGNED REQUEST TO A REST API OF AWS: one addressed by its path rather
 * than by an action - S3 (GET /<bucket>?policy, path style, at the
 * bucket's own Region: one signed for another Region is redirected, not
 * answered), S3 Control, and the REST-JSON APIs (OpenSearch Service's
 * /2021-01-01/domain, EFS's /2015-02-01/file-systems). A PUT writes an S3
 * setting (a data security response's Block Public Access), its XML body
 * sent with the Content-MD5 S3 asks such a write for.
 *
 * Signed like every other call (Signature Version 4, the payload's hash in
 * x-amz-content-sha256 as S3 requires), retried while AWS asks to slow
 * down - S3 says SlowDown - and held to the read's budget, one request per
 * try. The answer is its status, the few headers a reader uses, and the
 * body as text and as bytes, at most maxBodyBytes of it. The bytes are
 * the body's own when the request keeps them (keepBytes: an object's
 * content, which need not be text - a gzip, a spreadsheet); a
 * configuration answer is text, and its bytes are that text's UTF-8.
 *
 * Errors are classified as the other protocols' are (classifyAwsError),
 * with what S3 and the REST-JSON APIs say instead of the codes those know:
 * an access key S3 does not know (InvalidAccessKeyId), and a refused token
 * the REST-JSON APIs name only in their message.
 */

// S3's codes for a credential it does not accept, and for "slow down".
const REST_AUTHENTICATION_CODES: Array<string> = [
  "InvalidAccessKeyId",
  "InvalidToken",
  "TokenRefreshRequired",
];
const REST_THROTTLING_CODES: Array<string> = ["SlowDown"];

/*
 * What the REST-JSON APIs say of a credential they refuse, in the body's
 * message (their error code is in a header the transport does not keep).
 */
const REST_AUTHENTICATION_MESSAGES: Array<string> = [
  "security token included in the request is invalid",
  "security token included in the request is expired",
  "signature we calculated does not match",
];

// The headers an answer is read with; the others are not kept.
const REST_RESPONSE_HEADERS: Array<string> = [
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
  "x-amz-bucket-region",
];

// The most of a body kept: AWS's configuration answers are kilobytes.
export const AWS_REST_MAX_BODY_BYTES: number = 5 * 1024 * 1024;

export interface AwsRestRequest {
  transport: CloudConnectorTransport;
  credentials: AwsCredentials;
  // The name requests are signed for: "s3" (S3 and S3 Control), "es", "elasticfilesystem".
  service: string;
  // The Region signed for and sent to: an S3 bucket's own.
  region: string;
  // The host; service.region.amazonaws.com (or .com.cn) when absent.
  host?: string | undefined;
  // GET when absent; POST carries a JSON body, PUT an XML one (an S3 setting).
  method?: "GET" | "POST" | "PUT" | undefined;
  /*
   * The path, not encoded: "/", "/<bucket>", "/<bucket>/<key>". Each
   * segment is encoded once, as S3 signs it.
   */
  path: string;
  // Query parameters, not encoded; a subresource is a name with "" ({ policy: "" }).
  query?: Dictionary<string> | undefined;
  // Headers to send and sign: Range, x-amz-account-id.
  headers?: Dictionary<string> | undefined;
  // A POST's body (JSON) or a PUT's (XML).
  body?: string | undefined;
  // The most of the body kept; AWS_REST_MAX_BODY_BYTES when absent.
  maxBodyBytes?: number | undefined;
  /*
   * Keep the body's own bytes for `bytes` (the transport's bodyBytes): an
   * object's content, read as it is stored. Off for configuration answers,
   * which are text.
   */
  keepBytes?: boolean | undefined;
  step: string;
  providerTitle: string;
  now?: (() => Date) | undefined;
  timeoutInMs?: number | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  budget?: CloudReadBudget | undefined;
}

export interface AwsRestResponse {
  status: number;
  // Lowercased names, only REST_RESPONSE_HEADERS.
  headers: Dictionary<string>;
  text: string;
  /*
   * The body's own bytes when the request kept them and the transport
   * handed them over, else its text's UTF-8.
   */
  bytes: Uint8Array;
  // The body parsed, when it is a JSON object kept whole.
  json: JSONObject | undefined;
  // Whether the body was longer than maxBodyBytes, and cut.
  truncated: boolean;
}

function encodeAwsPath(path: string): string {
  if (path === "" || path === "/") {
    return "/";
  }

  return path
    .split("/")
    .map((segment: string): string => {
      return AwsSecurityHubClient.uriEncode(segment);
    })
    .join("/");
}

function encodeAwsQuery(query: Dictionary<string>): string {
  return Object.keys(query)
    .sort()
    .map((name: string): string => {
      return `${AwsSecurityHubClient.uriEncode(name)}=${AwsSecurityHubClient.uriEncode(
        query[name] || "",
      )}`;
    })
    .join("&");
}

// What a failed REST call means, with S3's and the REST-JSON APIs' own words.
export function classifyAwsRestError(data: {
  error: unknown;
  step: string;
  providerTitle: string;
  secretValues: Array<string>;
}): LlmProviderError {
  const failure: LlmProviderError = classifyAwsError(data);
  const body: string = failure.responseBody || "";
  const code: string = awsErrorCodeOf(body);
  const lowered: string = body.toLowerCase();
  let kind: CloudConnectionFailureKind = failure.kind;

  if (
    REST_AUTHENTICATION_CODES.includes(code) ||
    REST_AUTHENTICATION_MESSAGES.some((message: string): boolean => {
      return lowered.includes(message);
    })
  ) {
    kind = CloudConnectionFailureKind.Authentication;
  } else if (REST_THROTTLING_CODES.includes(code)) {
    kind = CloudConnectionFailureKind.RateLimited;
  }

  if (kind === failure.kind) {
    return failure;
  }

  return new LlmProviderError({
    message: failure.message,
    kind,
    statusCode: failure.statusCode,
    responseBody: failure.responseBody,
  });
}

/*
 * A PUT through the transport, held to the deadline LlmProviderHttp.send
 * holds a GET or a POST to (those two are what it sends), and failing as
 * they do.
 */
async function sendPut(data: {
  transport: CloudConnectorTransport;
  url: string;
  headers: Dictionary<string>;
  body: string;
  timeoutInMs?: number | undefined;
  step: string;
  providerTitle: string;
  secretValues: Array<string>;
}): Promise<DataSourceHttpResponse> {
  const timeoutInMs: number =
    data.timeoutInMs && data.timeoutInMs > 0
      ? data.timeoutInMs
      : LLM_PROVIDER_DEFAULT_TIMEOUT_IN_MS;
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;
  const deadline: Promise<never> = new Promise<never>(
    (_resolve: (value: never) => void, reject: (reason: Error) => void) => {
      timer = setTimeout(() => {
        reject(
          new LlmProviderError({
            message: `${data.providerTitle} ${data.step} timed out after ${Math.round(
              timeoutInMs / 1000,
            )} seconds.`,
            kind: CloudConnectionFailureKind.Unavailable,
          }),
        );
      }, timeoutInMs + 1000);
    },
  );

  try {
    return await Promise.race([
      data.transport({
        method: "PUT",
        url: data.url,
        headers: data.headers,
        body: data.body,
        timeoutInMs,
      }),
      deadline,
    ]);
  } catch (error) {
    throw LlmProviderError.from({
      error,
      step: data.step,
      providerTitle: data.providerTitle,
      secretValues: data.secretValues,
    });
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function sendAwsRestRequest(
  request: AwsRestRequest,
): Promise<AwsRestResponse> {
  const method: "GET" | "POST" | "PUT" = request.method || "GET";
  const host: string =
    request.host || getAwsHost(request.service, request.region);
  const body: string = method === "GET" ? "" : request.body || "";
  const payloadHash: string = createHash("sha256")
    .update(body, "utf8")
    .digest("hex");
  const headers: Dictionary<string> = {
    ...(request.headers || {}),
    "x-amz-content-sha256": payloadHash,
    ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    /*
     * S3 takes a setting's PUT only with the body's MD5 (Content-MD5): its
     * check that the body arrived as it was sent.
     */
    ...(method === "PUT"
      ? {
          "Content-Type": "application/xml",
          "Content-MD5": createHash("md5")
            .update(body, "utf8")
            .digest("base64"),
        }
      : {}),
  };
  const query: Dictionary<string> = request.query || {};
  const queryString: string = encodeAwsQuery(query);
  const url: string = `https://${host}${encodeAwsPath(request.path)}${
    queryString ? `?${queryString}` : ""
  }`;
  const maxBodyBytes: number = Math.max(
    0,
    request.maxBodyBytes ?? AWS_REST_MAX_BODY_BYTES,
  );
  const secrets: Array<string> = [
    request.credentials.secretAccessKey,
    ...(request.credentials.sessionToken
      ? [request.credentials.sessionToken]
      : []),
  ];
  const sleep: (milliseconds: number) => Promise<void> =
    request.sleep || CLOUD_DEFAULT_SLEEP;

  for (let attempt: number = 0; ; attempt++) {
    if (request.budget && !request.budget.take()) {
      throw new CloudReadBudgetSpent();
    }

    const signed: AwsSigV4SignResult = AwsSecurityHubClient.signRequest({
      method,
      host,
      path: request.path || "/",
      query,
      headers,
      body,
      payloadHash,
      accessKeyId: request.credentials.accessKeyId.trim(),
      secretAccessKey: request.credentials.secretAccessKey,
      sessionToken: request.credentials.sessionToken,
      region: request.region.trim(),
      service: request.service,
      date: request.now ? request.now() : new Date(),
    });

    try {
      const response: DataSourceHttpResponse =
        method === "PUT"
          ? await sendPut({
              transport: request.transport,
              url,
              headers: signed.headers,
              body,
              timeoutInMs: request.timeoutInMs,
              step: request.step,
              providerTitle: request.providerTitle,
              secretValues: secrets,
            })
          : await LlmProviderHttp.send({
              transport: request.transport,
              method,
              url,
              headers: signed.headers,
              body: method === "POST" ? body : undefined,
              timeoutInMs: request.timeoutInMs,
              ...(request.keepBytes ? { keepBodyBytes: true } : {}),
              step: request.step,
              providerTitle: request.providerTitle,
              secretValues: secrets,
            });

      // The body as stored when it was kept, else its text's UTF-8.
      const whole: Buffer =
        request.keepBytes && response.bodyBytes
          ? response.bodyBytes
          : Buffer.from(response.bodyText || "", "utf8");
      const truncated: boolean = whole.length > maxBodyBytes;
      const kept: Buffer = truncated ? whole.subarray(0, maxBodyBytes) : whole;
      const answerHeaders: Dictionary<string> = {};

      for (const name of REST_RESPONSE_HEADERS) {
        const value: string | undefined = (response.headers || {})[name];

        if (value !== undefined) {
          answerHeaders[name] = value;
        }
      }

      return {
        status: response.statusCode,
        headers: answerHeaders,
        text: truncated ? kept.toString("utf8") : response.bodyText || "",
        bytes: new Uint8Array(kept),
        json:
          !truncated &&
          response.bodyJson &&
          typeof response.bodyJson === "object" &&
          !Array.isArray(response.bodyJson)
            ? (response.bodyJson as JSONObject)
            : undefined,
        truncated,
      };
    } catch (error) {
      const failure: LlmProviderError = classifyAwsRestError({
        error,
        step: request.step,
        providerTitle: request.providerTitle,
        secretValues: secrets,
      });

      if (
        failure.kind === CloudConnectionFailureKind.RateLimited &&
        attempt < THROTTLE_RETRIES
      ) {
        await sleep(THROTTLE_FIRST_WAIT_MS * Math.pow(2, attempt));
        continue;
      }

      throw failure;
    }
  }
}
