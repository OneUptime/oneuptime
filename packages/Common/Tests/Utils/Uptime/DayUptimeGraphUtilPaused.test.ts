import MonitorPausedBy from "../../../Types/Monitor/MonitorPausedBy";
import UptimeHistoryLabels, {
  DefaultUptimeHistoryLabels,
} from "../../../Types/Monitor/UptimeHistoryLabels";
import DayUptimeGraphUtil, {
  DayLeftOutReading,
  PausedDaySpan,
} from "../../../Utils/Uptime/DayUptimeGraphUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * A DAY A PAUSE LEFT OUT OF UPTIME, AS THE STRIP NAMES IT (issue #11433).
 *
 * Time an incident declared by hand, or scheduled maintenance, paused with
 * no status set is left out of uptime as time with monitoring off is - and
 * it read "monitoring off" everywhere. It reads as paused, and why, now:
 * "Oct 22, 2026: paused for scheduled maintenance". Time with monitoring
 * turned off keeps "monitoring off". A day that had both is named for the
 * one that left out more of it.
 */

const HOUR: number = 3600;
const DAY: number = 24 * HOUR;
const DATE: string = "Oct 22, 2026";

function nameOf(data: {
  hasEvents?: boolean;
  monitoringOffSeconds?: number;
  pausedSeconds?: number;
  pausedBy?: MonitorPausedBy | null;
  incidentCount?: number;
  labels?: UptimeHistoryLabels;
}): string {
  return DayUptimeGraphUtil.getDayAriaLabel({
    dateLabel: DATE,
    hasEvents: data.hasEvents ?? false,
    uptimePercent: 100,
    incidentCount: data.incidentCount ?? 0,
    monitoringOffSeconds: data.monitoringOffSeconds,
    pausedSeconds: data.pausedSeconds,
    pausedBy: data.pausedBy,
    labels: data.labels,
  });
}

describe("readLeftOutTime", () => {
  test("all of it paused: the pause, and no time with monitoring off", () => {
    expect(
      DayUptimeGraphUtil.readLeftOutTime({
        monitoringOffSeconds: DAY,
        pausedSeconds: DAY,
        pausedBy: MonitorPausedBy.ScheduledMaintenance,
      }),
    ).toEqual({
      turnedOffSeconds: 0,
      pausedSeconds: DAY,
      pausedBy: MonitorPausedBy.ScheduledMaintenance,
      isNamedPaused: true,
    });
  });

  test("none of it paused: monitoring off, as before", () => {
    expect(
      DayUptimeGraphUtil.readLeftOutTime({ monitoringOffSeconds: 5 * HOUR }),
    ).toEqual({
      turnedOffSeconds: 5 * HOUR,
      pausedSeconds: 0,
      pausedBy: null,
      isNamedPaused: false,
    });
  });

  test("both: each part apart, the day named for the larger, a tie for the pause", () => {
    const morePaused: DayLeftOutReading = DayUptimeGraphUtil.readLeftOutTime({
      monitoringOffSeconds: 10 * HOUR,
      pausedSeconds: 7 * HOUR,
      pausedBy: MonitorPausedBy.Incident,
    });
    expect(morePaused).toEqual({
      turnedOffSeconds: 3 * HOUR,
      pausedSeconds: 7 * HOUR,
      pausedBy: MonitorPausedBy.Incident,
      isNamedPaused: true,
    });

    expect(
      DayUptimeGraphUtil.readLeftOutTime({
        monitoringOffSeconds: 10 * HOUR,
        pausedSeconds: 3 * HOUR,
        pausedBy: MonitorPausedBy.Incident,
      }).isNamedPaused,
    ).toBe(false);

    expect(
      DayUptimeGraphUtil.readLeftOutTime({
        monitoringOffSeconds: 10 * HOUR,
        pausedSeconds: 5 * HOUR,
        pausedBy: MonitorPausedBy.Incident,
      }).isNamedPaused,
    ).toBe(true);
  });

  test("a pause never leaves out more than the day's time left out, and one with no reason is none", () => {
    expect(
      DayUptimeGraphUtil.readLeftOutTime({
        monitoringOffSeconds: HOUR,
        pausedSeconds: 2 * HOUR,
        pausedBy: MonitorPausedBy.Incident,
      }),
    ).toEqual({
      turnedOffSeconds: 0,
      pausedSeconds: HOUR,
      pausedBy: MonitorPausedBy.Incident,
      isNamedPaused: true,
    });

    expect(
      DayUptimeGraphUtil.readLeftOutTime({
        monitoringOffSeconds: HOUR,
        pausedSeconds: HOUR,
        pausedBy: null,
      }),
    ).toEqual({
      turnedOffSeconds: HOUR,
      pausedSeconds: 0,
      pausedBy: null,
      isNamedPaused: false,
    });

    // A reason that is no reason, read back from a payload.
    expect(
      DayUptimeGraphUtil.readLeftOutTime({
        monitoringOffSeconds: HOUR,
        pausedSeconds: HOUR,
        pausedBy: "Holiday" as MonitorPausedBy,
      }).isNamedPaused,
    ).toBe(false);
  });

  test("less than a second of either is no time worth saying", () => {
    expect(
      DayUptimeGraphUtil.readLeftOutTime({
        monitoringOffSeconds: HOUR + 0.4,
        pausedSeconds: HOUR,
        pausedBy: MonitorPausedBy.ScheduledMaintenance,
      }),
    ).toEqual({
      turnedOffSeconds: 0,
      pausedSeconds: HOUR,
      pausedBy: MonitorPausedBy.ScheduledMaintenance,
      isNamedPaused: true,
    });

    expect(
      DayUptimeGraphUtil.readLeftOutTime({
        monitoringOffSeconds: 0.5,
        pausedSeconds: 0.5,
        pausedBy: MonitorPausedBy.ScheduledMaintenance,
      }),
    ).toEqual({
      turnedOffSeconds: 0,
      pausedSeconds: 0,
      pausedBy: null,
      isNamedPaused: false,
    });
  });

  test("anything that is not a number reads as none", () => {
    expect(
      DayUptimeGraphUtil.readLeftOutTime({
        monitoringOffSeconds: Number.NaN,
        pausedSeconds: -5,
        pausedBy: MonitorPausedBy.Incident,
      }),
    ).toEqual({
      turnedOffSeconds: 0,
      pausedSeconds: 0,
      pausedBy: null,
      isNamedPaused: false,
    });
  });
});

describe("a day's name", () => {
  test.each([
    [MonitorPausedBy.Incident, `${DATE}: paused by an incident`],
    [MonitorPausedBy.ScheduledMaintenance, `${DATE}: paused for scheduled maintenance`],
    [
      MonitorPausedBy.IncidentAndScheduledMaintenance,
      `${DATE}: paused by an incident and scheduled maintenance`,
    ],
  ])(
    "a day nothing was checked on, paused (%s): named for the pause, never monitoring off",
    (pausedBy: MonitorPausedBy, name: string) => {
      expect(
        nameOf({
          monitoringOffSeconds: DAY,
          pausedSeconds: DAY,
          pausedBy: pausedBy,
        }),
      ).toBe(name);
    },
  );

  test.each([
    [MonitorPausedBy.Incident, `${DATE}: paused by an incident, 2 incidents`],
    [
      MonitorPausedBy.ScheduledMaintenance,
      `${DATE}: paused for scheduled maintenance, 2 incidents`,
    ],
    [
      MonitorPausedBy.IncidentAndScheduledMaintenance,
      `${DATE}: paused by an incident and scheduled maintenance, 2 incidents`,
    ],
  ])(
    "with incidents that day (%s), it says how many",
    (pausedBy: MonitorPausedBy, name: string) => {
      expect(
        nameOf({
          monitoringOffSeconds: DAY,
          pausedSeconds: DAY,
          pausedBy: pausedBy,
          incidentCount: 2,
        }),
      ).toBe(name);
    },
  );

  test("monitoring turned off keeps its words", () => {
    expect(nameOf({ monitoringOffSeconds: DAY })).toBe(
      `${DATE}: monitoring off`,
    );
    expect(nameOf({ monitoringOffSeconds: DAY, incidentCount: 1 })).toBe(
      `${DATE}: monitoring off, 1 incidents`,
    );
  });

  test("a day off for longer than it was paused reads monitoring off", () => {
    expect(
      nameOf({
        monitoringOffSeconds: DAY,
        pausedSeconds: 4 * HOUR,
        pausedBy: MonitorPausedBy.ScheduledMaintenance,
      }),
    ).toBe(`${DATE}: monitoring off`);
  });

  test("a day with data is named by its uptime, however much of it was paused", () => {
    expect(
      nameOf({
        hasEvents: true,
        monitoringOffSeconds: 6 * HOUR,
        pausedSeconds: 6 * HOUR,
        pausedBy: MonitorPausedBy.Incident,
      }),
    ).toBe(`${DATE}: 100% uptime`);
  });

  test("a day with no time left out is no data, as before", () => {
    expect(nameOf({})).toBe(`${DATE}: no data`);
    expect(
      nameOf({ pausedSeconds: DAY, pausedBy: MonitorPausedBy.Incident }),
    ).toBe(`${DATE}: no data`);
  });

  test("the page's own words are used, not the defaults", () => {
    const labels: UptimeHistoryLabels = {
      ...DefaultUptimeHistoryLabels,
      dayLabelPausedForMaintenance: "{{date}} · en pausa por mantenimiento",
    };

    expect(
      nameOf({
        monitoringOffSeconds: DAY,
        pausedSeconds: DAY,
        pausedBy: MonitorPausedBy.ScheduledMaintenance,
        labels: labels,
      }),
    ).toBe(`${DATE} · en pausa por mantenimiento`);
  });

  test("the dialog's words for each reason", () => {
    const labels: UptimeHistoryLabels = DefaultUptimeHistoryLabels;

    expect(
      [
        MonitorPausedBy.Incident,
        MonitorPausedBy.ScheduledMaintenance,
        MonitorPausedBy.IncidentAndScheduledMaintenance,
      ].map((pausedBy: MonitorPausedBy): [string, string] => {
        return [
          DayUptimeGraphUtil.getPausedOnThisDayLabel({
            pausedBy: pausedBy,
            labels: labels,
          }),
          DayUptimeGraphUtil.getPausedForLabel({
            pausedBy: pausedBy,
            labels: labels,
          }),
        ];
      }),
    ).toEqual([
      [
        "Monitoring was paused by an incident on this day",
        "Paused by an incident for {{duration}}",
      ],
      [
        "Monitoring was paused for scheduled maintenance on this day",
        "Paused for scheduled maintenance for {{duration}}",
      ],
      [
        "Monitoring was paused by an incident and scheduled maintenance on this day",
        "Paused by an incident and scheduled maintenance for {{duration}}",
      ],
    ]);
  });

  test("no paused label says monitoring off, and every one says paused", () => {
    const paused: Array<string> = [
      DefaultUptimeHistoryLabels.dayLabelPausedByIncident,
      DefaultUptimeHistoryLabels.dayLabelPausedByIncidentWithIncidents,
      DefaultUptimeHistoryLabels.dayLabelPausedForMaintenance,
      DefaultUptimeHistoryLabels.dayLabelPausedForMaintenanceWithIncidents,
      DefaultUptimeHistoryLabels.dayLabelPausedByIncidentAndMaintenance,
      DefaultUptimeHistoryLabels.dayLabelPausedByIncidentAndMaintenanceWithIncidents,
      DefaultUptimeHistoryLabels.pausedByIncidentOnThisDay,
      DefaultUptimeHistoryLabels.pausedForMaintenanceOnThisDay,
      DefaultUptimeHistoryLabels.pausedByIncidentAndMaintenanceOnThisDay,
      DefaultUptimeHistoryLabels.pausedByIncidentFor,
      DefaultUptimeHistoryLabels.pausedForMaintenanceFor,
      DefaultUptimeHistoryLabels.pausedByIncidentAndMaintenanceFor,
    ];

    for (const label of paused) {
      expect({ label, saysPaused: /paused/i.test(label) }).toEqual({
        label,
        saysPaused: true,
      });
      expect({ label, saysOff: /monitoring off|was off/i.test(label) }).toEqual(
        { label, saysOff: false },
      );
    }
  });
});

describe("getPausedTimeOfDay, from timeline spans", () => {
  const dayStart: Date = new Date("2026-10-22T00:00:00.000Z");
  const dayEnd: Date = new Date("2026-10-23T00:00:00.000Z");

  function span(
    from: string,
    to: string,
    pausedBy?: MonitorPausedBy | null,
  ): PausedDaySpan {
    return {
      startDate: new Date(`2026-10-${from}:00.000Z`),
      endDate: new Date(`2026-10-${to}:00.000Z`),
      pausedBy: pausedBy,
    };
  }

  test("the paused spans' time in the day, less what was checked, with what paused them", () => {
    expect(
      DayUptimeGraphUtil.getPausedTimeOfDay({
        monitoringOffSpans: [
          span("22T02:00", "22T06:00", MonitorPausedBy.ScheduledMaintenance),
          // Monitoring turned off: not a pause.
          span("22T08:00", "22T10:00", null),
          span("22T12:00", "22T14:00", MonitorPausedBy.Incident),
        ],
        checkedSpans: [span("22T13:00", "22T14:00")],
        dayStart: dayStart,
        dayEnd: dayEnd,
      }),
    ).toEqual({
      pausedSeconds: 5 * HOUR,
      pausedBy: MonitorPausedBy.IncidentAndScheduledMaintenance,
    });
  });

  test("a pause that runs past midnight counts in each day only its own part", () => {
    expect(
      DayUptimeGraphUtil.getPausedTimeOfDay({
        monitoringOffSpans: [
          span("21T20:00", "22T03:00", MonitorPausedBy.ScheduledMaintenance),
        ],
        checkedSpans: [],
        dayStart: dayStart,
        dayEnd: dayEnd,
      }),
    ).toEqual({
      pausedSeconds: 3 * HOUR,
      pausedBy: MonitorPausedBy.ScheduledMaintenance,
    });
  });

  test("a pause on another day, or only monitoring turned off, is none", () => {
    expect(
      DayUptimeGraphUtil.getPausedTimeOfDay({
        monitoringOffSpans: [
          span("21T01:00", "21T05:00", MonitorPausedBy.Incident),
          span("22T01:00", "22T05:00", null),
        ],
        checkedSpans: [],
        dayStart: dayStart,
        dayEnd: dayEnd,
      }),
    ).toEqual({ pausedSeconds: 0, pausedBy: null });
  });

  test("a pause fully checked over leaves nothing out, and names nothing", () => {
    expect(
      DayUptimeGraphUtil.getPausedTimeOfDay({
        monitoringOffSpans: [
          span("22T01:00", "22T05:00", MonitorPausedBy.Incident),
        ],
        checkedSpans: [span("22T00:00", "22T06:00")],
        dayStart: dayStart,
        dayEnd: dayEnd,
      }),
    ).toEqual({ pausedSeconds: 0, pausedBy: null });
  });

  test("the paused time is never more than all of the day's time with monitoring off", () => {
    const spans: Array<PausedDaySpan> = [
      span("22T00:00", "22T09:00", MonitorPausedBy.Incident),
      span("22T05:00", "22T11:00", null),
      span("22T15:00", "22T16:00", MonitorPausedBy.ScheduledMaintenance),
    ];
    const checked: Array<PausedDaySpan> = [span("22T08:00", "22T09:30")];

    const paused: number = DayUptimeGraphUtil.getPausedTimeOfDay({
      monitoringOffSpans: spans,
      checkedSpans: checked,
      dayStart: dayStart,
      dayEnd: dayEnd,
    }).pausedSeconds;
    const all: number = DayUptimeGraphUtil.getMonitoringOffSecondsOfDay({
      monitoringOffSpans: spans,
      checkedSpans: checked,
      dayStart: dayStart,
      dayEnd: dayEnd,
    });

    // 00:00-09:00 and 15:00-16:00, less the hour of 08:00-09:30 checked.
    expect(paused).toBe(9 * HOUR);
    // 00:00-11:00 and 15:00-16:00, less 08:00-09:30.
    expect(all).toBe(10.5 * HOUR);
    expect(paused).toBeLessThanOrEqual(all);
  });
});
