import { describe, expect, test } from "@jest/globals";
import {
  DEFAULT_DEVICE_MANAGEMENT_READ_INTERVAL_IN_MINUTES,
  DeviceManagementConfig,
  getEsperApiBaseUrl,
  getEsperConsoleUrl,
  readDeviceManagementConfig,
  readDeviceManagementReadInterval,
  readEsperApiKey,
  readEsperTenant,
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
  getDeviceManagementProviderTitle,
  isDeviceManagementProvider,
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
  test("Esper, by its own name in every language", () => {
    expect(isDeviceManagementProvider("esper")).toBe(true);
    expect(isDeviceManagementProvider("intune")).toBe(false);
    expect(
      getDeviceManagementProviderTitle(DeviceManagementProvider.Esper),
    ).toBe("Esper");
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
});
