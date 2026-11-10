import { describe, expect, it } from "@jest/globals";
import { SessionReplayChunkManifestEntry } from "../../../Types/Rum/SessionReplay";
import {
  composedValue,
  createTranslator,
  Translator,
} from "../../../Types/Translator";
import ChunkLoader, {
  ChunkLoadError,
  ReplayWordedError,
  SessionReplayChunkFetcher,
  getReplayErrorWording,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ChunkLoader";

/*
 * What the chunk loader says when footage cannot be fetched, in the
 * reader's language (#6369). Its ChunkLoadError keeps the English message
 * the engine, the tests and the diagnostic read, and carries the same
 * sentence as a wording the player composes with the reader's translator:
 * one whole sentence for each way of naming what was asked for, a plural
 * on the attempts, and the reason in the sentence's language - a deadline
 * that passed, the player's own failure (ReplayWordedError), or a
 * server's words quoted as they were written.
 */

const MARKING: Translator = createTranslator((text: string): string => {
  return `⟦${text}⟧`;
}, "de");

const CHUNK_MS: number = 15000;

function makeEntry(chunkIndex: number): SessionReplayChunkManifestEntry {
  return {
    chunkIndex: chunkIndex,
    tabId: "tab-1",
    chunkStartOffsetMs: chunkIndex * CHUNK_MS,
    chunkEndOffsetMs: (chunkIndex + 1) * CHUNK_MS,
    eventCount: 10,
    hasFullSnapshot: chunkIndex === 0,
    payloadBytes: 4096,
    errorCount: 0,
    rageClickCount: 0,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    routeCount: 0,
  };
}

// The player's own failure, as its chunk transport throws it.
function playerFailure(status: number): ReplayWordedError {
  return new ReplayWordedError(
    composedValue((translator: Translator): string => {
      return translator.translateTemplate(
        "Could not load recording data (HTTP {{status}}).",
        { status: status },
      );
    }),
  );
}

async function failOnce(
  fetcher: SessionReplayChunkFetcher,
  retryDelaysMs: Array<number>,
): Promise<ChunkLoadError> {
  const loader: ChunkLoader = new ChunkLoader({
    sessionId: "sess-1",
    tabId: "tab-1",
    entries: [makeEntry(0)],
    fetchTimeoutMs: 5,
    fetchMinBytesPerSecond: Infinity,
    retryDelaysMs: retryDelaysMs,
    fetcher: fetcher,
  });

  try {
    await loader.ensureChunk(0);
  } catch (err) {
    if (err instanceof ChunkLoadError) {
      return err;
    }

    throw err;
  }

  throw new Error("The fetch was expected to fail.");
}

describe("ChunkLoadError in the reader's language", () => {
  it("words a failed fetch as one sentence, quoting the player's own failure in its language", async () => {
    const error: ChunkLoadError = await failOnce((): Promise<ArrayBuffer> => {
      return Promise.reject(playerFailure(503));
    }, [1, 1]);

    expect(error.message).toBe(
      "Could not fetch chunk 0 after 3 attempts (Could not load recording data (HTTP 503).).",
    );
    expect(error.wording.compose(MARKING)).toBe(
      "⟦Could not fetch chunk 0 after 3 attempts (⟦Could not load recording data (HTTP 503).⟧).⟧",
    );
  });

  it("quotes a server's own words as they were written", async () => {
    const error: ChunkLoadError = await failOnce((): Promise<ArrayBuffer> => {
      return Promise.reject(new Error("upstream reset"));
    }, [1, 1]);

    expect(error.wording.compose(MARKING)).toBe(
      "⟦Could not fetch chunk 0 after 3 attempts (upstream reset).⟧",
    );
  });

  it("words a failure that said nothing", async () => {
    const error: ChunkLoadError = await failOnce((): Promise<ArrayBuffer> => {
      return Promise.reject(new Error(""));
    }, [1, 1]);

    expect(error.message).toBe(
      "Could not fetch chunk 0 after 3 attempts (the request failed).",
    );
    expect(error.wording.compose(MARKING)).toBe(
      "⟦Could not fetch chunk 0 after 3 attempts (⟦the request failed⟧).⟧",
    );
  });

  it("words a deadline that passed, with its seconds in place", async () => {
    const error: ChunkLoadError = await failOnce((): Promise<ArrayBuffer> => {
      return new Promise<ArrayBuffer>((): void => {
        // Never resolves: the deadline ends it.
      });
    }, [1, 1]);

    expect(error.isTimeout).toBe(true);
    expect(error.wording.compose(MARKING)).toBe(
      "⟦Could not fetch chunk 0 after 3 attempts (⟦no response within 0s⟧).⟧",
    );
  });

  /*
   * One attempt used to read "after 1 attempts": the count is the whole
   * sentence's plural now.
   */
  it("says one attempt in the singular", async () => {
    const error: ChunkLoadError = await failOnce((): Promise<ArrayBuffer> => {
      return Promise.reject(new Error("upstream reset"));
    }, []);

    expect(error.attempts).toBe(1);
    expect(error.message).toBe(
      "Could not fetch chunk 0 after 1 attempt (upstream reset).",
    );
  });

  it("keeps a thrown-in message as its own wording", () => {
    const error: ChunkLoadError = new ChunkLoadError({
      message: "Footage did not arrive.",
      chunkIndexes: [2],
      attempts: 3,
      isAborted: false,
      isTimeout: true,
    });

    expect(error.wording.compose(MARKING)).toBe("Footage did not arrive.");
  });
});

describe("getReplayErrorWording", () => {
  it("gives the wording of a failure in the player's words, and any other failure's message as written", () => {
    const worded: ReplayWordedError = playerFailure(500);

    expect(worded.message).toBe("Could not load recording data (HTTP 500).");
    expect(getReplayErrorWording(worded)).toBe(worded.wording);
    expect(getReplayErrorWording(new Error("socket hang up"))).toBe(
      "socket hang up",
    );
    expect(getReplayErrorWording(new Error(""))).toBeNull();
    expect(getReplayErrorWording("refused")).toBeNull();
  });
});
