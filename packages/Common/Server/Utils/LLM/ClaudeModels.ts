import ClaudeModelId, {
  ClaudeModelFamily,
  ClaudeModelVersion,
} from "../../../Utils/LLM/ClaudeModelId";

/*
 * What a Claude model's id says about the requests it accepts.
 *
 * Claude models changed their request surface twice, and the model id is the
 * one thing OneUptime knows before the first request goes out:
 *
 *  - Sampling. Claude Opus 4.7 and every later model choose their own
 *    sampling. Opus 4.7, 4.8, 5 and 5.5 and the Fable and Mythos models
 *    reject `temperature`, `top_p` and `top_k` outright; Sonnet 5, Sonnet 5.5
 *    and Haiku 5.5 reject any value but the default. Either way the request
 *    fails with a 400 ("`temperature` is deprecated for this model.") unless
 *    the parameter is left out. Older models (Haiku 4.5, Sonnet 4.6, Opus
 *    4.6 and before) still take them.
 *  - Thinking. The Claude 5 models (Opus 5 and 5.5, Sonnet 5 and 5.5, Haiku
 *    5.5, Fable, Mythos) think before they answer even when the request does
 *    not ask them to, and the thinking counts against `max_tokens`. Opus 4.7
 *    and 4.8 do not think unless asked.
 *
 * This is a hint, not the authority. A gateway may serve a model under any
 * name, and a model released after this code is unknown to it, so the
 * provider's own answer decides in the end (LLMService adapts the request to
 * the 400 it gets back, and learns thinking from the response). Knowing the
 * current models by name only saves their first request a wasted round trip.
 */

/*
 * Reading the id itself (which family, which version, under whatever prefix
 * or suffix a cloud or gateway adds) is ClaudeModelId's job: the LLM cost
 * catalog prices a call by the same reading, so the two never disagree about
 * which model an id names.
 */
export { ClaudeModelFamily };
export type { ClaudeModelVersion };

export default class ClaudeModels {
  public static parse(
    modelName: string | undefined,
  ): ClaudeModelVersion | null {
    return ClaudeModelId.parse(modelName);
  }

  /**
   * Whether the model is known to refuse `temperature`, `top_p` and `top_k`
   * (or any value of them but the default, which leaving them out also
   * gives).
   */
  public static rejectsSamplingParameters(
    modelName: string | undefined,
  ): boolean {
    const version: ClaudeModelVersion | null = this.parse(modelName);

    if (!version) {
      return false;
    }

    switch (version.family) {
      case ClaudeModelFamily.Fable:
      case ClaudeModelFamily.Mythos:
        return true;
      case ClaudeModelFamily.Opus:
        return this.isAtLeast(version, 4, 7);
      case ClaudeModelFamily.Sonnet:
      case ClaudeModelFamily.Haiku:
        return this.isAtLeast(version, 5, 0);
      default:
        return false;
    }
  }

  /**
   * Whether the model thinks before it answers when the request does not
   * say, so that thinking shares the request's `max_tokens` with the answer.
   */
  public static thinksByDefault(modelName: string | undefined): boolean {
    const version: ClaudeModelVersion | null = this.parse(modelName);

    if (!version) {
      return false;
    }

    switch (version.family) {
      case ClaudeModelFamily.Fable:
      case ClaudeModelFamily.Mythos:
        return true;
      case ClaudeModelFamily.Opus:
      case ClaudeModelFamily.Sonnet:
      case ClaudeModelFamily.Haiku:
        return this.isAtLeast(version, 5, 0);
      default:
        return false;
    }
  }

  private static isAtLeast(
    version: ClaudeModelVersion,
    major: number,
    minor: number,
  ): boolean {
    if (version.major === undefined) {
      // A versionless Opus, Sonnet or Haiku id names no model we can place.
      return false;
    }

    if (version.major !== major) {
      return version.major > major;
    }

    return version.minor >= minor;
  }
}
