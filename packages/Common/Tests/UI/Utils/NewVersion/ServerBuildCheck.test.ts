import { describe, expect, jest, test } from "@jest/globals";
import { Mock } from "jest-mock";
import {
  checkServerBuild,
  FetchFunction,
  readBuildIdFromManifest,
  ServerBuildCheckResult,
  ServerBuildStatus,
} from "../../../../UI/Utils/NewVersion/ServerBuildCheck";

/*
 * The one question every new-version decision rests on: which build does the
 * server serve now? build.json answers it (Common/UI/esbuild-config.js
 * writes it beside the bundle). Every way a server can answer - or not - is
 * pinned here, because each one leads somewhere else: a new build moves the
 * reader onto it, the same build changes nothing, a server that answers
 * with something else still answers (a reload will reach it), one that is
 * restarting is waited for, and silence is never mistaken for any of them.
 * None of it may throw.
 */

const MANIFEST_URL: string = "/dashboard/dist/build.json";
const RUNNING: string = "14.0.89-abc123-0001";
const NEWER: string = "14.0.90-def456-0002";

interface FakeAnswer {
  status: number;
  body?: string;
  bodyFails?: boolean;
}

interface Call {
  url: string;
  init: RequestInit | undefined;
}

const answering: (
  answer: FakeAnswer,
  calls?: Array<Call>,
) => FetchFunction = (
  answer: FakeAnswer,
  calls?: Array<Call>,
): FetchFunction => {
  return (url: string, init?: RequestInit): Promise<Response> => {
    calls?.push({ url, init });

    return Promise.resolve({
      status: answer.status,
      ok: answer.status >= 200 && answer.status < 300,
      text: (): Promise<string> => {
        return answer.bodyFails
          ? Promise.reject(new TypeError("network error"))
          : Promise.resolve(answer.body ?? "");
      },
    } as unknown as Response);
  };
};

const flushMicrotasks: () => Promise<void> = async (): Promise<void> => {
  for (let i: number = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

const manifest: (buildId: unknown) => string = (buildId: unknown): string => {
  return JSON.stringify({ buildId, version: "14.0.90", gitSha: "def456" });
};

const check: (
  fetchFunction: FetchFunction,
  timeoutInMs?: number,
) => Promise<ServerBuildCheckResult> = (
  fetchFunction: FetchFunction,
  timeoutInMs?: number,
): Promise<ServerBuildCheckResult> => {
  return checkServerBuild({
    runningBuildId: RUNNING,
    manifestUrl: MANIFEST_URL,
    fetchFunction: fetchFunction,
    timeoutInMs: timeoutInMs,
  });
};

describe("checkServerBuild", () => {
  test("a new build on the server is New, with the build it names", async () => {
    await expect(
      check(answering({ status: 200, body: manifest(NEWER) })),
    ).resolves.toEqual({
      status: ServerBuildStatus.New,
      serverBuildId: NEWER,
    });
  });

  test("the build this tab runs is Same", async () => {
    await expect(
      check(answering({ status: 200, body: manifest(RUNNING) })),
    ).resolves.toEqual({
      status: ServerBuildStatus.Same,
      serverBuildId: RUNNING,
    });
  });

  test("asks for the manifest past every cache, as JSON", async () => {
    const calls: Array<Call> = [];

    await check(answering({ status: 200, body: manifest(RUNNING) }, calls));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(MANIFEST_URL);
    expect(calls[0]!.init?.method).toBe("GET");
    expect(calls[0]!.init?.cache).toBe("no-store");
    expect(calls[0]!.init?.credentials).toBe("same-origin");
    expect(calls[0]!.init?.headers).toEqual({ Accept: "application/json" });
    expect(calls[0]!.init?.signal).toBeDefined();
  });

  test.each<[string, string]>([
    [
      "the app's page (the server answers an unknown address with itself)",
      "<!DOCTYPE html><html><body><div id=root></div></body></html>",
    ],
    ["an empty answer", ""],
    ["JSON that names no build", JSON.stringify({ version: "14.0.90" })],
    ["a build id that is not a string", manifest(42)],
    ["an empty build id", manifest("   ")],
    ["a build id far too long to be one", manifest("x".repeat(201))],
    ["a JSON array", JSON.stringify([NEWER])],
    ["JSON null", "null"],
    ["a manifest cut short", '{"buildId":"14.0.90-def'],
  ])("%s is NoManifest, never a new build", async (_label: string, body) => {
    await expect(check(answering({ status: 200, body }))).resolves.toEqual({
      status: ServerBuildStatus.NoManifest,
      serverBuildId: null,
    });
  });

  test.each<number>([400, 401, 403, 404, 410])(
    "a %i answer is NoManifest: the server is there, the manifest is not",
    async (status: number) => {
      await expect(
        check(answering({ status, body: manifest(NEWER) })),
      ).resolves.toEqual({
        status: ServerBuildStatus.NoManifest,
        serverBuildId: null,
      });
    },
  );

  test.each<number>([408, 429, 500, 502, 503, 504])(
    "a %i answer is Unavailable: the server cannot serve right now",
    async (status: number) => {
      await expect(
        check(answering({ status, body: manifest(NEWER) })),
      ).resolves.toEqual({
        status: ServerBuildStatus.Unavailable,
        serverBuildId: null,
      });
    },
  );

  test("a request that fails (offline, refused) is Unreachable", async () => {
    const failing: FetchFunction = (): Promise<Response> => {
      return Promise.reject(new TypeError("Failed to fetch"));
    };

    await expect(check(failing)).resolves.toEqual({
      status: ServerBuildStatus.Unreachable,
      serverBuildId: null,
    });
  });

  test("a fetch that throws outright is Unreachable, not an exception", async () => {
    const throwing: FetchFunction = (): Promise<Response> => {
      throw new Error("fetch is broken");
    };

    await expect(check(throwing)).resolves.toEqual({
      status: ServerBuildStatus.Unreachable,
      serverBuildId: null,
    });
  });

  test("a body that breaks off is Unreachable", async () => {
    await expect(
      check(answering({ status: 200, bodyFails: true })),
    ).resolves.toEqual({
      status: ServerBuildStatus.Unreachable,
      serverBuildId: null,
    });
  });

  test("a server that never answers is Unreachable once the timeout passes, and the request is aborted", async () => {
    jest.useFakeTimers();

    try {
      let signal: AbortSignal | null = null;

      const hanging: FetchFunction = (
        _url: string,
        init?: RequestInit,
      ): Promise<Response> => {
        signal = init?.signal || null;
        return new Promise<Response>(() => {
          // Never answers.
        });
      };

      const result: Promise<ServerBuildCheckResult> = check(hanging, 5000);

      let settled: boolean = false;
      void result.then(() => {
        settled = true;
      });

      jest.advanceTimersByTime(4999);
      await flushMicrotasks();
      expect(settled).toBe(false);

      jest.advanceTimersByTime(1);
      await flushMicrotasks();
      expect(settled).toBe(true);

      await expect(result).resolves.toEqual({
        status: ServerBuildStatus.Unreachable,
        serverBuildId: null,
      });
      expect((signal as AbortSignal | null)?.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test("without a manifest address there is nothing to ask", async () => {
    const calls: Array<Call> = [];

    await expect(
      checkServerBuild({
        runningBuildId: RUNNING,
        manifestUrl: "",
        fetchFunction: answering({ status: 200, body: manifest(NEWER) }, calls),
      }),
    ).resolves.toEqual({
      status: ServerBuildStatus.Unreachable,
      serverBuildId: null,
    });
    expect(calls).toEqual([]);
  });

  test("uses the browser's fetch when none is handed in", async () => {
    const browserFetch: Mock<() => Promise<unknown>> = jest.fn(() => {
      return Promise.resolve({
        status: 200,
        ok: true,
        text: () => {
          return Promise.resolve(manifest(NEWER));
        },
      });
    });

    const original: typeof window.fetch = window.fetch;
    window.fetch = browserFetch as unknown as typeof window.fetch;

    try {
      await expect(
        checkServerBuild({ runningBuildId: RUNNING, manifestUrl: MANIFEST_URL }),
      ).resolves.toEqual({
        status: ServerBuildStatus.New,
        serverBuildId: NEWER,
      });
      expect(browserFetch).toHaveBeenCalledTimes(1);
      expect(browserFetch.mock.calls[0]![0]).toBe(MANIFEST_URL);
    } finally {
      window.fetch = original;
    }
  });
});

describe("readBuildIdFromManifest", () => {
  test("reads the build a manifest names", () => {
    expect(readBuildIdFromManifest(manifest(NEWER))).toBe(NEWER);
  });

  test("keeps the id exactly as written", () => {
    expect(readBuildIdFromManifest(manifest(" a b "))).toBe(" a b ");
  });

  test.each<[string, string]>([
    ["not JSON", "<html>"],
    ["a number", "12"],
    ["a string", JSON.stringify(NEWER)],
    ["an object without buildId", "{}"],
  ])("names no build for %s", (_label: string, text: string) => {
    expect(readBuildIdFromManifest(text)).toBeNull();
  });
});
