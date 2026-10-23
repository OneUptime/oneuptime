import { describe, expect, test } from "@jest/globals";
import {
  INVESTIGATION_RULE_MAX_WAIT_MINUTES,
  INVESTIGATION_RULE_RIGHT_AWAY,
  INVESTIGATION_RULE_TIMING_COPY,
  INVESTIGATION_RULE_TIMING_FIELD_KEY,
  INVESTIGATION_RULE_TIMING_FIELD_TITLE,
  INVESTIGATION_RULE_TIMINGS,
  INVESTIGATION_RULE_WAIT_FIELD,
  INVESTIGATION_RULE_WAIT_FIELD_DESCRIPTION,
  INVESTIGATION_RULE_WAIT_FIELD_TITLE,
  INVESTIGATION_RULE_WAIT_NOT_WHOLE,
  InvestigationRuleTiming,
  describeInvestigationRuleTiming,
  getInvestigationRuleTiming,
  getValuesForInvestigationRuleTiming,
  isInvestigationRuleTiming,
  isWaitChosen,
  validateInvestigationRuleWait,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/InvestigationRuleTiming";
import { AiLane } from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import {
  DEFAULT_INVESTIGATION_RULE_WAIT_MINUTES,
  MAX_INVESTIGATION_RULE_WAIT_MINUTES,
} from "../../../Types/AI/InvestigationRuleWait";

/*
 * WHEN AN AI RULE INVESTIGATES (issue #5074): the Investigate step's one
 * question - Right away, or Only if still open after a wait - and the
 * minutes the second one asks, written into the rule's one column
 * (onlyIfOpenAfterMinutes) the API and Terraform read. Investigation rules
 * are AI rules now: the column moved with them. React-free, read here
 * without the page.
 */

const WAIT: string = INVESTIGATION_RULE_WAIT_FIELD;
const CHOICE: string = INVESTIGATION_RULE_TIMING_FIELD_KEY;

describe("the choice and its words", () => {
  test("right away comes first: the default, and what every rule did before rules could wait", () => {
    expect(INVESTIGATION_RULE_TIMINGS).toEqual([
      InvestigationRuleTiming.RightAway,
      InvestigationRuleTiming.AfterWait,
    ]);
  });

  test("the choice is a form value of its own, never a column; the minutes are the rule's column", () => {
    expect(CHOICE).toBe("investigationTiming");
    expect(
      new AutoRemediationRule().getTableColumnMetadata(CHOICE),
    ).toBeFalsy();
    expect(WAIT).toBe("onlyIfOpenAfterMinutes");
    expect(new AutoRemediationRule().getTableColumnMetadata(WAIT)).toBeTruthy();
  });

  test.each([
    [
      AiLane.Incident,
      "OneUptime AI starts as soon as the incident is declared.",
      "Incidents resolved during the wait are not investigated.",
    ],
    [
      AiLane.Alert,
      "OneUptime AI starts as soon as the alert is created.",
      "Alerts resolved during the wait are not investigated.",
    ],
  ])(
    "%s rules say what each answer does",
    (lane: AiLane, rightAway: string, afterWait: string) => {
      expect(INVESTIGATION_RULE_TIMING_COPY[lane]).toEqual({
        [InvestigationRuleTiming.RightAway]: {
          title: "Right away",
          description: rightAway,
        },
        [InvestigationRuleTiming.AfterWait]: {
          title: "Only if still open after a wait",
          description: afterWait,
        },
      });
    },
  );

  test("the field titles and the minutes' help", () => {
    expect(INVESTIGATION_RULE_TIMING_FIELD_TITLE).toBe("When to investigate");
    expect(INVESTIGATION_RULE_WAIT_FIELD_TITLE).toBe("Wait (Minutes)");
    expect(INVESTIGATION_RULE_RIGHT_AWAY).toBe("Right away");
    expect(INVESTIGATION_RULE_WAIT_FIELD_DESCRIPTION[AiLane.Incident]).toBe(
      "Counted from when the incident is declared. When several rules match, the shortest wait decides. At most 1440 (a day).",
    );
    expect(INVESTIGATION_RULE_WAIT_FIELD_DESCRIPTION[AiLane.Alert]).toBe(
      "Counted from when the alert is created. When several rules match, the shortest wait decides. At most 1440 (a day).",
    );
  });

  test("the limits the form names are the server's", () => {
    expect(INVESTIGATION_RULE_MAX_WAIT_MINUTES).toBe(
      MAX_INVESTIGATION_RULE_WAIT_MINUTES,
    );
    expect(INVESTIGATION_RULE_WAIT_NOT_WHOLE).toContain(
      `from 1 to ${MAX_INVESTIGATION_RULE_WAIT_MINUTES}`,
    );
    for (const lane of [AiLane.Incident, AiLane.Alert]) {
      expect(INVESTIGATION_RULE_WAIT_FIELD_DESCRIPTION[lane]).toContain(
        `At most ${MAX_INVESTIGATION_RULE_WAIT_MINUTES}`,
      );
    }
  });

  test("a field's help fits the 150 characters the forms allow", () => {
    for (const lane of [AiLane.Incident, AiLane.Alert]) {
      expect(
        INVESTIGATION_RULE_WAIT_FIELD_DESCRIPTION[lane].length,
      ).toBeLessThanOrEqual(150);

      for (const timing of INVESTIGATION_RULE_TIMINGS) {
        expect(
          INVESTIGATION_RULE_TIMING_COPY[lane][timing].description.length,
        ).toBeLessThanOrEqual(150);
      }
    }
  });
});

describe("isInvestigationRuleTiming", () => {
  test("only the two answers", () => {
    expect(isInvestigationRuleTiming("right-away")).toBe(true);
    expect(isInvestigationRuleTiming("after-wait")).toBe(true);
    expect(isInvestigationRuleTiming("later")).toBe(false);
    expect(isInvestigationRuleTiming(undefined)).toBe(false);
    expect(isInvestigationRuleTiming(10)).toBe(false);
  });
});

describe("getInvestigationRuleTiming: the answer a rule's wait makes", () => {
  test.each([
    [{}, InvestigationRuleTiming.RightAway],
    [null, InvestigationRuleTiming.RightAway],
    [{ [WAIT]: null }, InvestigationRuleTiming.RightAway],
    [{ [WAIT]: 0 }, InvestigationRuleTiming.RightAway],
    [{ [WAIT]: "" }, InvestigationRuleTiming.RightAway],
    [{ [WAIT]: 1 }, InvestigationRuleTiming.AfterWait],
    [{ [WAIT]: 30 }, InvestigationRuleTiming.AfterWait],
    [{ [WAIT]: "45" }, InvestigationRuleTiming.AfterWait],
  ])("%p reads as %s", (values: unknown, expected: InvestigationRuleTiming) => {
    expect(getInvestigationRuleTiming(values)).toBe(expected);
  });
});

describe("isWaitChosen: whether the form asks the minutes", () => {
  test("the answer picked decides", () => {
    expect(
      isWaitChosen({
        [CHOICE]: InvestigationRuleTiming.AfterWait,
        [WAIT]: null,
      }),
    ).toBe(true);
    expect(
      isWaitChosen({ [CHOICE]: InvestigationRuleTiming.RightAway, [WAIT]: 30 }),
    ).toBe(false);
  });

  test("before anything is picked, the rule's wait decides: a rule that waits opens on its minutes", () => {
    expect(isWaitChosen({ [WAIT]: 30 })).toBe(true);
    expect(isWaitChosen({})).toBe(false);
    expect(isWaitChosen({ [CHOICE]: "garbage", [WAIT]: 30 })).toBe(true);
  });
});

describe("getValuesForInvestigationRuleTiming: what a pick writes", () => {
  test("a wait starts on the default minutes", () => {
    expect(
      getValuesForInvestigationRuleTiming({
        values: { name: "Prod" },
        timing: InvestigationRuleTiming.AfterWait,
      }),
    ).toEqual({
      name: "Prod",
      [CHOICE]: InvestigationRuleTiming.AfterWait,
      [WAIT]: DEFAULT_INVESTIGATION_RULE_WAIT_MINUTES,
    });
  });

  test("a wait keeps the minutes already there", () => {
    expect(
      getValuesForInvestigationRuleTiming({
        values: { [WAIT]: 45 },
        timing: InvestigationRuleTiming.AfterWait,
      }),
    ).toEqual({ [CHOICE]: InvestigationRuleTiming.AfterWait, [WAIT]: 45 });
  });

  test("right away clears the wait with null, so an edit clears what a rule stored", () => {
    expect(
      getValuesForInvestigationRuleTiming({
        values: { name: "Prod", [WAIT]: 45 },
        timing: InvestigationRuleTiming.RightAway,
      }),
    ).toEqual({
      name: "Prod",
      [CHOICE]: InvestigationRuleTiming.RightAway,
      [WAIT]: null,
    });
  });

  test("everything else in the form is kept as it was", () => {
    const values: Record<string, unknown> = {
      name: "Critical incidents",
      monitors: [{ value: "m-1" }],
      description: "Escalation waits 10 minutes",
    };

    expect(
      getValuesForInvestigationRuleTiming({
        values,
        timing: InvestigationRuleTiming.AfterWait,
      }),
    ).toMatchObject(values);
  });
});

describe("validateInvestigationRuleWait", () => {
  const afterWait: Record<string, unknown> = {
    [CHOICE]: InvestigationRuleTiming.AfterWait,
  };

  test.each([[1], [10], [1440], ["10"], [" 15 "]])(
    "%p minutes is a wait",
    (value: unknown) => {
      expect(
        validateInvestigationRuleWait({ ...afterWait, [WAIT]: value }),
      ).toBeNull();
    },
  );

  test.each([
    [null],
    [undefined],
    [""],
    [0],
    ["0"],
    [1441],
    [10.5],
    ["-1"],
    ["x"],
  ])("%p is refused while a wait is chosen", (value: unknown) => {
    expect(validateInvestigationRuleWait({ ...afterWait, [WAIT]: value })).toBe(
      "Enter a whole number of minutes, from 1 to 1440.",
    );
  });

  test("right away asks nothing of the minutes", () => {
    expect(
      validateInvestigationRuleWait({
        [CHOICE]: InvestigationRuleTiming.RightAway,
        [WAIT]: "nonsense",
      }),
    ).toBeNull();
  });
});

describe("describeInvestigationRuleTiming: what the rules table says", () => {
  test.each([
    [undefined, "Right away"],
    [null, "Right away"],
    [0, "Right away"],
    [1, "If still open after 1 minute"],
    [10, "If still open after 10 minutes"],
    // A count is written the reader's way, as every plural is.
    [1440, "If still open after 1,440 minutes"],
  ])("%p reads %p", (minutes: unknown, expected: string) => {
    expect(describeInvestigationRuleTiming(minutes)).toBe(expected);
  });
});
