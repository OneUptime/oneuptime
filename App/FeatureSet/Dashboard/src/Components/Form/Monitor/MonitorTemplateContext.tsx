import React, {
  createContext,
  FunctionComponent,
  ReactElement,
  useContext,
} from "react";
import FieldLabelElement, {
  ComponentProps as FieldLabelProps,
} from "Common/UI/Components/Forms/Fields/FieldLabel";

export const MonitorTemplateContext: React.Context<boolean> =
  createContext<boolean>(false);

export const TEMPLATE_TARGET_FIELD_DESCRIPTION: string =
  "Leave blank to keep each monitor's value when syncing. Enter a value to apply it to linked monitors.";

export const TEMPLATE_TARGET_DESCRIPTION: string =
  "Target fields are optional in templates. Blank fields keep each linked monitor's current value when syncing. Filled fields are copied along with criteria and other check settings. New monitors must provide any missing required targets.";

export const NETWORK_DEVICE_TEMPLATE_TARGET_DESCRIPTION: string =
  "The network device is optional in templates and is used as a default for new monitors. Existing linked monitors keep their selected device when syncing. Criteria and other check settings are copied from the template.";

interface ComponentProps extends FieldLabelProps {
  preserveOnSync?: boolean | undefined;
  templateDescription?: string | ReactElement | undefined;
}

const MonitorTargetFieldLabel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isMonitorTemplate: boolean = useContext(MonitorTemplateContext);

  return (
    <FieldLabelElement
      {...props}
      required={isMonitorTemplate ? false : props.required}
      description={
        isMonitorTemplate ? (
          props.preserveOnSync ? (
            NETWORK_DEVICE_TEMPLATE_TARGET_DESCRIPTION
          ) : (
            <>
              {props.templateDescription || props.description}
              <p className="mt-1">{TEMPLATE_TARGET_FIELD_DESCRIPTION}</p>
            </>
          )
        ) : (
          props.description
        )
      }
    />
  );
};

export default MonitorTargetFieldLabel;
