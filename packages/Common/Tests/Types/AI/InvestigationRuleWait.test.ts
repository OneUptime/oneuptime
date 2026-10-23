/*
 * An AI rule's wait (issue #5074; investigation rules were merged into the
 * AI rules, their wait with them): "only if the incident is still open
 * after N minutes" - how a stored wait is read, which waits a rule may
 * save, which wait an incident matching several rules gets, and the wait's
 * end (Types/AI/InvestigationRuleWait).
 */

import {
  DEFAULT_INVESTIGATION_RULE_WAIT_MINUTES,
  INVESTIGATION_RULE_WAIT_COLUMN,
  MAX_INVESTIGATION_RULE_WAIT_MINUTES,
  getInvestigationRuleWaitMinutes,
  getInvestigationRuleWaitProblem,
  getInvestigationWaitMinutes,
  getInvestigationWaitUntil,
  getShortestInvestigationRuleWait,
} from "../../../Types/AI/InvestigationRuleWait";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import { MAX_AI_INVESTIGATION_COOLDOWN_IN_MINUTES } from "../../../Types/AI/AIWorkloadLimits";
import { describe, expect, test } from "@jest/globals";

const DECLARED_AT: Date = new Date("2026-10-20T10:00:00.000Z");

describe("the wait's limits", () => {
  test("a rule may wait at most a day, as long as the re-investigation cooldown", () => {
    expect(MAX_INVESTIGATION_RULE_WAIT_MINUTES).toBe(1440);
    expect(MAX_INVESTIGATION_RULE_WAIT_MINUTES).toBe(
      MAX_AI_INVESTIGATION_COOLDOWN_IN_MINUTES,
    );
  });

  test("a rule's form starts a new wait on ten minutes, inside the limits", () => {
    expect(DEFAULT_INVESTIGATION_RULE_WAIT_MINUTES).toBe(10);
    expect(DEFAULT_INVESTIGATION_RULE_WAIT_MINUTES).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_INVESTIGATION_RULE_WAIT_MINUTES).toBeLessThanOrEqual(
      MAX_INVESTIGATION_RULE_WAIT_MINUTES,
    );
  });

  test("the column the helpers name is the rule's real column", () => {
    expect(INVESTIGATION_RULE_WAIT_COLUMN).toBe("onlyIfOpenAfterMinutes");
    expect(
      new AutoRemediationRule().getTableColumnMetadata(
        INVESTIGATION_RULE_WAIT_COLUMN,
      ),
    ).toBeTruthy();
  });
});

describe("getInvestigationRuleWaitMinutes: a stored wait as whole minutes", () => {
  test.each([
    [undefined, 0],
    [null, 0],
    [0, 0],
    [-5, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    ["", 0],
    ["   ", 0],
    ["ten", 0],
    [{}, 0],
    [[10], 0],
    [true, 0],
  ])("%p is no wait", (value: unknown, expected: number) => {
    expect(getInvestigationRuleWaitMinutes(value)).toBe(expected);
  });

  test.each([
    [1, 1],
    [10, 10],
    [30, 30],
    [1440, 1440],
    ["15", 15],
    [" 45 ", 45],
    [10.9, 10],
  ])("%p waits %p minutes", (value: unknown, expected: number) => {
    expect(getInvestigationRuleWaitMinutes(value)).toBe(expected);
  });

  test("a wait over a day, which only a row written around the server can hold, reads as a day", () => {
    expect(getInvestigationRuleWaitMinutes(1441)).toBe(1440);
    expect(getInvestigationRuleWaitMinutes(100000)).toBe(1440);
  });
});

describe("getInvestigationRuleWaitProblem: which waits a rule may save", () => {
  test.each([[null], [undefined], [0], [1], [10], [1440], ["10"], [" 30 "]])(
    "%p is saved",
    (value: unknown) => {
      expect(getInvestigationRuleWaitProblem(value)).toBeNull();
    },
  );

  test.each([[10.5], ["10.5"], [Number.NaN], ["ten"], [""], [{}], [true]])(
    "%p is refused as not a whole number of minutes",
    (value: unknown) => {
      expect(getInvestigationRuleWaitProblem(value)).toBe(
        "Only If Open After (Minutes) must be a whole number of minutes. Leave it empty to investigate right away.",
      );
    },
  );

  test("a negative wait is refused", () => {
    expect(getInvestigationRuleWaitProblem(-1)).toBe(
      "Only If Open After (Minutes) cannot be negative. Leave it empty to investigate right away.",
    );
  });

  test("a wait longer than a day is refused, saying the limit", () => {
    expect(getInvestigationRuleWaitProblem(1441)).toBe(
      "Only If Open After (Minutes) can be at most 1440 minutes (a day).",
    );
    expect(getInvestigationRuleWaitProblem("2000")).toContain("at most 1440");
  });

  test("the refusals name the column as its title reads in the API docs", () => {
    const title: string | undefined =
      new AutoRemediationRule().getTableColumnMetadata(
        INVESTIGATION_RULE_WAIT_COLUMN,
      )?.title;

    expect(title).toBe("Only If Open After (Minutes)");
    expect(getInvestigationRuleWaitProblem(-1)).toContain(title!);
  });
});

describe("getShortestInvestigationRuleWait: the wait an incident matching several rules gets", () => {
  test("no rule matched-and-waiting: no wait", () => {
    expect(getShortestInvestigationRuleWait([])).toBe(0);
  });

  test("the shortest of the waits decides", () => {
    expect(getShortestInvestigationRuleWait([30, 10, 60])).toBe(10);
  });

  test("one rule that investigates right away means right away, wherever it is", () => {
    expect(getShortestInvestigationRuleWait([30, 0, 10])).toBe(0);
    expect(getShortestInvestigationRuleWait([30, null, 10])).toBe(0);
    expect(getShortestInvestigationRuleWait([undefined])).toBe(0);
  });

  test("a stored wait is read as it would be on its own", () => {
    expect(getShortestInvestigationRuleWait(["45", 120])).toBe(45);
    expect(getShortestInvestigationRuleWait([5000, 2000])).toBe(1440);
  });
});

describe("the wait's end", () => {
  test("is the record's creation plus the wait", () => {
    expect(getInvestigationWaitUntil(DECLARED_AT, 10).toISOString()).toBe(
      "2026-10-20T10:10:00.000Z",
    );
    expect(getInvestigationWaitUntil(DECLARED_AT, 1440).toISOString()).toBe(
      "2026-10-21T10:00:00.000Z",
    );
  });

  test("no wait ends when the record was created", () => {
    expect(getInvestigationWaitUntil(DECLARED_AT, 0).getTime()).toBe(
      DECLARED_AT.getTime(),
    );
  });

  test("reads back as the wait, in whole minutes", () => {
    for (const minutes of [1, 5, 10, 30, 90, 1440]) {
      expect(
        getInvestigationWaitMinutes(
          DECLARED_AT,
          getInvestigationWaitUntil(DECLARED_AT, minutes),
        ),
      ).toBe(minutes);
    }
  });

  test("a time before the creation, or at it, is no wait", () => {
    expect(getInvestigationWaitMinutes(DECLARED_AT, DECLARED_AT)).toBe(0);
    expect(
      getInvestigationWaitMinutes(
        DECLARED_AT,
        new Date(DECLARED_AT.getTime() - 60_000),
      ),
    ).toBe(0);
  });

  test("a time a few seconds off a minute reads as the nearest minute", () => {
    expect(
      getInvestigationWaitMinutes(
        DECLARED_AT,
        new Date(DECLARED_AT.getTime() + 10 * 60_000 + 20_000),
      ),
    ).toBe(10);
  });
});
