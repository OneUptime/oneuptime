import { describe, expect, test } from "@jest/globals";
import MicrosoftEntraIdClient, {
  ENTRA_PREMIUM_REQUIRED_CODE,
  MICROSOFT_ENTRA_ID_PAGE_SIZE,
  Microsoft365Content,
  Microsoft365ContentPage,
  Microsoft365Subscription,
  MicrosoftEntraIdCloud,
  MicrosoftEntraIdHttpError,
  MicrosoftEntraIdPage,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/MicrosoftEntraId/MicrosoftEntraIdClient";
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
  FAKE_CLIENT_ID,
  FAKE_CLIENT_SECRET,
  FAKE_TENANT_ID,
  FakeEntraApi,
  apiError,
  createFakeEntraApi,
  requestsTo,
  respond,
} from "./MicrosoftEntraIdFakeApi";
import {
  entraRoleAssignment,
  entraSignIn,
} from "../../../../../Utils/SecurityEvent/Connectors/EntraIdFixtures";

/*
 * The Graph and Management API client as the connector depends on it:
 * one token per resource, the log URLs and their ge/le window, paging
 * that never leaves the API's own host, the Management API's
 * subscriptions, content listing and blobs, the 401 retry, the error codes
 * the connector reads, and that no credential leaves through an error
 * message. The transport is the injected seam; no network.
 */

const START: Date = new Date("2026-10-30T09:00:00.000Z");
const END: Date = new Date("2026-10-30T10:00:00.000Z");

function client(
  transport: (
    request: DataSourceHttpRequest,
  ) => Promise<DataSourceHttpResponse>,
  cloud: MicrosoftEntraIdCloud = "public",
): MicrosoftEntraIdClient {
  return new MicrosoftEntraIdClient({
    tenantId: FAKE_TENANT_ID,
    clientId: FAKE_CLIENT_ID,
    clientSecret: FAKE_CLIENT_SECRET,
    cloud,
    transport,
    requestTimeoutInMs: 15000,
  });
}

function scripted(responses: Array<DataSourceHttpResponse>): {
  requests: Array<DataSourceHttpRequest>;
  transport: (
    request: DataSourceHttpRequest,
  ) => Promise<DataSourceHttpResponse>;
} {
  const requests: Array<DataSourceHttpRequest> = [];

  return {
    requests,
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      requests.push(request);
      const next: DataSourceHttpResponse | undefined = responses.shift();

      if (!next) {
        throw new Error(`Unexpected request to ${request.url}`);
      }

      return next;
    },
  };
}

function token(): DataSourceHttpResponse {
  return respond(200, {
    token_type: "Bearer",
    expires_in: 3599,
    access_token: FAKE_ACCESS_TOKEN,
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

describe("MicrosoftEntraIdClient - tokens", () => {
  test("the client credentials grant asks for one resource at a time, form encoded", async () => {
    const api: FakeEntraApi = createFakeEntraApi({});
    const entra: MicrosoftEntraIdClient = client(api.transport);

    await entra.getAccessToken("graph");
    await entra.getAccessToken("manage");

    expect(api.requests).toHaveLength(2);
    expect(api.requests[0]!.method).toBe("POST");
    expect(api.requests[0]!.url).toBe(
      `https://login.microsoftonline.com/${FAKE_TENANT_ID}/oauth2/v2.0/token`,
    );
    expect(api.requests[0]!.formUrlEncoded).toBe(true);
    expect(api.requests[0]!.body).toEqual({
      client_id: FAKE_CLIENT_ID,
      scope: "https://graph.microsoft.com/.default",
      client_secret: FAKE_CLIENT_SECRET,
      grant_type: "client_credentials",
    });
    expect((api.requests[1]!.body as Dictionary<string>)["scope"]).toBe(
      "https://manage.office.com/.default",
    );
  });

  test("a token is kept for its life, per resource", async () => {
    const api: FakeEntraApi = createFakeEntraApi({});
    const entra: MicrosoftEntraIdClient = client(api.transport);

    await entra.getAccessToken("graph");
    await entra.getAccessToken("graph");

    expect(api.requests).toHaveLength(1);
    expect(entra.getRequestCount()).toBe(1);
  });

  test("Azure Government uses its own login, Graph and Management API hosts", async () => {
    const api: FakeEntraApi = createFakeEntraApi({});
    const entra: MicrosoftEntraIdClient = client(api.transport, "usgov");

    await entra.getAccessToken("manage");

    expect(
      api.requests[0]!.url.startsWith("https://login.microsoftonline.us/"),
    ).toBe(true);
    expect((api.requests[0]!.body as Dictionary<string>)["scope"]).toBe(
      "https://manage.office365.us/.default",
    );
    expect(
      entra.buildLogUrl({ log: "signIns", startTime: START, endTime: END }),
    ).toContain("https://graph.microsoft.us/v1.0/auditLogs/signIns");
    expect(entra.buildManagementUrl("subscriptions/list", {})).toContain(
      `https://manage.office365.us/api/v1.0/${FAKE_TENANT_ID}/activity/feed/subscriptions/list`,
    );
  });

  test("an unknown cloud is refused before anything is sent", () => {
    expect(() => {
      return client(
        createFakeEntraApi({}).transport,
        "china" as MicrosoftEntraIdCloud,
      );
    }).toThrow(BadDataException);
  });

  test("a refused secret names the cause, and never echoes the secret", async () => {
    const api: FakeEntraApi = createFakeEntraApi({
      tokenFailure: {
        statusCode: 401,
        body: {
          error: "invalid_client",
          error_description: `AADSTS7000215: Invalid client secret provided. Ensure the secret being sent is ${FAKE_CLIENT_SECRET}`,
          error_codes: [7000215],
        },
      },
    });
    const error: Error = await caught(
      client(api.transport).getAccessToken("graph"),
    );

    expect(error).toBeInstanceOf(MicrosoftEntraIdHttpError);
    expect((error as MicrosoftEntraIdHttpError).statusCode).toBe(401);
    expect(error.message).toContain("token request failed (HTTP 401)");
    expect(error.message).toContain(
      "Microsoft Entra rejected the client secret",
    );
    expect(error.message).not.toContain(FAKE_CLIENT_SECRET);
  });

  test("an app registration Entra does not know, and a tenant it does not know, are named", async () => {
    const unknownApp: Error = await caught(
      client(
        createFakeEntraApi({
          tokenFailure: {
            statusCode: 400,
            body: { error: "unauthorized_client", error_codes: [700016] },
          },
        }).transport,
      ).getAccessToken("graph"),
    );
    const unknownTenant: Error = await caught(
      client(
        createFakeEntraApi({
          tokenFailure: {
            statusCode: 400,
            body: { error: "invalid_request", error_codes: [90002] },
          },
        }).transport,
      ).getAccessToken("graph"),
    );

    expect(unknownApp.message).toContain(
      "did not find the Application (client) ID",
    );
    expect(unknownTenant.message).toContain("did not find the tenant");
  });

  test("a token response without a token is an error, not an empty bearer", async () => {
    const { transport } = scripted([respond(200, { token_type: "Bearer" })]);

    expect(
      (await caught(client(transport).getAccessToken("graph"))).message,
    ).toBe("Microsoft Entra ID token request returned no access_token.");
  });
});

describe("MicrosoftEntraIdClient - Graph logs", () => {
  test("the log URL reads [start, end) with ge and le, and asks for a page", () => {
    const entra: MicrosoftEntraIdClient = client(
      createFakeEntraApi({}).transport,
    );
    const url: URL = new URL(
      entra.buildLogUrl({
        log: "signIns",
        startTime: START,
        endTime: END,
        pageSize: 25,
      }),
    );

    expect(url.origin + url.pathname).toBe(
      "https://graph.microsoft.com/v1.0/auditLogs/signIns",
    );
    expect(url.searchParams.get("$filter")).toBe(
      "createdDateTime ge 2026-10-30T09:00:00.000Z and createdDateTime le 2026-10-30T09:59:59.999Z",
    );
    expect(url.searchParams.get("$top")).toBe("25");

    const audits: URL = new URL(
      entra.buildLogUrl({
        log: "directoryAudits",
        startTime: START,
        endTime: END,
        pageSize: 50000,
      }),
    );

    expect(audits.searchParams.get("$filter")).toContain("activityDateTime ge");
    expect(audits.searchParams.get("$top")).toBe(
      String(MICROSOFT_ENTRA_ID_PAGE_SIZE),
    );
  });

  test("pages follow @odata.nextLink with the bearer token", async () => {
    const api: FakeEntraApi = createFakeEntraApi({
      signIns: [
        entraSignIn({ id: "a", createdDateTime: "2026-10-30T09:10:00Z" }),
        entraSignIn({ id: "b", createdDateTime: "2026-10-30T09:20:00Z" }),
        entraSignIn({ id: "c", createdDateTime: "2026-10-30T09:30:00Z" }),
        // Outside the window.
        entraSignIn({ id: "d", createdDateTime: "2026-10-30T10:00:00Z" }),
      ],
    });
    const entra: MicrosoftEntraIdClient = client(api.transport);
    const first: MicrosoftEntraIdPage = await entra.listLog({
      log: "signIns",
      startTime: START,
      endTime: END,
      pageSize: 2,
    });

    expect(
      first.records.map((record: JSONObject): unknown => {
        return record["id"];
      }),
    ).toEqual(["c", "b"]);
    expect(first.nextLink).not.toBeNull();

    const second: MicrosoftEntraIdPage = await entra.listLogByNextLink(
      "signIns",
      first.nextLink!,
    );

    expect(
      second.records.map((record: JSONObject): unknown => {
        return record["id"];
      }),
    ).toEqual(["a"]);
    expect(second.nextLink).toBeNull();

    const graphRequests: Array<DataSourceHttpRequest> = requestsTo(
      api,
      "/auditLogs/signIns",
    );

    expect(graphRequests).toHaveLength(2);

    for (const request of graphRequests) {
      expect(request.headers?.["Authorization"]).toBe(
        `Bearer ${FAKE_ACCESS_TOKEN}`,
      );
      expect(request.acceptAnyStatus).toBe(true);
      expect(request.timeoutInMs).toBe(15000);
    }
  });

  test("a next link on another host, or over http, is refused before the token goes anywhere", async () => {
    const api: FakeEntraApi = createFakeEntraApi({});
    const entra: MicrosoftEntraIdClient = client(api.transport);

    for (const link of [
      "https://graph.microsoft.com.attacker.example/v1.0/auditLogs/signIns?$skiptoken=1",
      "http://graph.microsoft.com/v1.0/auditLogs/signIns?$skiptoken=1",
      "https://manage.office.com/api/v1.0/x",
      "not a url",
    ]) {
      const error: Error = await caught(
        entra.listLogByNextLink("signIns", link),
      );

      expect(error).toBeInstanceOf(APIException);
    }

    expect(api.requests).toHaveLength(0);
  });

  test("a sign-in read in a tenant without P1 or P2 carries Graph's code", async () => {
    const api: FakeEntraApi = createFakeEntraApi({
      signInsFailure: {
        statusCode: 403,
        body: apiError(
          ENTRA_PREMIUM_REQUIRED_CODE,
          "Neither tenant is B2C or tenant doesn't have premium license",
        ),
      },
    });
    const error: Error = await caught(
      client(api.transport).listLog({
        log: "signIns",
        startTime: START,
        endTime: END,
      }),
    );

    expect(error).toBeInstanceOf(MicrosoftEntraIdHttpError);
    expect((error as MicrosoftEntraIdHttpError).statusCode).toBe(403);
    expect((error as MicrosoftEntraIdHttpError).apiCode).toBe(
      ENTRA_PREMIUM_REQUIRED_CODE,
    );
    expect(error.message).toContain(`sign-ins request failed (HTTP 403)`);
    expect(error.message).toContain(
      `error code ${ENTRA_PREMIUM_REQUIRED_CODE}`,
    );
  });

  test("a 401 mid-read mints a new token once and retries", async () => {
    const { requests, transport } = scripted([
      token(),
      respond(
        401,
        apiError("InvalidAuthenticationToken", "Lifetime validation failed"),
      ),
      token(),
      respond(200, { value: [entraRoleAssignment()] }),
    ]);
    const page: MicrosoftEntraIdPage = await client(transport).listLog({
      log: "directoryAudits",
      startTime: START,
      endTime: END,
    });

    expect(page.records).toHaveLength(1);
    expect(requests).toHaveLength(4);
  });

  test("a second 401 is an error naming the step", async () => {
    const { transport } = scripted([
      token(),
      respond(401, apiError("InvalidAuthenticationToken", "expired")),
      token(),
      respond(401, apiError("InvalidAuthenticationToken", "expired")),
    ]);
    const error: Error = await caught(
      client(transport).listLog({
        log: "directoryAudits",
        startTime: START,
        endTime: END,
      }),
    );

    expect(error.message).toContain("audit logs request failed (HTTP 401)");
  });

  test("a page that is not a Graph collection is an error", async () => {
    const { transport } = scripted([token(), respond(200, { items: [] })]);

    expect(
      (
        await caught(
          client(transport).listLog({
            log: "signIns",
            startTime: START,
            endTime: END,
          }),
        )
      ).message,
    ).toBe(
      "Microsoft Entra ID sign-ins request returned an unrecognized response shape.",
    );
  });

  test("a request that never completes is named, with the transport's words redacted", async () => {
    const transport: (
      request: DataSourceHttpRequest,
    ) => Promise<DataSourceHttpResponse> = async (): Promise<DataSourceHttpResponse> => {
      throw new Error(`connect ETIMEDOUT client_secret=${FAKE_CLIENT_SECRET}`);
    };
    const error: Error = await caught(
      client(transport).getAccessToken("graph"),
    );

    expect(error.message).toContain(
      "Microsoft Entra ID token request did not complete",
    );
    expect(error.message).not.toContain(FAKE_CLIENT_SECRET);
  });
});

describe("MicrosoftEntraIdClient - Office 365 Management Activity API", () => {
  test("every address names the tenant and the publisher", () => {
    const entra: MicrosoftEntraIdClient = client(
      createFakeEntraApi({}).transport,
    );
    const url: URL = new URL(
      entra.buildManagementUrl("subscriptions/content", {
        contentType: "Audit.Exchange",
      }),
    );

    expect(url.origin + url.pathname).toBe(
      `https://manage.office.com/api/v1.0/${FAKE_TENANT_ID}/activity/feed/subscriptions/content`,
    );
    expect(url.searchParams.get("contentType")).toBe("Audit.Exchange");
    expect(url.searchParams.get("PublisherIdentifier")).toBe(FAKE_TENANT_ID);
  });

  test("subscriptions are listed and started with the Management API's own token", async () => {
    const api: FakeEntraApi = createFakeEntraApi({
      subscriptions: [{ contentType: "Audit.Exchange", status: "enabled" }],
    });
    const entra: MicrosoftEntraIdClient = client(api.transport);
    const before: Array<Microsoft365Subscription> =
      await entra.listSubscriptions();

    expect(before).toEqual([
      { contentType: "Audit.Exchange", status: "enabled" },
    ]);

    await entra.startSubscription("Audit.General");

    const start: DataSourceHttpRequest = requestsTo(
      api,
      "subscriptions/start",
    )[0]!;

    expect(start.method).toBe("POST");
    expect(new URL(start.url).searchParams.get("contentType")).toBe(
      "Audit.General",
    );
    // No webhook: the content is read by polling.
    expect(start.body).toEqual({});
    expect((api.requests[0]!.body as Dictionary<string>)["scope"]).toBe(
      "https://manage.office.com/.default",
    );
    expect(await entra.listSubscriptions()).toContainEqual({
      contentType: "Audit.General",
      status: "enabled",
    });
  });

  test("content is listed by second-precision UTC times and paged by the NextPageUri header", async () => {
    const api: FakeEntraApi = createFakeEntraApi({
      subscriptions: [{ contentType: "Audit.Exchange", status: "enabled" }],
      contentPageSize: 1,
      contents: [
        {
          contentId: "blob-1",
          contentType: "Audit.Exchange",
          contentCreated: "2026-10-30T09:05:00.000Z",
          records: [],
        },
        {
          contentId: "blob-2",
          contentType: "Audit.Exchange",
          contentCreated: "2026-10-30T09:35:00.000Z",
          records: [],
        },
      ],
    });
    const entra: MicrosoftEntraIdClient = client(api.transport);
    const first: Microsoft365ContentPage = await entra.listContent({
      contentType: "Audit.Exchange",
      startTime: new Date("2026-10-30T09:00:00.250Z"),
      endTime: END,
    });
    const listing: URL = new URL(
      requestsTo(api, "subscriptions/content")[0]!.url,
    );

    expect(listing.searchParams.get("startTime")).toBe("2026-10-30T09:00:00");
    expect(listing.searchParams.get("endTime")).toBe("2026-10-30T10:00:00");
    expect(
      first.contents.map((content: Microsoft365Content): string => {
        return content.contentId;
      }),
    ).toEqual(["blob-1"]);
    expect(first.nextPageUri).not.toBeNull();

    const second: Microsoft365ContentPage = await entra.listContentByNextPage(
      first.nextPageUri!,
    );

    expect(
      second.contents.map((content: Microsoft365Content): string => {
        return content.contentId;
      }),
    ).toEqual(["blob-2"]);
    expect(second.nextPageUri).toBeNull();
  });

  test("a blob's records are fetched from its contentUri, which must be on the Management API's host", async () => {
    const records: Array<JSONObject> = [{ Id: "1", Operation: "Set-Mailbox" }];
    const api: FakeEntraApi = createFakeEntraApi({
      contents: [
        {
          contentId: "blob-1",
          contentType: "Audit.Exchange",
          contentCreated: "2026-10-30T09:05:00.000Z",
          records,
        },
      ],
    });
    const entra: MicrosoftEntraIdClient = client(api.transport);

    expect(
      await entra.fetchContent(
        `https://manage.office.com/api/v1.0/${FAKE_TENANT_ID}/activity/feed/audit/blob-1`,
      ),
    ).toEqual(records);

    const before: number = api.requests.length;
    const error: Error = await caught(
      entra.fetchContent("https://blob.attacker.example/audit/blob-1"),
    );

    expect(error.message).toContain("returned a link on an unexpected host");
    expect(api.requests).toHaveLength(before);
  });

  test("a Management API error carries its AF code", async () => {
    const api: FakeEntraApi = createFakeEntraApi({
      subscriptionsFailure: {
        statusCode: 401,
        body: apiError(
          "AF10001",
          "The permission set (ActivityFeed.ReadDlp) sent in the request did not include the expected permission.",
        ),
      },
    });
    const error: Error = await caught(
      client(api.transport).listSubscriptions(),
    );

    expect((error as MicrosoftEntraIdHttpError).apiCode).toBe("AF10001");
    expect((error as MicrosoftEntraIdHttpError).statusCode).toBe(401);
  });

  test("managementTime writes UTC to the second", () => {
    expect(
      MicrosoftEntraIdClient.managementTime(
        new Date("2026-10-30T09:00:59.999Z"),
      ),
    ).toBe("2026-10-30T09:00:59");
  });
});

describe("MicrosoftEntraIdClient - error codes", () => {
  test("readApiErrorCode keeps only an identifier-shaped code", () => {
    expect(
      MicrosoftEntraIdClient.readApiErrorCode(apiError("AF20022", "x")),
    ).toBe("AF20022");
    expect(
      MicrosoftEntraIdClient.readApiErrorCode(
        apiError("Authorization_RequestDenied", "x"),
      ),
    ).toBe("Authorization_RequestDenied");
    expect(
      MicrosoftEntraIdClient.readApiErrorCode(
        apiError("eyJhbGciOi.secret value", "x"),
      ),
    ).toBe("");
    expect(MicrosoftEntraIdClient.readApiErrorCode({ error: "x" })).toBe("");
    expect(MicrosoftEntraIdClient.readApiErrorCode(null)).toBe("");
  });
});
