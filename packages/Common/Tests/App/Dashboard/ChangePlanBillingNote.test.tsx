import "@testing-library/jest-dom";
import { afterEach, describe, expect, it } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import ChangePlanBillingNote from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/ChangePlanBillingNote";
import {
  CHANGE_PLAN_BILLING_NOTE_TEST_ID,
  ChangePlanBillingCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/ChangePlanBilling";
import OneUptimeDate from "../../../Types/Date";

/*
 * The note under the plans in the Change Plan picker (Dashboard
 * Components/Billing/ChangePlanBillingNote): the trial the change keeps,
 * and when it ends - or that changing plan starts no trial, and what is
 * billed straight away.
 */

type DaysFromNowFunction = (days: number) => Date;

// getSomeDaysAfter goes through PositiveNumber, so it cannot count backwards.
const daysFromNow: DaysFromNowFunction = (days: number): Date => {
  return OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), days);
};

type NoteTextFunction = () => string;

const noteText: NoteTextFunction = (): string => {
  return screen.getByTestId(CHANGE_PLAN_BILLING_NOTE_TEST_ID)
    .textContent as string;
};

afterEach(() => {
  cleanup();
});

describe("a project with no running trial", () => {
  it("says changing plan does not start a free trial, and what is billed when", () => {
    // The reported case: a project created on Free, so no trial at all.
    render(<ChangePlanBillingNote trialEndsAt={null} />);

    expect(noteText()).toContain(ChangePlanBillingCopy.noTrialTitle);
    expect(noteText()).toContain(ChangePlanBillingCopy.noTrialDescription);
    expect(noteText()).not.toContain("runs until");
  });

  it("says the same once the trial has ended", () => {
    render(<ChangePlanBillingNote trialEndsAt={daysFromNow(-3)} />);

    expect(noteText()).toContain(ChangePlanBillingCopy.noTrialTitle);
    expect(noteText()).not.toContain(ChangePlanBillingCopy.trialTitle);
  });

  it("warns rather than informs: money moves as soon as the plan does", () => {
    render(<ChangePlanBillingNote trialEndsAt={undefined} />);

    expect(
      screen.getByTestId(CHANGE_PLAN_BILLING_NOTE_TEST_ID).className,
    ).toContain("amber");
  });
});

describe("a project still on its trial", () => {
  it("says the trial carries over and when it ends", () => {
    const trialEndsAt: Date = daysFromNow(9);

    render(<ChangePlanBillingNote trialEndsAt={trialEndsAt} />);

    expect(noteText()).toContain(ChangePlanBillingCopy.trialTitle);
    expect(noteText()).toContain(
      `Your free trial runs until ${OneUptimeDate.getDateAsLocalFormattedString(
        trialEndsAt,
        true,
      )} on whichever plan you choose. Billing starts when it ends.`,
    );
    expect(noteText()).not.toContain(ChangePlanBillingCopy.noTrialTitle);
  });

  it("reads a trial end that arrives as a string", () => {
    const trialEndsAt: Date = daysFromNow(2);

    render(<ChangePlanBillingNote trialEndsAt={trialEndsAt.toISOString()} />);

    expect(noteText()).toContain(
      OneUptimeDate.getDateAsLocalFormattedString(trialEndsAt, true),
    );
  });

  it("is informational: nothing is billed until the trial ends", () => {
    render(<ChangePlanBillingNote trialEndsAt={daysFromNow(9)} />);

    expect(
      screen.getByTestId(CHANGE_PLAN_BILLING_NOTE_TEST_ID).className,
    ).toContain("blue");
  });
});
