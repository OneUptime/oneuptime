import MonitorType from "../../../Types/Monitor/MonitorType";
import { SAMPLE_PEOPLE } from "../../../Types/SampleProject/SampleProject";
import {
  MINUTES_IN_A_DAY,
  SAMPLE_ALERTS,
  SAMPLE_INCIDENTS,
  SAMPLE_MAINTENANCE,
  SAMPLE_MONITOR_HISTORY_DAYS,
  SAMPLE_MONITORS,
  SAMPLE_ON_CALL,
  SAMPLE_SLO,
  SAMPLE_STATUS_PAGE_GROUPS,
  SampleAlertState,
  SampleIncident,
  SampleIncidentState,
  SampleMonitor,
  SampleMonitorOutage,
  SampleMonitorStatus,
} from "../../../Types/SampleProject/SampleProjectContent";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A SAMPLE PROJECT HOLDS (issue #6808): small, connected, and as the
 * issue asks - about ten monitors of the common types with thirty days of
 * history, one Degraded; three incidents, one open with a timeline, notes
 * and an on-call run, two resolved, one with a postmortem; a few alerts; an
 * on-call policy of two levels and a weekly rotation; a status page of the
 * monitors. Every reference points at something the sample has.
 */

const monitorKeys: Set<string> = new Set<string>(
  SAMPLE_MONITORS.map((monitor: SampleMonitor): string => {
    return monitor.key;
  }),
);
const handles: Set<string> = new Set<string>(
  SAMPLE_PEOPLE.map((person: { handle: string }): string => {
    return person.handle;
  }),
);

const openOutage: (
  monitor: SampleMonitor,
) => SampleMonitorOutage | undefined = (
  monitor: SampleMonitor,
): SampleMonitorOutage | undefined => {
  return monitor.outages.find((outage: SampleMonitorOutage): boolean => {
    return outage.endsMinutesAgo === null;
  });
};

const isOpen: (incident: SampleIncident) => boolean = (
  incident: SampleIncident,
): boolean => {
  return (
    incident.states[incident.states.length - 1]!.state !==
    SampleIncidentState.Resolved
  );
};

describe("the monitors", () => {
  test("about ten, each once, of the common types", () => {
    expect(SAMPLE_MONITORS.length).toBeGreaterThanOrEqual(8);
    expect(SAMPLE_MONITORS.length).toBeLessThanOrEqual(12);
    expect(monitorKeys.size).toBe(SAMPLE_MONITORS.length);

    const types: Set<MonitorType> = new Set<MonitorType>(
      SAMPLE_MONITORS.map((monitor: SampleMonitor): MonitorType => {
        return monitor.monitorType;
      }),
    );

    for (const type of [
      MonitorType.Website,
      MonitorType.API,
      MonitorType.Ping,
      MonitorType.Port,
      MonitorType.SSLCertificate,
      MonitorType.IncomingRequest,
    ]) {
      expect(types).toContain(type);
    }
  });

  test("exactly one is not operational now, and it is Degraded", () => {
    const notOperational: Array<SampleMonitor> = SAMPLE_MONITORS.filter(
      (monitor: SampleMonitor): boolean => {
        return Boolean(openOutage(monitor));
      },
    );

    expect(notOperational).toHaveLength(1);
    expect(openOutage(notOperational[0]!)!.status).toBe(
      SampleMonitorStatus.Degraded,
    );
  });

  test("every outage is within the thirty days, ends after it starts, and none overlap", () => {
    for (const monitor of SAMPLE_MONITORS) {
      const outages: Array<SampleMonitorOutage> = [...monitor.outages].sort(
        (a: SampleMonitorOutage, b: SampleMonitorOutage): number => {
          return b.startsMinutesAgo - a.startsMinutesAgo;
        },
      );

      outages.forEach((outage: SampleMonitorOutage, index: number) => {
        expect(outage.startsMinutesAgo).toBeLessThan(
          SAMPLE_MONITOR_HISTORY_DAYS * MINUTES_IN_A_DAY,
        );
        expect(outage.status).not.toBe(SampleMonitorStatus.Operational);
        expect(outage.rootCause.endsWith(".")).toBe(true);

        if (outage.endsMinutesAgo !== null) {
          expect(outage.endsMinutesAgo).toBeLessThan(outage.startsMinutesAgo);
        } else {
          // Only the last can still be going on.
          expect(index).toBe(outages.length - 1);
        }

        const next: SampleMonitorOutage | undefined = outages[index + 1];

        if (next) {
          expect(next.startsMinutesAgo).toBeLessThan(
            outage.endsMinutesAgo as number,
          );
        }
      });
    }
  });

  test("a monitor that needs an address has one, and a port monitor a port", () => {
    for (const monitor of SAMPLE_MONITORS) {
      if (monitor.monitorType === MonitorType.IncomingRequest) {
        expect(monitor.destination).toBeNull();
        continue;
      }

      expect(monitor.destination).toBeTruthy();
      // Made-up addresses only: example.com is reserved (RFC 2606).
      expect(monitor.destination).toMatch(/example\.com/);

      if (monitor.monitorType === MonitorType.Port) {
        expect(monitor.port).toBeGreaterThan(0);
      }
    }
  });
});

describe("the incidents", () => {
  test("three: one open, two resolved, one of them with a postmortem", () => {
    expect(SAMPLE_INCIDENTS).toHaveLength(3);

    const open: Array<SampleIncident> = SAMPLE_INCIDENTS.filter(isOpen);
    const resolved: Array<SampleIncident> = SAMPLE_INCIDENTS.filter(
      (incident: SampleIncident): boolean => {
        return !isOpen(incident);
      },
    );

    expect(open).toHaveLength(1);
    expect(resolved).toHaveLength(2);
    expect(
      resolved.filter((incident: SampleIncident): boolean => {
        return Boolean(incident.postmortemNote);
      }),
    ).toHaveLength(1);
  });

  test("the open one has a timeline, notes, the on-call run, and is on the Degraded monitor", () => {
    const open: SampleIncident = SAMPLE_INCIDENTS.find(isOpen)!;
    const degraded: SampleMonitor = SAMPLE_MONITORS.find(
      (monitor: SampleMonitor): boolean => {
        return Boolean(openOutage(monitor));
      },
    )!;

    expect(open.states.length).toBeGreaterThanOrEqual(2);
    expect(open.internalNotes.length).toBeGreaterThanOrEqual(1);
    expect(open.publicNotes.length).toBeGreaterThanOrEqual(1);
    expect(open.isPagedByOnCall).toBe(true);
    expect(open.monitorKeys).toContain(degraded.key);
    expect(
      SAMPLE_INCIDENTS.filter((incident: SampleIncident): boolean => {
        return incident.isPagedByOnCall;
      }),
    ).toHaveLength(1);
  });

  test("states start where they were declared and move forward in time", () => {
    for (const incident of SAMPLE_INCIDENTS) {
      expect(incident.states[0]!.state).toBe(SampleIncidentState.Identified);
      expect(incident.states[0]!.minutesAgo).toBe(incident.declaredMinutesAgo);

      for (let index: number = 1; index < incident.states.length; index++) {
        expect(incident.states[index]!.minutesAgo).toBeLessThan(
          incident.states[index - 1]!.minutesAgo,
        );
      }
    }
  });

  test("notes are posted while the incident was there, by its people", () => {
    for (const incident of SAMPLE_INCIDENTS) {
      for (const note of [...incident.internalNotes, ...incident.publicNotes]) {
        expect(note.minutesAgo).toBeLessThanOrEqual(
          incident.declaredMinutesAgo,
        );
        expect(note.minutesAgo).toBeGreaterThanOrEqual(0);

        if (note.authorHandle) {
          expect(handles).toContain(note.authorHandle);
        }
      }

      for (const key of incident.monitorKeys) {
        expect(monitorKeys).toContain(key);
      }
    }
  });
});

describe("the alerts", () => {
  test("a few, on the sample's monitors, with states in order", () => {
    expect(SAMPLE_ALERTS.length).toBeGreaterThanOrEqual(2);

    for (const alert of SAMPLE_ALERTS) {
      if (alert.monitorKey) {
        expect(monitorKeys).toContain(alert.monitorKey);
      }

      expect(alert.states[0]!.state).toBe(SampleAlertState.Identified);

      for (let index: number = 1; index < alert.states.length; index++) {
        expect(alert.states[index]!.minutesAgo).toBeLessThan(
          alert.states[index - 1]!.minutesAgo,
        );
      }
    }
  });
});

describe("the on-call policy", () => {
  test("a weekly rotation of sample people, then a second level after a wait", () => {
    expect(SAMPLE_ON_CALL.rotationHandles.length).toBeGreaterThanOrEqual(2);

    for (const handle of SAMPLE_ON_CALL.rotationHandles) {
      expect(handles).toContain(handle);
    }

    expect(handles).toContain(SAMPLE_ON_CALL.secondLevelHandle);
    expect(SAMPLE_ON_CALL.rotationHandles).not.toContain(
      SAMPLE_ON_CALL.secondLevelHandle,
    );
    expect(SAMPLE_ON_CALL.escalateAfterInMinutes).toBeGreaterThan(0);
  });

  test("the engineer on call acknowledged the open incident before it escalated", () => {
    const open: SampleIncident = SAMPLE_INCIDENTS.find(isOpen)!;
    const acknowledged: { state: SampleIncidentState; minutesAgo: number } =
      open.states.find(
        (state: { state: SampleIncidentState; minutesAgo: number }) => {
          return state.state === SampleIncidentState.Acknowledged;
        },
      )!;

    expect(open.declaredMinutesAgo - acknowledged.minutesAgo).toBe(
      SAMPLE_ON_CALL.acknowledgedAfterMinutes,
    );
    expect(SAMPLE_ON_CALL.acknowledgedAfterMinutes).toBeLessThan(
      SAMPLE_ON_CALL.escalateAfterInMinutes,
    );
  });
});

describe("the status page, the maintenance and the SLO", () => {
  test("the status page shows web and API monitors in its groups", () => {
    const shown: Array<SampleMonitor> = SAMPLE_MONITORS.filter(
      (monitor: SampleMonitor): boolean => {
        return monitor.statusPageGroup !== null;
      },
    );

    expect(shown.length).toBeGreaterThanOrEqual(3);

    for (const monitor of shown) {
      expect(SAMPLE_STATUS_PAGE_GROUPS).toContain(monitor.statusPageGroup);
    }

    // The open incident's monitor is on the page, so the page shows it.
    const open: SampleIncident = SAMPLE_INCIDENTS.find(isOpen)!;

    expect(
      open.monitorKeys.some((key: string): boolean => {
        return shown.some((monitor: SampleMonitor): boolean => {
          return monitor.key === key;
        });
      }),
    ).toBe(true);
  });

  test("the maintenance is coming up, on the sample's monitors", () => {
    expect(SAMPLE_MAINTENANCE.startsInMinutes).toBeGreaterThan(0);
    expect(SAMPLE_MAINTENANCE.durationInMinutes).toBeGreaterThan(0);

    for (const key of SAMPLE_MAINTENANCE.monitorKeys) {
      expect(monitorKeys).toContain(key);
    }
  });

  test("the SLO is on a sample monitor, with a target below 100%", () => {
    expect(monitorKeys).toContain(SAMPLE_SLO.monitorKey);
    expect(SAMPLE_SLO.targetPercentage).toBeGreaterThan(90);
    expect(SAMPLE_SLO.targetPercentage).toBeLessThan(100);
  });
});
