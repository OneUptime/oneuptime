import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import AIRunEventType from "Common/Types/AI/AIRunEventType";
import { InvestigationImpactAspect } from "Common/Utils/AI/InvestigationReport";
import {
  InvestigationImpactCounted,
  InvestigationImpactNumbers,
  parseInvestigationImpactNumbers,
} from "Common/Utils/AI/InvestigationImpactNumbers";
import {
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * WHO AND WHAT IT HURTS, ON THE FOLDED INVESTIGATION STEP (#5715's
 * follow-up: "Impact shows only in the full investigation report, not on
 * the folded Investigation step").
 *
 * A finished investigation folds to its summary. Its report's Impact
 * section - a cited line each for the users, the services and the SLOs,
 * with how each was counted - showed only once the report was opened. The
 * run records the same impact as short numbers (an InvestigationImpact
 * event, Common/Utils/AI/InvestigationImpactNumbers), and the folded step
 * draws them under the summary, one short line each, with the marks the
 * full report's Impact lines have: "1,240 requests affected", "2 services
 * affected", "1 of 2 SLOs affected". What was not measured is left out; a
 * run that recorded no numbers (an older one, or one whose answer measured
 * nothing) shows the summary alone, as before.
 *
 * Import-clean (no React), so the suites read the words without a browser.
 */

// What a users' line counts: users, sessions or requests - never confused.
export const INVESTIGATION_IMPACT_USERS_WORDS: Readonly<
  Record<InvestigationImpactCounted, PluralTemplate>
> = {
  [InvestigationImpactCounted.Users]: {
    one: "{{count}} user affected",
    other: "{{count}} users affected",
  },
  [InvestigationImpactCounted.Sessions]: {
    one: "{{count}} session affected",
    other: "{{count}} sessions affected",
  },
  [InvestigationImpactCounted.Requests]: {
    one: "{{count}} request affected",
    other: "{{count}} requests affected",
  },
};

export const INVESTIGATION_IMPACT_SERVICES_WORDS: PluralTemplate = {
  one: "{{count}} service affected",
  other: "{{count}} services affected",
};

// Counted by how many SLOs count the subject: "1 of 2 SLOs affected".
export const INVESTIGATION_IMPACT_SLOS_WORDS: PluralTemplate = {
  one: "{{affected}} of {{count}} SLO affected",
  other: "{{affected}} of {{count}} SLOs affected",
};

// What the list is, for a screen reader: the report's own section's name.
export const INVESTIGATION_IMPACT_LIST_LABEL: string = translationKey("Impact");

// One line of the folded step's impact: what it is about, and its words.
export interface InvestigationImpactLineWords {
  aspect: InvestigationImpactAspect;
  text: string;
}

/*
 * The numbers a run recorded: its newest InvestigationImpact event's, read
 * as the server wrote them, or null when it recorded none or wrote
 * something that does not hold together.
 */
export function getInvestigationImpactNumbers(
  events: ReadonlyArray<AIRunEvent>,
): InvestigationImpactNumbers | null {
  for (let index: number = events.length - 1; index >= 0; index--) {
    const event: AIRunEvent | undefined = events[index];

    if (event?.eventType !== AIRunEventType.InvestigationImpact) {
      continue;
    }

    return parseInvestigationImpactNumbers(event.resultSummary?.impactNumbers);
  }

  return null;
}

/*
 * The lines the folded step draws, in the report's order - the people, the
 * services, the SLOs - each in the reader's language, its counts in the
 * reader's digits.
 */
export function getInvestigationImpactLines(
  numbers: InvestigationImpactNumbers,
  translator: Translator,
): Array<InvestigationImpactLineWords> {
  const lines: Array<InvestigationImpactLineWords> = [];

  if (numbers.users) {
    lines.push({
      aspect: InvestigationImpactAspect.Users,
      text: translator.translatePlural(
        INVESTIGATION_IMPACT_USERS_WORDS[numbers.users.counted],
        numbers.users.count,
      ),
    });
  }

  if (numbers.services) {
    lines.push({
      aspect: InvestigationImpactAspect.Services,
      text: translator.translatePlural(
        INVESTIGATION_IMPACT_SERVICES_WORDS,
        numbers.services.count,
      ),
    });
  }

  if (numbers.slos) {
    lines.push({
      aspect: InvestigationImpactAspect.Slos,
      text: translator.translatePlural(
        INVESTIGATION_IMPACT_SLOS_WORDS,
        numbers.slos.total,
        { affected: translator.formatNumber(numbers.slos.affected) },
      ),
    });
  }

  return lines;
}
