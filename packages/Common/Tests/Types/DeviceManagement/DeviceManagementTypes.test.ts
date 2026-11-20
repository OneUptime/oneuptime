import { describe, expect, test } from "@jest/globals";
import {
  DEFAULT_DEVICE_MANAGEMENT_READ_INTERVAL_IN_MINUTES,
  DeviceManagementConfig,
  getDeviceManagementConnectionAddress,
  getEsperApiBaseUrl,
  getEsperConsoleUrl,
  getIntuneCloudHosts,
  getIntuneTokenUrl,
  readDeviceManagementConfig,
  readDeviceManagementReadInterval,
  readEsperApiKey,
  readEsperTenant,
  readIntuneClientId,
  readIntuneClientSecret,
  readIntuneCloud,
  readIntuneTenant,
  toDeviceManagementConfigJson,
  validateDeviceManagementConfig,
} from "../../../Types/DeviceManagement/DeviceManagementConnectionSettings";
import {
  DeviceManagementConnectionStatus,
  getDeviceManagementConnectionHealth,
  getDeviceManagementStaleAfterMinutes,
  isDeviceManagementStatusAProblem,
} from "../../../Types/DeviceManagement/DeviceManagementConnectionHealth";
import {
  DeviceManagementReadSummary,
  readDeviceManagementReadSummary,
} from "../../../Types/DeviceManagement/DeviceManagementReadSummary";
import DeviceManagementProvider, {
  getDeviceManagementProviderShortTitle,
  getDeviceManagementProviderTitle,
  isDeviceManagementProvider,
  readDeviceManagementProvider,
} from "../../../Types/DeviceManagement/DeviceManagementProvider";
import {
  EsperDeviceState,
  MANAGED_DEVICE_ONLINE_WINDOW_MINUTES,
  MANAGED_DEVICE_STATUS_LABELS,
  ManagedDeviceStatus,
  getManagedDeviceStatus,
  getManagedDeviceStatusTone,
  isManagedDeviceStatusAProblem,
} from "../../../Types/DeviceManagement/ManagedDeviceStatus";
import {
  ESPER_DEVICE_NAME_PLACEHOLDER,
  ESPER_SERIAL_NUMBER_PLACEHOLDER,
  getManagedDeviceHostName,
  getManagedDeviceUniqueHostName,
  getManagedDeviceUniqueName,
  getSharedManagedDeviceNames,
  getUsableSerialNumber,
  isManagedDeviceHostMatch,
} from "../../../Types/DeviceManagement/ManagedDeviceIdentity";
import BadDataException from "../../../Types/Exception/BadDataException";

/*
 * The rules every writer of a device management connection and every
 * reader of a managed device holds to, in one place: the tenant and the key
 * a connection takes, how its health reads, what its last read said, and
 * whether a device is online, offline, being set up or gone.
 */

const NOW: Date = new Date("2026-11-19T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

describe("the tenant", () => {
  test("is read from whatever people copy: the name, the console's address, the API's", () => {
    expect(readEsperTenant("acme")).toBe("acme");
    expect(readEsperTenant("  ACME ")).toBe("acme");
    expect(readEsperTenant("acme.esper.cloud")).toBe("acme");
    expect(readEsperTenant("https://acme.esper.cloud/devices?tab=1")).toBe(
      "acme",
    );
    expect(readEsperTenant("https://acme-api.esper.cloud/api/")).toBe("acme");
    expect(readEsperTenant("acme-retail-2")).toBe("acme-retail-2");
    expect(readEsperTenant("")).toBe("");
    expect(readEsperTenant(undefined)).toBe("");
  });

  test("is never a host outside esper.cloud, nor anything that is not one DNS label", () => {
    for (const value of [
      "evil.com",
      "acme.esper.cloud.evil.com",
      "https://acme.esper.cloud@evil.com/",
      "acme.esper.cloud:8443",
      "a.b.esper.cloud",
      "-acme",
      "acme-",
      "ac_me",
      "acme corp",
      "x".repeat(64),
      "https://.esper.cloud",
    ]) {
      expect(() => {
        return readEsperTenant(value);
      }).toThrow(BadDataException);
    }

    expect(() => {
      return readEsperTenant(42);
    }).toThrow(/name before \.esper\.cloud/);
  });

  test("names the API's and the console's addresses", () => {
    expect(getEsperApiBaseUrl("acme")).toBe("https://acme-api.esper.cloud/api");
    expect(getEsperConsoleUrl("acme")).toBe("https://acme.esper.cloud");
  });
});

describe("the API key", () => {
  test("is trimmed, and a copied 'Bearer ' is taken off", () => {
    expect(readEsperApiKey("  aBcD1234eFgH5678  ")).toBe("aBcD1234eFgH5678");
    expect(readEsperApiKey("Bearer aBcD1234eFgH5678")).toBe("aBcD1234eFgH5678");
  });

  test("an empty one asks for it, saying where it is made", () => {
    expect(() => {
      return readEsperApiKey("  ");
    }).toThrow(/API Key Management/);
    expect(() => {
      return readEsperApiKey(undefined);
    }).toThrow(BadDataException);
  });

  test("one that cannot be a key is refused", () => {
    for (const value of [
      "short",
      "has a space in it",
      "x".repeat(600),
      "naïve-key-123456",
    ]) {
      expect(() => {
        return readEsperApiKey(value);
      }).toThrow(/not an Esper API key/);
    }
  });
});

describe("the settings", () => {
  test("stored settings are read without trusting them", () => {
    expect(readDeviceManagementConfig(null)).toEqual({
      tenant: "",
      readIntervalInMinutes: DEFAULT_DEVICE_MANAGEMENT_READ_INTERVAL_IN_MINUTES,
    });
    expect(
      readDeviceManagementConfig({
        tenant: "evil.com",
        readIntervalInMinutes: 7,
      }),
    ).toEqual({ tenant: "", readIntervalInMinutes: 15 });
    expect(readDeviceManagementReadInterval("30")).toBe(30);
    expect(readDeviceManagementReadInterval("abc")).toBe(15);
  });

  test("sent settings are checked, never quietly replaced", () => {
    const config: DeviceManagementConfig = validateDeviceManagementConfig(
      { tenant: "https://acme.esper.cloud", readIntervalInMinutes: 30 },
      { requireTenant: true },
    );

    expect(config).toEqual({ tenant: "acme", readIntervalInMinutes: 30 });
    expect(toDeviceManagementConfigJson(config)).toEqual({
      tenant: "acme",
      readIntervalInMinutes: 30,
    });

    expect(() => {
      return validateDeviceManagementConfig(
        { tenant: "acme", readIntervalInMinutes: 7 },
        { requireTenant: true },
      );
    }).toThrow(/a number of minutes: one of 5, 10, 15, 30, 60\./);
    expect(() => {
      return validateDeviceManagementConfig(
        { tenant: "acme", region: "eu" },
        { requireTenant: true },
      );
    }).toThrow(/Settings has no "region"/);
    expect(() => {
      return validateDeviceManagementConfig({}, { requireTenant: true });
    }).toThrow(/Enter your Esper tenant/);
    expect(() => {
      return validateDeviceManagementConfig("acme", { requireTenant: true });
    }).toThrow(/must be an object/);
  });
});

describe("the service", () => {
  test("Esper and Microsoft Intune, by their own names in every language", () => {
    expect(isDeviceManagementProvider("esper")).toBe(true);
    expect(isDeviceManagementProvider("intune")).toBe(true);
    expect(isDeviceManagementProvider("soti")).toBe(false);
    expect(
      getDeviceManagementProviderTitle(DeviceManagementProvider.Esper),
    ).toBe("Esper");
    expect(
      getDeviceManagementProviderTitle(DeviceManagementProvider.Intune),
    ).toBe("Microsoft Intune");
    expect(
      getDeviceManagementProviderShortTitle(DeviceManagementProvider.Intune),
    ).toBe("Intune");
    // A connection made before there was a choice is Esper's.
    expect(readDeviceManagementProvider(undefined)).toBe(
      DeviceManagementProvider.Esper,
    );
  });
});

/*
 * #9837: an Intune connection's tenant is its directory ID or a domain of
 * it, its app registration's client ID a GUID, its cloud one of four.
 */
describe("an Intune connection's settings", () => {
  const TENANT_ID: string = "72f988bf-86f1-41af-91ab-2d7cd011db47";
  const CLIENT_ID: string = "6731de76-14a6-49ae-97bc-6eba6914391e";

  test("the tenant: a directory ID or a domain, as people copy them", () => {
    expect(readIntuneTenant(` ${TENANT_ID.toUpperCase()} `)).toBe(TENANT_ID);
    expect(readIntuneTenant(`{${TENANT_ID}}`)).toBe(TENANT_ID);
    expect(readIntuneTenant("Contoso.OnMicrosoft.com.")).toBe(
      "contoso.onmicrosoft.com",
    );
    expect(readIntuneTenant("")).toBe("");

    // No one tenant, or not a tenant at all: refused, never a path segment.
    for (const value of [
      "common",
      "organizations",
      "contoso",
      "https://login.microsoftonline.com/contoso.onmicrosoft.com",
      "contoso.onmicrosoft.com/../x",
      "contoso .com",
      42,
    ]) {
      expect(() => {
        return readIntuneTenant(value);
      }).toThrow(/Enter your tenant ID/);
    }
  });

  test("the client ID is a GUID; the cloud one of four, the commercial one by default", () => {
    expect(readIntuneClientId(CLIENT_ID.toUpperCase())).toBe(CLIENT_ID);
    expect(() => {
      return readIntuneClientId("6731de76-14a6-49ae-97bc");
    }).toThrow(/Application \(client\) ID/);
    expect(readIntuneCloud(undefined)).toBe("public");
    expect(readIntuneCloud("usgov")).toBe("usgov");
    expect(() => {
      return readIntuneCloud("china");
    }).toThrow("Cloud must be one of public, gcc, usgov, dod.");
  });

  test("each cloud signs in and reads at Microsoft's hosts for it", () => {
    expect(getIntuneCloudHosts("public")).toEqual({
      loginHost: "https://login.microsoftonline.com",
      graphHost: "https://graph.microsoft.com",
    });
    expect(getIntuneCloudHosts("gcc")).toEqual(getIntuneCloudHosts("public"));
    expect(getIntuneCloudHosts("usgov")).toEqual({
      loginHost: "https://login.microsoftonline.us",
      graphHost: "https://graph.microsoft.us",
    });
    expect(getIntuneCloudHosts("dod").graphHost).toBe(
      "https://dod-graph.microsoft.us",
    );
    expect(getIntuneCloudHosts("anything else")).toEqual(
      getIntuneCloudHosts("public"),
    );
    expect(
      getIntuneTokenUrl({ cloud: "usgov", tenant: "contoso.onmicrosoft.us" }),
    ).toBe(
      "https://login.microsoftonline.us/contoso.onmicrosoft.us/oauth2/v2.0/token",
    );
  });

  test("the client secret: its value, never its ID", () => {
    expect(
      readIntuneClientSecret(" Xq48Q~Zk1Lm9vN0pQrStUvWxYz.AbCdEfGhIjK-L "),
    ).toBe("Xq48Q~Zk1Lm9vN0pQrStUvWxYz.AbCdEfGhIjK-L");
    expect(() => {
      return readIntuneClientSecret("3f2b8c1d-4e5f-4a6b-8c7d-9e0f1a2b3c4d");
    }).toThrow(/This is the client secret's ID/);
    expect(() => {
      return readIntuneClientSecret("has a space in it 0123456789");
    }).toThrow(/This is not a client secret/);
    expect(() => {
      return readIntuneClientSecret("");
    }).toThrow(/Enter the client secret's value/);
  });

  test("stored and read back as the service's, checked as it is saved", () => {
    const config: DeviceManagementConfig = validateDeviceManagementConfig(
      { tenant: TENANT_ID, clientId: CLIENT_ID, readIntervalInMinutes: 30 },
      { requireTenant: true, provider: DeviceManagementProvider.Intune },
    );

    expect(toDeviceManagementConfigJson(config)).toEqual({
      tenant: TENANT_ID,
      clientId: CLIENT_ID,
      cloud: "public",
      readIntervalInMinutes: 30,
    });
    expect(
      readDeviceManagementConfig(
        toDeviceManagementConfigJson(config),
        DeviceManagementProvider.Intune,
      ),
    ).toEqual(config);
    // What is stored is never trusted: a client ID that is not one reads "".
    expect(
      readDeviceManagementConfig(
        { tenant: TENANT_ID, clientId: "x" },
        DeviceManagementProvider.Intune,
      ).clientId,
    ).toBe("");
    expect(() => {
      return validateDeviceManagementConfig(
        { tenant: TENANT_ID },
        { requireTenant: true, provider: DeviceManagementProvider.Intune },
      );
    }).toThrow(/Application \(client\) ID/);
    // An Esper connection's config stays as it was stored.
    expect(
      toDeviceManagementConfigJson(
        readDeviceManagementConfig({ tenant: "acme" }),
      ),
    ).toEqual({ tenant: "acme", readIntervalInMinutes: 15 });
  });

  test("what a connection reads, in a line", () => {
    expect(
      getDeviceManagementConnectionAddress({
        provider: DeviceManagementProvider.Intune,
        config: {
          tenant: TENANT_ID,
          cloud: "public",
          readIntervalInMinutes: 15,
        },
      }),
    ).toBe(TENANT_ID);
    expect(
      getDeviceManagementConnectionAddress({
        provider: DeviceManagementProvider.Intune,
        config: {
          tenant: TENANT_ID,
          cloud: "usgov",
          readIntervalInMinutes: 15,
        },
      }),
    ).toBe(`${TENANT_ID} (Microsoft 365 GCC High)`);
    expect(
      getDeviceManagementConnectionAddress({
        provider: DeviceManagementProvider.Esper,
        config: { tenant: "acme", readIntervalInMinutes: 15 },
      }),
    ).toBe("acme.esper.cloud");
  });
});

describe("a connection's health", () => {
  const healthOf: (
    data: Partial<Parameters<typeof getDeviceManagementConnectionHealth>[0]>,
  ) => DeviceManagementConnectionStatus = (
    data: Partial<Parameters<typeof getDeviceManagementConnectionHealth>[0]>,
  ): DeviceManagementConnectionStatus => {
    return getDeviceManagementConnectionHealth(
      { readIntervalInMinutes: 15, isEnabled: true, ...data },
      NOW,
    ).status;
  };

  test("off, waiting, healthy, partial, failing and stale, decided one way", () => {
    expect(healthOf({ isEnabled: false })).toBe(
      DeviceManagementConnectionStatus.Off,
    );
    expect(healthOf({ createdAt: new Date(NOW.getTime() - MINUTE) })).toBe(
      DeviceManagementConnectionStatus.Waiting,
    );
    expect(
      healthOf({ lastSuccessfulPullAt: new Date(NOW.getTime() - 5 * MINUTE) }),
    ).toBe(DeviceManagementConnectionStatus.Healthy);
    expect(
      healthOf({
        lastSuccessfulPullAt: new Date(NOW.getTime() - 5 * MINUTE),
        lastReadStatus: "partial",
      }),
    ).toBe(DeviceManagementConnectionStatus.Partial);
    expect(
      healthOf({
        lastSuccessfulPullAt: new Date(NOW.getTime() - 60 * MINUTE),
        lastPulledAt: new Date(NOW.getTime() - 5 * MINUTE),
        lastError: "Esper refused the key.",
      }),
    ).toBe(DeviceManagementConnectionStatus.Failing);
    expect(
      healthOf({
        lastSuccessfulPullAt: new Date(NOW.getTime() - 120 * MINUTE),
      }),
    ).toBe(DeviceManagementConnectionStatus.Stale);
    expect(
      healthOf({ createdAt: new Date(NOW.getTime() - 120 * MINUTE) }),
    ).toBe(DeviceManagementConnectionStatus.Stale);
  });

  test("a connection goes stale after three of its intervals, never sooner than half an hour", () => {
    expect(getDeviceManagementStaleAfterMinutes(15)).toBe(55);
    expect(getDeviceManagementStaleAfterMinutes(5)).toBe(30);
    expect(getDeviceManagementStaleAfterMinutes(Number.NaN)).toBe(55);
    expect(
      isDeviceManagementStatusAProblem(
        DeviceManagementConnectionStatus.Failing,
      ),
    ).toBe(true);
    expect(
      isDeviceManagementStatusAProblem(DeviceManagementConnectionStatus.Off),
    ).toBe(false);
  });
});

describe("what the last read said", () => {
  test("read back without trusting its shape", () => {
    const summary: DeviceManagementReadSummary | undefined =
      readDeviceManagementReadSummary({
        status: "partial",
        tenant: "acme",
        role: "Viewer",
        deviceCount: 12,
        onlineCount: "10",
        offlineCount: -3,
        addedCount: 2.7,
        warnings: ["One.", 4, ""],
        failureKind: "made-up",
        isDeviceListComplete: false,
      });

    expect(summary).toMatchObject({
      status: "partial",
      tenant: "acme",
      role: "Viewer",
      deviceCount: 12,
      onlineCount: 10,
      offlineCount: 0,
      addedCount: 2,
      warnings: ["One."],
      isDeviceListComplete: false,
    });
    expect(summary?.failureKind).toBeUndefined();
    expect(readDeviceManagementReadSummary({ status: "done" })).toBeUndefined();
    expect(readDeviceManagementReadSummary(null)).toBeUndefined();
  });
});

describe("whether a device is there", () => {
  const statusOf: (
    data: Partial<Parameters<typeof getManagedDeviceStatus>[0]>,
  ) => ManagedDeviceStatus = (
    data: Partial<Parameters<typeof getManagedDeviceStatus>[0]>,
  ): ManagedDeviceStatus => {
    return getManagedDeviceStatus({ now: NOW, ...data });
  };

  test("its last check-in decides online and offline, whatever Esper's state says", () => {
    expect(
      statusOf({
        providerState: EsperDeviceState.Offline,
        lastCheckInAt: new Date(NOW.getTime() - 5 * MINUTE),
      }),
    ).toBe(ManagedDeviceStatus.Online);
    expect(
      statusOf({
        providerState: EsperDeviceState.Online,
        lastCheckInAt: new Date(
          NOW.getTime() - (MANAGED_DEVICE_ONLINE_WINDOW_MINUTES + 1) * MINUTE,
        ),
      }),
    ).toBe(ManagedDeviceStatus.Offline);
    expect(
      statusOf({
        lastCheckInAt: new Date(
          NOW.getTime() - MANAGED_DEVICE_ONLINE_WINDOW_MINUTES * MINUTE,
        ),
      }),
    ).toBe(ManagedDeviceStatus.Online);
  });

  test("with no check-in known, Esper's state is all there is", () => {
    expect(statusOf({ providerState: EsperDeviceState.Online })).toBe(
      ManagedDeviceStatus.Online,
    );
    expect(statusOf({ providerState: EsperDeviceState.Offline })).toBe(
      ManagedDeviceStatus.Offline,
    );
    expect(statusOf({})).toBe(ManagedDeviceStatus.Offline);
  });

  test("being set up, disabled, wiped or removed says so, whatever the check-in", () => {
    const recent: Date = new Date(NOW.getTime() - MINUTE);

    expect(
      statusOf({
        providerState: EsperDeviceState.ConfiguringGooglePlay,
        lastCheckInAt: recent,
      }),
    ).toBe(ManagedDeviceStatus.Provisioning);
    expect(statusOf({ providerState: EsperDeviceState.Registered })).toBe(
      ManagedDeviceStatus.Provisioning,
    );
    expect(statusOf({ providerState: EsperDeviceState.OnboardingFailed })).toBe(
      ManagedDeviceStatus.OnboardingFailed,
    );
    expect(
      statusOf({
        providerState: EsperDeviceState.Disabled,
        lastCheckInAt: recent,
      }),
    ).toBe(ManagedDeviceStatus.Disabled);
    expect(
      statusOf({ providerState: EsperDeviceState.FactoryResetInProgress }),
    ).toBe(ManagedDeviceStatus.Wiping);
    expect(
      statusOf({
        removedAt: NOW,
        providerState: EsperDeviceState.Online,
        lastCheckInAt: recent,
      }),
    ).toBe(ManagedDeviceStatus.Removed);
  });

  test("red only for what went wrong; grey for what someone chose", () => {
    expect(getManagedDeviceStatusTone(ManagedDeviceStatus.Online)).toBe(
      "success",
    );
    expect(getManagedDeviceStatusTone(ManagedDeviceStatus.Offline)).toBe(
      "danger",
    );
    expect(
      getManagedDeviceStatusTone(ManagedDeviceStatus.OnboardingFailed),
    ).toBe("danger");
    expect(getManagedDeviceStatusTone(ManagedDeviceStatus.Provisioning)).toBe(
      "info",
    );

    for (const chosen of [
      ManagedDeviceStatus.Disabled,
      ManagedDeviceStatus.Wiping,
      ManagedDeviceStatus.Removed,
    ]) {
      expect(getManagedDeviceStatusTone(chosen)).toBe("paused");
      expect(isManagedDeviceStatusAProblem(chosen)).toBe(false);
    }

    expect(isManagedDeviceStatusAProblem(ManagedDeviceStatus.Offline)).toBe(
      true,
    );
  });

  test("every status has its name", () => {
    for (const status of Object.values(ManagedDeviceStatus)) {
      expect(MANAGED_DEVICE_STATUS_LABELS[status]).toBeTruthy();
    }
  });
});

describe("the identity contract", () => {
  test("the placeholders Esper fills into a managed configuration", () => {
    expect(ESPER_DEVICE_NAME_PLACEHOLDER).toBe("${esper.deviceName}");
    expect(ESPER_SERIAL_NUMBER_PLACEHOLDER).toBe("${esper.serialNumber}");
  });

  test("a device's host.name is its Esper name; without one, its serial, then its ID", () => {
    expect(
      getManagedDeviceHostName({
        deviceName: " ESP-ID-AAAAW ",
        serialNumber: "R9KT30ABC12",
        providerDeviceId: "id",
      }),
    ).toBe("ESP-ID-AAAAW");
    expect(
      getManagedDeviceHostName({
        serialNumber: "R9KT30ABC12",
        providerDeviceId: "id",
      }),
    ).toBe("R9KT30ABC12");
    expect(
      getManagedDeviceHostName({
        serialNumber: "unknown",
        providerDeviceId: "id",
      }),
    ).toBe("id");
  });

  test("a serial number that names no device never matches", () => {
    expect(getUsableSerialNumber("R9KT30ABC12")).toBe("r9kt30abc12");

    for (const placeholder of [
      "",
      " ",
      "unknown",
      "UNKNOWN",
      "0000000000",
      "null",
      "0123456789ABCDEF",
    ]) {
      expect(getUsableSerialNumber(placeholder)).toBeUndefined();
    }

    expect(getUsableSerialNumber(42)).toBeUndefined();
  });

  test("the ways a host is found", () => {
    expect(isManagedDeviceHostMatch("serial-number")).toBe(true);
    expect(isManagedDeviceHostMatch("mac")).toBe(false);
  });

  // #9837: Intune names every iPhone nobody renamed "iPhone".
  test("a name two devices share names neither: each goes by its serial number, or its ID", () => {
    const first: {
      deviceName: string;
      serialNumber: string;
      providerDeviceId: string;
    } = {
      deviceName: "iPhone",
      serialNumber: "F2LXK1AAAAAA",
      providerDeviceId: "a",
    };
    const second: {
      deviceName: string;
      serialNumber: string;
      providerDeviceId: string;
    } = { deviceName: " IPHONE ", serialNumber: "", providerDeviceId: "b-id" };
    const kiosk: {
      deviceName: string;
      serialNumber: string;
      providerDeviceId: string;
    } = {
      deviceName: "Kiosk 7",
      serialNumber: "R9KT30ABC12",
      providerDeviceId: "c",
    };
    const shared: Set<string> = getSharedManagedDeviceNames([
      first,
      second,
      kiosk,
    ]);

    expect(Array.from(shared)).toEqual(["iphone"]);
    expect(getManagedDeviceUniqueHostName(first, shared)).toBe("F2LXK1AAAAAA");
    expect(getManagedDeviceUniqueHostName(second, shared)).toBe("b-id");
    expect(getManagedDeviceUniqueHostName(kiosk, shared)).toBe("Kiosk 7");
    // Where it must be told apart - a monitor's series - its name says which.
    expect(getManagedDeviceUniqueName(first, shared)).toBe(
      "iPhone (F2LXK1AAAAAA)",
    );
    expect(getManagedDeviceUniqueName(kiosk, shared)).toBe("Kiosk 7");
    // Its own name back once no other device has it.
    expect(getManagedDeviceUniqueHostName(first, new Set<string>())).toBe(
      "iPhone",
    );
  });
});
