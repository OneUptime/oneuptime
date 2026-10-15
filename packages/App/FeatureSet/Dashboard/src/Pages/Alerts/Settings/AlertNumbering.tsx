import PageComponentProps from "../../PageComponentProps";
import { ALERT_NEXT_NUMBERS } from "../../../Components/NextNumber/NextNumberSettings";
import NumberingCards from "../../../Components/NextNumber/NumberingCards";
import { ALERT_NUMBER_PREFIXES } from "../../../Components/NumberPrefix/NumberPrefixSettings";
import React, { FunctionComponent, ReactElement } from "react";

export type ComponentProps = PageComponentProps;

/*
 * Alerts → Settings → Numbering: how alert and alert episode numbers look -
 * the text in front of them (ALT-42, AE-42) - and the number each gives
 * next, which a project moving from another tool can set to carry on after
 * that tool's numbers. It began as More Settings, then Number Prefix, whose
 * old addresses still forward here.
 */
const AlertNumbering: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  return (
    <NumberingCards
      prefixes={ALERT_NUMBER_PREFIXES}
      nextNumbers={ALERT_NEXT_NUMBERS}
    />
  );
};

export default AlertNumbering;
