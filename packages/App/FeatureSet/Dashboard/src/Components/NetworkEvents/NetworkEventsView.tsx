import NetworkEventAlertsModal from "./NetworkEventAlertsModal";
import {
  NETWORK_EVENT_KIND_TITLES,
  NetworkEventCopy,
  getNetworkEventCopy,
} from "./NetworkEventCopy";
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
  NetworkEventSubject,
  NetworkEventsFilters,
  NetworkEventsScope,
  getNetworkEventDetailAttributes,
} from "./NetworkEventsModel";
import { getNetworkEventsDocsUrl } from "./NetworkEventsSetup";
import {
  NetworkEventsViewState,
  hasNetworkEventsFilters,
  readNetworkEventsView,
  toNetworkEventsUrlParams,
} from "./NetworkEventsUrlState";
import SyslogSetupGuide from "./SyslogSetupGuide";
import {
  NetworkQuickAction,
  getNetworkQuickActionRoute,
} from "../Network/NetworkQuickActions";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { getNetworkEventAlertRoute } from "../../Utils/NetworkEventMonitorPrefill";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Route from "Common/Types/API/Route";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
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
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FilterButtons, {
  FilterButtonOption,
} from "Common/UI/Components/FilterButtons/FilterButtons";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import SideOver, { SideOverSize } from "Common/UI/Components/SideOver/SideOver";
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
 * and what to do about it.
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

// The names of what an event's details list, looked up where they are drawn.
const FACT_LABELS: {
  when: string;
  device: string;
  kind: string;
  reportedAs: string;
  sentFrom: string;
} = {
  when: translationKey("When"),
  device: translationKey("Device"),
  kind: translationKey("Kind"),
  reportedAs: translationKey("Reported as"),
  sentFrom: translationKey("Sent from"),
};

const CREATE_ALERT_FOR_EVENT: string = translationKey(
  "Create alert for this event",
);

const KIND_DOT_CLASS_NAMES: Record<NetworkEventKind, string> = {
  [NetworkEventKind.Problem]: "bg-red-500",
  [NetworkEventKind.Recovery]: "bg-emerald-500",
  [NetworkEventKind.Info]: "bg-gray-300",
};

function getDeviceEventsRoute(networkDeviceId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_DEVICE_VIEW_EVENTS] as Route,
    { modelId: new ObjectID(networkDeviceId) },
  );
}

/*
 * What a row calls its event: the vocabulary's words for a built-in one,
 * and its own name for one a project defined.
 */
export function getNetworkEventTitle(
  name: string,
  translator: Translator,
): string {
  const copy: NetworkEventCopy | null = getNetworkEventCopy(name);

  return copy ? translator.translateText(copy.title) || copy.title : name;
}

const SubjectText: FunctionComponent<{
  subject: NetworkEventSubject;
}> = (props: { subject: NetworkEventSubject }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span className="text-sm text-gray-500" data-testid="network-event-subject">
      {translator.translateText(props.subject.label)}{" "}
      <span className="font-medium text-gray-800">{props.subject.value}</span>
    </span>
  );
};

const UnknownSourceBadge: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span
      className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200"
      data-testid="network-event-unknown-source"
    >
      {translator.translateText("Not a device yet")}
    </span>
  );
};

export const NetworkEventRowItem: FunctionComponent<{
  row: NetworkEventRow;
  // On one device's page every row is that device's: it is not named again.
  showDevice: boolean;
  onOpen: (row: NetworkEventRow) => void;
}> = (props: {
  row: NetworkEventRow;
  showDevice: boolean;
  onOpen: (row: NetworkEventRow) => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const row: NetworkEventRow = props.row;
  const title: string = getNetworkEventTitle(row.name, translator);

  return (
    <li
      className="relative flex items-start gap-3 rounded-md px-2 py-3 hover:bg-gray-50"
      data-testid="network-event-row"
      data-event-name={row.name}
      data-event-kind={row.kind}
    >
      <span
        className={`mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ${KIND_DOT_CLASS_NAMES[row.kind]}`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {/*
           * The row's one control. Its ::after covers the whole row, so a
           * click anywhere on the row opens it, while the row stays a list
           * item and the device's link stays a link of its own.
           */}
          <button
            type="button"
            className="text-left text-sm font-semibold text-gray-900 after:absolute after:inset-0 after:rounded-md after:content-[''] focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-indigo-500"
            aria-haspopup="dialog"
            onClick={() => {
              props.onOpen(row);
            }}
            data-testid="network-event-open"
          >
            {title}
          </button>
          <span className="sr-only">
            {translator.translateText(NETWORK_EVENT_KIND_TITLES[row.kind])}
          </span>
          {props.showDevice && row.device ? (
            row.networkDeviceId ? (
              // Above the row's control, so the link goes to the device.
              <span className="relative z-10">
                <AppLink
                  to={getDeviceEventsRoute(row.networkDeviceId)}
                  className="text-sm font-medium text-gray-700 hover:text-indigo-600 hover:underline"
                >
                  {row.device}
                </AppLink>
              </span>
            ) : (
              <span className="font-mono text-sm text-gray-700">
                {row.device}
              </span>
            )
          ) : (
            <></>
          )}
          {row.subject ? <SubjectText subject={row.subject} /> : <></>}
          {props.showDevice && row.isFromUnknownSource ? (
            <UnknownSourceBadge />
          ) : (
            <></>
          )}
        </div>
        {row.message ? (
          <div
            className="mt-0.5 truncate font-mono text-xs text-gray-500"
            title={row.message}
            data-testid="network-event-message"
          >
            {row.message}
          </div>
        ) : (
          <></>
        )}
      </div>
      <div
        className="flex-shrink-0 whitespace-nowrap pt-0.5 text-right text-xs text-gray-500"
        title={
          row.time ? OneUptimeDate.getDateAsLocalFormattedString(row.time) : ""
        }
        data-testid="network-event-time"
      >
        {row.time ? OneUptimeDate.fromNow(row.time) : ""}
      </div>
    </li>
  );
};

/*
 * What the device said, word for word, and what OneUptime read out of it.
 */
export const NetworkEventDetails: FunctionComponent<{
  row: NetworkEventRow;
  canCreateAlert: boolean;
  // Set on one device's page: an alert made here is for that device only.
  alertDeviceId?: string | undefined;
  onClose: () => void;
}> = (props: {
  row: NetworkEventRow;
  canCreateAlert: boolean;
  alertDeviceId?: string | undefined;
  onClose: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const row: NetworkEventRow = props.row;
  const copy: NetworkEventCopy | null = getNetworkEventCopy(row.name);

  const facts: Array<{ label: string; value: ReactElement | string }> = [];

  if (row.time) {
    facts.push({
      label: FACT_LABELS.when,
      value: `${OneUptimeDate.getDateAsLocalFormattedString(row.time)} (${OneUptimeDate.fromNow(row.time)})`,
    });
  }

  if (row.device) {
    facts.push({
      label: FACT_LABELS.device,
      value: row.networkDeviceId ? (
        <AppLink
          to={getDeviceEventsRoute(row.networkDeviceId)}
          className="font-medium text-indigo-600 hover:underline"
        >
          {row.device}
        </AppLink>
      ) : (
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="font-mono">{row.device}</span>
          {row.isFromUnknownSource ? <UnknownSourceBadge /> : <></>}
        </span>
      ),
    });
  }

  for (const subject of row.subject ? [row.subject, ...row.details] : []) {
    facts.push({ label: subject.label, value: subject.value });
  }

  facts.push({
    label: FACT_LABELS.kind,
    value: translator.translateText(NETWORK_EVENT_KIND_TITLES[row.kind]) || "",
  });

  facts.push({
    label: FACT_LABELS.reportedAs,
    value: row.isSnmpTrap
      ? translator.translateText("SNMP trap") || ""
      : row.vendor
        ? translator.translateTemplate("Syslog, {{vendor}} format", {
            vendor: row.vendor,
          })
        : translator.translateText("Syslog") || "",
  });

  if (row.sourceIp && row.sourceIp !== row.device) {
    facts.push({ label: FACT_LABELS.sentFrom, value: row.sourceIp });
  }

  const alertRoute: Route = getNetworkEventAlertRoute(
    row.name,
    props.alertDeviceId,
  );

  return (
    <SideOver
      title={getNetworkEventTitle(row.name, translator)}
      description={
        copy
          ? copy.description
          : translator.translateTemplate(
              "An event your project named in a log pipeline: {{name}}.",
              { name: row.name },
            )
      }
      onClose={props.onClose}
      size={SideOverSize.Medium}
      {...(props.canCreateAlert
        ? {
            submitButtonText: CREATE_ALERT_FOR_EVENT,
            onSubmit: () => {
              Navigation.navigate(alertRoute);
            },
          }
        : {})}
      leftFooterElement={
        row.isFromUnknownSource && row.sourceIp ? (
          <Button
            title="Add as device"
            icon={IconProp.Add}
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.NORMAL}
            dataTestId="network-event-details-add-device"
            onClick={() => {
              Navigation.navigate(
                getNetworkQuickActionRoute(NetworkQuickAction.AddDevice, {
                  address: row.sourceIp || "",
                  probeId: row.probeId,
                }),
              );
            }}
          />
        ) : undefined
      }
    >
      <div className="space-y-6" data-testid="network-event-details">
        <dl className="divide-y divide-gray-100">
          {facts.map(
            (fact: {
              label: string;
              value: ReactElement | string;
            }): ReactElement => {
              return (
                <div
                  key={fact.label}
                  className="flex gap-4 py-2 text-sm"
                  data-testid="network-event-fact"
                >
                  <dt className="w-28 flex-shrink-0 text-gray-500">
                    {translator.translateText(fact.label)}
                  </dt>
                  <dd className="min-w-0 flex-1 break-words text-gray-900">
                    {fact.value}
                  </dd>
                </div>
              );
            },
          )}
        </dl>

        {row.message ? (
          <div>
            <div className="text-sm font-medium text-gray-900">
              {translator.translateText("What the device said")}
            </div>
            <pre
              className="mt-2 whitespace-pre-wrap break-words rounded-md bg-gray-50 p-3 font-mono text-xs text-gray-800 ring-1 ring-gray-200"
              data-testid="network-event-details-message"
            >
              {row.message}
            </pre>
          </div>
        ) : (
          <></>
        )}

        <div>
          <div className="text-sm font-medium text-gray-900">
            {translator.translateText("What was read out of it")}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {translator.translateText(
              "The attributes stored on this log. Search, chart or alert on any of them from Logs.",
            )}
          </p>
          <dl
            className="mt-2 divide-y divide-gray-100 rounded-md ring-1 ring-gray-200"
            data-testid="network-event-details-attributes"
          >
            {getNetworkEventDetailAttributes(row).map(
              (attribute: { key: string; value: string }): ReactElement => {
                return (
                  <div
                    key={attribute.key}
                    className="flex flex-col gap-0.5 px-3 py-1.5 text-xs sm:flex-row sm:gap-3"
                  >
                    <dt className="font-mono text-gray-500 sm:w-56 sm:flex-shrink-0">
                      {attribute.key}
                    </dt>
                    <dd className="min-w-0 flex-1 break-words font-mono text-gray-900">
                      {attribute.value}
                    </dd>
                  </div>
                );
              },
            )}
          </dl>
        </div>
      </div>
    </SideOver>
  );
};

// What a page with nothing in its range says instead of an empty list.
export const NetworkEventsEmptyState: FunctionComponent<{
  icon: IconProp;
  title: string;
  description: string | ReactElement;
  action?: ReactElement | undefined;
  testId: string;
}> = (props: {
  icon: IconProp;
  title: string;
  description: string | ReactElement;
  action?: ReactElement | undefined;
  testId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="px-4 py-12 text-center" data-testid={props.testId}>
      <Icon icon={props.icon} className="mx-auto h-10 w-10 text-gray-400" />
      <h3 className="mt-3 text-sm font-semibold text-gray-900">
        {translator.translateText(props.title)}
      </h3>
      <p className="mx-auto mt-1 max-w-xl text-sm leading-6 text-gray-500">
        {typeof props.description === "string"
          ? translator.translateText(props.description)
          : props.description}
      </p>
      {props.action ? (
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {props.action}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
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

  const renderEmptyState: () => ReactElement = (): ReactElement => {
    // Something is filtered out: say so, with the way back.
    if (hasFilters) {
      return (
        <NetworkEventsEmptyState
          testId="network-events-empty-filtered"
          icon={IconProp.Filter}
          title="No events match these filters"
          description="Nothing in this time range is of the kind, event and device picked above."
          action={
            <Button
              title="Clear filters"
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              dataTestId="network-events-clear-filters"
              onClick={() => {
                setFilters({});
              }}
            />
          }
        />
      );
    }

    // The range has nothing, and why could not be found out.
    if (!background) {
      return (
        <NetworkEventsEmptyState
          testId="network-events-empty-unknown"
          icon={IconProp.Clock}
          title="No events in this time range"
          description="Nothing was reported in this time range. Pick a longer one to look further back."
        />
      );
    }

    // There are events, just not in this range.
    if (background.lastEventAt) {
      return (
        <NetworkEventsEmptyState
          testId="network-events-empty-range"
          icon={IconProp.Clock}
          title="No events in this time range"
          description={translator.translateTemplate(
            "The last one was {{time}}.",
            { time: OneUptimeDate.fromNow(background.lastEventAt) },
          )}
          action={
            <Button
              title="Show the past week"
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              dataTestId="network-events-show-week"
              onClick={() => {
                applyView({
                  range: { range: TimeRange.PAST_ONE_WEEK },
                  filters: shownView.filters,
                });
              }}
            />
          }
        />
      );
    }

    // Syslog is arriving, but none of it is an event.
    return (
      <NetworkEventsEmptyState
        testId="network-events-empty-unrecognized"
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
        action={
          <Fragment>
            <AppLink
              to={logsRoute}
              className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline"
            >
              {translator.translateText("Open Logs") || ""}
            </AppLink>
            <Link
              to={getNetworkEventsDocsUrl()}
              openInNewTab={true}
              className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline"
            >
              <>
                {translator.translateText("How to name your own events")}
                <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
              </>
            </Link>
          </Fragment>
        }
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
      >
        {!hasLoaded && isLoading ? <ComponentLoader /> : <></>}

        {!hasLoaded && !isLoading && error ? (
          <ErrorMessage message={error} />
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
            <div
              className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
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
                className="flex-wrap"
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="sm:w-64">
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
                  <div className="sm:w-64">
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

            {rows.length === 0 ? (
              renderEmptyState()
            ) : (
              <Fragment>
                <ul
                  className="mt-4 divide-y divide-gray-100"
                  data-testid="network-events-list"
                >
                  {visibleRows.map((row: NetworkEventRow): ReactElement => {
                    return (
                      <NetworkEventRowItem
                        key={row.id}
                        row={row}
                        showDevice={!isDevice}
                        onOpen={setSelected}
                      />
                    );
                  })}
                </ul>
                {rows.length > visibleCount ? (
                  <div className="mt-4 flex justify-center">
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
                    className="mt-4 text-center text-xs text-gray-500"
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
