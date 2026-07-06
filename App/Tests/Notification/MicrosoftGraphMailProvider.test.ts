import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import MailTransportType from "Common/Types/Email/MailTransportType";
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import MicrosoftGraphMailProvider from "../../FeatureSet/Notification/Services/MailProviders/MicrosoftGraphMailProvider";
import SMTPOAuthService from "../../FeatureSet/Notification/Services/SMTPOAuthService";

/*
 * These tests exercise the throttling defenses added to the Graph transport:
 *   - the per-mailbox concurrency gate (keeps us under Graph's
 *     MailboxConcurrency limit, the root cause of the 429 we hit in prod), and
 *   - the Retry-After-aware retry loop (only retries transient failures, and
 *     waits exactly as long as Graph asks).
 *
 * The Graph HTTP call is faked via a stubbed global.fetch, and the OAuth token
 * fetch is stubbed so no real network/Redis is touched.
 */

/*
 * Captured before any test spies on the global, so helpers can schedule real
 * (near-instant) timers regardless of what a test does to setTimeout.
 */
const realSetTimeout: typeof setTimeout = global.setTimeout;

/*
 * MicrosoftGraphMailProvider.MAX_RETRIES — the total number of attempts made
 * before a retryable failure is surfaced. Mirrored here so the assertions read
 * meaningfully; kept in sync with the source constant.
 */
const MAX_RETRIES: number = 4;

// MicrosoftGraphMailProvider.MAX_CONCURRENT_PER_MAILBOX.
const MAX_CONCURRENT_PER_MAILBOX: number = 3;

type FakeResponseOptions = {
  retryAfter?: string | undefined;
  body?: string | undefined;
};

/**
 * Build a minimal object shaped like the parts of `Response` the provider
 * reads: status, a case-insensitive headers.get(), and text().
 */
function makeResponse(
  status: number,
  options?: FakeResponseOptions | undefined,
): Response {
  const headers: Map<string, string> = new Map<string, string>();
  if (options?.retryAfter !== undefined) {
    headers.set("retry-after", options.retryAfter);
  }

  return {
    status,
    headers: {
      get: (name: string): string | null => {
        return headers.get(name.toLowerCase()) ?? null;
      },
    },
    text: (): Promise<string> => {
      return Promise.resolve(options?.body ?? "");
    },
  } as unknown as Response;
}

function makeEmailServer(
  fromEmail: string = "sender@contoso.com",
): EmailServer {
  return {
    transportType: MailTransportType.MicrosoftGraph,
    username: fromEmail,
    password: undefined,
    fromEmail: new Email(fromEmail),
    fromName: "OneUptime Alerts",
    authType: SMTPAuthenticationType.OAuth,
    clientId: "client-id",
    clientSecret: "client-secret",
    tokenUrl: URL.fromString(
      "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
    ),
    scope: "https://graph.microsoft.com/.default",
    oauthProviderType: OAuthProviderType.ClientCredentials,
  };
}

function makeMail(toEmail: string = "recipient@example.com"): EmailMessage {
  return {
    toEmail: new Email(toEmail),
    subject: "Incident: API is down",
    body: "<p>Your monitor is down.</p>",
    vars: {},
  };
}

/**
 * Replace setTimeout with a version that fires (almost) immediately but records
 * the delay each caller *asked* for. Lets us assert the Retry-After value drove
 * the backoff without waiting real seconds. Returns the recorded delays.
 */
function installInstantTimersRecordingDelays(): number[] {
  const requestedDelays: number[] = [];
  jest.spyOn(global, "setTimeout").mockImplementation(((
    callback: (...args: Array<unknown>) => void,
    ms?: number,
  ) => {
    requestedDelays.push(ms ?? 0);
    return realSetTimeout(callback, 0);
  }) as unknown as typeof setTimeout);
  return requestedDelays;
}

describe("MicrosoftGraphMailProvider", () => {
  let fetchMock: jest.Mock;
  const originalFetch: typeof fetch = global.fetch;

  beforeEach(() => {
    jest
      .spyOn(SMTPOAuthService, "getAccessToken")
      .mockResolvedValue("fake-access-token");

    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
  });

  test("sends via Graph and resolves on HTTP 202", async () => {
    fetchMock.mockResolvedValue(makeResponse(202));

    const provider: MicrosoftGraphMailProvider =
      new MicrosoftGraphMailProvider();

    await provider.send(makeMail("recipient@example.com"), makeEmailServer());

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    // Posts to the sender mailbox's sendMail endpoint with the bearer token.
    expect(calledUrl).toContain("/users/sender%40contoso.com/sendMail");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer fake-access-token",
    );

    const payload: {
      message: { subject: string; toRecipients: Array<unknown> };
    } = JSON.parse(init.body as string);
    expect(payload.message.subject).toBe("Incident: API is down");
    expect(payload.message.toRecipients).toHaveLength(1);
  });

  test("does NOT retry non-retryable errors (403 Forbidden)", async () => {
    fetchMock.mockResolvedValue(
      makeResponse(403, {
        body: JSON.stringify({
          error: {
            code: "ErrorAccessDenied",
            message: "Access is denied.",
          },
        }),
      }),
    );

    const provider: MicrosoftGraphMailProvider =
      new MicrosoftGraphMailProvider();

    await expect(provider.send(makeMail(), makeEmailServer())).rejects.toThrow(
      /403|Forbidden/,
    );

    /*
     * A permission error will fail identically on every retry — so exactly one
     * attempt should be made.
     */
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("surfaces an actionable message that includes Graph's detail", async () => {
    fetchMock.mockResolvedValue(
      makeResponse(403, {
        body: JSON.stringify({
          error: { code: "ErrorAccessDenied", message: "Access is denied." },
        }),
      }),
    );

    const provider: MicrosoftGraphMailProvider =
      new MicrosoftGraphMailProvider();

    await expect(provider.send(makeMail(), makeEmailServer())).rejects.toThrow(
      /Mail\.Send/,
    );
  });

  test("retries a 429 and succeeds when a later attempt returns 202", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(429, { retryAfter: "0" }))
      .mockResolvedValueOnce(makeResponse(202));

    const provider: MicrosoftGraphMailProvider =
      new MicrosoftGraphMailProvider();

    await provider.send(makeMail(), makeEmailServer());

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("retries a transient 5xx and succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(503, { retryAfter: "0" }))
      .mockResolvedValueOnce(makeResponse(202));

    const provider: MicrosoftGraphMailProvider =
      new MicrosoftGraphMailProvider();

    await provider.send(makeMail(), makeEmailServer());

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("gives up after MAX_RETRIES on a persistent 429", async () => {
    fetchMock.mockResolvedValue(makeResponse(429, { retryAfter: "0" }));

    const provider: MicrosoftGraphMailProvider =
      new MicrosoftGraphMailProvider();

    await expect(provider.send(makeMail(), makeEmailServer())).rejects.toThrow(
      /rate-limited|429/,
    );

    expect(fetchMock).toHaveBeenCalledTimes(MAX_RETRIES);
  });

  test("honors Graph's Retry-After header for the backoff delay", async () => {
    /*
     * 7 seconds is deliberately outside any value the default exponential
     * backoff can produce (attempt backoffs land in 1-2s / 2-3s / 4-5s),
     * so seeing a 7000ms scheduled delay proves the header drove the wait.
     */
    const requestedDelays: number[] = installInstantTimersRecordingDelays();

    fetchMock
      .mockResolvedValueOnce(makeResponse(429, { retryAfter: "7" }))
      .mockResolvedValueOnce(makeResponse(202));

    const provider: MicrosoftGraphMailProvider =
      new MicrosoftGraphMailProvider();

    await provider.send(makeMail(), makeEmailServer());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestedDelays).toContain(7000);
  });

  test("retries network errors (transient) and can recover", async () => {
    installInstantTimersRecordingDelays();

    fetchMock
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce(makeResponse(202));

    const provider: MicrosoftGraphMailProvider =
      new MicrosoftGraphMailProvider();

    await provider.send(makeMail(), makeEmailServer());

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("retries request timeouts (AbortError) and can recover", async () => {
    installInstantTimersRecordingDelays();

    const abortError: Error = new Error("The operation was aborted");
    abortError.name = "AbortError";

    fetchMock
      .mockRejectedValueOnce(abortError)
      .mockResolvedValueOnce(makeResponse(202));

    const provider: MicrosoftGraphMailProvider =
      new MicrosoftGraphMailProvider();

    await provider.send(makeMail(), makeEmailServer());

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("caps concurrent sendMail requests per mailbox", async () => {
    let inFlight: number = 0;
    let maxInFlight: number = 0;

    fetchMock.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Hold the request open briefly so callers actually overlap.
      await new Promise<void>((resolve: () => void) => {
        realSetTimeout(resolve, 15);
      });
      inFlight--;
      return makeResponse(202);
    });

    const provider: MicrosoftGraphMailProvider =
      new MicrosoftGraphMailProvider();
    const server: EmailServer = makeEmailServer("blast@contoso.com");

    // Fire many sends through the SAME mailbox at once.
    const sends: Array<Promise<void>> = Array.from({ length: 6 }, () => {
      return provider.send(makeMail(), server);
    });

    await Promise.all(sends);

    // All six eventually go out...
    expect(fetchMock).toHaveBeenCalledTimes(6);
    // ...but never more than the per-mailbox cap are in flight simultaneously.
    expect(maxInFlight).toBe(MAX_CONCURRENT_PER_MAILBOX);
  });

  test("requires OAuth credentials", async () => {
    const provider: MicrosoftGraphMailProvider =
      new MicrosoftGraphMailProvider();

    const server: EmailServer = makeEmailServer();
    server.clientId = undefined;

    await expect(provider.send(makeMail(), server)).rejects.toThrow(
      /OAuth credentials/,
    );

    // Should fail before any network call.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("honors Retry-After on every retryable attempt, not just the first", async () => {
    const requestedDelays: number[] = installInstantTimersRecordingDelays();

    fetchMock
      .mockResolvedValueOnce(makeResponse(429, { retryAfter: "2" }))
      .mockResolvedValueOnce(makeResponse(429, { retryAfter: "2" }))
      .mockResolvedValueOnce(makeResponse(202));

    const provider: MicrosoftGraphMailProvider =
      new MicrosoftGraphMailProvider();

    await provider.send(makeMail(), makeEmailServer());

    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Both retries waited the header's 2000ms — proves it's honored per-attempt.
    expect(
      requestedDelays.filter((delay: number) => {
        return delay === 2000;
      }),
    ).toHaveLength(2);
  });

  test("caps the honored Retry-After at MAX_RETRY_WAIT_MS (60s)", async () => {
    const requestedDelays: number[] = installInstantTimersRecordingDelays();

    fetchMock
      .mockResolvedValueOnce(makeResponse(429, { retryAfter: "120" }))
      .mockResolvedValueOnce(makeResponse(202));

    const provider: MicrosoftGraphMailProvider =
      new MicrosoftGraphMailProvider();

    await provider.send(makeMail(), makeEmailServer());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 120s asked, but the backoff is clamped to the 60s cap.
    expect(requestedDelays).toContain(60000);
  });

  test("falls back to exponential backoff for an HTTP-date Retry-After", async () => {
    const requestedDelays: number[] = installInstantTimersRecordingDelays();

    fetchMock
      .mockResolvedValueOnce(
        makeResponse(429, { retryAfter: "Wed, 21 Oct 2026 07:28:00 GMT" }),
      )
      .mockResolvedValueOnce(makeResponse(202));

    const provider: MicrosoftGraphMailProvider =
      new MicrosoftGraphMailProvider();

    await provider.send(makeMail(), makeEmailServer());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    /*
     * The date form is not parsed as delta-seconds, so the retry uses the
     * attempt-1 exponential backoff (1000-2000ms) rather than the raw header.
     */
    expect(
      requestedDelays.some((delay: number) => {
        return delay >= 1000 && delay < 2000;
      }),
    ).toBe(true);
  });

  test('falls back to exponential backoff for a non-finite Retry-After ("Infinity")', async () => {
    const requestedDelays: number[] = installInstantTimersRecordingDelays();

    fetchMock
      .mockResolvedValueOnce(makeResponse(429, { retryAfter: "Infinity" }))
      .mockResolvedValueOnce(makeResponse(202));

    const provider: MicrosoftGraphMailProvider =
      new MicrosoftGraphMailProvider();

    await provider.send(makeMail(), makeEmailServer());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    /*
     * "Infinity" parses to a non-finite number and must be rejected, using
     * exponential backoff (1000-2000ms) rather than being clamped to the 60s cap.
     */
    expect(requestedDelays).not.toContain(60000);
    expect(
      requestedDelays.some((delay: number) => {
        return delay >= 1000 && delay < 2000;
      }),
    ).toBe(true);
  });

  test("retries a transient 408 Request Timeout and recovers", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(408, { retryAfter: "0" }))
      .mockResolvedValueOnce(makeResponse(202));

    const provider: MicrosoftGraphMailProvider =
      new MicrosoftGraphMailProvider();

    await provider.send(makeMail(), makeEmailServer());

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("does NOT retry a 401 and surfaces token/tenant guidance", async () => {
    fetchMock.mockResolvedValue(
      makeResponse(401, {
        body: JSON.stringify({
          error: { code: "InvalidAuthenticationToken", message: "bad token" },
        }),
      }),
    );

    const provider: MicrosoftGraphMailProvider =
      new MicrosoftGraphMailProvider();

    await expect(provider.send(makeMail(), makeEmailServer())).rejects.toThrow(
      /401|Tenant ID/,
    );

    // Auth failure is non-retryable — exactly one attempt.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("does NOT retry a 404 and points at the sender mailbox", async () => {
    fetchMock.mockResolvedValue(
      makeResponse(404, {
        body: JSON.stringify({
          error: { code: "ErrorInvalidUser", message: "not found" },
        }),
      }),
    );

    const provider: MicrosoftGraphMailProvider =
      new MicrosoftGraphMailProvider();

    await expect(provider.send(makeMail(), makeEmailServer())).rejects.toThrow(
      /licensed Exchange Online mailbox/,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("exhausts retries on a persistent 5xx and surfaces the HTTP status", async () => {
    fetchMock.mockResolvedValue(makeResponse(503, { retryAfter: "0" }));

    const provider: MicrosoftGraphMailProvider =
      new MicrosoftGraphMailProvider();

    await expect(provider.send(makeMail(), makeEmailServer())).rejects.toThrow(
      /HTTP 503/,
    );

    expect(fetchMock).toHaveBeenCalledTimes(MAX_RETRIES);
  });

  test("gates are independent per mailbox", async () => {
    let inFlight: number = 0;
    let maxInFlight: number = 0;

    fetchMock.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve: () => void) => {
        realSetTimeout(resolve, 15);
      });
      inFlight--;
      return makeResponse(202);
    });

    const provider: MicrosoftGraphMailProvider =
      new MicrosoftGraphMailProvider();
    const serverA: EmailServer = makeEmailServer("a@contoso.com");
    const serverB: EmailServer = makeEmailServer("b@contoso.com");

    // 3 through each of two distinct mailboxes — neither gate blocks the other.
    const sends: Array<Promise<void>> = [
      ...Array.from({ length: 3 }, () => {
        return provider.send(makeMail(), serverA);
      }),
      ...Array.from({ length: 3 }, () => {
        return provider.send(makeMail(), serverB);
      }),
    ];

    await Promise.all(sends);

    expect(fetchMock).toHaveBeenCalledTimes(6);
    // All 6 overlap (2 mailboxes × cap of 3) — a single global counter would cap at 3.
    expect(maxInFlight).toBe(2 * MAX_CONCURRENT_PER_MAILBOX);
  });

  test("releases the mailbox slot when the OAuth token fetch fails", async () => {
    const tokenError: Error = new Error("token fetch failed");
    // beforeEach already replaced getAccessToken with a jest mock resolving a token.
    const tokenMock: jest.Mock =
      SMTPOAuthService.getAccessToken as unknown as jest.Mock;

    /*
     * Fail the token fetch MAX_CONCURRENT_PER_MAILBOX times in a row. If the
     * concurrency slot leaked on failure, the counter would reach the cap and the
     * final send would block forever (test timeout). It succeeding proves every
     * failed send released its slot via the finally block.
     */
    for (let i: number = 0; i < MAX_CONCURRENT_PER_MAILBOX; i++) {
      tokenMock.mockRejectedValueOnce(tokenError);
    }
    fetchMock.mockResolvedValue(makeResponse(202));

    const provider: MicrosoftGraphMailProvider =
      new MicrosoftGraphMailProvider();
    const server: EmailServer = makeEmailServer("leaky@contoso.com");

    for (let i: number = 0; i < MAX_CONCURRENT_PER_MAILBOX; i++) {
      await expect(provider.send(makeMail(), server)).rejects.toThrow(
        /token fetch failed/,
      );
    }

    // Token failed before any HTTP call was made.
    expect(fetchMock).not.toHaveBeenCalled();

    // Slots were released, so this send acquires immediately and succeeds.
    await provider.send(makeMail(), server);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("bounds total time to the caller-supplied timeout", async () => {
    /*
     * With a 0ms deadline, the retry loop must give up immediately rather than
     * grinding through MAX_RETRIES on a persistent throttle. Uses instant timers
     * so a bug (ignoring the deadline) would still finish, but with the wrong
     * fetch count — the assertion, not wall-clock, catches the regression.
     */
    installInstantTimersRecordingDelays();
    fetchMock.mockResolvedValue(makeResponse(429, { retryAfter: "0" }));

    const provider: MicrosoftGraphMailProvider =
      new MicrosoftGraphMailProvider();

    await expect(
      provider.send(makeMail(), makeEmailServer(), { timeoutMs: 0 }),
    ).rejects.toThrow();

    // Deadline already passed → no retries beyond the first attempt.
    expect(fetchMock.mock.calls.length).toBeLessThan(MAX_RETRIES);
  });
});
