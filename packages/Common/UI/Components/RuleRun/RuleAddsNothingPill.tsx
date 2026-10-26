import { Yellow } from "../../../Types/BrandColors";
import ExplainedPill from "../Pill/ExplainedPill";
import {
  RULE_ADDS_NOTHING_TEXT,
  RULE_ADDS_NOTHING_TOOLTIP,
} from "./RuleAction";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "Adds nothing": a label or owner rule that matches and adds nothing - one
 * saved before the form asked what it adds (RuleAction). Drawn beside the
 * rule's status in its table (RuleTable) and on the rule's own page
 * (RuleView). What to do about it is said on hover, on a tap (a phone's
 * card of the table), on keyboard focus and to a screen reader
 * (ExplainedPill) - not under a mouse only.
 */
export const RULE_ADDS_NOTHING_TEST_ID: string = "rule-adds-nothing";

// The pill's own button, inside RULE_ADDS_NOTHING_TEST_ID.
export const RULE_ADDS_NOTHING_BUTTON_TEST_ID: string =
  "rule-adds-nothing-button";

const RuleAddsNothingPill: FunctionComponent = (): ReactElement => {
  return (
    <span data-testid={RULE_ADDS_NOTHING_TEST_ID}>
      <ExplainedPill
        color={Yellow}
        text={RULE_ADDS_NOTHING_TEXT}
        explanation={RULE_ADDS_NOTHING_TOOLTIP}
        dataTestId={RULE_ADDS_NOTHING_BUTTON_TEST_ID}
      />
    </span>
  );
};

export default RuleAddsNothingPill;
