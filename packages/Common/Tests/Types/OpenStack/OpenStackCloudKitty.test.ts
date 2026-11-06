import { describe, expect, test } from "@jest/globals";
import {
  addOpenStackCloudKittyRows,
  getOpenStackCloudKittyPeriods,
  readOpenStackCloudKittyReport,
  readOpenStackCloudKittySummary,
} from "../../../Types/OpenStack/OpenStackCloudKitty";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * HAND-CHECKED AGAINST CLOUDKITTY'S API REFERENCE. These rows are written to what the docs say its v2
 * summary and v1 report answer. What a real one answered is replayed through the probe's collector, in
 * Probe/Tests/Utils/OpenStack/OpenStackRatingCollection.test.ts.
 */

describe("CloudKitty's v2 summary, in its documented shapes", () => {
  test("a table, whose columns say which is which", () => {
    expect(
      readOpenStackCloudKittySummary({
        total: 2,
        columns: ["begin", "end", "qty", "rate", "project_id"],
        results: [
          [
            "2026-11-01T00:00:00+00:00",
            "2026-12-01T00:00:00+00:00",
            3.5533905029296875,
            1.7766952514648438,
            "84631866b2d84db49b29828052bf7b35",
          ],
          [
            "2026-11-01T00:00:00+00:00",
            "2026-12-01T00:00:00+00:00",
            7,
            "3.5",
            "fe9c35372db6420089883805b37a34af",
          ],
        ],
      }),
    ).toEqual({
      total: 2,
      rows: [
        {
          projectId: "84631866b2d84db49b29828052bf7b35",
          rate: 1.7766952514648438,
        },
        { projectId: "fe9c35372db6420089883805b37a34af", rate: 3.5 },
      ],
    });
  });

  test("the columns' order isn't promised", () => {
    expect(
      readOpenStackCloudKittySummary({
        total: 1,
        columns: ["project_id", "rate"],
        results: [["abc", 2]],
      }).rows,
    ).toEqual([{ projectId: "abc", rate: 2 }]);
  });

  test("response_format=object: each result says its own names", () => {
    expect(
      readOpenStackCloudKittySummary({
        total: 1,
        results: [{ project_id: "abc", rate: 2.5, qty: 1 }],
      }).rows,
    ).toEqual([{ projectId: "abc", rate: 2.5 }]);
  });

  test("a table with no column for what's needed has nothing to say", () => {
    expect(
      readOpenStackCloudKittySummary({
        total: 1,
        columns: ["begin", "qty"],
        results: [["x", 1]],
      }).rows,
    ).toEqual([]);
  });

  test("a rate of nothing is no rule having applied, and is left out", () => {
    expect(
      readOpenStackCloudKittySummary({
        columns: ["rate", "project_id"],
        results: [
          [0, "no-rule"],
          [-1, "below"],
          ["abc", "not-a-number"],
          [null, "no-rate"],
          ["", "empty-rate"],
          [1, "kept"],
        ],
      }).rows,
    ).toEqual([{ projectId: "kept", rate: 1 }]);
  });

  test.each([
    ["no project", [1, null]],
    ["an empty project", [1, ""]],
    ["a number for a project", [1, 7]],
    ["a project id longer than any Keystone gives", [1, "x".repeat(101)]],
    ["the word for all of them, which isn't a project", [1, "ALL"]],
  ])("%s is left out", (_name: string, row: Array<unknown>) => {
    expect(
      readOpenStackCloudKittySummary({
        columns: ["rate", "project_id"],
        results: [row],
      }).rows,
    ).toEqual([]);
  });

  test.each([
    [null],
    [undefined],
    ["text"],
    [42],
    [[]],
    [{}],
    [{ results: "x" }],
    [{ results: [null, 1, "x"], columns: ["rate", "project_id"] }],
    [{ results: [[]], columns: "rate" }],
  ])("%j reads as nothing, and doesn't throw", (answer: unknown) => {
    expect(readOpenStackCloudKittySummary(answer).rows).toEqual([]);
  });

  test("a total it doesn't say is what's here", () => {
    expect(
      readOpenStackCloudKittySummary({
        columns: ["rate", "project_id"],
        results: [[1, "a"]],
      }).total,
    ).toBe(1);
  });
});

describe("CloudKitty's v1 report, in its documented shape", () => {
  test("one row per project, and a rate in text", () => {
    expect(
      readOpenStackCloudKittyReport({
        summary: [
          {
            tenant_id: "abc",
            res_type: "ALL",
            rate: "1676.95",
            begin: "2026-11-01T00:00:00",
            end: "2026-12-01T00:00:00",
          },
        ],
      }),
    ).toEqual({
      total: null,
      rows: [{ projectId: "abc", rate: 1676.95 }],
    });
  });

  test("the total of everything isn't a project", () => {
    expect(
      readOpenStackCloudKittyReport({
        summary: [{ tenant_id: "ALL", rate: "1676.95" }],
      }).rows,
    ).toEqual([]);
  });

  test.each([
    [null],
    ["x"],
    [{}],
    [{ summary: "x" }],
    [{ summary: [null, 1] }],
  ])("%j reads as nothing", (answer: unknown) => {
    expect(readOpenStackCloudKittyReport(answer).rows).toEqual([]);
  });
});

describe("a project split across rows", () => {
  test("adds up to one figure", () => {
    expect(
      Array.from(
        addOpenStackCloudKittyRows([
          { projectId: "a", rate: 1 },
          { projectId: "a", rate: 2.5 },
          { projectId: "b", rate: 1 },
        ]).entries(),
      ),
    ).toEqual([
      ["a", 3.5],
      ["b", 1],
    ]);
  });
});

describe("what a read asks about", () => {
  test("this month and last, whole", () => {
    expect(
      getOpenStackCloudKittyPeriods(new Date("2026-11-15T10:00:00.000Z")),
    ).toEqual([
      {
        month: "2026-11",
        begin: "2026-11-01T00:00:00",
        end: "2026-12-01T00:00:00",
      },
      {
        month: "2026-10",
        begin: "2026-10-01T00:00:00",
        end: "2026-11-01T00:00:00",
      },
    ]);
  });

  test("January's last month is last year's December", () => {
    expect(
      getOpenStackCloudKittyPeriods(new Date("2027-01-02T00:00:00.000Z"))[1],
    ).toEqual({
      month: "2026-12",
      begin: "2026-12-01T00:00:00",
      end: "2027-01-01T00:00:00",
    });
  });
});

describe("what comes from outside can't hurt", () => {
  test("anything at all reads as rows or nothing, and every row it keeps is a rate above zero", () => {
    const random: SeededRandom = seededRandom(5748);
    const pieces: Array<string> = [
      "rate",
      "project_id",
      "ALL",
      "",
      "1",
      "-1",
      "NaN",
    ];

    for (const text of generatedTexts(500, 5748, pieces, 8)) {
      const value: unknown =
        random(3) === 0 ? text : random(3) === 1 ? Number(text) : [text];
      const page: ReturnType<typeof readOpenStackCloudKittySummary> =
        readOpenStackCloudKittySummary({
          columns: ["rate", "project_id"],
          results: [
            [value, text],
            [text, value],
            { rate: value, project_id: text },
          ],
        });

      for (const row of page.rows) {
        expect(row.rate).toBeGreaterThan(0);
        expect(row.projectId.length).toBeGreaterThan(0);
      }
    }
  });

  test("a very long answer is read in time with its length", () => {
    const results: Array<Array<unknown>> = [];

    for (let index: number = 0; index < 200000; index++) {
      results.push([1, `project-${index}`]);
    }

    const read: FastestRun<ReturnType<typeof readOpenStackCloudKittySummary>> =
      fastestRun({
        run: (): ReturnType<typeof readOpenStackCloudKittySummary> => {
          return readOpenStackCloudKittySummary({
            columns: ["rate", "project_id"],
            results,
          });
        },
        limitInMs: 2000,
      });

    expect(read.result.rows.length).toBe(200000);
    expect(read.inMs).toBeLessThan(2000);
  });
});
