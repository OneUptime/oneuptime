import React, { FunctionComponent, ReactElement } from "react";
import XcpNgResource from "Common/Models/DatabaseModels/XcpNgResource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import XcpNgResourceKind from "Common/Types/XcpNg/XcpNgResourceKind";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import EmptyValue from "Common/UI/Components/Detail/EmptyValue";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { formatReaderFigure } from "Common/Types/DateLanguage";
import { RESOURCE_PART_TONE_CLASS_NAMES } from "../ResourcePart/ResourcePartHero";
import ResourcePartRow from "../ResourcePart/ResourcePartRow";
import { ResourcePartStatus } from "../ResourcePart/ResourcePartTypes";
import {
  XcpNgRowsOnHost,
  XcpNgVmSummary,
  getXcpNgHostStatus,
  getXcpNgMemoryPercent,
  getXcpNgRowsOnHost,
  sortXcpNgHostsForGlance,
  summarizeXcpNgVms,
} from "../../Pages/XcpNg/Utils/XcpNgPartFacts";
import {
  XCP_NG_METRIC_STALE_MS,
  formatXcpNgUptime,
  getXcpNgDisplayName,
  isXcpNgReadingFresh,
  toXcpNgNumber,
} from "../../Pages/XcpNg/Utils/XcpNgResourceUtils";
import { getXcpNgMissingPatchCount } from "../../Pages/XcpNg/Utils/XcpNgEventFacts";

/*
 * THE POOL'S HOSTS AT A GLANCE, on its Overview - what Xen Orchestra's own
 * pool view opens with: each host, its state (a disabled one with a grey
 * Disabled chip: someone chose it), how busy it is and the VMs it runs, one
 * step from its page. Halted hosts come first, then disabled ones, then the
 * rest by name, as people number them (xcp-2 before xcp-10).
 *
 * The bars are the host's latest report: a host that has sent nothing for
 * 15 minutes shows no numbers rather than old ones (the lists' rule). Each
 * row is a link to the host's page, the whole row (ResourcePartRow).
 */

// How many hosts the card lists before it points to the Hosts list.
export const XCP_NG_HOSTS_CARD_SHOWN: number = 8;

export interface ComponentProps {
  rows: Array<XcpNgResource>;
  getHostRoute: (externalId: string) => Route;
  hostsRoute: Route;
  now: Date;
  // The pool master's XAPI UUID, as a probe last read it (#10997).
  masterHostExternalId?: string | undefined;
}

/*
 * Where a host's or a VM's CPU and memory turn amber and red: where their
 * tiles and the lists' bars do, so one reading is one colour on every card
 * of the pool's pages.
 */
export const XCP_NG_LOAD_THRESHOLDS: Record<
  "cpu" | "memory",
  { warning: number; danger: number }
> = {
  cpu: { warning: 80, danger: 90 },
  memory: { warning: 85, danger: 95 },
};

export function getXcpNgLoadBarClassName(data: {
  percent: number;
  metric: "cpu" | "memory";
  normalClassName?: string | undefined;
}): string {
  const thresholds: { warning: number; danger: number } =
    XCP_NG_LOAD_THRESHOLDS[data.metric];
  if (data.percent >= thresholds.danger) {
    return "bg-red-500";
  }
  if (data.percent >= thresholds.warning) {
    return "bg-amber-500";
  }
  return data.normalClassName || "bg-emerald-500";
}

const XcpNgHostsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const listClassName: string = useCardRuledListClassName();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const hosts: Array<XcpNgResource> = sortXcpNgHostsForGlance(
    props.rows.filter((row: XcpNgResource): boolean => {
      return row.kind === XcpNgResourceKind.Host;
    }),
  );

  if (hosts.length === 0) {
    return <></>;
  }

  const shown: Array<XcpNgResource> = hosts.slice(0, XCP_NG_HOSTS_CARD_SHOWN);

  const renderBar: (data: {
    key: "cpu" | "memory";
    label: string;
    percent: number | null;
  }) => ReactElement = (data: {
    key: "cpu" | "memory";
    label: string;
    percent: number | null;
  }): ReactElement => {
    const percent: number | null =
      data.percent === null ? null : Math.min(100, Math.max(0, data.percent));
    return (
      <div
        className="min-w-0 flex-1"
        data-testid={`xcp-ng-hosts-card-${data.key}`}
      >
        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
          <span className="text-gray-500">{tx(data.label)}</span>
          <span className="font-medium tabular-nums text-gray-700">
            {percent === null ? (
              <EmptyValue isSmall={true} />
            ) : (
              // In the reader's digits and percent sign ("۸۷٪", "87 %").
              formatReaderFigure(Math.round(percent), {
                decimals: 0,
                isPercent: true,
                language: translator.language,
              })
            )}
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-gray-100">
          {percent === null ? (
            <></>
          ) : (
            <div
              className={`h-1.5 rounded-full ${getXcpNgLoadBarClassName({
                percent: percent,
                metric: data.key,
              })}`}
              style={{ width: `${Math.max(percent, 2)}%` }}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="mb-6" data-testid="xcp-ng-hosts-card">
      <Card
        title="Hosts"
        description="Each host's state and load at its latest report, and the VMs it runs. Halted hosts come first."
        buttons={[
          <Link
            key="all-hosts"
            to={props.hostsRoute}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
            dataTestId="xcp-ng-hosts-card-all"
          >
            {translator.translatePlural(
              { one: "View {{count}} host", other: "View all {{count}} hosts" },
              hosts.length,
            )}
          </Link>,
        ]}
      >
        <ul className={listClassName}>
          {shown.map((host: XcpNgResource): ReactElement => {
            const externalId: string = host.externalId || "";
            const name: string = getXcpNgDisplayName(host);
            const status: ResourcePartStatus | null = getXcpNgHostStatus(host);
            const isFresh: boolean =
              host.isUp === true &&
              isXcpNgReadingFresh(host, props.now, XCP_NG_METRIC_STALE_MS);
            const onHost: XcpNgRowsOnHost = getXcpNgRowsOnHost(
              props.rows,
              externalId,
            );
            const vms: XcpNgVmSummary = summarizeXcpNgVms(onHost.vms);
            const uptime: string =
              host.isUp === true
                ? formatXcpNgUptime(host.uptimeSeconds, translator)
                : "";

            const facts: Array<string> = [];
            if (vms.total > 0) {
              facts.push(
                translator.translatePlural(
                  {
                    one: "{{running}}/{{count}} VM running",
                    other: "{{running}}/{{count}} VMs running",
                  },
                  vms.total,
                  // Written as the count beside it is, in the reader's digits.
                  { running: translator.formatNumber(vms.running) },
                ),
              );
            }
            if (uptime) {
              facts.push(
                translator.translateTemplate("up {{uptime}}", {
                  uptime: uptime,
                }),
              );
            }
            const threads: number | null = toXcpNgNumber(host.cpuCount);
            if (threads !== null && threads > 0) {
              facts.push(
                translator.translatePlural(
                  { one: "{{count}} thread", other: "{{count}} threads" },
                  threads,
                ),
              );
            }
            // Updates Xen Orchestra says it has not installed (#10997).
            const missingPatches: number | null =
              getXcpNgMissingPatchCount(host);
            if (missingPatches !== null && missingPatches > 0) {
              facts.push(
                translator.translatePlural(
                  {
                    one: "{{count}} patch missing",
                    other: "{{count}} patches missing",
                  },
                  missingPatches,
                ),
              );
            }
            const isMaster: boolean =
              Boolean(props.masterHostExternalId) &&
              externalId.toLowerCase() ===
                (props.masterHostExternalId || "").toLowerCase();

            return (
              <li
                key={externalId || name}
                data-testid="xcp-ng-hosts-card-item"
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
                          data-testid="xcp-ng-hosts-card-name"
                          className="min-w-0 text-sm font-medium text-gray-900 [overflow-wrap:anywhere]"
                        >
                          <BreakableName text={name} />
                        </span>
                        {status ? (
                          <span
                            data-testid="xcp-ng-hosts-card-status"
                            data-tone={status.tone}
                            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${RESOURCE_PART_TONE_CLASS_NAMES[status.tone].badge}`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${RESOURCE_PART_TONE_CLASS_NAMES[status.tone].dot}`}
                              aria-hidden="true"
                            />
                            {tx(status.label)}
                          </span>
                        ) : (
                          <></>
                        )}
                        {/*
                         * Disabled - maintenance mode, an evacuation - is
                         * someone's choice: the grey Paused chip, never red.
                         */}
                        {host.isEnabled === false ? (
                          <Pill
                            text="Disabled"
                            tone={PillTone.Paused}
                            dataTestId="xcp-ng-hosts-card-disabled"
                          />
                        ) : (
                          <></>
                        )}
                        {/* The host that runs the pool's XAPI. */}
                        {isMaster ? (
                          <Pill
                            text="Pool master"
                            tone={PillTone.Info}
                            dataTestId="xcp-ng-hosts-card-master"
                          />
                        ) : (
                          <></>
                        )}
                      </div>
                      {facts.length > 0 ? (
                        <div className="mt-0.5 text-xs text-gray-500">
                          {facts.join(" · ")}
                        </div>
                      ) : (
                        <></>
                      )}
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-1 gap-4 pl-10 md:pl-0">
                    {renderBar({
                      key: "cpu",
                      label: "CPU",
                      percent: isFresh
                        ? toXcpNgNumber(host.latestCpuPercent)
                        : null,
                    })}
                    {renderBar({
                      key: "memory",
                      label: "Memory",
                      percent: isFresh ? getXcpNgMemoryPercent(host) : null,
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

export default XcpNgHostsCard;
