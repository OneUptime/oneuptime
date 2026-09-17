/*
 * The traces and metrics chip builders resolve entity names through
 * ModelAPI, whose import chain reads `window`; nothing here resolves a name.
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import type { ActiveFilter } from "Common/UI/Components/TelemetryViewer/types";
import { TelemetrySignal } from "Common/Utils/Telemetry/LockedFilterSearch";
import {
  INVENTORY_ENTITY_IDENTITY_ATTRIBUTE,
  MANUAL_ENTITY_IDENTITY_ATTRIBUTE,
} from "Common/Utils/Telemetry/EntityKey";
import queryStringToFilter, {
  LogFilter,
} from "Common/Types/Log/LogQueryToFilter";
import { SearchValueOperator } from "Common/Types/Telemetry/TelemetrySearchQuery";
import {
  buildInventoryEntityKeyDisplays,
  buildInventorySearchAttributes,
} from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryTelemetryScope";
import {
  LockedEntityKeyDisplayMap,
  buildLockedEntityKeyChips,
} from "../../FeatureSet/Dashboard/src/Utils/LockedEntityKeyChips";
import {
  ENTITY_KEYS_FACET_KEY,
  ENTITY_KEY_NO_ATTRIBUTES_REASON,
  ENTITY_KEY_NO_SYNTAX_REASON,
  EntityKeyScopedRows,
  RESOURCE_ATTRIBUTE_PREFIX,
  buildEntitySearchToken,
  describeLockedEntityKeyFilter,
} from "../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScope";
import { attachLogsLockedFilterDetails } from "../../FeatureSet/Dashboard/src/Components/Logs/LogsLockedScope";
import { buildTracesLockedEntityKeyChips } from "../../FeatureSet/Dashboard/src/Components/Traces/TracesEntityDisplay";
import {
  ParsedTraceSearch,
  TraceAttributeFilter,
  parseTraceSearch,
} from "../../FeatureSet/Dashboard/src/Components/Traces/TracesSearchCompile";
import {
  ParsedMetricsSearch,
  parseMetricsSearch,
} from "../../FeatureSet/Dashboard/src/Components/Metrics/MetricsSearchQuery";
import { buildMetricsActiveFilterChips } from "../../FeatureSet/Dashboard/src/Utils/MetricsEntityChipDisplay";

/*
 * The search syntax on an Inventory item's locked pill.
 *
 * The item's Logs / Traces / Metrics pages scope by `hasAny(entityKeys, [key])`
 * — a hash no search bar understands. The pill's tooltip spells that scope
 * with the item's identifying OpenTelemetry resource attributes, the same
 * `@resource.<key>:<value>` shape a Kubernetes cluster's pill shows, and
 * never with the entity key. An item with nothing to spell gets the reason
 * there is no syntax instead, as do the exceptions and profiles lists, which
 * have no search bar.
 *
 * Every failure pinned here is silent: a token that names the entity key, a
 * lowercased value that matches nothing, an attribute quietly dropped (which
 * widens the search past the entity), a chip that borrows another key's
 * attributes, or a viewer step that rebuilds the chip and loses the token on
 * the way.
 */

const POD_KEY: string = "3f9a1b2c4d5e6f70";
const OTHER_KEY: string = "aaaaaaaaaaaaaaaa";

const SIGNALS: Array<TelemetrySignal> = ["logs", "traces", "metrics"];

/*
 * As ingest stores them: identity values canonicalized (trimmed, lowercased),
 * descriptive values in their original case.
 */
const POD_IDENTIFYING: Record<string, string> = {
  "k8s.pod.name": "checkout-7d9f",
  "k8s.namespace.name": "shop",
  "k8s.cluster.name": "prod-eks-01",
};

const POD_SEARCH_TOKEN: string =
  "@resource.k8s.cluster.name:prod-eks-01 @resource.k8s.namespace.name:shop @resource.k8s.pod.name:checkout-7d9f";

type PodDisplaysFunction = () => LockedEntityKeyDisplayMap;

const podDisplays: PodDisplaysFunction = (): LockedEntityKeyDisplayMap => {
  return buildInventoryEntityKeyDisplays({
    entityKey: POD_KEY,
    entityType: "k8s.pod",
    displayName: "checkout-7d9f",
    identifyingAttributes: POD_IDENTIFYING,
    descriptiveAttributes: {
      "k8s.pod.name": "checkout-7d9f",
      "k8s.pod.uid": "0c1d2e3f",
    },
  });
};

describe("buildInventorySearchAttributes", () => {
  test("hands over every identifying attribute, keyed without the resource. prefix", () => {
    expect(
      buildInventorySearchAttributes({
        identifyingAttributes: POD_IDENTIFYING,
      }),
    ).toEqual(POD_IDENTIFYING);
  });

  test("restores a value's original case from the descriptive attributes", () => {
    /*
     * Ingest lowercases identity values before hashing, but the explorers
     * match attribute values exactly — the lowercased name would find nothing.
     */
    expect(
      buildInventorySearchAttributes({
        identifyingAttributes: { "host.name": "web-prod-01" },
        descriptiveAttributes: { "host.name": "  Web-PROD-01 " },
      }),
    ).toEqual({ "host.name": "Web-PROD-01" });
  });

  test("keeps the identity value when the descriptive one names something else", () => {
    // A pod renamed since: its identity was built from the old name.
    expect(
      buildInventorySearchAttributes({
        identifyingAttributes: { "k8s.pod.name": "checkout-7d9f" },
        descriptiveAttributes: { "k8s.pod.name": "checkout-8a1b" },
      }),
    ).toEqual({ "k8s.pod.name": "checkout-7d9f" });
  });

  test("ignores descriptive attributes the identity does not have", () => {
    expect(
      buildInventorySearchAttributes({
        identifyingAttributes: { "container.id": "ab12cd34" },
        descriptiveAttributes: {
          "container.image.name": "nginx",
          "container.id": "",
        },
      }),
    ).toEqual({ "container.id": "ab12cd34" });
  });

  test("a numeric identity value is spelled as its digits", () => {
    expect(
      buildInventorySearchAttributes({
        identifyingAttributes: { "process.pid": 4242, "host.name": "web-01" },
      }),
    ).toEqual({ "process.pid": "4242", "host.name": "web-01" });
  });

  test("trims keys and values", () => {
    expect(
      buildInventorySearchAttributes({
        identifyingAttributes: { " service.name ": "  checkout " },
      }),
    ).toEqual({ "service.name": "checkout" });
  });

  test.each([
    ["missing", undefined],
    ["null", null],
    ["a string", "k8s.pod.name=checkout"],
    ["an array", ["k8s.pod.name"]],
    ["an empty object", {}],
  ])(
    "nothing to spell when the identifying attributes are %s",
    (_label: string, identifyingAttributes: unknown) => {
      expect(
        buildInventorySearchAttributes({ identifyingAttributes }),
      ).toBeUndefined();
    },
  );

  test.each([
    [MANUAL_ENTITY_IDENTITY_ATTRIBUTE, "payments vendor api"],
    [INVENTORY_ENTITY_IDENTITY_ATTRIBUTE, "651a000000000000000000aa"],
  ])(
    "nothing to spell for an identity OneUptime minted outside telemetry (%s)",
    (attributeKey: string, value: string) => {
      expect(
        buildInventorySearchAttributes({
          identifyingAttributes: { [attributeKey]: value },
        }),
      ).toBeUndefined();
    },
  );

  test("a minted identity attribute beside real ones still spells nothing", () => {
    expect(
      buildInventorySearchAttributes({
        identifyingAttributes: {
          "host.name": "web-01",
          [INVENTORY_ENTITY_IDENTITY_ATTRIBUTE]: "651a000000000000000000aa",
        },
      }),
    ).toBeUndefined();
  });

  test.each([
    ["an empty value", ""],
    ["a blank value", "   "],
    ["a null value", null],
    ["an object value", { nested: true }],
    ["a non-finite number", Number.NaN],
  ])(
    "leaves nothing out: %s anywhere spells nothing rather than a wider search",
    (_label: string, badValue: unknown) => {
      expect(
        buildInventorySearchAttributes({
          identifyingAttributes: {
            "k8s.cluster.name": "prod-eks-01",
            "k8s.pod.name": badValue,
          },
        }),
      ).toBeUndefined();
    },
  );

  test("a blank key spells nothing", () => {
    expect(
      buildInventorySearchAttributes({
        identifyingAttributes: { "  ": "x", "host.name": "web-01" },
      }),
    ).toBeUndefined();
  });

  test("a __proto__ key stays an own entry and does not touch the prototype", () => {
    const attributes: Record<string, string> | undefined =
      buildInventorySearchAttributes({
        identifyingAttributes: JSON.parse(
          '{"__proto__": "x", "host.name": "web-01"}',
        ) as unknown,
      });

    expect(attributes).toBeDefined();
    expect(Object.getPrototypeOf(attributes)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(attributes, "__proto__")).toBe(
      true,
    );
    expect(attributes!["host.name"]).toBe("web-01");
  });
});

describe("buildInventoryEntityKeyDisplays carries the search attributes", () => {
  test("the display names the item AND hands over its identifying attributes", () => {
    expect(podDisplays()).toEqual({
      [POD_KEY]: {
        displayKey: "Kubernetes Pod",
        displayValue: "checkout-7d9f",
        searchAttributes: POD_IDENTIFYING,
      },
    });
  });

  test("no searchAttributes property at all when the item has nothing to spell", () => {
    const displays: LockedEntityKeyDisplayMap = buildInventoryEntityKeyDisplays(
      {
        entityKey: POD_KEY,
        entityType: "external.service",
        displayName: "Payments vendor",
        identifyingAttributes: {
          [MANUAL_ENTITY_IDENTITY_ATTRIBUTE]: "payments vendor",
        },
      },
    );

    expect(
      Object.prototype.hasOwnProperty.call(
        displays[POD_KEY],
        "searchAttributes",
      ),
    ).toBe(false);
  });

  test("an item without an entity key still yields no displays", () => {
    expect(
      buildInventoryEntityKeyDisplays({
        identifyingAttributes: POD_IDENTIFYING,
      }),
    ).toEqual({});
  });
});

describe("buildLockedEntityKeyChips reads each chip's search attributes from the displays", () => {
  test("spells the chip with the attributes named for its own key", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
      displays: podDisplays(),
    });

    expect(chips[0]!.lockedDetail).toEqual({ searchToken: POD_SEARCH_TOKEN });
  });

  test("a key the page did not name, or no displays at all, gives the reason instead", () => {
    for (const displays of [podDisplays(), undefined]) {
      const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
        rows: "logs",
        entityKeys: displays ? [OTHER_KEY] : [POD_KEY],
        displays,
      });

      expect(chips[0]!.lockedDetail).toEqual({
        searchTokenUnavailableReason: ENTITY_KEY_NO_ATTRIBUTES_REASON,
      });
    }
  });

  test("never reads a key's attributes from the prototype", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: ["constructor"],
      displays: podDisplays(),
    });

    expect(chips[0]!.lockedDetail).toEqual({
      searchTokenUnavailableReason: ENTITY_KEY_NO_ATTRIBUTES_REASON,
    });
  });
});

describe("buildEntitySearchToken", () => {
  test.each(SIGNALS)(
    "%s: one @resource.<key>:<value> token per attribute, in key order",
    (signal: TelemetrySignal) => {
      expect(buildEntitySearchToken(signal, POD_IDENTIFYING)).toBe(
        POD_SEARCH_TOKEN,
      );
    },
  );

  test("the prefix is the one ingest stores resource attributes under", () => {
    expect(RESOURCE_ATTRIBUTE_PREFIX).toBe("resource.");
  });

  test("the token never mentions the entity key or its column", () => {
    const token: string = buildEntitySearchToken("logs", POD_IDENTIFYING)!;

    expect(token).not.toContain(ENTITY_KEYS_FACET_KEY);
    expect(token).not.toContain(POD_KEY);
  });

  test("values are escaped through the search grammar", () => {
    expect(
      buildEntitySearchToken("logs", {
        "service.name": "checkout api",
        "host.name": "web-*",
        "k8s.namespace.name": "-shop",
      }),
    ).toBe(
      '@resource.host.name:web-\\* @resource.k8s.namespace.name:\\-shop @resource.service.name:"checkout api"',
    );
  });

  test.each([
    ["undefined", undefined],
    ["an empty map", {}],
    ["an array", ["k8s.pod.name"] as unknown as Record<string, string>],
  ])(
    "null for %s",
    (_label: string, attributes: Record<string, string> | undefined) => {
      expect(buildEntitySearchToken("traces", attributes)).toBeNull();
    },
  );

  test.each([
    ["a key with a space", { "bad key": "x", "host.name": "web-01" }],
    ["a key with a colon", { "bad:key": "x", "host.name": "web-01" }],
    ["a key with a quote", { 'bad"key': "x", "host.name": "web-01" }],
    ["an empty value", { "k8s.pod.name": "", "host.name": "web-01" }],
    ["a blank value", { "k8s.pod.name": "  ", "host.name": "web-01" }],
  ])(
    "null for the whole entity when any attribute has %s",
    (_label: string, attributes: Record<string, string>) => {
      expect(buildEntitySearchToken("metrics", attributes)).toBeNull();
    },
  );
});

describe("the token reproduces the entity on every explorer's search bar", () => {
  const ATTRIBUTES: Record<string, string> = {
    "k8s.cluster.name": "Prod EKS",
    "k8s.namespace.name": "shop",
    "k8s.pod.name": "checkout-*",
  };

  test("logs: every attribute compiles to an exact resource-attribute match", () => {
    const filter: LogFilter = queryStringToFilter(
      buildEntitySearchToken("logs", ATTRIBUTES)!,
    );

    expect(filter.attributes).toEqual({
      "resource.k8s.cluster.name": "Prod EKS",
      "resource.k8s.namespace.name": "shop",
      "resource.k8s.pod.name": "checkout-*",
    });
    expect(filter.body).toBeUndefined();
  });

  test("traces: every attribute is an Equals filter on the resource attribute", () => {
    const parsed: ParsedTraceSearch = parseTraceSearch(
      buildEntitySearchToken("traces", ATTRIBUTES)!,
    );

    expect(parsed.freeText).toBe("");
    expect(parsed.fieldFilters).toEqual({});
    expect(
      parsed.attributeFilters.map((filter: TraceAttributeFilter) => {
        return [filter.key, filter.predicate.operator, filter.predicate.value];
      }),
    ).toEqual([
      ["resource.k8s.cluster.name", SearchValueOperator.Equals, "Prod EKS"],
      ["resource.k8s.namespace.name", SearchValueOperator.Equals, "shop"],
      ["resource.k8s.pod.name", SearchValueOperator.Equals, "checkout-*"],
    ]);
  });

  test("metrics: every attribute lands in the attribute filters, not the name", () => {
    const parsed: ParsedMetricsSearch = parseMetricsSearch(
      buildEntitySearchToken("metrics", ATTRIBUTES)!,
    );

    expect(parsed.attributes).toEqual({
      "resource.k8s.cluster.name": "Prod EKS",
      "resource.k8s.namespace.name": "shop",
      "resource.k8s.pod.name": "checkout-*",
    });
    expect(parsed.nameFilter).toBeNull();
    expect(parsed.serviceMatcher).toBeNull();
  });
});

describe("describeLockedEntityKeyFilter spells the syntax with attributes", () => {
  test.each(SIGNALS)(
    "%s: the attributes become the chip's search token, with no reason",
    (signal: TelemetrySignal) => {
      const detail: ReturnType<typeof describeLockedEntityKeyFilter> =
        describeLockedEntityKeyFilter({
          rows: signal,
          searchAttributes: POD_IDENTIFYING,
        });

      expect(detail.searchToken).toBe(POD_SEARCH_TOKEN);
      expect(detail.searchTokenUnavailableReason).toBeUndefined();
    },
  );

  test.each(SIGNALS)(
    "%s: without attributes there is no token, and the reason says why",
    (signal: TelemetrySignal) => {
      const detail: ReturnType<typeof describeLockedEntityKeyFilter> =
        describeLockedEntityKeyFilter({
          rows: signal,
        });

      expect(detail.searchToken).toBeUndefined();
      expect(detail.searchTokenUnavailableReason).toBe(
        ENTITY_KEY_NO_ATTRIBUTES_REASON,
      );
    },
  );

  test.each(SIGNALS)(
    "%s: attributes that cannot be spelled fall back to the reason",
    (signal: TelemetrySignal) => {
      const detail: ReturnType<typeof describeLockedEntityKeyFilter> =
        describeLockedEntityKeyFilter({
          rows: signal,
          searchAttributes: { "bad key": "x" },
        });

      expect(detail.searchToken).toBeUndefined();
      expect(detail.searchTokenUnavailableReason).toBe(
        ENTITY_KEY_NO_ATTRIBUTES_REASON,
      );
    },
  );

  test.each(["exceptions", "profiles"] as Array<EntityKeyScopedRows>)(
    "%s: no search bar to paste into, so no token even with attributes",
    (rows: EntityKeyScopedRows) => {
      const detail: ReturnType<typeof describeLockedEntityKeyFilter> =
        describeLockedEntityKeyFilter({
          rows,
          searchAttributes: POD_IDENTIFYING,
        });

      expect(detail.searchToken).toBeUndefined();
      expect(detail.searchTokenUnavailableReason).toBe(
        ENTITY_KEY_NO_SYNTAX_REASON,
      );
    },
  );

  test("no reason ever sends the reader to a removed Open in button", () => {
    const expectedReasons: Array<[EntityKeyScopedRows, string]> = [
      ["logs", ENTITY_KEY_NO_ATTRIBUTES_REASON],
      ["traces", ENTITY_KEY_NO_ATTRIBUTES_REASON],
      ["metrics", ENTITY_KEY_NO_ATTRIBUTES_REASON],
      ["exceptions", ENTITY_KEY_NO_SYNTAX_REASON],
      ["profiles", ENTITY_KEY_NO_SYNTAX_REASON],
    ];

    for (const [rows, expectedReason] of expectedReasons) {
      const detail: ReturnType<typeof describeLockedEntityKeyFilter> =
        describeLockedEntityKeyFilter({ rows });

      expect(detail.searchToken).toBeUndefined();
      expect(detail.searchTokenUnavailableReason).toBe(expectedReason);
      expect(detail.searchTokenUnavailableReason).not.toMatch(
        /Open in|carried|explorer link/i,
      );
    }
  });

  test("the attributes decide only between the token and the reason", () => {
    // The detail is the syntax or why there is none — nothing rides along.
    expect(
      describeLockedEntityKeyFilter({
        rows: "traces",
        searchAttributes: POD_IDENTIFYING,
      }),
    ).toEqual({ searchToken: POD_SEARCH_TOKEN });
    expect(describeLockedEntityKeyFilter({ rows: "traces" })).toEqual({
      searchTokenUnavailableReason: ENTITY_KEY_NO_ATTRIBUTES_REASON,
    });
  });
});

type EntityKeyChipOfFunction = (
  chips: Array<ActiveFilter>,
  entityKey: string,
) => ActiveFilter;

const entityKeyChipOf: EntityKeyChipOfFunction = (
  chips: Array<ActiveFilter>,
  entityKey: string,
): ActiveFilter => {
  const chip: ActiveFilter | undefined = chips.find(
    (candidate: ActiveFilter) => {
      return (
        candidate.facetKey === ENTITY_KEYS_FACET_KEY &&
        candidate.value === entityKey
      );
    },
  );

  expect(chip).toBeDefined();

  return chip!;
};

describe("an Inventory item's pill shows attribute syntax on every viewer", () => {
  test("shared builder: the chip names the item and carries the token", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
      displays: podDisplays(),
    });

    expect(chips).toHaveLength(1);
    expect(chips[0]!.displayKey).toBe("Kubernetes Pod");
    expect(chips[0]!.displayValue).toBe("checkout-7d9f");
    expect(chips[0]!.readOnly).toBe(true);
    expect(chips[0]!.lockedDetail!.searchToken).toBe(POD_SEARCH_TOKEN);
    expect(
      chips[0]!.lockedDetail!.searchTokenUnavailableReason,
    ).toBeUndefined();
  });

  test("shared builder: a key the page did not name has no token", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY, OTHER_KEY],
      displays: podDisplays(),
    });

    expect(entityKeyChipOf(chips, POD_KEY).lockedDetail!.searchToken).toBe(
      POD_SEARCH_TOKEN,
    );
    expect(
      entityKeyChipOf(chips, POD_KEY).lockedDetail!
        .searchTokenUnavailableReason,
    ).toBeUndefined();
    expect(
      entityKeyChipOf(chips, OTHER_KEY).lockedDetail!.searchToken,
    ).toBeUndefined();
    expect(
      entityKeyChipOf(chips, OTHER_KEY).lockedDetail!
        .searchTokenUnavailableReason,
    ).toBe(ENTITY_KEY_NO_ATTRIBUTES_REASON);
  });

  test.each(SIGNALS)(
    "%s: several pinned keys, each chip spells only its own entity",
    (signal: TelemetrySignal) => {
      /*
       * A page pinning two named items gets one pill per key. Each pill's
       * syntax is that item's attributes alone — never the other item's, and
       * never both AND-ed into a search that matches neither.
       */
      const displays: LockedEntityKeyDisplayMap = {
        [POD_KEY]: {
          displayKey: "Host",
          displayValue: "web-01",
          searchAttributes: { "host.name": "web-01" },
        },
        [OTHER_KEY]: {
          displayKey: "Host",
          displayValue: "web-02",
          searchAttributes: { "host.name": "web-02" },
        },
      };

      const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
        rows: signal,
        entityKeys: [POD_KEY, OTHER_KEY],
        displays,
      });

      expect(chips).toHaveLength(2);
      expect(entityKeyChipOf(chips, POD_KEY).lockedDetail!.searchToken).toBe(
        "@resource.host.name:web-01",
      );
      expect(
        entityKeyChipOf(chips, POD_KEY).lockedDetail!
          .searchTokenUnavailableReason,
      ).toBeUndefined();
      expect(entityKeyChipOf(chips, OTHER_KEY).lockedDetail!.searchToken).toBe(
        "@resource.host.name:web-02",
      );
      expect(
        entityKeyChipOf(chips, OTHER_KEY).lockedDetail!
          .searchTokenUnavailableReason,
      ).toBeUndefined();
    },
  );

  test("logs: the decoration step keeps the builder's token (same chip object) with no displays input", () => {
    /*
     * The Logs viewer runs every locked chip through this step. It has no
     * describer for the entity-key column, so the chip the builder spelled
     * from the item's attributes passes through untouched.
     */
    const built: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
      displays: podDisplays(),
    });
    const chips: Array<ActiveFilter> = attachLogsLockedFilterDetails(built, {});

    expect(entityKeyChipOf(chips, POD_KEY)).toBe(built[0]);
    expect(entityKeyChipOf(chips, POD_KEY).lockedDetail!.searchToken).toBe(
      POD_SEARCH_TOKEN,
    );
    expect(
      entityKeyChipOf(chips, POD_KEY).lockedDetail!
        .searchTokenUnavailableReason,
    ).toBeUndefined();
  });

  test("logs: a chip built without displays keeps its reason through the decoration step", () => {
    const built: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
    });
    const chips: Array<ActiveFilter> = attachLogsLockedFilterDetails(built, {});

    expect(entityKeyChipOf(chips, POD_KEY)).toBe(built[0]);
    expect(
      entityKeyChipOf(chips, POD_KEY).lockedDetail!.searchToken,
    ).toBeUndefined();
    expect(
      entityKeyChipOf(chips, POD_KEY).lockedDetail!
        .searchTokenUnavailableReason,
    ).toBe(ENTITY_KEY_NO_ATTRIBUTES_REASON);
  });

  test("traces: the page's entity-key chip carries the token", () => {
    const chips: Array<ActiveFilter> = buildTracesLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY],
      displays: podDisplays(),
      lockedChips: [],
    });

    expect(entityKeyChipOf(chips, POD_KEY).lockedDetail!.searchToken).toBe(
      POD_SEARCH_TOKEN,
    );
    expect(
      entityKeyChipOf(chips, POD_KEY).lockedDetail!
        .searchTokenUnavailableReason,
    ).toBeUndefined();
  });

  test("metrics: the page's entity-key chip carries the token", () => {
    const chips: Array<ActiveFilter> = buildMetricsActiveFilterChips({
      scopeIds: undefined,
      scopeEntityType: undefined,
      attributeFilters: undefined,
      entityKeysFilter: [POD_KEY],
      entityKeyDisplays: podDisplays(),
      activeFilters: [],
      facetConfigs: [],
      nameMap: {},
    });

    expect(entityKeyChipOf(chips, POD_KEY).lockedDetail!.searchToken).toBe(
      POD_SEARCH_TOKEN,
    );
    expect(
      entityKeyChipOf(chips, POD_KEY).lockedDetail!
        .searchTokenUnavailableReason,
    ).toBeUndefined();
  });

  test("a host item's token restores the host name's case on all three viewers", () => {
    const displays: LockedEntityKeyDisplayMap = buildInventoryEntityKeyDisplays(
      {
        entityKey: POD_KEY,
        entityType: "host",
        displayName: "web-prod-01",
        identifyingAttributes: { "host.name": "web-prod-01" },
        descriptiveAttributes: { "host.name": "WEB-Prod-01" },
      },
    );

    for (const signal of SIGNALS) {
      const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
        rows: signal,
        entityKeys: [POD_KEY],
        displays,
      });

      expect(chips[0]!.lockedDetail!.searchToken).toBe(
        "@resource.host.name:WEB-Prod-01",
      );
      expect(
        chips[0]!.lockedDetail!.searchTokenUnavailableReason,
      ).toBeUndefined();
    }
  });

  test("an identity value the grammar reads specially is quoted, and a numeric one is spelled as its digits, on all three viewers", () => {
    const hostDisplays: LockedEntityKeyDisplayMap =
      buildInventoryEntityKeyDisplays({
        entityKey: POD_KEY,
        entityType: "host",
        displayName: "web 01",
        identifyingAttributes: { "host.name": "web 01" },
      });
    const processDisplays: LockedEntityKeyDisplayMap =
      buildInventoryEntityKeyDisplays({
        entityKey: OTHER_KEY,
        entityType: "process",
        displayName: "worker",
        identifyingAttributes: { "host.name": "web-01", "process.pid": 1234 },
      });

    for (const signal of SIGNALS) {
      expect(
        entityKeyChipOf(
          buildLockedEntityKeyChips({
            rows: signal,
            entityKeys: [POD_KEY],
            displays: hostDisplays,
          }),
          POD_KEY,
        ).lockedDetail,
      ).toStrictEqual({ searchToken: '@resource.host.name:"web 01"' });

      expect(
        entityKeyChipOf(
          buildLockedEntityKeyChips({
            rows: signal,
            entityKeys: [OTHER_KEY],
            displays: processDisplays,
          }),
          OTHER_KEY,
        ).lockedDetail,
      ).toStrictEqual({
        searchToken: "@resource.host.name:web-01 @resource.process.pid:1234",
      });
    }
  });

  test("an item whose identity cannot be spelled has no token on any surface, and each surface gives its own reason", () => {
    const unspellableItems: Array<[string, unknown]> = [
      ["no identifying attributes", undefined],
      ["a key the search bar cannot type", { "host name": "web-01" }],
      ["an empty identity value", { "process.pid": "" }],
      [
        "an identity minted outside telemetry",
        { [MANUAL_ENTITY_IDENTITY_ATTRIBUTE]: "payments vendor api" },
      ],
      [
        "an Inventory-table identity",
        { [INVENTORY_ENTITY_IDENTITY_ATTRIBUTE]: "651a000000000000000000aa" },
      ],
    ];

    const reasonByRows: Array<[EntityKeyScopedRows, string]> = [
      ["logs", ENTITY_KEY_NO_ATTRIBUTES_REASON],
      ["traces", ENTITY_KEY_NO_ATTRIBUTES_REASON],
      ["metrics", ENTITY_KEY_NO_ATTRIBUTES_REASON],
      ["exceptions", ENTITY_KEY_NO_SYNTAX_REASON],
      ["profiles", ENTITY_KEY_NO_SYNTAX_REASON],
    ];

    for (const [, identifyingAttributes] of unspellableItems) {
      const displays: LockedEntityKeyDisplayMap =
        buildInventoryEntityKeyDisplays({
          entityKey: POD_KEY,
          entityType: "host",
          displayName: "web-01",
          identifyingAttributes,
        });

      for (const [rows, reason] of reasonByRows) {
        const chip: ActiveFilter = entityKeyChipOf(
          buildLockedEntityKeyChips({
            rows,
            entityKeys: [POD_KEY],
            displays,
          }),
          POD_KEY,
        );

        expect(chip.lockedDetail).toStrictEqual({
          searchTokenUnavailableReason: reason,
        });
        expect(chip.lockedDetail).not.toHaveProperty("searchToken");
      }
    }
  });
});

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type ReadSourceFunction = (...relativeParts: Array<string>) => string;

const readSource: ReadSourceFunction = (
  ...relativeParts: Array<string>
): string => {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
};

type SliceFromFunction = (source: string, marker: string) => string;

// From the marker to the end of its balanced parenthesised call.
const sliceCall: SliceFromFunction = (
  source: string,
  marker: string,
): string => {
  const start: number = source.indexOf(marker);

  expect(start).toBeGreaterThanOrEqual(0);

  let depth: number = 0;

  for (let index: number = start; index < source.length; index++) {
    const character: string = source[index]!;

    if (character === "(") {
      depth++;
    } else if (character === ")") {
      depth--;

      if (depth === 0) {
        return source.substring(start, index + 1);
      }
    }
  }

  return source.substring(start);
};

describe("the wiring that gets the attributes to the pill", () => {
  test("the Inventory shell hands the item's identifying and descriptive attributes to the display builder", () => {
    const shell: string = readSource(
      "Pages",
      "Inventory",
      "View",
      "InventorySignalPage.tsx",
    );
    const call: string = sliceCall(shell, "buildInventoryEntityKeyDisplays(");

    expect(call).toContain(
      "identifyingAttributes: item?.identifyingAttributes",
    );
    expect(call).toContain(
      "descriptiveAttributes: item?.descriptiveAttributes",
    );
    // …and the memo rebuilds when either changes.
    expect(shell).toContain(
      "item?.identifyingAttributes, item?.descriptiveAttributes",
    );
  });

  test("the item hook loads both attribute maps", () => {
    const hook: string = readSource(
      "Components",
      "Inventory",
      "useInventoryItem.ts",
    );

    expect(hook).toContain("identifyingAttributes: true");
    expect(hook).toContain("descriptiveAttributes: true");
  });

  test("the Logs viewer hands its entity-key displays to the chip builder, not to the decoration step", () => {
    const viewer: string = readSource("Components", "Logs", "LogsViewer.tsx");

    expect(sliceCall(viewer, "buildLockedEntityKeyChips(")).toContain(
      "displays: props.entityKeyDisplays",
    );

    const call: string = sliceCall(
      viewer,
      "attachLogsLockedFilterDetails(filters,",
    );

    expect(call).toContain("logQueryAttributes");
    expect(call).not.toContain("entityKeyDisplays");
  });
});
