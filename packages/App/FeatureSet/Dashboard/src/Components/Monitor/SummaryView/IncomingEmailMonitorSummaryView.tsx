import OneUptimeDate from "Common/Types/Date";
import IncomingEmailMonitorRequest from "Common/Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Detail from "Common/UI/Components/Detail/Detail";
import Field from "Common/UI/Components/Detail/Field";
import FieldType from "Common/UI/Components/Types/FieldType";
import IncomingEmailMonitorRequestUtil from "Common/Utils/Monitor/IncomingEmailMonitorRequestUtil";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { SummaryFact, SummaryFacts, SummaryView } from "./SummaryFacts";

export interface ComponentProps {
  incomingEmailMonitorRequest: IncomingEmailMonitorRequest;
  incomingEmailMonitorHeartbeatCheckedAt?: Date | undefined;
}

const IncomingEmailMonitorSummaryView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [showMoreDetails, setShowMoreDetails] = React.useState<boolean>(false);

  const fields: Array<Field<IncomingEmailMonitorRequest>> = [];

  /*
   * A scheduled check on a monitor that has never received an email carries
   * the monitor's creation time as its emailReceivedAt. That is not an email.
   */
  const hasEmail: boolean = IncomingEmailMonitorRequestUtil.hasEmail(
    props.incomingEmailMonitorRequest,
  );

  let lastEmailReceivedAt: string = "-";

  if (!hasEmail) {
    lastEmailReceivedAt = translator.translateTemplate("No email yet");
  } else if (props.incomingEmailMonitorRequest?.emailReceivedAt) {
    lastEmailReceivedAt =
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        props.incomingEmailMonitorRequest.emailReceivedAt,
      );
  }

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
    <SummaryView dataTestId="incoming-email-monitor-summary">
      {/*
       * A grid's gap, never space-x: a card on a line of its own keeps no
       * margin from the card before it, so on a phone no card steps in.
       */}
      <SummaryFacts>
        <SummaryFact
          title="Last Email Received At"
          value={lastEmailReceivedAt}
        />
        <SummaryFact
          title="From"
          value={props.incomingEmailMonitorRequest?.emailFrom || "-"}
        />
        <SummaryFact
          title="Subject"
          value={props.incomingEmailMonitorRequest?.emailSubject || "-"}
        />
        {props.incomingEmailMonitorHeartbeatCheckedAt ? (
          <SummaryFact
            title="Monitor Status Check At"
            value={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
              props.incomingEmailMonitorHeartbeatCheckedAt,
            )}
          />
        ) : (
          <></>
        )}
      </SummaryFacts>

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
    </SummaryView>
  );
};

export default IncomingEmailMonitorSummaryView;
