import NetworkDeviceDiscoveryScanService from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import ScanTargetUtil from "../../../Utils/NetworkDiscovery/ScanTargetUtil";
import ScanNameUtil from "../../../Utils/NetworkDiscovery/ScanNameUtil";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { describe, expect, it } from "@jest/globals";

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
