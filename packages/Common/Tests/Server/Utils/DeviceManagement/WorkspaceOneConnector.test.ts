import { afterEach, describe, expect, test } from "@jest/globals";
import DataSourceHttpFetch from "../../../../Server/Utils/DataSource/HttpFetch";
import {
  DeviceManagementCallOptions,
  DeviceManagementFleetRead,
  DeviceManagementSession,
  DeviceManagementTransport,
  ProviderApp,
} from "../../../../Server/Utils/DeviceManagement/DeviceManagementTypes";
import WorkspaceOneConnector, {
  WORKSPACE_ONE_DEVICES_PATH,
  WORKSPACE_ONE_MAX_APP_DEVICES_PER_READ,
  WORKSPACE_ONE_PAGE_SIZE,
} from "../../../../Server/Utils/DeviceManagement/WorkspaceOne/WorkspaceOneConnector";
import {
  WORKSPACE_ONE_ACCEPT,
  WORKSPACE_ONE_EGRESS_LABEL,
} from "../../../../Server/Utils/DeviceManagement/WorkspaceOne/WorkspaceOneApiClient";
import { DeviceManagementConfig } from "../../../../Types/DeviceManagement/DeviceManagementConnectionSettings";
import { DeviceManagementTestResult } from "../../../../Types/DeviceManagement/DeviceManagementConnectionTest";
import DeviceManagementProvider from "../../../../Types/DeviceManagement/DeviceManagementProvider";
import { ManagedDevicePlatform } from "../../../../Types/DeviceManagement/ManagedDevicePlatform";
import { JSONObject } from "../../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import {
  EgressGuardedTransport,
  createEgressGuardedTransport,
} from "./EgressGuardedTransport";
import {
  FakeWorkspaceOneApi,
  FakeWorkspaceOneRequest,
  WORKSPACE_ONE_API_KEY,
  WORKSPACE_ONE_CLIENT_ID,
  WORKSPACE_ONE_CLIENT_SECRET,
  WORKSPACE_ONE_PASSWORD,
  WORKSPACE_ONE_SERVER,
  WORKSPACE_ONE_TOKEN,
  WORKSPACE_ONE_USERNAME,
  buildWorkspaceOneAndroid,
  buildWorkspaceOneApp,
  buildWorkspaceOneDevice,
  buildWorkspaceOneIpad,
  buildWorkspaceOneWindows,
} from "./FakeWorkspaceOneApi";

/*
 * Workspace ONE UEM through its REST API (#10086), against a fake that
 * answers as Omnissa's reference documents it: an OAuth client's sign-in
 * at its region's token service, or an administrator's Basic sign-in with
 * the REST API key; the device search a page at a time, with its Total
 * and its 204 for nothing; 429s with and without Retry-After, and a daily
 * quota used up; a token that expired; 401 and 403; and where every
 * request may go - the egress guard refusing private, loopback and cloud
 * metadata addresses, a redirect's too. Nothing here talks to Omnissa.
 */

const NOW: Date = new Date("2026-11-19T12:00:00Z");
const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const PUBLIC_ADDRESS: string = "52.10.20.30";
const TOKEN_HOST: string = "na.uemauth.workspaceone.com";

function devices(): Array<JSONObject> {
  return [
    buildWorkspaceOneDevice(),
    buildWorkspaceOneIpad(),
    buildWorkspaceOneWindows(),
    buildWorkspaceOneAndroid(),
    // Unenrolled: still in the list, no longer managed.
    buildWorkspaceOneDevice({
      Id: { Value: 19 },
      SerialNumber: "OLD0000001",
      EnrollmentStatus: "Unenrolled",
    }),
  ];
}

function oauthConfig(
  overrides: Partial<DeviceManagementConfig> = {},
): DeviceManagementConfig {
  return {
    tenant: WORKSPACE_ONE_SERVER,
    authMethod: "oauth",
    region: "na",
    clientId: WORKSPACE_ONE_CLIENT_ID,
    readIntervalInMinutes: 15,
    ...overrides,
  };
}

function basicConfig(): DeviceManagementConfig {
  return {
    tenant: WORKSPACE_ONE_SERVER,
    authMethod: "basic",
    username: WORKSPACE_ONE_USERNAME,
    readIntervalInMinutes: 15,
  };
}

function options(
  transport: DeviceManagementTransport,
  slept: Array<number> = [],
): DeviceManagementCallOptions {
  return {
    transport,
    now: (): Date => {
      return NOW;
    },
    sleep: async (milliseconds: number): Promise<void> => {
      slept.push(milliseconds);
    },
    random: (): number => {
      return 0.5;
    },
  };
}

function sessionOf(
  transport: DeviceManagementTransport,
  data: {
    config?: DeviceManagementConfig;
    maxRequests?: number;
    secrets?: { clientSecret?: string; password?: string; apiKey?: string };
    slept?: Array<number>;
  } = {},
): DeviceManagementSession {
  return new WorkspaceOneConnector().openSession(
    {
      provider: DeviceManagementProvider.WorkspaceOne,
      projectId: PROJECT_ID,
      config: data.config || oauthConfig(),
      apiKey: data.secrets?.apiKey ?? "",
      clientSecret: data.secrets?.clientSecret ?? WORKSPACE_ONE_CLIENT_SECRET,
      ...(data.secrets?.password !== undefined
        ? { password: data.secrets.password }
        : {}),
    },
    {
      ...options(transport, data.slept),
      maxRequests: data.maxRequests ?? 100,
      maxDurationMs: 60 * 1000,
    },
  );
}

async function testOf(
  transport: DeviceManagementTransport,
  data: {
    config?: DeviceManagementConfig;
    clientSecret?: string;
    password?: string;
    apiKey?: string;
  } = {},
): Promise<DeviceManagementTestResult> {
  return new WorkspaceOneConnector().testConnection(
    {
      apiKey: data.apiKey ?? "",
      clientSecret: data.clientSecret ?? WORKSPACE_ONE_CLIENT_SECRET,
      ...(data.password !== undefined ? { password: data.password } : {}),
      config: data.config || oauthConfig(),
    },
    options(transport),
  );
}

afterEach(() => {
  delete process.env["BILLING_ENABLED"];
});

describe("signing in", () => {
  test("an OAuth client: the client credentials grant at its region's token service, then a bearer token on MDM API V1", async () => {
    const api: FakeWorkspaceOneApi = new FakeWorkspaceOneApi({
      devices: devices(),
    });

    await sessionOf(api.transport).readFleet({ checkInSince: NOW });

    const token: FakeWorkspaceOneRequest = api.requests[0]!;
    expect(token).toMatchObject({
      method: "POST",
      url: `https://${TOKEN_HOST}/connect/token`,
      egressLabel: WORKSPACE_ONE_EGRESS_LABEL,
    });
    expect(token.body).toEqual({
      grant_type: "client_credentials",
      client_id: WORKSPACE_ONE_CLIENT_ID,
      client_secret: WORKSPACE_ONE_CLIENT_SECRET,
    });

    const search: FakeWorkspaceOneRequest = api.requests[1]!;
    expect(search.url).toBe(
      `https://${WORKSPACE_ONE_SERVER}/api/mdm/devices/search?page=0&pagesize=${WORKSPACE_ONE_PAGE_SIZE}`,
    );
    expect(search.headers).toMatchObject({
      Authorization: `Bearer ${WORKSPACE_ONE_TOKEN}`,
      Accept: WORKSPACE_ONE_ACCEPT,
    });
    // No REST API key goes with an OAuth client.
    expect(search.headers["aw-tenant-code"]).toBeUndefined();
    expect(search.egressLabel).toBe(WORKSPACE_ONE_EGRESS_LABEL);
    expect(api.tokensIssued).toBe(1);
  });

  test("each region signs in at its own token service", async () => {
    for (const region of ["emea", "apac", "uat"]) {
      const api: FakeWorkspaceOneApi = new FakeWorkspaceOneApi({
        region,
        devices: devices(),
      });

      await sessionOf(api.transport, {
        config: oauthConfig({ region }),
      }).readFleet({ checkInSince: NOW });

      expect(api.requests[0]!.host).toBe(`${region}.uemauth.workspaceone.com`);
    }
  });

  test("an administrator's account: Basic authentication and the REST API key, no token service", async () => {
    const api: FakeWorkspaceOneApi = new FakeWorkspaceOneApi({
      devices: devices(),
    });

    const fleet: DeviceManagementFleetRead = await sessionOf(api.transport, {
      config: basicConfig(),
      secrets: {
        password: WORKSPACE_ONE_PASSWORD,
        apiKey: WORKSPACE_ONE_API_KEY,
      },
    }).readFleet({ checkInSince: NOW });

    expect(fleet.devices).toHaveLength(4);
    expect(
      api.requests.some((request: FakeWorkspaceOneRequest): boolean => {
        return request.host === TOKEN_HOST;
      }),
    ).toBe(false);
    expect(api.requests[0]!.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from(`${WORKSPACE_ONE_USERNAME}:${WORKSPACE_ONE_PASSWORD}`).toString("base64")}`,
      "aw-tenant-code": WORKSPACE_ONE_API_KEY,
    });
  });

  test("a client the token service refuses: said, and never the secret", async () => {
    const result: DeviceManagementTestResult = await testOf(
      new FakeWorkspaceOneApi({ devices: devices() }).transport,
      { clientSecret: "WRONGSECRET0000000000000000000000" },
    );

    expect(result).toMatchObject({
      provider: DeviceManagementProvider.WorkspaceOne,
      status: "fail",
      failureKind: LlmConnectionFailureKind.Authentication,
      tenant: WORKSPACE_ONE_SERVER,
    });
    expect(result.message).toContain(
      "Workspace ONE refused the OAuth client's ID or secret.",
    );
    expect(result.message).toContain("invalid_client");
    expect(result.message).toContain(TOKEN_HOST);
    expect(result.remediation).toContain("OAuth Client Management");
    expect(JSON.stringify(result)).not.toContain("WRONGSECRET");
  });

  test("an expired token is asked for again, once", async () => {
    const api: FakeWorkspaceOneApi = new FakeWorkspaceOneApi({
      devices: devices(),
    });
    api.script("/api/mdm/devices/search", [
      {
        status: 401,
        body: { errorCode: 1029, message: "OAuth token is expired." },
      },
    ]);

    const fleet: DeviceManagementFleetRead = await sessionOf(
      api.transport,
    ).readFleet({ checkInSince: NOW });

    expect(fleet.isDeviceListComplete).toBe(true);
    expect(api.tokensIssued).toBe(2);
  });

  test("an administrator Workspace ONE refuses: its 401 is the answer, with what to check", async () => {
    const result: DeviceManagementTestResult = await testOf(
      new FakeWorkspaceOneApi({ devices: devices() }).transport,
      {
        config: basicConfig(),
        password: "wrong password",
        apiKey: WORKSPACE_ONE_API_KEY,
      },
    );

    expect(result).toMatchObject({
      status: "fail",
      failureKind: LlmConnectionFailureKind.Authentication,
    });
    expect(result.message).toContain(
      "Workspace ONE refused the administrator's username, password or REST API key.",
    );
    expect(result.message).toContain(
      "User credentials are invalid. (error code 1005)",
    );
    expect(JSON.stringify(result)).not.toContain("wrong password");
    expect(JSON.stringify(result)).not.toContain(WORKSPACE_ONE_API_KEY);
  });

  test("a role without the REST API permissions: a permission failure naming them", async () => {
    const result: DeviceManagementTestResult = await testOf(
      new FakeWorkspaceOneApi({ devices: devices(), isPermissionMissing: true })
        .transport,
    );

    expect(result).toMatchObject({
      status: "fail",
      failureKind: LlmConnectionFailureKind.Permission,
    });
    expect(result.message).toContain("HTTP 403");
    expect(result.message).toContain("(error code 1011)");
    expect(result.remediation).toContain(
      "API > REST: Devices and Apps, Read",
    );
  });
});

describe("reading the device list", () => {
  test("every page, every enrolled device, its organization group, and each one's last report", async () => {
    const many: Array<JSONObject> = [];

    for (let index: number = 0; index < 1203; index++) {
      many.push(
        buildWorkspaceOneDevice({
          Id: { Value: 1000 + index },
          SerialNumber: `SN${String(index).padStart(8, "0")}`,
          DeviceReportedName: `Kiosk ${index}`,
        }),
      );
    }

    const api: FakeWorkspaceOneApi = new FakeWorkspaceOneApi({ devices: many });
    const fleet: DeviceManagementFleetRead = await sessionOf(
      api.transport,
    ).readFleet({ checkInSince: NOW });

    expect(fleet.devices).toHaveLength(1203);
    expect(fleet.isDeviceListComplete).toBe(true);
    expect(fleet.checkIns).toHaveLength(1203);
    expect(fleet.checkInWindowEnd).toEqual(NOW);
    expect(
      api
        .requestsTo("/api/mdm/devices/search")
        .map((request: FakeWorkspaceOneRequest): string | null => {
          return request.query.get("page");
        }),
    ).toEqual(["0", "1", "2"]);
  });

  test("the platforms, the groups, and an unenrolled device left out", async () => {
    const fleet: DeviceManagementFleetRead = await sessionOf(
      new FakeWorkspaceOneApi({ devices: devices() }).transport,
    ).readFleet({ checkInSince: NOW });

    expect(
      fleet.devices.map((device: { platform: string }): string => {
        return device.platform;
      }),
    ).toEqual([
      ManagedDevicePlatform.IOS,
      ManagedDevicePlatform.IPadOS,
      ManagedDevicePlatform.Windows,
      ManagedDevicePlatform.Android,
    ]);
    expect(
      fleet.groups.map((group: { id: string; name: string }): string => {
        return `${group.id} ${group.name}`;
      }),
    ).toEqual(["1041 Stores West", "1077 Warehouse"]);
    expect(fleet.enterpriseId).toBe(WORKSPACE_ONE_SERVER);
    expect(fleet.warnings).toEqual([]);
  });

  test("a tenant with no devices answers 204: an empty list, read to its end", async () => {
    const fleet: DeviceManagementFleetRead = await sessionOf(
      new FakeWorkspaceOneApi({ devices: [] }).transport,
    ).readFleet({ checkInSince: NOW });

    expect(fleet).toMatchObject({
      devices: [],
      isDeviceListComplete: true,
      checkInWindowEnd: NOW,
    });
  });

  test("a list cut short by the read's budget says so, names no window, and marks nothing removed", async () => {
    const many: Array<JSONObject> = [];

    for (let index: number = 0; index < 600; index++) {
      many.push(buildWorkspaceOneDevice({ Id: { Value: 2000 + index } }));
    }

    // The token and one page.
    const fleet: DeviceManagementFleetRead = await sessionOf(
      new FakeWorkspaceOneApi({ devices: many }).transport,
      { maxRequests: 2 },
    ).readFleet({ checkInSince: NOW });

    expect(fleet.isDeviceListComplete).toBe(false);
    expect(fleet.devices).toHaveLength(500);
    expect(fleet.checkInWindowEnd).toBeUndefined();
    expect(fleet.warnings.join(" ")).toContain("cut short");
  });

  test("a list that came back shorter than its Total (a device left while it was read) is cut short too", async () => {
    const fleet: DeviceManagementFleetRead = await sessionOf(
      new FakeWorkspaceOneApi({ devices: devices(), total: 6 }).transport,
    ).readFleet({ checkInSince: NOW });

    expect(fleet.isDeviceListComplete).toBe(false);
    expect(fleet.devices).toHaveLength(4);
  });

  test("an answer that is no list is a failure naming the call", async () => {
    const api: FakeWorkspaceOneApi = new FakeWorkspaceOneApi({
      devices: devices(),
    });
    api.script("/api/mdm/devices/search", [
      { status: 200, body: { Message: "Maintenance" } },
    ]);

    await expect(
      sessionOf(api.transport).readFleet({ checkInSince: NOW }),
    ).rejects.toThrow(
      "Workspace ONE answered the device list request with something that is not a list (HTTP 200).",
    );
  });

  test("a 429 waits what Retry-After says; with none it backs off; a daily quota used up is not tried again", async () => {
    const waited: FakeWorkspaceOneApi = new FakeWorkspaceOneApi({
      devices: devices(),
    });
    waited.script("/api/mdm/devices/search", [
      { status: 429, headers: { "retry-after": "5" } },
      { status: 429 },
    ]);
    const slept: Array<number> = [];

    const fleet: DeviceManagementFleetRead = await sessionOf(
      waited.transport,
      { slept },
    ).readFleet({ checkInSince: NOW });
    expect(fleet.isDeviceListComplete).toBe(true);
    expect(slept).toContain(5000);
    expect(slept.length).toBeGreaterThanOrEqual(2);

    const quota: FakeWorkspaceOneApi = new FakeWorkspaceOneApi({
      devices: devices(),
    });
    quota.script("/api/mdm/devices/search", [
      {
        status: 429,
        body: {
          errorCode: 1050,
          message: "Daily quota for API calls has been exceeded.",
        },
      },
    ]);
    const result: DeviceManagementTestResult = await testOf(quota.transport);

    expect(result.failureKind).toBe(LlmConnectionFailureKind.RateLimited);
    expect(result.message).toContain("Daily quota");
    expect(quota.requestsTo("/api/mdm/devices/search")).toHaveLength(1);
    expect(result.remediation).toContain("daily API quota");
  });
});

describe("a device's apps", () => {
  test("every page of them, by the device's ID; none answered 204 is none", async () => {
    const apps: Array<JSONObject> = [];

    for (let index: number = 0; index < 501; index++) {
      apps.push(
        buildWorkspaceOneApp({
          ApplicationIdentifier: `com.example.app${index}`,
          ApplicationName: `App ${index}`,
        }),
      );
    }

    const api: FakeWorkspaceOneApi = new FakeWorkspaceOneApi({
      devices: devices(),
      apps: { "15": apps },
    });
    const session: DeviceManagementSession = sessionOf(api.transport);

    const read: Array<ProviderApp> = await session.readApps({
      enterpriseId: WORKSPACE_ONE_SERVER,
      providerDeviceId: "15",
    });
    expect(read).toHaveLength(501);
    expect(
      api
        .requestsTo("/api/mdm/devices/15/apps")
        .map((request: FakeWorkspaceOneRequest): string | null => {
          return request.query.get("page");
        }),
    ).toEqual(["0", "1"]);

    expect(
      await session.readApps({
        enterpriseId: WORKSPACE_ONE_SERVER,
        providerDeviceId: "16",
      }),
    ).toEqual([]);
    expect(session.readsAppsOf({ platform: ManagedDevicePlatform.IOS })).toBe(
      true,
    );
    expect(session.readCheckIn).toBeUndefined();
  });

  test("a device type Workspace ONE lists no apps of (501) has none; another failure is said", async () => {
    const api: FakeWorkspaceOneApi = new FakeWorkspaceOneApi({
      devices: devices(),
    });
    api.script("/api/mdm/devices/17/apps", [
      {
        status: 501,
        body: {
          errorCode: 501,
          message: "Functionality not supported for device type : WinRT",
        },
      },
    ]);
    const session: DeviceManagementSession = sessionOf(api.transport);

    expect(
      await session.readApps({
        enterpriseId: WORKSPACE_ONE_SERVER,
        providerDeviceId: "17",
      }),
    ).toEqual([]);
    await expect(
      session.readApps({
        enterpriseId: WORKSPACE_ONE_SERVER,
        providerDeviceId: "404",
      }),
    ).rejects.toThrow("HTTP 400");
  });

  test("at most a few devices' apps a read: the tenant's daily quota is shared", () => {
    const session: DeviceManagementSession = sessionOf(
      new FakeWorkspaceOneApi().transport,
    );

    expect(session.maxAppDevicesPerRead).toBe(
      WORKSPACE_ONE_MAX_APP_DEVICES_PER_READ,
    );
    expect(WORKSPACE_ONE_MAX_APP_DEVICES_PER_READ).toBe(25);
  });
});

describe("testing a connection", () => {
  test("passes, and says how many devices a read will import when the list fits on its first page", async () => {
    const api: FakeWorkspaceOneApi = new FakeWorkspaceOneApi({
      devices: devices(),
    });

    const result: DeviceManagementTestResult = await testOf(api.transport);

    expect(result).toMatchObject({
      provider: DeviceManagementProvider.WorkspaceOne,
      status: "pass",
      tenant: WORKSPACE_ONE_SERVER,
      deviceCount: 4,
      message: `Connected to Workspace ONE UEM at ${WORKSPACE_ONE_SERVER}: 4 devices to import.`,
    });
    // Read-only: a token, and one page of the device list.
    expect(
      api.requests.map((request: FakeWorkspaceOneRequest): string => {
        return `${request.method} ${request.host}${request.path}`;
      }),
    ).toEqual([
      `POST ${TOKEN_HOST}/connect/token`,
      `GET ${WORKSPACE_ONE_SERVER}/api/mdm/devices/search`,
    ]);
  });

  test("a list longer than its first page is not counted; the test still passes", async () => {
    const many: Array<JSONObject> = [];

    for (let index: number = 0; index < 501; index++) {
      many.push(buildWorkspaceOneDevice({ Id: { Value: 3000 + index } }));
    }

    const result: DeviceManagementTestResult = await testOf(
      new FakeWorkspaceOneApi({ devices: many }).transport,
    );

    expect(result.status).toBe("pass");
    expect(result.deviceCount).toBeUndefined();
    expect(result.message).toBe(
      `Connected to Workspace ONE UEM at ${WORKSPACE_ONE_SERVER}.`,
    );
  });

  test("a server, a sign-in or credentials that cannot be one are refused before any request", async () => {
    const api: FakeWorkspaceOneApi = new FakeWorkspaceOneApi({
      devices: devices(),
    });

    for (const data of [
      { config: oauthConfig({ tenant: "" }) },
      { config: oauthConfig({ tenant: "http://as1234.awmdm.com" }) },
      { config: oauthConfig({ tenant: "https://user:pass@as1234.awmdm.com" }) },
      { config: oauthConfig({ region: "mars" }) },
      { config: oauthConfig({ clientId: "" }) },
      { clientSecret: "" },
      { config: { ...basicConfig(), username: "" }, password: "x", apiKey: WORKSPACE_ONE_API_KEY },
      { config: basicConfig(), password: "", apiKey: WORKSPACE_ONE_API_KEY },
      { config: basicConfig(), password: "pw", apiKey: "" },
      { config: oauthConfig({ authMethod: "certificate" }) },
    ]) {
      const result: DeviceManagementTestResult = await testOf(
        api.transport,
        data,
      );

      expect(result).toMatchObject({
        status: "fail",
        failureKind: LlmConnectionFailureKind.Settings,
      });
    }

    expect(api.requests).toHaveLength(0);
  });

  test("the console's address is read as its API server's", async () => {
    const api: FakeWorkspaceOneApi = new FakeWorkspaceOneApi({
      devices: devices(),
    });

    const result: DeviceManagementTestResult = await testOf(api.transport, {
      config: oauthConfig({ tenant: "https://cn1234.awmdm.com/AirWatch/" }),
    });

    expect(result).toMatchObject({ status: "pass", tenant: "as1234.awmdm.com" });
  });
});

describe("where the requests may go", () => {
  test("loopback, link-local and the cloud metadata address are refused - nothing reaches them, not even the sign-in's API request", async () => {
    for (const address of ["127.0.0.1", "169.254.169.254", "::1"]) {
      const api: FakeWorkspaceOneApi = new FakeWorkspaceOneApi({
        devices: devices(),
      });
      const guard: EgressGuardedTransport = createEgressGuardedTransport({
        inner: api.transport,
        addresses: {
          [TOKEN_HOST]: [[PUBLIC_ADDRESS]],
          [WORKSPACE_ONE_SERVER]: [[address]],
        },
        blockPrivateAddresses: false,
      });

      const result: DeviceManagementTestResult = await testOf(guard.transport);

      expect(result).toMatchObject({
        status: "fail",
        failureKind: LlmConnectionFailureKind.Settings,
      });
      expect(result.message).toContain(
        "OneUptime did not connect to the Workspace ONE UEM server",
      );
      expect(result.remediation).toContain("public internet");
      expect(api.requestsTo("/api/mdm/devices/search")).toHaveLength(0);
      expect(guard.refused).toEqual([
        `https://${WORKSPACE_ONE_SERVER}/api/mdm/devices/search?page=0&pagesize=${WORKSPACE_ONE_PAGE_SIZE}`,
      ]);
    }
  });

  test("a server on a private network is refused on OneUptime Cloud, and read by a self-hosted OneUptime", async () => {
    const addresses: Record<string, Array<Array<string>>> = {
      [TOKEN_HOST]: [[PUBLIC_ADDRESS]],
      [WORKSPACE_ONE_SERVER]: [["10.1.2.3"]],
    };
    const cloud: EgressGuardedTransport = createEgressGuardedTransport({
      inner: new FakeWorkspaceOneApi({ devices: devices() }).transport,
      addresses,
      blockPrivateAddresses: true,
    });

    expect((await testOf(cloud.transport)).status).toBe("fail");

    const selfHosted: EgressGuardedTransport = createEgressGuardedTransport({
      inner: new FakeWorkspaceOneApi({ devices: devices() }).transport,
      addresses,
      blockPrivateAddresses: false,
    });

    expect((await testOf(selfHosted.transport)).status).toBe("pass");
  });

  test("a redirect to the metadata address, or off the server, is never followed with the token", async () => {
    const api: FakeWorkspaceOneApi = new FakeWorkspaceOneApi({
      devices: devices(),
    });
    api.script("/api/mdm/devices/search", [
      {
        status: 302,
        headers: {
          location: "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
        },
      },
    ]);

    const result: DeviceManagementTestResult = await testOf(api.transport);

    expect(result.status).toBe("fail");
    expect(result.message).toContain("nothing was sent there");
    for (const request of api.requests) {
      expect([TOKEN_HOST, WORKSPACE_ONE_SERVER]).toContain(request.host);
    }
  });

  test("a server named by the metadata address itself goes nowhere through the real fetch", async () => {
    process.env["BILLING_ENABLED"] = "true";

    for (const host of ["169.254.169.254", "127.0.0.1", "10.0.0.8"]) {
      // An administrator's sign-in: the first request is the server's own.
      const result: DeviceManagementTestResult = await testOf(
        DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
        {
          config: { ...basicConfig(), tenant: host },
          password: "pw",
          apiKey: WORKSPACE_ONE_API_KEY,
        },
      );

      expect(result).toMatchObject({
        status: "fail",
        failureKind: LlmConnectionFailureKind.Settings,
      });
      expect(result.message).toContain(
        `Workspace ONE UEM server host ${host} is not allowed`,
      );
    }
  });
});
