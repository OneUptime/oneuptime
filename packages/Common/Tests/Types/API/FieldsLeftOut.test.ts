import FieldsLeftOut, {
  FIELDS_LEFT_OUT_HEADER,
} from "../../../Types/API/FieldsLeftOut";
import { describe, expect, test } from "@jest/globals";

/*
 * The header a create answers with the fields it left out because only
 * OneUptime writes them (#10136), and the note the CLI and the MCP server
 * show for it.
 */

describe("the header", () => {
  test("is X-OneUptime-Fields-Left-Out", () => {
    expect(FIELDS_LEFT_OUT_HEADER).toBe("X-OneUptime-Fields-Left-Out");
  });

  test("names each field once, in order, joined by a comma", () => {
    expect(
      FieldsLeftOut.toHeaderValue([
        "sendNextReportBy",
        "lastRollupAt",
        "sendNextReportBy",
      ]),
    ).toBe("sendNextReportBy, lastRollupAt");
    expect(FieldsLeftOut.toHeaderValue([])).toBe("");
  });

  test("is read back as the fields it names", () => {
    expect(
      FieldsLeftOut.fromHeaderValue("sendNextReportBy, lastRollupAt"),
    ).toEqual(["sendNextReportBy", "lastRollupAt"]);
    expect(FieldsLeftOut.fromHeaderValue(" lastRollupAt ,,depth")).toEqual([
      "lastRollupAt",
      "depth",
    ]);
    // Node joins a header sent twice; a client may hand both.
    expect(FieldsLeftOut.fromHeaderValue(["depth", "depth, slug"])).toEqual([
      "depth",
      "slug",
    ]);
  });

  test("an answer without it, or with another value, names nothing", () => {
    expect(FieldsLeftOut.fromHeaderValue(undefined)).toEqual([]);
    expect(FieldsLeftOut.fromHeaderValue(null)).toEqual([]);
    expect(FieldsLeftOut.fromHeaderValue("")).toEqual([]);
    expect(FieldsLeftOut.fromHeaderValue(7)).toEqual([]);
  });

  test("is found among an answer's headers whatever the case of its name", () => {
    expect(
      FieldsLeftOut.fromHeaders({
        "content-type": "application/json",
        "x-oneuptime-fields-left-out": "lastRollupAt",
      }),
    ).toEqual(["lastRollupAt"]);
    expect(
      FieldsLeftOut.fromHeaders({ "X-OneUptime-Fields-Left-Out": "depth" }),
    ).toEqual(["depth"]);
    expect(FieldsLeftOut.fromHeaders({ "content-type": "text/plain" })).toEqual(
      [],
    );
    expect(FieldsLeftOut.fromHeaders(undefined)).toEqual([]);
  });
});

describe("the note a client shows", () => {
  test("one field", () => {
    expect(FieldsLeftOut.getNote(["lastRollupAt"])).toBe(
      "OneUptime left out lastRollupAt: only OneUptime writes it, so the new record has OneUptime's value.",
    );
  });

  test("several fields, each once", () => {
    expect(
      FieldsLeftOut.getNote([
        "createdByUserId",
        "depth",
        "lastRollupAt",
        "depth",
      ]),
    ).toBe(
      "OneUptime left out createdByUserId, depth and lastRollupAt: only OneUptime writes them, so the new record has OneUptime's values.",
    );
  });

  test("nothing left out, no note", () => {
    expect(FieldsLeftOut.getNote([])).toBeNull();
  });
});
