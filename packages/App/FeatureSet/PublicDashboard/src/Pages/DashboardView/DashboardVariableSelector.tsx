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
import DashboardVariableControl, {
  VariableValueChange,
} from "Common/UI/Components/Dashboard/DashboardVariableControl";

export interface ComponentProps {
  variables: Array<DashboardVariable>;
  onVariableValueChange: (
    variableId: string,
    change: VariableValueChange,
  ) => void;
  dashboardId: ObjectID;
}

interface SingleVariableSelectorProps {
  variable: DashboardVariable;
  onVariableValueChange: (
    variableId: string,
    change: VariableValueChange,
  ) => void;
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
    } else {
      setIsLoadingOptions(false);
    }
    return () => {
      cancelled = true;
    };
  }, [variable.type, variable.attributeKey, props.dashboardId]);

  return (
    <DashboardVariableControl
      variable={variable}
      dynamicOptions={dynamicOptions}
      isLoadingOptions={isLoadingOptions}
      onVariableValueChange={props.onVariableValueChange}
    />
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
