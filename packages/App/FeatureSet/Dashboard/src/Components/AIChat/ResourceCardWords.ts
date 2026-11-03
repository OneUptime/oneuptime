import {
  AI_ACTION_CARD_LINE_SEPARATOR,
  AIActionCardFact,
  AIActionCardWords,
  AIActionSentence,
  describeAIActionCardValue,
  getAIActionSentenceDirection,
  isAIActionList,
  isKnownAIActionCardWords,
} from "Common/Types/AI/AIActionWords";
import { AIChatWidget } from "Common/Types/AI/AIChatTypes";
import {
  getFactsNotInHeading,
  ResourceCardFact,
} from "Common/Types/AI/ResourceCardFacts";
import { getReadingDirection } from "Common/Types/ReadingDirection";
import { Translator } from "Common/Types/Translator";
import { drawActionSentence, DrawnActionSentence } from "./ToolActionWords";

/*
 * THE CARD AN ACTION LEFT, IN THE READER'S LANGUAGE.
 *
 * Under an answer, the card a write left says what it made or changed:
 * "INCIDENT", "INC-42 · Checkout down", "Severity: High · Started
 * resolved", and its facts. The server stores the card twice: in English
 * (resourceType, subheading, fields), which the exports print and which a
 * card saved before this reads as, and as sentences and terms of
 * Common/Types/AI/AIActionWords (data.words), which this words in the
 * reader's language - the number, the title, a host's name and the note
 * the model wrote as data inside them. Words that are not the module's, or
 * a card saved before them, read as the stored English, each fact once
 * (Types/AI/ResourceCardFacts).
 *
 * React-free, so the card and its tests read the same rules.
 */

export interface DrawnResourceCardFact {
  label: string;
  value: DrawnActionSentence;
}

export interface DrawnResourceCard {
  // The kind of record, over the heading: "Incident", in the reader's words.
  kind: string;
  // The record by its number and title: data in every language.
  heading: string;
  // The line under the heading, sentence by sentence, joined with " · ".
  line: Array<DrawnActionSentence>;
  facts: Array<DrawnResourceCardFact>;
  // Whether the card is worded in the reader's language (it had words).
  isWorded: boolean;
}

// A card's words, when they are the module's sentences and terms.
export function getKnownResourceCardWords(
  widget: AIChatWidget,
): AIActionCardWords | null {
  return isKnownAIActionCardWords(widget.data.words)
    ? widget.data.words
    : null;
}

// The stored English, read the way most of its letters are.
function asStored(text: string): DrawnActionSentence {
  return { text, direction: null, separatorBefore: "" };
}

function drawFactValue(
  fact: AIActionCardFact,
  translator: Translator,
): DrawnActionSentence {
  // Data as written - a note, a description - read the way its letters are.
  if (typeof fact.value === "string") {
    return asStored(fact.value);
  }

  /*
   * A list of sentences - the resources linked - in the reader's language,
   * each name set apart, read the language's way.
   */
  if (isAIActionList(fact.value)) {
    return {
      text: describeAIActionCardValue(fact.value, translator, {
        setsValuesApart: true,
      }),
      direction:
        fact.value.list.length > 0
          ? getAIActionSentenceDirection(fact.value.list[0]!, translator)
          : getReadingDirection(translator.language),
      separatorBefore: "",
    };
  }

  return drawActionSentence(fact.value, translator, "");
}

/*
 * The card as it is drawn: in the reader's language when it has words,
 * else its stored English, each fact once.
 */
export function getDrawnResourceCard(
  widget: AIChatWidget,
  translator: Translator,
): DrawnResourceCard {
  const heading: string = widget.data.heading || "";
  const words: AIActionCardWords | null = getKnownResourceCardWords(widget);

  if (!words) {
    const fields: Array<ResourceCardFact> = getFactsNotInHeading({
      heading: widget.data.heading,
      subheading: widget.data.subheading,
      fields: widget.data.fields,
    });

    return {
      kind: widget.data.resourceType || "",
      heading,
      line: widget.data.subheading ? [asStored(widget.data.subheading)] : [],
      facts: fields.map((field: ResourceCardFact): DrawnResourceCardFact => {
        return { label: field.label, value: asStored(field.value) };
      }),
      isWorded: false,
    };
  }

  return {
    kind: translator.translateTerm(words.kind.term),
    heading,
    line: (words.line || []).map(
      (sentence: AIActionSentence, index: number): DrawnActionSentence => {
        return {
          ...drawActionSentence(sentence, translator, ""),
          separatorBefore: index > 0 ? AI_ACTION_CARD_LINE_SEPARATOR : "",
        };
      },
    ),
    facts: (words.facts || []).map(
      (fact: AIActionCardFact): DrawnResourceCardFact => {
        return {
          label: translator.translateTerm(fact.label.term),
          value: drawFactValue(fact, translator),
        };
      },
    ),
    isWorded: true,
  };
}
