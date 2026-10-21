import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import VMwareResourceModel from "Common/Models/DatabaseModels/VMwareResource";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledBodyClassName } from "Common/UI/Components/Card/CardSurface";
import CopyableButton from "Common/UI/Components/CopyableButton/CopyableButton";
import { DETAIL_VALUE_CLASS_NAME } from "Common/UI/Components/Detail/Detail";
import { DETAIL_FIELD_LABEL_CLASS_NAME } from "Common/UI/Components/Detail/DetailFieldLabel";
import {
  getDetailCellClassNames,
  getDetailGridClassName,
} from "Common/UI/Components/Detail/DetailGridLayout";
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
 * is and what it runs - nothing to edit (vCenter owns the host), and the
 * names a reader pastes elsewhere one copy away.
 *
 * Laid out the way every detail card in the product is (Detail's grid:
 * each name over its value, three columns on a wide screen, rules between
 * the rows), not as ten label-and-value lines that took 550px for what fits
 * in four rows. When vCenter last reported the host is the hero's line, so
 * it is not repeated here.
 */

// The detail card's columns on a wide screen (two from sm, one on a phone).
export const VMWARE_HOST_DETAIL_COLUMNS: number = 3;

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
  // What the value's copy button copies; no button without it.
  copyText?: string | undefined;
}

const VMwareHostDetailsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
  const bodyClassName: string = useCardRuledBodyClassName();

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
      copyText: props.identity.hostName,
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

  /*
   * A host no longer in the inventory may have been in a cluster or not:
   * nothing says, so no row rather than a guess.
   */
  if (props.row) {
    rows.push({
      key: "cluster",
      label: "Cluster",
      value: props.row.clusterName ? (
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
  }

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
      value:
        props.virtualMachines.total === 0
          ? tx("None")
          : translator.translateTemplate(
              "{{total}} ({{running}} running, {{off}} off)",
              {
                total: props.virtualMachines.total,
                running: props.virtualMachines.running,
                off:
                  props.virtualMachines.poweredOff +
                  props.virtualMachines.unknown,
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

  rows.push({
    key: "inventory-id",
    label: "Inventory ID",
    value: props.externalId,
    mono: true,
    copyText: props.externalId,
  });

  // Where each field sits in the grid, as Detail places its fields.
  const cellClassNames: Array<string> = getDetailCellClassNames(
    rows.map((): undefined => {
      return undefined;
    }),
    VMWARE_HOST_DETAIL_COLUMNS,
  );

  return (
    <div className="mb-6" data-testid="vmware-host-details">
      <Card
        title="Details"
        description="How vCenter knows this host. vCenter owns these: change them there."
      >
        <div className={`${bodyClassName} px-5 py-5 md:px-6`}>
          <dl className={getDetailGridClassName(VMWARE_HOST_DETAIL_COLUMNS)}>
            {rows.map((row: DetailRow, index: number): ReactElement => {
              return (
                <div
                  key={row.key}
                  data-testid={`vmware-host-detail-${row.key}`}
                  className={cellClassNames[index]}
                >
                  <dt
                    className={`flex justify-start ${DETAIL_FIELD_LABEL_CLASS_NAME}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {tx(row.label)}
                      {row.description ? (
                        <InfoTooltip label={row.label} text={row.description} />
                      ) : (
                        <></>
                      )}
                    </span>
                  </dt>
                  <dd
                    className={`${DETAIL_VALUE_CLASS_NAME} flex items-start gap-2`}
                  >
                    <div
                      className={`min-w-0 break-all${row.mono ? " font-mono" : ""}`}
                    >
                      {row.value}
                    </div>
                    {/*
                     * Beside the value and always in view, as on every
                     * detail card: a keyboard, a touch screen or a reader
                     * who would not think to hover still finds it.
                     */}
                    {row.copyText ? (
                      <div
                        className="flex h-6 flex-none items-center"
                        data-testid="vmware-host-detail-copy"
                      >
                        <CopyableButton textToBeCopied={row.copyText} />
                      </div>
                    ) : (
                      <></>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      </Card>
    </div>
  );
};

export default VMwareHostDetailsCard;
