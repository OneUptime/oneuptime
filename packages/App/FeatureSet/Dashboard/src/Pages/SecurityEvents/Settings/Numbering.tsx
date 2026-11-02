import PageComponentProps from "../../PageComponentProps";
import { SECURITY_CASE_NEXT_NUMBERS } from "../../../Components/NextNumber/NextNumberSettings";
import NumberingCards from "../../../Components/NextNumber/NumberingCards";
import { SECURITY_CASE_NUMBER_PREFIXES } from "../../../Components/NumberPrefix/NumberPrefixSettings";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Security Events > Settings > Numbering: how case numbers look - the text
 * in front of them, CASE- in CASE-42 unless the project chooses its own -
 * and the number the next case gets, which a team moving from another tool
 * sets to carry on after that tool's case numbers. The same two cards the
 * Incidents', Alerts' and Scheduled Maintenance's Numbering pages have
 * (NumberingCards).
 */
const SecurityCaseNumberingPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return (
    <NumberingCards
      prefixes={SECURITY_CASE_NUMBER_PREFIXES}
      nextNumbers={SECURITY_CASE_NEXT_NUMBERS}
    />
  );
};

export default SecurityCaseNumberingPage;
