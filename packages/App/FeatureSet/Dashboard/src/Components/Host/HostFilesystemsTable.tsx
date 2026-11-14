import { HOST_METRIC_DESCRIPTIONS } from "../MetricDescriptions/HostMetricDescriptions";
import Card from "Common/UI/Components/Card/Card";
import Table from "Common/UI/Components/Table/Table";
import Column from "Common/UI/Components/Table/Types/Column";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import FieldType from "Common/UI/Components/Types/FieldType";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { formatReaderFigure } from "Common/Types/DateLanguage";
import {
  HOST_DISK_FULL_PERCENT,
  HOST_DISK_NEAR_FULL_PERCENT,
} from "Common/Types/Host/HostHealth";
import React, { FunctionComponent, ReactElement } from "react";

// One mount point a host reports, with its capacity and how full it is.
export interface HostMount {
  mountpoint: string;
  device: string | null;
  type: string | null;
  totalBytes: number;
  usedBytes: number;
  utilizationPercent: number;
}

export interface ComponentProps {
  mounts: Array<HostMount>;
  formatBytes: (bytes: number | null | undefined) => string;
}

// Where a person's widths for these columns are kept (Table's ColumnResize).
export const HOST_FILESYSTEMS_TABLE_KEY: string = "host-filesystems-table";

export const HOST_FILESYSTEMS_TABLE_ID: string = "host-filesystems";

/*
 * How full a mount is, by colour: green, amber above 85% and red above 95% -
 * where the host's Needs attention starts to list it (HostHealth).
 */
export const getMountBarClassName: (percent: number) => string = (
  percent: number,
): string => {
  if (percent > HOST_DISK_FULL_PERCENT) {
    return "bg-red-500";
  }

  if (percent > HOST_DISK_NEAR_FULL_PERCENT) {
    return "bg-amber-500";
  }

  return "bg-emerald-500";
};

/*
 * A host's Filesystems: each mount point, what kind of filesystem and which
 * device it is, and how much of it is used - drawn by the product's table,
 * as every other list is.
 *
 * Beside the host's side menu at a 768px window the card is some 480px wide,
 * and the five columns ran past it, the Utilization bar out of sight and a
 * mount point broken onto a line a letter ("/boo" over "t/efi"). Where the
 * card is narrower than 48rem now (TableFit), the type and the device go
 * under the mount point and the sizes under the bar; on a phone each mount
 * is a card.
 */
const HostFilesystemsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const columns: Array<Column<HostMount>> = [
    {
      id: "mount",
      key: "mountpoint",
      title: "Mount",
      type: FieldType.Element,
      disableSort: true,
      /*
       * Each value reads the way the host wrote it (bdi): on a Persian page
       * /var/lib/postgresql kept its leading slash at its far end, and
       * "472 GiB / 500 GiB" put 472 after the total.
       */
      getElement: (mount: HostMount): ReactElement => {
        return (
          <bdi className="font-mono" data-testid="host-filesystem-mount">
            {mount.mountpoint}
          </bdi>
        );
      },
    },
    {
      id: "type",
      key: "type",
      title: "Type",
      type: FieldType.Element,
      disableSort: true,
      hideBelowLargeScreen: true,
      foldInto: "mount",
      getElement: (mount: HostMount): ReactElement => {
        if (!mount.type) {
          return <TableEmptyValue />;
        }

        return (
          <span className="inline-flex items-center rounded-md bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
            {mount.type}
          </span>
        );
      },
    },
    {
      id: "device",
      key: "device",
      title: "Device",
      type: FieldType.Element,
      disableSort: true,
      hideBelowLargeScreen: true,
      foldInto: "mount",
      getElement: (mount: HostMount): ReactElement => {
        if (!mount.device) {
          return <TableEmptyValue />;
        }

        return (
          <bdi className="font-mono" data-testid="host-filesystem-device">
            {mount.device}
          </bdi>
        );
      },
    },
    {
      id: "usedTotal",
      key: "usedBytes",
      title: "Used / Total",
      type: FieldType.Element,
      disableSort: true,
      headerTooltip: HOST_METRIC_DESCRIPTIONS.filesystemUsedTotal,
      hideBelowLargeScreen: true,
      foldInto: "utilization",
      getElement: (mount: HostMount): ReactElement => {
        return (
          <bdi className="tabular-nums" data-testid="host-filesystem-used">
            <span className="font-medium text-gray-900">
              {props.formatBytes(mount.usedBytes)}
            </span>
            <span className="mx-1 text-gray-400">/</span>
            <span>{props.formatBytes(mount.totalBytes)}</span>
          </bdi>
        );
      },
    },
    {
      id: "utilization",
      key: "utilizationPercent",
      title: "Utilization",
      type: FieldType.Element,
      disableSort: true,
      headerTooltip: HOST_METRIC_DESCRIPTIONS.filesystemUtilization,
      getElement: (mount: HostMount): ReactElement => {
        const percent: number = Math.min(
          100,
          Math.max(0, mount.utilizationPercent),
        );

        return (
          <span
            className="inline-flex items-center gap-3"
            data-testid="host-filesystem-utilization"
          >
            <span className="inline-block h-1.5 w-24 rounded-full bg-gray-100">
              <span
                className={`block h-1.5 rounded-full ${getMountBarClassName(percent)}`}
                style={{ width: `${percent}%` }}
              />
            </span>
            <span className="w-12 text-xs tabular-nums text-gray-600">
              {formatReaderFigure(percent, { decimals: 1, isPercent: true })}
            </span>
          </span>
        );
      },
    },
  ];

  return (
    <Card
      title="Filesystems"
      description="Mount points reported by the host with capacity and utilization."
    >
      <Table<HostMount>
        id={HOST_FILESYSTEMS_TABLE_ID}
        columnWidthsKey={HOST_FILESYSTEMS_TABLE_KEY}
        data={props.mounts}
        columns={columns}
        singularLabel="Filesystem"
        pluralLabel="Filesystems"
        currentPageNumber={1}
        totalItemsCount={props.mounts.length}
        itemsOnPage={props.mounts.length || 1}
        disablePagination={true}
        error=""
        isLoading={false}
        onNavigateToPage={(): void => {
          // Every mount is on the one page.
        }}
        sortOrder={SortOrder.Ascending}
        sortBy={null}
        onSortChanged={(): void => {
          // The mounts keep the order the host reports them in.
        }}
      />
    </Card>
  );
};

export default HostFilesystemsTable;
