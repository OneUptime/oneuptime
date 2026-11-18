/**
 * A grid group's rows and columns, as its axis values list them
 * (Utils/StatusPage/GridAxisValues).
 *
 * The public status page (GroupNestingLayout, the Overview) and the
 * Dashboard's Resources screen (ResourceExplorer) read them with the same
 * function, so the two agree on which grids have no rows or columns yet
 * (#9476). The public page reads it from a module of its own: reading it
 * from the Resources screen's model brought that model, and the group
 * hierarchy its navigator draws, into every status page's first load
 * (Tests/UI/StatusPageOverviewFirstLoadBuild.test.ts).
 */

import parseGridAxisValues from "../../../Utils/StatusPage/GridAxisValues";
import StatusPageResourceExplorerUtil from "../../../Utils/StatusPage/ResourceExplorer";
import { describe, expect, test } from "@jest/globals";

describe("parseGridAxisValues", () => {
  test("reads comma separated values, trimmed, in their order", () => {
    expect(parseGridAxisValues("US, EU ,APAC")).toEqual(["US", "EU", "APAC"]);
  });

  test("keeps the spaces inside a value", () => {
    expect(parseGridAxisValues("North America, South East Asia")).toEqual([
      "North America",
      "South East Asia",
    ]);
  });

  test("leaves out the empty values between commas", () => {
    expect(parseGridAxisValues(" Auth , API ,, ")).toEqual(["Auth", "API"]);
  });

  test.each([
    ["no value", undefined],
    ["null", null],
    ["an empty string", ""],
    ["only spaces", "   "],
    ["only commas and spaces", " , ,, "],
  ] as Array<[string, string | null | undefined]>)(
    "reads %s as no values",
    (_name: string, raw: string | null | undefined) => {
      expect(parseGridAxisValues(raw)).toEqual([]);
    },
  );

  test("reads them as the Dashboard's Resources screen does", () => {
    for (const raw of [
      "US, EU ,APAC",
      " Auth , API ,, ",
      " , ,, ",
      "",
      null,
      undefined,
    ]) {
      expect(StatusPageResourceExplorerUtil.parseAxisValues(raw)).toEqual(
        parseGridAxisValues(raw),
      );
    }
  });
});
