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
    <div className="flex flex-wrap gap-3 items-center">
      {props.variables.map((variable: DashboardVariable) => {
        const options: Array<string> = variable.customListValues
          ? variable.customListValues.split(",").map((v: string) => {
              return v.trim();
            })
          : [];

        return (
          <div key={variable.id} className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">
              {variable.label || variable.name}
            </label>
            {options.length > 0 ? (
              <select
                className="text-xs border border-gray-200 rounded-md px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-colors"
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
                className="text-xs border border-gray-200 rounded-md px-2.5 py-1.5 bg-white text-gray-700 w-28 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-colors"
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
