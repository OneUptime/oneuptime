import { describe, expect, test } from "@jest/globals";
import IntuneConnector, {
  INTUNE_DEVICES_PATH,
} from "../../../../Server/Utils/DeviceManagement/Intune/IntuneConnector";
import IntuneGraphClient, {
  INTUNE_EGRESS_LABEL,
  IntuneList,
} from "../../../../Server/Utils/DeviceManagement/Intune/IntuneGraphClient";
import {
  DeviceManagementBudgetSpent,
  DeviceManagementFleetRead,
  DeviceManagementSession,
  ProviderApp,
} from "../../../../Server/Utils/DeviceManagement/DeviceManagementTypes";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { DeviceManagementTestResult } from "../../../../Types/DeviceManagement/DeviceManagementConnectionTest";
import DeviceManagementProvider from "../../../../Types/DeviceManagement/DeviceManagementProvider";
import { ManagedDevicePlatform } from "../../../../Types/DeviceManagement/ManagedDevicePlatform";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import {
  FakeIntuneAnswer,
  FakeIntuneGraph,
  FakeIntuneRequest,
  INTUNE_CLIENT_ID,
  INTUNE_CLIENT_SECRET,
  INTUNE_TENANT,
  INTUNE_TOKEN,
  buildIntuneAndroid,
  buildIntuneDetectedApp,
  buildIntuneDevice,
  buildIntuneIpad,
  buildIntuneIphone,
} from "./FakeIntuneGraph";

/*
 * Microsoft Intune through Microsoft Graph (#9837), against a fake that
 * answers as Microsoft's reference pages document: the client credentials
 * grant and what Microsoft Entra says when the tenant, the app or its
 * secret is wrong; the device list a page at a time; 429s with and without
 * Retry-After; a token that expired; a permission the app registration
 * lacks; and links that lead off Graph. Nothing here talks to Microsoft.
 */

const NOW: Date = new Date("2026-11-19T12:00:00Z");
const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

const DEVICES: Array<ReturnType<typeof buildIntuneDevice>> = [
  buildIntuneDevice(),
  buildIntuneIpad(),
  buildIntuneAndroid(),
];

function clientOf(
  graph: FakeIntuneGraph,
  overrides: Partial<ConstructorParameters<typeof IntuneGraphClient>[0]> = {},
): { client: IntuneGraphClient; slept: Array<number> } {
  const slept: Array<number> = [];

  return {
    slept,
    client: new IntuneGraphClient({
      tenant: INTUNE_TENANT,
      clientId: INTUNE_CLIENT_ID,
      clientSecret: INTUNE_CLIENT_SECRET,
      cloud: "public",
      transport: graph.transport,
      now: (): Date => {
        return NOW;
      },
      sleep: async (milliseconds: number): Promise<void> => {
        slept.push(milliseconds);
      },
      random: (): number => {
        return 0.5;
      },
      ...overrides,
    }),
  };
}

async function failureOf(promise: Promise<unknown>): Promise<LlmProviderError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LlmProviderError);
    return error as LlmProviderError;
  }

  throw new Error("expected a failure");
}

function sessionOf(
  graph: FakeIntuneGraph,
  maxRequests: number = 100,
): DeviceManagementSession {
  return new IntuneConnector().openSession(
    {
      provider: DeviceManagementProvider.Intune,
      projectId: PROJECT_ID,
      config: {
        tenant: INTUNE_TENANT,
        clientId: INTUNE_CLIENT_ID,
        cloud: "public",
        readIntervalInMinutes: 15,
      },
      apiKey: "",
      clientSecret: INTUNE_CLIENT_SECRET,
    },
    {
      transport: graph.transport,
      now: (): Date => {
        return NOW;
      },
      sleep: async (): Promise<void> => {},
      maxRequests,
      maxDurationMs: 60 * 1000,
    },
  );
}

async function test_(
  graph: FakeIntuneGraph,
  overrides: {
    tenant?: string;
    clientId?: string;
    secret?: string;
    cloud?: string;
  } = {},
): Promise<DeviceManagementTestResult> {
  return new IntuneConnector().testConnection(
    {
      apiKey: "",
      clientSecret: overrides.secret ?? INTUNE_CLIENT_SECRET,
      config: {
        tenant: overrides.tenant ?? INTUNE_TENANT,
        clientId: overrides.clientId ?? INTUNE_CLIENT_ID,
        cloud: overrides.cloud ?? "public",
        readIntervalInMinutes: 15,
      },
    },
    {
      transport: graph.transport,
      sleep: async (): Promise<void> => {},
    },
  );
}

describe("signing in", () => {
  test("the client credentials grant at the tenant's sign-in, for Graph", async () => {
    const graph: FakeIntuneGraph = new FakeIntuneGraph({ devices: DEVICES });
    const { client } = clientOf(graph);

    expect(await client.getToken()).toBe(INTUNE_TOKEN);

    const token: FakeIntuneRequest = graph.requests[0]!;
    expect(token.method).toBe("POST");
    expect(token.url).toBe(
      "https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token",
    );
    expect(token.body).toEqual({
      client_id: INTUNE_CLIENT_ID,
      client_secret: INTUNE_CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    });
    expect(token.egressLabel).toBe(INTUNE_EGRESS_LABEL);

    // Kept for its life: asked once.
    await client.getToken();
    expect(graph.requests).toHaveLength(1);
  });

  test("each cloud signs in and reads at its own hosts", async () => {
    const graph: FakeIntuneGraph = new FakeIntuneGraph({
      loginHost: "login.microsoftonline.us",
      graphHost: "dod-graph.microsoft.us",
      devices: DEVICES,
    });
    const { client } = clientOf(graph, { cloud: "dod" });

    await client.get(INTUNE_DEVICES_PATH, "?$top=1", "device list request");

    expect(
      graph.requests.map((request: FakeIntuneRequest): string => {
        return request.host;
      }),
    ).toEqual(["login.microsoftonline.us", "dod-graph.microsoft.us"]);
    expect(graph.requests[0]!.body).toMatchObject({
      scope: "https://dod-graph.microsoft.us/.default",
    });
  });

  test("a wrong secret, an unknown app, an unknown tenant: each said, the secret never", async () => {
    const wrongSecret: LlmProviderError = await failureOf(
      clientOf(new FakeIntuneGraph(), {
        clientSecret: "Wrong8Q~0123456789abcdefghijklmnopqrstu",
      }).client.getToken(),
    );
    expect(wrongSecret.kind).toBe(LlmConnectionFailureKind.Authentication);
    expect(wrongSecret.message).toContain("refused the client secret");
    expect(wrongSecret.message).toContain("AADSTS7000215");
    expect(wrongSecret.message).not.toContain("Wrong8Q~");
    expect(wrongSecret.message).not.toContain("Trace ID");

    const unknownApp: LlmProviderError = await failureOf(
      clientOf(new FakeIntuneGraph(), {
        clientId: "00000000-0000-4000-8000-000000000000",
      }).client.getToken(),
    );
    expect(unknownApp.kind).toBe(LlmConnectionFailureKind.Settings);
    expect(unknownApp.message).toContain("no app registration");

    const unknownTenant: LlmProviderError = await failureOf(
      clientOf(new FakeIntuneGraph(), {
        tenant: "fabrikam.onmicrosoft.com",
      }).client.getToken(),
    );
    expect(unknownTenant.kind).toBe(LlmConnectionFailureKind.Settings);
    expect(unknownTenant.message).toContain("no such tenant");
  });

  test("a token Graph no longer takes is asked for again, once", async () => {
    const graph: FakeIntuneGraph = new FakeIntuneGraph({ devices: DEVICES });
    graph.script(INTUNE_DEVICES_PATH, [
      {
        status: 401,
        body: {
          error: {
            code: "InvalidAuthenticationToken",
            message: "Lifetime validation failed, the token is expired.",
          },
        },
      },
    ]);
    const { client } = clientOf(graph);

    const list: IntuneList = await client.getAll(
      INTUNE_DEVICES_PATH,
      "",
      "device list request",
      10,
    );

    expect(list.items).toHaveLength(3);
    expect(graph.requestsTo(INTUNE_DEVICES_PATH).length).toBe(3);
    expect(
      graph.requests.filter((request: FakeIntuneRequest): boolean => {
        return request.method === "POST";
      }),
    ).toHaveLength(2);
  });
});

describe("reading Graph", () => {
  test("every page of the device list, each next link followed on Graph", async () => {
    const graph: FakeIntuneGraph = new FakeIntuneGraph({
      devices: DEVICES,
      pageSize: 2,
    });
    const { client } = clientOf(graph);

    const list: IntuneList = await client.getAll(
      INTUNE_DEVICES_PATH,
      "",
      "device list request",
      10,
    );

    expect(list.isTruncated).toBe(false);
    expect(list.items).toHaveLength(3);
    expect(
      graph
        .requestsTo(INTUNE_DEVICES_PATH)
        .map((request: FakeIntuneRequest): string | null => {
          return request.query.get("$skiptoken");
        }),
    ).toEqual([null, "2"]);
    for (const request of graph.requestsTo(INTUNE_DEVICES_PATH)) {
      expect(request.headers["Authorization"]).toBe(`Bearer ${INTUNE_TOKEN}`);
    }
  });

  test("a list cut short by its pages, or by the read's budget, says so", async () => {
    const graph: FakeIntuneGraph = new FakeIntuneGraph({
      devices: DEVICES,
      pageSize: 1,
    });

    const byPages: IntuneList = await clientOf(graph).client.getAll(
      INTUNE_DEVICES_PATH,
      "",
      "device list request",
      2,
    );
    expect(byPages).toMatchObject({ isTruncated: true });
    expect(byPages.items).toHaveLength(2);

    // The token, then two pages: the budget ends the list part way.
    const byBudget: IntuneList = await clientOf(
      new FakeIntuneGraph({
        devices: DEVICES,
        pageSize: 1,
      }),
      { maxRequests: 3 },
    ).client.getAll(INTUNE_DEVICES_PATH, "", "device list request", 10, {
      stopWhenBudgetSpent: true,
    });
    expect(byBudget).toMatchObject({ isTruncated: true, isBudgetSpent: true });
    expect(byBudget.items).toHaveLength(2);
  });

  test("a 429 waits what Retry-After says, halves the pace, and tries again", async () => {
    const graph: FakeIntuneGraph = new FakeIntuneGraph({ devices: DEVICES });
    graph.script(INTUNE_DEVICES_PATH, [
      {
        status: 429,
        headers: { "retry-after": "7" },
        body: {
          error: { code: "TooManyRequests", message: "Too many requests." },
        },
      },
    ]);
    const { client, slept } = clientOf(graph);

    const list: IntuneList = await client.getAll(
      INTUNE_DEVICES_PATH,
      "",
      "device list request",
      10,
    );

    expect(list.items).toHaveLength(3);
    expect(slept).toContain(7000);
    expect(client.wasRateLimited()).toBe(true);
    expect(client.getRequestsPerSecond()).toBe(2.5);
  });

  test("a 429 with no Retry-After backs off; too many, or too long a wait, gives up and says so", async () => {
    const graph: FakeIntuneGraph = new FakeIntuneGraph({ devices: DEVICES });
    graph.script(INTUNE_DEVICES_PATH, [
      { status: 429 },
      { status: 429, headers: { "retry-after": "3600" } },
    ]);
    const { client, slept } = clientOf(graph);

    const failure: LlmProviderError = await failureOf(
      client.getAll(INTUNE_DEVICES_PATH, "", "device list request", 10),
    );

    expect(slept).toContain(client.backoffMs(1));
    expect(failure.kind).toBe(LlmConnectionFailureKind.RateLimited);
    expect(failure.retryAfterSeconds).toBe(3600);
    expect(failure.message).toContain("slow down");
  });

  test("a server error is tried again; a dropped connection once more", async () => {
    const graph: FakeIntuneGraph = new FakeIntuneGraph({ devices: DEVICES });
    graph.script(INTUNE_DEVICES_PATH, [{ status: 503 }]);
    graph.dropConnections(INTUNE_DEVICES_PATH, 1);

    const list: IntuneList = await clientOf(graph).client.getAll(
      INTUNE_DEVICES_PATH,
      "",
      "device list request",
      10,
    );

    expect(list.items).toHaveLength(3);
  });

  test("without the permission: a permission failure naming it", async () => {
    const failure: LlmProviderError = await failureOf(
      clientOf(
        new FakeIntuneGraph({ devices: DEVICES, isPermissionMissing: true }),
      ).client.getAll(INTUNE_DEVICES_PATH, "", "device list request", 10),
    );

    expect(failure.kind).toBe(LlmConnectionFailureKind.Permission);
    expect(failure.message).toContain(
      "DeviceManagementManagedDevices.Read.All",
    );
    expect(failure.message).toContain("admin consent");
  });

  test("a tenant with no Intune license is said", async () => {
    const graph: FakeIntuneGraph = new FakeIntuneGraph({ devices: DEVICES });
    graph.script(INTUNE_DEVICES_PATH, [
      {
        status: 400,
        body: {
          error: {
            code: "BadRequest",
            message: "Request not applicable to target tenant.",
          },
        },
      },
    ]);

    const failure: LlmProviderError = await failureOf(
      clientOf(graph).client.getAll(
        INTUNE_DEVICES_PATH,
        "",
        "device list request",
        10,
      ),
    );

    expect(failure.kind).toBe(LlmConnectionFailureKind.Settings);
    expect(failure.message).toContain("no Intune license");
  });

  test("a next link or a redirect off Graph is never followed, and the token never sent there", async () => {
    const graph: FakeIntuneGraph = new FakeIntuneGraph({ devices: DEVICES });
    graph.script(INTUNE_DEVICES_PATH, [
      {
        status: 200,
        body: {
          value: [DEVICES[0]],
          "@odata.nextLink":
            "https://graph.microsoft.com.attacker.example/v1.0/deviceManagement/managedDevices?$skiptoken=1",
        },
      },
    ]);

    const offHost: LlmProviderError = await failureOf(
      clientOf(graph).client.getAll(
        INTUNE_DEVICES_PATH,
        "",
        "device list request",
        10,
      ),
    );
    expect(offHost.message).toContain("outside Graph");

    const redirected: FakeIntuneGraph = new FakeIntuneGraph({
      devices: DEVICES,
    });
    redirected.script(INTUNE_DEVICES_PATH, [
      { status: 302, headers: { location: "http://169.254.169.254/latest" } },
    ]);
    const viaRedirect: LlmProviderError = await failureOf(
      clientOf(redirected).client.get(
        INTUNE_DEVICES_PATH,
        "",
        "device list request",
      ),
    );
    expect(viaRedirect.message).toContain("nothing was sent there");

    for (const request of [...graph.requests, ...redirected.requests]) {
      expect(["login.microsoftonline.com", "graph.microsoft.com"]).toContain(
        request.host,
      );
    }
  });

  test("only Graph's own versioned paths, over HTTPS, take the token", () => {
    const { client } = clientOf(new FakeIntuneGraph());

    expect(
      client.isAllowedGraphUrl(
        "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices",
      ),
    ).toBe(true);
    expect(
      client.isAllowedGraphUrl(
        "https://graph.microsoft.com/beta/deviceManagement/managedDevices/a",
      ),
    ).toBe(true);
    for (const url of [
      "http://graph.microsoft.com/v1.0/x",
      "https://graph.microsoft.com:8443/v1.0/x",
      "https://user:pass@graph.microsoft.com/v1.0/x",
      "https://graph.microsoft.com/other/x",
      "https://graph.microsoft.us/v1.0/x",
      "https://10.0.0.1/v1.0/x",
      "not a url",
    ]) {
      expect(client.isAllowedGraphUrl(url)).toBe(false);
    }
  });

  test("every request counts against the read's budget, the token's too", async () => {
    const { client } = clientOf(new FakeIntuneGraph({ devices: DEVICES }), {
      maxRequests: 1,
    });

    await expect(
      client.get(INTUNE_DEVICES_PATH, "", "device list request"),
    ).rejects.toBeInstanceOf(DeviceManagementBudgetSpent);
    expect(client.getRequestCount()).toBe(1);
  });
});

describe("testing a connection", () => {
  test("passes, and says how many devices a read will import", async () => {
    const graph: FakeIntuneGraph = new FakeIntuneGraph({
      devices: DEVICES,
      enrolledDeviceCount: 412,
    });

    const result: DeviceManagementTestResult = await test_(graph);

    expect(result).toMatchObject({
      provider: DeviceManagementProvider.Intune,
      status: "pass",
      tenant: INTUNE_TENANT,
      deviceCount: 412,
      message:
        "Connected to the Intune tenant contoso.onmicrosoft.com: 412 devices to import.",
    });
    // Read-only: a token, one device's ID, the overview.
    expect(
      graph.requests.map((request: FakeIntuneRequest): string => {
        return `${request.method} ${request.path}`;
      }),
    ).toEqual([
      "POST /contoso.onmicrosoft.com/oauth2/v2.0/token",
      "GET /v1.0/deviceManagement/managedDevices",
      "GET /v1.0/deviceManagement/managedDeviceOverview",
    ]);
    expect(graph.requests[1]!.query.get("$top")).toBe("1");
  });

  test("a failure says what failed and what to do, never the secret", async () => {
    const wrongSecret: DeviceManagementTestResult = await test_(
      new FakeIntuneGraph({ devices: DEVICES }),
      { secret: "Wrong8Q~0123456789abcdefghijklmnopqrstu" },
    );
    expect(wrongSecret).toMatchObject({
      status: "fail",
      failureKind: LlmConnectionFailureKind.Authentication,
    });
    expect(wrongSecret.remediation).toContain("Certificates & secrets");
    expect(JSON.stringify(wrongSecret)).not.toContain("Wrong8Q~");

    const noPermission: DeviceManagementTestResult = await test_(
      new FakeIntuneGraph({ devices: DEVICES, isPermissionMissing: true }),
    );
    expect(noPermission).toMatchObject({
      status: "fail",
      failureKind: LlmConnectionFailureKind.Permission,
    });
    expect(noPermission.remediation).toBe(
      "Give it the application permission DeviceManagementManagedDevices.Read.All on Microsoft Graph, under API permissions, and grant admin consent.",
    );

    const unknownTenant: DeviceManagementTestResult = await test_(
      new FakeIntuneGraph({ devices: DEVICES }),
      { tenant: "fabrikam.onmicrosoft.com" },
    );
    expect(unknownTenant).toMatchObject({
      status: "fail",
      failureKind: LlmConnectionFailureKind.Settings,
      tenant: "fabrikam.onmicrosoft.com",
    });
  });

  test("a tenant or a client ID that cannot be one is refused before any request", async () => {
    const graph: FakeIntuneGraph = new FakeIntuneGraph({ devices: DEVICES });

    for (const overrides of [{ tenant: "common" }, { clientId: "my-app" }]) {
      const result: DeviceManagementTestResult = await test_(graph, overrides);

      expect(result).toMatchObject({
        status: "fail",
        failureKind: LlmConnectionFailureKind.Settings,
      });
    }

    expect(graph.requests).toHaveLength(0);
  });

  test("a count the overview does not give is not said; the test still passes", async () => {
    const graph: FakeIntuneGraph = new FakeIntuneGraph({ devices: DEVICES });
    graph.script("/v1.0/deviceManagement/managedDeviceOverview", [
      { status: 500 },
      { status: 500 },
      { status: 500 },
    ]);

    const result: DeviceManagementTestResult = await test_(graph);

    expect(result.status).toBe("pass");
    expect(result.deviceCount).toBeUndefined();
    expect(result.message).toBe(
      "Connected to the Intune tenant contoso.onmicrosoft.com.",
    );
  });
});

describe("a read", () => {
  test("the fleet: every device, its category as its group, each one's last check-in", async () => {
    const fleet: DeviceManagementFleetRead = await sessionOf(
      new FakeIntuneGraph({ devices: DEVICES, pageSize: 2 }),
    ).readFleet({ checkInSince: new Date("2026-11-19T11:00:00Z") });

    expect(fleet.isDeviceListComplete).toBe(true);
    expect(fleet.enterpriseId).toBe(INTUNE_TENANT);
    expect(
      fleet.devices.map((device: { platform: string }): string => {
        return device.platform;
      }),
    ).toEqual([
      ManagedDevicePlatform.Windows,
      ManagedDevicePlatform.IPadOS,
      ManagedDevicePlatform.Android,
    ]);
    expect(
      fleet.groups.map((group: { name: string }) => {
        return group.name;
      }),
    ).toEqual(["Front Desk", "Warehouse"]);
    expect(fleet.checkIns).toHaveLength(3);
    expect(fleet.checkInWindowEnd).toEqual(NOW);
    expect(fleet.warnings).toEqual([]);
  });

  test("a device list cut short says so, and names no window", async () => {
    // The token and one page of one device.
    const fleet: DeviceManagementFleetRead = await sessionOf(
      new FakeIntuneGraph({ devices: DEVICES, pageSize: 1 }),
      2,
    ).readFleet({ checkInSince: new Date("2026-11-19T11:00:00Z") });

    expect(fleet.isDeviceListComplete).toBe(false);
    expect(fleet.devices).toHaveLength(1);
    expect(fleet.checkInWindowEnd).toBeUndefined();
    expect(fleet.warnings.join(" ")).toContain("cut short");
  });

  test("a device's discovered apps, through beta's detectedApps", async () => {
    const graph: FakeIntuneGraph = new FakeIntuneGraph({
      devices: DEVICES,
      apps: {
        [String(DEVICES[0]!["id"])]: [
          buildIntuneDetectedApp(),
          buildIntuneDetectedApp({
            displayName: "Company Portal",
            version: "11.2",
          }),
        ],
      },
    });
    const session: DeviceManagementSession = sessionOf(graph);

    const apps: Array<ProviderApp> = await session.readApps({
      enterpriseId: INTUNE_TENANT,
      providerDeviceId: String(DEVICES[0]!["id"]),
    });

    expect(
      apps.map((app: ProviderApp): string => {
        return `${app.appName} ${app.versionName}`;
      }),
    ).toEqual(["Microsoft Edge 131.0.2903.51", "Company Portal 11.2"]);
    expect(session.readsAppsOf({ platform: ManagedDevicePlatform.IOS })).toBe(
      true,
    );
    expect(session.readCheckIn).toBeUndefined();

    const request: FakeIntuneRequest = graph.requests[1]!;
    expect(request.path).toBe(
      `/beta/deviceManagement/managedDevices/${String(DEVICES[0]!["id"])}`,
    );
    expect(request.query.get("$expand")).toBe("detectedApps");
  });
});

/*
 * #10287: an iPhone's or an iPad's battery, from beta's single-device GET
 * with $select=id,hardwareInformation - Graph fills hardwareInformation
 * only on a device read alone, and its level on iOS and iPadOS alone -
 * under the one permission every read takes, paced and counted as every
 * request is, and slowed down by a 429 as every request is.
 */
describe("a device's battery", () => {
  const IPHONE: ReturnType<typeof buildIntuneDevice> = buildIntuneIphone();
  const IPAD: ReturnType<typeof buildIntuneDevice> = buildIntuneIpad();
  const WINDOWS: ReturnType<typeof buildIntuneDevice> = buildIntuneDevice();

  function pathOf(device: ReturnType<typeof buildIntuneDevice>): string {
    return `/beta/deviceManagement/managedDevices/${String(device["id"])}`;
  }

  function graphOf(): FakeIntuneGraph {
    return new FakeIntuneGraph({
      devices: [IPHONE, IPAD, WINDOWS],
      hardware: {
        [String(IPHONE["id"])]: {
          serialNumber: "F2LXK1GHJKL0",
          isSupervised: true,
          productName: "iPhone15,4",
          batteryLevelPercentage: 18,
        },
        [String(IPAD["id"])]: {
          serialNumber: "DMPXK1ABCDEF",
          isSupervised: true,
          productName: "iPad12,1",
          batteryLevelPercentage: 64.5,
        },
        // A laptop's battery health is said; its level never is.
        [String(WINDOWS["id"])]: {
          batteryHealthPercentage: 93,
          batteryChargeCycles: 212,
          batteryLevelPercentage: null,
        },
      },
    });
  }

  test("is asked of an iPhone or an iPad alone: Graph says no other device's", () => {
    const session: DeviceManagementSession = sessionOf(graphOf());

    expect(session.readsBatteryOf).toBeDefined();
    expect(session.readBatteryLevel).toBeDefined();
    expect(
      Object.values(ManagedDevicePlatform).filter(
        (platform: ManagedDevicePlatform): boolean => {
          return session.readsBatteryOf!({ platform });
        },
      ),
    ).toEqual([ManagedDevicePlatform.IOS, ManagedDevicePlatform.IPadOS]);
  });

  test("reads each one's level from beta's hardwareInformation, as Intune last heard it", async () => {
    const graph: FakeIntuneGraph = graphOf();
    const session: DeviceManagementSession = sessionOf(graph);

    expect(await session.readBatteryLevel!(String(IPHONE["id"]))).toBe(18);
    expect(await session.readBatteryLevel!(String(IPAD["id"]))).toBe(65);
    expect(await session.readBatteryLevel!(String(WINDOWS["id"]))).toBeNull();

    const asked: Array<FakeIntuneRequest> = graph.requests.filter(
      (request: FakeIntuneRequest): boolean => {
        return request.path.startsWith("/beta/");
      },
    );

    expect(asked).toHaveLength(3);
    expect(asked[0]!.method).toBe("GET");
    expect(asked[0]!.host).toBe("graph.microsoft.com");
    expect(asked[0]!.path).toBe(pathOf(IPHONE));
    // Its hardware alone: no apps, no other field.
    expect(asked[0]!.query.get("$select")).toBe("id,hardwareInformation");
    expect(asked[0]!.query.get("$expand")).toBeNull();
    expect(asked[0]!.headers["Authorization"]).toBe(`Bearer ${INTUNE_TOKEN}`);
    expect(asked[0]!.egressLabel).toBe(INTUNE_EGRESS_LABEL);
    // One token for the read, and one request a device, each counted.
    expect(session.getRequestCount()).toBe(4);
  });

  test("a 429 waits as Graph says, and the battery is read all the same", async () => {
    const graph: FakeIntuneGraph = graphOf();

    // Intune's throttled answer, as Graph writes it.
    graph.script(pathOf(IPHONE), [
      {
        status: 429,
        headers: { "retry-after": "2" },
        body: {
          error: {
            code: "TooManyRequests",
            message:
              '{\r\n  "_version": 3,\r\n  "Message": "Too many requests - Operation ID (for customer support): 00000000-0000-0000-0000-000000000000 - Activity ID: 7a6b5c4d-0000-4000-8000-000000000009 - Url: https://fef.msub03.manage.microsoft.com/DeviceFE/StatelessDeviceFEService/deviceManagement/managedDevices?api-version=5024-07-20",\r\n  "CustomApiErrorPhrase": "",\r\n  "RetryAfter": null,\r\n  "ErrorSourceService": "",\r\n  "HttpHeaders": "{}"\r\n}',
            innerError: {
              date: "2026-11-19T12:00:00",
              "request-id": "7a6b5c4d-0000-4000-8000-000000000009",
              "client-request-id": "7a6b5c4d-0000-4000-8000-000000000009",
            },
          },
        },
      },
    ]);

    const session: DeviceManagementSession = sessionOf(graph);

    expect(await session.readBatteryLevel!(String(IPHONE["id"]))).toBe(18);
    expect(graph.requestsTo(pathOf(IPHONE))).toHaveLength(2);
    expect(session.wasRateLimited()).toBe(true);
  });

  test("a 429 that names no wait backs off, and the battery is read all the same", async () => {
    const graph: FakeIntuneGraph = graphOf();

    graph.script(pathOf(IPAD), [{ status: 429 }, { status: 429 }]);

    const session: DeviceManagementSession = sessionOf(graph);

    expect(await session.readBatteryLevel!(String(IPAD["id"]))).toBe(65);
    expect(graph.requestsTo(pathOf(IPAD))).toHaveLength(3);
    expect(session.wasRateLimited()).toBe(true);
  });

  test("Graph throttling past what the client waits ends in a rate limit the read can tell", async () => {
    const graph: FakeIntuneGraph = graphOf();

    graph.script(
      pathOf(IPHONE),
      Array.from({ length: 8 }, (): FakeIntuneAnswer => {
        return { status: 429, headers: { "retry-after": "1" } };
      }),
    );

    const failure: LlmProviderError = await failureOf(
      sessionOf(graph).readBatteryLevel!(String(IPHONE["id"])),
    );

    expect(failure.kind).toBe(LlmConnectionFailureKind.RateLimited);
    expect(failure.statusCode).toBe(429);
    expect(failure.message).toContain("battery request");
  });

  test("a device Intune no longer knows is a 404 the read can tell", async () => {
    const failure: LlmProviderError = await failureOf(
      sessionOf(graphOf()).readBatteryLevel!(
        "00000000-0000-4000-8000-000000000000",
      ),
    );

    expect(failure.statusCode).toBe(404);
  });

  test("a request Graph no longer takes (a beta property gone) is a 400 the read can tell", async () => {
    const graph: FakeIntuneGraph = graphOf();

    graph.script(pathOf(IPAD), [
      {
        status: 400,
        body: {
          error: {
            code: "BadRequest",
            message:
              "Could not find a property named 'hardwareInformation' on type 'microsoft.graph.managedDevice'.",
          },
        },
      },
    ]);

    const failure: LlmProviderError = await failureOf(
      sessionOf(graph).readBatteryLevel!(String(IPAD["id"])),
    );

    expect(failure.statusCode).toBe(400);
    expect(failure.message).toContain("hardwareInformation");
  });

  test("a battery asked past the read's budget stops the read's asking", async () => {
    // The token and one device: the second is past the budget.
    const session: DeviceManagementSession = sessionOf(graphOf(), 2);

    expect(await session.readBatteryLevel!(String(IPHONE["id"]))).toBe(18);
    await expect(
      session.readBatteryLevel!(String(IPAD["id"])),
    ).rejects.toBeInstanceOf(DeviceManagementBudgetSpent);
  });
});
