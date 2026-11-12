import { expect } from "@jest/globals";
import {
  AIActionCardFact,
  AIActionCardValue,
  AIActionCardWords,
  AIActionSentence,
  AIActionSentenceValue,
  describeAIActionCardWords,
  getAIActionPluralTemplate,
  getAIReadCardMonitorTypeTerms,
  isAIActionList,
  isAIActionTerm,
  isKnownAIActionCardWords,
} from "../../Types/AI/AIActionWords";
import {
  AIChatResourceCardOrigin,
  AIChatWidget,
  AIChatWidgetType,
} from "../../Types/AI/AIChatTypes";
import { PluralTemplate } from "../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
} from "./DashboardLocales";

/*
 * THE CARD A READ LEFT, CHECKED AS THE DASHBOARD READS IT (issue #7175).
 *
 * For a test of a read tool: its card has words the Dashboard trusts as a
 * read's (isKnownAIActionCardWords), the English it stores is those words
 * in English, and every word of OneUptime's in it - its kind, each fact's
 * name, each value and sentence - is worded in every Dashboard language.
 * A monitor type's name is the type picker's own key: some languages keep
 * it in English (a follow-up), so it is left to its own test.
 */

// Every key a card's words name: its terms, and its sentences' templates.
export interface ReadCardKeys {
  terms: Array<string>;
  templates: Array<string>;
}

const LETTER: RegExp = /\p{L}/u;
const PLACEHOLDER: RegExp = /\{\{\s*[\w.]+\s*\}\}/g;

function sentenceKeys(sentence: AIActionSentence, keys: ReadCardKeys): void {
  const plural: PluralTemplate | undefined = getAIActionPluralTemplate(
    sentence.template,
  );

  if (plural) {
    keys.templates.push(plural.other, `${plural.other}_one`);
  } else if (LETTER.test(sentence.template.replace(PLACEHOLDER, ""))) {
    keys.templates.push(sentence.template);
  }

  for (const value of Object.values(sentence.values || {})) {
    valueKeys(value, keys);
  }
}

function valueKeys(
  value: AIActionSentenceValue | AIActionCardValue,
  keys: ReadCardKeys,
): void {
  if (typeof value === "string" || typeof value === "number") {
    return;
  }

  if (isAIActionTerm(value)) {
    keys.terms.push(value.term);
    return;
  }

  if (isAIActionList(value)) {
    for (const item of value.list) {
      sentenceKeys(item, keys);
    }
    return;
  }

  if ("template" in value) {
    sentenceKeys(value as AIActionSentence, keys);
  }
}

export function getReadCardKeys(words: AIActionCardWords): ReadCardKeys {
  const keys: ReadCardKeys = { terms: [words.kind.term], templates: [] };

  for (const part of words.line || []) {
    if (typeof part !== "string") {
      sentenceKeys(part, keys);
    }
  }

  for (const fact of words.facts || []) {
    valueKeys(fact.label as AIActionCardFact["value"], keys);
    valueKeys(fact.value, keys);
  }

  return keys;
}

/*
 * Each key of the card a Dashboard language leaves in English, as
 * "<language>: <key>". A monitor type's name is left out (see above).
 */
export function getReadCardWordsNotWorded(
  words: AIActionCardWords,
): Array<string> {
  const keys: ReadCardKeys = getReadCardKeys(words);
  const monitorTypes: ReadonlyArray<string> = getAIReadCardMonitorTypeTerms();
  const missing: Array<string> = [];

  for (const language of DASHBOARD_LANGUAGES) {
    for (const key of [
      ...keys.terms.filter((term: string): boolean => {
        return !monitorTypes.includes(term);
      }),
      ...keys.templates,
    ]) {
      if (!isWordedInDashboardLocale(key, language)) {
        missing.push(`${language}: ${key}`);
      }
    }
  }

  return missing;
}

// A read tool's card, in the reader's language: see the top of this file.
export function expectReadCardWorded(
  widget: AIChatWidget | undefined,
): AIActionCardWords {
  expect(widget).toBeDefined();
  expect(widget!.type).toBe(AIChatWidgetType.ResourceCard);
  expect(widget!.data.origin).toBe(AIChatResourceCardOrigin.Read);

  const words: unknown = widget!.data.words;

  expect(isKnownAIActionCardWords(words, { isRead: true })).toBe(true);

  const english: {
    kind: string;
    line?: string | undefined;
    facts: Array<{ label: string; value: string }>;
  } = describeAIActionCardWords(words as AIActionCardWords);

  // The English the card stores is its words in English.
  expect({
    resourceType: widget!.data.resourceType,
    subheading: widget!.data.subheading,
    fields: widget!.data.fields,
  }).toEqual({
    resourceType: english.kind,
    subheading: english.line,
    fields: english.facts,
  });

  expect(getReadCardWordsNotWorded(words as AIActionCardWords)).toEqual([]);

  return words as AIActionCardWords;
}
