import OneUptimeDate from "Common/Types/Date";
import ProbeMonitor from "Common/Types/Monitor/Monitor";
import Button, { ButtonStyleType } from "CommonUI/src/Components/Button/Button";
import Detail from "CommonUI/src/Components/Detail/Detail";
import Field from "CommonUI/src/Components/Detail/Field";
import InfoCard from "CommonUI/src/Components/InfoCard/InfoCard";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  probeMonitor: ProbeMonitor;
}

const WebsiteMonitorSummaryView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showMoreDetails, setShowMoreDetails] = React.useState<boolean>(false);

  let responseTimeInMs: number =
    props.probeMonitor?.responseTimeInMs || 0;

  if (responseTimeInMs > 0) {
    responseTimeInMs = Math.round(responseTimeInMs);
  }

  const fields: Array<Field<ProbeMonitor>> = [];

  if (props.probeMonitor?.responseHeaders) {
    fields.push({
      key: "responseHeaders",
      title: "Response Headers",
      description: "Response headers of the request.",
      fieldType: FieldType.JSON,
    });
  }

  if (props.probeMonitor?.responseBody) {
    fields.push({
      key: "responseBody",
      title: "Response Body",
      description: "Response body of the request.",
      fieldType: FieldType.JSON,
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex space-x-3">
        <InfoCard
          className="w-full shadow-none border-2 border-gray-100 "
          title="URL"
          value={
            props.probeMonitor.monitorDestination?.toString() || "-"
          }
        />
      </div>
      <div className="flex space-x-3">
        <InfoCard
          className="w-1/3 shadow-none border-2 border-gray-100 "
          title="Response Staus Code"
          value={props.probeMonitor?.responseCode?.toString() || "-"}
        />
        <InfoCard
          className="w-1/3 shadow-none border-2 border-gray-100 "
          title="Response Time (in ms)"
          value={responseTimeInMs ? responseTimeInMs + " ms" : "-"}
        />
        <InfoCard
          className="w-1/3 shadow-none border-2 border-gray-100 "
          title="Monitored At"
          value={
            props.probeMonitor?.monitoredAt
              ? OneUptimeDate.getDateAsLocalFormattedString(
                  props.probeMonitor.monitoredAt,
                )
              : "-"
          }
        />
      </div>

      {props.probeMonitor.failureCause && (
        <div className="flex space-x-3">
          <InfoCard
            className="w-full shadow-none border-2 border-gray-100 "
            title="Error"
            value={props.probeMonitor.failureCause?.toString() || "-"}
          />
        </div>
      )}

      {showMoreDetails && fields.length > 0 && (
        <div>
          <Detail<ProbeMonitor>
            id={"website-monitor-summary-detail"}
            item={props.probeMonitor}
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
