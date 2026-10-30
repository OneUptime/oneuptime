import { describe, expect, test } from "@jest/globals";
import GoogleWorkspaceClient, {
  GOOGLE_WORKSPACE_PAGE_SIZE,
  GOOGLE_WORKSPACE_REPORTS_SCOPE,
  GoogleWorkspaceActivityPage,
  GoogleWorkspaceHttpError,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleWorkspace/GoogleWorkspaceClient";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../../Server/Utils/DataSource/HttpFetch";
import APIException from "../../../../../../Types/Exception/ApiException";
import BadDataException from "../../../../../../Types/Exception/BadDataException";
import Dictionary from "../../../../../../Types/Dictionary";
import { JSONObject } from "../../../../../../Types/JSON";
import {
  FAKE_ACCESS_TOKEN,
  FAKE_ADMIN_EMAIL,
  FAKE_CLIENT_EMAIL,
  FAKE_PRIVATE_KEY,
  FAKE_SERVICE_ACCOUNT_JSON,
  FAKE_TOKEN_URI,
  FakeWorkspaceApi,
  activityRequests,
  createFakeWorkspaceApi,
  googleError,
  respond,
} from "./GoogleWorkspaceFakeApi";
import { googleWorkspaceActivity } from "../../../../../Utils/SecurityEvent/Connectors/GoogleWorkspaceFixtures";

/*
 * The Reports API client as the connector depends on it: an assertion
 * signed with the service account's key that acts as the administrator
 * with the read-only audit scope and nothing more, the activities URL and
 * its paging, the 401 retry, Google's reasons the connector's remediation
 * reads, and that neither the key nor the assertion leaves through an
 * error message. The fake checks every assertion's signature; no network.
 */

const START: Date = new Date("2026-10-30T09:00:00.000Z");
const END: Date = new Date("2026-10-30T10:00:00.000Z");

function client(
  transport: (
    request: DataSourceHttpRequest,
  ) => Promise<DataSourceHttpResponse>,
  adminEmail: string = FAKE_ADMIN_EMAIL,
): GoogleWorkspaceClient {
  return new GoogleWorkspaceClient({
    serviceAccountJson: FAKE_SERVICE_ACCOUNT_JSON,
    adminEmail,
    transport,
    requestTimeoutInMs: 15000,
  });
}

function activityAt(time: string, uniqueQualifier: string): JSONObject {
  return googleWorkspaceActivity("login", "login_success", [], {
    id: {
      time,
      uniqueQualifier,
      applicationName: "login",
      customerId: "C03az79cb",
    },
  });
}

async function caught(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected the call to throw.");
}

describe("GoogleWorkspaceClient - acting as the administrator", () => {
  test("the assertion is signed with the key, names the administrator, and asks for the read-only audit scope alone", async () => {
    const api: FakeWorkspaceApi = createFakeWorkspaceApi({});
    const token: string = await client(api.transport).getAccessToken();

    expect(token).toBe(FAKE_ACCESS_TOKEN);
    expect(api.assertions).toHaveLength(1);

    const claims: JSONObject = api.assertions[0]!;

    expect(claims["iss"]).toBe(FAKE_CLIENT_EMAIL);
    expect(claims["sub"]).toBe(FAKE_ADMIN_EMAIL);
    expect(claims["scope"]).toBe(GOOGLE_WORKSPACE_REPORTS_SCOPE);
    expect(GOOGLE_WORKSPACE_REPORTS_SCOPE).toBe(
      "https://www.googleapis.com/auth/admin.reports.audit.readonly",
    );
    expect(claims["aud"]).toBe(FAKE_TOKEN_URI);
    expect(Number(claims["exp"]) - Number(claims["iat"])).toBe(3600);

    const request: DataSourceHttpRequest = api.requests[0]!;

    expect(request.method).toBe("POST");
    expect(request.formUrlEncoded).toBe(true);
    expect((request.body as Dictionary<string>)["grant_type"]).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );
  });

  test("a token is kept for its life", async () => {
    const api: FakeWorkspaceApi = createFakeWorkspaceApi({});
    const workspace: GoogleWorkspaceClient = client(api.transport);

    await workspace.getAccessToken();
    await workspace.getAccessToken();

    expect(api.requests).toHaveLength(1);
    expect(workspace.getRequestCount()).toBe(1);
  });

  test("no domain-wide delegation is named as such, and the key never leaves in the message", async () => {
    const api: FakeWorkspaceApi = createFakeWorkspaceApi({
      tokenFailure: {
        statusCode: 401,
        body: {
          error: "unauthorized_client",
          error_description:
            "Client is unauthorized to retrieve access tokens using this method, or client not authorized for any of the scopes requested.",
        },
      },
    });
    const error: Error = await caught(client(api.transport).getAccessToken());

    expect(error).toBeInstanceOf(GoogleWorkspaceHttpError);
    expect((error as GoogleWorkspaceHttpError).reason).toBe(
      "unauthorized_client",
    );
    expect(error.message).toContain("token request failed (HTTP 401)");
    expect(error.message).toContain(
      "no domain-wide delegation for the admin.reports.audit.readonly scope",
    );
    expect(error.message).not.toContain("PRIVATE KEY");
  });

  /*
   * A playbook's containment step mints its token through this client for
   * the Directory API's user scope (GoogleWorkspaceResponseClient): the
   * assertion asks for that scope alone, and a delegation that lacks it is
   * named by it.
   */
  test("a client for another scope asks for that scope alone, and a refusal names it", async () => {
    const scope: string =
      "https://www.googleapis.com/auth/admin.directory.user";
    const api: FakeWorkspaceApi = createFakeWorkspaceApi({});

    await new GoogleWorkspaceClient({
      serviceAccountJson: FAKE_SERVICE_ACCOUNT_JSON,
      adminEmail: FAKE_ADMIN_EMAIL,
      transport: api.transport,
      requestTimeoutInMs: 15000,
      scope,
    }).getAccessToken();

    expect(api.assertions[0]!["scope"]).toBe(scope);
    expect(api.assertions[0]!["sub"]).toBe(FAKE_ADMIN_EMAIL);

    const refused: FakeWorkspaceApi = createFakeWorkspaceApi({
      tokenFailure: {
        statusCode: 401,
        body: { error: "unauthorized_client" },
      },
    });
    const error: Error = await caught(
      new GoogleWorkspaceClient({
        serviceAccountJson: FAKE_SERVICE_ACCOUNT_JSON,
        adminEmail: FAKE_ADMIN_EMAIL,
        transport: refused.transport,
        requestTimeoutInMs: 15000,
        scope,
      }).getAccessToken(),
    );

    expect(error.message).toContain(
      "no domain-wide delegation for the admin.directory.user scope.",
    );
  });

  test("an administrator Google does not know is named as such", async () => {
    const api: FakeWorkspaceApi = createFakeWorkspaceApi({});
    const error: Error = await caught(
      client(api.transport, "nobody@example.com").getAccessToken(),
    );

    expect((error as GoogleWorkspaceHttpError).reason).toBe("invalid_grant");
    expect(error.message).toContain(
      "Google does not know the Administrator email",
    );
  });

  test("an echoed assertion or key is blanked out of the message", async () => {
    let echoed: string = "";
    const transport: (
      request: DataSourceHttpRequest,
    ) => Promise<DataSourceHttpResponse> = async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      echoed = String((request.body as Dictionary<string>)["assertion"]);

      return respond(
        400,
        `bad request: assertion=${echoed} key=${FAKE_PRIVATE_KEY}`,
      );
    };
    const error: Error = await caught(client(transport).getAccessToken());

    expect(echoed.length).toBeGreaterThan(100);
    expect(error.message).not.toContain(echoed);
    expect(error.message).not.toContain("PRIVATE KEY-----\nMII");
  });

  test("a key that is not a service account key is refused before anything is sent", () => {
    expect(() => {
      return new GoogleWorkspaceClient({
        serviceAccountJson: '{"type":"authorized_user"}',
        adminEmail: FAKE_ADMIN_EMAIL,
        transport: createFakeWorkspaceApi({}).transport,
        requestTimeoutInMs: 15000,
      });
    }).toThrow(BadDataException);
  });
});

describe("GoogleWorkspaceClient - activities", () => {
  test("the URL lists an application over the window, at most a page, for one event when asked", () => {
    const workspace: GoogleWorkspaceClient = client(
      createFakeWorkspaceApi({}).transport,
    );
    const url: URL = new URL(
      workspace.buildActivitiesUrl({
        application: "drive",
        startTime: START,
        endTime: END,
        pageSize: 5000,
        eventName: "change_user_access",
        pageToken: "A:1700000000000000:-1:next",
      }),
    );

    expect(url.origin + url.pathname).toBe(
      "https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/drive",
    );
    expect(url.searchParams.get("startTime")).toBe("2026-10-30T09:00:00.000Z");
    expect(url.searchParams.get("endTime")).toBe("2026-10-30T10:00:00.000Z");
    expect(url.searchParams.get("maxResults")).toBe(
      String(GOOGLE_WORKSPACE_PAGE_SIZE),
    );
    expect(url.searchParams.get("eventName")).toBe("change_user_access");
    expect(url.searchParams.get("pageToken")).toBe(
      "A:1700000000000000:-1:next",
    );
  });

  test("an application name that is not one is refused", () => {
    const workspace: GoogleWorkspaceClient = client(
      createFakeWorkspaceApi({}).transport,
    );

    for (const application of ["../users", "LOGIN", "login?x=1", ""]) {
      expect(() => {
        return workspace.buildActivitiesUrl({
          application,
          startTime: START,
          endTime: END,
        });
      }).toThrow(APIException);
    }
  });

  test("pages are newest first and followed by nextPageToken, with the bearer token", async () => {
    const api: FakeWorkspaceApi = createFakeWorkspaceApi({
      activities: {
        login: [
          activityAt("2026-10-30T09:10:00.000Z", "1"),
          activityAt("2026-10-30T09:20:00.000Z", "2"),
          activityAt("2026-10-30T09:30:00.000Z", "3"),
        ],
      },
    });
    const workspace: GoogleWorkspaceClient = client(api.transport);
    const first: GoogleWorkspaceActivityPage = await workspace.listActivities({
      application: "login",
      startTime: START,
      endTime: END,
      pageSize: 2,
    });

    expect(
      first.activities.map((activity: JSONObject): unknown => {
        return (activity["id"] as JSONObject)["uniqueQualifier"];
      }),
    ).toEqual(["3", "2"]);
    expect(first.nextPageToken).toBe("2");

    const second: GoogleWorkspaceActivityPage = await workspace.listActivities({
      application: "login",
      startTime: START,
      endTime: END,
      pageSize: 2,
      pageToken: first.nextPageToken!,
    });

    expect(second.activities).toHaveLength(1);
    expect(second.nextPageToken).toBeNull();

    for (const request of api.requests.slice(1)) {
      expect(request.headers?.["Authorization"]).toBe(
        `Bearer ${FAKE_ACCESS_TOKEN}`,
      );
      expect(request.acceptAnyStatus).toBe(true);
      expect(request.timeoutInMs).toBe(15000);
    }

    expect(activityRequests(api)).toHaveLength(2);
  });

  test("a page with no activities is an empty page, not an error", async () => {
    const api: FakeWorkspaceApi = createFakeWorkspaceApi({});
    const page: GoogleWorkspaceActivityPage = await client(
      api.transport,
    ).listActivities({ application: "admin", startTime: START, endTime: END });

    expect(page).toEqual({ activities: [], nextPageToken: null });
  });

  test("Google's reason travels with the error: the Admin SDK turned off, the Reports privilege missing", async () => {
    const disabled: Error = await caught(
      client(
        createFakeWorkspaceApi({
          failures: {
            login: {
              statusCode: 403,
              body: {
                error: {
                  code: 403,
                  message:
                    "Admin SDK API has not been used in project 1234 before or it is disabled.",
                  status: "PERMISSION_DENIED",
                  details: [
                    {
                      "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                      reason: "SERVICE_DISABLED",
                      domain: "googleapis.com",
                    },
                  ],
                },
              },
            },
          },
        }).transport,
      ).listActivities({
        application: "login",
        startTime: START,
        endTime: END,
      }),
    );
    const forbidden: Error = await caught(
      client(
        createFakeWorkspaceApi({
          failures: {
            admin: {
              statusCode: 403,
              body: googleError(
                403,
                "PERMISSION_DENIED",
                "Not Authorized to access this resource/api",
                "forbidden",
              ),
            },
          },
        }).transport,
      ).listActivities({
        application: "admin",
        startTime: START,
        endTime: END,
      }),
    );

    expect((disabled as GoogleWorkspaceHttpError).reason).toBe(
      "SERVICE_DISABLED",
    );
    expect(disabled.message).toContain(
      "login activities request failed (HTTP 403)",
    );
    expect((forbidden as GoogleWorkspaceHttpError).reason).toBe("forbidden");
    expect((forbidden as GoogleWorkspaceHttpError).statusCode).toBe(403);
  });

  test("a 401 mid-read mints a new token once and retries", async () => {
    const responses: Array<DataSourceHttpResponse> = [
      respond(200, { access_token: "first", expires_in: 3599 }),
      respond(401, googleError(401, "UNAUTHENTICATED", "expired", "authError")),
      respond(200, { access_token: "second", expires_in: 3599 }),
      respond(200, { kind: "admin#reports#activities" }),
    ];
    const requests: Array<DataSourceHttpRequest> = [];
    const page: GoogleWorkspaceActivityPage = await client(
      async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        requests.push(request);

        return responses.shift()!;
      },
    ).listActivities({ application: "token", startTime: START, endTime: END });

    expect(page.activities).toEqual([]);
    expect(requests).toHaveLength(4);
    expect(requests[3]!.headers?.["Authorization"]).toBe("Bearer second");
  });

  test("an answer that is not an activities list is an error", async () => {
    const responses: Array<DataSourceHttpResponse> = [
      respond(200, { access_token: "first", expires_in: 3599 }),
      respond(200, { items: "none" }),
    ];
    const error: Error = await caught(
      client(async (): Promise<DataSourceHttpResponse> => {
        return responses.shift()!;
      }).listActivities({
        application: "saml",
        startTime: START,
        endTime: END,
      }),
    );

    expect(error.message).toBe(
      "Google Workspace saml activities request returned an unrecognized response shape.",
    );
  });

  test("readApiErrorReason prefers ErrorInfo, then the legacy reason, then the status", () => {
    expect(
      GoogleWorkspaceClient.readApiErrorReason(
        googleError(403, "PERMISSION_DENIED", "x", "forbidden"),
      ),
    ).toBe("forbidden");
    expect(
      GoogleWorkspaceClient.readApiErrorReason({
        error: { code: 429, status: "RESOURCE_EXHAUSTED" },
      }),
    ).toBe("RESOURCE_EXHAUSTED");
    expect(
      GoogleWorkspaceClient.readApiErrorReason({
        error: { errors: [{ reason: "has spaces in it" }] },
      }),
    ).toBe("");
    expect(GoogleWorkspaceClient.readApiErrorReason("text")).toBe("");
    expect(
      GoogleWorkspaceClient.readTokenError({ error: "invalid_grant" }),
    ).toBe("invalid_grant");
    expect(GoogleWorkspaceClient.readTokenError({ error: 7 })).toBe("");
  });
});
