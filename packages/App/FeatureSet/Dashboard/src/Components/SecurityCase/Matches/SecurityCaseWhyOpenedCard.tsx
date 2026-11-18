import AppLink from "../../AppLink/AppLink";
import DetectionRuleSummary, {
  formatTimespan,
} from "../../SecurityEvents/DetectionRuleSummary";
import { readDetectionRuleShape } from "../../SecurityEvents/DetectionRuleShape";
import SecurityEventDetailPanel from "../../SecurityEvents/SecurityEventDetailPanel";
import SecurityEventRequestOutcomePill from "../../SecurityEvents/SecurityEventRequestOutcomePill";
import SecurityEventSeverityPill from "../../SecurityEvents/SecurityEventSeverityPill";
import { toSecurityEvent } from "../Evidence/EventEvidence";
import { getSecurityDetectionSourceIcon } from "../SecurityCasePills";
import {
  DETECTIONS_FAILED,
  DETECTIONS_UNREADABLE,
  EVENTS_FAILED,
  EVENTS_UNREADABLE,
  EVENT_LINKS_ARIA_LABEL,
  EVENT_OPEN_DETAILS,
  EVENT_PANEL_NOTE,
  FACT_FIRES_WHEN,
  FACT_LOOKS_FOR,
  FACT_MATCHED,
  FACT_READ_MORE,
  FACT_REQUESTS,
  FIRED,
  FIRST_EVENTS_OF,
  HIDE_WHAT_IT_MATCHED,
  JOINED_THE_CASE,
  LOOKS_FOR_IN_FIELD,
  LOOK_NEXT_HEADING,
  MORE_DETECTIONS,
  NO_EVENTS_LEFT,
  NO_EVENTS_TO_LOOK_UP,
  OPENED_BY_HAND_DESCRIPTION,
  OPENED_BY_HAND_TITLE,
  OPENED_THE_CASE,
  OPEN_DETECTIONS,
  OPEN_EVIDENCE,
  OPEN_IN_EVENTS,
  OTHER_DETECTIONS_HEADING,
  RULES_UNREADABLE,
  SECURITY_CASE_MATCHES_TEST_IDS,
  SHOW_ALL_EVENTS,
  SHOW_FEWER_EVENTS,
  SHOW_RULE,
  HIDE_RULE,
  SHOW_WHAT_IT_MATCHED,
  TRY_AGAIN,
  WHAT_MATCHED_HEADING,
  WHY_OPENED_DESCRIPTION,
  WHY_OPENED_TITLE,
} from "./SecurityCaseMatchesCopy";
import {
  EventLink,
  EventSourceLabel,
  LookNextLink,
  MATCHED_EVENTS_SHOWN,
  MatchedSentence,
  RequestOutcomeSummary,
  RuleCountingSentence,
  getBasisNote,
  getCaseDetectionsRoute,
  getCaseEvidenceRoute,
  getDetectionEventsRoute,
  getEventLinks,
  getEventRowText,
  getEventSourceLabel,
  getLookNextLinks,
  getMatchedSentence,
  getRequestOutcomeSentence,
  getRequestOutcomeSummary,
  getRuleCountingSentence,
} from "./SecurityCaseMatchesModel";
import { SecurityCaseMatchesState } from "./useSecurityCaseMatches";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  SecurityCaseMatchedDetectionJson,
  SecurityCaseMatchedEventJson,
  SecurityCaseMatchesJson,
  SecurityCaseMatchesSource,
  getOpeningMatchedDetection,
} from "Common/Types/SecurityCase/SecurityCaseMatches";
import {
  getLookForValues,
  splitTextByLookFor,
  TextMatchPart,
} from "Common/Utils/SecurityCase/SecurityCaseMatchRules";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  writeReaderMoment,
  writeReaderTimeOfDay,
} from "Common/UI/Utils/ReaderMoments";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * WHY THIS CASE WAS OPENED, on a case's Overview (#9556): the three things
 * an analyst asks first, answered where they open the case.
 *
 *   Why was it opened?    The detection that opened it: the rule, when it
 *                         fires (its threshold, what it groups by, the
 *                         window it counts in), how many events it matched
 *                         from what, over when, what its condition looks
 *                         for, and how far the requests got.
 *   What exactly matched? The events themselves, oldest first: each line
 *                         the event's message with what the rule looks for
 *                         marked, how far its request got, the log line or
 *                         product it came from, and its trace, logs and
 *                         exception one click away. A line opens the event
 *                         whole - the log line it was read from, what the
 *                         request did - in the panel the Events explorer
 *                         opens.
 *   Where to look next?   Everything about what it is about, the events and
 *                         log lines naming it, the logs of the services its
 *                         lines came from, the traces of its requests -
 *                         each over its window - and the case's Story and
 *                         Connected Signals.
 *
 * The other detections on the case follow, each folded to a line until it
 * is asked for. A case nobody's detection opened says so, with the way to
 * its Evidence. What the reader may not read, and what failed, is said,
 * never left as a gap that reads as "nothing matched".
 */

export interface ComponentProps {
  caseId: ObjectID;
  state: SecurityCaseMatchesState;
}

const SECTION_HEADING_CLASS_NAME: string =
  "text-xs font-medium uppercase tracking-wide text-gray-500";

const LINK_CLASS_NAME: string =
  "inline-flex items-center gap-1 rounded font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const TEXT_BUTTON_CLASS_NAME: string =
  "rounded font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

// The text of an event, with what the rule looks for marked.
const MarkedText: FunctionComponent<{
  text: string;
  values: Array<string>;
}> = (props: { text: string; values: Array<string> }): ReactElement => {
  const parts: Array<TextMatchPart> = splitTextByLookFor(
    props.text,
    props.values,
  );

  return (
    <>
      {parts.map((part: TextMatchPart, index: number): ReactElement => {
        return part.isMatch ? (
          <mark
            key={index}
            className="rounded-sm bg-amber-100 px-0.5 text-amber-900"
            data-testid={SECURITY_CASE_MATCHES_TEST_IDS.eventMark}
          >
            {part.text}
          </mark>
        ) : (
          <React.Fragment key={index}>{part.text}</React.Fragment>
        );
      })}
    </>
  );
};

// One fact of a detection: its label, and what it says.
const Fact: FunctionComponent<{
  label: string;
  dataTestId: string;
  children: ReactElement | Array<ReactElement>;
}> = (props: {
  label: string;
  dataTestId: string;
  children: ReactElement | Array<ReactElement>;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className="grid grid-cols-1 gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[9rem_minmax(0,1fr)]"
      data-testid={props.dataTestId}
    >
      <dt className="text-sm font-medium text-gray-500">
        {translator.translateText(props.label)}
      </dt>
      <dd className="min-w-0 text-sm text-gray-900">{props.children}</dd>
    </div>
  );
};

// A field a rule names: drawn as the column name it is.
const FieldName: FunctionComponent<{ name: string }> = (props: {
  name: string;
}): ReactElement => {
  return (
    <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-800">
      {props.name}
    </code>
  );
};

// When a single rule fires, its fields drawn as code.
const RuleCounting: FunctionComponent<{
  sentence: RuleCountingSentence;
}> = (props: { sentence: RuleCountingSentence }): ReactElement => {
  const translator: Translator = useTranslator();
  const slots: Record<string, ReactElement> = {};

  for (const slot of Object.keys(props.sentence.fields)) {
    slots[slot] = <FieldName name={props.sentence.fields[slot] || ""} />;
  }

  return (
    <TranslatedSentence
      template={props.sentence.template}
      slots={slots}
      values={{
        count: translator.formatNumber(props.sentence.count),
        timespan: formatTimespan(props.sentence.windowInSeconds, translator),
      }}
    />
  );
};

// One event a detection matched, as a line.
const MatchedEventRow: FunctionComponent<{
  event: SecurityCaseMatchedEventJson;
  lookFor: Array<string>;
  onOpen: () => void;
}> = (props: {
  event: SecurityCaseMatchedEventJson;
  lookFor: Array<string>;
  onOpen: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const time: Date | null = props.event.time
    ? new Date(props.event.time)
    : null;
  const source: EventSourceLabel | null = getEventSourceLabel(props.event);
  const links: Array<EventLink> = getEventLinks(props.event);

  return (
    <li
      className="flex items-start gap-3 px-3 py-2.5"
      data-testid={SECURITY_CASE_MATCHES_TEST_IDS.event}
    >
      <span
        className="mt-0.5 w-20 flex-shrink-0 font-mono text-xs tabular-nums text-gray-500"
        title={time ? writeReaderMoment(time, { includeSeconds: true }) : ""}
      >
        {time ? writeReaderTimeOfDay(time) : ""}
      </span>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="block w-full rounded text-left font-mono text-xs leading-5 text-gray-900 [overflow-wrap:anywhere] hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          title={translator.translateText(EVENT_OPEN_DETAILS)}
          onClick={props.onOpen}
          data-testid={SECURITY_CASE_MATCHES_TEST_IDS.eventText}
        >
          <bdi>
            <MarkedText
              text={getEventRowText(props.event)}
              values={props.lookFor}
            />
          </bdi>
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
          <SecurityEventRequestOutcomePill
            outcome={props.event.requestOutcome}
          />
          {source ? (
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {translator.translateTemplate(source.template, source.values)}
            </span>
          ) : (
            <></>
          )}
          {links.length > 0 ? (
            <span
              className="flex flex-wrap items-center gap-x-3 gap-y-1"
              aria-label={translator.translateText(EVENT_LINKS_ARIA_LABEL)}
              data-testid={SECURITY_CASE_MATCHES_TEST_IDS.eventLinks}
            >
              {links.map((link: EventLink): ReactElement => {
                return (
                  <AppLink
                    key={link.key}
                    to={link.route}
                    className={LINK_CLASS_NAME}
                  >
                    <Icon icon={link.icon} className="h-3.5 w-3.5" />
                    <span>{translator.translateText(link.label)}</span>
                  </AppLink>
                );
              })}
            </span>
          ) : (
            <></>
          )}
        </div>
      </div>
    </li>
  );
};

// Why a detection's events are not listed: refused, failed, nothing to look up, none left.
function getNoEventsSentence(data: {
  detection: SecurityCaseMatchedDetectionJson;
  matches: SecurityCaseMatchesJson;
}): string {
  const { detection, matches } = data;

  if (detection.matchedEventCount !== null) {
    return NO_EVENTS_LEFT;
  }

  if (!detection.windowStart) {
    return NO_EVENTS_TO_LOOK_UP;
  }

  if (matches.unreadableSources.includes(SecurityCaseMatchesSource.Events)) {
    return EVENTS_UNREADABLE;
  }

  return EVENTS_FAILED;
}

// Whether the case's detections could not be read, for its role or a failure.
function isDetectionsUnread(matches: SecurityCaseMatchesJson): boolean {
  return (
    matches.unreadableSources.includes(SecurityCaseMatchesSource.Detections) ||
    matches.failedSources.includes(SecurityCaseMatchesSource.Detections)
  );
}

// One detection: why it fired, and what it matched.
const DetectionSection: FunctionComponent<{
  detection: SecurityCaseMatchedDetectionJson;
  matches: SecurityCaseMatchesJson;
  onOpenEvent: (event: SecurityCaseMatchedEventJson) => void;
  onTryAgain: () => void;
}> = (props: {
  detection: SecurityCaseMatchedDetectionJson;
  matches: SecurityCaseMatchesJson;
  onOpenEvent: (event: SecurityCaseMatchedEventJson) => void;
  onTryAgain: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const { detection } = props;
  const [isShowingAll, setIsShowingAll] = useState<boolean>(false);
  const [isShowingRule, setIsShowingRule] = useState<boolean>(false);

  const name: string =
    detection.rule?.name || detection.ruleName || detection.title;
  const description: string = detection.rule?.description || "";
  const counting: RuleCountingSentence | null = getRuleCountingSentence(
    detection.rule,
  );
  const matched: MatchedSentence | null = getMatchedSentence(detection);
  const outcomes: RequestOutcomeSummary = getRequestOutcomeSummary(
    detection.outcomes,
  );
  const outcomeSentence: ReturnType<typeof getRequestOutcomeSentence> =
    getRequestOutcomeSentence(outcomes);
  const lookFor: Array<string> = getLookForValues(
    detection.rule?.lookFor || [],
  );
  const basisNote: string = getBasisNote(detection);
  const events: Array<SecurityCaseMatchedEventJson> = isShowingAll
    ? detection.events
    : detection.events.slice(0, MATCHED_EVENTS_SHOWN);
  const hiddenCount: number = detection.events.length - events.length;
  const total: number = detection.matchedEventCount || 0;

  return (
    <section
      className="space-y-3"
      data-testid={SECURITY_CASE_MATCHES_TEST_IDS.detection}
      data-detection-id={detection.id}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
            <Icon
              icon={getSecurityDetectionSourceIcon(detection.source as never)}
              className="h-3.5 w-3.5 text-gray-400"
            />
            <span>{translator.translateText(detection.source)}</span>
            <span aria-hidden="true">·</span>
            <span>
              {translator.translateText(
                detection.isOpening ? OPENED_THE_CASE : JOINED_THE_CASE,
              )}
            </span>
          </p>
          <h3
            className="mt-0.5 break-words text-base font-semibold text-gray-900"
            data-testid={SECURITY_CASE_MATCHES_TEST_IDS.detectionTitle}
          >
            <bdi>{name}</bdi>
          </h3>
        </div>
        <SecurityEventSeverityPill severityName={detection.severity} />
      </div>

      {description ? (
        <p className="text-sm text-gray-600">
          <bdi>{description}</bdi>
        </p>
      ) : (
        <></>
      )}

      <dl
        className="divide-y divide-gray-100 border-y border-gray-100"
        data-testid={SECURITY_CASE_MATCHES_TEST_IDS.facts}
      >
        {counting ? (
          <Fact
            label={FACT_FIRES_WHEN}
            dataTestId={SECURITY_CASE_MATCHES_TEST_IDS.firesWhen}
          >
            <RuleCounting sentence={counting} />
          </Fact>
        ) : (
          <></>
        )}
        {detection.rule?.isCorrelation ? (
          <Fact
            label={FACT_FIRES_WHEN}
            dataTestId={SECURITY_CASE_MATCHES_TEST_IDS.firesWhen}
          >
            <DetectionRuleSummary
              shape={readDetectionRuleShape(detection.rule.sigmaRuleYaml)}
            />
          </Fact>
        ) : (
          <></>
        )}
        {matched ? (
          <Fact
            label={FACT_MATCHED}
            dataTestId={SECURITY_CASE_MATCHES_TEST_IDS.matched}
          >
            <span>
              <TranslatedSentence
                template={matched.template}
                count={matched.count}
                slots={{
                  value: (
                    <IsolatedText text={matched.value} className="font-mono" />
                  ),
                }}
                values={{
                  start: writeReaderMoment(matched.start),
                  end: writeReaderMoment(matched.end),
                }}
              />
              {detection.fireCount > 1 ? (
                <span className="text-gray-500">
                  {" · "}
                  {translator.translatePlural(FIRED, detection.fireCount)}
                </span>
              ) : (
                <></>
              )}
            </span>
          </Fact>
        ) : (
          <></>
        )}
        {lookFor.length > 0 ? (
          <Fact
            label={FACT_LOOKS_FOR}
            dataTestId={SECURITY_CASE_MATCHES_TEST_IDS.lookFor}
          >
            <div className="flex flex-col gap-1">
              {(detection.rule?.lookFor || []).map(
                (entry: { field: string; values: Array<string> }) => {
                  // A sentence, never a flex row's items: it reads one way in every language.
                  return (
                    <p key={entry.field} className="leading-6">
                      <TranslatedSentence
                        template={LOOKS_FOR_IN_FIELD}
                        slots={{
                          values: (
                            <span className="inline-flex flex-wrap gap-1">
                              {entry.values.map((value: string) => {
                                return (
                                  <code
                                    key={value}
                                    className="rounded bg-amber-50 px-1 py-0.5 font-mono text-xs text-amber-900"
                                  >
                                    {value}
                                  </code>
                                );
                              })}
                            </span>
                          ),
                          field: <FieldName name={entry.field} />,
                        }}
                      />
                    </p>
                  );
                },
              )}
            </div>
          </Fact>
        ) : (
          <></>
        )}
        {outcomes.tally.length > 0 ? (
          <Fact
            label={FACT_REQUESTS}
            dataTestId={SECURITY_CASE_MATCHES_TEST_IDS.requests}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {outcomes.tally.map(
                (entry: { outcome: string; count: number }): ReactElement => {
                  return (
                    <span
                      key={entry.outcome}
                      className="inline-flex items-center gap-1"
                    >
                      <SecurityEventRequestOutcomePill
                        outcome={entry.outcome}
                      />
                      <span className="text-xs tabular-nums text-gray-600">
                        {translator.formatNumber(entry.count)}
                      </span>
                    </span>
                  );
                },
              )}
              {outcomeSentence ? (
                <span className="text-sm text-gray-600">
                  {translator.translatePlural(
                    outcomeSentence,
                    outcomes.followed,
                    { through: translator.formatNumber(outcomes.through) },
                  )}
                </span>
              ) : (
                <></>
              )}
            </div>
          </Fact>
        ) : (
          <></>
        )}
        {detection.rule && detection.rule.references.length > 0 ? (
          <Fact
            label={FACT_READ_MORE}
            dataTestId={SECURITY_CASE_MATCHES_TEST_IDS.references}
          >
            <ul className="space-y-0.5">
              {detection.rule.references.map((reference: string) => {
                return (
                  <li key={reference} className="[overflow-wrap:anywhere]">
                    <a
                      href={reference}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={LINK_CLASS_NAME}
                    >
                      <bdi>{reference}</bdi>
                    </a>
                  </li>
                );
              })}
            </ul>
          </Fact>
        ) : (
          <></>
        )}
      </dl>

      {detection.rule?.sigmaRuleYaml ? (
        <div>
          <button
            type="button"
            className={`${TEXT_BUTTON_CLASS_NAME} text-sm`}
            aria-expanded={isShowingRule}
            onClick={() => {
              setIsShowingRule(!isShowingRule);
            }}
          >
            {translator.translateText(isShowingRule ? HIDE_RULE : SHOW_RULE)}
          </button>
          {isShowingRule ? (
            <pre
              className="mt-2 overflow-x-auto whitespace-pre rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs leading-5 text-gray-800"
              dir="ltr"
            >
              {detection.rule.sigmaRuleYaml}
            </pre>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h4 className={SECTION_HEADING_CLASS_NAME}>
            {translator.translateText(WHAT_MATCHED_HEADING)}
            {total > 0 ? ` (${translator.formatNumber(total)})` : ""}
          </h4>
        </div>
        {basisNote ? (
          <p
            className="text-xs text-gray-500"
            data-testid={SECURITY_CASE_MATCHES_TEST_IDS.basisNote}
          >
            <TranslatedSentence
              template={basisNote}
              slots={{
                value: (
                  <IsolatedText
                    text={detection.groupValue}
                    className="font-mono"
                  />
                ),
              }}
            />
          </p>
        ) : (
          <></>
        )}
        {detection.events.length > 0 ? (
          <>
            <ul
              className="divide-y divide-gray-100 rounded-lg border border-gray-200"
              data-testid={SECURITY_CASE_MATCHES_TEST_IDS.events}
            >
              {events.map(
                (
                  event: SecurityCaseMatchedEventJson,
                  index: number,
                ): ReactElement => {
                  return (
                    <MatchedEventRow
                      key={`${event.eventUid}-${index}`}
                      event={event}
                      lookFor={lookFor}
                      onOpen={() => {
                        props.onOpenEvent(event);
                      }}
                    />
                  );
                },
              )}
            </ul>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {hiddenCount > 0 || isShowingAll ? (
                <button
                  type="button"
                  className={TEXT_BUTTON_CLASS_NAME}
                  aria-expanded={isShowingAll}
                  onClick={() => {
                    setIsShowingAll(!isShowingAll);
                  }}
                  data-testid={SECURITY_CASE_MATCHES_TEST_IDS.showAll}
                >
                  {isShowingAll
                    ? translator.translateText(SHOW_FEWER_EVENTS)
                    : translator.translatePlural(SHOW_ALL_EVENTS, hiddenCount)}
                </button>
              ) : (
                <></>
              )}
              {total > detection.events.length ? (
                <span className="text-gray-500">
                  {translator.translateTemplate(FIRST_EVENTS_OF, {
                    shown: translator.formatNumber(detection.events.length),
                    count: translator.formatNumber(total),
                  })}
                </span>
              ) : (
                <></>
              )}
            </div>
          </>
        ) : (
          <p
            className="flex flex-wrap items-center gap-x-2 text-sm text-gray-600"
            data-testid={SECURITY_CASE_MATCHES_TEST_IDS.noEvents}
          >
            <span>
              {translator.translateText(
                getNoEventsSentence({ detection, matches: props.matches }),
              )}
            </span>
            {detection.matchedEventCount === null && detection.windowStart ? (
              <button
                type="button"
                className={TEXT_BUTTON_CLASS_NAME}
                onClick={props.onTryAgain}
              >
                {translator.translateText(TRY_AGAIN)}
              </button>
            ) : (
              <></>
            )}
          </p>
        )}
      </div>
    </section>
  );
};

// Another detection on the case: one line, its events a click away.
const OtherDetection: FunctionComponent<{
  detection: SecurityCaseMatchedDetectionJson;
  matches: SecurityCaseMatchesJson;
  onOpenEvent: (event: SecurityCaseMatchedEventJson) => void;
  onTryAgain: () => void;
}> = (props: {
  detection: SecurityCaseMatchedDetectionJson;
  matches: SecurityCaseMatchesJson;
  onOpenEvent: (event: SecurityCaseMatchedEventJson) => void;
  onTryAgain: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const { detection } = props;

  // One toggle, which says which way it is: folded to the line, or open on what it matched.
  const toggle: ReactElement = (
    <button
      type="button"
      className={`${TEXT_BUTTON_CLASS_NAME} text-sm`}
      aria-expanded={isOpen}
      onClick={() => {
        setIsOpen(!isOpen);
      }}
    >
      {translator.translateText(
        isOpen ? HIDE_WHAT_IT_MATCHED : SHOW_WHAT_IT_MATCHED,
      )}
    </button>
  );

  if (isOpen) {
    return (
      <li className="space-y-3 py-3">
        <DetectionSection
          detection={detection}
          matches={props.matches}
          onOpenEvent={props.onOpenEvent}
          onTryAgain={props.onTryAgain}
        />
        {toggle}
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <Icon
          icon={getSecurityDetectionSourceIcon(detection.source as never)}
          className="h-4 w-4 flex-shrink-0 text-gray-400"
        />
        <span className="min-w-0 truncate text-sm font-medium text-gray-900">
          <bdi>{detection.rule?.name || detection.title}</bdi>
        </span>
        <SecurityEventSeverityPill severityName={detection.severity} />
        {detection.fireCount > 1 ? (
          <span className="text-xs text-gray-500">
            {translator.translatePlural(FIRED, detection.fireCount)}
          </span>
        ) : (
          <></>
        )}
      </div>
      {toggle}
    </li>
  );
};

const LookNext: FunctionComponent<{ links: Array<LookNextLink> }> = (props: {
  links: Array<LookNextLink>;
}): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.links.length === 0) {
    return <></>;
  }

  return (
    <div
      className="space-y-2 border-t border-gray-100 pt-4"
      data-testid={SECURITY_CASE_MATCHES_TEST_IDS.lookNext}
    >
      <h4 className={SECTION_HEADING_CLASS_NAME}>
        {translator.translateText(LOOK_NEXT_HEADING)}
      </h4>
      <ul className="flex flex-wrap gap-2">
        {props.links.map((link: LookNextLink): ReactElement => {
          const text: string =
            typeof link.template === "string"
              ? translator.translateTemplate(link.template, link.values)
              : translator.translatePlural(
                  link.template,
                  link.count || 0,
                  link.values,
                );

          return (
            <li key={`${link.key}-${text}`}>
              <AppLink
                to={link.route}
                className="group inline-flex max-w-full items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-sm text-gray-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                dataTestId={`security-case-look-next-${link.key}`}
              >
                <Icon
                  icon={link.icon}
                  className="h-4 w-4 flex-shrink-0 text-gray-400 group-hover:text-indigo-500"
                />
                <span className="min-w-0 truncate">{text}</span>
              </AppLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const SecurityCaseWhyOpenedCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { matches, error, reread } = props.state;
  const [viewing, setViewing] = useState<{
    event: SecurityCaseMatchedEventJson;
    detectionName: string;
  } | null>(null);

  const opening: SecurityCaseMatchedDetectionJson | null = matches
    ? getOpeningMatchedDetection(matches)
    : null;
  const eventsRoute: Route | null = opening
    ? getDetectionEventsRoute(opening)
    : null;

  let body: ReactElement;

  if (error && !matches) {
    body = (
      <div data-testid={SECURITY_CASE_MATCHES_TEST_IDS.error}>
        <ErrorMessage message={error} onRefreshClick={reread} />
      </div>
    );
  } else if (!matches) {
    body = <DetailListSkeleton fields={4} />;
  } else if (!opening && isDetectionsUnread(matches)) {
    /*
     * The detections could not be read (the reader's role, or the read
     * failed): say so, never "Opened by hand".
     */
    const isUnreadable: boolean = matches.unreadableSources.includes(
      SecurityCaseMatchesSource.Detections,
    );

    body = (
      <p
        className="flex flex-wrap items-center gap-x-2 text-sm text-gray-600"
        data-testid={SECURITY_CASE_MATCHES_TEST_IDS.detectionsUnread}
      >
        <span>
          {translator.translateText(
            isUnreadable ? DETECTIONS_UNREADABLE : DETECTIONS_FAILED,
          )}
        </span>
        {isUnreadable ? (
          <></>
        ) : (
          <button
            type="button"
            className={TEXT_BUTTON_CLASS_NAME}
            onClick={reread}
          >
            {translator.translateText(TRY_AGAIN)}
          </button>
        )}
      </p>
    );
  } else if (!opening) {
    const evidenceRoute: Route | null = getCaseEvidenceRoute(props.caseId);

    body = (
      <div data-testid={SECURITY_CASE_MATCHES_TEST_IDS.openedByHand}>
        <TableEmptyState
          kind={TableEmptyStateKind.Empty}
          icon={IconProp.User}
          title={translator.translateText(OPENED_BY_HAND_TITLE) || ""}
          description={translator.translateText(OPENED_BY_HAND_DESCRIPTION)}
          isCompact={true}
        />
        {evidenceRoute ? (
          <div className="mt-2 flex justify-center">
            <Button
              title={OPEN_EVIDENCE}
              icon={IconProp.PaperClip}
              buttonStyle={ButtonStyleType.NORMAL}
              onClick={() => {
                Navigation.navigate(evidenceRoute);
              }}
            />
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  } else {
    const others: Array<SecurityCaseMatchedDetectionJson> =
      matches.detections.filter(
        (detection: SecurityCaseMatchedDetectionJson): boolean => {
          return detection.id !== opening.id;
        },
      );
    const moreCount: number = Math.max(
      0,
      matches.detectionCount - matches.detections.length,
    );
    const detectionsRoute: Route | null = getCaseDetectionsRoute(props.caseId);

    body = (
      <div className="space-y-5">
        {matches.unreadableSources.includes(SecurityCaseMatchesSource.Rules) ? (
          <p className="text-sm text-gray-600">
            {translator.translateText(RULES_UNREADABLE)}
          </p>
        ) : (
          <></>
        )}

        <DetectionSection
          detection={opening}
          matches={matches}
          onOpenEvent={(event: SecurityCaseMatchedEventJson) => {
            setViewing({
              event,
              detectionName: opening.rule?.name || opening.title,
            });
          }}
          onTryAgain={reread}
        />

        {others.length > 0 || moreCount > 0 ? (
          <div
            className="space-y-1 border-t border-gray-100 pt-4"
            data-testid={SECURITY_CASE_MATCHES_TEST_IDS.others}
          >
            <h4 className={SECTION_HEADING_CLASS_NAME}>
              {translator.translateText(OTHER_DETECTIONS_HEADING)}
            </h4>
            <ul className="divide-y divide-gray-100">
              {others.map(
                (detection: SecurityCaseMatchedDetectionJson): ReactElement => {
                  return (
                    <OtherDetection
                      key={detection.id}
                      detection={detection}
                      matches={matches}
                      onOpenEvent={(event: SecurityCaseMatchedEventJson) => {
                        setViewing({
                          event,
                          detectionName:
                            detection.rule?.name || detection.title,
                        });
                      }}
                      onTryAgain={reread}
                    />
                  );
                },
              )}
            </ul>
            {moreCount > 0 && detectionsRoute ? (
              <p
                className="flex flex-wrap items-center gap-x-2 text-sm text-gray-600"
                data-testid={SECURITY_CASE_MATCHES_TEST_IDS.moreDetections}
              >
                <span>
                  {translator.translatePlural(MORE_DETECTIONS, moreCount)}
                </span>
                <AppLink to={detectionsRoute} className={LINK_CLASS_NAME}>
                  {translator.translateText(OPEN_DETECTIONS) || OPEN_DETECTIONS}
                </AppLink>
              </p>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}

        <LookNext
          links={getLookNextLinks({ detection: opening, caseId: props.caseId })}
        />
      </div>
    );
  }

  return (
    <div data-testid={SECURITY_CASE_MATCHES_TEST_IDS.card}>
      <Card
        title={WHY_OPENED_TITLE}
        description={WHY_OPENED_DESCRIPTION}
        buttons={
          eventsRoute
            ? [
                {
                  title: OPEN_IN_EVENTS,
                  icon: IconProp.List,
                  buttonStyle: ButtonStyleType.NORMAL,
                  onClick: () => {
                    Navigation.navigate(eventsRoute);
                  },
                },
              ]
            : undefined
        }
      >
        {body}
      </Card>

      {viewing ? (
        <SecurityEventDetailPanel
          securityEvent={toSecurityEvent(viewing.event)}
          showCaseActions={false}
          note={
            <p className="text-xs text-gray-500">
              <TranslatedSentence
                template={EVENT_PANEL_NOTE}
                slots={{
                  detection: (
                    <span className="font-medium text-gray-700">
                      <bdi>{viewing.detectionName}</bdi>
                    </span>
                  ),
                }}
              />
            </p>
          }
          onClose={() => {
            setViewing(null);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default SecurityCaseWhyOpenedCard;
