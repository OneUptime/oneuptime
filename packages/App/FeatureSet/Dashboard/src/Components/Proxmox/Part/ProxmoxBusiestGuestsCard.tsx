import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledBodyClassName } from "Common/UI/Components/Card/CardSurface";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { getCpuBarColor } from "../../Infrastructure/ResourceTable";
import ResourcePartRow from "../../ResourcePart/ResourcePartRow";
import {
  ProxmoxBusyGuest,
  ProxmoxGuestSummary,
  getProxmoxGuestKind,
} from "../../../Pages/Proxmox/Utils/ProxmoxPartFacts";
import {
  formatBytes,
  formatPercent,
} from "../../../Pages/Proxmox/Utils/ProxmoxResourceUtils";

/*
 * What keeps a Proxmox node busy: its running guests using the most CPU at
 * their latest report, each a step from its own page (the whole row,
 * ResourcePartRow), and one step to the node's Guests tab with all of them
 * - the ESXi host page's busiest virtual machines, for a Proxmox node. The
 * bar is labelled CPU, as the Nodes card's bars are: the line under the
 * name is the guest's memory.
 */

// How many guests the card ranks.
export const PROXMOX_BUSIEST_GUESTS_SHOWN: number = 5;

export interface ComponentProps {
  guests: Array<ProxmoxBusyGuest>;
  summary: ProxmoxGuestSummary;
  getGuestRoute: (externalId: string) => Route;
  onShowAll: () => void;
}

const ProxmoxBusiestGuestsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const bodyClassName: string = useCardRuledBodyClassName();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  /*
   * A node that runs no guest has nothing to rank - none on it, or none
   * running (a node that is down): the Guests tile says "0/2 running" and
   * the Guests tab lists them.
   */
  if (props.summary.total === 0 || props.summary.running === 0) {
    return <></>;
  }

  return (
    <div className="mb-6" data-testid="proxmox-busiest-guests">
      <Card
        title="Busiest guests"
        description="The running guests on this node using the most CPU at their latest report."
      >
        <div className={`${bodyClassName} divide-y divide-gray-200`}>
          {props.guests.length === 0 ? (
            <p
              className="px-5 py-4 text-sm text-gray-500 md:px-6"
              data-testid="proxmox-busiest-guests-empty"
            >
              {tx(
                "No running guest has reported its CPU in the last 15 minutes.",
              )}
            </p>
          ) : (
            <ol className="divide-y divide-gray-200">
              {props.guests.map(
                (guest: ProxmoxBusyGuest, index: number): ReactElement => {
                  const externalId: string = guest.row.externalId || "";
                  const name: string = guest.row.name || externalId;
                  const kind: string = getProxmoxGuestKind(guest.row);
                  const cpu: number = Math.min(
                    100,
                    Math.max(0, guest.cpuPercent ?? 0),
                  );
                  const memoryTotal: number | null =
                    guest.row.maxMemoryBytes !== null &&
                    guest.row.maxMemoryBytes !== undefined
                      ? Number(guest.row.maxMemoryBytes)
                      : null;

                  return (
                    <li
                      key={externalId || name}
                      data-testid="proxmox-busy-guest"
                    >
                      <ResourcePartRow
                        to={
                          externalId
                            ? props.getGuestRoute(externalId)
                            : undefined
                        }
                        className="flex items-center gap-3"
                      >
                        <span
                          className="w-4 flex-shrink-0 text-xs tabular-nums text-gray-400"
                          aria-hidden="true"
                        >
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span
                              data-testid="proxmox-busy-guest-name"
                              className="min-w-0 text-sm font-medium text-gray-900 [overflow-wrap:anywhere]"
                            >
                              <BreakableName text={name} />
                            </span>
                            {kind ? (
                              <span className="inline-flex rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
                                {tx(kind)}
                              </span>
                            ) : (
                              <></>
                            )}
                          </div>
                          {guest.memoryBytes !== null ? (
                            <div className="mt-0.5 text-xs text-gray-500">
                              {memoryTotal !== null && memoryTotal > 0
                                ? translator.translateTemplate(
                                    "{{used}} of {{total}} memory",
                                    {
                                      used: formatBytes(guest.memoryBytes),
                                      total: formatBytes(memoryTotal),
                                    },
                                  )
                                : translator.translateTemplate(
                                    "{{used}} memory",
                                    { used: formatBytes(guest.memoryBytes) },
                                  )}
                            </div>
                          ) : (
                            <></>
                          )}
                        </div>
                        {/*
                         * Laid out as the Nodes card's bars are - the label
                         * and the value over the bar - and coloured as the
                         * guest's row in the Guests tab colours it, so one
                         * guest reads the same in both.
                         */}
                        <div
                          className="w-28 flex-shrink-0 sm:w-40"
                          data-testid="proxmox-busy-guest-cpu"
                        >
                          <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                            <span className="text-gray-500">{tx("CPU")}</span>
                            <span className="font-medium tabular-nums text-gray-700">
                              {formatPercent(guest.cpuPercent)}
                            </span>
                          </div>
                          <div
                            className="h-1.5 w-full rounded-full bg-gray-100"
                            aria-hidden="true"
                          >
                            <div
                              className={`h-1.5 rounded-full ${getCpuBarColor(cpu)}`}
                              style={{ width: `${Math.max(cpu, 2)}%` }}
                            />
                          </div>
                        </div>
                      </ResourcePartRow>
                    </li>
                  );
                },
              )}
            </ol>
          )}
          <div
            className="px-5 py-3 text-sm md:px-6"
            data-testid="proxmox-busiest-guests-all"
          >
            <button
              type="button"
              onClick={props.onShowAll}
              className="rounded-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              {translator.translatePlural(
                {
                  one: "View {{count}} guest",
                  other: "View all {{count}} guests",
                },
                props.summary.total + props.summary.templates,
              )}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default ProxmoxBusiestGuestsCard;
