import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { IsBillingEnabled } from "../../../Server/EnvironmentConfig";
import ProbeService from "../../../Server/Services/ProbeService";
import StorageArrayConnectionService from "../../../Server/Services/StorageArrayConnectionService";
import { Service as StorageArrayConnectionTestServiceType } from "../../../Server/Services/StorageArrayConnectionTestService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import Probe from "../../../Models/DatabaseModels/Probe";
import StorageArrayConnection from "../../../Models/DatabaseModels/StorageArrayConnection";
import StorageArrayConnectionTest from "../../../Models/DatabaseModels/StorageArrayConnectionTest";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import StorageArrayProbeCollectors from "../../../Types/StorageArray/Collection/StorageArrayProbeCollectors";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * "Test connection" for a storage array connection a probe reads (Dell
 * PowerMax's Unisphere, #11004) checks its probe and the connection it
 * names itself (getRelationsCheckedByService), as a vCenter's and an
 * XCP-ng connection's tests do:
 *
 *   - the probe: one of the test's project, or - on a self-hosted install
 *     only - one of the instance's global probes; another project's probe
 *     is refused, a missing one is not found;
 *   - the connection: read only within the test's project, so another
 *     project's connection is answered exactly as a missing one.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-0000000000b1",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-0000000000b2",
);
const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-0000000000b1");
const CONNECTION_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-0000000000b1",
);

type ServiceInternals = {
  onBeforeCreate: (
    createBy: CreateBy<StorageArrayConnectionTest>,
  ) => Promise<OnCreate<StorageArrayConnectionTest>>;
};

type Overrides<T> = { [Key in keyof T]?: T[Key] | undefined };

function buildService(): {
  service: StorageArrayConnectionTestServiceType;
  internals: ServiceInternals;
} {
  const service: StorageArrayConnectionTestServiceType =
    new StorageArrayConnectionTestServiceType();

  return { service, internals: service as unknown as ServiceInternals };
}

function probeRow(overrides: Overrides<Probe> = {}): Probe {
  const probe: Probe = new Probe(PROBE_ID);
  probe.projectId = PROJECT_ID;
  probe.isGlobalProbe = false;
  Object.assign(probe, overrides);
  return probe;
}

function newTest(
  extra: Record<string, unknown> = {},
): CreateBy<StorageArrayConnectionTest> {
  const test: StorageArrayConnectionTest = new StorageArrayConnectionTest();
  Object.assign(test, {
    storageSystem: StorageArrayProbeCollectors.getDefault().storageSystem,
    address: "unisphere.example.com",
    username: "monitor",
    password: "typed-password",
    probeId: PROBE_ID,
    ...extra,
  });

  return {
    data: test,
    props: { tenantId: PROJECT_ID },
  } as unknown as CreateBy<StorageArrayConnectionTest>;
}

type Spy = { mock: { calls: Array<Array<unknown>> } };

function stubProbe(probe: Probe | null): Spy {
  return jest
    .spyOn(ProbeService, "findOneById")
    .mockResolvedValue(probe as never) as unknown as Spy;
}

function stubSavedConnection(connection: StorageArrayConnection | null): Spy {
  return jest
    .spyOn(StorageArrayConnectionService, "findOneBy")
    .mockResolvedValue(connection as never) as unknown as Spy;
}

function stubActiveTests(
  service: StorageArrayConnectionTestServiceType,
  count: number,
): void {
  jest
    .spyOn(service, "countBy")
    .mockResolvedValue(new PositiveNumber(count) as never);
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(BadDataException);
    return (err as Error).message;
  }

  throw new Error("Expected the call to be refused.");
}

beforeEach(() => {
  jest.restoreAllMocks();
  stubProjectDirectory({});
});

describe("the probe a storage array connection test names is checked by the service itself", () => {
  test("names its checks: the probe and the connection", () => {
    const { service } = buildService();
    const checked: Array<string> = (
      service as unknown as {
        getRelationsCheckedByService: () => Array<string>;
      }
    ).getRelationsCheckedByService();

    expect(checked).toEqual(["probe", "storageArrayConnection"]);
  });

  test("one of the test's project's probes is taken, read as OneUptime, by its id", async () => {
    const { service, internals } = buildService();
    const lookup: Spy = stubProbe(probeRow());
    stubActiveTests(service, 0);

    const createBy: CreateBy<StorageArrayConnectionTest> = newTest();
    await internals.onBeforeCreate(createBy);

    expect(lookup.mock.calls[0]![0]).toMatchObject({
      id: PROBE_ID,
      props: { isRoot: true },
    });
  });

  test("a probe that does not exist is not found", async () => {
    const { service, internals } = buildService();
    stubProbe(null);
    stubActiveTests(service, 0);

    expect(await refusal(internals.onBeforeCreate(newTest()))).toBe(
      "Probe not found. Pick one of this project's probes.",
    );
  });

  test("another project's probe is refused", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow({ projectId: OTHER_PROJECT_ID }));
    stubActiveTests(service, 0);

    expect(await refusal(internals.onBeforeCreate(newTest()))).toBe(
      "This probe belongs to another project. Pick one of this project's probes.",
    );
  });

  test("a global probe is taken on a self-hosted install only", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow({ isGlobalProbe: true, projectId: undefined }));
    stubActiveTests(service, 0);

    if (IsBillingEnabled) {
      expect(await refusal(internals.onBeforeCreate(newTest()))).toBe(
        "Pick a probe of your own. Shared probes never receive storage passwords - add a probe in the storage network and pick it here.",
      );
    } else {
      await internals.onBeforeCreate(newTest());
    }
  });
});

describe("the connection a test names is read within the test's project only", () => {
  test("it is looked up by its id and the test's project, as OneUptime", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    stubActiveTests(service, 0);
    const connection: StorageArrayConnection = new StorageArrayConnection(
      CONNECTION_ID,
    );
    connection.storageSystem = StorageArrayProbeCollectors.getDefault()
      .storageSystem as never;
    const lookup: Spy = stubSavedConnection(connection);

    await internals.onBeforeCreate(
      newTest({ storageArrayConnectionId: CONNECTION_ID }),
    );

    expect(lookup.mock.calls[0]![0]).toMatchObject({
      query: { _id: CONNECTION_ID, projectId: PROJECT_ID },
      props: { isRoot: true },
    });
  });

  test("another project's connection is answered exactly as one that does not exist", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    stubActiveTests(service, 0);
    // The project's own read finds no row for another project's connection.
    stubSavedConnection(null);

    const foreign: string = await refusal(
      internals.onBeforeCreate(
        newTest({ storageArrayConnectionId: CONNECTION_ID }),
      ),
    );
    const missing: string = await refusal(
      internals.onBeforeCreate(
        newTest({
          storageArrayConnectionId: new ObjectID(
            "44444444-4444-4444-8444-0000000000ff",
          ),
          password: "",
        }),
      ),
    );

    expect(foreign).toBe("Connection not found.");
    expect(missing).toBe(foreign);
  });
});
