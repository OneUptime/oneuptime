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

export enum ClaudeModelFamily {
  Opus = "opus",
  Sonnet = "sonnet",
  Haiku = "haiku",
  Fable = "fable",
  Mythos = "mythos",
}

export interface ClaudeModelVersion {
  family: ClaudeModelFamily;
  // Undefined for an id without a version, such as claude-mythos-preview.
  major: number | undefined;
  minor: number;
}

/*
 * The current naming scheme, family first: claude-sonnet-5-5,
 * claude-opus-4-7, claude-haiku-4-5-20251001. It is matched anywhere in the
 * id, so the prefixes and suffixes gateways and clouds add still parse:
 * anthropic.claude-sonnet-5-5 (Amazon Bedrock), us.anthropic.claude-opus-4-7
 * (cross-region), anthropic/claude-sonnet-5.5 (OpenRouter, which also writes
 * the version with a dot), claude-haiku-4-5@20251001 (Google Cloud).
 *
 * The minor version is one or two digits that are not followed by another
 * digit, so the date of a dated id is not read as one: claude-opus-4-20250514
 * is Opus 4, not Opus 4.20250514.
 *
 * The older scheme puts the version first (claude-3-5-sonnet-20241022). Those
 * models all take sampling parameters and never think on their own, and they
 * deliberately do not match.
 */
const CLAUDE_MODEL_ID: RegExp =
  /(?:^|[^a-z0-9])claude-(opus|sonnet|haiku|fable|mythos)(?:-(\d+)(?:[-.](\d{1,2})(?!\d))?)?(?![a-z])/i;

export default class ClaudeModels {
  public static parse(
    modelName: string | undefined,
  ): ClaudeModelVersion | null {
    if (!modelName) {
      return null;
    }

    const match: RegExpMatchArray | null = modelName.match(CLAUDE_MODEL_ID);

    if (!match) {
      return null;
    }

    return {
      family: match[1]!.toLowerCase() as ClaudeModelFamily,
      major: match[2] !== undefined ? parseInt(match[2], 10) : undefined,
      minor: match[3] !== undefined ? parseInt(match[3], 10) : 0,
    };
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
