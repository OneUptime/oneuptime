import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { IsBillingEnabled } from "../../../../Server/EnvironmentConfig";
import ProbeService from "../../../../Server/Services/ProbeService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../../Server/Types/Database/UpdateBy";
import XcpNgConnectionRules, {
  SavedXcpNgConnection,
  XCP_NG_CONNECTION_SETTING_COLUMNS,
  XcpNgConnectionChange,
  getRequiredSecretName,
} from "../../../../Server/Utils/XcpNg/XcpNgConnectionRules";
import Probe from "../../../../Models/DatabaseModels/Probe";
import XcpNgConnection from "../../../../Models/DatabaseModels/XcpNgConnection";
import ObjectID from "../../../../Types/ObjectID";
import XcpNgCollectionStatus from "../../../../Types/XcpNg/XcpNgCollectionStatus";
import XcpNgConnectionType from "../../../../Types/XcpNg/XcpNgConnectionType";

/*
 * The save rules of an XCP-ng connection (#10996, #10999) - what a create
 * and an update must carry for each kind, how they are normalized, where a
 * saved secret may go - and what is written once they are saved. A
 * vCenter's rules (VMwareVCenterConnection.test.ts), for both kinds.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7c0e9d1a-1111-4b2c-8d3e-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "7c0e9d1a-1111-4b2c-8d3e-000000000002",
);
const PROBE_ID: string = "4d1b9f52-7a0e-4f34-9a0b-2b7c3f1d0001";
const OTHER_PROBE_ID: string = "4d1b9f52-7a0e-4f34-9a0b-2b7c3f1d0002";
const GLOBAL_PROBE_ID: string = "4d1b9f52-7a0e-4f34-9a0b-2b7c3f1d0003";
const FOREIGN_PROBE_ID: string = "4d1b9f52-7a0e-4f34-9a0b-2b7c3f1d0004";
const CONNECTION_ID: string = "9e8d7c6b-2222-4a1b-9c0d-000000000001";
const USER_ID: ObjectID = new ObjectID("3a3a3a3a-3333-4c4c-8d8d-000000000001");

const FINGERPRINT_A: string =
  "AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA";
const FINGERPRINT_B: string = FINGERPRINT_A.replace(/A/g, "B");

type DataRecord = Record<string, unknown>;

function probeOf(id: string): Probe | null {
  const probe: Probe = new Probe();
  probe._id = id;

  if (id === PROBE_ID || id === OTHER_PROBE_ID) {
    probe.projectId = PROJECT_ID;
    probe.isGlobalProbe = false;
    return probe;
  }

  if (id === GLOBAL_PROBE_ID) {
    probe.isGlobalProbe = true;
    return probe;
  }

  if (id === FOREIGN_PROBE_ID) {
    probe.projectId = OTHER_PROJECT_ID;
    probe.isGlobalProbe = false;
    return probe;
  }

  return null;
}

function createBy(data: DataRecord): CreateBy<XcpNgConnection> {
  return {
    data: { projectId: PROJECT_ID, ...data } as unknown as XcpNgConnection,
    props: { tenantId: PROJECT_ID, userId: USER_ID },
  } as CreateBy<XcpNgConnection>;
}

function updateBy(data: DataRecord): UpdateBy<XcpNgConnection> {
  return {
    query: { _id: CONNECTION_ID },
    data: data,
    props: { tenantId: PROJECT_ID, userId: USER_ID },
  } as unknown as UpdateBy<XcpNgConnection>;
}

const NEW_XEN_ORCHESTRA: DataRecord = {
  connectionType: XcpNgConnectionType.XenOrchestra,
  address: "XO.example.com/v6/",
  openMetricsSecret: "  plugin-secret\n",
  apiToken: "token-value",
  collectionProbeId: new ObjectID(PROBE_ID),
};

const NEW_XAPI: DataRecord = {
  connectionType: XcpNgConnectionType.Xapi,
  address: "10.0.0.10",
  username: "  root ",
  password: " root password with spaces ",
  collectionProbeId: new ObjectID(PROBE_ID),
};

function savedXenOrchestra(
  overrides: SavedXcpNgConnection = {},
): SavedXcpNgConnection {
  return {
    _id: CONNECTION_ID,
    projectId: PROJECT_ID,
    connectionType: XcpNgConnectionType.XenOrchestra,
    address: "https://xo.example.com",
    isOpenMetricsSecretSet: true,
    isApiTokenSet: true,
    isPasswordSet: false,
    collectionProbeId: new ObjectID(PROBE_ID),
    trustedCertificateFingerprint: FINGERPRINT_A,
    ...overrides,
  };
}

function savedXapi(overrides: SavedXcpNgConnection = {}): SavedXcpNgConnection {
  return {
    _id: CONNECTION_ID,
    projectId: PROJECT_ID,
    connectionType: XcpNgConnectionType.Xapi,
    address: "https://10.0.0.10",
    username: "root",
    isOpenMetricsSecretSet: false,
    isApiTokenSet: false,
    isPasswordSet: true,
    collectionProbeId: new ObjectID(PROBE_ID),
    trustedCertificateFingerprint: FINGERPRINT_A,
    ...overrides,
  };
}

async function update(
  data: DataRecord,
  saved: SavedXcpNgConnection,
): Promise<{ change: XcpNgConnectionChange; data: DataRecord }> {
  const by: UpdateBy<XcpNgConnection> = updateBy(data);
  const changes: Array<XcpNgConnectionChange> =
    await XcpNgConnectionRules.prepareUpdate({ updateBy: by, saved: [saved] });

  expect(changes).toHaveLength(1);
  return { change: changes[0]!, data: by.data as unknown as DataRecord };
}

beforeEach(() => {
  jest.spyOn(ProbeService, "findOneById").mockImplementation((async (options: {
    id: ObjectID;
  }) => {
    return probeOf(options.id.toString());
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("XcpNgConnectionRules.isConnectionWrite", () => {
  test("is any write of a connection setting, never of its name alone", () => {
    for (const column of XCP_NG_CONNECTION_SETTING_COLUMNS) {
      expect(XcpNgConnectionRules.isConnectionWrite({ [column]: "x" })).toBe(
        true,
      );
    }
    expect(
      XcpNgConnectionRules.isConnectionWrite({
        name: "Renamed",
        description: "x",
      }),
    ).toBe(false);
    expect(XcpNgConnectionRules.isConnectionWrite(undefined)).toBe(false);
  });

  test("names each kind's secret as a person knows it", () => {
    expect(getRequiredSecretName(XcpNgConnectionType.XenOrchestra)).toBe(
      "the OpenMetrics secret",
    );
    expect(getRequiredSecretName(XcpNgConnectionType.Xapi)).toBe(
      "the XAPI password",
    );
  });
});

describe("XcpNgConnectionRules.prepareCreate", () => {
  test("normalizes a Xen Orchestra: its address, its secrets' stray spaces, its name", async () => {
    const by: CreateBy<XcpNgConnection> = createBy({ ...NEW_XEN_ORCHESTRA });
    const change: XcpNgConnectionChange =
      await XcpNgConnectionRules.prepareCreate(by);
    const data: DataRecord = by.data as unknown as DataRecord;

    expect(data["address"]).toBe("https://xo.example.com");
    expect(data["openMetricsSecret"]).toBe("plugin-secret");
    expect(data["name"]).toBe("xo.example.com");
    expect(change).toMatchObject({
      projectId: PROJECT_ID,
      isConnectionChanged: true,
      isCredentialChanged: true,
      isOpenMetricsSecretSet: true,
      isApiTokenSet: true,
      isPasswordSet: false,
    });
  });

  test("keeps a pool's password exactly as typed: spaces may be part of it", async () => {
    const by: CreateBy<XcpNgConnection> = createBy({ ...NEW_XAPI });
    const change: XcpNgConnectionChange =
      await XcpNgConnectionRules.prepareCreate(by);
    const data: DataRecord = by.data as unknown as DataRecord;

    expect(data["username"]).toBe("root");
    expect(data["password"]).toBe(" root password with spaces ");
    expect(data["address"]).toBe("https://10.0.0.10");
    expect(change).toMatchObject({
      isPasswordSet: true,
      isOpenMetricsSecretSet: false,
      isApiTokenSet: false,
    });
  });

  test("keeps a name that was typed", async () => {
    const by: CreateBy<XcpNgConnection> = createBy({
      ...NEW_XEN_ORCHESTRA,
      name: "Paris Xen Orchestra",
    });
    await XcpNgConnectionRules.prepareCreate(by);
    expect((by.data as unknown as DataRecord)["name"]).toBe(
      "Paris Xen Orchestra",
    );
  });

  test.each([
    ["no kind", { ...NEW_XEN_ORCHESTRA, connectionType: undefined }, "connectionType"],
    ["an unknown kind", { ...NEW_XEN_ORCHESTRA, connectionType: "Proxmox" }, "connectionType"],
    ["no address", { ...NEW_XEN_ORCHESTRA, address: undefined }, "address"],
    ["an http address", { ...NEW_XEN_ORCHESTRA, address: "http://xo.example.com" }, "https://"],
    ["no secret", { ...NEW_XEN_ORCHESTRA, openMetricsSecret: "" }, "OpenMetrics"],
    ["an XAPI account on a Xen Orchestra", { ...NEW_XEN_ORCHESTRA, password: "x" }, "no XAPI account"],
    ["a Xen Orchestra secret on a pool", { ...NEW_XAPI, apiToken: "x" }, "no Xen Orchestra secret"],
    ["a pool with no user name", { ...NEW_XAPI, username: "" }, "user name"],
    ["a pool with no password", { ...NEW_XAPI, password: "" }, "password"],
    ["no probe", { ...NEW_XAPI, collectionProbeId: undefined }, "probe"],
    ["a probe that does not exist", { ...NEW_XAPI, collectionProbeId: new ObjectID("4d1b9f52-7a0e-4f34-9a0b-2b7c3f1d0999") }, "Probe not found"],
    ["another project's probe", { ...NEW_XAPI, collectionProbeId: new ObjectID(FOREIGN_PROBE_ID) }, "another project"],
    ["a bad fingerprint", { ...NEW_XAPI, trustedCertificateFingerprint: "AB:CD" }, "SHA-256"],
    ["an interval out of bounds", { ...NEW_XAPI, collectionIntervalInMinutes: 0 }, "1 to 60"],
    ["a secret too long", { ...NEW_XEN_ORCHESTRA, openMetricsSecret: "x".repeat(1025) }, "at most"],
  ])("refuses %s", async (_name: string, data: DataRecord, words: string) => {
    await expect(
      XcpNgConnectionRules.prepareCreate(createBy(data)),
    ).rejects.toThrow(words);
  });

  test("lets a shared probe read secrets only where it is the instance's own", async () => {
    const by: CreateBy<XcpNgConnection> = createBy({
      ...NEW_XAPI,
      collectionProbeId: new ObjectID(GLOBAL_PROBE_ID),
    });

    if (IsBillingEnabled) {
      await expect(XcpNgConnectionRules.prepareCreate(by)).rejects.toThrow(
        "Shared probes",
      );
    } else {
      await expect(
        XcpNgConnectionRules.prepareCreate(by),
      ).resolves.toBeTruthy();
    }
  });
});

describe("XcpNgConnectionRules.prepareUpdate", () => {
  test("does nothing for a write of the name alone", async () => {
    expect(
      await XcpNgConnectionRules.prepareUpdate({
        updateBy: updateBy({ name: "Renamed" }),
        saved: [savedXenOrchestra()],
      }),
    ).toEqual([]);
  });

  test("keeps the saved secrets for an empty field: the edit form sends one", async () => {
    const { change, data } = await update(
      { openMetricsSecret: "", apiToken: "", collectionIntervalInMinutes: 5 },
      savedXenOrchestra(),
    );

    expect(data["openMetricsSecret"]).toBeUndefined();
    expect(data["apiToken"]).toBeUndefined();
    expect(change.isOpenMetricsSecretSet).toBeNull();
    expect(change.isApiTokenSet).toBeNull();
    // Only the interval: nothing for the probe to try again.
    expect(change.isConnectionChanged).toBe(false);
  });

  test("clears the API token for null, the one secret a connection may go without", async () => {
    const { change, data } = await update(
      { apiToken: null },
      savedXenOrchestra(),
    );

    expect(data["apiToken"]).toBeNull();
    expect(change.isApiTokenSet).toBe(false);
    expect(change.isCredentialChanged).toBe(true);
  });

  test("never changes what a connection reads", async () => {
    await expect(
      update({ connectionType: XcpNgConnectionType.Xapi }, savedXenOrchestra()),
    ).rejects.toThrow("reads what it was made for");
  });

  test("asks for the secret again before sending it to another address", async () => {
    await expect(
      update({ address: "https://evil.example.com" }, savedXenOrchestra()),
    ).rejects.toThrow("Enter the OpenMetrics secret again");
    await expect(
      update({ address: "https://10.0.0.99" }, savedXapi()),
    ).rejects.toThrow("Enter the XAPI password again");
  });

  test("asks for it again before sending it through another probe or to another certificate", async () => {
    await expect(
      update(
        { collectionProbeId: new ObjectID(OTHER_PROBE_ID) },
        savedXenOrchestra(),
      ),
    ).rejects.toThrow("probe");
    await expect(
      update({ trustedCertificateFingerprint: FINGERPRINT_B }, savedXapi()),
    ).rejects.toThrow("certificate");
  });

  test("moves when the secret is entered again, and forgets a saved token it was not", async () => {
    const { change, data } = await update(
      {
        address: "https://xo2.example.com",
        openMetricsSecret: "new-plugin-secret",
      },
      savedXenOrchestra(),
    );

    expect(data["address"]).toBe("https://xo2.example.com");
    // The token was entered for the old address: it never goes to the new one.
    expect(data["apiToken"]).toBeNull();
    expect(change.isApiTokenSet).toBe(false);
    expect(change.isAddressChanged).toBe(true);
    expect(change.isConnectionChanged).toBe(true);
  });

  test("trusts the very certificate the probe found without asking for the secret again", async () => {
    const { change } = await update(
      { trustedCertificateFingerprint: FINGERPRINT_B },
      savedXapi({
        trustedCertificateFingerprint: undefined,
        presentedCertificate: {
          fingerprint256: FINGERPRINT_B.toLowerCase().replace(/:/g, ""),
        },
      }),
    );

    expect(change.isConnectionChanged).toBe(true);
    // Trusting it keeps a saved token too: it is the same place.
    expect(change.isApiTokenSet).toBeNull();
  });

  test("keeps the saved secrets when only publicly trusted certificates are accepted from now on", async () => {
    const { change } = await update(
      { trustedCertificateFingerprint: "" },
      savedXenOrchestra(),
    );

    expect(change.isConnectionChanged).toBe(true);
    expect(change.isApiTokenSet).toBe(false);
  });

  test("tries again with a new password or user name", async () => {
    const withPassword: { change: XcpNgConnectionChange } = await update(
      { password: "new" },
      savedXapi(),
    );
    expect(withPassword.change).toMatchObject({
      isPasswordSet: true,
      isCredentialChanged: true,
      isConnectionChanged: true,
    });

    const withUser: { change: XcpNgConnectionChange } = await update(
      { username: "EXAMPLE\\oneuptime" },
      savedXapi(),
    );
    expect(withUser.change.isCredentialChanged).toBe(true);
    expect(withUser.change.isConnectionChanged).toBe(true);
  });

  test("refuses another kind's secrets on an update", async () => {
    await expect(
      update({ openMetricsSecret: "x" }, savedXapi()),
    ).rejects.toThrow("no Xen Orchestra secret");
    await expect(
      update({ password: "x" }, savedXenOrchestra()),
    ).rejects.toThrow("no XAPI account");
  });

  test("changes one connection at a time", async () => {
    await expect(
      XcpNgConnectionRules.prepareUpdate({
        updateBy: updateBy({ address: "https://xo.example.com" }),
        saved: [savedXenOrchestra(), savedXenOrchestra()],
      }),
    ).rejects.toThrow("one XCP-ng connection at a time");
  });
});

describe("XcpNgConnectionRules.afterWrite", () => {
  async function written(change: XcpNgConnectionChange): Promise<
    Array<{ values: DataRecord; bumpSettingsVersion: boolean }>
  > {
    const writes: Array<{ values: DataRecord; bumpSettingsVersion: boolean }> =
      [];
    await XcpNgConnectionRules.afterWrite({
      change: change,
      writeServerColumns: async (write: {
        xcpNgConnectionId: ObjectID;
        values: DataRecord;
        bumpSettingsVersion: boolean;
      }): Promise<void> => {
        writes.push({
          values: write.values,
          bumpSettingsVersion: write.bumpSettingsVersion,
        });
      },
    });
    return writes;
  }

  const base: XcpNgConnectionChange = {
    xcpNgConnectionId: new ObjectID(CONNECTION_ID),
    projectId: PROJECT_ID,
    isConnectionChanged: false,
    isCredentialChanged: false,
    isOpenMetricsSecretSet: null,
    isApiTokenSet: null,
    isPasswordSet: null,
    isAddressChanged: false,
  };

  test("a changed connection is read at once with its new settings, and its old outcome forgotten", async () => {
    const writes: Array<{ values: DataRecord; bumpSettingsVersion: boolean }> =
      await written({ ...base, isConnectionChanged: true });

    expect(writes).toHaveLength(1);
    expect(writes[0]!.bumpSettingsVersion).toBe(true);
    expect(writes[0]!.values).toMatchObject({
      collectionStatus: XcpNgCollectionStatus.Pending,
      collectionErrorCode: null,
      collectionError: null,
      presentedCertificate: null,
    });
    expect(writes[0]!.values["nextCollectionAt"]).toBeInstanceOf(Date);
  });

  test("another address forgets what was learned of the old one", async () => {
    const writes: Array<{ values: DataRecord; bumpSettingsVersion: boolean }> =
      await written({
        ...base,
        isConnectionChanged: true,
        isAddressChanged: true,
      });

    expect(writes[0]!.values).toMatchObject({
      xapiPoolId: null,
      xapiMasterAddress: null,
      xapiPoolHosts: null,
      messageWatermark: null,
      xapiAccountKind: null,
    });
  });

  test("a new or removed token's expiry is read again", async () => {
    const writes: Array<{ values: DataRecord; bumpSettingsVersion: boolean }> =
      await written({
        ...base,
        isApiTokenSet: true,
        isCredentialChanged: true,
        isConnectionChanged: true,
      });

    expect(writes[0]!.values).toMatchObject({
      isApiTokenSet: true,
      apiTokenExpiresAt: null,
      apiTokenExpiryWarnedAt: null,
    });
    expect(writes[0]!.values["credentialsUpdatedAt"]).toBeInstanceOf(Date);
  });

  test("writes nothing for a change that changed nothing", async () => {
    expect(await written(base)).toEqual([]);
    expect(
      await written({ ...base, xcpNgConnectionId: null, isConnectionChanged: true }),
    ).toEqual([]);
  });
});
