import OneUptimeDate from "Common/Types/Date";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Detail from "Common/UI/Components/Detail/Detail";
import Field from "Common/UI/Components/Detail/Field";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  incomingMonitorRequest: IncomingMonitorRequest;
  incomingRequestMonitorHeartbeatCheckedAt?: Date | undefined;
}

const IncomingRequestMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showMoreDetails, setShowMoreDetails] = React.useState<boolean>(false);

  const fields: Array<Field<IncomingMonitorRequest>> = [
    {
      key: "requestHeaders",
      title: "Request Headers",
      description: "Request headers of the request.",
      fieldType: FieldType.JSON,
    },
  ];

  if (props.incomingMonitorRequest?.requestBody) {
    fields.push({
      key: "requestBody",
      title: "Request Body",
      description: "Request body of the request.",
      fieldType: FieldType.JSON,
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex space-x-3 justify-between">
        <InfoCard
          className="w-1/2 shadow-none border-2 border-gray-100"
          title="Last Request Received At"
          value={
            props.incomingMonitorRequest?.incomingRequestReceivedAt
              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  props.incomingMonitorRequest.incomingRequestReceivedAt,
                )
              : "-"
          }
        />
        <InfoCard
          className="w-1/2 shadow-none border-2 border-gray-100"
          title="Request Method"
          value={props.incomingMonitorRequest.requestMethod || "-"}
        />
        {props.incomingRequestMonitorHeartbeatCheckedAt && (
          <InfoCard
            className="w-1/2 shadow-none border-2 border-gray-100"
            title="Monitor Status Check At"
            value={
              props.incomingRequestMonitorHeartbeatCheckedAt
                ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                    props.incomingRequestMonitorHeartbeatCheckedAt,
                  )
                : "-"
            }
          />
        )}
      </div>

      {showMoreDetails && (
        <div>
          <Detail<IncomingMonitorRequest>
            id={"website-monitor-summary-detail"}
            item={props.incomingMonitorRequest}
            fields={fields}
            showDetailsInNumberOfColumns={1}
          />
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

export default IncomingRequestMonitorView;
