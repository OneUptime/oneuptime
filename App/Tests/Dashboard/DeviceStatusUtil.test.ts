import { describe, expect, test } from "@jest/globals";
import DeviceStatusUtil, {
  DEVICE_MIN_STALE_WINDOW_IN_MINUTES,
  DEVICE_MISSED_POLL_ALLOWANCE,
  DEVICE_STATUS_SELECT,
  DeviceReachabilityResult,
  NO_MONITOR_QUALIFIER,
  NO_PROBE_QUALIFIER,
  NO_SNMP_INTERFACES_LABEL,
  NetworkDeviceStatus,
  SNMP_FAILING_QUALIFIER,
  hasNoSnmpInventory,
  isSnmpFailing,
  isUnboundMonitorBackedDevice,
  isUnpolledProbeDevice,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusUtil";
import ObjectID from "Common/Types/ObjectID";

/*
 * DeviceStatusUtil is the dashboard's door onto the shared reachability
 * rule (Common/Utils/NetworkDevice/DeviceReachabilityUtil, which has the
 * exhaustive matrix). What is pinned here is the part the dashboard owns:
 * that the door delegates rather than re-deciding, that it accepts a
 * NetworkDevice row as-is, and that DEVICE_STATUS_SELECT names every column
 * the rule reads — a page that selects a subset silently falls back to the
 * legacy freshness path and puts the bug back.
 *
 * The dashboard also owns the QUALIFIERS: "No monitor", "No probe" and
 * "SNMP failing" are second pills beside the verdict, never a fourth
 * verdict, because the tiles and the Status chip are SQL over one column and
 * a fourth word would return rows whose pill disagreed with the chip that
 * fetched them. Their predicates live in this module and are pinned below,
 * along with the rule they all obey: a device is polled by PING first and
 * walked over SNMP only where it has credentials, so nothing about the walk
 * may move the Up / Down / Pending answer.
 *
 * Time is not faked: getStatus reads the wall clock, so every case here is
 * expressed as an offset from `Date.now()` at call time, which is what a
 * page render actually does.
 */

const MS_PER_MINUTE: number = 60 * 1000;

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MS_PER_MINUTE);
}

describe("DEVICE_STATUS_SELECT", () => {
  /*
   * The exact set every status surface fetches: the columns the verdict is
   * decided from, plus the columns the QUALIFIER pills beside it are decided
   * from. If a column is added to either and not here, every page keeps
   * compiling and quietly starts getting the wrong answer — so the set is
   * asserted whole, not key by key.
   *
   * The qualifier columns are in the same select on purpose. A row already
   * carries its verdict; whether the same device also has a failing SNMP walk
   * or no probe at all is decided from `isSnmpReachable` / `probeId` /
   * `isPollingEnabled`, and a list that had to go back to the server for them
   * would either issue a second query per page of rows or — far more likely —
   * drop the pill and leave "Up" standing alone on a device whose interfaces
   * and inventory stopped refreshing a week ago.
   */
  test("names every column the reachability rule and its qualifiers read", () => {
    expect(DEVICE_STATUS_SELECT).toEqual({
      isReachable: true,
      lastPolledAt: true,
      lastSeenAt: true,
      pollingIntervalInMinutes: true,
      monitoringMethod: true,
      isSnmpReachable: true,
      lastSnmpSeenAt: true,
      probeId: true,
      isPollingEnabled: true,
      currentMonitorStatus: {
        name: true,
        color: true,
        isOfflineState: true,
      },
    });
  });

  /*
   * The walk's own columns. A poll is a ping first and an SNMP walk only
   * where there are usable credentials, so `isReachable` alone cannot tell a
   * pinged-only device from one whose walk is broken — both are Up. These two
   * are what separate them, and without them in the select the "SNMP failing"
   * pill and the Interfaces column's "No SNMP" label are both underivable in
   * the browser: `isSnmpReachable` would be `undefined` on every row, which
   * the predicates read (correctly) as "nothing to say".
   */
  test("names the columns the SNMP qualifier is decided from", () => {
    expect(DEVICE_STATUS_SELECT.isSnmpReachable).toBe(true);
    expect(DEVICE_STATUS_SELECT.lastSnmpSeenAt).toBe(true);
  });

  /*
   * ...and the columns behind "No probe". A probe-polled device with no probe
   * assigned, or with polling switched off, is Pending forever and nothing on
   * the row explains why — these two are the explanation.
   */
  test("names the columns the No probe qualifier is decided from", () => {
    expect(DEVICE_STATUS_SELECT.probeId).toBe(true);
    expect(DEVICE_STATUS_SELECT.isPollingEnabled).toBe(true);
  });

  /*
   * Issue #3392 was a select as much as it was a rule: the poll columns
   * alone can only ever answer "Pending" for a device nothing polls, so a
   * page that selects them and nothing else paints every correctly bound
   * ping-only device grey forever.
   */
  test("names the two columns a monitor-backed device is judged by", () => {
    expect(DEVICE_STATUS_SELECT.monitoringMethod).toBe(true);
    expect(DEVICE_STATUS_SELECT.currentMonitorStatus.isOfflineState).toBe(true);
  });

  /*
   * `name` and `color` come with it so a surface can print the operator's
   * own status word ("Operational", "Degraded") rather than flattening
   * every ladder rung to Up or Down.
   */
  test("carries the monitor status label the pills render", () => {
    expect(DEVICE_STATUS_SELECT.currentMonitorStatus.name).toBe(true);
    expect(DEVICE_STATUS_SELECT.currentMonitorStatus.color).toBe(true);
  });

  test("spreads into a ModelAPI select without nesting", () => {
    const select: Record<string, unknown> = {
      ...DEVICE_STATUS_SELECT,
      name: true,
    };

    expect(select["isReachable"]).toBe(true);
    expect(select["lastPolledAt"]).toBe(true);
    expect(select["name"]).toBe(true);
  });
});

describe("the constants the dashboard copy quotes", () => {
  test("are re-exported so a tooltip cannot drift from the rule", () => {
    expect(DEVICE_MISSED_POLL_ALLOWANCE).toBe(10);
    expect(DEVICE_MIN_STALE_WINDOW_IN_MINUTES).toBe(60);
  });
});

describe("NetworkDeviceStatus", () => {
  test("carries the display strings the pills render", () => {
    expect(NetworkDeviceStatus.Up).toBe("Up");
    expect(NetworkDeviceStatus.Down).toBe("Down");
    expect(NetworkDeviceStatus.Pending).toBe("Pending");
  });
});

describe("DeviceStatusUtil.getStatus", () => {
  test("a device whose last poll succeeded is Up", () => {
    expect(
      DeviceStatusUtil.getStatus({
        isReachable: true,
        lastPolledAt: minutesAgo(1),
        lastSeenAt: minutesAgo(1),
        pollingIntervalInMinutes: 5,
      }),
    ).toBe(NetworkDeviceStatus.Up);
  });

  test("a device whose last poll failed is Down", () => {
    expect(
      DeviceStatusUtil.getStatus({
        isReachable: false,
        lastPolledAt: minutesAgo(1),
        lastSeenAt: minutesAgo(40),
        pollingIntervalInMinutes: 5,
      }),
    ).toBe(NetworkDeviceStatus.Down);
  });

  test("a device that has never been polled is Pending", () => {
    expect(DeviceStatusUtil.getStatus({})).toBe(NetworkDeviceStatus.Pending);
  });

  /*
   * Issue #3220. The device in the report answered SNMP — its Interfaces
   * tab showed 14 ports up — but its probe, 980 devices behind, had not got
   * back to it for 21 minutes, and the pill said Down.
   */
  test("issue #3220: a device polled 21 minutes ago on a 5-minute interval is Up", () => {
    expect(
      DeviceStatusUtil.getStatus({
        isReachable: true,
        lastPolledAt: minutesAgo(21),
        lastSeenAt: minutesAgo(21),
        pollingIntervalInMinutes: 5,
      }),
    ).toBe(NetworkDeviceStatus.Up);
  });

  test("a device on a 30-minute interval is not permanently Down", () => {
    expect(
      DeviceStatusUtil.getStatus({
        isReachable: true,
        lastPolledAt: minutesAgo(29),
        lastSeenAt: minutesAgo(29),
        pollingIntervalInMinutes: 30,
      }),
    ).toBe(NetworkDeviceStatus.Up);
  });

  /*
   * Staleness annotates the verdict rather than replacing it — see
   * DeviceReachabilityUtil. The tiles and the Status chip are SQL over
   * `isReachable`, so a pill they cannot reproduce would contradict them.
   */
  test("a device nothing has polled for hours keeps its last verdict", () => {
    expect(
      DeviceStatusUtil.getStatus({
        isReachable: true,
        lastPolledAt: minutesAgo(180),
        lastSeenAt: minutesAgo(180),
        pollingIntervalInMinutes: 5,
      }),
    ).toBe(NetworkDeviceStatus.Up);
  });

  test("accepts the ISO strings a NetworkDevice row carries after a fetch", () => {
    expect(
      DeviceStatusUtil.getStatus({
        isReachable: true,
        lastPolledAt: minutesAgo(2).toISOString(),
        lastSeenAt: minutesAgo(2).toISOString(),
      }),
    ).toBe(NetworkDeviceStatus.Up);
  });

  /*
   * The one that keeps the fix honest under a partial select: a page that
   * forgets isReachable gets the legacy freshness answer, and this pins
   * that it is at least the GENEROUS freshness answer rather than the
   * 15-minute one the bug came from.
   */
  test("a row with only lastSeenAt still falls back to freshness", () => {
    expect(DeviceStatusUtil.getStatus({ lastSeenAt: minutesAgo(21) })).toBe(
      NetworkDeviceStatus.Up,
    );
    expect(DeviceStatusUtil.getStatus({ lastSeenAt: minutesAgo(180) })).toBe(
      NetworkDeviceStatus.Down,
    );
  });
});

describe("DeviceStatusUtil.getReachability", () => {
  test("hands the pill everything it needs to explain itself", () => {
    const result: DeviceReachabilityResult = DeviceStatusUtil.getReachability({
      isReachable: true,
      lastPolledAt: minutesAgo(180),
      lastSeenAt: minutesAgo(180),
      pollingIntervalInMinutes: 5,
    });

    // The verdict stands; the amber "Stale" pill rides alongside it.
    expect(result.status).toBe(NetworkDeviceStatus.Up);
    expect(result.isStale).toBe(true);
    expect(result.staleWindowInMinutes).toBe(60);
    expect(result.lastContactAt).toBeInstanceOf(Date);
  });

  /*
   * The two Down tooltips say different things — "check the device" versus
   * "check the probe" — and isStale is what picks between them.
   */
  test("a device that answered nothing is Down but not stale", () => {
    const result: DeviceReachabilityResult = DeviceStatusUtil.getReachability({
      isReachable: false,
      lastPolledAt: minutesAgo(1),
      lastSeenAt: minutesAgo(600),
      pollingIntervalInMinutes: 5,
    });

    expect(result.status).toBe(NetworkDeviceStatus.Down);
    expect(result.isStale).toBe(false);
  });
});

describe("DeviceStatusUtil.getStaleWindowInMinutes", () => {
  test("scales with the device's own interval, floored at an hour", () => {
    expect(DeviceStatusUtil.getStaleWindowInMinutes(5)).toBe(60);
    expect(DeviceStatusUtil.getStaleWindowInMinutes(undefined)).toBe(60);
    expect(DeviceStatusUtil.getStaleWindowInMinutes(30)).toBe(300);
  });
});

/*
 * Issue #3392, at the dashboard door.
 *
 * The shared rule takes one flag — "is the device's stamped MonitorStatus
 * at the OFFLINE end of the ladder" — while the API hands every page the
 * nested `currentMonitorStatus` relation instead. This door is where the
 * one becomes the other, and it is the only place that mapping happens, so
 * a page can go on passing a NetworkDevice row straight through.
 */
describe("a monitor-backed device, as a page actually receives it", () => {
  const MONITOR_BACKED: string = "Monitor";

  test("reads an operational monitor off the nested relation as Up", () => {
    expect(
      DeviceStatusUtil.getStatus({
        monitoringMethod: MONITOR_BACKED,
        currentMonitorStatus: { isOfflineState: false },
      }),
    ).toBe(NetworkDeviceStatus.Up);
  });

  test("reads an offline monitor off the nested relation as Down", () => {
    expect(
      DeviceStatusUtil.getStatus({
        monitoringMethod: MONITOR_BACKED,
        currentMonitorStatus: { isOfflineState: true },
      }),
    ).toBe(NetworkDeviceStatus.Down);
  });

  /*
   * The regression. Every poll column NULL — because nothing polls it —
   * plus a bound Ping monitor reporting healthy, which is exactly the row
   * the issue screenshots show sitting on "Pending".
   */
  test("issue #3392: a bound ping monitor beats the empty poll columns", () => {
    expect(
      DeviceStatusUtil.getStatus({
        monitoringMethod: MONITOR_BACKED,
        currentMonitorStatus: { isOfflineState: false },
        isReachable: null,
        lastPolledAt: null,
        lastSeenAt: null,
        pollingIntervalInMinutes: null,
      }),
    ).toBe(NetworkDeviceStatus.Up);
  });

  /*
   * A relation the API left out (nothing bound, or bound and never
   * evaluated) must not collapse into "not offline" — that would paint an
   * unbound device green, which is a worse lie than the grey one this
   * change is fixing.
   */
  test("a missing relation is Pending, not a healthy default", () => {
    expect(
      DeviceStatusUtil.getStatus({ monitoringMethod: MONITOR_BACKED }),
    ).toBe(NetworkDeviceStatus.Pending);

    expect(
      DeviceStatusUtil.getStatus({
        monitoringMethod: MONITOR_BACKED,
        currentMonitorStatus: null,
      }),
    ).toBe(NetworkDeviceStatus.Pending);
  });

  /*
   * A MonitorStatus row whose isOfflineState the select did not ask for
   * still means "a monitor has reported" — the middle rungs of the ladder
   * ("Degraded") are not offline, which is how the topology map reads them.
   */
  test("a relation with no isOfflineState reads as not-offline", () => {
    expect(
      DeviceStatusUtil.getStatus({
        monitoringMethod: MONITOR_BACKED,
        currentMonitorStatus: {},
      }),
    ).toBe(NetworkDeviceStatus.Up);
  });

  test("flags the verdict as monitor-backed so a tooltip can say so", () => {
    const monitorBacked: DeviceReachabilityResult =
      DeviceStatusUtil.getReachability({
        monitoringMethod: MONITOR_BACKED,
        currentMonitorStatus: { isOfflineState: false },
      });

    expect(monitorBacked.isMonitorBacked).toBe(true);
    // Nothing polls it, so it can never be "nobody has polled this lately".
    expect(monitorBacked.isStale).toBe(false);

    const polled: DeviceReachabilityResult = DeviceStatusUtil.getReachability({
      isReachable: true,
      lastPolledAt: minutesAgo(1),
      lastSeenAt: minutesAgo(1),
    });

    expect(polled.isMonitorBacked).toBe(false);
  });

  /*
   * A probe-polled device can also carry a stamped monitor status — a
   * Network Device monitor watching its walk puts one there, and an
   * "interface down means Offline" criterion is enough to stamp it. That
   * must not start deciding its pill: its own poll does. A device that
   * answers ping is reachable however unhappy a monitor is about its ports,
   * and the two disagreeing is how a device reads Up on its own Interfaces
   * tab and Down on the list above it.
   *
   * "SNMP" here is the legacy spelling of the method — the enum is Probe /
   * Monitor now, and every unrecognised value (this one included) parses to
   * Probe, which is what keeps rows written before the rename on the poll
   * rule.
   */
  test("a probe-polled device with a stamped status is still judged by its own poll", () => {
    expect(
      DeviceStatusUtil.getStatus({
        monitoringMethod: "SNMP",
        currentMonitorStatus: { isOfflineState: true },
        isReachable: true,
        lastPolledAt: minutesAgo(1),
        lastSeenAt: minutesAgo(1),
      }),
    ).toBe(NetworkDeviceStatus.Up);
  });

  /*
   * Server-side callers (the site rollup, the topology builder) already
   * hand the shared rule the flat flag. Passing it through unchanged is
   * what lets the same door serve both.
   */
  test("an explicit flat flag is passed through rather than remapped", () => {
    expect(
      DeviceStatusUtil.getStatus({
        monitoringMethod: MONITOR_BACKED,
        monitorStatusIsOffline: true,
        currentMonitorStatus: { isOfflineState: false },
      }),
    ).toBe(NetworkDeviceStatus.Down);
  });
});

/*
 * The "No monitor" qualifier's predicate. It is shown for exactly one kind
 * of row — monitor-backed with nothing bound — and every other combination
 * has a different, existing answer: a probe-polled device has no binding to
 * be missing (it has a probe instead, and its own "No probe" qualifier when
 * that is what is absent), and a bound monitor-backed device is either
 * judged or "not yet".
 */
describe("isUnboundMonitorBackedDevice", () => {
  const MONITOR_ID: ObjectID = new ObjectID(
    "44444444-4444-4444-8444-444444444444",
  );

  test("is true for a monitor-backed device with nothing bound", () => {
    expect(
      isUnboundMonitorBackedDevice({
        monitoringMethod: "Monitor",
        monitorId: undefined,
      }),
    ).toBe(true);
    expect(
      isUnboundMonitorBackedDevice({
        monitoringMethod: "Monitor",
        monitorId: null,
      }),
    ).toBe(true);
  });

  test("is false once a monitor is bound, whether the id arrives as an ObjectID or a string", () => {
    expect(
      isUnboundMonitorBackedDevice({
        monitoringMethod: "Monitor",
        monitorId: MONITOR_ID,
      }),
    ).toBe(false);
    expect(
      isUnboundMonitorBackedDevice({
        monitoringMethod: "Monitor",
        monitorId: MONITOR_ID.toString(),
      }),
    ).toBe(false);
  });

  /*
   * A probe-polled device can carry a monitorId (the column is not
   * method-gated) and usually carries none; neither is a missing binding,
   * because nothing about a probe-polled device's status depends on one —
   * its probe pings it.
   *
   * The methods below are every spelling that parses to Probe: the legacy
   * "SNMP" the enum used to carry, an absent value (rows written before the
   * column existed), the empty string, and a typo. Only the exact word
   * "Monitor" is monitor-backed, so anything unrecognised keeps its device
   * on the poll rule rather than stranding it on Pending behind a binding it
   * was never going to have.
   */
  test.each([
    ["SNMP", undefined],
    ["SNMP", null],
    [undefined, undefined],
    ["", undefined],
    ["Monitorr", undefined],
  ])(
    "is false for a device whose method %p reads as Probe",
    (method: string | undefined, monitorId: null | undefined) => {
      expect(
        isUnboundMonitorBackedDevice({
          monitoringMethod: method,
          monitorId: monitorId,
        }),
      ).toBe(false);
    },
  );

  test("reads the method through the parser, so case and whitespace do not matter", () => {
    expect(
      isUnboundMonitorBackedDevice({
        monitoringMethod: "  monitor ",
        monitorId: undefined,
      }),
    ).toBe(true);
  });
});

/*
 * The walk never moves the verdict.
 *
 * A poll is a ping, plus an SNMP walk on the devices that have credentials,
 * and the device is reachable when EITHER answers. That is what makes
 * "answers ping, walk is broken" a real state rather than a contradiction —
 * and it is why `isSnmpReachable` is a qualifier column and not a second
 * verdict column. If it ever started deciding the pill, every ICMP-answering
 * device with expired credentials would go red on the list while its own
 * Overview said it was up, and the Status chip (SQL over `isReachable`)
 * would return a set the pills disagreed with.
 */
describe("the qualifier columns do not decide the verdict", () => {
  test("a device that answers ping with a failing walk is still Up", () => {
    expect(
      DeviceStatusUtil.getStatus({
        isReachable: true,
        isSnmpReachable: false,
        lastPolledAt: minutesAgo(1),
        lastSeenAt: minutesAgo(1),
      }),
    ).toBe(NetworkDeviceStatus.Up);
  });

  /*
   * ...and the converse: a walk that succeeded cannot rescue a device the
   * poll pipeline recorded as unreachable. `isReachable` is the one column
   * the answer comes from, whatever else the row carries.
   */
  test("a device recorded unreachable stays Down whatever its walk column says", () => {
    expect(
      DeviceStatusUtil.getStatus({
        isReachable: false,
        isSnmpReachable: true,
        lastPolledAt: minutesAgo(1),
        lastSeenAt: minutesAgo(30),
      }),
    ).toBe(NetworkDeviceStatus.Down);
  });

  /*
   * Losing the probe does not make the device unreachable — it makes the
   * verdict un-refreshable, which is what the "No probe" pill says. The last
   * poll's answer stands until a later poll contradicts it, exactly as it
   * does for a device whose probe is merely behind.
   */
  test("an Up device keeps its verdict when its probe is removed or polling is switched off", () => {
    expect(
      DeviceStatusUtil.getStatus({
        isReachable: true,
        probeId: null,
        isPollingEnabled: false,
        lastPolledAt: minutesAgo(1),
        lastSeenAt: minutesAgo(1),
      }),
    ).toBe(NetworkDeviceStatus.Up);
  });
});

/*
 * The "SNMP failing" qualifier's predicate: reachable by ping, and the last
 * walk failed. It is the only pill that explains why a green device's
 * interfaces, inventory and health OIDs have stopped moving, and it must
 * appear beside a GREEN pill only — "SNMP failing" next to a red one would
 * send an operator to check credentials on a box that is switched off.
 */
describe("isSnmpFailing", () => {
  test("is true for a pingable device whose last walk failed", () => {
    expect(
      isSnmpFailing({
        isReachable: true,
        isSnmpReachable: false,
        lastPolledAt: minutesAgo(1),
        lastSeenAt: minutesAgo(1),
      }),
    ).toBe(true);
  });

  /*
   * The legacy method spelling parses to Probe, so a row written before the
   * enum was renamed still gets the pill rather than silently losing it.
   */
  test("is true for a device still carrying the legacy method spelling", () => {
    expect(
      isSnmpFailing({
        monitoringMethod: "SNMP",
        isReachable: true,
        isSnmpReachable: false,
        lastPolledAt: minutesAgo(1),
        lastSeenAt: minutesAgo(1),
      }),
    ).toBe(true);
  });

  test("is false once the device itself is Down", () => {
    expect(
      isSnmpFailing({
        isReachable: false,
        isSnmpReachable: false,
        lastPolledAt: minutesAgo(1),
        lastSeenAt: minutesAgo(90),
      }),
    ).toBe(false);
  });

  /*
   * Nothing has polled it yet, so "the walk is failing" is a claim about an
   * attempt that never happened.
   */
  test("is false for a device with no verdict yet", () => {
    expect(isSnmpFailing({ isSnmpReachable: false })).toBe(false);
  });

  /*
   * NULL is the pinged-only device — no usable credentials, so no walk was
   * ever attempted. Nothing is failing; there is nothing to fail.
   */
  test("is false for a pinged-only device", () => {
    expect(
      isSnmpFailing({
        isReachable: true,
        isSnmpReachable: null,
        lastPolledAt: minutesAgo(1),
        lastSeenAt: minutesAgo(1),
      }),
    ).toBe(false);
  });

  /*
   * `undefined` is a page that did not select the column, not a failing
   * walk. Reading it as one would stamp "SNMP failing" on every row of a
   * list that simply asked for less.
   */
  test("is false when the column was not selected", () => {
    expect(
      isSnmpFailing({
        isReachable: true,
        lastPolledAt: minutesAgo(1),
        lastSeenAt: minutesAgo(1),
      }),
    ).toBe(false);
  });

  /*
   * A monitor-backed device is never polled and never walked, so its walk
   * columns are NULL forever. A stale `false` left on such a row by a device
   * that was switched over from probe polling must not resurrect the pill:
   * there is no walk to fix.
   */
  test("is false for a monitor-backed device whatever its walk column holds", () => {
    expect(
      isSnmpFailing({
        monitoringMethod: "Monitor",
        isSnmpReachable: false,
        currentMonitorStatus: { isOfflineState: false },
      }),
    ).toBe(false);
  });
});

/*
 * The "No probe" qualifier's predicate: a probe-polled device nothing CAN
 * poll. Both ways of getting there — no probe assigned, or polling switched
 * off — leave the device on its current verdict forever, and the pill is the
 * only thing on the row that says so.
 */
describe("isUnpolledProbeDevice", () => {
  const PROBE_ID: ObjectID = new ObjectID(
    "55555555-5555-4555-8555-555555555555",
  );

  test("is true for a probe-polled device with no probe assigned", () => {
    expect(isUnpolledProbeDevice({ probeId: null })).toBe(true);
    expect(isUnpolledProbeDevice({ probeId: undefined })).toBe(true);
  });

  test("is true for a device whose polling has been switched off", () => {
    expect(
      isUnpolledProbeDevice({ probeId: PROBE_ID, isPollingEnabled: false }),
    ).toBe(true);
  });

  test("is false once a probe is assigned and polling is on", () => {
    expect(
      isUnpolledProbeDevice({ probeId: PROBE_ID, isPollingEnabled: true }),
    ).toBe(false);
    // The id arrives as a string on a row that came back from the API.
    expect(
      isUnpolledProbeDevice({
        probeId: PROBE_ID.toString(),
        isPollingEnabled: true,
      }),
    ).toBe(false);
  });

  /*
   * The column is non-nullable with a default of true, so anything that is
   * not an explicit `false` is a row the page did not select it on — and a
   * missing column must not put "No probe" on every device in the list.
   */
  test("only an explicit false reads as polling switched off", () => {
    expect(isUnpolledProbeDevice({ probeId: PROBE_ID })).toBe(false);
    expect(
      isUnpolledProbeDevice({ probeId: PROBE_ID, isPollingEnabled: null }),
    ).toBe(false);
  });

  /*
   * A monitor-backed device has no probe BY DESIGN — its bound monitor is
   * what reports it — so "No probe" would be an instruction to fix something
   * that is not broken. Its own qualifier is "No monitor".
   */
  test("is false for a monitor-backed device, which has no probe by design", () => {
    expect(
      isUnpolledProbeDevice({
        monitoringMethod: "Monitor",
        probeId: null,
        isPollingEnabled: false,
      }),
    ).toBe(false);
  });
});

/*
 * The Interfaces column's "No SNMP" label. Interface counts are written by a
 * successful walk and by nothing else, so a pinged-only device has none —
 * and "0 / 0" there would claim it has no working ports, which is a
 * different and wrong statement (#3447).
 */
describe("hasNoSnmpInventory", () => {
  test("is true for a polled device that has never had a walk attempted", () => {
    expect(
      hasNoSnmpInventory({
        isReachable: true,
        isSnmpReachable: null,
        lastPolledAt: minutesAgo(1),
        lastSeenAt: minutesAgo(1),
      }),
    ).toBe(true);
  });

  /*
   * A failing walk is a different row: it HAS collected counts, they are
   * just frozen at whatever the last successful walk found. "No SNMP" would
   * hide that; the "SNMP failing" pill is what that device gets.
   */
  test("is false for a device whose walk is failing", () => {
    expect(
      hasNoSnmpInventory({
        isReachable: true,
        isSnmpReachable: false,
        lastPolledAt: minutesAgo(1),
        lastSeenAt: minutesAgo(1),
      }),
    ).toBe(false);
  });

  test("is false for a device whose walk is succeeding", () => {
    expect(
      hasNoSnmpInventory({
        isReachable: true,
        isSnmpReachable: true,
        lastPolledAt: minutesAgo(1),
        lastSeenAt: minutesAgo(1),
      }),
    ).toBe(false);
  });

  /*
   * Before the first poll nothing is known either way — NULL means "no walk
   * attempted" here too, but the honest label is "—", not a claim that the
   * device is pinged only.
   */
  test("is false for a device that has never been polled", () => {
    expect(hasNoSnmpInventory({ isSnmpReachable: null })).toBe(false);
  });

  test("is false for a monitor-backed device, which is never walked", () => {
    expect(
      hasNoSnmpInventory({
        monitoringMethod: "Monitor",
        isSnmpReachable: null,
        lastPolledAt: minutesAgo(1),
      }),
    ).toBe(false);
  });
});

/*
 * The three qualifiers are pills BESIDE the verdict, never a fourth word in
 * place of it. The tiles and the Status chip partition the fleet into
 * exactly Up / Down / Pending, so a qualifier that reused one of those words
 * — or that read as a verdict of its own — would make "Status is Pending"
 * return rows whose pill said something else entirely.
 */
describe("the qualifier vocabulary", () => {
  const VERDICT_WORDS: Array<string> = [
    NetworkDeviceStatus.Up,
    NetworkDeviceStatus.Down,
    NetworkDeviceStatus.Pending,
  ];

  test.each([
    ["No monitor", NO_MONITOR_QUALIFIER],
    ["No probe", NO_PROBE_QUALIFIER],
    ["SNMP failing", SNMP_FAILING_QUALIFIER],
    ["No SNMP", NO_SNMP_INTERFACES_LABEL],
  ])(
    "%s is its own word, and explains what to do about it",
    (expected: string, qualifier: { text: string; tooltip: string }) => {
      expect(qualifier.text).toBe(expected);
      expect(VERDICT_WORDS).not.toContain(qualifier.text);
      expect(qualifier.tooltip.length).toBeGreaterThan(0);
    },
  );

  /*
   * "SNMP failing" sits beside a green pill, so its sentence has to open by
   * agreeing with that pill — the device answers — before naming the walk.
   * A tooltip that read as "this device is unreachable" would contradict the
   * verdict it is printed next to.
   */
  test("the SNMP failing tooltip agrees with the green pill it sits beside", () => {
    expect(SNMP_FAILING_QUALIFIER.tooltip).toContain("answers ping");
    expect(SNMP_FAILING_QUALIFIER.tooltip.toLowerCase()).toContain(
      "credentials",
    );
  });

  /*
   * And "No SNMP" is about a device that is being polled — by ping — so its
   * sentence must not read as "nothing is watching this device".
   */
  test("the No SNMP label says the device is still pinged", () => {
    expect(NO_SNMP_INTERFACES_LABEL.tooltip.toLowerCase()).toContain(
      "pinged only",
    );
  });
});
