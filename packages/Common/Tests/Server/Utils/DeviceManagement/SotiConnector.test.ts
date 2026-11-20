import { afterEach, describe, expect, test } from "@jest/globals";
import DataSourceHttpFetch from "../../../../Server/Utils/DataSource/HttpFetch";
import {
  DeviceManagementCallOptions,
  DeviceManagementFleetRead,
  DeviceManagementSession,
  DeviceManagementTransport,
  ProviderApp,
} from "../../../../Server/Utils/DeviceManagement/DeviceManagementTypes";
import SotiConnector, {
  SOTI_MODE_SUMMARY_REQUEST,
  SOTI_PAGE_SIZE,
  getSotiInstalledApplicationsPath,
} from "../../../../Server/Utils/DeviceManagement/Soti/SotiConnector";
import { SOTI_EGRESS_LABEL } from "../../../../Server/Utils/DeviceManagement/Soti/SotiApiClient";
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
  FakeSotiApi,
  FakeSotiRequest,
  SOTI_CLIENT_ID,
  SOTI_CLIENT_SECRET,
  SOTI_PASSWORD,
  SOTI_SERVER,
  SOTI_TOKEN,
  SOTI_USERNAME,
  buildSotiApp,
  buildSotiDevice,
  buildSotiIpad,
  buildSotiWindows,
} from "./FakeSotiApi";

/*
 * SOTI MobiControl through its REST API (#10087), against a fake that
 * answers as MobiControl's reference documents it: the resource owner
 * password grant at the server's own token endpoint, with the API client
 * as Basic authentication; the device list a page at a time with skip and
 * take; a device's installed applications, its ID encoded twice; the
 * device summary; 429s with and without Retry-After; a token that
 * expired; 401 and 403; and where every request may go - the egress guard
 * refusing private, loopback and cloud metadata addresses, a redirect's
 * too. Nothing here talks to a MobiControl server.
 */

const NOW: Date = new Date("2026-11-19T12:00:00Z");
const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const BASE_PATH: string = "/MobiControl/api";

function devices(): Array<JSONObject> {
  return [
    buildSotiDevice(),
    buildSotiIpad(),
    buildSotiWindows(),
    buildSotiDevice({ DeviceId: "35-DISABLED", Mode: "Disabled" }),
    // Unenrolled: still listed, no longer managed.
    buildSotiDevice({ DeviceId: "35-GONE", Mode: "UnenrolledByAdmin" }),
  ];
}

function config(
  overrides: Partial<DeviceManagementConfig> = {},
): DeviceManagementConfig {
  return {
    tenant: SOTI_SERVER,
    clientId: SOTI_CLIENT_ID,
    username: SOTI_USERNAME,
    readIntervalInMinutes: 15,
    ...overrides,
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
  data: { maxRequests?: number; slept?: Array<number> } = {},
): DeviceManagementSession {
  return new SotiConnector().openSession(
    {
      provider: DeviceManagementProvider.Soti,
      projectId: PROJECT_ID,
      config: config(),
      apiKey: "",
      clientSecret: SOTI_CLIENT_SECRET,
      password: SOTI_PASSWORD,
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
  } = {},
): Promise<DeviceManagementTestResult> {
  return new SotiConnector().testConnection(
    {
      apiKey: "",
      clientSecret: data.clientSecret ?? SOTI_CLIENT_SECRET,
      password: data.password ?? SOTI_PASSWORD,
      config: data.config || config(),
    },
    options(transport),
  );
}

afterEach(() => {
  delete process.env["BILLING_ENABLED"];
});

describe("signing in", () => {
  test("the resource owner password grant at the server's token endpoint, the API client as Basic authentication", async () => {
    const api: FakeSotiApi = new FakeSotiApi({ devices: devices() });

    await sessionOf(api.transport).readFleet({ checkInSince: NOW });

    const token: FakeSotiRequest = api.requests[0]!;
    expect(token).toMatchObject({
      method: "POST",
      url: `https://${SOTI_SERVER}${BASE_PATH}/token`,
      egressLabel: SOTI_EGRESS_LABEL,
    });
    expect(token.headers["Authorization"]).toBe(
      `Basic ${Buffer.from(`${SOTI_CLIENT_ID}:${SOTI_CLIENT_SECRET}`).toString("base64")}`,
    );
    expect(token.body).toEqual({
      grant_type: "password",
      username: SOTI_USERNAME,
      password: SOTI_PASSWORD,
    });

    const list: FakeSotiRequest = api.requests[1]!;
    expect(list.url).toBe(
      `https://${SOTI_SERVER}${BASE_PATH}/devices?skip=0&take=${SOTI_PAGE_SIZE}`,
    );
    expect(list.headers["Authorization"]).toBe(`Bearer ${SOTI_TOKEN}`);
    expect(list.egressLabel).toBe(SOTI_EGRESS_LABEL);
  });

  test("a wrong API client, and a wrong user or password: each said, with what to check, never a secret", async () => {
    const wrongClient: DeviceManagementTestResult = await testOf(
      new FakeSotiApi({ devices: devices() }).transport,
      { clientSecret: "WRONGCLIENTSECRET000000000000000" },
    );
    expect(wrongClient).toMatchObject({
      status: "fail",
      failureKind: LlmConnectionFailureKind.Authentication,
    });
    expect(wrongClient.message).toContain(
      "MobiControl refused the API client's ID or secret.",
    );
    expect(JSON.stringify(wrongClient)).not.toContain("WRONGCLIENTSECRET");

    const wrongUser: DeviceManagementTestResult = await testOf(
      new FakeSotiApi({ devices: devices() }).transport,
      { password: "not the password" },
    );
    expect(wrongUser.failureKind).toBe(LlmConnectionFailureKind.Authentication);
    expect(wrongUser.message).toContain("invalid_grant");
    expect(wrongUser.message).toContain(
      "or the user may not sign in to the web console",
    );
    expect(wrongUser.remediation).toContain("Web Console Access");
    expect(JSON.stringify(wrongUser)).not.toContain("not the password");
  });

  test("an expired token is asked for again, once", async () => {
    const api: FakeSotiApi = new FakeSotiApi({ devices: devices() });
    api.script(`${BASE_PATH}/devices`, [
      {
        status: 401,
        body: {
          ErrorCode: 0,
          Message: "Authorization has been denied for this request.",
        },
      },
    ]);

    const fleet: DeviceManagementFleetRead = await sessionOf(
      api.transport,
    ).readFleet({ checkInSince: NOW });

    expect(fleet.isDeviceListComplete).toBe(true);
    expect(api.tokensIssued).toBe(2);
  });

  test("a user without the permissions: a permission failure naming them", async () => {
    const result: DeviceManagementTestResult = await testOf(
      new FakeSotiApi({ devices: devices(), isPermissionMissing: true })
        .transport,
    );

    expect(result).toMatchObject({
      status: "fail",
      failureKind: LlmConnectionFailureKind.Permission,
    });
    expect(result.message).toContain("HTTP 403");
    expect(result.remediation).toBe(
      "Give it the permissions Web Console Access and View Installed Applications, and View Groups on the device groups to read.",
    );
  });
});

describe("reading the device list", () => {
  test("every page, every managed device with its group and when it was last there", async () => {
    const many: Array<JSONObject> = [];

    for (let index: number = 0; index < 1100; index++) {
      many.push(
        buildSotiDevice({
          DeviceId: `35-${index}`,
          DeviceName: `Scanner ${index}`,
          HardwareSerialNumber: `SN${index}`,
        }),
      );
    }

    const api: FakeSotiApi = new FakeSotiApi({ devices: many });
    const fleet: DeviceManagementFleetRead = await sessionOf(
      api.transport,
    ).readFleet({ checkInSince: NOW });

    expect(fleet.devices).toHaveLength(1100);
    expect(fleet.isDeviceListComplete).toBe(true);
    expect(fleet.checkInWindowEnd).toEqual(NOW);
    expect(
      api
        .requestsTo(`${BASE_PATH}/devices`)
        .map((request: FakeSotiRequest): string | null => {
          return request.query.get("skip");
        }),
    ).toEqual(["0", "500", "1000"]);
  });

  test("the platforms and groups; a disabled device kept, an unenrolled one left out; a connected agent is there now", async () => {
    const fleet: DeviceManagementFleetRead = await sessionOf(
      new FakeSotiApi({ devices: devices() }).transport,
    ).readFleet({ checkInSince: NOW });

    expect(
      fleet.devices.map(
        (device: { providerDeviceId: string; platform: string }): string => {
          return `${device.providerDeviceId} ${device.platform}`;
        },
      ),
    ).toEqual([
      `35-8C4F2A9B1D7E ${ManagedDevicePlatform.Android}`,
      `IOS-00008110001A2B3C ${ManagedDevicePlatform.IPadOS}`,
      `WIN-5D1C2B3A4E5F ${ManagedDevicePlatform.Windows}`,
      `35-DISABLED ${ManagedDevicePlatform.Android}`,
    ]);
    expect(
      fleet.groups.map((group: { path: string }): string => {
        return group.path;
      }),
    ).toEqual(["Acme/Warehouses/Dallas", "Acme/Stores/West", "Acme/Offices"]);
    expect(fleet.checkIns).toContainEqual({
      providerDeviceId: "35-8C4F2A9B1D7E",
      lastCheckInAt: NOW,
    });
    expect(fleet.checkIns).toContainEqual({
      providerDeviceId: "WIN-5D1C2B3A4E5F",
      lastCheckInAt: new Date("2026-11-19T10:00:00Z"),
    });
    expect(fleet.enterpriseId).toBe(SOTI_SERVER);
  });

  test("a list cut short by the read's budget says so, names no window, and marks nothing removed", async () => {
    const many: Array<JSONObject> = [];

    for (let index: number = 0; index < 700; index++) {
      many.push(buildSotiDevice({ DeviceId: `35-${index}` }));
    }

    // The token and one page.
    const fleet: DeviceManagementFleetRead = await sessionOf(
      new FakeSotiApi({ devices: many }).transport,
      { maxRequests: 2 },
    ).readFleet({ checkInSince: NOW });

    expect(fleet.isDeviceListComplete).toBe(false);
    expect(fleet.devices).toHaveLength(500);
    expect(fleet.checkInWindowEnd).toBeUndefined();
    expect(fleet.warnings.join(" ")).toContain("cut short");
  });

  test("an answer that is no list is a failure naming the call", async () => {
    const api: FakeSotiApi = new FakeSotiApi({ devices: devices() });
    api.script(`${BASE_PATH}/devices`, [
      { status: 200, body: { Message: "Maintenance" } },
    ]);

    await expect(
      sessionOf(api.transport).readFleet({ checkInSince: NOW }),
    ).rejects.toThrow(
      "MobiControl answered the device list request with something that is not a list (HTTP 200).",
    );
  });

  test("a 429 waits what Retry-After says; with none it backs off; too many give up and say so", async () => {
    const api: FakeSotiApi = new FakeSotiApi({ devices: devices() });
    api.script(`${BASE_PATH}/devices`, [
      { status: 429, headers: { "retry-after": "3" } },
      { status: 429 },
    ]);
    const slept: Array<number> = [];

    const fleet: DeviceManagementFleetRead = await sessionOf(api.transport, {
      slept,
    }).readFleet({ checkInSince: NOW });

    expect(fleet.isDeviceListComplete).toBe(true);
    expect(slept).toContain(3000);

    const busy: FakeSotiApi = new FakeSotiApi({ devices: devices() });
    busy.script(`${BASE_PATH}/devices`, [
      { status: 429 },
      { status: 429 },
      { status: 429 },
      { status: 429 },
      { status: 429 },
    ]);
    const result: DeviceManagementTestResult = await testOf(busy.transport);
    expect(result.failureKind).toBe(LlmConnectionFailureKind.RateLimited);
    expect(result.message).toContain("slow down (HTTP 429)");
  });
});

describe("a device's apps", () => {
  test("every page of them, the device's ID encoded twice as MobiControl decodes it", async () => {
    const apps: Array<JSONObject> = [];

    for (let index: number = 0; index < 600; index++) {
      apps.push(
        buildSotiApp({
          ApplicationId: `com.example.app${index}`,
          Name: `App ${index}`,
        }),
      );
    }

    const id: string = "mac:00:11:22:33:44:57";
    const api: FakeSotiApi = new FakeSotiApi({
      devices: [buildSotiDevice({ DeviceId: id })],
      apps: { [id]: apps },
    });
    const session: DeviceManagementSession = sessionOf(api.transport);

    const read: Array<ProviderApp> = await session.readApps({
      enterpriseId: SOTI_SERVER,
      providerDeviceId: id,
    });

    expect(read).toHaveLength(600);
    expect(getSotiInstalledApplicationsPath(id)).toBe(
      "/devices/mac%253A00%253A11%253A22%253A33%253A44%253A57/installedApplications",
    );
    expect(
      api.requests
        .filter((request: FakeSotiRequest): boolean => {
          return request.path.endsWith("/installedApplications");
        })
        .map((request: FakeSotiRequest): string | null => {
          return request.query.get("skip");
        }),
    ).toEqual(["0", "500"]);
    expect(session.readsAppsOf({ platform: ManagedDevicePlatform.IOS })).toBe(
      true,
    );
    expect(session.readCheckIn).toBeUndefined();
    expect(session.maxAppDevicesPerRead).toBeUndefined();
  });

  test("a user that may not view installed applications: a permission failure", async () => {
    const api: FakeSotiApi = new FakeSotiApi({ devices: devices() });
    api.script(`${BASE_PATH}/devices/35-8C4F2A9B1D7E/installedApplications`, [
      { status: 403, body: { Message: "Access denied." } },
    ]);

    await expect(
      sessionOf(api.transport).readApps({
        enterpriseId: SOTI_SERVER,
        providerDeviceId: "35-8C4F2A9B1D7E",
      }),
    ).rejects.toMatchObject({ kind: LlmConnectionFailureKind.Permission });
  });
});

describe("testing a connection", () => {
  test("passes, and says how many devices a read will import, from the devices counted by their Mode", async () => {
    const api: FakeSotiApi = new FakeSotiApi({ devices: devices() });

    const result: DeviceManagementTestResult = await testOf(api.transport);

    expect(result).toMatchObject({
      provider: DeviceManagementProvider.Soti,
      status: "pass",
      tenant: SOTI_SERVER,
      deviceCount: 4,
      message: `Connected to SOTI MobiControl at ${SOTI_SERVER}: 4 devices to import.`,
    });
    // Read-only: a token, one device, the summary.
    expect(
      api.requests.map((request: FakeSotiRequest): string => {
        return `${request.method} ${request.path}`;
      }),
    ).toEqual([
      `POST ${BASE_PATH}/token`,
      `GET ${BASE_PATH}/devices`,
      `POST ${BASE_PATH}/devices/summary`,
    ]);
    expect(api.requests[1]!.query.get("take")).toBe("1");
    expect(JSON.parse(String(api.requests[2]!.body))).toEqual(
      SOTI_MODE_SUMMARY_REQUEST,
    );
  });

  test("a count the summary does not give is not said; the test still passes", async () => {
    const api: FakeSotiApi = new FakeSotiApi({ devices: devices() });
    api.script(`${BASE_PATH}/devices/summary`, [
      { status: 500 },
      { status: 500 },
      { status: 500 },
    ]);

    const result: DeviceManagementTestResult = await testOf(api.transport);

    expect(result.status).toBe("pass");
    expect(result.deviceCount).toBeUndefined();
    expect(result.message).toBe(
      `Connected to SOTI MobiControl at ${SOTI_SERVER}.`,
    );
  });

  test("a server or credentials that cannot be one are refused before any request", async () => {
    const api: FakeSotiApi = new FakeSotiApi({ devices: devices() });

    for (const data of [
      { config: config({ tenant: "" }) },
      { config: config({ tenant: "http://acme.mobicontrolcloud.com" }) },
      { config: config({ tenant: "acme.mobicontrolcloud.com:99999" }) },
      { config: config({ clientId: "" }) },
      { config: config({ username: "" }) },
      { clientSecret: "" },
      { password: "" },
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

  test("the web console's address is read as its server's", async () => {
    const result: DeviceManagementTestResult = await testOf(
      new FakeSotiApi({ devices: devices() }).transport,
      {
        config: config({
          tenant:
            "https://ACME.mobicontrolcloud.com/MobiControl/WebConsole/home",
        }),
      },
    );

    expect(result).toMatchObject({ status: "pass", tenant: SOTI_SERVER });
  });
});

describe("where the requests may go", () => {
  test("loopback, link-local and the cloud metadata address are refused - the sign-in never goes there", async () => {
    for (const address of ["127.0.0.1", "169.254.169.254", "::1"]) {
      const api: FakeSotiApi = new FakeSotiApi({ devices: devices() });
      const guard: EgressGuardedTransport = createEgressGuardedTransport({
        inner: api.transport,
        addresses: { [SOTI_SERVER]: [[address]] },
        blockPrivateAddresses: false,
      });

      const result: DeviceManagementTestResult = await testOf(guard.transport);

      expect(result).toMatchObject({
        status: "fail",
        failureKind: LlmConnectionFailureKind.Settings,
      });
      expect(result.message).toContain(
        "OneUptime did not connect to the SOTI MobiControl server",
      );
      // The credentials never left: the token request was the one refused.
      expect(api.requests).toHaveLength(0);
      expect(guard.refused).toEqual([
        `https://${SOTI_SERVER}${BASE_PATH}/token`,
      ]);
    }
  });

  test("a server on a private network is refused on OneUptime Cloud, and read by a self-hosted OneUptime", async () => {
    const addresses: Record<string, Array<Array<string>>> = {
      [SOTI_SERVER]: [["192.168.10.5"]],
    };

    const cloud: EgressGuardedTransport = createEgressGuardedTransport({
      inner: new FakeSotiApi({ devices: devices() }).transport,
      addresses,
      blockPrivateAddresses: true,
    });
    expect((await testOf(cloud.transport)).status).toBe("fail");

    const selfHosted: EgressGuardedTransport = createEgressGuardedTransport({
      inner: new FakeSotiApi({ devices: devices() }).transport,
      addresses,
      blockPrivateAddresses: false,
    });
    expect((await testOf(selfHosted.transport)).status).toBe("pass");
  });

  test("a redirect to the metadata address, or off the server, is never followed with the token", async () => {
    for (const location of [
      "http://169.254.169.254/latest/meta-data/",
      "https://acme.mobicontrolcloud.com.attacker.example/MobiControl/api/devices",
    ]) {
      const api: FakeSotiApi = new FakeSotiApi({ devices: devices() });
      api.script(`${BASE_PATH}/devices`, [
        { status: 302, headers: { location } },
      ]);

      const result: DeviceManagementTestResult = await testOf(api.transport);

      expect(result.status).toBe("fail");
      expect(result.message).toContain("nothing was sent there");
      for (const request of api.requests) {
        expect(request.host).toBe(SOTI_SERVER);
      }
    }
  });

  test("a server rebound to the metadata address after its sign-in: the next request is refused", async () => {
    const api: FakeSotiApi = new FakeSotiApi({ devices: devices() });
    const guard: EgressGuardedTransport = createEgressGuardedTransport({
      inner: api.transport,
      addresses: {
        [SOTI_SERVER]: [["52.10.20.30"], ["169.254.169.254"]],
      },
      blockPrivateAddresses: true,
    });

    const result: DeviceManagementTestResult = await testOf(guard.transport);

    expect(result.status).toBe("fail");
    expect(guard.allowed).toEqual([`https://${SOTI_SERVER}${BASE_PATH}/token`]);
    expect(guard.refused).toHaveLength(1);
  });

  test("a server named by a refused address goes nowhere through the real fetch", async () => {
    process.env["BILLING_ENABLED"] = "true";

    for (const host of ["169.254.169.254", "127.0.0.1", "172.16.0.9"]) {
      const result: DeviceManagementTestResult = await testOf(
        DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
        { config: config({ tenant: host }) },
      );

      expect(result).toMatchObject({
        status: "fail",
        failureKind: LlmConnectionFailureKind.Settings,
      });
      expect(result.message).toContain(
        `SOTI MobiControl server host ${host} is not allowed`,
      );
    }
  });
});
