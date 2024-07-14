import React, { FunctionComponent, ReactElement } from "react";
import Alert, { AlertType } from "CommonUI/src/Components/Alerts/Alert";
import OneUptimeDate from "Common/Types/Date";

export interface ComponentProps {
  lastRunAt?: undefined | Date;
}

const CopilotLastRunAt: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <>
      {props.lastRunAt && (
        <Alert
          type={AlertType.INFO}
          strongTitle="Last Run At: "
          title={`${OneUptimeDate.getDateAsLocalFormattedString(props.lastRunAt)}.`}
        />
      )}

      {!props.lastRunAt && (
        <Alert
          type={AlertType.INFO}
          strongTitle="Copilot Did Not Run Yet"
          title={`Please run the copilot to fix and improve your code.`}
        />
      )}
    </>
  );
};

export default CopilotLastRunAt;
