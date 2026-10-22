import {
  BatchOutcome,
  DestinationAnswer,
  describeAnswerBody,
  readTransportError,
  sendInBatches,
  toBatches,
} from "../../../../../Server/Utils/SecurityEvent/Destinations/BatchSender";
import { SecurityEventSendResult } from "../../../../../Server/Utils/SecurityEvent/Destinations/Types";
import { noSleep } from "./FakeSiem";
import { describe, expect, test } from "@jest/globals";

/*
 * The batching every SIEM sender but Google SecOps's shares, driven with a
 * scripted SIEM: what an answer means for the batch, and where a send that
 * stops leaves the next run to start.
 */

function answer(status: number, body: unknown = {}): DestinationAnswer {
  return {
    ok: status >= 200 && status < 300,
    status,
    bodyText: JSON.stringify(body),
    bodyJson: body,
  };
}

async function run(
  items: Array<number>,
  post: (batch: Array<number>) => Promise<BatchOutcome>,
  isSplittable: (outcome: BatchOutcome) => boolean = (): boolean => {
    return false;
  },
): Promise<SecurityEventSendResult> {
  return sendInBatches<number>({
    items,
    sizeOf: (): number => {
      return 10;
    },
    maxItems: 4,
    maxBytes: 1000,
    post,
    isSplittable,
    describeFailure: (failed: DestinationAnswer): string => {
      return `failed with ${failed.status}`;
    },
    describeUnreachable: (error: unknown): string => {
      return `unreachable: ${(error as Error).message}`;
    },
    sleep: noSleep,
  });
}

describe("an answer the transport threw", () => {
  test("is read back as its status and body", () => {
    expect(
      readTransportError(
        new Error(
          'Data source responded with HTTP 403: {"code":4,"text":"Invalid token"}',
        ),
      ),
    ).toEqual({
      ok: false,
      status: 403,
      bodyText: '{"code":4,"text":"Invalid token"}',
      bodyJson: { code: 4, text: "Invalid token" },
    });
  });

  test("a body that is not JSON is kept as text", () => {
    expect(
      readTransportError(
        new Error("Data source responded with HTTP 502: Bad Gateway"),
      ),
    ).toMatchObject({
      status: 502,
      bodyText: "Bad Gateway",
      bodyJson: undefined,
    });
  });

  test("anything else is no answer at all", () => {
    for (const error of [
      new Error("connect ECONNREFUSED 10.0.0.1:443"),
      new Error("Data source responded with HTTP abc: x"),
      "a string",
      undefined,
    ]) {
      expect(readTransportError(error)).toBeNull();
    }
  });

  test("what a SIEM said is cut short for a person to read", () => {
    expect(
      describeAnswerBody({
        ok: false,
        status: 400,
        bodyText: "x".repeat(1000),
        bodyJson: undefined,
      }).length,
    ).toBeLessThanOrEqual(301);
  });
});

describe("batches", () => {
  test("hold at most the items and bytes one request carries; a big item goes alone", () => {
    expect(
      toBatches(
        [1, 2, 3, 4, 5],
        (): number => {
          return 1;
        },
        2,
        100,
      ),
    ).toEqual([[1, 2], [3, 4], [5]]);
    expect(
      toBatches(
        [10, 500, 10, 10],
        (item: number): number => {
          return item;
        },
        10,
        100,
      ),
    ).toEqual([[10], [500], [10, 10]]);
  });
});

describe("a send", () => {
  test("goes batch by batch, and counts every event once", async () => {
    const seen: Array<Array<number>> = [];
    const result: SecurityEventSendResult = await run(
      [1, 2, 3, 4, 5, 6],
      async (batch: Array<number>): Promise<BatchOutcome> => {
        seen.push(batch);
        return { answer: answer(200) };
      },
    );

    expect(seen).toEqual([
      [1, 2, 3, 4],
      [5, 6],
    ]);
    expect(result).toMatchObject({ processed: 6, sent: 6, requests: 2 });
  });

  test("a SIEM that refused the very first event of a batch took none of it", async () => {
    let call: number = 0;
    const result: SecurityEventSendResult = await run(
      [1, 2, 3],
      async (): Promise<BatchOutcome> => {
        call++;
        return call === 1
          ? { answer: answer(400), acceptedBeforeRefusal: 0 }
          : { answer: answer(200) };
      },
      (): boolean => {
        return true;
      },
    );

    expect(result).toMatchObject({ processed: 3, sent: 2, rejected: 1 });
  });

  test("a send that stops in the second batch leaves the next run at its first event", async () => {
    let call: number = 0;
    const result: SecurityEventSendResult = await run(
      [1, 2, 3, 4, 5, 6],
      async (): Promise<BatchOutcome> => {
        call++;
        return call === 1 ? { answer: answer(200) } : { answer: answer(401) };
      },
    );

    expect(result).toMatchObject({
      processed: 4,
      sent: 4,
      failure: "failed with 401",
      failureStatus: 401,
    });
  });

  test("no answer three times stops the send with why", async () => {
    const result: SecurityEventSendResult = await run(
      [1],
      async (): Promise<BatchOutcome> => {
        throw new Error("socket hang up");
      },
    );

    expect(result).toMatchObject({
      processed: 0,
      requests: 3,
      failure: "unreachable: socket hang up",
      failureStatus: null,
    });
  });

  test("an event both refused and asked for again is refused, not sent again", async () => {
    const seen: Array<Array<number>> = [];
    const result: SecurityEventSendResult = await run(
      [1, 2, 3],
      async (batch: Array<number>): Promise<BatchOutcome> => {
        seen.push(batch);

        return seen.length === 1
          ? {
              answer: answer(200),
              rejected: [1],
              retry: [1, 2],
              rejectionReason: "bad",
            }
          : { answer: answer(200) };
      },
    );

    expect(seen).toEqual([[1, 2, 3], [3]]);
    expect(result).toMatchObject({
      processed: 3,
      sent: 2,
      rejected: 1,
      rejectionReason: "bad",
    });
  });

  test("nothing to send sends nothing", async () => {
    const result: SecurityEventSendResult = await run(
      [],
      async (): Promise<BatchOutcome> => {
        throw new Error("never");
      },
    );

    expect(result).toMatchObject({ processed: 0, requests: 0 });
  });
});
