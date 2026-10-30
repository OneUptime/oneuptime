import { generateKeyPairSync } from "crypto";
import jwt from "jsonwebtoken";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../../Server/Utils/DataSource/HttpFetch";
import Dictionary from "../../../../../../Types/Dictionary";
import { JSONObject, JSONValue } from "../../../../../../Types/JSON";

/*
 * A fake Google Workspace behind the connector's transport: Google's token
 * endpoint, which checks the service account's signed assertion with the
 * key's public half and that it names an administrator to act as, and the
 * Admin SDK Reports API's activities list - by the time of the activity,
 * newest first, filtered by eventName, paged by nextPageToken. Every
 * request is recorded. Not a test file itself.
 */

// Module scope on purpose: a real 2048-bit key, generated once.
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

export const FAKE_PUBLIC_KEY: string = publicKey;
export const FAKE_PRIVATE_KEY: string = privateKey;
export const FAKE_CLIENT_EMAIL: string =
  "workspace-reader@example-project.iam.gserviceaccount.com";
export const FAKE_ADMIN_EMAIL: string = "admin@example.com";
export const FAKE_TOKEN_URI: string = "https://oauth2.googleapis.com/token";
export const FAKE_ACCESS_TOKEN: string =
  "ya29.a0AfB_byFakeWorkspaceAccessToken";

export const FAKE_SERVICE_ACCOUNT_JSON: string = JSON.stringify({
  type: "service_account",
  project_id: "example-project",
  private_key_id: "0123456789abcdef0123456789abcdef01234567",
  private_key: privateKey,
  client_email: FAKE_CLIENT_EMAIL,
  client_id: "114511147312345678901",
  token_uri: FAKE_TOKEN_URI,
});

export interface FakeFailure {
  statusCode: number;
  body: JSONValue | string;
}

export interface FakeWorkspace {
  // Activities per application, in any order.
  activities?: Dictionary<Array<JSONObject>> | undefined;
  // The most activities a page holds, whatever maxResults asks for.
  pageCap?: number | undefined;
  tokenFailure?: FakeFailure | undefined;
  // Failures per application.
  failures?: Dictionary<FakeFailure> | undefined;
  // The administrators domain-wide delegation lets the account act as.
  admins?: Array<string> | undefined;
}

export interface FakeWorkspaceApi {
  transport: (
    request: DataSourceHttpRequest,
  ) => Promise<DataSourceHttpResponse>;
  requests: Array<DataSourceHttpRequest>;
  // The verified claims of every assertion the token endpoint was sent.
  assertions: Array<JSONObject>;
}

const APPLICATIONS_PATH: string =
  "/admin/reports/v1/activity/users/all/applications/";

export function respond(
  statusCode: number,
  body: JSONValue | string,
): DataSourceHttpResponse {
  const bodyText: string =
    typeof body === "string" ? body : JSON.stringify(body);
  let bodyJson: unknown = undefined;

  try {
    bodyJson = JSON.parse(bodyText);
  } catch {
    bodyJson = undefined;
  }

  return { statusCode, bodyText, bodyJson, headers: {} };
}

// Google's API error body.
export function googleError(
  code: number,
  status: string,
  message: string,
  reason: string,
): JSONObject {
  return {
    error: {
      code,
      message,
      errors: [{ message, domain: "global", reason }],
      status,
    },
  };
}

function timeOf(activity: JSONObject): number {
  const id: JSONObject = (activity["id"] || {}) as JSONObject;

  return new Date(String(id["time"])).getTime();
}

function holdsEvent(activity: JSONObject, eventName: string): boolean {
  const events: unknown = activity["events"];

  return (
    Array.isArray(events) &&
    events.some((event: unknown): boolean => {
      return (event as JSONObject)?.["name"] === eventName;
    })
  );
}

export function createFakeWorkspaceApi(
  workspace: FakeWorkspace,
): FakeWorkspaceApi {
  const requests: Array<DataSourceHttpRequest> = [];
  const assertions: Array<JSONObject> = [];

  const transport: (
    request: DataSourceHttpRequest,
  ) => Promise<DataSourceHttpResponse> = async (
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> => {
    requests.push(request);

    const url: URL = new URL(request.url);

    if (request.url === FAKE_TOKEN_URI) {
      const body: Dictionary<string> = (request.body ||
        {}) as Dictionary<string>;
      const claims: JSONObject = jwt.verify(
        String(body["assertion"] || ""),
        publicKey,
        { algorithms: ["RS256"] },
      ) as JSONObject;

      assertions.push(claims);

      if (workspace.tokenFailure) {
        return respond(
          workspace.tokenFailure.statusCode,
          workspace.tokenFailure.body,
        );
      }

      if (
        !(workspace.admins || [FAKE_ADMIN_EMAIL]).includes(
          String(claims["sub"]),
        )
      ) {
        return respond(400, {
          error: "invalid_grant",
          error_description: "Invalid email or User ID",
        });
      }

      return respond(200, {
        access_token: FAKE_ACCESS_TOKEN,
        expires_in: 3599,
        token_type: "Bearer",
      });
    }

    if (
      url.host === "admin.googleapis.com" &&
      url.pathname.startsWith(APPLICATIONS_PATH)
    ) {
      if (
        request.headers?.["Authorization"] !== `Bearer ${FAKE_ACCESS_TOKEN}`
      ) {
        return respond(
          401,
          googleError(
            401,
            "UNAUTHENTICATED",
            "Invalid Credentials",
            "authError",
          ),
        );
      }

      const application: string = url.pathname.slice(APPLICATIONS_PATH.length);
      const failure: FakeFailure | undefined =
        workspace.failures?.[application];

      if (failure) {
        return respond(failure.statusCode, failure.body);
      }

      const start: number = new Date(
        url.searchParams.get("startTime") || 0,
      ).getTime();
      const end: number = url.searchParams.get("endTime")
        ? new Date(url.searchParams.get("endTime")!).getTime()
        : Date.now();
      const eventName: string | null = url.searchParams.get("eventName");
      const maxResults: number = Math.min(
        workspace.pageCap || 1000,
        Number(url.searchParams.get("maxResults") || "1000"),
      );
      const offset: number = Number(url.searchParams.get("pageToken") || "0");
      const matching: Array<JSONObject> = (
        workspace.activities?.[application] || []
      )
        .filter((activity: JSONObject): boolean => {
          const time: number = timeOf(activity);

          return (
            time >= start &&
            time <= end &&
            (!eventName || holdsEvent(activity, eventName))
          );
        })
        .sort((a: JSONObject, b: JSONObject): number => {
          return timeOf(b) - timeOf(a);
        });
      const page: Array<JSONObject> = matching.slice(
        offset,
        offset + maxResults,
      );
      const body: JSONObject = {
        kind: "admin#reports#activities",
        etag: '"fake-etag"',
      };

      // An empty page has no items member at all.
      if (page.length > 0) {
        body["items"] = page;
      }

      if (offset + maxResults < matching.length) {
        body["nextPageToken"] = String(offset + maxResults);
      }

      return respond(200, body);
    }

    return respond(404, "not found");
  };

  return { transport, requests, assertions };
}

// The activities requests, as URLs.
export function activityRequests(api: FakeWorkspaceApi): Array<URL> {
  return api.requests
    .map((request: DataSourceHttpRequest): URL => {
      return new URL(request.url);
    })
    .filter((url: URL): boolean => {
      return url.host === "admin.googleapis.com";
    });
}
