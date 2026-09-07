import React, { FunctionComponent, ReactElement } from "react";
import VMwareSource from "Common/Models/DatabaseModels/VMwareSource";
import VMwareResource from "Common/Models/DatabaseModels/VMwareResource";
import ObjectID from "Common/Types/ObjectID";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Link from "Common/UI/Components/Link/Link";
import VMwareStatus from "../../Components/VMware/Status";
import {
  formatPercent,
  metricValue,
  resourceRoute,
  resourceStatus,
  resourceTypeLabel,
} from "./Utils";

const VMwareResources: FunctionComponent<{
  source: VMwareSource;
  resourceType: string;
  refresh: string;
}> = ({
  source,
  resourceType,
  refresh,
}: {
  source: VMwareSource;
  resourceType: string;
  refresh: string;
}): ReactElement => {
  return (
    <ModelTable<VMwareResource>
      modelType={VMwareResource}
      id={`vmware-resources-${resourceType}`}
      userPreferencesKey={`vmware-resources-${resourceType}-table`}
      filters={[]}
      name="VMware Resources"
      isCreateable={false}
      isEditable={false}
      isDeleteable={false}
      isViewable={false}
      query={{
        sourceId: new ObjectID(source._id!),
        resourceType,
        isArchived: false,
      }}
      refreshToggle={refresh}
      showRefreshButton={true}
      selectMoreFields={{
        metadata: true,
        metrics: true,
        lastSeenAt: true,
        expectedRunning: true,
        maintenanceMode: true,
        resourceType: true,
      }}
      cardProps={{
        title:
          resourceType === "vm"
            ? "Virtual machines"
            : resourceType === "host"
              ? "ESXi hosts"
              : resourceType === "datastore"
                ? "Datastores"
                : "Clusters",
        description:
          "Current inventory, with collection freshness and last-known resource state shown separately.",
      }}
      searchableFields={["name", "resourceIdentifier"]}
      noItemsMessage={`No ${resourceTypeLabel(resourceType).toLowerCase()} resources have been discovered for this source.`}
      columns={[
        {
          field: { name: true },
          title: "Name",
          type: FieldType.Element,
          getElement: (item: VMwareResource): ReactElement => (
            <Link
              to={resourceRoute(source._id!, item._id!)}
              className="font-medium text-gray-900 hover:underline dark:text-gray-100"
            >
              {item.name || item.resourceIdentifier}
            </Link>
          ),
        },
        {
          field: { metadata: true },
          title: "State",
          type: FieldType.Element,
          getElement: (item: VMwareResource): ReactElement => (
            <VMwareStatus status={resourceStatus(item, source)} />
          ),
        },
        {
          field: { metrics: true },
          title:
            resourceType === "cluster"
              ? "Parent"
              : resourceType === "datastore"
                ? "Storage used"
                : "CPU",
          type: FieldType.Element,
          getElement: (item: VMwareResource): ReactElement => (
            <span className="tabular-nums">
              {resourceType === "cluster"
                ? String(item.metadata?.["oneuptime.vmware.parent.name"] || "—")
                : formatPercent(
                    metricValue(
                      item,
                      `oneuptime.vmware.${resourceType === "datastore" ? "datastore.disk" : resourceType + ".cpu"}.utilization`,
                      source,
                    ),
                  )}
            </span>
          ),
        },
        ...(resourceType === "host" || resourceType === "vm"
          ? [
              {
                field: { resourceType: true },
                title: "Memory",
                type: FieldType.Element,
                getElement: (item: VMwareResource): ReactElement => (
                  <span className="tabular-nums">
                    {formatPercent(
                      metricValue(
                        item,
                        `oneuptime.vmware.${resourceType}.memory.utilization`,
                        source,
                      ),
                    )}
                  </span>
                ),
              },
            ]
          : []),
        {
          field: { resourceIdentifier: true },
          title: "Resource identifier",
          type: FieldType.Text,
          hideOnMobile: true,
        },
        {
          field: { lastSeenAt: true },
          title: "Last observed",
          type: FieldType.DateTime,
        },
      ]}
    />
  );
};
export default VMwareResources;
