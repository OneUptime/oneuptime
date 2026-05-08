import OneUptimeDate from "Common/Types/Date";
import CustomCodeMonitorResponse, {
  RetryAttempt,
} from "Common/Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";
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

  const totalAttempts: number = customCodeMonitorResponse.totalAttempts || 0;
  const retryAttempts: Array<RetryAttempt> =
    customCodeMonitorResponse.retryAttempts || [];
  const hadRetries: boolean = totalAttempts > 1 && retryAttempts.length > 0;

  return (
    <div className="space-y-5">
      <div className="space-y-5">
        {hadRetries && (
          <div className="rounded-md border-2 border-yellow-100 bg-yellow-50 p-3 text-sm text-yellow-900">
            This check required <strong>{totalAttempts} attempts</strong> to
            complete
            {customCodeMonitorResponse.scriptError
              ? " and ultimately failed."
              : "."}
          </div>
        )}

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
          <div className="space-y-5">
            {hadRetries && (
              <div className="rounded-md border-2 border-gray-100 p-4">
                <div className="text-sm font-medium text-gray-900 mb-1">
                  Retry Attempts
                </div>
                <div className="text-xs text-gray-500 mb-3">
                  Each attempt made for this check, in order.
                </div>
                <ul className="space-y-2">
                  {retryAttempts.map((attempt: RetryAttempt) => {
                    const failed: boolean = Boolean(attempt.scriptError);
                    return (
                      <li
                        key={attempt.attemptNumber}
                        className="text-sm text-gray-700"
                      >
                        <div>
                          <span className="font-mono">
                            Attempt {attempt.attemptNumber}/{totalAttempts}
                          </span>
                          <span className="mx-2 text-gray-400">—</span>
                          <span
                            className={
                              failed ? "text-red-700" : "text-green-700"
                            }
                          >
                            {failed ? "Failed" : "Succeeded"}
                          </span>
                          <span className="mx-2 text-gray-400">—</span>
                          <span>
                            {Math.round(attempt.executionTimeInMS)} ms
                          </span>
                        </div>
                        {failed && attempt.scriptError && (
                          <div className="ml-4 mt-1 text-xs text-gray-500 break-all">
                            {attempt.scriptError}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

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
