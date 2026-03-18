import PageComponentProps from "../PageComponentProps";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useState,
} from "react";
import DashboardLogsViewer from "../../Components/Logs/LogsViewer";
import TelemetryDocumentation from "../../Components/Telemetry/Documentation";

const LogsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  const [hasData, setHasData] = useState<boolean | undefined>(undefined);
  const [showDocs, setShowDocs] = useState<boolean>(false);

  const handleCountChange: (count: number) => void = useCallback(
    (count: number) => {
      setHasData(count > 0);
    },
    [],
  );

  if (disableTelemetryForThisProject) {
    return (
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  if (showDocs) {
    return (
      <TelemetryDocumentation
        telemetryType="logs"
        onClose={() => {
          setShowDocs(false);
        }}
      />
    );
  }

  if (hasData === false) {
    return <TelemetryDocumentation telemetryType="logs" />;
  }

  return (
    <DashboardLogsViewer
      showFilters={true}
      serviceIds={[]}
      limit={100}
      enableRealtime={true}
      id="logs"
      onCountChange={handleCountChange}
      onShowDocumentation={() => {
        setShowDocs(true);
      }}
    />
  );
};

export default LogsPage;
