import React, { FunctionComponent, ReactElement } from "react";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import RollingTimePicker from "Common/UI/Components/RollingTimePicker/RollingTimePicker";
import {
  ALERT_TEMPLATE_TIME_RANGE,
  ALERT_TEMPLATE_TIME_RANGE_DESCRIPTION,
} from "./AlertTemplateGroups";

/*
 * What a picked template still asks for, under it once Quick Setup's list
 * has folded into it (AlertTemplatePicker's children): the Time Range. The
 * template has already filled in the metric, the thresholds and the
 * criteria below, and its own window here.
 */

export interface ComponentProps {
  rollingTime: RollingTime | undefined;
  onRollingTimeChange: (rollingTime: RollingTime) => void;
}

const AlertTemplateConfiguration: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div data-testid="alert-template-configuration">
      <FieldLabelElement
        title={ALERT_TEMPLATE_TIME_RANGE}
        description={ALERT_TEMPLATE_TIME_RANGE_DESCRIPTION}
        required={true}
      />
      <RollingTimePicker
        value={props.rollingTime}
        onChange={(value: RollingTime) => {
          if (value === props.rollingTime) {
            return;
          }

          props.onRollingTimeChange(value);
        }}
      />
    </div>
  );
};

export default AlertTemplateConfiguration;
