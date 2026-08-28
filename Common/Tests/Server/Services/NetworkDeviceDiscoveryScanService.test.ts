import NetworkDeviceDiscoveryScanService from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Probe from "../../../Models/DatabaseModels/Probe";
import ProbeService from "../../../Server/Services/ProbeService";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import ScanTargetUtil from "../../../Utils/NetworkDiscovery/ScanTargetUtil";
import ScanNameUtil from "../../../Utils/NetworkDiscovery/ScanNameUtil";
import SnmpScanConfigUtil, {
  DiscoveryScanSnmpConfig,
  LEGACY_SNMP_CONFIG_ID,
  MAX_SNMP_CONFIGS_PER_SCAN,
} from "../../../Utils/NetworkDiscovery/SnmpScanConfigUtil";
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
  /*
   * The scan's method (issue #3445).
   *
   * Read on exactly ONE of the two reads this fixture stands in for, and the
   * asymmetry is the service's, not the fixture's: the PRE-image
   * (onBeforeUpdate's findBy) selects the sweep columns but not this one, while
   * the post-write read (onUpdateSuccess's findOneById) selects it, because the
   * credential-list rebuild has to know whether the scan sends SNMP at all. So
   * setting this here changes what the rebuild sees and nothing about what the
   * change comparison sees.
   */
  isSnmpEnabled?: boolean;
  snmpConfigs?: Array<DiscoveryScanSnmpConfig> | null | undefined;
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
 * The stored row's credential list, in the EXACT shape the flattened columns
 * below it mirror to.
 *
 * That correspondence is the whole point of the fixture, not incidental
 * tidiness. `unchangedSave()` posts this list straight back, so the "does
 * nothing at all when the whole form is re-posted unchanged" test only proves
 * anything if the list the form sends and the list the row holds are the same
 * credentials expressed the same way. If they drifted apart, that test would
 * still pass for the wrong reason — every save would look like a credential
 * change, and the assertion that is supposed to catch it would be measuring
 * a fixture bug instead of the hook.
 *
 * The id is `LEGACY_SNMP_CONFIG_ID`, which is what the backfill migration
 * stamped onto every row that predates the column, so this is a real row's
 * shape rather than an invented one. Returned from a function rather than
 * held as a module constant because the hooks normalize the payload IN PLACE
 * and `saveSettings` copies it onto the stored row — a shared array would let
 * one test's write leak into the next test's pre-image.
 */
function storedSnmpConfigs(): Array<DiscoveryScanSnmpConfig> {
  return [
    {
      id: LEGACY_SNMP_CONFIG_ID,
      name: "Access switches",
      snmpVersion: "V2c",
      snmpCommunityString: "public",
      snmpPort: 161,
    },
  ];
}

/*
 * A scan as it sits in the database: completed, one-time, sweeping a /24 with
 * a v2c community string — held both as the ordered credential list the
 * product writes now and, mirrored from its first entry, in the flattened
 * columns an older probe still reads. Every test below starts from this and
 * changes the one thing it is about.
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
  scan.snmpConfigs = storedSnmpConfigs();
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
   *
   * PROJECTED THROUGH THE CALLER'S OWN `select`, which is not fixture
   * pedantry. onUpdateSuccess rebuilds the credential list of a scan saved
   * through the flattened columns alone, and it does that by asking
   * SnmpScanConfigUtil.resolve() for the row's credentials — a reader that
   * returns the row's LIST when it has one and falls back to the flattened
   * columns only when it does not. The rebuild therefore depends entirely on
   * `snmpConfigs` being absent from this read, which is exactly what the
   * select arranges. A stub that handed back the whole fixture would return
   * the OLD list to that reader, the rebuild would write back the very
   * credentials the save replaced, and every test about it would pass while
   * the flattened columns stayed shadowed in production.
   */
  jest
    .spyOn(
      NetworkDeviceDiscoveryScanService as unknown as {
        findOneById: (args: Record<string, unknown>) => Promise<unknown>;
      },
      "findOneById",
    )
    .mockImplementation(async (args: Record<string, unknown>) => {
      const stored: NetworkDeviceDiscoveryScan | undefined = storedScans[0];

      if (!stored) {
        return null;
      }

      const select: Record<string, unknown> = (args["select"] || {}) as Record<
        string,
        unknown
      >;

      const projected: NetworkDeviceDiscoveryScan =
        new NetworkDeviceDiscoveryScan();

      for (const column of Object.keys(select)) {
        (projected as unknown as Record<string, unknown>)[column] = (
          stored as unknown as Record<string, unknown>
        )[column];
      }

      return projected;
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

type HasSweepChangedFunction = (
  scan: NetworkDeviceDiscoveryScan,
  data: Record<string, unknown>,
) => boolean;

/*
 * The "did this save change what the probe sweeps?" comparison, asked on its
 * own rather than through a whole save.
 *
 * Used for exactly one question, and only because that question cannot be
 * reached the other way: an EMPTY credential list is refused by validation
 * (`applySnmpConfigs` throws before any comparison happens), so a save can
 * never carry one down to here. The comparison still has to answer it
 * correctly, because the shapes it must treat as equal — an unset column, a
 * null the hook writes for a cleared list, and an empty array — are decided
 * by the same normalizer, and a normalizer that disagreed with itself would
 * turn a no-op save into a run-retiring one.
 */
const hasSweepChanged: HasSweepChangedFunction = (
  scan: NetworkDeviceDiscoveryScan,
  data: Record<string, unknown>,
): boolean => {
  return (NetworkDeviceDiscoveryScanService as any).hasSweepChanged(
    scan,
    data,
    Object.keys(data),
  );
};

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
    /*
     * The SAME list the stored row holds, posted back verbatim — which is
     * exactly what the Edit dialog does, because its only SNMP control seeds
     * itself from this column and ModelForm posts every field it declares
     * whether the operator touched it or not.
     *
     * This entry is the single most load-bearing line in the fixture. If
     * `normalizeSweepValue` ever stopped comparing two structurally-equal
     * lists as equal, every visit to the Edit dialog would end in a save that
     * retired the scan's run and deleted the hosts it had found — silently,
     * with the operator having changed nothing.
     */
    snmpConfigs: storedSnmpConfigs(),
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
      /*
       * A DIFFERENT list, not a differently-spelled one: the stored config is
       * kept as entry one and a second credential set is appended, which is
       * the commonest real edit ("the core switches are on v3 as well"). The
       * flattened columns therefore mirror to the same values they already
       * hold, so the only thing that changed is the list itself — and if the
       * comparison for this column were the `String(value)` fall-through the
       * others use, both lists would stringify to "[object Object]" and the
       * scan would keep advertising hosts found with credentials it no longer
       * tries.
       */
      snmpConfigs: [
        ...storedSnmpConfigs(),
        {
          id: "core-routers",
          name: "Core routers",
          snmpVersion: "V3",
          snmpV3SecurityLevel: "authPriv",
          snmpV3Username: "netops",
          snmpV3AuthProtocol: "sha",
          snmpV3AuthKey: "auth-secret",
          snmpV3PrivProtocol: "aes",
          snmpV3PrivKey: "priv-secret",
        },
      ],
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
   * The same rule for the credential LIST, on the row shape it actually
   * matters for: a scan created before `snmpConfigs` existed, whose column is
   * still NULL, edited by an API caller that clears the list rather than
   * sending one. "No list" and "a list that was cleared" are the same
   * statement — the scan falls back to its flattened columns either way — so
   * neither may read as a change and throw away the run.
   */
  it("does not re-queue a scan with no stored list when the save clears the list", async () => {
    storedScans = [storedScan({ snmpConfigs: undefined })];

    const writes: Array<ReconcileWrite> = await saveSettings({
      ...unchangedSave(),
      snmpConfigs: null,
    });

    expect(writes).toEqual([]);
  });

  /*
   * And the shape the hooks refuse to let through, asked of the comparison
   * directly (see `hasSweepChanged` above for why it cannot be asked through
   * a save). An empty array from a form is the third spelling of "this scan
   * has no list of its own", and the normalizer folds all three onto the same
   * answer.
   */
  it("reads an empty credential list and an unset column as the same setting", () => {
    const scanWithNoList: NetworkDeviceDiscoveryScan = storedScan({
      snmpConfigs: undefined,
    });

    const emptyShapes: Array<[string, unknown]> = [
      ["an empty array", []],
      ["null", null],
      ["undefined", undefined],
      ["an empty string", ""],
    ];

    for (const [label, value] of emptyShapes) {
      expect({
        posted: label,
        changed: hasSweepChanged(scanWithNoList, { snmpConfigs: value }),
      }).toEqual({ posted: label, changed: false });
    }
  });

  /*
   * The negative control the test above needs to mean anything: the
   * comparison is not simply answering "no" for every list. A scan that DOES
   * hold credentials, handed an empty list, has genuinely lost them.
   */
  it("reads an emptied credential list as a change on a scan that had one", () => {
    expect(hasSweepChanged(storedScan(), { snmpConfigs: [] })).toBe(true);
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

    /*
     * This save DOES reconcile something, and deliberately: it was written
     * through the flattened columns alone, so the credential list is rebuilt
     * from them (issue #3458 — a null list is readable but not editable, and
     * the Edit dialog would open a blank card over it).
     *
     * What the test is about is what that write must NOT carry. Asserted as
     * the write's exact key set rather than as `not.toContain("nextScanAt")`,
     * so a future reconciliation that starts moving the schedule on an
     * unrelated save fails here instead of passing on a narrower assertion.
     */
    for (const write of writes) {
      expect(Object.keys(write.data)).toEqual(["snmpConfigs"]);
    }
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

/*
 * ---------------------------------------------------------------------------
 * The ordered SNMP credential list (OneUptime issue #3458).
 * ---------------------------------------------------------------------------
 *
 * A scan used to carry exactly ONE credential set, in the flattened
 * snmpVersion / snmpCommunityString / snmpPort / snmpV3* columns, and the
 * probe reused it for every address in the sweep. Real segments are not
 * shaped that way — access switches on v2c with one community, the core on
 * v3, printers on the factory default — so such a scan silently missed every
 * device speaking a version it was not configured for and reported "0
 * discovered" with no indication that anything had been skipped.
 *
 * The `snmpConfigs` column is that list. Everything below pins the four
 * things the service does with it, each of which is a way the column could
 * quietly go wrong:
 *
 *   1. Every scan the product CREATES ends up with a list, even one posted
 *      through the flattened columns alone. The Edit dialog's only SNMP
 *      control reads this column, so a scan without one would open showing an
 *      empty card over credentials the operator cannot see.
 *   2. A bad list is refused with the SHARED validator's sentence, as a 400 —
 *      not as the TypeError an unguarded `.map()` over a posted string would
 *      raise, which is a 500 for what is plainly a client mistake.
 *   3. A stored list is mirrored back onto the flattened columns, for probes
 *      that have never heard of it.
 *   4. An update written through the flattened columns alone is reconciled
 *      rather than silently ignored.
 */

/*
 * A create payload with a valid target and probe, plus whatever the caller
 * wants to post on top.
 *
 * `extra` is Record<string, unknown> for the same reason `cidr` is unknown at
 * the top of this file: the hook runs before the model's own type checks and
 * is the first thing to see the raw request JSON, so a jsonb column really
 * can arrive holding a string, a number or an object rather than a list.
 */
function makeCreateByWith(
  extra: Record<string, unknown>,
): CreateBy<NetworkDeviceDiscoveryScan> {
  const createBy: CreateBy<NetworkDeviceDiscoveryScan> =
    makeCreateBy("192.168.1.0/24");

  Object.assign(createBy.data as unknown as Record<string, unknown>, extra);

  return createBy;
}

type CreatedRowFunction = (
  extra: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/*
 * The row as the create hook would hand it to the database. The hook rewrites
 * its input in place — the list is validated, normalized and given ids — so
 * what is asserted on is the payload AFTER the hook, not the one posted.
 */
const createdRow: CreatedRowFunction = async (
  extra: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const createBy: CreateBy<NetworkDeviceDiscoveryScan> =
    makeCreateByWith(extra);

  await onBeforeCreate(createBy);

  return createBy.data as unknown as Record<string, unknown>;
};

type UpdatedRowFunction = (
  data: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/*
 * The same thing for an update: the payload the write would actually carry,
 * once the hook has normalized the list and mirrored it onto the flattened
 * columns.
 */
const updatedRow: UpdatedRowFunction = async (
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  await onBeforeUpdate(makeUpdateBy(data));

  return data;
};

type CaptureErrorFunction = (
  run: () => Promise<unknown>,
) => Promise<Error | null>;

/*
 * The error a hook threw, as a value rather than as a matcher.
 *
 * `rejects.toThrow` proves that SOMETHING was thrown; the loops below have to
 * prove two harder things about the same throw at once. That it is a
 * BadDataException — a 400 — rather than the TypeError an unguarded
 * `.map()`/`.length` over a posted string or number would raise, which is a
 * 500 in answer to a client mistake. And that its sentence is the shared
 * validator's own, so the wizard's inline error and the API's 400 are the
 * same words rather than two descriptions of the same rule that can drift
 * apart.
 *
 * Returning the error also lets each case name itself in the assertion, which
 * is what makes a failure inside a table-driven loop readable.
 */
const captureError: CaptureErrorFunction = async (
  run: () => Promise<unknown>,
): Promise<Error | null> => {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }

  return null;
};

/*
 * One v3 credential set, complete. Used wherever a test needs a config whose
 * every flattened counterpart has a value, so that "was this mirrored?" can
 * be asked of all nine columns rather than of the two a v2c config fills in.
 */
function coreRoutersConfig(): DiscoveryScanSnmpConfig {
  return {
    id: "core-routers",
    name: "Core routers",
    snmpVersion: "V3",
    snmpPort: 1161,
    snmpV3SecurityLevel: "authPriv",
    snmpV3Username: "netops",
    snmpV3AuthProtocol: "SHA",
    snmpV3AuthKey: "auth-secret",
    snmpV3PrivProtocol: "AES",
    snmpV3PrivKey: "priv-secret",
  };
}

describe("NetworkDeviceDiscoveryScanService: the credential list on create", () => {
  /*
   * The invariant the Edit dialog depends on. That form's only SNMP control
   * is the list editor, so it selects `snmpConfigs` and nothing else — a scan
   * whose list were NULL would open with one empty card, and saving it would
   * replace credentials the operator never saw. The reader still falls back
   * to the flattened columns, because rows written out of band exist; this
   * only means the product never creates one.
   */
  it("derives a one-entry list from the flattened columns when the payload has none", async () => {
    const row: Record<string, unknown> = await createdRow({
      snmpVersion: "V3",
      snmpCommunityString: "private",
      snmpPort: 1161,
      snmpV3SecurityLevel: "authPriv",
      snmpV3Username: "netops",
      snmpV3AuthProtocol: "SHA",
      snmpV3AuthKey: "auth-secret",
      snmpV3PrivProtocol: "AES",
      snmpV3PrivKey: "priv-secret",
    });

    /*
     * The id is the synthetic "legacy" one, which is the same id the backfill
     * migration wrote onto every historical row and the same one the reader
     * synthesizes for a scan with no list — so a scan created this way is
     * indistinguishable from one that predates the column.
     */
    expect(row["snmpConfigs"]).toEqual([
      {
        id: LEGACY_SNMP_CONFIG_ID,
        snmpVersion: "V3",
        snmpCommunityString: "private",
        snmpPort: 1161,
        snmpV3SecurityLevel: "authPriv",
        snmpV3Username: "netops",
        snmpV3AuthProtocol: "SHA",
        snmpV3AuthKey: "auth-secret",
        snmpV3PrivProtocol: "AES",
        snmpV3PrivKey: "priv-secret",
      },
    ]);
  });

  /*
   * The bare case, which is the one an integration written before this column
   * existed actually posts: a target and a probe and nothing else. The
   * version defaults to the same v2c the probe would have swept with.
   */
  it("gives even a scan created with no SNMP settings at all a list", async () => {
    const row: Record<string, unknown> = await createdRow({});

    expect(row["snmpConfigs"]).toEqual([
      { id: LEGACY_SNMP_CONFIG_ID, snmpVersion: "V2c" },
    ]);
  });

  it("leaves a supplied list alone rather than deriving over it", async () => {
    const row: Record<string, unknown> = await createdRow({
      snmpConfigs: [
        {
          id: "access-switches",
          name: "Access switches",
          snmpVersion: "V2c",
          snmpCommunityString: "public",
        },
        coreRoutersConfig(),
      ],
    });

    const configs: Array<DiscoveryScanSnmpConfig> = row[
      "snmpConfigs"
    ] as Array<DiscoveryScanSnmpConfig>;

    /*
     * Both entries survive, in the order they were posted. Order is not
     * cosmetic: it is the order the probe tries them in per host, and the
     * first entry is the one mirrored onto the flattened columns.
     */
    expect(
      configs.map((config: DiscoveryScanSnmpConfig): string | undefined => {
        return config.id;
      }),
    ).toEqual(["access-switches", "core-routers"]);
  });

  /*
   * THE CREATE-PATH MIRROR, and a regression test for a bug that shipped
   * nowhere but got as far as review.
   *
   * `createBy.data` is a model INSTANCE, and every column on this model is
   * declared as a class field with `= undefined` — so `Object.keys()` on a
   * freshly built scan returns all thirty-seven column names no matter what
   * the client posted. The hook originally handed that straight to the mirror,
   * whose "the payload wins where it speaks for itself" guard then fired for
   * all nine flattened columns on every create, and the mirror became a
   * permanent no-op on the one path that needs it most.
   *
   * What that cost: the wizard's SNMP step posts `snmpConfigs` and nothing
   * else, so a scan created through the product stored a v3 credential set in
   * the list while its flattened columns kept the bare Postgres defaults —
   * and every probe running a version that predates the list swept it with
   * v2c/"public"/161 and reported the confident zero the whole feature exists
   * to stop. Invisible in the UI, invisible in the row, visible only as a
   * subnet that finds nothing.
   *
   * The fix is to pass the keys the client actually SUPPLIED (a posted column
   * carries a defined value; an untouched one does not), which is the
   * distinction the guard wanted in the first place. This test is written
   * against the observable behaviour rather than the key list, so it stays
   * true whatever shape the payload arrives in.
   */
  it("mirrors the first config onto the flattened columns, for probes that predate the list", async () => {
    const row: Record<string, unknown> = await createdRow({
      snmpConfigs: [coreRoutersConfig(), ...storedSnmpConfigs()],
    });

    expect({
      snmpVersion: row["snmpVersion"],
      snmpCommunityString: row["snmpCommunityString"],
      snmpPort: row["snmpPort"],
      snmpV3SecurityLevel: row["snmpV3SecurityLevel"],
      snmpV3Username: row["snmpV3Username"],
      snmpV3AuthProtocol: row["snmpV3AuthProtocol"],
      snmpV3AuthKey: row["snmpV3AuthKey"],
      snmpV3PrivProtocol: row["snmpV3PrivProtocol"],
      snmpV3PrivKey: row["snmpV3PrivKey"],
    }).toEqual({
      snmpVersion: "V3",
      snmpCommunityString: null,
      snmpPort: 1161,
      snmpV3SecurityLevel: "authPriv",
      snmpV3Username: "netops",
      snmpV3AuthProtocol: "SHA",
      snmpV3AuthKey: "auth-secret",
      snmpV3PrivProtocol: "AES",
      snmpV3PrivKey: "priv-secret",
    });
  });

  /*
   * The other half of the same guard, and the reason the fix tests for a
   * DEFINED value rather than simply mirroring everything: a caller that
   * really did send a flattened column meant it, and must read back what it
   * sent.
   */
  it("still leaves a flattened column the create payload named for itself alone", async () => {
    const row: Record<string, unknown> = await createdRow({
      snmpConfigs: [coreRoutersConfig()],
      snmpCommunityString: "operator-typed",
    });

    expect(row["snmpCommunityString"]).toBe("operator-typed");
    // ...while the columns the payload said nothing about are still mirrored.
    expect(row["snmpVersion"]).toBe("V3");
    expect(row["snmpV3Username"]).toBe("netops");
  });

  /*
   * A scan created with no SNMP settings at all: the derived list and the
   * flattened columns have to agree, or the two readers (a current probe on
   * the list, an older one on the columns) would sweep the same subnet
   * differently.
   */
  it("leaves the flattened columns to their own defaults when the list was derived from them", async () => {
    const row: Record<string, unknown> = await createdRow({});

    expect(row["snmpConfigs"]).toEqual([
      { id: LEGACY_SNMP_CONFIG_ID, snmpVersion: "V2c" },
    ]);
    /*
     * Untouched — the derive path has nothing to mirror BACK, since the list
     * it just built came from these columns. They stay undefined so Postgres
     * applies the same "V2c"/161 defaults the derived config already names.
     */
    expect(row["snmpVersion"]).toBeUndefined();
    expect(row["snmpCommunityString"]).toBeUndefined();
  });
});

/*
 * Every shape the column can arrive holding that must be refused, with the
 * sentence the operator would have seen on the form.
 *
 * These are not hypothetical shapes. A jsonb column has no type check of its
 * own, this hook runs before the model's, and the list is the one field of
 * this form that is not a plain input — so "the client sent a string" is the
 * ordinary failure of an API caller reading the docs, not an attack.
 */
const INVALID_LISTS: Array<[string, unknown]> = [
  ["a bare string where a list belongs", "V2c"],
  ["an object where a list belongs", { snmpVersion: "V2c" }],
  ["a number where a list belongs", 161],
  ["an empty list", []],
  ["a v3 config with no username", [{ id: "core-routers", snmpVersion: "V3" }]],
];

/*
 * The ceiling, built rather than written out: every extra config costs
 * another SNMP timeout on each address that answers nothing, so a long list
 * can push a large sweep past the probe's time limit.
 */
const OVERSIZED_LIST: Array<DiscoveryScanSnmpConfig> = [];

for (let index: number = 0; index < MAX_SNMP_CONFIGS_PER_SCAN + 1; index++) {
  OVERSIZED_LIST.push({
    id: `config-${index}`,
    snmpVersion: "V2c",
    snmpCommunityString: "public",
  });
}

INVALID_LISTS.push([
  `a list of ${MAX_SNMP_CONFIGS_PER_SCAN + 1} configs`,
  OVERSIZED_LIST,
]);

describe("NetworkDeviceDiscoveryScanService: validating the credential list", () => {
  it("rejects an invalid list on create with the shared validator's own message", async () => {
    for (const [label, value] of INVALID_LISTS) {
      const error: Error | null = await captureError((): Promise<unknown> => {
        return onBeforeCreate(makeCreateByWith({ snmpConfigs: value }));
      });

      expect({
        posted: label,
        isBadData: error instanceof BadDataException,
        message: error?.message,
      }).toEqual({
        posted: label,
        isBadData: true,
        message: SnmpScanConfigUtil.getValidationError(value),
      });
    }
  });

  it("rejects an invalid list on update with the shared validator's own message", async () => {
    for (const [label, value] of INVALID_LISTS) {
      const error: Error | null = await captureError((): Promise<unknown> => {
        return onBeforeUpdate(makeUpdateBy({ snmpConfigs: value }));
      });

      expect({
        posted: label,
        isBadData: error instanceof BadDataException,
        message: error?.message,
      }).toEqual({
        posted: label,
        isBadData: true,
        message: SnmpScanConfigUtil.getValidationError(value),
      });
    }
  });

  /*
   * A v3 config whose security level asks for authentication with nothing to
   * authenticate with does not fail loudly: the session is simply rejected by
   * every device, host after host, and the scan reports zero. Named
   * separately from the loop above because it is the failure mode this
   * validation exists for.
   */
  it("rejects a v3 config whose security level has no key to go with it", async () => {
    const error: Error | null = await captureError((): Promise<unknown> => {
      return onBeforeUpdate(
        makeUpdateBy({
          snmpConfigs: [
            {
              id: "core-routers",
              snmpVersion: "V3",
              snmpV3Username: "netops",
              snmpV3SecurityLevel: "authPriv",
              snmpV3AuthKey: "auth-secret",
            },
          ],
        }),
      );
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toContain("privacy key");
  });

  /*
   * The message names WHICH card is wrong. With five credential sets on
   * screen, "SNMP v3 Username is required" on its own is not something an
   * operator can act on.
   */
  it("names the offending config's position in the list", async () => {
    const error: Error | null = await captureError((): Promise<unknown> => {
      return onBeforeUpdate(
        makeUpdateBy({
          snmpConfigs: [
            { id: "access-switches", snmpVersion: "V2c" },
            { id: "core-routers", snmpVersion: "V3" },
          ],
        }),
      );
    });

    expect(error?.message).toContain("SNMP config 2");
  });

  // A valid list is accepted, so the rejections above are not vacuous.
  it("accepts a well-formed multi-config list", async () => {
    await expect(
      onBeforeUpdate(
        makeUpdateBy({
          snmpConfigs: [...storedSnmpConfigs(), coreRoutersConfig()],
        }),
      ),
    ).resolves.toBeDefined();
  });
});

describe("NetworkDeviceDiscoveryScanService: normalizing the credential list on write", () => {
  /*
   * An id has to be minted rather than left positional. The probe stamps the
   * answering config's id onto each discovered host and the importer resolves
   * the host's credentials back out of the list by that id — so an id derived
   * from a config's POSITION would re-point every host below a deleted card
   * at a different credential set, and those hosts would then be imported
   * with a community string that does not work.
   */
  it("mints a real id for a config that arrives without one", async () => {
    const row: Record<string, unknown> = await updatedRow({
      snmpConfigs: [{ snmpVersion: "V2c", snmpCommunityString: "public" }],
    });

    const configs: Array<DiscoveryScanSnmpConfig> = row[
      "snmpConfigs"
    ] as Array<DiscoveryScanSnmpConfig>;

    expect(configs).toHaveLength(1);
    expect(ObjectID.isValidUUID(configs[0]!.id as string)).toBe(true);
    // Specifically NOT the index-derived id the reader falls back to.
    expect(configs[0]!.id).not.toBe("config-1");
  });

  /*
   * And the other half of the same rule: an id that arrived is kept, because
   * results the probe has already stamped name it.
   */
  it("keeps the id a config arrived with", async () => {
    const row: Record<string, unknown> = await updatedRow({
      snmpConfigs: [coreRoutersConfig()],
    });

    expect((row["snmpConfigs"] as Array<DiscoveryScanSnmpConfig>)[0]!.id).toBe(
      "core-routers",
    );
  });

  /*
   * Everything a form can post loosely, tightened once at the write rather
   * than at each of the four readers (probe, importer, form, service). The
   * version in particular is normalized to the stored spelling, so a
   * hand-written "3" cannot make the same credentials read as a CHANGE the
   * next time the form posts "V3" back.
   */
  it("trims every string, coerces the port and normalizes the version", async () => {
    const row: Record<string, unknown> = await updatedRow({
      snmpConfigs: [
        {
          id: "  core-routers  ",
          name: "  Core routers  ",
          snmpVersion: "3",
          snmpCommunityString: "  private  ",
          snmpPort: "1161",
          snmpV3SecurityLevel: "  authPriv  ",
          snmpV3Username: "  netops  ",
          snmpV3AuthProtocol: "  SHA  ",
          snmpV3AuthKey: "  auth-secret  ",
          snmpV3PrivProtocol: "  AES  ",
          snmpV3PrivKey: "  priv-secret  ",
        },
      ],
    });

    expect(row["snmpConfigs"]).toEqual([
      {
        id: "core-routers",
        name: "Core routers",
        snmpVersion: "V3",
        snmpCommunityString: "private",
        snmpPort: 1161,
        snmpV3SecurityLevel: "authPriv",
        snmpV3Username: "netops",
        snmpV3AuthProtocol: "SHA",
        snmpV3AuthKey: "auth-secret",
        snmpV3PrivProtocol: "AES",
        snmpV3PrivKey: "priv-secret",
      },
    ]);
  });
});

/*
 * THE MIRROR.
 *
 * A probe is deployed separately from the server and is routinely a version
 * behind. A probe that has never heard of `snmpConfigs` reads the flattened
 * columns and NOTHING ELSE — so without this, saving a multi-config scan
 * would leave those columns holding whatever the scan was created with, or
 * the bare column defaults (v2c / "public" / 161), and every older probe in
 * the fleet would sweep with credentials nobody chose and report a confident
 * zero. The operator would see a scan that finds nothing and no indication
 * anywhere that the credentials it advertises are not the ones it is using.
 *
 * The FIRST config specifically, because that is the one such a probe would
 * have been handed under the old single-config UI, and because the list is
 * ordered by the operator's own preference.
 */
describe("NetworkDeviceDiscoveryScanService: mirroring the list onto the flattened columns", () => {
  it("writes the nine flattened columns from the list's first config", async () => {
    const row: Record<string, unknown> = await updatedRow({
      snmpConfigs: [coreRoutersConfig(), ...storedSnmpConfigs()],
    });

    /*
     * All nine asserted together, and the second config's own community
     * string ("public") must NOT appear among them — that is the assertion
     * that the FIRST entry is the one mirrored, rather than the last one
     * written or a merge of the two.
     */
    expect({
      snmpVersion: row["snmpVersion"],
      snmpCommunityString: row["snmpCommunityString"],
      snmpPort: row["snmpPort"],
      snmpV3SecurityLevel: row["snmpV3SecurityLevel"],
      snmpV3Username: row["snmpV3Username"],
      snmpV3AuthProtocol: row["snmpV3AuthProtocol"],
      snmpV3AuthKey: row["snmpV3AuthKey"],
      snmpV3PrivProtocol: row["snmpV3PrivProtocol"],
      snmpV3PrivKey: row["snmpV3PrivKey"],
    }).toEqual({
      snmpVersion: "V3",
      snmpCommunityString: null,
      snmpPort: 1161,
      snmpV3SecurityLevel: "authPriv",
      snmpV3Username: "netops",
      snmpV3AuthProtocol: "SHA",
      snmpV3AuthKey: "auth-secret",
      snmpV3PrivProtocol: "AES",
      snmpV3PrivKey: "priv-secret",
    });
  });

  /*
   * A caller that sends BOTH the list and a flattened column meant the
   * flattened one. Overwriting it would make the payload and the row disagree
   * in a way only the database could reveal — the caller would be told the
   * write succeeded and would then read back a value it never sent.
   */
  it("leaves a flattened column the payload named for itself alone", async () => {
    const row: Record<string, unknown> = await updatedRow({
      snmpConfigs: [coreRoutersConfig()],
      snmpCommunityString: "operator-typed",
    });

    expect(row["snmpCommunityString"]).toBe("operator-typed");
    // ...while the columns the payload said nothing about are still mirrored.
    expect(row["snmpVersion"]).toBe("V3");
    expect(row["snmpV3Username"]).toBe("netops");
  });

  /*
   * Clearing the list puts the scan back on its flattened columns, exactly
   * where a scan created before this feature already is. Mirroring anything
   * here would erase the very credentials the fallback just landed on: there
   * is no first config to mirror FROM, so the mirror would write the column
   * defaults over whatever the row actually holds.
   */
  it("clears the column and mirrors nothing when the list is cleared", async () => {
    for (const clearedValue of [null, ""]) {
      const row: Record<string, unknown> = await updatedRow({
        snmpConfigs: clearedValue,
      });

      // The whole payload, so "mirrors nothing" is a real assertion.
      expect(row).toEqual({ snmpConfigs: null });
    }
  });
});

/*
 * An update written through the FLATTENED columns alone, on a scan that has a
 * credential list.
 *
 * The list shadows those columns — the reader consults it and ignores them —
 * so such a write would land in the database and change nothing about the
 * sweep. That is the worst of both outcomes: the caller is told it succeeded
 * and the scan keeps the credentials it had. Which of the two honest answers
 * applies depends only on how many configs the row holds: a single-credential
 * scan has its list rebuilt from the columns the save just wrote, and a
 * multi-credential one is refused, because no set of flattened columns could
 * describe it and overwriting one config would silently discard the others.
 */
describe("NetworkDeviceDiscoveryScanService: an update through the flattened columns alone", () => {
  /*
   * The rebuild happens AFTER the write, not in the payload, and it has to:
   * one update payload is shared by every row the query matched, and the list
   * to rebuild is a function of each ROW. So this is asserted through a whole
   * save rather than through the hook alone — the payload the caller sent is
   * carried through untouched, and the list is put back in step by the
   * reconciling write that follows.
   */
  it("rebuilds the list from the columns the save wrote, so the two describe the same credentials", async () => {
    storedScans = [storedScan()];

    const data: Record<string, unknown> = { snmpCommunityString: "private" };

    const writes: Array<ReconcileWrite> = await saveSettings(data);

    // The caller's own payload is not rewritten on the way through.
    expect(data["snmpCommunityString"]).toBe("private");
    expect(Object.prototype.hasOwnProperty.call(data, "snmpConfigs")).toBe(
      false,
    );

    /*
     * The rebuilt list carries the community string the save just wrote, NOT
     * the one the row's list held a moment ago. That is the whole point: a
     * list still holding "public" would go on shadowing the "private" the
     * caller was told had been stored, and the probe would keep sweeping with
     * the old credential.
     *
     * The id is the synthetic legacy one, and the name the stored list carried
     * is gone — a save through these columns has no way to express a name, and
     * inventing one would be the rebuild claiming to know something the caller
     * never sent.
     */
    expect(writes).toHaveLength(1);
    expect(writes[0]!.data["snmpConfigs"]).toEqual([
      {
        id: LEGACY_SNMP_CONFIG_ID,
        snmpVersion: "V2c",
        snmpCommunityString: "private",
        snmpPort: 161,
      },
    ]);
  });

  /*
   * WHERE THE TWO CHANGES MEET AGAIN (issues #3445 + #3458): the rebuild is
   * skipped outright for a scan that sends no SNMP.
   *
   * An ICMP-only scan stores nulls in every SNMP column, so resolving a list
   * out of them would materialize one credential set that says nothing at all
   * — no version, no community string, no port — on a scan that will never
   * send a single SNMP packet. The Edit dialog seeds its list editor from this
   * column, so that empty card would then be shown to an operator who had
   * asked for a ping sweep, on a step the form does not even display.
   */
  it("does not materialize a list for an ICMP-only scan saved through those columns", async () => {
    storedScans = [
      storedScan({
        isSnmpEnabled: false,
        snmpConfigs: null,
        snmpVersion: undefined,
        snmpCommunityString: null,
        snmpPort: undefined,
      }),
    ];

    /*
     * An empty box, which is what the hidden SNMP step posts on a scan whose
     * credentials were cleared when the method was turned off. It matches the
     * null the row already holds, so nothing about the sweep changed either.
     */
    const writes: Array<ReconcileWrite> = await saveSettings({
      snmpCommunityString: "",
    });

    expect(writes).toEqual([]);
  });

  it("refuses the same update on a multi-config scan, naming the field to use instead", async () => {
    storedScans = [
      storedScan({
        snmpConfigs: [...storedSnmpConfigs(), coreRoutersConfig()],
      }),
    ];

    const error: Error | null = await captureError((): Promise<unknown> => {
      return onBeforeUpdate(makeUpdateBy({ snmpCommunityString: "private" }));
    });

    /*
     * There is no set of flattened columns that could express a two-config
     * scan, and picking one config to overwrite would silently discard the
     * other — so the only honest answer is a refusal that says what to send.
     */
    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toContain("snmpConfigs");
    expect(error?.message).toContain("2");
  });

  it("leaves an update that sends the list itself alone, even on a multi-config scan", async () => {
    storedScans = [
      storedScan({
        snmpConfigs: [...storedSnmpConfigs(), coreRoutersConfig()],
      }),
    ];

    const row: Record<string, unknown> = await updatedRow({
      snmpConfigs: [coreRoutersConfig()],
      snmpCommunityString: "operator-typed",
    });

    expect(row["snmpConfigs"]).toHaveLength(1);
    expect(row["snmpCommunityString"]).toBe("operator-typed");
  });

  /*
   * The reconciliation must not reach for a payload that never mentions SNMP
   * at all. Adding `snmpConfigs: null` to a rename or a target change would
   * throw away the credential list of every scan that got renamed.
   */
  it("leaves an update that touches no SNMP column at all completely alone", async () => {
    const row: Record<string, unknown> = await updatedRow({
      cidr: "10.0.0.0/24",
    });

    expect(Object.prototype.hasOwnProperty.call(row, "snmpConfigs")).toBe(
      false,
    );
  });
});

/*
 * The scan's METHOD (issue #3445).
 *
 * A scan that will not send SNMP must not be STORED carrying SNMP settings.
 * Hiding the fields in the wizard is not enough on its own, for two separate
 * reasons — ModelForm posts every declared field whether or not it was visible,
 * and this hook is also the only thing standing between a direct API call and
 * the table — so the clearing lives here, on the write path every writer takes.
 *
 * The nulls below are the part that is easy to "simplify" into a bug. TypeORM
 * OMITS an undefined property from the INSERT, at which point Postgres applies
 * this table's column defaults ('V2c' for snmpVersion, 161 for snmpPort), and
 * the stored row ends up claiming to be a v2c scan on port 161 while its own
 * method column says it sends no SNMP at all. That was verified empirically
 * against Postgres, not reasoned about: an explicit null is the only value that
 * beats a column default.
 */
describe("NetworkDeviceDiscoveryScanService SNMP config on create", () => {
  const SNMP_CONFIG_COLUMNS: Array<string> = [
    "snmpVersion",
    "snmpCommunityString",
    "snmpPort",
    "snmpV3SecurityLevel",
    "snmpV3Username",
    "snmpV3AuthProtocol",
    "snmpV3AuthKey",
    "snmpV3PrivProtocol",
    "snmpV3PrivKey",
  ];

  /*
   * A full v3 credential set, which is the worst case worth pinning: it is the
   * one that carries a passphrase, and the one an operator is most likely to
   * have typed before deciding they only wanted a ping sweep after all.
   */
  const SNMP_CREDENTIALS: Record<string, unknown> = {
    snmpVersion: "V3",
    snmpCommunityString: "public",
    snmpPort: 1161,
    snmpV3SecurityLevel: "authPriv",
    snmpV3Username: "netops",
    snmpV3AuthProtocol: "sha",
    snmpV3AuthKey: "auth-passphrase",
    snmpV3PrivProtocol: "aes",
    snmpV3PrivKey: "priv-passphrase",
  };

  /*
   * `isSnmpEnabled` is typed unknown for the same reason `cidr` is above: this
   * hook runs before the model's own type checks, so an API client really can
   * send a string or a number here. Passing NO_METHOD_KEY deletes the property
   * outright, which is how a request body from a client that has never heard of
   * the column reaches the hook.
   */
  const NO_METHOD_KEY: symbol = Symbol("no isSnmpEnabled key");

  type MakeScanFunction = (
    isSnmpEnabled: unknown,
    credentials?: Record<string, unknown>,
  ) => CreateBy<NetworkDeviceDiscoveryScan>;

  const makeScan: MakeScanFunction = (
    isSnmpEnabled: unknown,
    credentials: Record<string, unknown> = {},
  ): CreateBy<NetworkDeviceDiscoveryScan> => {
    const createBy: CreateBy<NetworkDeviceDiscoveryScan> =
      makeCreateBy("192.168.1.0/24");

    const data: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;

    if (isSnmpEnabled === NO_METHOD_KEY) {
      delete data["isSnmpEnabled"];
    } else {
      data["isSnmpEnabled"] = isSnmpEnabled;
    }

    for (const key of Object.keys(credentials)) {
      data[key] = credentials[key];
    }

    return createBy;
  };

  type CreatedScanFunction = (
    isSnmpEnabled: unknown,
    credentials?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;

  // What the hook would actually hand to the INSERT, for a given request body.
  const createdScan: CreatedScanFunction = async (
    isSnmpEnabled: unknown,
    credentials: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const createBy: CreateBy<NetworkDeviceDiscoveryScan> = makeScan(
      isSnmpEnabled,
      credentials,
    );

    await onBeforeCreate(createBy);

    return createBy.data as unknown as Record<string, unknown>;
  };

  /*
   * `null`, and specifically never `undefined`. The two look like the same
   * assertion and are completely different values to Postgres: TypeORM omits
   * an undefined property from the INSERT, the column default fills it back in
   * ('V2c', 161), and the stored row claims to be a v2c scan on port 161 while
   * its own method column says it sends no SNMP at all.
   *
   * The object-wrapped expect is what makes toEqual tell them apart — a bare
   * `toEqual(null)` on a received `undefined` would pass, because toEqual
   * treats an undefined property as an absent one — and the hasOwnProperty
   * check is what pins that the columns are WRITTEN rather than deleted.
   */
  it("nulls every SNMP column of a scan that sends no SNMP, with null and never undefined", async () => {
    const stored: Record<string, unknown> = await createdScan(
      false,
      SNMP_CREDENTIALS,
    );

    for (const column of SNMP_CONFIG_COLUMNS) {
      expect({ column: column, value: stored[column] }).toEqual({
        column: column,
        value: null,
      });
      expect(Object.prototype.hasOwnProperty.call(stored, column)).toBe(true);
    }

    // The two columns that actually carry a DEFAULT in this table.
    expect(stored["snmpVersion"]).not.toBe("V2c");
    expect(stored["snmpPort"]).not.toBe(161);
  });

  it("keeps the credentials of a scan that does send SNMP", async () => {
    const stored: Record<string, unknown> = await createdScan(
      true,
      SNMP_CREDENTIALS,
    );

    for (const column of SNMP_CONFIG_COLUMNS) {
      expect(stored[column]).toBe(SNMP_CREDENTIALS[column]);
    }
  });

  /*
   * The legacy and API case, and the one that fails silently.
   *
   * A request body written before this column existed carries no method at all.
   * Reading that absence as "SNMP is off" would clear the credentials of every
   * such scan and turn the entire product's discovery into a ping sweep, with
   * no error raised anywhere — the only symptom being addresses found where
   * devices used to be. Absence means SNMP, exactly as it did before the column.
   */
  it("keeps the credentials of a scan that never mentions the method at all", async () => {
    const createBy: CreateBy<NetworkDeviceDiscoveryScan> = makeScan(
      NO_METHOD_KEY,
      SNMP_CREDENTIALS,
    );

    expect(
      Object.prototype.hasOwnProperty.call(createBy.data, "isSnmpEnabled"),
    ).toBe(false);

    await onBeforeCreate(createBy);

    const stored: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;

    for (const column of SNMP_CONFIG_COLUMNS) {
      expect(stored[column]).toBe(SNMP_CREDENTIALS[column]);
    }
  });

  /*
   * ...and neither does an explicit null, which is what a partially-selected
   * row or a JSON body that spells "unset" as null produces. Only a real
   * boolean false turns SNMP off, so a value this hook did not recognise fails
   * safe toward the scan the product has always run.
   */
  it.each([
    ["an undefined method", undefined],
    ["a null method", null],
    ['the string "false"', "false"],
    ["a zero", 0],
  ])("keeps the credentials for %s", async (_label: string, value: unknown) => {
    const stored: Record<string, unknown> = await createdScan(
      value,
      SNMP_CREDENTIALS,
    );

    expect(stored["snmpVersion"]).toBe("V3");
    expect(stored["snmpV3PrivKey"]).toBe("priv-passphrase");
  });

  /*
   * The columns are written, not deleted, so a request that carried no
   * credentials in the first place still ends up with explicit nulls — which is
   * the whole reason the clearing exists, since it is the empty request that
   * would otherwise be filled in by the column defaults.
   */
  it("nulls the columns even when the request carried no credentials at all", async () => {
    const stored: Record<string, unknown> = await createdScan(false);

    for (const column of SNMP_CONFIG_COLUMNS) {
      expect(stored[column]).toBeNull();
    }
  });

  /*
   * The one column that must NOT be nulled by the clearing, and the mistake is
   * a single line: adding "isSnmpEnabled" to the list of SNMP columns. A null
   * method reads as SNMP-enabled everywhere in the product, so the row would
   * come back out claiming to be an SNMP scan whose credentials are all null —
   * an unrunnable sweep that also contradicts what the operator asked for.
   */
  it("leaves the method column itself alone", async () => {
    const stored: Record<string, unknown> = await createdScan(
      false,
      SNMP_CREDENTIALS,
    );

    expect(stored["isSnmpEnabled"]).toBe(false);
    expect(stored["isSnmpEnabled"]).not.toBeNull();
  });

  it("does not disturb anything else about the scan", async () => {
    const createBy: CreateBy<NetworkDeviceDiscoveryScan> = makeScan(false, {
      ...SNMP_CREDENTIALS,
      name: "  Ping Sweep - Region 1100  ",
      isRecurring: true,
      rescanIntervalInMinutes: 60,
    });

    await onBeforeCreate(createBy);

    const stored: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;

    expect(stored["cidr"]).toBe("192.168.1.0/24");
    expect(stored["probeId"]).toBe(PROBE_ID);
    expect(stored["isRecurring"]).toBe(true);
    expect(stored["rescanIntervalInMinutes"]).toBe(60);
    // Still normalized by the name rules, which run on the same hook.
    expect(stored["name"]).toBe("Ping Sweep - Region 1100");
  });

  it("returns the same createBy, so the cleared values are what gets written", async () => {
    const createBy: CreateBy<NetworkDeviceDiscoveryScan> = makeScan(
      false,
      SNMP_CREDENTIALS,
    );

    const result: unknown = await onBeforeCreate(createBy);

    const returned: CreateBy<NetworkDeviceDiscoveryScan> = (
      result as { createBy: CreateBy<NetworkDeviceDiscoveryScan> }
    ).createBy;

    expect(returned).toBe(createBy);
    expect(
      (returned.data as unknown as Record<string, unknown>)["snmpV3PrivKey"],
    ).toBeNull();
  });

  /*
   * Turning SNMP off does not turn the rest of the hook off. Every validation
   * that guarded a scan before this column existed still guards an ICMP-only
   * one — the sweep is the same sweep, and a target the probe would refuse is
   * still a target that must not be stored.
   */
  it("still rejects a bad target on an ICMP-only scan", async () => {
    const reversedRange: CreateBy<NetworkDeviceDiscoveryScan> = makeScan(false);
    (reversedRange.data as unknown as Record<string, unknown>)["cidr"] =
      "10.22-16.0.1";

    await expect(onBeforeCreate(reversedRange)).rejects.toThrow(/reversed/);

    const noTarget: CreateBy<NetworkDeviceDiscoveryScan> = makeScan(false);
    delete (noTarget.data as unknown as Record<string, unknown>)["cidr"];

    await expect(onBeforeCreate(noTarget)).rejects.toThrow(BadDataException);
  });

  it("still rejects an oversized target on an ICMP-only scan", async () => {
    const oversized: CreateBy<NetworkDeviceDiscoveryScan> = makeScan(false);
    (oversized.data as unknown as Record<string, unknown>)["cidr"] =
      "10.0.0.0/8";

    await expect(onBeforeCreate(oversized)).rejects.toThrow(/exceeding the/);
  });

  it("still rejects a bad name on an ICMP-only scan", async () => {
    const badName: CreateBy<NetworkDeviceDiscoveryScan> = makeScan(false, {
      name: "a".repeat(101),
    });

    await expect(onBeforeCreate(badName)).rejects.toThrow(
      ScanNameUtil.getValidationError("a".repeat(101)) as string,
    );
  });
});

/*
 * Every column a scan that will not send SNMP must not carry, in the order the
 * service nulls them.
 *
 * The LIST leads, and that is the merge of the two changes in one line: it is
 * where a scan's community strings and v3 passphrases actually live now (issue
 * #3458), so clearing the nine flattened columns while leaving it behind would
 * store an ICMP-only scan whose own method column says it sends no SNMP,
 * carrying every credential the operator had typed. The nine below it are what
 * a probe that predates the list still reads, and are cleared for the reason
 * issue #3445 gave: an undefined property is omitted from the INSERT and
 * Postgres fills in this table's own defaults ('V2c', 161).
 */
const EVERY_SNMP_COLUMN: Array<string> = [
  "snmpConfigs",
  "snmpVersion",
  "snmpCommunityString",
  "snmpPort",
  "snmpV3SecurityLevel",
  "snmpV3Username",
  "snmpV3AuthProtocol",
  "snmpV3AuthKey",
  "snmpV3PrivProtocol",
  "snmpV3PrivKey",
];

/*
 * ---------------------------------------------------------------------------
 * WHERE THE TWO CHANGES MEET, ON CREATE (issues #3445 + #3458 together).
 * ---------------------------------------------------------------------------
 *
 * Each half is settled on its own above. Every scan the product creates leaves
 * the create hook WITH a credential list, and a list it cannot store is refused
 * as a 400 (#3458). A scan that will not send SNMP leaves the same hook
 * carrying no SNMP settings at all (#3445). Put together on one request they
 * contradict each other unless the order is right, because the wizard posts
 * both fields at once:
 *
 *   - The SNMP step is hidden for an ICMP-only scan, but ModelForm builds the
 *     request body out of every DECLARED field without checking whether it was
 *     visible. So the half-finished credential card an operator typed before
 *     they unticked "Check SNMP on hosts that answer" is still in the POST.
 *     Validating it would refuse the create with a sentence about a step that
 *     is no longer on screen — which is issue #3445's own original symptom
 *     ("SNMP Version is required" blocking a ping sweep), reintroduced through
 *     the new field.
 *   - And the derive step would hand an ICMP-only scan a credential list built
 *     out of the flattened columns, which the clearing then nulls a few lines
 *     later. Deriving a list only to throw it away is at best a confusing way
 *     to write null; get the order wrong and the row KEEPS it, which is a scan
 *     whose method column says it sends no SNMP while holding a v3 passphrase.
 *
 * So both passes are gated on ScanModeUtil.isSnmpEnabled(createBy.data), and
 * the clearing runs last over a set that has `snmpConfigs` in it.
 */
describe("NetworkDeviceDiscoveryScanService: an ICMP-only scan never gets a credential list", () => {
  /*
   * The counterpart of "gives even a scan created with no SNMP settings at all
   * a list" above: the same bare payload, with the method turned off, must NOT
   * come out of the hook holding the derived one-entry list — so the invariant
   * the Edit dialog leans on is deliberately not extended to a scan whose SNMP
   * step that dialog does not show either.
   *
   * Null, and specifically not undefined. Left undefined this column is simply
   * omitted from the INSERT, which happens to be the same value here — but the
   * clearing exists precisely because "whatever the database decides" is not an
   * answer this hook is allowed to give about an SNMP column, and the two
   * spellings are told apart by wrapping the value in an object (a bare
   * `toEqual(null)` on a received undefined would pass).
   */
  it("stores a null credential list rather than deriving one from the flattened columns", async () => {
    const row: Record<string, unknown> = await createdRow({
      isSnmpEnabled: false,
    });

    expect({ snmpConfigs: row["snmpConfigs"] }).toEqual({ snmpConfigs: null });
  });

  /*
   * Every list shape the SNMP path refuses — a bare string, an object, a
   * number, an empty list, a v3 config with no username, a list past the
   * ceiling — accepted here, and stored as nothing.
   *
   * Both halves of that in one loop, because either one alone would pass for
   * the wrong reason: a hook that validated the list and then cleared it would
   * still store null, and a hook that skipped validation but kept the list
   * would still not throw.
   */
  it("neither refuses the create nor stores the list when the hidden SNMP step posts a bad one", async () => {
    for (const [label, value] of INVALID_LISTS) {
      const createBy: CreateBy<NetworkDeviceDiscoveryScan> = makeCreateByWith({
        isSnmpEnabled: false,
        snmpConfigs: value,
      });

      const error: Error | null = await captureError((): Promise<unknown> => {
        return onBeforeCreate(createBy);
      });

      const row: Record<string, unknown> = createBy.data as unknown as Record<
        string,
        unknown
      >;

      expect({
        posted: label,
        error: error === null ? null : error.message,
        snmpConfigs: row["snmpConfigs"],
      }).toEqual({
        posted: label,
        error: null,
        snmpConfigs: null,
      });
    }
  });

  /*
   * The whole set at once, from a payload that carries a perfectly VALID
   * two-config list as well as a full set of v3 credentials — which is what an
   * operator who worked through the SNMP step and then changed their mind
   * actually posts. Nothing survives except the method itself.
   */
  it("clears the credential list along with the nine flattened columns", async () => {
    const row: Record<string, unknown> = await createdRow({
      isSnmpEnabled: false,
      snmpConfigs: [coreRoutersConfig(), ...storedSnmpConfigs()],
      snmpVersion: "V3",
      snmpCommunityString: "public",
      snmpPort: 1161,
      snmpV3SecurityLevel: "authPriv",
      snmpV3Username: "netops",
      snmpV3AuthProtocol: "SHA",
      snmpV3AuthKey: "auth-secret",
      snmpV3PrivProtocol: "AES",
      snmpV3PrivKey: "priv-secret",
    });

    for (const column of EVERY_SNMP_COLUMN) {
      expect({ column: column, value: row[column] }).toEqual({
        column: column,
        value: null,
      });
    }

    /*
     * The one column the clearing must not reach, restated here because this
     * is the payload where getting it wrong is invisible: a nulled method
     * reads as SNMP-ENABLED everywhere in the product, so the row would come
     * back out as an SNMP scan whose every credential is null — an unrunnable
     * sweep that also contradicts what the operator asked for.
     */
    expect(row["isSnmpEnabled"]).toBe(false);
  });

  /*
   * And the mirror is off on this path too. `applySnmpConfigs` is what writes
   * the flattened columns from the list's first config, so a version of the
   * hook that cleared FIRST and mirrored afterwards would leave an ICMP-only
   * row advertising v3/1161/netops — credentials no probe will ever send, on a
   * scan that says it sends none.
   */
  it("does not mirror the first config onto the flattened columns on the way past", async () => {
    const row: Record<string, unknown> = await createdRow({
      isSnmpEnabled: false,
      snmpConfigs: [coreRoutersConfig()],
    });

    expect(row["snmpV3Username"]).toBeNull();
    expect(row["snmpPort"]).toBeNull();
  });

  /*
   * The other direction, so none of the above is vacuous: the very same
   * payload with the method left ON keeps its list and mirrors it. If the gate
   * were stuck closed, every test in this describe would still pass while the
   * feature did nothing.
   */
  it("still keeps and mirrors the list when the same payload leaves SNMP on", async () => {
    const row: Record<string, unknown> = await createdRow({
      isSnmpEnabled: true,
      snmpConfigs: [coreRoutersConfig()],
    });

    expect(row["snmpConfigs"]).toHaveLength(1);
    expect(row["snmpV3Username"]).toBe("netops");
  });
});

describe("NetworkDeviceDiscoveryScanService: the credential list retires a run like any other sweep column", () => {
  /*
   * The results on the row were found with the OLD credentials. Once the list
   * changes they describe a sweep that no longer exists — and, worse than
   * merely being stale, the Review Results dialog would offer them for import
   * under the new credentials and the auto-import worker would create devices
   * from them.
   */
  it("retires the run and clears the results when a config is added to the list", async () => {
    const writes: Array<ReconcileWrite> = await saveSettings({
      ...unchangedSave(),
      snmpConfigs: [...storedSnmpConfigs(), coreRoutersConfig()],
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]!.data).toEqual({
      status: "Pending",
      statusMessage: expect.stringContaining("queued to run again"),
      startedAt: null,
      completedAt: null,
      nextScanAt: null,
      discoveredDevices: null,
      scannedHostCount: null,
      respondedHostCount: null,
      autoImportProcessedAt: null,
    });
  });

  /*
   * Reordering alone is a real change, not a cosmetic one: the order is the
   * order the probe tries the configs in per host, and the first entry is
   * what an older probe sweeps with. A scan whose preferred credential moved
   * can find a different set of hosts, so its previous results are no more
   * trustworthy than they would be after an edit.
   */
  it("retires the run when the list is only reordered", async () => {
    storedScans = [
      storedScan({
        snmpConfigs: [...storedSnmpConfigs(), coreRoutersConfig()],
      }),
    ];

    const writes: Array<ReconcileWrite> = await saveSettings({
      snmpConfigs: [coreRoutersConfig(), ...storedSnmpConfigs()],
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]!.data["status"]).toBe("Pending");
  });

  /*
   * And the assertion the whole fixture is built around, restated for a
   * multi-config scan: re-posting the same list in the same order is not a
   * change. ModelForm posts every field it declares on every save, so this is
   * what an operator who opens Edit and presses Save actually sends — and if
   * it read as a change, every such visit would delete the scan's results.
   */
  it("does not retire the run when the same multi-config list is re-posted", async () => {
    storedScans = [
      storedScan({
        snmpConfigs: [...storedSnmpConfigs(), coreRoutersConfig()],
      }),
    ];

    const writes: Array<ReconcileWrite> = await saveSettings({
      snmpConfigs: [...storedSnmpConfigs(), coreRoutersConfig()],
    });

    expect(writes).toEqual([]);
  });
});

/*
 * The same invariant on the EDIT path (issues #3444 + #3445).
 *
 * A scan's method became editable when its settings did, so the create hook is
 * no longer the only way a row can end up saying "sends no SNMP" while carrying
 * a community string. The edit form posts every declared field regardless of
 * visibility, exactly as the wizard does, so an operator who switches the
 * method off is still sending the credentials they just hid.
 */
describe("NetworkDeviceDiscoveryScanService SNMP config on update", () => {
  it("clears the credentials when an edit turns the method off", async () => {
    const data: Record<string, unknown> = {
      isSnmpEnabled: false,
      snmpVersion: "V3",
      snmpCommunityString: "public",
      snmpPort: 1161,
      snmpV3Username: "monitoring",
      snmpV3AuthKey: "authentication passphrase",
      snmpV3PrivKey: "privacy passphrase",
    };

    await saveSettings(data);

    for (const column of [
      "snmpVersion",
      "snmpCommunityString",
      "snmpPort",
      "snmpV3SecurityLevel",
      "snmpV3Username",
      "snmpV3AuthProtocol",
      "snmpV3AuthKey",
      "snmpV3PrivProtocol",
      "snmpV3PrivKey",
    ]) {
      expect({ column: column, value: data[column] }).toEqual({
        column: column,
        value: null,
      });
    }

    // The method itself is the one SNMP-ish key the clear must not touch.
    expect(data["isSnmpEnabled"]).toBe(false);
  });

  it("leaves the credentials alone when an edit turns the method back on", async () => {
    const data: Record<string, unknown> = {
      isSnmpEnabled: true,
      snmpCommunityString: "public",
    };

    await saveSettings(data);

    expect(data["snmpCommunityString"]).toBe("public");
  });

  /*
   * The guard is on the key being WRITTEN, not on the stored value. A rename,
   * or the probe-ingest endpoints writing run state, must not reach in and null
   * columns they never mentioned — and those writers do not read the row at
   * all, so a clear here would be a write nobody asked for.
   */
  it("leaves the credentials alone on an edit that never mentions the method", async () => {
    const data: Record<string, unknown> = {
      snmpCommunityString: "public",
    };

    await saveSettings(data);

    expect(data["snmpCommunityString"]).toBe("public");
  });
});

/*
 * ---------------------------------------------------------------------------
 * WHERE THE TWO CHANGES MEET, ON UPDATE (issues #3445 + #3458 together).
 * ---------------------------------------------------------------------------
 *
 * The same collision as on the create path, arriving through a different door:
 * a scan's method became editable when its settings did, so an operator can
 * untick "Check SNMP on hosts that answer" on a scan that already HAS a
 * credential list, with the list editor's cards still filled in behind the
 * hidden step.
 *
 * The update hook answers it as a strict either/or. A save that WRITES
 * `isSnmpEnabled`, and writes it false, clears the whole SNMP set — the list
 * first — and `applySnmpConfigs` is skipped outright. That skip is not an
 * optimisation: applySnmpConfigs is the pass that VALIDATES the list, and
 * ModelForm posts every declared field regardless of visibility, so running it
 * would refuse the operator's save over the very credentials they had just told
 * the product to stop using. The other branch is unchanged — a save that says
 * nothing about the method still validates and mirrors its list exactly as it
 * did before the method column existed.
 */
describe("NetworkDeviceDiscoveryScanService: turning SNMP off on a scan that has a credential list", () => {
  /*
   * The full set, from the payload the edit form actually sends: the toggle
   * off, and behind it the two-config list the scan was carrying a moment ago.
   * Ten columns, not nine — the list is where those credentials live now.
   */
  it("clears the credential list along with the nine flattened columns", async () => {
    const data: Record<string, unknown> = {
      isSnmpEnabled: false,
      snmpConfigs: [coreRoutersConfig(), ...storedSnmpConfigs()],
      snmpVersion: "V3",
      snmpCommunityString: "public",
      snmpPort: 1161,
      snmpV3SecurityLevel: "authPriv",
      snmpV3Username: "netops",
      snmpV3AuthProtocol: "SHA",
      snmpV3AuthKey: "auth-secret",
      snmpV3PrivProtocol: "AES",
      snmpV3PrivKey: "priv-secret",
    };

    await saveSettings(data);

    for (const column of EVERY_SNMP_COLUMN) {
      expect({ column: column, value: data[column] }).toEqual({
        column: column,
        value: null,
      });
    }

    // The method itself is the one SNMP-ish key the clear must not touch.
    expect(data["isSnmpEnabled"]).toBe(false);
  });

  /*
   * THE REASON THE SKIP EXISTS, and the case that turns a merge of two
   * independently-correct changes into a bug if the order is wrong.
   *
   * Every list shape that is a 400 on any other update — a bare string, an
   * empty list, a v3 config with no key — has to sail through this one. The
   * operator has told the product to stop sending SNMP; refusing their save
   * because the credentials they abandoned are half-typed would leave them
   * stuck on a form whose offending field the wizard has taken off the screen,
   * with no way to make the error go away except to fill in credentials for a
   * sweep that will never send them.
   *
   * Asserted together with the stored value for the same reason as on the
   * create path: a hook that validated first and cleared afterwards would still
   * store null, and a hook that skipped validation but kept the list would
   * still not throw.
   */
  it("is not refused when the hidden SNMP step posts an invalid or empty list", async () => {
    for (const [label, value] of INVALID_LISTS) {
      const data: Record<string, unknown> = {
        isSnmpEnabled: false,
        snmpConfigs: value,
      };

      const error: Error | null = await captureError((): Promise<unknown> => {
        return onBeforeUpdate(makeUpdateBy(data));
      });

      expect({
        posted: label,
        error: error === null ? null : error.message,
        snmpConfigs: data["snmpConfigs"],
      }).toEqual({
        posted: label,
        error: null,
        snmpConfigs: null,
      });
    }
  });

  /*
   * ...while the SAME list on a save that turns the method back ON is refused
   * exactly as it was before. The skip is conditional on the operator having
   * turned SNMP off, not a hole in the validation — and this is the one
   * payload where they really do need to hear about it, because they have just
   * asked for a sweep that will use these credentials.
   */
  it("still refuses an invalid list on a save that turns the method back on", async () => {
    const error: Error | null = await captureError((): Promise<unknown> => {
      return onBeforeUpdate(
        makeUpdateBy({ isSnmpEnabled: true, snmpConfigs: [] }),
      );
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(SnmpScanConfigUtil.getValidationError([]));
  });

  /*
   * The method is a sweep column like any other, so turning it off retires the
   * run — the same reconciliation the credential list gets above.
   *
   * The hosts on the row answered a DIFFERENT question. Every one of them was
   * asked for its SNMP system group, and the ones that answered are on the row
   * as polled devices with a vendor and a sysName; the sweep this save
   * describes asks nothing of the kind. Left alone, the Review Results dialog
   * would go on offering them for import under a scan that no longer collects
   * any of it, and the auto-import worker would create polled devices from a
   * ping sweep's results.
   */
  it("retires the run and clears the results, because a sweep that stops asking for SNMP is a different sweep", async () => {
    const writes: Array<ReconcileWrite> = await saveSettings({
      ...unchangedSave(),
      isSnmpEnabled: false,
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]!.data).toEqual({
      status: "Pending",
      statusMessage: expect.stringContaining("queued to run again"),
      startedAt: null,
      completedAt: null,
      nextScanAt: null,
      discoveredDevices: null,
      scannedHostCount: null,
      respondedHostCount: null,
      autoImportProcessedAt: null,
    });
  });

  /*
   * And the no-op that every retirement rule has to survive: a scan that is
   * ALREADY ICMP-only, saved again with the emptied SNMP set it is carrying.
   *
   * The clearing above writes nulls; the form posts empty strings; the stored
   * row holds a mixture of nulls and columns that were never written at all.
   * All three mean the same thing — "this scan has no SNMP settings" — and the
   * sweep comparison has to say so, or every save on a ping-only scan would
   * delete the hosts it had found, silently, with the operator having changed
   * nothing. That is one normalizer answering for a nulled list, an unset
   * column and an empty box at once, which is exactly the seam where the two
   * changes meet.
   *
   * The pre-image deliberately does NOT carry `isSnmpEnabled`, and this payload
   * deliberately does not write it: the row this hook reads is built from an
   * explicit `select` that does not ask for that column, so a fixture that set
   * it would be asserting against a row shape the service never sees. See the
   * note in the handover about what that costs on the payload the Edit dialog
   * actually sends.
   */
  it("does not retire the run when a scan that already sends no SNMP is re-saved", async () => {
    storedScans = [
      storedScan({
        snmpConfigs: null,
        snmpVersion: undefined,
        snmpCommunityString: null,
        snmpPort: undefined,
      }),
    ];

    const writes: Array<ReconcileWrite> = await saveSettings({
      name: "Region 1100",
      cidr: "192.168.1.0/24",
      probe: { _id: PROBE_ID.toString() },
      /*
       * What the toggle's onChange left in the form values, posted on the way
       * past even though the SNMP step is not on screen: the list cleared
       * outright, the flattened boxes empty.
       */
      snmpConfigs: null,
      snmpVersion: "",
      snmpCommunityString: "",
      snmpPort: "",
      snmpV3SecurityLevel: "",
      snmpV3Username: "",
      snmpV3AuthProtocol: "",
      snmpV3AuthKey: "",
      snmpV3PrivProtocol: "",
      snmpV3PrivKey: "",
      isRecurring: false,
      rescanIntervalInMinutes: null,
    });

    expect(writes).toEqual([]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * WHAT ACTUALLY COUNTS AS A CREDENTIAL CHANGE (issue #3458, review round).
 * ---------------------------------------------------------------------------
 *
 * `hasSweepChanged` decides whether a save retires the run — status back to
 * Pending, statusMessage rewritten, and every host the scan had found deleted
 * from `discoveredDevices`. For the credential LIST that decision is made by
 * `normalizeSweepValue`, and it used to compare the whole stored object. Two
 * of the fields on that object are not part of the sweep at all, and each one
 * turned an operation that changes nothing about what the probe sends into a
 * silent deletion of the scan's results.
 *
 *   - `id` is server-minted bookkeeping. `applySnmpConfigs` runs BEFORE the
 *     comparison and mints a fresh ObjectID for every entry that arrived
 *     without one, so any client that does not echo ids back — a plain API
 *     caller, an IaC reconciler re-applying the same desired state — posted a
 *     byte-identical body twice and had the SECOND one read as a credential
 *     change. A scan under such a reconciler could never hold a result set at
 *     all: every reconcile loop re-queued it.
 *   - `name` is the operator's label on a credential card. It reaches a log
 *     line and the scan's status message and nothing else — never the wire —
 *     so renaming a card retired the run and deleted every host the scan had
 *     found.
 *
 * The fix strips exactly those two before comparing. The tests below pin both
 * halves of that: the two fields must NOT count, and everything the probe
 * actually puts on the wire — version, community, port, the v3 block, and the
 * ORDER the configs are tried in — must still count.
 */

/*
 * The same two credential sets the fixture's stored row holds, posted the way
 * a client that does not track server-minted ids sends them: no `id` on either
 * entry.
 *
 * This is not a contrived shape. `id` is optional on the wire precisely so a
 * caller can express "these are my credentials" without having to read the row
 * back first, which is exactly what a reconciler does on every loop.
 */
function idLessConfigs(): Array<DiscoveryScanSnmpConfig> {
  return [
    {
      name: "Access switches",
      snmpVersion: "V2c",
      snmpCommunityString: "public",
      snmpPort: 161,
    },
    {
      name: "Core routers",
      snmpVersion: "V3",
      snmpPort: 1161,
      snmpV3SecurityLevel: "authPriv",
      snmpV3Username: "netops",
      snmpV3AuthProtocol: "SHA",
      snmpV3AuthKey: "auth-secret",
      snmpV3PrivProtocol: "AES",
      snmpV3PrivKey: "priv-secret",
    },
  ];
}

/*
 * One field of one config, changed to something the probe would put on the
 * wire differently. Every one of these has to keep retiring the run: the hosts
 * on the row were found with the OLD value, and a community string or a v3 key
 * the scan no longer uses cannot have found them.
 *
 * The v1/v2c fields are changed on the first card and the v3 block on the
 * second, so that each posted config stays valid on its own — a v2c card
 * switched to v3 with no username is a 400, not a credential change, and would
 * prove nothing about the comparison.
 *
 * `whichConfig` names the card so a failure inside the loop says which one it
 * was, which is the whole reason these are a table rather than nine tests.
 */
type CredentialChangeCase = [
  label: string,
  whichConfig: "the v2c card" | "the v3 card",
  change: DiscoveryScanSnmpConfig,
];

const REAL_CREDENTIAL_CHANGES: Array<CredentialChangeCase> = [
  ["the community string", "the v2c card", { snmpCommunityString: "private" }],
  ["the port", "the v2c card", { snmpPort: 1161 }],
  ["the SNMP version", "the v2c card", { snmpVersion: "V1" }],
  ["the v3 username", "the v3 card", { snmpV3Username: "netops-readonly" }],
  [
    "the v3 security level",
    "the v3 card",
    { snmpV3SecurityLevel: "authNoPriv" },
  ],
  ["the v3 auth protocol", "the v3 card", { snmpV3AuthProtocol: "MD5" }],
  ["the v3 auth key", "the v3 card", { snmpV3AuthKey: "rotated-auth-secret" }],
  ["the v3 priv protocol", "the v3 card", { snmpV3PrivProtocol: "DES" }],
  ["the v3 priv key", "the v3 card", { snmpV3PrivKey: "rotated-priv-secret" }],
];

describe("NetworkDeviceDiscoveryScanService: what counts as a credential change", () => {
  /*
   * THE RECONCILER LOOP, run for real rather than described.
   *
   * Two saves of the SAME id-less body. The first is a genuine change — a
   * second credential set appears — so it retires the run, which is correct.
   * The second is byte-identical to the first and must be a no-op.
   *
   * In between, the server has minted ids onto the stored row (asserted, so
   * this test cannot pass by the ids never being minted at all), which is the
   * whole trap: the comparison sees a stored list carrying two ObjectIDs
   * against a posted list carrying two freshly-minted DIFFERENT ObjectIDs. If
   * `id` counted, the second save would retire the run and delete the hosts —
   * and so would the third, and the fourth, forever.
   */
  it("does not retire the run when a client that never echoes ids back posts the same list twice", async () => {
    const writesAfterFirstSave: Array<ReconcileWrite> = await saveSettings({
      ...unchangedSave(),
      snmpConfigs: idLessConfigs(),
    });

    expect(writesAfterFirstSave).toHaveLength(1);
    expect(writesAfterFirstSave[0]!.data["status"]).toBe("Pending");

    const writeCountAfterFirstSave: number = writesAfterFirstSave.length;

    /*
     * The row now holds server-minted ids for entries that arrived with none.
     * That is the state the second save has to compare against.
     */
    const storedAfterFirstSave: Array<DiscoveryScanSnmpConfig> = storedScans[0]!
      .snmpConfigs as Array<DiscoveryScanSnmpConfig>;

    expect(storedAfterFirstSave).toHaveLength(2);

    for (const config of storedAfterFirstSave) {
      expect({ hasMintedId: Boolean(config.id) }).toEqual({
        hasMintedId: true,
      });
    }

    const writesAfterSecondSave: Array<ReconcileWrite> = await saveSettings({
      ...unchangedSave(),
      snmpConfigs: idLessConfigs(),
    });

    expect(writesAfterSecondSave.slice(writeCountAfterFirstSave)).toEqual([]);
  });

  /*
   * The label on a credential card is for the operator reading the list. It
   * never reaches an SNMP packet, so renaming "Access switches" to "Edge
   * switches" cannot have invalidated a single host the scan found.
   *
   * Everything else in this payload is the stored row posted back verbatim,
   * which is what ModelForm sends on every save — so a write here would mean
   * the rename, and nothing else, deleted the results.
   */
  it("does not retire the run when only a config's operator label changes", async () => {
    const renamedConfigs: Array<DiscoveryScanSnmpConfig> =
      storedSnmpConfigs().map(
        (config: DiscoveryScanSnmpConfig): DiscoveryScanSnmpConfig => {
          return { ...config, name: "Edge switches" };
        },
      );

    const writes: Array<ReconcileWrite> = await saveSettings({
      ...unchangedSave(),
      snmpConfigs: renamedConfigs,
    });

    expect(writes).toEqual([]);
  });

  /*
   * The other side of the same line: the fields that DO reach the wire still
   * retire the run, one at a time.
   *
   * ISOLATION IS THE POINT OF THE FIXTURE HERE. Each case posts the whole
   * unchanged form — which names all nine flattened SNMP columns, so
   * `applySnmpConfigs` mirrors nothing over them ("the payload wins where it
   * speaks for itself") and their values stay exactly what the stored row
   * holds. The credential LIST is therefore the only thing in the payload that
   * differs, and a retirement here can have no other cause.
   *
   * Without that, "stop comparing id and name" could be simplified all the way
   * into "stop comparing the list", the mirrored flattened columns would flag
   * the change instead, and every one of these would still pass while the
   * multi-config case they exist for went unguarded.
   *
   * The fixture is rebuilt per case because a save mutates the stored row.
   */
  it("still retires the run when a real session parameter changes", async () => {
    for (const [label, whichConfig, change] of REAL_CREDENTIAL_CHANGES) {
      storedScans = [
        storedScan({
          snmpConfigs: [...storedSnmpConfigs(), coreRoutersConfig()],
        }),
      ];
      reconcileWrites = [];

      const postedConfigs: Array<DiscoveryScanSnmpConfig> =
        whichConfig === "the v2c card"
          ? [{ ...storedSnmpConfigs()[0]!, ...change }, coreRoutersConfig()]
          : [storedSnmpConfigs()[0]!, { ...coreRoutersConfig(), ...change }];

      const writes: Array<ReconcileWrite> = await saveSettings({
        ...unchangedSave(),
        snmpConfigs: postedConfigs,
      });

      /*
       * The cleared results are asserted as a boolean rather than read out of
       * the payload, because the value they are cleared TO is null — and a
       * `?? fallback` on the way to the assertion would report an untouched
       * payload and a cleared one identically.
       */
      expect({
        changed: label,
        on: whichConfig,
        status: writes[0]?.data["status"] ?? "no write at all",
        clearedTheHostsItFound:
          writes[0] !== undefined &&
          writes[0].data["discoveredDevices"] === null,
      }).toEqual({
        changed: label,
        on: whichConfig,
        status: "Pending",
        clearedTheHostsItFound: true,
      });
    }
  });

  /*
   * Order is a sweep parameter, and dropping `id` from the comparison is
   * exactly the change that could have hidden it — before the fix, two
   * reordered entries were told apart by their ids as much as by anything
   * else.
   *
   * It matters because order decides which credential each host is tried with
   * FIRST, and because the first entry is the one mirrored onto the flattened
   * columns that every older probe in the fleet reads. A scan whose preferred
   * credential moved can find a different set of hosts.
   *
   * Posted without ids, so the comparison has nothing but the session
   * parameters and their order to go on — and posted alongside the row's own
   * flattened columns, unchanged, for the same isolation reason as the table
   * above: a payload that names those columns suppresses the mirror, so the
   * REORDER cannot be detected second-hand through a mirrored first config
   * that happens to have moved.
   */
  it("still retires the run when an id-less list is only reordered", async () => {
    storedScans = [
      storedScan({
        snmpConfigs: [...storedSnmpConfigs(), coreRoutersConfig()],
      }),
    ];

    const reorderedConfigs: Array<DiscoveryScanSnmpConfig> =
      idLessConfigs().reverse();

    const writes: Array<ReconcileWrite> = await saveSettings({
      ...unchangedSave(),
      snmpConfigs: reorderedConfigs,
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]!.data["status"]).toBe("Pending");
  });

  /*
   * Deleting a credential card is the counterpart of adding one, pinned above.
   * The hosts the removed config found are still on the row, attributed to a
   * credential set the scan no longer has — the import path would fall back to
   * the first config and create devices that can never poll.
   *
   * The removed card is the SECOND one, so the flattened columns mirrored from
   * the first are unaffected either way — and they are posted unchanged on top
   * of that. The shortened list is the only difference in the payload.
   */
  it("still retires the run when a config is removed from the list", async () => {
    storedScans = [
      storedScan({
        snmpConfigs: [...storedSnmpConfigs(), coreRoutersConfig()],
      }),
    ];

    const writes: Array<ReconcileWrite> = await saveSettings({
      ...unchangedSave(),
      snmpConfigs: [storedSnmpConfigs()[0]!],
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]!.data["status"]).toBe("Pending");
  });
});

/*
 * ---------------------------------------------------------------------------
 * THE LIST IS NEVER NULLED OUT FROM UNDER A SCAN (issue #3458, review round).
 * ---------------------------------------------------------------------------
 *
 * `reconcileLegacySnmpUpdate` used to answer a save written through the
 * flattened columns alone by NULLING `snmpConfigs`, on the reasoning that the
 * list would otherwise go on shadowing the columns the caller had just
 * written.
 *
 * That left the row in the one state the product cannot survive: credentials
 * that are READABLE but not EDITABLE. `SnmpScanConfigUtil.resolve` falls back
 * to the flattened columns, so the probe kept sweeping correctly and nothing
 * looked wrong — but the Edit dialog's only SNMP control is the list editor,
 * and it selects `snmpConfigs` and nothing else. It therefore opened a BLANK
 * credential card over a scan holding a real community string, and saving that
 * card mirrored its emptiness back over all nine flattened columns and wiped
 * them.
 *
 * The fix keeps the list: the reconciliation now reports that a legacy write
 * happened, and `onUpdateSuccess` REBUILDS the list from the row's own
 * flattened columns once the write has landed.
 */
describe("NetworkDeviceDiscoveryScanService: a legacy save leaves the list rebuilt, never null", () => {
  /*
   * A whole v3 credential set written through the flattened columns — nine
   * columns at once, which is what an integration written before the list
   * existed actually sends.
   *
   * The rebuilt list must describe those NINE values, not the v2c community
   * string the row's list held a moment ago: a list still holding "public"
   * would shadow the v3 credentials the caller was told had been stored.
   *
   * Asserted alongside the retirement, because this save really does change
   * the sweep and both writes land in the same statement.
   */
  it("rebuilds the whole v3 credential set a legacy save wrote, rather than nulling the list", async () => {
    storedScans = [storedScan()];

    const writes: Array<ReconcileWrite> = await saveSettings({
      snmpVersion: "V3",
      snmpCommunityString: null,
      snmpPort: 1161,
      snmpV3SecurityLevel: "authPriv",
      snmpV3Username: "netops",
      snmpV3AuthProtocol: "SHA",
      snmpV3AuthKey: "auth-secret",
      snmpV3PrivProtocol: "AES",
      snmpV3PrivKey: "priv-secret",
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]!.data["status"]).toBe("Pending");

    /*
     * The synthetic legacy id, and no `name` — a save through these columns
     * has no way to express a label, and inventing one would be the rebuild
     * claiming to know something the caller never sent.
     */
    expect(writes[0]!.data["snmpConfigs"]).toEqual([
      {
        id: LEGACY_SNMP_CONFIG_ID,
        snmpVersion: "V3",
        snmpPort: 1161,
        snmpV3SecurityLevel: "authPriv",
        snmpV3Username: "netops",
        snmpV3AuthProtocol: "SHA",
        snmpV3AuthKey: "auth-secret",
        snmpV3PrivProtocol: "AES",
        snmpV3PrivKey: "priv-secret",
      },
    ]);
  });

  /*
   * THE INVARIANT, stated directly rather than implied by the paths above.
   *
   * Every way the PRODUCT can write an SNMP scan has to leave it holding a
   * credential list, because that is the single assumption the Edit dialog
   * makes: it seeds its list editor from `snmpConfigs` alone, so any path that
   * can leave the column null is a path that can hand an operator a blank card
   * over live credentials and let them save it away.
   *
   * Three writers maintain it — the backfill migration, `onBeforeCreate`, and
   * (since the fix) `onUpdateSuccess` — and the fourth, `onBeforeUpdate` with
   * a list in the payload, simply stores what was sent. This walks all of them
   * in one test so that adding a fifth without maintaining the invariant fails
   * here rather than in the dialog.
   *
   * The reader is deliberately NOT the thing under test: resolve() falls back
   * to the flattened columns and would answer happily for a null list, which
   * is precisely why the defect was invisible in production.
   */
  it("never leaves an SNMP scan with a null credential list, whichever way the product writes it", async () => {
    const createdFromFlattenedColumns: Record<string, unknown> =
      await createdRow({
        snmpVersion: "V2c",
        snmpCommunityString: "public",
        snmpPort: 161,
      });

    const createdFromTheListItself: Record<string, unknown> = await createdRow({
      snmpConfigs: [coreRoutersConfig()],
    });

    const createdWithNoSnmpSettingsAtAll: Record<string, unknown> =
      await createdRow({});

    storedScans = [storedScan()];
    reconcileWrites = [];

    const savedThroughTheEditForm: Record<string, unknown> = await updatedRow({
      ...unchangedSave(),
      snmpConfigs: [coreRoutersConfig()],
    });

    storedScans = [storedScan()];
    reconcileWrites = [];

    const legacyWrites: Array<ReconcileWrite> = await saveSettings({
      snmpCommunityString: "private",
    });

    /*
     * For the legacy path the final value is the one the reconciling write
     * put back, because the payload itself never mentioned the column.
     */
    const finalListPerWritePath: Array<[string, unknown]> = [
      [
        "created from the flattened columns",
        createdFromFlattenedColumns["snmpConfigs"],
      ],
      ["created from the list itself", createdFromTheListItself["snmpConfigs"]],
      [
        "created with no SNMP settings at all",
        createdWithNoSnmpSettingsAtAll["snmpConfigs"],
      ],
      ["saved through the edit form", savedThroughTheEditForm["snmpConfigs"]],
      [
        "saved through the flattened columns alone",
        legacyWrites[0]?.data["snmpConfigs"],
      ],
    ];

    for (const [path, storedList] of finalListPerWritePath) {
      expect({
        path: path,
        holdsACredentialList:
          Array.isArray(storedList) && storedList.length > 0,
      }).toEqual({
        path: path,
        holdsACredentialList: true,
      });
    }
  });
});
