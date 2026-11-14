import AppLink from "../AppLink/AppLink";
import SecurityCaseApi, {
  SecurityConnectionsRequest,
} from "../SecurityCase/SecurityCaseApi";
import { SecurityEntityChip } from "../SecurityCase/SecurityEntityChips";
import { formatNameList } from "../AiAccess/AiAccessModes";
import TelemetryMentions from "./TelemetryMentions";
import {
  CONNECTED_ENTRY_ICON_CLASS_NAME,
  CONNECTED_FACT_ROW_CLASS_NAME,
  CONNECTED_RECORD_TEXT_CLASS_NAME,
} from "./SecurityConnectionsLayout";
import {
  CONNECTED_ACTIVE_ALERTS,
  CONNECTED_ACTIVE_INCIDENTS,
  CONNECTED_CHANGES_TITLE,
  CONNECTED_EMPTY_DESCRIPTION,
  CONNECTED_EMPTY_TITLE,
  CONNECTED_FAILED,
  CONNECTED_MONITORS,
  CONNECTED_MORE,
  CONNECTED_MORE_RECORDS,
  CONNECTED_NOTHING_ACTIVE,
  CONNECTED_NOTHING_TO_LOOK_UP_DESCRIPTION,
  CONNECTED_NOTHING_TO_LOOK_UP_TITLE,
  CONNECTED_NOT_FOUND_TITLE,
  CONNECTED_ON_CALL_NOW,
  CONNECTED_ON_CALL_SCHEDULES,
  CONNECTED_PARTIAL_EMPTY_DESCRIPTION,
  CONNECTED_PARTIAL_EMPTY_TITLE,
  CONNECTED_POSSIBLE_GROUP_DESCRIPTION,
  CONNECTED_POSSIBLE_GROUP_TITLE,
  CONNECTED_POSSIBLE_PILL,
  CONNECTED_POSSIBLE_TOOLTIP,
  CONNECTED_SIGNALS_TITLE,
  CONNECTED_TEAMS,
  CONNECTED_TRY_AGAIN,
  CONNECTED_UNREADABLE,
  CONNECTED_WINDOW,
  CONNECTION_KIND_ICONS,
  CONNECTION_KIND_LABELS,
  CONNECTION_KIND_PLURALS,
  SECURITY_CONNECTIONS_TEST_IDS,
  SIGNAL_LINKS_ARIA_LABEL,
  SIGNAL_LINK_ICONS,
  SIGNAL_LINK_LABELS,
} from "./SecurityConnectionsCopy";
import {
  ConnectedSignalsGroups,
  ConnectedSignalsState,
  SignalLink,
  getAlertRoute,
  getConnectedRecordRoute,
  getConnectedSignalsGroups,
  getConnectedSignalsState,
  getConnectionReasonTemplate,
  getIncidentRoute,
  getLeadingMatch,
  getMonitorRoute,
  getOnCallScheduleRoute,
  getSignalLinks,
  getTeamRoute,
} from "./SecurityConnectionsModel";
import Route from "Common/Types/API/Route";
import { Gray500, Green, Yellow } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SecurityConnectedResourceJson,
  SecurityConnectionCertainty,
  SecurityConnectionChangeJson,
  SecurityConnectionKind,
  SecurityConnectionRecordJson,
  SecurityConnectionRecordListJson,
  SecurityConnectionScheduleJson,
  SecurityConnectionScheduleListJson,
  SecurityConnectionsJson,
} from "Common/Types/SecurityCase/SecurityConnection";
import {
  SecurityEntity,
  SecurityEntityType,
} from "Common/Types/SecurityCase/SecurityEntity";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import { isRecordNameAsWritten } from "Common/Utils/DefaultRecordNames";
import { StateListType } from "Common/Utils/StateOrder";
import API from "Common/UI/Utils/API/API";
import { Translator, composedValue } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  getChangeTitleDirection,
  getChangeTitleForReader,
} from "Common/Utils/Telemetry/CloudChangeTitle";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useState,
} from "react";

/*
 * CONNECTED SIGNALS: what a case, an event or an entity names in the rest of
 * OneUptime, and what was happening on each around it.
 *
 * One entry per record - a host, a container host, a cluster, a network
 * device, a cloud resource, a serverless function, a service, a monitor, a
 * user - exact connections first: its name, opening its page (and a
 * monitor's status beside it); why OneUptime connects it, said as a
 * sentence; its signals, each opening its explorer (or its own page) on it
 * and the window; and what is going on there, one fact a row - the
 * incidents and alerts open on it, the monitors watching it, what changed
 * on it in the window, a member's on-call schedules and teams - each item on
 * a line of its own, so a long title, another language or a right-to-left
 * page never runs one item into the next. The possible matches follow under a
 * heading of their own that says what "possible" means, each still with its
 * pill. Then what OneUptime looked for and no record matches, and what the
 * reader's role keeps from them. Under them, on a read of its own, where
 * what it names appears in the logs and traces themselves
 * (TelemetryMentions).
 *
 * No record at all is said as an entry of the list, not as a page's empty
 * state: its sentence beside the list's icon, what it looked for under it -
 * so the logs and traces below, often the answer then, are not pushed down
 * under a large illustration that says nothing was found.
 *
 * The same answer the case's triage reads, so OneUptime AI and the person
 * reading the case see the same connections.
 */

export interface ComponentProps {
  request: SecurityConnectionsRequest;
  // A key the request is told apart by: a new one reads afresh.
  requestKey: string;
  /*
   * Change it to read the same request again (the case changed), keeping
   * what is shown until the new answer is in.
   */
  refreshToken?: string | number | undefined;
  description: string;
  // Drawn without a card of its own, inside one that already is (the event panel).
  isEmbedded?: boolean | undefined;
}

const SIGNAL_LINK_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const FACT_LINK_CLASS_NAME: string =
  "min-w-0 text-gray-900 hover:text-indigo-700 hover:underline [overflow-wrap:anywhere]";

/*
 * A fact's row and a record's text column, as the values found in the logs
 * and traces lay theirs out too (SecurityConnectionsLayout).
 */
export { CONNECTED_FACT_ROW_CLASS_NAME, CONNECTED_RECORD_TEXT_CLASS_NAME };

/*
 * A change: its time, then what changed - beside the time while the title
 * keeps 16rem there, under it on a phone or beside a tablet's side menu,
 * rather than in a column a few words wide.
 */
export const CONNECTED_CHANGE_ITEM_CLASS_NAME: string =
  "flex min-w-0 flex-wrap gap-x-3";

export const CONNECTED_CHANGE_TITLE_CLASS_NAME: string =
  "min-w-0 flex-1 basis-64 text-gray-900 [overflow-wrap:anywhere]";

// A section's heading in the card: Possible matches, No matching record.
const SECTION_HEADING_CLASS_NAME: string =
  "text-xs font-medium uppercase tracking-wide text-gray-500";

// The logs and traces under the records: a rule between, as the possible matches have.
export const TELEMETRY_SECTION_CLASS_NAME: string =
  "mt-4 border-t border-gray-100 pt-4";

function readColor(value: string | undefined): Color {
  return value ? new Color(value) : Gray500;
}

/*
 * One open incident, alert or monitor on a record: its number and title,
 * opening it, and where it stands - its state, from `stateList`, whose
 * default names are looked up and the project's own drawn as written
 * (Common/Utils/DefaultRecordNames).
 */
const FactRecordItem: FunctionComponent<{
  item: SecurityConnectionRecordJson;
  route: Route | null;
  stateList?: StateListType | undefined;
}> = (props: {
  item: SecurityConnectionRecordJson;
  route: Route | null;
  stateList?: StateListType | undefined;
}): ReactElement => {
  const item: SecurityConnectionRecordJson = props.item;
  const text: ReactElement = (
    <bdi>
      {item.number ? (
        <span className="font-medium text-gray-500">{item.number} </span>
      ) : (
        <></>
      )}
      {item.title}
    </bdi>
  );

  return (
    <li
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5"
      data-testid={SECURITY_CONNECTIONS_TEST_IDS.factItem}
    >
      {props.route ? (
        <AppLink to={props.route} className={FACT_LINK_CLASS_NAME}>
          {text}
        </AppLink>
      ) : (
        <span className="min-w-0 text-gray-900 [overflow-wrap:anywhere]">
          {text}
        </span>
      )}
      {item.stateName ? (
        <Pill
          text={item.stateName}
          isUserContent={isRecordNameAsWritten(props.stateList, item.stateName)}
          color={readColor(item.stateColor)}
          size={PillSize.Small}
        />
      ) : (
        <></>
      )}
    </li>
  );
};

/*
 * One on-call schedule a member is on: its name, opening it, and "On call
 * now" when they are the one on call for it.
 */
const ScheduleItem: FunctionComponent<{
  schedule: SecurityConnectionScheduleJson;
}> = (props: { schedule: SecurityConnectionScheduleJson }): ReactElement => {
  const route: Route | null = getOnCallScheduleRoute(props.schedule.id);
  const name: ReactElement = <bdi>{props.schedule.name}</bdi>;

  return (
    <li
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5"
      data-testid={SECURITY_CONNECTIONS_TEST_IDS.factItem}
    >
      {route ? (
        <AppLink to={route} className={FACT_LINK_CLASS_NAME}>
          {name}
        </AppLink>
      ) : (
        <span className="min-w-0 text-gray-900 [overflow-wrap:anywhere]">
          {name}
        </span>
      )}
      {props.schedule.isOnCallNow ? (
        <span data-testid={SECURITY_CONNECTIONS_TEST_IDS.onCallNow}>
          {/* The pill says its words in the reader's language. */}
          <Pill
            text={CONNECTED_ON_CALL_NOW}
            color={Green}
            size={PillSize.Small}
          />
        </span>
      ) : (
        <></>
      )}
    </li>
  );
};

// What it looked for and no record matches: each as the case names it.
const NotFoundChips: FunctionComponent<{
  values: Array<SecurityEntity>;
  className?: string | undefined;
}> = (props: {
  values: Array<SecurityEntity>;
  className?: string | undefined;
}): ReactElement => {
  return (
    <div className={`flex flex-wrap gap-1.5 ${props.className || ""}`.trim()}>
      {props.values.map((entity: SecurityEntity, index: number) => {
        return (
          <SecurityEntityChip
            key={`${entity.type}-${entity.value}-${index}`}
            entity={{
              type: entity.type || SecurityEntityType.Other,
              value: entity.value,
            }}
            isLink={false}
          />
        );
      })}
    </div>
  );
};

/*
 * No record: an entry of the list, as a record's is drawn - the list's
 * icon in its square, the sentence beside it and why under it - with what
 * it looked for and found no record of, when it says.
 */
export const CONNECTED_NO_RECORD_TITLE_CLASS_NAME: string =
  "flex min-h-[2rem] items-center text-sm font-medium text-gray-900 text-pretty";

const NoRecordEntry: FunctionComponent<{
  testId: string;
  title: string;
  description: string;
  notFound: Array<SecurityEntity>;
}> = (props: {
  testId: string;
  title: string;
  description: string;
  notFound: Array<SecurityEntity>;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="flex items-start gap-3" data-testid={props.testId}>
      <span className={CONNECTED_ENTRY_ICON_CLASS_NAME}>
        <Icon icon={IconProp.Link} className="h-4 w-4 text-gray-400" />
      </span>
      <div className={CONNECTED_RECORD_TEXT_CLASS_NAME}>
        <p className={CONNECTED_NO_RECORD_TITLE_CLASS_NAME}>
          {translator.translateText(props.title)}
        </p>
        <p className="text-sm text-gray-500 text-pretty">
          {translator.translateText(props.description)}
        </p>
        {props.notFound.length > 0 ? (
          <div data-testid={SECURITY_CONNECTIONS_TEST_IDS.notFound}>
            <NotFoundChips values={props.notFound} className="mt-2" />
          </div>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

// "+2 more", after the items a fact lists.
const MoreItems: FunctionComponent<{ count: number }> = (props: {
  count: number;
}): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.count <= 0) {
    return <></>;
  }

  return (
    <li className="text-gray-500">
      {translator.translatePlural(CONNECTED_MORE, props.count)}
    </li>
  );
};

const FactRecordList: FunctionComponent<{
  list: SecurityConnectionRecordListJson;
  getRoute: (id: string) => Route | null;
  // The list the records' states are of: incident states for incidents.
  stateList?: StateListType | undefined;
}> = (props: {
  list: SecurityConnectionRecordListJson;
  getRoute: (id: string) => Route | null;
  stateList?: StateListType | undefined;
}): ReactElement => {
  return (
    <ul className="space-y-1">
      {props.list.items.map(
        (item: SecurityConnectionRecordJson): ReactElement => {
          return (
            <FactRecordItem
              key={item.id}
              item={item}
              route={props.getRoute(item.id)}
              stateList={props.stateList}
            />
          );
        },
      )}
      <MoreItems count={props.list.count - props.list.items.length} />
    </ul>
  );
};

// One fact of a record: its label, and its items.
const FactRow: FunctionComponent<{
  testId: string;
  label: string;
  labelClassName: string;
  children: ReactNode;
}> = (props: {
  testId: string;
  label: string;
  labelClassName: string;
  children: ReactNode;
}): ReactElement => {
  return (
    <div className={CONNECTED_FACT_ROW_CLASS_NAME} data-testid={props.testId}>
      <dt
        className={`font-medium ${props.labelClassName}`}
        data-testid={SECURITY_CONNECTIONS_TEST_IDS.factLabel}
      >
        {props.label}
      </dt>
      <dd className="min-w-0">{props.children}</dd>
    </div>
  );
};

const ConnectedRecord: FunctionComponent<{
  resource: SecurityConnectedResourceJson;
  windowStart: string;
  windowEnd: string;
}> = (props: {
  resource: SecurityConnectedResourceJson;
  windowStart: string;
  windowEnd: string;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const resource: SecurityConnectedResourceJson = props.resource;
  const route: Route | null = getConnectedRecordRoute(
    resource.kind,
    resource.id,
  );
  // A member's: null when they could not be read, left out for anyone else.
  const schedules: SecurityConnectionScheduleListJson | null =
    resource.onCallSchedules || null;
  const teams: SecurityConnectionRecordListJson | null = resource.teams || null;
  const match: SecurityConnectedResourceJson["matches"][number] | null =
    getLeadingMatch(resource);
  const links: Array<SignalLink> = getSignalLinks({
    resource,
    windowStart: props.windowStart,
    windowEnd: props.windowEnd,
  });
  const isPossible: boolean =
    resource.certainty === SecurityConnectionCertainty.Possible;
  const name: string =
    resource.name || translator.translateText("Unnamed") || "Unnamed";
  const incidents: SecurityConnectionRecordListJson | null =
    resource.activeIncidents;
  const alerts: SecurityConnectionRecordListJson | null = resource.activeAlerts;
  const monitors: SecurityConnectionRecordListJson | null = resource.monitors;
  const isQuiet: boolean =
    incidents !== null &&
    alerts !== null &&
    incidents.count === 0 &&
    alerts.count === 0;
  const changes: Array<SecurityConnectionChangeJson> =
    resource.recentChanges || [];
  const hasFacts: boolean =
    isQuiet ||
    Boolean(incidents && incidents.count > 0) ||
    Boolean(alerts && alerts.count > 0) ||
    Boolean(monitors && monitors.count > 0) ||
    changes.length > 0 ||
    Boolean(schedules && schedules.count > 0) ||
    Boolean(teams && teams.count > 0);

  return (
    <li
      className="py-4 first:pt-0 last:pb-0"
      data-testid={SECURITY_CONNECTIONS_TEST_IDS.record}
      data-kind={resource.kind}
      data-certainty={resource.certainty}
    >
      <div className="flex items-start gap-3">
        <span className={CONNECTED_ENTRY_ICON_CLASS_NAME}>
          <Icon
            icon={CONNECTION_KIND_ICONS[resource.kind]}
            className="h-4 w-4 text-gray-600"
          />
        </span>
        <div className={CONNECTED_RECORD_TEXT_CLASS_NAME}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {route ? (
              <AppLink
                to={route}
                className="min-w-0 text-sm font-semibold text-gray-900 hover:text-indigo-700 hover:underline [overflow-wrap:anywhere]"
                dataTestId={SECURITY_CONNECTIONS_TEST_IDS.recordName}
              >
                <bdi>{name}</bdi>
              </AppLink>
            ) : (
              <span
                className="min-w-0 text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]"
                data-testid={SECURITY_CONNECTIONS_TEST_IDS.recordName}
              >
                <bdi>{name}</bdi>
              </span>
            )}
            <span className="text-xs font-medium text-gray-500">
              {translator.translateText(CONNECTION_KIND_LABELS[resource.kind])}
            </span>
            {/* A monitor's status now, as the project names it. */}
            {resource.status ? (
              <span data-testid={SECURITY_CONNECTIONS_TEST_IDS.monitorStatus}>
                <Pill
                  text={resource.status.name}
                  isUserContent={isRecordNameAsWritten(
                    StateListType.MonitorStatus,
                    resource.status.name,
                  )}
                  color={readColor(resource.status.color)}
                  size={PillSize.Small}
                />
              </span>
            ) : (
              <></>
            )}
            {isPossible ? (
              <span data-testid={SECURITY_CONNECTIONS_TEST_IDS.possiblePill}>
                <Pill
                  text={CONNECTED_POSSIBLE_PILL}
                  color={Yellow}
                  size={PillSize.Small}
                  tooltip={CONNECTED_POSSIBLE_TOOLTIP}
                />
              </span>
            ) : (
              <></>
            )}
          </div>
          {match ? (
            <p
              className="mt-0.5 text-sm text-gray-600 text-pretty [overflow-wrap:anywhere]"
              data-testid={SECURITY_CONNECTIONS_TEST_IDS.recordReason}
            >
              {/*
               * Drawn and nothing else, so its values are set apart: in a
               * Persian sentence what the case named and what the record
               * holds - an address, a URL, a host - are each an isolate,
               * read left to right in one piece, its punctuation at its
               * own ends.
               */}
              {translator.translateTemplate(
                getConnectionReasonTemplate({ kind: resource.kind, match }),
                {
                  value: match.entityValue,
                  matched: match.matchedValue,
                },
                { setsValuesApart: true },
              )}
            </p>
          ) : (
            <></>
          )}
          {/*
           * A group of links, named for the record - not a navigation
           * landmark of its own: ten records would put ten of them in a
           * screen reader's list of the page's landmarks.
           */}
          {links.length > 0 ? (
            <div
              role="group"
              className="mt-2 flex flex-wrap gap-1.5"
              aria-label={translator.translateTemplate(
                SIGNAL_LINKS_ARIA_LABEL,
                { name },
              )}
              data-testid={SECURITY_CONNECTIONS_TEST_IDS.signalLinks}
            >
              {links.map((link: SignalLink): ReactElement => {
                return (
                  <AppLink
                    key={link.key}
                    to={link.route}
                    className={SIGNAL_LINK_CLASS_NAME}
                    dataTestId={`security-connected-link-${link.key}`}
                  >
                    <Icon
                      icon={SIGNAL_LINK_ICONS[link.key] || IconProp.Link}
                      className="h-3.5 w-3.5 shrink-0 text-gray-400"
                    />
                    <span>
                      {translator.translateText(
                        SIGNAL_LINK_LABELS[link.key] || "",
                      )}
                    </span>
                  </AppLink>
                );
              })}
            </div>
          ) : (
            <></>
          )}
          {hasFacts ? (
            <div
              className="mt-3 space-y-2 text-sm text-gray-600"
              data-testid={SECURITY_CONNECTIONS_TEST_IDS.facts}
            >
              {isQuiet ? (
                <p
                  className="text-gray-500"
                  data-testid={SECURITY_CONNECTIONS_TEST_IDS.nothingActive}
                >
                  {translator.translateText(CONNECTED_NOTHING_ACTIVE)}
                </p>
              ) : (
                <></>
              )}
              <dl className="space-y-2">
                {incidents && incidents.count > 0 ? (
                  <FactRow
                    testId={SECURITY_CONNECTIONS_TEST_IDS.incidents}
                    label={translator.translatePlural(
                      CONNECTED_ACTIVE_INCIDENTS,
                      incidents.count,
                    )}
                    labelClassName="text-red-700"
                  >
                    <FactRecordList
                      list={incidents}
                      getRoute={getIncidentRoute}
                      stateList={StateListType.IncidentState}
                    />
                  </FactRow>
                ) : (
                  <></>
                )}
                {alerts && alerts.count > 0 ? (
                  <FactRow
                    testId={SECURITY_CONNECTIONS_TEST_IDS.alerts}
                    label={translator.translatePlural(
                      CONNECTED_ACTIVE_ALERTS,
                      alerts.count,
                    )}
                    labelClassName="text-amber-700"
                  >
                    <FactRecordList
                      list={alerts}
                      getRoute={getAlertRoute}
                      stateList={StateListType.AlertState}
                    />
                  </FactRow>
                ) : (
                  <></>
                )}
                {monitors && monitors.count > 0 ? (
                  <FactRow
                    testId={SECURITY_CONNECTIONS_TEST_IDS.monitors}
                    label={translator.translatePlural(
                      CONNECTED_MONITORS,
                      monitors.count,
                    )}
                    labelClassName="text-gray-700"
                  >
                    <FactRecordList
                      list={monitors}
                      getRoute={getMonitorRoute}
                      stateList={StateListType.MonitorStatus}
                    />
                  </FactRow>
                ) : (
                  <></>
                )}
                {changes.length > 0 ? (
                  <FactRow
                    testId={SECURITY_CONNECTIONS_TEST_IDS.changes}
                    label={
                      translator.translateText(CONNECTED_CHANGES_TITLE) ||
                      CONNECTED_CHANGES_TITLE
                    }
                    labelClassName="text-gray-700"
                  >
                    <ul className="space-y-1">
                      {changes.map(
                        (
                          change: SecurityConnectionChangeJson,
                          index: number,
                        ): ReactElement => {
                          return (
                            <li
                              key={`${change.id}-${index}`}
                              className={CONNECTED_CHANGE_ITEM_CLASS_NAME}
                              data-testid={
                                SECURITY_CONNECTIONS_TEST_IDS.factItem
                              }
                            >
                              <time
                                dateTime={change.time}
                                className="shrink-0 whitespace-nowrap tabular-nums text-gray-500"
                                title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                                  new Date(change.time),
                                )}
                              >
                                {OneUptimeDate.getDateAsLocalShortDateTimeString(
                                  change.time,
                                )}
                              </time>
                              <span
                                className={CONNECTED_CHANGE_TITLE_CLASS_NAME}
                              >
                                {/*
                                 * Set apart, each title its own way: one
                                 * worded in the reader's language reads
                                 * theirs - a Persian health event right to
                                 * left, though it starts with "AWS
                                 * Health:" - a deploy's or a pipeline's
                                 * title its own (getChangeTitleDirection).
                                 */}
                                <bdi
                                  dir={getChangeTitleDirection({
                                    facts: change.cloudChange,
                                    health: change.cloudHealth,
                                    translator,
                                  })}
                                >
                                  {getChangeTitleForReader({
                                    title: change.title,
                                    eventType: change.eventType,
                                    facts: change.cloudChange,
                                    health: change.cloudHealth,
                                    translator,
                                    options: { setsValuesApart: true },
                                  })}
                                </bdi>
                              </span>
                            </li>
                          );
                        },
                      )}
                    </ul>
                  </FactRow>
                ) : (
                  <></>
                )}
                {schedules && schedules.count > 0 ? (
                  <FactRow
                    testId={SECURITY_CONNECTIONS_TEST_IDS.schedules}
                    label={translator.translatePlural(
                      CONNECTED_ON_CALL_SCHEDULES,
                      schedules.count,
                    )}
                    labelClassName="text-gray-700"
                  >
                    <ul className="space-y-1">
                      {schedules.items.map(
                        (
                          schedule: SecurityConnectionScheduleJson,
                        ): ReactElement => {
                          return (
                            <ScheduleItem
                              key={schedule.id}
                              schedule={schedule}
                            />
                          );
                        },
                      )}
                      <MoreItems
                        count={schedules.count - schedules.items.length}
                      />
                    </ul>
                  </FactRow>
                ) : (
                  <></>
                )}
                {teams && teams.count > 0 ? (
                  <FactRow
                    testId={SECURITY_CONNECTIONS_TEST_IDS.teams}
                    label={translator.translatePlural(
                      CONNECTED_TEAMS,
                      teams.count,
                    )}
                    labelClassName="text-gray-700"
                  >
                    <FactRecordList list={teams} getRoute={getTeamRoute} />
                  </FactRow>
                ) : (
                  <></>
                )}
              </dl>
            </div>
          ) : (
            <></>
          )}
        </div>
      </div>
    </li>
  );
};

const RecordList: FunctionComponent<{
  resources: Array<SecurityConnectedResourceJson>;
  windowStart: string;
  windowEnd: string;
}> = (props: {
  resources: Array<SecurityConnectedResourceJson>;
  windowStart: string;
  windowEnd: string;
}): ReactElement => {
  return (
    <ul className="divide-y divide-gray-100">
      {props.resources.map(
        (resource: SecurityConnectedResourceJson): ReactElement => {
          return (
            <ConnectedRecord
              key={`${resource.kind}:${resource.id}`}
              resource={resource}
              windowStart={props.windowStart}
              windowEnd={props.windowEnd}
            />
          );
        },
      )}
    </ul>
  );
};

// "Hosts and services": the kinds a note names, in the reader's language.
function kindNames(
  translator: Translator,
  kinds: Array<SecurityConnectionKind>,
): string {
  return formatNameList(
    kinds.map((kind: SecurityConnectionKind): string => {
      return (
        translator.translateText(CONNECTION_KIND_PLURALS[kind]) ||
        CONNECTION_KIND_PLURALS[kind]
      );
    }),
    "and",
    translator,
  );
}

const ConnectedSignals: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [connections, setConnections] =
    useState<SecurityConnectionsJson | null>(null);
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  const [shownKey, setShownKey] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;

    // Another case or event starts afresh; the same one keeps what it shows.
    if (shownKey !== props.requestKey) {
      setConnections(null);
      setShownKey(props.requestKey);
    }

    setError("");

    SecurityCaseApi.getConnections(props.request)
      .then((result: SecurityConnectionsJson) => {
        if (isCurrent) {
          setConnections(result);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err as Error));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [props.requestKey, props.refreshToken, readCount]);

  const reread: () => void = (): void => {
    setReadCount((count: number): number => {
      return count + 1;
    });
  };

  let body: ReactElement;

  if (error) {
    body = (
      <div data-testid={SECURITY_CONNECTIONS_TEST_IDS.error}>
        <ErrorMessage message={error} onRefreshClick={reread} />
      </div>
    );
  } else if (!connections) {
    body = <ComponentLoader />;
  } else {
    const notFound: Array<SecurityEntity> = connections.unmatched;
    const state: ConnectedSignalsState = getConnectedSignalsState(connections);
    const groups: ConnectedSignalsGroups =
      getConnectedSignalsGroups(connections);

    body = (
      <div className="space-y-4">
        {state === "records" &&
        connections.windowStart &&
        connections.windowEnd ? (
          <div
            className="flex items-center gap-1.5 text-xs text-gray-500"
            data-testid={SECURITY_CONNECTIONS_TEST_IDS.window}
          >
            <Icon
              icon={IconProp.Clock}
              className="h-3.5 w-3.5 shrink-0 text-gray-400"
            />
            <span>
              {translator.translateTemplate(CONNECTED_WINDOW, {
                start: OneUptimeDate.getDateAsLocalShortDateTimeString(
                  connections.windowStart,
                ),
                end: OneUptimeDate.getDateAsLocalShortDateTimeString(
                  connections.windowEnd,
                ),
              })}
            </span>
          </div>
        ) : (
          <></>
        )}

        {groups.exact.length > 0 ? (
          <RecordList
            resources={groups.exact}
            windowStart={connections.windowStart}
            windowEnd={connections.windowEnd}
          />
        ) : (
          <></>
        )}

        {groups.possible.length > 0 ? (
          <section
            className={
              groups.exact.length > 0 ? "border-t border-gray-100 pt-4" : ""
            }
            data-testid={SECURITY_CONNECTIONS_TEST_IDS.possibleGroup}
          >
            <h3 className={SECTION_HEADING_CLASS_NAME}>
              {translator.translateText(CONNECTED_POSSIBLE_GROUP_TITLE)}
            </h3>
            <p className="mb-4 mt-0.5 text-sm text-gray-500 text-pretty">
              {translator.translateText(CONNECTED_POSSIBLE_GROUP_DESCRIPTION)}
            </p>
            <RecordList
              resources={groups.possible}
              windowStart={connections.windowStart}
              windowEnd={connections.windowEnd}
            />
          </section>
        ) : (
          <></>
        )}

        {/*
         * No record: every kind read and none matches; a kind could not be
         * read, so one may still match; or nothing it names can match one.
         * What it looked for goes under the sentence that says so.
         */}
        {state === "nothing-found" ? (
          <NoRecordEntry
            testId={SECURITY_CONNECTIONS_TEST_IDS.empty}
            title={CONNECTED_EMPTY_TITLE}
            description={CONNECTED_EMPTY_DESCRIPTION}
            notFound={notFound}
          />
        ) : (
          <></>
        )}

        {state === "partly-read" ? (
          <NoRecordEntry
            testId={SECURITY_CONNECTIONS_TEST_IDS.partialEmpty}
            title={CONNECTED_PARTIAL_EMPTY_TITLE}
            description={CONNECTED_PARTIAL_EMPTY_DESCRIPTION}
            notFound={notFound}
          />
        ) : (
          <></>
        )}

        {state === "nothing-to-look-up" ? (
          <NoRecordEntry
            testId={SECURITY_CONNECTIONS_TEST_IDS.nothingToLookUp}
            title={CONNECTED_NOTHING_TO_LOOK_UP_TITLE}
            description={CONNECTED_NOTHING_TO_LOOK_UP_DESCRIPTION}
            notFound={[]}
          />
        ) : (
          <></>
        )}

        {connections.hasMoreResources ? (
          <p
            className="text-sm text-gray-500"
            data-testid={SECURITY_CONNECTIONS_TEST_IDS.moreRecords}
          >
            {translator.translateText(CONNECTED_MORE_RECORDS)}
          </p>
        ) : (
          <></>
        )}

        {/* Beside records: what it looked for that no record matches. */}
        {state === "records" && notFound.length > 0 ? (
          <div
            className="border-t border-gray-100 pt-3"
            data-testid={SECURITY_CONNECTIONS_TEST_IDS.notFound}
          >
            <h3 className={`mb-1.5 ${SECTION_HEADING_CLASS_NAME}`}>
              {translator.translateText(CONNECTED_NOT_FOUND_TITLE)}
            </h3>
            <NotFoundChips values={notFound} />
          </div>
        ) : (
          <></>
        )}

        {connections.unreadableKinds.length > 0 ? (
          <p
            className="text-sm text-gray-500"
            data-testid={SECURITY_CONNECTIONS_TEST_IDS.unreadable}
          >
            {translator.translateTemplate(CONNECTED_UNREADABLE, {
              kinds: composedValue((sentence: Translator): string => {
                return kindNames(sentence, connections.unreadableKinds);
              }),
            })}
          </p>
        ) : (
          <></>
        )}

        {connections.failedKinds.length > 0 ? (
          <p
            className="flex flex-wrap items-center gap-x-2 text-sm text-amber-700"
            data-testid={SECURITY_CONNECTIONS_TEST_IDS.failed}
          >
            <span>
              {translator.translateTemplate(CONNECTED_FAILED, {
                kinds: composedValue((sentence: Translator): string => {
                  return kindNames(sentence, connections.failedKinds);
                }),
              })}
            </span>
            <button
              type="button"
              className="rounded font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              onClick={reread}
            >
              {translator.translateText(CONNECTED_TRY_AGAIN)}
            </button>
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  }

  /*
   * Read with the records, not after them: the two reads run side by side,
   * and the logs and traces show under the records when they are in.
   */
  const telemetry: ReactElement = (
    <TelemetryMentions
      request={props.request}
      requestKey={props.requestKey}
      refreshToken={props.refreshToken}
      className={TELEMETRY_SECTION_CLASS_NAME}
    />
  );

  if (props.isEmbedded) {
    return (
      <div
        className="[container-type:inline-size]"
        data-testid={SECURITY_CONNECTIONS_TEST_IDS.connectedSignals}
      >
        <p className="mb-3 text-sm text-gray-600">
          {translator.translateText(props.description)}
        </p>
        {body}
        {telemetry}
      </div>
    );
  }

  return (
    <div data-testid={SECURITY_CONNECTIONS_TEST_IDS.connectedSignals}>
      <Card title={CONNECTED_SIGNALS_TITLE} description={props.description}>
        <>
          {body}
          {telemetry}
        </>
      </Card>
    </div>
  );
};

export default ConnectedSignals;
