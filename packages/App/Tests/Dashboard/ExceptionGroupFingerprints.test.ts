import {
  getGroupFingerprints,
  getMergedFingerprints,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionGroupFingerprints";
import { buildExceptionOccurrenceQuery } from "../../FeatureSet/Dashboard/src/Utils/ExceptionDetailData";
import { buildExceptionTrendRequest } from "../../FeatureSet/Dashboard/src/Utils/ExceptionDetailPresentation";
import { buildExceptionTrendZoomRequest } from "../../FeatureSet/Dashboard/src/Components/Exceptions/ExceptionTrendZoom";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import Includes from "Common/Types/BaseDatabase/Includes";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * An exception's page reads its occurrences by the fingerprints of its whole
 * group: its own, then those of the exceptions merged into it
 * (TelemetryExceptionMerge) - their occurrences keep their own fingerprint.
 * The trend chart, the latest occurrence and the occurrences table all read
 * the same list, and an exception nobody merged into reads exactly as before.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000001",
);

function member(fingerprint: string | undefined): TelemetryException {
  const row: TelemetryException = new TelemetryException();
  if (fingerprint !== undefined) {
    row.fingerprint = fingerprint;
  }
  return row;
}

describe("the fingerprints of the exceptions merged into one", () => {
  test("in the order read, without its own, repeats or blanks", () => {
    expect(
      getMergedFingerprints({
        fingerprint: "own",
        members: [
          member("b"),
          member("own"),
          member("b"),
          member(undefined),
          member(""),
          member("c"),
        ],
      }),
    ).toEqual(["b", "c"]);
  });

  test("nobody merged in: none", () => {
    expect(getMergedFingerprints({ fingerprint: "own", members: [] })).toEqual(
      [],
    );
  });

  test("the group: its own first", () => {
    expect(
      getGroupFingerprints({
        fingerprint: "own",
        mergedFingerprints: ["b", "own", "c"],
      }),
    ).toEqual(["own", "b", "c"]);
    expect(getGroupFingerprints({ fingerprint: "own" })).toEqual(["own"]);
  });
});

describe("the occurrence queries of the page", () => {
  test("nobody merged in: one fingerprint, exactly as before", () => {
    expect(
      buildExceptionOccurrenceQuery({
        projectId: PROJECT_ID,
        fingerprint: "own",
        primaryEntityId: SERVICE_ID,
      }),
    ).toEqual({
      projectId: PROJECT_ID,
      fingerprint: "own",
      primaryEntityId: SERVICE_ID,
    });
  });

  test("others merged in: any of the group's fingerprints, still in its service", () => {
    const query: Record<string, unknown> = buildExceptionOccurrenceQuery({
      projectId: PROJECT_ID,
      fingerprint: "own",
      mergedFingerprints: ["b", "c"],
      primaryEntityId: SERVICE_ID,
    }) as Record<string, unknown>;

    expect(query["fingerprint"]).toBeInstanceOf(Includes);
    expect((query["fingerprint"] as Includes).values).toEqual([
      "own",
      "b",
      "c",
    ]);
    expect(query["primaryEntityId"]).toBe(SERVICE_ID);
  });

  test("the trend chart reads the whole group, and a zoom keeps it", () => {
    const now: Date = new Date("2026-10-30T12:00:00.000Z");
    const request: JSONObject | null = buildExceptionTrendRequest({
      windowKey: "24h" as never,
      fingerprint: "own",
      mergedFingerprints: ["b"],
      primaryEntityId: SERVICE_ID,
      now,
    });

    expect(request!["fingerprints"]).toEqual(["own", "b"]);
    expect(request!["serviceIds"]).toEqual([SERVICE_ID.toString()]);

    const zoomed: JSONObject | null = buildExceptionTrendZoomRequest({
      windowKey: "24h" as never,
      fingerprint: "own",
      mergedFingerprints: ["b"],
      primaryEntityId: SERVICE_ID,
      zoomWindow: null,
      now,
    });

    expect(zoomed!["fingerprints"]).toEqual(["own", "b"]);
  });

  test("the trend chart of an exception nobody merged into reads its own fingerprint", () => {
    const request: JSONObject | null = buildExceptionTrendRequest({
      windowKey: "24h" as never,
      fingerprint: "own",
    });

    expect(request!["fingerprints"]).toEqual(["own"]);
  });
});
