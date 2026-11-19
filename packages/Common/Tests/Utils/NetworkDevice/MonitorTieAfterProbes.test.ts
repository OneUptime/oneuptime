import NetworkDeviceTieSource, {
  mayOneUptimeChangeTie,
  readNetworkDeviceTieSource,
} from "../../../Types/NetworkDevice/NetworkDeviceTieSource";
import ObjectID from "../../../Types/ObjectID";
import {
  MonitorTieChange,
  decideTieAfterProbeChange,
} from "../../../Utils/NetworkDevice/MonitorTieAfterProbes";
import { describe, expect, it } from "@jest/globals";

/*
 * A MONITOR'S TIE WHEN ITS PROBES CHANGE (OneUptime issue #9904).
 *
 * Branch A and branch B each have a router at 10.0.0.5. A Ping monitor of
 * 10.0.0.5 checks the one its probes see: moved from branch A's probe to
 * branch B's, it checks branch B's router. OneUptime follows its own ties
 * there, ties a monitor no device had, and takes off a tie it made that no
 * longer fits - never a tie a person made or took off, never one made
 * before who made it was recorded, and never a monitor made for a device.
 */

const BRANCH_A_ROUTER: string = "d0000000-0000-4000-8000-00000000000a";
const BRANCH_B_ROUTER: string = "d0000000-0000-4000-8000-00000000000b";

describe("who may change a tie", () => {
  it("reads a stored source as one of the two, or none", () => {
    expect(readNetworkDeviceTieSource("Automatic")).toBe(
      NetworkDeviceTieSource.Automatic,
    );
    expect(readNetworkDeviceTieSource("Person")).toBe(
      NetworkDeviceTieSource.Person,
    );
    for (const value of [null, undefined, "", "automatic", "Rule", 1]) {
      expect(readNetworkDeviceTieSource(value)).toBeNull();
    }
  });

  it("OneUptime changes its own tie, never a person's", () => {
    expect(
      mayOneUptimeChangeTie({
        networkDeviceId: BRANCH_A_ROUTER,
        tieSource: NetworkDeviceTieSource.Automatic,
      }),
    ).toBe(true);
    expect(
      mayOneUptimeChangeTie({
        networkDeviceId: BRANCH_A_ROUTER,
        tieSource: NetworkDeviceTieSource.Person,
      }),
    ).toBe(false);
  });

  it("nor a tie a person took off, while a monitor nobody tied may be tied", () => {
    expect(
      mayOneUptimeChangeTie({
        networkDeviceId: null,
        tieSource: NetworkDeviceTieSource.Person,
      }),
    ).toBe(false);
    expect(
      mayOneUptimeChangeTie({ networkDeviceId: null, tieSource: null }),
    ).toBe(true);
    // A tie OneUptime took off is still OneUptime's to make again.
    expect(
      mayOneUptimeChangeTie({
        networkDeviceId: null,
        tieSource: NetworkDeviceTieSource.Automatic,
      }),
    ).toBe(true);
  });

  it("keeps a tie made before who made it was recorded: it may be a person's", () => {
    expect(
      mayOneUptimeChangeTie({
        networkDeviceId: BRANCH_A_ROUTER,
        tieSource: null,
      }),
    ).toBe(false);
    expect(
      mayOneUptimeChangeTie({
        networkDeviceId: new ObjectID(BRANCH_A_ROUTER),
        tieSource: undefined,
      }),
    ).toBe(false);
  });
});

describe("a monitor of 10.0.0.5 whose probes change", () => {
  function decide(data: {
    linked?: string | null;
    source?: NetworkDeviceTieSource | null;
    seen?: string | null;
    isMadeForDevice?: boolean;
  }): MonitorTieChange | null {
    return decideTieAfterProbeChange({
      linkedDeviceId: data.linked || null,
      tieSource: data.source === undefined ? null : data.source,
      isMadeForDevice: Boolean(data.isMadeForDevice),
      seenDeviceId: data.seen || null,
    });
  }

  it("moved from branch A's probe to branch B's, its tie moves to branch B's router", () => {
    expect(
      decide({
        linked: BRANCH_A_ROUTER,
        source: NetworkDeviceTieSource.Automatic,
        seen: BRANCH_B_ROUTER,
      }),
    ).toEqual({
      kind: "retie",
      fromDeviceId: BRANCH_A_ROUTER,
      deviceId: BRANCH_B_ROUTER,
    });
  });

  it("tied to no device, whose probes now see one, is tied to it", () => {
    expect(decide({ seen: BRANCH_B_ROUTER })).toEqual({
      kind: "tie",
      deviceId: BRANCH_B_ROUTER,
    });
    expect(
      decide({
        source: NetworkDeviceTieSource.Automatic,
        seen: BRANCH_A_ROUTER,
      }),
    ).toEqual({ kind: "tie", deviceId: BRANCH_A_ROUTER });
  });

  it("tied by OneUptime, whose probes see no device there now, is untied", () => {
    expect(
      decide({
        linked: BRANCH_A_ROUTER,
        source: NetworkDeviceTieSource.Automatic,
        seen: null,
      }),
    ).toEqual({ kind: "untie", fromDeviceId: BRANCH_A_ROUTER });
  });

  it("whose probes still see the device it is tied to, is left as it is", () => {
    expect(
      decide({
        linked: BRANCH_A_ROUTER,
        source: NetworkDeviceTieSource.Automatic,
        seen: BRANCH_A_ROUTER.toUpperCase(),
      }),
    ).toBeNull();
    expect(decide({ seen: null })).toBeNull();
  });

  it("tied by a person, keeps the device they picked whatever its probes see", () => {
    for (const seen of [BRANCH_B_ROUTER, null]) {
      expect(
        decide({
          linked: BRANCH_A_ROUTER,
          source: NetworkDeviceTieSource.Person,
          seen: seen,
        }),
      ).toBeNull();
    }
  });

  it("untied by a person, stays untied whatever its probes see", () => {
    expect(
      decide({ source: NetworkDeviceTieSource.Person, seen: BRANCH_B_ROUTER }),
    ).toBeNull();
  });

  it("tied before who tied it was recorded, keeps its tie", () => {
    expect(
      decide({ linked: BRANCH_A_ROUTER, source: null, seen: BRANCH_B_ROUTER }),
    ).toBeNull();
    expect(
      decide({ linked: BRANCH_A_ROUTER, source: null, seen: null }),
    ).toBeNull();
  });

  it("made for a device by an import or a rule, is that device's whatever its probes see", () => {
    expect(
      decide({
        isMadeForDevice: true,
        linked: null,
        source: null,
        seen: BRANCH_B_ROUTER,
      }),
    ).toBeNull();
    expect(
      decide({
        isMadeForDevice: true,
        linked: BRANCH_A_ROUTER,
        source: NetworkDeviceTieSource.Automatic,
        seen: BRANCH_B_ROUTER,
      }),
    ).toBeNull();
  });

  it("reads ids whatever their case or kind", () => {
    expect(
      decideTieAfterProbeChange({
        linkedDeviceId: new ObjectID(BRANCH_A_ROUTER),
        tieSource: "Automatic",
        isMadeForDevice: false,
        seenDeviceId: BRANCH_B_ROUTER.toUpperCase(),
      }),
    ).toEqual({
      kind: "retie",
      fromDeviceId: BRANCH_A_ROUTER,
      deviceId: BRANCH_B_ROUTER,
    });
  });
});
