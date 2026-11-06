import {
  AIActionSentence,
  describeAIActionSentence,
  joinAIActionSentences,
} from "../../Types/AI/AIActionWords";

/*
 * An AI action's card as its English reads (Types/AI/AIActionWords): the
 * words the action stores beside its sentences, which the model, the
 * exports and an English reader read. For a test about what a card says;
 * a test about its words in a language words them with that language's
 * translator.
 */

// A title's English, or undefined for none.
export const actionTitleText: (
  sentence: AIActionSentence | undefined,
) => string | undefined = (
  sentence: AIActionSentence | undefined,
): string | undefined => {
  return sentence ? describeAIActionSentence(sentence) : undefined;
};

// A line's English, its sentences one after another, or undefined for none.
export const actionLineText: (
  sentences: Array<AIActionSentence> | undefined,
) => string | undefined = (
  sentences: Array<AIActionSentence> | undefined,
): string | undefined => {
  if (!sentences || sentences.length === 0) {
    return undefined;
  }

  return joinAIActionSentences(
    sentences.map((sentence: AIActionSentence): string => {
      return describeAIActionSentence(sentence);
    }),
  );
};
