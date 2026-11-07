import AppLink from "../AppLink/AppLink";
import { SECURITY_LOG_FORMAT_TEXTS } from "../SecurityEvents/SecurityConnectionsCopy";
import { readProjectSecurityLogSource } from "../SecurityEvents/SecurityLogsSourceCard";
import {
  SecurityEventsLogsState,
  getSecurityEventsLogsState,
} from "../SecurityEvents/SecurityEventsEmptyState";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SecurityLogSource from "Common/Models/DatabaseModels/SecurityLogSource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  SecurityLogFormatDefinition,
  SecurityLogFormatGroup,
  getSecurityLogFormatsInGroup,
} from "Common/Types/SecurityEvent/SecurityLogFormat";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  Translator,
  composedValue,
  formatList,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export const DEVICE_SECURITY_EVENTS_EMPTY_STATE_ID: string =
  "device-security-events-empty-state";

/*
 * A network device's Security Events page before the device has had any
 * (issue #5769). The project's setup guide would be the wrong answer here:
 * what puts events on this page is the device's own syslog reaching a
 * probe and Your logs reading it, so those are the two steps, each with
 * where it is done - the device's Logs page says how to point it at the
 * probe, Connections has Your logs' switch. Your logs says where it
 * stands, as the Events page's empty state does: a project that reads its
 * logs already is told so, not asked to turn on what is on.
 *
 * Under them, the security records read in a device's syslog, by their
 * names on Connections, and that events from any other source naming the
 * device land here too.
 */
export interface ComponentProps {
  modelId: ObjectID;
}

const DeviceSecurityEventsEmptyState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
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
        // Not known: the step still links to the switch.
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

  const logsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_DEVICE_VIEW_LOGS] as Route,
    { modelId: props.modelId },
  );
  const connectionsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_EVENTS_CONNECTIONS] as Route,
  );

  // By their names on Connections: CEF, LEEF, Palo Alto Networks, FortiGate, Cisco ASA.
  const deviceFormatTitles: Array<string> = getSecurityLogFormatsInGroup(
    SecurityLogFormatGroup.SecurityDevices,
  ).map((definition: SecurityLogFormatDefinition): string => {
    return SECURITY_LOG_FORMAT_TEXTS[definition.format].title;
  });

  const linkClassName: string =
    "font-medium text-indigo-600 hover:text-indigo-700 hover:underline";

  return (
    <div
      className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6"
      data-testid={DEVICE_SECURITY_EVENTS_EMPTY_STATE_ID}
    >
      <div className="flex flex-col items-center text-center">
        <div
          aria-hidden="true"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-200"
        >
          <Icon icon={IconProp.ShieldCheck} className="h-5 w-5" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-gray-900">
          {translator.translateText("No security events for this device yet")}
        </h3>
        <p className="mt-2 text-sm text-gray-500">
          {translator.translateText(
            "They appear here when OneUptime finds them in the syslog this device sends a probe - blocked connections and threats, VPN and administrator sign-ins - or when events from any other source name this device.",
          )}
        </p>
      </div>

      <ol className="mt-6 space-y-3 text-left text-sm text-gray-600">
        <li
          className="flex gap-3 rounded-lg border border-gray-200 bg-white p-4"
          data-testid={`${DEVICE_SECURITY_EVENTS_EMPTY_STATE_ID}-syslog`}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
            1
          </span>
          <span>
            <TranslatedSentence
              template="Send this device's syslog to a probe. Its {{logs}} page says how."
              slots={{
                logs: (
                  <AppLink to={logsRoute} className={linkClassName}>
                    {translator.translateText("Logs") || "Logs"}
                  </AppLink>
                ),
              }}
            />
          </span>
        </li>
        <li
          className="flex gap-3 rounded-lg border border-gray-200 bg-white p-4"
          data-testid={`${DEVICE_SECURITY_EVENTS_EMPTY_STATE_ID}-your-logs`}
          data-state={logsState}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
            2
          </span>
          <span>
            {logsState === "on" ? (
              <TranslatedSentence
                template="Your logs is on: every minute, OneUptime reads this project's new logs for security events. See the Security Events {{connections}} page."
                slots={{
                  connections: (
                    <AppLink to={connectionsRoute} className={linkClassName}>
                      {translator.translateText("Connections") || "Connections"}
                    </AppLink>
                  ),
                }}
              />
            ) : (
              <TranslatedSentence
                template="Turn on Your logs, on the Security Events {{connections}} page."
                slots={{
                  connections: (
                    <AppLink to={connectionsRoute} className={linkClassName}>
                      {translator.translateText("Connections") || "Connections"}
                    </AppLink>
                  ),
                }}
              />
            )}
          </span>
        </li>
      </ol>

      <p
        className="mt-4 text-center text-xs leading-5 text-gray-500"
        data-testid={`${DEVICE_SECURITY_EVENTS_EMPTY_STATE_ID}-formats`}
      >
        {translator.translateTemplate(
          "Read in a device's syslog: {{formats}}.",
          {
            formats: composedValue((sentence: Translator): string => {
              return formatList(
                deviceFormatTitles.map((title: string): string => {
                  return sentence.translateText(title) || title;
                }),
                sentence,
              );
            }),
          },
        )}
      </p>
    </div>
  );
};

export default DeviceSecurityEventsEmptyState;
