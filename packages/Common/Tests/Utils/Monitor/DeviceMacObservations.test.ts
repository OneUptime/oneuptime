import { describe, expect, test } from "@jest/globals";
import DeviceMacLearningUtil, {
  MAC_OBSERVATION_REFRESH_INTERVAL_IN_MS,
  MacLearningIpBinding,
  MacObservationCandidateDevice,
  MacObservationPlanEntry,
} from "../../../Utils/Monitor/DeviceMacLearningUtil";

/*
 * Which ARP readings are recorded in a device's discovered details (issue
 * #5185): which router's table gave a device its MAC, and when - and, for a
 * MAC someone typed that the table contradicts, what the table says. Only for
 * the bindings the learner itself trusts (same site, one device at the
 * address, one MAC behind it), and a reading that has not changed at most
 * once an hour, so a router walked every five minutes costs one small write
 * per device per hour.
 */

const NOW: number = new Date("2026-10-23T10:00:00.000Z").getTime();
const SITE: string = "site-a";

const IP: string = "10.0.0.5";
const MAC: string = "aa:bb:cc:dd:ee:01";
const OTHER_MAC: string = "aa:bb:cc:dd:ee:99";

function binding(ipAddress: string, macAddress: string): MacLearningIpBinding {
  return { ipAddress, macAddress };
}

function device(
  overrides: Partial<MacObservationCandidateDevice> = {},
): MacObservationCandidateDevice {
  return { id: "device-1", hostname: IP, siteId: SITE, ...overrides };
}

function observe(
  devices: Array<MacObservationCandidateDevice>,
  ipBindings: Array<MacLearningIpBinding> = [binding(IP, MAC)],
  observingSiteId: string | undefined = SITE,
): Array<MacObservationPlanEntry> {
  return DeviceMacLearningUtil.planMacObservations({
    ipBindings: ipBindings,
    devices: devices,
    observingSiteId: observingSiteId,
    now: NOW,
  });
}

describe("which readings are recorded", () => {
  test("a device with no MAC: the reading the learner writes is recorded too", () => {
    expect(observe([device()])).toEqual([
      { deviceId: "device-1", macAddress: MAC, ipAddress: IP },
    ]);
  });

  test("a learned MAC the table confirms, recorded before this release: recorded now", () => {
    expect(
      observe([device({ macAddress: MAC, isMacAddressLearned: true })]),
    ).toHaveLength(1);
  });

  test("a learned MAC the table now contradicts: the new reading is recorded", () => {
    expect(
      observe([
        device({
          macAddress: OTHER_MAC,
          isMacAddressLearned: true,
          observedMacAddress: OTHER_MAC,
          observedAt: NOW - 60 * 1000,
        }),
      ]),
    ).toEqual([{ deviceId: "device-1", macAddress: MAC, ipAddress: IP }]);
  });

  test("a TYPED MAC the table contradicts: recorded, so both are shown", () => {
    expect(
      observe([device({ macAddress: OTHER_MAC, isMacAddressLearned: false })]),
    ).toEqual([{ deviceId: "device-1", macAddress: MAC, ipAddress: IP }]);
  });

  test("a typed MAC the table agrees with: nothing to record", () => {
    expect(observe([device({ macAddress: "AA-BB-CC-DD-EE-01" })])).toEqual([]);
  });

  test("a typed MAC the table now agrees with, after it disagreed: the old reading is replaced", () => {
    expect(
      observe([
        device({
          macAddress: MAC,
          observedMacAddress: OTHER_MAC,
          observedAt: NOW - 60 * 1000,
        }),
      ]),
    ).toHaveLength(1);
  });
});

describe("how often an unchanged reading is recorded again", () => {
  test("not again within the hour", () => {
    expect(
      observe([
        device({
          macAddress: MAC,
          isMacAddressLearned: true,
          observedMacAddress: MAC,
          observedAt: NOW - MAC_OBSERVATION_REFRESH_INTERVAL_IN_MS + 1,
        }),
      ]),
    ).toEqual([]);
  });

  test("again once it is an hour old", () => {
    expect(
      observe([
        device({
          macAddress: MAC,
          isMacAddressLearned: true,
          observedMacAddress: MAC,
          observedAt: NOW - MAC_OBSERVATION_REFRESH_INTERVAL_IN_MS,
        }),
      ]),
    ).toHaveLength(1);
  });

  test("a reading recorded with no time is recorded again", () => {
    expect(
      observe([
        device({
          macAddress: MAC,
          isMacAddressLearned: true,
          observedMacAddress: "AA:BB:CC:DD:EE:01",
        }),
      ]),
    ).toHaveLength(1);
  });

  test("the hour is an hour", () => {
    expect(MAC_OBSERVATION_REFRESH_INTERVAL_IN_MS).toBe(60 * 60 * 1000);
  });
});

describe("the learner's refusals hold for readings too", () => {
  test("a device in another site is never credited with this router's table", () => {
    expect(observe([device({ siteId: "site-b" })])).toEqual([]);
  });

  test("two devices at one address: neither", () => {
    expect(observe([device(), device({ id: "device-2" })])).toEqual([]);
  });

  test("two MACs behind one address: neither", () => {
    expect(
      observe([device()], [binding(IP, MAC), binding(IP, OTHER_MAC)]),
    ).toEqual([]);
  });

  test("an address the table does not bind: nothing", () => {
    expect(observe([device({ hostname: "10.0.0.9" })])).toEqual([]);
  });
});

describe("the plan is deterministic", () => {
  test("sorted by device id", () => {
    const plan: Array<MacObservationPlanEntry> = observe(
      [
        device({ id: "device-b", hostname: "10.0.0.6" }),
        device({ id: "device-a", hostname: "10.0.0.5" }),
      ],
      [binding("10.0.0.5", MAC), binding("10.0.0.6", OTHER_MAC)],
    );

    expect(
      plan.map((entry: MacObservationPlanEntry): string => {
        return entry.deviceId;
      }),
    ).toEqual(["device-a", "device-b"]);
  });

  test("the learning plan is unchanged by what the readings record", () => {
    const devices: Array<MacObservationCandidateDevice> = [
      device({ id: "empty", hostname: "10.0.0.5" }),
      device({
        id: "learned",
        hostname: "10.0.0.6",
        macAddress: "aa:bb:cc:dd:ee:77",
        isMacAddressLearned: true,
        observedMacAddress: "aa:bb:cc:dd:ee:77",
        observedAt: NOW,
      }),
      device({
        id: "typed",
        hostname: "10.0.0.7",
        macAddress: "aa:bb:cc:dd:ee:78",
      }),
    ];
    const bindings: Array<MacLearningIpBinding> = [
      binding("10.0.0.5", "aa:bb:cc:dd:ee:01"),
      binding("10.0.0.6", "aa:bb:cc:dd:ee:02"),
      binding("10.0.0.7", "aa:bb:cc:dd:ee:03"),
    ];

    expect(
      DeviceMacLearningUtil.planMacLearning({
        ipBindings: bindings,
        devices: devices,
        observingSiteId: SITE,
      }),
    ).toEqual([
      {
        deviceId: "empty",
        macAddress: "aa:bb:cc:dd:ee:01",
        ipAddress: "10.0.0.5",
        previousMacAddress: null,
      },
      {
        deviceId: "learned",
        macAddress: "aa:bb:cc:dd:ee:02",
        ipAddress: "10.0.0.6",
        previousMacAddress: "aa:bb:cc:dd:ee:77",
      },
    ]);
  });
});
