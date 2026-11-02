import { describe, expect, test } from "@jest/globals";
import NetworkDeviceStalePoll, {
  StalePollDevice,
} from "../../../../Server/Utils/Monitor/NetworkDeviceStalePoll";
import { CheckOn, FilterType } from "../../../../Types/Monitor/CriteriaFilter";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import ObjectID from "../../../../Types/ObjectID";

/*
 * A Network Device monitor is evaluated on its device's polls, and on
 * nothing else: when they stopped, "Device unreachable" never fired. These
 * pin when a device counts as no longer polled, what its monitors then say,
 * and which monitors can say it.
 */

const NOW: Date = new Date("2026-10-30T12:00:00.000Z");

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

function polledDevice(overrides: Partial<StalePollDevice>): StalePollDevice {
  return {
    lastPolledAt: minutesAgo(1),
    pollingIntervalInMinutes: 5,
    isPollingEnabled: true,
    probeId: ObjectID.generate(),
    hostname: "10.0.0.1",
    monitoringMethod: undefined,
    createdAt: minutesAgo(60 * 24),
    ...overrides,
  };
}

function reason(
  device: StalePollDevice | null,
  monitorCreatedAt?: Date,
): string | undefined {
  return NetworkDeviceStalePoll.getStaleReason({
    device,
    monitorCreatedAt,
    now: NOW,
  });
}

function stepWithFilters(
  filters: Array<{ checkOn: CheckOn; filterType: FilterType }>,
): MonitorStep {
  return MonitorStep.fromJSON({
    _type: "MonitorStep",
    value: {
      id: ObjectID.generate().toString(),
      monitorCriteria: {
        _type: "MonitorCriteria",
        value: {
          monitorCriteriaInstanceArray: [
            {
              _type: "MonitorCriteriaInstance",
              value: {
                id: ObjectID.generate().toString(),
                filterCondition: "Any",
                filters: filters.map(
                  (filter: { checkOn: CheckOn; filterType: FilterType }) => {
                    return { ...filter, value: undefined };
                  },
                ),
                incidents: [],
                alerts: [],
              },
            },
          ],
        },
      },
    },
  } as never);
}

describe("how long a device may go without a poll", () => {
  test("three polling intervals, at least ten minutes", () => {
    expect(NetworkDeviceStalePoll.getStaleAfterInMinutes(5)).toBe(15);
    expect(NetworkDeviceStalePoll.getStaleAfterInMinutes(60)).toBe(180);
    expect(NetworkDeviceStalePoll.getStaleAfterInMinutes(1)).toBe(10);
  });

  test("the default interval when none is set", () => {
    expect(NetworkDeviceStalePoll.getStaleAfterInMinutes(undefined)).toBe(15);
    expect(NetworkDeviceStalePoll.getStaleAfterInMinutes(0)).toBe(15);
  });
});

describe("when a device's monitors say it stopped being polled", () => {
  test("a device polled on time is not stale", () => {
    expect(reason(polledDevice({ lastPolledAt: minutesAgo(14) }))).toBe(
      undefined,
    );
  });

  test("three missed polls are, and the reason says when the last one ran and why none came", () => {
    const why: string | undefined = reason(
      polledDevice({ lastPolledAt: minutesAgo(16) }),
    );

    expect(why).toContain("No poll of this device has arrived for 16 minutes");
    expect(why).toContain(minutesAgo(16).toISOString());
    expect(why).toContain("Its probe may be down or disconnected");
  });

  test("a device with no probe, or nothing to poll at, says so", () => {
    expect(
      reason(
        polledDevice({ lastPolledAt: minutesAgo(30), probeId: undefined }),
      ),
    ).toContain("No probe is assigned to poll it.");
    expect(
      reason(polledDevice({ lastPolledAt: minutesAgo(30), hostname: " " })),
    ).toContain("It has no hostname or IP address to poll.");
  });

  test("a device never polled is stale once the newer of it and the monitor is old enough", () => {
    expect(
      reason(
        polledDevice({ lastPolledAt: undefined, createdAt: minutesAgo(60) }),
        minutesAgo(5),
      ),
    ).toBe(undefined);

    expect(
      reason(
        polledDevice({ lastPolledAt: undefined, createdAt: minutesAgo(60) }),
        minutesAgo(20),
      ),
    ).toContain("This device has not been polled in the 20 minutes");
  });

  test("a deleted device is", () => {
    expect(reason(null)).toBe(
      "The network device this monitor watches no longer exists, so nothing polls it.",
    );
  });

  test("a device with polling turned off, or a monitor-backed one, is left alone", () => {
    expect(
      reason(
        polledDevice({
          lastPolledAt: minutesAgo(600),
          isPollingEnabled: false,
        }),
      ),
    ).toBe(undefined);
    expect(
      reason(
        polledDevice({
          lastPolledAt: minutesAgo(600),
          monitoringMethod: "Monitor",
        }),
      ),
    ).toBe(undefined);
  });
});

describe("which monitors can say a device is unreachable", () => {
  test("one with a Device Is Online = False criteria", () => {
    expect(
      NetworkDeviceStalePoll.canSayUnreachable(
        stepWithFilters([
          { checkOn: CheckOn.SnmpIsOnline, filterType: FilterType.False },
        ]),
      ),
    ).toBe(true);
  });

  test("not one judged on walk data alone, or only on being online", () => {
    expect(
      NetworkDeviceStalePoll.canSayUnreachable(
        stepWithFilters([
          { checkOn: CheckOn.SnmpIsOnline, filterType: FilterType.True },
        ]),
      ),
    ).toBe(false);
    expect(
      NetworkDeviceStalePoll.canSayUnreachable(
        stepWithFilters([
          {
            checkOn: CheckOn.SnmpWalkIsSucceeding,
            filterType: FilterType.False,
          },
        ]),
      ),
    ).toBe(false);
    expect(NetworkDeviceStalePoll.canSayUnreachable(new MonitorStep())).toBe(
      false,
    );
  });
});
