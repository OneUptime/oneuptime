import { CloudConnectionFailureKind } from "../../../Types/CloudConnection/CloudConnectionTest";
import LlmProviderError from "../LlmObservability/LlmProviderError";
import { CLOUD_DEFAULT_SLEEP } from "./CloudConnectorTypes";

/*
 * A CLOUD THAT SAYS "NOT NOW" IS ASKED AGAIN, A LITTLE LATER.
 *
 * Every cloud limits how fast it is read: Azure Resource Graph answers
 * fifteen queries in five seconds, Google Cloud's APIs a few hundred a
 * minute, and either answers a burst with 429 Too Many Requests - or, now
 * and then, a 502, 503 or 504 that the next try does not get. Such an
 * answer is asked again up to CLOUD_RETRIES times, waiting a second, then
 * two, then four. Each try is a request of the read's budget (the call
 * takes it), so a spent budget stops the tries like any other request.
 *
 * Nothing else is asked again: a refusal, a missing setting or a request
 * that timed out would only fail the same way, slower. (AWS calls retry
 * their throttling codes in sendAwsRequest, by AWS's own error codes.)
 */

export const CLOUD_RETRIES: number = 3;
export const CLOUD_FIRST_RETRY_WAIT_MS: number = 1000;

// The answers worth asking again: a rate limit, or a gateway that did not get through.
export function isRetryableCloudFailure(error: unknown): boolean {
  if (!(error instanceof LlmProviderError)) {
    return false;
  }

  if (error.kind === CloudConnectionFailureKind.RateLimited) {
    return true;
  }

  return (
    error.statusCode === 502 ||
    error.statusCode === 503 ||
    error.statusCode === 504
  );
}

/*
 * One call, asked again while it answers with a failure worth asking
 * again. The wait is the provider's own Retry-After when it sent one
 * (capped at the longest wait of these tries), else doubling from
 * CLOUD_FIRST_RETRY_WAIT_MS.
 */
export async function withCloudRetries<T>(data: {
  call: () => Promise<T>;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
}): Promise<T> {
  const sleep: (milliseconds: number) => Promise<void> =
    data.sleep || CLOUD_DEFAULT_SLEEP;
  const longestWaitMs: number =
    CLOUD_FIRST_RETRY_WAIT_MS * Math.pow(2, CLOUD_RETRIES - 1);

  for (let attempt: number = 0; ; attempt++) {
    try {
      return await data.call();
    } catch (error) {
      if (attempt >= CLOUD_RETRIES || !isRetryableCloudFailure(error)) {
        throw error;
      }

      const retryAfterSeconds: number | undefined =
        error instanceof LlmProviderError ? error.retryAfterSeconds : undefined;
      const waitMs: number =
        retryAfterSeconds !== undefined &&
        Number.isFinite(retryAfterSeconds) &&
        retryAfterSeconds > 0
          ? Math.min(retryAfterSeconds * 1000, longestWaitMs)
          : CLOUD_FIRST_RETRY_WAIT_MS * Math.pow(2, attempt);

      await sleep(waitMs);
    }
  }
}
