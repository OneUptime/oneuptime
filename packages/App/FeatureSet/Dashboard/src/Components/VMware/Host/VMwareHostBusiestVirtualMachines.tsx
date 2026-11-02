import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledBodyClassName } from "Common/UI/Components/Card/CardSurface";
import Link from "Common/UI/Components/Link/Link";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { getThresholdBarColor } from "../../Infrastructure/ResourceTable";
import { VMWARE_METRIC_DESCRIPTIONS } from "../../MetricDescriptions/VMwareMetricDescriptions";
import { VMWARE_USAGE_BAR_THRESHOLDS } from "../VMwareResourceColumns";
import {
  VMwareBusyVirtualMachine,
  VMwareHostVirtualMachineSummary,
} from "../../../Pages/VMware/Utils/VMwareHostData";
import { getVMwareCpuReadyPercentTone } from "../../../Pages/VMware/Utils/VMwarePartFacts";
import {
  formatBytes,
  formatPercent,
} from "../../../Pages/VMware/Utils/VMwareResourceUtils";

/*
 * What is keeping an ESXi host busy: its running virtual machines using the
 * most CPU. On a host outside VMware its processes answer that; on a
 * hypervisor it is the VMs. Each opens its own page, and the line under the
 * list opens the host's Virtual Machines tab with all of them.
 *
 * "View all" sits under the list, as "2 more incidents" does under what is
 * open on the host: as a header button its long label took half the header
 * beside the side menu and squeezed the title onto two lines.
 *
 * A VM reads here as it does in the Virtual Machines tab and in Needs
 * attention just above: its CPU bar amber past 90%, never red, and a CPU
 * Ready badge once it waits for a free CPU more than 10% of the time, the
 * line the VM CPU Ready Contention alert fires at - amber, as Needs
 * attention says it. A red badge at 14% sat under an amber "CPU ready 14%".
 */

export interface ComponentProps {
  virtualMachines: Array<VMwareBusyVirtualMachine>;
  summary: VMwareHostVirtualMachineSummary;
  getVirtualMachineRoute: (externalId: string) => Route;
  onShowAll: () => void;
}

const VMwareHostBusiestVirtualMachines: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
  const bodyClassName: string = useCardRuledBodyClassName();

  // A host that runs no virtual machine has nothing to rank.
  if (props.summary.total === 0) {
    return <></>;
  }

  const title: string = tx("Busiest virtual machines");

  const showAll: ReactElement = (
    <div
      className="px-5 py-3 text-sm md:px-6"
      data-testid="vmware-host-busiest-vms-all"
    >
      <button
        type="button"
        onClick={props.onShowAll}
        className="rounded-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
      >
        {translator.translatePlural(
          {
            one: "View {{count}} virtual machine",
            other: "View all {{count}} virtual machines",
          },
          props.summary.total,
        )}
      </button>
    </div>
  );

  return (
    <div className="mb-6" data-testid="vmware-host-busiest-vms">
      <Card
        title={
          <span className="inline-flex items-center gap-1">
            {title}
            <InfoTooltip
              label={title}
              text={VMWARE_METRIC_DESCRIPTIONS.hostPageBusiestVirtualMachines}
            />
          </span>
        }
        description="The running VMs on this host using the most CPU in the latest inventory."
      >
        <div className={`${bodyClassName} divide-y divide-gray-200`}>
          {props.virtualMachines.length === 0 ? (
            <p
              className="px-5 py-4 text-sm text-gray-500 md:px-6"
              data-testid="vmware-host-busiest-vms-empty"
            >
              {props.summary.running === 0
                ? tx("No virtual machine is running on this host.")
                : tx(
                    "No running virtual machine has reported its CPU in the last 15 minutes.",
                  )}
            </p>
          ) : (
            <ol className="divide-y divide-gray-200">
              {props.virtualMachines.map(
                (vm: VMwareBusyVirtualMachine, index: number): ReactElement => {
                  const percent: number = Math.min(
                    100,
                    Math.max(0, vm.cpuPercent),
                  );

                  return (
                    <li
                      key={vm.externalId || vm.name}
                      data-testid="vmware-host-busy-vm"
                      className="flex items-center gap-3 px-5 py-3 md:px-6"
                    >
                      <span
                        className="w-4 flex-shrink-0 text-xs tabular-nums text-gray-400"
                        aria-hidden="true"
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Link
                            to={props.getVirtualMachineRoute(vm.externalId)}
                            className="min-w-0 break-all text-sm font-medium text-gray-900 hover:text-indigo-600 hover:underline"
                          >
                            {vm.name}
                          </Link>
                          {getVMwareCpuReadyPercentTone(vm.cpuReadyPercent) ===
                          "warning" ? (
                            <span
                              data-testid="vmware-host-busy-vm-cpu-ready"
                              className="inline-flex whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200"
                            >
                              {translator.translateTemplate(
                                "CPU Ready {{percent}}",
                                { percent: formatPercent(vm.cpuReadyPercent) },
                              )}
                            </span>
                          ) : (
                            <></>
                          )}
                        </div>
                        {vm.memoryBytes !== null ? (
                          <div className="mt-0.5 text-xs text-gray-500">
                            {vm.memoryLimitBytes !== null
                              ? translator.translateTemplate(
                                  "{{used}} of {{total}} memory",
                                  {
                                    used: formatBytes(vm.memoryBytes),
                                    total: formatBytes(vm.memoryLimitBytes),
                                  },
                                )
                              : translator.translateTemplate(
                                  "{{used}} memory",
                                  {
                                    used: formatBytes(vm.memoryBytes),
                                  },
                                )}
                          </div>
                        ) : (
                          <></>
                        )}
                      </div>
                      {/*
                       * Coloured as the VM's row in the Virtual Machines
                       * tab colours it, so one VM reads the same in both.
                       */}
                      <div
                        className="flex w-28 flex-shrink-0 items-center gap-2 sm:w-40"
                        title={tx("CPU")}
                      >
                        <div
                          className="h-1.5 min-w-0 flex-1 rounded-full bg-gray-100"
                          aria-hidden="true"
                        >
                          <div
                            data-testid="vmware-host-busy-vm-cpu-bar"
                            className={`h-1.5 rounded-full ${getThresholdBarColor(
                              percent,
                              VMWARE_USAGE_BAR_THRESHOLDS,
                              "bg-green-500",
                            )}`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <span className="w-12 text-right text-xs tabular-nums text-gray-700">
                          <span className="sr-only">{`${tx("CPU")} `}</span>
                          {formatPercent(vm.cpuPercent)}
                        </span>
                      </div>
                    </li>
                  );
                },
              )}
            </ol>
          )}
          {showAll}
        </div>
      </Card>
    </div>
  );
};

export default VMwareHostBusiestVirtualMachines;
