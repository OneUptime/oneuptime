import NetworkDeviceDiscoveryScanService from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import ScanTargetUtil from "../../../Utils/NetworkDiscovery/ScanTargetUtil";
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
