import PageComponentProps from "../../PageComponentProps";
import { INCIDENT_NEXT_NUMBERS } from "../../../Components/NextNumber/NextNumberSettings";
import NumberingCards from "../../../Components/NextNumber/NumberingCards";
import { INCIDENT_NUMBER_PREFIXES } from "../../../Components/NumberPrefix/NumberPrefixSettings";
import React, { FunctionComponent, ReactElement } from "react";

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
    <NumberingCards
      prefixes={INCIDENT_NUMBER_PREFIXES}
      nextNumbers={INCIDENT_NEXT_NUMBERS}
    />
  );
};

export default IncidentNumbering;
