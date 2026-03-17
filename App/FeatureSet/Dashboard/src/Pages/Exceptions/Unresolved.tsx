import PageComponentProps from "../PageComponentProps";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ExceptionsTable from "../../Components/Exceptions/ExceptionsTable";
import TelemetryDocumentation from "../../Components/Telemetry/Documentation";

const UnresolvedExceptionsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  return (
    <Fragment>
      <ExceptionsTable
        query={{
          isResolved: false,
          isArchived: false,
        }}
        title="Unresolved Exceptions"
        description="All the exceptions that have not been resolved."
      />
      <TelemetryDocumentation />
    </Fragment>
  );
};

export default UnresolvedExceptionsPage;
