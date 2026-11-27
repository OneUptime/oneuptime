import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { IsBillingEnabled } from "../../../Server/EnvironmentConfig";
import ProbeService from "../../../Server/Services/ProbeService";
import XcpNgConnectionService from "../../../Server/Services/XcpNgConnectionService";
import { Service as XcpNgConnectionTestServiceType } from "../../../Server/Services/XcpNgConnectionTestService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import DatabaseService from "../../../Server/Services/DatabaseService";
import Probe from "../../../Models/DatabaseModels/Probe";
import XcpNgConnection from "../../../Models/DatabaseModels/XcpNgConnection";
import XcpNgConnectionTest from "../../../Models/DatabaseModels/XcpNgConnectionTest";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import XcpNgConnectionType from "../../../Types/XcpNg/XcpNgConnectionType";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * "Test connection" for an XCP-ng connection checks its probe and the
 * connection it names itself (getRelationsCheckedByService), as a vCenter's
 * test does (VMwareVCenterConnectionTestService.test.ts):
 *
 *   - the probe: one of the test's project, or - on a self-hosted install
 *     only - one of the instance's global probes; another project's probe
 *     is refused, a missing one is not found;
 *   - the connection: read only within the test's project, so another
 *     project's connection is answered exactly as a missing one, and its
 *     saved secrets are used only for the address, probe and certificate
 *     they were saved for;
 *   - the answer of a create holds none of the secrets.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-0000000000a1",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-0000000000a2",
);
const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-0000000000a1");
const OTHER_PROBE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-0000000000a2",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-0000000000a1",
);

type ServiceInternals = {
  onBeforeCreate: (
    createBy: CreateBy<XcpNgConnectionTest>,
  ) => Promise<OnCreate<XcpNgConnectionTest>>;
};

function buildService(): {
  service: XcpNgConnectionTestServiceType;
  internals: ServiceInternals;
} {
  const service: XcpNgConnectionTestServiceType =
    new XcpNgConnectionTestServiceType();

  return { service, internals: service as unknown as ServiceInternals };
}

function probeRow(overrides: Partial<Probe> = {}): Probe {
  const probe: Probe = new Probe(PROBE_ID);
  probe.projectId = PROJECT_ID;
  probe.isGlobalProbe = false;
  Object.assign(probe, overrides);
  return probe;
}

function savedConnection(
  overrides: Record<string, unknown> = {},
): XcpNgConnection {
  const connection: XcpNgConnection = new XcpNgConnection(CONNECTION_ID);
  Object.assign(connection, {
    connectionType: XcpNgConnectionType.XenOrchestra,
    address: "https://xo.example.com",
    openMetricsSecret: "saved-openmetrics-secret",
    apiToken: "saved-api-token",
    collectionProbeId: PROBE_ID,
    trustedCertificateFingerprint: null,
    ...overrides,
  });
  return connection;
}

function newTest(
  extra: Record<string, unknown> = {},
): CreateBy<XcpNgConnectionTest> {
  const test: XcpNgConnectionTest = new XcpNgConnectionTest();
  Object.assign(test, {
    connectionType: XcpNgConnectionType.XenOrchestra,
    address: "xo.example.com",
    openMetricsSecret: "typed-openmetrics-secret",
    probeId: PROBE_ID,
    ...extra,
  });

  return {
    data: test,
    props: { tenantId: PROJECT_ID },
  } as unknown as CreateBy<XcpNgConnectionTest>;
}

type Spy = { mock: { calls: Array<Array<unknown>> } };

function stubProbe(probe: Probe | null): Spy {
  return jest
    .spyOn(ProbeService, "findOneById")
    .mockResolvedValue(probe as never) as unknown as Spy;
}

function stubSavedConnection(connection: XcpNgConnection | null): Spy {
  return jest
    .spyOn(XcpNgConnectionService, "findOneBy")
    .mockResolvedValue(connection as never) as unknown as Spy;
}

function stubActiveTests(
  service: XcpNgConnectionTestServiceType,
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

describe("the probe a test names is checked by the service itself", () => {
  test("names its checks: the probe and the connection, which the generic check would get wrong", () => {
    const { service } = buildService();
    const checked: Array<string> = (
      service as unknown as {
        getRelationsCheckedByService: () => Array<string>;
      }
    ).getRelationsCheckedByService();

    expect(checked).toEqual(["probe", "xcpNgConnection"]);
  });

  test("one of the test's project's probes is taken, read as OneUptime, by its id", async () => {
    const { service, internals } = buildService();
    const lookup: Spy = stubProbe(probeRow());
    stubActiveTests(service, 0);

    const createBy: CreateBy<XcpNgConnectionTest> = newTest();
    await internals.onBeforeCreate(createBy);

    expect(createBy.data.probeId?.toString()).toBe(PROBE_ID.toString());
    expect(lookup.mock.calls[0]![0]).toMatchObject({
      id: PROBE_ID,
      props: { isRoot: true },
    });
  });

  test("a probe that does not exist is not found", async () => {
    const { service, internals } = buildService();
    stubProbe(null);
    stubActiveTests(service, 0);

    expect(
      await refusal(
        internals.onBeforeCreate(newTest({ probeId: OTHER_PROBE_ID })),
      ),
    ).toBe("Probe not found. Pick one of this project's probes.");
  });

  test("another project's probe is refused", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow({ projectId: OTHER_PROJECT_ID }));
    stubActiveTests(service, 0);

    expect(await refusal(internals.onBeforeCreate(newTest()))).toBe(
      "This probe belongs to another project. Pick one of this project's probes.",
    );
  });

  test("a global probe is taken on a self-hosted install only: OneUptime Cloud's shared probes never get the secrets", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow({ isGlobalProbe: true, projectId: undefined }));
    stubActiveTests(service, 0);

    if (IsBillingEnabled) {
      expect(await refusal(internals.onBeforeCreate(newTest()))).toBe(
        "Pick a probe of your own. Shared probes never receive XCP-ng secrets - add a probe in the network of your Xen Orchestra or pool and pick it here.",
      );
    } else {
      const createBy: CreateBy<XcpNgConnectionTest> = newTest();
      await internals.onBeforeCreate(createBy);
      expect(createBy.data.probeId?.toString()).toBe(PROBE_ID.toString());
    }
  });

  test("a test names a probe, or is refused before anything is read", async () => {
    const { service, internals } = buildService();
    const lookup: Spy = stubProbe(probeRow());
    stubActiveTests(service, 0);

    expect(
      await refusal(internals.onBeforeCreate(newTest({ probeId: undefined }))),
    ).toBe(
      "Pick the probe to test from: one in a network that reaches the address on its HTTPS port.",
    );
    expect(lookup.mock.calls).toHaveLength(0);
  });
});

describe("the connection a test names is read within the test's project only", () => {
  test("it is looked up by its id and the test's project, as OneUptime", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    stubActiveTests(service, 0);
    const lookup: Spy = stubSavedConnection(savedConnection());

    await internals.onBeforeCreate(
      newTest({ xcpNgConnectionId: CONNECTION_ID }),
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
        newTest({ xcpNgConnectionId: CONNECTION_ID, openMetricsSecret: "" }),
      ),
    );
    const missing: string = await refusal(
      internals.onBeforeCreate(
        newTest({
          xcpNgConnectionId: new ObjectID(
            "44444444-4444-4444-8444-0000000000ff",
          ),
        }),
      ),
    );

    expect(foreign).toBe("XCP-ng connection not found.");
    expect(missing).toBe(foreign);
  });

  test("a typed secret needs no saved one, but the connection must still be this project's", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    stubActiveTests(service, 0);
    stubSavedConnection(null);

    expect(
      await refusal(
        internals.onBeforeCreate(newTest({ xcpNgConnectionId: CONNECTION_ID })),
      ),
    ).toBe("XCP-ng connection not found.");
  });

  test("its saved secrets are used for the address, probe and certificate they were saved for", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    stubActiveTests(service, 0);
    stubSavedConnection(savedConnection());

    const createBy: CreateBy<XcpNgConnectionTest> = newTest({
      xcpNgConnectionId: CONNECTION_ID,
      openMetricsSecret: "",
    });
    await internals.onBeforeCreate(createBy);

    const data: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;
    expect(data["openMetricsSecret"]).toBe("saved-openmetrics-secret");
    expect(data["apiToken"]).toBe("saved-api-token");
  });

  test.each([
    [
      "another address",
      { address: "https://attacker.example.com" },
      "Enter the OpenMetrics secret again: a saved secret is only sent to the address it was entered for.",
    ],
    [
      "another probe",
      { probeId: OTHER_PROBE_ID },
      "Enter the OpenMetrics secret again: a saved secret is only sent through the probe it was entered for.",
    ],
  ])(
    "its saved secrets are never sent to %s",
    async (_name: string, extra: Record<string, unknown>, message: string) => {
      const { service, internals } = buildService();
      // Either probe is one of the project's own: only the binding differs.
      stubProbe(probeRow());
      stubActiveTests(service, 0);
      stubSavedConnection(savedConnection());

      expect(
        await refusal(
          internals.onBeforeCreate(
            newTest({
              xcpNgConnectionId: CONNECTION_ID,
              openMetricsSecret: "",
              ...extra,
            }),
          ),
        ),
      ).toBe(message);
    },
  );

  test("a test of a pool's XAPI never takes a Xen Orchestra's saved secrets", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    stubActiveTests(service, 0);
    stubSavedConnection(savedConnection());

    expect(
      await refusal(
        internals.onBeforeCreate(
          newTest({
            xcpNgConnectionId: CONNECTION_ID,
            connectionType: XcpNgConnectionType.Xapi,
            address: "https://pool-master.example.com",
            openMetricsSecret: undefined,
            username: "root",
            password: "",
          }),
        ),
      ),
    ).toBe(
      "Test the connection as what it reads: a Xen Orchestra, or a pool's XAPI.",
    );
  });
});

describe("the answer of a create holds none of the secrets", () => {
  test("the row is saved with them, and handed back without them", async () => {
    const { service } = buildService();
    const saved: XcpNgConnectionTest = new XcpNgConnectionTest(
      new ObjectID("55555555-5555-4555-8555-0000000000a1"),
    );
    Object.assign(saved, {
      openMetricsSecret: "typed-openmetrics-secret",
      apiToken: "typed-api-token",
      password: "typed-password",
      address: "https://xo.example.com",
    });
    jest
      .spyOn(DatabaseService.prototype, "create")
      .mockResolvedValue(saved as never);

    const answer: XcpNgConnectionTest = await service.create(newTest());
    const row: Record<string, unknown> = answer as unknown as Record<
      string,
      unknown
    >;

    expect(row["openMetricsSecret"]).toBeUndefined();
    expect(row["apiToken"]).toBeUndefined();
    expect(row["password"]).toBeUndefined();
    expect(row["address"]).toBe("https://xo.example.com");
  });
});
