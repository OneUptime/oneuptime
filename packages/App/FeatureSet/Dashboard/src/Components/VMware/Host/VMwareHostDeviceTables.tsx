import React, { FunctionComponent, ReactElement } from "react";
import useResizableColumns, {
  ResizableColumns,
} from "Common/UI/Components/Table/ColumnResize/useResizableColumns";
import ResizableHeaderCell from "Common/UI/Components/Table/ColumnResize/ResizableHeaderCell";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";
import Card from "Common/UI/Components/Card/Card";
import {
  useCardRuledBodyClassName,
  useCardRuledListClassName,
} from "Common/UI/Components/Card/CardSurface";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import ValueFormatter from "Common/Utils/ValueFormatter";
import { VMWARE_METRIC_DESCRIPTIONS } from "../../MetricDescriptions/VMwareMetricDescriptions";
import {
  VMWARE_DISK_LATENCY_DANGER_MS,
  VMWARE_DISK_LATENCY_WARN_MS,
  VMwareNetworkAdapterRow,
  VMwareStorageDeviceRow,
  formatVMwareMilliseconds,
  formatVMwarePerSecond,
} from "../../../Pages/VMware/Utils/VMwareHostData";

/*
 * An ESXi host's hardware, as vCenter's performance counters see it: one
 * row per physical network adapter and one per storage device, each value
 * averaged over the selected range. Where the host page outside VMware has
 * its Filesystems card, an ESXi host has its NICs and the disks and LUNs
 * its datastores live on.
 *
 * A table from xl up; below that each device is a short list of its own -
 * the values under its name, in columns that line up from one device to
 * the next - rather than a table that scrolls sideways and squeezes a
 * 40-character device name into a column of letters. Not only on a phone:
 * beside the side menu (md) the card is under 500px wide, where the storage
 * table ran past it and broke "naa.600508b1001c4d41..." into lines of six
 * letters, and at lg it still took three lines.
 *
 * A card shows only when the host reported at least one device over the
 * range: a collector that leaves the per-device series out (or a host that
 * reported none yet) has nothing to put in it.
 */

function formatBytesPerSecond(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  return ValueFormatter.formatValue(value, "By/s");
}

/*
 * A count of trouble (errors, drops): quiet at zero, amber above, so a bad
 * cable reads at a glance.
 */
function renderTroubleRate(value: number | null): ReactElement {
  const text: string = formatVMwarePerSecond(value);

  if (value === null || value <= 0) {
    return <span className="text-gray-500">{text}</span>;
  }

  return (
    <span
      className="inline-flex items-center justify-end gap-1.5 font-medium text-amber-700"
      data-testid="vmware-host-trouble-rate"
    >
      <span
        className="h-1.5 w-1.5 rounded-full bg-amber-500"
        aria-hidden="true"
      />
      {text}
    </span>
  );
}

function renderLatency(value: number | null): ReactElement {
  const text: string = formatVMwareMilliseconds(value);

  if (value === null || value < VMWARE_DISK_LATENCY_WARN_MS) {
    return <span>{text}</span>;
  }

  const isDanger: boolean = value >= VMWARE_DISK_LATENCY_DANGER_MS;

  return (
    <span
      className={`inline-flex items-center justify-end gap-1.5 font-medium ${
        isDanger ? "text-red-700" : "text-amber-700"
      }`}
      data-testid={
        isDanger ? "vmware-host-latency-danger" : "vmware-host-latency-warn"
      }
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          isDanger ? "bg-red-500" : "bg-amber-500"
        }`}
        aria-hidden="true"
      />
      {text}
    </span>
  );
}

interface DeviceColumn<TRow> {
  title: string;
  description?: string | undefined;
  render: (row: TRow) => ReactElement | string;
}

interface DeviceTableProps<TRow> {
  // The first column: the device's own name.
  nameTitle: string;
  columns: Array<DeviceColumn<TRow>>;
  rows: Array<TRow>;
  getName: (row: TRow) => string;
  rowTestId: string;
}

const HEADER_CLASS_NAME: string =
  "px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500 first:pl-5 last:pr-5 md:first:pl-6 md:last:pr-6";

const CELL_CLASS_NAME: string =
  "px-4 py-3 text-sm text-gray-700 tabular-nums first:pl-5 last:pr-5 md:first:pl-6 md:last:pr-6";

function DeviceTable<TRow>(props: DeviceTableProps<TRow>): ReactElement {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const bodyClassName: string = useCardRuledBodyClassName();
  const listClassName: string = useCardRuledListClassName();

  /*
   * The devices' columns as wide as a person makes them (Common's
   * Table/ColumnResize): a device's name gives way, a reading never - one
   * set of widths for each kind of device.
   */
  const deviceColumns: ResizableColumns = useResizableColumns({
    tableKey: `vmware-host-devices.${props.rowTestId}`,
    columns: [
      { id: "name", cellNumber: 1 },
      ...props.columns.map(
        (
          column: DeviceColumn<TRow>,
          index: number,
        ): { id: string; cellNumber: number } => {
          return { id: column.title, cellNumber: index + 2 };
        },
      ),
    ],
  });

  return (
    <>
      <div className={`max-xl:hidden ${bodyClassName}`}>
        <div className="overflow-x-auto">
          {deviceColumns.styles}
          <table
            className={`${deviceColumns.getTableWidthClassName("min-w-full")} divide-y divide-gray-200`}
            {...deviceColumns.tableAttributes}
          >
            <thead className="bg-gray-50">
              <tr>
                <ResizableHeaderCell
                  scope="col"
                  className={`${HEADER_CLASS_NAME} whitespace-nowrap text-left`}
                  resize={deviceColumns.getResize(
                    "name",
                    tx(props.nameTitle),
                    ColumnWidthKind.Name,
                  )}
                >
                  <span>{tx(props.nameTitle)}</span>
                </ResizableHeaderCell>
                {props.columns.map(
                  (column: DeviceColumn<TRow>): ReactElement => {
                    return (
                      <ResizableHeaderCell
                        key={column.title}
                        scope="col"
                        className={`${HEADER_CLASS_NAME} whitespace-nowrap text-right`}
                        resize={deviceColumns.getResize(
                          column.title,
                          tx(column.title),
                          ColumnWidthKind.Whole,
                        )}
                      >
                        <span className="inline-flex items-center justify-end gap-1">
                          {tx(column.title)}
                          {column.description ? (
                            <InfoTooltip
                              label={column.title}
                              text={column.description}
                            />
                          ) : (
                            <></>
                          )}
                        </span>
                      </ResizableHeaderCell>
                    );
                  },
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {props.rows.map((row: TRow): ReactElement => {
                const name: string = props.getName(row);

                return (
                  <tr key={name} data-testid={props.rowTestId}>
                    <td
                      className={`${CELL_CLASS_NAME} min-w-[8rem] max-w-[18rem] break-all font-mono font-medium text-gray-900`}
                    >
                      {name}
                    </td>
                    {props.columns.map(
                      (column: DeviceColumn<TRow>): ReactElement => {
                        return (
                          <td
                            key={column.title}
                            className={`${CELL_CLASS_NAME} whitespace-nowrap text-right`}
                          >
                            {column.render(row)}
                          </td>
                        );
                      },
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Under xl: each device under its own name. */}
      <ul
        className={`xl:hidden ${listClassName}`}
        data-testid={`${props.rowTestId}-list`}
      >
        {props.rows.map((row: TRow): ReactElement => {
          const name: string = props.getName(row);

          return (
            <li key={name} className="px-5 py-3 md:px-6">
              <div className="break-all font-mono text-sm font-medium text-gray-900">
                {name}
              </div>
              {/*
               * As many 9rem columns as the card has room for: two on a
               * phone and beside the side menu, three or four on a wider
               * card, so a value never drifts far from its name.
               */}
              <dl className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-6 gap-y-1.5">
                {props.columns.map(
                  (column: DeviceColumn<TRow>): ReactElement => {
                    return (
                      <div
                        key={column.title}
                        className="flex min-w-0 items-baseline justify-between gap-2 text-xs"
                      >
                        <dt className="text-gray-500">{tx(column.title)}</dt>
                        <dd className="tabular-nums text-gray-900">
                          {column.render(row)}
                        </dd>
                      </div>
                    );
                  },
                )}
              </dl>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export interface NetworkAdaptersProps {
  adapters: Array<VMwareNetworkAdapterRow>;
}

export const VMwareHostNetworkAdaptersCard: FunctionComponent<
  NetworkAdaptersProps
> = (props: NetworkAdaptersProps): ReactElement => {
  if (props.adapters.length === 0) {
    return <></>;
  }

  return (
    <div className="mb-6" data-testid="vmware-host-network-adapters">
      <Card
        title="Network adapters"
        description="The host's physical network adapters, each averaged over the selected range."
      >
        <DeviceTable<VMwareNetworkAdapterRow>
          nameTitle={translationKey("Adapter")}
          rows={props.adapters}
          rowTestId="vmware-host-network-adapter"
          getName={(adapter: VMwareNetworkAdapterRow): string => {
            return adapter.name;
          }}
          columns={[
            {
              title: "Received",
              description: VMWARE_METRIC_DESCRIPTIONS.hostPageAdapterThroughput,
              render: (adapter: VMwareNetworkAdapterRow): string => {
                return formatBytesPerSecond(adapter.receivedBytesPerSecond);
              },
            },
            {
              title: "Sent",
              render: (adapter: VMwareNetworkAdapterRow): string => {
                return formatBytesPerSecond(adapter.sentBytesPerSecond);
              },
            },
            {
              title: "Packets",
              description: VMWARE_METRIC_DESCRIPTIONS.hostPageAdapterPackets,
              render: (adapter: VMwareNetworkAdapterRow): string => {
                return formatVMwarePerSecond(adapter.packetsPerSecond);
              },
            },
            {
              title: "Errors",
              description: VMWARE_METRIC_DESCRIPTIONS.hostPageAdapterErrors,
              render: (adapter: VMwareNetworkAdapterRow): ReactElement => {
                return renderTroubleRate(adapter.errorsPerSecond);
              },
            },
            {
              title: "Drops",
              description: VMWARE_METRIC_DESCRIPTIONS.hostPageAdapterDrops,
              render: (adapter: VMwareNetworkAdapterRow): ReactElement => {
                return renderTroubleRate(adapter.dropsPerSecond);
              },
            },
          ]}
        />
      </Card>
    </div>
  );
};

export interface StorageDevicesProps {
  devices: Array<VMwareStorageDeviceRow>;
}

export const VMwareHostStorageDevicesCard: FunctionComponent<
  StorageDevicesProps
> = (props: StorageDevicesProps): ReactElement => {
  if (props.devices.length === 0) {
    return <></>;
  }

  return (
    <div className="mb-6" data-testid="vmware-host-storage-devices">
      <Card
        title="Storage devices"
        description="The disks and LUNs this host reads and writes, each averaged over the selected range."
      >
        <DeviceTable<VMwareStorageDeviceRow>
          nameTitle={translationKey("Device")}
          rows={props.devices}
          rowTestId="vmware-host-storage-device"
          getName={(device: VMwareStorageDeviceRow): string => {
            return device.name;
          }}
          columns={[
            {
              title: "Read",
              description: VMWARE_METRIC_DESCRIPTIONS.hostPageDeviceThroughput,
              render: (device: VMwareStorageDeviceRow): string => {
                return formatBytesPerSecond(device.readBytesPerSecond);
              },
            },
            {
              title: "Write",
              render: (device: VMwareStorageDeviceRow): string => {
                return formatBytesPerSecond(device.writeBytesPerSecond);
              },
            },
            {
              title: "Read latency",
              description: VMWARE_METRIC_DESCRIPTIONS.hostPageDeviceLatency,
              render: (device: VMwareStorageDeviceRow): ReactElement => {
                return renderLatency(device.readLatencyMs);
              },
            },
            {
              title: "Write latency",
              render: (device: VMwareStorageDeviceRow): ReactElement => {
                return renderLatency(device.writeLatencyMs);
              },
            },
          ]}
        />
      </Card>
    </div>
  );
};
