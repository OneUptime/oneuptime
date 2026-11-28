import MonitorPausedBy, {
  MonitorPausedByUtil,
} from "../../../Types/Monitor/MonitorPausedBy";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT PAUSED A MONITOR, FOR TIME LEFT OUT OF UPTIME (issue #11433).
 *
 * Time a pause leaves out of uptime reads "paused", and why: by an incident
 * declared by hand, for scheduled maintenance, or by both. A status event
 * says which (MonitorStatusTimeline.pausedBy), and a day reads it from its
 * status events together (combine).
 */

const ALL: Array<MonitorPausedBy> = Object.values(MonitorPausedBy);

describe("MonitorPausedByUtil", () => {
  test("the three reasons, stored as their names", () => {
    expect(ALL).toEqual([
      "Incident",
      "ScheduledMaintenance",
      "IncidentAndScheduledMaintenance",
    ]);
  });

  test("of: what paused it, from whether an incident and maintenance did", () => {
    expect(
      MonitorPausedByUtil.of({ isByIncident: true, isForMaintenance: false }),
    ).toBe(MonitorPausedBy.Incident);
    expect(
      MonitorPausedByUtil.of({ isByIncident: false, isForMaintenance: true }),
    ).toBe(MonitorPausedBy.ScheduledMaintenance);
    expect(
      MonitorPausedByUtil.of({ isByIncident: true, isForMaintenance: true }),
    ).toBe(MonitorPausedBy.IncidentAndScheduledMaintenance);
    expect(
      MonitorPausedByUtil.of({ isByIncident: false, isForMaintenance: false }),
    ).toBeNull();
  });

  test("isByIncident and isForMaintenance read each reason, and nothing else as one", () => {
    expect(ALL.map(MonitorPausedByUtil.isByIncident)).toEqual([
      true,
      false,
      true,
    ]);
    expect(ALL.map(MonitorPausedByUtil.isForMaintenance)).toEqual([
      false,
      true,
      true,
    ]);

    for (const other of [null, undefined, "", "incident", "Maintenance"]) {
      expect(MonitorPausedByUtil.isByIncident(other)).toBe(false);
      expect(MonitorPausedByUtil.isForMaintenance(other)).toBe(false);
    }
  });

  test("fromValue reads a stored reason back, and anything else as none", () => {
    for (const reason of ALL) {
      expect(MonitorPausedByUtil.fromValue(reason)).toBe(reason);
    }

    for (const other of [null, undefined, "", 1, {}, "INCIDENT", " Incident"]) {
      expect(MonitorPausedByUtil.fromValue(other)).toBeNull();
    }
  });

  test("combine: by an incident when any span was, for maintenance when any was", () => {
    expect(MonitorPausedByUtil.combine([])).toBeNull();
    expect(MonitorPausedByUtil.combine([null, undefined])).toBeNull();
    expect(
      MonitorPausedByUtil.combine([
        MonitorPausedBy.Incident,
        MonitorPausedBy.Incident,
      ]),
    ).toBe(MonitorPausedBy.Incident);
    expect(
      MonitorPausedByUtil.combine([
        MonitorPausedBy.Incident,
        null,
        MonitorPausedBy.ScheduledMaintenance,
      ]),
    ).toBe(MonitorPausedBy.IncidentAndScheduledMaintenance);
    expect(
      MonitorPausedByUtil.combine([
        MonitorPausedBy.IncidentAndScheduledMaintenance,
      ]),
    ).toBe(MonitorPausedBy.IncidentAndScheduledMaintenance);
  });

  test("combine over drawn spans is the same in any order, and joins what each says", () => {
    const random: SeededRandom = seededRandom(114330);
    const values: Array<MonitorPausedBy | null> = [...ALL, null];

    for (let draw: number = 0; draw < 300; draw++) {
      const spans: Array<MonitorPausedBy | null> = [];

      for (let index: number = random(6); index > 0; index--) {
        spans.push(values[random(values.length)]!);
      }

      const combined: MonitorPausedBy | null =
        MonitorPausedByUtil.combine(spans);

      expect(MonitorPausedByUtil.combine([...spans].reverse())).toBe(combined);
      expect(MonitorPausedByUtil.isByIncident(combined)).toBe(
        spans.some((span: MonitorPausedBy | null): boolean => {
          return MonitorPausedByUtil.isByIncident(span);
        }),
      );
      expect(MonitorPausedByUtil.isForMaintenance(combined)).toBe(
        spans.some((span: MonitorPausedBy | null): boolean => {
          return MonitorPausedByUtil.isForMaintenance(span);
        }),
      );
    }
  });
});
