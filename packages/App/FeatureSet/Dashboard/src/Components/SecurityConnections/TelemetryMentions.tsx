import AppLink from "../AppLink/AppLink";
import SecurityCaseApi, {
  SecurityConnectionsRequest,
} from "../SecurityCase/SecurityCaseApi";
import { SecurityEntityChip } from "../SecurityCase/SecurityEntityChips";
import { formatNameList } from "../AiAccess/AiAccessModes";
import {
  CONNECTED_MORE,
  CONNECTED_TRY_AGAIN,
  CONNECTION_KIND_LABELS,
  SECURITY_CONNECTIONS_TEST_IDS,
  TELEMETRY_FAILED,
  TELEMETRY_LOG_LINES,
  TELEMETRY_MENTIONS_DESCRIPTION,
  TELEMETRY_MENTIONS_TITLE,
  TELEMETRY_MORE_VALUES,
  TELEMETRY_NOT_FOUND_TITLE,
  TELEMETRY_OPEN_IN_LOGS,
  TELEMETRY_OPEN_IN_TRACES,
  TELEMETRY_PLACE_MESSAGE,
  TELEMETRY_SIGNAL_LABELS,
  TELEMETRY_SPANS,
  TELEMETRY_UNREADABLE,
} from "./SecurityConnectionsCopy";
import {
  TelemetryMentionsGroups,
  getTelemetryHits,
  getTelemetryMentionsGroups,
  getTelemetryPlaceRoute,
  getTelemetrySourceRoute,
} from "./SecurityConnectionsModel";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SECURITY_TELEMETRY_MESSAGE_PLACE,
  SECURITY_TELEMETRY_SIGNALS,
  SecurityTelemetryHitsJson,
  SecurityTelemetryMentionsJson,
  SecurityTelemetryPlaceJson,
  SecurityTelemetrySignal,
  SecurityTelemetrySourceJson,
  SecurityTelemetryValueJson,
} from "Common/Types/SecurityCase/SecurityConnection";
import {
  SecurityEntity,
  SecurityEntityType,
} from "Common/Types/SecurityCase/SecurityEntity";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
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
 * IN YOUR LOGS AND TRACES: where the values a case, an event or an entity
 * names appear in the logs and traces themselves (Common/Server/Utils/
 * SecurityEvent/Connections/SecurityTelemetryMentions), under Connected
 * Signals' records and on its own read, so the records show first.
 *
 * One entry per value found, in the order it was searched: the value, then
 * a row a signal - "In 1,284 log lines", "In 312 spans" - whose items are
 * where in them it was (the message, or an attribute's key), each opening
 * the Logs or the Traces explorer on exactly those lines or spans and the
 * window, and the records that sent them, each opening its page. The
 * values searched and named by none follow; then what the reader's role
 * keeps from them, and what could not be searched just now.
 *
 * Nothing at all for a case that names nothing searched for (a bare host
 * name, a user's bare name, a process): the records above are its answer.
 */

export interface ComponentProps {
  request: SecurityConnectionsRequest;
  // A key the request is told apart by: a new one reads afresh.
  requestKey: string;
  // Change it to read the same request again, keeping what is shown meanwhile.
  refreshToken?: string | number | undefined;
  // The section's own classes: a rule above it, under the records.
  className?: string | undefined;
}

// A section's heading in the card, as Possible matches and No matching record are.
const SECTION_HEADING_CLASS_NAME: string =
  "text-xs font-medium uppercase tracking-wide text-gray-500";

/*
 * A place's link: where in the lines or spans the value was, and how many,
 * as the record's signal links are drawn.
 */
export const TELEMETRY_PLACE_LINK_CLASS_NAME: string =
  "inline-flex max-w-full items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

/*
 * A value's row of one signal, as a record's facts are: the label above
 * its items on a narrow page, beside them from 32rem of the section's own
 * width.
 */
export const TELEMETRY_ROW_CLASS_NAME: string =
  "grid grid-cols-1 gap-x-4 gap-y-1.5 [@container(min-width:32rem)]:grid-cols-[11rem_minmax(0,1fr)]";

function readEntityType(type: string): SecurityEntityType {
  return (Object.values(SecurityEntityType) as Array<string>).includes(type)
    ? (type as SecurityEntityType)
    : SecurityEntityType.Other;
}

function toEntity(value: SecurityTelemetryValueJson): SecurityEntity {
  return {
    type: readEntityType(value.entityType),
    value: value.entityValue,
  };
}

// One place a value was found in, opening its explorer on it.
const PlaceLink: FunctionComponent<{
  signal: SecurityTelemetrySignal;
  value: SecurityTelemetryValueJson;
  place: SecurityTelemetryPlaceJson;
  windowStart: string;
  windowEnd: string;
}> = (props: {
  signal: SecurityTelemetrySignal;
  value: SecurityTelemetryValueJson;
  place: SecurityTelemetryPlaceJson;
  windowStart: string;
  windowEnd: string;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const route: Route | null = getTelemetryPlaceRoute({
    signal: props.signal,
    entityValue: props.value.entityValue,
    place: props.place,
    windowStart: props.windowStart,
    windowEnd: props.windowEnd,
  });
  const isMessage: boolean =
    props.place.key === SECURITY_TELEMETRY_MESSAGE_PLACE;
  const content: ReactElement = (
    <>
      <Icon
        icon={
          props.signal === SecurityTelemetrySignal.Logs
            ? IconProp.Logs
            : IconProp.Workflow
        }
        className="h-3.5 w-3.5 shrink-0 text-gray-400"
      />
      {isMessage ? (
        <span>{translator.translateText(TELEMETRY_PLACE_MESSAGE)}</span>
      ) : (
        // The attribute's key, as the telemetry writes it.
        <bdi className="min-w-0 truncate font-mono">{props.place.key}</bdi>
      )}
      <span className="shrink-0 tabular-nums text-gray-500">
        {translator.formatNumber(props.place.count)}
      </span>
    </>
  );

  if (!route) {
    return (
      <span
        className={TELEMETRY_PLACE_LINK_CLASS_NAME}
        data-testid={SECURITY_CONNECTIONS_TEST_IDS.telemetryPlace}
      >
        {content}
      </span>
    );
  }

  return (
    <AppLink
      to={route}
      className={TELEMETRY_PLACE_LINK_CLASS_NAME}
      title={
        translator.translateText(
          props.signal === SecurityTelemetrySignal.Logs
            ? TELEMETRY_OPEN_IN_LOGS
            : TELEMETRY_OPEN_IN_TRACES,
        ) || ""
      }
      dataTestId={SECURITY_CONNECTIONS_TEST_IDS.telemetryPlace}
    >
      {content}
    </AppLink>
  );
};

// One record that sent the lines or spans: its name, opening its page, its kind and how many.
const SourceItem: FunctionComponent<{
  source: SecurityTelemetrySourceJson;
}> = (props: { source: SecurityTelemetrySourceJson }): ReactElement => {
  const translator: Translator = useTranslator();
  const route: Route | null = getTelemetrySourceRoute(props.source);
  const name: ReactElement = <bdi>{props.source.name}</bdi>;

  return (
    <li
      className="flex min-w-0 flex-wrap items-baseline gap-x-2"
      data-testid={SECURITY_CONNECTIONS_TEST_IDS.telemetrySource}
    >
      {route ? (
        <AppLink
          to={route}
          className="min-w-0 text-gray-900 hover:text-indigo-700 hover:underline [overflow-wrap:anywhere]"
        >
          {name}
        </AppLink>
      ) : (
        <span className="min-w-0 text-gray-900 [overflow-wrap:anywhere]">
          {name}
        </span>
      )}
      <span className="text-xs text-gray-500">
        {translator.translateText(CONNECTION_KIND_LABELS[props.source.kind])}
      </span>
      <span className="text-xs tabular-nums text-gray-500">
        {translator.formatNumber(props.source.count)}
      </span>
    </li>
  );
};

// A value's row of one signal: how many named it, where in them, and who sent them.
const SignalRow: FunctionComponent<{
  signal: SecurityTelemetrySignal;
  value: SecurityTelemetryValueJson;
  hits: SecurityTelemetryHitsJson;
  windowStart: string;
  windowEnd: string;
}> = (props: {
  signal: SecurityTelemetrySignal;
  value: SecurityTelemetryValueJson;
  hits: SecurityTelemetryHitsJson;
  windowStart: string;
  windowEnd: string;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const isLogs: boolean = props.signal === SecurityTelemetrySignal.Logs;
  const moreSources: number =
    props.hits.sourceCount - props.hits.sources.length;

  return (
    <div
      className={TELEMETRY_ROW_CLASS_NAME}
      data-testid={
        isLogs
          ? SECURITY_CONNECTIONS_TEST_IDS.telemetryLogs
          : SECURITY_CONNECTIONS_TEST_IDS.telemetrySpans
      }
    >
      <dt
        className="font-medium text-gray-700"
        data-testid={SECURITY_CONNECTIONS_TEST_IDS.factLabel}
      >
        {translator.translatePlural(
          isLogs ? TELEMETRY_LOG_LINES : TELEMETRY_SPANS,
          props.hits.count,
        )}
      </dt>
      <dd className="min-w-0 space-y-1.5">
        {props.hits.places.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {props.hits.places.map(
              (place: SecurityTelemetryPlaceJson): ReactElement => {
                return (
                  <PlaceLink
                    key={place.key || "message"}
                    signal={props.signal}
                    value={props.value}
                    place={place}
                    windowStart={props.windowStart}
                    windowEnd={props.windowEnd}
                  />
                );
              },
            )}
          </div>
        ) : (
          <></>
        )}
        {props.hits.sources.length > 0 || moreSources > 0 ? (
          <ul className="space-y-0.5">
            {props.hits.sources.map(
              (source: SecurityTelemetrySourceJson): ReactElement => {
                return (
                  <SourceItem
                    key={`${source.kind}:${source.id}`}
                    source={source}
                  />
                );
              },
            )}
            {moreSources > 0 ? (
              <li className="text-gray-500">
                {translator.translatePlural(CONNECTED_MORE, moreSources)}
              </li>
            ) : (
              <></>
            )}
          </ul>
        ) : (
          <></>
        )}
      </dd>
    </div>
  );
};

// "Logs and Traces": the signals a note names, in the reader's language.
function signalNames(
  translator: Translator,
  signals: Array<SecurityTelemetrySignal>,
): string {
  return formatNameList(
    signals.map((signal: SecurityTelemetrySignal): string => {
      return (
        translator.translateText(TELEMETRY_SIGNAL_LABELS[signal]) ||
        TELEMETRY_SIGNAL_LABELS[signal]
      );
    }),
    "and",
    translator,
  );
}

const TelemetryMentions: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [mentions, setMentions] =
    useState<SecurityTelemetryMentionsJson | null>(null);
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  const [shownKey, setShownKey] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;

    // Another case or event starts afresh; the same one keeps what it shows.
    if (shownKey !== props.requestKey) {
      setMentions(null);
      setShownKey(props.requestKey);
    }

    setError("");

    SecurityCaseApi.getTelemetryMentions(props.request)
      .then((result: SecurityTelemetryMentionsJson) => {
        if (isCurrent) {
          setMentions(result);
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

  // A case that names nothing searched for: the records are its answer.
  if (!error && mentions && mentions.values.length === 0) {
    return <></>;
  }

  let body: ReactElement;

  if (error) {
    body = (
      <div data-testid={SECURITY_CONNECTIONS_TEST_IDS.telemetryError}>
        <ErrorMessage message={error} onRefreshClick={reread} />
      </div>
    );
  } else if (!mentions) {
    body = <ComponentLoader />;
  } else {
    const groups: TelemetryMentionsGroups =
      getTelemetryMentionsGroups(mentions);

    body = (
      <div className="space-y-4">
        {groups.found.length > 0 ? (
          <ul className="divide-y divide-gray-100">
            {groups.found.map(
              (
                value: SecurityTelemetryValueJson,
                index: number,
              ): ReactElement => {
                return (
                  <li
                    key={`${value.entityValue}-${index}`}
                    className="py-3 first:pt-0 last:pb-0"
                    data-testid={SECURITY_CONNECTIONS_TEST_IDS.telemetryValue}
                  >
                    <div className="mb-2 flex min-w-0">
                      <SecurityEntityChip
                        entity={toEntity(value)}
                        isLink={false}
                        isValueWrapped={true}
                      />
                    </div>
                    <dl className="space-y-2 text-sm text-gray-600">
                      {SECURITY_TELEMETRY_SIGNALS.map(
                        (signal: SecurityTelemetrySignal): ReactElement => {
                          const hits: SecurityTelemetryHitsJson | null =
                            getTelemetryHits(value, signal);

                          return hits ? (
                            <SignalRow
                              key={signal}
                              signal={signal}
                              value={value}
                              hits={hits}
                              windowStart={mentions.windowStart}
                              windowEnd={mentions.windowEnd}
                            />
                          ) : (
                            <React.Fragment key={signal}></React.Fragment>
                          );
                        },
                      )}
                    </dl>
                  </li>
                );
              },
            )}
          </ul>
        ) : (
          <></>
        )}

        {groups.notFound.length > 0 ? (
          <div
            className={
              groups.found.length > 0 ? "border-t border-gray-100 pt-3" : ""
            }
            data-testid={SECURITY_CONNECTIONS_TEST_IDS.telemetryNotFound}
          >
            <h4 className={`mb-1.5 ${SECTION_HEADING_CLASS_NAME}`}>
              {translator.translateText(TELEMETRY_NOT_FOUND_TITLE)}
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {groups.notFound.map(
                (
                  value: SecurityTelemetryValueJson,
                  index: number,
                ): ReactElement => {
                  return (
                    <SecurityEntityChip
                      key={`${value.entityValue}-${index}`}
                      entity={toEntity(value)}
                      isLink={false}
                    />
                  );
                },
              )}
            </div>
          </div>
        ) : (
          <></>
        )}

        {mentions.hasMoreValues ? (
          <p
            className="text-sm text-gray-500"
            data-testid={SECURITY_CONNECTIONS_TEST_IDS.telemetryMoreValues}
          >
            {translator.translateText(TELEMETRY_MORE_VALUES)}
          </p>
        ) : (
          <></>
        )}

        {mentions.unreadableSignals.length > 0 ? (
          <p
            className="text-sm text-gray-500"
            data-testid={SECURITY_CONNECTIONS_TEST_IDS.telemetryUnreadable}
          >
            {translator.translateTemplate(TELEMETRY_UNREADABLE, {
              signals: composedValue((sentence: Translator): string => {
                return signalNames(sentence, mentions.unreadableSignals);
              }),
            })}
          </p>
        ) : (
          <></>
        )}

        {mentions.failedSignals.length > 0 ? (
          <p
            className="flex flex-wrap items-center gap-x-2 text-sm text-amber-700"
            data-testid={SECURITY_CONNECTIONS_TEST_IDS.telemetryFailed}
          >
            <span>
              {translator.translateTemplate(TELEMETRY_FAILED, {
                signals: composedValue((sentence: Translator): string => {
                  return signalNames(sentence, mentions.failedSignals);
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

  return (
    <section
      className={`[container-type:inline-size] ${props.className || ""}`}
      data-testid={SECURITY_CONNECTIONS_TEST_IDS.telemetry}
    >
      <h3 className={SECTION_HEADING_CLASS_NAME}>
        {translator.translateText(TELEMETRY_MENTIONS_TITLE)}
      </h3>
      {mentions && mentions.windowStart && mentions.windowEnd ? (
        <p className="mb-4 mt-0.5 text-sm text-gray-500 text-pretty">
          {translator.translateTemplate(TELEMETRY_MENTIONS_DESCRIPTION, {
            start: OneUptimeDate.getDateAsLocalShortDateTimeString(
              mentions.windowStart,
            ),
            end: OneUptimeDate.getDateAsLocalShortDateTimeString(
              mentions.windowEnd,
            ),
          })}
        </p>
      ) : (
        <div className="mb-3" />
      )}
      {body}
    </section>
  );
};

export default TelemetryMentions;
