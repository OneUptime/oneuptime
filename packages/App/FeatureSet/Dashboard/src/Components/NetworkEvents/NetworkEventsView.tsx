import NetworkEventAlertsModal from "./NetworkEventAlertsModal";
import { getNetworkEventTitle } from "./NetworkEventCopy";
import NetworkEventDetails from "./NetworkEventDetails";
import NetworkEventSourcesCard from "./NetworkEventSourcesCard";
import {
  NETWORK_EVENTS_LOOKBACK_IN_DAYS,
  NetworkEventsBackground,
  NetworkEventsPage,
  fetchNetworkEventSources,
  fetchNetworkEvents,
  fetchNetworkEventsBackground,
} from "./NetworkEventsApi";
import {
  NETWORK_EVENTS_PAGE_LIMIT,
  NetworkEventFacetValue,
  NetworkEventRow,
  NetworkEventSource,
  NetworkEventsFilters,
  NetworkEventsScope,
} from "./NetworkEventsModel";
import { getNetworkEventsDocsUrl } from "./NetworkEventsSetup";
import NetworkEventsTimeline from "./NetworkEventsTimeline";
import {
  NetworkEventsViewState,
  hasNetworkEventsFilters,
  readNetworkEventsView,
  toNetworkEventsUrlParams,
} from "./NetworkEventsUrlState";
import SyslogSetupGuide from "./SyslogSetupGuide";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Route from "Common/Types/API/Route";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import IconProp from "Common/Types/Icon/IconProp";
import { NetworkEventKind } from "Common/Types/NetworkEvent/NetworkEventType";
import ObjectID from "Common/Types/ObjectID";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import NetworkDeviceOtherAddressesUtil from "Common/Utils/NetworkDevice/NetworkDeviceOtherAddresses";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import {
  formatFeedTimeAgo,
  getFeedClock,
} from "Common/UI/Components/Feed/FeedTime";
import FilterButtons, {
  FilterButtonOption,
} from "Common/UI/Components/FilterButtons/FilterButtons";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import {
  getFilteredEmptyStateProps,
  getLoadErrorStateProps,
} from "Common/UI/Components/Table/TableEmptyStateBuilders";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * THE EVENTS PAGE - a device's, or the whole network's.
 *
 * What the devices reported, newest first: links going down and coming
 * back, tunnels, failovers, restarts, sign-ins - read out of each vendor's
 * syslog (and the standard SNMP traps) into one vocabulary, so a row says
 * "Interface down" whoever made the device. The buttons over the list
 * narrow it to problems, recoveries or information; the pickers to one
 * event or one device. A row opens what the device said, word for word,
 * with one click to be told the next time it happens.
 *
 * The time range and the filters live in the URL, so a link lands on
 * exactly this view.
 *
 * Before anything has arrived the page is the set-up guide instead
 * (SyslogSetupGuide). In between - syslog is arriving, but none of it is an
 * event; or there are events, just not in this range - the page says which,
 * and what to do about it, the way an empty table does (TableEmptyState).
 *
 * The list itself is a timeline (NetworkEventsTimeline), and a row opens
 * NetworkEventDetails.
 *
 * Events are logs: this page reads them through the logs' own endpoints
 * (NetworkEventsApi), and everything on it can also be searched, charted
 * and alerted on from Logs.
 */

export interface NetworkEventsDeviceInfo {
  name?: string | undefined;
  hostname?: string | undefined;
  otherAddresses?: string | undefined;
  probeName?: string | undefined;
  isGlobalProbe?: boolean | undefined;
  /*
   * Who made the device, as far as OneUptime knows: its Vendor and its
   * system description. Opens the set-up guide on that maker's steps.
   */
  vendor?: string | undefined;
}

export interface ComponentProps {
  scope: NetworkEventsScope;
  // A device's page: its name, and what its set-up guide says.
  device?: NetworkEventsDeviceInfo | undefined;
}

// How many rows are shown at first, and how many more each "Show more" adds.
export const NETWORK_EVENTS_ROWS_STEP: number = 50;

/*
 * How often a page that is still its set-up guide looks for the first
 * message, so the guide turns into the list by itself.
 */
export const NETWORK_EVENTS_SETUP_POLL_IN_MS: number = 15_000;

const ALL_KINDS: string = "all";

// What the list is a list of, for the sentences an empty or failed one says.
const EVENTS_PLURAL_LABEL: string = translationKey("Events");

/*
 * A picker beside the kind buttons: a fixed width where the row is its
 * own, and between 11 and 15rem where it shares the buttons' line.
 */
const PICKER_CLASS_NAME: string =
  "sm:w-56 xl:w-auto xl:min-w-[11rem] xl:max-w-[15rem] xl:flex-1";

// A link drawn as the page's plain buttons are.
const OPEN_LOGS_LINK_CLASS_NAME: string =
  "inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

// What the kind buttons say, looked up where they are drawn.
const KIND_FILTER_LABELS: {
  all: string;
  problems: string;
  recoveries: string;
  information: string;
} = {
  all: translationKey("All"),
  problems: translationKey("Problems"),
  recoveries: translationKey("Recoveries"),
  information: translationKey("Informational"),
};

const NetworkEventsView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const scope: NetworkEventsScope = props.scope;
  const isDevice: boolean = scope.kind === "device";
  const scopeKey: string =
    scope.kind === "device" ? scope.networkDeviceId : "network";

  const [view, setView] = useState<NetworkEventsViewState>(
    (): NetworkEventsViewState => {
      return readNetworkEventsView((name: string): string | null => {
        return Navigation.getQueryStringByName(name);
      }, scope);
    },
  );
  /*
   * The view the rows on the page are of. The pickers show what was asked
   * for at once; this follows when the answer arrives - and stays behind
   * when it does not, so a failed request never dresses old rows in new
   * filters.
   */
  const [shownView, setShownView] = useState<NetworkEventsViewState>(view);
  const [page, setPage] = useState<NetworkEventsPage | null>(null);
  const [background, setBackground] = useState<NetworkEventsBackground | null>(
    null,
  );
  const [sources, setSources] = useState<Array<NetworkEventSource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [visibleCount, setVisibleCount] = useState<number>(
    NETWORK_EVENTS_ROWS_STEP,
  );
  const [selected, setSelected] = useState<NetworkEventRow | null>(null);
  const [showAlerts, setShowAlerts] = useState<boolean>(false);

  // The request the page is waiting for: an answer to an older one is dropped.
  const requestSequence: React.MutableRefObject<number> = useRef<number>(0);

  /*
   * `quiet` is the set-up guide looking for the first message on its own:
   * nothing on the page moves unless something arrived, and a look that
   * fails is simply tried again.
   */
  const load: (
    next: NetworkEventsViewState,
    options?: { quiet?: boolean | undefined },
  ) => Promise<void> = useCallback(
    async (
      next: NetworkEventsViewState,
      options?: { quiet?: boolean | undefined },
    ): Promise<void> => {
      const isQuiet: boolean = Boolean(options?.quiet);
      const sequence: number = ++requestSequence.current;
      const isCurrent: () => boolean = (): boolean => {
        return requestSequence.current === sequence;
      };

      if (!isQuiet) {
        setIsLoading(true);
        setError("");
      }

      try {
        // Resolved now, so a preset range ("Past 1 Day") ends at this moment.
        const window: InBetween<Date> =
          RangeStartAndEndDateTimeUtil.getStartAndEndDate(next.range);

        const [eventsPage, eventSources]: [
          NetworkEventsPage,
          Array<NetworkEventSource>,
        ] = await Promise.all([
          fetchNetworkEvents({
            scope: scope,
            filters: next.filters,
            window: window,
          }),
          // Who else is sending: a help, never a reason to fail the page.
          scope.kind === "network"
            ? fetchNetworkEventSources(window).catch(
                (): Array<NetworkEventSource> => {
                  return [];
                },
              )
            : Promise.resolve([]),
        ]);

        if (!isCurrent()) {
          return;
        }

        let nextBackground: NetworkEventsBackground | null = null;

        /*
         * Nothing in the range, and nothing was filtered out: find out
         * why, so the page can say more than "nothing".
         */
        if (
          eventsPage.rows.length === 0 &&
          eventsPage.counts.total === 0 &&
          !next.filters.event &&
          !next.filters.device
        ) {
          /*
           * Not knowing is not the same as knowing there is nothing: a
           * look that fails leaves the page saying only what it knows,
           * never the set-up guide of someone whose devices already report.
           */
          nextBackground = await fetchNetworkEventsBackground(scope).catch(
            (): null => {
              return null;
            },
          );

          if (!isCurrent()) {
            return;
          }
        }

        setPage(eventsPage);
        setSources(eventSources);
        setBackground(nextBackground);
        setShownView(next);
        setVisibleCount(NETWORK_EVENTS_ROWS_STEP);
      } catch (err) {
        if (isCurrent() && !isQuiet) {
          setError(API.getFriendlyMessage(err));
        }
      } finally {
        if (isCurrent() && !isQuiet) {
          setIsLoading(false);
        }
      }
    },
    [scopeKey],
  );

  useEffect(() => {
    load(view).catch(() => {
      // handled inside.
    });
  }, [scopeKey]);

  const applyView: (next: NetworkEventsViewState) => void = (
    next: NetworkEventsViewState,
  ): void => {
    setView(next);
    Navigation.setQueryString(toNetworkEventsUrlParams(next));
    load(next).catch(() => {
      // handled inside.
    });
  };

  const setFilters: (filters: NetworkEventsFilters) => void = (
    filters: NetworkEventsFilters,
  ): void => {
    applyView({ range: view.range, filters: filters });
  };

  const createButton: CardButtonSchema | null = PermissionGate.gateCardButton(
    {
      title: "Create alert",
      onClick: () => {
        setShowAlerts(true);
      },
      buttonStyle: ButtonStyleType.NORMAL,
      icon: IconProp.Bell,
    },
    new Monitor(),
    ModelAction.Create,
  );

  /*
   * The gate can hand back a locked button (disabled, with a tooltip naming
   * the missing permission) instead of none. A locked button is not
   * permission to create.
   */
  const canCreateAlert: boolean = Boolean(
    createButton && !createButton.disabled,
  );

  // A failed request leaves the rows of the last one that worked.
  const hasLoaded: boolean = page !== null;
  const counts: NetworkEventsPage["counts"] | undefined = page?.counts;
  /*
   * The counts are a second request, and one that answers with nothing
   * when it cannot be made in time: rows on the page are events in the
   * range whatever the counts say.
   */
  const hasEventsInRange: boolean = Boolean(
    page && (page.counts.total > 0 || page.rows.length > 0),
  );
  // Of the rows on the page, which may be a request behind the pickers.
  const hasFilters: boolean = hasNetworkEventsFilters(shownView.filters);

  /*
   * Nothing has ever arrived: the page is the set-up guide. (Only once the
   * page knows - while it is still asking for the first time, it shows the
   * loader.)
   */
  const showSetupGuide: boolean =
    hasLoaded &&
    !hasEventsInRange &&
    !hasFilters &&
    Boolean(background) &&
    !background?.lastEventAt &&
    !background?.isReceivingLogs;

  /*
   * The set-up guide waits for the first message by itself: someone who has
   * just pasted the lines into a device sees the page turn into its events
   * without touching it. Only while the tab is looked at.
   */
  useEffect(() => {
    if (!showSetupGuide) {
      return;
    }

    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }

      load(view, { quiet: true }).catch(() => {
        // handled inside.
      });
    }, NETWORK_EVENTS_SETUP_POLL_IN_MS);

    return () => {
      clearInterval(timer);
    };
  }, [showSetupGuide, scopeKey]);

  const kindOptions: Array<FilterButtonOption> = [
    { label: KIND_FILTER_LABELS.all, value: ALL_KINDS, badge: counts?.total },
    {
      label: KIND_FILTER_LABELS.problems,
      value: NetworkEventKind.Problem,
      badge: counts?.byKind[NetworkEventKind.Problem],
    },
    {
      label: KIND_FILTER_LABELS.recoveries,
      value: NetworkEventKind.Recovery,
      badge: counts?.byKind[NetworkEventKind.Recovery],
    },
    {
      label: KIND_FILTER_LABELS.information,
      value: NetworkEventKind.Info,
      badge: counts?.byKind[NetworkEventKind.Info],
    },
  ];

  const eventOptions: Array<DropdownOption> = (counts?.events || []).map(
    (event: NetworkEventFacetValue): DropdownOption => {
      return {
        value: event.value,
        label: `${getNetworkEventTitle(event.value, translator)} (${translator.formatNumber(event.count)})`,
      };
    },
  );

  // A filter that is set stays in its picker even when the range has none of it.
  if (
    view.filters.event &&
    !eventOptions.some((option: DropdownOption): boolean => {
      return option.value === view.filters.event;
    })
  ) {
    eventOptions.unshift({
      value: view.filters.event,
      label: getNetworkEventTitle(view.filters.event, translator),
    });
  }

  const deviceOptions: Array<DropdownOption> = (counts?.devices || []).map(
    (device: NetworkEventFacetValue): DropdownOption => {
      return {
        value: device.value,
        label: `${device.value} (${translator.formatNumber(device.count)})`,
      };
    },
  );

  if (
    view.filters.device &&
    !deviceOptions.some((option: DropdownOption): boolean => {
      return option.value === view.filters.device;
    })
  ) {
    deviceOptions.unshift({
      value: view.filters.device,
      label: view.filters.device,
    });
  }

  const rows: Array<NetworkEventRow> = page?.rows || [];
  const visibleRows: Array<NetworkEventRow> = rows.slice(0, visibleCount);

  const deviceLogsRoute: Route | undefined =
    scope.kind === "device"
      ? RouteUtil.populateRouteParams(
          RouteMap[PageMap.NETWORK_DEVICE_VIEW_LOGS] as Route,
          { modelId: new ObjectID(scope.networkDeviceId) },
        )
      : undefined;

  const logsRoute: Route =
    deviceLogsRoute ||
    RouteUtil.populateRouteParams(RouteMap[PageMap.LOGS] as Route);

  /*
   * Nothing in the range and nothing picked: there is nothing to narrow,
   * and the buttons and pickers would only stand over an empty page.
   */
  const showFilters: boolean =
    hasEventsInRange || hasFilters || hasNetworkEventsFilters(view.filters);

  const translateOrKeep: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const renderEmptyState: () => ReactElement = (): ReactElement => {
    // Something is filtered out: say so, with the way back.
    if (hasFilters) {
      return (
        <TableEmptyState
          {...getFilteredEmptyStateProps({
            title: "No events match these filters",
            description:
              "Nothing in this time range is of the kind, event and device picked above.",
            onClear: () => {
              setFilters({});
            },
          })}
          icon={IconProp.Filter}
          dataTestId="network-events-empty-filtered"
        />
      );
    }

    // The range has nothing, and why could not be found out.
    if (!background) {
      return (
        <TableEmptyState
          kind={TableEmptyStateKind.Empty}
          icon={IconProp.Clock}
          title="No events in this time range"
          description="Nothing was reported in this time range. Pick a longer one to look further back."
          dataTestId="network-events-empty-unknown"
        />
      );
    }

    // There are events, just not in this range.
    if (background.lastEventAt) {
      const lastEventAgo: string | undefined = formatFeedTimeAgo(
        new Date(background.lastEventAt),
        getFeedClock({ language: translator.language }),
      );

      return (
        <TableEmptyState
          kind={TableEmptyStateKind.Empty}
          icon={IconProp.Clock}
          title="No events in this time range"
          description={
            lastEventAgo
              ? translator.translateTemplate("The last one was {{time}}.", {
                  time: lastEventAgo,
                })
              : undefined
          }
          actions={[
            {
              title: "Show the past week",
              dataTestId: "network-events-show-week",
              onClick: () => {
                applyView({
                  range: { range: TimeRange.PAST_ONE_WEEK },
                  filters: shownView.filters,
                });
              },
            },
          ]}
          dataTestId="network-events-empty-range"
        />
      );
    }

    // Syslog is arriving, but none of it is an event.
    return (
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        icon={IconProp.Logs}
        title={
          isDevice
            ? "This device's syslog is arriving, but none of it is an event yet"
            : "Syslog is arriving, but none of it is an event yet"
        }
        description={translator.translateTemplate(
          "Nothing in the last {{days}} days was something OneUptime reads as an event: a link, a tunnel, a failover, a restart, a sign-in. Every message is still stored. See them in Logs, or name the events of a format OneUptime does not know in a log pipeline.",
          { days: NETWORK_EVENTS_LOOKBACK_IN_DAYS },
        )}
        // Real links, so they open in a new tab like any other.
        actionElement={
          <Fragment>
            <AppLink to={logsRoute} className={OPEN_LOGS_LINK_CLASS_NAME}>
              {translator.translateText("Open Logs") || ""}
            </AppLink>
            <Link
              to={getNetworkEventsDocsUrl()}
              openInNewTab={true}
              className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-indigo-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              <>
                {translator.translateText("How to name your own events")}
                <Icon
                  icon={IconProp.ExternalLink}
                  className="h-3.5 w-3.5 flex-shrink-0"
                />
              </>
            </Link>
          </Fragment>
        }
        dataTestId="network-events-empty-unrecognized"
      />
    );
  };

  const rangeElement: ReactElement = (
    <div className="flex items-center gap-2">
      <RangeStartAndEndDateView
        dashboardStartAndEndDate={view.range}
        onChange={(range: RangeStartAndEndDateTime) => {
          applyView({ range: range, filters: view.filters });
        }}
      />
      <Button
        title=""
        ariaLabel="Refresh"
        tooltip="Refresh"
        icon={IconProp.Refresh}
        buttonStyle={ButtonStyleType.ICON}
        dataTestId="network-events-refresh"
        onClick={() => {
          load(view).catch(() => {
            // handled inside.
          });
        }}
      />
    </div>
  );

  return (
    <div data-testid="network-events-view">
      <Card
        title="Events"
        description={
          isDevice
            ? "What this device reported, newest first: links, tunnels, failovers, restarts and sign-ins, read out of its syslog and its traps."
            : "What your devices reported, newest first: links, tunnels, failovers, restarts and sign-ins, read out of every vendor's syslog and traps into the same words."
        }
        buttons={createButton && !showSetupGuide ? [createButton] : []}
        rightElement={showSetupGuide ? undefined : rangeElement}
        /*
         * The description runs under the title and the actions, across the
         * card: beside a range picker, Refresh and Create alert it was
         * squeezed into a column a few words wide on a tablet.
         */
        headerLayout="stacked"
      >
        {!hasLoaded && isLoading ? <ComponentLoader /> : <></>}

        {/*
         * The first read failed: what failed, the server's reason and a way
         * to try again, as a table that could not load says it.
         */}
        {!hasLoaded && !isLoading && error ? (
          <TableEmptyState
            {...getLoadErrorStateProps({
              pluralLabel: EVENTS_PLURAL_LABEL,
              error: error,
              onRetry: () => {
                load(view).catch(() => {
                  // handled inside.
                });
              },
              translate: translateOrKeep,
              translator: translator,
            })}
            dataTestId="network-events-error"
          />
        ) : (
          <></>
        )}

        {hasLoaded && error ? (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
            data-testid="network-events-refresh-error"
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

        {showSetupGuide ? (
          <SyslogSetupGuide
            scope={isDevice ? "device" : "network"}
            isWaiting={true}
            probeName={props.device?.probeName}
            isGlobalProbe={props.device?.isGlobalProbe}
            deviceVendor={props.device?.vendor}
            matchAddresses={
              props.device
                ? [
                    ...(props.device.hostname ? [props.device.hostname] : []),
                    ...NetworkDeviceOtherAddressesUtil.parse(
                      props.device.otherAddresses,
                    ).addresses,
                  ]
                : undefined
            }
            settingsRoute={
              scope.kind === "device"
                ? RouteUtil.populateRouteParams(
                    RouteMap[PageMap.NETWORK_DEVICE_VIEW_SETTINGS] as Route,
                    { modelId: new ObjectID(scope.networkDeviceId) },
                  )
                : undefined
            }
          />
        ) : (
          <></>
        )}

        {page && !showSetupGuide ? (
          <div
            className={isLoading ? "opacity-60 transition-opacity" : ""}
            aria-busy={isLoading}
          >
            {showFilters ? (
              /*
               * One line from xl up: what kind on the left, which event and
               * which device on the right. The kind buttons keep their
               * width; the pickers take what is left, and go under the
               * buttons when a language's words leave them too little.
               */
              <div
                className="flex flex-col gap-3 xl:flex-row xl:flex-wrap xl:items-center xl:justify-between"
                data-testid="network-events-filters"
              >
                <FilterButtons
                  options={kindOptions}
                  selectedValue={view.filters.kind || ALL_KINDS}
                  onSelect={(value: string) => {
                    setFilters({
                      ...view.filters,
                      kind:
                        value === ALL_KINDS
                          ? undefined
                          : (value as NetworkEventKind),
                    });
                  }}
                  className="flex-wrap xl:flex-shrink-0 xl:flex-nowrap"
                />
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row xl:flex-1 xl:justify-end">
                  <div className={PICKER_CLASS_NAME}>
                    <Dropdown
                      options={eventOptions}
                      value={eventOptions.find(
                        (option: DropdownOption): boolean => {
                          return option.value === view.filters.event;
                        },
                      )}
                      placeholder="All events"
                      ariaLabel="Event"
                      dataTestId="network-events-event-filter"
                      onChange={(
                        value: DropdownValue | Array<DropdownValue> | null,
                      ) => {
                        setFilters({
                          ...view.filters,
                          event: value ? String(value) : undefined,
                        });
                      }}
                    />
                  </div>
                  {isDevice ? (
                    <></>
                  ) : (
                    <div className={PICKER_CLASS_NAME}>
                      <Dropdown
                        options={deviceOptions}
                        value={deviceOptions.find(
                          (option: DropdownOption): boolean => {
                            return option.value === view.filters.device;
                          },
                        )}
                        placeholder="All devices"
                        ariaLabel="Device"
                        dataTestId="network-events-device-filter"
                        onChange={(
                          value: DropdownValue | Array<DropdownValue> | null,
                        ) => {
                          setFilters({
                            ...view.filters,
                            device: value ? String(value) : undefined,
                          });
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <></>
            )}

            {rows.length === 0 ? (
              renderEmptyState()
            ) : (
              <Fragment>
                <NetworkEventsTimeline
                  rows={visibleRows}
                  showDevice={!isDevice}
                  onOpen={setSelected}
                  openRowId={selected?.id}
                />
                {rows.length > visibleCount ? (
                  <div className="mt-1 flex justify-center border-t border-gray-100 pt-4">
                    <Button
                      title="Show more"
                      buttonStyle={ButtonStyleType.NORMAL}
                      buttonSize={ButtonSize.Small}
                      dataTestId="network-events-show-more"
                      onClick={() => {
                        setVisibleCount(
                          visibleCount + NETWORK_EVENTS_ROWS_STEP,
                        );
                      }}
                    />
                  </div>
                ) : page.hasMore ? (
                  <p
                    className="mt-1 border-t border-gray-100 pt-4 text-center text-xs text-gray-500"
                    data-testid="network-events-more-note"
                  >
                    {translator.translateTemplate(
                      "These are the newest {{count}} events of this time range. Shorten the range or pick a filter to see older ones.",
                      {
                        count: translator.formatNumber(
                          NETWORK_EVENTS_PAGE_LIMIT,
                        ),
                      },
                    )}
                  </p>
                ) : (
                  <></>
                )}
              </Fragment>
            )}
          </div>
        ) : (
          <></>
        )}
      </Card>

      {isDevice || showSetupGuide ? (
        <></>
      ) : (
        <NetworkEventSourcesCard
          sources={sources}
          onLinked={() => {
            load(view).catch(() => {
              // handled inside.
            });
          }}
        />
      )}

      {selected ? (
        <NetworkEventDetails
          row={selected}
          canCreateAlert={canCreateAlert}
          alertDeviceId={
            scope.kind === "device" ? scope.networkDeviceId : undefined
          }
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : (
        <></>
      )}

      {showAlerts ? (
        <NetworkEventAlertsModal
          canCreate={canCreateAlert}
          device={
            scope.kind === "device"
              ? {
                  id: scope.networkDeviceId,
                  name: props.device?.name || "",
                }
              : undefined
          }
          onClose={() => {
            setShowAlerts(false);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default NetworkEventsView;
