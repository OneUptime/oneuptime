import React, { FunctionComponent, ReactElement } from "react";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledBodyClassName } from "Common/UI/Components/Card/CardSurface";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
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
 * A card shows only when the host reported at least one device: the
 * per-device counters need vCenter's statistics level 2 or higher for the
 * real-time interval, and a vCenter that collects less has nothing to put
 * in them.
 */

function formatBytesPerSecond(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  return ValueFormatter.formatValue(value, "By/s");
}

interface HeaderCell {
  title: string;
  description?: string | undefined;
  alignRight?: boolean | undefined;
}

const HEADER_CLASS_NAME: string =
  "px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500 first:pl-5 last:pr-5 md:first:pl-6 md:last:pr-6";

const CELL_CLASS_NAME: string =
  "px-4 py-3 text-sm text-gray-700 tabular-nums first:pl-5 last:pr-5 md:first:pl-6 md:last:pr-6";

const DeviceTableHeader: FunctionComponent<{
  cells: Array<HeaderCell>;
}> = (props: { cells: Array<HeaderCell> }): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  return (
    <thead className="bg-gray-50">
      <tr>
        {props.cells.map((cell: HeaderCell): ReactElement => {
          return (
            <th
              key={cell.title}
              scope="col"
              className={`${HEADER_CLASS_NAME} whitespace-nowrap ${
                cell.alignRight ? "text-right" : "text-left"
              }`}
            >
              <span
                className={`inline-flex items-center gap-1 ${
                  cell.alignRight ? "justify-end" : ""
                }`}
              >
                {tx(cell.title)}
                {cell.description ? (
                  <InfoTooltip label={cell.title} text={cell.description} />
                ) : (
                  <></>
                )}
              </span>
            </th>
          );
        })}
      </tr>
    </thead>
  );
};

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

export interface NetworkAdaptersProps {
  adapters: Array<VMwareNetworkAdapterRow>;
}

export const VMwareHostNetworkAdaptersCard: FunctionComponent<
  NetworkAdaptersProps
> = (props: NetworkAdaptersProps): ReactElement => {
  const bodyClassName: string = useCardRuledBodyClassName();

  if (props.adapters.length === 0) {
    return <></>;
  }

  return (
    <div className="mb-6" data-testid="vmware-host-network-adapters">
      <Card
        title="Network adapters"
        description="The host's physical network adapters, each averaged over the selected range."
      >
        <div className={bodyClassName}>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <DeviceTableHeader
                cells={[
                  { title: "Adapter" },
                  {
                    title: "Received",
                    description:
                      VMWARE_METRIC_DESCRIPTIONS.hostPageAdapterThroughput,
                    alignRight: true,
                  },
                  { title: "Sent", alignRight: true },
                  {
                    title: "Packets",
                    description:
                      VMWARE_METRIC_DESCRIPTIONS.hostPageAdapterPackets,
                    alignRight: true,
                  },
                  {
                    title: "Errors",
                    description:
                      VMWARE_METRIC_DESCRIPTIONS.hostPageAdapterErrors,
                    alignRight: true,
                  },
                  {
                    title: "Drops",
                    description:
                      VMWARE_METRIC_DESCRIPTIONS.hostPageAdapterDrops,
                    alignRight: true,
                  },
                ]}
              />
              <tbody className="divide-y divide-gray-100 bg-white">
                {props.adapters.map(
                  (adapter: VMwareNetworkAdapterRow): ReactElement => {
                    return (
                      <tr
                        key={adapter.name}
                        data-testid="vmware-host-network-adapter"
                      >
                        <td
                          className={`${CELL_CLASS_NAME} whitespace-nowrap font-mono font-medium text-gray-900`}
                        >
                          {adapter.name}
                        </td>
                        <td
                          className={`${CELL_CLASS_NAME} whitespace-nowrap text-right`}
                        >
                          {formatBytesPerSecond(adapter.receivedBytesPerSecond)}
                        </td>
                        <td
                          className={`${CELL_CLASS_NAME} whitespace-nowrap text-right`}
                        >
                          {formatBytesPerSecond(adapter.sentBytesPerSecond)}
                        </td>
                        <td
                          className={`${CELL_CLASS_NAME} whitespace-nowrap text-right`}
                        >
                          {formatVMwarePerSecond(adapter.packetsPerSecond)}
                        </td>
                        <td
                          className={`${CELL_CLASS_NAME} whitespace-nowrap text-right`}
                        >
                          {renderTroubleRate(adapter.errorsPerSecond)}
                        </td>
                        <td
                          className={`${CELL_CLASS_NAME} whitespace-nowrap text-right`}
                        >
                          {renderTroubleRate(adapter.dropsPerSecond)}
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        </div>
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
  const bodyClassName: string = useCardRuledBodyClassName();

  if (props.devices.length === 0) {
    return <></>;
  }

  return (
    <div className="mb-6" data-testid="vmware-host-storage-devices">
      <Card
        title="Storage devices"
        description="The disks and LUNs this host reads and writes, each averaged over the selected range."
      >
        <div className={bodyClassName}>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <DeviceTableHeader
                cells={[
                  { title: "Device" },
                  {
                    title: "Read",
                    description:
                      VMWARE_METRIC_DESCRIPTIONS.hostPageDeviceThroughput,
                    alignRight: true,
                  },
                  { title: "Write", alignRight: true },
                  {
                    title: "Read latency",
                    description:
                      VMWARE_METRIC_DESCRIPTIONS.hostPageDeviceLatency,
                    alignRight: true,
                  },
                  { title: "Write latency", alignRight: true },
                ]}
              />
              <tbody className="divide-y divide-gray-100 bg-white">
                {props.devices.map(
                  (device: VMwareStorageDeviceRow): ReactElement => {
                    return (
                      <tr
                        key={device.name}
                        data-testid="vmware-host-storage-device"
                      >
                        <td
                          className={`${CELL_CLASS_NAME} max-w-[16rem] break-all font-mono font-medium text-gray-900`}
                        >
                          {device.name}
                        </td>
                        <td
                          className={`${CELL_CLASS_NAME} whitespace-nowrap text-right`}
                        >
                          {formatBytesPerSecond(device.readBytesPerSecond)}
                        </td>
                        <td
                          className={`${CELL_CLASS_NAME} whitespace-nowrap text-right`}
                        >
                          {formatBytesPerSecond(device.writeBytesPerSecond)}
                        </td>
                        <td
                          className={`${CELL_CLASS_NAME} whitespace-nowrap text-right`}
                        >
                          {renderLatency(device.readLatencyMs)}
                        </td>
                        <td
                          className={`${CELL_CLASS_NAME} whitespace-nowrap text-right`}
                        >
                          {renderLatency(device.writeLatencyMs)}
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </div>
  );
};
