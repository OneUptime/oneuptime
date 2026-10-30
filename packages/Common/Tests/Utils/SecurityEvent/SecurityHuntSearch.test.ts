import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import Query from "../../../Types/BaseDatabase/Query";
import Search from "../../../Types/BaseDatabase/Search";
import ObjectID from "../../../Types/ObjectID";
import {
  SECURITY_HUNT_MESSAGES,
  securityHuntFiltersToMap,
} from "../../../Types/SecurityEvent/SecurityHunt";
import { FACET_EXCLUDE_KEY_PREFIX } from "../../../UI/Components/TelemetryViewer/FacetSelection";
import {
  SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX,
  SECURITY_EVENT_EXCLUDE_FACET_PREFIX,
  SECURITY_EVENT_FACET_COLUMNS,
  SECURITY_EVENT_SOURCE_FACET_KEY,
  applySecurityEventFacetFiltersToQuery,
  applySecurityEventSearchToQuery,
  buildSecurityEventSearchQuery,
  getSecurityEventAttributeKey,
  getSecurityEventBaseFacetKey,
  isSecurityEventChipKey,
  parseSecurityEventSearch,
  toSecurityEventExcludeFacetKey,
} from "../../../Utils/SecurityEvent/SecurityEventSearch";
import {
  buildSecurityHuntQuery,
  getSecurityHuntFiltersProblem,
} from "../../../Utils/SecurityEvent/SecurityHuntSearch";
import { describe, expect, test } from "@jest/globals";

/*
 * ONE COMPILE FOR THE EVENTS PAGE AND A HUNT'S SCHEDULED RUN.
 *
 * The Events page's search bar and sidebar chips, and a saved hunt's
 * search and chips, compile through the same shared module
 * (Utils/SecurityEvent/SecurityEventSearch), so a run on the server counts
 * exactly what the hunt's page lists. Its chips are the ones the sidebar
 * can make, checked before they are kept.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const START: Date = new Date("2026-10-28T12:00:00.000Z");
const END: Date = new Date("2026-10-29T12:00:00.000Z");

function chips(
  entries: Array<[string, Array<string>]>,
): Map<string, Set<string>> {
  return new Map<string, Set<string>>(
    entries.map(
      ([key, values]: [string, Array<string>]): [string, Set<string>] => {
        return [key, new Set<string>(values)];
      },
    ),
  );
}

describe("the chips' grammar", () => {
  test("marks an excluded chip on its key, with the shared sidebar's marker", () => {
    expect(SECURITY_EVENT_EXCLUDE_FACET_PREFIX).toBe(FACET_EXCLUDE_KEY_PREFIX);
    expect(toSecurityEventExcludeFacetKey("severityName")).toBe(
      "!severityName",
    );
    // Marked once, however often it is asked.
    expect(toSecurityEventExcludeFacetKey("!severityName")).toBe(
      "!severityName",
    );
    expect(getSecurityEventBaseFacetKey("!attributes.threat.matched")).toBe(
      "attributes.threat.matched",
    );
    expect(SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX).toBe("attributes.");
    expect(getSecurityEventAttributeKey("!attributes.threat.matched")).toBe(
      "threat.matched",
    );
  });

  test("a chip names a sidebar column or a source attribute with a key, included or excluded", () => {
    expect(SECURITY_EVENT_FACET_COLUMNS[0]).toBe(
      SECURITY_EVENT_SOURCE_FACET_KEY,
    );

    for (const column of SECURITY_EVENT_FACET_COLUMNS) {
      expect([column, isSecurityEventChipKey(column)]).toEqual([column, true]);
      expect([column, isSecurityEventChipKey(`!${column}`)]).toEqual([
        column,
        true,
      ]);
    }

    expect(isSecurityEventChipKey("attributes.threat.matched")).toBe(true);
    expect(isSecurityEventChipKey("!attributes.device.hostname")).toBe(true);
  });

  test("anything else is no chip: a column the sidebar has no section for, an attribute with no key", () => {
    for (const key of [
      "",
      "!",
      "attributes.",
      "!attributes.",
      "message",
      "projectId",
      "severity",
      "SeverityName",
      "attributes",
    ]) {
      expect([key, isSecurityEventChipKey(key)]).toEqual([key, false]);
    }
  });
});

describe("the search and the chips over a base query", () => {
  const base: Query<SecurityEvent> = {
    projectId: PROJECT_ID,
  } as Query<SecurityEvent>;

  test("is the search, then the chips - a chip on the same column is the one steered with", () => {
    const query: Record<string, unknown> = buildSecurityEventSearchQuery({
      base,
      search: "severity:Low powershell",
      filters: chips([["severityName", ["High"]]]),
    }) as Record<string, unknown>;

    expect(query["severityName"]).toBe("High");
    expect(query["message"]).toEqual(new Search("powershell"));
    expect(query["projectId"]).toBe(PROJECT_ID);
  });

  test("is what the page lays, step by step", () => {
    const search: string = "host:web-03 @threat.matched:true";
    const filters: Map<string, Set<string>> = chips([
      ["!statusName", ["Success"]],
      ["attributes.device.os", ["windows", "linux"]],
    ]);

    expect(buildSecurityEventSearchQuery({ base, search, filters })).toEqual(
      applySecurityEventFacetFiltersToQuery({
        query: applySecurityEventSearchToQuery({
          query: base,
          filters: parseSecurityEventSearch(search),
        }),
        filters,
      }),
    );
  });

  test("never writes into the caller's base query", () => {
    const own: Query<SecurityEvent> = {
      projectId: PROJECT_ID,
      attributes: { "tenant.id": "acme" },
    } as unknown as Query<SecurityEvent>;
    const copy: string = JSON.stringify(own);

    buildSecurityEventSearchQuery({
      base: own,
      search: "@device.os:linux severity:High",
      filters: chips([["attributes.threat.matched", ["true"]]]),
    });

    expect(JSON.stringify(own)).toBe(copy);
  });

  test("merges attribute chips with the attributes a search and the base already name", () => {
    const query: Record<string, unknown> = buildSecurityEventSearchQuery({
      base: {
        projectId: PROJECT_ID,
        attributes: { "tenant.id": "acme" },
      } as unknown as Query<SecurityEvent>,
      search: "@device.os:linux",
      filters: chips([["attributes.threat.matched", ["true"]]]),
    }) as Record<string, unknown>;

    expect(query["attributes"]).toEqual({
      "tenant.id": "acme",
      "device.os": "linux",
      "threat.matched": "true",
    });
  });

  test("compiles one value as an equality, several as IN, and excluded ones as not", () => {
    const query: Record<string, unknown> = buildSecurityEventSearchQuery({
      base,
      search: "",
      filters: chips([
        ["severityName", ["High", "Critical"]],
        ["!statusName", ["Success"]],
        ["!vendorName", ["Okta", "Linux"]],
        ["className", []],
      ]),
    }) as Record<string, unknown>;

    expect(query["severityName"]).toEqual(new Includes(["High", "Critical"]));
    expect(query["statusName"]).toEqual(new NotEqual("Success"));
    expect(query["vendorName"]).toEqual(new IncludesNone(["Okta", "Linux"]));
    // A chip with no values narrows nothing.
    expect(query).not.toHaveProperty("className");
  });
});

describe("what is wrong with a hunt's chips", () => {
  test("nothing, for chips the sidebar makes", () => {
    expect(getSecurityHuntFiltersProblem(undefined)).toBeNull();
    expect(getSecurityHuntFiltersProblem({})).toBeNull();
    expect(
      getSecurityHuntFiltersProblem({
        severityName: ["High"],
        "!statusName": ["Success"],
        "attributes.threat.matched": ["true"],
        primaryEntityId: ["3d000000-0000-4000-8000-000000000001"],
      }),
    ).toBeNull();
  });

  test("a key the Events sidebar cannot make - a column it has no section for, or none at all", () => {
    for (const key of ["projectId", "message", "attributes.", "severity"]) {
      expect([key, getSecurityHuntFiltersProblem({ [key]: ["x"] })]).toEqual([
        key,
        SECURITY_HUNT_MESSAGES.unknownFilter.message,
      ]);
    }
  });

  test("a value past 500 characters", () => {
    expect(
      getSecurityHuntFiltersProblem({ principalUser: ["u".repeat(500)] }),
    ).toBeNull();
    expect(
      getSecurityHuntFiltersProblem({ principalUser: ["u".repeat(501)] }),
    ).toBe(SECURITY_HUNT_MESSAGES.filterValueTooLong.message);
  });

  test("more than 50 values in all, across its keys", () => {
    const values: (count: number, prefix: string) => Array<string> = (
      count: number,
      prefix: string,
    ): Array<string> => {
      return Array.from({ length: count }, (_: unknown, index: number) => {
        return `${prefix}-${index}`;
      });
    };

    expect(
      getSecurityHuntFiltersProblem({
        principalHost: values(30, "host"),
        principalUser: values(20, "user"),
      }),
    ).toBeNull();
    expect(
      getSecurityHuntFiltersProblem({
        principalHost: values(30, "host"),
        principalUser: values(21, "user"),
      }),
    ).toBe(SECURITY_HUNT_MESSAGES.tooManyFilterValues.message);
  });

  test("reads the chips as kept first: repeated and empty values do not count", () => {
    expect(
      getSecurityHuntFiltersProblem({
        principalHost: Array.from({ length: 80 }, () => {
          return "web-03";
        }),
        projectId: [],
      }),
    ).toBeNull();
  });
});

describe("a hunt's read", () => {
  test("is the project, the window taking in both ends, the search and the chips", () => {
    const query: Record<string, unknown> = buildSecurityHuntQuery({
      projectId: PROJECT_ID,
      searchQuery: "processname:powershell.exe commandline:-enc",
      filters: { "!statusName": ["Failure"] },
      startTime: START,
      endTime: END,
    }) as Record<string, unknown>;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["time"]).toEqual(new InBetween<Date>(START, END));
    expect(query["processName"]).toBe("powershell.exe");
    expect(query["processCommandLine"]).toEqual(new Search("-enc"));
    expect(query["statusName"]).toEqual(new NotEqual("Failure"));
  });

  test("is exactly what the Events page compiles for the same search, chips and window", () => {
    const filters: { [key: string]: Array<string> } = {
      severityName: ["High", "Critical"],
      "attributes.threat.matched": ["true"],
    };
    const search: string = "user:svc-* -host:bastion-01";

    expect(
      buildSecurityHuntQuery({
        projectId: PROJECT_ID,
        searchQuery: search,
        filters,
        startTime: START,
        endTime: END,
      }),
    ).toEqual(
      buildSecurityEventSearchQuery({
        base: {
          projectId: PROJECT_ID,
          time: new InBetween<Date>(START, END),
        } as Query<SecurityEvent>,
        search,
        filters: securityHuntFiltersToMap(filters),
      }),
    );
  });

  test("with chips alone, narrows by them and nothing else", () => {
    const query: Record<string, unknown> = buildSecurityHuntQuery({
      projectId: PROJECT_ID,
      searchQuery: null,
      filters: { "attributes.threat.matched": ["true"] },
      startTime: START,
      endTime: END,
    }) as Record<string, unknown>;

    expect(Object.keys(query).sort()).toEqual(
      ["attributes", "projectId", "time"].sort(),
    );
    expect(query["attributes"]).toEqual({ "threat.matched": "true" });
  });
});
