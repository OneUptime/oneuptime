import { describe, expect, jest, test } from "@jest/globals";

/*
 * The chip display reaches the entity name lookup, whose API module reads
 * the browser's config at load; nothing here looks a name up.
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import { JSONObject } from "Common/Types/JSON";
import {
  ActiveFilter,
  FacetConfig,
} from "Common/UI/Components/TelemetryViewer/types";
import {
  ExceptionExclusions,
  applyExceptionExclusionsToPayload,
  applyExceptionExclusionsToQuery,
  readExceptionExclusions,
  toExcludedExceptionValue,
} from "../../FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsFacetExclusions";
import {
  getExceptionChipFacetKey,
  getExceptionChosenFacetKeys,
} from "../../FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsFacetCounts";
import {
  collectMetricsEntityLookup,
  getMetricsAppliedEntityFilterIds,
  getMetricsExcludedEntityFilterIds,
  resolveMetricsChipDisplay,
} from "../../FeatureSet/Dashboard/src/Utils/MetricsEntityChipDisplay";

/*
 * "Is not" in the Exceptions and Metrics explorers.
 *
 * Exceptions lists exception GROUPS (Postgres) under a chart and facet
 * counts of their occurrences (ClickHouse): a value left out is read once
 * and written into both, by one rule - a column that keeps values drops
 * what is left out of it. Metrics lists metric names under their Service
 * relation: a service left out is the set of metrics it does not report.
 */

const CHECKOUT_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BILLING_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HOST_ID: string = "5f4e3d2c-1b0a-4998-8776-655443322110";

function chips(
  entries: Array<[string, string]>,
): Array<{ facetKey: string; value: string }> {
  return entries.map(
    ([facetKey, value]: [string, string]): {
      facetKey: string;
      value: string;
    } => {
      return { facetKey, value };
    },
  );
}

describe("Exceptions: reading what the chips leave out", () => {
  test("every resource facet names the same column, so they are one list", () => {
    const exclusions: ExceptionExclusions = readExceptionExclusions({
      chips: chips([
        ["!primaryEntityId", CHECKOUT_ID],
        ["!serviceId", BILLING_ID],
        ["!hostId", HOST_ID],
        ["!hostId", HOST_ID],
        ["!exceptionType", "TypeError"],
        ["!environment", "staging"],
        ["!errorClass", "user-error"],
        ["!attributes.http.method", "GET"],
        ["exceptionType", "RangeError"],
      ]),
    });

    expect(exclusions).toEqual({
      entityIds: [CHECKOUT_ID, BILLING_ID, HOST_ID],
      columns: {
        exceptionType: ["TypeError"],
        environment: ["staging"],
        errorClass: ["user-error"],
      },
      attributes: { "http.method": ["GET"] },
    });
  });

  test("a facet counted without its own selection leaves its own `!` chips out", () => {
    const exclusions: ExceptionExclusions = readExceptionExclusions({
      chips: chips([
        ["!exceptionType", "TypeError"],
        ["!environment", "staging"],
        ["!serviceId", CHECKOUT_ID],
        ["!hostId", HOST_ID],
      ]),
      omitFacetKey: "exceptionType",
    });

    expect(exclusions.columns).toEqual({ environment: ["staging"] });

    expect(
      readExceptionExclusions({
        chips: chips([
          ["!serviceId", CHECKOUT_ID],
          ["!hostId", HOST_ID],
        ]),
        omitFacetKey: "primaryEntityId",
      }).entityIds,
    ).toEqual([HOST_ID]);
  });
});

describe("Exceptions: the group list leaves the values out", () => {
  test("one value is a !=, several one NOT IN", () => {
    expect(toExcludedExceptionValue(["TypeError"])).toBeInstanceOf(NotEqual);
    expect(toExcludedExceptionValue(["a", "b", "a"])).toEqual(
      new IncludesNone(["a", "b"]),
    );
  });

  test("columns and resources, never the class lens's own column", () => {
    const query: Record<string, unknown> = {};

    applyExceptionExclusionsToQuery({
      query,
      exclusions: readExceptionExclusions({
        chips: chips([
          ["!primaryEntityId", CHECKOUT_ID],
          ["!exceptionType", "TypeError"],
          ["!environment", "staging"],
          ["!errorClass", "user-error"],
        ]),
      }),
      skipColumns: ["errorClass"],
    });

    expect(query["primaryEntityId"]).toEqual(new NotEqual(CHECKOUT_ID));
    expect(query["exceptionType"]).toEqual(new NotEqual("TypeError"));
    expect(query["environment"]).toEqual(new NotEqual("staging"));
    expect(query["errorClass"]).toBeUndefined();
  });

  test("a column that keeps values drops what is left out of it - the page's own entity included", () => {
    const query: Record<string, unknown> = {
      primaryEntityId: CHECKOUT_ID,
      exceptionType: "RangeError",
    };

    applyExceptionExclusionsToQuery({
      query,
      exclusions: readExceptionExclusions({
        chips: chips([
          ["!primaryEntityId", BILLING_ID],
          ["!exceptionType", "TypeError"],
        ]),
      }),
    });

    expect(query).toEqual({
      primaryEntityId: CHECKOUT_ID,
      exceptionType: "RangeError",
    });
  });
});

describe("Exceptions: the chart and counts leave the same values out", () => {
  test("each rides its field", () => {
    const payload: JSONObject = {};

    applyExceptionExclusionsToPayload(
      payload,
      readExceptionExclusions({
        chips: chips([
          ["!primaryEntityId", CHECKOUT_ID],
          ["!hostId", HOST_ID],
          ["!exceptionType", "TypeError"],
          ["!environment", "staging"],
          ["!errorClass", "user-error"],
        ]),
      }),
    );

    expect(payload).toEqual({
      excludedServiceIds: [CHECKOUT_ID, HOST_ID],
      excludedExceptionTypes: ["TypeError"],
      excludedEnvironments: ["staging"],
    });
  });

  test("a field the request already keeps wins", () => {
    const payload: JSONObject = {
      serviceIds: [BILLING_ID],
      exceptionTypes: ["RangeError"],
      environments: ["production"],
    };

    applyExceptionExclusionsToPayload(
      payload,
      readExceptionExclusions({
        chips: chips([
          ["!primaryEntityId", CHECKOUT_ID],
          ["!exceptionType", "TypeError"],
          ["!environment", "staging"],
        ]),
      }),
    );

    expect(payload).toEqual({
      serviceIds: [BILLING_ID],
      exceptionTypes: ["RangeError"],
      environments: ["production"],
    });
  });

  test("a facet with a value left out is a choice: counted without it", () => {
    expect(getExceptionChipFacetKey("!exceptionType")).toBe("exceptionType");
    expect(getExceptionChipFacetKey("!serviceId")).toBe("primaryEntityId");
    expect(getExceptionChipFacetKey("!attributes.k")).toBeNull();
    expect(
      getExceptionChosenFacetKeys([
        { facetKey: "!environment" },
        { facetKey: "!hostId" },
      ]).sort(),
    ).toEqual(["environment", "hostId"]);
  });
});

describe("Metrics: a service left out", () => {
  const FACET_CONFIGS: Array<FacetConfig> = [
    {
      key: "primaryEntityId",
      title: "Service",
      valueDisplayMap: { [CHECKOUT_ID]: "checkout" },
    },
  ];

  test("is read apart from the services kept", () => {
    const filters: Array<ActiveFilter> = [
      {
        facetKey: "!primaryEntityId",
        value: CHECKOUT_ID,
        displayKey: "Service",
        displayValue: "checkout",
      },
      {
        facetKey: "!serviceId",
        value: BILLING_ID,
        displayKey: "Service",
        displayValue: BILLING_ID,
      },
      {
        facetKey: "primaryEntityId",
        value: HOST_ID,
        displayKey: "Service",
        displayValue: HOST_ID,
      },
    ];

    expect(getMetricsExcludedEntityFilterIds(filters)).toEqual([
      CHECKOUT_ID,
      BILLING_ID,
    ]);
    expect(getMetricsAppliedEntityFilterIds(filters)).toEqual([HOST_ID]);
  });

  test("is named like a kept one, its key kept", () => {
    const chip: ActiveFilter = resolveMetricsChipDisplay({
      chip: {
        facetKey: "!primaryEntityId",
        value: CHECKOUT_ID,
        displayKey: "!primaryEntityId",
        displayValue: CHECKOUT_ID,
      },
      facetConfigs: FACET_CONFIGS,
      nameMap: undefined,
    });

    expect(chip.facetKey).toBe("!primaryEntityId");
    expect(chip.displayKey).toBe("Service");
    expect(chip.displayValue).toBe("checkout");
  });

  test("its id is looked up with the others", () => {
    expect(
      collectMetricsEntityLookup({
        scopeIds: undefined,
        scopeEntityType: undefined,
        filters: [
          {
            facetKey: "!primaryEntityId",
            value: BILLING_ID,
            displayKey: "Service",
            displayValue: BILLING_ID,
          },
        ],
      }).ids,
    ).toEqual([BILLING_ID]);
  });
});
