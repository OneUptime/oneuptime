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
import {
  getCloudMonitoredResourceAttributeDisplayKeys,
  getCloudMonitoredResourceAttributeFilters,
  isCloudMonitoredResourceScoped,
} from "../Utils/CloudMonitoredResourceScope";

/*
 * A cloud resource's metrics: what its provider's monitoring publishes
 * about it, scoped by the exact metric attributes ingest recorded for it
 * (CloudMonitoredResourceScope). An environment's metrics are in App
 * Platforms (AppPlatforms/View/Metrics), its apps' own telemetry.
 */
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
          // The scope reads the attributes of a resource only.
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

  /*
   * The viewer keys its query memo on the identity of these objects, so
   * they are built once per row rather than once per render.
   */
  const attributeFilters: Record<string, string> = useMemo(() => {
    return getCloudMonitoredResourceAttributeFilters(cloudResource);
  }, [cloudResource?.cloudResourceKind, cloudResource?.telemetryAttributes]);

  const attributeFilterDisplayKeys: Record<string, string> = useMemo(() => {
    return getCloudMonitoredResourceAttributeDisplayKeys(attributeFilters);
  }, [attributeFilters]);

  /*
   * The row a chart opened from here is about: its markers are this
   * resource's incidents, alerts and changes, whatever its metric filter
   * says.
   */
  const eventScope: Record<string, string> = useMemo(() => {
    return { cloudResourceId: modelId.toString() };
  }, [modelId.toString()]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cloudResource?.resourceIdentifier) {
    return <ErrorMessage message="Cloud resource not found." />;
  }

  /*
   * A resource without recorded attributes has no filter, and the viewer
   * must not fall back to every metric in the project.
   */
  if (!isCloudMonitoredResourceScoped(cloudResource)) {
    return (
      <ErrorMessage message="This cloud resource has no metric attributes recorded yet. They are recorded with the next metrics its provider reports about it." />
    );
  }

  return (
    <Fragment>
      <MetricsViewer
        attributeFilters={attributeFilters}
        attributeFilterDisplayKeys={attributeFilterDisplayKeys}
        eventScope={eventScope}
      />
    </Fragment>
  );
};

export default CloudResourceMetrics;
