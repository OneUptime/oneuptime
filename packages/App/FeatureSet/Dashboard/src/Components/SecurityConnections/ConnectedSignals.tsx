import AppLink from "../AppLink/AppLink";
import SecurityCaseApi, {
  SecurityConnectionsRequest,
} from "../SecurityCase/SecurityCaseApi";
import { SecurityEntityChip } from "../SecurityCase/SecurityEntityChips";
import { formatNameList } from "../AiAccess/AiAccessModes";
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
  CONNECTED_POSSIBLE_PILL,
  CONNECTED_POSSIBLE_TOOLTIP,
  CONNECTED_SIGNALS_TITLE,
  CONNECTED_TRY_AGAIN,
  CONNECTED_UNREADABLE,
  CONNECTED_WINDOW,
  CONNECTION_KIND_ICONS,
  CONNECTION_KIND_LABELS,
  CONNECTION_KIND_PLURALS,
  CONNECTION_REASON_TEXT,
  SECURITY_CONNECTIONS_TEST_IDS,
  SIGNAL_LINKS_ARIA_LABEL,
  SIGNAL_LINK_ICONS,
  SIGNAL_LINK_LABELS,
} from "./SecurityConnectionsCopy";
import {
  SignalLink,
  getAlertRoute,
  getConnectedRecordRoute,
  getIncidentRoute,
  getLeadingMatch,
  getMonitorRoute,
  getSignalLinks,
} from "./SecurityConnectionsModel";
import Route from "Common/Types/API/Route";
import { Yellow } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SecurityConnectedResourceJson,
  SecurityConnectionCertainty,
  SecurityConnectionChangeJson,
  SecurityConnectionKind,
  SecurityConnectionRecordJson,
  SecurityConnectionRecordListJson,
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
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import API from "Common/UI/Utils/API/API";
import { Translator, composedValue } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * CONNECTED SIGNALS: what a case, an event or an entity names in the rest of
 * OneUptime, and what was happening on each around it.
 *
 * One line per record - a host, a container host, a cluster, a network
 * device, a service, a user - exact connections first: its name, opening its
 * page; why OneUptime connects it, said as a sentence, and when it is only a
 * possible match, a pill that says so; its signals, each opening its
 * explorer (or its own page) on it and the window; and what is going on
 * there: the incidents and alerts open on it, the monitors watching it,
 * what changed on it in the window. Then what OneUptime looked for and did
 * not find, and what the reader's role keeps from them.
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
  "text-gray-900 hover:text-indigo-700 hover:underline [overflow-wrap:anywhere]";

const RecordList: FunctionComponent<{
  list: SecurityConnectionRecordListJson;
  getRoute: (id: string) => Route | null;
}> = (props: {
  list: SecurityConnectionRecordListJson;
  getRoute: (id: string) => Route | null;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const more: number = props.list.count - props.list.items.length;

  return (
    <>
      {props.list.items.map(
        (item: SecurityConnectionRecordJson, index: number): ReactElement => {
          const route: Route | null = props.getRoute(item.id);
          const text: string = `${item.number ? `${item.number} ` : ""}${item.title}`;

          return (
            <React.Fragment key={item.id}>
              {index > 0 ? <span className="text-gray-400"> · </span> : <></>}
              {route ? (
                <AppLink to={route} className={FACT_LINK_CLASS_NAME}>
                  {text}
                </AppLink>
              ) : (
                <span className="text-gray-900">{text}</span>
              )}
              {item.stateName ? (
                <span className="text-gray-500"> ({item.stateName})</span>
              ) : (
                <></>
              )}
            </React.Fragment>
          );
        },
      )}
      {more > 0 ? (
        <span className="text-gray-500">
          {" "}
          {translator.translatePlural(CONNECTED_MORE, more)}
        </span>
      ) : (
        <></>
      )}
    </>
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
  const isQuiet: boolean =
    incidents !== null &&
    alerts !== null &&
    incidents.count === 0 &&
    alerts.count === 0;
  const changes: Array<SecurityConnectionChangeJson> =
    resource.recentChanges || [];

  return (
    <li
      className="py-4 first:pt-0 last:pb-0"
      data-testid={SECURITY_CONNECTIONS_TEST_IDS.record}
      data-kind={resource.kind}
      data-certainty={resource.certainty}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-50 ring-1 ring-inset ring-gray-200">
          <Icon
            icon={CONNECTION_KIND_ICONS[resource.kind]}
            className="h-4 w-4 text-gray-600"
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {route ? (
              <AppLink
                to={route}
                className="min-w-0 text-sm font-semibold text-gray-900 hover:text-indigo-700 hover:underline [overflow-wrap:anywhere]"
                dataTestId={SECURITY_CONNECTIONS_TEST_IDS.recordName}
              >
                {name}
              </AppLink>
            ) : (
              <span
                className="min-w-0 text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]"
                data-testid={SECURITY_CONNECTIONS_TEST_IDS.recordName}
              >
                {name}
              </span>
            )}
            <span className="text-xs font-medium text-gray-500">
              {translator.translateText(CONNECTION_KIND_LABELS[resource.kind])}
            </span>
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
              {translator.translateTemplate(
                CONNECTION_REASON_TEXT[match.reason],
                {
                  value: match.entityValue,
                  matched: match.matchedValue,
                },
              )}
            </p>
          ) : (
            <></>
          )}
          {links.length > 0 ? (
            <nav
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
            </nav>
          ) : (
            <></>
          )}
          <div
            className="mt-2 space-y-1 text-sm text-gray-600"
            data-testid={SECURITY_CONNECTIONS_TEST_IDS.facts}
          >
            {incidents && incidents.count > 0 ? (
              <p data-testid={SECURITY_CONNECTIONS_TEST_IDS.incidents}>
                <span className="font-medium text-red-700">
                  {translator.translatePlural(
                    CONNECTED_ACTIVE_INCIDENTS,
                    incidents.count,
                  )}
                </span>
                <span className="text-gray-400">: </span>
                <RecordList list={incidents} getRoute={getIncidentRoute} />
              </p>
            ) : (
              <></>
            )}
            {alerts && alerts.count > 0 ? (
              <p data-testid={SECURITY_CONNECTIONS_TEST_IDS.alerts}>
                <span className="font-medium text-amber-700">
                  {translator.translatePlural(
                    CONNECTED_ACTIVE_ALERTS,
                    alerts.count,
                  )}
                </span>
                <span className="text-gray-400">: </span>
                <RecordList list={alerts} getRoute={getAlertRoute} />
              </p>
            ) : (
              <></>
            )}
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
            {resource.monitors && resource.monitors.count > 0 ? (
              <p data-testid={SECURITY_CONNECTIONS_TEST_IDS.monitors}>
                <span className="font-medium text-gray-700">
                  {translator.translatePlural(
                    CONNECTED_MONITORS,
                    resource.monitors.count,
                  )}
                </span>
                <span className="text-gray-400">: </span>
                <RecordList
                  list={resource.monitors}
                  getRoute={getMonitorRoute}
                />
              </p>
            ) : (
              <></>
            )}
            {changes.length > 0 ? (
              <div data-testid={SECURITY_CONNECTIONS_TEST_IDS.changes}>
                <span className="font-medium text-gray-700">
                  {translator.translateText(CONNECTED_CHANGES_TITLE)}
                </span>
                <span className="text-gray-400">: </span>
                {changes.map(
                  (
                    change: SecurityConnectionChangeJson,
                    index: number,
                  ): ReactElement => {
                    return (
                      <React.Fragment key={`${change.id}-${index}`}>
                        {index > 0 ? (
                          <span className="text-gray-400"> · </span>
                        ) : (
                          <></>
                        )}
                        <span className="text-gray-900 [overflow-wrap:anywhere]">
                          {change.title || change.eventType}
                        </span>
                        <span
                          className="whitespace-nowrap text-gray-500"
                          title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                            new Date(change.time),
                          )}
                        >
                          {" "}
                          {OneUptimeDate.getDateAsLocalShortDateTimeString(
                            change.time,
                          )}
                        </span>
                      </React.Fragment>
                    );
                  },
                )}
              </div>
            ) : (
              <></>
            )}
          </div>
        </div>
      </div>
    </li>
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
    const hasRecords: boolean = connections.resources.length > 0;
    const hasLookedUp: boolean =
      hasRecords ||
      notFound.length > 0 ||
      connections.failedKinds.length > 0 ||
      connections.unreadableKinds.length > 0;

    body = (
      <div className="space-y-4">
        {connections.windowStart && connections.windowEnd ? (
          <p
            className="flex items-center gap-1.5 text-xs text-gray-500"
            data-testid={SECURITY_CONNECTIONS_TEST_IDS.window}
          >
            <Icon icon={IconProp.Clock} className="h-3.5 w-3.5 text-gray-400" />
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
          </p>
        ) : (
          <></>
        )}

        {hasRecords ? (
          <ul className="divide-y divide-gray-100">
            {connections.resources.map(
              (resource: SecurityConnectedResourceJson): ReactElement => {
                return (
                  <ConnectedRecord
                    key={`${resource.kind}:${resource.id}`}
                    resource={resource}
                    windowStart={connections.windowStart}
                    windowEnd={connections.windowEnd}
                  />
                );
              },
            )}
          </ul>
        ) : hasLookedUp ? (
          <div data-testid={SECURITY_CONNECTIONS_TEST_IDS.empty}>
            <TableEmptyState
              kind={TableEmptyStateKind.Empty}
              icon={IconProp.Link}
              title={translator.translateText(CONNECTED_EMPTY_TITLE) || ""}
              description={translator.translateText(
                CONNECTED_EMPTY_DESCRIPTION,
              )}
              isCompact={true}
            />
          </div>
        ) : (
          <div data-testid={SECURITY_CONNECTIONS_TEST_IDS.nothingToLookUp}>
            <TableEmptyState
              kind={TableEmptyStateKind.Empty}
              icon={IconProp.Link}
              title={
                translator.translateText(CONNECTED_NOTHING_TO_LOOK_UP_TITLE) ||
                ""
              }
              description={translator.translateText(
                CONNECTED_NOTHING_TO_LOOK_UP_DESCRIPTION,
              )}
              isCompact={true}
            />
          </div>
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

        {notFound.length > 0 ? (
          <div
            className="border-t border-gray-100 pt-3"
            data-testid={SECURITY_CONNECTIONS_TEST_IDS.notFound}
          >
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
              {translator.translateText(CONNECTED_NOT_FOUND_TITLE)}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {notFound.map((entity: SecurityEntity, index: number) => {
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
              className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
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
      </div>
    );
  }

  return (
    <div data-testid={SECURITY_CONNECTIONS_TEST_IDS.connectedSignals}>
      <Card title={CONNECTED_SIGNALS_TITLE} description={props.description}>
        {body}
      </Card>
    </div>
  );
};

export default ConnectedSignals;
