import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import Column from "Common/UI/Components/ModelTable/Column";
import Columns from "Common/UI/Components/ModelTable/Columns";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { translateTemplate } from "Common/UI/Utils/TranslateTemplate";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatBytes } from "../TelemetryResource/telemetryFormat";
import {
  fetchOpenStackHypervisorOptions,
  fetchOpenStackProjectNames,
  fetchOpenStackProjectOptions,
  fetchOpenStackRegionOptions,
  getOpenStackFact,
} from "../../Pages/OpenStack/Utils/OpenStackResourceUtils";
import { OPENSTACK_STATUS_WORDS } from "./OpenStackStatus";
import OpenStackStatusCell from "./OpenStackStatusCell";

/*
 * Every inventory list of an OpenStack cloud. A cloud can hold hundreds of
 * thousands of rows, so the table only ever holds a page of them: it pages, sorts
 * and filters on the server, by openStackCloudId and kind (the leading columns of
 * OpenStackResource's indexes). Nothing here reads a whole kind into the browser.
 *
 * A page says which rows it lists, which of the standard columns and filters they
 * have, and what to say when there are none: a list a credential cannot read looks
 * empty, and only the page knows what to say about that.
 */

export enum OpenStackColumn {
  Status = "status",
  AdminState = "adminState",
  DisabledReason = "disabledReason",
  Region = "region",
  AvailabilityZone = "availabilityZone",
  Hypervisor = "hypervisor",
  Project = "project",
}

export enum OpenStackFilter {
  Status = "status",
  AdminState = "adminState",
  Region = "region",
  Hypervisor = "hypervisor",
  Project = "project",
}

export interface ComponentProps {
  openStackCloudId: ObjectID;
  kind: OpenStackResourceKind;
  // Narrows the kind's rows: one family of services.
  query?: Query<OpenStackResource> | undefined;
  // Unique on the page: the table's id, its saved layout and its place in the URL.
  tableId: string;
  title: string;
  description: string;
  singularName: string;
  pluralName: string;
  emptyTitle: string;
  emptyDescription: string;
  nameTitle?: string | undefined;
  // How a row names itself, when its name column is not its name.
  getName?: ((row: OpenStackResource) => string) | undefined;
  statusTitle?: string | undefined;
  // The columns after the name, in order. Stable: a page declares them once.
  columns: Array<OpenStackColumn | Column<OpenStackResource>>;
  filters: Array<OpenStackFilter>;
  // A family of services' own words for what an operator can set.
  adminStateWords?: ReadonlyArray<string> | undefined;
  searchPlaceholder?: string | undefined;
  sortBy?: keyof OpenStackResource | undefined;
  sortOrder?: SortOrder | undefined;
  // A page of rows arrived: a page that shows more than the row reads it here.
  onRowsFetched?: ((rows: Array<OpenStackResource>) => void) | undefined;
}

const SELECT_MORE: Select<OpenStackResource> = {
  kind: true,
  externalId: true,
  adminState: true,
  disabledReason: true,
  facts: true,
  regionName: true,
  openStackProjectId: true,
};

// A word OpenStack wrote: never looked up, in the filter as in the cell.
function toWordOptions(words: ReadonlyArray<string>): Array<DropdownOption> {
  return words.map((word: string): DropdownOption => {
    return { value: word, label: word, isUserContent: true };
  });
}

function getFactCellText(value: string): ReactElement {
  return value ? <bdi>{value}</bdi> : <span className="text-gray-400">-</span>;
}

/*
 * A column read from `facts`, what OpenStack says about one kind and no other.
 * Never sorted: the server orders by columns, and facts is not one.
 */
export function getOpenStackFactColumn(data: {
  id: string;
  title: string;
  getText: (row: OpenStackResource) => string;
  hideOnMobile?: boolean | undefined;
}): Column<OpenStackResource> {
  return {
    id: data.id,
    field: { facts: true },
    title: data.title,
    type: FieldType.Element,
    disableSort: true,
    hideOnMobile: data.hideOnMobile,
    getElement: (row: OpenStackResource): ReactElement => {
      return getFactCellText(data.getText(row));
    },
    getExportValue: (row: OpenStackResource): string => {
      return data.getText(row);
    },
  };
}

export function formatOpenStackAmount(data: {
  taken: number | null | undefined;
  capacity: number | null | undefined;
  format: (value: number) => string;
}): string {
  const taken: string =
    data.taken === null || data.taken === undefined
      ? ""
      : data.format(data.taken);
  const capacity: string =
    data.capacity === null || data.capacity === undefined
      ? ""
      : data.format(data.capacity);

  if (taken && capacity) {
    return translateTemplate("{{used}} of {{total}}", {
      used: taken,
      total: capacity,
    });
  }
  return taken || capacity;
}

export function formatOpenStackBytes(bytes: number): string {
  return formatBytes(bytes);
}

export function formatOpenStackCount(count: number): string {
  return Number.isInteger(count) ? String(count) : count.toFixed(1);
}

// "12 of 64": what is promised, and what can be. Its title says "allocated".
export function getOpenStackAmountColumn(data: {
  title: string;
  field: "vcpuAllocated" | "memoryAllocatedBytes" | "diskAllocatedBytes";
  capacityField: "vcpuCapacity" | "memoryCapacityBytes" | "diskCapacityBytes";
  format: (value: number) => string;
  hideOnMobile?: boolean | undefined;
}): Column<OpenStackResource> {
  const getText: (row: OpenStackResource) => string = (
    row: OpenStackResource,
  ): string => {
    return formatOpenStackAmount({
      taken: row[data.field],
      capacity: row[data.capacityField],
      format: data.format,
    });
  };

  return {
    field: { [data.field]: true },
    title: data.title,
    type: FieldType.Element,
    hideOnMobile: data.hideOnMobile,
    getElement: (row: OpenStackResource): ReactElement => {
      return getFactCellText(getText(row));
    },
    getExportValue: getText,
  };
}

// A number on the row that is a size, not a share of anything.
export function getOpenStackSizeColumn(data: {
  title: string;
  field: "vcpuCapacity" | "memoryCapacityBytes" | "diskCapacityBytes";
  format: (value: number) => string;
  hideOnMobile?: boolean | undefined;
}): Column<OpenStackResource> {
  const getText: (row: OpenStackResource) => string = (
    row: OpenStackResource,
  ): string => {
    const value: number | undefined = row[data.field];
    return value === null || value === undefined ? "" : data.format(value);
  };

  return {
    field: { [data.field]: true },
    title: data.title,
    type: FieldType.Element,
    hideOnMobile: data.hideOnMobile,
    getElement: (row: OpenStackResource): ReactElement => {
      return getFactCellText(getText(row));
    },
    getExportValue: getText,
  };
}

const OpenStackResourceList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * Rows hold a project's ID, because Nova, Cinder and Neutron report only that.
   * Each page of rows looks up the names it needs, once.
   */
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  const askedProjectIds: MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set<string>(),
  );

  const showsProject: boolean = props.columns.includes(OpenStackColumn.Project);

  const onFetchSuccess: (rows: Array<OpenStackResource>) => void = (
    rows: Array<OpenStackResource>,
  ): void => {
    props.onRowsFetched?.(rows);

    if (!showsProject) {
      return;
    }

    const projectIds: Array<string> = [];

    for (const row of rows) {
      const projectId: string | undefined = row.openStackProjectId;
      if (
        projectId &&
        !askedProjectIds.current.has(projectId)
      ) {
        askedProjectIds.current.add(projectId);
        projectIds.push(projectId);
      }
    }

    fetchOpenStackProjectNames({
      openStackCloudId: props.openStackCloudId,
      projectIds: projectIds,
    })
      .then((names: Record<string, string>) => {
        if (Object.keys(names).length > 0) {
          setProjectNames((known: Record<string, string>) => {
            return { ...known, ...names };
          });
        }
      })
      .catch(() => {
        // The project's ID stands in for its name, and is just as true.
      });
  };

  const query: Query<OpenStackResource> = useMemo(() => {
    return {
      openStackCloudId: props.openStackCloudId,
      kind: props.kind,
      ...(props.query || {}),
    };
  }, [props.openStackCloudId, props.kind, props.query]);

  const filters: Array<Filter<OpenStackResource>> = useMemo(() => {
    return props.filters.map(
      (filter: OpenStackFilter): Filter<OpenStackResource> => {
        switch (filter) {
          case OpenStackFilter.Status:
            return {
              field: { status: true },
              title: props.statusTitle || "Status",
              type: FieldType.Dropdown,
              filterDropdownOptions: toWordOptions(
                OPENSTACK_STATUS_WORDS[props.kind] || [],
              ),
            };
          case OpenStackFilter.AdminState:
            return {
              field: { adminState: true },
              title: "Admin State",
              type: FieldType.Dropdown,
              filterDropdownOptions: toWordOptions(props.adminStateWords || []),
            };
          case OpenStackFilter.Region:
            return {
              field: { regionName: true },
              title: "Region",
              type: FieldType.Dropdown,
              filterEntityType: OpenStackResource,
              filterDropdownField: {
                label: "regionName",
                value: "regionName",
              },
              fetchFilterDropdownOptions: () => {
                return fetchOpenStackRegionOptions(props.openStackCloudId);
              },
            };
          case OpenStackFilter.Hypervisor:
            return {
              field: { hypervisorName: true },
              title: "Hypervisor",
              type: FieldType.Dropdown,
              filterEntityType: OpenStackResource,
              filterDropdownField: { label: "name", value: "name" },
              fetchFilterDropdownOptions: () => {
                return fetchOpenStackHypervisorOptions(props.openStackCloudId);
              },
            };
          case OpenStackFilter.Project:
            return {
              field: { openStackProjectId: true },
              title: "Project",
              type: FieldType.Dropdown,
              filterEntityType: OpenStackResource,
              filterDropdownField: { label: "name", value: "externalId" },
              fetchFilterDropdownOptions: () => {
                return fetchOpenStackProjectOptions(props.openStackCloudId);
              },
            };
          default:
            throw new Error(`Unknown OpenStack filter: ${filter as string}`);
        }
      },
    );
  }, [
    props.filters,
    props.openStackCloudId,
    props.kind,
    props.statusTitle,
    props.adminStateWords,
  ]);

  const columns: Columns<OpenStackResource> = useMemo(() => {
    const getName: (row: OpenStackResource) => string = (
      row: OpenStackResource,
    ): string => {
      return (
        (props.getName ? props.getName(row) : row.name) || row.externalId || ""
      );
    };

    const getProjectText: (row: OpenStackResource) => string = (
      row: OpenStackResource,
    ): string => {
      const projectId: string = row.openStackProjectId || "";
      return projectNames[projectId] || projectId;
    };

    const toColumn: (
      column: OpenStackColumn | Column<OpenStackResource>,
    ) => Column<OpenStackResource> = (
      column: OpenStackColumn | Column<OpenStackResource>,
    ): Column<OpenStackResource> => {
      if (typeof column !== "string") {
        return column;
      }

      switch (column) {
        case OpenStackColumn.Status:
          return {
            field: { status: true },
            title: props.statusTitle || "Status",
            type: FieldType.Element,
            // Beside a Reason column, the reason is not said twice.
            getElement: (row: OpenStackResource): ReactElement => {
              return (
                <OpenStackStatusCell
                  kind={row.kind}
                  status={row.status}
                  adminState={row.adminState}
                  disabledReason={row.disabledReason}
                  isScrapeFailed={
                    getOpenStackFact(row, "scrapeFailed") === true
                  }
                  showReason={
                    !props.columns.includes(OpenStackColumn.DisabledReason)
                  }
                />
              );
            },
            getExportValue: (row: OpenStackResource): string => {
              return row.status || "";
            },
          };
        case OpenStackColumn.AdminState:
          return {
            field: { adminState: true },
            title: "Admin State",
            type: FieldType.Text,
            hideOnMobile: true,
          };
        case OpenStackColumn.DisabledReason:
          return {
            field: { disabledReason: true },
            title: "Reason",
            type: FieldType.Text,
            wrapContent: true,
          };
        case OpenStackColumn.Region:
          return {
            field: { regionName: true },
            title: "Region",
            type: FieldType.Text,
            hideOnMobile: true,
          };
        case OpenStackColumn.AvailabilityZone:
          return {
            field: { availabilityZone: true },
            title: "Availability Zone",
            type: FieldType.Text,
            hideOnMobile: true,
          };
        case OpenStackColumn.Hypervisor:
          return {
            field: { hypervisorName: true },
            title: "Hypervisor",
            type: FieldType.Text,
            hideOnMobile: true,
          };
        case OpenStackColumn.Project:
          return {
            field: { openStackProjectId: true },
            title: "Project",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (row: OpenStackResource): ReactElement => {
              return getFactCellText(getProjectText(row));
            },
            getExportValue: getProjectText,
          };
        default:
          throw new Error(`Unknown OpenStack column: ${column as string}`);
      }
    };

    return [
      {
        field: { name: true },
        title: props.nameTitle || "Name",
        type: FieldType.Element,
        // Whatever else a viewer hides, a row stays nameable.
        isNotCustomizable: true,
        getElement: (row: OpenStackResource): ReactElement => {
          return (
            <span className="text-sm font-medium text-gray-900">
              <bdi>{getName(row)}</bdi>
            </span>
          );
        },
        getExportValue: getName,
      },
      ...props.columns.map(toColumn),
    ];
  }, [
    props.columns,
    props.getName,
    props.nameTitle,
    props.statusTitle,
    projectNames,
  ]);

  return (
    <ModelTable<OpenStackResource>
      modelType={OpenStackResource}
      id={props.tableId}
      userPreferencesKey={props.tableId}
      name={props.title}
      singularName={props.singularName}
      pluralName={props.pluralName}
      query={query}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      showRefreshButton={true}
      cardProps={{
        title: props.title,
        description: props.description,
      }}
      emptyState={{
        title: props.emptyTitle,
        description: props.emptyDescription,
        hideCreateButton: true,
      }}
      searchableFields={["name", "externalId"]}
      searchPlaceholder={props.searchPlaceholder}
      filters={filters}
      columns={columns}
      selectMoreFields={SELECT_MORE}
      sortBy={props.sortBy || "name"}
      sortOrder={props.sortOrder || SortOrder.Ascending}
      onFetchSuccess={onFetchSuccess}
    />
  );
};

export default OpenStackResourceList;
