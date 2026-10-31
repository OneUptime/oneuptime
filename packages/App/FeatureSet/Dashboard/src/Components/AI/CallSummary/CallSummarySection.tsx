import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentVideoCall from "Common/Models/DatabaseModels/IncidentVideoCall";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  CallSummary,
  CallSummaryBasis,
  CallSummaryCitation,
  CallSummaryFinding,
  CallSummaryFindingKind,
  CallSummaryPoint,
  CallSummaryRootCauseOutcome,
  RootCauseSuggestionStatus,
  getCallSummaryPointCount,
} from "Common/Types/VideoCall/CallSummary";
import CallSummaryMarkdown from "Common/Utils/VideoCall/CallSummaryMarkdown";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import API from "Common/UI/Utils/API/API";
import PermissionGate, {
  ModelAction,
  PermissionGateOptions,
} from "Common/UI/Utils/PermissionGate";
import { usePrivateRecordGateOptions } from "Common/UI/Utils/PrivateRecordScope";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { getVideoCallHeadline } from "../../VideoCall/EventVideoCallsCard";
import {
  readCallTranscriptAgain,
  reviewCallRootCauseSuggestion,
} from "../../VideoCall/CallTranscriptApi";
import CallTranscriptModal from "../../VideoCall/CallTranscriptModal";
import {
  CallTranscriptReading,
  CallTranscriptView,
  formatCallTranscriptTime,
  getCallSummarySectionId,
  getCallsWithReadings,
} from "../../VideoCall/CallTranscriptState";
import { describeTranscriptLength } from "../../VideoCall/CallTranscriptBlock";
import InvestigationNotice, { noticeFailedIcon } from "../InvestigationNotice";
import UseCallRootCauseModal from "./UseCallRootCauseModal";

/*
 * WHAT ONEUPTIME AI READ IN THE INCIDENT'S CALLS, on the AI Investigation
 * card (issue #4875). The card is the one place OneUptime AI says what it
 * thinks happened; a call's transcript is one more thing it read.
 *
 * For each call whose transcript it read: the root cause the call points
 * at, marked as a suggestion until somebody uses it - with the transcript
 * lines it rests on, quoted - or that the call did not discuss the cause
 * enough to suggest one; then, folded, everything else it found: what the
 * call confirmed and the hypotheses, as two lists, then what was tried,
 * decisions, follow-ups and open questions.
 *
 * Use as root cause opens the suggestion in the root cause's editor; only
 * saving it there writes the incident's root cause. Dismiss sets it aside -
 * its sentence stays, quieter, its quotes go - and Undo brings it back. The
 * section is flat, like the rest of the card: headings, hairlines and
 * quotes, never a box or a pill row inside the card.
 *
 * Nothing renders for an incident whose calls have no transcript read.
 */

export interface ComponentProps {
  incidentId: ObjectID;
  calls: Array<IncidentVideoCall>;
  // A suggestion was used, dismissed or brought back: read the calls again.
  onChanged: () => void;
}

/*
 * The lists under "N more points from the call". Findings come in two -
 * what the call confirmed, then what was only supposed - so the two never
 * read as one list with a tag on each line.
 */
const SECTION_TITLES: {
  confirmed: string;
  hypotheses: string;
  stepsTried: string;
  decisions: string;
  actions: string;
  openQuestions: string;
} = {
  confirmed: translationKey("Confirmed on the call"),
  hypotheses: translationKey("Hypotheses"),
  stepsTried: translationKey("What was tried"),
  decisions: translationKey("Decisions"),
  actions: translationKey("Follow-ups"),
  openQuestions: translationKey("Open questions"),
};

// "00:12:03 · Priya Shah", the head of a quoted line.
function citationHead(citation: CallSummaryCitation): string {
  return [citation.time, citation.speaker]
    .filter((piece: string | undefined): boolean => {
      return Boolean(piece);
    })
    .join(" · ");
}

const Quote: FunctionComponent<{ citation: CallSummaryCitation }> = (props: {
  citation: CallSummaryCitation;
}): ReactElement => {
  const head: string = citationHead(props.citation);

  return (
    <li
      data-testid="call-summary-quote"
      data-line={props.citation.line}
      className="border-l-2 border-gray-200 pl-3"
    >
      {head ? (
        <p className="text-xs font-medium text-gray-500">{head}</p>
      ) : (
        <></>
      )}
      <p className="break-words text-sm text-gray-700">
        “{props.citation.text}”
      </p>
    </li>
  );
};

const PointList: FunctionComponent<{
  title: string;
  points: Array<CallSummaryPoint>;
  testId: string;
}> = (props: {
  title: string;
  points: Array<CallSummaryPoint>;
  testId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.points.length === 0) {
    return <></>;
  }

  return (
    <div data-testid={props.testId}>
      <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {translator.translateText(props.title)}
      </h5>
      <ul className="mt-2 space-y-2">
        {props.points.map((point: CallSummaryPoint, index: number) => {
          const owner: string | undefined = (
            point as CallSummaryPoint & { owner?: string | undefined }
          ).owner;
          const times: Array<string> = point.citations.map(
            (citation: CallSummaryCitation): string => {
              return citation.time || `#${citation.line}`;
            },
          );

          return (
            <li
              key={index}
              data-testid="call-summary-point"
              className="break-words text-sm leading-6 text-gray-800"
            >
              {point.text}
              {owner ? (
                <span className="text-gray-500">
                  {" "}
                  {translator.translateTemplate("({{owner}})", { owner })}
                </span>
              ) : (
                <></>
              )}
              {/*
                When it was said, in small print after the words: a time is
                never split across two lines, and a long list of them wraps
                between times.
              */}
              {times.length > 0 ? (
                <>
                  {" "}
                  <span
                    data-testid="call-summary-point-times"
                    className="text-xs tabular-nums text-gray-500"
                  >
                    {times.map((time: string, timeIndex: number) => {
                      return (
                        <Fragment key={timeIndex}>
                          {timeIndex > 0 ? ", " : ""}
                          <span className="whitespace-nowrap">{time}</span>
                        </Fragment>
                      );
                    })}
                  </span>
                </>
              ) : (
                <></>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const CallSummaryOfCall: FunctionComponent<{
  incidentId: ObjectID;
  call: IncidentVideoCall;
  view: CallTranscriptView;
  isOnlyCall: boolean;
  canWorkOnCalls: boolean;
  canEditRootCause: boolean;
  onChanged: () => void;
}> = (props: {
  incidentId: ObjectID;
  call: IncidentVideoCall;
  view: CallTranscriptView;
  isOnlyCall: boolean;
  canWorkOnCalls: boolean;
  canEditRootCause: boolean;
  onChanged: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [isUsing, setIsUsing] = useState<boolean>(false);
  const [isDeciding, setIsDeciding] = useState<boolean>(false);
  const [isRereading, setIsRereading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isViewing, setIsViewing] = useState<boolean>(false);

  const callId: string = props.call.id?.toString() || "";
  const callLabel: string =
    translator.translateText(getVideoCallHeadline(props.call)) ||
    getVideoCallHeadline(props.call);
  const summary: CallSummary | null = props.view.summary;

  const decide: (decision: RootCauseSuggestionStatus) => Promise<void> = async (
    decision: RootCauseSuggestionStatus,
  ): Promise<void> => {
    setIsDeciding(true);
    setError(undefined);

    try {
      await reviewCallRootCauseSuggestion({ callId, decision });
      setIsDeciding(false);
      props.onChanged();
    } catch (err) {
      setIsDeciding(false);
      setError(API.getFriendlyErrorMessage(err as Error));
    }
  };

  const readAgain: () => Promise<void> = async (): Promise<void> => {
    setIsRereading(true);
    setError(undefined);

    try {
      await readCallTranscriptAgain({ callId });
      setIsRereading(false);
      props.onChanged();
    } catch (err) {
      setIsRereading(false);
      setError(API.getFriendlyErrorMessage(err as Error));
    }
  };

  const length: string = describeTranscriptLength(props.view.info, translator);

  // "5 minutes ago" in the reader's language.
  const when: (date: Date | undefined) => string = (
    date: Date | undefined,
  ): string => {
    return date
      ? formatCallTranscriptTime({
          date,
          language: translator.language,
          now: OneUptimeDate.getCurrentDate(),
        })
      : "";
  };

  /*
   * The heading names the call; the line under it says what was read - the
   * transcript's length - with the way to read it too. The section sits in
   * the AI Investigation card, under the Not confirmed mark, so it needs no
   * sentence saying OneUptime AI wrote it.
   */
  const heading: ReactElement = (
    <div>
      <h3 className="text-sm font-semibold text-gray-900">
        {props.isOnlyCall
          ? translator.translateText("From the incident's call")
          : translator.translateTemplate("From the {{call}}", {
              call: callLabel,
            })}
      </h3>
      <p
        data-testid="call-summary-transcript-line"
        className="mt-1 text-sm leading-6 text-gray-500"
      >
        {length ? `${length} · ` : ""}
        <button
          type="button"
          data-testid="call-summary-view-transcript"
          className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          onClick={() => {
            setIsViewing(true);
          }}
        >
          {translator.translateText("View transcript")}
        </button>
      </p>
    </div>
  );

  let body: ReactElement;

  if (props.view.reading === CallTranscriptReading.Reading) {
    body = (
      <InvestigationNotice
        role="status"
        testId="call-summary-reading"
        indicator={
          <span className="h-4 w-4 flex-shrink-0 rounded-full border-2 border-indigo-200 border-t-indigo-600 motion-safe:animate-spin" />
        }
        title="OneUptime AI is reading the transcript"
      >
        {translator.translateText(
          "The suggested root cause appears here when it is done, usually within a minute or two.",
        )}
      </InvestigationNotice>
    );
  } else if (
    props.view.reading === CallTranscriptReading.Failed ||
    props.view.reading === CallTranscriptReading.Stuck
  ) {
    /*
     * Try again sits under the notice's sentence, lined up with it (the
     * mark's width and the gap after it), not inside it: the notice's text
     * is a paragraph.
     */
    body = (
      <div className="space-y-1">
        <InvestigationNotice
          role="alert"
          testId="call-summary-failed"
          indicator={noticeFailedIcon}
          title={
            props.view.reading === CallTranscriptReading.Stuck
              ? "Reading the transcript took too long"
              : "OneUptime AI could not read the transcript"
          }
        >
          {props.view.reading === CallTranscriptReading.Failed
            ? props.view.readingMessage
            : translator.translateText(
                "It stopped before it suggested anything.",
              )}
        </InvestigationNotice>
        {props.canWorkOnCalls ? (
          <div className="pl-7">
            <button
              type="button"
              data-testid="call-summary-read-again"
              disabled={isRereading}
              className="rounded-md text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => {
                void readAgain();
              }}
            >
              {translator.translateText("Try again")}
            </button>
          </div>
        ) : (
          <></>
        )}
        {error ? (
          <div className="pt-2">
            <InvestigationNotice
              role="alert"
              testId="call-summary-error"
              indicator={noticeFailedIcon}
              title="Could not start reading it again"
            >
              {error}
            </InvestigationNotice>
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  } else if (summary) {
    const rootCause: CallSummary["rootCause"] = summary.rootCause;
    const isSuggested: boolean =
      rootCause.outcome === CallSummaryRootCauseOutcome.Suggested;
    const isDismissed: boolean =
      props.view.suggestion === RootCauseSuggestionStatus.Dismissed;
    const otherPoints: number = getCallSummaryPointCount(summary);

    body = (
      <div className="space-y-5">
        {isSuggested ? (
          <div data-testid="call-summary-root-cause">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-medium text-gray-900">
                {translator.translateText("Suggested root cause")}
              </h4>
              {props.view.suggestion === RootCauseSuggestionStatus.Accepted ? (
                <span
                  data-testid="call-summary-status"
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"
                >
                  <Icon icon={IconProp.Check} className="h-3 w-3" />
                  {translator.translateText("Used as root cause")}
                </span>
              ) : props.view.suggestion ===
                RootCauseSuggestionStatus.Dismissed ? (
                <span
                  data-testid="call-summary-status"
                  className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-200"
                >
                  {translator.translateText("Dismissed")}
                </span>
              ) : (
                <span
                  data-testid="call-summary-status"
                  className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200"
                >
                  <Icon icon={IconProp.Sparkles} className="h-3 w-3" />
                  {translator.translateText("Not confirmed")}
                </span>
              )}
            </div>

            <p
              data-testid="call-summary-root-cause-text"
              className={`mt-2 break-words text-sm leading-6 ${
                props.view.suggestion === RootCauseSuggestionStatus.Dismissed
                  ? "text-gray-500"
                  : "text-gray-900"
              }`}
            >
              {rootCause.summary}
            </p>
            {/*
              What the suggestion rests on - said on the call or only read
              into it - and the lines themselves, in the order they were
              said, as the transcript has them. A dismissed suggestion keeps
              its one sentence, quieter, and lets the rest go: Undo brings
              it back.
            */}
            {isDismissed ? (
              <></>
            ) : (
              <p
                data-testid="call-summary-basis"
                className="mt-1 text-xs text-gray-500"
              >
                {rootCause.basis === CallSummaryBasis.StatedOnCall
                  ? translator.translateText(
                      "Said on the call: someone found or confirmed it.",
                    )
                  : translator.translateText(
                      "OneUptime AI's reading of what was said: nobody on the call confirmed it.",
                    )}
              </p>
            )}

            {isDismissed ? (
              <></>
            ) : (
              <ul className="mt-3 space-y-2">
                {[...rootCause.citations]
                  .sort(
                    (left: CallSummaryCitation, right: CallSummaryCitation) => {
                      return left.line - right.line;
                    },
                  )
                  .map((citation: CallSummaryCitation) => {
                    return <Quote key={citation.line} citation={citation} />;
                  })}
              </ul>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2 [&>button]:ml-0 [&>button]:md:ml-0">
              {props.view.suggestion === RootCauseSuggestionStatus.Suggested ? (
                <>
                  {props.canEditRootCause ? (
                    <Button
                      title="Use as root cause"
                      icon={IconProp.Check}
                      buttonStyle={ButtonStyleType.PRIMARY}
                      buttonSize={ButtonSize.Small}
                      dataTestId="call-summary-use"
                      onClick={() => {
                        setIsUsing(true);
                      }}
                    />
                  ) : (
                    <></>
                  )}
                  {props.canWorkOnCalls ? (
                    <Button
                      title="Dismiss"
                      buttonStyle={ButtonStyleType.NORMAL}
                      buttonSize={ButtonSize.Small}
                      isLoading={isDeciding}
                      dataTestId="call-summary-dismiss"
                      onClick={() => {
                        void decide(RootCauseSuggestionStatus.Dismissed);
                      }}
                    />
                  ) : (
                    <></>
                  )}
                </>
              ) : props.view.suggestion ===
                RootCauseSuggestionStatus.Accepted ? (
                <p className="text-xs text-gray-500">
                  {props.view.reviewedByName
                    ? translator.translateTemplate(
                        "{{name}} used it as the incident's root cause {{when}}.",
                        {
                          name: props.view.reviewedByName,
                          when: when(props.view.reviewedAt),
                        },
                      )
                    : translator.translateText(
                        "It was used as the incident's root cause.",
                      )}{" "}
                  <Link
                    dataTestId="call-summary-root-cause-link"
                    className="font-medium text-indigo-600 hover:text-indigo-700"
                    to={RouteUtil.populateRouteParams(
                      RouteMap[PageMap.INCIDENT_VIEW_ROOT_CAUSE] as Route,
                      { modelId: props.incidentId },
                    )}
                  >
                    {translator.translateText("View root cause")}
                  </Link>
                </p>
              ) : props.view.suggestion ===
                RootCauseSuggestionStatus.Dismissed ? (
                <p className="text-xs text-gray-500">
                  {props.view.reviewedByName
                    ? translator.translateTemplate(
                        "{{name}} dismissed it {{when}}.",
                        {
                          name: props.view.reviewedByName,
                          when: when(props.view.reviewedAt),
                        },
                      )
                    : translator.translateText("It was dismissed.")}{" "}
                  {props.canWorkOnCalls ? (
                    <button
                      type="button"
                      data-testid="call-summary-undo-dismiss"
                      disabled={isDeciding}
                      className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      onClick={() => {
                        void decide(RootCauseSuggestionStatus.Suggested);
                      }}
                    >
                      {translator.translateText("Undo")}
                    </button>
                  ) : (
                    <></>
                  )}
                </p>
              ) : (
                <></>
              )}
            </div>

            {error ? (
              <div className="mt-3">
                <InvestigationNotice
                  role="alert"
                  testId="call-summary-error"
                  indicator={noticeFailedIcon}
                  title="Could not save your decision"
                >
                  {error}
                </InvestigationNotice>
              </div>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <InvestigationNotice
            testId="call-summary-not-enough"
            indicator={
              <Icon
                icon={IconProp.Info}
                className="h-4 w-4 flex-shrink-0 text-gray-400"
              />
            }
            title="Not enough was said on the call to suggest a root cause"
          >
            {translator.translateText(
              "OneUptime AI suggests a cause only when the call names one, with the lines that say so.",
            )}
          </InvestigationNotice>
        )}

        {otherPoints > 0 ? (
          <details
            data-testid="call-summary-details"
            className="group border-t border-gray-200 pt-4"
            open={!isSuggested}
          >
            <summary className="flex cursor-pointer select-none items-center gap-1 text-sm font-medium text-gray-700 hover:text-gray-900">
              <Icon
                icon={IconProp.ChevronRight}
                className="h-4 w-4 transition-transform group-open:rotate-90"
              />
              {translator.translatePlural(
                {
                  one: "{{count}} more point from the call",
                  other: "{{count}} more points from the call",
                },
                otherPoints,
              )}
            </summary>
            <div className="mt-4 space-y-5 pl-5">
              <PointList
                title={SECTION_TITLES.confirmed}
                points={summary.findings.filter(
                  (finding: CallSummaryFinding): boolean => {
                    return finding.kind === CallSummaryFindingKind.Confirmed;
                  },
                )}
                testId="call-summary-confirmed"
              />
              <PointList
                title={SECTION_TITLES.hypotheses}
                points={summary.findings.filter(
                  (finding: CallSummaryFinding): boolean => {
                    return finding.kind !== CallSummaryFindingKind.Confirmed;
                  },
                )}
                testId="call-summary-hypotheses"
              />
              <PointList
                title={SECTION_TITLES.stepsTried}
                points={summary.stepsTried}
                testId="call-summary-steps"
              />
              <PointList
                title={SECTION_TITLES.decisions}
                points={summary.decisions}
                testId="call-summary-decisions"
              />
              <PointList
                title={SECTION_TITLES.actions}
                points={summary.actions}
                testId="call-summary-actions"
              />
              <PointList
                title={SECTION_TITLES.openQuestions}
                points={summary.openQuestions}
                testId="call-summary-questions"
              />
            </div>
          </details>
        ) : (
          <></>
        )}
      </div>
    );
  } else {
    body = <></>;
  }

  return (
    <Fragment>
      <div
        id={getCallSummarySectionId(callId)}
        tabIndex={-1}
        data-testid="call-summary"
        data-reading={props.view.reading}
        className="scroll-mt-32 space-y-4 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-4"
      >
        {heading}
        {body}
      </div>

      {isUsing && summary ? (
        <UseCallRootCauseModal
          callId={props.call.id!}
          incidentId={props.incidentId}
          initialRootCause={CallSummaryMarkdown.buildRootCause(
            summary.rootCause,
          )}
          onClose={() => {
            setIsUsing(false);
          }}
          onSaved={() => {
            setIsUsing(false);
            props.onChanged();
          }}
        />
      ) : (
        <></>
      )}

      {isViewing ? (
        <CallTranscriptModal
          callId={props.call.id!}
          callLabel={callLabel}
          highlightLines={summary?.rootCause.citations.map(
            (citation: CallSummaryCitation): number => {
              return citation.line;
            },
          )}
          onClose={() => {
            setIsViewing(false);
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

// What the section's gates ask about: a call of the incident, a part of it.
const PRIVATE_RECORD_CALL: IncidentVideoCall = new IncidentVideoCall();

const CallSummarySection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * On a private incident, its calls are read again and their root cause
   * taken into it only through a team of the reader's that owns it
   * (PrivateRecordScope).
   */
  const privateRecordOptions: PermissionGateOptions | undefined =
    usePrivateRecordGateOptions(PRIVATE_RECORD_CALL);
  const readings: Array<{ call: IncidentVideoCall; view: CallTranscriptView }> =
    getCallsWithReadings(props.calls, OneUptimeDate.getCurrentDate());

  if (readings.length === 0) {
    return <></>;
  }

  const canWorkOnCalls: boolean = PermissionGate.check(
    new IncidentVideoCall(),
    ModelAction.Create,
    privateRecordOptions,
  ).isAllowed;
  const canEditRootCause: boolean = PermissionGate.checkColumnUpdate(
    new Incident(),
    "rootCause",
    privateRecordOptions,
  ).isAllowed;

  return (
    <section
      data-testid="call-summaries"
      aria-label={translator.translateText("From the incident's calls")}
      className="space-y-8 border-t border-gray-200 pt-6"
    >
      {readings.map(
        (entry: { call: IncidentVideoCall; view: CallTranscriptView }) => {
          return (
            <CallSummaryOfCall
              key={entry.call.id?.toString()}
              incidentId={props.incidentId}
              call={entry.call}
              view={entry.view}
              // "The incident's call" only when it has no other call to mean.
              isOnlyCall={props.calls.length === 1}
              canWorkOnCalls={canWorkOnCalls}
              canEditRootCause={canEditRootCause}
              onChanged={props.onChanged}
            />
          );
        },
      )}
    </section>
  );
};

export default CallSummarySection;
