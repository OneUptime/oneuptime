import {
  LlmCallPrices,
  LlmCostCatalogUtil,
  LlmModelPrice,
} from "../../../Types/Telemetry/LlmCostCatalog";

/*
 * What a day of a model's tokens cost at list price, for the providers whose
 * usage API reports tokens and no money (Azure Monitor, CloudWatch, Cloud
 * Monitoring).
 *
 * The same price list as an AI call's estimate (LlmCostCatalog), with the
 * project's own prices weighed against it - with one difference. A call's
 * estimate picks a model's long-prompt price when THAT call's prompt is long;
 * a day's total is many calls added up, so its token count says nothing
 * about any one prompt, and the long-prompt price is never used here. The
 * estimate can only be low for a model that charges more for long prompts,
 * never high for a day of ordinary ones.
 */
export default class LlmUsageCost {
  /*
   * USD at list price, or null when the model is not priced (unknown, or no
   * tokens): never a guess.
   */
  public static estimateDailyCostUsd(data: {
    model: string;
    // Every input token, cached ones included.
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    projectPriceOverrides?: Array<LlmModelPrice> | undefined;
  }): number | null {
    const count: (value: number) => number = (value: number): number => {
      return Number.isFinite(value) && value > 0 ? value : 0;
    };

    const cacheRead: number = count(data.cacheReadTokens);
    const cacheWrite: number = count(data.cacheWriteTokens);
    const output: number = count(data.outputTokens);
    const input: number = Math.max(
      count(data.inputTokens),
      cacheRead + cacheWrite,
    );

    if (!data.model || (input === 0 && output === 0)) {
      return null;
    }

    const price: LlmModelPrice | null = LlmCostCatalogUtil.findPriceForModel(
      data.model,
      data.projectPriceOverrides,
    );

    if (!price) {
      return null;
    }

    // Prompt length 0: the model's ordinary price, never its long-prompt one.
    const prices: LlmCallPrices = LlmCostCatalogUtil.callPrices(price, 0);

    const cost: number =
      ((input - cacheRead - cacheWrite) *
        prices.inputPricePerMillionTokensInUSD +
        cacheRead * prices.cacheReadPricePerMillionTokensInUSD +
        cacheWrite * prices.cacheWritePricePerMillionTokensInUSD +
        output * prices.outputPricePerMillionTokensInUSD) /
      1_000_000;

    return Math.round(cost * 1e8) / 1e8;
  }
}
