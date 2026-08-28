import NetworkDeviceDiscoveryScanService from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Probe from "../../../Models/DatabaseModels/Probe";
import ProbeService from "../../../Server/Services/ProbeService";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import ScanTargetUtil from "../../../Utils/NetworkDiscovery/ScanTargetUtil";
import ScanNameUtil from "../../../Utils/NetworkDiscovery/ScanNameUtil";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import OneUptimeDate from "../../../Types/Date";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * Contract under test: a discovery scan cannot be saved with a target the
 * probe would later refuse to sweep. Before this validation existed, a typo
 * was accepted, sat Pending until a probe claimed it, and surfaced minutes
 * later as a Failed scan — octet-range notation makes that mistake much
 * easier to make (a reversed range looks fine to the eye), so the check has
 * to happen at write time.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

/*
 * `cidr` is typed unknown, not string: this hook runs before the model's own
 * type and length checks, and BaseAPI assigns ShortText columns straight from
 * the request JSON — so a client that sends a number or an object really does
 * reach it with that value.
 */
function makeCreateBy(cidr?: unknown): CreateBy<NetworkDeviceDiscoveryScan> {
  const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
  scan.projectId = PROJECT_ID;
  scan.probeId = PROBE_ID;
  if (cidr !== undefined) {
    (scan as unknown as Record<string, unknown>)["cidr"] = cidr;
  }
  return {
    data: scan,
    props: { isRoot: true },
  };
}

/*
 * A scan with a valid target and whatever `name` the caller wants to try. The
 * name is written through a Record cast for the same reason the target is: the
 * hook runs before the model's own type checks, so a client really can send a
 * number or an object here.
 */
function makeCreateByWithName(
  name?: unknown,
): CreateBy<NetworkDeviceDiscoveryScan> {
  const createBy: CreateBy<NetworkDeviceDiscoveryScan> =
    makeCreateBy("192.168.1.0/24");

  if (name !== undefined) {
    (createBy.data as unknown as Record<string, unknown>)["name"] = name;
  }

  return createBy;
}

type CreatedNameFunction = (name?: unknown) => Promise<unknown>;

/*
 * What the hook would actually store in the column, for a given input.
 */
const createdName: CreatedNameFunction = async (
  name?: unknown,
): Promise<unknown> => {
  const createBy: CreateBy<NetworkDeviceDiscoveryScan> =
    makeCreateByWithName(name);

  await onBeforeCreate(createBy);

  return (createBy.data as unknown as Record<string, unknown>)["name"];
};

function makeUpdateBy(
  data: Record<string, unknown>,
): UpdateBy<NetworkDeviceDiscoveryScan> {
  return {
    query: { projectId: PROJECT_ID },
    data: data,
    props: { isRoot: true },
    limit: 1,
    skip: 0,
  } as unknown as UpdateBy<NetworkDeviceDiscoveryScan>;
}

type OnBeforeCreateFunction = (
  createBy: CreateBy<NetworkDeviceDiscoveryScan>,
) => Promise<unknown>;

type OnBeforeUpdateFunction = (
  updateBy: UpdateBy<NetworkDeviceDiscoveryScan>,
) => Promise<unknown>;

const onBeforeCreate: OnBeforeCreateFunction = (
  createBy: CreateBy<NetworkDeviceDiscoveryScan>,
): Promise<unknown> => {
  return (NetworkDeviceDiscoveryScanService as any).onBeforeCreate(createBy);
};

const onBeforeUpdate: OnBeforeUpdateFunction = (
  updateBy: UpdateBy<NetworkDeviceDiscoveryScan>,
): Promise<unknown> => {
  return (NetworkDeviceDiscoveryScanService as any).onBeforeUpdate(updateBy);
};

describe("NetworkDeviceDiscoveryScanService.onBeforeCreate", () => {
  it("accepts a CIDR target", async () => {
    await expect(
      onBeforeCreate(makeCreateBy("192.168.1.0/24")),
    ).resolves.toBeDefined();
  });

  it("accepts an octet-range target", async () => {
    await expect(
      onBeforeCreate(makeCreateBy("10.16-22.0-255.51-66")),
    ).resolves.toBeDefined();
  });

  it("accepts a single-host target", async () => {
    await expect(
      onBeforeCreate(makeCreateBy("10.0.0.5")),
    ).resolves.toBeDefined();
  });

  it("trims surrounding whitespace before validating", async () => {
    await expect(
      onBeforeCreate(makeCreateBy("  10.16-22.0-255.51-66  ")),
    ).resolves.toBeDefined();
  });

  it("rejects a missing target", async () => {
    await expect(onBeforeCreate(makeCreateBy())).rejects.toThrow(
      BadDataException,
    );
  });

  it("rejects an empty or whitespace-only target", async () => {
    await expect(onBeforeCreate(makeCreateBy(""))).rejects.toThrow(
      BadDataException,
    );
    await expect(onBeforeCreate(makeCreateBy("   "))).rejects.toThrow(
      BadDataException,
    );
  });

  it("rejects a malformed CIDR", async () => {
    await expect(onBeforeCreate(makeCreateBy("10.0.0.0/33"))).rejects.toThrow(
      /between \/0 and \/32/,
    );
    await expect(onBeforeCreate(makeCreateBy("not-a-target"))).rejects.toThrow(
      BadDataException,
    );
  });

  it("rejects a reversed octet range with a message naming the fix", async () => {
    await expect(
      onBeforeCreate(makeCreateBy("10.22-16.0.1-20")),
    ).rejects.toThrow(/reversed/);
  });

  it("rejects an out-of-range octet", async () => {
    await expect(onBeforeCreate(makeCreateBy("10.0.0.256"))).rejects.toThrow(
      /between 0 and 255/,
    );
  });

  /*
   * The size ceiling belongs on the form, not on a scan result: rejecting at
   * write time is the difference between an inline error and a probe being
   * handed a sweep it refuses minutes later.
   */
  it("rejects a target above the scan-size ceiling", async () => {
    await expect(onBeforeCreate(makeCreateBy("10.0.0.0/8"))).rejects.toThrow(
      /exceeding the/,
    );
    await expect(
      onBeforeCreate(makeCreateBy("10.0-255.0-255.1-10")),
    ).rejects.toThrow(/exceeding the/);
  });

  it("accepts a target exactly at the ceiling", async () => {
    const atLimit: string = "10.0.0-127.0-255";
    expect(ScanTargetUtil.countHosts(atLimit)).toBe(
      ScanTargetUtil.MAX_SCAN_HOSTS,
    );
    await expect(onBeforeCreate(makeCreateBy(atLimit))).resolves.toBeDefined();
  });

  /*
   * This hook is the FIRST thing to touch the raw request value:
   * DatabaseService.create runs it before checkRequiredFields, before the
   * column type/length checks and before the create-permission check, and
   * BaseAPI assigns a ShortText column straight from the JSON body. So a
   * client sending `"cidr": 42` reaches here with the number 42. Normalizing
   * the value in the hook (`(target || "").trim()`) would throw a TypeError
   * on every truthy non-string and turn the intended 400 into a 500.
   */
  it("rejects a non-string target with BadDataException, not a TypeError", async () => {
    for (const badValue of [
      42,
      true,
      {},
      [],
      ["10.0.0.0/24"],
      { value: "10.0.0.0/24" },
      0,
      null,
    ]) {
      await expect(onBeforeCreate(makeCreateBy(badValue))).rejects.toThrow(
        BadDataException,
      );
    }
  });

  it("rejects a non-string target on update too", async () => {
    await expect(onBeforeUpdate(makeUpdateBy({ cidr: 42 }))).rejects.toThrow(
      BadDataException,
    );
    await expect(onBeforeUpdate(makeUpdateBy({ cidr: {} }))).rejects.toThrow(
      BadDataException,
    );
  });

  /*
   * The error quotes the target back, so an unbounded target would be
   * amplified into the exception, the logs and the response body — and this
   * hook runs before the column's 100-character cap would have stopped it.
   */
  it("rejects an over-long target without echoing it", async () => {
    const huge: string = `1.2.3.${"9".repeat(100000)}`;

    await expect(onBeforeCreate(makeCreateBy(huge))).rejects.toThrow(
      /cannot be longer than/,
    );

    let message: string = "";
    try {
      await onBeforeCreate(makeCreateBy(huge));
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message.length).toBeLessThan(400);
  });

  it("returns the createBy unchanged so the write proceeds", async () => {
    const createBy: CreateBy<NetworkDeviceDiscoveryScan> =
      makeCreateBy("192.168.1.0/24");
    const result: any = await onBeforeCreate(createBy);
    expect(result.createBy).toBe(createBy);
    expect(result.createBy.data.cidr).toBe("192.168.1.0/24");
  });
});

describe("NetworkDeviceDiscoveryScanService.onBeforeUpdate", () => {
  /*
   * Every run-state write (claiming a scan, reporting a result, re-queueing a
   * recurring one) is an update that does NOT carry the target column. Those
   * must pass straight through — validating a column that is not being written
   * would break the entire scan lifecycle.
   */
  it("ignores updates that do not touch the target", async () => {
    await expect(
      onBeforeUpdate(
        makeUpdateBy({ status: "In Progress", startedAt: new Date(0) }),
      ),
    ).resolves.toBeDefined();
  });

  it("ignores an update with no data at all", async () => {
    await expect(onBeforeUpdate(makeUpdateBy({}))).resolves.toBeDefined();
  });

  it("validates a target carried by an update", async () => {
    await expect(
      onBeforeUpdate(makeUpdateBy({ cidr: "10.22-16.0.1" })),
    ).rejects.toThrow(BadDataException);
  });

  it("accepts a valid target carried by an update", async () => {
    await expect(
      onBeforeUpdate(makeUpdateBy({ cidr: "10.16-22.0-255.51-66" })),
    ).resolves.toBeDefined();
  });

  it("rejects an update that clears the target", async () => {
    await expect(onBeforeUpdate(makeUpdateBy({ cidr: null }))).rejects.toThrow(
      BadDataException,
    );
    await expect(onBeforeUpdate(makeUpdateBy({ cidr: "" }))).rejects.toThrow(
      BadDataException,
    );
  });
});

/*
 * The optional name (issue #3391). The hook does two things with it, and the
 * tests below separate them deliberately: it REJECTS what could never be
 * stored (a non-string, a value past the column width), and it NORMALIZES what
 * can be (trimming, folding onto one line, and turning a blank name into no
 * name at all). The messages are ScanNameUtil's, so the wizard's inline error
 * and the API's 400 are the same sentence.
 */
describe("NetworkDeviceDiscoveryScanService name validation on create", () => {
  it("accepts a scan with no name, because the field is optional", async () => {
    await expect(onBeforeCreate(makeCreateByWithName())).resolves.toBeDefined();
    await expect(createdName()).resolves.toBeUndefined();
  });

  it("accepts an ordinary name and stores it as typed", async () => {
    await expect(createdName("Router Discovery - Region 1100")).resolves.toBe(
      "Router Discovery - Region 1100",
    );
  });

  it("trims the name before storing it", async () => {
    await expect(createdName("  Switch Discovery  ")).resolves.toBe(
      "Switch Discovery",
    );
  });

  /*
   * A name pasted out of a spreadsheet cell arrives with a newline in it. The
   * list renders one line per scan and the probe inlines the name into log
   * messages, so the fold happens once, here, rather than at each reader.
   */
  it("folds a multi-line name onto one line", async () => {
    await expect(createdName("Router\nDiscovery   1100")).resolves.toBe(
      "Router Discovery 1100",
    );
  });

  /*
   * The distinction the column depends on: a blank box and an empty box are
   * the same statement, and both store nothing. An empty string would read as
   * a name to every caller that asks `scan.name ?`.
   */
  it("stores nothing at all for a blank name", async () => {
    await expect(createdName("")).resolves.toBeUndefined();
    await expect(createdName("   ")).resolves.toBeUndefined();
    await expect(createdName("\n\t")).resolves.toBeUndefined();
  });

  it("rejects a name that would not fit the column", async () => {
    await expect(
      onBeforeCreate(makeCreateByWithName("a".repeat(101))),
    ).rejects.toThrow(BadDataException);

    await expect(
      onBeforeCreate(makeCreateByWithName("a".repeat(100))),
    ).resolves.toBeDefined();
  });

  /*
   * The hook runs before the model's type checks, so this is the first thing
   * to see a client that sent the wrong shape. It must be a 400 rather than
   * the 500 an unguarded `.trim()` would produce.
   */
  it("rejects a name that is not text", async () => {
    for (const value of [1100, true, { name: "Router" }, ["Router"]]) {
      await expect(onBeforeCreate(makeCreateByWithName(value))).rejects.toThrow(
        BadDataException,
      );
    }
  });

  it("reports the same message the shared validator does", async () => {
    const tooLong: string = "a".repeat(101);

    await expect(onBeforeCreate(makeCreateByWithName(tooLong))).rejects.toThrow(
      ScanNameUtil.getValidationError(tooLong) as string,
    );
  });

  // The target is still validated when a name is present.
  it("still rejects a bad target on a named scan", async () => {
    const createBy: CreateBy<NetworkDeviceDiscoveryScan> =
      makeCreateBy("10.22-16.0.1");
    (createBy.data as unknown as Record<string, unknown>)["name"] =
      "Router Discovery";

    await expect(onBeforeCreate(createBy)).rejects.toThrow(BadDataException);
  });
});

describe("NetworkDeviceDiscoveryScanService name validation on update", () => {
  type UpdatedNameFunction = (name: unknown) => Promise<unknown>;

  const updatedName: UpdatedNameFunction = async (
    name: unknown,
  ): Promise<unknown> => {
    const updateBy: UpdateBy<NetworkDeviceDiscoveryScan> = makeUpdateBy({
      name: name,
    });

    await onBeforeUpdate(updateBy);

    return (updateBy.data as unknown as Record<string, unknown>)["name"];
  };

  /*
   * Renaming is the one edit a scan accepts, so this path is the product's,
   * not just a guard against root writers.
   */
  it("accepts and normalizes a rename", async () => {
    await expect(updatedName("  Switch Discovery — WB Units  ")).resolves.toBe(
      "Switch Discovery — WB Units",
    );
  });

  /*
   * The form posts an emptied box as an empty string. That means "this scan
   * has no name", which is NULL — not "", and not `undefined`, which TypeORM
   * would still try to write.
   */
  it("clears the name with null when the box is emptied", async () => {
    await expect(updatedName("")).resolves.toBeNull();
    await expect(updatedName("   ")).resolves.toBeNull();
    await expect(updatedName(null)).resolves.toBeNull();
  });

  it("rejects a rename that would not fit the column", async () => {
    await expect(
      onBeforeUpdate(makeUpdateBy({ name: "a".repeat(101) })),
    ).rejects.toThrow(BadDataException);
  });

  it("rejects a rename that is not text", async () => {
    await expect(onBeforeUpdate(makeUpdateBy({ name: 1100 }))).rejects.toThrow(
      BadDataException,
    );
  });

  /*
   * The probe claim path writes status/startedAt/statusMessage through the
   * hookless fast path, and every other run-state write goes through here
   * without a name. Touching the column on those updates would rewrite a name
   * nobody asked to change.
   */
  it("leaves an update that does not carry a name completely alone", async () => {
    const updateBy: UpdateBy<NetworkDeviceDiscoveryScan> = makeUpdateBy({
      status: "Completed",
      respondedHostCount: 3,
    });

    await onBeforeUpdate(updateBy);

    expect(Object.prototype.hasOwnProperty.call(updateBy.data, "name")).toBe(
      false,
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Editing a scan's settings after creation (OneUptime issue #3444).
 * ---------------------------------------------------------------------------
 *
 * The hooks stopped being pure the moment a scan's target and credentials
 * became editable: deciding whether a save actually CHANGED the sweep means
 * reading the row it is about to overwrite. So from here down the service's
 * two database calls are stubbed — `findBy` hands back the stored row, and
 * `updateColumnsByIdWithoutHooks` records the reconciling write instead of
 * making it — and the assertions are about what the hooks decide, not about
 * Postgres.
 */

const SCAN_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_PROBE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

interface ReconcileWrite {
  id: string;
  data: Record<string, unknown>;
}

interface StoredScanOverrides {
  status?: string;
  cidr?: string;
  probeId?: ObjectID;
  snmpVersion?: string | undefined;
  snmpCommunityString?: string | null | undefined;
  snmpPort?: number | undefined;
  snmpV3Username?: string | null | undefined;
  isRecurring?: boolean;
  rescanIntervalInMinutes?: number | null | undefined;
  completedAt?: Date | null | undefined;
  nextScanAt?: Date | null | undefined;
}

/*
 * A scan as it sits in the database: completed, one-time, sweeping a /24 with
 * a v2c community string. Every test below starts from this and changes the
 * one thing it is about.
 */
function storedScan(
  overrides?: StoredScanOverrides,
): NetworkDeviceDiscoveryScan {
  const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();

  scan._id = SCAN_ID.toString();
  scan.projectId = PROJECT_ID;
  scan.probeId = PROBE_ID;
  scan.cidr = "192.168.1.0/24";
  scan.status = "Completed";
  scan.snmpVersion = "V2c";
  scan.snmpCommunityString = "public";
  scan.snmpPort = 161;
  scan.isRecurring = false;

  Object.assign(scan, overrides || {});

  return scan;
}

let storedScans: Array<NetworkDeviceDiscoveryScan> = [];
// What the probe lookup finds. Null stands in for a probe that is not there.
let probeOnLookup: Probe | null = null;
let reconcileWrites: Array<ReconcileWrite> = [];
let lastFindByArgs: Record<string, unknown> | null = null;

beforeEach(() => {
  storedScans = [storedScan()];
  reconcileWrites = [];
  lastFindByArgs = null;

  /*
   * The probe a scan points at is looked up so it can be checked against the
   * scan's own project. By default it is one of this project's probes.
   */
  const probe: Probe = new Probe();
  probe._id = PROBE_ID.toString();
  probe.projectId = PROJECT_ID;
  probeOnLookup = probe;

  jest
    .spyOn(
      ProbeService as unknown as {
        findOneById: (args: Record<string, unknown>) => Promise<unknown>;
      },
      "findOneById",
    )
    .mockImplementation(async () => {
      return probeOnLookup;
    });

  jest
    .spyOn(
      NetworkDeviceDiscoveryScanService as unknown as {
        findBy: (args: Record<string, unknown>) => Promise<unknown>;
      },
      "findBy",
    )
    .mockImplementation(async (args: Record<string, unknown>) => {
      lastFindByArgs = args;

      return storedScans;
    });

  /*
   * The row as it stands after the write. onUpdateSuccess re-reads it rather
   * than predicting it from the payload, so the stub hands back the same
   * fixture the pre-image came from — with the update applied, exactly as the
   * database would have applied it.
   */
  jest
    .spyOn(
      NetworkDeviceDiscoveryScanService as unknown as {
        findOneById: (args: Record<string, unknown>) => Promise<unknown>;
      },
      "findOneById",
    )
    .mockImplementation(async () => {
      return storedScans[0] || null;
    });

  jest
    .spyOn(
      NetworkDeviceDiscoveryScanService as unknown as {
        updateColumnsByIdWithoutHooks: (input: {
          id: ObjectID;
          data: Record<string, unknown>;
        }) => Promise<void>;
      },
      "updateColumnsByIdWithoutHooks",
    )
    .mockImplementation(
      async (input: { id: ObjectID; data: Record<string, unknown> }) => {
        reconcileWrites.push({
          id: input.id.toString(),
          data: input.data,
        });
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * Run one settings save end to end through both hooks, exactly as
 * DatabaseService does: onBeforeUpdate, then the write, then onUpdateSuccess
 * with the ids the write touched.
 */
async function saveSettings(
  data: Record<string, unknown>,
  options?: { isRoot?: boolean },
): Promise<Array<ReconcileWrite>> {
  const updateBy: UpdateBy<NetworkDeviceDiscoveryScan> = {
    query: { _id: SCAN_ID },
    data: data,
    props: options?.isRoot
      ? { isRoot: true }
      : { isRoot: false, tenantId: PROJECT_ID },
    limit: 1,
    skip: 0,
  } as unknown as UpdateBy<NetworkDeviceDiscoveryScan>;

  const onUpdate: { updateBy: unknown; carryForward: unknown } =
    (await onBeforeUpdate(updateBy)) as {
      updateBy: unknown;
      carryForward: unknown;
    };

  /*
   * Stand in for the write itself, so the row onUpdateSuccess re-reads is the
   * row the update produced. Values are coerced the way the column types
   * would coerce them, which is the whole reason the hook reads the row back
   * instead of trusting the payload: a Number column posted as "60" is a
   * number by the time anybody reads it again.
   */
  const stored: NetworkDeviceDiscoveryScan | undefined = storedScans[0];

  if (stored) {
    for (const key of Object.keys(data)) {
      const value: unknown = data[key];

      if (key === "isRecurring") {
        stored.isRecurring = Boolean(value);
      } else if (key === "rescanIntervalInMinutes") {
        /*
         * Written through a cast because `exactOptionalPropertyTypes` forbids
         * assigning undefined to an optional property, and a cleared interval
         * is exactly that assignment.
         */
        (stored as unknown as Record<string, unknown>)[key] =
          value === null || value === undefined || value === ""
            ? undefined
            : Number(value);
      } else if (key !== "probe") {
        (stored as unknown as Record<string, unknown>)[key] = value;
      }
    }
  }

  await (NetworkDeviceDiscoveryScanService as any).onUpdateSuccess(onUpdate, [
    SCAN_ID,
  ]);

  return reconcileWrites;
}

/*
 * Everything the create wizard posts, unchanged from the stored row. This is
 * what the Edit dialog actually sends when the operator opens it and saves
 * without typing: ModelForm posts every field it declares, dirty or not.
 */
function unchangedSave(): Record<string, unknown> {
  return {
    name: "Region 1100",
    cidr: "192.168.1.0/24",
    probe: { _id: PROBE_ID.toString() },
    snmpVersion: "V2c",
    snmpCommunityString: "public",
    snmpPort: 161,
    snmpV3SecurityLevel: "",
    snmpV3Username: "",
    snmpV3AuthProtocol: "",
    snmpV3AuthKey: "",
    snmpV3PrivProtocol: "",
    snmpV3PrivKey: "",
    isRecurring: false,
    rescanIntervalInMinutes: null,
  };
}

describe("NetworkDeviceDiscoveryScanService: editing a scan's settings", () => {
  it("reads nothing for an update that touches neither settings nor schedule", async () => {
    const updateBy: UpdateBy<NetworkDeviceDiscoveryScan> = makeUpdateBy({
      status: "In Progress",
      startedAt: new Date(0),
      statusMessage: null,
    });

    const result: { updateBy: unknown; carryForward: unknown } =
      (await onBeforeUpdate(updateBy)) as {
        updateBy: unknown;
        carryForward: unknown;
      };

    expect(lastFindByArgs).toBeNull();
    expect(result.carryForward).toBeNull();
    expect(result.updateBy).toBe(updateBy);
  });

  it("reads nothing for a rename, so renaming can never re-queue a scan", async () => {
    const writes: Array<ReconcileWrite> = await saveSettings({
      name: "Region 1200",
    });

    expect(lastFindByArgs).toBeNull();
    expect(writes).toEqual([]);
  });

  /*
   * The hook runs BEFORE the permission layer scopes the query, and the API
   * hands the service a bare `{_id}`. Reading with that as root and no tenant
   * of our own would answer "does this id exist, and what are its SNMP
   * credentials" for every project on the instance.
   */
  it("scopes its read to the caller's project", async () => {
    await saveSettings({ cidr: "10.0.0.0/24" });

    expect(lastFindByArgs).not.toBeNull();
    expect((lastFindByArgs as any).query).toEqual({
      _id: SCAN_ID,
      projectId: PROJECT_ID,
    });
    expect((lastFindByArgs as any).props.isRoot).toBe(true);
  });

  it("leaves a root caller's query alone, since it has no tenant to scope to", async () => {
    await saveSettings({ cidr: "10.0.0.0/24" }, { isRoot: true });

    expect((lastFindByArgs as any).query).toEqual({ _id: SCAN_ID });
  });

  it("re-queues the scan and clears its results when the target changes", async () => {
    const writes: Array<ReconcileWrite> = await saveSettings({
      cidr: "10.0.0.0/24",
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]!.id).toBe(SCAN_ID.toString());
    expect(writes[0]!.data).toEqual({
      status: "Pending",
      startedAt: null,
      completedAt: null,
      nextScanAt: null,
      discoveredDevices: null,
      scannedHostCount: null,
      respondedHostCount: null,
      autoImportProcessedAt: null,
      /*
       * The row explains itself rather than going quiet: the operator saved a
       * change and the results they were looking at disappeared, and the scans
       * list renders this in the cell where those results used to be.
       */
      statusMessage: expect.stringContaining("queued to run again"),
    });
  });

  /*
   * Every column that decides what the probe sweeps, one at a time. Three of
   * them used to be covered and eight were not, which is exactly the shape of
   * gap that lets a column quietly fall out of the list: nothing fails, the
   * scan simply keeps advertising results from credentials it no longer has.
   */
  it("re-queues the scan when any single setting of the sweep changes", async () => {
    const changes: Record<string, unknown> = {
      cidr: "10.0.0.0/24",
      snmpVersion: "V3",
      snmpCommunityString: "private",
      snmpPort: 1161,
      snmpV3SecurityLevel: "authPriv",
      snmpV3Username: "netops",
      snmpV3AuthProtocol: "sha",
      snmpV3AuthKey: "auth-secret",
      snmpV3PrivProtocol: "aes",
      snmpV3PrivKey: "priv-secret",
    };

    for (const column of Object.keys(changes)) {
      reconcileWrites = [];
      storedScans = [storedScan()];

      const writes: Array<ReconcileWrite> = await saveSettings({
        ...unchangedSave(),
        [column]: changes[column],
      });

      expect({ column: column, retired: writes.length }).toEqual({
        column: column,
        retired: 1,
      });
      expect(writes[0]!.data["status"]).toBe("Pending");
    }
  });

  it("does nothing at all when the whole form is re-posted unchanged", async () => {
    const writes: Array<ReconcileWrite> = await saveSettings(unchangedSave());

    expect(writes).toEqual([]);
  });

  /*
   * The v3 columns of a v2c scan are NULL in the database and empty strings in
   * the form. Reading those as different values would retire a good result set
   * the first time anybody opened the dialog and pressed Save.
   */
  it("treats an empty box and an unset column as the same setting", async () => {
    storedScans = [
      storedScan({
        snmpCommunityString: null,
        snmpVersion: "V3",
        snmpV3Username: "netops",
      }),
    ];

    const writes: Array<ReconcileWrite> = await saveSettings({
      ...unchangedSave(),
      snmpVersion: "V3",
      snmpCommunityString: "",
      snmpV3Username: "netops",
    });

    expect(writes).toEqual([]);
  });

  /*
   * A Number field posts its contents as text, so clearing the box sends "" —
   * and "" into an integer column is a Postgres error, i.e. a bare 500 in
   * answer to "I do not want a custom port". Easy to reach only now that the
   * box arrives pre-filled.
   */
  it("reads an emptied number box as unset rather than as an empty string", async () => {
    const writes: Array<ReconcileWrite> = await saveSettings({
      ...unchangedSave(),
      snmpPort: "",
    });

    // Stored as NULL...
    expect(storedScans[0]!.snmpPort).toBeNull();
    // ...and it is a real change, so the scan sweeps again.
    expect(writes).toHaveLength(1);
    expect(writes[0]!.data["status"]).toBe("Pending");
  });

  it("reads an emptied interval box as unset too", async () => {
    const updateBy: UpdateBy<NetworkDeviceDiscoveryScan> = {
      query: { _id: SCAN_ID },
      data: { isRecurring: false, rescanIntervalInMinutes: "   " },
      props: { isRoot: false, tenantId: PROJECT_ID },
      limit: 1,
      skip: 0,
    } as unknown as UpdateBy<NetworkDeviceDiscoveryScan>;

    await onBeforeUpdate(updateBy);

    expect(
      (updateBy.data as unknown as Record<string, unknown>)[
        "rescanIntervalInMinutes"
      ],
    ).toBeNull();
  });

  it("re-queues when a credential changes", async () => {
    const writes: Array<ReconcileWrite> = await saveSettings({
      ...unchangedSave(),
      snmpCommunityString: "private",
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]!.data["status"]).toBe("Pending");
  });

  it("re-queues when the port changes, even though the form sends it as text", async () => {
    const writes: Array<ReconcileWrite> = await saveSettings({
      ...unchangedSave(),
      snmpPort: "1161",
    });

    expect(writes).toHaveLength(1);
  });

  it("does not re-queue when the port is re-sent as text unchanged", async () => {
    const writes: Array<ReconcileWrite> = await saveSettings({
      ...unchangedSave(),
      snmpPort: "161",
    });

    expect(writes).toEqual([]);
  });

  /*
   * The dashboard posts the relation object and server callers post the FK
   * column. A hook that understood only one spelling would silently ignore
   * every probe change made through the other.
   */
  it("re-queues when the probe changes, posted as a relation", async () => {
    const writes: Array<ReconcileWrite> = await saveSettings({
      ...unchangedSave(),
      probe: { _id: OTHER_PROBE_ID.toString() },
    });

    expect(writes).toHaveLength(1);
  });

  it("re-queues when the probe changes, posted as probeId", async () => {
    const writes: Array<ReconcileWrite> = await saveSettings({
      probeId: OTHER_PROBE_ID,
    });

    expect(writes).toHaveLength(1);
  });

  it("refuses to clear the probe rather than letting the column reject it", async () => {
    await expect(saveSettings({ probe: null })).rejects.toThrow(
      BadDataException,
    );
  });

  /*
   * A scan is dispatched by probe id alone: the claim endpoint hands a Pending
   * scan to whichever probe authenticates as that id, with no project check of
   * its own, and writes the hosts it reports back onto this row. Pointing a
   * scan at another project's probe is therefore pointing it at another
   * project's NETWORK — so the reference is checked wherever it can be
   * written.
   */
  it("refuses a probe that belongs to another project", async () => {
    const foreignProbe: Probe = new Probe();
    foreignProbe._id = OTHER_PROBE_ID.toString();
    foreignProbe.projectId = new ObjectID(
      "99999999-9999-4999-8999-999999999999",
    );
    probeOnLookup = foreignProbe;

    await expect(
      saveSettings({ probe: { _id: OTHER_PROBE_ID.toString() } }),
    ).rejects.toThrow(/another project/);
  });

  // A probe with no project of its own is a global probe: anyone may use it.
  it("accepts a global probe", async () => {
    const globalProbe: Probe = new Probe();
    globalProbe._id = OTHER_PROBE_ID.toString();
    probeOnLookup = globalProbe;

    const writes: Array<ReconcileWrite> = await saveSettings({
      probe: { _id: OTHER_PROBE_ID.toString() },
    });

    expect(writes).toHaveLength(1);
  });

  it("refuses a probe that does not exist", async () => {
    probeOnLookup = null;

    await expect(
      saveSettings({ probe: { _id: OTHER_PROBE_ID.toString() } }),
    ).rejects.toThrow(BadDataException);
  });

  /*
   * A payload pointing the FK column and the relation object at two different
   * probes must be refused rather than validated against whichever one TypeORM
   * happens to persist.
   */
  it("refuses a payload that names two different probes", async () => {
    await expect(
      saveSettings({
        probeId: PROBE_ID,
        probe: { _id: OTHER_PROBE_ID.toString() },
      }),
    ).rejects.toThrow(BadDataException);
  });

  it("checks the probe against the SCAN's project, not the caller's tenant", async () => {
    const otherProjectId: ObjectID = new ObjectID(
      "99999999-9999-4999-8999-999999999999",
    );

    // The scan belongs to another project; so does the probe being set.
    storedScans = [storedScan()];
    (storedScans[0] as NetworkDeviceDiscoveryScan).projectId = otherProjectId;

    const probeInThatProject: Probe = new Probe();
    probeInThatProject._id = OTHER_PROBE_ID.toString();
    probeInThatProject.projectId = otherProjectId;
    probeOnLookup = probeInThatProject;

    await expect(
      saveSettings({ probe: { _id: OTHER_PROBE_ID.toString() } }),
    ).resolves.toBeDefined();
  });

  it("abandons a run that is still in progress when the target changes", async () => {
    storedScans = [storedScan({ status: "In Progress" })];

    const writes: Array<ReconcileWrite> = await saveSettings({
      cidr: "10.0.0.0/24",
    });

    /*
     * Back to Pending, and startedAt cleared. The probe is still sweeping the
     * old target; when it reports, the result endpoint discards the result
     * precisely because the scan is Pending again.
     */
    expect(writes[0]!.data["status"]).toBe("Pending");
    expect(writes[0]!.data["startedAt"]).toBeNull();
  });

  /*
   * The hook plans for every row the update MATCHED, but the write may affect
   * fewer — a row hard-deleted in between, or a limit. Reconciling a row that
   * was not written would retire a scan nobody edited.
   */
  it("reconciles only the rows the write actually touched", async () => {
    const otherId: ObjectID = new ObjectID(
      "55555555-5555-4555-8555-555555555555",
    );

    const otherScan: NetworkDeviceDiscoveryScan = storedScan();
    otherScan._id = otherId.toString();

    storedScans = [storedScan(), otherScan];

    const updateBy: UpdateBy<NetworkDeviceDiscoveryScan> = {
      query: { projectId: PROJECT_ID },
      data: { cidr: "10.0.0.0/24" },
      props: { isRoot: false, tenantId: PROJECT_ID },
      limit: 2,
      skip: 0,
    } as unknown as UpdateBy<NetworkDeviceDiscoveryScan>;

    const onUpdate: { updateBy: unknown; carryForward: unknown } =
      (await onBeforeUpdate(updateBy)) as {
        updateBy: unknown;
        carryForward: unknown;
      };

    // Both rows were planned for...
    expect(
      Object.keys(onUpdate.carryForward as Record<string, unknown>).sort(),
    ).toEqual([SCAN_ID.toString(), otherId.toString()].sort());

    // ...but only one was written.
    await (NetworkDeviceDiscoveryScanService as any).onUpdateSuccess(onUpdate, [
      SCAN_ID,
    ]);

    expect(
      reconcileWrites.map((write: ReconcileWrite) => {
        return write.id;
      }),
    ).toEqual([SCAN_ID.toString()]);
  });
});

describe("NetworkDeviceDiscoveryScanService: when the next run is due", () => {
  const COMPLETED_AT: Date = OneUptimeDate.fromString(
    "2026-01-01T00:00:00.000Z",
  );

  /*
   * The bug this whole derivation exists for. Turning recurrence on for a scan
   * that had already finished used to write the flag and nothing else — and
   * the requeue worker matches on `nextScanAt <= now`, which is never true of
   * NULL. The list said "Every 60 min" over a scan that would never run again.
   */
  it("schedules a finished one-time scan the moment recurrence is turned on", async () => {
    storedScans = [
      storedScan({ status: "Completed", completedAt: COMPLETED_AT }),
    ];

    const writes: Array<ReconcileWrite> = await saveSettings({
      isRecurring: true,
      rescanIntervalInMinutes: 60,
    });

    expect(writes).toHaveLength(1);
    expect(
      OneUptimeDate.fromString(writes[0]!.data["nextScanAt"] as Date).getTime(),
    ).toBe(COMPLETED_AT.getTime() + 60 * 60 * 1000);
  });

  it("re-derives the next run when the interval is shortened", async () => {
    storedScans = [
      storedScan({
        status: "Completed",
        completedAt: COMPLETED_AT,
        isRecurring: true,
        rescanIntervalInMinutes: 1440,
        nextScanAt: OneUptimeDate.addRemoveMinutes(COMPLETED_AT, 1440),
      }),
    ];

    const writes: Array<ReconcileWrite> = await saveSettings({
      isRecurring: true,
      rescanIntervalInMinutes: 60,
    });

    /*
     * Measured from the last run, not from the save — so a scan whose cadence
     * was shortened past its own last completion reads as already due, which
     * is exactly what it is. Before this, the new cadence did not take effect
     * until one full OLD cadence had elapsed.
     */
    expect(writes).toHaveLength(1);
    expect(
      OneUptimeDate.fromString(writes[0]!.data["nextScanAt"] as Date).getTime(),
    ).toBe(COMPLETED_AT.getTime() + 60 * 60 * 1000);
  });

  /*
   * The form posts a Number field, and what arrives on the wire is not
   * guaranteed to be a number. Predicting the post-write schedule from the
   * payload would read "60" as "no cadence" and quietly unschedule a scan the
   * operator had just scheduled; the hook reads the stored row back instead,
   * where the column type has already had its say.
   */
  it("schedules from the stored value, not from whatever shape the request sent", async () => {
    storedScans = [
      storedScan({ status: "Completed", completedAt: COMPLETED_AT }),
    ];

    const writes: Array<ReconcileWrite> = await saveSettings({
      isRecurring: true,
      rescanIntervalInMinutes: "60",
    });

    expect(writes).toHaveLength(1);
    expect(
      OneUptimeDate.fromString(writes[0]!.data["nextScanAt"] as Date).getTime(),
    ).toBe(COMPLETED_AT.getTime() + 60 * 60 * 1000);
  });

  it("clears the next run when recurrence is turned off", async () => {
    storedScans = [
      storedScan({
        status: "Completed",
        completedAt: COMPLETED_AT,
        isRecurring: true,
        rescanIntervalInMinutes: 60,
        nextScanAt: OneUptimeDate.addRemoveMinutes(COMPLETED_AT, 60),
      }),
    ];

    const writes: Array<ReconcileWrite> = await saveSettings({
      isRecurring: false,
      rescanIntervalInMinutes: 60,
    });

    /*
     * A stale timestamp left behind here is not inert: turning recurrence back
     * on months later would find it already in the past and fire an immediate,
     * unasked-for sweep.
     *
     * The whole payload is asserted, not just the one key: turning recurrence
     * off must not touch the run — the scan keeps its results and its status,
     * and only its schedule changes.
     */
    expect(writes).toHaveLength(1);
    expect(writes[0]!.data).toEqual({ nextScanAt: null });
  });

  it("writes nothing when the schedule is re-posted unchanged", async () => {
    storedScans = [
      storedScan({
        status: "Completed",
        completedAt: COMPLETED_AT,
        isRecurring: true,
        rescanIntervalInMinutes: 60,
        nextScanAt: OneUptimeDate.addRemoveMinutes(COMPLETED_AT, 60),
      }),
    ];

    const writes: Array<ReconcileWrite> = await saveSettings({
      isRecurring: true,
      rescanIntervalInMinutes: 60,
    });

    expect(writes).toEqual([]);
  });

  it("clamps a sub-minimum interval instead of scheduling a sweep every minute", async () => {
    storedScans = [
      storedScan({ status: "Completed", completedAt: COMPLETED_AT }),
    ];

    const writes: Array<ReconcileWrite> = await saveSettings({
      isRecurring: true,
      rescanIntervalInMinutes: 1,
    });

    expect(
      OneUptimeDate.fromString(writes[0]!.data["nextScanAt"] as Date).getTime(),
    ).toBe(COMPLETED_AT.getTime() + 15 * 60 * 1000);
  });

  it("schedules nothing for a recurring scan with no interval", async () => {
    storedScans = [
      storedScan({ status: "Completed", completedAt: COMPLETED_AT }),
    ];

    const writes: Array<ReconcileWrite> = await saveSettings({
      isRecurring: true,
      rescanIntervalInMinutes: null,
    });

    expect(writes).toEqual([]);
  });

  /*
   * A scan that is queued or mid-sweep has a run coming already; the result
   * endpoint stamps the one after it. Scheduling from here would race it.
   */
  it("schedules nothing while a run is queued or in flight", async () => {
    for (const status of ["Pending", "In Progress"]) {
      reconcileWrites = [];
      storedScans = [storedScan({ status: status, completedAt: null })];

      const writes: Array<ReconcileWrite> = await saveSettings({
        isRecurring: true,
        rescanIntervalInMinutes: 60,
      });

      expect(writes).toEqual([]);
    }
  });

  it("schedules a failed run too, so a transient failure does not end the recurrence", async () => {
    storedScans = [storedScan({ status: "Failed", completedAt: COMPLETED_AT })];

    const writes: Array<ReconcileWrite> = await saveSettings({
      isRecurring: true,
      rescanIntervalInMinutes: 60,
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]!.data["nextScanAt"]).not.toBeNull();
  });

  /*
   * A save that never mentions the schedule must not move it. The stale-scan
   * reaper deliberately marks a stranded run due IMMEDIATELY rather than one
   * interval later, and re-deriving on an unrelated save would quietly push
   * that recovery out by a whole cadence.
   */
  it("leaves the schedule alone when the save did not ask about it", async () => {
    storedScans = [
      storedScan({
        status: "Failed",
        completedAt: COMPLETED_AT,
        isRecurring: true,
        rescanIntervalInMinutes: 60,
        // What the reaper writes: due now, not one interval after the failure.
        nextScanAt: COMPLETED_AT,
      }),
    ];

    const writes: Array<ReconcileWrite> = await saveSettings({
      cidr: "192.168.1.0/24",
      snmpCommunityString: "public",
    });

    expect(writes).toEqual([]);
  });

  /*
   * Both at once: the target changed AND the scan is recurring. The re-queue
   * wins — the run it would have been scheduled from no longer exists, and the
   * next one is scheduled when the new sweep reports.
   */
  it("leaves no next run scheduled when the sweep is re-queued", async () => {
    storedScans = [
      storedScan({
        status: "Completed",
        completedAt: COMPLETED_AT,
        isRecurring: true,
        rescanIntervalInMinutes: 60,
        nextScanAt: OneUptimeDate.addRemoveMinutes(COMPLETED_AT, 60),
      }),
    ];

    const writes: Array<ReconcileWrite> = await saveSettings({
      cidr: "10.0.0.0/24",
      isRecurring: true,
      rescanIntervalInMinutes: 60,
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]!.data["status"]).toBe("Pending");
    expect(writes[0]!.data["nextScanAt"]).toBeNull();
  });
});
