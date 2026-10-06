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
import {
  getCloudMonitoredResourceAttributeDisplayKeys,
  getCloudMonitoredResourceAttributeFilters,
  isCloudMonitoredResourceScoped,
} from "../Utils/CloudMonitoredResourceScope";
import { isCloudResourceKindResource } from "Common/Types/Cloud/CloudResourceKind";

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
          cloudResourceKind: true,
          telemetryAttributes: true,
        },
      });

      if (!item?.resourceIdentifier) {
        setError("Cloud resource not found.");
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

  const isResource: boolean = isCloudResourceKindResource(
    cloudResource?.cloudResourceKind,
  );

  /*
   * The viewer keys its query memo on the identity of these objects, so
   * they are built once per row rather than once per render. An
   * environment is scoped by its cloud.* resource attributes; a resource
   * discovered from cloud monitoring by the exact metric attributes ingest
   * recorded for it (CloudMonitoredResourceScope).
   */
  const attributeFilters: Record<string, string> = useMemo(() => {
    return isResource
      ? getCloudMonitoredResourceAttributeFilters(cloudResource)
      : getCloudResourceAttributeFilters(cloudResource);
  }, [
    isResource,
    cloudResource?.cloudPlatform,
    cloudResource?.cloudAccountId,
    cloudResource?.cloudRegion,
    cloudResource?.telemetryAttributes,
  ]);

  const attributeFilterDisplayKeys: Record<string, string> = useMemo(() => {
    return isResource
      ? getCloudMonitoredResourceAttributeDisplayKeys(attributeFilters)
      : getCloudResourceAttributeDisplayKeys(cloudResource);
  }, [isResource, attributeFilters]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cloudResource?.resourceIdentifier) {
    return <ErrorMessage message="Cloud resource not found." />;
  }

  if (isResource) {
    /*
     * A resource without recorded attributes has no filter either, and the
     * same fallback to every metric in the project must not happen.
     */
    if (!isCloudMonitoredResourceScoped(cloudResource)) {
      return (
        <ErrorMessage message="This cloud resource has no metric attributes recorded yet. They are recorded with the next metrics its provider reports about it." />
      );
    }
  } else if (!isCloudResourceScoped(cloudResource)) {
    /*
     * No platform means no attribute filter, and the viewer would fall back
     * to every metric in the project. Show what is actually true instead.
     */
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
