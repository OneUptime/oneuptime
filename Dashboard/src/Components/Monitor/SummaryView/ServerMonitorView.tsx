import OneUptimeDate from "Common/Types/Date";
import ServerMonitorResponse from "Common/Types/Monitor/ServerMonitor/ServerMonitorResponse";
import Button, { ButtonStyleType } from "CommonUI/src/Components/Button/Button";
import Detail from "CommonUI/src/Components/Detail/Detail";
import Field from "CommonUI/src/Components/Detail/Field";
import InfoCard from "CommonUI/src/Components/InfoCard/InfoCard";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  serverMonitorResponse: ServerMonitorResponse;
}

const ServerMonitorSummaryView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showMoreDetails, setShowMoreDetails] = React.useState<boolean>(false);

  const fields: Array<Field<ServerMonitorResponse>> = [];

  if (props.serverMonitorResponse?.processes) {
    fields.push({
      key: "processes",
      title: "Processes",
      description: "Processes running on the machine.",
      fieldType: FieldType.JSON,
    });
  }

  if(props.serverMonitorResponse.basicInfrastructureMetrics){
    fields.push({
      key: "basicInfrastructureMetrics",
      title: "Basic Infrastructure Metrics",
      description: "CPU, Memory, Disk and Network usage.",
      fieldType: FieldType.JSON,
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex space-x-3">
        <InfoCard
          className="w-1/2 shadow-none border-2 border-gray-100 "
          title="Hostname"
          value={props.serverMonitorResponse?.hostname || "-"}
        />
        <InfoCard
          className="w-1/2 shadow-none border-2 border-gray-100 "
          title="Last Ping At"
          value={
            props.serverMonitorResponse?.requestReceivedAt
              ? OneUptimeDate.getDateAsLocalFormattedString(
                  props.serverMonitorResponse.requestReceivedAt,
                )
              : "-"
          }
        />
      </div>

      {props.serverMonitorResponse.failureCause && (
        <div className="flex space-x-3">
          <InfoCard
            className="w-full shadow-none border-2 border-gray-100 "
            title="Error"
            value={props.serverMonitorResponse.failureCause?.toString() || "-"}
          />
        </div>
      )}

      {showMoreDetails && fields.length > 0 && (
        <div>
          <Detail<ServerMonitorResponse>
            id={"website-monitor-summary-detail"}
            item={props.serverMonitorResponse}
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

export default ServerMonitorSummaryView;
