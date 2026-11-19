import { HOST_METRIC_DESCRIPTIONS } from "../MetricDescriptions/HostMetricDescriptions";
import Card from "Common/UI/Components/Card/Card";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import Table from "Common/UI/Components/Table/Table";
import Column from "Common/UI/Components/Table/Types/Column";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import FieldType from "Common/UI/Components/Types/FieldType";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { HOST_DISK_USAGE_THRESHOLDS } from "Common/Types/Host/HostHealth";
import StorageUsageBar from "Common/UI/Components/StorageUsage/StorageUsageBar";
import {
  StorageUsage,
  getStorageUsage,
} from "Common/Utils/Storage/StorageUsage";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One mount point a host reports, as df reads it: Size is used, free and
 * the space reserved for root added up; free is what anyone can still
 * write (df's Avail); how full it is, used over used plus free (df's Use%).
 */
export interface HostMount {
  mountpoint: string;
  device: string | null;
  type: string | null;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  reservedBytes: number;
  utilizationPercent: number;
}

/*
 * How full a mount is, as the shared storage bar reads it (#9647): used of
 * used plus free, so the percent is df's Use% and the host's Needs
 * attention's, at its lines. The root-reserved space is counted in its
 * Size, never in how full it is: nobody but root can write it.
 */
export function getHostMountUsage(
  mount: Pick<HostMount, "usedBytes" | "freeBytes">,
): StorageUsage | null {
  return getStorageUsage(
    {
      capacity: mount.usedBytes + mount.freeBytes,
      available: mount.freeBytes,
    },
    HOST_DISK_USAGE_THRESHOLDS,
  );
}

export interface ComponentProps {
  mounts: Array<HostMount>;
  formatBytes: (bytes: number | null | undefined) => string;
}

// Where a person's widths for these columns are kept (Table's ColumnResize).
export const HOST_FILESYSTEMS_TABLE_KEY: string = "host-filesystems-table";

export const HOST_FILESYSTEMS_TABLE_ID: string = "host-filesystems";

/*
 * A host's Filesystems: each mount point, what kind of filesystem and which
 * device it is, and how full it is - drawn by the product's table, as every
 * other list is, with the shared storage bar (#9647): how much is used and
 * the percent, how much is free, and its size with the space reserved for
 * root said under it. "90 GiB / 100 GiB" beside 95% read like a mistake
 * while Free and the reserved space were never shown.
 *
 * Beside the host's side menu at a 768px window the card is some 480px wide,
 * and the columns ran past it, the bar out of sight and a mount point broken
 * onto a line a letter ("/boo" over "t/efi"). Where the card is narrower
 * than 48rem now (TableFit), the type and the device go under the mount
 * point and Free and Size under the bar; on a phone each mount is a card.
 */
const HostFilesystemsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

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
          <Pill
            text={mount.type}
            isUserContent={true}
            tone={PillTone.Neutral}
            isDotHidden={true}
          />
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
      id: "used",
      key: "usedBytes",
      title: "Used",
      type: FieldType.Element,
      disableSort: true,
      headerTooltip: HOST_METRIC_DESCRIPTIONS.filesystemUtilization,
      getElement: (mount: HostMount): ReactElement => {
        return (
          <StorageUsageBar
            usage={getHostMountUsage(mount)}
            formatAmount={(amount: number): string => {
              return props.formatBytes(amount);
            }}
            dataTestId="host-filesystem-usage"
          />
        );
      },
    },
    {
      id: "free",
      key: "freeBytes",
      // The room left, never the price (MeaningKeys).
      title: "Free (storage space)",
      type: FieldType.Element,
      disableSort: true,
      headerTooltip: HOST_METRIC_DESCRIPTIONS.filesystemFree,
      hideBelowLargeScreen: true,
      foldInto: "used",
      showTitleWhenFolded: true,
      getElement: (mount: HostMount): ReactElement => {
        return (
          <bdi className="tabular-nums" data-testid="host-filesystem-free">
            {props.formatBytes(Math.max(0, mount.freeBytes))}
          </bdi>
        );
      },
    },
    {
      id: "size",
      key: "totalBytes",
      title: "Size",
      type: FieldType.Element,
      disableSort: true,
      headerTooltip: HOST_METRIC_DESCRIPTIONS.filesystemSize,
      hideBelowLargeScreen: true,
      foldInto: "used",
      showTitleWhenFolded: true,
      getElement: (mount: HostMount): ReactElement => {
        return (
          <span className="inline-block" data-testid="host-filesystem-size">
            {/* "512 GiB", not "GiB 512", on a right-to-left page. */}
            <bdi className="tabular-nums">
              {props.formatBytes(mount.totalBytes)}
            </bdi>
            {mount.reservedBytes > 0 ? (
              <span
                className="block text-xs text-gray-500"
                data-testid="host-filesystem-reserved"
              >
                {translator.translateTemplate("{{size}} reserved for root", {
                  size: props.formatBytes(mount.reservedBytes),
                })}
              </span>
            ) : null}
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
