import { afterEach, describe, expect, jest, test } from "@jest/globals";
import SnmpTrapReceiverUsers, {
  MAX_TRAP_RECEIVER_DEVICES,
} from "../../../../Server/Utils/Monitor/SnmpTrapReceiverUsers";
import NetworkDeviceHydrationUtil, {
  SnmpConnectionCredentials,
} from "../../../../Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkSiteService from "../../../../Server/Services/NetworkSiteService";
import NetworkSnmpCredentialProfileService from "../../../../Server/Services/NetworkSnmpCredentialProfileService";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkSite from "../../../../Models/DatabaseModels/NetworkSite";
import NetworkSnmpCredentialProfile from "../../../../Models/DatabaseModels/NetworkSnmpCredentialProfile";
import SnmpAuthProtocol from "../../../../Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "../../../../Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpSecurityLevel from "../../../../Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import { SnmpTrapReceiverUser } from "../../../../Types/Probe/SnmpTrapReceiver";
import ObjectID from "../../../../Types/ObjectID";

/*
 * THE SNMPv3 USERS A PROBE'S TRAP RECEIVER IS HANDED (#11005).
 *
 * Only its own devices', from every layer a device takes credentials from -
 * its own columns, its credential profile, its site's default - each read
 * exactly as the poller reads it, and never another project's profile.
 */

const PROBE: ObjectID = new ObjectID("11050000-0000-4000-8000-000000000001");
const PROJECT: ObjectID = new ObjectID("11050000-0000-4000-8000-000000000002");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "11050000-0000-4000-8000-000000000003",
);
const SITE: ObjectID = new ObjectID("11050000-0000-4000-8000-000000000004");
const DEVICE_PROFILE: ObjectID = new ObjectID(
  "11050000-0000-4000-8000-000000000005",
);
const SITE_PROFILE: ObjectID = new ObjectID(
  "11050000-0000-4000-8000-000000000006",
);
const FOREIGN_PROFILE: ObjectID = new ObjectID(
  "11050000-0000-4000-8000-000000000007",
);

let deviceCounter: number = 0;

function device(fields: Record<string, unknown>): NetworkDevice {
  deviceCounter++;
  const model: NetworkDevice = new NetworkDevice();
  model._id = `11050000-0000-4000-8000-1000000000${String(deviceCounter).padStart(2, "0")}`;
  model.projectId = PROJECT;
  model.hostname = `10.20.0.${deviceCounter}`;
  Object.assign(model, fields);
  return model;
}

function profile(
  id: ObjectID,
  fields: Record<string, unknown>,
): NetworkSnmpCredentialProfile {
  const model: NetworkSnmpCredentialProfile =
    new NetworkSnmpCredentialProfile();
  model._id = id.toString();
  model.projectId = PROJECT;
  Object.assign(model, fields);
  return model;
}

const V3_COLUMNS: Record<string, unknown> = {
  snmpVersion: "V3",
  snmpV3SecurityLevel: "authPriv",
  snmpV3Username: "san-monitor",
  snmpV3AuthProtocol: "SHA",
  snmpV3AuthKey: "auth-passphrase",
  snmpV3PrivProtocol: "AES",
  snmpV3PrivKey: "priv-passphrase",
};

const SAN_MONITOR: SnmpTrapReceiverUser = {
  userName: "san-monitor",
  securityLevel: SnmpSecurityLevel.AuthPriv,
  authProtocol: SnmpAuthProtocol.SHA,
  authKey: "auth-passphrase",
  privProtocol: SnmpPrivProtocol.AES,
  privKey: "priv-passphrase",
  addresses: [],
};

function mockLookups(data: {
  devices: Array<NetworkDevice>;
  profiles?: Array<NetworkSnmpCredentialProfile>;
  sites?: Array<NetworkSite>;
}): ReturnType<typeof jest.spyOn> {
  const findIds: ReturnType<typeof jest.spyOn> = jest
    .spyOn(NetworkDeviceService, "findDeviceIdsWithSnmpV3OnProbe")
    .mockResolvedValue(
      data.devices.map((model: NetworkDevice) => {
        return model.id!;
      }),
    );
  jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue(data.devices);
  jest
    .spyOn(NetworkSnmpCredentialProfileService, "findBy")
    .mockImplementation(async (args: unknown) => {
      const wanted: Array<string> = JSON.stringify(
        (args as { query: unknown }).query,
      ).match(/[0-9a-f-]{36}/g) as Array<string>;

      return (data.profiles || []).filter(
        (model: NetworkSnmpCredentialProfile) => {
          return (wanted || []).includes(model.id!.toString());
        },
      );
    });
  jest.spyOn(NetworkSiteService, "findBy").mockResolvedValue(data.sites || []);

  return findIds;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("toUser: one credential, read as the poller reads it", () => {
  test("an authPriv credential", () => {
    expect(SnmpTrapReceiverUsers.toUser(device(V3_COLUMNS), "d")).toEqual(
      SAN_MONITOR,
    );
  });

  test("spellings the forms and the API write are read the parse() way", () => {
    expect(
      SnmpTrapReceiverUsers.toUser(
        device({
          ...V3_COLUMNS,
          snmpV3SecurityLevel: "AuthPriv",
          snmpV3AuthProtocol: "SHA-256",
          snmpV3PrivProtocol: "aes-256",
        }),
        "d",
      ),
    ).toEqual({
      ...SAN_MONITOR,
      authProtocol: SnmpAuthProtocol.SHA256,
      privProtocol: SnmpPrivProtocol.AES256,
    });
  });

  test("unset protocols are the poller's defaults: MD5 and DES", () => {
    expect(
      SnmpTrapReceiverUsers.toUser(
        device({
          ...V3_COLUMNS,
          snmpV3AuthProtocol: null,
          snmpV3PrivProtocol: null,
        }),
        "d",
      ),
    ).toEqual({
      ...SAN_MONITOR,
      authProtocol: SnmpAuthProtocol.MD5,
      privProtocol: SnmpPrivProtocol.DES,
    });
  });

  test("an unset level is noAuthNoPriv, as the hydration sends it", () => {
    expect(
      SnmpTrapReceiverUsers.toUser(
        device({ ...V3_COLUMNS, snmpV3SecurityLevel: null }),
        "d",
      ),
    ).toEqual({
      userName: "san-monitor",
      securityLevel: SnmpSecurityLevel.NoAuthNoPriv,
      addresses: [],
    });
  });

  test("an authNoPriv credential keeps no privacy key", () => {
    expect(
      SnmpTrapReceiverUsers.toUser(
        device({ ...V3_COLUMNS, snmpV3SecurityLevel: "authNoPriv" }),
        "d",
      ),
    ).toEqual({
      userName: "san-monitor",
      securityLevel: SnmpSecurityLevel.AuthNoPriv,
      authProtocol: SnmpAuthProtocol.SHA,
      authKey: "auth-passphrase",
      addresses: [],
    });
  });

  test("a user name is trimmed, as the device sends it", () => {
    expect(
      SnmpTrapReceiverUsers.toUser(
        device({ ...V3_COLUMNS, snmpV3Username: "  san-monitor " }),
        "d",
      )!.userName,
    ).toBe("san-monitor");
  });

  test("the legacy snmpV3Auth object of an old device is read, as the poller reads it", () => {
    expect(
      SnmpTrapReceiverUsers.toUser(
        device({
          snmpVersion: "V3",
          snmpV3Username: null,
          snmpV3Auth: {
            securityLevel: "authNoPriv",
            username: "legacy",
            authProtocol: "SHA",
            authKey: "legacy-passphrase",
          },
        }),
        "d",
      ),
    ).toEqual({
      userName: "legacy",
      securityLevel: SnmpSecurityLevel.AuthNoPriv,
      authProtocol: SnmpAuthProtocol.SHA,
      authKey: "legacy-passphrase",
      addresses: [],
    });
  });

  test("what a poll could not work with either is left out", () => {
    for (const fields of [
      { snmpV3Username: "" },
      { snmpV3Username: "x".repeat(33) },
      { snmpV3SecurityLevel: "everything" },
      { snmpV3AuthProtocol: "SHA-3" },
      { snmpV3AuthKey: "   " },
      { snmpV3PrivProtocol: "3DES" },
      { snmpV3PrivKey: null },
    ]) {
      expect(
        SnmpTrapReceiverUsers.toUser(device({ ...V3_COLUMNS, ...fields }), "d"),
      ).toBeNull();
    }
  });
});

describe("getDeviceAddresses", () => {
  test("its hostname when it is an IP address, and its Other Addresses", () => {
    expect(
      SnmpTrapReceiverUsers.getDeviceAddresses(
        device({
          hostname: "10.20.0.5",
          otherAddresses: "10.99.0.1, 2001:DB8::5, 10.20.0.5",
        }),
      ),
    ).toEqual(["10.20.0.5", "10.99.0.1", "2001:db8::5"]);

    expect(
      SnmpTrapReceiverUsers.getDeviceAddresses(
        device({ hostname: "switch-01.example.com", otherAddresses: null }),
      ),
    ).toEqual([]);
  });
});

describe("getUsersForProbe", () => {
  test("a probe with no SNMPv3 device reads nothing more", async () => {
    const findIds: ReturnType<typeof jest.spyOn> = mockLookups({ devices: [] });
    const findBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      NetworkDeviceService,
      "findBy",
    );

    expect(await SnmpTrapReceiverUsers.getUsersForProbe(PROBE)).toEqual([]);
    expect(findIds).toHaveBeenCalledWith({
      probeId: PROBE,
      limit: MAX_TRAP_RECEIVER_DEVICES,
    });
    expect(findBy).not.toHaveBeenCalled();
  });

  test("every layer's SNMPv3 user: the device's own, its profile's, its site's default", async () => {
    const withAll: NetworkDevice = device({
      ...V3_COLUMNS,
      hostname: "10.20.0.50",
      snmpCredentialProfileId: DEVICE_PROFILE,
      siteId: SITE,
    });
    const site: NetworkSite = new NetworkSite();
    site._id = SITE.toString();
    site.projectId = PROJECT;
    site.snmpCredentialProfileId = SITE_PROFILE;

    mockLookups({
      devices: [withAll],
      sites: [site],
      profiles: [
        profile(DEVICE_PROFILE, {
          ...V3_COLUMNS,
          snmpV3Username: "profile-user",
          snmpV3SecurityLevel: "authNoPriv",
        }),
        profile(SITE_PROFILE, {
          snmpVersion: "V3",
          snmpV3SecurityLevel: "noAuthNoPriv",
          snmpV3Username: "site-default",
        }),
      ],
    });

    const users: Array<SnmpTrapReceiverUser> =
      await SnmpTrapReceiverUsers.getUsersForProbe(PROBE);

    expect(
      users.map((user: SnmpTrapReceiverUser) => {
        return `${user.userName} ${user.securityLevel} ${user.addresses.join(",")}`;
      }),
    ).toEqual([
      "san-monitor authPriv 10.20.0.50",
      "profile-user authNoPriv 10.20.0.50",
      "site-default noAuthNoPriv 10.20.0.50",
    ]);
  });

  test("a device polled over v2c still hands over its site's SNMPv3 trap user", async () => {
    const v2cDevice: NetworkDevice = device({
      snmpVersion: "V2c",
      snmpCommunityString: "public",
      hostname: "10.20.0.60",
      siteId: SITE,
    });
    const site: NetworkSite = new NetworkSite();
    site._id = SITE.toString();
    site.projectId = PROJECT;
    site.snmpCredentialProfileId = SITE_PROFILE;

    mockLookups({
      devices: [v2cDevice],
      sites: [site],
      profiles: [
        profile(SITE_PROFILE, { ...V3_COLUMNS, snmpV3Username: "traps" }),
      ],
    });

    expect(
      (await SnmpTrapReceiverUsers.getUsersForProbe(PROBE)).map(
        (user: SnmpTrapReceiverUser) => {
          return user.userName;
        },
      ),
    ).toEqual(["traps"]);
  });

  test("another project's profile is never handed over, whatever points at it", async () => {
    mockLookups({
      devices: [
        device({
          snmpVersion: "V2c",
          snmpCommunityString: "public",
          snmpCredentialProfileId: FOREIGN_PROFILE,
        }),
      ],
      profiles: [
        profile(FOREIGN_PROFILE, {
          ...V3_COLUMNS,
          projectId: OTHER_PROJECT,
          snmpV3Username: "someone-elses",
        }),
      ],
    });

    expect(await SnmpTrapReceiverUsers.getUsersForProbe(PROBE)).toEqual([]);
  });

  test("the same credential on many devices is one user, at all their addresses", async () => {
    mockLookups({
      devices: [
        device({ ...V3_COLUMNS, hostname: "10.20.0.70" }),
        device({
          ...V3_COLUMNS,
          hostname: "10.20.0.71",
          otherAddresses: "10.99.0.71",
        }),
        device({
          ...V3_COLUMNS,
          hostname: "10.20.0.72",
          snmpV3PrivKey: "another",
        }),
      ],
    });

    const users: Array<SnmpTrapReceiverUser> =
      await SnmpTrapReceiverUsers.getUsersForProbe(PROBE);

    expect(users).toHaveLength(2);
    expect(users[0]!.addresses).toEqual([
      "10.20.0.70",
      "10.20.0.71",
      "10.99.0.71",
    ]);
    expect(users[1]!.privKey).toBe("another");
  });

  test("a failed profile lookup fails the answer: the probe keeps the users it has", async () => {
    mockLookups({
      devices: [
        device({ ...V3_COLUMNS, snmpCredentialProfileId: DEVICE_PROFILE }),
      ],
    });
    jest
      .spyOn(NetworkSnmpCredentialProfileService, "findBy")
      .mockRejectedValue(new Error("connection reset"));

    await expect(SnmpTrapReceiverUsers.getUsersForProbe(PROBE)).rejects.toThrow(
      "connection reset",
    );
  });

  test("devices are read in chunks, with the credential columns and their addresses", async () => {
    const devices: Array<NetworkDevice> = Array.from({ length: 1001 }, () => {
      return device(V3_COLUMNS);
    });
    mockLookups({ devices: devices });
    const findBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([]);

    await SnmpTrapReceiverUsers.getUsersForProbe(PROBE);

    expect(findBy).toHaveBeenCalledTimes(2);
    expect(
      (findBy.mock.calls[0]![0] as { select: Record<string, boolean> }).select,
    ).toMatchObject({
      ...NetworkDeviceHydrationUtil.snmpConfigSelect,
      otherAddresses: true,
    });
    expect(
      (findBy.mock.calls[0]![0] as { props: { isRoot: boolean } }).props,
    ).toEqual({ isRoot: true });
  });
});

test("resolveSnmpV3Carriers leaves out v2c rows and rows with no user name", async () => {
  jest
    .spyOn(NetworkSnmpCredentialProfileService, "findBy")
    .mockResolvedValue([
      profile(DEVICE_PROFILE, { snmpVersion: "V2c", snmpCommunityString: "x" }),
    ]);
  jest.spyOn(NetworkSiteService, "findBy").mockResolvedValue([]);

  const v3WithoutName: NetworkDevice = device({
    snmpVersion: "V3",
    snmpV3Username: "  ",
    snmpCredentialProfileId: DEVICE_PROFILE,
  });

  const carriers: Map<
    string,
    Array<SnmpConnectionCredentials>
  > = await NetworkDeviceHydrationUtil.resolveSnmpV3Carriers([v3WithoutName]);

  expect(carriers.get(v3WithoutName.id!.toString())).toEqual([]);
});
