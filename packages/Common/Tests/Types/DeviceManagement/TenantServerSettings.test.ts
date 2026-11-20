import { describe, expect, test } from "@jest/globals";
import {
  DeviceManagementConfig,
  getDeviceManagementConnectionAddress,
  getSotiApiBaseUrl,
  getWorkspaceOneApiBaseUrl,
  getWorkspaceOneTokenHost,
  getWorkspaceOneTokenUrl,
  readDeviceManagementConfig,
  readDeviceManagementPassword,
  readDeviceManagementUsername,
  readServerAddress,
  readSotiServer,
  readWorkspaceOneApiKey,
  readWorkspaceOneAuthMethod,
  readWorkspaceOneClientId,
  readWorkspaceOneRegion,
  readWorkspaceOneServer,
  toDeviceManagementConfigJson,
  validateDeviceManagementConfig,
} from "../../../Types/DeviceManagement/DeviceManagementConnectionSettings";
import DeviceManagementProvider from "../../../Types/DeviceManagement/DeviceManagementProvider";
import {
  ManagedDeviceCheckInCadence,
  MANAGED_DEVICE_ONLINE_WINDOW_MINUTES,
  MANAGED_DEVICE_SYNC_ONLINE_WINDOW_MINUTES,
  getManagedDeviceCheckInCadence,
  getManagedDeviceOnlineWindowMinutes,
} from "../../../Types/DeviceManagement/ManagedDeviceStatus";
import {
  getAllManagedDeviceServiceAttributeKeys,
  getManagedDeviceServiceAttributeKeys,
} from "../../../Types/DeviceManagement/ManagedDeviceIdentity";
import { ManagedDevicePlatform } from "../../../Types/DeviceManagement/ManagedDevicePlatform";

/*
 * The settings of a service that answers at a server the customer names
 * (#10086, #10087): the server - where OneUptime connects with the
 * credentials - read strictly; how a Workspace ONE connection signs in and
 * its token service's region; a SOTI connection's API client and user;
 * and what each device of theirs checks in like, and is named by on its
 * host.
 */

const HELP: string = "Enter the server's address.";

describe("a server's address", () => {
  test("whatever people copy names its host: an address with its path, a bare host, any case, a port", () => {
    for (const [typed, read] of [
      ["as1234.awmdm.com", "as1234.awmdm.com"],
      ["https://AS1234.awmdm.com/API/", "as1234.awmdm.com"],
      ["  https://as1234.awmdm.com/api/mdm/devices?page=0#top ", "as1234.awmdm.com"],
      ["HTTPS://mdm.acme.com:8443/MobiControl", "mdm.acme.com:8443"],
      ["mdm.acme.com:443", "mdm.acme.com"],
      ["mobicontrol", "mobicontrol"],
      ["10.20.30.40:9443", "10.20.30.40:9443"],
      ["mdm.acme.com.", "mdm.acme.com"],
      ["mdm.acme.com\\MobiControl", "mdm.acme.com"],
      // The path is dropped: the host is what it names.
      ["as1234.awmdm.com/../admin", "as1234.awmdm.com"],
      ["0.0.0.0", "0.0.0.0"],
    ] as Array<[string, string]>) {
      expect(readServerAddress(typed, HELP)).toBe(read);
    }

    for (const none of [undefined, null, "", "   "]) {
      expect(readServerAddress(none, HELP)).toBe("");
    }
  });

  test("another scheme is refused, never upgraded", () => {
    for (const typed of [
      "http://as1234.awmdm.com",
      "ftp://as1234.awmdm.com",
      "file:///etc/passwd",
      "gopher://169.254.169.254",
    ]) {
      expect(() => {
        return readServerAddress(typed, HELP);
      }).toThrow(
        "OneUptime connects to the server over HTTPS only. Enter its address starting with https://.",
      );
    }
  });

  test("a user or a password in it, a port that is none, or a host that is no host is refused", () => {
    for (const typed of [
      "https://admin:secret@as1234.awmdm.com",
      "admin@as1234.awmdm.com",
      "as1234.awmdm.com:",
      "as1234.awmdm.com:0",
      "as1234.awmdm.com:65536",
      "as1234.awmdm.com:84a3",
      "[::1]",
      "as_1234.awmdm.com",
      "-as1234.awmdm.com",
      "as1234..awmdm.com",
      // A URL reads these as IPv4 addresses, or fails on them.
      "999.1.1.1",
      "1.2.3",
      "0x7f.0.0.1",
      "127.1",
      "010.0.0.1",
      "10.0.0.1.5",
      `${"a".repeat(64)}.com`,
      `${"a.".repeat(130)}com`,
      42,
    ] as Array<unknown>) {
      expect(() => {
        return readServerAddress(typed, HELP);
      }).toThrow(HELP);
    }
  });
});

describe("a Workspace ONE connection's settings (#10086)", () => {
  test("its REST API URL, or its console's address, names the API server", () => {
    expect(readWorkspaceOneServer("https://as1234.awmdm.com/API")).toBe(
      "as1234.awmdm.com",
    );
    // People copy the console's address from the browser: cnNNNN is asNNNN's console.
    expect(
      readWorkspaceOneServer("https://cn1234.awmdm.com/AirWatch/#/Devices"),
    ).toBe("as1234.awmdm.com");
    expect(readWorkspaceOneServer("cn1234.awmdm.com:8443")).toBe(
      "as1234.awmdm.com:8443",
    );
    // Not every host that starts with cn is a console.
    expect(readWorkspaceOneServer("cnx.awmdm.com")).toBe("cnx.awmdm.com");
    expect(readWorkspaceOneServer("cn1234.example.com")).toBe(
      "cn1234.example.com",
    );
    expect(() => {
      return readWorkspaceOneServer("as1234 awmdm com");
    }).toThrow(/Enter your Workspace ONE REST API URL/);
  });

  test("its API, and the token service of each region, at Omnissa's hosts", () => {
    expect(getWorkspaceOneApiBaseUrl("as1234.awmdm.com")).toBe(
      "https://as1234.awmdm.com/api",
    );
    expect(
      ["na", "emea", "apac", "uat"].map((region: string): string => {
        return getWorkspaceOneTokenUrl(region);
      }),
    ).toEqual([
      "https://na.uemauth.workspaceone.com/connect/token",
      "https://emea.uemauth.workspaceone.com/connect/token",
      "https://apac.uemauth.workspaceone.com/connect/token",
      "https://uat.uemauth.workspaceone.com/connect/token",
    ]);
    // Nothing typed becomes a token host.
    expect(getWorkspaceOneTokenHost("evil.example/")).toBe(
      "na.uemauth.workspaceone.com",
    );
  });

  test("how it signs in, and its region: an OAuth client in na by default, anything else refused", () => {
    expect(readWorkspaceOneAuthMethod(undefined)).toBe("oauth");
    expect(readWorkspaceOneAuthMethod("basic")).toBe("basic");
    expect(() => {
      return readWorkspaceOneAuthMethod("certificate");
    }).toThrow("Sign in with must be one of oauth, basic.");
    expect(readWorkspaceOneRegion("")).toBe("na");
    expect(() => {
      return readWorkspaceOneRegion("eu");
    }).toThrow("Region must be one of na, emea, apac, uat.");
  });

  test("its client ID and REST API key: generated text, trimmed, loose on purpose", () => {
    expect(readWorkspaceOneClientId(" a3f1c2d4e5b647a8 ")).toBe(
      "a3f1c2d4e5b647a8",
    );
    expect(() => {
      return readWorkspaceOneClientId("a b");
    }).toThrow(/Enter the OAuth client's Client ID/);
    expect(
      readWorkspaceOneApiKey("1EhZqw0lA6Uq2aUW8IDHm2RkAgpQZJbH9jE2/nYwG+w="),
    ).toBe("1EhZqw0lA6Uq2aUW8IDHm2RkAgpQZJbH9jE2/nYwG+w=");
    expect(() => {
      return readWorkspaceOneApiKey("short");
    }).toThrow(/Enter the REST API key/);
  });

  test("stored and read back as the sign-in's: an OAuth client's region and ID, or an administrator's username", () => {
    const oauth: DeviceManagementConfig = validateDeviceManagementConfig(
      {
        tenant: "https://as1234.awmdm.com/API/",
        region: "emea",
        clientId: "a3f1c2d4e5b647a8b9c0d1e2f3a4b5c6",
        readIntervalInMinutes: "30",
      },
      { requireTenant: true, provider: DeviceManagementProvider.WorkspaceOne },
    );

    expect(oauth).toEqual({
      tenant: "as1234.awmdm.com",
      readIntervalInMinutes: 30,
      authMethod: "oauth",
      region: "emea",
      clientId: "a3f1c2d4e5b647a8b9c0d1e2f3a4b5c6",
    });
    expect(
      readDeviceManagementConfig(
        toDeviceManagementConfigJson(oauth),
        DeviceManagementProvider.WorkspaceOne,
      ),
    ).toEqual(oauth);

    // An administrator's sign-in keeps no OAuth client's settings.
    expect(
      validateDeviceManagementConfig(
        {
          tenant: "mdm.acme.com",
          authMethod: "basic",
          username: " reader ",
          region: "emea",
          clientId: "a3f1c2d4e5b647a8b9c0d1e2f3a4b5c6",
        },
        {
          requireTenant: true,
          provider: DeviceManagementProvider.WorkspaceOne,
        },
      ),
    ).toEqual({
      tenant: "mdm.acme.com",
      readIntervalInMinutes: 15,
      authMethod: "basic",
      username: "reader",
    });

    // A stored value is read without trusting it.
    expect(
      readDeviceManagementConfig(
        { tenant: "http://x", authMethod: "nope", region: "mars" },
        DeviceManagementProvider.WorkspaceOne,
      ),
    ).toEqual({
      tenant: "",
      readIntervalInMinutes: 15,
      authMethod: "oauth",
      region: "na",
      clientId: "",
    });
  });

  test("what it reads, in a line: its server", () => {
    expect(
      getDeviceManagementConnectionAddress({
        provider: DeviceManagementProvider.WorkspaceOne,
        config: { tenant: "as1234.awmdm.com", readIntervalInMinutes: 15 },
      }),
    ).toBe("as1234.awmdm.com");
  });
});

describe("a SOTI connection's settings (#10087)", () => {
  test("the web console's address names the server; its API is under /MobiControl/api", () => {
    expect(
      readSotiServer(
        "https://acme.mobicontrolcloud.com/MobiControl/WebConsole/home",
      ),
    ).toBe("acme.mobicontrolcloud.com");
    expect(getSotiApiBaseUrl("mdm.acme.com:8443")).toBe(
      "https://mdm.acme.com:8443/MobiControl/api",
    );
    expect(() => {
      return readSotiServer("http://acme.mobicontrolcloud.com");
    }).toThrow(/over HTTPS only/);
  });

  test("stored and read back: the server, the API client's ID and the user", () => {
    const config: DeviceManagementConfig = validateDeviceManagementConfig(
      {
        tenant: "acme.mobicontrolcloud.com",
        clientId: "a9326fd5872f4a66b6bab3e2c8065e63",
        username: "oneuptime-reader",
        readIntervalInMinutes: 10,
      },
      { requireTenant: true, provider: DeviceManagementProvider.Soti },
    );

    expect(config).toEqual({
      tenant: "acme.mobicontrolcloud.com",
      readIntervalInMinutes: 10,
      clientId: "a9326fd5872f4a66b6bab3e2c8065e63",
      username: "oneuptime-reader",
    });
    expect(
      readDeviceManagementConfig(
        toDeviceManagementConfigJson(config),
        DeviceManagementProvider.Soti,
      ),
    ).toEqual(config);
    expect(() => {
      return validateDeviceManagementConfig(
        { tenant: "acme.mobicontrolcloud.com", cloud: "public" },
        { requireTenant: true, provider: DeviceManagementProvider.Soti },
      );
    }).toThrow(
      'Settings has no "cloud": a SOTI connection takes tenant, clientId, username and readIntervalInMinutes.',
    );
    expect(
      getDeviceManagementConnectionAddress({
        provider: DeviceManagementProvider.Soti,
        config,
      }),
    ).toBe("acme.mobicontrolcloud.com");
  });
});

describe("usernames and passwords", () => {
  test("a username is trimmed text; a password is kept exactly as typed", () => {
    expect(readDeviceManagementUsername(" ACME\\reader ", HELP)).toBe(
      "ACME\\reader",
    );
    expect(readDeviceManagementPassword(" with spaces ", HELP)).toBe(
      " with spaces ",
    );

    for (const value of ["", "   ", "line\nbreak", "tab\there", null, 7]) {
      expect(() => {
        return readDeviceManagementUsername(value, HELP);
      }).toThrow(HELP);
      expect(() => {
        return readDeviceManagementPassword(value, HELP);
      }).toThrow(HELP);
    }

    expect(() => {
      return readDeviceManagementPassword("x".repeat(513), HELP);
    }).toThrow(HELP);
  });
});

describe("how often their devices check in", () => {
  test("a SOTI agent keeps a live connection: a heartbeat, but not on an Apple device; Workspace ONE's report hours apart", () => {
    for (const platform of [
      ManagedDevicePlatform.Android,
      ManagedDevicePlatform.Windows,
      ManagedDevicePlatform.Linux,
      ManagedDevicePlatform.Other,
    ]) {
      expect(
        getManagedDeviceCheckInCadence({
          provider: DeviceManagementProvider.Soti,
          platform,
        }),
      ).toBe(ManagedDeviceCheckInCadence.Heartbeat);
      expect(
        getManagedDeviceOnlineWindowMinutes({
          provider: DeviceManagementProvider.Soti,
          platform,
        }),
      ).toBe(MANAGED_DEVICE_ONLINE_WINDOW_MINUTES);
    }

    for (const platform of [
      ManagedDevicePlatform.IOS,
      ManagedDevicePlatform.IPadOS,
      ManagedDevicePlatform.MacOS,
    ]) {
      expect(
        getManagedDeviceOnlineWindowMinutes({
          provider: DeviceManagementProvider.Soti,
          platform,
        }),
      ).toBe(MANAGED_DEVICE_SYNC_ONLINE_WINDOW_MINUTES);
    }

    for (const platform of [
      ManagedDevicePlatform.Android,
      ManagedDevicePlatform.IOS,
      ManagedDevicePlatform.Windows,
    ]) {
      expect(
        getManagedDeviceCheckInCadence({
          provider: DeviceManagementProvider.WorkspaceOne,
          platform,
        }),
      ).toBe(ManagedDeviceCheckInCadence.Sync);
    }
  });
});

describe("what their devices' hosts carry", () => {
  test("each service's facts under its own namespace, and every namespace let go with a host", () => {
    expect(
      getManagedDeviceServiceAttributeKeys(DeviceManagementProvider.WorkspaceOne),
    ).toEqual({
      deviceId: "workspaceone.device.id",
      deviceName: "workspaceone.device.name",
      group: "workspaceone.group",
    });
    expect(
      getManagedDeviceServiceAttributeKeys(DeviceManagementProvider.Soti),
    ).toEqual({
      deviceId: "soti.device.id",
      deviceName: "soti.device.name",
      group: "soti.group",
    });

    const all: Array<string> = getAllManagedDeviceServiceAttributeKeys();

    for (const key of [
      "esper.device.id",
      "intune.group",
      "workspaceone.device.name",
      "soti.group",
    ]) {
      expect(all).toContain(key);
    }
  });
});
