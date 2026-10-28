import {
  fetchNetworkTraffic,
  findNetworkTrafficAddress,
} from "./NetworkTrafficApi";
import {
  TrafficAddressLabel,
  getFilteredAddress,
  getTrafficAddressLabel,
  getTrafficAddressText,
} from "./NetworkTrafficAddressNames";
import {
  TrafficAddressInline,
  TrafficAddressPair,
  TrafficAddressPrimary,
  TrafficAddressText,
  getTrafficAddressSecondary,
} from "./TrafficAddress";
import TrafficAddressCard from "./TrafficAddressCard";
import { fetchNetworkTrafficUsage } from "./NetworkTrafficUsageApi";
import MerakiConnectModal from "./Meraki/MerakiConnectModal";
import MerakiConnectionsCard from "./Meraki/MerakiConnectionsCard";
import MerakiTrafficView from "./Meraki/MerakiTrafficView";
import { MERAKI_CONNECTION_NAME } from "./Meraki/MerakiWords";
import {
  TrafficSide,
  pickTrafficSide,
  readTrafficSide,
  readNetworkTrafficUsageFilters,
  toMerakiUrlParams,
} from "./Meraki/MerakiUrlState";
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
import NetworkAddressName from "Common/Models/DatabaseModels/NetworkAddressName";
import NetworkControllerConnection from "Common/Models/DatabaseModels/NetworkControllerConnection";
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
  NetworkTrafficFindMatch,
  NetworkTrafficFindRequest,
  NetworkTrafficFindResult,
  NetworkTrafficInterfaceRow,
  NetworkTrafficRequest,
  NetworkTrafficSource,
  NetworkTrafficSummary,
} from "Common/Types/NetFlow/NetworkTraffic";
import { NetworkTrafficAddressNames } from "Common/Types/NetFlow/NetworkAddressName";
import {
  NetworkTrafficUsageFilters,
  NetworkTrafficUsageRequest,
  NetworkTrafficUsageSummary,
} from "Common/Types/NetFlow/NetworkTrafficUsage";
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
import CardGrid from "Common/UI/Components/Card/CardGrid";
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
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import {
  SentencePart,
  getSentenceParts,
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
 * Addresses are written by their names (issue #5340): "mumbai-fs01" over
 * 10.18.167.35, wherever an address shows - the top lists, both views of
 * the conversations, the chips, the address card a page narrowed to one
 * address opens with, and "find" (a name or an address). Names come from
 * the project's inventory, the names people give addresses, and DNS as the
 * probe resolved it (NetworkAddressName); the summary carries them.
 *
 * Before any flow has arrived the page is the set-up guide instead
 * (TrafficSetupGuide): the probe already listens, the device needs a few
 * lines, and records are matched by the address they come from.
 *
 * A drag across the chart zooms the page's range, a double-click (or Reset
 * zoom) puts it back (issue #4105); while a new window loads the last one
 * stays on screen, dimmed, so the page never collapses under the pointer.
 *
 * A page can show its traffic a second way (issue #5140): as a Meraki
 * connection read it from the Meraki dashboard API - uplinks, applications,
 * clients - with nothing set up on the devices (MerakiTrafficView). When
 * the page has both, a switch in the header picks one, and it is kept in
 * the URL (MerakiUrlState); a page with Meraki traffic and no flow records
 * opens on Meraki, and every other page opens as it did before. The whole
 * network's page lists the connections at its foot, and its set-up guide
 * offers to connect one.
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
    "The 10 addresses that sent the most bytes in this time range, with each one's share of all the traffic shown. An address is shown by its name when your inventory, your address names or DNS has one. Click one to see only its traffic.",
  ),
  destinations: translationKey(
    "The 10 addresses that received the most bytes in this time range. An address is shown by its name when your inventory, your address names or DNS has one. Click one to see only the traffic to it.",
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

/*
 * What the flow side's card says it is, by whose page it is - keys, so
 * the extractor finds them and the card draws them in the reader's
 * language, as the Meraki side's (MERAKI_DESCRIPTIONS) beside it.
 */
export const FLOW_DESCRIPTIONS: {
  device: string;
  site: string;
  network: string;
} = {
  device: translationKey(
    "Where this device's traffic goes, from the flow records it exports.",
  ),
  site: translationKey(
    "Where this site's traffic goes, from the flow records its devices export.",
  ),
  network: translationKey(
    "Where your network's traffic goes, from the flow records your devices export.",
  ),
};

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
          : translator.translateText(
              "Pick a longer time range to see older traffic.",
            )}
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
  // "Find" by a name: the addresses it found, to pick one of.
  const [findMatches, setFindMatches] = useState<Array<NetworkTrafficFindMatch>>(
    [],
  );
  const [isFinding, setIsFinding] = useState<boolean>(false);
  const latestFindRef: React.MutableRefObject<number> = useRef<number>(0);
  const findFormRef: React.RefObject<HTMLFormElement> =
    useRef<HTMLFormElement>(null);

  // The addresses to pick from close on Escape, or a click outside the box.
  useEffect(() => {
    if (findMatches.length === 0) {
      return;
    }

    const close: () => void = (): void => {
      setFindMatches([]);
    };

    const onPointerDown: (event: MouseEvent) => void = (
      event: MouseEvent,
    ): void => {
      if (
        findFormRef.current &&
        event.target instanceof Node &&
        !findFormRef.current.contains(event.target)
      ) {
        close();
      }
    };

    const onKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (event.key === "Escape") {
        close();
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [findMatches]);
  const [refreshKey, setRefreshKey] = useState<number>(0);

  // The Meraki side: the side picked, its filters, and what it answered.
  const [pickedSource, setPickedSource] = useState<TrafficSide | null>(
    (): TrafficSide | null => {
      return readTrafficSide((name: string): string | null => {
        return Navigation.getQueryStringByName(name);
      });
    },
  );
  const [usageFilters, setUsageFiltersState] =
    useState<NetworkTrafficUsageFilters>((): NetworkTrafficUsageFilters => {
      return readNetworkTrafficUsageFilters((name: string): string | null => {
        return Navigation.getQueryStringByName(name);
      });
    });
  const [usage, setUsage] = useState<NetworkTrafficUsageSummary | null>(null);
  const [isUsageSettled, setIsUsageSettled] = useState<boolean>(false);
  const [isUsageLoading, setIsUsageLoading] = useState<boolean>(true);
  const [usageError, setUsageError] = useState<string>("");
  const [isConnectOpen, setIsConnectOpen] = useState<boolean>(false);
  const [connectionsRefreshKey, setConnectionsRefreshKey] = useState<number>(0);

  // Only the newest fetch lands: a drag and a double-click can overlap.
  const latestFetchRef: React.MutableRefObject<number> = useRef<number>(0);
  const latestUsageFetchRef: React.MutableRefObject<number> = useRef<number>(0);

  const setSource: (next: TrafficSide) => void = (next: TrafficSide): void => {
    setPickedSource(next);
    Navigation.setQueryString(
      toMerakiUrlParams({ source: next, filters: usageFilters }),
    );
  };

  const setUsageFilters: (next: NetworkTrafficUsageFilters) => void = (
    next: NetworkTrafficUsageFilters,
  ): void => {
    setUsageFiltersState(next);
    Navigation.setQueryString(
      toMerakiUrlParams({ source: pickedSource, filters: next }),
    );
  };

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

  /*
   * The same window as the Meraki connections read it. A page without one
   * is answered at once (isAvailable false); a failure leaves the page on
   * its flows, saying nothing - or, on the Meraki side, that it could not
   * refresh.
   */
  useEffect(() => {
    latestUsageFetchRef.current += 1;
    const fetchId: number = latestUsageFetchRef.current;

    const loadUsage: () => Promise<void> = async (): Promise<void> => {
      setIsUsageLoading(true);
      setUsageError("");

      try {
        const dateRange: InBetween<Date> =
          RangeStartAndEndDateTimeUtil.getStartAndEndDate(view.range);
        const request: NetworkTrafficUsageRequest = {
          startTime: OneUptimeDate.toString(dateRange.startValue),
          endTime: OneUptimeDate.toString(dateRange.endValue),
          filters: usageFilters,
        };

        if (scope.kind === "device") {
          request.networkDeviceId = scope.networkDeviceId.toString();
        } else if (scope.kind === "site") {
          request.networkSiteId = scope.networkSiteId.toString();
        }

        const next: NetworkTrafficUsageSummary =
          await fetchNetworkTrafficUsage(request);

        if (fetchId === latestUsageFetchRef.current) {
          setUsage(next);
        }
      } catch (err) {
        if (fetchId === latestUsageFetchRef.current) {
          setUsageError(API.getFriendlyMessage(err));
        }
      } finally {
        if (fetchId === latestUsageFetchRef.current) {
          setIsUsageLoading(false);
          setIsUsageSettled(true);
        }
      }
    };

    loadUsage().catch(() => {
      // handled inside.
    });
  }, [scopeKey, view.range, usageFilters, refreshKey]);

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

  const onPickAddress: (address: string) => void = (address: string) => {
    setAddressError("");
    setAddressInput("");
    setFindMatches([]);
    setFilters({ ...view.filters, hostIp: address });
  };

  /*
   * Find an address by itself or by its name (issue #5340). An address is
   * filtered on at once, checked (and written canonically) the way the
   * server checks it. A name is looked up in the page's window: one
   * address found is filtered on, several are listed to pick from, none
   * says so.
   */
  const onFindAddress: (event: FormEvent) => void = (
    event: FormEvent,
  ): void => {
    event.preventDefault();
    const typed: string = addressInput.trim();

    if (!typed) {
      return;
    }

    let hostIp: string | undefined = undefined;

    try {
      hostIp = NetworkTrafficFiltersUtil.sanitize({ hostIp: typed }).hostIp;
    } catch {
      hostIp = undefined;
    }

    if (hostIp) {
      onPickAddress(hostIp);
      return;
    }

    latestFindRef.current += 1;
    const findId: number = latestFindRef.current;

    setAddressError("");
    setFindMatches([]);
    setIsFinding(true);

    const dateRange: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(view.range);
    const request: NetworkTrafficFindRequest = {
      startTime: OneUptimeDate.toString(dateRange.startValue),
      endTime: OneUptimeDate.toString(dateRange.endValue),
      query: typed,
    };

    if (scope.kind === "device") {
      request.networkDeviceId = scope.networkDeviceId.toString();
    } else if (scope.kind === "site") {
      request.networkSiteId = scope.networkSiteId.toString();
    }

    findNetworkTrafficAddress(request)
      .then((result: NetworkTrafficFindResult) => {
        if (findId !== latestFindRef.current) {
          return;
        }

        if (result.matches.length === 1) {
          onPickAddress(result.matches[0]!.address);
          return;
        }

        if (result.matches.length === 0) {
          setAddressError(
            translator.translateTemplate(
              "No address with traffic in this time range matches “{{query}}”.",
              { query: typed },
            ),
          );
          return;
        }

        setFindMatches(result.matches);
      })
      .catch((err: Error) => {
        if (findId === latestFindRef.current) {
          setAddressError(API.getFriendlyMessage(err));
        }
      })
      .finally(() => {
        if (findId === latestFindRef.current) {
          setIsFinding(false);
        }
      });
  };

  // ---- Rows ----------------------------------------------------------------

  const addressNames: NetworkTrafficAddressNames | undefined =
    summary?.addressNames;

  const labelOf: (address: string) => TrafficAddressLabel = (
    address: string,
  ): TrafficAddressLabel => {
    return getTrafficAddressLabel(address, addressNames);
  };

  /*
   * A source or destination: its name over its address (and the subnet
   * it is in), or the address alone when it has no name.
   */
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
      const label: TrafficAddressLabel = labelOf(row.ip);

      return {
        key: row.ip,
        label: <TrafficAddressPrimary label={label} />,
        title: getTrafficAddressText(label),
        sublabel: getTrafficAddressSecondary(label) || undefined,
        octets: row.octets,
        isActive: isActive,
        ariaLabel: translator.translateTemplate(
          side === "source"
            ? "Show only the traffic from {{address}}"
            : "Show only the traffic to {{address}}",
          { address: getTrafficAddressText(label) },
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
      // An exporter that is no device yet may still have a name (DNS, a host).
      const exporterLabel: TrafficAddressLabel = labelOf(row.exporterIp);

      return {
        key: row.networkDeviceId || `unknown:${row.exporterIp}`,
        label: isKnown ? (
          row.name || <TrafficAddressText address={row.exporterIp} />
        ) : (
          <TrafficAddressPrimary label={exporterLabel} />
        ),
        title: isKnown ? undefined : getTrafficAddressText(exporterLabel),
        sublabel: isKnown ? (
          <TrafficAddressText address={row.exporterIp} />
        ) : exporterLabel.name ? (
          <Fragment>
            <TrafficAddressText address={row.exporterIp} />
            <span aria-hidden="true"> · </span>
            {translator.translateText("Not a device yet")}
          </Fragment>
        ) : (
          translator.translateText("Not a device yet")
        ),
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
    const source: TrafficAddressLabel = labelOf(row.sourceIp);
    const destination: TrafficAddressLabel = labelOf(row.destinationIp);
    const hasName: boolean = Boolean(source.name || destination.name);

    return {
      key: `${row.sourceIp}>${row.destinationIp}`,
      /*
       * Names first when either end has one ("mumbai-fs01 → backup-01"),
       * the addresses under them; the addresses alone otherwise. Left to
       * right whatever the page's language: the arrow is the flow.
       */
      label: (
        <TrafficAddressPair
          source={<TrafficAddressPrimary label={source} />}
          destination={<TrafficAddressPrimary label={destination} />}
        />
      ),
      title: `${getTrafficAddressText(source)} → ${getTrafficAddressText(destination)}`,
      isMono: !hasName,
      sublabel: hasName ? (
        <TrafficAddressPair
          source={<TrafficAddressText address={row.sourceIp} />}
          destination={<TrafficAddressText address={row.destinationIp} />}
        />
      ) : undefined,
      octets: row.octets,
      isActive: isActive,
      ariaLabel: translator.translateTemplate(
        "Show only the traffic from {{source}} to {{destination}}",
        {
          source: getTrafficAddressText(source),
          destination: getTrafficAddressText(destination),
        },
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

  const description: string = FLOW_DESCRIPTIONS[scope.kind];

  /*
   * Who the one address the page is narrowed to is, and the next step
   * (issue #5340): for the filters the page shows, so it changes with them.
   */
  const filteredAddress: string | null = getFilteredAddress(filters);

  /*
   * Naming an address is for whoever may add Address Names, and renaming
   * one for whoever may change them.
   */
  const nameAddressGate: PermissionGateResult = PermissionGate.check(
    new NetworkAddressName(),
    ModelAction.Create,
    { singularName: "Address Name" },
  );
  const renameAddressGate: PermissionGateResult = PermissionGate.check(
    new NetworkAddressName(),
    ModelAction.Update,
    { singularName: "Address Name" },
  );

  const deviceStatus: ReactElement | null = ((): ReactElement | null => {
    if (scope.kind !== "device" || !summary || needsSetup) {
      return null;
    }

    const source: NetworkTrafficSource | undefined = summary.sources[0];

    if (source) {
      return (
        <div
          className="mb-4 flex items-start gap-2 text-sm text-gray-600"
          data-testid="traffic-device-status"
        >
          {/* Beside the first line, however the sentence wraps. */}
          <span
            className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-emerald-500"
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
            {source.samplingRate > 1 ? (
              <span className="text-gray-500">
                {" "}
                {translator.translateTemplate(
                  "The device samples 1 in {{rate}} packets.",
                  { rate: translator.formatNumber(source.samplingRate) },
                )}
              </span>
            ) : (
              <></>
            )}
          </span>
        </div>
      );
    }

    if (summary.lastFlowAt) {
      return (
        <div
          className="mb-4 flex items-start gap-2 text-sm text-amber-800"
          data-testid="traffic-device-status"
        >
          <span
            className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-amber-500"
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

  const isMerakiAvailable: boolean = Boolean(usage?.isAvailable);
  const hasFlowRecords: boolean = Boolean(summary) && !needsSetup;
  const side: TrafficSide = pickTrafficSide({
    picked: pickedSource,
    isMerakiAvailable,
    hasFlows: hasFlowRecords,
  });
  const isMerakiShown: boolean = isUsageSettled && side === TrafficSide.Meraki;

  /*
   * Connecting Meraki is for who may add a connection (project owners and
   * admins). Anyone else reads the offer with why there is no button - or,
   * before the permissions have loaded, no button and nothing said.
   */
  const merakiConnectGate: PermissionGateResult = PermissionGate.check(
    new NetworkControllerConnection(),
    ModelAction.Create,
    { singularName: MERAKI_CONNECTION_NAME },
  );

  const sourceSwitch: ReactElement = isMerakiAvailable ? (
    <div
      className="inline-flex rounded-md bg-gray-50 p-0.5 ring-1 ring-gray-200"
      role="group"
      aria-label={translator.translateText("Show traffic from")}
      data-testid="traffic-source-switch"
    >
      {[TrafficSide.Flows, TrafficSide.Meraki].map(
        (option: TrafficSide): ReactElement => {
          return (
            <button
              key={option}
              type="button"
              aria-pressed={side === option}
              className={`rounded px-2.5 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                side === option
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-900"
              }`}
              onClick={() => {
                setSource(option);
              }}
              data-testid={`traffic-source-${option}`}
            >
              {option === TrafficSide.Meraki
                ? translator.translateText("Meraki")
                : translator.translateText("Flows")}
            </button>
          );
        },
      )}
    </div>
  ) : (
    <></>
  );

  const headerElement: ReactElement = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {sourceSwitch}
      <RangeStartAndEndDateView
        dashboardStartAndEndDate={view.range}
        onChange={setRange}
      />
      <ResetTimeRangeZoomButton />
    </div>
  );

  return (
    <TimeRangeZoomScope timeRange={view.range} onTimeRangeChange={setRange}>
      {isMerakiShown && usage ? (
        <MerakiTrafficView
          scopeKind={scope.kind}
          summary={usage}
          isLoading={isUsageLoading}
          error={usageError}
          filters={usageFilters}
          onFiltersChange={setUsageFilters}
          headerElement={headerElement}
          hasFlows={hasFlowRecords}
          onShowFlows={() => {
            setSource(TrafficSide.Flows);
          }}
        />
      ) : (
        <Fragment>
          <Card
            title="Traffic"
            description={description}
            rightElement={headerElement}
          >
            {(!loaded && isLoading) || !isUsageSettled ? (
              <ComponentLoader />
            ) : (
              <></>
            )}

            {!loaded && !isLoading && error ? (
              <ErrorMessage message={error} />
            ) : (
              <></>
            )}

            {loaded && summary && isUsageSettled ? (
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
                      onConnectMeraki={
                        scope.kind === "network" && merakiConnectGate.isAllowed
                          ? () => {
                              setIsConnectOpen(true);
                            }
                          : undefined
                      }
                      connectMerakiLockedReason={
                        scope.kind === "network" && !merakiConnectGate.isAllowed
                          ? merakiConnectGate.disabledReason
                          : undefined
                      }
                      matchAddresses={[
                        ...(props.device?.hostname
                          ? [props.device.hostname]
                          : []),
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

                      {/*
                       * Nothing to narrow in an empty window, unless it is
                       * empty because of the filters: then the chips are how
                       * they come off.
                       */}
                      {hasTraffic || isFiltered ? (
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
                                  (
                                    chip: NetworkTrafficFilterChip,
                                  ): ReactElement => {
                                    const chipAddress: TrafficAddressLabel | null =
                                      chip.address
                                        ? labelOf(chip.address)
                                        : null;
                                    const text: string =
                                      translator.translateTemplate(
                                        chip.template,
                                        chipAddress
                                          ? {
                                              ...chip.values,
                                              address:
                                                getTrafficAddressText(
                                                  chipAddress,
                                                ),
                                            }
                                          : chip.values,
                                      );

                                    return (
                                      <span
                                        key={chip.kind}
                                        className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-indigo-50 py-1 pl-3 pr-1 text-sm font-medium text-indigo-700 ring-1 ring-indigo-200"
                                        data-testid={`traffic-filter-${chip.kind}`}
                                        title={text}
                                      >
                                        {chipAddress ? (
                                          <span className="min-w-0 truncate">
                                            {getSentenceParts({
                                              translator: translator,
                                              template: chip.template,
                                              slots: ["address"],
                                              values: chip.values,
                                            }).map(
                                              (
                                                part: SentencePart,
                                                index: number,
                                              ): ReactElement => {
                                                return part.kind === "slot" ? (
                                                  <TrafficAddressInline
                                                    key={index}
                                                    label={chipAddress}
                                                  />
                                                ) : (
                                                  <Fragment key={index}>
                                                    {part.text}
                                                  </Fragment>
                                                );
                                              },
                                            )}
                                          </span>
                                        ) : (
                                          text
                                        )}
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
                            ref={findFormRef}
                            className="relative flex flex-shrink-0 items-start gap-2"
                            onSubmit={onFindAddress}
                            data-testid="traffic-find-address"
                          >
                            <div className="min-w-0 flex-1 lg:w-64 lg:flex-none">
                              <input
                                data-unsaved-changes-ignore
                                type="text"
                                inputMode="text"
                                value={addressInput}
                                onChange={(
                                  event: React.ChangeEvent<HTMLInputElement>,
                                ) => {
                                  setAddressInput(event.target.value);
                                  setAddressError("");
                                  setFindMatches([]);
                                }}
                                placeholder={translator.translateText(
                                  "Find a name or an IP address",
                                )}
                                aria-label={translator.translateText(
                                  "Find a name or an IP address",
                                )}
                                className="block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                              {addressError ? (
                                <p
                                  className="mt-1 text-xs text-red-600"
                                  role="alert"
                                  data-testid="traffic-find-address-error"
                                >
                                  {addressError}
                                </p>
                              ) : (
                                <></>
                              )}
                              {findMatches.length > 0 ? (
                                /*
                                 * Over the page, under the box, as wide as a
                                 * name needs: Escape or a click elsewhere
                                 * closes it, a pick filters the page.
                                 */
                                <div
                                  className="absolute right-0 top-full z-20 mt-2 w-full rounded-md bg-white py-1 shadow-lg ring-1 ring-gray-200 sm:w-96"
                                  role="group"
                                  aria-label={translator.translateText(
                                    "Pick the address:",
                                  )}
                                  data-testid="traffic-find-address-matches"
                                >
                                  <p className="px-3 pb-1 pt-2 text-xs text-gray-500">
                                    {translator.translateText(
                                      "Pick the address:",
                                    )}
                                  </p>
                                  <ul className="pb-1">
                                    {findMatches.map(
                                      (
                                        match: NetworkTrafficFindMatch,
                                      ): ReactElement => {
                                        const matchLabel: TrafficAddressLabel =
                                          {
                                            ...labelOf(match.address),
                                            name: match.name || null,
                                          };

                                        return (
                                          <li key={match.address}>
                                            <button
                                              type="button"
                                              className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                                              onClick={() => {
                                                onPickAddress(match.address);
                                              }}
                                              aria-label={translator.translateTemplate(
                                                "Show only the traffic to or from {{address}}",
                                                {
                                                  address:
                                                    getTrafficAddressText(
                                                      matchLabel,
                                                    ),
                                                },
                                              )}
                                              data-testid="traffic-find-address-match"
                                            >
                                              <span className="min-w-0">
                                                <span
                                                  className="block truncate text-sm text-gray-900"
                                                  title={getTrafficAddressText(
                                                    matchLabel,
                                                  )}
                                                >
                                                  <TrafficAddressPrimary
                                                    label={matchLabel}
                                                  />
                                                </span>
                                                {matchLabel.name ? (
                                                  <span className="block truncate text-xs text-gray-500">
                                                    <TrafficAddressText
                                                      address={match.address}
                                                    />
                                                  </span>
                                                ) : (
                                                  <></>
                                                )}
                                              </span>
                                              <span className="flex-shrink-0 text-xs tabular-nums text-gray-500">
                                                {formatTrafficBytes(
                                                  match.octets,
                                                )}
                                              </span>
                                            </button>
                                          </li>
                                        );
                                      },
                                    )}
                                  </ul>
                                </div>
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
                              isLoading={isFinding}
                              dataTestId="traffic-find-address-button"
                            />
                          </form>
                        </div>
                      ) : (
                        <></>
                      )}

                      {filteredAddress ? (
                        <TrafficAddressCard
                          label={labelOf(filteredAddress)}
                          canName={nameAddressGate.isAllowed}
                          canRename={renameAddressGate.isAllowed}
                          onNamed={() => {
                            setRefreshKey((key: number) => {
                              return key + 1;
                            });
                          }}
                        />
                      ) : (
                        <></>
                      )}

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
                                bytes: formatTrafficBytes(
                                  summary.totals.octets,
                                ),
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

          {loaded && summary && isUsageSettled && !needsSetup && hasTraffic ? (
            <Fragment>
              <CardGrid
                columns={2}
                cardWidth="narrow"
                dataTestId="traffic-top-lists"
              >
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
              </CardGrid>

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
                    aria-label={translator.translateText(
                      "Show conversations as",
                    )}
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
                            addressNames={summary.addressNames}
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
                          conversationMode === "diagram"
                            ? "sm:hidden"
                            : undefined
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
                                      <span
                                        className={`min-w-0 flex-1 text-sm text-gray-900${
                                          row.isMono ? " font-mono" : ""
                                        }`}
                                        title={row.title}
                                        data-testid="traffic-conversation-row-label"
                                      >
                                        {row.label}
                                      </span>
                                      <span className="flex-shrink-0 text-sm tabular-nums text-gray-900">
                                        {formatTrafficBytes(row.octets)}
                                      </span>
                                    </div>
                                    {row.sublabel ? (
                                      <div
                                        className="mt-0.5 text-xs text-gray-500"
                                        data-testid="traffic-conversation-row-addresses"
                                      >
                                        {row.sublabel}
                                      </div>
                                    ) : (
                                      <></>
                                    )}
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
        </Fragment>
      )}

      {scope.kind === "network" && summary && !isMerakiShown ? (
        <TrafficSourcesCard
          sources={summary.sources}
          addressNames={summary.addressNames}
          onLinked={() => {
            setRefreshKey((key: number) => {
              return key + 1;
            });
          }}
        />
      ) : (
        <></>
      )}

      {scope.kind === "network" ? (
        <MerakiConnectionsCard
          /*
           * Without a connection, a page that shows its flows offers Meraki
           * at its foot; a page still setting up offers it in its guide.
           */
          offerWhenEmpty={Boolean(summary) && !needsSetup}
          refreshKey={connectionsRefreshKey}
          onChanged={() => {
            setRefreshKey((key: number) => {
              return key + 1;
            });
          }}
          onConnect={() => {
            setIsConnectOpen(true);
          }}
        />
      ) : (
        <></>
      )}

      {isConnectOpen ? (
        <MerakiConnectModal
          onClose={() => {
            setIsConnectOpen(false);
          }}
          onConnected={() => {
            setIsConnectOpen(false);
            setSource(TrafficSide.Meraki);
            setConnectionsRefreshKey((key: number) => {
              return key + 1;
            });
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
