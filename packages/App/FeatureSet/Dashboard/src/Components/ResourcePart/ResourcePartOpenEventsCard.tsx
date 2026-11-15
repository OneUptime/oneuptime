import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Route from "Common/Types/API/Route";
import { Red500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import { isRecordNameAsWritten } from "Common/Utils/DefaultRecordNames";
import { StateListType } from "Common/Utils/StateOrder";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { formatRelativeTime } from "../Home/HomeRelativeTime";
import { OpenIssueRecord } from "../ResourceTopology/ResourceTopologyIssues";
import {
  ResourcePartOpenEvents,
  loadResourcePartOpenEvents,
} from "./ResourcePartOpenEvents";
import { OpenIssueRelation } from "../ResourceTopology/ResourceTopologyIssuesLoader";
import ResourcePartRow from "./ResourcePartRow";

/*
 * What is wrong with a part right now, near the top of its page: the
 * unresolved incidents and alerts its resource's monitors opened for it,
 * incidents first and each kind newest first, each a step from its own
 * page, and how many more there are. The ESXi host page's card,
 * generalized for every resource product's parts (ResourcePartOpenEvents
 * says how the records are found).
 *
 * Draws nothing while nothing is open - the part's status and its alerts
 * card say the rest - and nothing when neither kind can be read. Each row
 * opens its record, the whole row (ResourcePartRow), as Home's Needs
 * attention rows do.
 */

// How many open records the card lists before it points to the rest.
export const RESOURCE_PART_OPEN_EVENTS_SHOWN: number = 5;

export interface ComponentProps {
  testId: string;
  // "Open on this node" - English.
  title: string;
  description: string;
  // The relation that links a record to the resource: "proxmoxClusters".
  resourceRelation: string;
  resourceId: ObjectID;
  isAbout: (record: OpenIssueRecord) => boolean;
  // The inventory rows to read with each record (ResourcePartOpenEvents).
  relations?: Array<OpenIssueRelation> | undefined;
  getIncidentRoute: (incidentId: ObjectID) => Route;
  getAlertRoute: (alertId: ObjectID) => Route;
  // The resource's own Incidents and Alerts pages, for the rest.
  incidentsRoute: Route;
  alertsRoute: Route;
  // Read again when this changes (the page's refresh).
  refreshToken?: number | undefined;
}

function toColor(value: string | null): Color | null {
  if (!value) {
    return null;
  }
  try {
    return new Color(value);
  } catch {
    return null;
  }
}

const ResourcePartOpenEventsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
  const listClassName: string = useCardRuledListClassName();
  const [events, setEvents] = useState<ResourcePartOpenEvents | null>(null);

  useEffect(() => {
    let ignore: boolean = false;
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      setEvents(null);
      return undefined;
    }

    loadResourcePartOpenEvents({
      projectId: projectId,
      resourceRelation: props.resourceRelation,
      resourceId: props.resourceId,
      isAbout: props.isAbout,
      relations: props.relations,
    })
      .then((loaded: ResourcePartOpenEvents) => {
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
  }, [props.resourceId.toString(), props.testId, props.refreshToken]);

  if (!events || events.records.length === 0) {
    return <></>;
  }

  const shown: Array<OpenIssueRecord> = events.records.slice(
    0,
    RESOURCE_PART_OPEN_EVENTS_SHOWN,
  );
  const hidden: Array<OpenIssueRecord> = events.records.slice(
    RESOURCE_PART_OPEN_EVENTS_SHOWN,
  );
  const hiddenIncidents: number = hidden.filter(
    (record: OpenIssueRecord): boolean => {
      return record.type === "incident";
    },
  ).length;
  const hiddenAlerts: number = hidden.length - hiddenIncidents;

  return (
    <div className="mb-6" data-testid={props.testId}>
      <Card title={props.title} description={props.description}>
        <ul className={listClassName}>
          {shown.map((record: OpenIssueRecord): ReactElement => {
            const isIncident: boolean = record.type === "incident";
            const id: ObjectID = new ObjectID(record.id);

            return (
              <li
                key={`${record.type}-${record.id}`}
                data-testid={`${props.testId}-item`}
                data-kind={record.type}
              >
                <ResourcePartRow
                  to={
                    isIncident
                      ? props.getIncidentRoute(id)
                      : props.getAlertRoute(id)
                  }
                  className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3"
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
                      <div
                        data-testid={`${props.testId}-title`}
                        className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere]"
                      >
                        {record.title ||
                          (isIncident
                            ? tx("Untitled incident")
                            : tx("Untitled alert"))}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        {[
                          isIncident ? tx("Incident") : tx("Alert"),
                          record.number,
                          record.stateName,
                          record.createdAt
                            ? formatRelativeTime({
                                date: record.createdAt,
                                now: new Date(),
                                language: translator.language,
                              })
                            : "",
                        ]
                          .filter((part: string): boolean => {
                            return Boolean(part);
                          })
                          .join(" · ")}
                      </div>
                    </div>
                  </div>
                  {record.severityName ? (
                    <div className="pl-10 sm:flex-none sm:pl-0">
                      <Pill
                        text={record.severityName}
                        isUserContent={isRecordNameAsWritten(
                          isIncident
                            ? StateListType.IncidentSeverity
                            : StateListType.AlertSeverity,
                          record.severityName,
                        )}
                        color={toColor(record.severityColor) || Red500}
                        size={PillSize.Small}
                      />
                    </div>
                  ) : (
                    <></>
                  )}
                </ResourcePartRow>
              </li>
            );
          })}
          {hiddenIncidents > 0 || hiddenAlerts > 0 ? (
            <li
              className="flex flex-wrap gap-x-4 gap-y-1 px-5 py-3 text-sm md:px-6"
              data-testid={`${props.testId}-more`}
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

export default ResourcePartOpenEventsCard;
