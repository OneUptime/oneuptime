import { createHash } from "crypto";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import MetricSeriesFingerprint, {
  MetricSeriesIdentity,
} from "../../../Utils/Metrics/MetricSeriesFingerprint";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A GROUPED READ'S ROWS, EACH SERIES READ ONCE (issue #10108).
 *
 * MetricSeriesFingerprint.createSeriesReader reads a row's series - its
 * labels and their fingerprint - from its values of the grouped keys, and
 * reads and hashes each series once however many rows it has. A fingerprint
 * keys open incidents and alerts, and the labels name them, so the reader
 * must give exactly what extractSeriesLabels and computeFingerprint gave for
 * every row: each test compares with them, and with master's fingerprint
 * written out, on the same rows.
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

function row(attributes: JSONObject | undefined): AggregatedModel {
  return {
    timestamp: new Date("2026-11-17T10:04:00.000Z"),
    value: 1,
    ...(attributes === undefined ? {} : { attributes: attributes }),
  } as unknown as AggregatedModel;
}

function expectAsBefore(input: {
  keys: Array<string>;
  sample: AggregatedModel;
  read: (sample: AggregatedModel) => MetricSeriesIdentity;
}): void {
  const labels: JSONObject = MetricSeriesFingerprint.extractSeriesLabels({
    sample: input.sample,
    attributeKeys: input.keys,
  });
  const identity: MetricSeriesIdentity = input.read(input.sample);

  expect(identity.labels).toEqual(labels);
  expect(identity.fingerprint).toBe(
    MetricSeriesFingerprint.computeFingerprint(labels),
  );
  expect(identity.fingerprint).toBe(referenceFingerprint(labels));
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MetricSeriesFingerprint.createSeriesReader", () => {
  const KEYS: Array<string> = ["resource.host.name", "resource.container.name"];

  test("reads a row's labels and fingerprint as extractSeriesLabels and computeFingerprint do", () => {
    const read: (sample: AggregatedModel) => MetricSeriesIdentity =
      MetricSeriesFingerprint.createSeriesReader(KEYS);

    const samples: Array<AggregatedModel> = [
      row({
        "resource.host.name": "docker-host-0001",
        "resource.container.name": "checkout-api-1",
      }),
      // A key it does not have, and one that is null.
      row({ "resource.host.name": "docker-host-0002" }),
      row({
        "resource.host.name": null,
        "resource.container.name": "worker",
      } as unknown as JSONObject),
      // No attributes at all.
      row(undefined),
      // Values that are not text.
      row({
        "resource.host.name": 42,
        "resource.container.name": true,
      } as unknown as JSONObject),
      // Text in every script, and the empty text.
      row({
        "resource.host.name": "хост-1 主机 🚀",
        "resource.container.name": "",
      }),
      // Attributes beyond the keys are not labels.
      row({
        "resource.host.name": "docker-host-0003",
        "resource.container.name": "nginx",
        "container.image.name": "nginx:1.27",
      }),
    ];

    for (const sample of samples) {
      expectAsBefore({ keys: KEYS, sample: sample, read: read });
    }
  });

  test("a series' later rows are its first's, and it is hashed once", () => {
    const computeFingerprint: jest.SpiedFunction<
      typeof MetricSeriesFingerprint.computeFingerprint
    > = jest.spyOn(MetricSeriesFingerprint, "computeFingerprint");
    const read: (sample: AggregatedModel) => MetricSeriesIdentity =
      MetricSeriesFingerprint.createSeriesReader(KEYS);

    const identities: Array<MetricSeriesIdentity> = [];

    // Ten series, a hundred rows each, every row its own objects.
    for (let rowIndex: number = 0; rowIndex < 1_000; rowIndex++) {
      identities.push(
        read(
          row({
            "resource.host.name": `host-${rowIndex % 10}`,
            "resource.container.name": `container-${rowIndex % 10}`,
          }),
        ),
      );
    }

    expect(computeFingerprint).toHaveBeenCalledTimes(10);
    expect(new Set<MetricSeriesIdentity>(identities).size).toBe(10);
    expect(identities[0]).toBe(identities[10]);
  });

  test("the order the keys are given in, and a key given twice, change nothing", () => {
    const sample: AggregatedModel = row({
      "resource.host.name": "docker-host-0001",
      "resource.container.name": "checkout-api-1",
    });

    const byOrder: MetricSeriesIdentity =
      MetricSeriesFingerprint.createSeriesReader(KEYS)(sample);
    const reversed: MetricSeriesIdentity =
      MetricSeriesFingerprint.createSeriesReader([...KEYS].reverse())(sample);
    const twice: MetricSeriesIdentity =
      MetricSeriesFingerprint.createSeriesReader([...KEYS, KEYS[0]!])(sample);

    expect(reversed.fingerprint).toBe(byOrder.fingerprint);
    expect(twice.fingerprint).toBe(byOrder.fingerprint);
    expectAsBefore({
      keys: [...KEYS, KEYS[0]!],
      sample: sample,
      read: MetricSeriesFingerprint.createSeriesReader([...KEYS, KEYS[0]!]),
    });
  });

  test("keys named as what every object inherits are labels like any other", () => {
    const keys: Array<string> = ["constructor", "__proto__", "toString"];
    const read: (sample: AggregatedModel) => MetricSeriesIdentity =
      MetricSeriesFingerprint.createSeriesReader(keys);

    const attributes: JSONObject = {};
    Object.defineProperty(attributes, "__proto__", {
      value: "proto-value",
      enumerable: true,
      configurable: true,
      writable: true,
    });
    attributes["constructor"] = "constructor-value";

    expectAsBefore({ keys: keys, sample: row(attributes), read: read });
    // A row without them reads the inherited ones as absent, as before.
    expectAsBefore({ keys: keys, sample: row({}), read: read });
  });

  test("a 1 and a '1' are one series, with the first row's labels, as before", () => {
    const read: (sample: AggregatedModel) => MetricSeriesIdentity =
      MetricSeriesFingerprint.createSeriesReader(["code"]);

    const first: MetricSeriesIdentity = read(
      row({ code: 1 } as unknown as JSONObject),
    );
    const second: MetricSeriesIdentity = read(row({ code: "1" }));

    expect(second.fingerprint).toBe(first.fingerprint);
    expect(first.fingerprint).toBe(referenceFingerprint({ code: "1" }));
  });

  test("values that join into the same text get the same fingerprint, as before", () => {
    // "a=x|b=y|b=z" either way: the canonical text computeFingerprint hashes.
    const read: (sample: AggregatedModel) => MetricSeriesIdentity =
      MetricSeriesFingerprint.createSeriesReader(["a", "b"]);

    const first: MetricSeriesIdentity = read(row({ a: "x|b=y", b: "z" }));
    const second: MetricSeriesIdentity = read(row({ a: "x", b: "y|b=z" }));

    expect(first.fingerprint).toBe(
      referenceFingerprint({ a: "x|b=y", b: "z" }),
    );
    expect(second.fingerprint).toBe(first.fingerprint);
    // Each with its own labels, as extractSeriesLabels reads them.
    expect(second.labels).toEqual({ a: "x", b: "y|b=z" });

    // And a key a row lacks is the empty text, not left out.
    expect(read(row({ a: "x|b=y" })).fingerprint).toBe(
      referenceFingerprint({ a: "x|b=y", b: "" }),
    );
  });

  test("with no keys, each row's labels are every column it has, read as before", () => {
    const read: (sample: AggregatedModel) => MetricSeriesIdentity =
      MetricSeriesFingerprint.createSeriesReader([]);

    const sample: AggregatedModel = {
      timestamp: new Date(),
      value: 3,
      service: "api",
      region: "eu",
    } as unknown as AggregatedModel;

    expectAsBefore({ keys: [], sample: sample, read: read });
  });

  test("5,000 random rows read as before", () => {
    const random: SeededRandom = seededRandom(10108);
    const read: (sample: AggregatedModel) => MetricSeriesIdentity =
      MetricSeriesFingerprint.createSeriesReader(KEYS);
    const values: Array<JSONValue> = ["", "a", "b|c", "d=e", 7, null, "😀"];

    for (let index: number = 0; index < 5_000; index++) {
      const attributes: JSONObject = {};

      for (const key of KEYS) {
        if (random(4) > 0) {
          attributes[key] = values[random(values.length)]!;
        }
      }

      expectAsBefore({ keys: KEYS, sample: row(attributes), read: read });
    }
  });
});
