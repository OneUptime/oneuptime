import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { composedValue, Translator } from "Common/UI/Utils/TranslateTemplate";
import { formatRelativeTime } from "../../Home/HomeRelativeTime";
import {
  VMwareHostReportState,
  VMwareHostReportStateLook,
  VMwareHostStatusTone,
  VMwareHostVirtualMachineSummary,
  getVMwareHostReportStateLook,
} from "../../../Pages/VMware/Utils/VMwareHostData";
import {
  formatBytes,
  formatMhz,
} from "../../../Pages/VMware/Utils/VMwareResourceUtils";

/*
 * The top of an ESXi host's page, above its tabs: which host this is, where
 * it sits in vCenter, whether vCenter is still reporting it, and its size -
 * the hero the host page outside VMware opens with, with what vCenter knows
 * about a host in place of what an agent on it would report (an operating
 * system, cores, processes).
 */

export interface ComponentProps {
  hostName: string;
  reportState: VMwareHostReportState;
  lastReportAt: Date | null;
  datacenterName?: string | undefined;
  clusterName?: string | undefined;
  // The cluster's own page, when the host is in a cluster.
  clusterRoute?: Route | undefined;
  /*
   * Whether the host is known to be in no cluster: true for a host vCenter
   * reports outside a cluster, unset when nothing says (a host no longer in
   * the inventory).
   */
  isStandalone?: boolean | undefined;
  cpuCapacityMhz: number | null;
  memoryCapacityBytes: number | null;
  virtualMachines: VMwareHostVirtualMachineSummary | null;
}

const TONE_CLASS_NAMES: Record<
  VMwareHostStatusTone,
  { badge: string; dot: string }
> = {
  positive: {
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  warning: {
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
  },
  neutral: {
    badge: "bg-gray-50 text-gray-600 ring-gray-200",
    dot: "bg-gray-400",
  },
};

interface HeroChip {
  key: string;
  icon: IconProp;
  label: string;
}

const VMwareHostHero: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
  const look: VMwareHostReportStateLook = getVMwareHostReportStateLook(
    props.reportState,
  );
  const toneClassNames: { badge: string; dot: string } =
    TONE_CLASS_NAMES[look.tone];

  const renderLocation: () => ReactElement = (): ReactElement => {
    const datacenter: string = props.datacenterName || "";

    if (props.clusterName) {
      const cluster: ReactElement = props.clusterRoute ? (
        <Link
          to={props.clusterRoute}
          className="font-medium text-gray-700 underline decoration-gray-300 underline-offset-2 hover:text-indigo-600 hover:decoration-indigo-400"
        >
          {props.clusterName}
        </Link>
      ) : (
        <span className="font-medium text-gray-700">{props.clusterName}</span>
      );

      return datacenter ? (
        <TranslatedSentence
          template="ESXi host in cluster {{cluster}}, datacenter {{datacenter}}"
          slots={{ cluster: cluster }}
          values={{ datacenter: datacenter }}
        />
      ) : (
        <TranslatedSentence
          template="ESXi host in cluster {{cluster}}"
          slots={{ cluster: cluster }}
        />
      );
    }

    if (datacenter && props.isStandalone) {
      return (
        <>
          {translator.translateTemplate(
            "Standalone ESXi host in datacenter {{datacenter}}",
            { datacenter: datacenter },
          )}
        </>
      );
    }

    if (datacenter) {
      return (
        <>
          {translator.translateTemplate(
            "ESXi host in datacenter {{datacenter}}",
            { datacenter: datacenter },
          )}
        </>
      );
    }

    return <>{tx("ESXi host")}</>;
  };

  const chips: Array<HeroChip> = [];

  if (props.cpuCapacityMhz !== null && props.cpuCapacityMhz > 0) {
    chips.push({
      key: "cpu",
      icon: IconProp.CPUChip,
      label: translator.translateTemplate("{{capacity}} CPU", {
        capacity: formatMhz(props.cpuCapacityMhz),
      }),
    });
  }

  if (props.memoryCapacityBytes !== null && props.memoryCapacityBytes > 0) {
    chips.push({
      key: "memory",
      icon: IconProp.SquareStack,
      label: translator.translateTemplate("{{capacity}} memory", {
        capacity: formatBytes(props.memoryCapacityBytes),
      }),
    });
  }

  if (props.virtualMachines && props.virtualMachines.total > 0) {
    chips.push({
      key: "vms",
      icon: IconProp.ComputerDesktop,
      label: translator.translatePlural(
        {
          one: "{{count}} VM, {{running}} running",
          other: "{{count}} VMs, {{running}} running",
        },
        props.virtualMachines.total,
        { running: props.virtualMachines.running },
      ),
    });
  }

  return (
    <div
      data-testid="vmware-host-hero"
      data-report-state={props.reportState}
      className="relative mb-6 rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
        <div
          className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-indigo-50 via-white to-white"
          aria-hidden="true"
        />
      </div>
      <div className="relative px-5 py-5 md:px-6">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-inset ring-indigo-200">
            <Icon icon={IconProp.Server} className="h-6 w-6 text-indigo-600" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2
                className="min-w-0 break-all text-xl font-semibold text-gray-900"
                data-testid="vmware-host-name"
              >
                {props.hostName}
              </h2>
              <span
                data-testid="vmware-host-status"
                title={tx(look.description)}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${toneClassNames.badge}`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${toneClassNames.dot}`}
                  aria-hidden="true"
                />
                {tx(look.label)}
                <span className="sr-only">{` ${tx(look.description)}`}</span>
              </span>
            </div>
            <div
              className="mt-1 text-sm text-gray-500"
              data-testid="vmware-host-location"
            >
              {renderLocation()}
            </div>
            {/*
             * A host no longer in the inventory has no report time left to
             * show: the notice under the hero says what happened instead.
             * "Last reported", in the status's own words, and its own
             * sentence rather than the shared "Last seen {{time}}": vCenter
             * reports a host, it is not seen.
             * The exact time is the line's title. A host vCenter stopped
             * reporting has the notice under the hero open with the same
             * time, so the line is left out rather than said twice.
             */}
            {props.lastReportAt &&
            props.reportState !== VMwareHostReportState.NotReporting ? (
              <div
                className="mt-1 text-xs text-gray-500"
                data-testid="vmware-host-last-seen"
                title={OneUptimeDate.getDateAsLocalFormattedString(
                  props.lastReportAt,
                )}
              >
                {translator.translateTemplate("Last reported {{time}}", {
                  // In the language the sentence is shown in.
                  time: composedValue((sentence: Translator): string => {
                    return formatRelativeTime({
                      date: props.lastReportAt as Date,
                      now: new Date(),
                      language: sentence.language,
                    });
                  }),
                })}
              </div>
            ) : (
              <></>
            )}
          </div>
        </div>

        {chips.length > 0 ? (
          <div
            className="mt-4 flex flex-wrap gap-1.5"
            data-testid="vmware-host-chips"
          >
            {chips.map((chip: HeroChip): ReactElement => {
              return (
                <span
                  key={chip.key}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700"
                >
                  <Icon icon={chip.icon} className="h-3 w-3 text-gray-500" />
                  <span className="font-medium">{chip.label}</span>
                </span>
              );
            })}
          </div>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default VMwareHostHero;
