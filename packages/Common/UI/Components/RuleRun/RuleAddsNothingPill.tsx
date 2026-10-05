import { Yellow } from "../../../Types/BrandColors";
import Pill from "../Pill/Pill";
import {
  RULE_ADDS_NOTHING_TEXT,
  RULE_ADDS_NOTHING_TOOLTIP,
} from "./RuleAction";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "Adds nothing": a label or owner rule that matches and adds nothing - one
 * saved before the form asked what it adds (RuleAction). Drawn beside the
 * rule's status in its table (RuleTable) and on the rule's own page
 * (RuleView), with what to do about it in its tooltip.
 */
export const RULE_ADDS_NOTHING_TEST_ID: string = "rule-adds-nothing";

const RuleAddsNothingPill: FunctionComponent = (): ReactElement => {
  return (
    <span data-testid={RULE_ADDS_NOTHING_TEST_ID}>
      <Pill
        color={Yellow}
        text={RULE_ADDS_NOTHING_TEXT}
        tooltip={RULE_ADDS_NOTHING_TOOLTIP}
      />
    </span>
  );
};

export default RuleAddsNothingPill;
