import { describe, expect, test } from "@jest/globals";
import type {
  LockedFilterDetail,
  LockedFilterScopeMatch,
} from "Common/Types/Telemetry/LockedFilterDetail";
import type { ActiveFilter } from "Common/UI/Components/TelemetryViewer/types";
/*
 * STATIC imports, on purpose: every viewer's chip builder calls this module
 * and their suites run in plain Node. A browser-only import dragged in here
 * fails this file at load.
 */
import {
  ENTITY_KEY_GROUP_NO_SYNTAX_REASON,
  LockedEntityKeyDisplay,
  LockedEntityKeyDisplayMap,
  LockedEntityKeyGroup,
  buildLockedEntityKeyChips,
} from "../../FeatureSet/Dashboard/src/Utils/LockedEntityKeyChips";
import {
  DEFAULT_ENTITY_KEY_DISPLAY_KEY,
  ENTITY_KEYS_FACET_KEY,
  ENTITY_KEY_NO_ATTRIBUTES_REASON,
  ENTITY_KEY_NO_SYNTAX_REASON,
  EntityKeyScopedRows,
  describeLockedEntityKeyFilter,
} from "../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScope";

/*
 * Grouped entity-key chips: the fix for a database's Logs / Traces / Metrics
 * tabs showing one locked chip PER KEY — its id, every endpoint and every pod
 * — which put 26 look-alike pills above one CloudNativePG cluster's logs and
 * read as 26 separate filters. Keys whose displays name the same group now
 * share ONE chip, named after the group, whose tooltip lists what it
 * matches. The rules pinned here:
 *
 *  - one chip per group, at the position of the group's first key, with the
 *    ungrouped chips around it in their usual order;
 *  - the chip is named by the group ("Database: orders-db"), read-only, on
 *    the entity-key column, and its value is the group id;
 *  - its tooltip detail lists every member under its heading, headings in
 *    first-seen order, values in key order without duplicates;
 *  - a group of ONE keeps that key's search syntax; two or more say why they
 *    have none;
 *  - a partial or malformed group is no group: the key keeps its own chip;
 *  - skipped keys leave the group, and a group with no members left has no
 *    chip;
 *  - nothing here reads or writes the query, and the inputs are not mutated.
 */

const GROUP: LockedEntityKeyGroup = {
  id: "database:orders",
  displayKey: "Database",
  displayValue: "orders-db",
  summary: "Shows telemetry from this database.",
};

function member(
  displayKey: string,
  displayValue: string,
  overrides: Partial<LockedEntityKeyGroup> = {},
  extra: Partial<LockedEntityKeyDisplay> = {},
): LockedEntityKeyDisplay {
  return {
    displayKey: displayKey,
    displayValue: displayValue,
    group: { ...GROUP, ...overrides },
    ...extra,
  };
}

const ROW_KEY: string = "1111111111111111";
const ENDPOINT_A_KEY: string = "2222222222222222";
const ENDPOINT_B_KEY: string = "3333333333333333";
const POD_KEY: string = "4444444444444444";
const LOOSE_KEY: string = "5555555555555555";
const OTHER_KEY: string = "6666666666666666";

function databaseDisplays(): LockedEntityKeyDisplayMap {
  return {
    [ROW_KEY]: member("Database", "orders-db", {
      memberLabel: "Database ID",
      memberDescription: "Sent with this database's id.",
      memberValue: "db-uuid",
    }),
    [ENDPOINT_A_KEY]: member("Database Endpoint", "db.prod:5432", {
      memberLabel: "Endpoints",
      memberDescription: "Addressed to one of these addresses.",
    }),
    [ENDPOINT_B_KEY]: member("Database Endpoint", "db.prod:5432@prod", {
      memberLabel: "Endpoints",
    }),
    [POD_KEY]: member("Database Instance", "orders-db (44444444)", {
      memberLabel: "Instances",
      memberDescription: "Reported by a pod this database runs as.",
    }),
  };
}

function chipsFor(
  entityKeys: Array<string>,
  displays: LockedEntityKeyDisplayMap | undefined,
  rows: EntityKeyScopedRows = "logs",
  skipEntityKeys?: Array<string>,
): Array<ActiveFilter> {
  return buildLockedEntityKeyChips({
    rows: rows,
    entityKeys: entityKeys,
    displays: displays,
    skipEntityKeys: skipEntityKeys,
  });
}

function matchesOf(chip: ActiveFilter): Array<LockedFilterScopeMatch> {
  return chip.lockedDetail?.scopeMatches || [];
}

describe("buildLockedEntityKeyChips — grouped keys", () => {
  test("every key of one database collapses into ONE chip", () => {
    const chips: Array<ActiveFilter> = chipsFor(
      [ROW_KEY, ENDPOINT_A_KEY, ENDPOINT_B_KEY, POD_KEY],
      databaseDisplays(),
    );

    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({
      facetKey: ENTITY_KEYS_FACET_KEY,
      value: "database:orders",
      displayKey: "Database",
      displayValue: "orders-db",
      readOnly: true,
    });
  });

  test("the chip's tooltip lists what it matches, heading by heading", () => {
    const chips: Array<ActiveFilter> = chipsFor(
      [ROW_KEY, ENDPOINT_A_KEY, ENDPOINT_B_KEY, POD_KEY],
      databaseDisplays(),
    );

    expect(matchesOf(chips[0]!)).toEqual([
      {
        label: "Database ID",
        description: "Sent with this database's id.",
        values: ["db-uuid"],
      },
      {
        label: "Endpoints",
        description: "Addressed to one of these addresses.",
        values: ["db.prod:5432", "db.prod:5432@prod"],
      },
      {
        label: "Instances",
        description: "Reported by a pod this database runs as.",
        values: ["orders-db (44444444)"],
      },
    ]);
    expect(chips[0]!.lockedDetail!.scopeSummary).toBe(
      "Shows telemetry from this database.",
    );
  });

  test("a group of several keys has no search syntax, and says why", () => {
    const chips: Array<ActiveFilter> = chipsFor(
      [ROW_KEY, ENDPOINT_A_KEY],
      databaseDisplays(),
    );

    expect(chips[0]!.lockedDetail!.searchToken).toBeUndefined();
    expect(chips[0]!.lockedDetail!.searchTokenUnavailableReason).toBe(
      ENTITY_KEY_GROUP_NO_SYNTAX_REASON,
    );
  });

  test("the reason is the same whatever list the chip sits above", () => {
    const rowsList: Array<EntityKeyScopedRows> = [
      "logs",
      "traces",
      "metrics",
      "exceptions",
      "profiles",
    ];

    for (const rows of rowsList) {
      const chips: Array<ActiveFilter> = chipsFor(
        [ROW_KEY, POD_KEY],
        databaseDisplays(),
        rows,
      );

      expect(chips).toHaveLength(1);
      expect(chips[0]!.lockedDetail!.searchTokenUnavailableReason).toBe(
        ENTITY_KEY_GROUP_NO_SYNTAX_REASON,
      );
    }
  });

  test("a group of ONE keeps that key's own search syntax", () => {
    const displays: LockedEntityKeyDisplayMap = {
      [POD_KEY]: member(
        "Kubernetes Pod",
        "checkout-7d9f",
        { memberLabel: "Pods" },
        {
          searchAttributes: {
            "k8s.pod.name": "checkout-7d9f",
            "k8s.namespace.name": "shop",
          },
        },
      ),
    };

    for (const rows of ["logs", "traces", "metrics"] as const) {
      const chips: Array<ActiveFilter> = chipsFor([POD_KEY], displays, rows);
      const expected: LockedFilterDetail = describeLockedEntityKeyFilter({
        rows: rows,
        searchAttributes: displays[POD_KEY]!.searchAttributes,
      });

      expect(chips).toHaveLength(1);
      expect(chips[0]!.lockedDetail!.searchToken).toBe(expected.searchToken);
      expect(chips[0]!.lockedDetail!.searchToken).toBeTruthy();
      expect(matchesOf(chips[0]!)).toEqual([
        { label: "Pods", values: ["checkout-7d9f"] },
      ]);
    }
  });

  test("a group of one without attributes carries the plain entity-key reason", () => {
    const logs: Array<ActiveFilter> = chipsFor([ROW_KEY], databaseDisplays());
    expect(logs[0]!.lockedDetail!.searchTokenUnavailableReason).toBe(
      ENTITY_KEY_NO_ATTRIBUTES_REASON,
    );

    const exceptions: Array<ActiveFilter> = chipsFor(
      [ROW_KEY],
      databaseDisplays(),
      "exceptions",
    );
    expect(exceptions[0]!.lockedDetail!.searchTokenUnavailableReason).toBe(
      ENTITY_KEY_NO_SYNTAX_REASON,
    );
  });

  test("the group chip sits where its first key would, between the ungrouped chips", () => {
    const displays: LockedEntityKeyDisplayMap = {
      ...databaseDisplays(),
      [LOOSE_KEY]: { displayKey: "Kubernetes Node", displayValue: "node-a" },
    };

    const chips: Array<ActiveFilter> = chipsFor(
      [OTHER_KEY, ROW_KEY, LOOSE_KEY, ENDPOINT_A_KEY, POD_KEY],
      displays,
    );

    expect(
      chips.map((chip: ActiveFilter): string => {
        return `${chip.displayKey}: ${chip.displayValue}`;
      }),
    ).toEqual([
      `${DEFAULT_ENTITY_KEY_DISPLAY_KEY}: ${OTHER_KEY}`,
      "Database: orders-db",
      "Kubernetes Node: node-a",
    ]);
  });

  test("ungrouped chips are exactly what they were before groups existed", () => {
    const chips: Array<ActiveFilter> = chipsFor([LOOSE_KEY, OTHER_KEY], {
      [LOOSE_KEY]: { displayKey: "Kubernetes Node", displayValue: "node-a" },
    });

    expect(chips).toEqual([
      {
        facetKey: ENTITY_KEYS_FACET_KEY,
        value: LOOSE_KEY,
        displayKey: "Kubernetes Node",
        displayValue: "node-a",
        readOnly: true,
        lockedDetail: {
          searchTokenUnavailableReason: ENTITY_KEY_NO_ATTRIBUTES_REASON,
        },
      },
      {
        facetKey: ENTITY_KEYS_FACET_KEY,
        value: OTHER_KEY,
        displayKey: DEFAULT_ENTITY_KEY_DISPLAY_KEY,
        displayValue: OTHER_KEY,
        readOnly: true,
        lockedDetail: {
          searchTokenUnavailableReason: ENTITY_KEY_NO_ATTRIBUTES_REASON,
        },
      },
    ]);
    for (const chip of chips) {
      expect(chip.lockedDetail).not.toHaveProperty("scopeMatches");
    }
  });

  test("two groups make two chips, each with only its own members", () => {
    const displays: LockedEntityKeyDisplayMap = {
      [ROW_KEY]: member("Database", "orders-db", { memberLabel: "ID" }),
      [ENDPOINT_A_KEY]: member("Database Endpoint", "cache:6379", {
        id: "database:cache",
        displayValue: "cache",
        memberLabel: "Endpoints",
      }),
      [POD_KEY]: member("Database Instance", "orders-db (4444)", {
        memberLabel: "Instances",
      }),
    };

    const chips: Array<ActiveFilter> = chipsFor(
      [ROW_KEY, ENDPOINT_A_KEY, POD_KEY],
      displays,
    );

    expect(
      chips.map((chip: ActiveFilter): string => {
        return chip.value;
      }),
    ).toEqual(["database:orders", "database:cache"]);
    expect(
      matchesOf(chips[0]!).map((match: LockedFilterScopeMatch): string => {
        return match.label;
      }),
    ).toEqual(["ID", "Instances"]);
    expect(matchesOf(chips[1]!)).toEqual([
      { label: "Endpoints", values: ["cache:6379"] },
    ]);
    expect(chips[1]!.displayValue).toBe("cache");
  });

  test("group ids are compared trimmed", () => {
    const displays: LockedEntityKeyDisplayMap = {
      [ROW_KEY]: member("Database", "orders-db", { id: "  database:orders " }),
      [POD_KEY]: member("Database Instance", "pod", { id: "database:orders" }),
    };

    const chips: Array<ActiveFilter> = chipsFor([ROW_KEY, POD_KEY], displays);

    expect(chips).toHaveLength(1);
    expect(chips[0]!.value).toBe("database:orders");
  });

  test("the first member names the chip when members disagree", () => {
    const displays: LockedEntityKeyDisplayMap = {
      [ROW_KEY]: member("Database", "orders-db", {
        displayValue: "  first name  ",
        summary: "",
      }),
      [POD_KEY]: member("Database Instance", "pod", {
        displayValue: "second name",
        summary: "second summary",
      }),
    };

    const chips: Array<ActiveFilter> = chipsFor([ROW_KEY, POD_KEY], displays);

    expect(chips[0]!.displayValue).toBe("first name");
    // A blank summary falls through to the next member's.
    expect(chips[0]!.lockedDetail!.scopeSummary).toBe("second summary");
  });

  test("a group without any summary has none on its detail", () => {
    const displays: LockedEntityKeyDisplayMap = {
      [ROW_KEY]: member("Database", "orders-db", { summary: undefined }),
    };

    const chips: Array<ActiveFilter> = chipsFor([ROW_KEY], displays);

    expect(chips[0]!.lockedDetail).not.toHaveProperty("scopeSummary");
  });

  test("headings fall back to the key's display key, then to 'Resource'", () => {
    const displays: LockedEntityKeyDisplayMap = {
      [ROW_KEY]: member("Database", "orders-db"),
      [POD_KEY]: member("   ", "pod-a"),
    };

    const chips: Array<ActiveFilter> = chipsFor([ROW_KEY, POD_KEY], displays);

    expect(matchesOf(chips[0]!)).toEqual([
      { label: "Database", values: ["orders-db"] },
      { label: DEFAULT_ENTITY_KEY_DISPLAY_KEY, values: ["pod-a"] },
    ]);
  });

  test("values fall back to the display value, then to the key itself", () => {
    const displays: LockedEntityKeyDisplayMap = {
      [ROW_KEY]: member("Database", "orders-db", {
        memberLabel: "Things",
        memberValue: "  ",
      }),
      [POD_KEY]: member("Database", "", { memberLabel: "Things" }),
    };

    const chips: Array<ActiveFilter> = chipsFor([ROW_KEY, POD_KEY], displays);

    expect(matchesOf(chips[0]!)).toEqual([
      { label: "Things", values: ["orders-db", POD_KEY] },
    ]);
  });

  test("a value listed twice under one heading is listed once", () => {
    const displays: LockedEntityKeyDisplayMap = {
      [ENDPOINT_A_KEY]: member("Database Endpoint", "db.prod:5432", {
        memberLabel: "Endpoints",
      }),
      [ENDPOINT_B_KEY]: member("Database Endpoint", "db.prod:5432", {
        memberLabel: "Endpoints",
      }),
    };

    const chips: Array<ActiveFilter> = chipsFor(
      [ENDPOINT_A_KEY, ENDPOINT_B_KEY],
      displays,
    );

    expect(matchesOf(chips[0]!)).toEqual([
      { label: "Endpoints", values: ["db.prod:5432"] },
    ]);
  });

  test("a heading's description is its first non-empty one", () => {
    const displays: LockedEntityKeyDisplayMap = {
      [ENDPOINT_A_KEY]: member("Database Endpoint", "a:1", {
        memberLabel: "Endpoints",
        memberDescription: "   ",
      }),
      [ENDPOINT_B_KEY]: member("Database Endpoint", "b:2", {
        memberLabel: "Endpoints",
        memberDescription: "  How they match.  ",
      }),
    };

    const chips: Array<ActiveFilter> = chipsFor(
      [ENDPOINT_A_KEY, ENDPOINT_B_KEY],
      displays,
    );

    expect(matchesOf(chips[0]!)).toEqual([
      {
        label: "Endpoints",
        description: "How they match.",
        values: ["a:1", "b:2"],
      },
    ]);
  });

  test.each([
    ["no id", { id: "" }],
    ["a blank id", { id: "   " }],
    ["no display key", { displayKey: "" }],
    ["no display value", { displayValue: " " }],
  ])(
    "a group with %s is no group: the key keeps its own chip",
    (_label: string, overrides: Partial<LockedEntityKeyGroup>) => {
      const displays: LockedEntityKeyDisplayMap = {
        [ROW_KEY]: member("Database", "orders-db", overrides),
        [POD_KEY]: member("Database Instance", "orders-db (4444)"),
      };

      const chips: Array<ActiveFilter> = chipsFor([ROW_KEY, POD_KEY], displays);

      expect(
        chips.map((chip: ActiveFilter): string => {
          return `${chip.value} ${chip.displayKey}: ${chip.displayValue}`;
        }),
      ).toEqual([
        `${ROW_KEY} Database: orders-db`,
        "database:orders Database: orders-db",
      ]);
      expect(chips[0]!.lockedDetail).not.toHaveProperty("scopeMatches");
    },
  );

  test.each([
    ["a string", "database:orders"],
    ["an array", ["database:orders"]],
    ["a number", 7],
    ["null", null],
  ])(
    "a group that is %s at runtime is ignored",
    (_label: string, group: unknown) => {
      const displays: LockedEntityKeyDisplayMap = {
        [ROW_KEY]: {
          displayKey: "Database",
          displayValue: "orders-db",
          group: group as LockedEntityKeyGroup,
        },
      };

      const chips: Array<ActiveFilter> = chipsFor([ROW_KEY], displays);

      expect(chips).toHaveLength(1);
      expect(chips[0]!.value).toBe(ROW_KEY);
      expect(chips[0]!.lockedDetail).not.toHaveProperty("scopeMatches");
    },
  );

  test("a skipped key leaves its group; the rest still share the chip", () => {
    const chips: Array<ActiveFilter> = chipsFor(
      [ROW_KEY, ENDPOINT_A_KEY, POD_KEY],
      databaseDisplays(),
      "traces",
      [ENDPOINT_A_KEY],
    );

    expect(chips).toHaveLength(1);
    expect(
      matchesOf(chips[0]!).map((match: LockedFilterScopeMatch): string => {
        return match.label;
      }),
    ).toEqual(["Database ID", "Instances"]);
  });

  test("a group whose every key is skipped has no chip", () => {
    const chips: Array<ActiveFilter> = chipsFor(
      [ROW_KEY, POD_KEY, OTHER_KEY],
      databaseDisplays(),
      "traces",
      [ROW_KEY, POD_KEY],
    );

    expect(
      chips.map((chip: ActiveFilter): string => {
        return chip.value;
      }),
    ).toEqual([OTHER_KEY]);
  });

  test("a group of one after skips keeps that member's syntax, not the group reason", () => {
    const chips: Array<ActiveFilter> = chipsFor(
      [ROW_KEY, POD_KEY],
      databaseDisplays(),
      "logs",
      [POD_KEY],
    );

    expect(chips[0]!.lockedDetail!.searchTokenUnavailableReason).toBe(
      ENTITY_KEY_NO_ATTRIBUTES_REASON,
    );
  });

  test("keys the page does not scope by never appear in the breakdown", () => {
    const chips: Array<ActiveFilter> = chipsFor([POD_KEY], databaseDisplays());

    expect(matchesOf(chips[0]!)).toEqual([
      {
        label: "Instances",
        description: "Reported by a pod this database runs as.",
        values: ["orders-db (44444444)"],
      },
    ]);
  });

  test("duplicate and padded keys still count once", () => {
    const chips: Array<ActiveFilter> = chipsFor(
      [ROW_KEY, ` ${ROW_KEY} `, ENDPOINT_A_KEY, ENDPOINT_A_KEY],
      databaseDisplays(),
    );

    expect(chips).toHaveLength(1);
    expect(
      matchesOf(chips[0]!).map((match: LockedFilterScopeMatch): number => {
        return match.values.length;
      }),
    ).toEqual([1, 1]);
  });

  test("returns fresh chips and leaves its inputs alone", () => {
    const displays: LockedEntityKeyDisplayMap = databaseDisplays();
    const snapshot: string = JSON.stringify(displays);
    const keys: Array<string> = [ROW_KEY, ENDPOINT_A_KEY, POD_KEY];

    const first: Array<ActiveFilter> = chipsFor(keys, displays);
    const second: Array<ActiveFilter> = chipsFor(keys, displays);

    expect(JSON.stringify(displays)).toBe(snapshot);
    expect(keys).toEqual([ROW_KEY, ENDPOINT_A_KEY, POD_KEY]);
    expect(first).toEqual(second);
    expect(first[0]).not.toBe(second[0]);
    expect(first[0]!.lockedDetail!.scopeMatches).not.toBe(
      second[0]!.lockedDetail!.scopeMatches,
    );
  });

  test("a group of hundreds of keys is still one chip", () => {
    const displays: LockedEntityKeyDisplayMap = {};
    const keys: Array<string> = [];

    for (let index: number = 0; index < 300; index++) {
      const key: string = index.toString(16).padStart(16, "0");
      keys.push(key);
      displays[key] = member("Database Endpoint", `db-${index}:5432`, {
        memberLabel: "Endpoints",
      });
    }

    const chips: Array<ActiveFilter> = chipsFor(keys, displays);

    expect(chips).toHaveLength(1);
    expect(matchesOf(chips[0]!)[0]!.values).toHaveLength(300);
    expect(matchesOf(chips[0]!)[0]!.values[299]).toBe("db-299:5432");
  });
});
