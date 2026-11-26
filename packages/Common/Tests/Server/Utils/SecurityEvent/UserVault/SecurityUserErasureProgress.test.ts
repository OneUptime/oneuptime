import {
  SecurityUserErasureProgress,
  getEmptyErasureProgress,
  getEventsUnnamed,
  readErasureProgress,
  toStoredErasureProgress,
} from "../../../../../Server/Utils/SecurityEvent/UserVault/SecurityUserErasureProgress";
import { describe, expect, test } from "@jest/globals";

/*
 * WHERE AN ERASURE HAS GOT TO (#11160), as the request keeps it between
 * runs: read back exactly as kept, and whatever else the column holds read
 * as nothing kept - so a part of the erasure starts again, which changes
 * nothing it changed before.
 */

const KEPT: SecurityUserErasureProgress = {
  toldAt: "2026-11-26T10:02:00.000Z",
  namedEvents: 12,
  cleanSince: "2026-11-26T10:03:00.000Z",
  unnamedFindings: 40,
  findings: {
    number: 2,
    startedAt: "2026-11-26T10:20:00.000Z",
    after: { time: "1764151200000000123", id: "finding-7" },
    changed: 3,
    unnamed: 1,
    isFinal: true,
    endedAt: null,
  },
};

describe("readErasureProgress", () => {
  test("reads back what was kept, through the JSON the column stores", () => {
    expect(
      readErasureProgress(
        JSON.parse(JSON.stringify(toStoredErasureProgress(KEPT))),
      ),
    ).toEqual(KEPT);
  });

  test.each([[null], [undefined], [""], ["progress"], [12], [[]], [true]])(
    "reads %p as nothing kept",
    (value: unknown) => {
      expect(readErasureProgress(value)).toEqual(getEmptyErasureProgress());
    },
  );

  test("a pass with no start reads as none", () => {
    expect(
      readErasureProgress({ ...KEPT, findings: { number: 1 } }).findings,
    ).toBeNull();
  });

  test("a cursor that is not a finding's time and id reads as the start", () => {
    for (const after of [
      { time: "soon", id: "finding-7" },
      { time: "1764151200000000123", id: "" },
      // A number, as a JSON reader would hand one back: not the text a time is kept as.
      { time: Number("1764151200000000123"), id: "finding-7" },
      { time: "1764151200000000123" },
      "finding-7",
    ]) {
      expect(
        readErasureProgress({
          ...KEPT,
          findings: { ...KEPT.findings, after },
        }).findings?.after,
      ).toBeNull();
    }
  });

  test("counts that are not counts read as none, times that are not times as unset", () => {
    expect(
      readErasureProgress({
        toldAt: "not a time",
        namedEvents: -3,
        cleanSince: 7,
        unnamedFindings: "many",
        findings: {
          number: 0,
          startedAt: "2026-11-26T10:20:00.000Z",
          changed: Number.NaN,
          unnamed: 2.7,
          isFinal: "yes",
          endedAt: "never",
        },
      }),
    ).toEqual({
      toldAt: null,
      namedEvents: 0,
      cleanSince: null,
      unnamedFindings: 0,
      findings: {
        number: 1,
        startedAt: "2026-11-26T10:20:00.000Z",
        after: null,
        changed: 0,
        unnamed: 2,
        isFinal: false,
        endedAt: null,
      },
    });
  });
});

describe("getEventsUnnamed", () => {
  test("the events a tell counted, and the most findings one pass un-named", () => {
    expect(getEventsUnnamed(KEPT)).toBe(12 + 40);
    expect(
      getEventsUnnamed({
        ...KEPT,
        unnamedFindings: 0,
        findings: { ...KEPT.findings!, unnamed: 9 },
      }),
    ).toBe(12 + 9);
  });

  test("never adds passes up: a later pass reads the same findings again", () => {
    expect(
      getEventsUnnamed({
        ...KEPT,
        unnamedFindings: 40,
        findings: { ...KEPT.findings!, unnamed: 30 },
      }),
    ).toBe(12 + 40);
  });

  test("none for nothing done", () => {
    expect(getEventsUnnamed(getEmptyErasureProgress())).toBe(0);
  });
});
