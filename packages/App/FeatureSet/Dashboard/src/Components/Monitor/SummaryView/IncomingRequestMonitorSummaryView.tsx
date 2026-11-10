import OneUptimeDate from "Common/Types/Date";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Detail from "Common/UI/Components/Detail/Detail";
import Field from "Common/UI/Components/Detail/Field";
import FieldType from "Common/UI/Components/Types/FieldType";
import { translationKey } from "Common/Types/Translator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { SECRETS_IN_REQUEST_ARE_MASKED } from "../../EventView/EventEvaluationDetailsCopy";
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

export const INCOMING_REQUEST_SECRETS_MASKED_TEST_ID: string =
  "incoming-request-secrets-masked";

export interface ComponentProps {
  incomingMonitorRequest: IncomingMonitorRequest;
  incomingRequestMonitorHeartbeatCheckedAt?: Date | undefined;
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
