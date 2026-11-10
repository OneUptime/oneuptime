import OneUptimeDate from "Common/Types/Date";
import React, { FunctionComponent, ReactElement } from "react";
import TelemetryMonitorSummary from "./Types/TelemetryMonitorSummary";
import { SummaryFact, SummaryFacts, SummaryView } from "./SummaryFacts";
import { getTelemetryObservationText } from "./TelemetryObservationText";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

export interface ComponentProps {
  telemetryMonitorSummary?: TelemetryMonitorSummary | undefined;
}

const WebsiteMonitorSummaryView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const summary: TelemetryMonitorSummary | undefined =
    props.telemetryMonitorSummary;

  return (
    <SummaryView dataTestId="telemetry-monitor-summary">
      <SummaryFacts>
        <SummaryFact
          title={summary?.lastCheckedLabel || "Monitored At"}
          value={
            summary?.lastCheckedAt
              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  summary?.lastCheckedAt,
                )
              : "-"
          }
        />
        {/*
         * What a check in Monitoring Logs saw: the same words as its
         * Observed column.
         */}
        {summary?.observation ? (
          <SummaryFact
            title="Observed"
            value={getTelemetryObservationText(translator, summary.observation)}
          />
        ) : (
          <></>
        )}
        {/* A check that has run has no next one. */}
        {summary?.isPastCheck ? (
          <></>
        ) : (
          <SummaryFact
            title="Next Check At"
            value={
              summary?.nextCheckAt
                ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                    summary?.nextCheckAt,
                  )
                : "-"
            }
          />
        )}
      </SummaryFacts>
    </SummaryView>
  );
};

export default WebsiteMonitorSummaryView;
