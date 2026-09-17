import { afterEach, describe, expect, test } from "@jest/globals";
import NetworkDeviceMacLearningUtil, {
  MacLearningResult,
} from "../../../../Server/Utils/Monitor/NetworkDeviceMacLearningUtil";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import { MacLearningIpBinding } from "../../../../Utils/Monitor/DeviceMacLearningUtil";
import ObjectID from "../../../../Types/ObjectID";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import { JSONObject } from "../../../../Types/JSON";
import { FindOperator } from "typeorm";

/*
 * NetworkDeviceMacLearningUtil is the thin server half of MAC learning: it
 * reads the devices registered at the addresses a router's ARP table bound,
 * hands them to the pure planner, and applies the plan with the hook-free
 * compare-and-set write. The planner's rules are pinned in
 * Tests/Utils/Monitor/DeviceMacLearningUtil.test.ts; what is pinned HERE is
 * the database contract around it:
 *
 *  - the read asks about exactly the bound addresses, chunked so the
 *    literal `IN (...)` list never exceeds what the planner can take;
 *  - the read is NOT narrowed by site or by an empty MAC column - the
 *    planner has to see the second device at an address, or the device that
 *    already has a MAC, to refuse correctly;
 *  - the write is one hook-free statement per planned device, guarded so it
 *    fills the column only while it is still NULL.
 */

const PROJECT_ID: string = "1c9d4a7b-0000-4000-8000-000000000011";
const ROUTER_ID: string = "8f2c1f0e-0000-4000-8000-0000000000aa";
const REGISTER_ID: string = "8f2c1f0e-0000-4000-8000-0000000000bb";
const HANDSET_ID: string = "8f2c1f0e-0000-4000-8000-0000000000cc";
const SITE_A: ObjectID = new ObjectID("5a5a5a5a-0000-4000-8000-00000000000a");
const SITE_B: ObjectID = new ObjectID("5b5b5b5b-0000-4000-8000-00000000000b");

const REGISTER_IP: string = "10.0.0.5";
const REGISTER_MAC: string = "aa:bb:cc:dd:ee:01";
const HANDSET_IP: string = "10.0.0.6";
const HANDSET_MAC: string = "aa:bb:cc:dd:ee:02";

/*
 * Must track HOSTNAME_LOOKUP_CHUNK_SIZE in NetworkDeviceMacLearningUtil.
 * Written out rather than imported (it is module-private) so that changing
 * the util's constant fails HERE.
 */
const CHUNK_SIZE: number = 500;

let findBySpy: jest.SpyInstance;
let hookFreeUpdateSpy: jest.SpyInstance;

function deviceRow(
  id: string,
  hostname: string,
  overrides?: {
    siteId?: ObjectID;
    macAddress?: string;
    isMacAddressLearned?: boolean;
  },
): NetworkDevice {
  const row: NetworkDevice = new NetworkDevice();
  row.id = new ObjectID(id);
  row.hostname = hostname;
  if (overrides?.siteId) {
    row.siteId = overrides.siteId;
  }
  if (overrides?.macAddress !== undefined) {
    row.macAddress = overrides.macAddress;
  }
  if (overrides?.isMacAddressLearned !== undefined) {
    row.isMacAddressLearned = overrides.isMacAddressLearned;
  }
  return row;
}

function binding(ipAddress: string, macAddress: string): MacLearningIpBinding {
  return { ipAddress, macAddress };
}

/*
 * `count` distinct, well-formed addresses. Kept under 40 x 256 so every
 * generated address is unique — the chunk-arithmetic case counts on it.
 */
function addresses(count: number): Array<string> {
  const list: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    list.push(`10.99.${Math.floor(index / 256)}.${index % 256}`);
  }

  return list;
}

function findByArgs(callIndex: number): JSONObject {
  return findBySpy.mock.calls[callIndex]![0] as JSONObject;
}

function queryOf(callIndex: number): JSONObject {
  return findByArgs(callIndex)["query"] as JSONObject;
}

/*
 * The addresses one read actually asked about. QueryHelper.any renders the
 * chunk into a TypeORM Raw operator — `(alias IN (:...rid))` with a RANDOM
 * parameter name — so the list is recovered from the operator's parameters
 * rather than from a key a test could hard-code.
 */
function hostnamesIn(query: JSONObject): Array<string> {
  const operator: FindOperator<string> = query[
    "hostname"
  ] as unknown as FindOperator<string>;

  const parameters: Record<string, unknown> =
    (operator.objectLiteralParameters || {}) as Record<string, unknown>;

  const values: Array<unknown> =
    (Object.values(parameters)[0] as Array<unknown>) || [];

  return values.map((value: unknown): string => {
    return String(value);
  });
}

function askedAboutInCall(callIndex: number): Array<string> {
  return hostnamesIn(queryOf(callIndex));
}

function chunkSizes(): Array<number> {
  const sizes: Array<number> = [];

  for (let index: number = 0; index < findBySpy.mock.calls.length; index++) {
    sizes.push(askedAboutInCall(index).length);
  }

  return sizes;
}

/*
 * findBy answers each chunk with the seeded rows whose hostname that chunk
 * asked about — the way a real read would — so a candidate can only be
 * planned if some chunk actually asked about its address.
 */
function mockServices(rows: Array<NetworkDevice> = []): void {
  findBySpy = jest
    .spyOn(NetworkDeviceService, "findBy")
    .mockImplementation(
      async (findBy: unknown): Promise<Array<NetworkDevice>> => {
        const asked: Set<string> = new Set(
          hostnamesIn((findBy as JSONObject)["query"] as JSONObject),
        );
        return rows.filter((row: NetworkDevice) => {
          return asked.has(row.hostname || "");
        });
      },
    );
  hookFreeUpdateSpy = jest
    .spyOn(NetworkDeviceService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined);
}

async function learn(
  ipBindings: Array<MacLearningIpBinding>,
  options?: { observingSiteId?: ObjectID | undefined },
): Promise<MacLearningResult> {
  return NetworkDeviceMacLearningUtil.learnFromArpBindings({
    projectId: new ObjectID(PROJECT_ID),
    observingDeviceId: new ObjectID(ROUTER_ID),
    observingSiteId: options?.observingSiteId,
    ipBindings: ipBindings,
  });
}

function writtenDeviceIds(): Array<string> {
  return hookFreeUpdateSpy.mock.calls.map((call: Array<unknown>) => {
    return ((call[0] as JSONObject)["id"] as ObjectID).toString();
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("NetworkDeviceMacLearningUtil.learnFromArpBindings — the candidate read", () => {
  test("asks for the project's live devices at the bound addresses, and nothing narrower", async () => {
    mockServices();

    await learn([
      binding(REGISTER_IP, REGISTER_MAC),
      binding(HANDSET_IP, HANDSET_MAC),
    ]);

    expect(findBySpy).toHaveBeenCalledTimes(1);

    const query: JSONObject = queryOf(0);

    expect((query["projectId"] as ObjectID).toString()).toBe(PROJECT_ID);
    expect(query["isArchived"]).toBe(false);
    expect(askedAboutInCall(0)).toEqual([REGISTER_IP, HANDSET_IP]);
    /*
     * Deliberately NOT filtered by site or by `macAddress: null`: the
     * planner refuses on what a narrower query would have hidden.
     */
    expect(Object.keys(query).sort()).toEqual([
      "hostname",
      "isArchived",
      "projectId",
    ]);
  });

  test("selects exactly the columns the planner keys on, as root", async () => {
    mockServices();

    await learn([binding(REGISTER_IP, REGISTER_MAC)]);

    const args: JSONObject = findByArgs(0);

    expect(args["select"]).toEqual({
      _id: true,
      hostname: true,
      siteId: true,
      macAddress: true,
      isMacAddressLearned: true,
    });
    expect(args["props"]).toEqual({ isRoot: true });
    expect(args["limit"]).toBe(LIMIT_MAX);
    expect(args["skip"]).toBe(0);
  });

  test("one address bound to two MACs is asked about once", async () => {
    mockServices();

    await learn([
      binding(REGISTER_IP, REGISTER_MAC),
      binding(REGISTER_IP, "aa:bb:cc:dd:ee:99"),
    ]);

    expect(askedAboutInCall(0)).toEqual([REGISTER_IP]);
  });

  test("bound addresses are trimmed, and blank ones dropped, before the read", async () => {
    mockServices();

    await learn([
      binding(` ${REGISTER_IP} `, REGISTER_MAC),
      binding("   ", HANDSET_MAC),
    ]);

    expect(askedAboutInCall(0)).toEqual([REGISTER_IP]);
  });

  test("empty bindings issue no read and no write", async () => {
    mockServices();

    const result: MacLearningResult = await learn([]);

    expect(findBySpy).not.toHaveBeenCalled();
    expect(hookFreeUpdateSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ candidateDeviceCount: 0, plannedCount: 0 });
  });

  test("bindings with only blank addresses issue no read either", async () => {
    mockServices();

    const result: MacLearningResult = await learn([binding("", REGISTER_MAC)]);

    expect(findBySpy).not.toHaveBeenCalled();
    expect(result).toEqual({ candidateDeviceCount: 0, plannedCount: 0 });
  });

  test("1,001 distinct addresses are read in chunks of 500, and candidates from every chunk are planned", async () => {
    const bound: Array<string> = addresses(CHUNK_SIZE * 2 + 1);
    const firstInFirstChunk: string = bound[0]!;
    const onlyOneInLastChunk: string = bound[bound.length - 1]!;

    mockServices([
      deviceRow(REGISTER_ID, firstInFirstChunk, { siteId: SITE_A }),
      deviceRow(HANDSET_ID, onlyOneInLastChunk, { siteId: SITE_A }),
    ]);

    const result: MacLearningResult = await learn(
      bound.map((ip: string, index: number) => {
        return binding(
          ip,
          `aa:bb:${Math.floor(index / 256)
            .toString(16)
            .padStart(
              2,
              "0",
            )}:${(index % 256).toString(16).padStart(2, "0")}:00:01`,
        );
      }),
      { observingSiteId: SITE_A },
    );

    expect(findBySpy).toHaveBeenCalledTimes(3);
    expect(chunkSizes()).toEqual([CHUNK_SIZE, CHUNK_SIZE, 1]);

    // Every address, once, across the three reads.
    const asked: Array<string> = [];
    for (let index: number = 0; index < findBySpy.mock.calls.length; index++) {
      asked.push(...askedAboutInCall(index));
    }
    expect(asked).toEqual(bound);

    // A device answered by the first chunk and one by the last both land.
    expect(result).toEqual({ candidateDeviceCount: 2, plannedCount: 2 });
    expect(writtenDeviceIds().sort()).toEqual([REGISTER_ID, HANDSET_ID].sort());
  });

  test("a returned row with no id is not a candidate", async () => {
    const nameless: NetworkDevice = new NetworkDevice();
    nameless.hostname = REGISTER_IP;
    nameless.siteId = SITE_A;
    mockServices([nameless]);

    const result: MacLearningResult = await learn(
      [binding(REGISTER_IP, REGISTER_MAC)],
      { observingSiteId: SITE_A },
    );

    expect(result).toEqual({ candidateDeviceCount: 0, plannedCount: 0 });
    expect(hookFreeUpdateSpy).not.toHaveBeenCalled();
  });
});

describe("NetworkDeviceMacLearningUtil.learnFromArpBindings — the write", () => {
  test("each planned device gets exactly one hook-free compare-and-set write", async () => {
    mockServices([
      deviceRow(REGISTER_ID, REGISTER_IP, { siteId: SITE_A }),
      deviceRow(HANDSET_ID, HANDSET_IP, { siteId: SITE_A }),
    ]);

    const result: MacLearningResult = await learn(
      [
        binding(REGISTER_IP, "AA-BB-CC-DD-EE-01"),
        binding(HANDSET_IP, HANDSET_MAC),
      ],
      { observingSiteId: SITE_A },
    );

    expect(hookFreeUpdateSpy).toHaveBeenCalledTimes(2);

    const byId: Map<string, JSONObject> = new Map(
      hookFreeUpdateSpy.mock.calls.map((call: Array<unknown>) => {
        const input: JSONObject = call[0] as JSONObject;
        return [(input["id"] as ObjectID).toString(), input];
      }),
    );

    expect(Array.from(byId.keys()).sort()).toEqual(
      [REGISTER_ID, HANDSET_ID].sort(),
    );

    const registerWrite: JSONObject = byId.get(REGISTER_ID)!;
    // Normalized on the way in: the row never sees the ARP table's spelling.
    expect(registerWrite["data"]).toEqual({
      macAddress: REGISTER_MAC,
      isMacAddressLearned: true,
    });
    /*
     * Fill only while still empty, and never a row deleted between the
     * read and this write. This guard is what makes the whole thing safe to
     * run from every router's walk without a lock.
     */
    expect(registerWrite["expectedData"]).toEqual({
      macAddress: null,
      deletedAt: null,
    });

    const handsetWrite: JSONObject = byId.get(HANDSET_ID)!;
    expect(handsetWrite["data"]).toEqual({
      macAddress: HANDSET_MAC,
      isMacAddressLearned: true,
    });
    expect(handsetWrite["expectedData"]).toEqual({
      macAddress: null,
      deletedAt: null,
    });

    expect(result).toEqual({ candidateDeviceCount: 2, plannedCount: 2 });
  });

  test("the write goes through updateColumnsByIdWithoutHooks and never the hooked update", async () => {
    const hookedUpdateSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "updateOneById")
      .mockResolvedValue(1);
    mockServices([deviceRow(REGISTER_ID, REGISTER_IP, { siteId: SITE_A })]);

    await learn([binding(REGISTER_IP, REGISTER_MAC)], {
      observingSiteId: SITE_A,
    });

    expect(hookFreeUpdateSpy).toHaveBeenCalledTimes(1);
    expect(hookedUpdateSpy).not.toHaveBeenCalled();
  });

  test("a device already carrying a MAC is a candidate but is never written", async () => {
    mockServices([
      deviceRow(REGISTER_ID, REGISTER_IP, {
        siteId: SITE_A,
        macAddress: "00:11:22:33:44:55",
      }),
    ]);

    const result: MacLearningResult = await learn(
      [binding(REGISTER_IP, REGISTER_MAC)],
      { observingSiteId: SITE_A },
    );

    expect(hookFreeUpdateSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ candidateDeviceCount: 1, plannedCount: 0 });
  });

  test("a device in another site is a candidate but is never written", async () => {
    mockServices([deviceRow(REGISTER_ID, REGISTER_IP, { siteId: SITE_B })]);

    const result: MacLearningResult = await learn(
      [binding(REGISTER_IP, REGISTER_MAC)],
      { observingSiteId: SITE_A },
    );

    expect(hookFreeUpdateSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ candidateDeviceCount: 1, plannedCount: 0 });
  });

  test("the observing site is compared as a string, so an equal ObjectID matches", async () => {
    // A fresh ObjectID with the same value: equal by string, not by reference.
    mockServices([
      deviceRow(REGISTER_ID, REGISTER_IP, {
        siteId: new ObjectID(SITE_A.toString()),
      }),
    ]);

    const result: MacLearningResult = await learn(
      [binding(REGISTER_IP, REGISTER_MAC)],
      { observingSiteId: new ObjectID(SITE_A.toString()) },
    );

    expect(result).toEqual({ candidateDeviceCount: 1, plannedCount: 1 });
    expect(writtenDeviceIds()).toEqual([REGISTER_ID]);
  });

  test("a router with no site stamps only devices with no site", async () => {
    mockServices([
      deviceRow(REGISTER_ID, REGISTER_IP),
      deviceRow(HANDSET_ID, HANDSET_IP, { siteId: SITE_A }),
    ]);

    const result: MacLearningResult = await learn(
      [binding(REGISTER_IP, REGISTER_MAC), binding(HANDSET_IP, HANDSET_MAC)],
      { observingSiteId: undefined },
    );

    expect(writtenDeviceIds()).toEqual([REGISTER_ID]);
    expect(result).toEqual({ candidateDeviceCount: 2, plannedCount: 1 });
  });

  test("two devices at one address: neither is written, but both are counted as candidates", async () => {
    mockServices([
      deviceRow(REGISTER_ID, REGISTER_IP, { siteId: SITE_A }),
      deviceRow(HANDSET_ID, REGISTER_IP, { siteId: SITE_A }),
    ]);

    const result: MacLearningResult = await learn(
      [binding(REGISTER_IP, REGISTER_MAC)],
      { observingSiteId: SITE_A },
    );

    expect(hookFreeUpdateSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ candidateDeviceCount: 2, plannedCount: 0 });
  });

  test("nothing is written when no device is registered at any bound address", async () => {
    mockServices([deviceRow(REGISTER_ID, "10.0.0.250", { siteId: SITE_A })]);

    const result: MacLearningResult = await learn(
      [binding(REGISTER_IP, REGISTER_MAC)],
      { observingSiteId: SITE_A },
    );

    expect(findBySpy).toHaveBeenCalledTimes(1);
    expect(hookFreeUpdateSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ candidateDeviceCount: 0, plannedCount: 0 });
  });

  test("a write that throws surfaces to the caller, after the writes before it landed", async () => {
    /*
     * The util does not swallow: the walk pipeline wraps this call in its
     * own try/catch (pinned in NetworkInventoryUtil.test.ts), and a silent
     * catch here would hide a broken write path from that log line.
     */
    mockServices([
      deviceRow(REGISTER_ID, REGISTER_IP, { siteId: SITE_A }),
      deviceRow(HANDSET_ID, HANDSET_IP, { siteId: SITE_A }),
    ]);
    hookFreeUpdateSpy
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("connection reset"));

    await expect(
      learn(
        [binding(REGISTER_IP, REGISTER_MAC), binding(HANDSET_IP, HANDSET_MAC)],
        { observingSiteId: SITE_A },
      ),
    ).rejects.toThrow("connection reset");

    expect(hookFreeUpdateSpy).toHaveBeenCalledTimes(2);
  });
});

/*
 * The pass may correct a MAC it learned itself - the ARP table it learned
 * from is exactly the evidence that goes stale - and only that. The write
 * compares-and-sets on the value the plan saw, so a value that changed
 * under the plan (an operator typing one in) is left alone by the row.
 */
describe("NetworkDeviceMacLearningUtil.learnFromArpBindings — correcting a learned MAC", () => {
  const STALE_MAC: string = "de:ad:be:ef:00:01";

  test("a learned MAC the table now contradicts is rewritten, compare-and-set on the old value", async () => {
    mockServices([
      deviceRow(REGISTER_ID, REGISTER_IP, {
        macAddress: STALE_MAC,
        isMacAddressLearned: true,
      }),
    ]);

    const result: MacLearningResult = await learn([
      binding(REGISTER_IP, REGISTER_MAC),
    ]);

    expect(hookFreeUpdateSpy).toHaveBeenCalledTimes(1);
    const write: JSONObject = hookFreeUpdateSpy.mock.calls[0]![0] as JSONObject;
    expect(write["data"]).toEqual({
      macAddress: REGISTER_MAC,
      isMacAddressLearned: true,
    });
    expect(write["expectedData"]).toEqual({
      macAddress: STALE_MAC,
      deletedAt: null,
    });
    expect(result).toEqual({ candidateDeviceCount: 1, plannedCount: 1 });
  });

  test("a typed MAC is never rewritten, however much the table disagrees", async () => {
    mockServices([
      deviceRow(REGISTER_ID, REGISTER_IP, {
        macAddress: STALE_MAC,
        isMacAddressLearned: false,
      }),
    ]);

    const result: MacLearningResult = await learn([
      binding(REGISTER_IP, REGISTER_MAC),
    ]);

    expect(hookFreeUpdateSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ candidateDeviceCount: 1, plannedCount: 0 });
  });

  test("a learned MAC the table still agrees with is left alone", async () => {
    mockServices([
      deviceRow(REGISTER_ID, REGISTER_IP, {
        macAddress: REGISTER_MAC,
        isMacAddressLearned: true,
      }),
    ]);

    await learn([binding(REGISTER_IP, REGISTER_MAC)]);

    expect(hookFreeUpdateSpy).not.toHaveBeenCalled();
  });
});
