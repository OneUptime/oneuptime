import React, { FunctionComponent, ReactElement } from "react";
import VMwareResource from "Common/Models/DatabaseModels/VMwareResource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { RESOURCE_PART_TONE_CLASS_NAMES } from "../ResourcePart/ResourcePartHero";
import ResourcePartRow from "../ResourcePart/ResourcePartRow";
import { ResourcePartStatus } from "../ResourcePart/ResourcePartTypes";
import {
  VMWARE_HOST_SATURATION_PERCENT,
  findVMwareDatacenter,
  getVMwareHostName,
  getVMwareHostStatus,
  toVMwareNumber,
} from "../../Pages/VMware/Utils/VMwareHealth";
import {
  VMwareHostLoad,
  getVMwareHostLoad,
  sortVMwareHostsForGlance,
} from "../../Pages/VMware/Utils/VMwarePartFacts";
import {
  formatBytes,
  formatMhz,
} from "../../Pages/VMware/Utils/VMwareResourceUtils";

/*
 * A vCenter's ESXi hosts at a glance - what vCenter's own Hosts tab opens
 * with: each host, whether vCenter can reach it, how busy it is, one step
 * from its page. The hosts that need attention come first (not responding
 * before a busy one), then the running ones, then the ones powered off or
 * in standby (sortVMwareHostsForGlance).
 *
 * The bars are the host's latest report, amber past 90% as the Host CPU and
 * Memory Saturation alerts say, never red: a busy host is one to look at.
 * A host that is not running shows no numbers rather than an idle 0%. Each
 * row is a link to the host's page, the whole row (ResourcePartRow).
 */

// How many hosts the card lists before it points to the Hosts list.
export const VMWARE_HOSTS_CARD_SHOWN: number = 8;

export interface ComponentProps {
  hosts: Array<VMwareResource>;
  datacenters: Array<VMwareResource>;
  getHostRoute: (externalId: string) => Route | undefined;
  // Where "View all" leads: the Hosts list, or a tab of the page it is on.
  hostsRoute?: Route | undefined;
  onShowAll?: (() => void) | undefined;
  now: Date;
  // A cluster's page leaves the cluster's name off each row.
  showCluster?: boolean | undefined;
  description?: string | undefined;
  testId?: string | undefined;
}

export function getVMwareHostBarClassName(percent: number): string {
  return percent > VMWARE_HOST_SATURATION_PERCENT
    ? "bg-amber-500"
    : "bg-emerald-500";
}

const VMwareHostsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const listClassName: string = useCardRuledListClassName();
  const testId: string = props.testId || "vmware-hosts-card";

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const hosts: Array<VMwareResource> = sortVMwareHostsForGlance({
    hosts: props.hosts,
    datacenters: props.datacenters,
    now: props.now,
  });

  if (hosts.length === 0) {
    return <></>;
  }

  const shown: Array<VMwareResource> = hosts.slice(0, VMWARE_HOSTS_CARD_SHOWN);

  const viewAllLabel: string = translator.translatePlural(
    { one: "View {{count}} host", other: "View all {{count}} hosts" },
    hosts.length,
  );
  const viewAllClassName: string =
    "inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
  const viewAll: Array<ReactElement> = props.onShowAll
    ? [
        <button
          key="all-hosts"
          type="button"
          onClick={props.onShowAll}
          className={viewAllClassName}
          data-testid={`${testId}-all`}
        >
          {viewAllLabel}
        </button>,
      ]
    : props.hostsRoute
      ? [
          <Link
            key="all-hosts"
            to={props.hostsRoute}
            className={viewAllClassName}
            dataTestId={`${testId}-all`}
          >
            {viewAllLabel}
          </Link>,
        ]
      : [];

  const renderBar: (data: {
    key: string;
    label: string;
    percent: number | null;
  }) => ReactElement = (data: {
    key: string;
    label: string;
    percent: number | null;
  }): ReactElement => {
    const percent: number | null =
      data.percent === null ? null : Math.min(100, Math.max(0, data.percent));
    return (
      <div className="min-w-0 flex-1" data-testid={`${testId}-${data.key}`}>
        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
          <span className="text-gray-500">{tx(data.label)}</span>
          <span className="font-medium tabular-nums text-gray-700">
            {percent === null ? "—" : `${Math.round(percent)}%`}
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-gray-100">
          {percent === null ? (
            <></>
          ) : (
            <div
              className={`h-1.5 rounded-full ${getVMwareHostBarClassName(percent)}`}
              style={{ width: `${Math.max(percent, 2)}%` }}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="mb-6" data-testid={testId}>
      <Card
        title="ESXi Hosts"
        description={
          props.description ||
          "Each host's state and load at vCenter's latest report, the ones that need attention first."
        }
        buttons={viewAll}
      >
        <ul className={listClassName}>
          {shown.map((host: VMwareResource): ReactElement => {
            const externalId: string = host.externalId || "";
            const name: string = getVMwareHostName(host) || externalId;
            const datacenter: VMwareResource | null = findVMwareDatacenter(
              props.datacenters,
              host.datacenterName,
            );
            const status: ResourcePartStatus = getVMwareHostStatus({
              host: host,
              datacenter: datacenter,
              now: props.now,
            });
            const load: VMwareHostLoad = getVMwareHostLoad({
              host: host,
              datacenter: datacenter,
              now: props.now,
            });

            const facts: Array<string> = [];
            if (props.showCluster !== false) {
              facts.push(
                host.clusterName
                  ? translator.translateTemplate("Cluster {{cluster}}", {
                      cluster: host.clusterName,
                    })
                  : tx("Standalone"),
              );
            }
            const cpuCapacity: number | null = toVMwareNumber(
              host.cpuCapacityMhz,
            );
            if (cpuCapacity !== null && cpuCapacity > 0) {
              facts.push(
                translator.translateTemplate("{{capacity}} CPU", {
                  capacity: formatMhz(cpuCapacity),
                }),
              );
            }
            const memoryCapacity: number | null = toVMwareNumber(
              host.maxMemoryBytes,
            );
            if (memoryCapacity !== null && memoryCapacity > 0) {
              facts.push(
                translator.translateTemplate("{{capacity}} memory", {
                  capacity: formatBytes(memoryCapacity),
                }),
              );
            }

            return (
              <li
                key={externalId || name}
                data-testid={`${testId}-item`}
                data-host={name}
              >
                <ResourcePartRow
                  to={externalId ? props.getHostRoute(externalId) : undefined}
                  className="flex flex-col gap-3 md:flex-row md:items-center md:gap-6"
                >
                  <div className="flex min-w-0 items-start gap-3 md:w-2/5">
                    <div
                      className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200"
                      aria-hidden="true"
                    >
                      <Icon
                        icon={IconProp.ServerStack}
                        className="h-3.5 w-3.5"
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span
                          data-testid={`${testId}-name`}
                          className="min-w-0 text-sm font-medium text-gray-900 [overflow-wrap:anywhere]"
                        >
                          {/*
                           * Alone in its box, a name of any length breaks
                           * after its dots: at 768px beside the side menu
                           * "esx03.acme.example" broke as "esx03.acme.exa" /
                           * "mple".
                           */}
                          <bdi>
                            <BreakableName text={name} breaksFromLength={0} />
                          </bdi>
                        </span>
                        <span
                          data-testid={`${testId}-status`}
                          data-tone={status.tone}
                          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${RESOURCE_PART_TONE_CLASS_NAMES[status.tone].badge}`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${RESOURCE_PART_TONE_CLASS_NAMES[status.tone].dot}`}
                            aria-hidden="true"
                          />
                          {tx(status.label)}
                        </span>
                      </div>
                      {/*
                       * Each fact whole on its line - on a phone "512" ended
                       * one line and "GiB memory" began the next - while a
                       * long cluster name may still break after its dots.
                       */}
                      {facts.length > 0 ? (
                        <div
                          className="mt-0.5 text-xs text-gray-500"
                          data-testid={`${testId}-facts`}
                        >
                          {facts.map(
                            (fact: string, index: number): ReactElement => {
                              return (
                                <React.Fragment key={`${fact}-${index}`}>
                                  {index > 0 ? " · " : ""}
                                  <span
                                    className={
                                      index === 0 && props.showCluster !== false
                                        ? "[overflow-wrap:anywhere]"
                                        : "whitespace-nowrap"
                                    }
                                  >
                                    {index === 0 &&
                                    props.showCluster !== false ? (
                                      <BreakableName text={fact} />
                                    ) : (
                                      fact
                                    )}
                                  </span>
                                </React.Fragment>
                              );
                            },
                          )}
                        </div>
                      ) : (
                        <></>
                      )}
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-1 gap-4 ps-10 md:ps-0">
                    {renderBar({
                      key: "cpu",
                      label: "CPU",
                      percent: load.cpuPercent,
                    })}
                    {renderBar({
                      key: "memory",
                      label: "Memory",
                      percent: load.memoryPercent,
                    })}
                  </div>
                </ResourcePartRow>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
};

export default VMwareHostsCard;
