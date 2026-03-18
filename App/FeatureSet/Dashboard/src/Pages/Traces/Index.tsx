import PageComponentProps from "../PageComponentProps";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import TelemetryDocumentation from "../../Components/Telemetry/Documentation";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useState,
} from "react";
import TraceTable from "../../Components/Traces/TraceTable";
import Span from "Common/Models/AnalyticsModels/Span";

const TracesPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  const [hasData, setHasData] = useState<boolean | undefined>(undefined);

  const handleFetchSuccess: (data: Array<Span>, totalCount: number) => void =
    useCallback((_data: Array<Span>, totalCount: number) => {
      setHasData(totalCount > 0);
    }, []);

  if (disableTelemetryForThisProject) {
    return (
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  if (hasData === false) {
    return <TelemetryDocumentation telemetryType="traces" />;
  }

  return <TraceTable onFetchSuccess={handleFetchSuccess} />;
};

export default TracesPage;
