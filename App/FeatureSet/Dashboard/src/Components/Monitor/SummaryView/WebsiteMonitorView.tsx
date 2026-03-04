import OneUptimeDate from "Common/Types/Date";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Detail from "Common/UI/Components/Detail/Detail";
import Field from "Common/UI/Components/Detail/Field";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  probeMonitorResponse: ProbeMonitorResponse;
  probeName?: string | undefined;
}

const WebsiteMonitorSummaryView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showMoreDetails, setShowMoreDetails] = React.useState<boolean>(false);

  let responseTimeInMs: number =
    props.probeMonitorResponse?.responseTimeInMs || 0;

  if (responseTimeInMs > 0) {
    responseTimeInMs = Math.round(responseTimeInMs);
  }

  const fields: Array<Field<ProbeMonitorResponse>> = [];

  if (props.probeMonitorResponse?.responseHeaders) {
    fields.push({
      key: "responseHeaders",
      title: "Response Headers",
      description: "Response headers of the request.",
      fieldType: FieldType.JSON,
    });
  }

  if (props.probeMonitorResponse?.responseBody) {
    fields.push({
      key: "responseBody",
      title: "Response Body",
      description: "Response body of the request.",
      fieldType: FieldType.JSON,
    });
  }

  // Check if there are error details to show
  const hasErrorDetails: boolean = Boolean(
    props.probeMonitorResponse.requestFailedDetails,
  );

  return (
    <div className="space-y-5">
      <div className="flex space-x-3">
        <InfoCard
          className="w-full shadow-none border-2 border-gray-100 "
          title="URL"
          value={
            props.probeMonitorResponse.monitorDestination?.toString() || "-"
          }
        />
      </div>
      <div className="flex space-x-3">
        <InfoCard
          className="w-1/4 shadow-none border-2 border-gray-100 "
          title="Probe"
          value={props.probeName || "-"}
        />
        <InfoCard
          className="w-1/4 shadow-none border-2 border-gray-100 "
          title="Response Status Code"
          value={props.probeMonitorResponse?.responseCode?.toString() || "-"}
        />
        <InfoCard
          className="w-1/4 shadow-none border-2 border-gray-100 "
          title="Response Time (in ms)"
          value={responseTimeInMs ? responseTimeInMs + " ms" : "-"}
        />
        <InfoCard
          className="w-1/4 shadow-none border-2 border-gray-100 "
          title="Monitored At"
          value={
            props.probeMonitorResponse?.monitoredAt
              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  props.probeMonitorResponse.monitoredAt,
                )
              : "-"
          }
        />
      </div>

      {props.probeMonitorResponse.failureCause && (
        <div className="flex space-x-3">
          <InfoCard
            className="w-full shadow-none border-2 border-gray-100 "
            title="Error"
            value={props.probeMonitorResponse.failureCause?.toString() || "-"}
          />
        </div>
      )}

      {/* Error Details Section */}
      {hasErrorDetails && (
        <div className="space-y-3">
          <div className="flex space-x-3">
            <InfoCard
              className="w-1/2 shadow-none border-2 border-gray-100 "
              title="Failed At"
              value={
                props.probeMonitorResponse.requestFailedDetails?.failedPhase ||
                "-"
              }
            />
            <InfoCard
              className="w-1/2 shadow-none border-2 border-gray-100 "
              title="Error Code"
              value={
                props.probeMonitorResponse.requestFailedDetails?.errorCode ||
                "-"
              }
            />
          </div>
          <div className="flex space-x-3">
            <InfoCard
              className="w-full shadow-none border-2 border-gray-100 "
              title="Error Details"
              value={
                props.probeMonitorResponse.requestFailedDetails
                  ?.errorDescription || "-"
              }
            />
          </div>
        </div>
      )}

      {showMoreDetails && fields.length > 0 && (
        <div>
          <Detail<ProbeMonitorResponse>
            id={"website-monitor-summary-detail"}
            item={props.probeMonitorResponse}
            fields={fields}
            showDetailsInNumberOfColumns={1}
          />
        </div>
      )}

      {!showMoreDetails && fields.length > 0 && (
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

      {showMoreDetails && fields.length > 0 && (
        <div className="-ml-3">
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
  );
};

export default WebsiteMonitorSummaryView;
