import getUpdatedRowCount from "../../../../Server/Utils/Database/UpdatedRowCount";
import { describe, expect, test } from "@jest/globals";

/*
 * HOW MANY ROWS A RAW UPDATE WROTE, as the Postgres driver answers
 * `manager.query` of one: [rows, affected count]. FileService's one-off
 * statements count what they moved with it, and PublishedImages.
 * publishWhenShown makes an image public only when it says a row was
 * written - so anything else counts as nothing written.
 */
describe("getUpdatedRowCount", () => {
  test("reads the affected count of [rows, count]", () => {
    expect(getUpdatedRowCount([[{ _id: "a" }, { _id: "b" }], 2])).toBe(2);
    expect(getUpdatedRowCount([[], 0])).toBe(0);
    // An UPDATE without RETURNING: no rows, still a count.
    expect(getUpdatedRowCount([[], 7])).toBe(7);
  });

  test("anything else wrote nothing it can count", () => {
    for (const answer of [
      undefined,
      null,
      0,
      "1",
      {},
      { affected: 1 },
      [],
      // The rows alone: never taken as a count.
      [{ _id: "a" }],
      [[{ _id: "a" }]],
      // A count that is not a number.
      [[{ _id: "a" }], "1"],
      [[{ _id: "a" }], null],
    ]) {
      expect({ answer, count: getUpdatedRowCount(answer) }).toEqual({
        answer,
        count: 0,
      });
    }
  });
});
