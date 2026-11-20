import { describe, expect, test } from "@jest/globals";
import DataSourceHttpRetry, {
  DataSourceTransport,
  HTTP_RETRY_BUDGET_IN_MS,
  HTTP_RETRY_MAX_ATTEMPTS,
  HttpRetryClassifier,
  HttpRetryExchange,
  HttpRetryReason,
  HttpRetryVerdict,
  readWaitInMs,
} from "../../../../Server/Utils/DataSource/HttpRetry";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import BadDataException from "../../../../Types/Exception/BadDataException";
import {
  DataSourceStatusException,
  DataSourceUnreachedError,
} from "../../../../Server/Utils/DataSource/HttpFailure";

/*
 * ASKING A DATA SOURCE AGAIN (#9540), AS EVERY COLLECTOR DOES.
 *
 * The client every Data Observability collector sends its requests
 * through: an answer the provider's classifier says may pass is asked
 * again, twice at most, after its Retry-After or a backoff of two then four
 * seconds, within a minute of waiting per collection. Held here:
 *
 *  - what is asked again, and what never is: a request that may have done
 *    its work is asked again only after a throttle, or an answer saying it
 *    did nothing;
 *  - the waits: Retry-After first, then a wait the answer names in its
 *    body, never less than the backoff, none past thirty seconds;
 *  - a throttle holds back the collection's other requests;
 *  - an outage is not asked again: after two requests in a row fail every
 *    try, the rest are sent once, until something answers.
 */

const URL: string = "https://example.test/api";

function answer(
  statusCode: number,
  headers: Record<string, string> = {},
): DataSourceHttpResponse {
  return { statusCode, bodyText: "", bodyJson: undefined, headers };
}

// A 503 may pass, a 429 is a throttle, a 418 says it did nothing; everything else is kept.
const CLASSIFY: HttpRetryClassifier = (
  response: DataSourceHttpResponse,
): HttpRetryVerdict | null => {
  if (response.statusCode === 429) {
    return { reason: HttpRetryReason.Throttled };
  }

  if (response.statusCode === 503) {
    return { reason: HttpRetryReason.Unavailable };
  }

  if (response.statusCode === 418) {
    return { reason: HttpRetryReason.Unavailable, isUndone: true };
  }

  if (response.statusCode === 502) {
    return { reason: HttpRetryReason.Unavailable, waitInMs: 7_500 };
  }

  return null;
};

interface World {
  retry: DataSourceHttpRetry;
  sent: Array<DataSourceHttpRequest>;
  waits: Array<number>;
}

// A client whose answers come in the order given, then a 200 each time after.
function world(
  answers: Array<DataSourceHttpResponse>,
  options: { now?: () => number } = {},
): World {
  const sent: Array<DataSourceHttpRequest> = [];
  const waits: Array<number> = [];
  const transport: DataSourceTransport = async (
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> => {
    sent.push(request);

    return answers.shift() || answer(200);
  };

  return {
    sent,
    waits,
    retry: new DataSourceHttpRetry({
      transport,
      classify: CLASSIFY,
      provider: "Example",
      sleep: async (ms: number): Promise<void> => {
        waits.push(ms);
      },
      ...(options.now ? { now: options.now } : {}),
    }),
  };
}

function get(isSafeToRepeat: boolean = true): {
  build: (attempt: number) => DataSourceHttpRequest;
  isSafeToRepeat: boolean;
} {
  return {
    build: (attempt: number): DataSourceHttpRequest => {
      return { method: "GET", url: `${URL}?try=${attempt}` };
    },
    isSafeToRepeat,
  };
}

describe("what is asked again", () => {
  test("an answer to keep is handed back at once", async () => {
    const { retry, sent, waits } = world([answer(404)]);
    const exchange: HttpRetryExchange = await retry.exchange(get());

    expect(exchange.response.statusCode).toBe(404);
    expect(exchange.attempts).toBe(1);
    expect(exchange.verdict).toBe(null);
    expect(sent).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  test("an answer that may pass is asked again after two seconds, and the next answer is kept", async () => {
    const { retry, sent, waits } = world([answer(503)]);
    const exchange: HttpRetryExchange = await retry.exchange(get());

    expect(exchange.response.statusCode).toBe(200);
    expect(exchange.attempts).toBe(2);
    expect(waits).toEqual([2_000]);
    // Built again for each try, so a token or a resubmission mark is fresh.
    expect(
      sent.map((request: DataSourceHttpRequest): string => {
        return request.url;
      }),
    ).toEqual([`${URL}?try=1`, `${URL}?try=2`]);
  });

  test("three tries at most, two then four seconds apart; the last answer is handed back with its verdict", async () => {
    const { retry, sent, waits } = world([
      answer(503),
      answer(503),
      answer(503),
    ]);
    const exchange: HttpRetryExchange = await retry.exchange(get());

    expect(sent).toHaveLength(HTTP_RETRY_MAX_ATTEMPTS);
    expect(waits).toEqual([2_000, 4_000]);
    expect(exchange.attempts).toBe(3);
    expect(exchange.response.statusCode).toBe(503);
    expect(exchange.verdict).toEqual({ reason: HttpRetryReason.Unavailable });
  });

  test("a request that may have done its work is never asked again after a failure for now", async () => {
    const { retry, sent, waits } = world([answer(503)]);
    const exchange: HttpRetryExchange = await retry.exchange(get(false));

    expect(exchange.response.statusCode).toBe(503);
    expect(sent).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  test("but it is asked again after a throttle, which turned it away before doing it", async () => {
    const { retry, sent } = world([answer(429, { "retry-after": "1" })]);

    expect((await retry.exchange(get(false))).response.statusCode).toBe(200);
    expect(sent).toHaveLength(2);
  });

  test("and after an answer saying it did nothing", async () => {
    const { retry, sent } = world([answer(418)]);

    expect((await retry.exchange(get(false))).response.statusCode).toBe(200);
    expect(sent).toHaveLength(2);
  });

  test("the classifier is handed the request that was sent", async () => {
    const seen: Array<string> = [];
    const retry: DataSourceHttpRetry = new DataSourceHttpRetry({
      transport: async (): Promise<DataSourceHttpResponse> => {
        return answer(200);
      },
      classify: (
        _response: DataSourceHttpResponse,
        request: DataSourceHttpRequest,
      ): null => {
        seen.push(`${request.method} ${request.url}`);
        return null;
      },
      provider: "Example",
    });

    await retry.exchange(get());

    expect(seen).toEqual([`GET ${URL}?try=1`]);
  });
});

describe("how long it waits", () => {
  test("the Retry-After an answer gives, in seconds", async () => {
    const { retry, waits } = world([answer(503, { "retry-after": "5" })]);

    await retry.exchange(get());

    expect(waits).toEqual([5_000]);
  });

  test("the Retry-After an answer gives, as a date", async () => {
    const nowMs: number = Date.UTC(2026, 10, 19, 12, 0, 0);
    const { retry, waits } = world(
      [answer(503, { "retry-after": "Thu, 19 Nov 2026 12:00:09 GMT" })],
      {
        now: (): number => {
          return nowMs;
        },
      },
    );

    await retry.exchange(get());

    expect(waits).toEqual([9_000]);
  });

  test("a Retry-After that is no Retry-After is the backoff", async () => {
    const { retry, waits } = world([answer(503, { "retry-after": "-5" })]);

    await retry.exchange(get());

    expect(waits).toEqual([2_000]);
  });

  test("a wait the answer names in its body, when longer than the backoff", async () => {
    const { retry, waits } = world([answer(502), answer(502)]);

    await retry.exchange(get());

    expect(waits).toEqual([7_500, 7_500]);
  });

  test("a wait the answer names is never waited less than the backoff", async () => {
    const waits: Array<number> = [];
    const retry: DataSourceHttpRetry = new DataSourceHttpRetry({
      transport: (() => {
        let asked: number = 0;

        return async (): Promise<DataSourceHttpResponse> => {
          asked++;
          return asked === 1 ? answer(503) : answer(200);
        };
      })(),
      classify: (response: DataSourceHttpResponse): HttpRetryVerdict | null => {
        return response.statusCode === 503
          ? { reason: HttpRetryReason.Unavailable, waitInMs: 10 }
          : null;
      },
      provider: "Example",
      sleep: async (ms: number): Promise<void> => {
        waits.push(ms);
      },
    });

    await retry.exchange(get());

    expect(waits).toEqual([2_000]);
  });

  test("a wait longer than thirty seconds is not waited out: the answer is handed back at once", async () => {
    const { retry, sent, waits } = world([
      answer(503, { "retry-after": "31" }),
    ]);
    const exchange: HttpRetryExchange = await retry.exchange(get());

    expect(exchange.response.statusCode).toBe(503);
    expect(sent).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  test("a collection waits a minute at most in all; after that, nothing is asked again", async () => {
    // Every request fails twice, then is answered: no outage, only the budget.
    let asked: number = 0;
    const waits: Array<number> = [];
    const retry: DataSourceHttpRetry = new DataSourceHttpRetry({
      transport: async (): Promise<DataSourceHttpResponse> => {
        asked++;
        return asked % 3 === 0 ? answer(200) : answer(503);
      },
      classify: CLASSIFY,
      provider: "Example",
      sleep: async (ms: number): Promise<void> => {
        waits.push(ms);
      },
    });

    for (let request: number = 0; request < 10; request++) {
      expect((await retry.exchange(get())).response.statusCode).toBe(200);
    }

    expect(retry.totalWaitInMs).toBe(HTTP_RETRY_BUDGET_IN_MS);

    const last: HttpRetryExchange = await retry.exchange(get());

    expect(last.response.statusCode).toBe(503);
    expect(last.attempts).toBe(1);
    expect(
      waits.reduce((sum: number, wait: number): number => {
        return sum + wait;
      }, 0),
    ).toBe(HTTP_RETRY_BUDGET_IN_MS);
  });

  test("readWaitInMs keeps only a wait worth waiting for", () => {
    expect(readWaitInMs(3_500)).toBe(3_500);
    expect(readWaitInMs("1200")).toBe(1_200);
    expect(readWaitInMs(0)).toBe(undefined);
    expect(readWaitInMs(-1)).toBe(undefined);
    expect(readWaitInMs("soon")).toBe(undefined);
    expect(readWaitInMs(Number.NaN)).toBe(undefined);
  });
});

describe("a throttle holds back the collection", () => {
  test("the next request waits for the time a throttle named, though it met none itself", async () => {
    // The clock stands still, so the named time never comes by itself.
    const { retry, waits } = world([answer(429, { "retry-after": "3" })], {
      now: (): number => {
        return 1_000_000;
      },
    });

    await retry.exchange(get());
    expect(waits).toEqual([3_000]);

    await retry.exchange(get());
    expect(waits).toEqual([3_000, 3_000]);
  });

  test("a request that does not share the throttle neither waits for it nor holds the others back", async () => {
    const { retry, waits } = world([answer(429, { "retry-after": "3" })], {
      now: (): number => {
        return 1_000_000;
      },
    });

    await retry.exchange({ ...get(), sharesThrottle: false });
    expect(waits).toEqual([3_000]);

    await retry.exchange(get());
    expect(waits).toEqual([3_000]);
  });
});

describe("an outage is not asked again", () => {
  test("after two requests in a row fail every try, the rest are sent once", async () => {
    const { retry, sent } = world(
      Array.from({ length: 20 }, (): DataSourceHttpResponse => {
        return answer(503);
      }),
    );

    await retry.exchange(get());
    await retry.exchange(get());
    expect(retry.isInOutage).toBe(true);
    await retry.exchange(get());
    await retry.exchange(get());

    expect(sent).toHaveLength(3 + 3 + 1 + 1);
  });

  test("an answer lifts it: the next failure for now is asked again", async () => {
    const answers: Array<DataSourceHttpResponse> = [
      ...Array.from({ length: 6 }, (): DataSourceHttpResponse => {
        return answer(503);
      }),
      answer(200),
      answer(503),
    ];
    const { retry, sent } = world(answers);

    await retry.exchange(get());
    await retry.exchange(get());
    await retry.exchange(get());
    expect(retry.isInOutage).toBe(false);

    const next: HttpRetryExchange = await retry.exchange(get());

    expect(next.attempts).toBe(2);
    expect(sent).toHaveLength(6 + 1 + 2);
  });

  test("a request that failed after an answer in between starts the count again", async () => {
    const { retry } = world([
      answer(503),
      answer(503),
      answer(503),
      answer(404),
      answer(503),
      answer(503),
      answer(503),
    ]);

    await retry.exchange(get());
    await retry.exchange(get());
    await retry.exchange(get());

    expect(retry.isInOutage).toBe(false);
  });

  test("a throttle still waits as it asks during an outage: it turned the request away, it did not fail", async () => {
    const { retry, sent } = world([
      ...Array.from({ length: 6 }, (): DataSourceHttpResponse => {
        return answer(503);
      }),
      answer(429, { "retry-after": "1" }),
    ]);

    await retry.exchange(get());
    await retry.exchange(get());

    expect((await retry.exchange(get())).response.statusCode).toBe(200);
    expect(sent).toHaveLength(6 + 2);
  });
});

describe("a request that got no answer", () => {
  test("is never asked again, and is thrown with the transport's own words, told apart from a failure of the request's own making", async () => {
    let sent: number = 0;
    const retry: DataSourceHttpRetry = new DataSourceHttpRetry({
      transport: async (): Promise<DataSourceHttpResponse> => {
        sent++;
        throw new Error("Could not reach data source: socket hang up");
      },
      classify: CLASSIFY,
      provider: "Example",
    });
    const error: unknown = await retry
      .exchange(get())
      .catch((thrown: unknown): unknown => {
        return thrown;
      });

    expect(sent).toBe(1);
    expect(error).toBeInstanceOf(DataSourceUnreachedError);
    expect((error as Error).message).toBe(
      "Could not reach data source: socket hang up",
    );
    expect(
      ((error as DataSourceUnreachedError).transportError as Error).message,
    ).toBe("Could not reach data source: socket hang up");
  });

  test("a request that could not be built throws its own error, unmarked", async () => {
    const { retry, sent } = world([]);
    const refused: Error = new Error("The sign-in was refused.");
    const error: unknown = await retry
      .exchange({
        build: (): DataSourceHttpRequest => {
          throw refused;
        },
        isSafeToRepeat: true,
      })
      .catch((thrown: unknown): unknown => {
        return thrown;
      });

    expect(error).toBe(refused);
    expect(sent).toHaveLength(0);
  });
});

describe("as a transport, for a caller that takes one", () => {
  test("a success is handed on, and the request is sent asking for every status", async () => {
    const { retry, sent } = world([answer(503)]);
    const transport: DataSourceTransport = retry.asTransport({
      isSafeToRepeat: (): boolean => {
        return true;
      },
    });

    expect((await transport({ method: "POST", url: URL })).statusCode).toBe(
      200,
    );
    expect(sent).toHaveLength(2);
    expect(sent[0]!.acceptAnyStatus).toBe(true);
  });

  test("a last answer outside 2xx is thrown as a sentence of who answered which request with what status, then the provider's words, both kept for a caller that reads them", async () => {
    const retry: DataSourceHttpRetry = new DataSourceHttpRetry({
      transport: async (): Promise<DataSourceHttpResponse> => {
        return {
          statusCode: 400,
          bodyText: ' {"error":"invalid_grant"}\n',
          bodyJson: { error: "invalid_grant" },
        };
      },
      classify: CLASSIFY,
      provider: "Example",
    });
    const transport: DataSourceTransport = retry.asTransport({
      isSafeToRepeat: (): boolean => {
        return true;
      },
    });

    const error: unknown = await transport({
      method: "POST",
      url: `${URL}?key=a-key-in-the-query`,
    }).catch((thrown: unknown): unknown => {
      return thrown;
    });

    // Thrown as the plain transport throws a status, so a caller that catches one catches it.
    expect(error).toBeInstanceOf(BadDataException);
    expect(error).toBeInstanceOf(DataSourceStatusException);
    // The address without its query, which can hold a key.
    expect((error as DataSourceStatusException).message).toBe(
      'Example answered HTTP 400 to POST https://example.test/api. {"error":"invalid_grant"}',
    );
    expect((error as DataSourceStatusException).statusCode).toBe(400);
    expect((error as DataSourceStatusException).bodyText).toBe(
      '{"error":"invalid_grant"}',
    );
  });

  test("an answer outside 2xx with no words says it gave none", async () => {
    const { retry } = world([answer(404)]);
    const transport: DataSourceTransport = retry.asTransport({
      isSafeToRepeat: (): boolean => {
        return true;
      },
    });

    const error: unknown = await transport({ method: "GET", url: URL }).catch(
      (thrown: unknown): unknown => {
        return thrown;
      },
    );

    expect((error as DataSourceStatusException).message).toBe(
      "Example answered HTTP 404 to GET https://example.test/api. It gave no error message.",
    );
    expect((error as DataSourceStatusException).bodyText).toBe("");
  });

  test("a request that asked for every status is handed its last answer, whatever it is", async () => {
    const { retry } = world([answer(503), answer(503), answer(503)]);
    const transport: DataSourceTransport = retry.asTransport({
      isSafeToRepeat: (): boolean => {
        return true;
      },
    });

    expect(
      (await transport({ method: "GET", url: URL, acceptAnyStatus: true }))
        .statusCode,
    ).toBe(503);
  });

  test("a request the caller says may not be repeated is sent once after a failure for now", async () => {
    const { retry, sent } = world([answer(503)]);
    const transport: DataSourceTransport = retry.asTransport({
      isSafeToRepeat: (request: DataSourceHttpRequest): boolean => {
        return request.method === "GET";
      },
    });

    await expect(transport({ method: "POST", url: URL })).rejects.toThrow(
      "Example answered HTTP 503 to POST https://example.test/api.",
    );
    expect(sent).toHaveLength(1);
  });
});
