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
import VMwareVCenterFeedService from "../../../../Server/Services/VMwareVCenterFeedService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../../Server/Types/Database/UpdateBy";
import VMwareVCenterConnection, {
  VMWARE_CONNECTION_SAVED_SELECT,
  VMWARE_CONNECTION_SETTING_COLUMNS,
  VMwareConnectionChange,
} from "../../../../Server/Utils/VMware/VMwareVCenterConnection";
import Probe from "../../../../Models/DatabaseModels/Probe";
import VMwareVCenter from "../../../../Models/DatabaseModels/VMwareVCenter";
import { VMwareVCenterFeedEventType } from "../../../../Models/DatabaseModels/VMwareVCenterFeed";
import { Blue500, Gray500, Yellow500 } from "../../../../Types/BrandColors";
import ObjectID from "../../../../Types/ObjectID";
import VMwareCollectionMethod from "../../../../Types/VMware/VMwareCollectionMethod";
import VMwareCollectionStatus from "../../../../Types/VMware/VMwareCollectionStatus";

/*
 * The save rules of a vCenter's probe collection settings - what a create
 * and an update must carry, how they are normalized, where a saved password
 * may go - and what is written once they are saved.
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
const VCENTER_ID: string = "9e8d7c6b-2222-4a1b-9c0d-000000000001";
const USER_ID: ObjectID = new ObjectID("3a3a3a3a-3333-4c4c-8d8d-000000000001");

const FINGERPRINT_A: string =
  "AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA";
const FINGERPRINT_B: string = FINGERPRINT_A.replace(/A/g, "B");

type DataRecord = Record<string, unknown>;

interface SavedRow {
  _id?: string | undefined;
  projectId?: ObjectID | undefined;
  collectionMethod?: VMwareCollectionMethod | undefined;
  vcenterUrl?: string | undefined;
  vcenterUsername?: string | undefined;
  isVCenterPasswordSet?: boolean | undefined;
  collectionProbeId?: ObjectID | undefined;
  trustedCertificateFingerprint?: string | undefined;
  presentedCertificate?: { fingerprint256?: string | undefined } | undefined;
}

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

function createBy(data: DataRecord): CreateBy<VMwareVCenter> {
  return {
    data: { projectId: PROJECT_ID, ...data } as unknown as VMwareVCenter,
    props: { tenantId: PROJECT_ID, userId: USER_ID },
  } as CreateBy<VMwareVCenter>;
}

function updateBy(data: DataRecord): UpdateBy<VMwareVCenter> {
  return {
    query: { _id: VCENTER_ID },
    data: data,
    props: { tenantId: PROJECT_ID, userId: USER_ID },
  } as unknown as UpdateBy<VMwareVCenter>;
}

function probeVCenter(overrides: SavedRow = {}): SavedRow {
  return {
    _id: VCENTER_ID,
    projectId: PROJECT_ID,
    collectionMethod: VMwareCollectionMethod.Probe,
    vcenterUrl: "https://vcsa.example.com",
    vcenterUsername: "oneuptime@vsphere.local",
    isVCenterPasswordSet: true,
    collectionProbeId: new ObjectID(PROBE_ID),
    ...overrides,
  };
}

function agentVCenter(overrides: SavedRow = {}): SavedRow {
  return {
    _id: VCENTER_ID,
    projectId: PROJECT_ID,
    collectionMethod: VMwareCollectionMethod.Agent,
    isVCenterPasswordSet: false,
    ...overrides,
  };
}

async function update(
  data: DataRecord,
  saved: SavedRow,
): Promise<{ change: VMwareConnectionChange; data: DataRecord }> {
  const by: UpdateBy<VMwareVCenter> = updateBy(data);
  const changes: Array<VMwareConnectionChange> =
    await VMwareVCenterConnection.prepareUpdate({
      updateBy: by,
      saved: [saved],
    });

  expect(changes).toHaveLength(1);
  return { change: changes[0]!, data: by.data as unknown as DataRecord };
}

const COMPLETE_PROBE_SETTINGS: DataRecord = {
  collectionMethod: VMwareCollectionMethod.Probe,
  vcenterUrl: "vcsa.example.com/ui/",
  vcenterUsername: "  oneuptime@vsphere.local  ",
  vcenterPassword: "secret",
  collectionProbeId: new ObjectID(PROBE_ID),
};

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

describe("VMwareVCenterConnection.isConnectionWrite", () => {
  test("is any write of a probe collection setting", () => {
    expect(VMWARE_CONNECTION_SETTING_COLUMNS).toEqual([
      "collectionMethod",
      "vcenterUrl",
      "vcenterUsername",
      "vcenterPassword",
      "collectionProbeId",
      "collectionProbe",
      "trustedCertificateFingerprint",
      "collectionIntervalInMinutes",
    ]);

    for (const column of VMWARE_CONNECTION_SETTING_COLUMNS) {
      expect(
        VMwareVCenterConnection.isConnectionWrite({ [column]: null }),
      ).toBe(true);
    }

    expect(VMwareVCenterConnection.isConnectionWrite({ name: "x" })).toBe(
      false,
    );
    expect(VMwareVCenterConnection.isConnectionWrite(undefined)).toBe(false);
  });

  test("the saved row is read with everything the password rule compares", () => {
    expect(Object.keys(VMWARE_CONNECTION_SAVED_SELECT).sort()).toEqual(
      [
        "_id",
        "collectionMethod",
        "collectionProbeId",
        "isVCenterPasswordSet",
        "presentedCertificate",
        "projectId",
        "trustedCertificateFingerprint",
        "vcenterUrl",
        "vcenterUsername",
      ].sort(),
    );
  });
});

describe("VMwareVCenterConnection.prepareCreate", () => {
  test("a vCenter registered without collection settings is left alone", async () => {
    const by: CreateBy<VMwareVCenter> = createBy({ name: "Lab" });

    expect(await VMwareVCenterConnection.prepareCreate(by)).toBeNull();
    expect(
      (by.data as unknown as DataRecord)["collectionMethod"],
    ).toBeUndefined();
  });

  test("an agent vCenter keeps no password, and the probe has nothing to do", async () => {
    const by: CreateBy<VMwareVCenter> = createBy({
      collectionMethod: VMwareCollectionMethod.Agent,
      vcenterUrl: "vcsa.example.com",
      vcenterPassword: "",
    });

    const change: VMwareConnectionChange | null =
      await VMwareVCenterConnection.prepareCreate(by);
    const data: DataRecord = by.data as unknown as DataRecord;

    expect(change).toMatchObject({
      isConnectionChanged: false,
      isCredentialChanged: false,
      isPasswordSet: false,
      isSwitchedToAgent: false,
      feedLines: [],
      feedColor: Gray500,
    });
    expect(data["vcenterPassword"]).toBeUndefined();
    expect(data["vcenterUrl"]).toBe("https://vcsa.example.com");
  });

  test("an agent vCenter is refused a password", async () => {
    await expect(
      VMwareVCenterConnection.prepareCreate(
        createBy({ vcenterPassword: "secret" }),
      ),
    ).rejects.toThrow(
      "A password is only saved for a vCenter a probe collects. Set the collection method to Probe, or leave the password out.",
    );
  });

  test("a probe vCenter is normalized, named after its address, and collected at once", async () => {
    const by: CreateBy<VMwareVCenter> = createBy({
      ...COMPLETE_PROBE_SETTINGS,
      trustedCertificateFingerprint: FINGERPRINT_A.replace(
        /:/g,
        "",
      ).toLowerCase(),
      collectionIntervalInMinutes: "5",
    });

    const change: VMwareConnectionChange | null =
      await VMwareVCenterConnection.prepareCreate(by);
    const data: DataRecord = by.data as unknown as DataRecord;

    expect(data).toMatchObject({
      name: "vcsa.example.com",
      collectionMethod: VMwareCollectionMethod.Probe,
      vcenterUrl: "https://vcsa.example.com",
      vcenterUsername: "oneuptime@vsphere.local",
      vcenterPassword: "secret",
      trustedCertificateFingerprint: FINGERPRINT_A,
      collectionIntervalInMinutes: 5,
    });
    expect(data["collectionProbeId"]!.toString()).toBe(PROBE_ID);

    expect(change).toMatchObject({
      vmwareVCenterId: null,
      projectId: PROJECT_ID,
      isConnectionChanged: true,
      isCredentialChanged: true,
      isPasswordSet: true,
      isSwitchedToAgent: false,
      feedColor: Blue500,
    });
    expect(change!.feedLines.map(String)).toEqual([
      "It is collected by a OneUptime probe from `https://vcsa.example.com`, as `oneuptime@vsphere.local`.",
    ]);
  });

  test("a name someone typed is kept; the probe may come as a relation", async () => {
    const by: CreateBy<VMwareVCenter> = createBy({
      ...COMPLETE_PROBE_SETTINGS,
      collectionProbeId: undefined,
      collectionProbe: { _id: PROBE_ID },
      name: "Production",
    });

    await VMwareVCenterConnection.prepareCreate(by);

    const data: DataRecord = by.data as unknown as DataRecord;
    expect(data["name"]).toBe("Production");
    expect(data["collectionProbeId"]!.toString()).toBe(PROBE_ID);
  });

  test.each([
    [
      "no address",
      { vcenterUrl: undefined } as DataRecord,
      "Enter vCenter's address, such as https://vcsa.example.com.",
    ],
    [
      "no user name",
      { vcenterUsername: "   " } as DataRecord,
      "Enter the vCenter user name, such as oneuptime@vsphere.local.",
    ],
    [
      "no password",
      { vcenterPassword: "" } as DataRecord,
      "Enter the vCenter password.",
    ],
    [
      "no probe",
      { collectionProbeId: undefined } as DataRecord,
      "Pick the probe that collects this vCenter: one in a network that can reach vCenter on TCP 443.",
    ],
    [
      "plain http",
      { vcenterUrl: "http://vcsa.example.com" } as DataRecord,
      "Use https://. vCenter serves its API over HTTPS only, and OneUptime never sends a password unencrypted.",
    ],
    [
      "the cloud metadata address",
      { vcenterUrl: "https://169.254.169.254" } as DataRecord,
      "OneUptime does not connect to loopback, link-local or cloud metadata addresses. Enter vCenter's own host name or IP address.",
    ],
    [
      "a user name over 256 characters",
      { vcenterUsername: "u".repeat(257) } as DataRecord,
      "The vCenter user name may be at most 256 characters.",
    ],
    [
      "a password over 256 characters",
      { vcenterPassword: "p".repeat(257) } as DataRecord,
      "The vCenter password may be at most 256 characters.",
    ],
    [
      "a fingerprint that is not SHA-256",
      { trustedCertificateFingerprint: "AB:CD" } as DataRecord,
      "The trusted certificate fingerprint must be a SHA-256 fingerprint: 64 hexadecimal characters, such as AB:CD:EF:... .",
    ],
    [
      "an interval of 0",
      { collectionIntervalInMinutes: 0 } as DataRecord,
      "Collect every 1 to 60 minutes, in whole minutes.",
    ],
    [
      "an interval that is not a number",
      { collectionIntervalInMinutes: "often" } as DataRecord,
      "Collect every 1 to 60 minutes, in whole minutes.",
    ],
  ])(
    "refuses %s",
    async (_name: string, overrides: DataRecord, message: string) => {
      await expect(
        VMwareVCenterConnection.prepareCreate(
          createBy({ ...COMPLETE_PROBE_SETTINGS, ...overrides }),
        ),
      ).rejects.toThrow(message);
    },
  );

  test("another project's probe is answered like one that does not exist would be - refused", async () => {
    await expect(
      VMwareVCenterConnection.prepareCreate(
        createBy({
          ...COMPLETE_PROBE_SETTINGS,
          collectionProbeId: new ObjectID(FOREIGN_PROBE_ID),
        }),
      ),
    ).rejects.toThrow(
      "This probe belongs to another project. Pick one of this project's probes.",
    );

    await expect(
      VMwareVCenterConnection.prepareCreate(
        createBy({
          ...COMPLETE_PROBE_SETTINGS,
          collectionProbeId: new ObjectID(
            "4d1b9f52-7a0e-4f34-9a0b-2b7c3f1d0999",
          ),
        }),
      ),
    ).rejects.toThrow("Probe not found. Pick one of this project's probes.");
  });

  test("a global probe: refused on OneUptime Cloud, the instance's own on a self-hosted install", async () => {
    const attempt: Promise<VMwareConnectionChange | null> =
      VMwareVCenterConnection.prepareCreate(
        createBy({
          ...COMPLETE_PROBE_SETTINGS,
          collectionProbeId: new ObjectID(GLOBAL_PROBE_ID),
        }),
      );

    if (IsBillingEnabled) {
      await expect(attempt).rejects.toThrow(
        "Pick a probe of your own. OneUptime's shared probes never receive vCenter passwords - add a probe in vCenter's network and pick it here.",
      );
    } else {
      await expect(attempt).resolves.toMatchObject({ isPasswordSet: true });
    }
  });
});

describe("VMwareVCenterConnection.prepareUpdate", () => {
  test("an update of no collection setting decides nothing", async () => {
    expect(
      await VMwareVCenterConnection.prepareUpdate({
        updateBy: updateBy({ name: "x" }),
        saved: [probeVCenter()],
      }),
    ).toEqual([]);
  });

  test("settings change one vCenter at a time", async () => {
    await expect(
      VMwareVCenterConnection.prepareUpdate({
        updateBy: updateBy({ vcenterUsername: "x" }),
        saved: [
          probeVCenter(),
          probeVCenter({ _id: "9e8d7c6b-2222-4a1b-9c0d-000000000002" }),
        ],
      }),
    ).rejects.toThrow(
      "Change the collection settings of one vCenter at a time.",
    );
  });

  test("a collection method that is not one is refused", async () => {
    await expect(
      update({ collectionMethod: "Telepathy" }, probeVCenter()),
    ).rejects.toThrow("Collection method must be one of Agent, Probe.");
  });

  test("switching an agent vCenter to a probe needs everything, and says to stop the agent", async () => {
    await expect(
      update(
        {
          collectionMethod: VMwareCollectionMethod.Probe,
          vcenterUrl: "vcsa.example.com",
          vcenterUsername: "oneuptime@vsphere.local",
          collectionProbeId: new ObjectID(PROBE_ID),
        },
        agentVCenter(),
      ),
    ).rejects.toThrow("Enter the vCenter password.");

    const { change } = await update(
      {
        collectionMethod: VMwareCollectionMethod.Probe,
        vcenterUrl: "vcsa.example.com",
        vcenterUsername: "oneuptime@vsphere.local",
        vcenterPassword: "secret",
        collectionProbeId: new ObjectID(PROBE_ID),
      },
      agentVCenter(),
    );

    expect(change).toMatchObject({
      vmwareVCenterId: new ObjectID(VCENTER_ID),
      isConnectionChanged: true,
      isCredentialChanged: true,
      isPasswordSet: true,
      feedColor: Blue500,
    });
    expect(change.feedLines.map(String)).toEqual([
      "It is now collected by a OneUptime probe from `https://vcsa.example.com`, instead of the VMware agent. Stop the agent once the first collection succeeds, or every metric arrives twice.",
    ]);
  });

  test("switching to the agent forgets the password and the probe's status", async () => {
    const { change, data } = await update(
      { collectionMethod: VMwareCollectionMethod.Agent },
      probeVCenter(),
    );

    expect(data["vcenterPassword"]).toBeNull();
    expect(change).toMatchObject({
      isSwitchedToAgent: true,
      isPasswordSet: false,
      isCredentialChanged: true,
      feedColor: Yellow500,
    });
    expect(change.feedLines.map(String)).toEqual([
      "Its data now comes from the VMware agent. OneUptime forgot the saved vCenter password, and its probe stopped collecting.",
    ]);
  });

  test("an agent vCenter is refused a password on update too", async () => {
    await expect(
      update({ vcenterPassword: "secret" }, agentVCenter()),
    ).rejects.toThrow(
      "A password is only saved for a vCenter a probe collects.",
    );
  });

  test("an empty password keeps the saved one - it never clears it", async () => {
    const { change, data } = await update(
      { vcenterPassword: "", collectionIntervalInMinutes: 10 },
      probeVCenter(),
    );

    expect("vcenterPassword" in data).toBe(false);
    expect(change).toMatchObject({
      isPasswordSet: null,
      isCredentialChanged: false,
      isConnectionChanged: false,
    });
    expect(change.feedLines.map(String)).toEqual([
      "It is collected every 10 minutes now.",
    ]);
  });

  test("a new password is a credential change the probe tries at once", async () => {
    const { change } = await update({ vcenterPassword: "new" }, probeVCenter());

    expect(change).toMatchObject({
      isPasswordSet: true,
      isCredentialChanged: true,
      isConnectionChanged: true,
    });
    expect(change.feedLines.map(String)).toEqual([
      "Its vCenter password changed.",
    ]);
  });

  test("a new user name keeps the saved password, and says whose account it is now", async () => {
    const { change } = await update(
      { vcenterUsername: "monitor@vsphere.local" },
      probeVCenter(),
    );

    expect(change.isCredentialChanged).toBe(true);
    expect(change.isPasswordSet).toBeNull();
    expect(change.feedLines.map(String)).toEqual([
      "Its vCenter account changed to `monitor@vsphere.local`.",
    ]);
  });

  test("the saved password is never sent to another address", async () => {
    await expect(
      update({ vcenterUrl: "https://attacker.example.com" }, probeVCenter()),
    ).rejects.toThrow(
      "Enter the password again: a saved password is only sent to the vCenter address it was entered for.",
    );

    // Spelled differently, the same address keeps it.
    const { change } = await update(
      { vcenterUrl: "VCSA.example.com:443/ui" },
      probeVCenter(),
    );
    expect(change.isConnectionChanged).toBe(false);

    // With the password typed again, the address may change.
    const moved: { change: VMwareConnectionChange } = await update(
      { vcenterUrl: "https://vcsa-2.example.com", vcenterPassword: "secret" },
      probeVCenter(),
    );
    expect(moved.change.feedLines.map(String)).toEqual([
      "Its address changed to `https://vcsa-2.example.com`.",
      "Its vCenter password changed.",
    ]);
  });

  test("the saved password is never handed to another probe", async () => {
    await expect(
      update(
        { collectionProbeId: new ObjectID(OTHER_PROBE_ID) },
        probeVCenter(),
      ),
    ).rejects.toThrow(
      "Enter the password again: a saved password is only sent through the probe it was entered for.",
    );

    const { change } = await update(
      { collectionProbe: { _id: OTHER_PROBE_ID }, vcenterPassword: "secret" },
      probeVCenter(),
    );
    expect(change.feedLines.map(String)).toContain(
      "Another probe collects it now.",
    );
  });

  test("the saved password is never sent to a certificate someone chose", async () => {
    await expect(
      update({ trustedCertificateFingerprint: FINGERPRINT_A }, probeVCenter()),
    ).rejects.toThrow(
      "Enter the password again: a saved password is only sent to the certificate that was trusted when it was entered.",
    );
  });

  test("trusting exactly the certificate the probe found there keeps it - that is 'Trust this certificate'", async () => {
    const { change, data } = await update(
      { trustedCertificateFingerprint: FINGERPRINT_A.toLowerCase() },
      probeVCenter({ presentedCertificate: { fingerprint256: FINGERPRINT_A } }),
    );

    expect(data["trustedCertificateFingerprint"]).toBe(FINGERPRINT_A);
    expect(change.isConnectionChanged).toBe(true);
    expect(change.feedLines.map(String)).toEqual([
      `The certificate with SHA-256 fingerprint \`${FINGERPRINT_A}\` is trusted for it now.`,
    ]);

    // Not when the address moves with it.
    await expect(
      update(
        {
          trustedCertificateFingerprint: FINGERPRINT_A,
          vcenterUrl: "https://vcsa-2.example.com",
        },
        probeVCenter({
          presentedCertificate: { fingerprint256: FINGERPRINT_A },
        }),
      ),
    ).rejects.toThrow("only sent to the vCenter address it was entered for");

    // Nor a certificate other than the one presented.
    await expect(
      update(
        { trustedCertificateFingerprint: FINGERPRINT_B },
        probeVCenter({
          presentedCertificate: { fingerprint256: FINGERPRINT_A },
        }),
      ),
    ).rejects.toThrow("only sent to the certificate that was trusted");
  });

  test("dropping a trusted certificate is stricter, and keeps the password", async () => {
    const { change, data } = await update(
      { trustedCertificateFingerprint: "" },
      probeVCenter({ trustedCertificateFingerprint: FINGERPRINT_A }),
    );

    expect(data["trustedCertificateFingerprint"]).toBeNull();
    expect(change.feedLines.map(String)).toEqual([
      "It no longer trusts a certificate of its own: vCenter's certificate must come from an authority the probe trusts.",
    ]);
  });

  test("a probe-collected vCenter without a saved password needs one with any change", async () => {
    await expect(
      update(
        { collectionIntervalInMinutes: 5 },
        probeVCenter({ isVCenterPasswordSet: false }),
      ),
    ).rejects.toThrow("Enter the vCenter password.");
  });

  test("a probe the project may not use is refused on update too", async () => {
    await expect(
      update(
        {
          collectionProbeId: new ObjectID(FOREIGN_PROBE_ID),
          vcenterPassword: "secret",
        },
        probeVCenter(),
      ),
    ).rejects.toThrow("This probe belongs to another project.");
  });

  test("a row that does not match changes nothing", async () => {
    expect(
      await VMwareVCenterConnection.prepareUpdate({
        updateBy: updateBy({ vcenterUsername: "x" }),
        saved: [],
      }),
    ).toEqual([]);
  });
});

describe("VMwareVCenterConnection.afterWrite", () => {
  interface Written {
    vmwareVCenterId: ObjectID;
    values: DataRecord;
    bumpSettingsVersion: boolean;
  }

  function change(
    overrides: Partial<VMwareConnectionChange>,
  ): VMwareConnectionChange {
    return {
      vmwareVCenterId: new ObjectID(VCENTER_ID),
      projectId: PROJECT_ID,
      isConnectionChanged: false,
      isCredentialChanged: false,
      isPasswordSet: null,
      isSwitchedToAgent: false,
      feedLines: [],
      feedColor: Gray500,
      ...overrides,
    };
  }

  async function run(value: VMwareConnectionChange): Promise<Array<Written>> {
    const written: Array<Written> = [];

    await VMwareVCenterConnection.afterWrite({
      change: value,
      userId: USER_ID,
      writeServerColumns: async (write: Written): Promise<void> => {
        written.push(write);
      },
    });

    return written;
  }

  test("a changed connection is collected at once with the new settings, its old verdict cleared", async () => {
    const feed: ReturnType<typeof jest.spyOn> = jest
      .spyOn(VMwareVCenterFeedService, "createVMwareVCenterFeedItem")
      .mockResolvedValue(undefined as never);

    const written: Array<Written> = await run(
      change({
        isConnectionChanged: true,
        isCredentialChanged: true,
        isPasswordSet: true,
        feedLines: [],
      }),
    );

    expect(written).toHaveLength(1);
    expect(written[0]!.bumpSettingsVersion).toBe(true);
    expect(written[0]!.values).toMatchObject({
      isVCenterPasswordSet: true,
      collectionStatus: VMwareCollectionStatus.Pending,
      collectionErrorCode: null,
      collectionError: null,
      presentedCertificate: null,
    });
    expect(written[0]!.values["vcenterCredentialsUpdatedAt"]).toBeInstanceOf(
      Date,
    );
    expect(written[0]!.values["nextCollectionAt"]).toBeInstanceOf(Date);
    // No lines, no feed item.
    expect(feed).not.toHaveBeenCalled();
  });

  test("switching to the agent forgets the probe's verdict and schedule", async () => {
    const written: Array<Written> = await run(
      change({
        isSwitchedToAgent: true,
        isPasswordSet: false,
        isCredentialChanged: true,
      }),
    );

    expect(written[0]!.bumpSettingsVersion).toBe(true);
    expect(written[0]!.values).toMatchObject({
      isVCenterPasswordSet: false,
      collectionStatus: null,
      collectionErrorCode: null,
      collectionError: null,
      presentedCertificate: null,
      nextCollectionAt: null,
    });
  });

  test("an interval change alone keeps the verdict and the version, and writes nothing", async () => {
    jest
      .spyOn(VMwareVCenterFeedService, "createVMwareVCenterFeedItem")
      .mockResolvedValue(undefined as never);

    expect(await run(change({}))).toEqual([]);
  });

  test("says on the feed what changed, and who changed it", async () => {
    const feed: ReturnType<typeof jest.spyOn> = jest
      .spyOn(VMwareVCenterFeedService, "createVMwareVCenterFeedItem")
      .mockResolvedValue(undefined as never);

    const { change: decided } = await update(
      { vcenterPassword: "new", collectionIntervalInMinutes: 10 },
      probeVCenter(),
    );
    await run(decided);

    expect(feed).toHaveBeenCalledTimes(1);
    expect(feed.mock.calls[0]![0]).toEqual({
      vmwareVCenterId: new ObjectID(VCENTER_ID),
      projectId: PROJECT_ID,
      vmwareVCenterFeedEventType:
        VMwareVCenterFeedEventType.VMwareVCenterUpdated,
      displayColor: Gray500,
      feedInfoInMarkdown:
        "🔌 Data collection changed. Its vCenter password changed. It is collected every 10 minutes now.",
      userId: USER_ID,
    });
  });

  test("nothing is written for a change that names no vCenter", async () => {
    expect(
      await run(change({ vmwareVCenterId: null, isConnectionChanged: true })),
    ).toEqual([]);
  });

  test("a failed write fails the save, so it is never mistaken for one that worked", async () => {
    await expect(
      VMwareVCenterConnection.afterWrite({
        change: change({ isConnectionChanged: true }),
        writeServerColumns: async (): Promise<void> => {
          throw new Error("database is gone");
        },
      }),
    ).rejects.toThrow("database is gone");
  });
});

describe("VMwareVCenterConnection.getBinding and getRebindRefusal", () => {
  test("a binding is the endpoint, the probe and the certificate, each in one spelling", () => {
    expect(
      VMwareVCenterConnection.getBinding({
        vcenterUrl: "VCSA.example.com/ui",
        probeId: PROBE_ID.toUpperCase(),
        trustedCertificateFingerprint: FINGERPRINT_A.toLowerCase(),
      }),
    ).toEqual({
      endpointKey: "vcsa.example.com:443",
      probeId: PROBE_ID,
      trustedCertificateFingerprint: FINGERPRINT_A,
    });

    expect(
      VMwareVCenterConnection.getBinding({
        vcenterUrl: undefined,
        probeId: null,
        trustedCertificateFingerprint: "",
      }),
    ).toEqual({
      endpointKey: null,
      probeId: null,
      trustedCertificateFingerprint: null,
    });
  });

  test("the presented-certificate exception needs the same address and probe", () => {
    const saved: ReturnType<typeof VMwareVCenterConnection.getBinding> =
      VMwareVCenterConnection.getBinding({
        vcenterUrl: "https://vcsa.example.com",
        probeId: PROBE_ID,
        trustedCertificateFingerprint: null,
      });

    expect(
      VMwareVCenterConnection.getRebindRefusal({
        saved: saved,
        next: { ...saved, trustedCertificateFingerprint: FINGERPRINT_A },
        presentedFingerprint: FINGERPRINT_A,
      }),
    ).toBeNull();

    expect(
      VMwareVCenterConnection.getRebindRefusal({
        saved: saved,
        next: {
          ...saved,
          probeId: OTHER_PROBE_ID,
          trustedCertificateFingerprint: FINGERPRINT_A,
        },
        presentedFingerprint: FINGERPRINT_A,
      }),
    ).toBe(
      "Enter the password again: a saved password is only sent through the probe it was entered for.",
    );

    expect(
      VMwareVCenterConnection.getRebindRefusal({
        saved: saved,
        next: { ...saved, trustedCertificateFingerprint: FINGERPRINT_A },
        presentedFingerprint: null,
      }),
    ).not.toBeNull();
  });
});
