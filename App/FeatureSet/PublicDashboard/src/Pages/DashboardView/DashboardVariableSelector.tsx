import React, { FunctionComponent, ReactElement } from "react";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";

export interface ComponentProps {
  variables: Array<DashboardVariable>;
  onVariableValueChange: (variableId: string, value: string) => void;
}

const DashboardVariableSelector: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {props.variables.map((variable: DashboardVariable) => {
        return (
          <div key={variable.id} className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-gray-500">
              {variable.name}:
            </label>
            {variable.customListValues ? (
              <select
                className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-700"
                value={variable.selectedValue || variable.defaultValue || ""}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                  props.onVariableValueChange(variable.id, e.target.value);
                }}
              >
                {variable.customListValues.split(",").map((option: string) => {
                  const trimmedOption: string = option.trim();
                  return (
                    <option key={trimmedOption} value={trimmedOption}>
                      {trimmedOption}
                    </option>
                  );
                })}
              </select>
            ) : (
              <input
                type="text"
                className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-700 w-24"
                value={variable.selectedValue || variable.defaultValue || ""}
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
