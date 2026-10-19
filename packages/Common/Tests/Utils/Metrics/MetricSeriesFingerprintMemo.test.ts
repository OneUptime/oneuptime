import crypto, { createHash } from "crypto";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import MetricSeriesFingerprint, {
  FINGERPRINT_MEMO_MAX_ENTRIES,
  FINGERPRINT_MEMO_MAX_TEXT_LENGTH,
} from "../../../Utils/Metrics/MetricSeriesFingerprint";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * MetricSeriesFingerprint.computeFingerprint now keeps the fingerprints of
 * label sets it saw lately, by their canonical text, because a grouped
 * metric monitor fingerprints all 10,000 raw rows of a read and SHA-256 was
 * nine tenths of that work. A fingerprint keys open incidents and alerts, so
 * it must not change by a single character: every test below compares with
 * master's function, verbatim, on the same labels.
 */

// Master's computeFingerprint, verbatim.
function referenceFingerprint(labels: JSONObject): string {
  const keys: Array<string> = Object.keys(labels || {}).sort();

  if (keys.length === 0) {
    return "__all__";
  }

  const parts: Array<string> = [];

  for (const key of keys) {
    const raw: JSONValue | undefined = labels[key];
    const value: string = raw === undefined || raw === null ? "" : String(raw);
    parts.push(`${key}=${value}`);
  }

  return createHash("sha256")
    .update(parts.join("|"))
    .digest("hex")
    .slice(0, 16);
}

type HashSpy = { mock: { calls: Array<unknown> } };

function spyOnHashes(): HashSpy {
  return jest.spyOn(crypto, "createHash") as unknown as HashSpy;
}

// Fills the memo to the brim with label sets no other test uses.
let fillerCount: number = 0;

function fillTheMemo(): void {
  while (MetricSeriesFingerprint.getMemoSize() < FINGERPRINT_MEMO_MAX_ENTRIES) {
    MetricSeriesFingerprint.computeFingerprint({
      "memo.filler": `filler-${fillerCount++}`,
    });
  }
}

/*
 * Leaves the memo holding one throwaway label set, through what it does
 * anyway: filled to the brim, the next new label set starts it over. The
 * memo is shared by the whole file, so a test that counts digests starts
 * from here.
 */
function emptyTheMemo(): void {
  fillTheMemo();
  MetricSeriesFingerprint.computeFingerprint({
    "memo.filler": `start-over-${fillerCount++}`,
  });
  expect(MetricSeriesFingerprint.getMemoSize()).toBe(1);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the same fingerprints as before", () => {
  test("20,000 seeded label sets, read in a random order with repeats", () => {
    const random: SeededRandom = seededRandom(1616);
    const labelSets: Array<JSONObject> = [];

    for (let i: number = 0; i < 2000; i++) {
      const labels: JSONObject = {};
      const keys: number = 1 + random(4);

      for (let k: number = 0; k < keys; k++) {
        const kind: number = random(10);
        const key: string = ["host.name", "k8s.pod.name", "a", "b|c", "x=y"][
          random(5)
        ] as string;

        labels[key] =
          kind === 0
            ? null
            : kind === 1
              ? random(1000)
              : kind === 2
                ? random(2) === 0
                : kind === 3
                  ? ""
                  : `value-${random(50)}${kind === 4 ? "|=" : ""}`;
      }

      labelSets.push(labels);
    }

    for (let i: number = 0; i < 20000; i++) {
      const labels: JSONObject = labelSets[random(labelSets.length)]!;
      const fingerprint: string =
        MetricSeriesFingerprint.computeFingerprint(labels);

      if (fingerprint !== referenceFingerprint(labels)) {
        throw new Error(
          `${JSON.stringify(labels)}: ${fingerprint} where master gave ${referenceFingerprint(labels)}`,
        );
      }
    }
  });

  test("the hash values the existing suite pins, read twice", () => {
    for (let round: number = 0; round < 2; round++) {
      expect(MetricSeriesFingerprint.computeFingerprint({ host: "web1" })).toBe(
        "5a9c211a2005a4bb",
      );
      expect(
        MetricSeriesFingerprint.computeFingerprint({ b: "2", a: "1" }),
      ).toBe("95a180ca2b5d1603");
      expect(MetricSeriesFingerprint.computeFingerprint({})).toBe("__all__");
    }
  });

  test("labels whose values print the same share a fingerprint, as before", () => {
    const pairs: Array<[JSONObject, JSONObject]> = [
      [{ port: 80 }, { port: "80" }],
      [{ up: true }, { up: "true" }],
      [{ host: null }, { host: "" }],
      [{ host: undefined as unknown as JSONValue }, { host: "" }],
    ];

    for (const [left, right] of pairs) {
      expect(MetricSeriesFingerprint.computeFingerprint(left)).toBe(
        MetricSeriesFingerprint.computeFingerprint(right),
      );
      expect(MetricSeriesFingerprint.computeFingerprint(left)).toBe(
        referenceFingerprint(left),
      );
    }
  });

  test("a label set's text past the memo's length limit is still fingerprinted exactly", () => {
    const long: JSONObject = {
      "log.message": "x".repeat(FINGERPRINT_MEMO_MAX_TEXT_LENGTH * 4),
    };

    expect(MetricSeriesFingerprint.computeFingerprint(long)).toBe(
      referenceFingerprint(long),
    );
    expect(MetricSeriesFingerprint.computeFingerprint(long)).toBe(
      referenceFingerprint(long),
    );
  });
});

describe("hashed once, kept within bounds", () => {
  test("a series read 100 times is hashed once", () => {
    const labels: JSONObject = { "host.name": "memo-once.example" };
    const hashes: HashSpy = spyOnHashes();

    for (let i: number = 0; i < 100; i++) {
      MetricSeriesFingerprint.computeFingerprint({ ...labels });
    }

    expect(hashes.mock.calls).toHaveLength(1);
  });

  test("a label set's text longer than the limit is never kept, so it is hashed every time", () => {
    const sizeBefore: number = MetricSeriesFingerprint.getMemoSize();
    const labels: JSONObject = {
      "log.message": "y".repeat(FINGERPRINT_MEMO_MAX_TEXT_LENGTH + 1),
    };
    const hashes: HashSpy = spyOnHashes();

    MetricSeriesFingerprint.computeFingerprint(labels);
    MetricSeriesFingerprint.computeFingerprint(labels);

    expect(hashes.mock.calls).toHaveLength(2);
    expect(MetricSeriesFingerprint.getMemoSize()).toBe(sizeBefore);
  });

  test("the memo never holds more than FINGERPRINT_MEMO_MAX_ENTRIES label sets: a full memo starts over", () => {
    const kept: JSONObject = { "host.name": "kept-before-the-brim" };
    const oneMore: JSONObject = { "host.name": "one-more" };
    const keptFingerprint: string = referenceFingerprint(kept);
    const oneMoreFingerprint: string = referenceFingerprint(oneMore);

    emptyTheMemo();
    MetricSeriesFingerprint.computeFingerprint(kept);
    fillTheMemo();

    expect(MetricSeriesFingerprint.getMemoSize()).toBe(
      FINGERPRINT_MEMO_MAX_ENTRIES,
    );

    const hashes: HashSpy = spyOnHashes();

    // A label set it already holds is read back; the memo stays full.
    expect(MetricSeriesFingerprint.computeFingerprint(kept)).toBe(
      keptFingerprint,
    );
    expect(hashes.mock.calls).toHaveLength(0);
    expect(MetricSeriesFingerprint.getMemoSize()).toBe(
      FINGERPRINT_MEMO_MAX_ENTRIES,
    );

    /*
     * A new one empties it first, rather than trimming the oldest entry one
     * at a time (a Map walks past the slots of deleted entries to find its
     * oldest, so that trimming slowed down with every row).
     */
    expect(MetricSeriesFingerprint.computeFingerprint(oneMore)).toBe(
      oneMoreFingerprint,
    );
    expect(hashes.mock.calls).toHaveLength(1);
    expect(MetricSeriesFingerprint.getMemoSize()).toBe(1);

    // What was let go comes back with the same fingerprint, hashed once more.
    expect(MetricSeriesFingerprint.computeFingerprint(kept)).toBe(
      keptFingerprint,
    );
    expect(hashes.mock.calls).toHaveLength(2);
    expect(MetricSeriesFingerprint.getMemoSize()).toBe(2);
  });

  test("more series than the memo holds, read round-robin, never cost more digests than master's one a row, with the same fingerprints", () => {
    const series: number = FINGERPRINT_MEMO_MAX_ENTRIES + 904;
    const rows: number = 2 * series + 1000;

    const labelsOf: (row: number) => JSONObject = (row: number): JSONObject => {
      return {
        "k8s.pod.name": `checkout-7c9d8f-${row % series}`,
        "k8s.namespace.name": "prod",
      };
    };

    // Master's fingerprint of every series, worked out before counting.
    const expected: Array<string> = [];
    for (let s: number = 0; s < series; s++) {
      expected.push(referenceFingerprint(labelsOf(s)));
    }

    const hashes: HashSpy = spyOnHashes();

    for (let i: number = 0; i < rows; i++) {
      const fingerprint: string = MetricSeriesFingerprint.computeFingerprint(
        labelsOf(i),
      );

      if (fingerprint !== expected[i % series]) {
        throw new Error(
          `row ${i}: ${fingerprint} where master gave ${expected[i % series]}`,
        );
      }

      if (
        MetricSeriesFingerprint.getMemoSize() > FINGERPRINT_MEMO_MAX_ENTRIES
      ) {
        throw new Error(
          `${MetricSeriesFingerprint.getMemoSize()} label sets kept after row ${i}`,
        );
      }
    }

    expect(hashes.mock.calls.length).toBeLessThanOrEqual(rows);
  });

  test("memory stays small: at most a few megabytes of label text", () => {
    // Keys and values together are bounded by the limits.
    expect(
      FINGERPRINT_MEMO_MAX_ENTRIES * (FINGERPRINT_MEMO_MAX_TEXT_LENGTH + 16),
    ).toBeLessThanOrEqual(4 * 1024 * 1024);
  });
});

describe("speed", () => {
  test("10,000 rows over 100 series: 100 digests instead of 10,000, well under a second", () => {
    const rows: Array<JSONObject> = [];

    for (let i: number = 0; i < 10000; i++) {
      rows.push({
        "k8s.pod.name": `checkout-7c9d8f-${i % 100}`,
        "k8s.namespace.name": "prod",
      });
    }

    emptyTheMemo();

    const hashes: HashSpy = spyOnHashes();

    const branch: FastestRun<number> = fastestRun({
      run: (): number => {
        let length: number = 0;
        for (const labels of rows) {
          length += MetricSeriesFingerprint.computeFingerprint(labels).length;
        }
        return length;
      },
      limitInMs: 0,
    });

    // One SHA-256 per series over all three runs; master took 30,000.
    expect(hashes.mock.calls).toHaveLength(100);

    jest.restoreAllMocks();

    let masterLength: number = 0;
    for (const labels of rows) {
      masterLength += referenceFingerprint(labels).length;
    }

    expect(branch.result).toBe(masterLength);
    // About 2-6 ms here (master: about 14 ms); the budget is far above.
    expect(branch.inMs).toBeLessThan(1000);
  });
});
