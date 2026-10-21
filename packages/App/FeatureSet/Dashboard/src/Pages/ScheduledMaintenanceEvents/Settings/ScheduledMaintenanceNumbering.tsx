import PageComponentProps from "../../PageComponentProps";
import { SCHEDULED_MAINTENANCE_NEXT_NUMBERS } from "../../../Components/NextNumber/NextNumberSettings";
import NumberingCards from "../../../Components/NextNumber/NumberingCards";
import { SCHEDULED_MAINTENANCE_NUMBER_PREFIXES } from "../../../Components/NumberPrefix/NumberPrefixSettings";
import React, { FunctionComponent, ReactElement } from "react";

export type ComponentProps = PageComponentProps;

/*
 * Scheduled Maintenance → Settings → Numbering: how event numbers look - the
 * text in front of them (SM-42) - and the number the next event gets, which
 * a project moving from another tool can set to carry on after that tool's
 * numbers. It began as More Settings, then Number Prefix, whose old
 * addresses still forward here.
 */
const ScheduledMaintenanceNumbering: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  return (
    <NumberingCards
      prefixes={SCHEDULED_MAINTENANCE_NUMBER_PREFIXES}
      nextNumbers={SCHEDULED_MAINTENANCE_NEXT_NUMBERS}
    />
  );
};

export default ScheduledMaintenanceNumbering;
