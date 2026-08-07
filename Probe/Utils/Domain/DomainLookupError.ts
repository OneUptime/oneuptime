/*
 * Lookup failures split into two kinds, and the split is what decides
 * whether DomainMonitorUtil.query retries.
 *
 * A retryable failure is a transient one - the registry timed out, rate
 * limited us, or answered 5xx. A permanent failure is a fact about the
 * domain or the TLD: the domain is not registered, or the TLD publishes no
 * usable registration service. Retrying those three more times with a
 * one-second sleep in between only delays the (identical) answer.
 */
export class DomainLookupError extends Error {
  public readonly isRetryable: boolean;

  public constructor(message: string, options?: { isRetryable?: boolean }) {
    super(message);
    this.name = "DomainLookupError";
    this.isRetryable = options?.isRetryable ?? true;
  }
}

// The registry answered authoritatively that the domain does not exist.
export class DomainNotFoundError extends DomainLookupError {
  public constructor(message: string) {
    super(message, { isRetryable: false });
    this.name = "DomainNotFoundError";
  }
}

/*
 * No usable registration service for this name - no RDAP entry in the IANA
 * bootstrap, or a WHOIS server that answered without a record.
 */
export class DomainLookupUnsupportedError extends DomainLookupError {
  public constructor(message: string) {
    super(message, { isRetryable: false });
    this.name = "DomainLookupUnsupportedError";
  }
}

export class DomainLookupErrorUtil {
  public static isRetryable(err: unknown): boolean {
    if (err instanceof DomainLookupError) {
      return err.isRetryable;
    }

    return true;
  }

  public static getMessage(err: unknown): string {
    if (err instanceof Error) {
      return err.message || err.toString();
    }

    return String(err);
  }

  /*
   * WHOIS runs over a raw socket and RDAP over axios, so a deadline being
   * hit shows up under several different names.
   */
  public static isTimeout(err: unknown): boolean {
    const message: string = DomainLookupErrorUtil.getMessage(err).toLowerCase();

    return (
      message.includes("timeout") ||
      message.includes("timed out") ||
      message.includes("etimeout") ||
      message.includes("etimedout") ||
      message.includes("econnaborted")
    );
  }
}
