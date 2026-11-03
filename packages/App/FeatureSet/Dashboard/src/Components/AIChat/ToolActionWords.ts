import {
  AIActionSentence,
  AIActionWords,
  describeAIActionSentence,
  getAIActionSentenceDirection,
  getAIActionSentenceSeparator,
  getAIActionSentenceShownValues,
  isKnownAIActionWords,
} from "Common/Types/AI/AIActionWords";
import { AIChatToolAction } from "Common/Types/AI/AIChatTypes";
import { ReadingDirection } from "Common/Types/ReadingDirection";
import { Translator } from "Common/Types/Translator";

/*
 * WHAT AN AI ACTION'S CARD SAYS, IN THE READER'S LANGUAGE.
 *
 * The server stores each action's title and line twice: in English
 * (`title`, `description`), which the model, the exports and conversations
 * saved before read, and as sentences of Common/Types/AI/AIActionWords
 * (`words`), which the card words here in the reader's language - the
 * incident's number, the host's name and the title the model wrote as
 * data inside them. Words that are not this module's sentences, or an
 * action saved before them, read as the stored English.
 *
 * React-free, so App's tests and the card's own read the same rules.
 */

/*
 * A sentence as the card draws it. `direction` is the way its language is
 * read when it was worded here (a Persian sentence right to left, its
 * values set apart); null for the stored English, which is read the way
 * most of its letters are (IsolatedText).
 */
export interface DrawnActionSentence {
  text: string;
  direction: ReadingDirection | null;
  /*
   * What goes before it in a line of several: a space, or nothing after a
   * Chinese or Japanese full stop.
   */
  separatorBefore: string;
}

// The action's words, when they are sentences this Dashboard can say.
function getKnownWords(action: AIChatToolAction): AIActionWords | null {
  return isKnownAIActionWords(action.words) ? action.words : null;
}

function drawSentence(
  sentence: AIActionSentence,
  translator: Translator,
  previous: string,
): DrawnActionSentence {
  const text: string = describeAIActionSentence(sentence, translator, {
    setsValuesApart: true,
  });

  return {
    text,
    direction: getAIActionSentenceDirection(sentence, translator),
    separatorBefore: getAIActionSentenceSeparator(previous),
  };
}

// The action's title, in the reader's language when it can be.
export function getToolActionTitle(
  action: AIChatToolAction,
  translator: Translator,
): DrawnActionSentence {
  const words: AIActionWords | null = getKnownWords(action);

  if (!words) {
    return { text: action.title, direction: null, separatorBefore: "" };
  }

  return drawSentence(words.title, translator, "");
}

/*
 * The title as a name - a group's aria-label - with no isolate marks in it:
 * a screen reader hears the words, not how they are laid out.
 */
export function getToolActionTitleLabel(
  action: AIChatToolAction,
  translator: Translator,
): string {
  const words: AIActionWords | null = getKnownWords(action);

  return words
    ? describeAIActionSentence(words.title, translator)
    : action.title;
}

/*
 * The line under the title, sentence by sentence, in the reader's language
 * when it can be: none when the action has no line.
 */
export function getToolActionDescription(
  action: AIChatToolAction,
  translator: Translator,
): Array<DrawnActionSentence> {
  const words: AIActionWords | null = getKnownWords(action);

  if (!words) {
    return action.description
      ? [{ text: action.description, direction: null, separatorBefore: "" }]
      : [];
  }

  const drawn: Array<DrawnActionSentence> = [];
  let previous: string = "";

  for (const sentence of words.description || []) {
    const next: DrawnActionSentence = drawSentence(
      sentence,
      translator,
      previous,
    );

    drawn.push(next);
    previous = next.text;
  }

  return drawn;
}

/*
 * The data the title shows itself - the title the alert takes, the
 * incident's number - which the card's argument line need not repeat.
 */
export function getToolActionShownValues(
  action: AIChatToolAction,
): Array<string> {
  const words: AIActionWords | null = getKnownWords(action);

  return words ? getAIActionSentenceShownValues(words.title) : [];
}

/*
 * The arguments the title names by name - incidentId, once the title says
 * "INC-42" - whose IDs the card's argument line leaves out.
 */
export function getToolActionNamedArguments(
  action: AIChatToolAction,
): Array<string> {
  return getKnownWords(action)?.namedArguments || [];
}
