import AutoRemediationSuggestionStatus from "Common/Types/AutoRemediation/AutoRemediationSuggestionStatus";
import {
  hasRemediationRoundAppliedSteps,
  RemediationRoundCheck,
  RemediationRoundCheckStatus,
  RemediationRuledOutFix,
} from "Common/Types/AutoRemediation/RemediationRound";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";
import AiRunFailureNotice from "../AI/AiRunFailureNotice";
import { RemediationFixReasoning } from "./RemediationFixStepDetails";
import { readRemediationMoment } from "./RemediationFixSteps";
import { getRemediationReasoningMarkdown } from "./RemediationReasoning";
import { RemediationRoundView } from "./RemediationRoundView";
import { REMEDIATION_ROUND_COPY } from "./RemediationStepCopy";

/*
 * WHAT A ROUND OF AN AI FIX DID (issues #6436, #6487), under the fix's
 * plan step: "Why wasn't the safe fix found? What did you do ... did you
 * ask for an approval? What fix wasn't safe? What commands did you run?"
 *
 * The plan step opens to its answer in that order. First the lead
 * (RemediationRoundLead):
 *
 *   - a round that stopped before it found a fix: why, what to do, and
 *     Try again for whoever may (AiRunFailureNotice, as every AI card says
 *     a run did not finish);
 *   - a round that found no fix: why, as the AI said it - the step's
 *     summary, which the open step leaves out, said here whole - with the
 *     AI's whole answer folded under it (it says the same why again, at
 *     length);
 *   - any other fix: the AI's reasoning, as before.
 *
 * Then what the fix runs (the plan's commands, or its changes), and then
 * what the round did to get there (RemediationRoundEvidence):
 *
 *   - the fixes it ruled out, each with why not and the commands it would
 *     have run (what the AI said when it ended without one);
 *   - what it checked: each command it ran on the cluster or the resource,
 *     how it went, when and why it ran it, and how often it queried the
 *     project's telemetry besides;
 *   - for a round with no fix: that nothing ran and nobody was asked to
 *     approve anything.
 *
 * The AI's words (a fix, a reason, a command) are its own text, set apart
 * (dir="auto", or a left-to-right code line) so they read their own way
 * on a right-to-left page.
 */

/*
 * Why the round found no fix, in the AI's words (explain_no_fix), or ""
 * when it has none to say: only a round that finished without a fix.
 */
export function getRemediationRoundReason(data: {
  round: RemediationRoundView | undefined;
  status: AutoRemediationSuggestionStatus;
  isUnfinished: boolean;
}): string {
  if (
    data.isUnfinished ||
    data.status !== AutoRemediationSuggestionStatus.NoneApplicable
  ) {
    return "";
  }

  return data.round?.explanation?.reason || "";
}

// The same words, however their lines and spaces fall.
function isSameText(a: string, b: string): boolean {
  return a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
}

export interface LeadProps {
  /*
   * The round, once read. Before that - or for a fix no AI run worked out -
   * the lead is the fix's reasoning alone.
   */
  round?: RemediationRoundView | undefined;
  status: AutoRemediationSuggestionStatus;
  // Its round stopped without its answer (isRemediationRoundUnfinished).
  isUnfinished: boolean;
  // Start the round again: offered only when the reader may.
  onTryAgain?: (() => Promise<void>) | undefined;
  // What the AI wrote for the fix (its rationale), in Markdown.
  reasoningMarkdown?: string | undefined;
}

/*
 * What the plan step opens to first: why it stopped, why it found no fix,
 * or the AI's reasoning for the fix it proposes.
 */
export const RemediationRoundLead: FunctionComponent<LeadProps> = (
  props: LeadProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isReasoningShown, setIsReasoningShown] = useState<boolean>(false);
  const reasoningId: string = useId();
  const round: RemediationRoundView | undefined = props.round;

  if (round && props.isUnfinished) {
    /*
     * The note the round was settled with says less than the notice (that
     * it did not finish): it gives way.
     */
    return (
      <AiRunFailureNotice
        title={REMEDIATION_ROUND_COPY.whyItStopped}
        events={round.events}
        errorMessage={round.run?.errorMessage}
        onTryAgain={round.mayTryAgain ? props.onTryAgain : undefined}
        testId="remediation-round-failure"
      />
    );
  }

  const reason: string = getRemediationRoundReason({
    round,
    status: props.status,
    isUnfinished: props.isUnfinished,
  });
  /*
   * The AI's answer alone: the round posted it as a report, with a heading,
   * an Evidence checked list and a footer that called the run read-only
   * (issue #6860) - what it checked is listed under the fix already.
   */
  const reasoningMarkdown: string = getRemediationReasoningMarkdown(
    props.reasoningMarkdown,
  );

  if (!reason) {
    return reasoningMarkdown ? (
      <RemediationFixReasoning markdown={reasoningMarkdown} />
    ) : (
      <></>
    );
  }

  /*
   * The AI's whole answer says the why again, at length: it is one press
   * away under the reason, never a second copy of it in sight.
   */
  const isReasoningFolded: boolean =
    Boolean(reasoningMarkdown) && !isSameText(reasoningMarkdown, reason);

  return (
    <div data-testid="remediation-round-lead">
      <p
        dir="auto"
        data-testid="remediation-round-reason"
        className="break-words text-sm leading-6 text-gray-700"
      >
        {reason}
      </p>
      {/*
        Set in under the reason, on a rule of its own: the AI's answer as
        it wrote it, apart from the reason it gave.
      */}
      {isReasoningFolded && isReasoningShown ? (
        <div id={reasoningId} className="mt-3 border-s-2 border-gray-200 ps-3">
          <RemediationFixReasoning markdown={reasoningMarkdown} />
        </div>
      ) : (
        <></>
      )}
      {isReasoningFolded ? (
        <button
          type="button"
          data-testid="remediation-round-reasoning-toggle"
          aria-expanded={isReasoningShown}
          // Names what it opens while that is drawn.
          aria-controls={isReasoningShown ? reasoningId : undefined}
          onClick={() => {
            setIsReasoningShown(!isReasoningShown);
          }}
          className="mt-2 inline-flex items-center gap-1 rounded text-sm font-medium text-indigo-600 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          <span>
            {translator.translateText(
              isReasoningShown
                ? REMEDIATION_ROUND_COPY.showLessReasoning
                : REMEDIATION_ROUND_COPY.showFullReasoning,
            )}
          </span>
          <Icon
            icon={isReasoningShown ? IconProp.ChevronUp : IconProp.ChevronDown}
            className="h-4 w-4 flex-shrink-0"
          />
        </button>
      ) : (
        <></>
      )}
    </div>
  );
};

/*
 * How each check went, as its mark: the marks of the run's activity
 * (ChatActivityFeed), so a command reads the same here as there.
 */
const CHECK_MARK_LABELS: Record<RemediationRoundCheckStatus, string> = {
  ran: REMEDIATION_ROUND_COPY.checkRan,
  failed: REMEDIATION_ROUND_COPY.checkFailed,
  unknown: REMEDIATION_ROUND_COPY.checkUnknown,
  running: REMEDIATION_ROUND_COPY.checkRunning,
  stopped: REMEDIATION_ROUND_COPY.checkStopped,
};

function renderCheckMarkContent(
  status: RemediationRoundCheckStatus,
): ReactElement {
  if (status === "running") {
    return (
      <span className="h-3 w-3 flex-shrink-0 animate-spin rounded-full border-2 border-gray-200 border-t-gray-600"></span>
    );
  }

  const marks: Record<
    Exclude<RemediationRoundCheckStatus, "running">,
    { icon: IconProp; className: string }
  > = {
    ran: { icon: IconProp.Check, className: "text-emerald-500" },
    failed: { icon: IconProp.Close, className: "text-red-500" },
    unknown: { icon: IconProp.Help, className: "text-amber-500" },
    stopped: { icon: IconProp.MinusCircle, className: "text-gray-400" },
  };

  return (
    <Icon
      icon={marks[status].icon}
      className={`h-3 w-3 flex-shrink-0 ${marks[status].className}`}
    />
  );
}

// A check's time of day, and its full date and time for the hover.
function describeCheckTime(date: Date): { short: string; full: string } {
  return {
    short: OneUptimeDate.getLocalTimeString(date, {
      includeSeconds: true,
      use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
    }),
    full: OneUptimeDate.getDateAsLocalShortDateTimeString(date, {
      includeSeconds: true,
    }),
  };
}

const SECTION_HEADING_CLASS_NAME: string = "text-xs font-medium text-gray-500";

const RuledOutFixList: FunctionComponent<{
  fixes: Array<RemediationRuledOutFix>;
}> = (props: { fixes: Array<RemediationRuledOutFix> }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <section data-testid="remediation-round-ruled-out">
      <h4 className={SECTION_HEADING_CLASS_NAME}>
        {translator.translateText(REMEDIATION_ROUND_COPY.ruledOutHeading)}
      </h4>
      <ul className="mt-2 flex flex-col gap-3">
        {props.fixes.map(
          (fix: RemediationRuledOutFix, index: number): ReactElement => {
            return (
              <li
                key={`ruled-out-${index}`}
                data-testid="remediation-round-ruled-out-fix"
                className="border-s-2 border-gray-200 ps-3"
              >
                <p
                  dir="auto"
                  data-testid="remediation-round-ruled-out-what"
                  className="break-words text-sm font-medium text-gray-900"
                >
                  {fix.fix}
                </p>
                <p
                  dir="auto"
                  data-testid="remediation-round-ruled-out-why"
                  className="mt-0.5 break-words text-sm text-gray-600"
                >
                  {fix.whyNot}
                </p>
                {fix.commands.map(
                  (command: string, commandIndex: number): ReactElement => {
                    // As a plan's command reads (RemediationFixStepDetails).
                    return (
                      <pre
                        key={`ruled-out-${index}-${commandIndex}`}
                        dir="ltr"
                        data-testid="remediation-round-ruled-out-command"
                        className="mt-2 whitespace-pre-wrap rounded-md bg-gray-50 px-3 py-2 font-mono text-xs leading-5 text-gray-800 [overflow-wrap:anywhere]"
                      >
                        {command}
                      </pre>
                    );
                  },
                )}
              </li>
            );
          },
        )}
      </ul>
    </section>
  );
};

const CheckList: FunctionComponent<{
  checks: Array<RemediationRoundCheck>;
  otherCheckCount: number;
}> = (props: {
  checks: Array<RemediationRoundCheck>;
  otherCheckCount: number;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <section data-testid="remediation-round-checks">
      <h4 className={SECTION_HEADING_CLASS_NAME}>
        {translator.translateText(REMEDIATION_ROUND_COPY.checksHeading)}
      </h4>
      {props.checks.length > 0 ? (
        <ol className="mt-2 flex flex-col gap-2 [container-type:inline-size]">
          {props.checks.map(
            (check: RemediationRoundCheck, index: number): ReactElement => {
              const at: Date | null = readRemediationMoment(check.at);
              const time: { short: string; full: string } | null = at
                ? describeCheckTime(at)
                : null;
              const markLabel: string = translator.translateText(
                CHECK_MARK_LABELS[check.status],
              ) as string;

              return (
                <li
                  key={`check-${index}`}
                  data-testid="remediation-round-check"
                  data-status={check.status}
                  className="flex min-w-0 items-start gap-2 text-xs leading-5"
                >
                  {/*
                    The mark, centred on the command's first line, as a
                    list's bullet is.
                  */}
                  <div
                    role="img"
                    aria-label={markLabel}
                    title={markLabel}
                    data-testid="remediation-round-check-mark"
                    className="flex h-5 flex-shrink-0 items-center"
                  >
                    {renderCheckMarkContent(check.status)}
                  </div>
                  <div className="min-w-0 flex-1">
                    {/*
                      The command, then when it ran: at the end of its
                      line where the list is wide enough to line the times
                      up, as the run's activity does; right after it on a
                      narrow card, where a column of times left each
                      command a few letters a line.
                    */}
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 [@container(min-width:26rem)]:flex-nowrap">
                      <code
                        dir="ltr"
                        data-testid="remediation-round-check-command"
                        className="min-w-0 font-mono text-gray-800 [overflow-wrap:anywhere]"
                      >
                        {check.command}
                      </code>
                      {at && time ? (
                        <time
                          dateTime={at.toISOString()}
                          title={time.full}
                          data-testid="remediation-round-check-time"
                          className="flex-shrink-0 tabular-nums text-gray-400 [@container(min-width:26rem)]:ms-auto"
                        >
                          {time.short}
                        </time>
                      ) : (
                        <></>
                      )}
                    </div>
                    {check.why ? (
                      <p
                        dir="auto"
                        data-testid="remediation-round-check-why"
                        className="break-words text-gray-500"
                      >
                        {check.why}
                      </p>
                    ) : (
                      <></>
                    )}
                    {check.error ? (
                      <p
                        dir="auto"
                        data-testid="remediation-round-check-error"
                        className="mt-0.5 whitespace-pre-wrap break-words font-mono text-rose-600 [overflow-wrap:anywhere]"
                      >
                        {check.error}
                      </p>
                    ) : (
                      <></>
                    )}
                  </div>
                </li>
              );
            },
          )}
        </ol>
      ) : (
        <></>
      )}
      {props.otherCheckCount > 0 ? (
        <p
          data-testid="remediation-round-other-checks"
          className="mt-2 text-xs leading-5 text-gray-500"
        >
          {translator.translatePlural(
            REMEDIATION_ROUND_COPY.otherChecks,
            props.otherCheckCount,
          )}
        </p>
      ) : (
        <></>
      )}
    </section>
  );
};

/*
 * Whether a fix ran, and whether anyone was asked to approve one: said for
 * a round that found no fix, or stopped before it found one. A fix that
 * waits for approval, or ran, says so in its own steps - and so does a
 * round that made a change before it stopped (hasAppliedSteps): it is not
 * said that nothing ran.
 */
export function getRemediationRoundApprovalLine(data: {
  status: AutoRemediationSuggestionStatus;
  isRunbook: boolean;
  isUnfinished: boolean;
  hasAppliedSteps?: boolean | undefined;
}): string | null {
  if (data.hasAppliedSteps) {
    return null;
  }

  if (data.isUnfinished) {
    return data.isRunbook
      ? REMEDIATION_ROUND_COPY.nothingAskedUnfinishedRunbook
      : REMEDIATION_ROUND_COPY.nothingAskedUnfinished;
  }

  if (data.status !== AutoRemediationSuggestionStatus.NoneApplicable) {
    return null;
  }

  return data.isRunbook
    ? REMEDIATION_ROUND_COPY.nothingAskedNoRunbook
    : REMEDIATION_ROUND_COPY.nothingAskedNoFix;
}

export interface EvidenceProps {
  /*
   * The round, once read. Before that - or for a fix no AI run worked out -
   * only whether anything ran and was asked is said.
   */
  round?: RemediationRoundView | undefined;
  status: AutoRemediationSuggestionStatus;
  // It picks a runbook, rather than working out commands or changes.
  isRunbook: boolean;
  // Its round stopped without its answer (isRemediationRoundUnfinished).
  isUnfinished: boolean;
}

/*
 * What the round did to get to its answer, after the answer: the fixes it
 * ruled out, what it checked, and - when it found none - that nothing ran
 * and nobody was asked.
 */
export const RemediationRoundEvidence: FunctionComponent<EvidenceProps> = (
  props: EvidenceProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const round: RemediationRoundView | undefined = props.round;
  const ruledOutFixes: Array<RemediationRuledOutFix> =
    round?.explanation?.ruledOutFixes || [];
  const approvalLine: string | null = getRemediationRoundApprovalLine({
    status: props.status,
    isRunbook: props.isRunbook,
    isUnfinished: props.isUnfinished,
    hasAppliedSteps: round
      ? hasRemediationRoundAppliedSteps(round.appliedSteps)
      : false,
  });

  return (
    <>
      {ruledOutFixes.length > 0 ? (
        <RuledOutFixList fixes={ruledOutFixes} />
      ) : (
        <></>
      )}
      {round && (round.checks.length > 0 || round.otherCheckCount > 0) ? (
        <CheckList
          checks={round.checks}
          otherCheckCount={round.otherCheckCount}
        />
      ) : (
        <></>
      )}
      {approvalLine ? (
        <p
          data-testid="remediation-round-approval"
          className="text-sm leading-6 text-gray-600"
        >
          {translator.translateText(approvalLine)}
        </p>
      ) : (
        <></>
      )}
    </>
  );
};
