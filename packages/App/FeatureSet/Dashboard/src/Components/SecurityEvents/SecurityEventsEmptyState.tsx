import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useState,
} from "react";
import SecurityLogSource from "Common/Models/DatabaseModels/SecurityLogSource";
import { Green500 } from "Common/Types/BrandColors";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { SecurityEventConnectorCategories } from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import {
  SECURITY_LOG_FORMATS,
  SecurityLogFormatDefinition,
} from "Common/Types/SecurityEvent/SecurityLogFormat";
import Icon from "Common/UI/Components/Icon/Icon";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslateValue from "Common/UI/Utils/Translation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { SECURITY_LOG_FORMAT_TEXTS } from "./SecurityConnectionsCopy";
import {
  getYourLogsStatusLines,
  readProjectSecurityLogSource,
} from "./SecurityLogsSourceCard";

export const SECURITY_EVENTS_EMPTY_STATE_ID: string =
  "security-events-empty-state";

/*
 * The ingest route (Telemetry/API/SecurityEventsIngest.ts). It is part of
 * the API, not prose, so it is shown as code and never translated.
 */
export const SECURITY_EVENTS_INGEST_METHOD: string = "POST";
export const SECURITY_EVENTS_INGEST_PATH: string = "/security-events/v1/ingest";

export interface SecurityEventsWayIn {
  id: string;
  icon: IconProp;
  title: string;
  description: string;
  actionTitle: string;
}

export interface SecurityEventsLogsWayIn extends SecurityEventsWayIn {
  /*
   * Its action once the project's logs are read already - or when whether
   * they are could not be found out: Connections says how it stands.
   */
  openActionTitle: string;
}

/*
 * The first way in, the one with nothing to install: the logs the project
 * already sends OneUptime, read for sign-ins, sudo, cluster changes,
 * CloudTrail and web attacks ("Your logs", at the top of Connections). The
 * same words as that card and its switch, so the reader finds what they
 * were sent to.
 */
export const SECURITY_EVENTS_LOGS_WAY_IN: SecurityEventsLogsWayIn = {
  id: "logs",
  icon: IconProp.Logs,
  title: "Find security events in your logs",
  description:
    "Attacks often show up in the logs you already send OneUptime. Nothing to install.",
  actionTitle: "Turn on Your logs",
  openActionTitle: translationKey("Open Your logs"),
};

/*
 * The two ways in from other tools: have OneUptime poll a security product,
 * or push events to the ingest API. Neither is the "real" one - polling
 * needs nothing but a read-only credential, pushing nothing but an HTTP
 * client at the source - so the cards are the same size and weight, in the
 * order Connections and the docs give them: your logs, your security
 * tools, anything you send.
 */
export const SECURITY_EVENTS_WAYS_IN: Array<SecurityEventsWayIn> = [
  {
    id: "connect",
    icon: IconProp.Link,
    title: "Pull from a security product",
    description:
      "OneUptime polls Microsoft Sentinel, CrowdStrike, Splunk and more on a schedule.",
    actionTitle: "Connect a security product",
  },
  {
    id: "send",
    icon: IconProp.PaperAirplane,
    title: "Send events to OneUptime",
    description:
      "POST JSON from a SIEM, a SOAR webhook, a log forwarder or any other source.",
    actionTitle: "Read the setup guide",
  },
];

/*
 * Where the project's Your logs stands: not read yet, read and on, read and
 * off (or never turned on), or not known - the read failed.
 */
export type SecurityEventsLogsState = "reading" | "on" | "off" | "unknown";

export const getSecurityEventsLogsState: (data: {
  isRead: boolean;
  didReadFail: boolean;
  source: SecurityLogSource | null;
}) => SecurityEventsLogsState = (data: {
  isRead: boolean;
  didReadFail: boolean;
  source: SecurityLogSource | null;
}): SecurityEventsLogsState => {
  if (data.didReadFail) {
    return "unknown";
  }

  if (!data.isRead) {
    return "reading";
  }

  return data.source?.isEnabled === true ? "on" : "off";
};

/*
 * The Security Events table with nothing in it. That means "nothing is
 * sending yet" far more often than "nothing happened", and there are three
 * ways to start: the logs the project already sends (one switch, nothing to
 * install - so it leads, the width of the list), a security product
 * OneUptime polls (Connections), or events pushed to the ingest API (the
 * setup guide). Each gets a card of its own, so the choice reads as a
 * choice rather than as one long sentence.
 *
 * Your logs says where it stands: a project whose logs are read already,
 * and nothing in them yet, is told when they were last checked - not asked
 * to turn on what is on.
 *
 * Every card is one click target, through a stretched button; the endpoint
 * is raised above it so it can still be selected and copied.
 */
const SecurityEventsEmptyState: FunctionComponent = (): ReactElement => {
  const { translateString } = useTranslateValue();
  // For Your logs' own lines, as its card on Connections writes them.
  const translator: Translator = useTranslator();
  const [logSource, setLogSource] = useState<SecurityLogSource | null>(null);
  const [isLogSourceRead, setIsLogSourceRead] = useState<boolean>(false);
  const [didLogSourceReadFail, setDidLogSourceReadFail] =
    useState<boolean>(false);

  useEffect(() => {
    let isCurrent: boolean = true;

    readProjectSecurityLogSource()
      .then((found: SecurityLogSource | null) => {
        if (isCurrent) {
          setLogSource(found);
          setIsLogSourceRead(true);
        }
      })
      .catch(() => {
        /*
         * Not known: the card still offers the way to its switch, and
         * Connections says why it could not be read.
         */
        if (isCurrent) {
          setDidLogSourceReadFail(true);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  const logsState: SecurityEventsLogsState = getSecurityEventsLogsState({
    isRead: isLogSourceRead,
    didReadFail: didLogSourceReadFail,
    source: logSource,
  });

  const navigateTo: (pageMap: PageMap) => void = (pageMap: PageMap): void => {
    Navigation.navigate(
      RouteUtil.populateRouteParams(RouteMap[pageMap] as Route),
    );
  };

  const actions: Record<string, () => void> = {
    // Your logs is the first card on Connections, its switch at the top.
    logs: (): void => {
      navigateTo(PageMap.SECURITY_EVENTS_CONNECTIONS);
    },
    connect: (): void => {
      navigateTo(PageMap.SECURITY_EVENTS_CONNECTIONS);
    },
    send: (): void => {
      navigateTo(PageMap.SECURITY_EVENTS_DOCUMENTATION);
    },
  };

  const actionTestIds: Record<string, string> = {
    logs: `${SECURITY_EVENTS_EMPTY_STATE_ID}-your-logs`,
    connect: `${SECURITY_EVENTS_EMPTY_STATE_ID}-connections`,
    send: `${SECURITY_EVENTS_EMPTY_STATE_ID}-setup-guide`,
  };

  /*
   * Your logs says Turn on until the project's logs are known to be read
   * already - or cannot be known at all - and nothing while the read is out:
   * no label that changes under the pointer a moment after the page draws.
   */
  const getActionTitle: (wayIn: SecurityEventsWayIn) => string | null = (
    wayIn: SecurityEventsWayIn,
  ): string | null => {
    if (wayIn.id !== SECURITY_EVENTS_LOGS_WAY_IN.id) {
      return wayIn.actionTitle;
    }

    if (logsState === "reading") {
      return null;
    }

    return logsState === "off"
      ? wayIn.actionTitle
      : SECURITY_EVENTS_LOGS_WAY_IN.openActionTitle;
  };

  const logsStatusLines: Array<string> =
    logsState === "on"
      ? getYourLogsStatusLines({ source: logSource, translator: translator })
      : [];

  /*
   * The one concrete fact under each description: the kinds of line read
   * in your logs, the kinds of product OneUptime can poll, or the endpoint
   * to call. Each one 28px line, so the actions below them stay level.
   */
  const details: Record<string, ReactNode> = {
    logs: (
      <p
        data-testid={`${SECURITY_EVENTS_EMPTY_STATE_ID}-log-formats`}
        className="py-1 text-xs leading-5 text-gray-500"
      >
        {SECURITY_LOG_FORMATS.map(
          (format: SecurityLogFormatDefinition): string => {
            const title: string =
              SECURITY_LOG_FORMAT_TEXTS[format.format].title;

            // As its card on Connections names it, in the reader's language.
            return translateString(title) || title;
          },
        ).join(" · ")}
      </p>
    ),
    connect: (
      <p
        data-testid={`${SECURITY_EVENTS_EMPTY_STATE_ID}-categories`}
        className="py-1 text-xs leading-5 text-gray-500"
      >
        {SecurityEventConnectorCategories.map((category: string): string => {
          // A category with no entry in the locale reads as its English name.
          return translateString(category) || category;
        }).join(" · ")}
      </p>
    ),
    send: (
      <code
        data-testid={`${SECURITY_EVENTS_EMPTY_STATE_ID}-ingest-endpoint`}
        className="relative z-10 inline-flex max-w-full flex-wrap items-center gap-x-1.5 break-all rounded-md bg-gray-50 px-2 py-1 font-mono text-xs leading-5 text-gray-700 ring-1 ring-inset ring-gray-200"
      >
        <span className="font-semibold text-indigo-600">
          {SECURITY_EVENTS_INGEST_METHOD}
        </span>
        <span>{SECURITY_EVENTS_INGEST_PATH}</span>
      </code>
    ),
  };

  const renderWayIn: (
    wayIn: SecurityEventsWayIn,
    options: { isLead: boolean },
  ) => ReactElement = (
    wayIn: SecurityEventsWayIn,
    options: { isLead: boolean },
  ): ReactElement => {
    const titleId: string = `${SECURITY_EVENTS_EMPTY_STATE_ID}-${wayIn.id}-title`;
    const actionTitle: string | null = getActionTitle(wayIn);
    const isLogsOn: boolean = wayIn.id === "logs" && logsState === "on";

    return (
      <li
        key={wayIn.id}
        data-testid={`${SECURITY_EVENTS_EMPTY_STATE_ID}-${wayIn.id}`}
        data-state={wayIn.id === "logs" ? logsState : undefined}
        className={`group relative flex min-w-0 flex-col rounded-lg border border-gray-200 bg-white p-4 transition-colors duration-150 ease-out hover:border-indigo-300 sm:p-5${
          options.isLead ? " col-span-full" : ""
        }`}
      >
        {/*
         * The title takes the row beside its badge and wraps there, from
         * 10rem: a long one (Your logs', or any in German) wrapped whole to
         * a line under the badge on a phone. Only where even 10rem is not
         * left - beside the filters on a small tablet - does it go under
         * the badge, never squeezed to nothing. Your logs' On closes the
         * row, at the card's end.
         */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-200"
          >
            <Icon icon={wayIn.icon} className="h-5 w-5" />
          </div>
          <h4
            id={titleId}
            className="min-w-0 flex-1 basis-40 text-sm font-semibold text-gray-900"
          >
            {translateString(wayIn.title)}
          </h4>
          {isLogsOn ? (
            <span
              data-testid={`${SECURITY_EVENTS_EMPTY_STATE_ID}-logs-on`}
              className="inline-flex"
            >
              <Pill text="On" color={Green500} size={PillSize.Small} />
            </span>
          ) : (
            <></>
          )}
        </div>
        <p className="mt-3 text-sm leading-6 text-gray-500">
          {translateString(wayIn.description)}
        </p>
        <div className="mt-3">{details[wayIn.id]}</div>
        {isLogsOn && logsStatusLines.length > 0 ? (
          <p
            data-testid={`${SECURITY_EVENTS_EMPTY_STATE_ID}-logs-status`}
            className="mt-1 text-xs leading-5 text-gray-700"
          >
            {logsStatusLines.join(" ")}
          </p>
        ) : (
          <></>
        )}
        <div className="mt-auto pt-5">
          {actionTitle ? (
            <button
              type="button"
              data-testid={actionTestIds[wayIn.id]}
              aria-describedby={titleId}
              onClick={actions[wayIn.id]}
              className="inline-flex max-w-full items-center gap-1.5 text-left text-sm font-semibold text-indigo-600 after:absolute after:inset-0 after:rounded-lg after:content-[''] focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-indigo-500"
            >
              <span className="min-w-0">{translateString(actionTitle)}</span>
              <Icon
                icon={IconProp.ArrowRight}
                className="h-4 w-4 shrink-0 transition-transform duration-150 ease-out group-hover:translate-x-0.5"
              />
            </button>
          ) : (
            // Its line kept while Your logs is read, so nothing moves after.
            <span aria-hidden="true" className="block h-5" />
          )}
        </div>
      </li>
    );
  };

  return (
    <div
      id={SECURITY_EVENTS_EMPTY_STATE_ID}
      className="w-full px-3 py-8 text-center sm:px-6"
    >
      <div
        aria-hidden="true"
        className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-200"
      >
        <Icon icon={IconProp.ShieldCheck} className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-gray-900">
        {translateString("No security events yet")}
      </h3>
      <p
        data-testid={`${SECURITY_EVENTS_EMPTY_STATE_ID}-description`}
        className="mx-auto mt-1.5 max-w-xl text-sm leading-6 text-gray-500"
      >
        {translateString(
          "Events show up here as soon as a source starts sending.",
        )}
      </p>

      {/*
       * Columns from the width the list actually has: from md up it shares
       * its row with the filters sidebar, so the window's width says little
       * about it. Your logs takes the whole first row; the other two share
       * the next, or stack where they cannot.
       */}
      <ul
        role="list"
        aria-label={translateString("Ways to start sending security events")}
        className="mx-auto mt-6 grid max-w-3xl grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4 text-left"
      >
        {renderWayIn(SECURITY_EVENTS_LOGS_WAY_IN, { isLead: true })}
        {SECURITY_EVENTS_WAYS_IN.map(
          (wayIn: SecurityEventsWayIn): ReactElement => {
            return renderWayIn(wayIn, { isLead: false });
          },
        )}
      </ul>
    </div>
  );
};

export default SecurityEventsEmptyState;
