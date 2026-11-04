import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Column from "Common/UI/Components/ModelTable/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import OpenStackResourceList, {
  OpenStackColumn,
  OpenStackFilter,
  formatOpenStackBytes,
  formatOpenStackCount,
  getOpenStackAmountColumn,
} from "../../../Components/OpenStack/OpenStackResourceList";
import OpenStackStatusCell from "../../../Components/OpenStack/OpenStackStatusCell";
import {
  fetchOpenStackComputeServices,
  getOpenStackHostKey,
} from "../Utils/OpenStackResourceUtils";

/*
 * Every compute host, and what Nova and Placement have promised on it. Those
 * numbers are promises and not load, so every column says "allocated". A host
 * Nova lost keeps its last numbers, and would read as idle capacity on its own, so
 * each row says what its nova-compute last said, read for the rows on this page.
 */

const FILTERS: Array<OpenStackFilter> = [OpenStackFilter.Region];

const AMOUNT_COLUMNS: Array<Column<OpenStackResource>> = [
  getOpenStackAmountColumn({
    title: "vCPUs Allocated",
    field: "vcpuAllocated",
    capacityField: "vcpuCapacity",
    format: formatOpenStackCount,
  }),
  getOpenStackAmountColumn({
    title: "Memory Allocated",
    field: "memoryAllocatedBytes",
    capacityField: "memoryCapacityBytes",
    format: formatOpenStackBytes,
  }),
  getOpenStackAmountColumn({
    title: "Disk Allocated",
    field: "diskAllocatedBytes",
    capacityField: "diskCapacityBytes",
    format: formatOpenStackBytes,
    hideOnMobile: true,
  }),
];

const INSTANCES_COLUMN: Column<OpenStackResource> = {
  field: { instanceCount: true },
  title: "Instances",
  type: FieldType.Number,
};

const OpenStackCloudHypervisors: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [computeServices, setComputeServices] = useState<
    Record<string, OpenStackResource>
  >({});

  const columns: Array<OpenStackColumn | Column<OpenStackResource>> =
    useMemo(() => {
      return [
        {
          id: "nova-compute",
          field: { hypervisorName: true },
          title: "nova-compute",
          type: FieldType.Element,
          disableSort: true,
          getElement: (row: OpenStackResource): ReactElement => {
            const service: OpenStackResource | undefined =
              computeServices[
                getOpenStackHostKey(row.regionName, row.hypervisorName)
              ];
            return (
              <OpenStackStatusCell
                kind={OpenStackResourceKind.Service}
                status={service?.status}
                adminState={service?.adminState}
                disabledReason={service?.disabledReason}
              />
            );
          },
          getExportValue: (row: OpenStackResource): string => {
            return (
              computeServices[
                getOpenStackHostKey(row.regionName, row.hypervisorName)
              ]?.status || ""
            );
          },
        },
        ...AMOUNT_COLUMNS,
        INSTANCES_COLUMN,
        OpenStackColumn.Region,
        OpenStackColumn.AvailabilityZone,
      ];
    }, [computeServices]);

  return (
    <OpenStackResourceList
      openStackCloudId={modelId}
      kind={OpenStackResourceKind.Hypervisor}
      tableId="openstack-hypervisors-table"
      title="Hypervisors"
      description="Compute hosts, and what Nova and Placement have promised to instances on each. Allocated is what is promised, not how busy a host is."
      singularName="hypervisor"
      pluralName="hypervisors"
      emptyTitle="No hypervisors reported yet"
      emptyDescription="These come from Nova and Placement, which take the Full view or Infrastructure only credential. A Project view credential can't list hypervisors."
      nameTitle="Hypervisor"
      columns={columns}
      filters={FILTERS}
      searchPlaceholder="Search hypervisors"
      onRowsFetched={(rows: Array<OpenStackResource>) => {
        const names: Array<string> = [];

        for (const row of rows) {
          if (row.hypervisorName && !names.includes(row.hypervisorName)) {
            names.push(row.hypervisorName);
          }
        }

        fetchOpenStackComputeServices({
          openStackCloudId: modelId,
          hypervisorNames: names,
        })
          .then((services: Record<string, OpenStackResource>) => {
            setComputeServices(services);
          })
          .catch(() => {
            // A dash in the column: the rest of the row is still true.
          });
      }}
    />
  );
};

export default OpenStackCloudHypervisors;
