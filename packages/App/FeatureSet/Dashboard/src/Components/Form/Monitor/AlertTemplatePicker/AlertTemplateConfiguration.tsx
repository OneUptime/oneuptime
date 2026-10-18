import React, { FunctionComponent, ReactElement } from "react";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import RollingTimePicker from "Common/UI/Components/RollingTimePicker/RollingTimePicker";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  ALERT_TEMPLATE_CONFIGURATION_TITLE,
  ALERT_TEMPLATE_TIME_RANGE,
  AlertTemplatePickerTemplate,
} from "./AlertTemplateGroups";

/*
 * Under Quick Setup's list once a template is picked: the picked template's
 * full description - how it works, the metric it reads, its caveats - and
 * the one thing left to choose, the Time Range. The template has already
 * filled in the metric, the thresholds and the criteria below.
 */

export interface ComponentProps {
  template: AlertTemplatePickerTemplate;
  rollingTime: RollingTime | undefined;
  onRollingTimeChange: (rollingTime: RollingTime) => void;
}

const AlertTemplateConfiguration: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4"
      data-testid="alert-template-configuration"
    >
      <h4 className="text-sm font-semibold text-gray-900">
        {translator.translateText(ALERT_TEMPLATE_CONFIGURATION_TITLE)}
      </h4>
      <p
        className="mt-2 text-sm font-medium text-gray-900"
        data-testid="alert-template-configuration-name"
      >
        {props.template.name}
      </p>
      <p
        className="mt-0.5 text-sm text-gray-600"
        data-testid="alert-template-description"
      >
        {props.template.description}
      </p>

      <div className="mt-4">
        <FieldLabelElement title={ALERT_TEMPLATE_TIME_RANGE} required={true} />
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
    </div>
  );
};

export default AlertTemplateConfiguration;
