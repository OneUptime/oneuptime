import {
  OnCallPassOnAnswer,
  OnCallPassOnOutcome,
  OnCallPassOnRefusal,
  OnCallPassOnResult,
  OnCallPassOnRule,
  getOnCallPassOnLevelCount,
  getOnCallPassOnLevelName,
} from "./OnCallPagePassOn";
import {
  ComposedValue,
  composedValue,
  translationKey,
  Translator,
} from "../Translator";

/*
 * WHAT ESCALATING A PAGE DID, OR WOULD DO, IN THE READER'S LANGUAGE.
 *
 * The server says it in English (OnCallPagePassOn's getOnCallPassOnSentence:
 * its confirm page, the page after it, the API's answer and an English
 * call). These are the same sentences in every language OneUptime writes
 * in, as the Dashboard's Escalate dialog says them (Components/OnCallPolicy/
 * PassOn/PassOnPage) and as a page's call in its person's language says
 * them once 2 is pressed (#11066, OnCallPageCallAnswers):
 *
 *   This will immediately page Platform leads (Level 2 of 3), without
 *     waiting.
 *   The policy is now paging Platform leads (Level 2 of 3): Sam Lee.
 *   Bob Smith is still being paged. If nobody acknowledges by 5:28 AM UTC,
 *     the policy pages Level 3 of 3 next.
 *
 * They are the Dashboard's sentences, worded in the Dashboard's locale
 * files - this file is one of the Dashboard extractor's key roots - and
 * copied into the server's by npm run i18n:server-sync
 * (Common/Scripts/I18n/ServerLocales' DASHBOARD_SHARED_TEXT_SOURCES), so the
 * dialog and the call say the same words. Each sentence is whole; a level
 * and a list of names go into it as values worded in its language.
 *
 * Pure, with no Node, browser or database APIs.
 */

// The words a list of names is joined with, two or three of them.
const NAME_LIST: Readonly<Record<2 | 3, string>> = {
  2: translationKey("{{first}} and {{second}}"),
  3: translationKey("{{first}}, {{second}} and {{third}}"),
};

/*
 * "Ana, Bob and Carl" in `translator`'s language: two or three names with
 * its "and", more than three said together as the first, as the Dashboard
 * joins a list (AiAccessModes' formatNameList).
 */
export function joinOnCallPassOnNames(
  names: ReadonlyArray<string>,
  translator: Translator,
): string {
  if (names.length <= 1) {
    return names.join("");
  }

  if (names.length > 3) {
    const together: number = names.length - 2;

    return joinOnCallPassOnNames(
      [names.slice(0, together).join(", "), ...names.slice(together)],
      translator,
    );
  }

  const [first, second, third] = names;

  return translator.translateTemplate(
    NAME_LIST[names.length as 2 | 3],
    third === undefined
      ? { first: first!, second: second! }
      : { first: first!, second: second!, third },
  );
}

// The names as a sentence's value, joined in that sentence's language.
const namesValue: (names: ReadonlyArray<string>) => ComposedValue = (
  names: ReadonlyArray<string>,
): ComposedValue => {
  return composedValue((sentence: Translator): string => {
    return joinOnCallPassOnNames(names, sentence);
  });
};

/*
 * A level's label in `translator`'s language, by the name it is given:
 * "Platform leads (Level 2 of 3)", or "Level 2 of 3" for a level with no
 * name. `name` stands for the level's own name - the Dashboard hands it a
 * mark to find the level's place in the label by.
 */
export function getOnCallPassOnLevelLabelInLanguage(
  translator: Translator,
  rule: OnCallPassOnRule,
  ruleCount: number,
  name: string | undefined,
): string {
  const place: { order: string; count: string } = {
    order: translator.formatNumber(rule.order),
    count: translator.formatNumber(getOnCallPassOnLevelCount(rule, ruleCount)),
  };

  return name
    ? translator.translateTemplate("{{name}} (Level {{order}} of {{count}})", {
        ...place,
        name: name,
      })
    : translator.translateTemplate("Level {{order}} of {{count}}", place);
}

/*
 * A level as a sentence's value, worded in that sentence's language - or
 * null for a level that is not known: no rule, or one whose place could not
 * be read (order 0), which the sentences name as "the next level".
 */
export function getOnCallPassOnLevelValue(
  rule: OnCallPassOnRule | undefined,
  ruleCount: number,
): ComposedValue | null {
  if (!rule || !rule.order) {
    return null;
  }

  const name: string | undefined = getOnCallPassOnLevelName(rule);

  return composedValue((sentence: Translator): string => {
    return getOnCallPassOnLevelLabelInLanguage(sentence, rule, ruleCount, name);
  });
}

/*
 * What escalating a page would do, or did, in `translator`'s language: the
 * Dashboard's words for the server's sentences (getOnCallPassOnSentence).
 * `formatTime` says when the policy moves on, as the reader's clock reads
 * it: the Dashboard's in the browser's zone, a call's in the person's.
 */
export function describeOnCallPassOnResultInLanguage(
  result: OnCallPassOnResult,
  translator: Translator,
  formatTime: (at: Date) => string,
): string {
  const level: ComposedValue | null = getOnCallPassOnLevelValue(
    result.rule,
    result.ruleCount,
  );

  switch (result.outcome) {
    case OnCallPassOnOutcome.NextRulePaged: {
      if (result.isPreview) {
        return level
          ? translator.translateTemplate(
              "This will immediately page {{level}}, without waiting.",
              { level: level },
            )
          : translator.translateTemplate(
              "This will immediately page the next level, without waiting.",
            );
      }

      if (!level) {
        return translator.translateTemplate(
          "The policy is now paging the next level.",
        );
      }

      return result.pagedNames.length > 0
        ? translator.translateTemplate(
            "The policy is now paging {{level}}: {{names}}.",
            { level: level, names: namesValue(result.pagedNames) },
          )
        : translator.translateTemplate("The policy is now paging {{level}}.", {
            level: level,
          });
    }
    case OnCallPassOnOutcome.PolicyStartedAgain: {
      if (result.isPreview) {
        return level
          ? translator.translateTemplate(
              "There is no level after yours, so this will immediately page {{level}} again, without waiting.",
              { level: level },
            )
          : translator.translateTemplate(
              "There is no level after yours, so this will immediately page the first level again, without waiting.",
            );
      }

      return level
        ? translator.translateTemplate(
            "There was no level after yours, so the policy started over and is paging {{level}} again.",
            { level: level },
          )
        : translator.translateTemplate(
            "There was no level after yours, so the policy started over and is paging the first level again.",
          );
    }
    case OnCallPassOnOutcome.OthersStillPaged: {
      const still: string = translator.translatePlural(
        {
          one: "{{names}} is still being paged.",
          other: "{{names}} are still being paged.",
        },
        Math.max(result.stillPagedNames.length, 1),
        { names: namesValue(result.stillPagedNames) },
      );

      if (result.isDirectPage || !result.nextStepAt) {
        return still;
      }

      const next: ComposedValue | null = getOnCallPassOnLevelValue(
        result.nextRule,
        result.ruleCount,
      );
      const time: string = formatTime(result.nextStepAt);

      const then: string = next
        ? translator.translateTemplate(
            "If nobody acknowledges by {{time}}, the policy pages {{level}} next.",
            { level: next, time: time },
          )
        : translator.translateTemplate(
            "If nobody acknowledges by {{time}}, the policy moves on.",
            { time: time },
          );

      return `${still} ${then}`;
    }
    case OnCallPassOnOutcome.AlreadyEscalated:
      return level
        ? translator.translateTemplate(
            "The policy has moved on already and is paging {{level}} now.",
            { level: level },
          )
        : translator.translateTemplate(
            "The policy has moved on already and is paging a later level now.",
          );
    case OnCallPassOnOutcome.PagingStopped:
    default:
      if (result.isPreview) {
        return result.isDirectPage
          ? translator.translateTemplate(
              "Nobody else is being paged: paging stops, and somebody needs to take it.",
            )
          : translator.translateTemplate(
              "Nobody else is left to page: paging stops, and somebody needs to take it.",
            );
      }

      return translator.translateTemplate(
        "Nobody else is left to page, so paging stopped. Somebody needs to take it.",
      );
  }
}

// Why a page could not be escalated, in `translator`'s language.
export function describeOnCallPassOnRefusalInLanguage(
  answer: OnCallPassOnAnswer,
  translator: Translator,
): string {
  switch (answer.refusal) {
    case OnCallPassOnRefusal.RecordAcknowledged:
      return (answer.acknowledgedByName || "").trim()
        ? translator.translateTemplate(
            "{{name}} acknowledged it already, so there is nothing to escalate.",
            { name: (answer.acknowledgedByName || "").trim() },
          )
        : translator.translateTemplate(
            "Somebody acknowledged it already, so there is nothing to escalate.",
          );
    case OnCallPassOnRefusal.AlreadyPassedOn:
      return translator.translateTemplate(
        "You escalated it already, so you will not be paged again for it.",
      );
    case OnCallPassOnRefusal.PageOver:
      return translator.translateTemplate(
        "This page is over: the on-call policy has stopped paging.",
      );
    // The level picked was not there to page: nothing changed.
    case OnCallPassOnRefusal.LevelNotAvailable:
      return translator.translateTemplate(
        "The policy's levels have changed, so nothing was escalated. Escalate again to pick a level.",
      );
    case OnCallPassOnRefusal.NotPaged:
    case OnCallPassOnRefusal.InvalidLink:
    default:
      return translator.translateTemplate(
        "You are not being paged about this right now.",
      );
  }
}
