import InterfaceInventoryUtil, {
  InterfaceExistingRowSnapshot,
  InterfaceUpsertPlan,
} from "../../../Utils/Monitor/InterfaceInventoryUtil";
import {
  FibreChannelCounter,
  FibreChannelPortType,
  SnmpFibreChannelPort,
} from "../../../Types/Monitor/SnmpMonitor/SnmpFibreChannel";
import SnmpInterface from "../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import { describe, expect, test } from "@jest/globals";

/*
 * A Fibre Channel port's type and why it is down, kept on its stored
 * interface row (NetworkInterface.fibreChannelPortType and downReason) for
 * the Interfaces page. A down port reports no type, or a generic one, so
 * the type it had when it was last up - the E-Port, the inter-switch link -
 * is what is kept while it is down: that is what says what went down.
 */

const NOW: Date = new Date("2026-11-26T10:00:00.000Z");
const EARLIER: Date = new Date("2026-11-26T09:59:00.000Z");

function walked(
  fibreChannel: SnmpFibreChannelPort | undefined,
  isUp: boolean = true,
): SnmpInterface {
  return {
    interfaceIndex: 0x40000004,
    name: "0/4",
    interfaceType: 56,
    isOperationallyUp: isUp,
    isAdministrativelyUp: true,
    speedInBitsPerSecond: 32000000000,
    ...(fibreChannel ? { fibreChannel: fibreChannel } : {}),
  };
}

function stored(
  fields: Partial<InterfaceExistingRowSnapshot> = {},
): InterfaceExistingRowSnapshot {
  return {
    interfaceIndex: 0x40000004,
    isMonitored: true,
    name: "0/4",
    alias: null,
    macAddress: null,
    interfaceType: 56,
    isOperationallyUp: true,
    isAdministrativelyUp: true,
    speedInMbps: 32000,
    inRateMbps: null,
    outRateMbps: null,
    utilizationPercent: null,
    errorsPerSecond: null,
    fibreChannelPortType: FibreChannelPortType.E,
    downReason: null,
    lastSeenAt: EARLIER,
    ...fields,
  };
}

function plan(
  interfaces: Array<SnmpInterface>,
  existing: Array<InterfaceExistingRowSnapshot>,
): InterfaceUpsertPlan {
  return InterfaceInventoryUtil.planWalkUpsert({
    walkedInterfaces: interfaces,
    existingRows: existing,
    now: NOW,
    // A slot far longer than the test: only real changes write.
    refreshMs: 24 * 60 * 60 * 1000,
  });
}

describe("fibreChannelPortType", () => {
  test("an up port: what the switch reports now", () => {
    expect(
      InterfaceInventoryUtil.fibreChannelPortType({
        walked: walked({ portType: FibreChannelPortType.F }),
        stored: stored(),
      }),
    ).toBe(FibreChannelPortType.F);
  });

  test("a down port keeps the type it had when it was last up", () => {
    expect(
      InterfaceInventoryUtil.fibreChannelPortType({
        walked: walked({ downReason: "No light" }, false),
        stored: stored({ fibreChannelPortType: FibreChannelPortType.E }),
      }),
    ).toBe(FibreChannelPortType.E);

    // Brocade calls a down port a G-Port: the stored E-Port still wins.
    expect(
      InterfaceInventoryUtil.fibreChannelPortType({
        walked: walked({ portType: FibreChannelPortType.G }, false),
        stored: stored({ fibreChannelPortType: FibreChannelPortType.E }),
      }),
    ).toBe(FibreChannelPortType.E);
  });

  test("a down port never seen up: whatever it reports", () => {
    expect(
      InterfaceInventoryUtil.fibreChannelPortType({
        walked: walked({ portType: FibreChannelPortType.G }, false),
        stored: undefined,
      }),
    ).toBe(FibreChannelPortType.G);
    expect(
      InterfaceInventoryUtil.fibreChannelPortType({
        walked: walked({ downReason: "No light" }, false),
        stored: undefined,
      }),
    ).toBeNull();
  });

  test("a poll that read nothing of the Fibre Channel side keeps what is stored", () => {
    expect(
      InterfaceInventoryUtil.fibreChannelPortType({
        walked: walked(undefined),
        stored: stored({ fibreChannelPortType: FibreChannelPortType.TE }),
      }),
    ).toBe(FibreChannelPortType.TE);
  });

  test("any other port has none", () => {
    expect(
      InterfaceInventoryUtil.fibreChannelPortType({
        walked: walked(undefined),
        stored: stored({ fibreChannelPortType: null }),
      }),
    ).toBeNull();
    expect(
      InterfaceInventoryUtil.fibreChannelPortType({
        walked: walked(undefined),
        stored: undefined,
      }),
    ).toBeNull();
  });
});

describe("downReason", () => {
  test("only while the port is down, in the switch's words", () => {
    expect(
      InterfaceInventoryUtil.downReason({
        walked: walked({ downReason: "No light" }, false),
        stored: undefined,
      }),
    ).toBe("No light");
    expect(
      InterfaceInventoryUtil.downReason({
        walked: walked({ downReason: "No light" }, true),
        stored: stored({ downReason: "No light" }),
      }),
    ).toBeNull();
  });

  test("a down port whose reason the switch did not give has none", () => {
    expect(
      InterfaceInventoryUtil.downReason({
        walked: walked({ counters: {} }, false),
        stored: stored({ downReason: "No light" }),
      }),
    ).toBeNull();
  });

  test("a poll that read nothing of the Fibre Channel side keeps the stored reason while the port is down", () => {
    expect(
      InterfaceInventoryUtil.downReason({
        walked: walked(undefined, false),
        stored: stored({ downReason: "SFP not present" }),
      }),
    ).toBe("SFP not present");
  });

  test("a reason longer than the column holds is cut to fit", () => {
    const reason: string | null = InterfaceInventoryUtil.downReason({
      walked: walked({ downReason: "x".repeat(500) }, false),
      stored: undefined,
    });

    expect(reason!.length).toBeLessThanOrEqual(100);
  });
});

describe("planWalkUpsert with Fibre Channel ports", () => {
  test("a new port is inserted with its type and reason", () => {
    const upsert: InterfaceUpsertPlan = plan(
      [walked({ portType: FibreChannelPortType.F })],
      [],
    );

    expect(upsert.inserts).toHaveLength(1);
    expect(upsert.inserts[0]!.fibreChannelPortType).toBe(
      FibreChannelPortType.F,
    );
    expect(upsert.inserts[0]!.downReason).toBeNull();
  });

  test("an E-Port going down is written once: its reason, and the type it had", () => {
    const upsert: InterfaceUpsertPlan = plan(
      [walked({ downReason: "No light" }, false)],
      [stored()],
    );

    expect(upsert.updates).toHaveLength(1);
    expect(upsert.updates[0]!.isOperationallyUp).toBe(false);
    expect(upsert.updates[0]!.fibreChannelPortType).toBe(
      FibreChannelPortType.E,
    );
    expect(upsert.updates[0]!.downReason).toBe("No light");
  });

  test("the reason changing on a port that stays down is a write", () => {
    const upsert: InterfaceUpsertPlan = plan(
      [walked({ downReason: "No sync" }, false)],
      [stored({ isOperationallyUp: false, downReason: "No light" })],
    );

    expect(upsert.updates).toHaveLength(1);
    expect(upsert.updates[0]!.downReason).toBe("No sync");
  });

  test("the type changing on an up port is a write", () => {
    const upsert: InterfaceUpsertPlan = plan(
      [walked({ portType: FibreChannelPortType.F })],
      [stored({ fibreChannelPortType: FibreChannelPortType.E })],
    );

    expect(upsert.updates).toHaveLength(1);
    expect(upsert.updates[0]!.fibreChannelPortType).toBe(
      FibreChannelPortType.F,
    );
  });

  test("nothing changed, nothing written - counters moving are not a change", () => {
    const upsert: InterfaceUpsertPlan = plan(
      [
        walked({
          portType: FibreChannelPortType.E,
          counters: { [FibreChannelCounter.BbCreditZero]: 2211904 },
        }),
      ],
      [stored()],
    );

    expect(upsert.updates).toHaveLength(0);
    expect(upsert.unchangedInterfaceIndexes).toEqual([0x40000004]);
  });

  test("a failed Fibre Channel read is not a change either", () => {
    const upsert: InterfaceUpsertPlan = plan([walked(undefined)], [stored()]);

    expect(upsert.updates).toHaveLength(0);
  });
});
