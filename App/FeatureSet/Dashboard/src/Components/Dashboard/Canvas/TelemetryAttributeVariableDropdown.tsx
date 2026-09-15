import React, { FunctionComponent, ReactElement } from "react";
import DashboardVariable, {
  DashboardVariableType,
} from "Common/Types/Dashboard/DashboardVariable";

export interface ComponentProps {
  variables?: Array<DashboardVariable> | undefined;
  value?: string | undefined;
  onChange: (value: string) => void;
}

/*
 * Picks one of the dashboard's Telemetry Attribute variables for a widget
 * that follows that variable's toolbar selection — the SLO widget's "Follow
 * SLO Variable".
 *
 * Only Telemetry Attribute variables are offered because they are the only
 * kind whose selection the public dashboard route resolves from stored
 * config; a Custom List variable would work in the app and silently show
 * nothing to an anonymous viewer. Mirrors ProjectLabelVariableDropdown: a
 * native select, a "None" option that clears the binding, and an inline
 * explanation when the stored binding points at a variable that is gone.
 */
const TelemetryAttributeVariableDropdown: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const variables: Array<DashboardVariable> = (props.variables || []).filter(
    (variable: DashboardVariable): boolean => {
      return variable.type === DashboardVariableType.TelemetryAttribute;
    },
  );

  const selected: DashboardVariable | undefined = variables.find(
    (variable: DashboardVariable): boolean => {
      return variable.id === props.value;
    },
  );

  const isMissing: boolean = Boolean(props.value && !selected);

  type GetOptionLabelFunction = (variable: DashboardVariable) => string;

  // The key is part of the label: two "SLO" variables on different keys are otherwise indistinguishable.
  const getOptionLabel: GetOptionLabelFunction = (
    variable: DashboardVariable,
  ): string => {
    const name: string = variable.label || variable.name;

    return variable.attributeKey ? `${name} (${variable.attributeKey})` : name;
  };

  return (
    <div>
      <select
        aria-label="Follow Variable"
        className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-700"
        value={props.value || ""}
        onChange={(event: React.ChangeEvent<HTMLSelectElement>): void => {
          props.onChange(event.target.value);
        }}
      >
        <option value="">None</option>
        {isMissing ? (
          <option value={props.value}>Unavailable variable</option>
        ) : (
          <></>
        )}
        {variables.map((variable: DashboardVariable): ReactElement => {
          return (
            <option key={variable.id} value={variable.id}>
              {getOptionLabel(variable)}
            </option>
          );
        })}
      </select>
      {isMissing ? (
        <p role="alert" className="text-xs text-red-600 mt-1">
          This variable was removed or is no longer a Telemetry Attribute
          variable. Choose another variable or clear the binding.
        </p>
      ) : selected && selected.isMultiSelect ? (
        <p className="text-xs text-gray-500 mt-1">
          This variable allows several picks. The widget shows an SLO only while
          exactly one is picked.
        </p>
      ) : variables.length === 0 ? (
        <p className="text-xs text-gray-500 mt-1">
          Add a Telemetry Attribute variable from the dashboard toolbar to use
          it here.
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default TelemetryAttributeVariableDropdown;
