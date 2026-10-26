import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { DataSourceHttpResponse } from "../../DataSource/HttpFetch";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import LlmProviderHttp from "../../LlmObservability/LlmProviderHttp";
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
