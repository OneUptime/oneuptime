import PageComponentProps from "../PageComponentProps";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import SecurityEventConnectionsTable from "../../Components/SecurityEvents/SecurityEventConnectionsTable";
import SecurityEventDestinationsTable from "../../Components/SecurityEvents/SecurityEventDestinationsTable";
import SecurityLogsSourceCard from "../../Components/SecurityEvents/SecurityLogsSourceCard";
import SecurityTelemetrySourcesCard from "../../Components/SecurityEvents/SecurityTelemetrySourcesCard";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Security Events > Connections: where security events come from and where
 * they go, top to bottom.
 *
 *   Your logs             the logs the project already sends, read for
 *                         sign-ins, sudo, Kubernetes audit, CloudTrail and
 *                         web attacks - one switch
 *   Your OneUptime data   the project's traces, network flows, audit log
 *                         and session replays - one switch each
 *   Your security tools   the security products OneUptime imports from
 *   Send to your SIEM     the SIEMs OneUptime sends what it finds to
 *
 * Each card owns its own state, so the page is only the plan gate in front
 * of them.
 */
const SecurityEventsConnectionsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  /*
   * Same reseller-telemetry gate as every other Security Events page —
   * polled records land in the telemetry-billed security event stream, so a
   * plan without telemetry features has nowhere to put them.
   */
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  return (
    <div className="space-y-6">
      <SecurityLogsSourceCard />
      <SecurityTelemetrySourcesCard />
      <SecurityEventConnectionsTable />
      <SecurityEventDestinationsTable />
    </div>
  );
};

export default SecurityEventsConnectionsPage;
