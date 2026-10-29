import OneUptimeDate from "Common/Types/Date";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Detail from "Common/UI/Components/Detail/Detail";
import Field from "Common/UI/Components/Detail/Field";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { FunctionComponent, ReactElement } from "react";
import { SummaryFact, SummaryFacts, SummaryView } from "./SummaryFacts";

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

  /*
   * Two to a row, in a grid that follows the summary's width: the three
   * half-width cards of a flex row were a card and a half wider than the
   * Monitor Summary card, which scrolled sideways on a phone (#5101).
   */
  return (
    <SummaryView dataTestId="incoming-request-monitor-summary">
      <SummaryFacts>
        <SummaryFact
          title="Last Request Received At"
          value={
            props.incomingMonitorRequest?.incomingRequestReceivedAt
              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  props.incomingMonitorRequest.incomingRequestReceivedAt,
                )
              : "-"
          }
        />
        <SummaryFact
          title="Request Method"
          value={props.incomingMonitorRequest.requestMethod || "-"}
        />
        {props.incomingRequestMonitorHeartbeatCheckedAt ? (
          <SummaryFact
            title="Monitor Status Check At"
            value={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
              props.incomingRequestMonitorHeartbeatCheckedAt,
            )}
          />
        ) : (
          <></>
        )}
      </SummaryFacts>

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

      {/*
       * One button, open or folded: its words follow the state and it
       * keeps its place, so focus stays on it after a press.
       */}
      <div className="-ml-3">
        <Button
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
          title={showMoreDetails ? "Hide Details" : "Show More Details"}
          ariaExpanded={showMoreDetails}
          onClick={() => {
            return setShowMoreDetails(!showMoreDetails);
          }}
        />
      </div>
    </SummaryView>
  );
};

export default IncomingRequestMonitorView;
