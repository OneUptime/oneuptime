import { createHash } from "crypto";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import RetryAfter from "../../../../Utils/RetryAfter";
import {
  DataSourceHttpResponse,
  getDataSourceHttpStatusError,
} from "../../DataSource/HttpFetch";
import { asSentence, withAttempts } from "../../DataSource/HttpFailure";
import { HttpRetryReason, HttpRetryVerdict } from "../../DataSource/HttpRetry";
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
import {
  AWS_RETRY_AFTER_HEADER,
  AwsRetryExchange,
  exchangeWithAwsRetries,
  getAwsRetryQuota,
  isAwsReadAction,
} from "./AwsRetry";

/*
 * ONE SIGNED REQUEST TO AN AWS API, the way every AWS call of a cloud
 * connection is made: signed with Signature Version 4 (the signer the AWS
 * Security Hub connector checks against AWS's published test vectors),
 * sent through the injected transport, asked again as the AWS SDKs'
 * standard retry mode asks - after a throttle, and after a failure for now
 * when sending it again is safe (AwsRetry) - and answered as a JSON object
 * - or an LlmProviderError whose message names the step and carries no
 * secret, classified by the error code AWS answered with.
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

/*
 * The error codes the AWS SDKs' standard retry mode waits out as throttling
 * ("Retry behavior", AWS SDKs and Tools Reference Guide): the service
 * turned the request away before doing it. Athena answers
 * TooManyRequestsException and Glue ThrottlingException, both as 400s, and
 * S3 SlowDown as a 503. A 5xx with one of these is a throttle.
 */
export const AWS_THROTTLING_ERROR_CODES: ReadonlyArray<string> = [
  "Throttling",
  "ThrottlingException",
  "ThrottledException",
  "RequestThrottledException",
  "TooManyRequestsException",
  "ProvisionedThroughputExceededException",
  "TransactionInProgressException",
  "LimitExceededException",
  "PriorRequestNotComplete",
  "RequestThrottled",
  "EC2ThrottledException",
  "RequestLimitExceeded",
  "SlowDown",
  "BandwidthLimitExceeded",
];

/*
 * The error codes asked again as failures for now: those the standard retry
 * mode calls transient (RequestTimeout, RequestTimeoutException,
 * InternalError, STS's IDPCommunicationError), the common errors that say
 * to try again later (InternalFailure, ServiceUnavailable), Athena's
 * InternalServerException ("a transient condition or outage"), Glue's
 * InternalServiceException, and Glue's FederationSourceRetryableException
 * ("the operation may be retried"). Any other 500, 502, 503 or 504 is one
 * too, whatever its code.
 */
export const AWS_TRANSIENT_ERROR_CODES: ReadonlyArray<string> = [
  "RequestTimeout",
  "RequestTimeoutException",
  "InternalError",
  "IDPCommunicationError",
  "InternalFailure",
  "ServiceUnavailable",
  "InternalServerException",
  "InternalServiceException",
  "FederationSourceRetryableException",
];

// The statuses asked again whatever their code: a server or a gateway failing for now.
export const AWS_TRANSIENT_STATUS_CODES: ReadonlyArray<number> = [
  500, 502, 503, 504,
];

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

/*
 * The words of an AWS error answer: JSON's "message" (or "Message"), or
 * XML's <Message>. "" when the answer has none.
 */
export function awsErrorMessageOf(body: string): string {
  const text: string = (body || "").trim();

  if (text.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(text);

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return "";
      }

      const message: unknown =
        (parsed as JSONObject)["message"] ?? (parsed as JSONObject)["Message"];

      return typeof message === "string" ? message.trim() : "";
    } catch {
      return "";
    }
  }

  return readXmlTag(text, "Message");
}

/*
 * WHY AWS REFUSED A CALL, as its access-denied message says it. AWS words
 * the policy that refused a call into the message ("Troubleshoot access
 * denied error messages", IAM User Guide): "because no identity-based
 * policy allows the s3:GetBucketPolicy action" when nothing the caller's
 * own role or user holds allows the action, "with an explicit deny in a
 * resource-based policy" (or "because no resource-based policy allows")
 * when the resource's own policy - an S3 bucket's - refuses it. S3 says so
 * within one account or organization, and gives a bare "Access Denied"
 * across accounts; every other refusal (a service control policy, a
 * permissions boundary, an explicit deny in the caller's own policy) and a
 * message that names no policy is Unknown.
 */
export enum AwsRefusalCause {
  // The caller's own policies never allow the action: refused on any resource.
  NoIdentityPolicyAllows = "no-identity-policy-allows",
  // The resource's own policy refuses the caller: refused on that resource.
  ResourcePolicy = "resource-policy",
  Unknown = "unknown",
}

export function awsRefusalCauseOf(body: string): AwsRefusalCause {
  const words: string = awsErrorMessageOf(body)
    .split(/\s+/)
    .join(" ")
    .toLowerCase();

  if (words.includes("because no identity-based policy allows")) {
    return AwsRefusalCause.NoIdentityPolicyAllows;
  }

  if (
    words.includes("with an explicit deny in a resource-based policy") ||
    words.includes("because no resource-based policy allows")
  ) {
    return AwsRefusalCause.ResourcePolicy;
  }

  return AwsRefusalCause.Unknown;
}

/*
 * The error code a REST-JSON API (Lambda, EKS, OpenSearch Service) names in
 * its x-amzn-ErrorType header, before any ":" and the URL after it - or ""
 * when it names none.
 */
export function awsErrorTypeHeaderOf(
  headers: Dictionary<string> | undefined,
): string {
  for (const name of Object.keys(headers || {})) {
    if (name.toLowerCase() === "x-amzn-errortype") {
      return (headers![name] || "").split(":")[0]!.trim();
    }
  }

  return "";
}

/*
 * Whether an answer of AWS may pass, read as the AWS SDKs' standard retry
 * mode reads it: by its error code first (a JSON answer's "__type", an XML
 * answer's <Code>, a REST-JSON API's x-amzn-ErrorType), then by its
 * status. A 5xx with a throttling code is a throttle; a 429 is one
 * whatever its code. A wait AWS names in x-amz-retry-after (milliseconds)
 * comes with the verdict. Null for a success, and for an answer asking
 * again would only repeat: a refusal, a request AWS will not take.
 */
export function classifyAwsAnswer(
  response: DataSourceHttpResponse,
): HttpRetryVerdict | null {
  if (response.statusCode >= 200 && response.statusCode < 300) {
    return null;
  }

  const code: string =
    awsErrorCodeOf(response.bodyText || "") ||
    awsErrorTypeHeaderOf(response.headers);
  const namedWait: string | undefined = Object.keys(
    response.headers || {},
  ).find((name: string): boolean => {
    return name.toLowerCase() === AWS_RETRY_AFTER_HEADER;
  });
  const waitInMs: number = namedWait
    ? Number((response.headers![namedWait] || "").trim())
    : NaN;
  const withWait: { waitInMs?: number } =
    Number.isFinite(waitInMs) && waitInMs > 0 ? { waitInMs } : {};

  if (
    AWS_THROTTLING_ERROR_CODES.includes(code) ||
    response.statusCode === 429
  ) {
    return { reason: HttpRetryReason.Throttled, ...withWait };
  }

  if (
    AWS_TRANSIENT_ERROR_CODES.includes(code) ||
    AWS_TRANSIENT_STATUS_CODES.includes(response.statusCode)
  ) {
    return { reason: HttpRetryReason.Unavailable, ...withWait };
  }

  return null;
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
  } else if (AWS_THROTTLING_ERROR_CODES.includes(code)) {
    kind = CloudConnectionFailureKind.RateLimited;
  }

  return new LlmProviderError({
    message: failure.message,
    kind,
    statusCode: failure.statusCode,
    retryAfterSeconds: failure.retryAfterSeconds,
    responseBody: failure.responseBody,
  });
}

// What a transport that throws for a status outside 2xx says of an answer (DataSourceHttpFetch).
function transportErrorOf(response: DataSourceHttpResponse): BadDataException {
  return getDataSourceHttpStatusError(
    response.statusCode,
    response.bodyText || "",
  );
}

/*
 * A transport's answer to a request that asked for every status
 * (acceptAnyStatus): the answer itself, or - from a transport that throws
 * for a status outside 2xx all the same, as a test's fake does - the status
 * and body its error keeps. Anything else it throws is no answer: it is
 * thrown on, as the step's failure.
 */
function answerOf(data: {
  error: unknown;
  step: string;
  providerTitle: string;
  secretValues: Array<string>;
  classify: typeof classifyAwsError;
}): DataSourceHttpResponse {
  const failure: LlmProviderError = data.classify({
    error: data.error,
    step: data.step,
    providerTitle: data.providerTitle,
    secretValues: data.secretValues,
  });

  if (
    failure.statusCode === undefined ||
    failure.responseBody === undefined ||
    failure.statusCode < 300
  ) {
    throw failure;
  }

  let bodyJson: unknown = undefined;

  try {
    bodyJson = JSON.parse(failure.responseBody);
  } catch {
    bodyJson = undefined;
  }

  return {
    statusCode: failure.statusCode,
    bodyText: failure.responseBody,
    bodyJson,
    headers: {},
  };
}

/*
 * The error an answer that is no success ends a call with: the words a
 * transport's error would have had (classified by AWS's code), the wait
 * AWS named, and how many times the request was asked, once more than one.
 */
function answerError(data: {
  exchange: AwsRetryExchange;
  step: string;
  providerTitle: string;
  secretValues: Array<string>;
  classify: typeof classifyAwsError;
}): LlmProviderError {
  const failure: LlmProviderError = data.classify({
    error: transportErrorOf(data.exchange.response),
    step: data.step,
    providerTitle: data.providerTitle,
    secretValues: data.secretValues,
  });
  const retryAfterSeconds: number | undefined =
    RetryAfter.secondsFromHeaders(data.exchange.response.headers) ??
    (data.exchange.verdict?.waitInMs
      ? Math.ceil(data.exchange.verdict.waitInMs / 1000)
      : undefined);

  return new LlmProviderError({
    message:
      data.exchange.attempts > 1
        ? LlmProviderError.redact(
            withAttempts(asSentence(failure.message), data.exchange.attempts),
            data.secretValues,
          )
        : failure.message,
    kind: failure.kind,
    statusCode: failure.statusCode,
    retryAfterSeconds,
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
  /*
   * Whether sending it again after a failure for now cannot do its work
   * twice. A read is (isAwsReadAction: Describe..., Get..., List...), and
   * so is a write that sets a setting to one value, which its caller says:
   * sending it again changes nothing more. When left out, a call whose
   * action is no read is asked again after a throttle only (AwsRetry).
   */
  isSafeToRepeat?: boolean | undefined;
}

// The action an AWS JSON or Query call names: its X-Amz-Target's, else its form's Action.
export function getAwsRequestAction(
  request: Pick<AwsRequest, "target" | "body">,
): string {
  if (request.target) {
    return request.target.split(".").pop() || request.target;
  }

  const action: unknown = (request.body as Dictionary<string>)["Action"];

  return typeof action === "string" ? action : "";
}

// Whether the call may be sent again after a failure for now: what it says, else whether it only reads.
export function isAwsRequestSafeToRepeat(
  request: Pick<AwsRequest, "target" | "body" | "isSafeToRepeat">,
): boolean {
  return (
    request.isSafeToRepeat ?? isAwsReadAction(getAwsRequestAction(request))
  );
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

// What one AWS call is, to be signed: AwsRequest without how it is sent.
export type AwsRequestToSign = Pick<
  AwsRequest,
  | "credentials"
  | "service"
  | "region"
  | "host"
  | "target"
  | "jsonVersion"
  | "body"
  | "now"
>;

/*
 * One AWS call, signed with Signature Version 4 at the time now: its URL,
 * its signed headers and its body. Signed again for each try, so a retry
 * is never refused as a request too old (RequestExpired).
 */
export function signAwsRequest(request: AwsRequestToSign): {
  url: string;
  headers: Dictionary<string>;
  body: string;
} {
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

  return { url: `https://${host}/`, headers: signed.headers, body };
}

/*
 * Sends one signed request; JSON protocol answers are parsed, query
 * protocol answers are returned as text (XML).
 */
export async function sendAwsRequest(
  request: AwsRequest,
): Promise<{ json: JSONObject; text: string }> {
  const secrets: Array<string> = [
    request.credentials.secretAccessKey,
    ...(request.credentials.sessionToken
      ? [request.credentials.sessionToken]
      : []),
  ];
  const exchange: AwsRetryExchange = await exchangeWithAwsRetries({
    send: async (): Promise<DataSourceHttpResponse> => {
      // Every try is a request of the read's budget, signed at the time it is sent.
      if (request.budget && !request.budget.take()) {
        throw new CloudReadBudgetSpent();
      }

      const signed: {
        url: string;
        headers: Dictionary<string>;
        body: string;
      } = signAwsRequest(request);

      try {
        return await LlmProviderHttp.send({
          transport: request.transport,
          method: "POST",
          url: signed.url,
          headers: signed.headers,
          body: signed.body,
          timeoutInMs: request.timeoutInMs,
          acceptAnyStatus: true,
          step: request.step,
          providerTitle: request.providerTitle,
          secretValues: secrets,
        });
      } catch (error) {
        return answerOf({
          error,
          step: request.step,
          providerTitle: request.providerTitle,
          secretValues: secrets,
          classify: classifyAwsError,
        });
      }
    },
    classify: classifyAwsAnswer,
    isSafeToRepeat: isAwsRequestSafeToRepeat(request),
    isDynamoDb: request.service === "dynamodb",
    quota: getAwsRetryQuota(request.budget),
    sleep: request.sleep || CLOUD_DEFAULT_SLEEP,
    now: (): number => {
      return (request.now ? request.now() : new Date()).getTime();
    },
  });
  const response: DataSourceHttpResponse = exchange.response;

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw answerError({
      exchange,
      step: request.step,
      providerTitle: request.providerTitle,
      secretValues: secrets,
      classify: classifyAwsError,
    });
  }

  const json: JSONObject =
    response.bodyJson &&
    typeof response.bodyJson === "object" &&
    !Array.isArray(response.bodyJson)
      ? (response.bodyJson as JSONObject)
      : {};

  return { json, text: response.bodyText || "" };
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
 * x-amz-content-sha256 as S3 requires), asked again as every other call is
 * (AwsRetry: after a throttle - S3 says SlowDown - and, for a GET or a
 * request its caller says is safe to send again, after a failure for now),
 * and held to the read's budget, one request per try. The answer is its status, the few headers a reader uses, and the
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

// S3's codes for a credential it does not accept ("slow down" is a throttle: AWS_THROTTLING_ERROR_CODES).
const REST_AUTHENTICATION_CODES: Array<string> = [
  "InvalidAccessKeyId",
  "InvalidToken",
  "TokenRefreshRequired",
];

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
  /*
   * Whether sending it again after a failure for now cannot do its work
   * twice: a GET can't, and neither can a POST that only reads (OpenSearch
   * Service's DescribeDomains) or a PUT that sets a setting to one value,
   * which their callers say. When left out, anything but a GET is asked
   * again after a throttle only (AwsRetry).
   */
  isSafeToRepeat?: boolean | undefined;
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
  }

  if (kind === failure.kind) {
    return failure;
  }

  return new LlmProviderError({
    message: failure.message,
    kind,
    statusCode: failure.statusCode,
    retryAfterSeconds: failure.retryAfterSeconds,
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
        acceptAnyStatus: true,
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
  const exchange: AwsRetryExchange = await exchangeWithAwsRetries({
    send: async (): Promise<DataSourceHttpResponse> => {
      // Every try is a request of the read's budget, signed at the time it is sent.
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
        return method === "PUT"
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
              acceptAnyStatus: true,
              step: request.step,
              providerTitle: request.providerTitle,
              secretValues: secrets,
            });
      } catch (error) {
        return answerOf({
          error,
          step: request.step,
          providerTitle: request.providerTitle,
          secretValues: secrets,
          classify: classifyAwsRestError,
        });
      }
    },
    classify: classifyAwsAnswer,
    isSafeToRepeat: request.isSafeToRepeat ?? method === "GET",
    quota: getAwsRetryQuota(request.budget),
    sleep: request.sleep || CLOUD_DEFAULT_SLEEP,
    now: (): number => {
      return (request.now ? request.now() : new Date()).getTime();
    },
  });
  const response: DataSourceHttpResponse = exchange.response;

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw answerError({
      exchange,
      step: request.step,
      providerTitle: request.providerTitle,
      secretValues: secrets,
      classify: classifyAwsRestError,
    });
  }

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
}
