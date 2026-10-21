import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import { Red500 } from "Common/Types/BrandColors";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  VMwareHostOpenEvent,
  VMwareHostOpenEventKind,
  VMwareHostOpenEvents,
  loadVMwareHostOpenEvents,
  sortVMwareHostOpenEvents,
} from "./VMwareHostOpenEvents";

/*
 * What is wrong with an ESXi host right now, near the top of its page: the
 * unresolved incidents and alerts its vCenter's monitors opened for this
 * host, newest first, each one a step from its own page. The host page
 * outside VMware counts them in its Activity cards; a VMware monitor is the
 * vCenter's, so here they are read through their series labels and listed.
 *
 * Draws nothing while nothing is open - the host's status and its Host
 * alerts card say the rest - and nothing when neither kind can be read.
 */

// How many open records the card lists before it points to the rest.
export const VMWARE_HOST_OPEN_EVENTS_SHOWN: number = 5;

export interface ComponentProps {
  vcenterId: ObjectID;
  hostName: string;
  getIncidentRoute: (incidentId: ObjectID) => Route;
  getAlertRoute: (alertId: ObjectID) => Route;
  // The vCenter's own Incidents and Alerts pages, for the rest.
  incidentsRoute: Route;
  alertsRoute: Route;
  // Read again when this changes (the page's refresh).
  refreshToken?: number | undefined;
}

const VMwareHostOpenEventsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
  const listClassName: string = useCardRuledListClassName();
  const [events, setEvents] = useState<VMwareHostOpenEvents | null>(null);

  useEffect(() => {
    let ignore: boolean = false;
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId || !props.hostName) {
      setEvents(null);
      return undefined;
    }

    loadVMwareHostOpenEvents({
      projectId: projectId,
      vcenterId: props.vcenterId,
      hostName: props.hostName,
    })
      .then((loaded: VMwareHostOpenEvents) => {
        if (!ignore) {
          setEvents(loaded);
        }
      })
      .catch(() => {
        if (!ignore) {
          setEvents(null);
        }
      });

    return () => {
      ignore = true;
    };
  }, [props.vcenterId.toString(), props.hostName, props.refreshToken]);

  if (!events) {
    return <></>;
  }

  const all: Array<VMwareHostOpenEvent> = sortVMwareHostOpenEvents([
    ...(events.incidents || []),
    ...(events.alerts || []),
  ]);

  if (all.length === 0) {
    return <></>;
  }

  const shown: Array<VMwareHostOpenEvent> = all.slice(
    0,
    VMWARE_HOST_OPEN_EVENTS_SHOWN,
  );
  const hiddenIncidents: number = all
    .slice(VMWARE_HOST_OPEN_EVENTS_SHOWN)
    .filter((event: VMwareHostOpenEvent): boolean => {
      return event.kind === VMwareHostOpenEventKind.Incident;
    }).length;
  const hiddenAlerts: number = all.length - shown.length - hiddenIncidents;

  return (
    <div className="mb-6" data-testid="vmware-host-open-events">
      <Card
        title="Open on this host"
        description="Unresolved incidents and alerts this vCenter's monitors opened for this host."
      >
        <ul className={listClassName}>
          {shown.map((event: VMwareHostOpenEvent): ReactElement => {
            const isIncident: boolean =
              event.kind === VMwareHostOpenEventKind.Incident;

            return (
              <li
                key={`${event.kind}-${event.id.toString()}`}
                data-testid="vmware-host-open-event"
                data-kind={event.kind}
                className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:gap-3 md:px-6"
              >
                <div className="flex min-w-0 items-start gap-3 sm:flex-1">
                  <div
                    className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ring-1 ring-inset ${
                      isIncident
                        ? "bg-red-50 text-red-600 ring-red-200"
                        : "bg-amber-50 text-amber-600 ring-amber-200"
                    }`}
                    aria-hidden="true"
                  >
                    <Icon
                      icon={
                        isIncident
                          ? IconProp.Alert
                          : IconProp.ExclaimationCircle
                      }
                      className="h-3.5 w-3.5"
                    />
                  </div>
                  <div className="min-w-0">
                    <Link
                      to={
                        isIncident
                          ? props.getIncidentRoute(event.id)
                          : props.getAlertRoute(event.id)
                      }
                      className="break-words text-sm font-medium text-gray-900 hover:text-indigo-600 hover:underline"
                    >
                      {event.title ||
                        (isIncident
                          ? tx("Untitled incident")
                          : tx("Untitled alert"))}
                    </Link>
                    <div className="mt-0.5 text-xs text-gray-500">
                      {[
                        isIncident ? tx("Incident") : tx("Alert"),
                        event.number,
                        event.stateName,
                        event.createdAt
                          ? OneUptimeDate.fromNow(event.createdAt)
                          : "",
                      ]
                        .filter((part: string): boolean => {
                          return Boolean(part);
                        })
                        .join(" · ")}
                    </div>
                  </div>
                </div>
                {event.severityName ? (
                  <div className="pl-10 sm:flex-none sm:pl-0">
                    <Pill
                      text={event.severityName}
                      color={event.severityColor || Red500}
                      size={PillSize.Small}
                    />
                  </div>
                ) : (
                  <></>
                )}
              </li>
            );
          })}
          {hiddenIncidents > 0 || hiddenAlerts > 0 ? (
            <li
              className="flex flex-wrap gap-x-4 gap-y-1 px-5 py-3 text-sm md:px-6"
              data-testid="vmware-host-open-events-more"
            >
              {hiddenIncidents > 0 ? (
                <Link
                  to={props.incidentsRoute}
                  className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                >
                  {translator.translatePlural(
                    {
                      one: "{{count}} more incident",
                      other: "{{count}} more incidents",
                    },
                    hiddenIncidents,
                  )}
                </Link>
              ) : (
                <></>
              )}
              {hiddenAlerts > 0 ? (
                <Link
                  to={props.alertsRoute}
                  className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                >
                  {translator.translatePlural(
                    {
                      one: "{{count}} more alert",
                      other: "{{count}} more alerts",
                    },
                    hiddenAlerts,
                  )}
                </Link>
              ) : (
                <></>
              )}
            </li>
          ) : (
            <></>
          )}
        </ul>
      </Card>
    </div>
  );
};

export default VMwareHostOpenEventsCard;
