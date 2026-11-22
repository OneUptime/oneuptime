import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../Server/Utils/DataSource/HttpFetch";
import CrowdStrikeFalconResponseClient, {
  CROWDSTRIKE_IOC_SCOPE_HINT,
  CrowdStrikeIoc,
  CrowdStrikeIocWriteResult,
  readFalconRetryAfter,
} from "../../../../../Server/Utils/SecurityEvent/Response/CrowdStrikeFalconResponseClient";
import MicrosoftDefenderEndpointClient, {
  DEFENDER_INDICATOR_APPLICATION,
  DEFENDER_INDICATORS_PERMISSION_HINT,
  DefenderIndicator,
  DefenderIndicatorAction,
  DefenderIndicatorImportResult,
  DefenderIndicatorSubmission,
  DefenderIndicatorType,
  readAccessTokenRoles,
  readDefenderRetryAfter,
} from "../../../../../Server/Utils/SecurityEvent/Response/MicrosoftDefenderEndpointClient";
import { JSONObject } from "../../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The calls the blocklist's endpoint destinations make (#10346), against
 * recorded answers of Microsoft Defender for Endpoint's indicators API and
 * CrowdStrike Falcon's IOC Management: what each request says, how each
 * answer is read, and how a throttled, refused or full provider is said -
 * so the reconciler records why, and tries again later.
 */

type Responder = (request: DataSourceHttpRequest) => DataSourceHttpResponse;

interface RecordingTransport {
  requests: Array<DataSourceHttpRequest>;
  transport: (
    request: DataSourceHttpRequest,
  ) => Promise<DataSourceHttpResponse>;
}

function respond(
  statusCode: number,
  body: unknown,
  headers?: Record<string, string>,
): DataSourceHttpResponse {
  const bodyText: string = body === undefined ? "" : JSON.stringify(body);
  return {
    statusCode,
    bodyText,
    bodyJson: body,
    ...(headers ? { headers } : {}),
  };
}

function recording(responder: Responder): RecordingTransport {
  const requests: Array<DataSourceHttpRequest> = [];

  return {
    requests,
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      requests.push(request);
      return responder(request);
    },
  };
}

// A JWT whose payload carries these roles; its signature is never read here.
function tokenWithRoles(roles: Array<string> | undefined): string {
  const encode: (value: JSONObject) => string = (value: JSONObject): string => {
    return Buffer.from(JSON.stringify(value))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/[=]+$/, "");
  };

  return `${encode({ alg: "RS256" })}.${encode(roles ? { roles } : { aud: "x" })}.signature`;
}

const DEFENDER_TOKEN: string = tokenWithRoles([
  "Machine.Read.All",
  "Ti.ReadWrite.All",
]);

function isTokenRequest(request: DataSourceHttpRequest): boolean {
  return request.url.includes("/oauth2/");
}

function defenderClient(responder: Responder): {
  client: MicrosoftDefenderEndpointClient;
  requests: Array<DataSourceHttpRequest>;
} {
  const recorded: RecordingTransport = recording(
    (request: DataSourceHttpRequest): DataSourceHttpResponse => {
      return isTokenRequest(request)
        ? respond(200, { access_token: DEFENDER_TOKEN })
        : responder(request);
    },
  );

  return {
    client: new MicrosoftDefenderEndpointClient({
      tenantId: "tenant-1",
      clientId: "client-1",
      clientSecret: "SECRET-DEFENDER",
      cloud: "public",
      transport: recorded.transport,
    }),
    requests: recorded.requests,
  };
}

function apiRequests(
  requests: Array<DataSourceHttpRequest>,
): Array<DataSourceHttpRequest> {
  return requests.filter((request: DataSourceHttpRequest): boolean => {
    return !isTokenRequest(request);
  });
}

function bodyOf(request: DataSourceHttpRequest | undefined): JSONObject {
  return JSON.parse(String(request?.body || "{}")) as JSONObject;
}

// An indicator as Defender lists it (the entity of the List Indicators example).
function listedIndicator(id: number, value: string): JSONObject {
  return {
    id: String(id),
    indicatorValue: value,
    indicatorType: "DomainName",
    action: "Block",
    application: DEFENDER_INDICATOR_APPLICATION,
    source: "OneUptime",
    sourceType: "AadApp",
    title: `OneUptime: ${value}`,
    description: "OneUptime blocklist until lifted [oneuptime:c1]",
    expirationTime: "2026-12-01T10:00:00Z",
    severity: "High",
  };
}

const SUBMISSION: DefenderIndicatorSubmission = {
  indicatorValue: "evil.example",
  indicatorType: DefenderIndicatorType.DomainName,
  action: DefenderIndicatorAction.Block,
  title: "OneUptime: evil.example",
  description:
    "OneUptime case CASE-7 until 2026-12-01 10:00 UTC [oneuptime:c1]",
  expirationTime: new Date("2026-12-01T10:00:00Z"),
};

describe("Microsoft Defender indicators: listing OneUptime's", () => {
  test("filters on OneUptime's application, 10,000 a page, and reads every field", async () => {
    const { client, requests } = defenderClient(() => {
      return respond(200, {
        "@odata.context":
          "https://api.security.microsoft.com/api/$metadata#Indicators",
        value: [listedIndicator(995, "evil.example")],
      });
    });

    const indicators: Array<DefenderIndicator> = await client.listIndicators();
    const request: DataSourceHttpRequest = apiRequests(requests)[0]!;
    const url: URL = new URL(request.url);

    expect(url.origin).toBe("https://api.security.microsoft.com");
    expect(url.pathname).toBe("/api/indicators");
    expect(url.searchParams.get("$filter")).toBe("application eq 'OneUptime'");
    expect(url.searchParams.get("$top")).toBe("10000");
    expect(url.searchParams.get("$skip")).toBe("0");
    expect(request.headers?.["Authorization"]).toBe(`Bearer ${DEFENDER_TOKEN}`);
    // Every status comes back with its headers, for a 429's Retry-After.
    expect(request.acceptAnyStatus).toBe(true);

    expect(indicators).toEqual([
      {
        id: "995",
        indicatorValue: "evil.example",
        indicatorType: "DomainName",
        action: "Block",
        application: "OneUptime",
        title: "OneUptime: evil.example",
        description: "OneUptime blocklist until lifted [oneuptime:c1]",
        expirationTime: new Date("2026-12-01T10:00:00Z"),
      },
    ]);
  });

  test("reads every page until one is short", async () => {
    const full: Array<JSONObject> = Array.from(
      { length: 10000 },
      (_unused: unknown, index: number): JSONObject => {
        return listedIndicator(index + 1, `evil${index}.example`);
      },
    );
    const { client, requests } = defenderClient(
      (request: DataSourceHttpRequest): DataSourceHttpResponse => {
        const skip: string | null = new URL(request.url).searchParams.get(
          "$skip",
        );

        return respond(200, {
          value: skip === "0" ? full : [listedIndicator(20001, "last.example")],
        });
      },
    );

    const indicators: Array<DefenderIndicator> = await client.listIndicators();

    expect(indicators.length).toBe(10001);
    expect(
      apiRequests(requests).map((request: DataSourceHttpRequest) => {
        return new URL(request.url).searchParams.get("$skip");
      }),
    ).toEqual(["0", "10000"]);
  });

  test("an indicator without an id, or an answer without a list, is nothing held", async () => {
    const { client } = defenderClient(() => {
      return respond(200, { value: [{ indicatorValue: "x.example" }, null] });
    });

    expect(await client.listIndicators()).toEqual([]);

    const { client: empty } = defenderClient(() => {
      return respond(200, {});
    });

    expect(await empty.listIndicators()).toEqual([]);
  });
});

describe("Microsoft Defender indicators: importing", () => {
  test("sends each indicator filed under OneUptime, on every device, with its end", async () => {
    const { client, requests } = defenderClient(() => {
      return respond(200, {
        value: [
          {
            id: "2841",
            indicator: "evil.example",
            isFailed: false,
            failureReason: null,
          },
        ],
      });
    });

    const results: Array<DefenderIndicatorImportResult> =
      await client.importIndicators([
        SUBMISSION,
        { ...SUBMISSION, indicatorValue: "x.example", expirationTime: null },
      ]);
    const request: DataSourceHttpRequest = apiRequests(requests)[0]!;
    const sent: Array<JSONObject> = bodyOf(request)[
      "Indicators"
    ] as Array<JSONObject>;

    expect(request.method).toBe("POST");
    expect(request.url).toBe(
      "https://api.security.microsoft.com/api/indicators/import",
    );
    expect(sent[0]).toEqual({
      indicatorValue: "evil.example",
      indicatorType: "DomainName",
      action: "Block",
      application: "OneUptime",
      title: "OneUptime: evil.example",
      description:
        "OneUptime case CASE-7 until 2026-12-01 10:00 UTC [oneuptime:c1]",
      severity: "High",
      generateAlert: false,
      expirationTime: "2026-12-01T10:00:00.000Z",
    });
    // A block kept until lifted has no end at Defender either; no device group means every device.
    expect(sent[1]!["expirationTime"]).toBeUndefined();
    expect(sent[1]!["rbacGroupNames"]).toBeUndefined();

    expect(results).toEqual([
      {
        indicatorValue: "evil.example",
        id: "2841",
        isFailed: false,
        failureReason: null,
      },
      {
        indicatorValue: "x.example",
        id: null,
        isFailed: true,
        failureReason: "Microsoft Defender said nothing about it",
      },
    ]);
  });

  test("keeps a title and a description to the lengths Defender takes", async () => {
    const { client, requests } = defenderClient(() => {
      return respond(200, { value: [] });
    });

    await client.importIndicators([
      { ...SUBMISSION, title: "t".repeat(300), description: "d".repeat(900) },
    ]);

    const sent: JSONObject = (
      bodyOf(apiRequests(requests)[0])["Indicators"] as Array<JSONObject>
    )[0]!;

    expect(String(sent["title"]).length).toBe(100);
    expect(String(sent["description"]).length).toBe(500);
  });

  test("500 a call, the most an import takes", async () => {
    const { client, requests } = defenderClient(() => {
      return respond(200, { value: [] });
    });

    await client.importIndicators(
      Array.from({ length: 1001 }, (_unused: unknown, index: number) => {
        return { ...SUBMISSION, indicatorValue: `e${index}.example` };
      }),
    );

    expect(
      apiRequests(requests).map((request: DataSourceHttpRequest) => {
        return (bodyOf(request)["Indicators"] as Array<unknown>).length;
      }),
    ).toEqual([500, 500, 1]);
  });

  test("an indicator Defender refuses says why - a full tenant among them", async () => {
    const { client } = defenderClient(() => {
      return respond(200, {
        value: [
          {
            id: null,
            indicator: "EVIL.example",
            isFailed: true,
            failureReason:
              "The tenant reached its limit of 15000 active indicators",
          },
        ],
      });
    });

    expect(await client.importIndicators([SUBMISSION])).toEqual([
      {
        indicatorValue: "EVIL.example",
        id: null,
        isFailed: true,
        failureReason:
          "The tenant reached its limit of 15000 active indicators",
      },
    ]);
  });

  test("a throttled call says so, with Defender's limits and how long it asked to wait", async () => {
    const { client } = defenderClient(() => {
      return respond(
        429,
        {
          error: {
            code: "TooManyRequests",
            message: "Rate limit",
            target: "t",
          },
        },
        { "retry-after": "30" },
      );
    });

    await expect(client.importIndicators([SUBMISSION])).rejects.toThrow(
      "Microsoft Defender indicator import was throttled: Microsoft Defender takes 100 calls a minute and 1,500 an hour, and asked OneUptime to wait 30 seconds. OneUptime tries again later.",
    );
  });

  test("a call without the permission names Ti.ReadWrite.All", async () => {
    const { client } = defenderClient(() => {
      return respond(403, {
        error: {
          code: "Forbidden",
          message: "The application does not have the required permissions",
        },
      });
    });

    const error: Error = await client.importIndicators([SUBMISSION]).then(
      () => {
        return new Error("no error");
      },
      (thrown: Error) => {
        return thrown;
      },
    );

    expect(error.message).toContain("HTTP 403");
    expect(error.message).toContain(DEFENDER_INDICATORS_PERMISSION_HINT);
    expect(error.message).not.toContain("SECRET-DEFENDER");
  });

  test("a tenant with custom indicators off says where to turn them on", async () => {
    const { client } = defenderClient(() => {
      return respond(403, {
        error: {
          code: "DisabledFeature",
          message: "Tenant feature is not enabled.",
        },
      });
    });

    await expect(client.importIndicators([SUBMISSION])).rejects.toThrow(
      /Custom network indicators.*Advanced features/,
    );
  });

  test("a token Microsoft Entra refuses stops before any indicator call", async () => {
    const recorded: RecordingTransport = recording(() => {
      return respond(401, { error: "invalid_client" });
    });
    const client: MicrosoftDefenderEndpointClient =
      new MicrosoftDefenderEndpointClient({
        tenantId: "tenant-1",
        clientId: "client-1",
        clientSecret: "SECRET-DEFENDER",
        cloud: "public",
        transport: recorded.transport,
      });

    await expect(client.importIndicators([SUBMISSION])).rejects.toThrow(
      /Microsoft Defender token request failed \(HTTP 401\)/,
    );
    expect(recorded.requests.length).toBe(1);
  });
});

describe("Microsoft Defender indicators: deleting", () => {
  test("deletes in batches of 500 with BatchDelete", async () => {
    const { client, requests } = defenderClient(() => {
      return respond(204, undefined);
    });

    const failures: Array<{ id: string; error: string }> =
      await client.deleteIndicators(
        Array.from({ length: 501 }, (_unused: unknown, index: number) => {
          return String(index);
        }),
      );

    expect(failures).toEqual([]);
    expect(
      apiRequests(requests).map((request: DataSourceHttpRequest) => {
        return [
          request.method,
          new URL(request.url).pathname,
          (bodyOf(request)["IndicatorIds"] as Array<string>).length,
        ];
      }),
    ).toEqual([
      ["POST", "/api/indicators/BatchDelete", 500],
      ["POST", "/api/indicators/BatchDelete", 1],
    ]);
  });

  test("a batch that meets one already gone is deleted one by one: gone is deleted", async () => {
    const { client, requests } = defenderClient(
      (request: DataSourceHttpRequest): DataSourceHttpResponse => {
        if (request.url.endsWith("/BatchDelete")) {
          return respond(404, { error: { code: "NotFound" } });
        }

        if (request.url.endsWith("/api/indicators/2")) {
          return respond(404, { error: { code: "NotFound" } });
        }

        if (request.url.endsWith("/api/indicators/3")) {
          return respond(400, { error: { code: "InvalidRequestBody" } });
        }

        return respond(204, undefined);
      },
    );

    const failures: Array<{ id: string; error: string }> =
      await client.deleteIndicators(["1", "2", "3"]);

    expect(
      apiRequests(requests).map((request: DataSourceHttpRequest) => {
        return `${request.method} ${new URL(request.url).pathname}`;
      }),
    ).toEqual([
      "POST /api/indicators/BatchDelete",
      "DELETE /api/indicators/1",
      "DELETE /api/indicators/2",
      "DELETE /api/indicators/3",
    ]);
    expect(failures.length).toBe(1);
    expect(failures[0]!.id).toBe("3");
    expect(failures[0]!.error).toContain("HTTP 400");
  });

  test("a throttled or refused delete stops the pass", async () => {
    const { client } = defenderClient(() => {
      return respond(429, {}, { "retry-after": "600" });
    });

    await expect(client.deleteIndicators(["1"])).rejects.toThrow(
      /throttled.*10 minutes/,
    );
  });
});

describe("Microsoft Defender: the permissions an app registration was granted", () => {
  test("read from the access token's roles", async () => {
    const { client } = defenderClient(() => {
      return respond(200, {});
    });

    expect(await client.readApplicationPermissions()).toEqual([
      "Machine.Read.All",
      "Ti.ReadWrite.All",
    ]);
  });

  test("none from a token without roles, or one that is no JWT", () => {
    expect(readAccessTokenRoles(tokenWithRoles(undefined))).toEqual([]);
    expect(readAccessTokenRoles("opaque-token")).toEqual([]);
    expect(readAccessTokenRoles("a.%%%.c")).toEqual([]);
    expect(readAccessTokenRoles("")).toEqual([]);
  });

  test("how long a throttled answer asked to wait, in words", () => {
    expect(readDefenderRetryAfter({ "retry-after": "1" })).toBe("1 second");
    expect(readDefenderRetryAfter({ "retry-after": "119" })).toBe(
      "119 seconds",
    );
    expect(readDefenderRetryAfter({ "retry-after": "3600" })).toBe(
      "60 minutes",
    );
    expect(readDefenderRetryAfter({ "retry-after": "soon" })).toBeNull();
    expect(readDefenderRetryAfter(undefined)).toBeNull();
  });
});

// ---------- CrowdStrike Falcon ----------

const FALCON_TOKEN: string = "falcon-access-token";

function falconClient(responder: Responder): {
  client: CrowdStrikeFalconResponseClient;
  requests: Array<DataSourceHttpRequest>;
} {
  const recorded: RecordingTransport = recording(
    (request: DataSourceHttpRequest): DataSourceHttpResponse => {
      return isTokenRequest(request)
        ? respond(201, { access_token: FALCON_TOKEN })
        : responder(request);
    },
  );

  return {
    client: new CrowdStrikeFalconResponseClient({
      cloud: "eu-1",
      clientId: "falcon-client",
      clientSecret: "SECRET-FALCON",
      transport: recorded.transport,
    }),
    requests: recorded.requests,
  };
}

const SHA256: string =
  "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f";

function listedIoc(id: string, extra: JSONObject = {}): JSONObject {
  return {
    id,
    type: "sha256",
    value: SHA256,
    action: "prevent",
    mobile_action: "no_action",
    severity: "high",
    platforms: ["windows", "mac", "linux"],
    applied_globally: true,
    source: "OneUptime",
    description: "OneUptime blocklist until lifted [oneuptime:c2:Block]",
    expiration: "2026-12-20T10:00:00Z",
    expired: false,
    deleted: false,
    ...extra,
  };
}

describe("CrowdStrike Falcon IOCs: listing OneUptime's", () => {
  test("filters on OneUptime's source, a page at a time by `after`, expired ones too", async () => {
    const { client, requests } = falconClient(
      (request: DataSourceHttpRequest): DataSourceHttpResponse => {
        const after: string | null = new URL(request.url).searchParams.get(
          "after",
        );

        return after
          ? respond(200, {
              meta: { pagination: { after: "" } },
              resources: [
                listedIoc("b", {
                  expired: true,
                  action: "no_action",
                  expiration: "0001-01-01T00:00:00Z",
                }),
              ],
            })
          : respond(200, {
              meta: { pagination: { after: "page-2" } },
              resources: Array.from(
                { length: 500 },
                (_unused: unknown, index: number): JSONObject => {
                  return listedIoc(`a${index}`);
                },
              ),
            });
      },
    );

    const iocs: Array<CrowdStrikeIoc> = await client.listIocs();
    const first: URL = new URL(apiRequests(requests)[0]!.url);

    expect(first.origin).toBe("https://api.eu-1.crowdstrike.com");
    expect(first.pathname).toBe("/iocs/combined/indicator/v1");
    expect(first.searchParams.get("filter")).toBe("source:'OneUptime'");
    expect(first.searchParams.get("limit")).toBe("500");
    expect(
      new URL(apiRequests(requests)[1]!.url).searchParams.get("after"),
    ).toBe("page-2");
    expect(iocs.length).toBe(501);
    expect(iocs[0]).toEqual({
      id: "a0",
      type: "sha256",
      value: SHA256,
      action: "prevent",
      description: "OneUptime blocklist until lifted [oneuptime:c2:Block]",
      source: "OneUptime",
      expiration: new Date("2026-12-20T10:00:00Z"),
      isExpired: false,
    });
    // Falcon writes "no expiration" as the zero time.
    expect(iocs[500]!.expiration).toBeNull();
    expect(iocs[500]!.isExpired).toBe(true);
  });

  test("a deleted IOC is not listed, and a page that repeats its cursor ends the read", async () => {
    const { client, requests } = falconClient(() => {
      return respond(200, {
        meta: { pagination: { after: "same" } },
        resources: [listedIoc("x", { deleted: true })],
      });
    });

    expect(await client.listIocs()).toEqual([]);
    expect(apiRequests(requests).length).toBe(1);
  });
});

describe("CrowdStrike Falcon IOCs: creating", () => {
  test("sends each file set to prevent on every computer, with its end", async () => {
    const { client, requests } = falconClient(() => {
      return respond(201, {
        resources: [{ id: "ioc-1", type: "sha256", value: SHA256 }],
      });
    });

    const results: Array<CrowdStrikeIocWriteResult> = await client.createIocs(
      [
        {
          type: "sha256",
          value: SHA256,
          description: "OneUptime case CASE-9 [oneuptime:c2:Block]",
          expiration: new Date("2026-12-20T10:00:00Z"),
        },
      ],
      "OneUptime blocklist",
    );
    const request: DataSourceHttpRequest = apiRequests(requests)[0]!;

    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/iocs/entities/indicators/v1");
    expect(bodyOf(request)).toEqual({
      comment: "OneUptime blocklist",
      indicators: [
        {
          type: "sha256",
          value: SHA256,
          action: "prevent",
          severity: "high",
          platforms: ["windows", "mac", "linux"],
          applied_globally: true,
          source: "OneUptime",
          description: "OneUptime case CASE-9 [oneuptime:c2:Block]",
          expiration: "2026-12-20T10:00:00.000Z",
        },
      ],
    });
    expect(results).toEqual([
      { value: SHA256, id: "ioc-1", isDone: true, error: null },
    ]);
  });

  test("200 a call", async () => {
    const { client, requests } = falconClient(() => {
      return respond(201, { resources: [] });
    });

    await client.createIocs(
      Array.from({ length: 201 }, (_unused: unknown, index: number) => {
        return {
          type: "md5" as const,
          value: index.toString(16).padStart(32, "0"),
          description: "d",
          expiration: null,
        };
      }),
      "c",
    );

    expect(
      apiRequests(requests).map((request: DataSourceHttpRequest) => {
        return (bodyOf(request)["indicators"] as Array<unknown>).length;
      }),
    ).toEqual([200, 1]);
  });

  test("a create Falcon refuses in part fails the rows it names, a duplicate among them", async () => {
    const other: string = "b".repeat(64);
    const duplicate: string = "c".repeat(64);
    const { client } = falconClient(() => {
      return respond(400, {
        meta: { query_time: 0.02, powered_by: "ioc-manager" },
        errors: [
          {
            code: 400,
            message: "One or more indicators have a warning or invalid input",
          },
        ],
        resources: [
          {
            row: 1,
            value: SHA256,
            type: "sha256",
            message_type: "error",
            field_name: "expiration",
            message:
              "expiration: The 'expiration' field must be in the future.",
          },
          {
            row: 3,
            value: duplicate,
            type: "sha256",
            message_type: "warning",
            message: `Warning: Duplicate type: 'sha256' and value: '${duplicate}' combination.`,
          },
        ],
      });
    });

    const results: Array<CrowdStrikeIocWriteResult> = await client.createIocs(
      [SHA256, other, duplicate].map((value: string) => {
        return {
          type: "sha256" as const,
          value,
          description: "d",
          expiration: null,
        };
      }),
      "c",
    );

    expect(results[0]).toEqual({
      value: SHA256,
      id: null,
      isDone: false,
      error: "expiration: The 'expiration' field must be in the future.",
    });
    expect(results[1]!.isDone).toBe(true);
    expect(results[2]!.isDone).toBe(false);
    expect(results[2]!.error).toContain("Duplicate");
  });

  test("a 400 that names no row refuses the whole batch", async () => {
    const { client } = falconClient(() => {
      return respond(400, {
        errors: [{ code: 400, message: "indicators is required" }],
      });
    });

    const results: Array<CrowdStrikeIocWriteResult> = await client.createIocs(
      [{ type: "sha256", value: SHA256, description: "d", expiration: null }],
      "c",
    );

    expect(results[0]!.isDone).toBe(false);
    expect(results[0]!.error).toContain("indicators is required");
  });

  test("a throttled call says how long Falcon asked to wait", async () => {
    const retryAt: number = Math.floor(Date.now() / 1000) + 90;
    const { client } = falconClient(() => {
      return respond(
        429,
        { errors: [{ code: 429, message: "API rate limit exceeded." }] },
        { "x-ratelimit-retryafter": String(retryAt) },
      );
    });

    await expect(
      client.createIocs(
        [
          {
            type: "md5",
            value: "a".repeat(32),
            description: "d",
            expiration: null,
          },
        ],
        "c",
      ),
    ).rejects.toThrow(
      /CrowdStrike Falcon IOC create was throttled by CrowdStrike Falcon, which asked OneUptime to wait \d+ seconds\. OneUptime tries again later\./,
    );
  });

  test("a call without the scope names IOC Management", async () => {
    const { client } = falconClient(() => {
      return respond(403, {
        errors: [{ code: 403, message: "access denied, authorization failed" }],
      });
    });

    const error: Error = await client
      .createIocs(
        [
          {
            type: "md5",
            value: "a".repeat(32),
            description: "d",
            expiration: null,
          },
        ],
        "c",
      )
      .then(
        () => {
          return new Error("no error");
        },
        (thrown: Error) => {
          return thrown;
        },
      );

    expect(error.message).toContain(CROWDSTRIKE_IOC_SCOPE_HINT);
    expect(error.message).not.toContain("SECRET-FALCON");
  });
});

describe("CrowdStrike Falcon IOCs: updating and deleting", () => {
  test("an update moves each IOC's end and sets it to prevent again", async () => {
    const { client, requests } = falconClient(() => {
      return respond(200, { resources: [] });
    });

    await client.updateIocs(
      [
        {
          id: "ioc-1",
          description: "d",
          expiration: new Date("2027-01-01T00:00:00Z"),
        },
        { id: "ioc-2", description: "e", expiration: null },
      ],
      "OneUptime blocklist",
    );

    const request: DataSourceHttpRequest = apiRequests(requests)[0]!;

    expect(request.method).toBe("PATCH");
    expect(bodyOf(request)).toEqual({
      comment: "OneUptime blocklist",
      indicators: [
        {
          id: "ioc-1",
          action: "prevent",
          severity: "high",
          description: "d",
          expiration: "2027-01-01T00:00:00.000Z",
        },
        { id: "ioc-2", action: "prevent", severity: "high", description: "e" },
      ],
    });
  });

  test("an update Falcon refuses stops the pass", async () => {
    const { client } = falconClient(() => {
      return respond(500, { errors: [{ code: 500, message: "boom" }] });
    });

    await expect(
      client.updateIocs([{ id: "a", description: "d", expiration: null }], "c"),
    ).rejects.toThrow(/IOC update failed \(HTTP 500\)/);
  });

  test("deletes by ID, 100 a call, an IOC already gone counting as deleted", async () => {
    const { client, requests } = falconClient(() => {
      return respond(404, { errors: [{ code: 404, message: "not found" }] });
    });

    await client.deleteIocs(
      Array.from({ length: 101 }, (_unused: unknown, index: number) => {
        return `id-${index}`;
      }),
      "OneUptime blocklist",
    );

    const calls: Array<URL> = apiRequests(requests).map(
      (request: DataSourceHttpRequest): URL => {
        expect(request.method).toBe("DELETE");
        return new URL(request.url);
      },
    );

    expect(calls.length).toBe(2);
    expect(calls[0]!.searchParams.getAll("ids").length).toBe(100);
    expect(calls[1]!.searchParams.getAll("ids")).toEqual(["id-100"]);
    expect(calls[0]!.searchParams.get("comment")).toBe("OneUptime blocklist");
  });

  test("a delete refused for its scope throws", async () => {
    const { client } = falconClient(() => {
      return respond(403, {});
    });

    await expect(client.deleteIocs(["a"], "c")).rejects.toThrow(
      CROWDSTRIKE_IOC_SCOPE_HINT,
    );
  });
});

describe("CrowdStrike Falcon: the IOC Management scopes", () => {
  test("Read lists one ID; Write is an update of no IOC, which Falcon answers 400 with the scope", async () => {
    const { client, requests } = falconClient(
      (request: DataSourceHttpRequest): DataSourceHttpResponse => {
        return request.method === "GET"
          ? respond(200, { resources: [] })
          : respond(400, { errors: [{ code: 400, message: "no indicators" }] });
      },
    );

    expect(await client.checkIocScopes()).toEqual({
      canRead: true,
      canWrite: true,
    });
    expect(bodyOf(apiRequests(requests)[1])).toEqual({
      comment: "OneUptime connection test",
      indicators: [],
    });
  });

  test("a 403 says which scope is missing", async () => {
    const { client } = falconClient(
      (request: DataSourceHttpRequest): DataSourceHttpResponse => {
        return request.method === "GET" ? respond(403, {}) : respond(403, {});
      },
    );

    expect(await client.checkIocScopes()).toEqual({
      canRead: false,
      canWrite: false,
    });

    const { client: readOnly } = falconClient(
      (request: DataSourceHttpRequest): DataSourceHttpResponse => {
        return request.method === "GET" ? respond(200, {}) : respond(403, {});
      },
    );

    expect(await readOnly.checkIocScopes()).toEqual({
      canRead: true,
      canWrite: false,
    });
  });

  test("a throttled check throws rather than read as missing", async () => {
    const { client } = falconClient(() => {
      return respond(429, {});
    });

    await expect(client.checkIocScopes()).rejects.toThrow(/throttled/);
  });

  test("how long a throttled answer asked to wait, from seconds since the epoch", () => {
    const now: Date = new Date("2026-11-21T10:00:00Z");
    const at: (seconds: number) => Record<string, string> = (
      seconds: number,
    ) => {
      return {
        "x-ratelimit-retryafter": String(now.getTime() / 1000 + seconds),
      };
    };

    expect(readFalconRetryAfter(at(30), now)).toBe("30 seconds");
    expect(readFalconRetryAfter(at(300), now)).toBe("5 minutes");
    expect(readFalconRetryAfter(at(-30), now)).toBe("1 second");
    expect(
      readFalconRetryAfter({ "x-ratelimit-retryafter": "x" }, now),
    ).toBeNull();
    expect(readFalconRetryAfter(undefined, now)).toBeNull();
  });
});
