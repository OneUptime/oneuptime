import { describe, expect, test } from "@jest/globals";
import {
  RECURRENCE_FIX_THRESHOLDS,
  decideRecurrenceVerdict,
} from "../../../../../Server/Utils/AI/CodeFix/RecurrenceFixVerdict";
import { FixProductionVerdict } from "../../../../../Server/Utils/AI/CodeFix/FixProductionVerdict";
import FixProductionStatus from "../../../../../Types/AI/FixProductionStatus";
import { IncidentAlertAiSubjectKind } from "../../../../../Types/AI/IncidentAlertAiLogs";
import { seededRandom, SeededRandom } from "../../../../Helpers/SeededRandom";

/*
 * A fix of an investigation's root cause is merged, not working. These pin
 * when its monitor counts as stopped (no incident for a day, and long
 * enough that at its rate before it would have raised three), as not
 * stopped (any new incident after the rollout grace), and as impossible to
 * tell (a monitor that rarely fires, or an incident left open, which keeps
 * the monitor from raising another).
 */

const HOUR: number = 60 * 60 * 1000;
const DEPLOYED_AT: Date = new Date("2026-10-20T10:00:00.000Z");
const GRACE: number = RECURRENCE_FIX_THRESHOLDS.rolloutGraceMinutes * 60 * 1000;

// `hours` of watched time after the rollout grace.
function watched(hours: number): Date {
  return new Date(DEPLOYED_AT.getTime() + GRACE + hours * HOUR);
}

function decide(data: {
  now: Date;
  recurrences?: number;
  firstRecurrenceLabel?: string;
  baselineCount: number;
  hasOpenSubject?: boolean;
  openSeenAt?: Date;
  subjectKind?: IncidentAlertAiSubjectKind;
  monitorLabel?: string;
}): FixProductionVerdict {
  return decideRecurrenceVerdict({
    deployedAt: DEPLOYED_AT,
    now: data.now,
    subjectKind: data.subjectKind || "incident",
    recurrences: data.recurrences || 0,
    firstRecurrenceLabel: data.firstRecurrenceLabel,
    baselineCount: data.baselineCount,
    hasOpenSubject: data.hasOpenSubject || false,
    openSeenAt: data.openSeenAt,
    deployLabel: "version 2.3.2",
    monitorLabel: data.monitorLabel || 'monitor "API health"',
  });
}

describe("thresholds", () => {
  test("are pinned: a month's baseline, two weeks' watch", () => {
    expect(RECURRENCE_FIX_THRESHOLDS).toEqual({
      rolloutGraceMinutes: 10,
      minWatchHours: 24,
      maxWatchDays: 14,
      minExpectedRecurrences: 3,
      baselineDays: 30,
    });
  });
});

describe("a deployed fix of an incident's root cause", () => {
  test("one new incident from the monitor is Regressed, however early", () => {
    expect(
      decide({
        now: watched(0.5),
        recurrences: 1,
        firstRecurrenceLabel: "INC-57",
        baselineCount: 9,
      }),
    ).toEqual({
      status: FixProductionStatus.Regressed,
      summary:
        'Monitor "API health" raised incident INC-57 after version 2.3.2 shipped the fix, so the fix did not stop it.',
    });
  });

  test("several are counted, naming the first", () => {
    expect(
      decide({
        now: watched(40),
        recurrences: 3,
        firstRecurrenceLabel: "#12",
        baselineCount: 9,
        subjectKind: "alert",
      }).summary,
    ).toBe(
      'Monitor "API health" raised 3 alerts, the first #12, after version 2.3.2 shipped the fix, so the fix did not stop it.',
    );
  });

  test("a recurrence wins over an open incident", () => {
    expect(
      decide({
        now: watched(2),
        recurrences: 1,
        baselineCount: 9,
        hasOpenSubject: true,
      }).status,
    ).toBe(FixProductionStatus.Regressed);
  });

  test("quiet for a day and long enough to expect three is Verified", () => {
    // 9 in 30 days is 0.3 a day: three are expected after 10 days.
    expect(decide({ now: watched(239), baselineCount: 9 }).status).toBe(
      FixProductionStatus.Watching,
    );
    expect(decide({ now: watched(240), baselineCount: 9 })).toEqual({
      status: FixProductionStatus.Verified,
      summary:
        'Monitor "API health" raised no incident in the 10 days since version 2.3.2 shipped the fix; it raised 9 incidents in the 30 days before the fix.',
    });
  });

  test("never before a day, however often it fired before", () => {
    expect(decide({ now: watched(23), baselineCount: 3000 }).status).toBe(
      FixProductionStatus.Watching,
    );
    expect(decide({ now: watched(24), baselineCount: 3000 }).status).toBe(
      FixProductionStatus.Verified,
    );
  });

  test("a monitor too rare to tell is Unverifiable after two weeks", () => {
    expect(decide({ now: watched(14 * 24), baselineCount: 1 })).toEqual({
      status: FixProductionStatus.Unverifiable,
      summary:
        'Monitor "API health" raised no incident in the 14 days since version 2.3.2 shipped the fix, but it raised 1 incident in the 30 days before the fix: too rare for its absence to show the fix works.',
    });
  });

  test("an open incident keeps it from being Verified, and ends the watch Unverifiable", () => {
    expect(
      decide({ now: watched(300), baselineCount: 90, hasOpenSubject: true }),
    ).toEqual({
      status: FixProductionStatus.Watching,
      summary:
        'Version 2.3.2 shipped the fix. Monitor "API health" has raised no incident since, but one of its incidents is still open, and it raises no other while one is; it raised 90 incidents in the 30 days before the fix.',
    });
    expect(
      decide({
        now: watched(14 * 24),
        baselineCount: 90,
        hasOpenSubject: true,
      }),
    ).toEqual({
      status: FixProductionStatus.Unverifiable,
      summary:
        'An incident of monitor "API health" stayed open through the 14 days since version 2.3.2 shipped the fix, and a monitor raises no other while one is open: whether the fix stopped it cannot be told.',
    });
  });

  test("quiet time counts from the last check that found one open", () => {
    // 90 in 30 days is 3 a day: a day of quiet is enough.
    const closedLate: FixProductionVerdict = decide({
      now: watched(30),
      baselineCount: 90,
      openSeenAt: watched(20),
    });

    expect(closedLate.status).toBe(FixProductionStatus.Watching);

    expect(
      decide({ now: watched(44), baselineCount: 90, openSeenAt: watched(20) }),
    ).toEqual({
      status: FixProductionStatus.Verified,
      summary:
        'Monitor "API health" raised no incident in the 24 hours since its last incident closed; it raised 90 incidents in the 30 days before the fix.',
    });
  });

  test("the watch's words do not change from one check to the next", () => {
    expect(decide({ now: watched(5), baselineCount: 2 })).toEqual(
      decide({ now: watched(100), baselineCount: 2 }),
    );
    expect(decide({ now: watched(5), baselineCount: 2 }).summary).toBe(
      'Version 2.3.2 shipped the fix, and monitor "API health" has raised no incident since; it raised 2 incidents in the 30 days before the fix.',
    );
  });

  test("Verified always means quiet for a day, with three expected and none open", () => {
    const random: SeededRandom = seededRandom(5095);

    for (let draw: number = 0; draw < 2000; draw++) {
      const hours: number = random(16 * 24);
      const baselineCount: number = random(200);
      const hasOpenSubject: boolean = random(4) === 0;
      const recurrences: number = random(5) === 0 ? 1 + random(3) : 0;
      const verdict: FixProductionVerdict = decide({
        now: watched(hours),
        baselineCount,
        hasOpenSubject,
        recurrences,
      });

      if (recurrences > 0) {
        expect(verdict.status).toBe(FixProductionStatus.Regressed);
        continue;
      }

      if (verdict.status === FixProductionStatus.Verified) {
        expect(hasOpenSubject).toBe(false);
        expect(hours).toBeGreaterThanOrEqual(24);
        expect((baselineCount / (30 * 24)) * hours).toBeGreaterThanOrEqual(3);
      }

      expect(verdict.status).not.toBe(FixProductionStatus.Regressed);

      if (hours >= 14 * 24) {
        expect(verdict.status).not.toBe(FixProductionStatus.Watching);
      }
    }
  });
});
