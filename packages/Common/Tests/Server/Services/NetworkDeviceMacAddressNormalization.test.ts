import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import { Service as NetworkDeviceServiceType } from "../../../Server/Services/NetworkDeviceService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT THIS FILE IS DEFENDING
 *
 * NetworkDevice.macAddress is what lets a ping-only device (issue #3489) be
 * recognised in the forwarding tables of the switches around it: the
 * topology builder compares the declared MAC against each NetworkEndpoint
 * row's MAC as a plain string. Every endpoint row already holds the
 * lowercase colon form, so the one thing that makes the comparison work is
 * that the declared MAC is stored the same way whatever an operator pasted.
 * A MAC stored as "AA-BB-CC-DD-EE-FF" is not wrong, it is just a MAC that
 * matches nothing, forever, with no error anywhere.
 *
 * So these tests pin the write-side contract of the hook, through the real
 * onBeforeCreate and onBeforeUpdate:
 *
 *   - every accepted spelling lands as aa:bb:cc:dd:ee:ff;
 *   - blank clears the column (a form cannot post null);
 *   - anything that is not twelve hex digits is REFUSED, not stored;
 *   - a non-string is refused with its own message;
 *   - undefined, null and a SQL-expression function pass through untouched.
 *
 * And, on the update path, that the normalisation sits ABOVE the early
 * return. A macAddress-only payload changes neither site nor identity, so
 * it is precisely the shape that skips the snapshot read — the same trap
 * the OID template guard once fell into (NetworkDeviceOidTemplateWriteGuards
 * .test.ts). A normaliser placed below the return would be dead code on the
 * only write the device settings form actually makes.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const BOGUS_SITE_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

const STORED_FORM: string = "aa:bb:cc:dd:ee:ff";

/*
 * The spellings an operator is likely to paste — from a switch CLI, a
 * vendor label, a Windows ipconfig, a Cisco show mac address-table — and
 * that normalizeMac is documented to accept. Each has to land as the ONE
 * stored form, because equality against endpoint rows is the whole point.
 */
const ACCEPTED_SPELLINGS: Array<string> = [
  "aa:bb:cc:dd:ee:ff",
  "AA:BB:CC:DD:EE:FF",
  "AA-BB-CC-DD-EE-FF",
  "aabb.ccdd.eeff",
  "AABB.CCDD.EEFF",
  "aabbccddeeff",
  "AABBCCDDEEFF",
  "0xaabbccddeeff",
  "0XAABBCCDDEEFF",
  "  aa:bb:cc:dd:ee:ff  ",
];

const BLANK_SPELLINGS: Array<string> = ["", "   ", "\t", "\n"];

/*
 * Not a MAC, in the ways it usually goes wrong: five pairs, seven pairs,
 * letters past f, eleven digits, prose.
 */
const REJECTED_SPELLINGS: Array<string> = [
  "aa:bb:cc:dd:ee",
  "aa:bb:cc:dd:ee:ff:00",
  "gg:hh:ii:jj:kk:ll",
  "aa:bb:cc:dd:ee:f",
  "not-a-mac",
  "aa:bb:cc:dd:ee:ff extra",
];

const NOT_A_MAC_MESSAGE: RegExp = /six pairs of hex digits/;
const NOT_TEXT_MESSAGE: RegExp = /must be text/;

type DeviceServiceInternals = {
  onBeforeCreate: (
    createBy: CreateBy<NetworkDevice>,
  ) => Promise<OnCreate<NetworkDevice>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<NetworkDevice>,
  ) => Promise<OnUpdate<NetworkDevice>>;
};

function buildDeviceService(): {
  service: NetworkDeviceServiceType;
  internals: DeviceServiceInternals;
} {
  const service: NetworkDeviceServiceType = new NetworkDeviceServiceType();
  return {
    service,
    internals: service as unknown as DeviceServiceInternals,
  };
}

/*
 * The device the update matches, for the one write shape below that does
 * reach the snapshot read.
 */
function matchedDevice(): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice(DEVICE_ID);
  device.projectId = PROJECT_ID;
  return device;
}

/*
 * A create carrying the identity columns and a MAC, and nothing that would
 * make the hook reach for the database: no site, no probe, no monitor, no
 * template. `macAddress` is written through a loose record so a test can
 * hand the hook a value the model's type would not allow.
 */
function createWithMac(macAddress: unknown): CreateBy<NetworkDevice> {
  const device: NetworkDevice = new NetworkDevice();
  device.projectId = PROJECT_ID;
  device.name = "Register 4";
  device.hostname = "10.20.30.44";
  (device as unknown as Record<string, unknown>)["macAddress"] = macAddress;

  return {
    data: device,
    props: { isRoot: true },
  } as CreateBy<NetworkDevice>;
}

/*
 * A payload that writes the MAC and NOTHING else — no site, no hostname, no
 * name, no sysName. This is the shape the device settings form posts, and
 * it is precisely the shape that trips onBeforeUpdate's early return.
 */
function macOnlyUpdate(macAddress: unknown): UpdateBy<NetworkDevice> {
  return {
    query: { _id: DEVICE_ID.toString() },
    data: { macAddress: macAddress },
    props: { isRoot: true },
  } as unknown as UpdateBy<NetworkDevice>;
}

function storedMacOf(result: OnCreate<NetworkDevice>): unknown {
  return (result.createBy.data as unknown as Record<string, unknown>)[
    "macAddress"
  ];
}

function writtenMacOf(result: OnUpdate<NetworkDevice>): unknown {
  return (result.updateBy.data as unknown as Record<string, unknown>)[
    "macAddress"
  ];
}

describe("the MAC address is normalised on create", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test.each(ACCEPTED_SPELLINGS)(
    "stores %j as lowercase colon form",
    async (spelling: string) => {
      const { internals } = buildDeviceService();

      const result: OnCreate<NetworkDevice> = await internals.onBeforeCreate(
        createWithMac(spelling),
      );

      expect(storedMacOf(result)).toBe(STORED_FORM);
    },
  );

  /*
   * A form cannot post null, and "delete what I typed" has to work from
   * one. Blank is the spelling of "no MAC" that reaches the hook.
   */
  test.each(BLANK_SPELLINGS)("stores %j as null", async (spelling: string) => {
    const { internals } = buildDeviceService();

    const result: OnCreate<NetworkDevice> = await internals.onBeforeCreate(
      createWithMac(spelling),
    );

    expect(storedMacOf(result)).toBeNull();
  });

  /*
   * A model instance carries every column as an own property set to
   * undefined, so `"macAddress" in data` is true on a create that never
   * mentioned the MAC. That must NOT be read as "clear it": undefined has to
   * come out as undefined, or every discovery import would write a null it
   * never asked for.
   */
  test("leaves an unset MAC undefined rather than turning it into null", async () => {
    const { internals } = buildDeviceService();
    const createBy: CreateBy<NetworkDevice> = createWithMac(undefined);

    expect("macAddress" in createBy.data).toBe(true);

    const result: OnCreate<NetworkDevice> =
      await internals.onBeforeCreate(createBy);

    expect(storedMacOf(result)).toBeUndefined();
  });

  /*
   * THE assertion of the column. A malformed MAC stored as typed is not an
   * error anyone sees — it is a device that never gets its cable drawn, with
   * nothing to say why. Refuse it at the write.
   */
  test.each(REJECTED_SPELLINGS)(
    "refuses %j with the six-pairs message",
    async (spelling: string) => {
      const { internals } = buildDeviceService();

      await expect(
        internals.onBeforeCreate(createWithMac(spelling)),
      ).rejects.toThrow(NOT_A_MAC_MESSAGE);
    },
  );

  test("the refusal is a BadDataException, so the API answers 400 and not 500", async () => {
    const { internals } = buildDeviceService();

    await expect(
      internals.onBeforeCreate(createWithMac("not-a-mac")),
    ).rejects.toThrow(BadDataException);
  });

  /*
   * A number is what a JSON client sends when it drops the quotes around
   * twelve bare hex digits that happen to be all decimal. Its own message,
   * because "six pairs of hex digits" would send the caller looking at the
   * digits rather than the quotes.
   */
  test("refuses a non-string with its own message", async () => {
    const { internals } = buildDeviceService();

    await expect(
      internals.onBeforeCreate(createWithMac(112233445566)),
    ).rejects.toThrow(NOT_TEXT_MESSAGE);
    await expect(
      internals.onBeforeCreate(createWithMac(112233445566)),
    ).rejects.toThrow(BadDataException);
  });

  /*
   * Ordering within the hook. The site tenancy guard is the first thing
   * onBeforeCreate reaches for the database on, and a payload can be wrong
   * in both ways at once. The MAC check runs first, so the operator hears
   * about the field they just typed rather than about a site lookup — and,
   * more to the point, a malformed MAC never costs a database round trip.
   *
   * The stub resolves null, which is what the guard sees for a site that
   * does not exist; the companion test below proves the stub is live.
   */
  test("normalises before the site guard runs, so a bad MAC wins over a bad site", async () => {
    const { internals } = buildDeviceService();

    const siteFindSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "findOneById")
      .mockResolvedValue(null as never);

    const createBy: CreateBy<NetworkDevice> = createWithMac("not-a-mac");
    createBy.data.siteId = BOGUS_SITE_ID;

    await expect(internals.onBeforeCreate(createBy)).rejects.toThrow(
      NOT_A_MAC_MESSAGE,
    );
    expect(siteFindSpy).not.toHaveBeenCalled();
  });

  test("...and the site guard really would have refused that site", async () => {
    const { internals } = buildDeviceService();

    const siteFindSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "findOneById")
      .mockResolvedValue(null as never);

    const createBy: CreateBy<NetworkDevice> = createWithMac(STORED_FORM);
    createBy.data.siteId = BOGUS_SITE_ID;

    await expect(internals.onBeforeCreate(createBy)).rejects.toThrow(
      /Network site not found/,
    );
    expect(siteFindSpy).toHaveBeenCalledTimes(1);
  });
});

describe("the MAC address is normalised on update", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test.each(ACCEPTED_SPELLINGS)(
    "writes %j as lowercase colon form",
    async (spelling: string) => {
      const { internals } = buildDeviceService();

      const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate(
        macOnlyUpdate(spelling),
      );

      expect(writtenMacOf(result)).toBe(STORED_FORM);
    },
  );

  test.each(BLANK_SPELLINGS)("writes %j as null", async (spelling: string) => {
    const { internals } = buildDeviceService();

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate(
      macOnlyUpdate(spelling),
    );

    expect(writtenMacOf(result)).toBeNull();
  });

  // Null is already "clear the column"; there is nothing to normalise.
  test("leaves an explicit null as null", async () => {
    const { internals } = buildDeviceService();

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate(
      macOnlyUpdate(null),
    );

    expect(writtenMacOf(result)).toBeNull();
  });

  /*
   * TypeORM drops an undefined column before it builds the SET list, so an
   * undefined that reaches the hook is a column the write does not touch.
   * Turning it into null would clear a MAC the caller never mentioned.
   */
  test("leaves an undefined value undefined", async () => {
    const { internals } = buildDeviceService();

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate(
      macOnlyUpdate(undefined),
    );

    expect("macAddress" in result.updateBy.data).toBe(true);
    expect(writtenMacOf(result)).toBeUndefined();
  });

  test.each(REJECTED_SPELLINGS)(
    "refuses %j with the six-pairs message",
    async (spelling: string) => {
      const { internals } = buildDeviceService();

      await expect(
        internals.onBeforeUpdate(macOnlyUpdate(spelling)),
      ).rejects.toThrow(NOT_A_MAC_MESSAGE);
    },
  );

  test("refuses a non-string with its own message", async () => {
    const { internals } = buildDeviceService();

    await expect(
      internals.onBeforeUpdate(macOnlyUpdate(112233445566)),
    ).rejects.toThrow(NOT_TEXT_MESSAGE);
    await expect(
      internals.onBeforeUpdate(macOnlyUpdate(112233445566)),
    ).rejects.toThrow(BadDataException);
  });

  /*
   * An update payload is a QueryDeepPartialEntity, so a column may hold a
   * SQL-expression function instead of a value. Nothing in the tree writes
   * this column that way, but refusing it would buy no safety and would
   * make a future caller's life harder — so it passes through by reference,
   * neither normalised nor rejected.
   */
  test("leaves a raw SQL-expression function untouched", async () => {
    const { internals } = buildDeviceService();

    const expression: () => string = (): string => {
      return `lower("macAddress")`;
    };

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate(
      macOnlyUpdate(expression),
    );

    expect(writtenMacOf(result)).toBe(expression);
  });

  /*
   * THE regression test for placement. A macAddress-only write changes
   * neither site nor identity and names none of the relations the early
   * return watches for, so the hook bails out before the snapshot read —
   * and the normalisation above still has to have run. If it drifts below
   * the return, the spelling test above fails; this one pins the other
   * half, that the early return is still taken (no snapshot read for a
   * write that does not need one).
   */
  test("a macAddress-only payload still takes the early return", async () => {
    const { service, internals } = buildDeviceService();

    const findBySpy: jest.SpyInstance = jest
      .spyOn(service, "findBy")
      .mockResolvedValue([matchedDevice()] as never);

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate(
      macOnlyUpdate("AA-BB-CC-DD-EE-FF"),
    );

    expect(writtenMacOf(result)).toBe(STORED_FORM);
    expect(result.carryForward).toBeNull();
    expect(findBySpy).not.toHaveBeenCalled();
  });

  /*
   * ...and a malformed MAC on that same shape is refused without a snapshot
   * read either: the check costs nothing on the write it exists for.
   */
  test("a malformed macAddress-only payload is refused before any read", async () => {
    const { service, internals } = buildDeviceService();

    const findBySpy: jest.SpyInstance = jest
      .spyOn(service, "findBy")
      .mockResolvedValue([matchedDevice()] as never);

    await expect(
      internals.onBeforeUpdate(macOnlyUpdate("not-a-mac")),
    ).rejects.toThrow(NOT_A_MAC_MESSAGE);

    expect(findBySpy).not.toHaveBeenCalled();
  });

  /*
   * The other write shape: the settings form saving the name and the MAC
   * together. `name` is an identity column, so this one DOES read the
   * snapshot — the MAC still has to come out normalised, and the snapshot
   * read has to have happened, or this test is the early-return test again.
   */
  test("a payload carrying other columns too still normalises", async () => {
    const { service, internals } = buildDeviceService();

    const findBySpy: jest.SpyInstance = jest
      .spyOn(service, "findBy")
      .mockResolvedValue([matchedDevice()] as never);

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate({
      query: { _id: DEVICE_ID.toString() },
      data: { name: "Register 4", macAddress: "AABB.CCDD.EEFF" },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>);

    expect(writtenMacOf(result)).toBe(STORED_FORM);
    expect(result.updateBy.data.name).toBe("Register 4");
    expect(findBySpy).toHaveBeenCalledTimes(1);
  });

  /*
   * And on that shape a malformed MAC is refused ABOVE the snapshot read:
   * the hook checks what it was handed before it goes looking for what is
   * already stored.
   */
  test("a malformed MAC alongside other columns is refused before the snapshot read", async () => {
    const { service, internals } = buildDeviceService();

    const findBySpy: jest.SpyInstance = jest
      .spyOn(service, "findBy")
      .mockResolvedValue([matchedDevice()] as never);

    await expect(
      internals.onBeforeUpdate({
        query: { _id: DEVICE_ID.toString() },
        data: { name: "Register 4", macAddress: "not-a-mac" },
        props: { isRoot: true },
      } as unknown as UpdateBy<NetworkDevice>),
    ).rejects.toThrow(NOT_A_MAC_MESSAGE);

    expect(findBySpy).not.toHaveBeenCalled();
  });

  // A payload that never mentions the MAC is not the hook's business.
  test("does nothing to a payload that does not carry the column", async () => {
    const { service, internals } = buildDeviceService();

    const findBySpy: jest.SpyInstance = jest
      .spyOn(service, "findBy")
      .mockResolvedValue([matchedDevice()] as never);

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate({
      query: { _id: DEVICE_ID.toString() },
      data: { pollingIntervalInMinutes: 10 },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>);

    expect("macAddress" in result.updateBy.data).toBe(false);
    expect(findBySpy).not.toHaveBeenCalled();
  });
});

/*
 * Whatever comes through the API is the operator's. The ARP pass writes
 * hook-free and may only correct a value it wrote itself, so every write
 * that lands here clears the provenance flag beside the MAC - including a
 * blank, which is "forget what you learned".
 */
describe("a MAC written through the API is the operator's", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test("create clears the learned flag beside a typed MAC", async () => {
    const { internals } = buildDeviceService();

    const result: OnCreate<NetworkDevice> = await internals.onBeforeCreate(
      createWithMac("AA-BB-CC-DD-EE-FF"),
    );

    expect(
      (result.createBy.data as unknown as Record<string, unknown>)[
        "isMacAddressLearned"
      ],
    ).toBe(false);
  });

  test("update clears the learned flag beside a typed MAC", async () => {
    const { internals } = buildDeviceService();

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate(
      macOnlyUpdate("aabb.ccdd.eeff"),
    );

    expect(
      (result.updateBy.data as unknown as Record<string, unknown>)[
        "isMacAddressLearned"
      ],
    ).toBe(false);
  });

  test("blanking the MAC clears the learned flag too", async () => {
    const { internals } = buildDeviceService();

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate(
      macOnlyUpdate("   "),
    );

    const data: Record<string, unknown> = result.updateBy
      .data as unknown as Record<string, unknown>;
    expect(data["macAddress"]).toBeNull();
    expect(data["isMacAddressLearned"]).toBe(false);
  });

  test("a payload that does not mention the MAC leaves the flag alone", async () => {
    const { service, internals } = buildDeviceService();
    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate({
      query: { _id: DEVICE_ID.toString() },
      data: { name: "renamed" },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>);

    expect(
      "isMacAddressLearned" in
        (result.updateBy.data as unknown as Record<string, unknown>),
    ).toBe(false);
  });
});
