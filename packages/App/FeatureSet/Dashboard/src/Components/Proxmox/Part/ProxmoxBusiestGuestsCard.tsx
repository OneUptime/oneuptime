import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledBodyClassName } from "Common/UI/Components/Card/CardSurface";
import Link from "Common/UI/Components/Link/Link";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { getCpuBarColor } from "../../Infrastructure/ResourceTable";
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
 * their latest report, each a step from its own page, and one step to the
 * node's Guests tab with all of them - the ESXi host page's busiest virtual
 * machines, for a Proxmox node.
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

  // A node that runs no guest has nothing to rank.
  if (props.summary.total === 0) {
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
              {props.summary.running === 0
                ? tx("No guest is running on this node.")
                : tx(
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
                          {externalId ? (
                            <Link
                              to={props.getGuestRoute(externalId)}
                              className="min-w-0 break-all text-sm font-medium text-gray-900 hover:text-indigo-600 hover:underline"
                            >
                              {name}
                            </Link>
                          ) : (
                            <span className="min-w-0 break-all text-sm font-medium text-gray-900">
                              {name}
                            </span>
                          )}
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
                       * Coloured as the guest's row in the Guests tab colours
                       * it, so one guest reads the same in both.
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
                            className={`h-1.5 rounded-full ${getCpuBarColor(cpu)}`}
                            style={{ width: `${cpu}%` }}
                          />
                        </div>
                        <span className="w-12 text-right text-xs tabular-nums text-gray-700">
                          <span className="sr-only">{`${tx("CPU")} `}</span>
                          {formatPercent(guest.cpuPercent)}
                        </span>
                      </div>
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
