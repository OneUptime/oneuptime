import {
  HUNTRESS_MAX_WATCHED_ORGANIZATIONS,
  HUNTRESS_MAX_WATCHED_ORGANIZATION_LENGTH,
  getHuntressOrganizationFilterProblem,
  isHuntressOrganizationWatched,
  parseHuntressOrganizationFilter,
} from "../../../Types/Huntress/HuntressOrganizationFilter";
import { describe, expect, test } from "@jest/globals";

/*
 * Which of an MSP's Huntress organizations a connection opens incidents
 * for: all of them, or the ones listed by name or id, one per line.
 */
describe("parseHuntressOrganizationFilter", () => {
  test("one organization per line, trimmed, without blank lines", () => {
    expect(
      parseHuntressOrganizationFilter("  Acme Corp \n\n1234\r\n Globex  \n"),
    ).toEqual(["Acme Corp", "1234", "Globex"]);
  });

  test("names keep their commas: a comma does not split a line", () => {
    expect(parseHuntressOrganizationFilter("Smith, Jones & Co")).toEqual([
      "Smith, Jones & Co",
    ]);
  });

  test("repeats are dropped, case aside, keeping the first spelling", () => {
    expect(parseHuntressOrganizationFilter("Acme\nACME\nacme")).toEqual([
      "Acme",
    ]);
  });

  test("an empty filter names nothing", () => {
    expect(parseHuntressOrganizationFilter("")).toEqual([]);
    expect(parseHuntressOrganizationFilter(null)).toEqual([]);
    expect(parseHuntressOrganizationFilter(undefined)).toEqual([]);
    expect(parseHuntressOrganizationFilter(" \n \n")).toEqual([]);
  });
});

describe("getHuntressOrganizationFilterProblem", () => {
  test("a short list is fine", () => {
    expect(getHuntressOrganizationFilterProblem("Acme\n1234")).toBeNull();
    expect(getHuntressOrganizationFilterProblem(null)).toBeNull();
  });

  test(`more than ${HUNTRESS_MAX_WATCHED_ORGANIZATIONS} organizations are refused`, () => {
    const lines: Array<string> = [];

    for (
      let index: number = 0;
      index <= HUNTRESS_MAX_WATCHED_ORGANIZATIONS;
      index++
    ) {
      lines.push(`Org ${index}`);
    }

    expect(getHuntressOrganizationFilterProblem(lines.join("\n"))).toBe(
      `List at most ${HUNTRESS_MAX_WATCHED_ORGANIZATIONS} organizations, one per line.`,
    );
  });

  test("a line longer than an organization name is refused, quoting its start", () => {
    const line: string = "x".repeat(HUNTRESS_MAX_WATCHED_ORGANIZATION_LENGTH + 1);

    expect(getHuntressOrganizationFilterProblem(`Acme\n${line}`)).toBe(
      `"${"x".repeat(40)}…" is longer than an organization name can be (${HUNTRESS_MAX_WATCHED_ORGANIZATION_LENGTH} characters). Put each organization on a line of its own.`,
    );
  });
});

describe("isHuntressOrganizationWatched", () => {
  const acme: { id: string; name: string } = { id: "4", name: "Acme Corp" };

  test("an empty filter watches every organization, even a report naming none", () => {
    expect(
      isHuntressOrganizationWatched({ filter: [], organization: acme }),
    ).toBe(true);
    expect(
      isHuntressOrganizationWatched({
        filter: [],
        organization: { id: null, name: null },
      }),
    ).toBe(true);
  });

  test("an organization is watched by its name, in any case", () => {
    expect(
      isHuntressOrganizationWatched({
        filter: ["acme corp"],
        organization: acme,
      }),
    ).toBe(true);
    expect(
      isHuntressOrganizationWatched({
        filter: ["ACME CORP"],
        organization: { id: "4", name: " Acme Corp " },
      }),
    ).toBe(true);
  });

  test("an organization is watched by its id", () => {
    expect(
      isHuntressOrganizationWatched({ filter: ["4"], organization: acme }),
    ).toBe(true);
  });

  test("an organization the filter does not name is not watched", () => {
    expect(
      isHuntressOrganizationWatched({
        filter: ["Globex", "5"],
        organization: acme,
      }),
    ).toBe(false);
  });

  test("a part of a name is not a match", () => {
    expect(
      isHuntressOrganizationWatched({ filter: ["Acme"], organization: acme }),
    ).toBe(false);
    expect(
      isHuntressOrganizationWatched({ filter: ["44"], organization: acme }),
    ).toBe(false);
  });

  test("a report naming no organization is not watched by a filter that lists some", () => {
    expect(
      isHuntressOrganizationWatched({
        filter: ["Acme Corp"],
        organization: { id: null, name: null },
      }),
    ).toBe(false);
  });
});
