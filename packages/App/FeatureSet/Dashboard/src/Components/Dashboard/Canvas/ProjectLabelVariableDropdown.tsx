import React, { FunctionComponent, ReactElement } from "react";
import DashboardVariable, {
  DashboardVariableType,
} from "Common/Types/Dashboard/DashboardVariable";

export interface ComponentProps {
  variables?: Array<DashboardVariable> | undefined;
  value?: string | undefined;
  onChange: (value: string) => void;
}

const ProjectLabelVariableDropdown: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const variables: Array<DashboardVariable> = (props.variables || []).filter(
    (variable: DashboardVariable) => {
      return variable.type === DashboardVariableType.ProjectLabel;
    },
  );
  const selected: DashboardVariable | undefined = variables.find(
    (variable: DashboardVariable) => {
      return variable.id === props.value;
    },
  );
  const missing: boolean = Boolean(props.value && !selected);
  return (
    <div>
      <select
        aria-label="Label Variable"
        className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-700"
        value={props.value || ""}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
          return props.onChange(e.target.value);
        }}
      >
        <option value="">None</option>
        {missing && <option value={props.value}>Unavailable variable</option>}
        {variables.map((variable: DashboardVariable) => {
          return (
            <option key={variable.id} value={variable.id}>
              {variable.label && variable.label !== variable.name
                ? `${variable.label} (${variable.name})`
                : variable.name}
            </option>
          );
        })}
      </select>
      {missing ? (
        <p role="alert" className="text-xs text-red-600 mt-1">
          This label variable was removed or its source changed. Choose a
          Project Labels variable or clear the binding.
        </p>
      ) : selected && !selected.labelOptions?.length ? (
        <p role="alert" className="text-xs text-red-600 mt-1">
          Choose allowed labels for this variable in Dashboard Variables.
        </p>
      ) : variables.length === 0 ? (
        <p className="text-xs text-gray-500 mt-1">
          Add a Project Labels variable from the dashboard toolbar to use it
          here.
        </p>
      ) : null}
    </div>
  );
};

export default ProjectLabelVariableDropdown;
