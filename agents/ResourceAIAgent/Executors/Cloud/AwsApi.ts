import {
  CloudHttpMethod,
  CloudHttpResponse,
  CloudSender,
  CloudTransportError,
  isPlainObject,
  parseJsonBody,
  readString,
  shortenCloudText,
} from "./CloudHttp";
import { CloudApiError } from "./CloudChange";
import {
  AwsSigningCredentials,
  buildAwsPath,
  encodeAwsForm,
  signAwsRequest,
  AwsSignedRequest,
} from "./AwsSigV4";
import { XmlElement, parseXml, xmlFind, xmlText } from "./CloudXml";

/*
 * Calls to AWS's APIs, signed with SigV4, in the three protocols the
 * agent's operations use:
 *
 *   query  STS, EC2, RDS, Auto Scaling: a form POST of Action, Version and
 *          the parameters; the answer is XML (CloudXml reads it).
 *   json   ECS and Application Auto Scaling (JSON 1.1), SQS (JSON 1.0): a
 *          POST of a JSON body naming the operation in X-Amz-Target.
 *   rest   Lambda: a method and a path, JSON in and out.
 *
 * Every call names the IAM action it needs, so an error answer can say
 * exactly which permission the agent's role lacks.
 */

export const STS_API_VERSION: string = "2011-06-15";
export const EC2_API_VERSION: string = "2016-11-15";
export const RDS_API_VERSION: string = "2014-10-31";
export const AUTOSCALING_API_VERSION: string = "2011-01-01";

// A 12-digit AWS account id.
export const AWS_ACCOUNT_PATTERN: RegExp = /^[0-9]{12}$/;

// The DNS suffix of a Region's partition.
export function awsDnsSuffix(region: string): string {
  if (region.startsWith("cn-")) {
    return "amazonaws.com.cn";
  }

  if (region.startsWith("us-isob-")) {
    return "sc2s.sgov.gov";
  }

  if (region.startsWith("us-iso-")) {
    return "c2s.ic.gov";
  }

  return "amazonaws.com";
}

// "ecs.us-east-1.amazonaws.com"
export function awsHost(endpointPrefix: string, region: string): string {
  return `${endpointPrefix}.${region}.${awsDnsSuffix(region)}`;
}

/*
 * Where STS is called: the Region's own endpoint, or the global one
 * (signed for us-east-1) when no Region is known.
 */
export function stsEndpoint(region: string | null): {
  host: string;
  region: string;
} {
  if (region) {
    return { host: awsHost("sts", region), region };
  }

  return { host: "sts.amazonaws.com", region: "us-east-1" };
}

// Error codes that mean the identity lacks a permission.
const ACCESS_DENIED_CODES: ReadonlyArray<string> = [
  "AccessDenied",
  "AccessDeniedException",
  "UnauthorizedOperation",
  "UnauthorizedException",
  "AuthorizationError",
  "AuthorizationErrorException",
  "Forbidden",
];

// Error codes that mean the credentials themselves were not accepted.
const BAD_CREDENTIAL_CODES: ReadonlyArray<string> = [
  "InvalidClientTokenId",
  "UnrecognizedClientException",
  "SignatureDoesNotMatch",
  "InvalidSignatureException",
  "IncompleteSignature",
  "MissingAuthenticationToken",
  "ExpiredToken",
  "ExpiredTokenException",
  "AuthFailure",
  "RequestExpired",
];

/*
 * "com.amazonaws.ecs#AccessDeniedException" and the header's
 * "AccessDeniedException:http://internal.amazon.com/..." -> the code alone.
 */
function bareCode(code: string): string {
  const colon: number = code.indexOf(":");
  const head: string = colon >= 0 ? code.slice(0, colon) : code;
  const hash: number = head.lastIndexOf("#");

  return (hash >= 0 ? head.slice(hash + 1) : head).trim();
}

// The error code and message of an AWS error answer, in any of the three protocols.
export function readAwsError(response: CloudHttpResponse): {
  code: string | null;
  message: string;
} {
  const headerType: string = response.headers["x-amzn-errortype"] || "";
  const trimmed: string = response.truncated ? "" : response.body.trim();

  if (trimmed.startsWith("<")) {
    const root: XmlElement | null = parseXml(trimmed);
    const error: XmlElement | null = xmlFind(root, "Error");

    return {
      code: xmlText(error, "Code"),
      message: xmlText(error, "Message") || "",
    };
  }

  const json: unknown = parseJsonBody(response);
  const object: Record<string, unknown> | null = isPlainObject(json)
    ? json
    : null;
  const type: string =
    readString(object, "__type") ||
    readString(object, "code") ||
    readString(object, "Code") ||
    headerType;
  const message: string =
    readString(object, "message") ||
    readString(object, "Message") ||
    readString(object, "errorMessage") ||
    "";

  return { code: type ? bareCode(type) : null, message };
}

export interface AwsCallNames {
  // The IAM action the call needs: "ecs:UpdateService".
  permission: string;
}

export interface AwsClientOptions {
  send: CloudSender;
  credentials: AwsSigningCredentials;
  nowMs: () => number;
  userAgent: string;
  /*
   * What to add when AWS refuses the identity a permission: who needs it
   * and how to grant it.
   */
  describeMissingPermission: (permission: string) => string;
  // How the identity is named when its credentials are not accepted.
  identityName: string;
}

export class AwsClient {
  public constructor(private readonly options: AwsClientOptions) {}

  // A Query-protocol call (STS, EC2, RDS, Auto Scaling): the answer's root element.
  public async query(data: {
    endpointPrefix: string;
    signingName: string;
    region: string;
    host?: string | undefined;
    action: string;
    version: string;
    params?: Array<[string, string]> | undefined;
    permission: string;
  }): Promise<XmlElement> {
    const body: string = encodeAwsForm([
      ["Action", data.action],
      ["Version", data.version],
      ...(data.params || []),
    ]);
    const response: CloudHttpResponse = await this.call({
      method: "POST",
      host: data.host || awsHost(data.endpointPrefix, data.region),
      path: "/",
      query: {},
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      },
      body,
      signingName: data.signingName,
      region: data.region,
      permission: data.permission,
    });
    const root: XmlElement | null = response.truncated
      ? null
      : parseXml(response.body);

    if (!root) {
      throw new CloudApiError({
        status: response.status,
        code: null,
        description: `AWS answered ${data.permission}, but not with XML the agent can read${
          response.truncated ? " (the answer is too large)" : ""
        }.`,
        isAccessDenied: false,
      });
    }

    return root;
  }

  // A JSON 1.0 / 1.1 call (ECS, Application Auto Scaling, SQS): the answer's object.
  public async json(data: {
    endpointPrefix: string;
    signingName: string;
    region: string;
    target: string;
    jsonVersion: "1.0" | "1.1";
    body: Record<string, unknown>;
    permission: string;
  }): Promise<Record<string, unknown>> {
    const response: CloudHttpResponse = await this.call({
      method: "POST",
      host: awsHost(data.endpointPrefix, data.region),
      path: "/",
      query: {},
      headers: {
        "Content-Type": `application/x-amz-json-${data.jsonVersion}`,
        "X-Amz-Target": data.target,
      },
      body: JSON.stringify(data.body),
      signingName: data.signingName,
      region: data.region,
      permission: data.permission,
    });

    return this.readJsonObject(response, data.permission);
  }

  // A REST call (Lambda): the answer's object ({} for an empty answer).
  public async rest(data: {
    endpointPrefix: string;
    signingName: string;
    region: string;
    method: CloudHttpMethod;
    // Decoded path segments; each is encoded once on the wire.
    segments: Array<string>;
    query?: Record<string, string> | undefined;
    body?: Record<string, unknown> | undefined;
    permission: string;
  }): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {};
    let body: string = "";

    if (data.body !== undefined) {
      body = JSON.stringify(data.body);
      headers["Content-Type"] = "application/json";
    }

    const response: CloudHttpResponse = await this.call({
      method: data.method,
      host: awsHost(data.endpointPrefix, data.region),
      path: buildAwsPath(data.segments),
      query: data.query || {},
      headers,
      body,
      signingName: data.signingName,
      region: data.region,
      permission: data.permission,
      sendEmptyBody: data.body === undefined,
    });

    if (!response.body.trim()) {
      return {};
    }

    return this.readJsonObject(response, data.permission);
  }

  private readJsonObject(
    response: CloudHttpResponse,
    permission: string,
  ): Record<string, unknown> {
    const json: unknown = parseJsonBody(response);

    if (!isPlainObject(json)) {
      throw new CloudApiError({
        status: response.status,
        code: null,
        description: `AWS answered ${permission}, but not with JSON the agent can read${
          response.truncated ? " (the answer is too large)" : ""
        }.`,
        isAccessDenied: false,
      });
    }

    return json;
  }

  // Sign, send, and turn an error answer into a CloudApiError.
  private async call(data: {
    method: CloudHttpMethod;
    host: string;
    path: string;
    query: Record<string, string>;
    headers: Record<string, string>;
    body: string;
    signingName: string;
    region: string;
    permission: string;
    sendEmptyBody?: boolean | undefined;
  }): Promise<CloudHttpResponse> {
    const signed: AwsSignedRequest = signAwsRequest({
      method: data.method,
      path: data.path,
      query: data.query,
      host: data.host,
      headers: { ...data.headers },
      body: data.body,
      service: data.signingName,
      region: data.region,
      date: new Date(this.options.nowMs()),
      credentials: this.options.credentials,
    });
    const url: string = `https://${data.host}${data.path}${
      signed.queryString ? `?${signed.queryString}` : ""
    }`;
    let response: CloudHttpResponse;

    try {
      response = await this.options.send({
        method: data.method,
        url,
        headers: {
          ...signed.headers,
          Accept: "application/json",
          "User-Agent": this.options.userAgent,
        },
        body:
          data.sendEmptyBody && data.body === "" && data.method !== "POST"
            ? null
            : data.body,
      });
    } catch (err: unknown) {
      if (err instanceof CloudTransportError) {
        throw new CloudTransportError({
          kind: err.kind,
          code: err.code,
          message: `${data.permission} at https://${data.host}: ${err.message}`,
        });
      }

      throw err;
    }

    if (response.status >= 200 && response.status < 300) {
      return response;
    }

    throw this.describeError(response, data.permission);
  }

  private describeError(
    response: CloudHttpResponse,
    permission: string,
  ): CloudApiError {
    const error: { code: string | null; message: string } =
      readAwsError(response);
    const said: string = shortenCloudText(error.message);
    const code: string | null = error.code;
    const head: string = `AWS refused ${permission} (HTTP ${response.status}${
      code ? ` ${code}` : ""
    })${said ? `: ${said}` : ""}`;
    const isRedirect: boolean = response.status >= 300 && response.status < 400;
    const isAccessDenied: boolean =
      (code !== null && ACCESS_DENIED_CODES.includes(code)) ||
      (response.status === 403 &&
        !(code !== null && BAD_CREDENTIAL_CODES.includes(code)));

    if (isRedirect) {
      return new CloudApiError({
        status: response.status,
        code,
        description: `AWS answered ${permission} with a redirect (HTTP ${response.status}), which the agent never follows.`,
        isAccessDenied: false,
      });
    }

    if (code !== null && BAD_CREDENTIAL_CODES.includes(code)) {
      return new CloudApiError({
        status: response.status,
        code,
        description: `${head}. AWS did not accept the credentials of ${this.options.identityName}: they may have expired, or the agent's clock may be off.`,
        isAccessDenied: false,
      });
    }

    return new CloudApiError({
      status: response.status,
      code,
      description: isAccessDenied
        ? `${head}. ${this.options.describeMissingPermission(permission)}`
        : `${head}.`,
      isAccessDenied,
    });
  }
}

// "arn:aws:sts::123456789012:assumed-role/Role/session" -> "123456789012".
export function accountOfArn(arn: string | null): string | null {
  if (!arn || !arn.startsWith("arn:")) {
    return null;
  }

  const fields: Array<string> = arn.split(":");
  const account: string = fields[4] || "";

  return AWS_ACCOUNT_PATTERN.test(account) ? account : null;
}

// "arn:aws-cn:..." -> "aws-cn".
export function partitionOfArn(arn: string): string {
  return arn.split(":")[1] || "aws";
}

// Tags of the forms AWS writes them: [{Key, Value}] / [{key, value}].
export function readAwsTagList(value: unknown): Record<string, string> {
  const tags: Record<string, string> = {};

  if (!Array.isArray(value)) {
    return tags;
  }

  for (const entry of value) {
    if (!isPlainObject(entry)) {
      continue;
    }

    const key: string | null =
      readString(entry, "Key") || readString(entry, "key");
    const tagValue: string | null =
      readString(entry, "Value") ?? readString(entry, "value");

    if (key) {
      tags[key] = tagValue ?? "";
    }
  }

  return tags;
}

// Tags from XML: <TagList><Tag><Key/><Value/></Tag></TagList>, <tagSet><item><key/><value/>...
export function readAwsXmlTags(
  list: XmlElement | null,
): Record<string, string> {
  const tags: Record<string, string> = {};

  if (!list) {
    return tags;
  }

  for (const entry of list.children) {
    const key: string | null = xmlText(entry, "Key") ?? xmlText(entry, "key");
    const value: string | null =
      xmlText(entry, "Value") ?? xmlText(entry, "value");

    if (key) {
      tags[key] = value ?? "";
    }
  }

  return tags;
}
