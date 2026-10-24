import {
  formatBitsPerSecond,
  formatTrafficBytes,
  getBitsPerSecond,
} from "../NetworkTrafficFormat";
import { fillTrafficSeriesGaps } from "../TrafficSeries";
import TrafficOverTimeChart from "../TrafficOverTimeChart";
import TrafficSummaryTiles from "../TrafficSummaryTiles";
import TrafficTopList, { TrafficTopRow } from "../TrafficTopList";
import {
  MERAKI_STATUS_WORDS,
  MERAKI_TONE_DOT,
  MERAKI_TONE_TEXT,
  MERAKI_VIEW_HELP,
  MerakiStatusWords,
  drawMerakiTemplate,
  getMerakiConnectionSentence,
} from "./MerakiWords";
import {
  MerakiFilterChip,
  getMerakiFilterChips,
  withoutMerakiFilter,
} from "./MerakiUrlState";
import {
  getClientDetails,
  getClientLabel,
  hasMerakiTraffic,
  shouldListNetworks,
  toFlowSummary,
} from "./MerakiTrafficRows";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import AppLink from "../../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import {
  NetworkTrafficUsageApplicationRow,
  NetworkTrafficUsageClientRow,
  NetworkTrafficUsageConnection,
  NetworkTrafficUsageDestinationRow,
  NetworkTrafficUsageFilters,
  NetworkTrafficUsageFiltersUtil,
  NetworkTrafficUsageNetworkRow,
  NetworkTrafficUsageSummary,
  NetworkTrafficUsageUplinkRow,
  getUsageOctets,
} from "Common/Types/NetFlow/NetworkTrafficUsage";
import {
  NetworkControllerConnectionStatus,
  isNetworkControllerStatusAProblem,
} from "Common/Types/NetworkController/NetworkControllerConnectionHealth";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  ReactNode,
} from "react";

/*
 * THE MERAKI SIDE OF A TRAFFIC PAGE: a device's, a site's or the whole
 * network's traffic as a Meraki connection read it from the Meraki
 * dashboard API, drawn with the flow side's own parts - the same four
 * numbers and chart, the same top lists - so the two read alike.
 *
 * What it shows, and where it comes from (Types/NetFlow/NetworkTrafficUsage):
 *
 *   - the numbers and the chart: the appliances' uplinks, download and
 *     upload, in five-minute windows;
 *   - Top networks (the whole network's page, several networks) or the
 *     uplinks (one network: a branch, a device), the two lists a click
 *     narrows the page to;
 *   - Top applications, destinations and clients: Meraki's traffic
 *     analytics and client usage, read every two hours - lists, not
 *     filters, since the uplinks they would narrow know no applications;
 *   - in place of Top conversations, why there are none, and the way to
 *     them: NetFlow on the MX appliances.
 *
 * Over it all, one line says how the connection is doing - when it last
 * read, or that it failed, and why - so traffic that stopped coming in is
 * never taken for a quiet network.
 */

export interface ComponentProps {
  scopeKind: "device" | "site" | "network";
  summary: NetworkTrafficUsageSummary;
  isLoading: boolean;
  // A refresh that failed while an earlier summary is on screen.
  error: string;
  filters: NetworkTrafficUsageFilters;
  onFiltersChange: (filters: NetworkTrafficUsageFilters) => void;
  // The header's controls: the side switch, the range picker, Reset zoom.
  headerElement: ReactElement;
  // "Set up NetFlow": the flow side of the page.
  onShowFlows: () => void;
}

export const MERAKI_DESCRIPTIONS: {
  device: string;
  site: string;
  network: string;
} = {
  device: translationKey(
    "Where this appliance's traffic goes, as the Meraki dashboard reports it.",
  ),
  site: translationKey(
    "Where this site's traffic goes, as the Meraki dashboard reports it.",
  ),
  network: translationKey(
    "Where your network's traffic goes, as the Meraki dashboard reports it.",
  ),
};

export const MERAKI_TILE_HELP: { traffic: string; flows: string } = {
  traffic: MERAKI_VIEW_HELP.traffic,
  flows: MERAKI_VIEW_HELP.flows,
};

function getWindowSeconds(summary: NetworkTrafficUsageSummary): number {
  const start: number = new Date(summary.windowStartAt).getTime();
  const end: number = new Date(summary.windowEndAt).getTime();

  return Number.isFinite(start) && Number.isFinite(end) && end > start
    ? (end - start) / 1000
    : 3600;
}

/*
 * How the connections are doing, one line each, the ones to act on first:
 * a failure, a connection that stopped reading, one that read in part.
 */
const ConnectionLines: FunctionComponent<{
  connections: Array<NetworkTrafficUsageConnection>;
}> = (props: {
  connections: Array<NetworkTrafficUsageConnection>;
}): ReactElement => {
  const translator: Translator = useTranslator();

  const sorted: Array<NetworkTrafficUsageConnection> = [
    ...props.connections,
  ].sort(
    (
      a: NetworkTrafficUsageConnection,
      b: NetworkTrafficUsageConnection,
    ): number => {
      return (
        Number(isNetworkControllerStatusAProblem(b.status)) -
        Number(isNetworkControllerStatusAProblem(a.status))
      );
    },
  );

  return (
    <div className="mb-4 space-y-1.5" data-testid="meraki-connection-lines">
      {sorted.map((connection: NetworkTrafficUsageConnection): ReactElement => {
        const words: MerakiStatusWords = MERAKI_STATUS_WORDS[connection.status];
        const detail: string | undefined =
          connection.lastError || connection.warning;

        return (
          <div
            key={connection.id}
            className={`flex items-start gap-2 text-sm ${MERAKI_TONE_TEXT[words.tone]}`}
            data-testid="meraki-connection-line"
            data-status={connection.status}
          >
            <span
              className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${MERAKI_TONE_DOT[words.tone]}`}
              aria-hidden="true"
            />
            <span className="min-w-0">
              <span className="font-medium">
                {connection.organizationName || connection.name}
              </span>
              <span>
                {" · "}
                {drawMerakiTemplate(
                  translator,
                  getMerakiConnectionSentence(connection, {
                    language: translator.language,
                  }),
                )}
              </span>
              {detail ? (
                <span
                  className="mt-0.5 block break-words text-xs text-gray-500"
                  data-testid="meraki-connection-line-detail"
                >
                  {detail}
                </span>
              ) : (
                <></>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const MerakiTrafficView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const summary: NetworkTrafficUsageSummary = props.summary;
  const filters: NetworkTrafficUsageFilters = props.filters;
  const isFiltered: boolean =
    NetworkTrafficUsageFiltersUtil.isFiltered(filters);
  const hasTraffic: boolean = hasMerakiTraffic(summary);
  const windowSeconds: number = getWindowSeconds(summary);
  const isWaiting: boolean =
    !summary.lastUplinkAt && !summary.lastAnalyticsAt && !hasTraffic;
  const canNarrow: boolean = props.scopeKind !== "device";
  /*
   * The lines over the traffic: every connection - but while the page waits
   * for a first read, the page says so itself, and a line that only waits
   * too would say it twice.
   */
  const lines: Array<NetworkTrafficUsageConnection> = isWaiting
    ? summary.connections.filter(
        (connection: NetworkTrafficUsageConnection): boolean => {
          return (
            connection.status !== NetworkControllerConnectionStatus.Waiting
          );
        },
      )
    : summary.connections;

  const setFilters: (next: NetworkTrafficUsageFilters) => void = (
    next: NetworkTrafficUsageFilters,
  ): void => {
    props.onFiltersChange(next);
  };

  // ---- Rows ----------------------------------------------------------------

  const networkRows: Array<TrafficTopRow> = summary.topNetworks.map(
    (row: NetworkTrafficUsageNetworkRow): TrafficTopRow => {
      const isActive: boolean =
        filters.controllerNetworkId === row.controllerNetworkId;
      const name: string = row.name || row.controllerNetworkId;

      return {
        key: row.controllerNetworkId,
        label: name,
        octets: getUsageOctets(row),
        detail: translator.translateTemplate("In {{in}} · out {{out}}", {
          in: formatTrafficBytes(row.receivedOctets),
          out: formatTrafficBytes(row.sentOctets),
        }),
        isActive,
        ariaLabel: translator.translateTemplate(
          "Show only the traffic of {{network}}",
          { network: name },
        ),
        onClick: canNarrow
          ? () => {
              setFilters(
                isActive
                  ? withoutMerakiFilter(filters, "network")
                  : { controllerNetworkId: row.controllerNetworkId },
              );
            }
          : undefined,
      };
    },
  );

  const uplinkRows: Array<TrafficTopRow> = summary.topUplinks.map(
    (row: NetworkTrafficUsageUplinkRow): TrafficTopRow => {
      const isActive: boolean = filters.deviceSerial === row.deviceSerial;
      const appliance: string = row.deviceName || row.deviceSerial;

      return {
        key: `${row.deviceSerial}/${row.interfaceName}`,
        label: row.interfaceName,
        isMono: true,
        sublabel: [appliance, row.controllerNetworkName]
          .filter(Boolean)
          .join(" · "),
        octets: getUsageOctets(row),
        detail: translator.translateTemplate("In {{in}} · out {{out}}", {
          in: formatTrafficBytes(row.receivedOctets),
          out: formatTrafficBytes(row.sentOctets),
        }),
        isActive,
        ariaLabel: translator.translateTemplate(
          "Show only the traffic of {{appliance}}",
          { appliance: appliance },
        ),
        onClick:
          canNarrow && row.deviceSerial
            ? () => {
                setFilters(
                  isActive
                    ? withoutMerakiFilter(filters, "appliance")
                    : {
                        controllerNetworkId: row.controllerNetworkId,
                        deviceSerial: row.deviceSerial,
                      },
                );
              }
            : undefined,
        trailing:
          row.networkDeviceId && props.scopeKind !== "device" ? (
            <AppLink
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.NETWORK_DEVICE_VIEW_TRAFFIC] as Route,
                { modelId: new ObjectID(row.networkDeviceId) },
              )}
              className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-50 hover:text-gray-700"
            >
              <span className="sr-only">
                {translator.translateTemplate("Open {{device}}", {
                  device: appliance,
                })}
              </span>
              <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
            </AppLink>
          ) : undefined,
      };
    },
  );

  const applicationRows: Array<TrafficTopRow> = summary.topApplications.map(
    (row: NetworkTrafficUsageApplicationRow): TrafficTopRow => {
      return {
        key: row.application,
        label: row.application,
        octets: getUsageOctets(row),
        detail: translator.translateTemplate("In {{in}} · out {{out}}", {
          in: formatTrafficBytes(row.receivedOctets),
          out: formatTrafficBytes(row.sentOctets),
        }),
        isActive: false,
      };
    },
  );

  const destinationRows: Array<TrafficTopRow> = summary.topDestinations.map(
    (row: NetworkTrafficUsageDestinationRow): TrafficTopRow => {
      return {
        key: row.destination,
        label: row.destination,
        isMono: true,
        sublabel: row.application || undefined,
        octets: getUsageOctets(row),
        isActive: false,
      };
    },
  );

  const clientRows: Array<TrafficTopRow> = summary.topClients.map(
    (row: NetworkTrafficUsageClientRow): TrafficTopRow => {
      const details: Array<string> = getClientDetails(row);

      return {
        key: row.clientKey,
        label: getClientLabel(row),
        isMono: !row.name,
        sublabel: details.length > 0 ? details.join(" · ") : undefined,
        octets: getUsageOctets(row),
        detail: translator.translateTemplate("In {{in}} · out {{out}}", {
          in: formatTrafficBytes(row.receivedOctets),
          out: formatTrafficBytes(row.sentOctets),
        }),
        isActive: false,
      };
    },
  );

  const chips: Array<MerakiFilterChip> = getMerakiFilterChips(filters, {
    networkName: summary.topNetworks.find(
      (row: NetworkTrafficUsageNetworkRow): boolean => {
        return row.controllerNetworkId === filters.controllerNetworkId;
      },
    )?.name,
    applianceName: summary.topUplinks.find(
      (row: NetworkTrafficUsageUplinkRow): boolean => {
        return row.deviceSerial === filters.deviceSerial;
      },
    )?.deviceName,
  });

  const listsNetworks: boolean = canNarrow && shouldListNetworks(summary);
  const applicationTotal: number = getUsageOctets(summary.applicationTotals);
  const clientTotal: number = getUsageOctets(summary.clientTotals);
  const uplinkTotal: number = summary.topUplinks.reduce(
    (total: number, row: NetworkTrafficUsageUplinkRow): number => {
      return total + getUsageOctets(row);
    },
    0,
  );

  const body: ReactNode = ((): ReactNode => {
    if (isWaiting) {
      return (
        <div
          className="flex flex-col items-center justify-center px-6 py-14 text-center"
          data-testid="meraki-waiting"
        >
          <Icon
            icon={IconProp.Refresh}
            className="h-6 w-6 animate-spin text-gray-300"
          />
          <div className="mt-3 text-sm font-medium text-gray-900">
            {translator.translateText(
              "Waiting for the first read from Meraki.",
            )}
          </div>
          <p className="mt-1 max-w-md text-sm text-gray-500">
            {translator.translateText(
              "It starts within a minute and brings in the last day: uplink usage first, then each network's applications and clients.",
            )}
          </p>
        </div>
      );
    }

    if (hasTraffic) {
      return (
        <Fragment>
          <TrafficSummaryTiles
            summary={toFlowSummary(summary)}
            windowSeconds={windowSeconds}
            help={MERAKI_TILE_HELP}
          />
          <div className="group/zoomhint mt-6">
            <div className="mb-1 text-sm font-medium text-gray-900">
              {translator.translateText("Traffic over time")}
            </div>
            <TrafficOverTimeChart
              series={fillTrafficSeriesGaps(
                toFlowSummary(summary).series,
                summary.bucketSeconds,
                summary.windowStartAt,
                summary.windowEndAt,
              )}
              bucketSeconds={summary.bucketSeconds}
              windowStartAt={summary.windowStartAt}
              windowEndAt={summary.windowEndAt}
              splitAriaLabel={translationKey(
                "Traffic in and out through the appliances' uplinks over time, in bits per second",
              )}
            />
          </div>
          <div className="mt-2 text-xs text-gray-500">
            {translator.translateTemplate(
              "{{bytes}} at an average of {{rate}}.",
              {
                bytes: formatTrafficBytes(getUsageOctets(summary.totals)),
                rate: formatBitsPerSecond(
                  getBitsPerSecond(
                    getUsageOctets(summary.totals),
                    windowSeconds,
                  ),
                ),
              },
            )}
          </div>
        </Fragment>
      );
    }

    if (isFiltered) {
      return (
        <div
          className="flex flex-col items-center justify-center px-6 py-14 text-center"
          data-testid="meraki-no-match"
        >
          <div className="text-sm font-medium text-gray-900">
            {translator.translateText(
              "No traffic matches these filters in this time range.",
            )}
          </div>
          <div className="mt-3">
            <Button
              title="Clear filters"
              buttonStyle={ButtonStyleType.OUTLINE}
              buttonSize={ButtonSize.Small}
              onClick={() => {
                setFilters({});
              }}
            />
          </div>
        </div>
      );
    }

    return (
      <div
        className="flex flex-col items-center justify-center px-6 py-14 text-center"
        data-testid="meraki-no-data"
      >
        <div className="text-sm font-medium text-gray-900">
          {translator.translateText("No traffic in the selected time range.")}
        </div>
        <p className="mt-1 max-w-md text-sm text-gray-500">
          {translator.translateText(
            "Meraki keeps traffic for 30 days: pick a longer time range to see older traffic.",
          )}
        </p>
      </div>
    );
  })();

  return (
    <Fragment>
      <Card
        title="Traffic"
        description={MERAKI_DESCRIPTIONS[props.scopeKind]}
        rightElement={props.headerElement}
      >
        <div className="relative" aria-busy={props.isLoading}>
          {props.error ? (
            <div
              role="alert"
              className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
            >
              <Icon
                icon={IconProp.Error}
                className="h-4 w-4 shrink-0 text-red-500"
              />
              <span>
                {translator.translateTemplate(
                  "Couldn't refresh — showing previously loaded data. {{error}}",
                  { error: props.error },
                )}
              </span>
            </div>
          ) : (
            <></>
          )}

          {props.isLoading ? (
            <div
              className="pointer-events-none absolute right-0 top-0 z-10 inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-500 shadow-sm"
              data-testid="traffic-refreshing"
            >
              <Icon
                icon={IconProp.Refresh}
                className="h-3 w-3 animate-spin text-gray-400"
              />
              {translator.translateText("Refreshing")}
            </div>
          ) : (
            <></>
          )}

          <div
            className={props.isLoading ? "opacity-75 transition-opacity" : ""}
            data-testid="meraki-traffic-body"
          >
            {lines.length > 0 ? <ConnectionLines connections={lines} /> : <></>}

            {chips.length > 0 ? (
              <div
                className="mb-5 flex min-h-[2rem] flex-wrap items-center gap-2"
                data-testid="meraki-filters"
              >
                {chips.map((chip: MerakiFilterChip): ReactElement => {
                  const text: string = translator.translateTemplate(
                    chip.template,
                    chip.values,
                  );

                  return (
                    <span
                      key={chip.kind}
                      className="inline-flex items-center gap-1 rounded-full bg-indigo-50 py-1 pl-3 pr-1 text-sm font-medium text-indigo-700 ring-1 ring-indigo-200"
                      data-testid={`meraki-filter-${chip.kind}`}
                    >
                      {text}
                      <button
                        type="button"
                        className="flex h-5 w-5 items-center justify-center rounded-full text-indigo-600 hover:bg-indigo-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        aria-label={translator.translateTemplate(
                          "Remove the filter {{filter}}",
                          { filter: text },
                        )}
                        onClick={() => {
                          setFilters(withoutMerakiFilter(filters, chip.kind));
                        }}
                      >
                        <Icon icon={IconProp.Close} className="h-3 w-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : (
              <></>
            )}

            {body}
          </div>
        </div>
      </Card>

      {hasTraffic ? (
        <Fragment>
          <div className="grid grid-cols-1 gap-x-5 lg:grid-cols-2">
            {listsNetworks ? (
              <TrafficTopList
                title="Top networks"
                description="Which networks carried the most."
                help={MERAKI_VIEW_HELP.networks}
                rows={networkRows}
                totalOctets={getUsageOctets(summary.totals)}
                emptyMessage="No networks in this time range."
                dataTestId="meraki-top-networks"
              />
            ) : (
              <TrafficTopList
                title="Uplinks"
                description="What came in and went out on each uplink."
                help={MERAKI_VIEW_HELP.uplinks}
                rows={uplinkRows}
                totalOctets={uplinkTotal}
                emptyMessage="No uplink usage in this time range. Uplink usage comes from MX and Z appliances."
                dataTestId="meraki-top-uplinks"
              />
            )}
            <TrafficTopList
              title="Top applications"
              description="What the traffic is for, as Meraki names it."
              help={MERAKI_VIEW_HELP.applications}
              rows={applicationRows}
              totalOctets={applicationTotal}
              emptyMessage="No applications in this time range. Meraki keeps them where traffic analysis is turned on."
              dataTestId="meraki-top-applications"
            />
            <TrafficTopList
              title="Top clients"
              description="Who used the most."
              help={MERAKI_VIEW_HELP.clients}
              rows={clientRows}
              totalOctets={clientTotal}
              emptyMessage="No clients in this time range."
              dataTestId="meraki-top-clients"
            />
            <TrafficTopList
              title="Top destinations"
              description="Where the traffic went."
              help={MERAKI_VIEW_HELP.destinations}
              rows={destinationRows}
              totalOctets={applicationTotal}
              emptyMessage="No destinations in this time range."
              dataTestId="meraki-top-destinations"
            />
          </div>

          <Card
            title="Who talks to whom"
            description="Conversations come from flow records, not from the Meraki dashboard API."
          >
            <div
              className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              data-testid="meraki-conversations-note"
            >
              <p className="max-w-2xl text-sm text-gray-600">
                {translator.translateText(MERAKI_VIEW_HELP.conversations)}
              </p>
              <div className="flex-shrink-0">
                <Button
                  title="Set up NetFlow"
                  icon={IconProp.ArrowUpDown}
                  buttonSize={ButtonSize.Small}
                  buttonStyle={ButtonStyleType.NORMAL}
                  onClick={props.onShowFlows}
                  dataTestId="meraki-set-up-netflow"
                />
              </div>
            </div>
          </Card>
        </Fragment>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default MerakiTrafficView;
