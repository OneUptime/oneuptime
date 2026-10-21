import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { CloudConnectionAwsRoleSetup } from "Common/Types/CloudConnection/CloudConnectionSetupCommands";
import {
  CloudConnectionFailureKind,
  CloudConnectionRegionCount,
  CloudConnectionTestResult,
  CloudConnectionTestStatus,
  CloudConnectionTypeCount,
} from "Common/Types/CloudConnection/CloudConnectionTest";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL, DOCS_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The calls Cloud > Connect makes besides the connections' CRUD: "Test
 * connection" (signs in and counts a little of what a read would find -
 * nothing is stored), "Read now" (queues a read of a saved connection) and
 * the AWS role setup (what the IAM role command is written from).
 *
 * The server answers a test with a CloudConnectionTestResult, a failed one
 * included: a refused credential is the test's answer, not a failed
 * request.
 */

export const CLOUD_CONNECTION_API_PATH: string = "/cloud-connection";

export function cloudConnectionDocsUrl(docsPath: string): URL {
  const relativePath: string = docsPath.startsWith("/docs")
    ? docsPath.slice("/docs".length)
    : docsPath;
  return URL.fromString(`${DOCS_URL.toString()}${relativePath}`);
}

const TEST_STATUSES: Array<CloudConnectionTestStatus> = ["pass", "warn", "fail"];

function readCounts<T>(
  value: JSONValue | undefined,
  key: "type" | "region",
): Array<T> {
  if (!Array.isArray(value)) {
    return [];
  }

  const counts: Array<T> = [];

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const entry: JSONObject = item as JSONObject;
    const name: JSONValue | undefined = entry[key];
    const count: JSONValue | undefined = entry["count"];

    if (typeof name === "string" && typeof count === "number" && count > 0) {
      counts.push({ [key]: name, count } as unknown as T);
    }
  }

  return counts;
}

// The server's answer, read as the result it is - or a failure saying so.
export function readCloudConnectionTestResult(
  data: JSONObject | undefined,
): CloudConnectionTestResult {
  const status: unknown = data?.["status"];

  if (!data || !TEST_STATUSES.includes(status as CloudConnectionTestStatus)) {
    return {
      provider: "",
      status: "fail",
      message:
        "The server did not return a test result. Check the API logs and try again.",
      failureKind: CloudConnectionFailureKind.Other,
      durationMs: 0,
    };
  }

  const rawAccounts: JSONValue | undefined = data["accounts"];
  let accounts: Array<string> | undefined = undefined;

  if (Array.isArray(rawAccounts)) {
    accounts = [];

    for (const account of rawAccounts) {
      if (typeof account === "string") {
        accounts.push(account);
      }
    }
  }

  return {
    provider: typeof data["provider"] === "string" ? data["provider"] : "",
    status: status as CloudConnectionTestStatus,
    message: typeof data["message"] === "string" ? data["message"] : "",
    failureKind:
      typeof data["failureKind"] === "string"
        ? (data["failureKind"] as CloudConnectionFailureKind)
        : undefined,
    accounts,
    resourceCount:
      typeof data["resourceCount"] === "number"
        ? data["resourceCount"]
        : undefined,
    resourceTypes: readCounts<CloudConnectionTypeCount>(
      data["resourceTypes"],
      "type",
    ),
    regions: readCounts<CloudConnectionRegionCount>(data["regions"], "region"),
    isSample: data["isSample"] === true,
    durationMs: typeof data["durationMs"] === "number" ? data["durationMs"] : 0,
  };
}

/*
 * Tests a connection: { provider, config, secrets } for settings never
 * saved, or { connectionId, config?, secrets? } for a saved one (a secret
 * left empty keeps the stored one).
 */
export async function runCloudConnectionTest(
  body: JSONObject,
): Promise<CloudConnectionTestResult> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(
        `${CLOUD_CONNECTION_API_PATH}/test`,
      ),
      headers: ModelAPI.getCommonHeaders(),
      data: body,
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return readCloudConnectionTestResult(response.data);
}

// Queues a read of a saved, enabled connection now.
export async function readCloudConnectionNow(
  connectionId: ObjectID,
): Promise<void> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(
        `${CLOUD_CONNECTION_API_PATH}/${connectionId.toString()}/read-now`,
      ),
      headers: ModelAPI.getCommonHeaders(),
      data: {},
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }
}

// The answer read as the setup it is; unavailable when it says nothing.
export function readCloudConnectionAwsRoleSetup(
  data: JSONObject | undefined,
): CloudConnectionAwsRoleSetup {
  const externalId: unknown = data?.["externalId"];
  const principal: unknown = data?.["trustedPrincipalArn"];

  return {
    isAvailable:
      data?.["isAvailable"] === true &&
      typeof principal === "string" &&
      typeof externalId === "string",
    trustedPrincipalArn: typeof principal === "string" ? principal : undefined,
    externalId: typeof externalId === "string" ? externalId : "",
  };
}

// Whether this OneUptime can sign in to an AWS role, and what it trusts.
export async function getCloudConnectionAwsRoleSetup(): Promise<CloudConnectionAwsRoleSetup> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.get<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(
        `${CLOUD_CONNECTION_API_PATH}/aws-role-setup`,
      ),
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return readCloudConnectionAwsRoleSetup(response.data);
}
