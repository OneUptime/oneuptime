import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import StorageArrayConnectionRules, {
  SavedStorageArrayConnection,
  StorageArrayConnectionChange,
} from "../../../../Server/Utils/StorageArray/StorageArrayConnectionRules";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../../Server/Types/Database/UpdateBy";
import StorageArrayConnection from "../../../../Models/DatabaseModels/StorageArrayConnection";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import StorageArrayCollectionStatus from "../../../../Types/StorageArray/Collection/StorageArrayCollectionStatus";
import POWERMAX_PROBE_COLLECTOR from "../../../../Types/StorageArray/Platforms/Dell/PowerMax/PowerMaxProbeCollector";

/*
 * The rules a storage array connection's writes follow (#11004), as
 * VMware's agentless collection: every setting is checked and normalized
 * before it is saved; a connection needs an address, a user name, a
 * password and a probe the project may use; the password is write-only,
 * and an edit that keeps it may not send it anywhere it was not entered
 * for - except trusting the certificate the probe itself found.
 *
 * The probe's lookup (assertProbeCanCollect) is stubbed: it reads Postgres.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const PROBE: string = "33333333-3333-4333-8333-333333333333";
const OTHER_PROBE: string = "44444444-4444-4444-8444-444444444444";
const CONNECTION: string = "55555555-5555-4555-8555-555555555555";

const FINGERPRINT: string =
  "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";
const PRESENTED: string =
  "01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF";

let probeChecks: Array<{ probeId: string; projectId: string }>;

beforeEach(() => {
  probeChecks = [];
  jest
    .spyOn(StorageArrayConnectionRules, "assertProbeCanCollect")
    .mockImplementation(
      async (data: { probeId: ObjectID; projectId: ObjectID }) => {
        probeChecks.push({
          probeId: data.probeId.toString(),
          projectId: data.projectId.toString(),
        });
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

function createBy(
  data: Record<string, unknown>,
): CreateBy<StorageArrayConnection> {
  return {
    data: data as unknown as StorageArrayConnection,
    props: { tenantId: PROJECT },
  } as unknown as CreateBy<StorageArrayConnection>;
}

function updateBy(
  data: Record<string, unknown>,
): UpdateBy<StorageArrayConnection> {
  return {
    data: data as unknown as StorageArrayConnection,
    query: { _id: CONNECTION },
    props: { tenantId: PROJECT },
  } as unknown as UpdateBy<StorageArrayConnection>;
}

function saved(
  overrides: Partial<SavedStorageArrayConnection> = {},
): SavedStorageArrayConnection {
  return {
    _id: CONNECTION,
    projectId: PROJECT,
    storageSystem: "dell.powermax",
    address: "https://unisphere.example.com:8443",
    username: "oneuptime-monitor",
    isPasswordSet: true,
    collectionProbeId: new ObjectID(PROBE),
    trustedCertificateFingerprint: FINGERPRINT,
    ...overrides,
  };
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }
  throw new Error("The write was not refused.");
}

describe("connecting a new Unisphere", () => {
  test("normalizes what was typed and names it after its host", async () => {
    const data: Record<string, unknown> = {
      address: "Unisphere.Example.com/univmax",
      username: "  oneuptime-monitor ",
      password: "pw",
      collectionProbeId: PROBE,
      trustedCertificateFingerprint: FINGERPRINT.replace(
        /:/g,
        "",
      ).toLowerCase(),
    };

    const change: StorageArrayConnectionChange =
      await StorageArrayConnectionRules.prepareCreate(createBy(data));

    expect(data).toMatchObject({
      storageSystem: "dell.powermax",
      address: "https://unisphere.example.com:8443",
      username: "oneuptime-monitor",
      trustedCertificateFingerprint: FINGERPRINT,
      collectionIntervalInMinutes: 5,
      name: "unisphere.example.com",
    });
    expect(change).toEqual({
      storageArrayConnectionId: null,
      isConnectionChanged: true,
      isCredentialChanged: true,
      isPasswordSet: true,
    });
    expect(probeChecks).toEqual([
      { probeId: PROBE, projectId: PROJECT.toString() },
    ]);
  });

  test("keeps a name someone gave it", async () => {
    const data: Record<string, unknown> = {
      name: "Unisphere DC1",
      address: "unisphere.example.com",
      username: "u",
      password: "pw",
      collectionProbeId: PROBE,
    };
    await StorageArrayConnectionRules.prepareCreate(createBy(data));
    expect(data["name"]).toBe("Unisphere DC1");
  });

  test("nothing a person writes decides the server's own columns", async () => {
    const data: Record<string, unknown> = {
      address: "unisphere.example.com",
      username: "u",
      password: "pw",
      collectionProbeId: PROBE,
      isPasswordSet: false,
      collectionStatus: StorageArrayCollectionStatus.Succeeded,
      collectionSummary: { arrays: [], warnings: [] },
      nextCollectionAt: new Date(0),
      collectionSettingsVersion: 99,
      presentedCertificate: { fingerprint256: FINGERPRINT },
    };
    await StorageArrayConnectionRules.prepareCreate(createBy(data));

    for (const column of [
      "isPasswordSet",
      "collectionStatus",
      "collectionSummary",
      "nextCollectionAt",
      "collectionSettingsVersion",
      "presentedCertificate",
    ]) {
      expect(data[column]).toBeUndefined();
    }
  });

  test.each([
    [
      "no address",
      { username: "u", password: "pw", collectionProbeId: PROBE },
      "Enter the address of Unisphere for PowerMax, such as https://unisphere.example.com:8443.",
    ],
    [
      "plain http",
      {
        address: "http://unisphere.example.com",
        username: "u",
        password: "pw",
        collectionProbeId: PROBE,
      },
      "Use https://. The server's API is served over HTTPS, and OneUptime never sends a password unencrypted.",
    ],
    [
      "no user name",
      {
        address: "unisphere.example.com",
        username: "   ",
        password: "pw",
        collectionProbeId: PROBE,
      },
      "Enter the user name.",
    ],
    [
      "no password",
      {
        address: "unisphere.example.com",
        username: "u",
        password: "",
        collectionProbeId: PROBE,
      },
      "Enter the password.",
    ],
    [
      "no probe",
      { address: "unisphere.example.com", username: "u", password: "pw" },
      "Pick the probe that reads this server: one in a network that reaches it on TCP 8443.",
    ],
    [
      "an interval outside 5 to 10 minutes",
      {
        address: "unisphere.example.com",
        username: "u",
        password: "pw",
        collectionProbeId: PROBE,
        collectionIntervalInMinutes: 1,
      },
      "Collect every 5 to 10 minutes, in whole minutes.",
    ],
    [
      "a fingerprint that is not one",
      {
        address: "unisphere.example.com",
        username: "u",
        password: "pw",
        collectionProbeId: PROBE,
        trustedCertificateFingerprint: "AB:CD",
      },
      "The trusted certificate fingerprint must be a SHA-256 fingerprint: 64 hexadecimal characters, such as AB:CD:EF:... .",
    ],
    [
      "a platform no probe reads",
      {
        storageSystem: "netapp.ontap",
        address: "unisphere.example.com",
        username: "u",
        password: "pw",
        collectionProbeId: PROBE,
      },
      "Storage platform must be one of dell.powermax.",
    ],
    [
      "a user name too long",
      {
        address: "unisphere.example.com",
        username: "u".repeat(257),
        password: "pw",
        collectionProbeId: PROBE,
      },
      "The user name may be at most 256 characters.",
    ],
    [
      "a password too long",
      {
        address: "unisphere.example.com",
        username: "u",
        password: "p".repeat(257),
        collectionProbeId: PROBE,
      },
      "The password may be at most 256 characters.",
    ],
  ])(
    "is refused with %s",
    async (_name: string, data: Record<string, unknown>, message: string) => {
      expect(
        await refusal(
          StorageArrayConnectionRules.prepareCreate(createBy(data)),
        ),
      ).toBe(message);
    },
  );

  test("a probe the project may not use is refused, as the probe check says", async () => {
    (
      StorageArrayConnectionRules.assertProbeCanCollect as unknown as jest.Mock
    ).mockImplementation(async () => {
      throw new BadDataException(
        "This probe belongs to another project. Pick one of this project's probes.",
      );
    });
    expect(
      await refusal(
        StorageArrayConnectionRules.prepareCreate(
          createBy({
            address: "unisphere.example.com",
            username: "u",
            password: "pw",
            collectionProbeId: OTHER_PROBE,
          }),
        ),
      ),
    ).toBe(
      "This probe belongs to another project. Pick one of this project's probes.",
    );
  });
});

describe("changing a saved connection", () => {
  test("an empty password keeps the saved one; nothing it is bound to changed", async () => {
    const data: Record<string, unknown> = {
      username: "oneuptime-monitor",
      password: "",
      collectionIntervalInMinutes: 10,
    };
    const changes: Array<StorageArrayConnectionChange> =
      await StorageArrayConnectionRules.prepareUpdate({
        updateBy: updateBy(data),
        saved: [saved()],
      });

    expect(data["password"]).toBeUndefined();
    expect(changes).toEqual([
      {
        storageArrayConnectionId: new ObjectID(CONNECTION),
        isCredentialChanged: false,
        isPasswordSet: null,
        isConnectionChanged: false,
      },
    ]);
  });

  test("a new password is a new credential and a new connection", async () => {
    const changes: Array<StorageArrayConnectionChange> =
      await StorageArrayConnectionRules.prepareUpdate({
        updateBy: updateBy({ password: "new-pw" }),
        saved: [saved()],
      });
    expect(changes[0]).toMatchObject({
      isCredentialChanged: true,
      isPasswordSet: true,
      isConnectionChanged: true,
    });
  });

  test("another user name is a new credential", async () => {
    const changes: Array<StorageArrayConnectionChange> =
      await StorageArrayConnectionRules.prepareUpdate({
        updateBy: updateBy({ username: "other-user" }),
        saved: [saved()],
      });
    expect(changes[0]).toMatchObject({
      isCredentialChanged: true,
      isConnectionChanged: true,
    });
  });

  test("another address, probe or certificate without the password is refused", async () => {
    expect(
      await refusal(
        StorageArrayConnectionRules.prepareUpdate({
          updateBy: updateBy({ address: "attacker.example.com" }),
          saved: [saved()],
        }),
      ),
    ).toBe(
      "Enter the password again: a saved password is only sent to the address it was entered for.",
    );
    expect(
      await refusal(
        StorageArrayConnectionRules.prepareUpdate({
          updateBy: updateBy({ collectionProbeId: OTHER_PROBE }),
          saved: [saved()],
        }),
      ),
    ).toBe(
      "Enter the password again: a saved password is only sent through the probe it was entered for.",
    );
    expect(
      await refusal(
        StorageArrayConnectionRules.prepareUpdate({
          updateBy: updateBy({ trustedCertificateFingerprint: PRESENTED }),
          saved: [saved()],
        }),
      ),
    ).toBe(
      "Enter the password again: a saved password is only sent to the certificate that was trusted when it was entered.",
    );
  });

  test("with the password, the address, the probe and the certificate may all change", async () => {
    const changes: Array<StorageArrayConnectionChange> =
      await StorageArrayConnectionRules.prepareUpdate({
        updateBy: updateBy({
          address: "unisphere-2.example.com",
          collectionProbeId: OTHER_PROBE,
          trustedCertificateFingerprint: PRESENTED,
          password: "pw",
        }),
        saved: [saved()],
      });
    expect(changes[0]!.isConnectionChanged).toBe(true);
    expect(probeChecks[0]!.probeId).toBe(OTHER_PROBE);
  });

  test("trusting the certificate the probe found keeps the password", async () => {
    const changes: Array<StorageArrayConnectionChange> =
      await StorageArrayConnectionRules.prepareUpdate({
        updateBy: updateBy({ trustedCertificateFingerprint: PRESENTED }),
        saved: [
          saved({
            presentedCertificate: {
              fingerprint256: PRESENTED,
              subject: "CN=unisphere",
              issuer: "CN=unisphere",
              isSelfSigned: true,
            },
          }),
        ],
      });
    expect(changes[0]).toMatchObject({
      isCredentialChanged: false,
      isConnectionChanged: true,
    });
  });

  test("going back to publicly trusted certificates keeps the password", async () => {
    const changes: Array<StorageArrayConnectionChange> =
      await StorageArrayConnectionRules.prepareUpdate({
        updateBy: updateBy({ trustedCertificateFingerprint: "" }),
        saved: [saved()],
      });
    expect(changes[0]!.isConnectionChanged).toBe(true);
  });

  test("a connection's platform is set when it is made", async () => {
    expect(
      await refusal(
        StorageArrayConnectionRules.prepareUpdate({
          updateBy: updateBy({ storageSystem: "purestorage.flasharray" }),
          saved: [saved()],
        }),
      ),
    ).toBe(
      "A connection's platform is set when it is made. Connect a new one for another platform.",
    );
  });

  test("a connection with no password saved needs one", async () => {
    expect(
      await refusal(
        StorageArrayConnectionRules.prepareUpdate({
          updateBy: updateBy({ username: "u" }),
          saved: [saved({ isPasswordSet: false })],
        }),
      ),
    ).toBe("Enter the password.");
  });

  test("settings of one connection at a time", async () => {
    expect(
      await refusal(
        StorageArrayConnectionRules.prepareUpdate({
          updateBy: updateBy({ username: "u" }),
          saved: [
            saved(),
            saved({ _id: "66666666-6666-4666-8666-666666666666" }),
          ],
        }),
      ),
    ).toBe("Change the settings of one connection at a time.");
  });

  test("a write that names no setting, or matches no row, changes nothing", async () => {
    expect(
      await StorageArrayConnectionRules.prepareUpdate({
        updateBy: updateBy({ name: "Renamed", description: "x" }),
        saved: [saved()],
      }),
    ).toEqual([]);
    expect(
      await StorageArrayConnectionRules.prepareUpdate({
        updateBy: updateBy({ username: "u" }),
        saved: [],
      }),
    ).toEqual([]);
    expect(probeChecks).toEqual([]);
  });
});

// What afterWrite hands the service to write, as the service writes it.
type ServerColumnsWrite = {
  storageArrayConnectionId: ObjectID;
  values: Record<string, unknown>;
  bumpSettingsVersion: boolean;
};

describe("after a write is saved", () => {
  test("a new connection's columns: password saved, Pending, collected at once, a new settings version", async () => {
    const writes: Array<ServerColumnsWrite> = [];

    await StorageArrayConnectionRules.afterWrite({
      change: {
        storageArrayConnectionId: new ObjectID(CONNECTION),
        isConnectionChanged: true,
        isCredentialChanged: true,
        isPasswordSet: true,
      },
      writeServerColumns: async (write: ServerColumnsWrite): Promise<void> => {
        writes.push(write);
      },
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]!.bumpSettingsVersion).toBe(true);
    expect(writes[0]!.values).toMatchObject({
      isPasswordSet: true,
      collectionStatus: StorageArrayCollectionStatus.Pending,
      collectionErrorCode: null,
      collectionError: null,
      presentedCertificate: null,
    });
    expect(writes[0]!.values["credentialsUpdatedAt"]).toBeInstanceOf(Date);
    expect(writes[0]!.values["nextCollectionAt"]).toBeInstanceOf(Date);
  });

  test("a rename writes nothing of the server's; a connection with no id is not written", async () => {
    const writes: Array<unknown> = [];
    await StorageArrayConnectionRules.afterWrite({
      change: {
        storageArrayConnectionId: new ObjectID(CONNECTION),
        isConnectionChanged: false,
        isCredentialChanged: false,
        isPasswordSet: null,
      },
      writeServerColumns: async (write: ServerColumnsWrite): Promise<void> => {
        writes.push(write);
      },
    });
    await StorageArrayConnectionRules.afterWrite({
      change: {
        storageArrayConnectionId: null,
        isConnectionChanged: true,
        isCredentialChanged: true,
        isPasswordSet: true,
      },
      writeServerColumns: async (write: ServerColumnsWrite): Promise<void> => {
        writes.push(write);
      },
    });
    expect(writes).toEqual([]);
  });
});

describe("what a write is", () => {
  test("a write of a setting is a connection write; a name or description is not", () => {
    expect(
      StorageArrayConnectionRules.isConnectionWrite({ address: "x" }),
    ).toBe(true);
    expect(
      StorageArrayConnectionRules.isConnectionWrite({
        collectionProbe: { _id: PROBE },
      }),
    ).toBe(true);
    expect(
      StorageArrayConnectionRules.isConnectionWrite({
        name: "x",
        description: "y",
      }),
    ).toBe(false);
    expect(StorageArrayConnectionRules.isConnectionWrite(undefined)).toBe(
      false,
    );
  });

  test("a password is given only as text with something in it", () => {
    expect(StorageArrayConnectionRules.isPasswordGiven("pw")).toBe(true);
    for (const value of ["", null, undefined, 5]) {
      expect(StorageArrayConnectionRules.isPasswordGiven(value)).toBe(false);
    }
  });

  test("a saved password is bound to the address's host and port, the probe and the certificate", () => {
    expect(
      StorageArrayConnectionRules.getBinding({
        address: "https://Unisphere.example.com:8443/univmax",
        probeId: PROBE.toUpperCase(),
        trustedCertificateFingerprint: FINGERPRINT.toLowerCase(),
        collector: POWERMAX_PROBE_COLLECTOR,
      }),
    ).toEqual({
      endpointKey: "unisphere.example.com:8443",
      probeId: PROBE,
      trustedCertificateFingerprint: FINGERPRINT,
    });
  });
});
