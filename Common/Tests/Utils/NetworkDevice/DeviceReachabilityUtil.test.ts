import { describe, expect, test } from "@jest/globals";
import DeviceReachabilityUtil, {
  DEFAULT_DEVICE_POLLING_INTERVAL_IN_MINUTES,
  DEVICE_MIN_STALE_WINDOW_IN_MINUTES,
  DEVICE_MISSED_POLL_ALLOWANCE,
  DeviceReachabilityInput,
  DeviceReachabilityResult,
  NetworkDeviceReachability,
} from "../../../Utils/NetworkDevice/DeviceReachabilityUtil";

/*
 * DeviceReachabilityUtil is the single rule behind every up/down verdict a
 * NetworkDevice gets: the device list pill, the summary tiles, the device
 * Overview hero, the topology graph, the network map and the site rollup.
 *
 * The rule it replaced was "lastSeenAt newer than a fixed 15 minutes", and
 * the whole point of these tests is to pin the distinction that rule could
 * not make — "the device did not answer" versus "we have not asked". Every
 * case below states which of the two it is about.
 *
 * `now` is passed explicitly rather than faked, because that is how every
 * production caller uses it (the topology builder and the site rollup both
 * thread one shared `now` through a whole graph).
 */

const NOW: Date = new Date("2026-08-18T12:00:00.000Z");

const MS_PER_MINUTE: number = 60 * 1000;

function minutesAgo(minutes: number, extraMs: number = 0): Date {
  return new Date(NOW.getTime() - minutes * MS_PER_MINUTE - extraMs);
}

function statusOf(device: DeviceReachabilityInput): NetworkDeviceReachability {
  return DeviceReachabilityUtil.getStatus(device, NOW);
}

function reachabilityOf(
  device: DeviceReachabilityInput,
): DeviceReachabilityResult {
  return DeviceReachabilityUtil.getReachability(device, NOW);
}

describe("the constants the rule is built from", () => {
  test("the default interval mirrors the NetworkDevice column default", () => {
    expect(DEFAULT_DEVICE_POLLING_INTERVAL_IN_MINUTES).toBe(5);
  });

  test("ten missed polls, floored at an hour", () => {
    expect(DEVICE_MISSED_POLL_ALLOWANCE).toBe(10);
    expect(DEVICE_MIN_STALE_WINDOW_IN_MINUTES).toBe(60);
  });

  test("the enum carries the display strings the pills render", () => {
    expect(NetworkDeviceReachability.Up).toBe("Up");
    expect(NetworkDeviceReachability.Down).toBe("Down");
    expect(NetworkDeviceReachability.Pending).toBe("Pending");
  });
});

describe("DeviceReachabilityUtil.getPollingIntervalInMinutes", () => {
  test("keeps a sane configured interval", () => {
    expect(DeviceReachabilityUtil.getPollingIntervalInMinutes(5)).toBe(5);
    expect(DeviceReachabilityUtil.getPollingIntervalInMinutes(30)).toBe(30);
    expect(DeviceReachabilityUtil.getPollingIntervalInMinutes(1440)).toBe(1440);
  });

  test("a missing interval falls back to the column default", () => {
    expect(DeviceReachabilityUtil.getPollingIntervalInMinutes(undefined)).toBe(
      5,
    );
    expect(DeviceReachabilityUtil.getPollingIntervalInMinutes(null)).toBe(5);
  });

  /*
   * The same clamp NetworkDeviceService.claimDevicesForPolling applies when
   * it advances nextPollAt. If the two disagreed, the window would be sized
   * against a schedule the scheduler never runs.
   */
  test("zero, negative and non-finite intervals fall back too", () => {
    expect(DeviceReachabilityUtil.getPollingIntervalInMinutes(0)).toBe(5);
    expect(DeviceReachabilityUtil.getPollingIntervalInMinutes(-15)).toBe(5);
    expect(DeviceReachabilityUtil.getPollingIntervalInMinutes(NaN)).toBe(5);
    expect(
      DeviceReachabilityUtil.getPollingIntervalInMinutes(
        Number.POSITIVE_INFINITY,
      ),
    ).toBe(5);
  });

  test("a sub-minute interval is clamped up to one minute", () => {
    expect(DeviceReachabilityUtil.getPollingIntervalInMinutes(0.5)).toBe(1);
  });
});

describe("DeviceReachabilityUtil.getStaleWindowInMinutes", () => {
  test("short intervals get the one-hour floor, not ten times nothing", () => {
    expect(DeviceReachabilityUtil.getStaleWindowInMinutes(1)).toBe(60);
    expect(DeviceReachabilityUtil.getStaleWindowInMinutes(5)).toBe(60);
    expect(DeviceReachabilityUtil.getStaleWindowInMinutes(6)).toBe(60);
  });

  test("beyond six minutes the window scales with the device's own schedule", () => {
    expect(DeviceReachabilityUtil.getStaleWindowInMinutes(10)).toBe(100);
    expect(DeviceReachabilityUtil.getStaleWindowInMinutes(30)).toBe(300);
    expect(DeviceReachabilityUtil.getStaleWindowInMinutes(60)).toBe(600);
  });

  /*
   * The old rule was a flat 15 minutes for every device, which a device
   * polled every 15, 30 or 60 minutes could never satisfy — it was down the
   * moment it was configured.
   */
  test("a slow-polled device's window always exceeds its own interval", () => {
    for (const interval of [1, 5, 15, 30, 60, 120, 720, 1440]) {
      expect(
        DeviceReachabilityUtil.getStaleWindowInMinutes(interval),
      ).toBeGreaterThan(interval);
    }
  });
});

describe("the last poll failed → Down", () => {
  test("isReachable false is Down", () => {
    expect(statusOf({ isReachable: false })).toBe(
      NetworkDeviceReachability.Down,
    );
  });

  /*
   * The verdict does not expire. Nothing since has contradicted it, and
   * inventing an expiry is how "we have not asked lately" became "the
   * device is up" in the other direction.
   */
  test("Down stands however old the failed poll is", () => {
    expect(
      statusOf({
        isReachable: false,
        lastPolledAt: minutesAgo(1),
        lastSeenAt: minutesAgo(90),
      }),
    ).toBe(NetworkDeviceReachability.Down);

    expect(
      statusOf({
        isReachable: false,
        lastPolledAt: minutesAgo(60 * 24 * 30),
        lastSeenAt: minutesAgo(60 * 24 * 30),
      }),
    ).toBe(NetworkDeviceReachability.Down);
  });

  test("a device that answered recently but failed its LAST poll is Down", () => {
    expect(
      statusOf({
        isReachable: false,
        lastPolledAt: minutesAgo(1),
        lastSeenAt: minutesAgo(6),
        pollingIntervalInMinutes: 5,
      }),
    ).toBe(NetworkDeviceReachability.Down);
  });
});

describe("the last poll succeeded → Up", () => {
  test("isReachable true, polled just now, is Up", () => {
    expect(
      statusOf({
        isReachable: true,
        lastPolledAt: NOW,
        lastSeenAt: NOW,
        pollingIntervalInMinutes: 5,
      }),
    ).toBe(NetworkDeviceReachability.Up);
  });

  /*
   * THE REGRESSION. Issue #3220: UN1234WANRTR01 answered SNMP — its
   * Interfaces tab showed 14 ports up, written by that very walk — but the
   * fleet was big enough that its probe could only get round to it every
   * ~20 minutes, so the last successful poll was 21 minutes old and the old
   * fixed 15-minute freshness window called the device Down.
   */
  test("issue #3220: a device polled 21 minutes ago on a 5-minute interval is Up", () => {
    expect(
      statusOf({
        isReachable: true,
        lastPolledAt: minutesAgo(21),
        lastSeenAt: minutesAgo(21),
        pollingIntervalInMinutes: 5,
      }),
    ).toBe(NetworkDeviceReachability.Up);
  });

  test("issue #3220, generalised: no lag short of the stale window flips a good poll to Down", () => {
    for (const lagInMinutes of [16, 21, 30, 45, 59]) {
      expect(
        statusOf({
          isReachable: true,
          lastPolledAt: minutesAgo(lagInMinutes),
          lastSeenAt: minutesAgo(lagInMinutes),
          pollingIntervalInMinutes: 5,
        }),
      ).toBe(NetworkDeviceReachability.Up);
    }
  });

  /*
   * The other half of the same bug, with no fleet-size excuse needed: a
   * device configured to be polled every 30 minutes could not be inside a
   * 15-minute window at any point in its cycle.
   */
  test("a device on a 30-minute interval is Up right before its next poll", () => {
    expect(
      statusOf({
        isReachable: true,
        lastPolledAt: minutesAgo(29),
        lastSeenAt: minutesAgo(29),
        pollingIntervalInMinutes: 30,
      }),
    ).toBe(NetworkDeviceReachability.Up);
  });

  test("a device on a 60-minute interval is Up right before its next poll", () => {
    expect(
      statusOf({
        isReachable: true,
        lastPolledAt: minutesAgo(59),
        lastSeenAt: minutesAgo(59),
        pollingIntervalInMinutes: 60,
      }),
    ).toBe(NetworkDeviceReachability.Up);
  });

  test("a clock-skewed future timestamp is Up, not an error", () => {
    expect(
      statusOf({
        isReachable: true,
        lastPolledAt: minutesAgo(-5),
        lastSeenAt: minutesAgo(-5),
      }),
    ).toBe(NetworkDeviceReachability.Up);
  });
});

/*
 * Staleness ANNOTATES the verdict; it never replaces it.
 *
 * Two reasons, and the tests below pin both. Turning "nothing has polled
 * this in a while" into "the device is down" is the exact inference this
 * whole change exists to remove — doing it again at an hour instead of
 * fifteen minutes would just move the bug. And the window is per-device
 * (derived from each row's own interval), so a status that depended on it
 * could never be expressed as a SQL filter — the device list's summary
 * counts and its Status chip run in the database over `isReachable`, and a
 * pill they cannot reproduce is a pill that contradicts them on screen.
 */
describe("the polling pipeline stopped → still Up, but flagged stale", () => {
  test("a good verdict older than the stale window stays Up and is flagged", () => {
    const result: DeviceReachabilityResult = reachabilityOf({
      isReachable: true,
      lastPolledAt: minutesAgo(61),
      lastSeenAt: minutesAgo(61),
      pollingIntervalInMinutes: 5,
    });

    expect(result.status).toBe(NetworkDeviceReachability.Up);
    expect(result.isStale).toBe(true);
  });

  test("the staleness boundary is strict, and moves only isStale", () => {
    expect(
      reachabilityOf({
        isReachable: true,
        lastPolledAt: minutesAgo(60),
        pollingIntervalInMinutes: 5,
      }),
    ).toMatchObject({ status: NetworkDeviceReachability.Up, isStale: false });

    expect(
      reachabilityOf({
        isReachable: true,
        lastPolledAt: minutesAgo(60, 1),
        pollingIntervalInMinutes: 5,
      }),
    ).toMatchObject({ status: NetworkDeviceReachability.Up, isStale: true });
  });

  test("the window follows the device's interval, so a slow device is not flagged early", () => {
    // 30-minute interval -> 300-minute window: four hours is fine.
    expect(
      reachabilityOf({
        isReachable: true,
        lastPolledAt: minutesAgo(240),
        pollingIntervalInMinutes: 30,
      }).isStale,
    ).toBe(false);

    // Six hours is not.
    expect(
      reachabilityOf({
        isReachable: true,
        lastPolledAt: minutesAgo(360),
        pollingIntervalInMinutes: 30,
      }).isStale,
    ).toBe(true);
  });

  /*
   * The invariant that keeps the pill, the summary counts and the Status
   * chip in agreement. The latter two are SQL over `isReachable` alone, so
   * the moment anything else can change `status`, they diverge — which is
   * precisely how a stale fleet came to render 40 red rows under a tile
   * reading "Devices Down 0".
   */
  test("status is decided by isReachable alone, whatever the timestamps say", () => {
    const ages: Array<number> = [0, 1, 59, 60, 61, 600, 60 * 24 * 30];

    for (const age of ages) {
      expect(
        statusOf({
          isReachable: true,
          lastPolledAt: minutesAgo(age),
          lastSeenAt: minutesAgo(age),
          pollingIntervalInMinutes: 5,
        }),
      ).toBe(NetworkDeviceReachability.Up);

      expect(
        statusOf({
          isReachable: false,
          lastPolledAt: minutesAgo(age),
          lastSeenAt: minutesAgo(age + 10),
          pollingIntervalInMinutes: 5,
        }),
      ).toBe(NetworkDeviceReachability.Down);
    }
  });

  test("the result names the window it judged against, so the UI can explain itself", () => {
    expect(
      reachabilityOf({ isReachable: true, pollingIntervalInMinutes: 30 })
        .staleWindowInMinutes,
    ).toBe(300);
    expect(
      reachabilityOf({ isReachable: true, pollingIntervalInMinutes: 5 })
        .staleWindowInMinutes,
    ).toBe(60);
  });

  /*
   * A failing device is in contact — we are reaching its probe, the probe
   * is reaching the network, the device just is not answering. Measuring
   * staleness from lastSeenAt would call that "out of contact" and hide the
   * real, more specific diagnosis behind a probe-health message.
   */
  test("a device failing every poll is Down but NOT stale", () => {
    const result: DeviceReachabilityResult = reachabilityOf({
      isReachable: false,
      lastPolledAt: minutesAgo(2),
      lastSeenAt: minutesAgo(600),
      pollingIntervalInMinutes: 5,
    });

    expect(result.status).toBe(NetworkDeviceReachability.Down);
    expect(result.isStale).toBe(false);
    expect(result.lastContactAt?.getTime()).toBe(minutesAgo(2).getTime());
  });

  test("a device can be both Down and stale, reported independently", () => {
    const result: DeviceReachabilityResult = reachabilityOf({
      isReachable: false,
      lastPolledAt: minutesAgo(600),
      pollingIntervalInMinutes: 5,
    });

    expect(result.status).toBe(NetworkDeviceReachability.Down);
    expect(result.isStale).toBe(true);
  });
});

describe("never polled → Pending", () => {
  test("a device with no poll history at all is Pending", () => {
    expect(statusOf({})).toBe(NetworkDeviceReachability.Pending);
  });

  test("explicit nulls (raw API payloads) are Pending", () => {
    expect(
      statusOf({
        isReachable: null,
        lastPolledAt: null,
        lastSeenAt: null,
        pollingIntervalInMinutes: null,
      }),
    ).toBe(NetworkDeviceReachability.Pending);
  });

  test("empty-string dates are Pending, not Invalid Date", () => {
    expect(statusOf({ lastPolledAt: "", lastSeenAt: "" })).toBe(
      NetworkDeviceReachability.Pending,
    );
  });

  test("Pending is never reported as stale — there is nothing to have gone stale", () => {
    const result: DeviceReachabilityResult = reachabilityOf({});

    expect(result.isStale).toBe(false);
    expect(result.lastContactAt).toBeNull();
  });

  /*
   * Polled repeatedly and never once answered. That is a device that is
   * down, not a device waiting to be set up — calling it Pending would hide
   * it from every "what is broken" view on the product.
   */
  test("polled but never answered is Down, not Pending", () => {
    expect(
      statusOf({
        lastPolledAt: minutesAgo(2),
        lastSeenAt: undefined,
      }),
    ).toBe(NetworkDeviceReachability.Down);
  });
});

/*
 * Rows written before the isReachable column existed carry only lastSeenAt
 * until their first walk after the upgrade rewrites them. The upgrade
 * migration backfills them, so this is a narrow window — but a device must
 * not read Pending (and vanish from the Down list) during it.
 */
describe("rows with no recorded outcome fall back to freshness", () => {
  test("a legacy row seen recently is Up", () => {
    expect(statusOf({ lastSeenAt: minutesAgo(5) })).toBe(
      NetworkDeviceReachability.Up,
    );
  });

  test("a legacy row is judged against the same generous window", () => {
    expect(statusOf({ lastSeenAt: minutesAgo(21) })).toBe(
      NetworkDeviceReachability.Up,
    );
    expect(statusOf({ lastSeenAt: minutesAgo(61) })).toBe(
      NetworkDeviceReachability.Down,
    );
  });

  test("a legacy row's interval still sizes its window", () => {
    expect(
      statusOf({ lastSeenAt: minutesAgo(200), pollingIntervalInMinutes: 30 }),
    ).toBe(NetworkDeviceReachability.Up);
  });
});

describe("date parsing", () => {
  test("accepts ISO strings, the form the API serializes", () => {
    expect(
      statusOf({
        isReachable: true,
        lastPolledAt: "2026-08-18T11:39:00.000Z",
        lastSeenAt: "2026-08-18T11:39:00.000Z",
      }),
    ).toBe(NetworkDeviceReachability.Up);
  });

  test("accepts Date objects", () => {
    expect(statusOf({ isReachable: true, lastPolledAt: new Date(NOW) })).toBe(
      NetworkDeviceReachability.Up,
    );
  });

  /*
   * An Invalid Date compares false against every window, which would
   * silently read as "fresh". Treating it as "not set" makes the outcome
   * column the only thing deciding, which is at least honest.
   */
  test("an unparseable date reads as not-set rather than as fresh", () => {
    const result: DeviceReachabilityResult = reachabilityOf({
      lastSeenAt: "not-a-date-at-all",
    });

    expect(result.lastContactAt).toBeNull();
    expect(result.status).toBe(NetworkDeviceReachability.Pending);
  });
});

describe("lastContactAt is the newer of the two timestamps", () => {
  test("the later attempt wins over the earlier success", () => {
    expect(
      reachabilityOf({
        isReachable: false,
        lastPolledAt: minutesAgo(1),
        lastSeenAt: minutesAgo(30),
      }).lastContactAt?.getTime(),
    ).toBe(minutesAgo(1).getTime());
  });

  test("a legacy row with only lastSeenAt uses it", () => {
    expect(
      reachabilityOf({ lastSeenAt: minutesAgo(7) }).lastContactAt?.getTime(),
    ).toBe(minutesAgo(7).getTime());
  });

  test("a device polled but never seen uses the attempt", () => {
    expect(
      reachabilityOf({
        isReachable: false,
        lastPolledAt: minutesAgo(3),
      }).lastContactAt?.getTime(),
    ).toBe(minutesAgo(3).getTime());
  });
});

/*
 * The scenario from the issue, at the scale the issue reports it: 980
 * devices behind one probe that can only claim 50 a minute, so the fleet
 * takes ~20 minutes to cycle and every device's last successful poll is
 * uniformly spread across that window. Under the old rule roughly a quarter
 * of a perfectly healthy fleet was red at any instant, which is what "323
 * of 980 Down/Stale" was.
 */
describe("issue #3220 at fleet scale", () => {
  function healthyFleetPolledOverMinutes(
    cycleInMinutes: number,
    deviceCount: number,
  ): Array<DeviceReachabilityInput> {
    const devices: Array<DeviceReachabilityInput> = [];

    for (let index: number = 0; index < deviceCount; index++) {
      const ageInMinutes: number = (index / deviceCount) * cycleInMinutes;
      devices.push({
        isReachable: true,
        lastPolledAt: minutesAgo(ageInMinutes),
        lastSeenAt: minutesAgo(ageInMinutes),
        pollingIntervalInMinutes: 5,
      });
    }

    return devices;
  }

  test("a healthy fleet on a 20-minute cycle reports zero devices down", () => {
    const fleet: Array<DeviceReachabilityInput> = healthyFleetPolledOverMinutes(
      20,
      980,
    );

    const down: number = fleet.filter(
      (device: DeviceReachabilityInput): boolean => {
        return statusOf(device) === NetworkDeviceReachability.Down;
      },
    ).length;

    expect(down).toBe(0);
  });

  test("genuinely unreachable devices in that fleet are still counted", () => {
    const fleet: Array<DeviceReachabilityInput> = healthyFleetPolledOverMinutes(
      20,
      100,
    );

    // Three of them failed their last walk.
    fleet[10]!.isReachable = false;
    fleet[40]!.isReachable = false;
    fleet[90]!.isReachable = false;

    const down: number = fleet.filter(
      (device: DeviceReachabilityInput): boolean => {
        return statusOf(device) === NetworkDeviceReachability.Down;
      },
    ).length;

    expect(down).toBe(3);
  });

  /*
   * A probe that has stopped entirely. The fleet keeps its last known
   * verdicts — inventing an outage nobody observed is the failure mode this
   * change exists to remove — but every device is flagged stale, which is
   * the signal that says "check the probe" rather than "check 50 devices".
   */
  test("a fleet whose probe has stopped is flagged stale, not declared down", () => {
    const fleet: Array<DeviceReachabilityInput> = healthyFleetPolledOverMinutes(
      20,
      50,
    ).map((device: DeviceReachabilityInput): DeviceReachabilityInput => {
      // Nothing has been polled for three hours.
      return {
        ...device,
        lastPolledAt: minutesAgo(180),
        lastSeenAt: minutesAgo(180),
      };
    });

    const down: number = fleet.filter(
      (device: DeviceReachabilityInput): boolean => {
        return statusOf(device) === NetworkDeviceReachability.Down;
      },
    ).length;
    const stale: number = fleet.filter(
      (device: DeviceReachabilityInput): boolean => {
        return reachabilityOf(device).isStale;
      },
    ).length;

    expect(down).toBe(0);
    expect(stale).toBe(50);
  });
});

/*
 * Issue #3392: a device nothing polls.
 *
 * The whole rule above is about the OUTCOME of a poll, and a monitor-backed
 * device never gets one — no probe, no credentials, no walk. Its poll
 * columns are NULL forever, so the rule could only ever answer "Pending"
 * for it: an operator who followed the documented workflow to the letter
 * (Monitoring Method = Monitor, a Ping monitor bound, polling off) watched
 * a device that answers every ping sit on "Pending" indefinitely.
 *
 * These pin the second rule: for such a device the bound Monitor's verdict
 * IS the answer, and every poll column on the row is irrelevant to it.
 */
describe("monitor-backed devices are judged by their monitor, not by a poll", () => {
  const MONITOR_BACKED: string = "Monitor";

  test("a bound monitor reporting healthy makes the device Up", () => {
    expect(
      statusOf({
        monitoringMethod: MONITOR_BACKED,
        monitorStatusIsOffline: false,
      }),
    ).toBe(NetworkDeviceReachability.Up);
  });

  test("a bound monitor reporting offline makes the device Down", () => {
    expect(
      statusOf({
        monitoringMethod: MONITOR_BACKED,
        monitorStatusIsOffline: true,
      }),
    ).toBe(NetworkDeviceReachability.Down);
  });

  /*
   * MonitorStatus is a ladder, not a pair: a "Degraded" row is neither
   * operational nor offline. Reading the OFFLINE end is what keeps this
   * verdict identical to the one the topology map draws for the same
   * device, which resolves the ladder the same way.
   */
  test("a degraded-but-not-offline status is Up, exactly as the map draws it", () => {
    expect(
      statusOf({
        monitoringMethod: MONITOR_BACKED,
        monitorStatusIsOffline: false,
      }),
    ).toBe(NetworkDeviceReachability.Up);
  });

  /*
   * The two ways a monitor-backed device legitimately has no verdict:
   * nothing is bound to it yet (discovery import creates ping-only hosts
   * that way on purpose), or something is bound and has not been evaluated
   * yet. Both are Pending, and neither may default to healthy.
   */
  test("no stamped status is Pending, not a healthy default", () => {
    expect(statusOf({ monitoringMethod: MONITOR_BACKED })).toBe(
      NetworkDeviceReachability.Pending,
    );

    expect(
      statusOf({
        monitoringMethod: MONITOR_BACKED,
        monitorStatusIsOffline: null,
      }),
    ).toBe(NetworkDeviceReachability.Pending);
  });

  /*
   * The regression itself. This is the exact row shape the issue reports:
   * an ICMP-only host imported by a discovery scan, switched to Monitor,
   * bound to a Ping monitor that is reporting healthy, and polled by
   * nothing — so every poll column is NULL.
   */
  test("the reported row shape reads Up rather than Pending", () => {
    const un0661voipcp01: DeviceReachabilityInput = {
      monitoringMethod: MONITOR_BACKED,
      monitorStatusIsOffline: false,
      isReachable: null,
      lastPolledAt: null,
      lastSeenAt: null,
      pollingIntervalInMinutes: null,
    };

    expect(statusOf(un0661voipcp01)).toBe(NetworkDeviceReachability.Up);
  });

  /*
   * Poll columns on a monitor-backed row are not merely absent — on a
   * device switched over from SNMP they hold whatever a probe last found
   * before it stopped asking, which is worse than nothing. The monitor
   * wins outright, in both directions.
   */
  test("a stale successful walk does not override a monitor reporting offline", () => {
    expect(
      statusOf({
        monitoringMethod: MONITOR_BACKED,
        monitorStatusIsOffline: true,
        isReachable: true,
        lastPolledAt: minutesAgo(2),
        lastSeenAt: minutesAgo(2),
      }),
    ).toBe(NetworkDeviceReachability.Down);
  });

  test("a failed walk from its SNMP days does not override a healthy monitor", () => {
    expect(
      statusOf({
        monitoringMethod: MONITOR_BACKED,
        monitorStatusIsOffline: false,
        isReachable: false,
        lastPolledAt: minutesAgo(4000),
        lastSeenAt: minutesAgo(9000),
      }),
    ).toBe(NetworkDeviceReachability.Up);
  });

  /*
   * Staleness says "nothing has polled this device lately, go and check its
   * probe". For a device that has no probe BY DESIGN that is both false and
   * actively misleading, so it can never be raised here.
   */
  test("is never flagged stale, however old the poll columns are", () => {
    const result: DeviceReachabilityResult = reachabilityOf({
      monitoringMethod: MONITOR_BACKED,
      monitorStatusIsOffline: false,
      lastPolledAt: minutesAgo(60 * 24 * 30),
      lastSeenAt: minutesAgo(60 * 24 * 30),
      pollingIntervalInMinutes: 5,
    });

    expect(result.status).toBe(NetworkDeviceReachability.Up);
    expect(result.isStale).toBe(false);
  });

  test("is never flagged stale even when it has no poll columns at all", () => {
    expect(
      reachabilityOf({
        monitoringMethod: MONITOR_BACKED,
        monitorStatusIsOffline: true,
      }).isStale,
    ).toBe(false);
  });

  /*
   * lastContactAt is still reported honestly — it is "the newest thing a
   * probe wrote", and for a device converted from SNMP that is a real
   * historical fact the device page prints. It just does not decide
   * anything here.
   */
  test("still reports lastContactAt from the poll columns when there is one", () => {
    expect(
      reachabilityOf({
        monitoringMethod: MONITOR_BACKED,
        monitorStatusIsOffline: false,
        lastPolledAt: minutesAgo(90),
      }).lastContactAt?.getTime(),
    ).toBe(minutesAgo(90).getTime());

    expect(
      reachabilityOf({
        monitoringMethod: MONITOR_BACKED,
        monitorStatusIsOffline: false,
      }).lastContactAt,
    ).toBeNull();
  });
});

/*
 * The column is free text (the SnmpVersion precedent), so what counts as
 * "monitor-backed" is whatever NetworkDeviceMonitoringMethodUtil.parse says
 * — and every other value has to keep the poll rule, because reading a
 * typo as monitor-backed would silently stop a switch being judged by its
 * walk.
 */
describe("which rows count as monitor-backed", () => {
  test.each(["Monitor", "monitor", "MONITOR", "  Monitor  "])(
    "%p reads as monitor-backed",
    (monitoringMethod: string) => {
      const result: DeviceReachabilityResult = reachabilityOf({
        monitoringMethod: monitoringMethod,
        monitorStatusIsOffline: false,
      });

      expect(result.isMonitorBacked).toBe(true);
      expect(result.status).toBe(NetworkDeviceReachability.Up);
    },
  );

  test.each([
    ["SNMP", "the explicit SNMP value"],
    ["", "an empty string"],
    ["Monitorr", "a typo"],
    ["ping", "an unrecognised word"],
  ])("%p (%s) keeps the poll rule", (monitoringMethod: string) => {
    const device: DeviceReachabilityInput = {
      monitoringMethod: monitoringMethod,
      // A monitor status the poll rule must ignore for these rows.
      monitorStatusIsOffline: true,
      isReachable: true,
      lastPolledAt: minutesAgo(1),
      lastSeenAt: minutesAgo(1),
    };

    const result: DeviceReachabilityResult = reachabilityOf(device);

    expect(result.isMonitorBacked).toBe(false);
    expect(result.status).toBe(NetworkDeviceReachability.Up);
  });

  /*
   * Every row written before the column existed, and every caller that
   * does not select it. Both have to keep behaving exactly as they did.
   */
  test.each([
    ["null", null],
    ["undefined", undefined],
  ])(
    "a %s method is a polled device, unchanged",
    (_label: string, value: string | null | undefined) => {
      const result: DeviceReachabilityResult = reachabilityOf({
        monitoringMethod: value as string | null | undefined,
        monitorStatusIsOffline: true,
        isReachable: true,
        lastPolledAt: minutesAgo(1),
        lastSeenAt: minutesAgo(1),
      });

      expect(result.isMonitorBacked).toBe(false);
      expect(result.status).toBe(NetworkDeviceReachability.Up);
    },
  );

  /*
   * A caller that selects neither new column gets precisely the old
   * behaviour, including staleness — which is what lets the topology
   * builder and the site rollup keep passing their existing projections.
   */
  test("an input carrying neither new column behaves exactly as before", () => {
    const result: DeviceReachabilityResult = reachabilityOf({
      isReachable: true,
      lastPolledAt: minutesAgo(180),
      lastSeenAt: minutesAgo(180),
      pollingIntervalInMinutes: 5,
    });

    expect(result.status).toBe(NetworkDeviceReachability.Up);
    expect(result.isStale).toBe(true);
    expect(result.isMonitorBacked).toBe(false);
  });
});
