import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { SecurityEventConnectorCategories } from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import Icon from "Common/UI/Components/Icon/Icon";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslateValue from "Common/UI/Utils/Translation";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";

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

/*
 * The two ways events start arriving. Neither is the "real" one: pushing
 * needs nothing but an HTTP client at the source, polling needs nothing but
 * a read-only credential for it. So the cards are the same size and weight,
 * and only the order says which to read first.
 */
export const SECURITY_EVENTS_WAYS_IN: Array<SecurityEventsWayIn> = [
  {
    id: "send",
    icon: IconProp.PaperAirplane,
    title: "Send events to OneUptime",
    description:
      "POST JSON from a SIEM, a SOAR webhook, a log forwarder or any other source.",
    actionTitle: "Read the setup guide",
  },
  {
    id: "connect",
    icon: IconProp.Link,
    title: "Pull from a security product",
    description:
      "OneUptime polls Microsoft Sentinel, CrowdStrike, Splunk and more on a schedule.",
    actionTitle: "Connect a security product",
  },
];

/*
 * The Security Events table with nothing in it. That means "nothing is
 * sending yet" far more often than "nothing happened", and there are two
 * ways to start sending: push events to the ingest API (the setup guide), or
 * have OneUptime poll a security product (Connections). Each gets a card of
 * its own, so the choice reads as a choice rather than as one long sentence.
 *
 * Every card is one click target, through a stretched button; the endpoint
 * is raised above it so it can still be selected and copied.
 */
const SecurityEventsEmptyState: FunctionComponent = (): ReactElement => {
  const { translateString } = useTranslateValue();

  const navigateTo: (pageMap: PageMap) => void = (pageMap: PageMap): void => {
    Navigation.navigate(
      RouteUtil.populateRouteParams(RouteMap[pageMap] as Route),
    );
  };

  const actions: Record<string, () => void> = {
    send: (): void => {
      navigateTo(PageMap.SECURITY_EVENTS_DOCUMENTATION);
    },
    connect: (): void => {
      navigateTo(PageMap.SECURITY_EVENTS_CONNECTIONS);
    },
  };

  const actionTestIds: Record<string, string> = {
    send: `${SECURITY_EVENTS_EMPTY_STATE_ID}-setup-guide`,
    connect: `${SECURITY_EVENTS_EMPTY_STATE_ID}-connections`,
  };

  /*
   * The one concrete fact under each description: the endpoint to call, or
   * the kinds of product OneUptime can poll. Both are one 28px line, so the
   * two actions below them stay level.
   */
  const details: Record<string, ReactNode> = {
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
    connect: (
      <p
        data-testid={`${SECURITY_EVENTS_EMPTY_STATE_ID}-categories`}
        className="py-1 text-xs leading-5 text-gray-500"
      >
        {SecurityEventConnectorCategories.map((category: string): string => {
          return translateString(category);
        }).join(" · ")}
      </p>
    ),
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
          "Events show up here as soon as a source starts sending. Every event is normalized to OCSF, whatever format it arrives in.",
        )}
      </p>

      {/*
       * Columns from the width the list actually has: it shares its row with
       * the filters sidebar, so the window's width says little about it.
       */}
      <ul
        role="list"
        aria-label={translateString("Ways to start sending security events")}
        className="mx-auto mt-6 grid max-w-3xl grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4 text-left"
      >
        {SECURITY_EVENTS_WAYS_IN.map(
          (wayIn: SecurityEventsWayIn): ReactElement => {
            const titleId: string = `${SECURITY_EVENTS_EMPTY_STATE_ID}-${wayIn.id}-title`;

            return (
              <li
                key={wayIn.id}
                data-testid={`${SECURITY_EVENTS_EMPTY_STATE_ID}-${wayIn.id}`}
                className="group relative flex min-w-0 flex-col rounded-lg border border-gray-200 bg-white p-4 transition-colors duration-150 ease-out hover:border-indigo-300 sm:p-5"
              >
                {/*
                 * Wraps rather than squeezing the title to nothing when the
                 * list is narrow, e.g. beside the filters on a phone.
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
                    className="min-w-0 text-sm font-semibold text-gray-900"
                  >
                    {translateString(wayIn.title)}
                  </h4>
                </div>
                <p className="mt-3 text-sm leading-6 text-gray-500">
                  {translateString(wayIn.description)}
                </p>
                <div className="mt-3">{details[wayIn.id]}</div>
                <div className="mt-auto pt-5">
                  <button
                    type="button"
                    data-testid={actionTestIds[wayIn.id]}
                    aria-describedby={titleId}
                    onClick={actions[wayIn.id]}
                    className="inline-flex max-w-full items-center gap-1.5 text-left text-sm font-semibold text-indigo-600 after:absolute after:inset-0 after:rounded-lg after:content-[''] focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-indigo-500"
                  >
                    <span className="min-w-0">
                      {translateString(wayIn.actionTitle)}
                    </span>
                    <Icon
                      icon={IconProp.ArrowRight}
                      className="h-4 w-4 shrink-0 transition-transform duration-150 ease-out group-hover:translate-x-0.5"
                    />
                  </button>
                </div>
              </li>
            );
          },
        )}
      </ul>
    </div>
  );
};

export default SecurityEventsEmptyState;
