import {
  AIActionTableCell,
  AIActionTableWords,
  describeAIActionSentence,
  describeAIActionTableCell,
  getAIActionSentenceDirection,
  isAIActionTerm,
  isKnownAIActionTableWords,
} from "Common/Types/AI/AIActionWords";
import { AIChatWidget, AIChatWidgetType } from "Common/Types/AI/AIChatTypes";
import { getReadingDirection } from "Common/Types/ReadingDirection";
import { getSentenceLanguage, Translator } from "Common/Types/Translator";
import { DrawnActionSentence } from "./ToolActionWords";

/*
 * A TABLE A TOOL LEFT, IN THE READER'S LANGUAGE (issue #7394).
 *
 * Under the cards a read leaves, the table of what it listed - the
 * monitors query_monitors read - said its title ("Monitors (4)"), the
 * line under it, each monitor's type and Disabled in the server's
 * English, while the card above said the same monitor's type and Disabled
 * in the reader's language. The server stores the table twice: in English
 * (its title, description and rows), which the exports print, the model
 * reads and a table saved before this reads as; and as sentences and
 * terms of Common/Types/AI/AIActionWords (data.tableWords), which this
 * words in the reader's language - the count written the reader's way, a
 * status the project named as data inside it.
 *
 * Each part is worded only when its words say in English what the table
 * stores there: the title, the line, a cell. Anything else - a table saved
 * before words, words that are not the module's, a cell whose words and
 * stored English disagree - reads as the stored English, so the chat and
 * the exports never say two different things. A cell the words do not
 * name is data: a monitor's name, a status the project chose.
 *
 * React-free, so the widget and its tests read the same rules.
 */

// A table's words, when they are the module's sentences and terms.
export function getKnownTableWords(
  widget: AIChatWidget,
): AIActionTableWords | null {
  if (widget.type !== AIChatWidgetType.Table) {
    return null;
  }

  return isKnownAIActionTableWords(widget.data.tableWords)
    ? widget.data.tableWords
    : null;
}

/*
 * How a worded title and the line under it are laid out: whole, wrapped
 * where they must be, their lines balanced. In the reader's language they
 * run longer than the English, and a status the project named sits inside
 * the title: cut on one line, a phone lost the title's count ("Monitore
 * mit Status „Partial Outage …") and Russian's order line at 390 pixels.
 * Balanced, a count never stands alone on the last line.
 */
export const WORDED_HEADING_LINE_CLASS_NAME: string = "break-words text-balance";

export interface DrawnWidgetHeading {
  /*
   * The title in the reader's language, read its language's way; null
   * when the widget's own title is drawn as stored.
   */
  title: DrawnActionSentence | null;
  /*
   * The line under it, likewise; null when its stored description, if
   * any, is drawn as stored.
   */
  description: DrawnActionSentence | null;
}

// A sentence of the module in the reader's language: its values set apart.
function drawSentence(
  sentence: AIActionTableWords["title"],
  translator: Translator,
): DrawnActionSentence {
  return {
    text: describeAIActionSentence(sentence, translator, {
      setsValuesApart: true,
    }),
    direction: getAIActionSentenceDirection(sentence, translator),
    separatorBefore: "",
  };
}

/*
 * A widget's title and the line under it, as drawn: in the reader's
 * language where the table's words say what it stores.
 */
export function getDrawnWidgetHeading(
  widget: AIChatWidget,
  translator: Translator,
): DrawnWidgetHeading {
  const words: AIActionTableWords | null = getKnownTableWords(widget);

  if (!words) {
    return { title: null, description: null };
  }

  const english: string = describeAIActionSentence(words.title);
  const description: AIActionTableWords["description"] = words.description;

  return {
    title:
      english === widget.title ? drawSentence(words.title, translator) : null,
    description:
      description &&
      describeAIActionSentence(description) === widget.description
        ? drawSentence(description, translator)
        : null,
  };
}

/*
 * A cell's words in the reader's language, when the table's words name
 * the cell and say in English what it stores; null when the cell is drawn
 * as stored - data, or a table saved before words.
 */
export function getDrawnTableCell(data: {
  words: AIActionTableWords | null;
  rowIndex: number;
  columnKey: string;
  stored: unknown;
  translator: Translator;
}): DrawnActionSentence | null {
  const row: Record<string, AIActionTableCell> | undefined =
    data.words?.cells?.[data.rowIndex];
  const cell: AIActionTableCell | undefined =
    row && Object.prototype.hasOwnProperty.call(row, data.columnKey)
      ? row[data.columnKey]
      : undefined;

  if (!cell || describeAIActionTableCell(cell) !== data.stored) {
    return null;
  }

  if (isAIActionTerm(cell)) {
    return {
      text: data.translator.translateTerm(cell.term),
      direction: getReadingDirection(
        getSentenceLanguage(data.translator, cell.term),
      ),
      separatorBefore: "",
    };
  }

  return drawSentence(cell, data.translator);
}
