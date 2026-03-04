import OneUptimeDate from "Common/Types/Date";
import IncomingEmailMonitorRequest from "Common/Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Detail from "Common/UI/Components/Detail/Detail";
import Field from "Common/UI/Components/Detail/Field";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  incomingEmailMonitorRequest: IncomingEmailMonitorRequest;
  incomingEmailMonitorHeartbeatCheckedAt?: Date | undefined;
}

const IncomingEmailMonitorSummaryView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showMoreDetails, setShowMoreDetails] = React.useState<boolean>(false);

  const fields: Array<Field<IncomingEmailMonitorRequest>> = [];

  if (props.incomingEmailMonitorRequest?.emailHeaders) {
    fields.push({
      key: "emailHeaders",
      title: "Email Headers",
      description: "Headers from the received email.",
      fieldType: FieldType.JSON,
    });
  }

  if (props.incomingEmailMonitorRequest?.emailBody) {
    fields.push({
      key: "emailBody",
      title: "Email Body (Text)",
      description: "Plain text body of the received email.",
      fieldType: FieldType.LongText,
    });
  }

  if (props.incomingEmailMonitorRequest?.emailBodyHtml) {
    fields.push({
      key: "emailBodyHtml",
      title: "Email Body (HTML)",
      description: "HTML body of the received email.",
      fieldType: FieldType.HTML,
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex space-x-3 justify-between flex-wrap">
        <InfoCard
          className="w-full sm:w-auto flex-1 shadow-none border-2 border-gray-100 mb-3"
          title="Last Email Received At"
          value={
            props.incomingEmailMonitorRequest?.emailReceivedAt
              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  props.incomingEmailMonitorRequest.emailReceivedAt,
                )
              : "-"
          }
        />
        <InfoCard
          className="w-full sm:w-auto flex-1 shadow-none border-2 border-gray-100 mb-3"
          title="From"
          value={props.incomingEmailMonitorRequest?.emailFrom || "-"}
        />
        <InfoCard
          className="w-full sm:w-auto flex-1 shadow-none border-2 border-gray-100 mb-3"
          title="Subject"
          value={props.incomingEmailMonitorRequest?.emailSubject || "-"}
        />
        {props.incomingEmailMonitorHeartbeatCheckedAt && (
          <InfoCard
            className="w-full sm:w-auto flex-1 shadow-none border-2 border-gray-100 mb-3"
            title="Monitor Status Check At"
            value={
              props.incomingEmailMonitorHeartbeatCheckedAt
                ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                    props.incomingEmailMonitorHeartbeatCheckedAt,
                  )
                : "-"
            }
          />
        )}
      </div>

      {showMoreDetails && fields.length > 0 && (
        <div>
          <Detail<IncomingEmailMonitorRequest>
            id={"incoming-email-monitor-summary-detail"}
            item={props.incomingEmailMonitorRequest}
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

export default IncomingEmailMonitorSummaryView;
