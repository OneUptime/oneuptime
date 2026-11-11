import AutoRemediationSuggestionStatus from "Common/Types/AutoRemediation/AutoRemediationSuggestionStatus";
import {
  PluralTemplate,
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import { FinishedFixOutcome } from "Common/Utils/Suggestions/CodeFixSuggestion";
import { InvestigationCodeFixSuggestion } from "Common/Utils/Suggestions/InvestigationCodeFixSuggestion";
import SuggestionOffer from "Common/Utils/Suggestions/SuggestionOffer";
import { RemediationDecisionSignal } from "./RemediationDecisionLines";
import { RemediationFixFacts } from "./RemediationStepStatus";

/*
 * WHAT CAME OF FIXING, IN ONE SENTENCE (issue #6860).
 *
 * "Can we make this UI 10x better? Please make it natural to understand."
 * The Remediation step read as a log: a line per lane the rule engine
 * checked ('OneUptime AI is fixing cluster "oneuptime-test". Approvals are
 * bypassed on this cluster, so its fixes run on their own.'), in the
 * present tense long after the fixing ended, then a block per fix, each
 * with its own status - and the reader pieced together what happened from
 * a pill, the lines and every fix's steps.
 *
 * The step now opens with the answer, set like the investigation's TL;DR:
 * what came of fixing this incident or alert, and what - if anything -
 * waits for the reader. "OneUptime AI found no fix for this alert, so
 * nothing was changed." "A fix is ready. It runs once you approve it." "A
 * fix ran, and this incident recovered." The fixes below it say how.
 *
 * It is read from the same facts as the step's pill (RemediationStepStatus),
 * in the same order, so the two never disagree: a fix that waits for the
 * reader first, then one at work, then how the fixes that ran went, then
 * why none ran. Only fixes are summed up: with none, the decision's lines
 * are the whole story and say it themselves; while a pull request that
 * fixes the code is being written or is opened, its own line does.
 *
 * React-free, so App's tests can read it; RemediationStep draws it.
 */

export const REMEDIATION_STEP_SUMMARY_COPY: {
  // A fix waits for the reader's approval: one, or several.
  needsYourApproval: PluralTemplate;
  // ... for the approval of someone who may give it, not the reader's.
  needsSomeonesApproval: PluralTemplate;
  // The reader gave a riskier fix its first approval: someone else runs it.
  needsSecondApproval: string;
  // A fix is moving.
  planning: string;
  running: string;
  verifying: string;
  // How the fixes that ran went.
  recovered: string;
  didNotRecover: string;
  runFailed: string;
  ran: string;
  // Why no fix ran.
  dismissed: PluralTemplate;
  stopped: string;
  stoppedPartway: string;
  noFix: string;
  nothingRan: string;
} = {
  needsYourApproval: {
    one: translationKey(
      "A fix is ready for this {{signal}}. It runs once you approve it.",
    ),
    other: translationKey(
      "{{count}} fixes are ready for this {{signal}}. Each runs once you approve it.",
    ),
  },
  needsSomeonesApproval: {
    one: translationKey(
      "A fix is ready for this {{signal}}. It runs once someone who may approve fixes approves it.",
    ),
    other: translationKey(
      "{{count}} fixes are ready for this {{signal}}. Each runs once someone who may approve fixes approves it.",
    ),
  },
  needsSecondApproval: translationKey(
    "You approved the fix for this {{signal}}. It runs once someone else approves it too.",
  ),
  planning: translationKey(
    "OneUptime AI is working out a fix for this {{signal}}.",
  ),
  running: translationKey("A fix for this {{signal}} is running now."),
  verifying: translationKey(
    "A fix ran. OneUptime is checking whether this {{signal}} recovers.",
  ),
  recovered: translationKey("A fix ran, and this {{signal}} recovered."),
  didNotRecover: translationKey(
    "A fix ran, but this {{signal}} did not recover.",
  ),
  runFailed: translationKey(
    "A fix ran for this {{signal}}, but part of it failed.",
  ),
  ran: translationKey("A fix ran for this {{signal}}."),
  dismissed: {
    one: translationKey(
      "The fix for this {{signal}} was dismissed, so nothing ran.",
    ),
    other: translationKey(
      "The {{count}} fixes for this {{signal}} were dismissed, so nothing ran.",
    ),
  },
  stopped: translationKey(
    "OneUptime AI stopped before it found a fix for this {{signal}}, so nothing was changed.",
  ),
  stoppedPartway: translationKey(
    "OneUptime AI stopped partway through a fix for this {{signal}}. Check what it changed.",
  ),
  noFix: translationKey(
    "OneUptime AI found no fix for this {{signal}}, so nothing was changed.",
  ),
  nothingRan: translationKey("No fix ran for this {{signal}}."),
};

export type RemediationStepSummaryKind =
  keyof typeof REMEDIATION_STEP_SUMMARY_COPY;

// What the summary says: which sentence, and how many fixes it counts.
export interface RemediationStepSummary {
  kind: RemediationStepSummaryKind;
  count: number;
}

export interface RemediationStepSummaryInput {
  fixes: Array<RemediationFixFacts>;
  /*
   * Whether the reader may approve a fix that waits (RemediationFixActGate):
   * false when their permissions certainly do not let them. Left out,
   * theirs - as the pill reads it.
   */
  mayApprove?: boolean | undefined;
  // The fix in the code the investigation recommends, once read.
  codeFix?: InvestigationCodeFixSuggestion | null | undefined;
}

function summary(
  kind: RemediationStepSummaryKind,
  count: number = 1,
): RemediationStepSummary {
  return { kind, count };
}

/*
 * Whether a pull request that fixes the code is being written, or came of
 * the investigation: its own line says what happened, and a sentence over
 * the fixes that nothing was changed would read against it.
 */
function isCodeFixTheStory(
  codeFix: InvestigationCodeFixSuggestion | null | undefined,
): boolean {
  if (!codeFix) {
    return false;
  }

  if (codeFix.offer === SuggestionOffer.InProgress) {
    return true;
  }

  return (
    codeFix.offer === SuggestionOffer.Done &&
    codeFix.fixOutcome !== FinishedFixOutcome.NothingToChange
  );
}

export function getRemediationStepSummary(
  input: RemediationStepSummaryInput,
): RemediationStepSummary | null {
  const fixes: Array<RemediationFixFacts> = input.fixes;

  if (fixes.length === 0) {
    return null;
  }

  // What needs the reader comes first, as on the pill.
  const waiting: Array<RemediationFixFacts> = fixes.filter(
    (fix: RemediationFixFacts): boolean => {
      return (
        fix.status === AutoRemediationSuggestionStatus.Suggested &&
        !fix.isUnapprovable
      );
    },
  );

  if (waiting.length > 0) {
    if (input.mayApprove === false) {
      return summary("needsSomeonesApproval", waiting.length);
    }

    if (
      waiting.every((fix: RemediationFixFacts): boolean => {
        return fix.isFirstApprovedByReader;
      })
    ) {
      return summary("needsSecondApproval");
    }

    return summary(
      "needsYourApproval",
      waiting.filter((fix: RemediationFixFacts): boolean => {
        return !fix.isFirstApprovedByReader;
      }).length,
    );
  }

  // Then what is moving: running first, then the check, then the working out.
  const moving: Array<RemediationFixFacts> = fixes.filter(
    (fix: RemediationFixFacts): boolean => {
      return fix.isInProgress;
    },
  );

  if (moving.length > 0) {
    const isDoing: (progress: RemediationFixFacts["progress"]) => boolean = (
      progress: RemediationFixFacts["progress"],
    ): boolean => {
      return moving.some((fix: RemediationFixFacts): boolean => {
        return fix.progress === progress;
      });
    };

    if (isDoing("running")) {
      return summary("running");
    }

    if (isDoing("verifying")) {
      return summary("verifying");
    }

    return summary("planning");
  }

  if (isCodeFixTheStory(input.codeFix)) {
    return null;
  }

  // How the fixes that ran went, the best outcome first, as on the pill.
  if (
    fixes.some((fix: RemediationFixFacts): boolean => {
      return fix.isVerified;
    })
  ) {
    return summary("recovered");
  }

  const failed: Array<RemediationFixFacts> = fixes.filter(
    (fix: RemediationFixFacts): boolean => {
      return fix.hasFailed;
    },
  );

  if (failed.length > 0) {
    return summary(
      failed.some((fix: RemediationFixFacts): boolean => {
        return Boolean(fix.didNotRecover);
      })
        ? "didNotRecover"
        : "runFailed",
    );
  }

  if (
    fixes.some((fix: RemediationFixFacts): boolean => {
      return fix.hasRun;
    })
  ) {
    return summary("ran");
  }

  // Why none ran.
  if (
    fixes.every((fix: RemediationFixFacts): boolean => {
      return fix.status === AutoRemediationSuggestionStatus.Dismissed;
    })
  ) {
    return summary("dismissed", fixes.length);
  }

  const unfinished: Array<RemediationFixFacts> = fixes.filter(
    (fix: RemediationFixFacts): boolean => {
      return Boolean(fix.isUnfinished);
    },
  );

  /*
   * A round that made a change before it stopped is never said to have
   * changed nothing: the reader checks what it changed.
   */
  if (
    unfinished.some((fix: RemediationFixFacts): boolean => {
      return Boolean(fix.hasAppliedSteps);
    })
  ) {
    return summary("stoppedPartway");
  }

  const isNoFix: (fix: RemediationFixFacts) => boolean = (
    fix: RemediationFixFacts,
  ): boolean => {
    return fix.status === AutoRemediationSuggestionStatus.NoneApplicable;
  };

  if (
    unfinished.length > 0 &&
    fixes.every((fix: RemediationFixFacts): boolean => {
      return isNoFix(fix) || Boolean(fix.isUnfinished);
    })
  ) {
    return summary("stopped");
  }

  if (fixes.every(isNoFix)) {
    return summary("noFix");
  }

  return summary("nothingRan");
}

/*
 * The summary in the reader's language: the incident or the alert as the
 * sentence names it, and the number of fixes it counts.
 */
export function describeRemediationStepSummary(
  stepSummary: RemediationStepSummary,
  data: { translator: Translator; signal: RemediationDecisionSignal },
): string {
  const words: string | PluralTemplate =
    REMEDIATION_STEP_SUMMARY_COPY[stepSummary.kind];
  const values: { signal: ReturnType<typeof translatableTerm> } = {
    signal: translatableTerm(
      data.signal === "incident" ? "Incident" : "Alert",
      { inSentence: true },
    ),
  };

  if (typeof words === "string") {
    return data.translator.translateTemplate(words, values);
  }

  return data.translator.translatePlural(words, stepSummary.count, values);
}
