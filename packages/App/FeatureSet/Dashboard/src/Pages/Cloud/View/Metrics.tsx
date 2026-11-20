import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import {
  CloudAddedMetric,
  toStoredCloudAddedMetrics,
} from "Common/Types/Cloud/CloudAddedMetrics";
import MetricsViewer from "../../../Components/Metrics/MetricsViewer";
import {
  GetMetricRowAggregation,
  GetMetricRowGroup,
  GetMetricRowGroupGaps,
  MetricRowAggregation,
  MetricRowGroupGap,
} from "../../../Components/Metrics/Utils/MetricRowScope";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import CloudResourceMoreMetrics from "../../../Components/Cloud/ResourceMetrics/CloudResourceMoreMetrics";
import CloudUnreportedKeyMetricsList from "../../../Components/Cloud/ResourceMetrics/CloudUnreportedKeyMetricsList";
import CloudResourceMetricCollectionLine from "../../../Components/Cloud/ResourceMetrics/CloudResourceMetricCollectionLine";
import {
  CloudMonitoredResourceRowAggregation,
  getCloudMonitoredResourceAttributeDisplayKeys,
  getCloudMonitoredResourceAttributeFilters,
  getCloudMonitoredResourceRowAggregation,
  getCloudMonitoredResourceRowGroup,
  getCloudMonitoredResourceRowGroupGaps,
  getCloudResourceAddedSplitAttributes,
  getCloudResourceAddedStoredNames,
  isCloudMonitoredResourceScoped,
} from "../Utils/CloudMonitoredResourceScope";

/*
 * A cloud resource's metrics: what its provider's monitoring publishes
 * about it, scoped by the exact metric attributes ingest recorded for it
 * (CloudMonitoredResourceScope). An environment's metrics are in App
 * Platforms (AppPlatforms/View/Metrics), its apps' own telemetry.
 *
 * A Service Bus or Event Hubs namespace's metrics arrive once per queue,
 * topic and event hub, and its rows read as their total, as do the
 * explorer and the monitors opened from them.
 *
 * Its key metrics read in sections, each saying - folded away - which of
 * its key metrics the resource did not report in the range, and why
 * (#9569). Above them, when its connection last read them, and what it
 * could not read, with its cloud's own words (#10291). Under the list,
 * More Metrics lists what else its cloud
 * publishes, on demand, and adds one to what its connection reads (#9563):
 * an added metric reads in a section of its own, and charts and alerts as
 * a key metric does.
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
      /*
       * Its connection's additions and settings are read through the
       * resource for who may read the connection itself (#10310): every
       * reader of the project's cloud resources, but a team kept from its
       * connections, which reads the key metrics without them.
       */
      const item: CloudResource | null = await ModelAPI.getItem({
        modelType: CloudResource,
        id: modelId,
        select: PermissionGate.getSelectReadableThroughRelations(
          CloudResource,
          {
            _id: true,
            resourceIdentifier: true,
            name: true,
            // The scope reads the attributes of a resource only.
            cloudResourceKind: true,
            telemetryAttributes: true,
            // What its rows add up: a namespace's metrics, one per queue.
            cloudProvider: true,
            cloudResourceType: true,
            /*
             * What its connection reads for it besides its key metrics, and
             * how often: a metric that comes once an hour is missing only
             * past its delay (#10026).
             */
            cloudConnectionId: true,
            cloudConnection: {
              addedMetrics: true,
              provider: true,
              config: true,
            },
          },
        ),
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

  // Stable per type: the viewer refetches its rows when it changes.
  const rowAggregation: CloudMonitoredResourceRowAggregation | undefined =
    useMemo(() => {
      return getCloudMonitoredResourceRowAggregation(cloudResource);
    }, [cloudResource?.cloudProvider, cloudResource?.cloudResourceType]);

  /*
   * Its connection's additions: as loaded, then as Add and Remove leave
   * them, so the list re-sections without a reload.
   */
  const [addedMetrics, setAddedMetrics] = useState<unknown>(undefined);

  useEffect(() => {
    setAddedMetrics(cloudResource?.cloudConnection?.addedMetrics);
  }, [cloudResource]);

  const onAddedMetricsChange: (metrics: Array<CloudAddedMetric>) => void =
    useCallback((metrics: Array<CloudAddedMetric>): void => {
      setAddedMetrics(toStoredCloudAddedMetrics(metrics));
    }, []);

  // What someone added for it, by the names they are stored under.
  const addedStoredNames: Array<string> = useMemo(() => {
    return getCloudResourceAddedStoredNames({
      _id: cloudResource?._id,
      cloudResourceType: cloudResource?.cloudResourceType,
      cloudConnection: { addedMetrics },
    });
  }, [cloudResource?._id, cloudResource?.cloudResourceType, addedMetrics]);
  const addedNamesKey: string = addedStoredNames.join("\n");

  /*
   * An addition split by a dimension (#9808) opens its chart split by it, a
   * line per value; every other row as its type reads it.
   */
  const splitAttributes: Map<string, string> = useMemo(() => {
    return getCloudResourceAddedSplitAttributes({
      _id: cloudResource?._id,
      cloudResourceType: cloudResource?.cloudResourceType,
      cloudConnection: { addedMetrics },
    });
  }, [cloudResource?._id, cloudResource?.cloudResourceType, addedMetrics]);
  const splitAttributesKey: string = Array.from(splitAttributes.entries())
    .map(([name, attribute]: [string, string]): string => {
      return `${name}=${attribute}`;
    })
    .join("\n");

  const getRowAggregation: GetMetricRowAggregation | undefined = useMemo(() => {
    if (splitAttributes.size === 0) {
      return rowAggregation?.getRowAggregation;
    }

    return (
      metricName: string,
      startAndEndDate: InBetween<Date>,
    ): MetricRowAggregation | undefined => {
      const read: MetricRowAggregation | undefined =
        rowAggregation?.getRowAggregation(metricName, startAndEndDate);
      const attribute: string | undefined = splitAttributes.get(
        metricName.trim().toLowerCase(),
      );

      return attribute
        ? {
            ...(read || { aggregationType: AggregationType.Avg }),
            groupByAttributeKeys: [attribute],
          }
        : read;
    };
  }, [rowAggregation, splitAttributesKey]);

  /*
   * Its key metrics in sections - Availability, Traffic, Errors, Latency
   * and the rest, most telling first - then what someone added, and its
   * other metrics after them.
   */
  const getRowGroup: GetMetricRowGroup | undefined = useMemo(() => {
    return getCloudMonitoredResourceRowGroup(cloudResource, addedStoredNames);
  }, [
    cloudResource?.cloudProvider,
    cloudResource?.cloudResourceType,
    addedNamesKey,
  ]);

  // The key metrics each section did not get in the range, and why.
  const getRowGroupGaps: GetMetricRowGroupGaps | undefined = useMemo(() => {
    return getCloudMonitoredResourceRowGroupGaps(cloudResource);
  }, [
    cloudResource?.cloudProvider,
    cloudResource?.cloudResourceType,
    cloudResource?.telemetryAttributes,
    cloudResource?.cloudConnection?.config,
  ]);

  const renderRowGroupGap: (gap: MetricRowGroupGap) => ReactElement =
    useCallback(
      (gap: MetricRowGroupGap): ReactElement => {
        return (
          <CloudUnreportedKeyMetricsList
            cloudResourceId={modelId}
            keys={gap.keys}
          />
        );
      },
      [modelId.toString()],
    );

  if (isLoading) {
    return <PageSkeleton shape="chart" />;
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
      {/*
       * When its connection last read its metrics, and what it could not
       * (#10291): above them, where a person looks when one is missing.
       */}
      {cloudResource.cloudConnectionId ? (
        <CloudResourceMetricCollectionLine cloudResourceId={modelId} />
      ) : (
        <></>
      )}
      <MetricsViewer
        attributeFilters={attributeFilters}
        attributeFilterDisplayKeys={attributeFilterDisplayKeys}
        eventScope={eventScope}
        getRowAggregation={getRowAggregation}
        getRowGroup={getRowGroup}
        getRowGroupGaps={getRowGroupGaps}
        renderRowGroupGap={renderRowGroupGap}
        defaultRowValueCaption={rowAggregation?.defaultRowValueCaption}
      />
      {cloudResource.cloudConnectionId ? (
        <div className="mt-6">
          <CloudResourceMoreMetrics
            cloudResourceId={modelId}
            provider={String(cloudResource.cloudProvider || "")}
            resourceType={String(cloudResource.cloudResourceType || "")}
            onAddedMetricsChange={onAddedMetricsChange}
          />
        </div>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default CloudResourceMetrics;
