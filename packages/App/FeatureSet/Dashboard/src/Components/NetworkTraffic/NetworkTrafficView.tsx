import { fetchNetworkTraffic } from "./NetworkTrafficApi";
import {
  formatBitsPerSecond,
  formatTrafficBytes,
  getApplicationLabel,
  getBitsPerSecond,
  getInterfaceLabel,
  getInterfaceUtilizationPercent,
  ApplicationLabel,
} from "./NetworkTrafficFormat";
import {
  NetworkTrafficFilterChip,
  NetworkTrafficFilterKind,
  NetworkTrafficViewState,
  getNetworkTrafficFilterChips,
  readNetworkTrafficView,
  toNetworkTrafficUrlParams,
  withApplicationFilter,
  withoutNetworkTrafficFilter,
} from "./NetworkTrafficUrlState";
import { fillTrafficSeriesGaps } from "./TrafficSeries";
import TrafficConversationDiagram from "./TrafficConversationDiagram";
import TrafficOverTimeChart from "./TrafficOverTimeChart";
import TrafficSetupGuide from "./TrafficSetupGuide";
import TrafficSourcesCard from "./TrafficSourcesCard";
import TrafficSummaryTiles from "./TrafficSummaryTiles";
import TrafficTopList, { TrafficTopRow } from "./TrafficTopList";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import {
  NetworkTrafficAddressRow,
  NetworkTrafficApplicationRow,
  NetworkTrafficConversationRow,
  NetworkTrafficDeviceRow,
  NetworkTrafficFilters,
  NetworkTrafficFiltersUtil,
  NetworkTrafficInterfaceRow,
  NetworkTrafficRequest,
  NetworkTrafficSource,
  NetworkTrafficSummary,
} from "Common/Types/NetFlow/NetworkTraffic";
import ObjectID from "Common/Types/ObjectID";
import NetworkDeviceOtherAddressesUtil from "Common/Utils/NetworkDevice/NetworkDeviceOtherAddresses";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ButtonType from "Common/UI/Components/Button/ButtonTypes";
import Card from "Common/UI/Components/Card/Card";
import {
  ChartTimeRangeZoomContextValue,
  TimeRangeZoomScope,
  useChartTimeRangeZoom,
} from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import ResetTimeRangeZoomButton from "Common/UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import {
  translatableTerm,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FormEvent,
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * THE TRAFFIC PAGE - a device's, a site's, or the whole network's.
 *
 * One request (POST /network-traffic/summary) fills the page for a window:
 * four numbers, traffic over time, and the busiest sources, destinations,
 * applications, interfaces (a device) or devices (a site, the network), and
 * the busiest conversations drawn as a diagram. Every row narrows the whole
 * page to it - click 10.0.0.5 under Top sources and every number, the chart
 * and every other table are 10.0.0.5's - and the chips over the page say
 * what it is narrowed to. The time range and the filters live in the URL,
 * so a link lands on exactly this view.
 *
 * Before any flow has arrived the page is the set-up guide instead
 * (TrafficSetupGuide): the probe already listens, the device needs a few
 * lines, and records are matched by the address they come from.
 *
 * A drag across the chart zooms the page's range, a double-click (or Reset
 * zoom) puts it back (issue #4105); while a new window loads the last one
 * stays on screen, dimmed, so the page never collapses under the pointer.
 */

export type NetworkTrafficScope =
  | { kind: "device"; networkDeviceId: ObjectID }
  | { kind: "site"; networkSiteId: ObjectID }
  | { kind: "network" };

export interface NetworkTrafficDeviceInfo {
  hostname?: string | undefined;
  otherAddresses?: string | undefined;
  probeName?: string | undefined;
  isGlobalProbe?: boolean | undefined;
}

export interface ComponentProps {
  scope: NetworkTrafficScope;
  // A device's page: what its set-up guide says.
  device?: NetworkTrafficDeviceInfo | undefined;
}

interface LoadedTraffic {
  summary: NetworkTrafficSummary;
  // The view the summary answers; while the next loads, what is on screen.
  view: NetworkTrafficViewState;
}

export const TRAFFIC_HELP: {
  sources: string;
  destinations: string;
  applications: string;
  interfaces: string;
  devices: string;
  conversations: string;
} = {
  sources: translationKey(
    "The 10 addresses that sent the most bytes in this time range, with each one's share of all the traffic shown. Click one to see only its traffic.",
  ),
  destinations: translationKey(
    "The 10 addresses that received the most bytes in this time range. Click one to see only the traffic to it.",
  ),
  applications: translationKey(
    "Traffic by protocol and service port, named after the service usually on that port (HTTPS is TCP port 443). This is the port, not deep packet inspection. Click one to see only its traffic.",
  ),
  interfaces: translationKey(
    "The device's busiest interfaces: what came in through each and what went out through it. Names and speeds come from the device's SNMP walk; without one, the interface's index is shown.",
  ),
  devices: translationKey(
    "The devices that reported the most traffic. Traffic that passes through two exporting devices is counted by each. An address that is not a device yet is shown as itself.",
  ),
  conversations: translationKey(
    "The 10 busiest pairs of addresses, from the one that sent to the one that received. The band's thickness is the bytes. Click a band to see only that conversation.",
  ),
};

export const CONVERSATIONS_TITLE: string = translationKey("Top conversations");

function getWindowSeconds(summary: NetworkTrafficSummary): number {
  const start: number = new Date(summary.windowStartAt).getTime();
  const end: number = new Date(summary.windowEndAt).getTime();

  return Number.isFinite(start) && Number.isFinite(end) && end > start
    ? (end - start) / 1000
    : 3600;
}

function toDate(value: string): Date {
  return OneUptimeDate.fromString(
    value.includes("T") ? value : `${value.replace(" ", "T")}Z`,
  );
}

/*
 * Nothing in a window that was zoomed into: the way back is where the
 * pointer already is (a double-click here, like on the chart), or Reset
 * zoom beside the picker. The sentences name no device: the page says whose
 * traffic it is, and a whole sentence translates where a pasted-in noun
 * would not.
 */
const ZoomedEmptyState: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const zoom: ChartTimeRangeZoomContextValue | null = useChartTimeRangeZoom();
  const rangeBeforeZoom: RangeStartAndEndDateTime | null =
    zoom?.rangeBeforeZoom || null;

  return (
    <div
      className={`flex flex-col items-center justify-center px-6 py-14 text-center${
        zoom?.onTimeRangeReset ? " select-none" : ""
      }`}
      onDoubleClick={zoom?.onTimeRangeReset}
      data-testid="traffic-no-data"
    >
      <div className="text-sm font-medium text-gray-900">
        {translator.translateText("No traffic in the selected time range.")}
      </div>
      <p className="mt-1 max-w-md text-sm text-gray-500">
        {zoom?.onTimeRangeReset
          ? rangeBeforeZoom && rangeBeforeZoom.range !== TimeRange.CUSTOM
            ? translator.translateTemplate(
                "No flow records in the stretch you zoomed into. Double-click here, or use Reset zoom, to go back to the {{range}}.",
                {
                  range: translatableTerm(rangeBeforeZoom.range, {
                    inSentence: true,
                  }),
                },
              )
            : translator.translateText(
                "No flow records in the stretch you zoomed into. Double-click here, or use Reset zoom, to go back to the time range before the zoom.",
              )
          : translator.translateText("No flow records in this time range.")}
      </p>
    </div>
  );
};

const NetworkTrafficView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const scope: NetworkTrafficScope = props.scope;

  const [view, setViewState] = useState<NetworkTrafficViewState>(
    (): NetworkTrafficViewState => {
      return readNetworkTrafficView((name: string): string | null => {
        return Navigation.getQueryStringByName(name);
      });
    },
  );
  const [loaded, setLoaded] = useState<LoadedTraffic | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [conversationMode, setConversationMode] = useState<"diagram" | "list">(
    "diagram",
  );
  const [addressInput, setAddressInput] = useState<string>("");
  const [addressError, setAddressError] = useState<string>("");
  const [refreshKey, setRefreshKey] = useState<number>(0);

  // Only the newest fetch lands: a drag and a double-click can overlap.
  const latestFetchRef: React.MutableRefObject<number> = useRef<number>(0);

  const setView: (next: NetworkTrafficViewState) => void = useCallback(
    (next: NetworkTrafficViewState): void => {
      setViewState(next);
      Navigation.setQueryString(toNetworkTrafficUrlParams(next));
    },
    [],
  );

  const setFilters: (filters: NetworkTrafficFilters) => void = (
    filters: NetworkTrafficFilters,
  ): void => {
    setView({ range: view.range, filters: filters });
  };

  const setRange: (range: RangeStartAndEndDateTime) => void = useCallback(
    (range: RangeStartAndEndDateTime): void => {
      setViewState((current: NetworkTrafficViewState) => {
        const next: NetworkTrafficViewState = {
          range: range,
          filters: current.filters,
        };
        Navigation.setQueryString(toNetworkTrafficUrlParams(next));
        return next;
      });
    },
    [],
  );

  const scopeKey: string =
    scope.kind === "device"
      ? `device:${scope.networkDeviceId.toString()}`
      : scope.kind === "site"
        ? `site:${scope.networkSiteId.toString()}`
        : "network";

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    latestFetchRef.current += 1;
    const fetchId: number = latestFetchRef.current;
    const requestedView: NetworkTrafficViewState = view;

    setIsLoading(true);
    setError("");

    let summary: NetworkTrafficSummary | null = null;
    let failure: string | null = null;

    try {
      const dateRange: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(requestedView.range);

      const request: NetworkTrafficRequest = {
        startTime: OneUptimeDate.toString(dateRange.startValue),
        endTime: OneUptimeDate.toString(dateRange.endValue),
        filters: requestedView.filters,
      };

      if (scope.kind === "device") {
        request.networkDeviceId = scope.networkDeviceId.toString();
      } else if (scope.kind === "site") {
        request.networkSiteId = scope.networkSiteId.toString();
      }

      summary = await fetchNetworkTraffic(request);
    } catch (err) {
      failure = API.getFriendlyMessage(err);
    }

    if (fetchId !== latestFetchRef.current) {
      return;
    }

    if (failure !== null) {
      setError(failure);
    } else if (summary) {
      setLoaded({ summary: summary, view: requestedView });
    }

    setIsLoading(false);
  }, [scopeKey, view, refreshKey]);

  useEffect(() => {
    load().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    });
  }, [load]);

  const summary: NetworkTrafficSummary | null = loaded?.summary || null;
  const shownView: NetworkTrafficViewState = loaded?.view || view;
  const filters: NetworkTrafficFilters = shownView.filters;
  const isFiltered: boolean = NetworkTrafficFiltersUtil.isFiltered(
    view.filters,
  );

  // ---- Click to filter ---------------------------------------------------

  const toggle: (
    isActive: boolean,
    on: NetworkTrafficFilters,
    kinds: Array<NetworkTrafficFilterKind>,
  ) => void = (
    isActive: boolean,
    on: NetworkTrafficFilters,
    kinds: Array<NetworkTrafficFilterKind>,
  ): void => {
    if (isActive) {
      let next: NetworkTrafficFilters = view.filters;

      for (const kind of kinds) {
        next = withoutNetworkTrafficFilter(next, kind);
      }

      setFilters(next);
      return;
    }

    setFilters({ ...view.filters, ...on });
  };

  const onSelectSource: (address: string) => void = (address: string) => {
    toggle(view.filters.sourceIp === address, { sourceIp: address }, [
      "source",
    ]);
  };

  const onSelectDestination: (address: string) => void = (address: string) => {
    toggle(view.filters.destinationIp === address, { destinationIp: address }, [
      "destination",
    ]);
  };

  const onSelectConversation: (
    sourceIp: string,
    destinationIp: string,
  ) => void = (sourceIp: string, destinationIp: string) => {
    toggle(
      view.filters.sourceIp === sourceIp &&
        view.filters.destinationIp === destinationIp,
      { sourceIp: sourceIp, destinationIp: destinationIp },
      ["source", "destination"],
    );
  };

  const onFindAddress: (event: FormEvent) => void = (
    event: FormEvent,
  ): void => {
    event.preventDefault();
    const address: string = addressInput.trim();

    if (!address) {
      return;
    }

    // Checked (and written canonically) the way the server checks it.
    let hostIp: string | undefined = undefined;

    try {
      hostIp = NetworkTrafficFiltersUtil.sanitize({ hostIp: address }).hostIp;
    } catch {
      hostIp = undefined;
    }

    if (!hostIp) {
      setAddressError(
        translator.translateText("Enter an IP address, like 10.0.0.5.") || "",
      );
      return;
    }

    setAddressError("");
    setAddressInput("");
    setFilters({ ...view.filters, hostIp: hostIp });
  };

  // ---- Rows ----------------------------------------------------------------

  const addressRows: (
    rows: Array<NetworkTrafficAddressRow>,
    side: "source" | "destination",
  ) => Array<TrafficTopRow> = (
    rows: Array<NetworkTrafficAddressRow>,
    side: "source" | "destination",
  ): Array<TrafficTopRow> => {
    return rows.map((row: NetworkTrafficAddressRow): TrafficTopRow => {
      const isActive: boolean =
        side === "source"
          ? filters.sourceIp === row.ip
          : filters.destinationIp === row.ip;

      return {
        key: row.ip,
        label: row.ip,
        isMono: true,
        octets: row.octets,
        isActive: isActive,
        ariaLabel: translator.translateTemplate(
          side === "source"
            ? "Show only the traffic from {{address}}"
            : "Show only the traffic to {{address}}",
          { address: row.ip },
        ),
        onClick: () => {
          if (side === "source") {
            onSelectSource(row.ip);
          } else {
            onSelectDestination(row.ip);
          }
        },
      };
    });
  };

  const applicationRows: Array<TrafficTopRow> = (
    summary?.topApplications || []
  ).map((row: NetworkTrafficApplicationRow): TrafficTopRow => {
    const label: ApplicationLabel = getApplicationLabel(
      row.protocolNumber,
      row.port,
      translator,
    );
    const isActive: boolean =
      filters.protocolNumber === row.protocolNumber &&
      (filters.port === undefined || filters.port === row.port);

    return {
      key: `${row.protocolNumber}/${row.port}`,
      label: label.name,
      sublabel: label.detail || undefined,
      octets: row.octets,
      isActive: isActive,
      ariaLabel: translator.translateTemplate(
        "Show only the {{application}} traffic",
        { application: label.name },
      ),
      onClick: () => {
        if (isActive) {
          setFilters(withoutNetworkTrafficFilter(view.filters, "application"));
        } else {
          setFilters(
            withApplicationFilter(view.filters, row.protocolNumber, row.port),
          );
        }
      },
    };
  });

  const windowSeconds: number = summary ? getWindowSeconds(summary) : 3600;

  const interfaceRows: Array<TrafficTopRow> = (
    summary?.topInterfaces || []
  ).map((row: NetworkTrafficInterfaceRow): TrafficTopRow => {
    const isActive: boolean = filters.interfaceIndex === row.interfaceIndex;
    const name: string = getInterfaceLabel(row, translator);
    const utilization: number | null = getInterfaceUtilizationPercent(
      row,
      windowSeconds,
    );

    return {
      key: String(row.interfaceIndex),
      label: name,
      sublabel:
        [
          row.alias,
          utilization !== null && row.speedInMbps
            ? translator.translateTemplate(
                "{{percent}}% of {{speed}} on average",
                {
                  percent: Math.round(utilization),
                  speed: formatBitsPerSecond(row.speedInMbps * 1_000_000),
                },
              )
            : null,
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
      octets: row.inOctets + row.outOctets,
      detail: translator.translateTemplate("In {{in}} · out {{out}}", {
        in: formatTrafficBytes(row.inOctets),
        out: formatTrafficBytes(row.outOctets),
      }),
      isActive: isActive,
      ariaLabel: translator.translateTemplate(
        "Show only the traffic through {{interface}}",
        { interface: name },
      ),
      onClick: () => {
        toggle(isActive, { interfaceIndex: row.interfaceIndex }, ["interface"]);
      },
    };
  });

  const deviceRows: Array<TrafficTopRow> = (summary?.topDevices || []).map(
    (row: NetworkTrafficDeviceRow): TrafficTopRow => {
      const isKnown: boolean = Boolean(row.networkDeviceId);
      const isActive: boolean = isKnown
        ? filters.networkDeviceId === row.networkDeviceId
        : filters.exporterIp === row.exporterIp;

      return {
        key: row.networkDeviceId || `unknown:${row.exporterIp}`,
        label: isKnown ? row.name || row.exporterIp : row.exporterIp,
        isMono: !isKnown,
        sublabel: isKnown
          ? row.exporterIp
          : translator.translateText("Not a device yet"),
        octets: row.octets,
        isActive: isActive,
        ariaLabel: translator.translateTemplate(
          "Show only the traffic {{device}} reported",
          { device: row.name || row.exporterIp },
        ),
        onClick: () => {
          if (isKnown) {
            toggle(isActive, { networkDeviceId: row.networkDeviceId }, [
              "device",
            ]);
          } else {
            toggle(isActive, { exporterIp: row.exporterIp }, ["exporter"]);
          }
        },
        trailing: isKnown ? (
          <AppLink
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_VIEW_TRAFFIC] as Route,
              { modelId: new ObjectID(row.networkDeviceId!) },
            )}
            className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-50 hover:text-gray-700"
          >
            <span className="sr-only">
              {translator.translateTemplate("Open {{device}}", {
                device: row.name || row.exporterIp,
              })}
            </span>
            <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
          </AppLink>
        ) : undefined,
      };
    },
  );

  const conversationRows: Array<TrafficTopRow> = (
    summary?.topConversations || []
  ).map((row: NetworkTrafficConversationRow): TrafficTopRow => {
    const isActive: boolean =
      filters.sourceIp === row.sourceIp &&
      filters.destinationIp === row.destinationIp;

    return {
      key: `${row.sourceIp}>${row.destinationIp}`,
      label: `${row.sourceIp} → ${row.destinationIp}`,
      isMono: true,
      octets: row.octets,
      isActive: isActive,
      ariaLabel: translator.translateTemplate(
        "Show only the traffic from {{source}} to {{destination}}",
        { source: row.sourceIp, destination: row.destinationIp },
      ),
      onClick: () => {
        onSelectConversation(row.sourceIp, row.destinationIp);
      },
    };
  });

  // ---- The page's states ---------------------------------------------------

  const hasTraffic: boolean = Boolean(
    summary && (summary.totals.octets > 0 || summary.totals.flows > 0),
  );

  const needsSetup: boolean = Boolean(
    summary &&
      !hasTraffic &&
      !NetworkTrafficFiltersUtil.isFiltered(shownView.filters) &&
      shownView.range.range !== TimeRange.CUSTOM &&
      (scope.kind === "device"
        ? summary.lastFlowAt === null
        : summary.sources.length === 0),
  );

  const unknownSources: Array<NetworkTrafficSource> = (
    summary?.sources || []
  ).filter((source: NetworkTrafficSource): boolean => {
    return !source.networkDeviceId;
  });

  const chips: Array<NetworkTrafficFilterChip> = getNetworkTrafficFilterChips(
    view.filters,
    {
      deviceName: summary?.topDevices.find(
        (row: NetworkTrafficDeviceRow): boolean => {
          return row.networkDeviceId === view.filters.networkDeviceId;
        },
      )?.name,
      interfaceName: summary?.topInterfaces.find(
        (row: NetworkTrafficInterfaceRow): boolean => {
          return row.interfaceIndex === view.filters.interfaceIndex;
        },
      )
        ? getInterfaceLabel(
            summary!.topInterfaces.find(
              (row: NetworkTrafficInterfaceRow): boolean => {
                return row.interfaceIndex === view.filters.interfaceIndex;
              },
            )!,
            translator,
          )
        : undefined,
      applicationName:
        view.filters.protocolNumber !== undefined
          ? getApplicationLabel(
              view.filters.protocolNumber,
              view.filters.port || 0,
              translator,
            ).name
          : undefined,
    },
  );

  const description: string =
    scope.kind === "device"
      ? "Where this device's traffic goes, from the flow records it exports."
      : scope.kind === "site"
        ? "Where this site's traffic goes, from the flow records its devices export."
        : "Where your network's traffic goes, from the flow records your devices export.";

  const deviceStatus: ReactElement | null = ((): ReactElement | null => {
    if (scope.kind !== "device" || !summary || needsSetup) {
      return null;
    }

    const source: NetworkTrafficSource | undefined = summary.sources[0];

    if (source) {
      return (
        <div
          className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600"
          data-testid="traffic-device-status"
        >
          <span
            className="h-2 w-2 rounded-full bg-emerald-500"
            aria-hidden="true"
          />
          <span>
            {translator.translateTemplate(
              "Receiving {{format}} from {{address}}, last flow {{time}}.",
              {
                format:
                  source.flowFormat ||
                  translator.translateText("NetFlow v5 or v9") ||
                  "",
                address: source.exporterIp,
                time: OneUptimeDate.fromNow(toDate(source.lastFlowAt)),
              },
            )}
          </span>
          {source.samplingRate > 1 ? (
            <span className="text-gray-500">
              {translator.translateTemplate(
                "The device samples 1 in {{rate}} packets.",
                { rate: translator.formatNumber(source.samplingRate) },
              )}
            </span>
          ) : (
            <></>
          )}
        </div>
      );
    }

    if (summary.lastFlowAt) {
      return (
        <div
          className="mb-4 flex items-center gap-2 text-sm text-amber-800"
          data-testid="traffic-device-status"
        >
          <span
            className="h-2 w-2 rounded-full bg-amber-500"
            aria-hidden="true"
          />
          <span>
            {translator.translateTemplate(
              "No flow records in the last hour. The device's last one arrived {{time}}.",
              { time: OneUptimeDate.fromNow(toDate(summary.lastFlowAt)) },
            )}
          </span>
        </div>
      );
    }

    return null;
  })();

  return (
    <TimeRangeZoomScope timeRange={view.range} onTimeRangeChange={setRange}>
      <Card
        title="Traffic"
        description={description}
        rightElement={
          <div className="flex items-center gap-2">
            <RangeStartAndEndDateView
              dashboardStartAndEndDate={view.range}
              onChange={setRange}
            />
            <ResetTimeRangeZoomButton />
          </div>
        }
      >
        {!loaded && isLoading ? <ComponentLoader /> : <></>}

        {!loaded && !isLoading && error ? (
          <ErrorMessage message={error} />
        ) : (
          <></>
        )}

        {loaded && summary ? (
          <div className="relative" aria-busy={isLoading}>
            {error ? (
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
                    { error: error },
                  )}
                </span>
              </div>
            ) : (
              <></>
            )}

            {isLoading ? (
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
              className={isLoading ? "opacity-75 transition-opacity" : ""}
              data-testid="traffic-body"
            >
              {needsSetup ? (
                <TrafficSetupGuide
                  scope={scope.kind}
                  probeName={props.device?.probeName}
                  isGlobalProbe={props.device?.isGlobalProbe}
                  matchAddresses={[
                    ...(props.device?.hostname ? [props.device.hostname] : []),
                    ...NetworkDeviceOtherAddressesUtil.parse(
                      props.device?.otherAddresses,
                    ).addresses,
                  ]}
                  settingsRoute={
                    scope.kind === "device"
                      ? RouteUtil.populateRouteParams(
                          RouteMap[
                            PageMap.NETWORK_DEVICE_VIEW_SETTINGS
                          ] as Route,
                          { modelId: scope.networkDeviceId },
                        )
                      : undefined
                  }
                />
              ) : (
                <Fragment>
                  {deviceStatus}

                  {scope.kind === "network" && unknownSources.length > 0 ? (
                    <div
                      className="mb-4 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200"
                      data-testid="traffic-unknown-sources"
                    >
                      <Icon
                        icon={IconProp.Info}
                        className="h-4 w-4 text-amber-600"
                      />
                      <span>
                        {translator.translatePlural(
                          {
                            one: "{{count}} address sending flow records is not a device yet.",
                            other:
                              "{{count}} addresses sending flow records are not devices yet.",
                          },
                          unknownSources.length,
                        )}
                      </span>
                      <a
                        href="#traffic-sources"
                        className="font-medium text-amber-900 underline"
                      >
                        {translator.translateText("Review")}
                      </a>
                    </div>
                  ) : (
                    <></>
                  )}

                  <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div
                      className="flex min-h-[2rem] flex-wrap items-center gap-2"
                      data-testid="traffic-filters"
                    >
                      {chips.length === 0 ? (
                        <span className="text-sm text-gray-500">
                          {translator.translateText(
                            "Click any row to see only its traffic.",
                          )}
                        </span>
                      ) : (
                        <Fragment>
                          {chips.map(
                            (chip: NetworkTrafficFilterChip): ReactElement => {
                              const text: string = translator.translateTemplate(
                                chip.template,
                                chip.values,
                              );

                              return (
                                <span
                                  key={chip.kind}
                                  className="inline-flex items-center gap-1 rounded-full bg-indigo-50 py-1 pl-3 pr-1 text-sm font-medium text-indigo-700 ring-1 ring-indigo-200"
                                  data-testid={`traffic-filter-${chip.kind}`}
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
                                      setFilters(
                                        withoutNetworkTrafficFilter(
                                          view.filters,
                                          chip.kind,
                                        ),
                                      );
                                    }}
                                  >
                                    <Icon
                                      icon={IconProp.Close}
                                      className="h-3 w-3"
                                    />
                                  </button>
                                </span>
                              );
                            },
                          )}
                          <button
                            type="button"
                            className="text-sm font-medium text-gray-500 hover:text-gray-900 hover:underline"
                            onClick={() => {
                              setFilters({});
                            }}
                            data-testid="traffic-filters-clear"
                          >
                            {translator.translateText("Clear filters")}
                          </button>
                        </Fragment>
                      )}
                    </div>
                    <form
                      className="flex flex-shrink-0 items-start gap-2"
                      onSubmit={onFindAddress}
                      data-testid="traffic-find-address"
                    >
                      <div>
                        <input
                          type="text"
                          inputMode="text"
                          value={addressInput}
                          onChange={(
                            event: React.ChangeEvent<HTMLInputElement>,
                          ) => {
                            setAddressInput(event.target.value);
                            setAddressError("");
                          }}
                          placeholder={translator.translateText(
                            "Find an IP address",
                          )}
                          aria-label={translator.translateText(
                            "Find an IP address",
                          )}
                          className="block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 lg:w-56"
                        />
                        {addressError ? (
                          <p className="mt-1 text-xs text-red-600">
                            {addressError}
                          </p>
                        ) : (
                          <></>
                        )}
                      </div>
                      <Button
                        title="Find"
                        type={ButtonType.Submit}
                        icon={IconProp.Search}
                        buttonSize={ButtonSize.Small}
                        buttonStyle={ButtonStyleType.OUTLINE}
                        dataTestId="traffic-find-address-button"
                      />
                    </form>
                  </div>

                  {hasTraffic ? (
                    <Fragment>
                      <TrafficSummaryTiles
                        summary={summary}
                        windowSeconds={windowSeconds}
                      />
                      <div className="group/zoomhint mt-6">
                        <div className="mb-1 text-sm font-medium text-gray-900">
                          {translator.translateText("Traffic over time")}
                        </div>
                        <TrafficOverTimeChart
                          series={fillTrafficSeriesGaps(
                            summary.series,
                            summary.bucketSeconds,
                            summary.windowStartAt,
                            summary.windowEndAt,
                          )}
                          bucketSeconds={summary.bucketSeconds}
                          windowStartAt={summary.windowStartAt}
                          windowEndAt={summary.windowEndAt}
                        />
                      </div>
                      <div className="mt-2 text-xs text-gray-500">
                        {translator.translateTemplate(
                          "{{bytes}} at an average of {{rate}}.",
                          {
                            bytes: formatTrafficBytes(summary.totals.octets),
                            rate: formatBitsPerSecond(
                              getBitsPerSecond(
                                summary.totals.octets,
                                windowSeconds,
                              ),
                            ),
                          },
                        )}
                      </div>
                    </Fragment>
                  ) : isFiltered ? (
                    <div
                      className="flex flex-col items-center justify-center px-6 py-14 text-center"
                      data-testid="traffic-no-match"
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
                  ) : (
                    <ZoomedEmptyState />
                  )}
                </Fragment>
              )}
            </div>
          </div>
        ) : (
          <></>
        )}
      </Card>

      {loaded && summary && !needsSetup && hasTraffic ? (
        <Fragment>
          <div className="grid grid-cols-1 gap-x-5 lg:grid-cols-2">
            {scope.kind === "device" ? (
              <Fragment>
                <TrafficTopList
                  title="Top sources"
                  description="Who sent the most."
                  help={TRAFFIC_HELP.sources}
                  rows={addressRows(summary.topSources, "source")}
                  totalOctets={summary.totals.octets}
                  emptyMessage="No sources in this time range."
                  dataTestId="traffic-top-sources"
                />
                <TrafficTopList
                  title="Top destinations"
                  description="Who received the most."
                  help={TRAFFIC_HELP.destinations}
                  rows={addressRows(summary.topDestinations, "destination")}
                  totalOctets={summary.totals.octets}
                  emptyMessage="No destinations in this time range."
                  dataTestId="traffic-top-destinations"
                />
                <TrafficTopList
                  title="Top applications"
                  description="What the traffic is for, by service port."
                  help={TRAFFIC_HELP.applications}
                  rows={applicationRows}
                  totalOctets={summary.totals.octets}
                  emptyMessage="No applications in this time range."
                  dataTestId="traffic-top-applications"
                />
                <TrafficTopList
                  title="Top interfaces"
                  description="Which ports the traffic went through."
                  help={TRAFFIC_HELP.interfaces}
                  rows={interfaceRows}
                  totalOctets={
                    // In and out are both counted: every share is of both.
                    summary.topInterfaces.reduce(
                      (
                        total: number,
                        row: NetworkTrafficInterfaceRow,
                      ): number => {
                        return total + row.inOctets + row.outOctets;
                      },
                      0,
                    )
                  }
                  emptyMessage="The device's flow records name no interfaces."
                  dataTestId="traffic-top-interfaces"
                />
              </Fragment>
            ) : (
              <Fragment>
                <TrafficTopList
                  title="Top devices"
                  description="Which devices reported the most traffic."
                  help={TRAFFIC_HELP.devices}
                  rows={deviceRows}
                  totalOctets={summary.totals.octets}
                  emptyMessage="No devices in this time range."
                  dataTestId="traffic-top-devices"
                />
                <TrafficTopList
                  title="Top applications"
                  description="What the traffic is for, by service port."
                  help={TRAFFIC_HELP.applications}
                  rows={applicationRows}
                  totalOctets={summary.totals.octets}
                  emptyMessage="No applications in this time range."
                  dataTestId="traffic-top-applications"
                />
                <TrafficTopList
                  title="Top sources"
                  description="Who sent the most."
                  help={TRAFFIC_HELP.sources}
                  rows={addressRows(summary.topSources, "source")}
                  totalOctets={summary.totals.octets}
                  emptyMessage="No sources in this time range."
                  dataTestId="traffic-top-sources"
                />
                <TrafficTopList
                  title="Top destinations"
                  description="Who received the most."
                  help={TRAFFIC_HELP.destinations}
                  rows={addressRows(summary.topDestinations, "destination")}
                  totalOctets={summary.totals.octets}
                  emptyMessage="No destinations in this time range."
                  dataTestId="traffic-top-destinations"
                />
              </Fragment>
            )}
          </div>

          <Card
            title={
              <span className="inline-flex items-center gap-1.5">
                {translator.translateText(CONVERSATIONS_TITLE)}
                <InfoTooltip
                  label={CONVERSATIONS_TITLE}
                  text={TRAFFIC_HELP.conversations}
                />
              </span>
            }
            description="Who talks to whom, busiest first."
            rightElement={
              <div
                className="max-sm:hidden inline-flex rounded-md bg-gray-50 p-0.5 ring-1 ring-gray-200 sm:flex"
                role="group"
                aria-label={translator.translateText("Show conversations as")}
              >
                {(["diagram", "list"] as Array<"diagram" | "list">).map(
                  (mode: "diagram" | "list"): ReactElement => {
                    return (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={conversationMode === mode}
                        className={`rounded px-2.5 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                          conversationMode === mode
                            ? "bg-white text-gray-900 shadow-sm"
                            : "text-gray-500 hover:text-gray-900"
                        }`}
                        onClick={() => {
                          setConversationMode(mode);
                        }}
                        data-testid={`traffic-conversations-${mode}`}
                      >
                        {translator.translateText(
                          mode === "diagram" ? "Diagram" : "List",
                        )}
                      </button>
                    );
                  },
                )}
              </div>
            }
          >
            <div data-testid="traffic-top-conversations">
              {summary.topConversations.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-500">
                  {translator.translateText(
                    "No conversations in this time range.",
                  )}
                </p>
              ) : (
                <Fragment>
                  {conversationMode === "diagram" ? (
                    <div className="max-sm:hidden">
                      <TrafficConversationDiagram
                        conversations={summary.topConversations}
                        onSelectConversation={onSelectConversation}
                        onSelectSource={onSelectSource}
                        onSelectDestination={onSelectDestination}
                      />
                    </div>
                  ) : (
                    <></>
                  )}
                  <div
                    className={
                      conversationMode === "diagram" ? "sm:hidden" : undefined
                    }
                  >
                    <ol className="-mx-2 space-y-0.5">
                      {conversationRows.map(
                        (row: TrafficTopRow): ReactElement => {
                          return (
                            <li key={row.key}>
                              <button
                                type="button"
                                className={`block w-full rounded-md px-2 py-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                                  row.isActive
                                    ? "bg-indigo-50"
                                    : "hover:bg-gray-50"
                                }`}
                                aria-pressed={row.isActive}
                                aria-label={row.ariaLabel}
                                onClick={row.onClick}
                                data-testid="traffic-conversation-row"
                              >
                                <div className="flex items-baseline justify-between gap-3">
                                  <span className="min-w-0 truncate font-mono text-sm text-gray-900">
                                    {row.label}
                                  </span>
                                  <span className="flex-shrink-0 text-sm tabular-nums text-gray-900">
                                    {formatTrafficBytes(row.octets)}
                                  </span>
                                </div>
                              </button>
                            </li>
                          );
                        },
                      )}
                    </ol>
                  </div>
                </Fragment>
              )}
            </div>
          </Card>
        </Fragment>
      ) : (
        <></>
      )}

      {scope.kind === "network" && summary ? (
        <TrafficSourcesCard
          sources={summary.sources}
          onLinked={() => {
            setRefreshKey((key: number) => {
              return key + 1;
            });
          }}
        />
      ) : (
        <></>
      )}
    </TimeRangeZoomScope>
  );
};

export default NetworkTrafficView;
