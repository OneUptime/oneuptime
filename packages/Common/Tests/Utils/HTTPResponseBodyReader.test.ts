import { describe, expect, jest, test } from "@jest/globals";
import BadDataException from "../../Types/Exception/BadDataException";
import HTTPResponseBodyReader, {
  HTTPResponseBodyBudget,
} from "../../Utils/HTTPResponseBodyReader";
import { Readable } from "stream";
import type { Mock, MockInstance } from "jest-mock";

const read: (
  body: AsyncIterable<unknown>,
  budget: HTTPResponseBodyBudget,
  options?: {
    statusCode?: number;
    limitRedirectResponseBody?: boolean;
    headers?: unknown;
    isHeadResponse?: boolean;
    maximumResponseBytes?: number;
    signal?: AbortSignal;
  },
) => Promise<Buffer> = async (
  body: AsyncIterable<unknown>,
  budget: HTTPResponseBodyBudget,
  options: {
    statusCode?: number;
    limitRedirectResponseBody?: boolean;
    headers?: unknown;
    isHeadResponse?: boolean;
    maximumResponseBytes?: number;
    signal?: AbortSignal;
  } = {},
): Promise<Buffer> => {
  return await HTTPResponseBodyReader.read(body, {
    budget: budget,
    statusCode: options.statusCode ?? 200,
    limitRedirectResponseBody: options.limitRedirectResponseBody ?? true,
    headers: options.headers,
    isHeadResponse: options.isHeadResponse,
    maximumResponseBytes: options.maximumResponseBytes,
    signal: options.signal,
  });
};

describe("HTTPResponseBodyReader", () => {
  test.each([200, 400, 503])(
    "destroys a stalled status %s body and removes its listener on abort",
    async (statusCode: number) => {
      const controller: AbortController = new AbortController();
      const addListener: MockInstance<AbortSignal["addEventListener"]> =
        jest.spyOn(controller.signal, "addEventListener");
      const removeListener: MockInstance<AbortSignal["removeEventListener"]> =
        jest.spyOn(controller.signal, "removeEventListener");
      const body: Readable = new Readable({ read: (): void => {} });
      const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(10);
      const pending: Promise<Buffer> = read(body, budget, {
        statusCode: statusCode,
        signal: controller.signal,
      });
      const rejected: Promise<void> = expect(pending).rejects.toMatchObject({
        name: "AbortError",
      });

      controller.abort();
      await rejected;

      expect(body.destroyed).toBe(true);
      expect(budget.remainingBytes).toBe(10);
      expect(removeListener).toHaveBeenCalledWith(
        "abort",
        addListener.mock.calls[0]![1],
      );
    },
  );

  test("destroys an already-aborted body without starting its iterator", async () => {
    const controller: AbortController = new AbortController();
    controller.abort();
    const body: Readable = Readable.from([Buffer.from("unread")]);
    const iterate: MockInstance<Readable[typeof Symbol.asyncIterator]> =
      jest.spyOn(body, Symbol.asyncIterator);
    const removeListener: MockInstance<AbortSignal["removeEventListener"]> =
      jest.spyOn(controller.signal, "removeEventListener");
    const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(10);

    await expect(
      read(body, budget, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(iterate).not.toHaveBeenCalled();
    expect(body.destroyed).toBe(true);
    expect(budget.remainingBytes).toBe(10);
    expect(removeListener).toHaveBeenCalledTimes(1);
  });

  test("removes its abort listener after a successful duck-typed stream", async () => {
    const controller: AbortController = new AbortController();
    const destroy: Mock<() => void> = jest.fn<() => void>();
    const body: AsyncIterable<Buffer> & { destroy: () => void } = {
      async *[Symbol.asyncIterator](): ReturnType<
        AsyncIterable<Buffer>[typeof Symbol.asyncIterator]
      > {
        yield Buffer.from("data");
      },
      destroy: destroy,
    };
    const removeListener: MockInstance<AbortSignal["removeEventListener"]> =
      jest.spyOn(controller.signal, "removeEventListener");

    await expect(
      read(body, new HTTPResponseBodyBudget(10), { signal: controller.signal }),
    ).resolves.toEqual(Buffer.from("data"));
    controller.abort();

    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
  });

  test("removes its abort listener after the source iterator fails", async () => {
    const controller: AbortController = new AbortController();
    const destroy: Mock<() => void> = jest.fn<() => void>();
    const sourceError: Error = new Error("source failed");
    const body: AsyncIterable<Buffer> & { destroy: () => void } = {
      [Symbol.asyncIterator](): AsyncIterator<Buffer> {
        return {
          next: (): Promise<IteratorResult<Buffer>> => {
            return Promise.reject(sourceError);
          },
        };
      },
      destroy: destroy,
    };
    const removeListener: MockInstance<AbortSignal["removeEventListener"]> =
      jest.spyOn(controller.signal, "removeEventListener");

    await expect(
      read(body, new HTTPResponseBodyBudget(10), { signal: controller.signal }),
    ).rejects.toBe(sourceError);
    controller.abort();

    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
  });

  test.each(["declared length", "streamed length", "exhausted budget"])(
    "removes its abort listener after rejecting %s",
    async (failure: string) => {
      const controller: AbortController = new AbortController();
      const removeListener: MockInstance<AbortSignal["removeEventListener"]> =
        jest.spyOn(controller.signal, "removeEventListener");
      const body: Readable = Readable.from([Buffer.from("12345")]);
      const destroy: MockInstance<Readable["destroy"]> = jest.spyOn(
        body,
        "destroy",
      );
      const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(
        failure === "exhausted budget" ? 0 : 4,
      );

      await expect(
        read(body, budget, {
          signal: controller.signal,
          headers:
            failure === "declared length" ? { "content-length": "5" } : {},
        }),
      ).rejects.toBeInstanceOf(BadDataException);
      const destroyCalls: number = destroy.mock.calls.length;
      controller.abort();

      expect(body.destroyed).toBe(true);
      expect(removeListener).toHaveBeenCalledTimes(1);
      expect(destroy).toHaveBeenCalledTimes(destroyCalls);
    },
  );

  test("settles on abort without destroy and never charges a late chunk", async () => {
    const controller: AbortController = new AbortController();
    const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(10);
    let resolveWaiting: () => void = (): void => {};
    const waiting: Promise<void> = new Promise((resolve: () => void) => {
      resolveWaiting = resolve;
    });
    let resolveLateChunk: (
      chunk: IteratorResult<Buffer>,
    ) => void = (): void => {};
    const lateChunk: Promise<IteratorResult<Buffer>> = new Promise(
      (resolve: (chunk: IteratorResult<Buffer>) => void) => {
        resolveLateChunk = resolve;
      },
    );
    let nextCalls: number = 0;
    const body: AsyncIterable<Buffer> = {
      [Symbol.asyncIterator](): AsyncIterator<Buffer> {
        return {
          next: (): Promise<IteratorResult<Buffer>> => {
            nextCalls++;
            if (nextCalls === 1) {
              return Promise.resolve({
                done: false,
                value: Buffer.from("abc"),
              });
            }
            resolveWaiting();
            return lateChunk;
          },
        };
      },
    };
    const pending: Promise<Buffer> = read(body, budget, {
      signal: controller.signal,
    });
    const rejected: Promise<void> = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });

    await waiting;
    expect(budget.remainingBytes).toBe(7);
    controller.abort();
    await rejected;
    resolveLateChunk({ done: false, value: Buffer.from("late") });
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });

    expect(budget.remainingBytes).toBe(7);
    expect(nextCalls).toBe(2);
  });

  test("charges sequential responses against one cumulative byte budget", async () => {
    const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(6);

    await expect(
      read(Readable.from([Buffer.from("abc")]), budget),
    ).resolves.toEqual(Buffer.from("abc"));
    expect(budget.remainingBytes).toBe(3);

    await expect(
      read(Readable.from([Buffer.from("de")]), budget),
    ).resolves.toEqual(Buffer.from("de"));
    expect(budget.remainingBytes).toBe(1);

    await expect(
      read(Readable.from([Buffer.from("fg")]), budget),
    ).rejects.toBeInstanceOf(BadDataException);
  });

  test.each([301, 302, 303, 307, 308])(
    "applies the smaller redirect cap to status %s",
    async (statusCode: number) => {
      const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(100, 4);
      const body: Readable = Readable.from([Buffer.from("12345")]);

      await expect(
        read(body, budget, {
          statusCode: statusCode,
          limitRedirectResponseBody: true,
        }),
      ).rejects.toThrow("exceeded the allowed size");
      expect(body.destroyed).toBe(true);
    },
  );

  test("allows a redirect body to use the full budget when redirects are not followed", async () => {
    const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(10, 4);

    await expect(
      read(Readable.from([Buffer.from("12345")]), budget, {
        statusCode: 302,
        limitRedirectResponseBody: false,
      }),
    ).resolves.toEqual(Buffer.from("12345"));
    expect(budget.remainingBytes).toBe(5);
  });

  test("accepts a redirect body exactly at its smaller cap and charges the shared budget", async () => {
    const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(10, 4);

    await expect(
      read(Readable.from([Buffer.from("1234")]), budget, {
        statusCode: 308,
        limitRedirectResponseBody: true,
      }),
    ).resolves.toEqual(Buffer.from("1234"));
    expect(budget.remainingBytes).toBe(6);
  });

  test("enforces a caller-specific per-response cap while charging the shared budget", async () => {
    const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(100);
    const body: Readable = Readable.from([Buffer.from("12345")]);

    await expect(
      read(body, budget, {
        limitRedirectResponseBody: false,
        maximumResponseBytes: 4,
      }),
    ).rejects.toThrow("exceeded the allowed size");
    expect(body.destroyed).toBe(true);
    expect(budget.remainingBytes).toBe(95);
  });

  test("counts UTF-8 bytes rather than JavaScript characters", async () => {
    const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(2);

    await expect(
      read(Readable.from([Buffer.from("é")]), budget),
    ).resolves.toEqual(Buffer.from("é"));
    expect(budget.remainingBytes).toBe(0);
  });

  test("rejects an oversized Content-Length before reading the stream", async () => {
    const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(4);
    const body: Readable = Readable.from([Buffer.from("data")]);

    await expect(
      read(body, budget, {
        headers: { "Content-Length": "5" },
      }),
    ).rejects.toThrow("exceeded the allowed size");
    expect(body.destroyed).toBe(true);
    expect(budget.remainingBytes).toBe(4);
  });

  test("ignores hypothetical Content-Length on HEAD while still counting actual bytes", async () => {
    const emptyBudget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(4);

    await expect(
      read(Readable.from([]), emptyBudget, {
        headers: { "Content-Length": "1000000" },
        isHeadResponse: true,
      }),
    ).resolves.toEqual(Buffer.alloc(0));
    expect(emptyBudget.remainingBytes).toBe(4);

    const nonCompliantBudget: HTTPResponseBodyBudget =
      new HTTPResponseBodyBudget(4);
    await expect(
      read(Readable.from([Buffer.from("12345")]), nonCompliantBudget, {
        headers: { "Content-Length": "1000000" },
        isHeadResponse: true,
      }),
    ).rejects.toBeInstanceOf(BadDataException);
    expect(nonCompliantBudget.remainingBytes).toBe(0);
  });

  test.each([204, 304])(
    "ignores hypothetical Content-Length on bodyless status %s while still counting actual bytes",
    async (statusCode: number) => {
      const emptyBudget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(4);

      await expect(
        read(Readable.from([]), emptyBudget, {
          statusCode: statusCode,
          headers: { "Content-Length": "1000000" },
        }),
      ).resolves.toEqual(Buffer.alloc(0));
      expect(emptyBudget.remainingBytes).toBe(4);

      const nonCompliantBudget: HTTPResponseBodyBudget =
        new HTTPResponseBodyBudget(4);
      await expect(
        read(Readable.from([Buffer.from("12345")]), nonCompliantBudget, {
          statusCode: statusCode,
          headers: { "Content-Length": "1000000" },
        }),
      ).rejects.toBeInstanceOf(BadDataException);
      expect(nonCompliantBudget.remainingBytes).toBe(0);
    },
  );

  test("supports Axios-style headers with a get method", async () => {
    const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(4);
    const body: Readable = Readable.from([Buffer.from("data")]);

    await expect(
      read(body, budget, {
        headers: {
          get: (name: string): string | undefined => {
            return name === "content-length" ? "5" : undefined;
          },
        },
      }),
    ).rejects.toBeInstanceOf(BadDataException);
    expect(body.destroyed).toBe(true);
  });

  test("uses the first Content-Length value when a header collection returns an array", async () => {
    const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(4);
    const body: Readable = Readable.from([Buffer.from("data")]);

    await expect(
      read(body, budget, {
        headers: { "content-length": ["5", "4"] },
      }),
    ).rejects.toThrow("exceeded the allowed size");
    expect(body.destroyed).toBe(true);
    expect(budget.remainingBytes).toBe(4);
  });

  test.each(["not-a-number", "-1", Number.POSITIVE_INFINITY])(
    "ignores an invalid Content-Length value (%s) and enforces the stream itself",
    async (contentLength: string | number) => {
      const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(4);

      await expect(
        read(Readable.from([Buffer.from("data")]), budget, {
          headers: { "content-length": contentLength },
        }),
      ).resolves.toEqual(Buffer.from("data"));
      expect(budget.remainingBytes).toBe(0);
    },
  );

  test("destroys a chunked stream as soon as it exceeds the remaining budget", async () => {
    const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(4);
    const body: Readable = Readable.from([
      Buffer.from("12"),
      Buffer.from("345"),
      Buffer.from("unread"),
    ]);

    await expect(read(body, budget)).rejects.toBeInstanceOf(BadDataException);
    expect(body.destroyed).toBe(true);
    expect(budget.remainingBytes).toBe(0);
  });

  test("charges bytes received before the source stream fails", async () => {
    const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(20);
    let nextCallCount: number = 0;
    const body: AsyncIterable<Buffer> = {
      [Symbol.asyncIterator](): AsyncIterator<Buffer> {
        return {
          next: (): Promise<IteratorResult<Buffer>> => {
            nextCallCount++;
            if (nextCallCount === 1) {
              return Promise.resolve({
                done: false,
                value: Buffer.from("partial"),
              });
            }

            return Promise.reject(new Error("socket reset while reading"));
          },
        };
      },
    };

    await expect(read(body, budget)).rejects.toThrow(
      "socket reset while reading",
    );
    expect(budget.remainingBytes).toBe(13);
  });

  test("rejects a new response after the shared budget is exactly exhausted", async () => {
    const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(4);
    await read(Readable.from([Buffer.from("data")]), budget);
    const rejectedBody: Readable = Readable.from([Buffer.alloc(0)]);

    await expect(read(rejectedBody, budget)).rejects.toThrow("cumulative size");
    expect(rejectedBody.destroyed).toBe(true);
  });

  test("rejects a non-stream body in budgeted mode", async () => {
    await expect(
      HTTPResponseBodyReader.read("not-a-stream", {
        budget: new HTTPResponseBodyBudget(10),
        statusCode: 200,
        limitRedirectResponseBody: true,
      }),
    ).rejects.toThrow("could not be read");
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "fails closed for a non-finite constructor limit (%s)",
    async (invalidLimit: number) => {
      const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(
        invalidLimit,
        invalidLimit,
      );

      expect(budget.remainingBytes).toBe(0);
      expect(budget.maxRedirectResponseBytes).toBe(0);
      await expect(
        read(Readable.from([Buffer.alloc(0)]), budget),
      ).rejects.toThrow("cumulative size");
    },
  );

  test("clamps negative constructor limits and refuses any response", async () => {
    const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(-10, -1);

    expect(budget.remainingBytes).toBe(0);
    expect(budget.maxRedirectResponseBytes).toBe(0);
    await expect(
      read(Readable.from([Buffer.alloc(0)]), budget),
    ).rejects.toThrow("cumulative size");
  });

  test("rejects invalid direct budget consumption without changing the balance", () => {
    const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(10);

    expect(() => {
      budget.consume(-1);
    }).toThrow("cumulative size");
    expect(() => {
      budget.consume(11);
    }).toThrow("cumulative size");
    expect(() => {
      budget.consume(Number.NaN);
    }).toThrow("cumulative size");
    expect(budget.remainingBytes).toBe(10);
  });
});
