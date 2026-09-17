import { gunzipSync, strFromU8 } from "fflate";
import {
  SESSION_REPLAY_CONTENT_TYPE,
  SESSION_REPLAY_MOBILE_APP_IDENTIFIER_HEADER,
  SESSION_REPLAY_RECORDER_KIND_HEADER,
  SessionReplayChunkEnvelope,
} from "../src/Contract";
import {
  ReplayFetch,
  validateStartOptions,
  ValidatedStartOptions,
} from "../src/Config";
import ReplayOutbox, { frameId, PersistedReplayFrame } from "../src/Outbox";
import ReplayTransport, {
  CHUNK_POST_TIMEOUT_MS,
  EncodedReplayFrame,
  encodeReplayFrame,
  ReplayTransportOptions,
} from "../src/Transport";
import { envelope, MemoryStorage, response, startOptions } from "./TestUtils";

interface SplitWireResult {
  envelope: Record<string, unknown>;
  payload: unknown;
  compressed: Uint8Array;
}

function splitWire(body: Uint8Array): SplitWireResult {
  const newline: number = body.indexOf(10);
  const wireEnvelope: Record<string, unknown> = JSON.parse(
    strFromU8(body.slice(0, newline)),
  ) as Record<string, unknown>;
  const compressed: Uint8Array = body.slice(newline + 1);
  return {
    envelope: wireEnvelope,
    payload: JSON.parse(strFromU8(gunzipSync(compressed))),
    compressed,
  };
}

async function seed(outbox: ReplayOutbox, index: number): Promise<void> {
  const frameEnvelope: SessionReplayChunkEnvelope = envelope({
    chunkIndex: index,
  });
  await outbox.enqueue({
    id: frameId(frameEnvelope),
    envelope: frameEnvelope,
    payload: JSON.stringify([{ index }]),
    attempts: 0,
    createdAtUnixMs: index,
  });
}

describe("mobile replay transport", () => {
  test("builds the newline-framed contract with real gzip, never raw deflate", () => {
    const encoded: EncodedReplayFrame = encodeReplayFrame(
      envelope(),
      JSON.stringify([{ ok: true }]),
    );
    const frame: SplitWireResult = splitWire(encoded.body);
    expect(Array.from(frame.compressed.slice(0, 2))).toEqual([0x1f, 0x8b]);
    expect(frame.payload).toEqual([{ ok: true }]);
    expect(frame.envelope["payloadEncoding"]).toBe("gzip");
    expect(frame.envelope["payloadBytes"]).toBe(frame.compressed.byteLength);
  });

  test("persists before POST and sends native headers without browser Origin", async () => {
    const storage: MemoryStorage = new MemoryStorage();
    const outbox: ReplayOutbox = new ReplayOutbox(storage, "app");
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (_url: string, init?: NonNullable<Parameters<ReplayFetch>[1]>) => {
        expect(
          Array.from(storage.values.keys()).some((key: string) => {
            return key.endsWith("/outbox");
          }),
        ).toBe(true);
        expect(init?.headers?.["Content-Type"]).toBe(
          SESSION_REPLAY_CONTENT_TYPE,
        );
        expect(init?.headers?.[SESSION_REPLAY_RECORDER_KIND_HEADER]).toBe(
          "rn-view-tree",
        );
        expect(
          init?.headers?.[SESSION_REPLAY_MOBILE_APP_IDENTIFIER_HEADER],
        ).toBe("com.example.checkout");
        expect(init?.headers).not.toHaveProperty("Origin");
        const decoded: SplitWireResult = splitWire(init?.body as Uint8Array);
        expect(decoded.payload).toEqual([{ safe: true }]);
        return response(202, { directive: "continue", configEpoch: 1 });
      },
    );
    const validated: ValidatedStartOptions = validateStartOptions(
      startOptions({ fetch }),
    )!;
    const transport: ReplayTransport = new ReplayTransport({
      startOptions: validated,
      outbox,
      onDirective: jest.fn(),
      onDiagnostic: jest.fn(),
    });
    await transport.enqueue(envelope(), JSON.stringify([{ safe: true }]));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await outbox.list()).toEqual([]);
    transport.destroy();
  });

  test("retains network failures durably and a new transport restores them", async () => {
    jest.useFakeTimers();
    const storage: MemoryStorage = new MemoryStorage();
    const outbox: ReplayOutbox = new ReplayOutbox(storage, "app");
    const failingFetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (_url: string) => {
        throw new Error("offline");
      },
    );
    const first: ReplayTransport = new ReplayTransport({
      startOptions: validateStartOptions(
        startOptions({ fetch: failingFetch }),
      )!,
      outbox,
      onDirective: jest.fn(),
      onDiagnostic: jest.fn(),
    });
    await first.enqueue(envelope(), "[]");
    expect((await outbox.list())[0]?.attempts).toBe(1);
    first.destroy();

    const acceptedFetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (_url: string) => {
        return response(202, { directive: "continue", configEpoch: 1 });
      },
    );
    const second: ReplayTransport = new ReplayTransport({
      startOptions: validateStartOptions(
        startOptions({ fetch: acceptedFetch }),
      )!,
      outbox,
      onDirective: jest.fn(),
      onDiagnostic: jest.fn(),
    });
    await second.restore();
    expect(acceptedFetch).toHaveBeenCalledTimes(1);
    expect(await outbox.list()).toEqual([]);
    second.destroy();
    jest.useRealTimers();
  });

  test("aborts and releases the drain when React Native fetch never settles", async () => {
    jest.useFakeTimers();
    const outbox: ReplayOutbox = new ReplayOutbox(new MemoryStorage(), "app");
    let requestSignal: AbortSignal | undefined;
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (
        _url: string,
        init: NonNullable<Parameters<ReplayFetch>[1]> = {},
      ) => {
        return await new Promise<never>(() => {
          requestSignal = init.signal;
        });
      },
    );
    const onDiagnostic: jest.MockedFunction<
      ReplayTransportOptions["onDiagnostic"]
    > = jest.fn();
    const transport: ReplayTransport = new ReplayTransport({
      startOptions: validateStartOptions(startOptions({ fetch }))!,
      outbox,
      onDirective: jest.fn(),
      onDiagnostic,
    });

    const uploading: Promise<void> = transport.enqueue(envelope(), "[]");
    for (
      let step: number = 0;
      step < 20 && fetch.mock.calls.length === 0;
      step += 1
    ) {
      await Promise.resolve();
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(CHUNK_POST_TIMEOUT_MS);
    await uploading;

    expect(requestSignal?.aborted).toBe(true);
    expect(onDiagnostic).toHaveBeenCalledWith("chunk-post-timeout", {
      chunkIndex: 0,
    });
    expect((await outbox.list())[0]?.attempts).toBe(1);
    transport.destroy();
    jest.useRealTimers();
  });

  test("destroy aborts an in-flight request and releases its drain immediately", async () => {
    const outbox: ReplayOutbox = new ReplayOutbox(new MemoryStorage(), "app");
    let requestSignal: AbortSignal | undefined;
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (
        _url: string,
        init: NonNullable<Parameters<ReplayFetch>[1]> = {},
      ) => {
        return await new Promise<never>(() => {
          requestSignal = init.signal;
        });
      },
    );
    const onDiagnostic: jest.MockedFunction<
      ReplayTransportOptions["onDiagnostic"]
    > = jest.fn();
    const transport: ReplayTransport = new ReplayTransport({
      startOptions: validateStartOptions(startOptions({ fetch }))!,
      outbox,
      onDirective: jest.fn(),
      onDiagnostic,
    });

    const uploading: Promise<void> = transport.enqueue(envelope(), "[]");
    for (
      let step: number = 0;
      step < 20 && fetch.mock.calls.length === 0;
      step += 1
    ) {
      await Promise.resolve();
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    transport.destroy();
    await uploading;

    expect(requestSignal?.aborted).toBe(true);
    expect(onDiagnostic).not.toHaveBeenCalled();
  });

  test("a 204 stop header halts capture and clears every queued frame", async () => {
    const outbox: ReplayOutbox = new ReplayOutbox(new MemoryStorage(), "app");
    await seed(outbox, 0);
    await seed(outbox, 1);
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (_url: string) => {
        return response(
          204,
          {},
          {
            "x-oneuptime-replay-directive": "stop",
            "x-oneuptime-replay-reason": "budget-exhausted",
          },
        );
      },
    );
    const onDirective: jest.MockedFunction<
      ReplayTransportOptions["onDirective"]
    > = jest.fn();
    const transport: ReplayTransport = new ReplayTransport({
      startOptions: validateStartOptions(startOptions({ fetch }))!,
      outbox,
      onDirective,
      onDiagnostic: jest.fn(),
    });
    await transport.restore();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onDirective).toHaveBeenCalledWith("stop", "budget-exhausted");
    expect(await outbox.list()).toEqual([]);
  });

  test("an accepted 204 throttle removes only that frame and waits before the next", async () => {
    jest.useFakeTimers();
    const outbox: ReplayOutbox = new ReplayOutbox(new MemoryStorage(), "app");
    await seed(outbox, 0);
    await seed(outbox, 1);
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (_url: string) => {
        return response(
          204,
          {},
          {
            "x-oneuptime-replay-directive": "throttle",
            "retry-after": "30",
          },
        );
      },
    );
    const transport: ReplayTransport = new ReplayTransport({
      startOptions: validateStartOptions(startOptions({ fetch }))!,
      outbox,
      onDirective: jest.fn(),
      onDiagnostic: jest.fn(),
    });
    await transport.restore();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      (await outbox.list()).map((item: PersistedReplayFrame) => {
        return item.envelope.chunkIndex;
      }),
    ).toEqual([1]);
    transport.destroy();
    jest.useRealTimers();
  });

  test("retry-after zero drains remaining frames after the current drain settles", async () => {
    jest.useFakeTimers();
    const outbox: ReplayOutbox = new ReplayOutbox(new MemoryStorage(), "app");
    await seed(outbox, 0);
    await seed(outbox, 1);
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (_url: string) => {
        return response(
          204,
          {},
          {
            "x-oneuptime-replay-directive": "throttle",
            "retry-after": "0",
          },
        );
      },
    );
    const transport: ReplayTransport = new ReplayTransport({
      startOptions: validateStartOptions(startOptions({ fetch }))!,
      outbox,
      onDirective: jest.fn(),
      onDiagnostic: jest.fn(),
    });
    await transport.restore();
    expect(fetch).toHaveBeenCalledTimes(1);
    await jest.runOnlyPendingTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await outbox.list()).toEqual([]);
    transport.destroy();
    jest.useRealTimers();
  });

  test.each([401, 403, 404])(
    "terminal HTTP %s clears sensitive persisted backlog",
    async (status: number) => {
      const outbox: ReplayOutbox = new ReplayOutbox(new MemoryStorage(), "app");
      await seed(outbox, 0);
      await seed(outbox, 1);
      const transport: ReplayTransport = new ReplayTransport({
        startOptions: validateStartOptions(
          startOptions({
            fetch: jest.fn(async () => {
              return response(status);
            }),
          }),
        )!,
        outbox,
        onDirective: jest.fn(),
        onDiagnostic: jest.fn(),
      });
      await transport.restore();
      expect(await outbox.list()).toEqual([]);
    },
  );
});
