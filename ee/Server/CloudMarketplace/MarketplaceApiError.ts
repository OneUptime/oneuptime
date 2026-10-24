/*
 * A marketplace API call that did not succeed. `isRetryable` separates "ask
 * again later" (throttling, the marketplace's own outage, no answer at all)
 * from an answer that will not change. The message carries the marketplace's
 * status and a cut-down body for the log - never a token or a key.
 */
export default class MarketplaceApiError extends Error {
  public readonly status: number | null;
  public readonly isRetryable: boolean;
  public readonly body: string;
  /*
   * The marketplace's own name for the error, when it gave one
   * ("CustomerNotEntitledException", "ResourceNotActive", ...), so a caller
   * can tell "not subscribed" apart from "misconfigured". Empty otherwise.
   */
  public readonly code: string;

  public constructor(data: {
    message: string;
    status: number | null;
    isRetryable: boolean;
    body?: string | undefined;
    code?: string | undefined;
  }) {
    super(data.message);
    this.name = "MarketplaceApiError";
    this.status = data.status;
    this.isRetryable = data.isRetryable;
    this.body = data.body || "";
    this.code = data.code || "";
  }

  public isNotFound(): boolean {
    return this.status === 404;
  }
}
