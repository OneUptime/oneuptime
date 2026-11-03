import {
  RemediationFixStep,
  RemediationFixStepKind,
  RemediationFixStepTone,
} from "./RemediationFixSteps";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * ONE FIX'S STEPS, ON THE AI CARD'S REMEDIATION STEP (issue #5598).
 *
 * What OneUptime AI did with one fix, in the order it happened
 * (RemediationFixSteps): a mark on a rail, what it did, when, and why or
 * what went wrong. A step with more to read - the reasoning, each command
 * and why, each command's output, each undo - opens in place: its whole
 * line is the press, its chevron says which way it goes. What the reader
 * can do with the fix (Review and approve, Approve & Run, Dismiss, View
 * Execution) is under the step it belongs to, always in sight.
 *
 * Marks, a rail and lines, never boxes: the AI card is the only frame
 * (block 43), and its own two steps are marks on a rail too (AiCardStep),
 * which these read like, a size down.
 */

/*
 * A step's mark by how it went: a tinted disc, in the colours of the
 * decision's lines above the fixes (REMEDIATION_DECISION_TONE_MARK) - green
 * for what was done, amber for what waits for the reader, indigo for what
 * is moving, grey for what did nothing - and red for a failure, a shade
 * deeper, so a disc a third their size still reads. No ring: a ringed
 * circle is the card's one pill, its step's status. Light classes only:
 * Theme.css remaps each of them for the dark theme.
 */
export const REMEDIATION_FIX_STEP_MARK_CLASS_NAMES: Record<
  RemediationFixStepTone,
  string
> = {
  done: "bg-emerald-100 text-emerald-700",
  live: "bg-indigo-100 text-indigo-700",
  attention: "bg-amber-100 text-amber-700",
  failed: "bg-red-100 text-red-700",
  idle: "bg-gray-100 text-gray-500",
};

export interface ComponentProps {
  steps: Array<RemediationFixStep>;
  // Names what each step's press opens, apart from another fix's.
  idPrefix: string;
  isStepOpen: (kind: RemediationFixStepKind) => boolean;
  onToggleStep: (kind: RemediationFixStepKind) => void;
  // What an open step shows: its reasoning, its commands, their output.
  renderDetails: (kind: RemediationFixStepKind) => ReactNode;
  // What is in sight under a step whether it is open or not: its buttons.
  renderActions?: ((kind: RemediationFixStepKind) => ReactNode) | undefined;
}

// The id of what a step's press opens, for aria-controls.
export function getRemediationFixStepDetailsId(
  idPrefix: string,
  kind: RemediationFixStepKind,
): string {
  return `${idPrefix}-${kind}`;
}

/*
 * A step's mark: how it went, with the AI card's colours. A done rollback
 * is an undo, not a tick: what ran was taken back.
 */
function renderStepMarkContent(step: RemediationFixStep): ReactElement {
  const iconClassName: string = "h-3 w-3";

  if (step.tone === "live") {
    return (
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-500 opacity-75 motion-safe:animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
      </span>
    );
  }

  const icons: Record<Exclude<RemediationFixStepTone, "live">, IconProp> = {
    done: step.kind === "rollback" ? IconProp.ArrowUturnLeft : IconProp.Check,
    failed: IconProp.Close,
    attention: IconProp.HandRaised,
    idle: IconProp.Minus,
  };

  return <Icon icon={icons[step.tone]} className={iconClassName} />;
}

// Two moments are on the same day where the reader is.
function isSameLocalDay(a: Date, b: Date): boolean {
  const timezone: string = OneUptimeDate.getCurrentTimezone() as string;

  return (
    OneUptimeDate.getStartOfDay(a, timezone).getTime() ===
    OneUptimeDate.getStartOfDay(b, timezone).getTime()
  );
}

/*
 * When a step happened, as its line says it: the time alone today, the
 * date and time before ("Sep 14, 18:04"), in the reader's clock and words.
 * The full moment is under the pointer.
 */
export function formatRemediationStepTime(
  date: Date,
  now: Date = OneUptimeDate.getCurrentDate(),
): string {
  if (isSameLocalDay(date, now)) {
    return OneUptimeDate.getLocalTimeString(date, {
      use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
    });
  }

  return OneUptimeDate.getDateAsLocalShortDateTimeString(date);
}

// What the summary under a step's title is, for the suites that read it.
const SUMMARY_TEST_IDS: Partial<Record<RemediationFixStepKind, string>> = {
  verify: "remediation-fix-verification-note",
};

const RemediationFixStepList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ol data-testid="remediation-fix-steps" className="mt-3">
      {props.steps.map(
        (step: RemediationFixStep, index: number): ReactElement => {
          const isLast: boolean = index === props.steps.length - 1;
          const isOpen: boolean =
            step.hasDetails && props.isStepOpen(step.kind);
          const detailsId: string = getRemediationFixStepDetailsId(
            props.idPrefix,
            step.kind,
          );
          const actions: ReactNode = props.renderActions?.(step.kind);

          /*
           * What it did, then when, in the title's flow: a long title -
           * a cluster's name - wraps as words do, the time with it, on the
           * AI card's narrow column as on a wide one.
           */
          const titleRow: ReactElement = (
            <span className="min-w-0 flex-1 break-words text-sm leading-6">
              <span
                data-testid="remediation-fix-step-title"
                className="font-medium text-gray-900"
              >
                {step.title}
              </span>
              {step.at ? (
                <time
                  data-testid="remediation-fix-step-time"
                  dateTime={step.at.toISOString()}
                  title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                    step.at,
                  )}
                  className="ms-2 whitespace-nowrap text-xs text-gray-500 tabular-nums"
                >
                  {formatRemediationStepTime(step.at)}
                </time>
              ) : (
                <></>
              )}
            </span>
          );

          return (
            <li
              key={step.kind}
              data-testid="remediation-fix-step"
              data-step={step.kind}
              data-tone={step.tone}
              className="flex gap-x-3"
            >
              {/*
                The step's mark, and the rail down to the next one's: one
                column, so the rail runs from mark to mark however tall the
                step grows when it opens.
              */}
              <div aria-hidden="true" className="flex flex-col items-center">
                <span
                  data-testid="remediation-fix-step-mark"
                  className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full ${
                    REMEDIATION_FIX_STEP_MARK_CLASS_NAMES[step.tone]
                  }`}
                >
                  {renderStepMarkContent(step)}
                </span>
                {isLast ? (
                  <></>
                ) : (
                  <span
                    data-testid="remediation-fix-step-rail"
                    className="mt-1 w-px flex-1 bg-gray-200"
                  />
                )}
              </div>

              <div className={`min-w-0 flex-1 ${isLast ? "" : "pb-3"}`}>
                {step.hasDetails ? (
                  <button
                    type="button"
                    data-testid="remediation-fix-step-toggle"
                    aria-expanded={isOpen}
                    // Names what it opens while that is drawn.
                    aria-controls={isOpen ? detailsId : undefined}
                    onClick={() => {
                      props.onToggleStep(step.kind);
                    }}
                    className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-start gap-x-2 rounded-md px-1.5 text-start hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    {titleRow}
                    <Icon
                      icon={IconProp.ChevronDown}
                      className={`mt-1 h-4 w-4 flex-none text-gray-400 transition-transform ${
                        isOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                ) : (
                  <div className="flex items-start">{titleRow}</div>
                )}

                {/*
                  Why, or what went wrong. What OneUptime AI or an agent wrote
                  reads in its own direction, two lines of it: the open step
                  has all of it (and so says it once, not twice).
                */}
                {step.summary && !(isOpen && step.isSummaryWritten) ? (
                  <p
                    dir={step.isSummaryWritten ? "auto" : undefined}
                    data-testid={
                      SUMMARY_TEST_IDS[step.kind] ||
                      "remediation-fix-step-summary"
                    }
                    className={`break-words text-sm leading-5 text-gray-600 ${
                      step.isSummaryWritten && step.hasDetails
                        ? "line-clamp-2"
                        : ""
                    }`}
                  >
                    {step.summary}
                  </p>
                ) : (
                  <></>
                )}

                {isOpen ? (
                  <div
                    id={detailsId}
                    data-testid="remediation-fix-step-details"
                    data-step={step.kind}
                    className="mt-3 space-y-4"
                  >
                    {props.renderDetails(step.kind)}
                  </div>
                ) : (
                  <></>
                )}

                {actions ? <div className="mt-3">{actions}</div> : <></>}
              </div>
            </li>
          );
        },
      )}
    </ol>
  );
};

export default RemediationFixStepList;
