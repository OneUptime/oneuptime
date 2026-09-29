import { APIResponse } from "@playwright/test";

/*
 * Resilient wrapper around Playwright's page.request for the e2e seeding
 * helpers.
 *
 * The whole e2e suite runs in a single worker (workers: 1) against one
 * long-lived browser connection, and under that load page.request
 * intermittently throws a transport-level error that is not an application
 * failure at all:
 *
 *   - "Object with guid response@... was not bound in the connection"
 *   - "Response has been disposed"
 *   - "Target page, context or browser has been closed"
 *   - "socket hang up" / ECONNRESET / ECONNREFUSED
 *
 * When it hits, the HTTP call never produced a usable response object, so the
 * right response is to issue a fresh request rather than fail. In serial specs
 * (CreateMonitors.spec.ts is `mode: "serial"`) a single transport blip on one
 * seed used to fail the whole describe group and cascade into retries of every
 * sibling test, so hardening the seed call removes a broad class of flakiness.
 *
 * Every seed used here is safe to repeat: entities are created with random
 * names and later looked up by name, so a duplicate row from a retried-but-
 * actually-succeeded request is simply never referenced.
 */

// The parsed outcome of a request, with the body already read exactly once.
export interface ApiResult {
  ok: boolean;
  status: number;
  text: string;
}

const transportErrorPattern: RegExp =
  /(was not bound in the connection|has been disposed|Target (page|context|browser) (has been )?closed|browser has been closed|socket hang up|ECONNRESET|ECONNREFUSED|Connection closed|Protocol error)/i;

/*
 * True when an error is a Playwright/transport hiccup rather than a real
 * assertion or HTTP outcome. Only these are retried; everything else rethrows
 * immediately so genuine bugs still fail fast.
 */
export const isTransportError: (error: unknown) => boolean = (
  error: unknown,
): boolean => {
  const message: string =
    error instanceof Error ? error.message : String(error);
  return transportErrorPattern.test(message);
};

type SleepFunction = (ms: number) => Promise<void>;

const sleep: SleepFunction = (ms: number): Promise<void> => {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, ms);
  });
};

type SendRequestFunction = () => Promise<APIResponse>;

/*
 * Sends a page.request and reads its body atomically, retrying only on
 * transport errors. Reading status/ok/body inside the same try is deliberate:
 * the disposal race can surface on the body read, not the send, so both must be
 * guarded together for the retry to catch it.
 */
export const sendWithRetry: (data: {
  send: SendRequestFunction;
  retries?: number | undefined;
}) => Promise<ApiResult> = async (data: {
  send: SendRequestFunction;
  retries?: number | undefined;
}): Promise<ApiResult> => {
  const retries: number = data.retries ?? 3;
  let lastError: unknown;

  for (let attempt: number = 0; attempt <= retries; attempt++) {
    try {
      const response: APIResponse = await data.send();
      const status: number = response.status();
      const ok: boolean = response.ok();
      const text: string = await response.text();
      return { ok, status, text };
    } catch (error) {
      lastError = error;
      if (!isTransportError(error) || attempt === retries) {
        throw error;
      }
      // Linear backoff before a completely fresh request.
      await sleep(500 * (attempt + 1));
    }
  }

  throw lastError;
};
