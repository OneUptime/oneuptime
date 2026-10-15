import PageComponentProps from "../../PageComponentProps";
import NextNumberCard from "../../../Components/NextNumber/NextNumberCard";
import { ALERT_NEXT_NUMBERS } from "../../../Components/NextNumber/NextNumberSettings";
import NumberPrefixCard from "../../../Components/NumberPrefix/NumberPrefixCard";
import { ALERT_NUMBER_PREFIXES } from "../../../Components/NumberPrefix/NumberPrefixSettings";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

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
    <Fragment>
      <NumberPrefixCard page={ALERT_NUMBER_PREFIXES} />
      <NextNumberCard page={ALERT_NEXT_NUMBERS} />
    </Fragment>
  );
};

export default AlertNumbering;
