import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Link from "Common/UI/Components/Link/Link";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { VMWARE_METRIC_DESCRIPTIONS } from "../../MetricDescriptions/VMwareMetricDescriptions";
import {
  VMwareBusyVirtualMachine,
  VMwareHostVirtualMachineSummary,
} from "../../../Pages/VMware/Utils/VMwareHostData";
import {
  formatBytes,
  formatPercent,
} from "../../../Pages/VMware/Utils/VMwareResourceUtils";

/*
 * What is keeping an ESXi host busy: its running virtual machines using the
 * most CPU. On a host outside VMware its processes answer that; on a
 * hypervisor it is the VMs. Each opens its own page, and the card's button
 * opens the host's Virtual machines tab with all of them.
 */

// CPU Ready from which a VM is waiting noticeably (the overview's levels).
export const VM_CPU_READY_WARN_PERCENT: number = 5;
export const VM_CPU_READY_DANGER_PERCENT: number = 10;

export interface ComponentProps {
  virtualMachines: Array<VMwareBusyVirtualMachine>;
  summary: VMwareHostVirtualMachineSummary;
  getVirtualMachineRoute: (externalId: string) => Route;
  onShowAll: () => void;
}

function getCpuBarClassName(percent: number): string {
  if (percent >= 90) {
    return "bg-red-500";
  }

  if (percent >= 70) {
    return "bg-amber-500";
  }

  return "bg-indigo-500";
}

const VMwareHostBusiestVirtualMachines: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
  const listClassName: string = useCardRuledListClassName();

  // A host that runs no virtual machine has nothing to rank.
  if (props.summary.total === 0) {
    return <></>;
  }

  const title: string = tx("Busiest virtual machines");

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
        description="The running VMs on this host using the most CPU right now."
        buttons={[
          {
            title: translator.translatePlural(
              {
                one: "View {{count}} virtual machine",
                other: "View all {{count}} virtual machines",
              },
              props.summary.total,
            ),
            icon: IconProp.ComputerDesktop,
            buttonStyle: ButtonStyleType.NORMAL,
            onClick: props.onShowAll,
          },
        ]}
      >
        {props.virtualMachines.length === 0 ? (
          <p
            className="text-sm text-gray-500"
            data-testid="vmware-host-busiest-vms-empty"
          >
            {props.summary.running === 0
              ? tx("No virtual machine is running on this host.")
              : tx(
                  "No running virtual machine has reported its CPU in the last 15 minutes.",
                )}
          </p>
        ) : (
          <ol className={listClassName}>
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
                        {vm.cpuReadyPercent !== null &&
                        vm.cpuReadyPercent >= VM_CPU_READY_WARN_PERCENT ? (
                          <span
                            data-testid="vmware-host-busy-vm-cpu-ready"
                            className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                              vm.cpuReadyPercent >= VM_CPU_READY_DANGER_PERCENT
                                ? "bg-red-50 text-red-700 ring-red-200"
                                : "bg-amber-50 text-amber-700 ring-amber-200"
                            }`}
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
                            : translator.translateTemplate("{{used}} memory", {
                                used: formatBytes(vm.memoryBytes),
                              })}
                        </div>
                      ) : (
                        <></>
                      )}
                    </div>
                    <div
                      className="flex w-28 flex-shrink-0 items-center gap-2 sm:w-40"
                      title={tx("CPU")}
                    >
                      <div
                        className="h-1.5 min-w-0 flex-1 rounded-full bg-gray-100"
                        aria-hidden="true"
                      >
                        <div
                          className={`h-1.5 rounded-full ${getCpuBarClassName(percent)}`}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <span className="w-12 text-right text-xs tabular-nums text-gray-700">
                        {formatPercent(vm.cpuPercent)}
                      </span>
                    </div>
                  </li>
                );
              },
            )}
          </ol>
        )}
      </Card>
    </div>
  );
};

export default VMwareHostBusiestVirtualMachines;
