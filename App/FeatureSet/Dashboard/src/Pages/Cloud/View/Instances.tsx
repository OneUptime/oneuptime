import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import CloudResourceInstance from "Common/Models/DatabaseModels/CloudResourceInstance";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Pill from "Common/UI/Components/Pill/Pill";
import { Gray500, Green } from "Common/Types/BrandColors";
import {
  formatBytes,
  formatPercent,
} from "../../../Components/TelemetryResource/telemetryMetrics";
import {
  CLOUD_INSTANCE_LIVE_WINDOW_MINUTES,
  isCloudInstanceLive,
} from "../Utils/CloudResourceTelemetryScope";
import { CLOUD_INSTANCE_IDENTITY_ATTRIBUTES } from "Common/Utils/Telemetry/CloudInstanceIdentity";

/*
 * The copy names the identity chain from the same constant ingest walks, so
 * the page can never list a different set of attributes than the one that
 * actually names the rows.
 */
const IDENTITY_ATTRIBUTE_LIST: string =
  CLOUD_INSTANCE_IDENTITY_ATTRIBUTES.join(", ");

const CloudResourceInstances: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: Query<CloudResourceInstance> = {
    cloudResourceId: modelId,
  } as any;

  return (
    <Fragment>
      <ModelTable<CloudResourceInstance>
        modelType={CloudResourceInstance}
        id="cloud-resource-instances-table"
        userPreferencesKey="cloud-resource-instances-table"
        name="Cloud Environment Instances"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        showRefreshButton={true}
        query={query}
        sortBy="lastSeenAt"
        sortOrder={SortOrder.Descending}
        selectMoreFields={{ latestCpuPercent: true, latestMemoryBytes: true }}
        cardProps={{
          title: "Instances",
          description: `Running tasks, replicas and instances of this cloud environment, as last reported via OpenTelemetry. An instance is named from the first of these resource attributes its telemetry carries, platform identities first: ${IDENTITY_ATTRIBUTE_LIST}. Instances not seen in the last ${CLOUD_INSTANCE_LIVE_WINDOW_MINUTES} minutes are shown as Stale.`,
        }}
        noItemsMessage={`No instances reported yet. Instances appear when telemetry carries one of these resource attributes: ${IDENTITY_ATTRIBUTE_LIST}.`}
        filters={[
          {
            field: { instanceName: true },
            title: "Instance",
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
                      ? `Seen in the last ${CLOUD_INSTANCE_LIVE_WINDOW_MINUTES} minutes`
                      : `Not seen for more than ${CLOUD_INSTANCE_LIVE_WINDOW_MINUTES} minutes`
                  }
                />
              );
            },
          },
          {
            field: { latestCpuPercent: true },
            title: "CPU",
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
    </Fragment>
  );
};

export default CloudResourceInstances;
