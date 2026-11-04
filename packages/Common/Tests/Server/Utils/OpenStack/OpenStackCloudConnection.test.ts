import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { IsBillingEnabled } from "../../../../Server/EnvironmentConfig";
import OpenStackCloudFeedService from "../../../../Server/Services/OpenStackCloudFeedService";
import ProbeService from "../../../../Server/Services/ProbeService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../../Server/Types/Database/UpdateBy";
import OpenStackCloudConnection, {
  OPENSTACK_CONNECTION_SAVED_SELECT,
  OPENSTACK_CONNECTION_SETTING_COLUMNS,
  OpenStackConnectionChange,
  SavedOpenStackConnection,
} from "../../../../Server/Utils/OpenStack/OpenStackCloudConnection";
import OpenStackCloud from "../../../../Models/DatabaseModels/OpenStackCloud";
import { OpenStackCloudFeedEventType } from "../../../../Models/DatabaseModels/OpenStackCloudFeed";
import Probe from "../../../../Models/DatabaseModels/Probe";
import { Blue500, Gray500, Yellow500 } from "../../../../Types/BrandColors";
import ObjectID from "../../../../Types/ObjectID";
import OpenStackCollectionMethod from "../../../../Types/OpenStack/OpenStackCollectionMethod";
import OpenStackCollectionStatus from "../../../../Types/OpenStack/OpenStackCollectionStatus";

/*
 * The save rules of a cloud's probe collection settings: what a create and an update must
 * carry, how they are normalized, where a saved credential may go, and what is written once
 * they are saved. OpenStackCloudServiceConnection.test.ts holds the service's hooks to these.
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
const CLOUD_ID: string = "9e8d7c6b-2222-4a1b-9c0d-000000000001";
const USER_ID: ObjectID = new ObjectID("3a3a3a3a-3333-4c4c-8d8d-000000000001");

const AUTH_URL: string = "https://keystone.example.com:5000";

const FINGERPRINT_A: string = Array.from({ length: 32 }, () => {
  return "AA";
}).join(":");
const FINGERPRINT_B: string = Array.from({ length: 32 }, () => {
  return "BB";
}).join(":");

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

function createBy(data: DataRecord): CreateBy<OpenStackCloud> {
  return {
    data: { projectId: PROJECT_ID, ...data } as unknown as OpenStackCloud,
    props: { tenantId: PROJECT_ID, userId: USER_ID },
  } as CreateBy<OpenStackCloud>;
}

function updateBy(data: DataRecord): UpdateBy<OpenStackCloud> {
  return {
    query: { _id: CLOUD_ID },
    data: data,
    props: { tenantId: PROJECT_ID, userId: USER_ID },
  } as unknown as UpdateBy<OpenStackCloud>;
}

function probeCloud(
  overrides: Partial<SavedOpenStackConnection> = {},
): SavedOpenStackConnection {
  return {
    _id: CLOUD_ID,
    projectId: PROJECT_ID,
    collectionMethod: OpenStackCollectionMethod.Probe,
    authUrl: AUTH_URL,
    credentialKind: "applicationCredential",
    applicationCredentialId: "saved-id",
    isCredentialSet: true,
    collectionProbeId: new ObjectID(PROBE_ID),
    collectionRegions: ["RegionOne"],
    ...overrides,
  };
}

function agentCloud(
  overrides: Partial<SavedOpenStackConnection> = {},
): SavedOpenStackConnection {
  return {
    _id: CLOUD_ID,
    projectId: PROJECT_ID,
    collectionMethod: OpenStackCollectionMethod.Agent,
    isCredentialSet: false,
    ...overrides,
  };
}

async function update(
  data: DataRecord,
  saved: SavedOpenStackConnection,
): Promise<{ change: OpenStackConnectionChange; data: DataRecord }> {
  const by: UpdateBy<OpenStackCloud> = updateBy(data);
  const changes: Array<OpenStackConnectionChange> =
    await OpenStackCloudConnection.prepareUpdate({
      updateBy: by,
      saved: [saved],
    });

  expect(changes).toHaveLength(1);

  return { change: changes[0]!, data: by.data as unknown as DataRecord };
}

const COMPLETE_PROBE_SETTINGS: DataRecord = {
  collectionMethod: OpenStackCollectionMethod.Probe,
  authUrl: "keystone.example.com:5000/v3/",
  applicationCredentialId: "  an-id  ",
  credentialSecret: "a-secret",
  collectionRegions: [" RegionOne "],
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

describe("what a write of these settings is", () => {
  test("any write of a probe collection setting", () => {
    for (const column of OPENSTACK_CONNECTION_SETTING_COLUMNS) {
      expect(
        OpenStackCloudConnection.isConnectionWrite({ [column]: null }),
      ).toBe(true);
    }

    expect(OpenStackCloudConnection.isConnectionWrite({ name: "x" })).toBe(
      false,
    );
    expect(OpenStackCloudConnection.isConnectionWrite(undefined)).toBe(false);
  });

  test("the saved row is read with everything the credential rule compares", () => {
    expect(Object.keys(OPENSTACK_CONNECTION_SAVED_SELECT).sort()).toEqual(
      [
        "_id",
        "projectId",
        "collectionMethod",
        "authUrl",
        "credentialKind",
        "applicationCredentialId",
        "keystoneUsername",
        "userDomainName",
        "projectName",
        "projectDomainName",
        "isCredentialSet",
        "collectionProbeId",
        "collectionRegions",
        "collectionOptions",
        "trustedCertificateFingerprints",
        "presentedCertificate",
      ].sort(),
    );
    // Reading the secret for this would be reading it for nothing.
    expect(OPENSTACK_CONNECTION_SAVED_SELECT).not.toHaveProperty(
      "credentialSecret",
    );
  });
});

describe("creating a cloud", () => {
  test("one the agent registered names none of it, and nothing is done", async () => {
    await expect(
      OpenStackCloudConnection.prepareCreate(createBy({ name: "Lab" })),
    ).resolves.toBeNull();
  });

  test("a probe-collected one, normalized", async () => {
    const by: CreateBy<OpenStackCloud> = createBy({
      ...COMPLETE_PROBE_SETTINGS,
    });

    const change: OpenStackConnectionChange | null =
      await OpenStackCloudConnection.prepareCreate(by);

    expect(by.data as unknown as DataRecord).toMatchObject({
      collectionMethod: OpenStackCollectionMethod.Probe,
      authUrl: AUTH_URL,
      collectionRegions: ["RegionOne"],
      credentialKind: "applicationCredential",
      applicationCredentialId: "an-id",
      credentialSecret: "a-secret",
      // Nobody named it, so it is named after its address.
      name: "keystone.example.com",
    });

    expect(change).toMatchObject({
      isConnectionChanged: true,
      isCredentialChanged: true,
      isCredentialSet: true,
      isSwitchedToAgent: false,
      feedColor: Blue500,
    });
    expect(change?.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(change?.feedLines[0]?.toString()).toContain(AUTH_URL);
  });

  test("a name somebody typed stays", async () => {
    const by: CreateBy<OpenStackCloud> = createBy({
      ...COMPLETE_PROBE_SETTINGS,
      name: "Production",
    });

    await OpenStackCloudConnection.prepareCreate(by);

    expect((by.data as unknown as DataRecord)["name"]).toBe("Production");
  });

  test("a user name and password", async () => {
    const by: CreateBy<OpenStackCloud> = createBy({
      ...COMPLETE_PROBE_SETTINGS,
      applicationCredentialId: undefined,
      keystoneUsername: " monitor ",
      projectName: "monitoring",
      credentialSecret: "hunter2",
    });

    await OpenStackCloudConnection.prepareCreate(by);

    expect(by.data as unknown as DataRecord).toMatchObject({
      credentialKind: "password",
      keystoneUsername: "monitor",
      projectName: "monitoring",
      userDomainName: "Default",
      projectDomainName: "Default",
      credentialSecret: "hunter2",
    });
  });

  test("the collection method defaults to the agent, which needs none of it", async () => {
    const by: CreateBy<OpenStackCloud> = createBy({
      authUrl: AUTH_URL,
      credentialSecret: "",
    });

    const change: OpenStackConnectionChange | null =
      await OpenStackCloudConnection.prepareCreate(by);

    expect((by.data as unknown as DataRecord)["collectionMethod"]).toBe(
      OpenStackCollectionMethod.Agent,
    );
    expect(by.data as unknown as DataRecord).not.toHaveProperty(
      "credentialSecret",
    );
    expect(change).toMatchObject({
      isConnectionChanged: false,
      isCredentialSet: false,
      feedLines: [],
      feedColor: Gray500,
    });
  });

  test("a secret for a cloud the agent reports has nowhere to go, and is refused", async () => {
    await expect(
      OpenStackCloudConnection.prepareCreate(
        createBy({
          collectionMethod: OpenStackCollectionMethod.Agent,
          credentialSecret: "a-secret",
        }),
      ),
    ).rejects.toThrow(
      "A credential is only saved for a cloud a probe collects",
    );
  });

  test.each([
    ["no address", { authUrl: undefined }, "Enter Keystone's address"],
    ["plain HTTP", { authUrl: "http://keystone.example.com" }, "Use https://"],
    ["loopback", { authUrl: "https://127.0.0.1" }, "Loopback"],
    [
      "no secret",
      { credentialSecret: undefined },
      "Enter an application credential's ID and secret",
    ],
    [
      "a secret with nothing naming it",
      { applicationCredentialId: undefined },
      "needs both its ID and its secret",
    ],
    ["no regions", { collectionRegions: [] }, "Pick the regions to read"],
    [
      "regions left out",
      { collectionRegions: undefined },
      "Pick the regions to read",
    ],
    [
      "no probe",
      { collectionProbeId: undefined },
      "Pick the probe that collects this cloud",
    ],
    [
      "another project's probe",
      { collectionProbeId: new ObjectID(FOREIGN_PROBE_ID) },
      "another project",
    ],
    [
      "a probe that does not exist",
      {
        collectionProbeId: new ObjectID("4d1b9f52-7a0e-4f34-9a0b-2b7c3f1d0009"),
      },
      "Probe not found",
    ],
    [
      "an interface that is not one",
      { endpointInterface: "private" },
      "public, internal or admin",
    ],
    [
      "a region that is not one",
      { collectionRegions: [7] },
      "A region's name is text",
    ],
    [
      "a fingerprint that is not one",
      { trustedCertificateFingerprints: ["no"] },
      "SHA-256",
    ],
    [
      "an interval too short",
      { collectionIntervalInMinutes: 0 },
      "Collect every 1 to 60 minutes",
    ],
    [
      "an interval too long",
      { collectionIntervalInMinutes: 61 },
      "Collect every 1 to 60 minutes",
    ],
    [
      "options that are not",
      { collectionOptions: "ports" },
      "collection options",
    ],
    [
      "port scopes that are not",
      { collectionOptions: { portNetworkIds: "a" } },
      "by their IDs",
    ],
  ])(
    "%s is refused",
    async (_name: string, overrides: DataRecord, words: string) => {
      await expect(
        OpenStackCloudConnection.prepareCreate(
          createBy({ ...COMPLETE_PROBE_SETTINGS, ...overrides }),
        ),
      ).rejects.toThrow(words);
    },
  );

  test("a shared probe, only where those are the operator's own", async () => {
    const attempt: Promise<OpenStackConnectionChange | null> =
      OpenStackCloudConnection.prepareCreate(
        createBy({
          ...COMPLETE_PROBE_SETTINGS,
          collectionProbeId: new ObjectID(GLOBAL_PROBE_ID),
        }),
      );

    if (IsBillingEnabled) {
      await expect(attempt).rejects.toThrow("Shared probes never receive");
    } else {
      await expect(attempt).resolves.toMatchObject({
        isConnectionChanged: true,
      });
    }
  });

  test("what it may be given is normalized too", async () => {
    const by: CreateBy<OpenStackCloud> = createBy({
      ...COMPLETE_PROBE_SETTINGS,
      trustedCertificateFingerprints: [FINGERPRINT_A.toLowerCase()],
      collectionIntervalInMinutes: "5",
      endpointInterface: "internal",
      collectionOptions: { collectPorts: true, somethingElse: 1 },
    });

    await OpenStackCloudConnection.prepareCreate(by);

    expect(by.data as unknown as DataRecord).toMatchObject({
      trustedCertificateFingerprints: [FINGERPRINT_A],
      collectionIntervalInMinutes: 5,
      endpointInterface: "internal",
      collectionOptions: { collectPorts: true },
    });
  });

  test("a project that cannot be found is refused", async () => {
    const by: CreateBy<OpenStackCloud> = {
      data: { ...COMPLETE_PROBE_SETTINGS } as unknown as OpenStackCloud,
      props: {},
    } as CreateBy<OpenStackCloud>;

    await expect(OpenStackCloudConnection.prepareCreate(by)).rejects.toThrow(
      "project is missing",
    );
  });
});

describe("updating a cloud's settings", () => {
  test("one that names none of them is nothing to do", async () => {
    await expect(
      OpenStackCloudConnection.prepareUpdate({
        updateBy: updateBy({ name: "New" }),
        saved: [probeCloud()],
      }),
    ).resolves.toEqual([]);
  });

  test("one that matched no row is nothing to do", async () => {
    await expect(
      OpenStackCloudConnection.prepareUpdate({
        updateBy: updateBy({ authUrl: AUTH_URL }),
        saved: [],
      }),
    ).resolves.toEqual([]);
  });

  test("a change of many at once is refused: each credential answers for itself", async () => {
    await expect(
      OpenStackCloudConnection.prepareUpdate({
        updateBy: updateBy({ collectionIntervalInMinutes: 5 }),
        saved: [probeCloud(), probeCloud()],
      }),
    ).rejects.toThrow("one cloud at a time");
  });

  test("a method that is not one is refused", async () => {
    await expect(
      update({ collectionMethod: "Telepathy" }, probeCloud()),
    ).rejects.toThrow("Collection method must be one of");
  });

  test("an interval only: nothing about the connection changed, and it is said", async () => {
    const { change } = await update(
      { collectionIntervalInMinutes: 5 },
      probeCloud(),
    );

    expect(change).toMatchObject({
      isConnectionChanged: false,
      isCredentialChanged: false,
      isCredentialSet: null,
    });
    expect(change.feedLines.join(" ")).toContain("every 5 minutes");
  });

  test("an empty secret means keep the saved one: the form sends its empty field", async () => {
    const { change, data } = await update(
      { credentialSecret: "", collectionIntervalInMinutes: 5 },
      probeCloud(),
    );

    expect(data).not.toHaveProperty("credentialSecret");
    expect(change.isCredentialChanged).toBe(false);
    expect(change.isCredentialSet).toBeNull();
  });

  test("a new secret is a new credential, and the probe tries again", async () => {
    const { change } = await update(
      {
        applicationCredentialId: "new-id",
        credentialSecret: "new-secret",
      },
      probeCloud(),
    );

    expect(change).toMatchObject({
      isCredentialChanged: true,
      isCredentialSet: true,
      isConnectionChanged: true,
    });
    expect(change.feedLines.join(" ")).toContain("credential changed");
  });

  test("a new secret for the saved application credential is that credential's", async () => {
    const { change, data } = await update(
      { credentialSecret: "rotated" },
      probeCloud(),
    );

    expect(data).toMatchObject({
      credentialKind: "applicationCredential",
      applicationCredentialId: "saved-id",
      credentialSecret: "rotated",
    });
    expect(change.isCredentialChanged).toBe(true);
  });

  test("a new password for the saved user is that user's: passwords do change", async () => {
    const { change, data } = await update(
      { credentialSecret: "rotated" },
      probeCloud({
        credentialKind: "password",
        applicationCredentialId: undefined,
        keystoneUsername: "monitor",
        userDomainName: "Users",
        projectName: "monitoring",
        projectDomainName: "Projects",
      }),
    );

    expect(data).toMatchObject({
      credentialKind: "password",
      keystoneUsername: "monitor",
      userDomainName: "Users",
      projectName: "monitoring",
      projectDomainName: "Projects",
      credentialSecret: "rotated",
    });
    expect(change.isCredentialChanged).toBe(true);
  });

  test("a new password, on another project", async () => {
    const { data } = await update(
      { credentialSecret: "rotated", projectName: "other" },
      probeCloud({
        credentialKind: "password",
        applicationCredentialId: undefined,
        keystoneUsername: "monitor",
        projectName: "monitoring",
      }),
    );

    expect(data).toMatchObject({
      keystoneUsername: "monitor",
      projectName: "other",
    });
  });

  test("from a password to an application credential: what named the old kind goes", async () => {
    const { data } = await update(
      { applicationCredentialId: "new-id", credentialSecret: "new-secret" },
      probeCloud({
        credentialKind: "password",
        applicationCredentialId: undefined,
        keystoneUsername: "monitor",
        projectName: "monitoring",
      }),
    );

    expect(data).toMatchObject({
      credentialKind: "applicationCredential",
      applicationCredentialId: "new-id",
      keystoneUsername: null,
      userDomainName: null,
      projectName: null,
      projectDomainName: null,
    });
  });

  test("from an application credential to a password: what named the old kind goes", async () => {
    const { data } = await update(
      {
        keystoneUsername: "monitor",
        projectName: "monitoring",
        credentialSecret: "hunter2",
      },
      probeCloud(),
    );

    expect(data).toMatchObject({
      credentialKind: "password",
      keystoneUsername: "monitor",
      applicationCredentialId: null,
    });
  });

  test("spaces around a name are not a change of name", async () => {
    const { change } = await update(
      { applicationCredentialId: "  saved-id  " },
      probeCloud(),
    );

    expect(change.isCredentialChanged).toBe(false);
  });

  test("a new secret may go with any address, because it was given for it", async () => {
    const { change, data } = await update(
      {
        authUrl: "https://new.example.com/v3",
        applicationCredentialId: "new-id",
        credentialSecret: "new-secret",
      },
      probeCloud(),
    );

    expect(data["authUrl"]).toBe("https://new.example.com");
    expect(change.isConnectionChanged).toBe(true);
    expect(change.feedLines.join(" ")).toContain("https://new.example.com");
  });

  test("a new secret may go with another of this project's probes", async () => {
    const { change } = await update(
      {
        collectionProbeId: new ObjectID(OTHER_PROBE_ID),
        applicationCredentialId: "saved-id",
        credentialSecret: "new-secret",
      },
      probeCloud(),
    );

    expect(change.feedLines.join(" ")).toContain("Another probe collects it");
  });

  describe("keeping the saved secret", () => {
    test("another address asks for it again", async () => {
      await expect(
        update({ authUrl: "https://evil.example.com:5000" }, probeCloud()),
      ).rejects.toThrow("only sent to the Keystone it was entered for");
    });

    test("the same address written differently is the same address", async () => {
      const { change, data } = await update(
        { authUrl: "https://KEYSTONE.example.com:5000/v3/" },
        probeCloud(),
      );

      expect(data["authUrl"]).toBe(AUTH_URL);
      expect(change.isConnectionChanged).toBe(false);
    });

    test("another path on the same host asks for it again", async () => {
      await expect(
        update(
          { authUrl: "https://keystone.example.com:5000/other" },
          probeCloud(),
        ),
      ).rejects.toThrow("only sent to the Keystone it was entered for");
    });

    test("another probe asks for it again", async () => {
      await expect(
        update(
          { collectionProbeId: new ObjectID(OTHER_PROBE_ID) },
          probeCloud(),
        ),
      ).rejects.toThrow("only sent through the probe it was entered for");
    });

    test("another probe named by its relation is the same as by its id", async () => {
      await expect(
        update({ collectionProbe: { _id: OTHER_PROBE_ID } }, probeCloud()),
      ).rejects.toThrow("only sent through the probe it was entered for");
    });

    test("a new certificate asks for it again", async () => {
      await expect(
        update(
          { trustedCertificateFingerprints: [FINGERPRINT_A] },
          probeCloud(),
        ),
      ).rejects.toThrow("only sent to the certificates that were trusted");
    });

    test("trusting fewer keeps it, and the probe tries again", async () => {
      const { change } = await update(
        { trustedCertificateFingerprints: [FINGERPRINT_A] },
        probeCloud({
          trustedCertificateFingerprints: [FINGERPRINT_A, FINGERPRINT_B],
        }),
      );

      expect(change.isConnectionChanged).toBe(true);
      expect(change.isCredentialChanged).toBe(false);
      expect(change.feedLines.join(" ")).toContain("It trusts 1 now");
    });

    test("trusting none keeps it, and says what that means", async () => {
      const { change } = await update(
        { trustedCertificateFingerprints: [] },
        probeCloud({ trustedCertificateFingerprints: [FINGERPRINT_A] }),
      );

      expect(change.feedLines.join(" ")).toContain(
        "must come from an authority the probe trusts",
      );
    });

    test("the certificate the probe found there can be trusted: nobody chose it", async () => {
      const { change } = await update(
        {
          trustedCertificateFingerprints: [FINGERPRINT_A, FINGERPRINT_B],
        },
        probeCloud({
          trustedCertificateFingerprints: [FINGERPRINT_A],
          presentedCertificate: { fingerprint256: FINGERPRINT_B },
        }),
      );

      expect(change.isConnectionChanged).toBe(true);
      expect(change.isCredentialChanged).toBe(false);
    });

    test("but only that one", async () => {
      await expect(
        update(
          {
            trustedCertificateFingerprints: [FINGERPRINT_A],
          },
          probeCloud({
            presentedCertificate: { fingerprint256: FINGERPRINT_B },
          }),
        ),
      ).rejects.toThrow("only sent to the certificates that were trusted");
    });

    test.each([
      [
        "the application credential's ID",
        { applicationCredentialId: "another-id" },
      ],
      ["the kind", { credentialKind: "password" }],
      ["the user", { keystoneUsername: "someone-else" }],
      ["the user's domain", { userDomainName: "Other" }],
      ["the project", { projectName: "other" }],
      ["the project's domain", { projectDomainName: "Other" }],
    ])(
      "a change of %s asks for it again: a secret only goes with what it was entered for",
      async (_name: string, data: DataRecord) => {
        await expect(update(data, probeCloud())).rejects.toThrow(
          "Enter the credential's secret again",
        );
      },
    );

    test("naming the same credential changes nothing", async () => {
      const { change } = await update(
        {
          applicationCredentialId: "saved-id",
          credentialKind: "applicationCredential",
        },
        probeCloud(),
      );

      expect(change.isCredentialChanged).toBe(false);
    });
  });

  test("regions: the probe tries again, and it is said", async () => {
    const { change, data } = await update(
      { collectionRegions: ["RegionOne", "RegionTwo"] },
      probeCloud(),
    );

    expect(data["collectionRegions"]).toEqual(["RegionOne", "RegionTwo"]);
    expect(change.isConnectionChanged).toBe(true);
    expect(change.feedLines.join(" ")).toContain("regions it reads changed");
  });

  test("the same regions are not a change", async () => {
    const { change } = await update(
      { collectionRegions: ["RegionOne"] },
      probeCloud(),
    );

    expect(change.isConnectionChanged).toBe(false);
  });

  test("regions can't be emptied while a probe collects it", async () => {
    await expect(
      update({ collectionRegions: [] }, probeCloud()),
    ).rejects.toThrow("Pick the regions to read");
  });

  test("the interface: the probe tries again", async () => {
    const { change } = await update(
      { endpointInterface: "internal" },
      probeCloud(),
    );

    expect(change.isConnectionChanged).toBe(true);
  });

  test("the options are held to what a probe knows, and said when they change", async () => {
    const { change, data } = await update(
      { collectionOptions: { collectPorts: true, somethingElse: 1 } },
      probeCloud(),
    );

    expect(data["collectionOptions"]).toEqual({ collectPorts: true });
    expect(change.feedLines.join(" ")).toContain("beyond the defaults changed");
    // Read at the next collection, which is soon enough: no one is waiting on it.
    expect(change.isConnectionChanged).toBe(false);
  });

  test("options that did not change are not said to have", async () => {
    const { change } = await update(
      { collectionOptions: { collectPorts: true } },
      probeCloud({ collectionOptions: { collectPorts: true } }),
    );

    expect(change.feedLines).toEqual([]);
  });

  test("a probe that may no longer collect it is refused, even keeping everything else", async () => {
    await expect(
      update(
        { collectionIntervalInMinutes: 5 },
        probeCloud({ collectionProbeId: new ObjectID(FOREIGN_PROBE_ID) }),
      ),
    ).rejects.toThrow("another project");
  });

  describe("moving between the agent and a probe", () => {
    test("to a probe: everything it needs, a new secret among them", async () => {
      await expect(
        update(
          {
            collectionMethod: OpenStackCollectionMethod.Probe,
            authUrl: AUTH_URL,
            collectionRegions: ["RegionOne"],
            collectionProbeId: new ObjectID(PROBE_ID),
          },
          agentCloud(),
        ),
      ).rejects.toThrow("Enter an application credential's ID and secret");
    });

    test("to a probe, with everything: it says to stop the agent, or every metric arrives twice", async () => {
      const { change } = await update(
        {
          collectionMethod: OpenStackCollectionMethod.Probe,
          authUrl: AUTH_URL,
          applicationCredentialId: "an-id",
          credentialSecret: "a-secret",
          collectionRegions: ["RegionOne"],
          collectionProbeId: new ObjectID(PROBE_ID),
          collectionIntervalInMinutes: 5,
        },
        agentCloud(),
      );

      expect(change).toMatchObject({
        isConnectionChanged: true,
        isCredentialChanged: true,
        isCredentialSet: true,
        isSwitchedToAgent: false,
        feedColor: Blue500,
      });
      expect(change.feedLines).toHaveLength(1);
      expect(change.feedLines[0]?.toString()).toContain(
        "every metric arrives twice",
      );
    });

    test("a secret saved long ago does not count for a cloud the agent reports now", async () => {
      await expect(
        update(
          {
            collectionMethod: OpenStackCollectionMethod.Probe,
            authUrl: AUTH_URL,
            collectionRegions: ["RegionOne"],
            collectionProbeId: new ObjectID(PROBE_ID),
          },
          agentCloud({ isCredentialSet: true }),
        ),
      ).rejects.toThrow("Enter an application credential's ID and secret");
    });

    test("to the agent: the credential is forgotten, and it is said", async () => {
      const { change, data } = await update(
        { collectionMethod: OpenStackCollectionMethod.Agent },
        probeCloud(),
      );

      expect(data["credentialSecret"]).toBeNull();
      expect(change).toMatchObject({
        isSwitchedToAgent: true,
        isCredentialSet: false,
        isCredentialChanged: true,
        feedColor: Yellow500,
      });
      expect(change.feedLines[0]?.toString()).toContain(
        "saved credential was deleted",
      );
    });

    test("to the agent, with a secret: it has nowhere to go", async () => {
      await expect(
        update(
          {
            collectionMethod: OpenStackCollectionMethod.Agent,
            credentialSecret: "a-secret",
          },
          probeCloud(),
        ),
      ).rejects.toThrow(
        "A credential is only saved for a cloud a probe collects",
      );
    });

    test("a cloud already on the agent: nothing to forget", async () => {
      const { change } = await update(
        { collectionIntervalInMinutes: 5 },
        agentCloud(),
      );

      expect(change).toMatchObject({
        isSwitchedToAgent: false,
        isConnectionChanged: false,
        feedLines: [],
      });
    });
  });
});

describe("once it is saved", () => {
  const CHANGE: OpenStackConnectionChange = {
    openStackCloudId: new ObjectID(CLOUD_ID),
    projectId: PROJECT_ID,
    isConnectionChanged: true,
    isCredentialChanged: true,
    isCredentialSet: true,
    isSwitchedToAgent: false,
    feedLines: [],
    feedColor: Gray500,
  };

  interface WrittenColumns {
    openStackCloudId: ObjectID;
    values: DataRecord;
    bumpSettingsVersion: boolean;
  }

  async function afterWrite(
    overrides: Partial<OpenStackConnectionChange>,
  ): Promise<Array<WrittenColumns>> {
    const written: Array<WrittenColumns> = [];

    await OpenStackCloudConnection.afterWrite({
      change: { ...CHANGE, ...overrides },
      userId: USER_ID,
      writeServerColumns: async (write: WrittenColumns): Promise<void> => {
        written.push(write);
      },
    });

    return written;
  }

  test("a connection that changed: the probe tries now, and an old report no longer counts", async () => {
    const before: number = Date.now();

    const [written] = await afterWrite({});

    expect(written?.bumpSettingsVersion).toBe(true);
    expect(written?.openStackCloudId.toString()).toBe(CLOUD_ID);
    expect(written?.values).toMatchObject({
      isCredentialSet: true,
      collectionStatus: OpenStackCollectionStatus.Pending,
      collectionErrorCode: null,
      collectionError: null,
      presentedCertificate: null,
    });
    expect(
      (written?.values["nextCollectionAt"] as Date).getTime(),
    ).toBeGreaterThanOrEqual(before);
    expect(written?.values["credentialsUpdatedAt"]).toBeInstanceOf(Date);
  });

  test("to the agent: the probe's status goes too, and it is not scheduled", async () => {
    const [written] = await afterWrite({
      isSwitchedToAgent: true,
      isCredentialSet: false,
    });

    expect(written?.bumpSettingsVersion).toBe(true);
    expect(written?.values).toMatchObject({
      isCredentialSet: false,
      collectionStatus: null,
      collectionErrorCode: null,
      collectionError: null,
      presentedCertificate: null,
      nextCollectionAt: null,
    });
  });

  test("nothing about the connection changed: nothing is written", async () => {
    await expect(
      afterWrite({
        isConnectionChanged: false,
        isCredentialChanged: false,
        isCredentialSet: null,
      }),
    ).resolves.toEqual([]);
  });

  test("a change with no cloud yet to write to does nothing", async () => {
    await expect(afterWrite({ openStackCloudId: null })).resolves.toEqual([]);
  });

  test("a feed line says what changed and who changed it", async () => {
    const feed: ReturnType<typeof jest.spyOn> = jest
      .spyOn(OpenStackCloudFeedService, "createOpenStackCloudFeedItem")
      .mockResolvedValue(undefined as never);

    const { change } = await update(
      { collectionIntervalInMinutes: 5 },
      probeCloud(),
    );

    await afterWrite({ ...change });

    expect(feed).toHaveBeenCalledTimes(1);

    const item: DataRecord = feed.mock.calls[0]?.[0] as DataRecord;

    expect(item).toMatchObject({
      projectId: PROJECT_ID,
      openStackCloudFeedEventType:
        OpenStackCloudFeedEventType.OpenStackCloudUpdated,
      userId: USER_ID,
      displayColor: Gray500,
    });
    expect(item["feedInfoInMarkdown"]).toContain("Data collection changed");
    expect(item["feedInfoInMarkdown"]).toContain("every 5 minutes");
  });

  test("nothing to say: no feed line", async () => {
    const feed: ReturnType<typeof jest.spyOn> = jest
      .spyOn(OpenStackCloudFeedService, "createOpenStackCloudFeedItem")
      .mockResolvedValue(undefined as never);

    await afterWrite({});

    expect(feed).not.toHaveBeenCalled();
  });

  test("a write that fails is not swallowed", async () => {
    await expect(
      OpenStackCloudConnection.afterWrite({
        change: CHANGE,
        writeServerColumns: async (): Promise<void> => {
          throw new Error("The database is gone.");
        },
      }),
    ).rejects.toThrow("The database is gone.");
  });
});

describe("which probe", () => {
  test("a probe of this project", async () => {
    await expect(
      OpenStackCloudConnection.assertProbeCanCollect({
        probeId: new ObjectID(PROBE_ID),
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();
  });

  test("another project's reads as refused, in its own words", async () => {
    await expect(
      OpenStackCloudConnection.assertProbeCanCollect({
        probeId: new ObjectID(FOREIGN_PROBE_ID),
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow("This probe belongs to another project");
  });

  test("one that does not exist", async () => {
    await expect(
      OpenStackCloudConnection.assertProbeCanCollect({
        probeId: new ObjectID("4d1b9f52-7a0e-4f34-9a0b-2b7c3f1d0009"),
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow("Probe not found");
  });
});

describe("the binding a credential has", () => {
  test("is read the one way, however it was written", () => {
    expect(
      OpenStackCloudConnection.getBinding({
        authUrl: "https://KEYSTONE.example.com:5000/v3/",
        probeId: PROBE_ID.toUpperCase(),
        trustedCertificateFingerprints: [FINGERPRINT_A.toLowerCase()],
      }),
    ).toEqual({
      endpointKey: "keystone.example.com:5000",
      probeId: PROBE_ID,
      trustedCertificateFingerprints: [FINGERPRINT_A],
    });
  });

  test("nothing saved reads as nothing", () => {
    expect(
      OpenStackCloudConnection.getBinding({
        authUrl: null,
        probeId: null,
        trustedCertificateFingerprints: null,
      }),
    ).toEqual({
      endpointKey: null,
      probeId: null,
      trustedCertificateFingerprints: [],
    });
  });
});
