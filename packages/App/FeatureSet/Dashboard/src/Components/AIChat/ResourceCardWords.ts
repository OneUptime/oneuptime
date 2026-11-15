import {
  AI_ACTION_CARD_LINE_SEPARATOR,
  AIActionCardFact,
  AIActionCardWords,
  AIActionSentence,
  describeAIActionCardLabel,
  describeAIActionCardValue,
  describeAIActionFigure,
  getAIActionSentenceDirection,
  isAIActionFigure,
  isAIActionList,
  isAIActionMoment,
  isAIActionTerm,
  isKnownAIActionCardWords,
  withCurrentAIActionCardLines,
} from "Common/Types/AI/AIActionWords";
import {
  AIChatWidget,
  isAIChatReadResourceCard,
} from "Common/Types/AI/AIChatTypes";
import {
  getFactsNotInHeading,
  ResourceCardFact,
} from "Common/Types/AI/ResourceCardFacts";
import OneUptimeDate from "Common/Types/Date";
import { withDateDisplayLanguage } from "Common/Types/DateLanguage";
import { getReadingDirection } from "Common/Types/ReadingDirection";
import { getSentenceLanguage, Translator } from "Common/Types/Translator";
import { drawActionSentence, DrawnActionSentence } from "./ToolActionWords";

/*
 * THE CARD A TOOL LEFT, IN THE READER'S LANGUAGE.
 *
 * Under an answer, the card a write left says what it made or changed:
 * "INCIDENT", "INC-42 · Checkout down", "Severity: High · Started
 * resolved", and its facts; the card a read left shows a record as it is -
 * "MONITOR", its name, its status, "Type: Website" (issue #7175). The server stores the card twice: in English
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

/*
 * A card's words, when they are the module's sentences and terms - a
 * read's card's, or a write's, as the one who left it says (issue #7175).
 * A line the module has since reworded reads as its kind's card says it
 * now: a private note's card saved when it said "for your team only"
 * (#7595).
 */
export function getKnownResourceCardWords(
  widget: AIChatWidget,
): AIActionCardWords | null {
  const words: unknown = withCurrentAIActionCardLines(widget.data.words);

  return isKnownAIActionCardWords(words, {
    isRead: isAIChatReadResourceCard(widget.data),
  })
    ? words
    : null;
}

// The stored English, read the way most of its letters are.
function asStored(text: string): DrawnActionSentence {
  return { text, direction: null, separatorBefore: "" };
}

// A word or a figure of the module, read its language's way.
function drawWord(text: string, language: string): DrawnActionSentence {
  return {
    text,
    direction: getReadingDirection(language),
    separatorBefore: "",
  };
}

function drawFactValue(
  fact: AIActionCardFact,
  translator: Translator,
): DrawnActionSentence {
  const value: AIActionCardFact["value"] = fact.value;

  // Data as written - a note, a description, a name - read the way its letters are.
  if (typeof value === "string") {
    return asStored(value);
  }

  /*
   * A word of OneUptime's - "Off - not checked", a monitor type's name -
   * in the reader's language when it words it, else in English, read
   * that language's way.
   */
  if (isAIActionTerm(value)) {
    return drawWord(
      translator.translateTerm(value.term),
      getSentenceLanguage(translator, value.term),
    );
  }

  // A figure, written the reader's way: "99,95 %" in German, "۹۹٫۹۵٪" in Persian.
  if (isAIActionFigure(value)) {
    return drawWord(
      describeAIActionFigure(value, translator),
      translator.language,
    );
  }

  /*
   * A moment, as every page writes one - in the reader's language and in
   * the time zone they picked, its zone said - never the ISO text the
   * card stores for the exports.
   */
  if (isAIActionMoment(value)) {
    const moment: Date = new Date(value.moment);

    return drawWord(
      withDateDisplayLanguage(translator.language, (): string => {
        return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(moment);
      }),
      translator.language,
    );
  }

  /*
   * A list of sentences - the resources linked - in the reader's language,
   * each name set apart, read the language's way.
   */
  if (isAIActionList(value)) {
    return {
      text: describeAIActionCardValue(value, translator, {
        setsValuesApart: true,
      }),
      direction:
        value.list.length > 0
          ? getAIActionSentenceDirection(value.list[0]!, translator)
          : getReadingDirection(translator.language),
      separatorBefore: "",
    };
  }

  return drawActionSentence(value, translator, "");
}

/*
 * A card's line, part by part: a sentence in the reader's language, and
 * data - a status name the project chose, a description - as written.
 */
function drawLine(
  parts: Array<AIActionSentence | string>,
  translator: Translator,
): Array<DrawnActionSentence> {
  return parts
    .map((part: AIActionSentence | string): DrawnActionSentence => {
      return typeof part === "string"
        ? asStored(part)
        : drawActionSentence(part, translator, "");
    })
    .filter((part: DrawnActionSentence): boolean => {
      return Boolean(part.text);
    })
    .map((part: DrawnActionSentence, index: number): DrawnActionSentence => {
      return {
        ...part,
        separatorBefore: index > 0 ? AI_ACTION_CARD_LINE_SEPARATOR : "",
      };
    });
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
    line: drawLine(words.line || [], translator),
    facts: (words.facts || []).map(
      (fact: AIActionCardFact): DrawnResourceCardFact => {
        return {
          // A name, or a sentence with data in it: "Rule 2 — Database team".
          label: describeAIActionCardLabel(fact.label, translator, {
            setsValuesApart: true,
          }),
          value: drawFactValue(fact, translator),
        };
      },
    ),
    isWorded: true,
  };
}
