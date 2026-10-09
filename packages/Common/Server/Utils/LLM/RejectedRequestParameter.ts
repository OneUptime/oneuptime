/*
 * Which request parameter a provider's error says the model does not accept.
 *
 * OpenAI names the parameter in a field of its own (`param`), and LLMService
 * reads that first. Anthropic does not: its 400 carries a sentence and
 * nothing else, and gateways that sit in front of a model (LiteLLM,
 * Databricks, OpenRouter) pass the sentence on inside their own wording. The
 * sentence is then the only signal, in shapes like these:
 *
 *   Anthropic   "`temperature` is deprecated for this model."
 *   OpenAI      "Unsupported parameter: 'top_p' is not supported with this model."
 *   OpenAI      "Unsupported value: 'temperature' does not support 0 with this
 *               model. Only the default (1) value is supported."
 *   Azure       "Unrecognized request argument supplied: top_k"
 *   Databricks  "Model us.anthropic.claude-opus-4-7 does not support the
 *               temperature parameter."
 *   Pydantic    "top_k: Extra inputs are not permitted"
 *
 * A parameter counts as rejected only when the error both names it and says
 * it is not accepted. An error that names a parameter for another reason - a
 * value out of range ("temperature: Input should be less than or equal to
 * 1"), or two parameters that cannot be combined ("`temperature` and `top_p`
 * cannot both be specified") - is not one, because leaving the parameter out
 * would not be what the provider asked for. That error is the operator's to
 * read.
 */

const REJECTION_PHRASES: Array<RegExp> = [
  /\bdeprecated\b/i,
  /\bnot supported\b/i,
  /\bunsupported\b/i,
  /\b(?:does|do|did) not support\b/i,
  /\b(?:doesn't|don't) support\b/i,
  /\bnot permitted\b/i,
  /\bunrecogni[sz]ed\b/i,
  /\bno longer (?:supported|accepted|available)\b/i,
];

/*
 * Characters that may form part of a parameter's name. A candidate only
 * counts where it stands alone: `top_p` is named in "'top_p' is not
 * supported", but not in "top_p_threshold".
 */
const NAME_CHARACTER: RegExp = /[A-Za-z0-9_]/;

export default class RejectedRequestParameter {
  /**
   * The first of the candidates the error text names as not accepted, by
   * where it appears in the text, or undefined when it names none of them.
   */
  public static findIn(data: {
    errorText: string;
    candidates: Iterable<string>;
  }): string | undefined {
    const errorText: string = data.errorText || "";

    if (!this.saysParameterIsNotAccepted(errorText)) {
      return undefined;
    }

    let found: string | undefined = undefined;
    let foundAt: number = Number.POSITIVE_INFINITY;

    for (const candidate of data.candidates) {
      const position: number = this.positionOfName(errorText, candidate);

      if (position !== -1 && position < foundAt) {
        found = candidate;
        foundAt = position;
      }
    }

    return found;
  }

  public static saysParameterIsNotAccepted(errorText: string): boolean {
    return REJECTION_PHRASES.some((phrase: RegExp): boolean => {
      return phrase.test(errorText);
    });
  }

  // Where the text names the parameter on its own, or -1.
  private static positionOfName(text: string, name: string): number {
    if (!name) {
      return -1;
    }

    let from: number = 0;

    while (from <= text.length - name.length) {
      const at: number = text.indexOf(name, from);

      if (at === -1) {
        return -1;
      }

      const before: string = at > 0 ? text.charAt(at - 1) : "";
      const after: string = text.charAt(at + name.length);

      if (!NAME_CHARACTER.test(before) && !NAME_CHARACTER.test(after)) {
        return at;
      }

      from = at + 1;
    }

    return -1;
  }
}
