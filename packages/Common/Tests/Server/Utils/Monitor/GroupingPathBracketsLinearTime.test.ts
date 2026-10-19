import IncomingRequestIncidentGrouping from "../../../../Server/Utils/Monitor/IncomingRequestIncidentGrouping";
import { patternWith } from "../../../Helpers/SourcePatterns";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A GROUPING PATH'S BRACKETED PARTS ARE READ ONCE.
 *
 * An incoming request monitor groups what it receives by a JSON path a
 * project wrote, and names the group after the path's last named segment:
 * "alerts[*].labels.alertname" -> "alertname". The bracketed parts came off
 * with /\[[^\]]*\]/g, which looked for the "]" from every "[" of a run that
 * has none after it, each try reading on to the end of the path: a long
 * path took time that grows with the square of its length, on every request
 * the monitor received. A "[" with no "]" after it now takes the rest of
 * the path in the same match and gives it back as written.
 * ---------------------------------------------------------------------------
 */

const GROUPING_FILE: string =
  "packages/Common/Server/Utils/Monitor/IncomingRequestIncidentGrouping.ts";

const LENGTH: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

const timeOf: (run: () => unknown) => number = (run: () => unknown): number => {
  const startedAt: number = Date.now();
  run();
  return Date.now() - startedAt;
};

// The pattern as it was: the reference the one the product runs must agree with.
const BRACKETED_PART_BEFORE: RegExp = /\[[^\]]*\]/g;

// The pattern the product runs: a bracketed part, or an unclosed one.
const BRACKETED_PART_NOW: RegExp = patternWith(GROUPING_FILE, "(\\])?");

// What the product does with it: the part off, an unclosed one as written.
const withoutBracketedParts: (path: string) => string = (
  path: string,
): string => {
  return path.replace(
    BRACKETED_PART_NOW,
    (part: string, closing: string | undefined): string => {
      return closing === undefined ? part : "";
    },
  );
};

describe("a path built to be slow is read quickly", () => {
  test.each([
    ["a run of opening brackets", "requestBody." + repeat("[", LENGTH)],
    ["opening brackets and names", "requestBody." + repeat("[a.", LENGTH)],
    [
      "a closed part, then opening brackets",
      "requestBody.alerts[0]." + repeat("[", LENGTH),
    ],
  ])("%s, grouping a request", (_label: string, path: string) => {
    expect(
      timeOf(() => {
        IncomingRequestIncidentGrouping.extractItems({
          requestBody: { alerts: [{ labels: { alertname: "Disk full" } }] },
          grouping: { groupByJSONPath: path },
        } as unknown as Parameters<
          typeof IncomingRequestIncidentGrouping.extractItems
        >[0]);
      }),
    ).toBeLessThan(2000);
  });
});

describe("the parts taken off are the parts the pattern took off", () => {
  test("on forty thousand drawn paths", () => {
    const differences: Array<string> = [];

    for (const path of generatedTexts(
      40000,
      7717,
      ["[", "]", "*", "[*]", "a", ".", "0", "'b'", "x", "[0]"],
      12,
    )) {
      if (
        withoutBracketedParts(path) !==
        path.replace(new RegExp(BRACKETED_PART_BEFORE.source, "g"), "")
      ) {
        differences.push(JSON.stringify(path));
      }
    }

    expect(differences).toEqual([]);
  });

  test("a group is still named after the path's last named segment", () => {
    const items: ReturnType<typeof IncomingRequestIncidentGrouping.extractItems> =
      IncomingRequestIncidentGrouping.extractItems({
        requestBody: {
          alerts: [
            { labels: { alertname: "Disk full" } },
            { labels: { alertname: "CPU high" } },
          ],
        },
        grouping: {
          groupByJSONPath: "requestBody.alerts[*].labels.alertname",
        },
      } as unknown as Parameters<
        typeof IncomingRequestIncidentGrouping.extractItems
      >[0]);

    expect(
      items.map((item: { labels: Record<string, unknown> }) => {
        return item.labels;
      }),
    ).toEqual([{ alertname: "Disk full" }, { alertname: "CPU high" }]);
  });
});
