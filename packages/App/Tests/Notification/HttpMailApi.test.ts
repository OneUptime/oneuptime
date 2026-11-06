import { describe, expect, jest, test } from "@jest/globals";
import http from "http";
import net from "net";
import HttpMailApi, {
  MAX_PROVIDER_DETAIL_LENGTH,
  MailApiAnswer,
  MailApiSendException,
} from "../../FeatureSet/Notification/Services/MailProviders/HttpMailApi";

/*
 * ONE EMAIL TO A PROVIDER'S HTTP API (HttpMailApi): what Amazon SES,
 * Mailgun, Postmark, Resend and a project's SendGrid config share around
 * their one request - which failures are tried again and how long the wait
 * is, the deadline over every try, the gate a config's sends share, and
 * that what a provider says reaches the Email Log without a key in it.
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    },
  };
});

const noWait: (ms: number) => Promise<void> = async (): Promise<void> => {
  return;
};

function retryable(
  message: string,
  retryAfterSeconds?: number,
): MailApiSendException {
  return new MailApiSendException(message, {
    isRetryable: true,
    retryAfterSeconds: retryAfterSeconds,
  });
}

describe("which answers are worth another try", () => {
  test.each([
    [429, true],
    [408, true],
    [500, true],
    [502, true],
    [503, true],
    [400, false],
    [401, false],
    [403, false],
    [404, false],
    [413, false],
    [422, false],
  ])("HTTP %s: %s", (status: number, expected: boolean) => {
    expect(HttpMailApi.isRetryableStatus(status)).toBe(expected);
  });
});

describe("Retry-After", () => {
  test("delta-seconds, as most providers send it", () => {
    expect(HttpMailApi.parseRetryAfter("30")).toBe(30);
    expect(HttpMailApi.parseRetryAfter(" 2 ")).toBe(2);
    expect(HttpMailApi.parseRetryAfter("0")).toBe(0);
  });

  test("an HTTP date, as the seconds left until it", () => {
    const now: number = Date.parse("2026-01-01T00:00:00Z");

    expect(
      HttpMailApi.parseRetryAfter("Thu, 01 Jan 2026 00:00:10 GMT", now),
    ).toBe(10);
    // A date already past asks for no wait at all.
    expect(
      HttpMailApi.parseRetryAfter("Wed, 31 Dec 2025 23:59:00 GMT", now),
    ).toBe(0);
  });

  test("absent, negative or not a time: the backoff applies", () => {
    expect(HttpMailApi.parseRetryAfter(null)).toBeUndefined();
    expect(HttpMailApi.parseRetryAfter(undefined)).toBeUndefined();
    expect(HttpMailApi.parseRetryAfter("")).toBeUndefined();
    expect(HttpMailApi.parseRetryAfter("-5")).toBeUndefined();
    expect(HttpMailApi.parseRetryAfter("soon")).toBeUndefined();
  });
});

describe("the wait before a retry", () => {
  test("is what the provider asked for, capped at a minute", () => {
    expect(
      HttpMailApi.getBackoffMs({
        attempt: 1,
        retryAfterSeconds: 3,
        random: () => {
          return 0.9;
        },
      }),
    ).toBe(3000);
    expect(
      HttpMailApi.getBackoffMs({
        attempt: 1,
        retryAfterSeconds: 3600,
        random: () => {
          return 0;
        },
      }),
    ).toBe(HttpMailApi.MAX_RETRY_WAIT_MS);
  });

  test("doubles with each try when the provider says nothing, with up to a second of jitter", () => {
    const at: (attempt: number, random: number) => number = (
      attempt: number,
      random: number,
    ): number => {
      return HttpMailApi.getBackoffMs({
        attempt: attempt,
        random: () => {
          return random;
        },
      });
    };

    expect(at(1, 0)).toBe(1000);
    expect(at(2, 0)).toBe(2000);
    expect(at(3, 0)).toBe(4000);
    expect(at(3, 0.5)).toBe(4500);
    expect(at(10, 0.99)).toBe(HttpMailApi.MAX_RETRY_WAIT_MS);
  });
});

describe("sendWithRetry", () => {
  test("a send that goes is tried once", async () => {
    const attempt: jest.Mock<(timeoutMs: number) => Promise<void>> = jest.fn(
      async (): Promise<void> => {
        return;
      },
    );

    await HttpMailApi.sendWithRetry({
      providerName: "Resend",
      attempt: attempt,
      sleep: noWait,
    });

    expect(attempt).toHaveBeenCalledTimes(1);
    // Each try gets the per-request time when the caller gave no deadline.
    expect(attempt.mock.calls[0]![0]).toBe(HttpMailApi.REQUEST_TIMEOUT_MS);
  });

  test("throttling is tried again, after the wait the provider asked for, until it goes", async () => {
    const waits: Array<number> = [];
    let calls: number = 0;

    await HttpMailApi.sendWithRetry({
      providerName: "Resend",
      attempt: async (): Promise<void> => {
        calls++;

        if (calls < 3) {
          throw retryable("Resend is limiting how fast this account sends.", 2);
        }
      },
      sleep: async (ms: number): Promise<void> => {
        waits.push(ms);
      },
    });

    expect(calls).toBe(3);
    expect(waits).toEqual([2000, 2000]);
  });

  test("a refusal that fails the same every time is reported at once, never tried again", async () => {
    let calls: number = 0;

    await expect(
      HttpMailApi.sendWithRetry({
        providerName: "Postmark",
        attempt: async (): Promise<void> => {
          calls++;
          throw new MailApiSendException("The token was refused.", {
            statusCode: 401,
            isRetryable: false,
          });
        },
        sleep: noWait,
      }),
    ).rejects.toThrow("The token was refused.");

    expect(calls).toBe(1);
  });

  test("an error that is not the provider's answer is not tried again", async () => {
    let calls: number = 0;

    await expect(
      HttpMailApi.sendWithRetry({
        providerName: "Mailgun",
        attempt: async (): Promise<void> => {
          calls++;
          throw new Error("a bug");
        },
        sleep: noWait,
      }),
    ).rejects.toThrow("a bug");

    expect(calls).toBe(1);
  });

  test("gives up after MAX_ATTEMPTS tries, with the last failure", async () => {
    let calls: number = 0;

    await expect(
      HttpMailApi.sendWithRetry({
        providerName: "Amazon SES",
        attempt: async (): Promise<void> => {
          calls++;
          throw retryable(`failure ${calls}`);
        },
        sleep: noWait,
        random: () => {
          return 0;
        },
      }),
    ).rejects.toThrow(`failure ${HttpMailApi.MAX_ATTEMPTS}`);

    expect(calls).toBe(HttpMailApi.MAX_ATTEMPTS);
  });

  test("a retry that would end past the deadline is not tried: the failure is reported now", async () => {
    let calls: number = 0;
    const sleep: jest.Mock<(ms: number) => Promise<void>> = jest.fn(noWait);

    await expect(
      HttpMailApi.sendWithRetry({
        providerName: "Amazon SES",
        timeoutMs: 4000,
        attempt: async (): Promise<void> => {
          calls++;
          throw retryable(
            "Amazon SES is limiting how fast this account sends.",
            30,
          );
        },
        sleep: sleep,
      }),
    ).rejects.toThrow("Amazon SES is limiting how fast this account sends.");

    expect(calls).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("each try gets no more time than is left of the deadline", async () => {
    const timeouts: Array<number> = [];

    await HttpMailApi.sendWithRetry({
      providerName: "Postmark",
      timeoutMs: 4000,
      attempt: async (timeoutMs: number): Promise<void> => {
        timeouts.push(timeoutMs);
      },
      sleep: noWait,
    });

    expect(timeouts[0]).toBeLessThanOrEqual(4000);
    expect(timeouts[0]).toBeGreaterThan(3000);
  });

  test("a client's own error is read with the classifier the provider gives", async () => {
    let calls: number = 0;

    await HttpMailApi.sendWithRetry({
      providerName: "SendGrid",
      attempt: async (): Promise<void> => {
        calls++;

        if (calls === 1) {
          throw Object.assign(new Error("Too Many Requests"), { code: 429 });
        }
      },
      isRetryable: (error: unknown): boolean => {
        return (error as { code?: number }).code === 429;
      },
      getRetryAfterSeconds: (): number => {
        return 1;
      },
      sleep: noWait,
    });

    expect(calls).toBe(2);
  });
});

describe("the gate a config's sends share", () => {
  test("holds at most MAX_IN_FLIGHT_PER_CONFIG sends of one config at once, and lets the rest through as each ends", async () => {
    const key: string = HttpMailApi.getSlotKey({
      providerName: "Resend",
      configId: "config-a",
      credential: "re_a",
    });
    let inFlight: number = 0;
    let mostInFlight: number = 0;

    await Promise.all(
      Array.from({ length: 12 }).map(async (): Promise<void> => {
        await HttpMailApi.withSendSlot(key, async (): Promise<void> => {
          inFlight++;
          mostInFlight = Math.max(mostInFlight, inFlight);
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 20);
          });
          inFlight--;
        });
      }),
    );

    expect(mostInFlight).toBe(HttpMailApi.MAX_IN_FLIGHT_PER_CONFIG);
    // Nothing in flight keeps no entry.
    expect(HttpMailApi.getInFlightCount(key)).toBe(0);
  });

  test("frees its slot when the send fails", async () => {
    const key: string = HttpMailApi.getSlotKey({
      providerName: "Postmark",
      configId: "config-b",
      credential: "token",
    });

    await expect(
      HttpMailApi.withSendSlot(key, async (): Promise<void> => {
        throw new Error("refused");
      }),
    ).rejects.toThrow("refused");

    expect(HttpMailApi.getInFlightCount(key)).toBe(0);
  });

  test("two configs never share a gate, even with the same key; an edited key starts afresh", () => {
    const keyOf: (
      configId: string | undefined,
      credential: string,
    ) => string = (
      configId: string | undefined,
      credential: string,
    ): string => {
      return HttpMailApi.getSlotKey({
        providerName: "Mailgun",
        configId: configId,
        credential: credential,
      });
    };

    expect(keyOf("a", "key-1")).not.toBe(keyOf("b", "key-1"));
    expect(keyOf("a", "key-1")).not.toBe(keyOf("a", "key-2"));
    expect(keyOf(undefined, "key-1")).not.toBe(keyOf("a", "key-1"));
    expect(keyOf("a", "key-1")).toBe(keyOf("a", "key-1"));
    // The map holds a hash, never the key.
    expect(keyOf("a", "key-1")).not.toContain("key-1");
  });

  test("a separator inside a value cannot make two configs' gates one", () => {
    expect(
      HttpMailApi.getSlotKey({
        providerName: "Resend",
        configId: "a",
        credential: "b:c",
      }),
    ).not.toBe(
      HttpMailApi.getSlotKey({
        providerName: "Resend",
        configId: "a:b",
        credential: "c",
      }),
    );
  });
});

describe("what a provider said, made safe to show", () => {
  test("every secret the request carried is replaced", () => {
    expect(
      HttpMailApi.scrub(
        "API key re_live_123456 is invalid for re_live_123456",
        ["re_live_123456"],
      ),
    ).toBe("API key [redacted] is invalid for [redacted]");
  });

  test("short values are not taken for secrets, so ordinary words survive", () => {
    expect(HttpMailApi.scrub("the key is bad", ["is"])).toBe("the key is bad");
  });

  test("whitespace collapses and a page of text is cut to a line", () => {
    expect(HttpMailApi.scrub("a\n\n  b\tc", [])).toBe("a b c");

    const long: string = HttpMailApi.scrub("x".repeat(5000), []);

    expect(long.length).toBe(MAX_PROVIDER_DETAIL_LENGTH + 1);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("post", () => {
  async function startServer(
    answer: (
      request: http.IncomingMessage,
      response: http.ServerResponse,
    ) => void,
  ): Promise<{ url: string; close: () => Promise<void> }> {
    const server: http.Server = http.createServer(answer);

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    return {
      url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`,
      close: async (): Promise<void> => {
        server.closeAllConnections();
        await new Promise<void>((resolve: () => void) => {
          server.close(() => {
            resolve();
          });
        });
      },
    };
  }

  test("an answer is read whole: status, headers and body", async () => {
    const server: { url: string; close: () => Promise<void> } =
      await startServer(
        (request: http.IncomingMessage, response: http.ServerResponse) => {
          response.writeHead(429, {
            "Retry-After": "7",
            "Content-Type": "application/json",
          });
          response.end(JSON.stringify({ message: "slow down" }));
        },
      );

    try {
      const answer: MailApiAnswer = await HttpMailApi.post({
        providerName: "Resend",
        request: { url: `${server.url}/emails`, headers: {}, body: "{}" },
        timeoutMs: 5000,
      });

      expect(answer.status).toBe(429);
      expect(answer.headers.get("retry-after")).toBe("7");
      expect(HttpMailApi.readJson(answer.bodyText)).toEqual({
        message: "slow down",
      });
    } finally {
      await server.close();
    }
  });

  test("a provider that never answers is a retryable timeout naming the host", async () => {
    const server: { url: string; close: () => Promise<void> } =
      await startServer(() => {
        // Never answers.
      });

    try {
      const failure: unknown = await HttpMailApi.post({
        providerName: "Postmark",
        request: { url: `${server.url}/email`, headers: {}, body: "{}" },
        timeoutMs: 100,
      }).catch((error: unknown) => {
        return error;
      });

      expect(failure).toBeInstanceOf(MailApiSendException);
      expect((failure as MailApiSendException).isRetryable).toBe(true);
      expect((failure as MailApiSendException).message).toContain(
        "Postmark did not answer within",
      );
      expect((failure as MailApiSendException).message).toContain(
        new URL(server.url).host,
      );
    } finally {
      await server.close();
    }
  });

  test("a host that cannot be reached is a retryable failure that says why", async () => {
    const failure: unknown = await HttpMailApi.post({
      providerName: "Mailgun",
      // Nothing listens on port 1.
      request: { url: "http://127.0.0.1:1/v3", headers: {}, body: "{}" },
      timeoutMs: 5000,
    }).catch((error: unknown) => {
      return error;
    });

    expect(failure).toBeInstanceOf(MailApiSendException);
    expect((failure as MailApiSendException).isRetryable).toBe(true);
    expect((failure as MailApiSendException).message).toContain(
      "Mailgun could not be reached at 127.0.0.1:1",
    );
  });

  test("a body that is not JSON reads as undefined", () => {
    expect(HttpMailApi.readJson("Forbidden")).toBeUndefined();
    expect(HttpMailApi.readJson("")).toBeUndefined();
  });
});
