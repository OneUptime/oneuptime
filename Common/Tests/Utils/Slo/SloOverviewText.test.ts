import SliType from "../../../Types/ServiceLevelObjective/SliType";
import SloMultiMonitorMode from "../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import {
  getSliTypeText,
  getSloAtRiskText,
  getSloDowntimeStatusesText,
  getSloHeadline,
  getSloMonitorCountText,
  getSloMultiMonitorModeText,
  getSloTargetText,
  getSloWindowPhrase,
  getSloWindowText,
  SloHeadlineData,
} from "../../../Utils/Slo/SloOverviewText";
import { describe, expect, test } from "@jest/globals";

describe("getSloWindowText", () => {
  test("rolling windows name their length", () => {
    expect(
      getSloWindowText({ windowType: SloWindowType.Rolling, windowDays: 30 }),
    ).toBe("Rolling 30 days");
    expect(getSloWindowText({ windowDays: 1 })).toBe("Rolling 1 day");
  });

  test("a missing or unusable length reads as the 30-day default", () => {
    expect(getSloWindowText({ windowDays: null })).toBe("Rolling 30 days");
    expect(getSloWindowText({ windowDays: 0 })).toBe("Rolling 30 days");
    expect(getSloWindowText({ windowDays: NaN })).toBe("Rolling 30 days");
  });

  test("calendar months name their timezone, defaulting to UTC", () => {
    expect(
      getSloWindowText({
        windowType: SloWindowType.CalendarMonth,
        timezone: "Europe/Berlin",
      }),
    ).toBe("Calendar month (Europe/Berlin)");
    expect(getSloWindowText({ windowType: SloWindowType.CalendarMonth })).toBe(
      "Calendar month (UTC)",
    );
  });

  test("a calendar month ignores a stale windowDays", () => {
    expect(
      getSloWindowText({
        windowType: SloWindowType.CalendarMonth,
        windowDays: 7,
        timezone: "UTC",
      }),
    ).toBe("Calendar month (UTC)");
  });
});

describe("getSloWindowPhrase", () => {
  test("completes a sentence", () => {
    expect(getSloWindowPhrase({ windowDays: 7 })).toBe("the last 7 days");
    expect(getSloWindowPhrase({ windowDays: 1 })).toBe("the last 1 day");
    expect(
      getSloWindowPhrase({
        windowType: SloWindowType.CalendarMonth,
        timezone: null,
      }),
    ).toBe("this calendar month (UTC)");
  });
});

describe("getSloTargetText", () => {
  test("formats to three decimals without trailing zeros", () => {
    expect(getSloTargetText(99.9)).toBe("Target 99.9%");
    expect(getSloTargetText(99.95)).toBe("Target 99.95%");
    expect(getSloTargetText(99)).toBe("Target 99%");
  });

  test("is null when unknown", () => {
    expect(getSloTargetText(null)).toBeNull();
    expect(getSloTargetText(undefined)).toBeNull();
  });
});

describe("getSloMonitorCountText", () => {
  test.each([
    [0, "No monitors"],
    [-1, "No monitors"],
    [NaN, "No monitors"],
    [1, "1 monitor"],
    [12, "12 monitors"],
  ])("%p reads %p", (count: number, text: string) => {
    expect(getSloMonitorCountText(count)).toBe(text);
  });
});

describe("getSloAtRiskText", () => {
  test("uses the SLO's own threshold", () => {
    expect(getSloAtRiskText(25)).toBe(
      "When 25% or less of the error budget is left",
    );
  });

  test("falls back to the 20% column default", () => {
    expect(getSloAtRiskText(null)).toBe(
      "When 20% or less of the error budget is left",
    );
  });
});

describe("getSloDowntimeStatusesText", () => {
  test("names the rule the worker falls back to when the list is empty", () => {
    expect(getSloDowntimeStatusesText([])).toBe("Every non-operational status");
    expect(getSloDowntimeStatusesText([null, "  ", undefined])).toBe(
      "Every non-operational status",
    );
  });

  test("lists trimmed names, skipping blanks", () => {
    expect(
      getSloDowntimeStatusesText(["Offline", " Degraded ", null, ""]),
    ).toBe("Offline, Degraded");
  });
});

describe("getSloMultiMonitorModeText", () => {
  test("says what Any Monitor Down does", () => {
    expect(getSloMultiMonitorModeText(SloMultiMonitorMode.AnyDown).title).toBe(
      "Down when any monitor is down",
    );
  });

  test("says what Monitor Seconds Average does", () => {
    expect(
      getSloMultiMonitorModeText(SloMultiMonitorMode.MonitorSecondsAverage)
        .title,
    ).toBe("Averaged across monitors");
  });

  test("a missing mode reads as the Any Monitor Down default, never as raw enum text", () => {
    expect(getSloMultiMonitorModeText(null)).toEqual(
      getSloMultiMonitorModeText(SloMultiMonitorMode.AnyDown),
    );

    for (const mode of Object.values(SloMultiMonitorMode)) {
      expect(getSloMultiMonitorModeText(mode).title).not.toBe(mode);
    }
  });
});

describe("getSliTypeText", () => {
  test("names the indicator", () => {
    expect(getSliTypeText(SliType.MonitorUptime)).toBe("Monitor uptime");
    expect(getSliTypeText(SliType.Metric)).toBe("Metric");
    expect(getSliTypeText(null)).toBe("Monitor uptime");
  });
});

describe("getSloHeadline", () => {
  const evaluated: SloHeadlineData = {
    isEnabled: true,
    isArchived: false,
    sloStatus: SloStatus.Healthy,
    lastEvaluatedAt: "2026-09-15T11:58:00.000Z",
    monitorCount: 3,
  };

  test.each([
    [SloStatus.Healthy, "Within error budget"],
    [SloStatus.AtRisk, "Error budget running low"],
    [SloStatus.BudgetExhausted, "Error budget exhausted"],
    [SloStatus.Misconfigured, "Cannot be evaluated"],
    [SloStatus.Paused, "Measurement paused"],
  ])("%s reads %p", (status: SloStatus, headline: string) => {
    expect(getSloHeadline({ ...evaluated, sloStatus: status })).toBe(headline);
  });

  test("archived beats everything, including a stale healthy status", () => {
    expect(
      getSloHeadline({ ...evaluated, isArchived: true, isEnabled: false }),
    ).toBe("Archived — not being measured");
  });

  test("disabled beats the last status the worker wrote", () => {
    expect(
      getSloHeadline({
        ...evaluated,
        isEnabled: false,
        sloStatus: SloStatus.BudgetExhausted,
      }),
    ).toBe("Disabled — not being measured");
  });

  test("a guard status is named even before a budget exists", () => {
    expect(
      getSloHeadline({
        ...evaluated,
        sloStatus: SloStatus.Misconfigured,
        lastEvaluatedAt: null,
      }),
    ).toBe("Cannot be evaluated");
  });

  test("before the first evaluation it says what the SLO is waiting for", () => {
    expect(
      getSloHeadline({
        ...evaluated,
        sloStatus: null,
        lastEvaluatedAt: null,
        monitorCount: 0,
      }),
    ).toBe("Waiting for monitors");

    expect(
      getSloHeadline({
        ...evaluated,
        sloStatus: null,
        lastEvaluatedAt: null,
        monitorCount: 2,
      }),
    ).toBe("Waiting for the first evaluation");
  });

  test("an evaluation stamp without a status is still waiting, never 'healthy'", () => {
    expect(getSloHeadline({ ...evaluated, sloStatus: undefined })).toBe(
      "Waiting for the first evaluation",
    );
  });
});
