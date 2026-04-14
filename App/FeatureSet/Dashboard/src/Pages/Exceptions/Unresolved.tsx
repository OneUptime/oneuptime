import PageComponentProps from "../PageComponentProps";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import TelemetryDocumentation from "../../Components/Telemetry/Documentation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ExceptionsViewer from "../../Components/Exceptions/ExceptionsViewer";
import ExceptionsNavTabs from "../../Components/Exceptions/ExceptionsNavTabs";
import Service from "Common/Models/DatabaseModels/Service";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";

const UnresolvedExceptionsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  const [serviceCount, setServiceCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchServiceCount: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const count: number = await ModelAPI.count({
        modelType: Service,
        query: {},
      });
      setServiceCount(count);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchServiceCount().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (disableTelemetryForThisProject) {
    return (
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (serviceCount === 0) {
    return (
      <Fragment>
        <ExceptionsNavTabs active="unresolved" />
        <TelemetryDocumentation telemetryType="exceptions" />
      </Fragment>
    );
  }

  return (
    <Fragment>
      <ExceptionsNavTabs active="unresolved" />
      <ExceptionsViewer defaultStatus="unresolved" />
    </Fragment>
  );
};

export default UnresolvedExceptionsPage;
