import PageComponentProps from "../../PageComponentProps";
import NumberPrefixCard from "../../../Components/NumberPrefix/NumberPrefixCard";
import { INCIDENT_NUMBER_PREFIXES } from "../../../Components/NumberPrefix/NumberPrefixSettings";
import React, { FunctionComponent, ReactElement } from "react";

export type ComponentProps = PageComponentProps;

/*
 * Incidents → Settings → Number Prefix: the text in front of incident and
 * incident episode numbers (INC-42, IE-42). It replaced More Settings, which
 * held nothing else by then.
 */
const IncidentNumberPrefix: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  return <NumberPrefixCard page={INCIDENT_NUMBER_PREFIXES} />;
};

export default IncidentNumberPrefix;
