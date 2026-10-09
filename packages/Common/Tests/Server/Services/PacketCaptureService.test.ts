import FileService from "../../../Server/Services/FileService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import {
  ALREADY_FINISHED_MESSAGE,
  CAPABILITY_NOT_REPORTED_MESSAGE,
  CAPTURE_TURNED_OFF_MESSAGE,
  FILE_TOO_LARGE_MESSAGE,
  getActiveCaptureLimitMessage,
  getPacketCaptureFileName,
  getPacketCaptureName,
  getUnknownInterfaceMessage,
  GLOBAL_PROBE_MESSAGE,
  HEARTBEAT_TIMEOUT_MESSAGE,
  NO_INTERFACES_MESSAGE,
  NOT_A_PCAP_MESSAGE,
  NOT_STARTED_MESSAGE,
  PICKUP_TIMEOUT_MESSAGE,
  PROBE_NOT_FOUND_MESSAGE,
  Service as PacketCaptureServiceType,
  TOOL_MISSING_MESSAGE,
  UPLOAD_TIMEOUT_MESSAGE,
} from "../../../Server/Services/PacketCaptureService";
import ProbeService from "../../../Server/Services/ProbeService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import { OnCreate, OnDelete } from "../../../Server/Types/Database/Hooks";
import File from "../../../Models/DatabaseModels/File";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import PacketCapture from "../../../Models/DatabaseModels/PacketCapture";
import Probe from "../../../Models/DatabaseModels/Probe";
import ColumnLength from "../../../Types/Database/ColumnLength";
import BadDataException from "../../../Types/Exception/BadDataException";
import MimeType from "../../../Types/File/MimeType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { PacketCaptureCapability } from "../../../Types/PacketCapture/PacketCaptureCapability";
import PacketCaptureEndReason from "../../../Types/PacketCapture/PacketCaptureEndReason";
import { PacketCaptureJob } from "../../../Types/PacketCapture/PacketCaptureJob";
import {
  PACKET_CAPTURE_HEARTBEAT_TIMEOUT_IN_MINUTES,
  PACKET_CAPTURE_MAX_ACTIVE_PER_PROBE,
  PACKET_CAPTURE_PICKUP_TIMEOUT_IN_MINUTES,
  PACKET_CAPTURE_RETENTION_IN_DAYS,
  PACKET_CAPTURE_UPLOAD_GRACE_IN_MINUTES,
} from "../../../Types/PacketCapture/PacketCaptureLimits";
import { PACKET_CAPTURE_NOT_FOUND_MESSAGE } from "../../../Types/PacketCapture/PacketCapturePermissions";
import PacketCaptureStatus from "../../../Types/PacketCapture/PacketCaptureStatus";
import PositiveNumber from "../../../Types/PositiveNumber";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  makePcap,
  makePcapHeader,
  makePcapRecord,
  pcapLength,
} from "../Utils/PacketCapture/PcapFixture";
import { EntityManager } from "typeorm";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHAT THIS FILE IS DEFENDING
 *
 * A packet capture is a person asking a probe to record the traffic it
 * sees. Everything the server holds it to is here:
 *
 *   - the create checks: only the project's own probe, never a global one;
 *     the probe must have said captures are on, tcpdump is installed and the
 *     interface exists; the filter must be one BPF can be; the limits must
 *     be inside the probe's maximums; the probe must have a slot free. The
 *     row always starts Pending with no result, whatever was posted.
 *   - the probe's SQL: a probe only ever claims, hears about and settles its
 *     OWN captures, and the server counts the packets in the file itself.
 *     A dropped predicate is invisible from outside - the query still runs -
 *     so the statements are pinned by their text and their parameters.
 *   - the clocks: captures nobody will finish are failed with the reason,
 *     and captures and their files are deleted after the retention period.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const DEVICE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const CAPTURE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const SECOND_CAPTURE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const FILE_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const SECOND_FILE_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);

type ServiceInternals = {
  onBeforeCreate: (
    createBy: CreateBy<PacketCapture>,
  ) => Promise<OnCreate<PacketCapture>>;
  checkCreateBeforeReferences: (
    createBy: CreateBy<PacketCapture>,
  ) => Promise<void>;
  onBeforeDelete: (
    deleteBy: DeleteBy<PacketCapture>,
  ) => Promise<OnDelete<PacketCapture>>;
  onDeleteSuccess: (
    onDelete: OnDelete<PacketCapture>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ) => Promise<OnDelete<PacketCapture>>;
};

function buildService(): {
  service: PacketCaptureServiceType;
  internals: ServiceInternals;
} {
  const service: PacketCaptureServiceType = new PacketCaptureServiceType();

  return { service, internals: service as unknown as ServiceInternals };
}

/*
 * A probe's report as it is stored: whatever the probe posted, so a test
 * can store a broken one too.
 */
function capability(overrides: JSONObject = {}): PacketCaptureCapability {
  return {
    isEnabled: true,
    isToolAvailable: true,
    interfaces: [
      { name: "any", addresses: [], isUp: true },
      { name: "eth0", addresses: ["10.0.0.2/24"], isUp: true },
    ],
    limits: {
      maxDurationInSeconds: 1800,
      maxPackets: 1000000,
      maxFileSizeInMB: 25,
    },
    ...overrides,
  } as unknown as PacketCaptureCapability;
}

type Overrides<T> = { [Key in keyof T]?: T[Key] | undefined };

function probeRow(overrides: Overrides<Probe> = {}): Probe {
  const probe: Probe = new Probe(PROBE_ID);
  probe.projectId = PROJECT_ID;
  probe.isGlobalProbe = false;
  probe.packetCaptureCapability = capability();
  Object.assign(probe, overrides);
  return probe;
}

type Spy = { mock: { calls: Array<Array<unknown>> } };

function stubProbe(probe: Probe | null): Spy {
  return jest
    .spyOn(ProbeService, "findOneById")
    .mockResolvedValue(probe as never) as unknown as Spy;
}

function stubActiveCount(
  service: PacketCaptureServiceType,
  count: number,
): Spy {
  return jest
    .spyOn(service, "countBy")
    .mockResolvedValue(new PositiveNumber(count) as never) as unknown as Spy;
}

function makeCreateBy(
  data: Record<string, unknown>,
  props: Record<string, unknown> = { tenantId: PROJECT_ID },
): CreateBy<PacketCapture> {
  const capture: PacketCapture = new PacketCapture();
  Object.assign(capture, data);

  return { data: capture, props: props } as unknown as CreateBy<PacketCapture>;
}

function startCapture(
  extra: Record<string, unknown> = {},
): CreateBy<PacketCapture> {
  return makeCreateBy({
    probeId: PROBE_ID,
    interfaceName: "eth0",
    bpfFilter: "host 10.0.0.5",
    ...extra,
  });
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

interface RecordedStatement {
  sql: string;
  params: Array<unknown>;
}

/*
 * A fake EntityManager that records every statement and answers each with
 * the next scripted result. The service only ever calls `query`.
 */
function stubTransaction(
  service: PacketCaptureServiceType,
  results: Array<unknown>,
): Array<RecordedStatement> {
  const statements: Array<RecordedStatement> = [];
  const queue: Array<unknown> = [...results];

  jest
    .spyOn(service, "executeTransaction")
    .mockImplementation(
      async <TResult>(
        runInTransaction: (entityManager: EntityManager) => Promise<TResult>,
      ): Promise<TResult> => {
        const entityManager: {
          query: (sql: string, params: Array<unknown>) => Promise<unknown>;
        } = {
          query: async (
            sql: string,
            params: Array<unknown>,
          ): Promise<unknown> => {
            statements.push({ sql, params });
            return queue.length > 0 ? queue.shift() : [];
          },
        };

        return await runInTransaction(
          entityManager as unknown as EntityManager,
        );
      },
    );

  return statements;
}

const WHITESPACE: RegExp = /\s+/g;

function flatten(sql: string): string {
  return sql.replace(WHITESPACE, " ").trim();
}

beforeEach(() => {
  jest.restoreAllMocks();
  stubProjectDirectory({});
});

describe("checkCreateBeforeReferences: a global probe is refused first, in words that say why", () => {
  test("a global probe", async () => {
    const { internals } = buildService();
    stubProbe(probeRow({ isGlobalProbe: true, projectId: undefined }));

    expect(
      await refusal(internals.checkCreateBeforeReferences(startCapture())),
    ).toBe(GLOBAL_PROBE_MESSAGE);
  });

  test("a probe with no project is a global one", async () => {
    const { internals } = buildService();
    stubProbe(probeRow({ projectId: undefined }));

    expect(
      await refusal(internals.checkCreateBeforeReferences(startCapture())),
    ).toBe(GLOBAL_PROBE_MESSAGE);
  });

  test("named through the relation too", async () => {
    const { internals } = buildService();
    stubProbe(probeRow({ isGlobalProbe: true }));

    expect(
      await refusal(
        internals.checkCreateBeforeReferences(
          makeCreateBy({ probe: new Probe(PROBE_ID), interfaceName: "eth0" }),
        ),
      ),
    ).toBe(GLOBAL_PROBE_MESSAGE);
  });

  test("a project's own probe, a missing probe or no probe at all is left to the create checks", async () => {
    const { internals } = buildService();

    stubProbe(probeRow());
    await internals.checkCreateBeforeReferences(startCapture());

    jest.restoreAllMocks();
    stubProbe(null);
    await internals.checkCreateBeforeReferences(startCapture());

    jest.restoreAllMocks();
    const spy: Spy = stubProbe(probeRow());
    await internals.checkCreateBeforeReferences(makeCreateBy({}));
    expect(spy.mock.calls).toHaveLength(0);
  });
});

describe("onBeforeCreate: what a capture is started with", () => {
  test("starts the capture Pending, named after its interface and filter, with the default limits", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    stubActiveCount(service, 0);

    const createBy: CreateBy<PacketCapture> = startCapture({
      interfaceName: "  eth0 ",
      bpfFilter: "  host   10.0.0.5  ",
    });

    const result: OnCreate<PacketCapture> =
      await internals.onBeforeCreate(createBy);

    expect(result.createBy).toBe(createBy);
    expect(createBy.data.status).toBe(PacketCaptureStatus.Pending);
    expect(createBy.data.interfaceName).toBe("eth0");
    expect(createBy.data.bpfFilter).toBe("host 10.0.0.5");
    expect(createBy.data.name).toBe("eth0: host 10.0.0.5");
    expect(createBy.data.maxDurationInSeconds).toBe(60);
    expect(createBy.data.maxPackets).toBe(100000);
    expect(createBy.data.maxFileSizeInMB).toBe(10);
    expect(createBy.data.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(createBy.data.probeId?.toString()).toBe(PROBE_ID.toString());
    expect(createBy.data.networkDeviceId).toBeNull();
    expect(createBy.data.fileId).toBeNull();
  });

  test("a capture of every packet is named 'all traffic'", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    stubActiveCount(service, 0);

    const createBy: CreateBy<PacketCapture> = startCapture({
      interfaceName: "any",
      bpfFilter: "",
    });

    await internals.onBeforeCreate(createBy);

    expect(createBy.data.bpfFilter).toBe("");
    expect(createBy.data.name).toBe("any: all traffic");
  });

  test("whatever was posted for the run is cleared: a capture never starts with a result", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    stubActiveCount(service, 0);

    const createBy: CreateBy<PacketCapture> = startCapture({
      status: PacketCaptureStatus.Completed,
      statusMessage: "done",
      endReason: PacketCaptureEndReason.DurationReached,
      startedAt: new Date(),
      completedAt: new Date(),
      stopRequestedAt: new Date(),
      packetCount: 10,
      fileSizeInBytes: 100,
      fileId: FILE_ID,
      file: new File(FILE_ID),
      name: "posted name",
    });

    await internals.onBeforeCreate(createBy);

    const data: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;

    expect(createBy.data.status).toBe(PacketCaptureStatus.Pending);
    expect(createBy.data.name).toBe("eth0: host 10.0.0.5");

    for (const column of [
      "statusMessage",
      "endReason",
      "startedAt",
      "completedAt",
      "stopRequestedAt",
      "packetCount",
      "fileSizeInBytes",
    ]) {
      expect({ column: column, value: data[column] }).toEqual({
        column: column,
        value: undefined,
      });
    }

    expect(data["fileId"]).toBeNull();
    expect("file" in data).toBe(false);
  });

  test("the limits asked for are kept, as whole numbers", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    stubActiveCount(service, 0);

    const createBy: CreateBy<PacketCapture> = startCapture({
      maxDurationInSeconds: "300",
      maxPackets: 5000,
      maxFileSizeInMB: 25,
    });

    await internals.onBeforeCreate(createBy);

    expect(createBy.data.maxDurationInSeconds).toBe(300);
    expect(createBy.data.maxPackets).toBe(5000);
    expect(createBy.data.maxFileSizeInMB).toBe(25);
  });

  test("the probe can be named by its relation", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    stubActiveCount(service, 0);

    const createBy: CreateBy<PacketCapture> = makeCreateBy({
      probe: new Probe(PROBE_ID),
      interfaceName: "eth0",
    });

    await internals.onBeforeCreate(createBy);

    const data: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;

    expect(createBy.data.probeId?.toString()).toBe(PROBE_ID.toString());
    expect("probe" in data).toBe(false);
  });

  test("a capture needs a probe", async () => {
    const { internals } = buildService();

    expect(
      await refusal(
        internals.onBeforeCreate(makeCreateBy({ interfaceName: "eth0" })),
      ),
    ).toBe("Pick the probe to capture on.");
  });

  test("a probe that does not exist, or is another project's, is not found - the same words for both", async () => {
    const { internals } = buildService();

    stubProbe(null);
    expect(await refusal(internals.onBeforeCreate(startCapture()))).toBe(
      PROBE_NOT_FOUND_MESSAGE,
    );

    jest.restoreAllMocks();
    stubProjectDirectory({});
    stubProbe(probeRow({ projectId: OTHER_PROJECT_ID }));
    expect(await refusal(internals.onBeforeCreate(startCapture()))).toBe(
      PROBE_NOT_FOUND_MESSAGE,
    );
  });

  test("a global probe never captures", async () => {
    const { internals } = buildService();
    stubProbe(probeRow({ isGlobalProbe: true }));

    expect(await refusal(internals.onBeforeCreate(startCapture()))).toBe(
      GLOBAL_PROBE_MESSAGE,
    );
  });

  test("a probe that never reported, or has captures off, no tcpdump or no interfaces, is refused with what to fix", async () => {
    const { internals } = buildService();

    const cases: Array<{ report: unknown; message: string }> = [
      { report: undefined, message: CAPABILITY_NOT_REPORTED_MESSAGE },
      { report: { broken: true }, message: CAPABILITY_NOT_REPORTED_MESSAGE },
      {
        report: capability({ isEnabled: false }),
        message: CAPTURE_TURNED_OFF_MESSAGE,
      },
      {
        report: capability({ isToolAvailable: false }),
        message: TOOL_MISSING_MESSAGE,
      },
      {
        report: capability({ interfaces: [] }),
        message: NO_INTERFACES_MESSAGE,
      },
    ];

    for (const item of cases) {
      jest.restoreAllMocks();
      stubProjectDirectory({});
      stubProbe(
        probeRow({
          packetCaptureCapability: item.report as PacketCaptureCapability,
        }),
      );

      expect(await refusal(internals.onBeforeCreate(startCapture()))).toBe(
        item.message,
      );
    }
  });

  test("the refusals say what to set where the probe runs", () => {
    expect(CAPABILITY_NOT_REPORTED_MESSAGE).toContain(
      "PROBE_PACKET_CAPTURE_ENABLED=true",
    );
    expect(CAPTURE_TURNED_OFF_MESSAGE).toContain(
      "PROBE_PACKET_CAPTURE_ENABLED=true",
    );
    expect(TOOL_MISSING_MESSAGE).toContain("tcpdump");
  });

  test("a capture needs an interface the probe reported", async () => {
    const { internals } = buildService();
    stubProbe(probeRow());

    expect(
      await refusal(
        internals.onBeforeCreate(startCapture({ interfaceName: "  " })),
      ),
    ).toBe("Pick the network interface to capture on.");
    expect(
      await refusal(
        internals.onBeforeCreate(startCapture({ interfaceName: undefined })),
      ),
    ).toBe("Pick the network interface to capture on.");
    expect(
      await refusal(
        internals.onBeforeCreate(startCapture({ interfaceName: "eth9" })),
      ),
    ).toBe(getUnknownInterfaceMessage("eth9"));
    expect(getUnknownInterfaceMessage("eth9")).toBe(
      'This probe has no network interface named "eth9". Pick one of the interfaces it reported.',
    );
  });

  test("a filter BPF cannot be is refused with what is wrong", async () => {
    const { internals } = buildService();
    stubProbe(probeRow());

    expect(
      await refusal(
        internals.onBeforeCreate(
          startCapture({ bpfFilter: "host 10.0.0.5; reboot" }),
        ),
      ),
    ).toContain('The filter can\'t contain ";"');
    expect(
      await refusal(
        internals.onBeforeCreate(startCapture({ bpfFilter: "(host 10.0.0.5" })),
      ),
    ).toBe('The filter has a "(" that is never closed.');
    expect(
      await refusal(
        internals.onBeforeCreate(startCapture({ bpfFilter: "-w /tmp/x" })),
      ),
    ).toBe('The filter can\'t start with "-".');
  });

  test("limits past the hard maximums are refused, not lowered", async () => {
    const { internals } = buildService();
    stubProbe(probeRow());

    expect(
      await refusal(
        internals.onBeforeCreate(startCapture({ maxDurationInSeconds: 3600 })),
      ),
    ).toBe("A capture runs for at most 30 minutes.");
    expect(
      await refusal(
        internals.onBeforeCreate(startCapture({ maxFileSizeInMB: 100 })),
      ),
    ).toBe("A capture file is at most 25 MB.");
    expect(
      await refusal(internals.onBeforeCreate(startCapture({ maxPackets: 0 }))),
    ).toBe("A capture stops after at least 1 packet.");
  });

  test("limits past the probe's own lower maximums are refused as the probe's", async () => {
    const { internals } = buildService();
    stubProbe(
      probeRow({
        packetCaptureCapability: capability({
          limits: {
            maxDurationInSeconds: 300,
            maxPackets: 1000000,
            maxFileSizeInMB: 5,
          },
        }),
      }),
    );

    expect(
      await refusal(
        internals.onBeforeCreate(startCapture({ maxDurationInSeconds: 600 })),
      ),
    ).toBe("This probe allows captures of at most 5 minutes.");
    expect(
      await refusal(
        internals.onBeforeCreate(startCapture({ maxFileSizeInMB: 10 })),
      ),
    ).toBe("This probe allows capture files of at most 5 MB.");
  });

  test("a probe's lower maximum lowers the defaults too", async () => {
    const { service, internals } = buildService();
    stubProbe(
      probeRow({
        packetCaptureCapability: capability({
          limits: {
            maxDurationInSeconds: 30,
            maxPackets: 1000000,
            maxFileSizeInMB: 2,
          },
        }),
      }),
    );
    stubActiveCount(service, 0);

    const createBy: CreateBy<PacketCapture> = startCapture();

    await internals.onBeforeCreate(createBy);

    expect(createBy.data.maxDurationInSeconds).toBe(30);
    expect(createBy.data.maxFileSizeInMB).toBe(2);
  });

  test("a network device must be the project's", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    stubActiveCount(service, 0);

    const otherDevice: NetworkDevice = new NetworkDevice(DEVICE_ID);
    otherDevice.projectId = OTHER_PROJECT_ID;

    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(otherDevice as never);

    expect(
      await refusal(
        internals.onBeforeCreate(startCapture({ networkDeviceId: DEVICE_ID })),
      ),
    ).toBe("Network Device not found.");

    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(null as never);

    expect(
      await refusal(
        internals.onBeforeCreate(startCapture({ networkDeviceId: DEVICE_ID })),
      ),
    ).toBe("Network Device not found.");
  });

  test("a capture started from a device keeps the device", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    stubActiveCount(service, 0);

    const device: NetworkDevice = new NetworkDevice(DEVICE_ID);
    device.projectId = PROJECT_ID;

    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(device as never);

    const createBy: CreateBy<PacketCapture> = startCapture({
      networkDevice: new NetworkDevice(DEVICE_ID),
    });

    await internals.onBeforeCreate(createBy);

    expect(createBy.data.networkDeviceId?.toString()).toBe(
      DEVICE_ID.toString(),
    );
  });

  test("a probe with every slot taken is refused, counting its Pending and Running captures", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    const count: Spy = stubActiveCount(
      service,
      PACKET_CAPTURE_MAX_ACTIVE_PER_PROBE,
    );

    expect(await refusal(internals.onBeforeCreate(startCapture()))).toBe(
      getActiveCaptureLimitMessage(PACKET_CAPTURE_MAX_ACTIVE_PER_PROBE),
    );
    expect(getActiveCaptureLimitMessage(2)).toBe(
      "This probe is already running 2 packet captures. Wait for one to finish, or stop one, and try again.",
    );

    const query: JSONObject = (count.mock.calls[0]![0] as { query: JSONObject })
      .query;

    expect(query["probeId"]?.toString()).toBe(PROBE_ID.toString());
    expect(JSON.stringify(query["status"])).toContain(
      PacketCaptureStatus.Pending,
    );
    expect(JSON.stringify(query["status"])).toContain(
      PacketCaptureStatus.Running,
    );
  });

  test("one slot free is enough", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    stubActiveCount(service, PACKET_CAPTURE_MAX_ACTIVE_PER_PROBE - 1);

    const createBy: CreateBy<PacketCapture> = startCapture();

    await internals.onBeforeCreate(createBy);

    expect(createBy.data.status).toBe(PacketCaptureStatus.Pending);
  });

  test("the probe is read as root, with its report", async () => {
    const { service, internals } = buildService();
    const spy: Spy = stubProbe(probeRow());
    stubActiveCount(service, 0);

    await internals.onBeforeCreate(startCapture());

    const reads: Array<{ select: JSONObject; props: JSONObject }> =
      spy.mock.calls.map((call: Array<unknown>) => {
        return call[0] as { select: JSONObject; props: JSONObject };
      });

    // The global-probe check first, then the create checks.
    expect(reads).toHaveLength(2);

    for (const read of reads) {
      expect(read.props).toEqual({ isRoot: true });
      expect(read.select["isGlobalProbe"]).toBe(true);
      expect(read.select["projectId"]).toBe(true);
    }

    expect(reads[1]!.select["packetCaptureCapability"]).toBe(true);
  });
});

describe("getPacketCaptureName", () => {
  test("the interface and the filter", () => {
    expect(
      getPacketCaptureName({ interfaceName: "eth0", bpfFilter: "port 53" }),
    ).toBe("eth0: port 53");
    expect(getPacketCaptureName({ interfaceName: "any", bpfFilter: "" })).toBe(
      "any: all traffic",
    );
  });

  test("cut to fit the column", () => {
    const name: string = getPacketCaptureName({
      interfaceName: "eth0",
      bpfFilter: `host ${"a".repeat(400)}`,
    });

    expect(name).toHaveLength(ColumnLength.ShortText);
    expect(name.endsWith("…")).toBe(true);
  });
});

describe("getPacketCaptureFileName", () => {
  test("what was captured, where and when, in characters every file system takes", () => {
    expect(
      getPacketCaptureFileName({
        probeName: "Site A Probe",
        interfaceName: "eth0",
        startedAt: new Date("2026-10-09T08:30:00.123Z"),
      }),
    ).toBe("packet-capture-site-a-probe-eth0-2026-10-09T08-30-00Z.pcap");
  });

  test("without a probe name, and with names that need tidying", () => {
    expect(
      getPacketCaptureFileName({
        interfaceName: "ens192.20",
        startedAt: new Date("2026-01-02T03:04:05Z"),
      }),
    ).toBe("packet-capture-ens192-20-2026-01-02T03-04-05Z.pcap");
    expect(
      getPacketCaptureFileName({
        probeName: "../../etc/passwd ☃",
        interfaceName: "any",
        startedAt: new Date("2026-01-02T03:04:05Z"),
      }),
    ).toBe("packet-capture-etc-passwd-any-2026-01-02T03-04-05Z.pcap");
  });

  test("a long probe name is cut", () => {
    const fileName: string = getPacketCaptureFileName({
      probeName: "p".repeat(200),
      interfaceName: "eth0",
      startedAt: new Date("2026-01-02T03:04:05Z"),
    });

    expect(fileName).toBe(
      `packet-capture-${"p".repeat(40)}-eth0-2026-01-02T03-04-05Z.pcap`,
    );
  });
});

describe("toJob: a claimed row as the probe runs it", () => {
  test("carries the interface, the filter and the limits, the size in bytes", () => {
    expect(
      PacketCaptureServiceType.toJob({
        _id: CAPTURE_ID.toString(),
        interfaceName: "eth0",
        bpfFilter: "  port   53 ",
        maxDurationInSeconds: 120,
        maxPackets: 500,
        maxFileSizeInMB: 5,
      }),
    ).toEqual({
      id: CAPTURE_ID.toString(),
      interfaceName: "eth0",
      bpfFilter: "port 53",
      maxDurationInSeconds: 120,
      maxPackets: 500,
      maxFileSizeInBytes: 5 * 1024 * 1024,
    });
  });

  test("a row written past the hard maximums is still run inside them", () => {
    const job: PacketCaptureJob = PacketCaptureServiceType.toJob({
      _id: CAPTURE_ID.toString(),
      interfaceName: "eth0",
      bpfFilter: null,
      maxDurationInSeconds: 86400,
      maxPackets: 99999999,
      maxFileSizeInMB: 1000,
    });

    expect(job.bpfFilter).toBe("");
    expect(job.maxDurationInSeconds).toBe(1800);
    expect(job.maxPackets).toBe(1000000);
    expect(job.maxFileSizeInBytes).toBe(25 * 1024 * 1024);
  });

  test("a limit that is not a number reads as the hard maximum", () => {
    const job: PacketCaptureJob = PacketCaptureServiceType.toJob({
      _id: CAPTURE_ID.toString(),
      interfaceName: "eth0",
      maxDurationInSeconds: "soon",
      maxPackets: 0,
      maxFileSizeInMB: -1,
    });

    expect(job.maxDurationInSeconds).toBe(1800);
    expect(job.maxPackets).toBe(1000000);
    expect(job.maxFileSizeInBytes).toBe(25 * 1024 * 1024);
  });
});

describe("claimPendingForProbe", () => {
  test("hands out nothing, and asks nothing, when the probe has no slot free", async () => {
    const { service } = buildService();
    const statements: Array<RecordedStatement> = stubTransaction(service, []);

    expect(
      await service.claimPendingForProbe({ probeId: PROBE_ID, limit: 0 }),
    ).toEqual([]);
    expect(statements).toHaveLength(0);
  });

  test("selects only this probe's Pending, undeleted captures inside the pickup window, oldest first, skipping locked ones", async () => {
    const { service } = buildService();
    const statements: Array<RecordedStatement> = stubTransaction(service, [[]]);

    const before: number = Date.now();
    await service.claimPendingForProbe({ probeId: PROBE_ID, limit: 2 });
    const after: number = Date.now();

    expect(statements).toHaveLength(1);

    const select: RecordedStatement = statements[0]!;
    const sql: string = flatten(select.sql);

    expect(sql).toContain('FROM "PacketCapture" c');
    expect(sql).toContain('c."probeId" = $1');
    expect(select.params[0]).toBe(PROBE_ID.toString());
    expect(sql).toContain('c."status" = $2');
    expect(select.params[1]).toBe(PacketCaptureStatus.Pending);
    expect(sql).toContain('c."createdAt" >= $3');
    const windowStart: number = (select.params[2] as Date).getTime();
    expect(windowStart).toBeGreaterThanOrEqual(
      before - PACKET_CAPTURE_PICKUP_TIMEOUT_IN_MINUTES * 60 * 1000,
    );
    expect(windowStart).toBeLessThanOrEqual(
      after - PACKET_CAPTURE_PICKUP_TIMEOUT_IN_MINUTES * 60 * 1000,
    );
    expect(sql).toContain('c."deletedAt" IS NULL');
    expect(sql).toContain('ORDER BY c."createdAt" ASC');
    expect(sql).toContain("LIMIT $4");
    expect(select.params[3]).toBe(2);
    expect(sql).toContain("FOR UPDATE OF c SKIP LOCKED");
  });

  test("marks what it claimed Running with a start time, in the same transaction, and hands it out", async () => {
    const { service } = buildService();
    const rows: Array<JSONObject> = [
      {
        _id: CAPTURE_ID.toString(),
        interfaceName: "eth0",
        bpfFilter: "port 53",
        maxDurationInSeconds: 60,
        maxPackets: 100,
        maxFileSizeInMB: 1,
      },
      {
        _id: SECOND_CAPTURE_ID.toString(),
        interfaceName: "any",
        bpfFilter: "",
        maxDurationInSeconds: 30,
        maxPackets: 10,
        maxFileSizeInMB: 2,
      },
    ];
    const statements: Array<RecordedStatement> = stubTransaction(service, [
      rows,
      [[], 2],
    ]);

    const jobs: Array<PacketCaptureJob> = await service.claimPendingForProbe({
      probeId: PROBE_ID,
      limit: 2,
    });

    expect(statements).toHaveLength(2);

    const update: RecordedStatement = statements[1]!;
    const sql: string = flatten(update.sql);

    expect(sql).toContain('UPDATE "PacketCapture"');
    expect(sql).toContain('"status" = $2');
    expect(update.params[1]).toBe(PacketCaptureStatus.Running);
    expect(sql).toContain('"startedAt" = now()');
    expect(sql).toContain('"updatedAt" = now()');
    expect(sql).toContain('WHERE "_id" = ANY($1::uuid[])');
    expect(update.params[0]).toEqual([
      CAPTURE_ID.toString(),
      SECOND_CAPTURE_ID.toString(),
    ]);

    expect(jobs).toEqual([
      {
        id: CAPTURE_ID.toString(),
        interfaceName: "eth0",
        bpfFilter: "port 53",
        maxDurationInSeconds: 60,
        maxPackets: 100,
        maxFileSizeInBytes: 1048576,
      },
      {
        id: SECOND_CAPTURE_ID.toString(),
        interfaceName: "any",
        bpfFilter: "",
        maxDurationInSeconds: 30,
        maxPackets: 10,
        maxFileSizeInBytes: 2097152,
      },
    ]);
  });
});

describe("findCapturesToStop", () => {
  test("marks this probe's Running captures as heard from, and keeps them running", async () => {
    const { service } = buildService();
    const statements: Array<RecordedStatement> = stubTransaction(service, [
      [
        [
          { _id: CAPTURE_ID.toString(), stopRequestedAt: null },
          { _id: SECOND_CAPTURE_ID.toString(), stopRequestedAt: null },
        ],
        2,
      ],
    ]);

    expect(
      await service.findCapturesToStop({
        probeId: PROBE_ID,
        runningPacketCaptureIds: [
          CAPTURE_ID.toString(),
          SECOND_CAPTURE_ID.toString(),
        ],
      }),
    ).toEqual([]);

    const update: RecordedStatement = statements[0]!;
    const sql: string = flatten(update.sql);

    expect(sql).toContain('UPDATE "PacketCapture"');
    expect(sql).toContain('SET "updatedAt" = now()');
    expect(sql).toContain('"_id" = ANY($1::uuid[])');
    expect(sql).toContain('"probeId" = $2');
    expect(sql).toContain('"status" = $3');
    expect(sql).toContain('"deletedAt" IS NULL');
    expect(sql).toContain('RETURNING "_id", "stopRequestedAt"');
    expect(update.params).toEqual([
      [CAPTURE_ID.toString(), SECOND_CAPTURE_ID.toString()],
      PROBE_ID.toString(),
      PacketCaptureStatus.Running,
    ]);
  });

  test("names the ones someone stopped from the dashboard", async () => {
    const { service } = buildService();
    stubTransaction(service, [
      [
        [
          { _id: CAPTURE_ID.toString(), stopRequestedAt: new Date() },
          { _id: SECOND_CAPTURE_ID.toString(), stopRequestedAt: null },
        ],
        2,
      ],
    ]);

    expect(
      await service.findCapturesToStop({
        probeId: PROBE_ID,
        runningPacketCaptureIds: [
          CAPTURE_ID.toString(),
          SECOND_CAPTURE_ID.toString(),
        ],
      }),
    ).toEqual([CAPTURE_ID.toString()]);
  });

  test("names the ones the server no longer has for this probe: deleted, failed, or never its own", async () => {
    const { service } = buildService();
    stubTransaction(service, [[{ _id: CAPTURE_ID.toString() }]]);

    expect(
      await service.findCapturesToStop({
        probeId: PROBE_ID,
        runningPacketCaptureIds: [
          CAPTURE_ID.toString(),
          SECOND_CAPTURE_ID.toString(),
        ],
      }),
    ).toEqual([SECOND_CAPTURE_ID.toString()]);
  });

  test("ids are read once each, in lower case, and one that is not an id is never put to the database", async () => {
    const { service } = buildService();
    const statements: Array<RecordedStatement> = stubTransaction(service, [
      [[{ _id: CAPTURE_ID.toString() }], 1],
    ]);

    expect(
      await service.findCapturesToStop({
        probeId: PROBE_ID,
        runningPacketCaptureIds: [
          CAPTURE_ID.toString().toUpperCase(),
          ` ${CAPTURE_ID.toString()} `,
          "not-an-id'; DROP TABLE x; --",
        ],
      }),
    ).toEqual(["not-an-id'; drop table x; --"]);

    expect(statements[0]!.params[0]).toEqual([CAPTURE_ID.toString()]);
  });

  test("no ids, no statement", async () => {
    const { service } = buildService();
    const statements: Array<RecordedStatement> = stubTransaction(service, []);

    expect(
      await service.findCapturesToStop({
        probeId: PROBE_ID,
        runningPacketCaptureIds: ["nope"],
      }),
    ).toEqual(["nope"]);
    expect(statements).toHaveLength(0);
  });

  test("an answer it cannot read keeps nothing running", async () => {
    const { service } = buildService();
    stubTransaction(service, ["unexpected"]);

    expect(
      await service.findCapturesToStop({
        probeId: PROBE_ID,
        runningPacketCaptureIds: [CAPTURE_ID.toString()],
      }),
    ).toEqual([CAPTURE_ID.toString()]);
  });
});

describe("recordFailure", () => {
  test("fails this probe's Running capture with the probe's reason", async () => {
    const { service } = buildService();
    const statements: Array<RecordedStatement> = stubTransaction(service, [
      [[{ _id: CAPTURE_ID.toString() }], 1],
    ]);

    expect(
      await service.recordFailure({
        probeId: PROBE_ID,
        packetCaptureId: CAPTURE_ID,
        statusMessage: "  tcpdump could not use the filter.  ",
      }),
    ).toBe(true);

    const update: RecordedStatement = statements[0]!;
    const sql: string = flatten(update.sql);

    expect(sql).toContain('"_id" = $1');
    expect(sql).toContain('"probeId" = $2');
    expect(sql).toContain('"status" = $5');
    expect(sql).toContain('"deletedAt" IS NULL');
    expect(sql).toContain('"completedAt" = now()');
    expect(update.params).toEqual([
      CAPTURE_ID.toString(),
      PROBE_ID.toString(),
      PacketCaptureStatus.Failed,
      "tcpdump could not use the filter.",
      PacketCaptureStatus.Running,
    ]);
  });

  test("with no reason, says the probe could not run it", async () => {
    const { service } = buildService();
    const statements: Array<RecordedStatement> = stubTransaction(service, [
      [[{ _id: CAPTURE_ID.toString() }], 1],
    ]);

    await service.recordFailure({
      probeId: PROBE_ID,
      packetCaptureId: CAPTURE_ID,
      statusMessage: "   ",
    });

    expect(statements[0]!.params[3]).toBe(
      "The probe could not run this capture.",
    );
  });

  test("a reason longer than the column is cut to fit, so the capture never stays Running", async () => {
    const { service } = buildService();
    const statements: Array<RecordedStatement> = stubTransaction(service, [
      [[{ _id: CAPTURE_ID.toString() }], 1],
    ]);

    await service.recordFailure({
      probeId: PROBE_ID,
      packetCaptureId: CAPTURE_ID,
      statusMessage: "x".repeat(ColumnLength.LongText + 100),
    });

    const message: string = statements[0]!.params[3] as string;

    expect(message).toHaveLength(ColumnLength.LongText);
    expect(message.endsWith("…")).toBe(true);
  });

  test("false when there is no such Running capture of this probe", async () => {
    const { service } = buildService();
    stubTransaction(service, [[[], 0]]);

    expect(
      await service.recordFailure({
        probeId: PROBE_ID,
        packetCaptureId: CAPTURE_ID,
        statusMessage: "x",
      }),
    ).toBe(false);
  });
});

describe("recordCompletion", () => {
  function runningCapture(
    overrides: Overrides<PacketCapture> = {},
  ): PacketCapture {
    const capture: PacketCapture = new PacketCapture(CAPTURE_ID);
    capture.projectId = PROJECT_ID;
    capture.interfaceName = "eth0";
    capture.maxFileSizeInMB = 1;
    capture.startedAt = new Date("2026-10-09T08:30:00Z");
    const probe: Probe = new Probe(PROBE_ID);
    probe.name = "Site A";
    capture.probe = probe;
    Object.assign(capture, overrides);
    return capture;
  }

  function stubCapture(
    service: PacketCaptureServiceType,
    capture: PacketCapture | null,
  ): Spy {
    return jest
      .spyOn(service, "findOneBy")
      .mockResolvedValue(capture as never) as unknown as Spy;
  }

  function stubFileCreate(): Spy {
    return jest.spyOn(FileService, "create").mockImplementation((async (
      createBy: CreateBy<File>,
    ) => {
      createBy.data.id = FILE_ID;
      return createBy.data;
    }) as never) as unknown as Spy;
  }

  function stubFileDelete(): Spy {
    return jest
      .spyOn(FileService, "hardDeleteBy")
      .mockResolvedValue(1 as never) as unknown as Spy;
  }

  test("reads only this probe's Running capture", async () => {
    const { service } = buildService();
    const read: Spy = stubCapture(service, null);

    expect(
      await service.recordCompletion({
        probeId: PROBE_ID,
        packetCaptureId: CAPTURE_ID,
        pcap: makePcap({ packetLengths: [60] }),
        endReason: PacketCaptureEndReason.DurationReached,
      }),
    ).toBe(false);

    const findOneBy: FindOneBy<PacketCapture> = read.mock
      .calls[0]![0] as FindOneBy<PacketCapture>;
    const query: JSONObject = findOneBy.query as unknown as JSONObject;

    expect(query["_id"]).toBe(CAPTURE_ID.toString());
    expect(query["probeId"]?.toString()).toBe(PROBE_ID.toString());
    expect(query["status"]).toBe(PacketCaptureStatus.Running);
    expect(findOneBy.props).toEqual({ isRoot: true });
  });

  test("stores the file as a private file of the capture's project and completes the capture with the packets it counted", async () => {
    const { service } = buildService();
    stubCapture(service, runningCapture());
    const create: Spy = stubFileCreate();
    const remove: Spy = stubFileDelete();
    const statements: Array<RecordedStatement> = stubTransaction(service, [
      [[{ _id: CAPTURE_ID.toString() }], 1],
    ]);
    const pcap: Buffer = makePcap({ packetLengths: [60, 1514, 98] });

    expect(
      await service.recordCompletion({
        probeId: PROBE_ID,
        packetCaptureId: CAPTURE_ID,
        pcap: pcap,
        endReason: PacketCaptureEndReason.PacketLimitReached,
      }),
    ).toBe(true);

    const createBy: CreateBy<File> = create.mock.calls[0]![0] as CreateBy<File>;

    expect((createBy.data.file as Buffer).equals(pcap)).toBe(true);
    expect(createBy.data.fileType).toBe(MimeType.pcap);
    expect(createBy.data.isPublic).toBe(false);
    expect(createBy.data.name).toBe(
      "packet-capture-site-a-eth0-2026-10-09T08-30-00Z.pcap",
    );
    expect(createBy.props.isRoot).toBe(true);
    expect(createBy.props.tenantId?.toString()).toBe(PROJECT_ID.toString());

    const update: RecordedStatement = statements[0]!;
    const sql: string = flatten(update.sql);

    expect(sql).toContain('"probeId" = $2');
    expect(sql).toContain('"status" = $9');
    expect(sql).toContain('"deletedAt" IS NULL');
    expect(update.params).toEqual([
      CAPTURE_ID.toString(),
      PROBE_ID.toString(),
      PacketCaptureStatus.Completed,
      PacketCaptureEndReason.PacketLimitReached,
      null,
      3,
      pcap.length,
      FILE_ID.toString(),
      PacketCaptureStatus.Running,
    ]);
    expect(remove.mock.calls).toHaveLength(0);
  });

  test("a half-written last packet is dropped from the file and from the count", async () => {
    const { service } = buildService();
    stubCapture(service, runningCapture());
    const create: Spy = stubFileCreate();
    const statements: Array<RecordedStatement> = stubTransaction(service, [
      [[{ _id: CAPTURE_ID.toString() }], 1],
    ]);
    const whole: Buffer = makePcap({ packetLengths: [60, 70] });
    const uploaded: Buffer = Buffer.concat([
      whole,
      makePcapRecord({ capturedLength: 80, index: 2 }).subarray(0, 20),
    ]);

    await service.recordCompletion({
      probeId: PROBE_ID,
      packetCaptureId: CAPTURE_ID,
      pcap: uploaded,
      endReason: PacketCaptureEndReason.StoppedFromDashboard,
    });

    const createBy: CreateBy<File> = create.mock.calls[0]![0] as CreateBy<File>;

    expect((createBy.data.file as Buffer).equals(whole)).toBe(true);
    expect(statements[0]!.params[5]).toBe(2);
    expect(statements[0]!.params[6]).toBe(pcapLength([60, 70]));
  });

  test("a capture that matched no packets completes with no file", async () => {
    const { service } = buildService();
    stubCapture(service, runningCapture());
    const create: Spy = stubFileCreate();

    for (const pcap of [null, Buffer.alloc(0), makePcapHeader()]) {
      const statements: Array<RecordedStatement> = stubTransaction(service, [
        [[{ _id: CAPTURE_ID.toString() }], 1],
      ]);

      expect(
        await service.recordCompletion({
          probeId: PROBE_ID,
          packetCaptureId: CAPTURE_ID,
          pcap: pcap,
          endReason: PacketCaptureEndReason.DurationReached,
        }),
      ).toBe(true);

      expect(statements[0]!.params.slice(5, 8)).toEqual([0, 0, null]);
    }

    expect(create.mock.calls).toHaveLength(0);
  });

  test("an upload that is not a pcap file is refused, and nothing is stored", async () => {
    const { service } = buildService();
    stubCapture(service, runningCapture());
    const create: Spy = stubFileCreate();

    expect(
      await refusal(
        service.recordCompletion({
          probeId: PROBE_ID,
          packetCaptureId: CAPTURE_ID,
          pcap: Buffer.from("<html>not a capture</html>"),
          endReason: PacketCaptureEndReason.DurationReached,
        }),
      ),
    ).toBe(NOT_A_PCAP_MESSAGE);
    expect(create.mock.calls).toHaveLength(0);
  });

  test("an upload larger than the capture's size limit is refused", async () => {
    const { service } = buildService();
    stubCapture(service, runningCapture({ maxFileSizeInMB: 1 }));
    const create: Spy = stubFileCreate();

    expect(
      await refusal(
        service.recordCompletion({
          probeId: PROBE_ID,
          packetCaptureId: CAPTURE_ID,
          pcap: makePcap({ packetLengths: [262144, 262144, 262144, 262144] }),
          endReason: PacketCaptureEndReason.FileSizeLimitReached,
        }),
      ),
    ).toBe(FILE_TOO_LARGE_MESSAGE);
    expect(create.mock.calls).toHaveLength(0);
  });

  test("a capture whose size limit was never written is held to the hard maximum", async () => {
    const { service } = buildService();
    stubCapture(service, runningCapture({ maxFileSizeInMB: undefined }));
    stubFileCreate();
    stubTransaction(service, [[[{ _id: CAPTURE_ID.toString() }], 1]]);

    expect(
      await service.recordCompletion({
        probeId: PROBE_ID,
        packetCaptureId: CAPTURE_ID,
        pcap: makePcap({
          packetLengths: [262144, 262144, 262144, 262144, 262144],
        }),
        endReason: PacketCaptureEndReason.DurationReached,
      }),
    ).toBe(true);
  });

  test("the probe's words are kept, an end reason it made up is not", async () => {
    const { service } = buildService();
    stubCapture(service, runningCapture());
    stubFileCreate();
    const statements: Array<RecordedStatement> = stubTransaction(service, [
      [[{ _id: CAPTURE_ID.toString() }], 1],
    ]);

    await service.recordCompletion({
      probeId: PROBE_ID,
      packetCaptureId: CAPTURE_ID,
      pcap: makePcap({ packetLengths: [60] }),
      endReason: "BecauseISaidSo" as unknown as PacketCaptureEndReason,
      statusMessage: " tcpdump stopped by itself: interface went down ",
    });

    expect(statements[0]!.params[3]).toBeNull();
    expect(statements[0]!.params[4]).toBe(
      "tcpdump stopped by itself: interface went down",
    );
  });

  test("a capture settled or deleted while the file was uploading keeps no file", async () => {
    const { service } = buildService();
    stubCapture(service, runningCapture());
    stubFileCreate();
    const remove: Spy = stubFileDelete();
    stubTransaction(service, [[[], 0]]);

    expect(
      await service.recordCompletion({
        probeId: PROBE_ID,
        packetCaptureId: CAPTURE_ID,
        pcap: makePcap({ packetLengths: [60] }),
        endReason: PacketCaptureEndReason.DurationReached,
      }),
    ).toBe(false);

    const deleteBy: DeleteBy<File> = remove.mock.calls[0]![0] as DeleteBy<File>;

    expect((deleteBy.query as JSONObject)["_id"]).toBe(FILE_ID.toString());
    expect(deleteBy.props).toEqual({ isRoot: true });
  });
});

describe("requestStop", () => {
  function stubCaptureStatus(
    service: PacketCaptureServiceType,
    status: PacketCaptureStatus | null,
  ): Spy {
    let capture: PacketCapture | null = null;

    if (status) {
      capture = new PacketCapture(CAPTURE_ID);
      capture.status = status;
    }

    return jest
      .spyOn(service, "findOneBy")
      .mockResolvedValue(capture as never) as unknown as Spy;
  }

  test("asks a Running capture of the project to stop, once", async () => {
    const { service } = buildService();
    const read: Spy = stubCaptureStatus(service, PacketCaptureStatus.Running);
    const statements: Array<RecordedStatement> = stubTransaction(service, [
      [[{ _id: CAPTURE_ID.toString() }], 1],
    ]);

    await service.requestStop({
      packetCaptureId: CAPTURE_ID,
      projectId: PROJECT_ID,
    });

    const query: JSONObject = (read.mock.calls[0]![0] as { query: JSONObject })
      .query;

    expect(query["_id"]).toBe(CAPTURE_ID.toString());
    expect(query["projectId"]?.toString()).toBe(PROJECT_ID.toString());

    const update: RecordedStatement = statements[0]!;
    const sql: string = flatten(update.sql);

    expect(sql).toContain(
      '"stopRequestedAt" = COALESCE("stopRequestedAt", now())',
    );
    expect(sql).toContain('"projectId" = $2');
    expect(sql).toContain('"status" = $3');
    expect(update.params).toEqual([
      CAPTURE_ID.toString(),
      PROJECT_ID.toString(),
      PacketCaptureStatus.Running,
    ]);
  });

  test("another project's capture, or none, is not found", async () => {
    const { service } = buildService();
    stubCaptureStatus(service, null);

    expect(
      await refusal(
        service.requestStop({
          packetCaptureId: CAPTURE_ID,
          projectId: OTHER_PROJECT_ID,
        }),
      ),
    ).toBe(PACKET_CAPTURE_NOT_FOUND_MESSAGE);
  });

  test("a capture that has not started is deleted instead", async () => {
    const { service } = buildService();
    stubCaptureStatus(service, PacketCaptureStatus.Pending);

    expect(
      await refusal(
        service.requestStop({
          packetCaptureId: CAPTURE_ID,
          projectId: PROJECT_ID,
        }),
      ),
    ).toBe(NOT_STARTED_MESSAGE);
  });

  test("a capture that has finished cannot be stopped", async () => {
    for (const status of [
      PacketCaptureStatus.Completed,
      PacketCaptureStatus.Failed,
    ]) {
      jest.restoreAllMocks();
      const { service } = buildService();
      stubCaptureStatus(service, status);

      expect(
        await refusal(
          service.requestStop({
            packetCaptureId: CAPTURE_ID,
            projectId: PROJECT_ID,
          }),
        ),
      ).toBe(ALREADY_FINISHED_MESSAGE);
    }
  });

  test("one that finished between the read and the write says so", async () => {
    const { service } = buildService();
    stubCaptureStatus(service, PacketCaptureStatus.Running);
    stubTransaction(service, [[[], 0]]);

    expect(
      await refusal(
        service.requestStop({
          packetCaptureId: CAPTURE_ID,
          projectId: PROJECT_ID,
        }),
      ),
    ).toBe(ALREADY_FINISHED_MESSAGE);
  });
});

describe("failStaleCaptures", () => {
  test("fails what was not picked up, what ran past its deadline and what its probe stopped naming, with the reason", async () => {
    const { service } = buildService();
    const statements: Array<RecordedStatement> = stubTransaction(service, [
      [[{ _id: CAPTURE_ID.toString() }], 1],
      [[], 0],
      [[{ _id: SECOND_CAPTURE_ID.toString() }, { _id: "x" }], 2],
    ]);

    const before: number = Date.now();
    const failed: number = await service.failStaleCaptures();
    const after: number = Date.now();

    expect(failed).toBe(3);
    expect(statements).toHaveLength(3);

    const [notPickedUp, pastDeadline, notHeardFrom] = statements as [
      RecordedStatement,
      RecordedStatement,
      RecordedStatement,
    ];

    expect(flatten(notPickedUp.sql)).toContain('"createdAt" < $4');
    expect(notPickedUp.params.slice(0, 3)).toEqual([
      PacketCaptureStatus.Failed,
      PICKUP_TIMEOUT_MESSAGE,
      PacketCaptureStatus.Pending,
    ]);
    expect((notPickedUp.params[3] as Date).getTime()).toBeGreaterThanOrEqual(
      before - PACKET_CAPTURE_PICKUP_TIMEOUT_IN_MINUTES * 60 * 1000,
    );
    expect((notPickedUp.params[3] as Date).getTime()).toBeLessThanOrEqual(
      after - PACKET_CAPTURE_PICKUP_TIMEOUT_IN_MINUTES * 60 * 1000,
    );

    expect(flatten(pastDeadline.sql)).toContain(
      `"startedAt" + ("maxDurationInSeconds" * INTERVAL '1 second') < $4`,
    );
    expect(pastDeadline.params.slice(0, 3)).toEqual([
      PacketCaptureStatus.Failed,
      UPLOAD_TIMEOUT_MESSAGE,
      PacketCaptureStatus.Running,
    ]);
    expect((pastDeadline.params[3] as Date).getTime()).toBeLessThanOrEqual(
      after - PACKET_CAPTURE_UPLOAD_GRACE_IN_MINUTES * 60 * 1000,
    );

    expect(flatten(notHeardFrom.sql)).toContain('"updatedAt" < $4');
    expect(notHeardFrom.params.slice(0, 3)).toEqual([
      PacketCaptureStatus.Failed,
      HEARTBEAT_TIMEOUT_MESSAGE,
      PacketCaptureStatus.Running,
    ]);
    expect((notHeardFrom.params[3] as Date).getTime()).toBeLessThanOrEqual(
      after - PACKET_CAPTURE_HEARTBEAT_TIMEOUT_IN_MINUTES * 60 * 1000,
    );

    for (const statement of statements) {
      expect(flatten(statement.sql)).toContain('"deletedAt" IS NULL');
      expect(flatten(statement.sql)).toContain('"completedAt" = now()');
    }
  });

  test("the reasons say what to check", () => {
    expect(PICKUP_TIMEOUT_MESSAGE).toBe(
      "The probe did not pick up this capture within 5 minutes. Check that the probe is connected and that packet capture is still turned on.",
    );
    expect(HEARTBEAT_TIMEOUT_MESSAGE).toContain("restarted");
  });
});

describe("deleteExpiredCaptures", () => {
  test("deletes captures past the retention period with their files, a batch at a time", async () => {
    const { service } = buildService();
    const fullBatch: Array<JSONObject> = [];

    for (let index: number = 0; index < 200; index++) {
      fullBatch.push({
        _id: `aaaaaaaa-0000-4000-8000-${index.toString().padStart(12, "0")}`,
        fileId: index === 0 ? FILE_ID.toString() : null,
      });
    }

    const statements: Array<RecordedStatement> = stubTransaction(service, [
      [fullBatch, 200],
      [],
      [
        [
          { _id: CAPTURE_ID.toString(), fileId: SECOND_FILE_ID.toString() },
          { _id: SECOND_CAPTURE_ID.toString(), fileId: "not-a-uuid" },
        ],
        2,
      ],
      [],
    ]);

    const before: number = Date.now();
    expect(await service.deleteExpiredCaptures()).toBe(202);

    expect(statements).toHaveLength(4);

    const [firstDelete, firstFiles, secondDelete, secondFiles] = statements as [
      RecordedStatement,
      RecordedStatement,
      RecordedStatement,
      RecordedStatement,
    ];

    expect(flatten(firstDelete.sql)).toContain('DELETE FROM "PacketCapture"');
    expect(flatten(firstDelete.sql)).toContain('"createdAt" < $1');
    expect(flatten(firstDelete.sql)).toContain('RETURNING "_id", "fileId"');
    expect(firstDelete.params[1]).toBe(200);

    const cutoff: number = (firstDelete.params[0] as Date).getTime();
    const retention: number =
      PACKET_CAPTURE_RETENTION_IN_DAYS * 24 * 3600 * 1000;
    expect(cutoff).toBeLessThanOrEqual(Date.now() - retention);
    expect(cutoff).toBeGreaterThanOrEqual(before - retention - 1000);

    expect(flatten(firstFiles.sql)).toBe(
      'DELETE FROM "File" WHERE "_id" = ANY($1::uuid[])',
    );
    expect(firstFiles.params).toEqual([[FILE_ID.toString()]]);

    expect(flatten(secondDelete.sql)).toContain('DELETE FROM "PacketCapture"');
    expect(secondFiles.params).toEqual([[SECOND_FILE_ID.toString()]]);
  });

  test("nothing expired, one statement", async () => {
    const { service } = buildService();
    const statements: Array<RecordedStatement> = stubTransaction(service, [
      [[], 0],
    ]);

    expect(await service.deleteExpiredCaptures()).toBe(0);
    expect(statements).toHaveLength(1);
  });
});

describe("deleting a capture deletes its file", () => {
  test("onBeforeDelete reads the files of the captures being deleted, in the request's project only", async () => {
    const { service, internals } = buildService();
    const capture: PacketCapture = new PacketCapture(CAPTURE_ID);
    capture.fileId = FILE_ID;
    const noFile: PacketCapture = new PacketCapture(SECOND_CAPTURE_ID);

    const find: Spy = jest
      .spyOn(service, "findBy")
      .mockResolvedValue([capture, noFile] as never) as unknown as Spy;

    const deleteBy: DeleteBy<PacketCapture> = {
      query: { _id: CAPTURE_ID.toString() },
      props: { tenantId: PROJECT_ID },
    } as unknown as DeleteBy<PacketCapture>;

    const result: OnDelete<PacketCapture> =
      await internals.onBeforeDelete(deleteBy);

    const findBy: FindBy<PacketCapture> = find.mock
      .calls[0]![0] as FindBy<PacketCapture>;
    const query: JSONObject = findBy.query as unknown as JSONObject;

    expect(query["_id"]).toBe(CAPTURE_ID.toString());
    expect(query["projectId"]?.toString()).toBe(PROJECT_ID.toString());
    expect(result.carryForward).toEqual([
      { captureId: CAPTURE_ID.toString(), fileId: FILE_ID },
    ]);
  });

  test("onDeleteSuccess deletes the files of the captures that were deleted, and only those", async () => {
    const { internals } = buildService();
    const remove: Spy = jest
      .spyOn(FileService, "hardDeleteBy")
      .mockResolvedValue(1 as never) as unknown as Spy;

    await internals.onDeleteSuccess(
      {
        deleteBy: {} as DeleteBy<PacketCapture>,
        carryForward: [
          { captureId: CAPTURE_ID.toString(), fileId: FILE_ID },
          { captureId: SECOND_CAPTURE_ID.toString(), fileId: SECOND_FILE_ID },
        ],
      },
      [new ObjectID(CAPTURE_ID.toString().toUpperCase())],
    );

    const deleteBy: DeleteBy<File> = remove.mock.calls[0]![0] as DeleteBy<File>;

    expect(JSON.stringify((deleteBy.query as JSONObject)["_id"])).toContain(
      FILE_ID.toString(),
    );
    expect(JSON.stringify((deleteBy.query as JSONObject)["_id"])).not.toContain(
      SECOND_FILE_ID.toString(),
    );
    expect(deleteBy.props).toEqual({ isRoot: true });
  });

  test("no files, no delete", async () => {
    const { internals } = buildService();
    const remove: Spy = jest
      .spyOn(FileService, "hardDeleteBy")
      .mockResolvedValue(1 as never) as unknown as Spy;

    await internals.onDeleteSuccess(
      { deleteBy: {} as DeleteBy<PacketCapture>, carryForward: null },
      [CAPTURE_ID],
    );

    expect(remove.mock.calls).toHaveLength(0);
  });
});

describe("recordProbeCapability", () => {
  test("keeps a project probe's report, written only when it changed", async () => {
    const { service } = buildService();
    stubProbe(probeRow());
    const statements: Array<RecordedStatement> = stubTransaction(service, [[]]);

    expect(
      await service.recordProbeCapability({
        probeId: PROBE_ID,
        capability: {
          isEnabled: true,
          isToolAvailable: true,
          interfaces: [{ name: "eth0", addresses: [] }],
          limits: {
            maxDurationInSeconds: 1800,
            maxPackets: 1000000,
            maxFileSizeInMB: 25,
          },
        },
      }),
    ).toBe(true);

    const update: RecordedStatement = statements[0]!;
    const sql: string = flatten(update.sql);

    expect(sql).toContain('UPDATE "Probe"');
    expect(sql).toContain('SET "packetCaptureCapability" = $2::jsonb');
    expect(sql).toContain('"projectId" IS NOT NULL');
    expect(sql).toContain(
      '"packetCaptureCapability" IS DISTINCT FROM $2::jsonb',
    );
    expect(update.params[0]).toBe(PROBE_ID.toString());
    expect(JSON.parse(update.params[1] as string)).toMatchObject({
      isEnabled: true,
      interfaces: [{ name: "eth0", addresses: [] }],
    });
  });

  test("a global probe's report is dropped: it never captures", async () => {
    for (const probe of [
      probeRow({ isGlobalProbe: true }),
      probeRow({ projectId: undefined }),
      null,
    ]) {
      jest.restoreAllMocks();
      const { service } = buildService();
      stubProbe(probe);
      const statements: Array<RecordedStatement> = stubTransaction(service, []);

      expect(
        await service.recordProbeCapability({
          probeId: PROBE_ID,
          capability: {
            isEnabled: true,
            isToolAvailable: true,
            interfaces: [],
            limits: {
              maxDurationInSeconds: 1800,
              maxPackets: 1000000,
              maxFileSizeInMB: 25,
            },
          },
        }),
      ).toBe(false);
      expect(statements).toHaveLength(0);
    }
  });
});

describe("the service is wired to its model", () => {
  test("it serves the PacketCapture table", () => {
    const { service } = buildService();

    expect(service.getModel().tableName).toBe("PacketCapture");
  });

  /*
   * onBeforeCreate checks these two against the project in its own words
   * (above), so the generic project check leaves them to it and checks the
   * rest (ProjectScopedReferencesEverywhere lists the service).
   */
  test("checks the probe and the network device itself", () => {
    const { service } = buildService();

    expect(
      (
        service as unknown as {
          getRelationsCheckedByService: () => Array<string>;
        }
      ).getRelationsCheckedByService(),
    ).toEqual(["probe", "networkDevice"]);
  });
});
