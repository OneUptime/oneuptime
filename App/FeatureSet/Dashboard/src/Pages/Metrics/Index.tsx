import PageComponentProps from "../PageComponentProps";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import TelemetryDocumentation from "../../Components/Telemetry/Documentation";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useState,
} from "react";
import MetricsTable from "../../Components/Metrics/MetricsTable";
import MetricType from "Common/Models/DatabaseModels/MetricType";

const MetricsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  const [hasData, setHasData] = useState<boolean | undefined>(undefined);

  const handleFetchSuccess: (
    data: Array<MetricType>,
    totalCount: number,
  ) => void = useCallback(
    (_data: Array<MetricType>, totalCount: number) => {
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
    return <TelemetryDocumentation telemetryType="metrics" />;
  }

  return <MetricsTable onFetchSuccess={handleFetchSuccess} />;
};

export default MetricsPage;
