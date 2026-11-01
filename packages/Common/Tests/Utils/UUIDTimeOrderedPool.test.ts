import UUID, {
  RANDOM_BYTES_PER_TIME_ORDERED_ID,
  TIME_ORDERED_IDS_PER_RANDOM_DRAW,
} from "../../Utils/UUID";
import { SeededRandom, seededRandom } from "../Helpers/SeededRandom";
import {
  ComparedRuns,
  FastestRun,
  fastestRunsCompared,
} from "../Helpers/FastestRun";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * UUID.generateTimeOrdered stamps every ingested log, span and metric data
 * point, so it was rewritten for speed: its random bytes come from a block
 * drawn once per TIME_ORDERED_IDS_PER_RANDOM_DRAW ids, its hex from a table,
 * and its timestamp prefix is written once per millisecond. These tests hold
 * it to what it was:
 *
 *   - the id is byte for byte what master's implementation wrote for the same
 *     clock and the same random bytes (referenceTimeOrderedId below is that
 *     implementation, with its clock and its 16 random bytes passed in);
 *   - every random byte drawn goes into exactly one id, so ids stay unique
 *     and their random bits stay uniform;
 *   - Math.random still stands in where Web Crypto is missing;
 *   - and it is several times faster than master's.
 */

const UUID_V7_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const POOL_BYTES: number =
  RANDOM_BYTES_PER_TIME_ORDERED_ID * TIME_ORDERED_IDS_PER_RANDOM_DRAW;

/*
 * Master's UUID.generateTimeOrdered, verbatim, except that the 16 bytes it
 * drew from getRandomValues and the Date.now() it read are passed in.
 */
function referenceTimeOrderedId(randomBytes: Uint8Array, now: number): string {
  const bytes: Uint8Array = new Uint8Array(16);
  bytes.set(randomBytes);

  let timestamp: number = now;
  for (let i: number = 5; i >= 0; i--) {
    bytes[i] = timestamp % 256;
    timestamp = Math.floor(timestamp / 256);
  }

  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;

  const hex: string = Array.from(bytes, (b: number) => {
    return b.toString(16).padStart(2, "0");
  }).join("");

  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    hex.slice(12, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20, 32)
  );
}

/*
 * The 16 bytes master would have drawn for an id that took `randomBytes` as
 * its bytes 6..15 (bytes 0..5 are written over by the clock either way).
 */
function asMasterDraw(randomBytes: Uint8Array): Uint8Array {
  const bytes: Uint8Array = new Uint8Array(16);
  bytes.set(randomBytes, 6);
  return bytes;
}

interface RandomSourceRecorder {
  // Every block handed out, in order, as copies.
  draws: Array<Uint8Array>;
  restore: () => void;
}

/*
 * Stands in for crypto.getRandomValues: fills each block from a seeded
 * stream and keeps a copy, so a test knows exactly which bytes each id took.
 */
function recordRandomSource(random: SeededRandom): RandomSourceRecorder {
  const cryptoObj: Crypto = globalThis.crypto;
  const original: Crypto["getRandomValues"] =
    cryptoObj.getRandomValues.bind(cryptoObj);
  const draws: Array<Uint8Array> = [];

  Object.defineProperty(cryptoObj, "getRandomValues", {
    configurable: true,
    writable: true,
    value: <T extends ArrayBufferView | null>(array: T): T => {
      const bytes: Uint8Array = array as unknown as Uint8Array;
      for (let i: number = 0; i < bytes.length; i++) {
        bytes[i] = random(256);
      }
      draws.push(new Uint8Array(bytes));
      return array;
    },
  });

  return {
    draws: draws,
    restore: (): void => {
      Object.defineProperty(cryptoObj, "getRandomValues", {
        configurable: true,
        writable: true,
        value: original,
      });
    },
  };
}

/*
 * Makes ids until one of them starts a new block, and returns that id: the
 * first id of a block takes its bytes 0..9. The pool is shared by the whole
 * process, so a test aligns itself to a block before it reads the bytes.
 */
function generateUntilNewDraw(recorder: RandomSourceRecorder): string {
  const drawsBefore: number = recorder.draws.length;

  for (let i: number = 0; i <= TIME_ORDERED_IDS_PER_RANDOM_DRAW; i++) {
    const id: string = UUID.generateTimeOrdered();

    if (recorder.draws.length > drawsBefore) {
      return id;
    }
  }

  throw new Error("No new random block was drawn within one block of ids.");
}

function idBytesOfDraw(draw: Uint8Array, idIndex: number): Uint8Array {
  const start: number = idIndex * RANDOM_BYTES_PER_TIME_ORDERED_ID;
  return draw.slice(start, start + RANDOM_BYTES_PER_TIME_ORDERED_ID);
}

let restoreRandomSource: (() => void) | null = null;

afterEach(() => {
  if (restoreRandomSource) {
    restoreRandomSource();
    restoreRandomSource = null;
  }
  jest.restoreAllMocks();
});

describe("UUID.generateTimeOrdered: the same ids as before", () => {
  test("every id of two whole blocks is master's id for the same clock and bytes", () => {
    const recorder: RandomSourceRecorder = recordRandomSource(
      seededRandom(9562),
    );
    restoreRandomSource = recorder.restore;

    const now: number = Date.UTC(2026, 9, 17, 10, 11, 12, 345);
    jest.spyOn(Date, "now").mockReturnValue(now);

    const ids: Array<string> = [generateUntilNewDraw(recorder)];

    for (let i: number = 1; i < 2 * TIME_ORDERED_IDS_PER_RANDOM_DRAW; i++) {
      ids.push(UUID.generateTimeOrdered());
    }

    // The second block was drawn exactly when the first ran out.
    expect(recorder.draws).toHaveLength(2);

    for (let i: number = 0; i < ids.length; i++) {
      const draw: Uint8Array = recorder.draws[
        Math.floor(i / TIME_ORDERED_IDS_PER_RANDOM_DRAW)
      ] as Uint8Array;
      const bytes: Uint8Array = idBytesOfDraw(
        draw,
        i % TIME_ORDERED_IDS_PER_RANDOM_DRAW,
      );

      expect(ids[i]).toBe(referenceTimeOrderedId(asMasterDraw(bytes), now));
    }
  });

  test("a block holds exactly the random bytes of TIME_ORDERED_IDS_PER_RANDOM_DRAW ids, under getRandomValues' limit", () => {
    expect(RANDOM_BYTES_PER_TIME_ORDERED_ID).toBe(10);
    expect(POOL_BYTES).toBeLessThanOrEqual(65536);

    const recorder: RandomSourceRecorder = recordRandomSource(seededRandom(4));
    restoreRandomSource = recorder.restore;

    generateUntilNewDraw(recorder);

    expect(recorder.draws[0]).toHaveLength(POOL_BYTES);
  });

  test("the timestamp prefix is master's for every clock reading, the 48-bit wrap and odd values included", () => {
    const random: SeededRandom = seededRandom(48);
    const clocks: Array<number> = [
      0,
      1,
      255,
      256,
      65535,
      65536,
      2 ** 32 - 1,
      2 ** 32,
      2 ** 40 + 12345,
      2 ** 48 - 1,
      2 ** 48,
      2 ** 48 + 1,
      2 ** 52 + 3,
      Date.UTC(1970, 0, 1),
      Date.UTC(2026, 9, 17, 23, 59, 59, 999),
      Date.UTC(9999, 11, 31, 23, 59, 59, 999),
      1.5,
      -1,
      -256,
    ];

    for (let i: number = 0; i < 200; i++) {
      clocks.push(Math.floor(random() * 2 ** 48));
    }

    const recorder: RandomSourceRecorder = recordRandomSource(random);
    restoreRandomSource = recorder.restore;

    const nowSpy: { mockReturnValue: (value: number) => unknown } = jest.spyOn(
      Date,
      "now",
    ) as unknown as {
      mockReturnValue: (value: number) => unknown;
    };

    for (const clock of clocks) {
      nowSpy.mockReturnValue(clock);

      const id: string = UUID.generateTimeOrdered();
      const expectedPrefix: string = referenceTimeOrderedId(
        new Uint8Array(16),
        clock,
      ).slice(0, 13);

      expect(id.slice(0, 13)).toBe(expectedPrefix);
      expect(id).toMatch(UUID_V7_PATTERN);
    }
  });

  test("the prefix follows the clock from one millisecond to the next and back", () => {
    const recorder: RandomSourceRecorder = recordRandomSource(seededRandom(7));
    restoreRandomSource = recorder.restore;

    const nowSpy: { mockReturnValue: (value: number) => unknown } = jest.spyOn(
      Date,
      "now",
    ) as unknown as {
      mockReturnValue: (value: number) => unknown;
    };

    const first: number = Date.UTC(2026, 9, 17, 10, 0, 0, 0);
    const prefixOf: (clock: number) => string = (clock: number): string => {
      return referenceTimeOrderedId(new Uint8Array(16), clock).slice(0, 13);
    };

    for (const clock of [first, first + 1, first, first + 1000, first + 1]) {
      nowSpy.mockReturnValue(clock);
      expect(UUID.generateTimeOrdered().slice(0, 13)).toBe(prefixOf(clock));
      expect(UUID.generateTimeOrdered().slice(0, 13)).toBe(prefixOf(clock));
    }
  });

  test("ids made later sort after ids made earlier, as before", () => {
    const nowSpy: { mockReturnValue: (value: number) => unknown } = jest.spyOn(
      Date,
      "now",
    ) as unknown as {
      mockReturnValue: (value: number) => unknown;
    };

    let previous: string = "";
    const start: number = Date.UTC(2026, 0, 1);

    for (let i: number = 0; i < 2000; i++) {
      nowSpy.mockReturnValue(start + i * 7);
      const id: string = UUID.generateTimeOrdered();
      expect(id > previous).toBe(true);
      previous = id;
    }
  });
});

describe("UUID.generateTimeOrdered: randomness", () => {
  test("Web Crypto is asked once per block of ids, not once per id", () => {
    const recorder: RandomSourceRecorder = recordRandomSource(seededRandom(1));
    restoreRandomSource = recorder.restore;

    generateUntilNewDraw(recorder);

    for (let i: number = 1; i < 3 * TIME_ORDERED_IDS_PER_RANDOM_DRAW; i++) {
      UUID.generateTimeOrdered();
    }

    expect(recorder.draws).toHaveLength(3);
  });

  test("200,000 ids made in one millisecond are all different", () => {
    jest.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 9, 17));

    const seen: Set<string> = new Set<string>();

    for (let i: number = 0; i < 200000; i++) {
      seen.add(UUID.generateTimeOrdered());
    }

    expect(seen.size).toBe(200000);
  });

  test("each of the 74 random bits is set about half the time, and version and variant never change", () => {
    jest.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 9, 17));

    const samples: number = 100000;
    // Hex digits 12..31 of the id without hyphens are bytes 6..15.
    const setCounts: Array<number> = new Array<number>(80).fill(0);

    let malformed: number = 0;

    for (let i: number = 0; i < samples; i++) {
      const id: string = UUID.generateTimeOrdered();

      if (id[14] !== "7" || !"89ab".includes(id[19] as string)) {
        malformed++;
      }

      const hex: string = id.split("-").join("").slice(12);

      for (let digit: number = 0; digit < 20; digit++) {
        const value: number = parseInt(hex[digit] as string, 16);
        for (let bit: number = 0; bit < 4; bit++) {
          if ((value >> (3 - bit)) & 1) {
            const position: number = digit * 4 + bit;
            setCounts[position] = (setCounts[position] as number) + 1;
          }
        }
      }
    }

    expect(malformed).toBe(0);

    /*
     * Bits 0..3 are the version (always 0111) and bits 16..17 the variant
     * (always 10); the other 74 are random. 1% is over six standard
     * deviations of a fair bit over 100,000 draws.
     */
    for (let bit: number = 0; bit < 80; bit++) {
      const share: number = (setCounts[bit] as number) / samples;

      if (bit < 4) {
        expect(share).toBe(bit === 0 ? 0 : 1);
      } else if (bit === 16) {
        expect(share).toBe(1);
      } else if (bit === 17) {
        expect(share).toBe(0);
      } else {
        expect(Math.abs(share - 0.5)).toBeLessThan(0.01);
      }
    }
  });

  test("without Web Crypto, a block is filled from Math.random, as each id was before", () => {
    const originalCrypto: Crypto = globalThis.crypto;
    const recorder: RandomSourceRecorder = recordRandomSource(seededRandom(3));
    restoreRandomSource = recorder.restore;

    // Line the pool up so the next block starts with the next id.
    generateUntilNewDraw(recorder);
    for (let i: number = 1; i < TIME_ORDERED_IDS_PER_RANDOM_DRAW; i++) {
      UUID.generateTimeOrdered();
    }

    const mathRandom: { mock: { calls: Array<unknown> } } = jest.spyOn(
      Math,
      "random",
    ) as unknown as { mock: { calls: Array<unknown> } };

    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true,
    });

    try {
      const id: string = UUID.generateTimeOrdered();

      expect(id).toMatch(UUID_V7_PATTERN);
      expect(mathRandom.mock.calls).toHaveLength(POOL_BYTES);

      for (let i: number = 1; i < TIME_ORDERED_IDS_PER_RANDOM_DRAW; i++) {
        expect(UUID.generateTimeOrdered()).toMatch(UUID_V7_PATTERN);
      }

      // The rest of the block came from the same fill.
      expect(mathRandom.mock.calls).toHaveLength(POOL_BYTES);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: originalCrypto,
        configurable: true,
      });
    }

    // Web Crypto back: the next block is drawn from it again.
    generateUntilNewDraw(recorder);
    expect(recorder.draws).toHaveLength(2);
  });
});

describe("UUID.generateTimeOrdered: speed", () => {
  /*
   * Master's implementation as it ran: 16 bytes from Web Crypto per id, the
   * hex of every byte formatted on its own, the clock written every time.
   */
  function masterGenerateTimeOrdered(): string {
    const bytes: Uint8Array = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return referenceTimeOrderedId(bytes.slice(6, 16), Date.now());
  }

  test("100,000 ids take a small fraction of a second, and well under a third of master's time", () => {
    const count: number = 100000;

    // Timed in turns (fastestRunsCompared): one stall cannot slow one side alone.
    const runs: ComparedRuns<string, string> = fastestRunsCompared({
      first: (): string => {
        let last: string = "";
        for (let i: number = 0; i < count; i++) {
          last = UUID.generateTimeOrdered();
        }
        return last;
      },
      second: (): string => {
        let last: string = "";
        for (let i: number = 0; i < count; i++) {
          last = masterGenerateTimeOrdered();
        }
        return last;
      },
    });
    const branch: FastestRun<string> = runs.first;
    const master: FastestRun<string> = runs.second;

    expect(branch.result).toMatch(UUID_V7_PATTERN);
    expect(master.result).toMatch(UUID_V7_PATTERN);

    // About 0.1-0.3 microseconds an id here; the budget is far above it.
    expect(branch.inMs).toBeLessThan(1500);
    // Measured 15-35 times faster; a third leaves room for a noisy runner.
    expect(branch.inMs * 3).toBeLessThan(master.inMs);
  });
});
