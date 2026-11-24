import {
  buildProbeScanOptions,
  DataSecurityProbeStoreWork,
  readProbeScanResult,
  readProbeStoreWork,
} from "../../../../Server/Utils/DataSecurity/DataSecurityProbeScan";
import {
  ContentScanOptions,
  ContentScanResult,
} from "../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import { JSONObject } from "../../../../Types/JSON";
import { MAX_SHADOW_DETECTORS } from "../../../../Utils/DataSecurity/ShadowCount";
import { describe, expect, test } from "@jest/globals";

/*
 * A database only a customer's probe can reach is proven on as any other
 * store (#10371): the probe is handed the drafts being proven on it with
 * its work, runs them in shadow, and only their counts - of the drafts it
 * was handed - are kept from what it reports. A probe older than them
 * leaves them out, and its store is proven by the others of the group.
 */

const DRAFT_KEY: string = "00000000-0000-4000-8000-000000000001:AsDrafted";

function work(extra: JSONObject = {}): JSONObject {
  return {
    dataStoreId: "00000000-0000-4000-8000-0000000000aa",
    kind: "PostgreSQL",
    engine: "postgresql",
    probeConnectionVariable: "ORDERS_DB",
    limits: {},
    exclusions: [],
    customDataTypes: [],
    disabledDataTypeIds: [],
    allowedValues: [],
    fingerprintKey: "key",
    ...extra,
  };
}

describe("the work a probe is handed", () => {
  test("carries the drafts being proven on the store, and the probe runs them in shadow", () => {
    const read: DataSecurityProbeStoreWork = readProbeStoreWork(
      work({
        shadowDataTypes: [
          {
            key: DRAFT_KEY,
            definition: {
              pattern: "\\b[A-Z]{2}-?\\d{7}\\b",
              nameHints: ["policy no"],
            },
          },
        ],
      }),
    )!;

    expect(read.shadowDataTypes).toEqual([
      {
        key: DRAFT_KEY,
        definition: expect.objectContaining({
          pattern: "\\b[A-Z]{2}-?\\d{7}\\b",
          nameHints: ["policy no"],
        }),
      },
    ]);

    const options: ContentScanOptions = buildProbeScanOptions(read);

    expect(
      options.shadowDetectors!.map((detector: { key: string }) => {
        return detector.key;
      }),
    ).toEqual([DRAFT_KEY]);
    // Never one of the scan's own detectors: it finds nothing.
    expect(options.customDetectors).toEqual([]);
  });

  test("leaves out a draft that is not one: no key, no pattern, or more than a scan runs", () => {
    const read: DataSecurityProbeStoreWork = readProbeStoreWork(
      work({
        shadowDataTypes: [
          { key: "bad key", definition: { pattern: "x\\d" } },
          { key: "no-pattern", definition: {} },
          "not a draft",
          ...Array.from(
            { length: MAX_SHADOW_DETECTORS + 5 },
            (_value: unknown, index: number) => {
              return { key: `d${index}`, definition: { pattern: "\\d{9}" } };
            },
          ),
        ],
      }),
    )!;

    expect(read.shadowDataTypes!.length).toBeLessThanOrEqual(
      MAX_SHADOW_DETECTORS,
    );
    expect(
      read.shadowDataTypes!.some((draft: { key: string }) => {
        return draft.key === "bad key" || draft.key === "no-pattern";
      }),
    ).toBe(false);
  });

  test("an older server's work, with no drafts, scans as before", () => {
    const read: DataSecurityProbeStoreWork = readProbeStoreWork(work())!;

    expect(read.shadowDataTypes).toEqual([]);
    expect(buildProbeScanOptions(read).shadowDetectors).toEqual([]);
  });
});

describe("what a probe reports", () => {
  function report(shadowCounts: unknown): JSONObject {
    return {
      locations: [],
      readLog: [],
      objectsRead: 1,
      rowsRead: 10,
      bytesRead: 100,
      warnings: [],
      fingerprints: {},
      plaintextPasswordFields: [],
      isComplete: true,
      shadowCounts: shadowCounts as JSONObject,
    };
  }

  test("keeps the counts of the drafts it was handed, and no other", () => {
    const result: ContentScanResult = readProbeScanResult(
      report({
        [DRAFT_KEY]: {
          fields: 2,
          values: 20,
          matched: 10,
          matchedFields: {
            "public.policies.policy_no": { values: 10, matched: 10 },
          },
        },
        "00000000-0000-4000-8000-000000000009:AsDrafted": {
          fields: 1,
          values: 5,
          matched: 5,
          matchedFields: {},
        },
      }),
      (): boolean => {
        return true;
      },
      (key: string): boolean => {
        return key === DRAFT_KEY;
      },
    )!;

    expect(Object.keys(result.shadowCounts!)).toEqual([DRAFT_KEY]);
    expect(result.shadowCounts![DRAFT_KEY]!.matched).toBe(10);
  });

  test("keeps none by default, nor from a report with none", () => {
    expect(
      readProbeScanResult(
        report({
          [DRAFT_KEY]: { fields: 1, values: 1, matched: 1, matchedFields: {} },
        }),
        (): boolean => {
          return true;
        },
      )!.shadowCounts,
    ).toBeUndefined();
    expect(
      readProbeScanResult(report(undefined), (): boolean => {
        return true;
      })!.shadowCounts,
    ).toBeUndefined();
  });
});
