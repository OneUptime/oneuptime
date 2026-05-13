import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import DashboardVariable, {
  DashboardVariableType,
} from "Common/Types/Dashboard/DashboardVariable";
import API from "../../Utils/API";
import { PUBLIC_DASHBOARD_API_URL } from "../../Utils/Config";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

export interface ComponentProps {
  variables: Array<DashboardVariable>;
  onVariableValueChange: (variableId: string, value: string) => void;
  dashboardId: ObjectID;
}

interface SingleVariableSelectorProps {
  variable: DashboardVariable;
  onVariableValueChange: (variableId: string, value: string) => void;
  dashboardId: ObjectID;
}

const SingleVariableSelector: FunctionComponent<SingleVariableSelectorProps> = (
  props: SingleVariableSelectorProps,
): ReactElement => {
  const { variable } = props;
  const [dynamicOptions, setDynamicOptions] = useState<Array<string>>([]);
  const [isLoadingOptions, setIsLoadingOptions] = useState<boolean>(false);

  useEffect(() => {
    let cancelled: boolean = false;
    if (
      variable.type === DashboardVariableType.TelemetryAttribute &&
      variable.attributeKey
    ) {
      setIsLoadingOptions(true);
      API.post<JSONObject>({
        url: URL.fromString(PUBLIC_DASHBOARD_API_URL.toString()).addRoute(
          `/attribute-values/${props.dashboardId.toString()}`,
        ),
        data: {
          attributeKey: variable.attributeKey,
        },
      })
        .then((response: HTTPResponse<JSONObject>) => {
          if (cancelled) {
            return;
          }
          const values: Array<string> = ((response.data || {})["values"] ||
            []) as Array<string>;
          setDynamicOptions(values);
        })
        .catch(() => {
          if (cancelled) {
            return;
          }
          setDynamicOptions([]);
        })
        .finally(() => {
          if (cancelled) {
            return;
          }
          setIsLoadingOptions(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [variable.type, variable.attributeKey, props.dashboardId]);

  const isTelemetryAttribute: boolean =
    variable.type === DashboardVariableType.TelemetryAttribute;
  const isCustomList: boolean =
    variable.type === DashboardVariableType.CustomList ||
    Boolean(variable.customListValues);

  const customListOptions: Array<string> = variable.customListValues
    ? variable.customListValues.split(",").map((v: string) => {
        return v.trim();
      })
    : [];

  const options: Array<string> = isTelemetryAttribute
    ? dynamicOptions
    : customListOptions;

  const useSelect: boolean = isTelemetryAttribute || isCustomList;

  return (
    <div className="flex items-center gap-1.5">
      <label className="text-xs font-medium text-gray-500">
        {variable.name}:
      </label>
      {useSelect ? (
        <select
          className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-700"
          value={variable.selectedValue || variable.defaultValue || ""}
          disabled={isLoadingOptions}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            props.onVariableValueChange(variable.id, e.target.value);
          }}
        >
          <option value="">{isLoadingOptions ? "Loading…" : "All"}</option>
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
          className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-700 w-24"
          value={variable.selectedValue || variable.defaultValue || ""}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            props.onVariableValueChange(variable.id, e.target.value);
          }}
        />
      )}
    </div>
  );
};

const DashboardVariableSelector: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {props.variables.map((variable: DashboardVariable) => {
        return (
          <SingleVariableSelector
            key={variable.id}
            variable={variable}
            onVariableValueChange={props.onVariableValueChange}
            dashboardId={props.dashboardId}
          />
        );
      })}
    </div>
  );
};

export default DashboardVariableSelector;
