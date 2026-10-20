import { AiTokenCountBreakdown } from "Common/Types/AI/AiTokenCount";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * The line under an AI Logs row's "Tokens Used" when the call used the
 * provider's prompt cache: how many tokens the call sent and received in
 * all, and how many of them the cache served or took - the numbers the
 * provider's own console shows, and the reason the count above them is
 * smaller (or, for a call that only wrote to the cache, a little larger).
 * Empty for a call that did not use the cache, whose count is its tokens.
 *
 * Kept free of React, so the wording is tested on its own.
 */
export const getLlmLogCacheText: (
  translator: Translator,
  tokens: AiTokenCountBreakdown,
) => string = (
  translator: Translator,
  tokens: AiTokenCountBreakdown,
): string => {
  const cacheRead: string = translator.formatNumber(tokens.cacheReadTokens);
  const cacheWrite: string = translator.formatNumber(tokens.cacheWriteTokens);

  if (tokens.cacheReadTokens > 0 && tokens.cacheWriteTokens > 0) {
    return translator.translatePlural(
      {
        one: "{{count}} token: {{cacheRead}} from the cache, {{cacheWrite}} written to it",
        other:
          "{{count}} tokens: {{cacheRead}} from the cache, {{cacheWrite}} written to it",
      },
      tokens.totalTokens,
      { cacheRead, cacheWrite },
    );
  }

  if (tokens.cacheReadTokens > 0) {
    return translator.translatePlural(
      {
        one: "{{count}} token, {{cacheRead}} from the cache",
        other: "{{count}} tokens, {{cacheRead}} from the cache",
      },
      tokens.totalTokens,
      { cacheRead },
    );
  }

  if (tokens.cacheWriteTokens > 0) {
    return translator.translatePlural(
      {
        one: "{{count}} token, {{cacheWrite}} written to the cache",
        other: "{{count}} tokens, {{cacheWrite}} written to the cache",
      },
      tokens.totalTokens,
      { cacheWrite },
    );
  }

  return "";
};
