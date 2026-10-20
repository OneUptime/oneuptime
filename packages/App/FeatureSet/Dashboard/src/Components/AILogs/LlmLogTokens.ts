import { AiTokenCountBreakdown } from "Common/Types/AI/AiTokenCount";
import { PluralTemplate, Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * The facts under an AI Logs row's "Tokens Used" when the call used the
 * provider's prompt cache: how many tokens the call used in all, how many of
 * them the cache served, and how many went into it - the numbers the
 * provider's own console shows, and the reason the count above them is
 * smaller (or, for a call that only wrote to the cache, a little larger).
 * "28,496 tokens · 20,654 from cache · 4,216 written to cache".
 *
 * Each fact is a phrase of its own, translated whole, so the line can wrap
 * between facts and never inside one ("20,654 from" / "cache" read badly).
 * A call that did not use the cache has none: its count is its tokens.
 *
 * Kept free of React, so the wording is tested on its own.
 */
export const LLM_LOG_TOTAL_TOKENS: PluralTemplate = {
  one: "{{count}} token",
  other: "{{count}} tokens",
};

/*
 * English says both alike for any count; a language whose words agree with
 * the count ("1 escrito", "2 escritos") has its own "one" form.
 */
export const LLM_LOG_TOKENS_FROM_CACHE: PluralTemplate = {
  one: "{{count}} from cache",
  other: "{{count}} from cache",
};

export const LLM_LOG_TOKENS_WRITTEN_TO_CACHE: PluralTemplate = {
  one: "{{count}} written to cache",
  other: "{{count}} written to cache",
};

export const getLlmLogCacheFacts: (
  translator: Translator,
  tokens: AiTokenCountBreakdown,
) => Array<string> = (
  translator: Translator,
  tokens: AiTokenCountBreakdown,
): Array<string> => {
  if (tokens.cacheReadTokens <= 0 && tokens.cacheWriteTokens <= 0) {
    return [];
  }

  const facts: Array<string> = [
    translator.translatePlural(LLM_LOG_TOTAL_TOKENS, tokens.totalTokens),
  ];

  if (tokens.cacheReadTokens > 0) {
    facts.push(
      translator.translatePlural(
        LLM_LOG_TOKENS_FROM_CACHE,
        tokens.cacheReadTokens,
      ),
    );
  }

  if (tokens.cacheWriteTokens > 0) {
    facts.push(
      translator.translatePlural(
        LLM_LOG_TOKENS_WRITTEN_TO_CACHE,
        tokens.cacheWriteTokens,
      ),
    );
  }

  return facts;
};
