import { describe, expect, test } from "@jest/globals";
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
import {
  MODEL_TURN_STATE_KEY,
  readModelResumeAt,
} from "../../../../Server/Utils/DataSecurity/Model/ModelTurns";
import { JSONObject } from "../../../../Types/JSON";

/*
 * A PROBE'S DATABASE TAKES TURNS AT THE MODEL'S TIME TOO (#10928).
 *
 * A database only a probe reaches keeps no state on the probe: the server
 * hands the probe, with its work, the table the store's last scan's model
 * stopped at, and keeps the one this scan's stopped at from the probe's
 * report - a table's name, and nothing else a probe could put in a store's
 * state. A server or a probe of a release before the turns says nothing of
 * them, and its scan starts at the first table, as it always did.
 */

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
    findNamesAndAddresses: true,
    ...extra,
  };
}

function report(extra: JSONObject = {}): JSONObject {
  return {
    locations: [],
    readLog: ["public.orders"],
    objectsRead: 1,
    rowsRead: 10,
    bytesRead: 100,
    warnings: [],
    fingerprints: {},
    plaintextPasswordFields: [],
    isComplete: true,
    ...extra,
  };
}

function isKnown(): boolean {
  return true;
}

describe("the work a probe is handed", () => {
  test("names the table the model's turn starts at, and the probe's scan starts there", () => {
    const read: DataSecurityProbeStoreWork = readProbeStoreWork(
      work({ modelResumeAt: "public.orders" }),
    )!;

    expect(read.modelResumeAt).toBe("public.orders");

    const options: ContentScanOptions = buildProbeScanOptions(read);

    expect(readModelResumeAt(options.previousState)).toBe("public.orders");
  });

  test("from a server before the turns, nothing: the scan starts at the first table", () => {
    const read: DataSecurityProbeStoreWork = readProbeStoreWork(work())!;

    expect(read.modelResumeAt).toBeUndefined();
    expect(
      readModelResumeAt(buildProbeScanOptions(read).previousState),
    ).toBeNull();
  });

  test("anything but a table's name is no turn", () => {
    for (const modelResumeAt of [42, "", ["public.orders"], "x".repeat(600)]) {
      expect(
        readProbeStoreWork(work({ modelResumeAt } as JSONObject))!
          .modelResumeAt,
      ).toBeUndefined();
    }
  });
});

describe("what the server keeps of a probe's report", () => {
  test("the table the next scan's model starts at", () => {
    const result: ContentScanResult | null = readProbeScanResult(
      report({
        nextState: { [MODEL_TURN_STATE_KEY]: { resumeAt: "public.tickets" } },
      }),
      isKnown,
    );

    expect(result?.nextState).toEqual({
      [MODEL_TURN_STATE_KEY]: { resumeAt: "public.tickets" },
    });
  });

  test("nothing else a probe puts in its state", () => {
    const result: ContentScanResult | null = readProbeScanResult(
      report({
        nextState: {
          [MODEL_TURN_STATE_KEY]: { resumeAt: "public.tickets", extra: "x" },
          etags: { "a.csv": { etag: "1" } },
          plaintextPasswordFields: ["users.password"],
          anything: "Maria Gonzalez",
        },
      }),
      isKnown,
    );

    expect(result?.nextState).toEqual({
      [MODEL_TURN_STATE_KEY]: { resumeAt: "public.tickets" },
    });
  });

  test("a report from a probe before the turns, or with no turn left, keeps none", () => {
    for (const nextState of [
      undefined,
      {},
      { [MODEL_TURN_STATE_KEY]: {} },
      { [MODEL_TURN_STATE_KEY]: { resumeAt: 7 } },
      "public.tickets",
    ]) {
      const result: ContentScanResult | null = readProbeScanResult(
        report(nextState === undefined ? {} : ({ nextState } as JSONObject)),
        isKnown,
      );

      expect(result).not.toBeNull();
      expect(result!.nextState).toBeUndefined();
    }
  });
});
