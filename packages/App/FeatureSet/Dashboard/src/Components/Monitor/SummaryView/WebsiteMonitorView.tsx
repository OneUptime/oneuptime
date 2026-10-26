import OneUptimeDate from "Common/Types/Date";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Detail from "Common/UI/Components/Detail/Detail";
import Field from "Common/UI/Components/Detail/Field";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { FunctionComponent, ReactElement } from "react";
import HttpTimingsView from "./HttpTimingsView";
import ProbeAttemptsView from "./ProbeAttemptsView";
import SummaryErrorFacts from "./SummaryErrorFacts";
import { SummaryFact, SummaryFacts, SummaryView } from "./SummaryFacts";

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

  const probeAttempts: Array<ProbeAttempt> =
    props.probeMonitorResponse.probeAttempts || [];
  const totalAttempts: number =
    props.probeMonitorResponse.totalAttempts ?? probeAttempts.length;
  const hadRetries: boolean = totalAttempts > 1;

  return (
    <SummaryView dataTestId="website-monitor-summary">
      <SummaryFacts>
        <SummaryFact
          isWide={true}
          title="URL"
          value={
            props.probeMonitorResponse.monitorDestination?.toString() || "-"
          }
        />
        <SummaryFact title="Probe" value={props.probeName || "-"} />
        <SummaryFact
          title="Response Status Code"
          value={props.probeMonitorResponse?.responseCode?.toString() || "-"}
        />
        <SummaryFact
          title="Response Time (in ms)"
          value={responseTimeInMs ? responseTimeInMs + " ms" : "-"}
        />
        <SummaryFact
          title="Monitored At"
          value={
            props.probeMonitorResponse?.monitoredAt
              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  props.probeMonitorResponse.monitoredAt,
                )
              : "-"
          }
        />
      </SummaryFacts>

      <SummaryErrorFacts probeMonitorResponse={props.probeMonitorResponse} />

      {/* Why it failed comes first, then where the time went. */}
      {props.probeMonitorResponse.httpTimings && (
        <HttpTimingsView httpTimings={props.probeMonitorResponse.httpTimings} />
      )}

      {showMoreDetails && hadRetries && (
        <ProbeAttemptsView
          attempts={probeAttempts}
          totalAttempts={totalAttempts}
        />
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

      {!showMoreDetails && (fields.length > 0 || hadRetries) && (
        <div className="-ml-3">
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

      {showMoreDetails && (fields.length > 0 || hadRetries) && (
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

export default WebsiteMonitorSummaryView;
