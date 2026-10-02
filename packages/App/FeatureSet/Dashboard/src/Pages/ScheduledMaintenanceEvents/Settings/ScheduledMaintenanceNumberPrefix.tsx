import PageComponentProps from "../../PageComponentProps";
import NumberPrefixCard from "../../../Components/NumberPrefix/NumberPrefixCard";
import { SCHEDULED_MAINTENANCE_NUMBER_PREFIXES } from "../../../Components/NumberPrefix/NumberPrefixSettings";
import React, { FunctionComponent, ReactElement } from "react";

export type ComponentProps = PageComponentProps;

/*
 * Scheduled Maintenance → Settings → Number Prefix: the text in front of
 * event numbers (SM-42). It replaced More Settings, which held nothing else.
 */
const ScheduledMaintenanceNumberPrefix: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  return <NumberPrefixCard page={SCHEDULED_MAINTENANCE_NUMBER_PREFIXES} />;
};

export default ScheduledMaintenanceNumberPrefix;
