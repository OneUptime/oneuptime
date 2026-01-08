import PageComponentProps from "../PageComponentProps";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import React, { FunctionComponent, ReactElement } from "react";
import ExceptionsTable from "../../Components/Exceptions/ExceptionsTable";

const ResolvedExceptionsPage: FunctionComponent<PageComponentProps> = (
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
    <ExceptionsTable
      query={{
        isResolved: true,
        isArchived: false,
      }}
      title="Resolved Exceptions"
      description="All the exceptions that have been resolved."
    />
  );
};

export default ResolvedExceptionsPage;
