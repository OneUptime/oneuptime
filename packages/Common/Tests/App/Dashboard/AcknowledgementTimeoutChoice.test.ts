import { describe, expect, test } from "@jest/globals";
import {
  ACKNOWLEDGEMENT_TIMEOUT_CHOICES,
  ACKNOWLEDGEMENT_TIMEOUT_CHOICE_FIELD_KEY,
  ACKNOWLEDGEMENT_TIMEOUT_COLUMN,
  ACKNOWLEDGEMENT_TIMEOUT_DEFAULT_MINUTES,
  ACKNOWLEDGEMENT_TIMEOUT_MAX_MINUTES,
  ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN,
  ACKNOWLEDGEMENT_TIMEOUT_MIN_MINUTES,
  AcknowledgementTimeoutChoice,
  AcknowledgementTimeoutCopy,
  getAcknowledgementTimeoutChoice,
  getAcknowledgementTimeoutChoiceInForm,
  getAcknowledgementTimeoutMinutes,
  getValuesForAcknowledgementTimeoutChoice,
  isAcknowledgementTimeoutChoice,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/AcknowledgementTimeout/AcknowledgementTimeout";
import {
  DEFAULT_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES,
  MAX_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES,
  MIN_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES,
  ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN,
} from "../../../Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";

/*
 * THE ACKNOWLEDGEMENT TIMEOUT'S ONE CHOICE, AS THE DASHBOARD READS AND
 * WRITES IT (AcknowledgementTimeout.ts).
 *
 * Don't page again, or page again - and only then after how many minutes.
 * Both answers write the one column; what a stored policy reads as is what
 * the worker does with it.
 */

const ONE_DIGIT: RegExp = /\d+/g;

describe("the answers", () => {
  test("are two, Don't page again first: what every policy does at first", () => {
    expect(ACKNOWLEDGEMENT_TIMEOUT_CHOICES).toEqual([
      AcknowledgementTimeoutChoice.Off,
      AcknowledgementTimeoutChoice.PageAgain,
    ]);
    expect(isAcknowledgementTimeoutChoice("off")).toBe(true);
    expect(isAcknowledgementTimeoutChoice("page-again")).toBe(true);
    expect(isAcknowledgementTimeoutChoice("start-again")).toBe(false);
    expect(isAcknowledgementTimeoutChoice(undefined)).toBe(false);
  });

  test("write the policy's own column", () => {
    expect(ACKNOWLEDGEMENT_TIMEOUT_COLUMN).toBe(
      "acknowledgementTimeoutInMinutes",
    );
    expect(
      new OnCallDutyPolicy().getTableColumnMetadata(
        ACKNOWLEDGEMENT_TIMEOUT_COLUMN,
      ),
    ).toBeDefined();
  });

  test("the choice is a form value of its own, never a column", () => {
    expect(
      new OnCallDutyPolicy().getTableColumns().columns,
    ).not.toContain(ACKNOWLEDGEMENT_TIMEOUT_CHOICE_FIELD_KEY);
  });
});

describe("what a stored policy reads as", () => {
  test("empty, or nothing that is minutes: Don't page again", () => {
    for (const value of [undefined, null, 0, -5, "", "x"]) {
      expect({
        value,
        choice: getAcknowledgementTimeoutChoice({
          acknowledgementTimeoutInMinutes: value,
        }),
        minutes: getAcknowledgementTimeoutMinutes({
          acknowledgementTimeoutInMinutes: value,
        }),
      }).toEqual({
        value,
        choice: AcknowledgementTimeoutChoice.Off,
        minutes: null,
      });
    }

    expect(getAcknowledgementTimeoutChoice(null)).toBe(
      AcknowledgementTimeoutChoice.Off,
    );
    expect(getAcknowledgementTimeoutChoice("not a policy")).toBe(
      AcknowledgementTimeoutChoice.Off,
    );
  });

  test("minutes: Page again, after them", () => {
    expect(
      getAcknowledgementTimeoutChoice({ acknowledgementTimeoutInMinutes: 30 }),
    ).toBe(AcknowledgementTimeoutChoice.PageAgain);
    expect(
      getAcknowledgementTimeoutMinutes({ acknowledgementTimeoutInMinutes: 90 }),
    ).toBe(90);
  });
});

describe("what the form shows", () => {
  test("the answer picked in it, once one is", () => {
    expect(
      getAcknowledgementTimeoutChoiceInForm({
        [ACKNOWLEDGEMENT_TIMEOUT_CHOICE_FIELD_KEY]:
          AcknowledgementTimeoutChoice.PageAgain,
        // An emptied box would read as Don't page again.
        acknowledgementTimeoutInMinutes: "",
      }),
    ).toBe(AcknowledgementTimeoutChoice.PageAgain);
  });

  test("otherwise the stored policy's", () => {
    expect(
      getAcknowledgementTimeoutChoiceInForm({
        acknowledgementTimeoutInMinutes: 15,
      }),
    ).toBe(AcknowledgementTimeoutChoice.PageAgain);
    expect(getAcknowledgementTimeoutChoiceInForm({})).toBe(
      AcknowledgementTimeoutChoice.Off,
    );
  });
});

describe("what an answer writes", () => {
  test("Page again: the minutes the policy pages again after now", () => {
    expect(
      getValuesForAcknowledgementTimeoutChoice({
        values: { name: "Payments", acknowledgementTimeoutInMinutes: 45 },
        choice: AcknowledgementTimeoutChoice.PageAgain,
      }),
    ).toEqual({
      name: "Payments",
      acknowledgementTimeoutInMinutes: 45,
      [ACKNOWLEDGEMENT_TIMEOUT_CHOICE_FIELD_KEY]:
        AcknowledgementTimeoutChoice.PageAgain,
    });
  });

  test("Page again on a policy that does not: 30 minutes", () => {
    expect(
      getValuesForAcknowledgementTimeoutChoice({
        values: { acknowledgementTimeoutInMinutes: null },
        choice: AcknowledgementTimeoutChoice.PageAgain,
      })[ACKNOWLEDGEMENT_TIMEOUT_COLUMN],
    ).toBe(30);
  });

  test("Don't page again: empty, whatever it was", () => {
    expect(
      getValuesForAcknowledgementTimeoutChoice({
        values: { acknowledgementTimeoutInMinutes: 45 },
        choice: AcknowledgementTimeoutChoice.Off,
      }),
    ).toEqual({
      acknowledgementTimeoutInMinutes: null,
      [ACKNOWLEDGEMENT_TIMEOUT_CHOICE_FIELD_KEY]:
        AcknowledgementTimeoutChoice.Off,
    });
  });
});

describe("the numbers the card goes by are the rule's", () => {
  test("30 to start with, 5 to 1440, at most 5 times", () => {
    expect(ACKNOWLEDGEMENT_TIMEOUT_DEFAULT_MINUTES).toBe(
      DEFAULT_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES,
    );
    expect(ACKNOWLEDGEMENT_TIMEOUT_MIN_MINUTES).toBe(
      MIN_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES,
    );
    expect(ACKNOWLEDGEMENT_TIMEOUT_MAX_MINUTES).toBe(
      MAX_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES,
    );
    expect(ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN).toBe(
      ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN,
    );
  });

  test("the minutes' help says the same cap the worker keeps", () => {
    const numbers: Array<string> =
      AcknowledgementTimeoutCopy.minutesDescription.match(ONE_DIGIT) || [];

    expect(numbers).toEqual([String(ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN)]);
  });
});

describe("the words", () => {
  test("are short: a card's description, a field's, a choice's", () => {
    expect(AcknowledgementTimeoutCopy.cardDescription.length).toBeLessThanOrEqual(
      210,
    );

    for (const text of [
      AcknowledgementTimeoutCopy.minutesDescription,
      AcknowledgementTimeoutCopy.choices[AcknowledgementTimeoutChoice.Off]
        .description,
      AcknowledgementTimeoutCopy.choices[AcknowledgementTimeoutChoice.PageAgain]
        .description,
    ]) {
      expect(text.length).toBeLessThanOrEqual(150);
    }
  });

  test("never name the setting's column or say 'timeout' where a plain word does", () => {
    for (const text of [
      AcknowledgementTimeoutCopy.cardDescription,
      AcknowledgementTimeoutCopy.fieldTitle,
      AcknowledgementTimeoutCopy.rowTitle,
      AcknowledgementTimeoutCopy.minutesTitle,
      AcknowledgementTimeoutCopy.choices[AcknowledgementTimeoutChoice.Off].title,
      AcknowledgementTimeoutCopy.choices[AcknowledgementTimeoutChoice.PageAgain]
        .title,
    ]) {
      expect(text).not.toContain("acknowledgementTimeoutInMinutes");
      expect(text.toLowerCase()).not.toContain("timeout");
    }
  });
});
