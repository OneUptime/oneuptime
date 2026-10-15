import PageComponentProps from "../../PageComponentProps";
import NextNumberCard from "../../../Components/NextNumber/NextNumberCard";
import { INCIDENT_NEXT_NUMBERS } from "../../../Components/NextNumber/NextNumberSettings";
import NumberPrefixCard from "../../../Components/NumberPrefix/NumberPrefixCard";
import { INCIDENT_NUMBER_PREFIXES } from "../../../Components/NumberPrefix/NumberPrefixSettings";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

export type ComponentProps = PageComponentProps;

/*
 * Incidents → Settings → Numbering: how incident and incident episode numbers
 * look - the text in front of them (INC-42, IE-42) - and the number each
 * gives next, which a project moving from another tool can set to carry on
 * after that tool's numbers. It began as More Settings, then Number Prefix,
 * whose old addresses still forward here.
 */
const IncidentNumbering: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <NumberPrefixCard page={INCIDENT_NUMBER_PREFIXES} />
      <NextNumberCard page={INCIDENT_NEXT_NUMBERS} />
    </Fragment>
  );
};

export default IncidentNumbering;
