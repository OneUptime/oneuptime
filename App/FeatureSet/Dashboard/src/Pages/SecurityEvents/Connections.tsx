import PageComponentProps from "../PageComponentProps";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import SecurityEventConnectionsTable from "../../Components/SecurityEvents/SecurityEventConnectionsTable";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Security Events > Connections: every managed connector, Google SecOps
 * included, in one list. The table owns its own state, so the page is only
 * the plan gate in front of it.
 */
const SecurityEventsConnectionsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  /*
   * Same reseller-telemetry gate as every other Security Events tab —
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

  return <SecurityEventConnectionsTable />;
};

export default SecurityEventsConnectionsPage;
