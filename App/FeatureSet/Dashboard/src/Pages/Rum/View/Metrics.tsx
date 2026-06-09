import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import MetricsViewer from "../../../Components/Metrics/MetricsViewer";

const RumApplicationMetrics: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [rumApplication, setRumApplication] = useState<RumApplication | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: RumApplication | null = await ModelAPI.getItem({
        modelType: RumApplication,
        id: modelId,
        select: {
          appIdentifier: true,
          name: true,
          sdkLanguage: true,
        },
      });

      if (!item?.appIdentifier) {
        setError("RUM application not found.");
        setIsLoading(false);
        return;
      }

      setRumApplication(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!rumApplication?.appIdentifier) {
    return <ErrorMessage message="RUM application not found." />;
  }

  return (
    <Fragment>
      <MetricsViewer
        attributeFilters={{
          "resource.service.name": rumApplication.appIdentifier,
          ...(rumApplication.sdkLanguage
            ? { "resource.telemetry.sdk.language": rumApplication.sdkLanguage }
            : {}),
        }}
        attributeFilterDisplayKeys={{
          "resource.service.name": "Application",
          ...(rumApplication.sdkLanguage
            ? { "resource.telemetry.sdk.language": "SDK" }
            : {}),
        }}
      />
    </Fragment>
  );
};

export default RumApplicationMetrics;
