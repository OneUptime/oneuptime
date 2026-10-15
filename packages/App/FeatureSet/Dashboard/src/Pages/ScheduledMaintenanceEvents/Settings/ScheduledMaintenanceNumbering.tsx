import PageComponentProps from "../../PageComponentProps";
import NextNumberCard from "../../../Components/NextNumber/NextNumberCard";
import { SCHEDULED_MAINTENANCE_NEXT_NUMBERS } from "../../../Components/NextNumber/NextNumberSettings";
import NumberPrefixCard from "../../../Components/NumberPrefix/NumberPrefixCard";
import { SCHEDULED_MAINTENANCE_NUMBER_PREFIXES } from "../../../Components/NumberPrefix/NumberPrefixSettings";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

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
    <Fragment>
      <NumberPrefixCard page={SCHEDULED_MAINTENANCE_NUMBER_PREFIXES} />
      <NextNumberCard page={SCHEDULED_MAINTENANCE_NEXT_NUMBERS} />
    </Fragment>
  );
};

export default ScheduledMaintenanceNumbering;
