import React, { FunctionComponent, ReactElement } from "react";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";

export interface ComponentProps {
  variables: Array<DashboardVariable>;
  onVariableValueChange: (variableId: string, value: string) => void;
}

const DashboardVariableSelector: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.variables || props.variables.length === 0) {
    return <></>;
  }

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {props.variables.map((variable: DashboardVariable) => {
        const options: Array<string> = variable.customListValues
          ? variable.customListValues.split(",").map((v: string) => {
              return v.trim();
            })
          : [];

        return (
          <div key={variable.id} className="flex items-center gap-1">
            <label className="text-xs font-medium text-gray-500">
              {variable.label || variable.name}:
            </label>
            {options.length > 0 ? (
              <select
                className="text-xs border border-gray-200 rounded px-2 py-1 bg-white"
                value={variable.selectedValue || variable.defaultValue || ""}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                  props.onVariableValueChange(variable.id, e.target.value);
                }}
              >
                <option value="">All</option>
                {options.map((option: string) => {
                  return (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  );
                })}
              </select>
            ) : (
              <input
                type="text"
                className="text-xs border border-gray-200 rounded px-2 py-1 bg-white w-24"
                value={variable.selectedValue || variable.defaultValue || ""}
                placeholder={variable.name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  props.onVariableValueChange(variable.id, e.target.value);
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

export default DashboardVariableSelector;
