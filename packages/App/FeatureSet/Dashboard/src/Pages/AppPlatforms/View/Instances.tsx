import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import CloudResourceInstance from "Common/Models/DatabaseModels/CloudResourceInstance";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Route from "Common/Types/API/Route";
import Pill from "Common/UI/Components/Pill/Pill";
import { Gray500, Green } from "Common/Types/BrandColors";
import AppLink from "../../../Components/AppLink/AppLink";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  formatBytes,
  formatPercent,
} from "../../../Components/TelemetryResource/telemetryMetrics";
import {
  CLOUD_INSTANCE_LIVE_WINDOW_MINUTES,
  isCloudInstanceLive,
} from "../Utils/CloudResourceTelemetryScope";
import { getShortRevision } from "../Utils/CloudApps";
import { CLOUD_INSTANCE_IDENTITY_ATTRIBUTES } from "Common/Utils/Telemetry/CloudInstanceIdentity";
import { CLOUD_INSTANCE_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/CloudMetricDescriptions";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * The copy names the identity chain from the same constant ingest walks, so
 * the page can never list a different set of attributes than the one that
 * actually names the rows.
 */
const IDENTITY_ATTRIBUTE_LIST: string =
  CLOUD_INSTANCE_IDENTITY_ATTRIBUTES.join(", ");

export interface CloudInstancesTableProps {
  environmentId: ObjectID;
  /*
   * One app's instances (its page's Instances tab); unset, every instance
   * of the environment, each naming the app it runs.
   */
  app?:
    | {
        id: ObjectID;
        name?: string | undefined;
      }
    | undefined;
}

/*
 * The running tasks, replicas or instances of an environment, or of one of
 * its apps: the app each one runs (on the environment's list), the revision
 * it runs, whether it is live, and its latest CPU and memory.
 */
export const CloudInstancesTable: FunctionComponent<
  CloudInstancesTableProps
> = (props: CloudInstancesTableProps): ReactElement => {
  const translator: Translator = useTranslator();
  const appId: ObjectID | undefined = props.app?.id;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: Query<CloudResourceInstance> = (
    appId
      ? { cloudResourceId: props.environmentId, cloudAppId: appId }
      : { cloudResourceId: props.environmentId }
  ) as any;

  const getAppRoute: (instance: CloudResourceInstance) => Route = (
    instance: CloudResourceInstance,
  ): Route => {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_APP_DETAIL] as Route,
      {
        modelId: props.environmentId,
        subModelId: new ObjectID(instance.cloudAppId!.toString()),
      },
    );
  };

  return (
    <ModelTable<CloudResourceInstance>
      modelType={CloudResourceInstance}
      id={
        appId ? "cloud-app-instances-table" : "cloud-resource-instances-table"
      }
      userPreferencesKey={
        appId ? "cloud-app-instances-table" : "cloud-resource-instances-table"
      }
      name="Cloud Environment Instances"
      // The model's nouns are Cloud's (cloud resource instances).
      singularName="Instance"
      pluralName="Instances"
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      showRefreshButton={true}
      query={query}
      sortBy="lastSeenAt"
      sortOrder={SortOrder.Descending}
      selectMoreFields={{
        latestCpuPercent: true,
        latestMemoryBytes: true,
        cloudAppId: true,
      }}
      cardProps={{
        title: "Instances",
        description: translator.translateTemplate(
          appId
            ? "Running tasks and instances of this app, as last reported. Those not seen in the last {{minutes}} minutes are Stale."
            : "Running tasks and instances of this environment, as last reported. Those not seen in the last {{minutes}} minutes are Stale.",
          {
            attributes: IDENTITY_ATTRIBUTE_LIST,
            minutes: CLOUD_INSTANCE_LIVE_WINDOW_MINUTES,
          },
        ),
      }}
      noItemsMessage={translator.translateTemplate(
        "No instances reported yet. Instances appear when telemetry carries one of these resource attributes: {{attributes}}.",
        { attributes: IDENTITY_ATTRIBUTE_LIST },
      )}
      filters={[
        {
          field: { instanceName: true },
          title: "Instance",
          type: FieldType.Text,
        },
        {
          field: { revision: true },
          title: "Revision",
          type: FieldType.Text,
        },
      ]}
      columns={[
        {
          field: { instanceName: true },
          title: "Instance",
          type: FieldType.Element,
          getElement: (item: CloudResourceInstance): ReactElement => {
            return (
              <span className="font-mono text-sm text-gray-900">
                {(item.instanceName as string) || "—"}
              </span>
            );
          },
        },
        ...(appId
          ? []
          : [
              {
                field: { cloudApp: { name: true } },
                title: "App",
                type: FieldType.Element,
                hideOnMobile: true,
                getElement: (item: CloudResourceInstance): ReactElement => {
                  const name: string = item.cloudApp?.name || "";

                  if (!item.cloudAppId || !name) {
                    return <span className="text-sm text-gray-400">—</span>;
                  }

                  return (
                    <AppLink
                      to={getAppRoute(item)}
                      className="text-sm font-medium text-gray-900 hover:underline"
                    >
                      <bdi>{name}</bdi>
                    </AppLink>
                  );
                },
              },
            ]),
        {
          field: { revision: true },
          title: "Revision",
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (item: CloudResourceInstance): ReactElement => {
            const revision: string = getShortRevision({
              revision: item.revision,
              appName: props.app?.name || item.cloudApp?.name,
            });

            return revision ? (
              <span className="font-mono text-sm text-gray-700">
                <bdi>{revision}</bdi>
              </span>
            ) : (
              <span className="text-sm text-gray-400">—</span>
            );
          },
        },
        {
          field: { lastSeenAt: true },
          title: "Status",
          type: FieldType.Element,
          /*
           * Derived from lastSeenAt, which the Last Seen column already
           * sorts on; without this both headers would claim the sort.
           */
          disableSort: true,
          getElement: (item: CloudResourceInstance): ReactElement => {
            const isLive: boolean = isCloudInstanceLive(item.lastSeenAt);
            return (
              <Pill
                text={isLive ? "Running" : "Stale"}
                color={isLive ? Green : Gray500}
                tooltip={
                  isLive
                    ? translator.translateTemplate(
                        "Seen in the last {{minutes}} minutes",
                        { minutes: CLOUD_INSTANCE_LIVE_WINDOW_MINUTES },
                      )
                    : translator.translateTemplate(
                        "Not seen for more than {{minutes}} minutes",
                        { minutes: CLOUD_INSTANCE_LIVE_WINDOW_MINUTES },
                      )
                }
              />
            );
          },
        },
        {
          field: { latestCpuPercent: true },
          title: "CPU",
          headerTooltip: CLOUD_INSTANCE_METRIC_DESCRIPTIONS.cpu,
          type: FieldType.Element,
          getElement: (item: CloudResourceInstance): ReactElement => {
            return (
              <span className="text-sm text-gray-700">
                {formatPercent(
                  typeof item.latestCpuPercent === "number"
                    ? item.latestCpuPercent
                    : null,
                )}
              </span>
            );
          },
        },
        {
          field: { latestMemoryBytes: true },
          title: "Memory",
          headerTooltip: CLOUD_INSTANCE_METRIC_DESCRIPTIONS.memory,
          type: FieldType.Element,
          getElement: (item: CloudResourceInstance): ReactElement => {
            return (
              <span className="text-sm text-gray-700">
                {formatBytes(
                  typeof item.latestMemoryBytes === "number"
                    ? item.latestMemoryBytes
                    : null,
                )}
              </span>
            );
          },
        },
        {
          field: { lastSeenAt: true },
          title: "Last Seen",
          type: FieldType.DateTime,
        },
      ]}
    />
  );
};

const CloudResourceInstances: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CloudInstancesTable environmentId={modelId} />
    </Fragment>
  );
};

export default CloudResourceInstances;
