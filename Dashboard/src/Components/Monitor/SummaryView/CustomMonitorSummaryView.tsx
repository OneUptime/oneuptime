import OneUptimeDate from "Common/Types/Date";
import CustomCodeMonitorResponse from "Common/Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Detail from "Common/UI/Components/Detail/Detail";
import Field from "Common/UI/Components/Detail/Field";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  customCodeMonitorResponse: CustomCodeMonitorResponse;
  moreDetailElement?: ReactElement | undefined;
  monitoredAt: Date;
  probeName?: string | undefined;
}

const CustomMonitorSummaryView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.customCodeMonitorResponse) {
    return (
      <ErrorMessage message="No summary available for the selected probe. Should be few minutes for summary to show up. " />
    );
  }

  const [showMoreDetails, setShowMoreDetails] = React.useState<boolean>(false);

  const customCodeMonitorResponse: CustomCodeMonitorResponse =
    props.customCodeMonitorResponse;

  let executionTimeInMS: number =
    customCodeMonitorResponse.executionTimeInMS || 0;

  if (executionTimeInMS > 0) {
    executionTimeInMS = Math.round(executionTimeInMS);
  }

  const fields: Array<Field<CustomCodeMonitorResponse>> = [];

  if (
    customCodeMonitorResponse.logMessages &&
    customCodeMonitorResponse.logMessages.length > 0
  ) {
    fields.push({
      key: "logMessages",
      title: "Log Messages",
      description: "Log messages from the script execution.",
      fieldType: FieldType.JSON,
    });
  }

  if (customCodeMonitorResponse.result) {
    fields.push({
      key: "result",
      title: "Result",
      description: "Result of the script execution.",
      fieldType: FieldType.JSON,
    });
  }

  if (customCodeMonitorResponse.scriptError) {
    fields.push({
      key: "scriptError",
      title: "Script Error",
      description: "Error message from script execution.",
      fieldType: FieldType.Text,
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-5">
        <div className="flex space-x-3 w-full">
          {props.probeName && (
            <InfoCard
              className="w-1/4 shadow-none border-2 border-gray-100 "
              title="Probe"
              value={props.probeName || "-"}
            />
          )}
          <InfoCard
            className={`${props.probeName ? "w-1/4" : "w-1/3"} shadow-none border-2 border-gray-100 `}
            title="Execution Time (in ms)"
            value={executionTimeInMS ? executionTimeInMS + " ms" : "-"}
          />

          <InfoCard
            className={`${props.probeName ? "w-1/4" : "w-1/3"} shadow-none border-2 border-gray-100 `}
            title="Error"
            value={customCodeMonitorResponse.scriptError ? "Yes" : "No"}
          />

          <InfoCard
            className={`${props.probeName ? "w-1/4" : "w-1/3"} shadow-none border-2 border-gray-100 `}
            title="Monitored At"
            value={
              props.monitoredAt
                ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                    props.monitoredAt,
                  )
                : "-"
            }
          />
        </div>

        {showMoreDetails && (
          <div>
            <Detail<CustomCodeMonitorResponse>
              id={"custom-code-monitor-summary-detail"}
              item={customCodeMonitorResponse}
              fields={fields}
              showDetailsInNumberOfColumns={1}
            />

            {props.moreDetailElement && props.moreDetailElement}
          </div>
        )}

        {!showMoreDetails && (
          <div className="-ml-2">
            <Button
              buttonStyle={ButtonStyleType.SECONDARY_LINK}
              title="Show More Details"
              onClick={() => {
                return setShowMoreDetails(true);
              }}
            />
          </div>
        )}

        {/* Hide details button */}

        {showMoreDetails && (
          <div className="-ml-2">
            <Button
              buttonStyle={ButtonStyleType.SECONDARY_LINK}
              title="Hide Details"
              onClick={() => {
                return setShowMoreDetails(false);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomMonitorSummaryView;
