import OneUptimeDate from "Common/Types/Date";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Detail from "Common/UI/Components/Detail/Detail";
import Field from "Common/UI/Components/Detail/Field";
import FieldType from "Common/UI/Components/Types/FieldType";
import { translationKey } from "Common/Types/Translator";
import { HEARTBEAT_SWEEP_EVERY_SECONDS } from "Common/Utils/Monitor/HeartbeatSweepSchedule";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { SECRETS_IN_REQUEST_ARE_MASKED } from "../../EventView/EventEvaluationDetailsCopy";
import SubscriptionConfirmationNotice from "../IncomingRequestMonitor/SubscriptionConfirmationNotice";
import { SummaryFact, SummaryFacts, SummaryView } from "./SummaryFacts";

/*
 * The latest request is shown as the monitor's logs keep it (#6402): with
 * secrets and personal data masked, and with no headers or body at all when
 * the monitor keeps no request content (its Settings page). A copy says
 * when its content was left out (isResponseContentOmitted) wherever it is
 * shown; only the monitor's overview says that secrets in it are masked
 * (areSecretsMasked).
 */
export const REQUEST_CONTENT_NOT_SHOWN: string = translationKey(
  "The monitor keeps no request content: its headers and body are not shown.",
);

export const INCOMING_REQUEST_CONTENT_NOT_SHOWN_TEST_ID: string =
  "incoming-request-content-not-shown";

/*
 * How often the heartbeat sweeps check a monitor, in the reader's words:
 * "Every 30 seconds". The incoming email summary says it too.
 */
export const getHeartbeatSweepScheduleText: (
  translator: Translator,
) => string = (translator: Translator): string => {
  return translator.translatePlural(
    {
      one: "Every {{count}} second",
      other: "Every {{count}} seconds",
    },
    HEARTBEAT_SWEEP_EVERY_SECONDS,
  );
};

export const INCOMING_REQUEST_SECRETS_MASKED_TEST_ID: string =
  "incoming-request-secrets-masked";

export interface ComponentProps {
  incomingMonitorRequest: IncomingMonitorRequest;
  incomingRequestMonitorHeartbeatCheckedAt?: Date | undefined;
  /*
   * The heartbeat sweep is checking the monitor on its schedule: the stamp
   * is as recent as a running sweep leaves it (HeartbeatSweepSchedule, issue
   * #8123). The fact then says the schedule rather than the stamp, which is
   * written only every few minutes.
   */
  isStatusCheckOnSchedule?: boolean | undefined;
  /*
   * The request is the copy the server cuts for readers, as a monitor's
   * latest request is (Monitor.incomingMonitorRequest): the details then
   * say that secrets and personal data in them are masked. Left out where
   * the request may have been kept before copies were cut - a monitoring
   * log row, the summary an incident or an alert keeps - so nothing claims
   * a masking an old copy never had.
   */
  areSecretsMasked?: boolean | undefined;
}

const IncomingRequestMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [showMoreDetails, setShowMoreDetails] = React.useState<boolean>(false);

  const fields: Array<Field<IncomingMonitorRequest>> = [];

  /*
   * The request as its logs keep it (Monitor.incomingMonitorRequest): a
   * monitor that keeps no request content keeps no headers and no body, so
   * there is nothing to fold out.
   */
  if (props.incomingMonitorRequest?.requestHeaders) {
    fields.push({
      key: "requestHeaders",
      title: "Request Headers",
      description: "Request headers of the request.",
      fieldType: FieldType.JSON,
    });
  }

  if (props.incomingMonitorRequest?.requestBody) {
    fields.push({
      key: "requestBody",
      title: "Request Body",
      description: "Request body of the request.",
      /*
       * A text body (text/plain that holds no JSON, #8430) is shown as the
       * text it is: as JSON it was neither formatted nor quiet, as the field
       * logged that it could not parse it.
       */
      fieldType:
        typeof props.incomingMonitorRequest.requestBody === "string"
          ? FieldType.Code
          : FieldType.JSON,
    });
  }

  /*
   * Two to a row, in a grid that follows the summary's width: the three
   * half-width cards of a flex row were a card and a half wider than the
   * Monitor Summary card, which scrolled sideways on a phone (#5101).
   */
  return (
    <SummaryView dataTestId="incoming-request-monitor-summary">
      {/*
       * A request that is Amazon SNS or Azure Event Grid asking to confirm
       * a subscription leads with the link that confirms it (#7723): the
       * one step left before the service sends anything here - unless
       * OneUptime answered it already (#8429).
       */}
      <SubscriptionConfirmationNotice
        requestBody={props.incomingMonitorRequest?.requestBody}
        answeredVerification={
          props.incomingMonitorRequest?.answeredVerification
        }
      />

      <SummaryFacts>
        <SummaryFact
          title="Last Request Received At"
          value={
            props.incomingMonitorRequest?.incomingRequestReceivedAt
              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  props.incomingMonitorRequest.incomingRequestReceivedAt,
                )
              : undefined
          }
        />
        <SummaryFact
          title="Request Method"
          value={props.incomingMonitorRequest.requestMethod}
        />
        {props.incomingRequestMonitorHeartbeatCheckedAt ? (
          <SummaryFact
            title="Monitor Status Check At"
            value={
              props.isStatusCheckOnSchedule
                ? getHeartbeatSweepScheduleText(translator)
                : OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                    props.incomingRequestMonitorHeartbeatCheckedAt,
                  )
            }
          />
        ) : (
          <></>
        )}
      </SummaryFacts>

      {props.incomingMonitorRequest?.isResponseContentOmitted ? (
        <p
          data-testid={INCOMING_REQUEST_CONTENT_NOT_SHOWN_TEST_ID}
          className="text-sm text-gray-500"
        >
          {translator.translateText(REQUEST_CONTENT_NOT_SHOWN)}
        </p>
      ) : (
        <></>
      )}

      {showMoreDetails && fields.length > 0 && (
        <div className="space-y-3">
          <Detail<IncomingMonitorRequest>
            id={"website-monitor-summary-detail"}
            item={props.incomingMonitorRequest}
            fields={fields}
            showDetailsInNumberOfColumns={1}
          />
          {props.areSecretsMasked ? (
            <p
              data-testid={INCOMING_REQUEST_SECRETS_MASKED_TEST_ID}
              className="text-sm text-gray-500"
            >
              {translator.translateText(SECRETS_IN_REQUEST_ARE_MASKED)}
            </p>
          ) : (
            <></>
          )}
        </div>
      )}

      {/*
       * One button, open or folded: its words follow the state and it
       * keeps its place, so focus stays on it after a press.
       */}
      {fields.length > 0 && (
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
      )}
    </SummaryView>
  );
};

export default IncomingRequestMonitorView;
