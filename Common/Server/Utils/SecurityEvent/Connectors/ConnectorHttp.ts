import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../DataSource/HttpFetch";
import { SecurityEventConnectorHttpRequest } from "./Types";

export const MAX_CONNECTOR_PAGES: number = 10;
export const CONNECTOR_TIMEOUT_MS: number = 30_000;

export function defaultConnectorRequest(
  request: DataSourceHttpRequest,
): Promise<DataSourceHttpResponse> {
  return DataSourceHttpFetch.fetch(request);
}

export function jsonObject(value: unknown, label: string): JSONObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadDataException(`${label} returned an invalid JSON object.`);
  }
  return value as JSONObject;
}

export function jsonObjects(
  value: unknown,
  label: string = "Connector response",
  required: boolean = false,
): Array<JSONObject> {
  if (value === undefined || value === null) {
    if (required) {
      throw new BadDataException(`${label} returned no result array.`);
    }
    return [];
  }
  if (!Array.isArray(value)) {
    throw new BadDataException(`${label} returned an invalid result array.`);
  }
  const objects: Array<JSONObject> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new BadDataException(
        `${label} returned a non-object result array member.`,
      );
    }
    objects.push(entry as JSONObject);
  }
  return objects;
}

export function stringValues(
  value: unknown,
  label: string,
  required: boolean = false,
): Array<string> {
  if (value === undefined || value === null) {
    if (required) {
      throw new BadDataException(`${label} returned no result array.`);
    }
    return [];
  }
  if (!Array.isArray(value)) {
    throw new BadDataException(`${label} returned an invalid result array.`);
  }
  const strings: Array<string> = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry) {
      throw new BadDataException(
        `${label} returned a non-string result array member.`,
      );
    }
    strings.push(entry);
  }
  return strings;
}

export function stringValue(value: JSONValue | undefined): string {
  return typeof value === "string" ? value : "";
}

export async function requestJson(data: {
  request: SecurityEventConnectorHttpRequest;
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string> | undefined;
  body?: JSONObject | string | undefined;
  formUrlEncoded?: boolean | undefined;
  signal?: AbortSignal | undefined;
  label: string;
}): Promise<{ response: DataSourceHttpResponse; body: JSONObject }> {
  const response: DataSourceHttpResponse = await data.request({
    method: data.method,
    url: data.url,
    headers: data.headers,
    body:
      typeof data.body === "string"
        ? data.body
        : data.body
          ? JSON.stringify(data.body)
          : undefined,
    formUrlEncoded: data.formUrlEncoded,
    signal: data.signal,
    timeoutInMs: CONNECTOR_TIMEOUT_MS,
    egressOptions: {
      targetLabel: `${data.label} endpoint`,
      privateNetworkHint:
        "Private addresses are available on self-hosted OneUptime deployments.",
    },
  });
  return {
    response,
    body: jsonObject(response.bodyJson, data.label),
  };
}

export function parseCredentialJson(value: string): JSONObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value || "");
  } catch {
    throw new BadDataException("Credentials JSON is not valid JSON.");
  }
  return jsonObject(parsed, "Credentials JSON");
}

export function requiredSetting(
  object: JSONObject,
  key: string,
  provider: string,
): string {
  const value: JSONValue = object[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new BadDataException(`${provider} requires ${key}.`);
  }
  return value.trim();
}
