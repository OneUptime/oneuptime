import {
  NETWORK_EVENT_KIND_TITLES,
  NetworkEventCopy,
  getNetworkEventCopy,
  getNetworkEventTitle,
} from "./NetworkEventCopy";
import {
  NetworkEventRow,
  getNetworkEventDetailAttributes,
} from "./NetworkEventsModel";
import {
  KIND_DOT_CLASS_NAMES,
  UnknownSourceBadge,
  getDeviceEventsRoute,
} from "./NetworkEventsTimeline";
import {
  NetworkQuickAction,
  getNetworkQuickActionRoute,
} from "../Network/NetworkQuickActions";
import AppLink from "../AppLink/AppLink";
import { getNetworkEventAlertRoute } from "../../Utils/NetworkEventMonitorPrefill";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import {
  FeedClock,
  formatFeedFullTime,
  formatFeedTimeAgo,
  getFeedClock,
} from "Common/UI/Components/Feed/FeedTime";
import SideOver, { SideOverSize } from "Common/UI/Components/SideOver/SideOver";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * ONE EVENT, OPENED: what the device said, word for word, and what
 * OneUptime read out of it.
 *
 * The facts first - when, which device, what it happened to - then the
 * message as the device sent it, then every attribute stored on the log.
 * One click to be told the next time it happens; for an event from an
 * address that is not a device yet, one click to make it one.
 *
 * A panel beside the list, not over it: narrow enough that the rows it was
 * opened from stay in view.
 */

export interface ComponentProps {
  row: NetworkEventRow;
  canCreateAlert: boolean;
  // Set on one device's page: an alert made here is for that device only.
  alertDeviceId?: string | undefined;
  onClose: () => void;
}

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

interface Fact {
  label: string;
  value: ReactElement | string;
}

const NetworkEventDetails: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const row: NetworkEventRow = props.row;
  const copy: NetworkEventCopy | null = getNetworkEventCopy(row.name);

  const facts: Array<Fact> = [];

  if (row.time) {
    /*
     * The whole instant, to the second, in the reader's zone and language -
     * and how long ago that was, which is what is asked first.
     */
    const clock: FeedClock = getFeedClock({ language: translator.language });
    const ago: string | undefined = formatFeedTimeAgo(row.time, clock);

    facts.push({
      label: FACT_LABELS.when,
      value: (
        <span className="inline-flex flex-wrap items-baseline gap-x-2">
          <time dateTime={row.time.toISOString()}>
            {formatFeedFullTime(row.time, clock)}
          </time>
          {ago ? (
            <span
              className="text-gray-500"
              data-testid="network-event-details-ago"
            >
              {ago}
            </span>
          ) : (
            <></>
          )}
        </span>
      ),
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
        <span className="inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="min-w-0 [overflow-wrap:anywhere]">{row.device}</span>
          {row.isFromUnknownSource ? <UnknownSourceBadge /> : <></>}
          {/*
           * Beside what it is about, not in the footer: on a phone the
           * footer has room for the panel's own two buttons and no more.
           */}
          {row.isFromUnknownSource && row.sourceIp ? (
            <Button
              title="Add as device"
              icon={IconProp.Add}
              buttonSize={ButtonSize.Small}
              buttonStyle={ButtonStyleType.NORMAL}
              // On a phone: its own words' width and size, not the dialog button's.
              className="md:ml-0 max-md:w-auto max-md:text-sm"
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
          ) : (
            <></>
          )}
        </span>
      ),
    });
  }

  for (const subject of row.subject ? [row.subject, ...row.details] : []) {
    facts.push({ label: subject.label, value: subject.value });
  }

  facts.push({
    label: FACT_LABELS.kind,
    value: (
      <span className="inline-flex items-center gap-2">
        <span
          className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${KIND_DOT_CLASS_NAMES[row.kind]}`}
          aria-hidden="true"
        />
        {translator.translateText(NETWORK_EVENT_KIND_TITLES[row.kind]) || ""}
      </span>
    ),
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
      size={SideOverSize.Small}
      {...(props.canCreateAlert
        ? {
            submitButtonText: CREATE_ALERT_FOR_EVENT,
            onSubmit: () => {
              Navigation.navigate(alertRoute);
            },
          }
        : {})}
    >
      {/*
       * The panel's body has no top padding of its own from sm up: its
       * first row would sit against the header without this.
       */}
      <div className="space-y-6 sm:pt-4" data-testid="network-event-details">
        <dl className="divide-y divide-gray-100">
          {facts.map((fact: Fact): ReactElement => {
            return (
              <div
                key={fact.label}
                className="flex gap-4 py-2.5 text-sm"
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
          })}
        </dl>

        {row.message ? (
          <div>
            <h3 className="text-sm font-medium text-gray-900">
              {translator.translateText("What the device said")}
            </h3>
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
          <h3 className="text-sm font-medium text-gray-900">
            {translator.translateText("What was read out of it")}
          </h3>
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
                    <dt className="break-words font-mono text-gray-500 sm:w-52 sm:flex-shrink-0">
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

export default NetworkEventDetails;
