import PageComponentProps from "../PageComponentProps";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useState,
} from "react";
import MetricsTable from "../../Components/Metrics/MetricsTable";
import TelemetryDocumentation from "../../Components/Telemetry/Documentation";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import MetricType from "Common/Models/DatabaseModels/MetricType";

const MetricsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  const [hasData, setHasData] = useState<boolean>(false);
  const [showDocs, setShowDocs] = useState<boolean>(false);

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

  return (
    <Fragment>
      <MetricsTable onFetchSuccess={handleFetchSuccess} />
      {!hasData && <TelemetryDocumentation telemetryType="metrics" />}
      {hasData && !showDocs && (
        <div className="flex justify-center mt-4 mb-4">
          <Button
            title="View Setup Documentation"
            icon={IconProp.Book}
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.OUTLINE}
            onClick={() => {
              setShowDocs(true);
            }}
          />
        </div>
      )}
      {hasData && showDocs && (
        <TelemetryDocumentation telemetryType="metrics" />
      )}
    </Fragment>
  );
};

export default MetricsPage;
