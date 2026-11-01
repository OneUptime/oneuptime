import React, { FunctionComponent, ReactElement } from "react";
import ProxmoxResource from "Common/Models/DatabaseModels/ProxmoxResource";
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
  ProxmoxGuestSummary,
  getProxmoxDiskPercent,
  getProxmoxMemoryPercent,
  getProxmoxNodeName,
  getProxmoxPartStatus,
  getProxmoxRowsOnNode,
  summarizeProxmoxGuests,
  toProxmoxDate,
  toProxmoxNumber,
} from "../../Pages/Proxmox/Utils/ProxmoxPartFacts";
import {
  METRIC_STALE_MS,
  formatUptime,
} from "../../Pages/Proxmox/Utils/ProxmoxResourceUtils";

/*
 * The cluster's nodes at a glance on its Overview - what Proxmox VE's own
 * Datacenter summary opens with: each node, whether it is up, how busy it
 * is and what it runs, one step from its page. Offline nodes come first;
 * then the nodes in name order, as people number them (pve2 before pve10).
 *
 * The bars are the node's latest report. A node that has sent nothing for
 * 15 minutes shows no numbers rather than old ones (the lists' rule). Each
 * row is a link to the node's page, the whole row (ResourcePartRow).
 */

// How many nodes the card lists before it points to the node list.
export const PROXMOX_NODES_CARD_SHOWN: number = 8;

export interface ComponentProps {
  rows: Array<ProxmoxResource>;
  getNodeRoute: (externalId: string) => Route;
  nodesRoute: Route;
  now: Date;
}

function barClassName(percent: number): string {
  if (percent >= 90) {
    return "bg-red-500";
  }
  if (percent >= 75) {
    return "bg-amber-500";
  }
  return "bg-emerald-500";
}

export function sortProxmoxNodesForGlance(
  nodes: Array<ProxmoxResource>,
): Array<ProxmoxResource> {
  return [...nodes].sort((a: ProxmoxResource, b: ProxmoxResource): number => {
    const aDown: number = a.isUp === false ? 0 : 1;
    const bDown: number = b.isUp === false ? 0 : 1;
    if (aDown !== bDown) {
      return aDown - bDown;
    }
    return getProxmoxNodeName(a).localeCompare(
      getProxmoxNodeName(b),
      undefined,
      {
        numeric: true,
        sensitivity: "base",
      },
    );
  });
}

const ProxmoxNodesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const listClassName: string = useCardRuledListClassName();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const nodes: Array<ProxmoxResource> = sortProxmoxNodesForGlance(
    props.rows.filter((row: ProxmoxResource): boolean => {
      return row.kind === "Node";
    }),
  );

  if (nodes.length === 0) {
    return <></>;
  }

  const shown: Array<ProxmoxResource> = nodes.slice(
    0,
    PROXMOX_NODES_CARD_SHOWN,
  );

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
      <div
        className="min-w-0 flex-1"
        data-testid={`proxmox-nodes-card-${data.key}`}
      >
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
              className={`h-1.5 rounded-full ${barClassName(percent)}`}
              style={{ width: `${Math.max(percent, 2)}%` }}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="mb-6" data-testid="proxmox-nodes-card">
      <Card
        title="Nodes"
        description="Each node's state and load at its latest report, and the guests it runs."
        buttons={[
          <Link
            key="all-nodes"
            to={props.nodesRoute}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
            dataTestId="proxmox-nodes-card-all"
          >
            {translator.translatePlural(
              { one: "View {{count}} node", other: "View all {{count}} nodes" },
              nodes.length,
            )}
          </Link>,
        ]}
      >
        <ul className={listClassName}>
          {shown.map((node: ProxmoxResource): ReactElement => {
            const externalId: string = node.externalId || "";
            const name: string = getProxmoxNodeName(node) || externalId;
            const status: ResourcePartStatus | null =
              getProxmoxPartStatus(node);
            const updatedAt: Date | null = toProxmoxDate(node.metricsUpdatedAt);
            const isFresh: boolean = Boolean(
              node.isUp !== false &&
                updatedAt &&
                props.now.getTime() - updatedAt.getTime() <= METRIC_STALE_MS,
            );
            const guests: ProxmoxGuestSummary = summarizeProxmoxGuests(
              getProxmoxRowsOnNode(props.rows, getProxmoxNodeName(node)).guests,
            );
            const uptime: string =
              node.isUp === false ? "" : formatUptime(node.uptimeSeconds);

            const facts: Array<string> = [];
            if (guests.total > 0) {
              facts.push(
                translator.translatePlural(
                  {
                    one: "{{running}}/{{count}} guest running",
                    other: "{{running}}/{{count}} guests running",
                  },
                  guests.total,
                  // Written as the count beside it is, in the reader's digits.
                  { running: translator.formatNumber(guests.running) },
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
            const cores: number | null = toProxmoxNumber(node.cpuCount);
            if (cores !== null && cores > 0) {
              facts.push(
                translator.translatePlural(
                  { one: "{{count}} core", other: "{{count}} cores" },
                  cores,
                ),
              );
            }

            return (
              <li
                key={externalId || name}
                data-testid="proxmox-nodes-card-item"
                data-node={name}
              >
                <ResourcePartRow
                  to={externalId ? props.getNodeRoute(externalId) : undefined}
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
                          data-testid="proxmox-nodes-card-name"
                          className="min-w-0 text-sm font-medium text-gray-900 [overflow-wrap:anywhere]"
                        >
                          <BreakableName text={name} />
                        </span>
                        {status ? (
                          <span
                            data-testid="proxmox-nodes-card-status"
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
                        ? toProxmoxNumber(node.latestCpuPercent)
                        : null,
                    })}
                    {renderBar({
                      key: "memory",
                      label: "Memory",
                      percent: isFresh ? getProxmoxMemoryPercent(node) : null,
                    })}
                    {renderBar({
                      key: "disk",
                      label: "Disk",
                      percent: isFresh ? getProxmoxDiskPercent(node) : null,
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

export default ProxmoxNodesCard;
