import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import MetricsViewer from "../../../Components/Metrics/MetricsViewer";
import CloudResourceConnectBanner from "../../../Components/Cloud/CloudResourceConnectBanner";
import {
  getCloudResourceAttributeDisplayKeys,
  getCloudResourceAttributeFilters,
  isCloudResourceScoped,
} from "../Utils/CloudResourceTelemetryScope";

const CloudResourceMetrics: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cloudResource, setCloudResource] = useState<CloudResource | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: CloudResource | null = await ModelAPI.getItem({
        modelType: CloudResource,
        id: modelId,
        select: {
          resourceIdentifier: true,
          name: true,
          cloudPlatform: true,
          cloudAccountId: true,
          cloudRegion: true,
        },
      });

      if (!item?.resourceIdentifier) {
        setError("Cloud environment not found.");
        setIsLoading(false);
        return;
      }

      setCloudResource(item);
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

  /*
   * The viewer keys its query memo on the identity of these objects, so
   * they are built once per environment rather than once per render.
   */
  const attributeFilters: Record<string, string> = useMemo(() => {
    return getCloudResourceAttributeFilters(cloudResource);
  }, [
    cloudResource?.cloudPlatform,
    cloudResource?.cloudAccountId,
    cloudResource?.cloudRegion,
  ]);

  const attributeFilterDisplayKeys: Record<string, string> = useMemo(() => {
    return getCloudResourceAttributeDisplayKeys(cloudResource);
  }, [
    cloudResource?.cloudPlatform,
    cloudResource?.cloudAccountId,
    cloudResource?.cloudRegion,
  ]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cloudResource?.resourceIdentifier) {
    return <ErrorMessage message="Cloud environment not found." />;
  }

  /*
   * No platform means no attribute filter, and the viewer would fall back
   * to every metric in the project. Show what is actually true instead.
   */
  if (!isCloudResourceScoped(cloudResource)) {
    return (
      <CloudResourceConnectBanner
        modelId={modelId}
        environmentKey={cloudResource.resourceIdentifier}
      />
    );
  }

  return (
    <Fragment>
      <MetricsViewer
        attributeFilters={attributeFilters}
        attributeFilterDisplayKeys={attributeFilterDisplayKeys}
      />
    </Fragment>
  );
};

export default CloudResourceMetrics;
