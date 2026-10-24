import SecurityCaseAiVerdict, {
  isDismissingSecurityCaseAiVerdict,
  securityCaseAiVerdictFromToken,
} from "../../../../Types/SecurityCase/SecurityCaseAiVerdict";
import SecurityCasePriorityLevel, {
  isSecurityCasePriorityLevel,
} from "../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import { isWhiteSpaceCode } from "../../../../Utils/RegExpCharacterClasses";
import { findLabelledValues } from "../LabelledAnswerLines";

/*
 * WHAT A SECURITY CASE'S TRIAGE DECIDED, read from the model's answer.
 *
 * The triage persona (SecurityCaseTriagePrompt) has the model end its report
 * with three lines the server reads:
 *
 *   Verdict: malicious | benign | false-positive | inconclusive
 *   Priority: critical | high | medium | low | informational
 *   Playbook: <the id of one playbook the context listed> | none
 *
 * The priority is one of the five levels every project keeps a built-in
 * priority for (SecurityCasePriorityLevel): the runner keeps the project's
 * priority of that level, by id, whatever the project calls it.
 *
 * The answer is what a model wrote, and a model's answer can be steered by
 * what it read - here, events an attacker may have written. So nothing read
 * here acts on its own: the verdict and the priority are suggestions a
 * person applies with one click, the playbook runs only when a person runs
 * it, and each value must be one the server offered (a playbook id outside
 * the list is no suggestion). Each falls toward a person looking:
 *
 *   - a verdict line that is missing or says anything else reads
 *     Inconclusive;
 *   - a benign or false-positive read of a case whose data held text
 *     written to steer an AI (InstructionLikeText) reads Inconclusive: that
 *     is the read such text is after, so it is the one never taken from it -
 *     and nothing else it suggested is kept either (a lower priority, a
 *     playbook), since the same steered answer wrote it;
 *   - a priority or playbook that cannot be read is no suggestion.
 *
 * The LAST line of each label wins (the model may quote the format before
 * it answers). Lines are found by findLabelledValues, in time in line with
 * the answer.
 */

const VERDICT_VALUE: RegExp =
  /(malicious|benign|false-positive|inconclusive)\b/iy;
const PRIORITY_VALUE: RegExp = /(critical|high|medium|low|informational)\b/iy;
// A playbook id as OneUptime writes one, or "none".
const PLAYBOOK_VALUE: RegExp =
  /(none|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/iy;

export const SECURITY_CASE_TRIAGE_DECISION_LABELS: ReadonlyArray<string> = [
  "verdict",
  "priority",
  "playbook",
];

export interface SecurityCaseTriageDecision {
  verdict: SecurityCaseAiVerdict;
  // The level the model suggested; undefined: no priority could be read.
  suggestedPriority?: SecurityCasePriorityLevel | undefined;
  // One of the playbook ids offered; undefined for none.
  suggestedPlaybookId?: string | undefined;
  /*
   * Whether the verdict the model wrote was set aside for Inconclusive
   * because the case's data held text written to steer an AI.
   */
  verdictSetAside: boolean;
}

function lastValue(text: string, label: string, value: RegExp): string | null {
  const values: Array<string> = findLabelledValues({ text, label, value });

  return values.length > 0 ? values[values.length - 1]! : null;
}

// The level a "Priority:" word names, written as the scale writes it.
function toPriority(
  word: string | null,
): SecurityCasePriorityLevel | undefined {
  if (!word) {
    return undefined;
  }

  const name: string =
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

  return isSecurityCasePriorityLevel(name) ? name : undefined;
}

export function readSecurityCaseTriageDecision(data: {
  analysisMarkdown: string;
  // The ids of the playbooks the context offered, as it wrote them.
  offeredPlaybookIds: Array<string>;
  // Whether the case's data held text written to steer an AI.
  instructionLikeTextFound: boolean;
}): SecurityCaseTriageDecision {
  const text: string = data.analysisMarkdown || "";

  const written: SecurityCaseAiVerdict =
    securityCaseAiVerdictFromToken(lastValue(text, "verdict", VERDICT_VALUE)) ||
    SecurityCaseAiVerdict.Inconclusive;

  const verdictSetAside: boolean =
    data.instructionLikeTextFound && isDismissingSecurityCaseAiVerdict(written);

  const playbookWord: string | null = lastValue(
    text,
    "playbook",
    PLAYBOOK_VALUE,
  );
  const offered: Array<string> = data.offeredPlaybookIds.map(
    (id: string): string => {
      return id.toLowerCase();
    },
  );
  const playbookId: string | undefined =
    playbookWord &&
    playbookWord.toLowerCase() !== "none" &&
    offered.includes(playbookWord.toLowerCase())
      ? playbookWord.toLowerCase()
      : undefined;

  // A read set aside suggests nothing: the steered answer wrote it all.
  return {
    verdict: verdictSetAside ? SecurityCaseAiVerdict.Inconclusive : written,
    suggestedPriority: verdictSetAside
      ? undefined
      : toPriority(lastValue(text, "priority", PRIORITY_VALUE)),
    suggestedPlaybookId: verdictSetAside ? undefined : playbookId,
    verdictSetAside,
  };
}

/*
 * Whether a line is one of the three decision lines: "Verdict:", "Priority:"
 * or "Playbook:" (any case, "=" for ":", in "**" or not), read with one pass
 * over the line.
 */
export function isSecurityCaseTriageDecisionLine(line: string): boolean {
  let index: number = 0;

  const skip: (accept: (code: number) => boolean) => void = (
    accept: (code: number) => boolean,
  ): void => {
    while (index < line.length && accept(line.charCodeAt(index))) {
      index++;
    }
  };

  const isStar: (code: number) => boolean = (code: number): boolean => {
    return code === 0x2a;
  };

  skip(isWhiteSpaceCode);
  skip(isStar);
  skip(isWhiteSpaceCode);

  const rest: string = line.slice(index).toLowerCase();

  for (const label of SECURITY_CASE_TRIAGE_DECISION_LABELS) {
    if (!rest.startsWith(label)) {
      continue;
    }

    index = label.length;

    let after: number = 0;

    while (
      index + after < rest.length &&
      (isWhiteSpaceCode(rest.charCodeAt(index + after)) ||
        isStar(rest.charCodeAt(index + after)))
    ) {
      after++;
    }

    const separator: string = rest.charAt(index + after);

    return separator === ":" || separator === "=";
  }

  return false;
}

/*
 * The report as people read it: the model's analysis without the three
 * decision lines, which the card and the case's columns show in their own
 * words. Trailing blank lines left behind go too.
 */
export function removeSecurityCaseTriageDecisionLines(
  analysisMarkdown: string,
): string {
  const lines: Array<string> = (analysisMarkdown || "").split("\n");

  const kept: Array<string> = lines.filter((line: string): boolean => {
    return !isSecurityCaseTriageDecisionLine(line);
  });

  while (kept.length > 0 && kept[kept.length - 1]!.trim() === "") {
    kept.pop();
  }

  return kept.join("\n");
}
