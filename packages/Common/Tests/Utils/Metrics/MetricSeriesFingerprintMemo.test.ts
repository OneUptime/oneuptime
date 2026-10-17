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

  test("the memo never holds more than FINGERPRINT_MEMO_MAX_ENTRIES label sets, and lets the oldest go first", () => {
    for (let i: number = 0; i < FINGERPRINT_MEMO_MAX_ENTRIES + 500; i++) {
      MetricSeriesFingerprint.computeFingerprint({ "host.name": `bound-${i}` });
    }

    expect(MetricSeriesFingerprint.getMemoSize()).toBe(
      FINGERPRINT_MEMO_MAX_ENTRIES,
    );

    const hashes: HashSpy = spyOnHashes();

    // The newest are still kept...
    MetricSeriesFingerprint.computeFingerprint({
      "host.name": `bound-${FINGERPRINT_MEMO_MAX_ENTRIES + 499}`,
    });
    expect(hashes.mock.calls).toHaveLength(0);

    // ...the oldest were let go, and come back with the same fingerprint.
    const first: string = MetricSeriesFingerprint.computeFingerprint({
      "host.name": "bound-0",
    });
    expect(hashes.mock.calls).toHaveLength(1);
    expect(first).toBe(referenceFingerprint({ "host.name": "bound-0" }));
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
