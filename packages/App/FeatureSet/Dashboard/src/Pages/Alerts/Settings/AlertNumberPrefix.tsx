import PageComponentProps from "../../PageComponentProps";
import NumberPrefixCard from "../../../Components/NumberPrefix/NumberPrefixCard";
import { ALERT_NUMBER_PREFIXES } from "../../../Components/NumberPrefix/NumberPrefixSettings";
import React, { FunctionComponent, ReactElement } from "react";

export type ComponentProps = PageComponentProps;

/*
 * Alerts → Settings → Number Prefix: the text in front of alert and alert
 * episode numbers (ALT-42, AE-42). It replaced More Settings, which held
 * nothing else.
 */
const AlertNumberPrefix: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  return <NumberPrefixCard page={ALERT_NUMBER_PREFIXES} />;
};

export default AlertNumberPrefix;
