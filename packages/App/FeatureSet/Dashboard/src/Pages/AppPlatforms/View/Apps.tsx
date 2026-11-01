import PageComponentProps from "../../PageComponentProps";
import CloudAppsTable from "../../../Components/AppPlatforms/CloudAppsTable";
import CloudResourceConnectBanner from "../../../Components/Cloud/CloudResourceConnectBanner";
import { isCloudResourceScoped } from "../Utils/CloudResourceTelemetryScope";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * An environment's Apps: what runs in it, one row per app - an ECS service,
 * a Cloud Run service, a Container App - as a Kubernetes cluster lists its
 * Deployments.
 */
const AppPlatformEnvironmentApps: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [environment, setEnvironment] = useState<CloudResource | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let ignore: boolean = false;

    ModelAPI.getItem({
      modelType: CloudResource,
      id: modelId,
      select: {
        resourceIdentifier: true,
        cloudPlatform: true,
        cloudAccountId: true,
        cloudRegion: true,
      },
    })
      .then((item: CloudResource | null): void => {
        if (ignore) {
          return;
        }
        if (!item) {
          setError("Cloud environment not found.");
        }
        setEnvironment(item);
        setIsLoading(false);
      })
      .catch((err: Error): void => {
        if (!ignore) {
          setError(API.getFriendlyMessage(err));
          setIsLoading(false);
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [modelId.toString()]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error || !environment) {
    return <ErrorMessage message={error || "Cloud environment not found."} />;
  }

  // An environment made by hand, with no telemetry yet, has no apps.
  if (!isCloudResourceScoped(environment)) {
    return (
      <CloudResourceConnectBanner
        modelId={modelId}
        environmentKey={environment.resourceIdentifier}
      />
    );
  }

  return (
    <CloudAppsTable
      id="app-platforms-environment-apps-table"
      environment={environment}
    />
  );
};

export default AppPlatformEnvironmentApps;
