import { describe, expect, jest, test } from "@jest/globals";
import { generateKeyPairSync, KeyObject } from "crypto";
import SecurityEventConnection from "../../../../../Models/DatabaseModels/SecurityEventConnection";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../Server/Utils/DataSource/HttpFetch";
import AwsSecurityHubClient from "../../../../../Server/Utils/SecurityEvent/Connectors/AwsSecurityHubClient";
import CloudflareSecurityEventClient from "../../../../../Server/Utils/SecurityEvent/Connectors/CloudflareSecurityEventClient";
import CrowdStrikeFalconClient from "../../../../../Server/Utils/SecurityEvent/Connectors/CrowdStrikeFalconClient";
import GoogleSecurityCommandCenterClient from "../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecurityCommandCenterClient";
import MicrosoftGraphSecurityClient from "../../../../../Server/Utils/SecurityEvent/Connectors/MicrosoftGraphSecurityClient";
import OktaSystemLogClient from "../../../../../Server/Utils/SecurityEvent/Connectors/OktaSystemLogClient";
import SplunkEnterpriseSecurityClient from "../../../../../Server/Utils/SecurityEvent/Connectors/SplunkEnterpriseSecurityClient";
import {
  SecurityEventConnectorFetchResult,
  SecurityEventConnectorHttpRequest,
} from "../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import { JSONObject } from "../../../../../Types/JSON";

const startTime: Date = new Date("2026-01-01T00:00:00.000Z");
const endTime: Date = new Date("2026-01-01T00:01:00.000Z");

interface QueuedRequest {
  calls: Array<DataSourceHttpRequest>;
  request: SecurityEventConnectorHttpRequest;
}

interface GeneratedKeyPair {
  publicKey: KeyObject;
  privateKey: KeyObject;
}

function connection(
  configuration: JSONObject,
  credentials: JSONObject,
): SecurityEventConnection {
  return {
    configuration,
    credentialJson: JSON.stringify(credentials),
  } as SecurityEventConnection;
}

function response(
  bodyJson: unknown,
  headers?: Record<string, string>,
  bodyText?: string,
): DataSourceHttpResponse {
  return {
    statusCode: 200,
    bodyJson,
    bodyText: bodyText === undefined ? JSON.stringify(bodyJson) : bodyText,
    headers,
  };
}

function queuedRequest(
  responses: Array<DataSourceHttpResponse>,
): QueuedRequest {
  const calls: Array<DataSourceHttpRequest> = [];
  return {
    calls,
    request: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      calls.push(request);
      const next: DataSourceHttpResponse | undefined = responses.shift();
      if (!next) {
        throw new Error("Unexpected connector request.");
      }
      return next;
    },
  };
}

describe("security event connector HTTP clients", () => {
  test("AWS signs paginated findings requests and returns every page", async () => {
    const http: QueuedRequest = queuedRequest([
      response({ Findings: [{ Id: "first" }], NextToken: "page-two" }),
      response({ Findings: [{ Id: "second" }] }),
    ]);
    const client: AwsSecurityHubClient = new AwsSecurityHubClient(
      connection(
        { region: "eu-west-2" },
        {
          accessKeyId: "test-access-key",
          secretAccessKey: "test-secret-key",
          sessionToken: "test-session-token",
        },
      ),
      http.request,
    );

    const result: SecurityEventConnectorFetchResult = await client.fetchEvents({
      startTime,
      endTime,
    });

    expect(result).toMatchObject({
      events: [{ Id: "first" }, { Id: "second" }],
      complete: true,
      requestCount: 2,
      warnings: [],
    });
    expect(http.calls[0]).toMatchObject({
      method: "POST",
      url: "https://securityhub.eu-west-2.amazonaws.com/findings",
      timeoutInMs: 30_000,
      headers: {
        Host: "securityhub.eu-west-2.amazonaws.com",
        "X-Amz-Security-Token": "test-session-token",
      },
    });
    expect(http.calls[0]?.headers?.["Authorization"]).toContain(
      "Credential=test-access-key/",
    );
    expect(http.calls[0]?.headers?.["Authorization"]).not.toContain(
      "test-secret-key",
    );
    expect(JSON.parse(http.calls[1]?.body as string)).toMatchObject({
      NextToken: "page-two",
    });
  });

  test.each([
    [
      "commercial",
      "eu-west-2",
      "securityhub.eu-west-2.amazonaws.com",
      "5effdab30cf77931a3d23ae06848d5e747a9511cfe445b78560861e1b85237ea",
    ],
    [
      "GovCloud",
      "us-gov-west-1",
      "securityhub.us-gov-west-1.amazonaws.com",
      "22f3cb6daf50f76586bad453e7486b3e083734678e8115452315e95c20982afd",
    ],
    [
      "China",
      "cn-north-1",
      "securityhub.cn-north-1.amazonaws.com.cn",
      "8bda7af50a1479ecadd38a8d033fd223757c8768519f6d545f74ee48cbd083b0",
    ],
  ])(
    "AWS uses the %s partition endpoint and signs its exact host",
    async (
      _partition: string,
      region: string,
      hostname: string,
      signature: string,
    ) => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-01-02T03:04:05.000Z"));
      try {
        const http: QueuedRequest = queuedRequest([response({ Findings: [] })]);
        const client: AwsSecurityHubClient = new AwsSecurityHubClient(
          connection(
            { region },
            {
              accessKeyId: "partition-access-key",
              secretAccessKey: "partition-secret",
            },
          ),
          http.request,
        );

        await client.fetchEvents({ startTime, endTime });

        expect(http.calls[0]).toMatchObject({
          method: "POST",
          url: `https://${hostname}/findings`,
          headers: {
            Host: hostname,
            "X-Amz-Date": "20260102T030405Z",
            Authorization:
              `AWS4-HMAC-SHA256 Credential=partition-access-key/20260102/${region}/securityhub/aws4_request, ` +
              `SignedHeaders=content-type;host;x-amz-date, Signature=${signature}`,
          },
        });
      } finally {
        jest.useRealTimers();
      }
    },
  );

  test("AWS reports incomplete after its bounded page limit", async () => {
    const http: QueuedRequest = queuedRequest(
      Array.from(
        { length: 10 },
        (_: unknown, index: number): DataSourceHttpResponse => {
          return response({
            Findings: [{ Id: String(index) }],
            NextToken: "more",
          });
        },
      ),
    );
    const client: AwsSecurityHubClient = new AwsSecurityHubClient(
      connection(
        { region: "us-east-1" },
        { accessKeyId: "id", secretAccessKey: "key" },
      ),
      http.request,
    );

    const result: SecurityEventConnectorFetchResult = await client.fetchEvents({
      startTime,
      endTime,
    });

    expect(result.complete).toBe(false);
    expect(result.events).toHaveLength(10);
    expect(result.continuation).toEqual({ nextToken: "more" });
    expect(result.warnings[0]).toContain("more pages");
  });

  test("Cloudflare sends its GraphQL time range, splits full windows, and keeps results", async () => {
    const fullBatch: Array<JSONObject> = Array.from(
      { length: 1000 },
      (_: unknown, index: number): JSONObject => {
        return { rayName: String(index) };
      },
    );
    const http: QueuedRequest = queuedRequest([
      response({
        data: { viewer: { zones: [{ firewallEventsAdaptive: fullBatch }] } },
      }),
      response({
        data: {
          viewer: {
            zones: [{ firewallEventsAdaptive: [{ rayName: "left" }] }],
          },
        },
      }),
      response({
        data: {
          viewer: {
            zones: [{ firewallEventsAdaptive: [{ rayName: "right" }] }],
          },
        },
      }),
    ]);
    const client: CloudflareSecurityEventClient =
      new CloudflareSecurityEventClient(
        connection(
          { accountId: "account", zoneId: "zone" },
          { apiToken: "cf-token" },
        ),
        http.request,
      );

    const result: SecurityEventConnectorFetchResult = await client.fetchEvents({
      startTime,
      endTime,
    });
    const firstBody: JSONObject = JSON.parse(
      http.calls[0]?.body as string,
    ) as JSONObject;

    expect(result).toMatchObject({
      complete: true,
      requestCount: 3,
      warnings: [],
    });
    expect(result.events).toEqual([{ rayName: "left" }, { rayName: "right" }]);
    expect(http.calls[0]).toMatchObject({
      method: "POST",
      url: "https://api.cloudflare.com/client/v4/graphql",
      headers: { Authorization: "Bearer cf-token" },
    });
    expect(firstBody).toMatchObject({
      variables: {
        zoneTag: "zone",
        filter: {
          datetime_geq: startTime.toISOString(),
          datetime_lt: endTime.toISOString(),
        },
      },
    });
  });

  test("Cloudflare makes a one-second full result window explicitly incomplete", async () => {
    const http: QueuedRequest = queuedRequest([
      response({
        data: {
          viewer: {
            zones: [
              {
                firewallEventsAdaptive: Array.from({ length: 1000 }, () => {
                  return {};
                }),
              },
            ],
          },
        },
      }),
    ]);
    const client: CloudflareSecurityEventClient =
      new CloudflareSecurityEventClient(
        connection(
          { accountId: "account", zoneId: "zone" },
          { apiToken: "token" },
        ),
        http.request,
      );

    const result: SecurityEventConnectorFetchResult = await client.fetchEvents({
      startTime,
      endTime: new Date(startTime.getTime() + 1000),
    });

    expect(result).toMatchObject({ complete: false, requestCount: 1 });
    expect(result.warnings[0]).toContain("may be truncated");
  });

  test("Cloudflare surfaces GraphQL error bodies", async () => {
    const http: QueuedRequest = queuedRequest([
      response({ errors: [{ message: "denied" }] }),
    ]);
    const client: CloudflareSecurityEventClient =
      new CloudflareSecurityEventClient(
        connection(
          { accountId: "account", zoneId: "zone" },
          { apiToken: "token" },
        ),
        http.request,
      );

    await expect(client.fetchEvents({ startTime, endTime })).rejects.toThrow(
      "denied",
    );
  });

  test("CrowdStrike exchanges credentials once and fetches a stable ID page", async () => {
    const http: QueuedRequest = queuedRequest([
      response({ access_token: "falcon-access-token" }),
      response({
        resources: ["a", "b", "c"],
        meta: { pagination: { total: 3 } },
      }),
      response({
        resources: [
          { composite_id: "a" },
          { composite_id: "b" },
          { composite_id: "c" },
        ],
      }),
    ]);
    const client: CrowdStrikeFalconClient = new CrowdStrikeFalconClient(
      connection({}, { clientId: "client-id", clientSecret: "client-secret" }),
      http.request,
    );

    const result: SecurityEventConnectorFetchResult = await client.fetchEvents({
      startTime,
      endTime,
    });

    expect(result).toMatchObject({
      complete: true,
      requestCount: 3,
      warnings: [],
    });
    expect(result.events).toHaveLength(3);
    expect(http.calls[0]).toMatchObject({
      method: "POST",
      url: "https://api.crowdstrike.com/oauth2/token",
      formUrlEncoded: true,
      body: { client_id: "client-id", client_secret: "client-secret" },
    });
    expect(http.calls[1]?.headers?.["Authorization"]).toBe(
      "Bearer falcon-access-token",
    );
    expect(http.calls[1]?.url).toContain("offset=0");
    expect(new URL(http.calls[1]!.url).searchParams.get("sort")).toBeNull();
    expect(
      http.calls
        .slice(1)
        .map((call: DataSourceHttpRequest): string => {
          return JSON.stringify(call);
        })
        .join("\n"),
    ).not.toContain("client-secret");
  });

  test("CrowdStrike treats a bounded alert-ID query as incomplete", async () => {
    const http: QueuedRequest = queuedRequest([
      response({ access_token: "token" }),
      response({
        resources: ["id-0"],
        meta: { pagination: { total: 21 } },
      }),
      response({
        resources: [{ composite_id: "id-0" }],
      }),
    ]);
    const client: CrowdStrikeFalconClient = new CrowdStrikeFalconClient(
      connection({}, { clientId: "id", clientSecret: "secret" }),
      http.request,
    );

    const result: SecurityEventConnectorFetchResult = await client.fetchEvents({
      startTime,
      endTime,
    });

    expect(result).toMatchObject({ complete: false, requestCount: 3 });
    expect(result.continuation).toBeUndefined();
    expect(result.warnings.join(" ")).toContain("without mutable offset");
  });

  test("Google SCC exchanges a signed assertion and follows page tokens", async () => {
    const keys: GeneratedKeyPair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const privateKey: string = keys.privateKey
      .export({ type: "pkcs1", format: "pem" })
      .toString();
    const http: QueuedRequest = queuedRequest([
      response({ access_token: "google-token" }),
      response({
        listFindingsResults: [
          { finding: { name: "first" }, resource: { name: "resource" } },
        ],
        nextPageToken: "next-page",
      }),
      response({ listFindingsResults: [{ finding: { name: "second" } }] }),
    ]);
    const client: GoogleSecurityCommandCenterClient =
      new GoogleSecurityCommandCenterClient(
        connection(
          { parent: "organizations/123/sources/-" },
          { client_email: "service@example.test", private_key: privateKey },
        ),
        http.request,
      );

    const result: SecurityEventConnectorFetchResult = await client.fetchEvents({
      startTime,
      endTime,
    });

    expect(result).toMatchObject({
      complete: true,
      requestCount: 3,
      warnings: [],
    });
    expect(result.events).toEqual([
      { finding: { name: "first" }, resource: { name: "resource" } },
      { finding: { name: "second" } },
    ]);
    expect(http.calls[0]).toMatchObject({
      method: "POST",
      url: "https://oauth2.googleapis.com/token",
      formUrlEncoded: true,
      body: { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer" },
    });
    expect(http.calls[1]?.headers?.["Authorization"]).toBe(
      "Bearer google-token",
    );
    expect(new URL(http.calls[1]!.url).searchParams.get("filter")).toBe(
      `eventTime >= "${startTime.toISOString()}" AND eventTime < "${endTime.toISOString()}"`,
    );
    expect(new URL(http.calls[1]!.url).searchParams.get("orderBy")).toBe(
      "eventTime asc",
    );
    expect(http.calls[2]?.url).toContain("pageToken=next-page");
  });

  test("Microsoft includes paged alerts and incidents", async () => {
    const http: QueuedRequest = queuedRequest([
      response({ access_token: "graph-token" }),
      response({
        value: [{ id: "alert-one" }],
        "@odata.nextLink":
          "https://graph.microsoft.com/v1.0/security/alerts_v2?$skiptoken=two",
      }),
      response({ value: [{ id: "alert-two", "@odata.type": "provided" }] }),
      response({ value: [{ id: "incident-one" }] }),
    ]);
    const client: MicrosoftGraphSecurityClient =
      new MicrosoftGraphSecurityClient(
        connection(
          { tenantId: "tenant/with slash" },
          { clientId: "client", clientSecret: "secret" },
        ),
        http.request,
      );

    const result: SecurityEventConnectorFetchResult = await client.fetchEvents({
      startTime,
      endTime,
    });

    expect(result).toMatchObject({
      complete: true,
      requestCount: 4,
      warnings: [],
    });
    expect(result.events).toEqual([
      { id: "alert-one", "@odata.type": "#microsoft.graph.security.alert" },
      { id: "alert-two", "@odata.type": "provided" },
      {
        id: "incident-one",
        "@odata.type": "#microsoft.graph.security.incident",
      },
    ]);
    expect(http.calls[0]?.url).toContain("tenant%2Fwith%20slash");
    expect(http.calls[1]?.url).toContain("%24filter=");
    expect(http.calls[2]?.url).toContain("$skiptoken=two");
    expect(
      http.calls
        .slice(1)
        .map((call: DataSourceHttpRequest): string => {
          return JSON.stringify(call);
        })
        .join("\n"),
    ).not.toContain("secret");
  });

  test("Microsoft stops before calling an unsafe pagination URL", async () => {
    const http: QueuedRequest = queuedRequest([
      response({ access_token: "token" }),
      response({
        value: [],
        "@odata.nextLink": "https://attacker.example/v1.0/security/alerts_v2",
      }),
    ]);
    const client: MicrosoftGraphSecurityClient =
      new MicrosoftGraphSecurityClient(
        connection(
          { tenantId: "tenant" },
          { clientId: "client", clientSecret: "secret" },
        ),
        http.request,
      );

    await expect(client.fetchEvents({ startTime, endTime })).rejects.toThrow(
      "unsafe pagination URL",
    );
    expect(http.calls).toHaveLength(2);
  });

  test("Okta saves its ascending polling link without a bounded until filter", async () => {
    const pages: Array<DataSourceHttpResponse> = Array.from(
      { length: 10 },
      (_: unknown, index: number): DataSourceHttpResponse => {
        return response([{ uuid: String(index) }], {
          link: '<https://okta.example/api/v1/logs?after=more>; rel="next"',
        });
      },
    );
    const http: QueuedRequest = queuedRequest(pages);
    const client: OktaSystemLogClient = new OktaSystemLogClient(
      connection(
        { baseUrl: "https://okta.example/tenant" },
        { apiToken: "okta-token" },
      ),
      http.request,
    );

    const result: SecurityEventConnectorFetchResult = await client.fetchEvents({
      startTime,
      endTime,
    });

    expect(result).toMatchObject({
      complete: true,
      requestCount: 10,
      continuation: {
        nextUrl: "https://okta.example/api/v1/logs?after=more",
      },
    });
    expect(result.events).toHaveLength(10);
    expect(result.warnings[0]).toContain("next polling link was saved");
    expect(http.calls[0]).toMatchObject({
      headers: { Authorization: "SSWS okta-token" },
    });
    expect(http.calls[0]?.url).toContain("sortOrder=ASCENDING");
    expect(http.calls[0]?.url).toContain(
      `since=${encodeURIComponent(startTime.toISOString())}`,
    );
    expect(http.calls[0]?.url).not.toContain("until=");
  });

  test("Okta resumes the exact provider polling link so delayed events remain eligible", async () => {
    const savedNextUrl: string =
      "https://okta.example/api/v1/logs?after=saved-provider-cursor";
    const nextUrl: string =
      "https://okta.example/api/v1/logs?after=next-provider-cursor";
    const http: QueuedRequest = queuedRequest([
      response([], { link: `<${nextUrl}>; rel="next"` }),
    ]);
    const client: OktaSystemLogClient = new OktaSystemLogClient(
      connection({ baseUrl: "https://okta.example" }, { apiToken: "token" }),
      http.request,
    );

    const result: SecurityEventConnectorFetchResult = await client.fetchEvents({
      startTime,
      endTime,
      continuation: { nextUrl: savedNextUrl },
    });

    expect(http.calls[0]?.url).toBe(savedNextUrl);
    expect(result).toMatchObject({
      complete: true,
      continuation: { nextUrl },
    });
  });

  test("Okta stops before calling a pagination link from another origin", async () => {
    const http: QueuedRequest = queuedRequest([
      response([], {
        link: '<https://attacker.example/api/v1/logs?after=bad>; rel="next"',
      }),
    ]);
    const client: OktaSystemLogClient = new OktaSystemLogClient(
      connection({ baseUrl: "https://okta.example" }, { apiToken: "token" }),
      http.request,
    );

    await expect(client.fetchEvents({ startTime, endTime })).rejects.toThrow(
      "unsafe pagination URL",
    );
    expect(http.calls).toHaveLength(1);
  });

  test("Splunk parses streaming export records and makes its 1,000-result ceiling visible", async () => {
    const fullExport: string = `${'{"result":{"id":"one"}}\n'}${'{"results":[{"id":"two"},{"id":"three"}]}\n'}`;
    const http: QueuedRequest = queuedRequest([
      response(undefined, undefined, fullExport),
    ]);
    const client: SplunkEnterpriseSecurityClient =
      new SplunkEnterpriseSecurityClient(
        connection(
          {
            baseUrl: "https://splunk.example:8089",
            search: "search index=main",
          },
          { apiToken: "splunk-token" },
        ),
        http.request,
      );

    const result: SecurityEventConnectorFetchResult = await client.fetchEvents({
      startTime,
      endTime,
    });

    expect(result).toMatchObject({
      events: [{ id: "one" }, { id: "two" }, { id: "three" }],
      complete: true,
      requestCount: 1,
    });
    expect(http.calls[0]).toMatchObject({
      method: "POST",
      url: "https://splunk.example:8089/services/search/v2/jobs/export",
      formUrlEncoded: true,
      headers: { Authorization: "Bearer splunk-token" },
      body: {
        search: "search index=main",
        earliest_time: startTime.toISOString(),
        latest_time: endTime.toISOString(),
        max_count: "1000",
      },
    });

    const cappedHttp: QueuedRequest = queuedRequest([
      response(undefined, undefined, '{"result":{"id":"x"}}\n'.repeat(1_000)),
    ]);
    const cappedClient: SplunkEnterpriseSecurityClient =
      new SplunkEnterpriseSecurityClient(
        connection(
          { baseUrl: "https://splunk.example" },
          { apiToken: "token" },
        ),
        cappedHttp.request,
      );
    const cappedResult: SecurityEventConnectorFetchResult =
      await cappedClient.fetchEvents({ startTime, endTime });
    expect(cappedResult).toMatchObject({ complete: false, requestCount: 1 });
    expect(cappedResult.warnings[0]).toContain("1,000-result ceiling");
  });

  test("Splunk supports session-key and basic authentication", async () => {
    const sessionHttp: QueuedRequest = queuedRequest([
      response(undefined, undefined, '{"result":{"id":"one"}}\n'),
    ]);
    const sessionClient: SplunkEnterpriseSecurityClient =
      new SplunkEnterpriseSecurityClient(
        connection(
          { baseUrl: "https://splunk.example" },
          { apiToken: "session-key", tokenScheme: "Splunk" },
        ),
        sessionHttp.request,
      );
    await sessionClient.fetchEvents({ startTime, endTime });
    expect(sessionHttp.calls[0]?.headers).toMatchObject({
      Authorization: "Splunk session-key",
    });

    const basicHttp: QueuedRequest = queuedRequest([
      response(undefined, undefined, '{"result":{"id":"two"}}\n'),
    ]);
    const basicClient: SplunkEnterpriseSecurityClient =
      new SplunkEnterpriseSecurityClient(
        connection(
          { baseUrl: "https://splunk.example" },
          { username: "reader", password: "secret" },
        ),
        basicHttp.request,
      );
    await basicClient.fetchEvents({ startTime, endTime });
    expect(basicHttp.calls[0]?.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from("reader:secret").toString("base64")}`,
    });
  });

  test("Splunk reports malformed export error bodies", async () => {
    const http: QueuedRequest = queuedRequest([
      response(undefined, undefined, "not json\n"),
    ]);
    const client: SplunkEnterpriseSecurityClient =
      new SplunkEnterpriseSecurityClient(
        connection(
          { baseUrl: "https://splunk.example" },
          { apiToken: "token" },
        ),
        http.request,
      );

    await expect(client.fetchEvents({ startTime, endTime })).rejects.toThrow(
      "non-JSON result line",
    );
  });

  test("AWS resumes a saved page token and rejects mixed findings arrays", async () => {
    const resumeHttp: QueuedRequest = queuedRequest([
      response({ Findings: [] }),
    ]);
    const resumeClient: AwsSecurityHubClient = new AwsSecurityHubClient(
      connection(
        { region: "us-east-1" },
        { accessKeyId: "id", secretAccessKey: "secret" },
      ),
      resumeHttp.request,
    );
    await resumeClient.fetchEvents({
      startTime,
      endTime,
      continuation: { nextToken: "saved-token" },
    });
    expect(JSON.parse(String(resumeHttp.calls[0]?.body))).toMatchObject({
      NextToken: "saved-token",
    });

    const malformedHttp: QueuedRequest = queuedRequest([
      response({ Findings: [{ Id: "one" }, "bad-member"] }),
    ]);
    const malformedClient: AwsSecurityHubClient = new AwsSecurityHubClient(
      connection(
        { region: "us-east-1" },
        { accessKeyId: "id", secretAccessKey: "secret" },
      ),
      malformedHttp.request,
    );
    await expect(
      malformedClient.fetchEvents({ startTime, endTime }),
    ).rejects.toThrow("non-object result array member");
  });

  test("Cloudflare rejects invisible zones and malformed event members", async () => {
    const missingZoneHttp: QueuedRequest = queuedRequest([
      response({ data: { viewer: { zones: [] } } }),
    ]);
    const missingZoneClient: CloudflareSecurityEventClient =
      new CloudflareSecurityEventClient(
        connection(
          { accountId: "account", zoneId: "missing" },
          { apiToken: "token" },
        ),
        missingZoneHttp.request,
      );
    await expect(
      missingZoneClient.fetchEvents({ startTime, endTime }),
    ).rejects.toThrow("no matching zone");

    const malformedHttp: QueuedRequest = queuedRequest([
      response({
        data: {
          viewer: {
            zones: [{ firewallEventsAdaptive: [{ rayName: "one" }, 7] }],
          },
        },
      }),
    ]);
    const malformedClient: CloudflareSecurityEventClient =
      new CloudflareSecurityEventClient(
        connection(
          { accountId: "account", zoneId: "zone" },
          { apiToken: "token" },
        ),
        malformedHttp.request,
      );
    await expect(
      malformedClient.fetchEvents({ startTime, endTime }),
    ).rejects.toThrow("non-object result array member");
  });

  test("CrowdStrike surfaces API errors and detects exact missing entities", async () => {
    const errorHttp: QueuedRequest = queuedRequest([
      response({ access_token: "token" }),
      response({
        resources: [],
        errors: [{ code: "403", message: "denied" }],
      }),
    ]);
    const errorClient: CrowdStrikeFalconClient = new CrowdStrikeFalconClient(
      connection({}, { clientId: "id", clientSecret: "secret" }),
      errorHttp.request,
    );
    await expect(
      errorClient.fetchEvents({ startTime, endTime }),
    ).rejects.toThrow("403: denied");

    const partialHttp: QueuedRequest = queuedRequest([
      response({ access_token: "token" }),
      response({
        resources: ["a", "b"],
        meta: { pagination: { total: 2 } },
      }),
      response({
        resources: [{ composite_id: "a" }, { composite_id: "other" }],
      }),
    ]);
    const partialClient: CrowdStrikeFalconClient = new CrowdStrikeFalconClient(
      connection({}, { clientId: "id", clientSecret: "secret" }),
      partialHttp.request,
    );
    const partialResult: SecurityEventConnectorFetchResult =
      await partialClient.fetchEvents({
        startTime,
        endTime,
      });
    expect(partialResult.complete).toBe(false);
    expect(partialResult.continuation).toBeUndefined();
    expect(partialResult.warnings.join(" ")).toContain("omitted 1");
  });

  test("Microsoft, Google, and Okta reject malformed result containers", async () => {
    const microsoftHttp: QueuedRequest = queuedRequest([
      response({ access_token: "token" }),
      response({ value: { id: "not-an-array" } }),
    ]);
    const microsoftClient: MicrosoftGraphSecurityClient =
      new MicrosoftGraphSecurityClient(
        connection(
          { tenantId: "tenant" },
          { clientId: "id", clientSecret: "secret" },
        ),
        microsoftHttp.request,
      );
    await expect(
      microsoftClient.fetchEvents({ startTime, endTime }),
    ).rejects.toThrow("invalid result array");

    const keys: GeneratedKeyPair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const privateKey: string = keys.privateKey
      .export({ type: "pkcs1", format: "pem" })
      .toString();
    const googleHttp: QueuedRequest = queuedRequest([
      response({ access_token: "token" }),
      response({ listFindingsResults: [{ finding: {} }, false] }),
    ]);
    const googleClient: GoogleSecurityCommandCenterClient =
      new GoogleSecurityCommandCenterClient(
        connection(
          { parent: "organizations/123/sources/-" },
          { client_email: "service@example.test", private_key: privateKey },
        ),
        googleHttp.request,
      );
    await expect(
      googleClient.fetchEvents({ startTime, endTime }),
    ).rejects.toThrow("non-object result array member");

    const oktaHttp: QueuedRequest = queuedRequest([
      response({ uuid: "not-an-array" }),
    ]);
    const oktaClient: OktaSystemLogClient = new OktaSystemLogClient(
      connection({ baseUrl: "https://okta.example" }, { apiToken: "token" }),
      oktaHttp.request,
    );
    await expect(
      oktaClient.fetchEvents({ startTime, endTime }),
    ).rejects.toThrow("invalid result array");
  });

  test("Splunk surfaces search messages and rejects mixed result arrays", async () => {
    const errorHttp: QueuedRequest = queuedRequest([
      response(
        undefined,
        undefined,
        '{"messages":[{"type":"ERROR","text":"search denied"}]}\n',
      ),
    ]);
    const errorClient: SplunkEnterpriseSecurityClient =
      new SplunkEnterpriseSecurityClient(
        connection(
          { baseUrl: "https://splunk.example" },
          { apiToken: "token" },
        ),
        errorHttp.request,
      );
    await expect(
      errorClient.fetchEvents({ startTime, endTime }),
    ).rejects.toThrow("search denied");

    const warningHttp: QueuedRequest = queuedRequest([
      response(
        undefined,
        undefined,
        '{"messages":[{"type":"WARN","text":"partial index"}],"result":{"id":"one"}}\n',
      ),
    ]);
    const warningClient: SplunkEnterpriseSecurityClient =
      new SplunkEnterpriseSecurityClient(
        connection(
          { baseUrl: "https://splunk.example" },
          { apiToken: "token" },
        ),
        warningHttp.request,
      );
    const warningResult: SecurityEventConnectorFetchResult =
      await warningClient.fetchEvents({
        startTime,
        endTime,
      });
    expect(warningResult.warnings).toContain(
      "Splunk search warning: partial index",
    );

    const malformedHttp: QueuedRequest = queuedRequest([
      response(undefined, undefined, '{"results":[{"id":"one"},3]}\n'),
    ]);
    const malformedClient: SplunkEnterpriseSecurityClient =
      new SplunkEnterpriseSecurityClient(
        connection(
          { baseUrl: "https://splunk.example" },
          { apiToken: "token" },
        ),
        malformedHttp.request,
      );
    await expect(
      malformedClient.fetchEvents({ startTime, endTime }),
    ).rejects.toThrow("non-object result array member");
  });

  test("forwards cancellation signals through provider and identity requests", async () => {
    const controller: AbortController = new AbortController();
    const awsHttp: QueuedRequest = queuedRequest([response({ Findings: [] })]);
    await new AwsSecurityHubClient(
      connection(
        { region: "us-east-1" },
        { accessKeyId: "id", secretAccessKey: "secret" },
      ),
      awsHttp.request,
    ).fetchEvents({ startTime, endTime, signal: controller.signal });

    const microsoftHttp: QueuedRequest = queuedRequest([
      response({ access_token: "token" }),
      response({ value: [] }),
      response({ value: [] }),
    ]);
    await new MicrosoftGraphSecurityClient(
      connection(
        { tenantId: "tenant" },
        { clientId: "id", clientSecret: "secret" },
      ),
      microsoftHttp.request,
    ).fetchEvents({ startTime, endTime, signal: controller.signal });

    expect(
      [...awsHttp.calls, ...microsoftHttp.calls].every(
        (call: DataSourceHttpRequest): boolean => {
          return call.signal === controller.signal;
        },
      ),
    ).toBe(true);
  });
});
