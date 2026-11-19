import {
  AmbiguousAddressReason,
  DeviceAtAddressLike,
  NoDeviceReason,
  SeenDeviceReason,
} from "../../../Utils/NetworkDevice/DeviceAddressScope";
import {
  UntiedMonitorMatch,
  getUntiedMonitorMatch,
  readUntiedDeviceMonitorsAnswer,
} from "../../../Utils/NetworkDevice/UntiedDeviceMonitor";
import { JSONValue } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

/*
 * A monitor that checks a device's address but is tied to no device
 * (OneUptime issue #9903): how its probes see the device on whose page it
 * is listed, and the server's answer as that page reads it.
 *
 * Branch A and branch B each have a router at 10.0.0.5; branch A's printer
 * is alone at 10.0.0.9; site C has a switch of its own.
 */

const BRANCH_A_ROUTER: string = "d0000000-0000-4000-8000-00000000000a";
const BRANCH_B_ROUTER: string = "d0000000-0000-4000-8000-00000000000b";
const BRANCH_C_SWITCH: string = "d0000000-0000-4000-8000-0000000000c2";
const BRANCH_A_PRINTER: string = "d0000000-0000-4000-8000-0000000000a9";
const MONITOR_ID: string = "cc000000-0000-4000-8000-000000000001";
const OTHER_MONITOR_ID: string = "cc000000-0000-4000-8000-000000000002";

const ROUTER_A: DeviceAtAddressLike = { id: BRANCH_A_ROUTER };
const ROUTER_B: DeviceAtAddressLike = { id: BRANCH_B_ROUTER.toUpperCase() };

describe("getUntiedMonitorMatch", () => {
  it("matches this device, and nothing for another", () => {
    expect(
      getUntiedMonitorMatch({
        deviceId: BRANCH_A_ROUTER.toUpperCase(),
        seen: {
          kind: "device",
          device: ROUTER_A,
          reason: SeenDeviceReason.PolledByTheProbes,
        },
      }),
    ).toEqual({ match: UntiedMonitorMatch.ThisDevice });
    expect(
      getUntiedMonitorMatch({
        deviceId: BRANCH_A_ROUTER,
        seen: {
          kind: "device",
          device: ROUTER_B,
          reason: SeenDeviceReason.OnlyOneInTheirSites,
        },
      }),
    ).toBeNull();
  });

  it("names the others it cannot tell this one from, by id in lower case, only when this one is among them", () => {
    expect(
      getUntiedMonitorMatch({
        deviceId: BRANCH_A_ROUTER,
        seen: {
          kind: "ambiguous",
          devices: [ROUTER_A, ROUTER_B, ROUTER_B],
          reason: AmbiguousAddressReason.SeveralInTheirSites,
        },
      }),
    ).toEqual({
      match: UntiedMonitorMatch.CannotTellApart,
      ambiguousReason: AmbiguousAddressReason.SeveralInTheirSites,
      otherDeviceIds: [BRANCH_B_ROUTER],
    });
    expect(
      getUntiedMonitorMatch({
        deviceId: BRANCH_C_SWITCH,
        seen: {
          kind: "ambiguous",
          devices: [ROUTER_A, ROUTER_B],
          reason: AmbiguousAddressReason.PollSeveral,
        },
      }),
    ).toBeNull();
  });

  it("is unplaced probes only when that is why none is seen", () => {
    expect(
      getUntiedMonitorMatch({
        deviceId: BRANCH_A_PRINTER,
        seen: {
          kind: "none",
          reason: NoDeviceReason.ReachUnknownDeviceInASite,
        },
      }),
    ).toEqual({ match: UntiedMonitorMatch.ProbesInNoSite });

    for (const reason of [
      NoDeviceReason.NoneAtTheAddress,
      NoDeviceReason.NoneInTheirSites,
    ]) {
      expect(
        getUntiedMonitorMatch({
          deviceId: BRANCH_A_PRINTER,
          seen: { kind: "none", reason: reason },
        }),
      ).toBeNull();
    }
  });

  it("says nothing without a device or an answer", () => {
    expect(
      getUntiedMonitorMatch({ deviceId: BRANCH_A_PRINTER, seen: null }),
    ).toBeNull();
    expect(
      getUntiedMonitorMatch({
        deviceId: "",
        seen: {
          kind: "device",
          device: ROUTER_A,
          reason: SeenDeviceReason.PolledByTheProbes,
        },
      }),
    ).toBeNull();
  });
});

describe("readUntiedDeviceMonitorsAnswer", () => {
  it("reads each monitor with what its probes see", () => {
    expect(
      readUntiedDeviceMonitorsAnswer({
        monitors: [
          {
            monitorId: MONITOR_ID.toUpperCase(),
            name: "Branch A ping",
            monitorType: "Ping",
            match: UntiedMonitorMatch.ThisDevice,
          },
          {
            monitorId: OTHER_MONITOR_ID,
            name: "Both branches ping",
            monitorType: "Ping",
            match: UntiedMonitorMatch.CannotTellApart,
            ambiguousReason: AmbiguousAddressReason.PollSeveral,
            otherDeviceIds: [
              BRANCH_B_ROUTER.toUpperCase(),
              BRANCH_B_ROUTER,
              "not-an-id",
              7,
            ],
          },
        ],
        hasMore: true,
      }),
    ).toEqual({
      monitors: [
        {
          monitorId: MONITOR_ID,
          name: "Branch A ping",
          monitorType: "Ping",
          match: UntiedMonitorMatch.ThisDevice,
        },
        {
          monitorId: OTHER_MONITOR_ID,
          name: "Both branches ping",
          monitorType: "Ping",
          match: UntiedMonitorMatch.CannotTellApart,
          ambiguousReason: AmbiguousAddressReason.PollSeveral,
          otherDeviceIds: [BRANCH_B_ROUTER],
        },
      ],
      hasMore: true,
    });
  });

  it("leaves out a row with no id, an id twice, or a match it cannot say", () => {
    expect(
      readUntiedDeviceMonitorsAnswer({
        monitors: [
          {
            monitorId: "nope",
            name: "A",
            match: UntiedMonitorMatch.ThisDevice,
          },
          { name: "B", match: UntiedMonitorMatch.ThisDevice },
          { monitorId: MONITOR_ID, name: "C", match: "SomethingNew" },
          {
            monitorId: MONITOR_ID,
            name: "D",
            match: UntiedMonitorMatch.ThisDevice,
          },
          {
            monitorId: MONITOR_ID,
            name: "E",
            match: UntiedMonitorMatch.ThisDevice,
          },
          null,
          "row",
        ],
      }).monitors.map((monitor: { name: string }): string => {
        return monitor.name;
      }),
    ).toEqual(["D"]);
  });

  it("leaves out a monitor that cannot tell the devices apart for a reason it cannot say", () => {
    expect(
      readUntiedDeviceMonitorsAnswer({
        monitors: [
          {
            monitorId: MONITOR_ID,
            name: "New reason",
            match: UntiedMonitorMatch.CannotTellApart,
            ambiguousReason: "SomethingNew",
          },
          {
            monitorId: OTHER_MONITOR_ID,
            name: "No reason",
            match: UntiedMonitorMatch.CannotTellApart,
          },
        ],
      }).monitors,
    ).toEqual([]);
  });

  it("keeps a monitor that cannot tell them apart with no other device it may name", () => {
    expect(
      readUntiedDeviceMonitorsAnswer({
        monitors: [
          {
            monitorId: MONITOR_ID,
            name: "Ping",
            match: UntiedMonitorMatch.CannotTellApart,
            ambiguousReason: AmbiguousAddressReason.ReachUnknown,
          },
        ],
      }).monitors,
    ).toEqual([
      {
        monitorId: MONITOR_ID,
        name: "Ping",
        monitorType: "",
        match: UntiedMonitorMatch.CannotTellApart,
        ambiguousReason: AmbiguousAddressReason.ReachUnknown,
        otherDeviceIds: [],
      },
    ]);
  });

  it("reads anything else as nothing to list", () => {
    for (const value of [
      undefined,
      null,
      "monitors",
      [],
      {},
      { monitors: "none" },
      { monitors: [], hasMore: "yes" },
    ] as Array<JSONValue | undefined>) {
      expect(readUntiedDeviceMonitorsAnswer(value)).toEqual({
        monitors: [],
        hasMore: false,
      });
    }
  });
});
