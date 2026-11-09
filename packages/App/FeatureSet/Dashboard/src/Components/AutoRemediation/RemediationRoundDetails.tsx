import AutoRemediationSuggestionStatus from "Common/Types/AutoRemediation/AutoRemediationSuggestionStatus";
import {
  hasRemediationRoundAppliedSteps,
  RemediationRoundCheck,
  RemediationRoundCheckStatus,
  RemediationRuledOutFix,
} from "Common/Types/AutoRemediation/RemediationRound";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import AiRunFailureNotice from "../AI/AiRunFailureNotice";
import { formatAiRunTime } from "../AI/AiRunFailureWords";
import { readRemediationMoment } from "./RemediationFixSteps";
import { RemediationRoundView } from "./RemediationRoundView";
import { REMEDIATION_ROUND_COPY } from "./RemediationStepCopy";

/*
 * WHAT A ROUND OF AN AI FIX DID (issues #6436, #6487), under the fix's
 * plan step: "Why wasn't the safe fix found? What did you do ... did you
 * ask for an approval? What fix wasn't safe? What commands did you run?"
 *
 *   - a round that stopped before it found a fix: why, what to do, and
 *     Try again for whoever may (AiRunFailureNotice, as every AI card says
 *     a run did not finish);
 *   - for a round that found no fix, why, as the AI said it: the summary
 *     of the step, which the open step leaves out (it says a written
 *     summary once), so it is said here, whole;
 *   - the fixes it ruled out, each with why not and the commands it would
 *     have run (what the AI said when it ended without one);
 *   - what it checked: each command it ran on the cluster or the resource,
 *     how it went and why it ran it, and how often it queried the
 *     project's telemetry besides;
 *   - for a round with no fix: that nothing ran and nobody was asked to
 *     approve anything.
 *
 * The AI's words (a fix, a reason, a command) are its own text, set apart
 * (bdi, or a left-to-right code line) so they read their own way on a
 * right-to-left page.
 */

export interface ComponentProps {
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
  // Start the round again: offered only when the reader may.
  onTryAgain?: (() => Promise<void>) | undefined;
}

const CHECK_MARKS: Record<
  RemediationRoundCheckStatus,
  { icon: IconProp; className: string; label: string }
> = {
  ran: {
    icon: IconProp.Check,
    className: "text-emerald-600",
    label: REMEDIATION_ROUND_COPY.checkRan,
  },
  failed: {
    icon: IconProp.Close,
    className: "text-rose-600",
    label: REMEDIATION_ROUND_COPY.checkFailed,
  },
  unknown: {
    icon: IconProp.Help,
    className: "text-amber-600",
    label: REMEDIATION_ROUND_COPY.checkUnknown,
  },
  running: {
    icon: IconProp.Refresh,
    className: "text-indigo-600",
    label: REMEDIATION_ROUND_COPY.checkRunning,
  },
  stopped: {
    icon: IconProp.Minus,
    className: "text-gray-400",
    label: REMEDIATION_ROUND_COPY.checkStopped,
  },
};

const SECTION_HEADING_CLASS_NAME: string = "text-xs font-medium text-gray-500";

const CODE_LINE_CLASS_NAME: string =
  "block whitespace-pre-wrap rounded bg-gray-50 px-2 py-1 font-mono text-xs leading-5 text-gray-800 [overflow-wrap:anywhere]";

const RuledOutFixList: FunctionComponent<{
  fixes: Array<RemediationRuledOutFix>;
}> = (props: { fixes: Array<RemediationRuledOutFix> }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <section data-testid="remediation-round-ruled-out">
      <h5 className={SECTION_HEADING_CLASS_NAME}>
        {translator.translateText(REMEDIATION_ROUND_COPY.ruledOutHeading)}
      </h5>
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
                  data-testid="remediation-round-ruled-out-what"
                  className="break-words text-sm font-medium text-gray-900"
                >
                  <bdi>{fix.fix}</bdi>
                </p>
                <p
                  data-testid="remediation-round-ruled-out-why"
                  className="mt-0.5 break-words text-sm text-gray-600"
                >
                  <bdi>{fix.whyNot}</bdi>
                </p>
                {fix.commands.length > 0 ? (
                  <div className="mt-1.5 flex flex-col gap-1">
                    {fix.commands.map(
                      (command: string, commandIndex: number): ReactElement => {
                        return (
                          <code
                            key={`ruled-out-${index}-${commandIndex}`}
                            dir="ltr"
                            data-testid="remediation-round-ruled-out-command"
                            className={CODE_LINE_CLASS_NAME}
                          >
                            {command}
                          </code>
                        );
                      },
                    )}
                  </div>
                ) : (
                  <></>
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
      <h5 className={SECTION_HEADING_CLASS_NAME}>
        {translator.translateText(REMEDIATION_ROUND_COPY.checksHeading)}
      </h5>
      {props.checks.length > 0 ? (
        <ol className="mt-2 flex flex-col gap-2">
          {props.checks.map(
            (check: RemediationRoundCheck, index: number): ReactElement => {
              const mark: {
                icon: IconProp;
                className: string;
                label: string;
              } = CHECK_MARKS[check.status];
              const at: Date | null = readRemediationMoment(check.at);
              const markLabel: string = translator.translateText(
                mark.label,
              ) as string;

              return (
                <li
                  key={`check-${index}`}
                  data-testid="remediation-round-check"
                  data-status={check.status}
                  className="flex min-w-0 items-start gap-2"
                >
                  <span
                    role="img"
                    aria-label={markLabel}
                    title={markLabel}
                    data-testid="remediation-round-check-mark"
                    className={`mt-1 flex-shrink-0 ${mark.className}`}
                  >
                    <Icon icon={mark.icon} className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <code
                        dir="ltr"
                        data-testid="remediation-round-check-command"
                        className="min-w-0 font-mono text-xs leading-5 text-gray-800 [overflow-wrap:anywhere]"
                      >
                        {check.command}
                      </code>
                      {at ? (
                        <time
                          dateTime={at.toISOString()}
                          className="text-xs text-gray-400 tabular-nums"
                        >
                          {formatAiRunTime(at)}
                        </time>
                      ) : (
                        <></>
                      )}
                    </div>
                    {check.why ? (
                      <p
                        data-testid="remediation-round-check-why"
                        className="break-words text-xs leading-5 text-gray-500"
                      >
                        <bdi>{check.why}</bdi>
                      </p>
                    ) : (
                      <></>
                    )}
                    {check.error ? (
                      <p
                        dir="auto"
                        data-testid="remediation-round-check-error"
                        className="mt-0.5 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-rose-700 [overflow-wrap:anywhere]"
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

const RemediationRoundDetails: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const round: RemediationRoundView | undefined = props.round;
  const ruledOutFixes: Array<RemediationRuledOutFix> =
    round?.explanation?.ruledOutFixes || [];
  /*
   * Why it found none, in the AI's words: the step's summary, which the
   * open step leaves out - it is said here, whole, first.
   */
  const reason: string =
    !props.isUnfinished &&
    props.status === AutoRemediationSuggestionStatus.NoneApplicable
      ? round?.explanation?.reason || ""
      : "";
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
      {round && props.isUnfinished ? (
        <AiRunFailureNotice
          title={REMEDIATION_ROUND_COPY.whyItStopped}
          events={round.events}
          errorMessage={round.run?.errorMessage}
          onTryAgain={round.mayTryAgain ? props.onTryAgain : undefined}
          testId="remediation-round-failure"
        />
      ) : (
        <></>
      )}
      {reason ? (
        <p
          dir="auto"
          data-testid="remediation-round-reason"
          className="break-words text-sm leading-6 text-gray-700"
        >
          {reason}
        </p>
      ) : (
        <></>
      )}
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

export default RemediationRoundDetails;
