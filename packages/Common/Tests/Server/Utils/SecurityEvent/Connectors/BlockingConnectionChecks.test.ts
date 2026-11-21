import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../Server/Utils/DataSource/HttpFetch";
import {
  BLOCK_CHECK_KEY,
  CROWDSTRIKE_BLOCK_CHECK_NAME,
  CROWDSTRIKE_BLOCK_REMEDIATION,
  DEFENDER_BLOCK_CHECK_NAME,
  DEFENDER_BLOCK_REMEDIATION,
  checkCrowdStrikeBlocking,
  checkDefenderBlocking,
  withBlockingCheck,
} from "../../../../../Server/Utils/SecurityEvent/Connectors/BlockingConnectionChecks";
import CrowdStrikeFalconConnector from "../../../../../Server/Utils/SecurityEvent/Connectors/CrowdStrikeFalcon/CrowdStrikeFalconConnector";
import MicrosoftDefenderXdrConnector from "../../../../../Server/Utils/SecurityEvent/Connectors/MicrosoftDefenderXdr/MicrosoftDefenderXdrConnector";
import {
  ConnectorTransport,
  SecurityConnectorSettings,
} from "../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import { SecurityConnectorCheck } from "../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import {
  BLOCK_INDICATORS_KEY,
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
  isBlockingTurnedOn,
} from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { JSONObject } from "../../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * Blocking is an opt-in on the connection (#10346): a switch off by
 * default, which names the exact permission it takes - and, with it on,
 * the connection's test checks that permission without writing anything,
 * against recorded answers of Microsoft Entra, Defender and Falcon.
 */

const DEFENDER_SECRET: string = "A1bC2dE3fH4iJ5kL6mN7oP8qR9sT0u~verySecret";
const FALCON_SECRET: string = "falcon-secret-0123456789abcdef";

type Responder = (request: DataSourceHttpRequest) => DataSourceHttpResponse;

function respond(
  statusCode: number,
  body: unknown,
  headers?: Record<string, string>,
): DataSourceHttpResponse {
  return {
    statusCode,
    bodyText: body === undefined ? "" : JSON.stringify(body),
    bodyJson: body,
    headers: headers || {},
  };
}

// A JWT whose payload carries these roles; its signature is never read here.
function tokenWithRoles(roles: Array<string> | undefined): string {
  const encode: (value: JSONObject) => string = (value: JSONObject): string => {
    return Buffer.from(JSON.stringify(value))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  };

  return `${encode({ alg: "RS256" })}.${encode(roles ? { roles } : { aud: "x" })}.signature`;
}

function recording(responder: Responder): {
  requests: Array<DataSourceHttpRequest>;
  transport: ConnectorTransport;
} {
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

function defenderSettings(blocking: boolean): SecurityConnectorSettings {
  return {
    provider: SecurityEventConnectorProvider.MicrosoftDefenderXdr,
    config: {
      tenantId: "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c",
      clientId: "00001111-aaaa-2222-bbbb-3333cccc4444",
      cloud: "public",
      ...(blocking ? { [BLOCK_INDICATORS_KEY]: true } : {}),
    },
    secrets: { clientSecret: DEFENDER_SECRET },
    alertingOnly: false,
  };
}

function falconSettings(blocking: boolean): SecurityConnectorSettings {
  return {
    provider: SecurityEventConnectorProvider.CrowdStrikeFalcon,
    config: {
      cloud: "us-1",
      clientId: "falcon-client",
      ...(blocking ? { [BLOCK_INDICATORS_KEY]: true } : {}),
    },
    secrets: { clientSecret: FALCON_SECRET },
    alertingOnly: false,
  };
}

function isTokenRequest(request: DataSourceHttpRequest): boolean {
  return request.url.includes("/oauth2/");
}

// Defender: Entra's token with these roles, then the indicators listed.
function defender(data: {
  roles: Array<string> | undefined;
  indicators?: (request: DataSourceHttpRequest) => DataSourceHttpResponse;
}): { requests: Array<DataSourceHttpRequest>; transport: ConnectorTransport } {
  return recording((request: DataSourceHttpRequest): DataSourceHttpResponse => {
    if (isTokenRequest(request)) {
      return respond(200, {
        token_type: "Bearer",
        expires_in: 3599,
        access_token: tokenWithRoles(data.roles),
      });
    }

    if (request.url.includes("/api/indicators") && data.indicators) {
      return data.indicators(request);
    }

    throw new Error(`Unexpected request to ${request.url}`);
  });
}

// Falcon: a token, then the read check, the write check and the list.
function falcon(data: {
  read: number;
  write: number;
  writeHeaders?: Record<string, string>;
}): { requests: Array<DataSourceHttpRequest>; transport: ConnectorTransport } {
  return recording((request: DataSourceHttpRequest): DataSourceHttpResponse => {
    if (isTokenRequest(request)) {
      return respond(201, {
        access_token: "falcon-token",
        token_type: "bearer",
        expires_in: 1799,
      });
    }

    if (request.url.includes("/iocs/queries/indicators/v1?limit=1")) {
      return respond(data.read, {
        meta: {},
        resources: data.read === 200 ? ["ioc-1"] : [],
        errors:
          data.read === 200
            ? []
            : [{ code: data.read, message: "access denied, authorization failed" }],
      });
    }

    if (
      request.method === "PATCH" &&
      request.url.includes("/iocs/entities/indicators/v1")
    ) {
      return respond(
        data.write,
        {
          meta: {},
          resources: [],
          errors: [
            {
              code: data.write,
              message:
                data.write === 400
                  ? "indicators: at least one indicator is required"
                  : "access denied, authorization failed",
            },
          ],
        },
        data.writeHeaders,
      );
    }

    if (request.url.includes("/iocs/combined/indicator/v1")) {
      return respond(200, {
        meta: { pagination: { total: 2 } },
        resources: [
          {
            id: "ioc-1",
            type: "sha256",
            value: "a".repeat(64),
            action: "prevent",
            source: "OneUptime",
            description: "OneUptime blocklist [oneuptime:c1:Block]",
            expiration: "2026-12-21T10:00:00Z",
          },
          {
            id: "ioc-2",
            type: "md5",
            value: "b".repeat(32),
            action: "prevent",
            source: "OneUptime",
            description: "OneUptime blocklist [oneuptime:c1:Block]",
            expiration: "2026-12-21T10:00:00Z",
          },
        ],
        errors: [],
      });
    }

    throw new Error(`Unexpected request to ${request.method} ${request.url}`);
  });
}

function expectNoSecrets(checks: Array<SecurityConnectorCheck>): void {
  const serialized: string = JSON.stringify(checks);
  expect(serialized).not.toContain(DEFENDER_SECRET);
  expect(serialized).not.toContain(FALCON_SECRET);
}

describe("the opt-in on each connection", () => {
  test.each([
    [
      SecurityEventConnectorProvider.MicrosoftDefenderXdr,
      "Block domains, addresses and files with Defender",
      "OneUptime adds Defender indicators for what you block. Needs the WindowsDefenderATP permission Ti.ReadWrite.All, with admin consent.",
    ],
    [
      SecurityEventConnectorProvider.CrowdStrikeFalcon,
      "Block files with CrowdStrike",
      "OneUptime adds custom IOCs that stop a file running on every computer. Needs the IOC Management: Read and Write scopes.",
    ],
  ])(
    "%s has a switch, off unless turned on, that names the permission it takes",
    (
      provider: SecurityEventConnectorProvider,
      title: string,
      description: string,
    ) => {
      const definition: SecurityEventConnectorDefinition =
        getSecurityEventConnectorDefinition(provider)!;
      const field: JSONObject | undefined = (
        definition.configFields as unknown as Array<JSONObject>
      ).find((candidate: JSONObject): boolean => {
        return candidate["key"] === BLOCK_INDICATORS_KEY;
      });

      expect(field).toEqual(
        expect.objectContaining({
          key: BLOCK_INDICATORS_KEY,
          title,
          description,
          isOption: true,
        }),
      );
      // The description fits a field's 150 characters.
      expect(description.length).toBeLessThanOrEqual(150);
    },
  );

  test("blocking is on only when the switch is: absent, off or anything but the switch turned on is off", () => {
    expect(isBlockingTurnedOn({ [BLOCK_INDICATORS_KEY]: true })).toBe(true);

    for (const config of [
      undefined,
      {},
      { [BLOCK_INDICATORS_KEY]: false },
      { [BLOCK_INDICATORS_KEY]: "true" },
      { [BLOCK_INDICATORS_KEY]: 1 },
      { [BLOCK_INDICATORS_KEY]: "yes please" },
    ]) {
      expect(isBlockingTurnedOn(config as JSONObject | undefined)).toBe(false);
    }
  });
});

describe("withBlockingCheck", () => {
  const authenticated: SecurityConnectorCheck = {
    key: "authentication",
    name: "Authentication",
    status: "pass",
    durationMs: 1,
    message: "Authenticated.",
  };

  test("adds nothing while the switch is off: the connection only reads", async () => {
    let asked: boolean = false;
    const checks: Array<SecurityConnectorCheck> = await withBlockingCheck({
      settings: defenderSettings(false),
      checks: [authenticated],
      name: DEFENDER_BLOCK_CHECK_NAME,
      check: async () => {
        asked = true;
        return authenticated;
      },
    });

    expect(checks).toEqual([authenticated]);
    expect(asked).toBe(false);
  });

  test("is skipped, saying why, when the connection did not authenticate", async () => {
    const checks: Array<SecurityConnectorCheck> = await withBlockingCheck({
      settings: defenderSettings(true),
      checks: [{ ...authenticated, status: "fail" }],
      name: DEFENDER_BLOCK_CHECK_NAME,
      check: async () => {
        throw new Error("never asked");
      },
    });

    expect(checks[1]).toEqual(
      expect.objectContaining({
        key: BLOCK_CHECK_KEY,
        name: DEFENDER_BLOCK_CHECK_NAME,
        status: "skip",
        message: "Skipped because authentication failed.",
      }),
    );
  });
});

describe("Microsoft Defender: Ti.ReadWrite.All", () => {
  test("held: passes, saying how many of the tenant's 15,000 indicators OneUptime holds", async () => {
    const recorded: ReturnType<typeof defender> = defender({
      roles: ["Alert.Read.All", "Ti.ReadWrite.All"],
      indicators: () => {
        return respond(200, {
          value: [
            {
              id: "1",
              indicatorValue: "evil.example",
              indicatorType: "DomainName",
              action: "Block",
              description: "OneUptime blocklist [oneuptime:c1]",
            },
          ],
        });
      },
    });

    const check: SecurityConnectorCheck = await checkDefenderBlocking({
      settings: defenderSettings(true),
      transport: recorded.transport,
    });

    expect(check).toEqual(
      expect.objectContaining({
        key: BLOCK_CHECK_KEY,
        name: DEFENDER_BLOCK_CHECK_NAME,
        status: "pass",
        message:
          "The app registration holds Ti.ReadWrite.All. OneUptime holds 1 of the 15,000 indicators a Defender tenant takes, the tenant's own included.",
        details: { oneUptimeIndicators: 1, tenantIndicatorLimit: 15000 },
      }),
    );

    // Nothing written: a token, and one read.
    expect(
      recorded.requests.map((request: DataSourceHttpRequest): string => {
        return request.method || "GET";
      }),
    ).toEqual(["POST", "GET"]);
    expect((recorded.requests[0]!.body as JSONObject)["scope"]).toBe(
      "https://api.securitycenter.microsoft.com/.default",
    );
  });

  test("not held: fails before any indicator call, naming the permission and where to grant it", async () => {
    for (const roles of [["Alert.Read.All"], undefined]) {
      const recorded: ReturnType<typeof defender> = defender({ roles });

      const check: SecurityConnectorCheck = await checkDefenderBlocking({
        settings: defenderSettings(true),
        transport: recorded.transport,
      });

      expect(check.status).toBe("fail");
      expect(check.message).toBe(
        "The app registration does not hold Ti.ReadWrite.All on Microsoft Defender for Endpoint, so OneUptime cannot add the indicators that block what you block.",
      );
      expect(check.remediation).toBe(DEFENDER_BLOCK_REMEDIATION);
      expect(recorded.requests.length).toBe(1);
    }
  });

  test("a throttled read fails, saying how long Defender asked to wait, and no secret", async () => {
    const recorded: ReturnType<typeof defender> = defender({
      roles: ["Ti.ReadWrite.All"],
      indicators: () => {
        return respond(
          429,
          { error: { code: "TooManyRequests", message: "Rate limit" } },
          // As the transport hands headers: their names in lower case.
          { "retry-after": "30" },
        );
      },
    });

    const check: SecurityConnectorCheck = await checkDefenderBlocking({
      settings: defenderSettings(true),
      transport: recorded.transport,
    });

    expect(check.status).toBe("fail");
    expect(check.message).toContain("30 seconds");
    expectNoSecrets([check]);
  });

  test("the connection's test runs it last, when the switch is on", async () => {
    const recorded: ReturnType<typeof defender> = defender({
      roles: ["Ti.ReadWrite.All"],
      indicators: () => {
        return respond(200, { value: [] });
      },
    });
    const connector: MicrosoftDefenderXdrConnector =
      new MicrosoftDefenderXdrConnector(
        async (
          request: DataSourceHttpRequest,
        ): Promise<DataSourceHttpResponse> => {
          if (request.url.includes("/security/alerts_v2")) {
            return respond(200, { value: [] });
          }

          return await recorded.transport(request);
        },
      );

    const on: Array<SecurityConnectorCheck> = await connector.testConnection(
      defenderSettings(true),
      { requestTimeoutInMs: 20000 },
    );
    const off: Array<SecurityConnectorCheck> = await connector.testConnection(
      defenderSettings(false),
      { requestTimeoutInMs: 20000 },
    );

    expect(
      on.map((check: SecurityConnectorCheck): string => {
        return `${check.key}:${check.status}`;
      }),
    ).toEqual([
      "authentication:pass",
      "read-permission:pass",
      "detections-available:warn",
      "block-permission:pass",
    ]);
    expect(
      off.some((check: SecurityConnectorCheck): boolean => {
        return check.key === BLOCK_CHECK_KEY;
      }),
    ).toBe(false);
    expectNoSecrets(on);
  });
});

describe("CrowdStrike Falcon: IOC Management Read and Write", () => {
  test("both held: passes, saying how many of OneUptime's IOCs Falcon holds, and writes nothing", async () => {
    const recorded: ReturnType<typeof falcon> = falcon({
      read: 200,
      write: 400,
    });

    const check: SecurityConnectorCheck = await checkCrowdStrikeBlocking({
      settings: falconSettings(true),
      transport: recorded.transport,
    });

    expect(check).toEqual(
      expect.objectContaining({
        key: BLOCK_CHECK_KEY,
        name: CROWDSTRIKE_BLOCK_CHECK_NAME,
        status: "pass",
        message:
          "The API client holds IOC Management: Read and Write. OneUptime holds 2 custom IOCs in Falcon.",
        details: { oneUptimeIocs: 2 },
      }),
    );

    // The write check updates no IOC: an empty list.
    const patch: DataSourceHttpRequest | undefined = recorded.requests.find(
      (request: DataSourceHttpRequest): boolean => {
        return request.method === "PATCH";
      },
    );

    expect(JSON.parse(String(patch?.body))).toEqual({
      comment: "OneUptime connection test",
      indicators: [],
    });
  });

  test.each([
    [200, 403, "IOC Management: Write"],
    [403, 400, "IOC Management: Read"],
    [403, 403, "IOC Management: Read and Write"],
  ])(
    "read %s and write %s: fails, naming %s and where to grant it",
    async (read: number, write: number, missing: string) => {
      const check: SecurityConnectorCheck = await checkCrowdStrikeBlocking({
        settings: falconSettings(true),
        transport: falcon({ read, write }).transport,
      });

      expect(check.status).toBe("fail");
      expect(check.message).toBe(
        `The API client does not hold ${missing}, so OneUptime cannot add the IOCs that block the files you block.`,
      );
      expect(check.remediation).toBe(CROWDSTRIKE_BLOCK_REMEDIATION);
    },
  );

  test("a throttled check fails rather than read as a missing scope", async () => {
    const check: SecurityConnectorCheck = await checkCrowdStrikeBlocking({
      settings: falconSettings(true),
      transport: falcon({
        read: 200,
        write: 429,
        writeHeaders: {
          "x-ratelimit-retryafter": String(Math.floor(Date.now() / 1000) + 20),
        },
      }).transport,
    });

    expect(check.status).toBe("fail");
    expect(check.message).not.toContain("does not hold");
    expect(check.message).toContain("throttled");
    expectNoSecrets([check]);
  });

  test("the connection's test adds it only with the switch on", async () => {
    const connector: CrowdStrikeFalconConnector = new CrowdStrikeFalconConnector(
      falcon({ read: 200, write: 400 }).transport,
    );

    const off: Array<SecurityConnectorCheck> = await connector
      .testConnection(falconSettings(false), { requestTimeoutInMs: 20000 })
      .catch((): Array<SecurityConnectorCheck> => {
        return [];
      });

    expect(
      off.some((check: SecurityConnectorCheck): boolean => {
        return check.key === BLOCK_CHECK_KEY;
      }),
    ).toBe(false);
  });
});
