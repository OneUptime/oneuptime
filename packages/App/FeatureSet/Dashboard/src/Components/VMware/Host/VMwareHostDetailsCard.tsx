import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import VMwareResourceModel from "Common/Models/DatabaseModels/VMwareResource";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Link from "Common/UI/Components/Link/Link";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { VMWARE_METRIC_DESCRIPTIONS } from "../../MetricDescriptions/VMwareMetricDescriptions";
import {
  VMwareHostIdentity,
  VMwareHostVirtualMachineSummary,
  toFiniteNumber,
} from "../../../Pages/VMware/Utils/VMwareHostData";
import {
  formatBytes,
  formatMhz,
} from "../../../Pages/VMware/Utils/VMwareResourceUtils";

/*
 * An ESXi host's details, as the host page outside VMware has its
 * Identification and Hardware cards: who the host is to vCenter, how big it
 * is, what it runs and when vCenter last reported it - each value one copy
 * away, nothing to edit (vCenter owns the host).
 */

export interface ComponentProps {
  identity: VMwareHostIdentity;
  externalId: string;
  row: VMwareResourceModel | null;
  clusterRoute?: Route | undefined;
  virtualMachines: VMwareHostVirtualMachineSummary | null;
}

interface DetailRow {
  key: string;
  label: string;
  value: ReactElement | string;
  description?: string | undefined;
  mono?: boolean | undefined;
}

const VMwareHostDetailsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
  const listClassName: string = useCardRuledListClassName();

  const cpuCapacity: number | null = toFiniteNumber(props.row?.cpuCapacityMhz);
  const memoryCapacity: number | null = toFiniteNumber(
    props.row?.maxMemoryBytes,
  );

  const rows: Array<DetailRow> = [
    {
      key: "host",
      label: "Host name",
      value: props.identity.hostName,
      mono: true,
    },
    { key: "vcenter", label: "vCenter", value: props.identity.vcenterName },
  ];

  if (props.identity.datacenterName) {
    rows.push({
      key: "datacenter",
      label: "Datacenter",
      value: props.identity.datacenterName,
    });
  }

  rows.push({
    key: "cluster",
    label: "Cluster",
    value: props.row?.clusterName ? (
      props.clusterRoute ? (
        <Link
          to={props.clusterRoute}
          className="text-indigo-600 hover:text-indigo-700 hover:underline"
        >
          {props.row.clusterName}
        </Link>
      ) : (
        props.row.clusterName
      )
    ) : (
      tx("None - a standalone host")
    ),
  });

  if (cpuCapacity !== null) {
    rows.push({
      key: "cpu",
      label: "CPU capacity",
      value: formatMhz(cpuCapacity),
      description: VMWARE_METRIC_DESCRIPTIONS.hostCpuCapacity,
    });
  }

  if (memoryCapacity !== null) {
    rows.push({
      key: "memory",
      label: "Memory",
      value: formatBytes(memoryCapacity),
    });
  }

  if (props.virtualMachines) {
    rows.push({
      key: "vms",
      label: "Virtual machines",
      value: translator.translateTemplate(
        "{{total}} ({{running}} running, {{off}} off)",
        {
          total: props.virtualMachines.total,
          running: props.virtualMachines.running,
          off: props.virtualMachines.poweredOff + props.virtualMachines.unknown,
        },
      ),
    });

    if (props.virtualMachines.templates > 0) {
      rows.push({
        key: "templates",
        label: "VM templates",
        value: String(props.virtualMachines.templates),
      });
    }
  }

  if (props.row?.metricsUpdatedAt) {
    const updatedAt: Date = new Date(props.row.metricsUpdatedAt as Date);

    rows.push({
      key: "metrics-updated",
      label: "Metrics updated",
      value: (
        <span title={OneUptimeDate.getDateAsLocalFormattedString(updatedAt)}>
          {OneUptimeDate.fromNow(updatedAt)}
        </span>
      ),
    });
  }

  rows.push({
    key: "inventory-id",
    label: "Inventory ID",
    value: props.externalId,
    mono: true,
  });

  return (
    <div className="mb-6" data-testid="vmware-host-details">
      <Card
        title="Details"
        description="How vCenter knows this host. vCenter owns these: change them there."
      >
        <dl className={listClassName}>
          {rows.map((row: DetailRow): ReactElement => {
            return (
              <div
                key={row.key}
                data-testid={`vmware-host-detail-${row.key}`}
                className="px-5 py-3 sm:grid sm:grid-cols-3 sm:gap-4 md:px-6"
              >
                <dt className="flex items-center gap-1 text-sm font-medium text-gray-500">
                  {tx(row.label)}
                  {row.description ? (
                    <InfoTooltip label={row.label} text={row.description} />
                  ) : (
                    <></>
                  )}
                </dt>
                <dd
                  className={`mt-1 break-all text-sm text-gray-900 sm:col-span-2 sm:mt-0 ${
                    row.mono ? "font-mono" : ""
                  }`}
                >
                  {row.value}
                </dd>
              </div>
            );
          })}
        </dl>
      </Card>
    </div>
  );
};

export default VMwareHostDetailsCard;
