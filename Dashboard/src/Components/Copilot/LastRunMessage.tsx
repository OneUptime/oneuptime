import React, { FunctionComponent, ReactElement } from "react";
import Alert, { AlertType } from "CommonUI/src/Components/Alerts/Alert";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "CommonUI/src/Utils/Navigation";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";

export interface ComponentProps {
  lastRunAt?: undefined | Date;
  codeRepositoryId: ObjectID;
}

const CopilotLastRunAt: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <>
      {props.lastRunAt && (
        <Alert
          type={AlertType.INFO}
          strongTitle="Copilot Last Ran At"
          title={`${OneUptimeDate.getDateAsLocalFormattedString(props.lastRunAt)}.`}
        />
      )}

      {!props.lastRunAt && (
        <Alert
          className="cursor-pointer"
          onClick={() => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[
                  PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW_DOCUMENTATION
                ]!,
                {
                  modelId: props.codeRepositoryId,
                },
              ),
            );
          }}
          type={AlertType.INFO}
          strongTitle="Copilot Did Not Run Yet"
          title={`Copilot improves your code and fixes them automatically. Please click here to learn more.`}
        />
      )}
    </>
  );
};

export default CopilotLastRunAt;
