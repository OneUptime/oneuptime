import RecordConditionPicker, {
  MONITOR_CONDITION_QUERY,
  RECORD_CONDITION_KINDS,
  RecordConditionKind,
} from "./RecordConditionPicker";
import { NotificationRuleConditionCheckOn } from "Common/Types/Workspace/NotificationRules/NotificationRuleCondition";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "MONITOR IS ANY OF ..." IN A WORKSPACE RULE OR SUMMARY, SEARCHED ON THE
 * SERVER (#10646): the record condition picker for monitors
 * (RecordConditionPicker), which never offers an archived monitor (#7582)
 * and names what the condition holds by its ids.
 */

// Archived monitors are retired: never offered for a new pick.
export { MONITOR_CONDITION_QUERY };

const MONITOR_KIND: RecordConditionKind =
  RECORD_CONDITION_KINDS[NotificationRuleConditionCheckOn.Monitors]!;

export interface ComponentProps {
  ids: Array<string>;
  onChange: (ids: Array<string>) => void;
  id?: string | undefined;
  // In the reader's words already.
  ariaLabel: string;
  ariaDescribedby?: string | undefined;
}

const MonitorConditionPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return <RecordConditionPicker {...props} kind={MONITOR_KIND} />;
};

export default MonitorConditionPicker;
