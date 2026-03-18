import PageComponentProps from "../PageComponentProps";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import TelemetryDocumentation from "../../Components/Telemetry/Documentation";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useState,
} from "react";
import ExceptionsTable from "../../Components/Exceptions/ExceptionsTable";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";

const UnresolvedExceptionsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  const [hasData, setHasData] = useState<boolean | undefined>(undefined);

  const handleFetchSuccess: (
    data: Array<TelemetryException>,
    totalCount: number,
  ) => void = useCallback(
    (_data: Array<TelemetryException>, totalCount: number) => {
      setHasData(totalCount > 0);
    },
    [],
  );

  if (disableTelemetryForThisProject) {
    return (
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  if (hasData === false) {
    return <TelemetryDocumentation telemetryType="exceptions" />;
  }

  return (
    <ExceptionsTable
      query={{
        isResolved: false,
        isArchived: false,
      }}
      title="Unresolved Exceptions"
      description="All the exceptions that have not been resolved."
      onFetchSuccess={handleFetchSuccess}
    />
  );
};

export default UnresolvedExceptionsPage;
