/*
 * The locked pill an Inventory item's Exceptions tab was missing. The tab
 * narrows the list to exception groups with an occurrence carrying the
 * item's entity key, and the chip bar above it used to be empty — so a
 * filtered list read like every exception in the window.
 *
 * These tests pin what the pill says (exact user-visible text), when it
 * appears, and — just as important — that it is display only: it names
 * exactly the keys the instance scope filters on, never reaches the entity
 * name resolver, and cannot mark or unfold a facet in the sidebar. The
 * wiring that puts it on screen is pinned by ExceptionsLockedScopeWiring.
 *
 * The chip module imports the shared entity-name resolver, which imports
 * ModelAPI; it is mocked so nothing reaches the network.
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

import { describe, expect, test } from "@jest/globals";
import { JSONObject, ObjectType } from "Common/Types/JSON";
import Includes from "Common/Types/BaseDatabase/Includes";
import EntityType from "Common/Types/Telemetry/EntityType";
import { LockedFilterDetail } from "Common/Types/Telemetry/LockedFilterDetail";
import { RESOURCE_FACET_CATALOG_KEYS } from "Common/Types/Telemetry/ResourceFacetCatalog";
import {
  FacetVisibility,
  FacetVisibilityOptions,
  computeFacetVisibility,
} from "Common/UI/Components/TelemetryViewer/FacetVisibility";
import { ActiveFilter } from "Common/UI/Components/TelemetryViewer/types";
import {
  INVENTORY_ITEM_FALLBACK_DISPLAY_KEY,
  buildInventoryEntityKeyDisplays,
} from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryTelemetryScope";
import {
  ExceptionInstanceScope,
  buildExceptionEntityKeyScope,
  hasExceptionInstanceScope,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionsAttributeScope";
import {
  ExceptionEntityChipRef,
  buildExceptionEntityTypeHints,
  buildExceptionKnownChipIds,
  buildExceptionLockedEntityKeyChips,
  collectExceptionEntityChipIds,
  isExceptionNamedResourceFacetKey,
  resolveExceptionChipDisplay,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionsEntityChipDisplay";
import {
  ExceptionQueryScope,
  buildExceptionQueryScope,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionQueryScope";
import {
  LockedEntityKeyDisplay,
  LockedEntityKeyDisplayMap,
} from "../../FeatureSet/Dashboard/src/Utils/LockedEntityKeyChips";
import {
  DEFAULT_ENTITY_KEY_DISPLAY_KEY,
  ENTITY_KEYS_FACET_KEY,
  ENTITY_KEY_NO_ATTRIBUTES_REASON,
  ENTITY_KEY_NO_SYNTAX_REASON,
  LOCKED_FILTER_SOURCE_PAGE,
  describeLockedEntityKeyFilter,
} from "../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScope";

/*
 * The explanation's wording is owned by LockedTelemetryScope.test.ts. Here a
 * pill's detail is compared to the describer, with the exceptions sentence
 * and reason spelled out where they are what a test is about.
 */

const POD_KEY: string = "3f9a1b2c4d5e6f70";
const NODE_KEY: string = "9c8b7a6d5e4f3021";
const VOLUME_KEY: string = "0a1b2c3d4e5f6071";

const POD_DISPLAYS: LockedEntityKeyDisplayMap = buildInventoryEntityKeyDisplays(
  {
    entityKey: POD_KEY,
    entityType: EntityType.KubernetesPod,
    displayName: "checkout-7d9f",
  },
);

type FirstChipFunction = (chips: Array<ActiveFilter>) => ActiveFilter;

const onlyChip: FirstChipFunction = (
  chips: Array<ActiveFilter>,
): ActiveFilter => {
  expect(chips).toHaveLength(1);
  return chips[0]!;
};

type DetailOfFunction = (chip: ActiveFilter) => LockedFilterDetail;

const detailOf: DetailOfFunction = (chip: ActiveFilter): LockedFilterDetail => {
  expect(chip.lockedDetail).toBeDefined();
  return chip.lockedDetail!;
};

type ChipValuesFunction = (chips: Array<ActiveFilter>) => Array<string>;

const chipValues: ChipValuesFunction = (
  chips: Array<ActiveFilter>,
): Array<string> => {
  return chips.map((chip: ActiveFilter): string => {
    return chip.value;
  });
};

/*
 * The React key TelemetryActiveFilterChips gives a read-only chip. Two
 * pills with the same one would collide.
 */
type ReadOnlyChipKeyFunction = (chip: ExceptionEntityChipRef) => string;

const readOnlyChipKey: ReadOnlyChipKeyFunction = (
  chip: ExceptionEntityChipRef,
): string => {
  return `readonly:${chip.facetKey}:${chip.value}`;
};

describe("the words the pill is built from", () => {
  test("the facet, the fallback key, the source and the no-syntax reason read exactly as the chip bar shows them", () => {
    expect(ENTITY_KEYS_FACET_KEY).toBe("entityKeys");
    expect(DEFAULT_ENTITY_KEY_DISPLAY_KEY).toBe("Resource");
    expect(LOCKED_FILTER_SOURCE_PAGE).toBe("Pinned by this page");
    expect(ENTITY_KEY_NO_SYNTAX_REASON).toBe(
      "Entity keys have no search syntax.",
    );
    expect(INVENTORY_ITEM_FALLBACK_DISPLAY_KEY).toBe("Inventory Item");
  });
});

describe("buildExceptionLockedEntityKeyChips — an Inventory item's Exceptions tab", () => {
  test("REGRESSION: the tab gets a named, locked pill instead of an empty chip bar", () => {
    const chips: Array<ActiveFilter> = buildExceptionLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY],
      entityKeyDisplays: POD_DISPLAYS,
    });

    expect(chips).toEqual([
      {
        facetKey: "entityKeys",
        value: POD_KEY,
        displayKey: "Kubernetes Pod",
        displayValue: "checkout-7d9f",
        readOnly: true,
        lockedDetail: describeLockedEntityKeyFilter({
          rows: "exceptions",
          entityKey: POD_KEY,
          entityKeys: [POD_KEY],
          entityTypeLabel: "Kubernetes Pod",
        }),
      },
    ]);
    expect(detailOf(chips[0]!).summary).toBe(
      "Only exceptions linked to this Kubernetes Pod are shown.",
    );
  });

  test("the pill is read-only under the entityKeys facet, so the chip bar draws a lock with no remove button and no link", () => {
    const chip: ActiveFilter = onlyChip(
      buildExceptionLockedEntityKeyChips({
        entityKeysFilter: [POD_KEY],
        entityKeyDisplays: POD_DISPLAYS,
      }),
    );

    expect(chip.readOnly).toBe(true);
    expect(chip.facetKey).toBe(ENTITY_KEYS_FACET_KEY);
    // The value is the key the filter matches, never the display name.
    expect(chip.value).toBe(POD_KEY);
    expect(chip).not.toHaveProperty("openRoute");
  });

  test("the explanation names exceptions, has no search syntax to copy, and gives the exceptions reason rather than an explorer's", () => {
    const detail: LockedFilterDetail = detailOf(
      onlyChip(
        buildExceptionLockedEntityKeyChips({
          entityKeysFilter: [POD_KEY],
          entityKeyDisplays: POD_DISPLAYS,
        }),
      ),
    );

    expect(detail.summary).toBe(
      "Only exceptions linked to this Kubernetes Pod are shown.",
    );
    expect(detail.source).toBe("Pinned by this page");
    /*
     * No token: the chip's own tooltip renders no Copy button, and a
     * keyboard user is not told Enter copies anything.
     */
    expect(detail).not.toHaveProperty("searchToken");
    expect(detail.searchTokenUnavailableReason).toBe(
      "Entity keys have no search syntax.",
    );
    // Not the explorers' reason: exceptions have no search bar at all.
    expect(detail.searchTokenUnavailableReason).not.toBe(
      ENTITY_KEY_NO_ATTRIBUTES_REASON,
    );
    expect(detail.combinator).toBe("all");
    expect(detail.predicates).toEqual(
      describeLockedEntityKeyFilter({ rows: "exceptions", entityKey: POD_KEY })
        .predicates,
    );
  });

  test("an item that names its identifying attributes still gets no search syntax on the exceptions pill", () => {
    /*
     * The same display map spells the pill on the Logs, Traces and Metrics
     * tabs; the exceptions list has nowhere to paste it.
     */
    const detail: LockedFilterDetail = detailOf(
      onlyChip(
        buildExceptionLockedEntityKeyChips({
          entityKeysFilter: [POD_KEY],
          entityKeyDisplays: {
            [POD_KEY]: {
              displayKey: "Kubernetes Pod",
              displayValue: "checkout-7d9f",
              searchAttributes: {
                "k8s.cluster.name": "prod",
                "k8s.namespace.name": "shop",
                "k8s.pod.name": "checkout-7d9f",
              },
            },
          },
        }),
      ),
    );

    expect(detail).not.toHaveProperty("searchToken");
    expect(detail.searchTokenUnavailableReason).toBe(
      ENTITY_KEY_NO_SYNTAX_REASON,
    );
    expect(detail.summary).toBe(
      "Only exceptions linked to this Kubernetes Pod are shown.",
    );
  });

  test("an item without a type reads 'Inventory Item: <name>'", () => {
    const chip: ActiveFilter = onlyChip(
      buildExceptionLockedEntityKeyChips({
        entityKeysFilter: [POD_KEY],
        entityKeyDisplays: buildInventoryEntityKeyDisplays({
          entityKey: POD_KEY,
          displayName: "checkout-7d9f",
        }),
      }),
    );

    expect(chip.displayKey).toBe("Inventory Item");
    expect(chip.displayValue).toBe("checkout-7d9f");
    expect(detailOf(chip).summary).toBe(
      "Only exceptions linked to this Inventory Item are shown.",
    );
  });

  test("an item without a name shows its key as the value, still under its type", () => {
    const chip: ActiveFilter = onlyChip(
      buildExceptionLockedEntityKeyChips({
        entityKeysFilter: [POD_KEY],
        entityKeyDisplays: buildInventoryEntityKeyDisplays({
          entityKey: POD_KEY,
          entityType: EntityType.KubernetesPod,
          displayName: "   ",
        }),
      }),
    );

    expect(chip.displayKey).toBe("Kubernetes Pod");
    expect(chip.displayValue).toBe(POD_KEY);
    expect(detailOf(chip).summary).toBe(
      "Only exceptions linked to this Kubernetes Pod are shown.",
    );
  });

  test("a display map built for another item's key does not name this one", () => {
    const chip: ActiveFilter = onlyChip(
      buildExceptionLockedEntityKeyChips({
        entityKeysFilter: [NODE_KEY],
        entityKeyDisplays: POD_DISPLAYS,
      }),
    );

    expect(chip.displayKey).toBe("Resource");
    expect(chip.displayValue).toBe(NODE_KEY);
    expect(detailOf(chip).summary).toBe(
      "Only exceptions linked to this resource are shown.",
    );
  });
});

describe("buildExceptionLockedEntityKeyChips — without a name from the page", () => {
  test("REGRESSION: with no display map the pill still renders, as 'Resource: <key>'", () => {
    const chips: Array<ActiveFilter> = buildExceptionLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY],
    });

    expect(chips).toEqual([
      {
        facetKey: "entityKeys",
        value: POD_KEY,
        displayKey: "Resource",
        displayValue: POD_KEY,
        readOnly: true,
        lockedDetail: describeLockedEntityKeyFilter({
          rows: "exceptions",
          entityKey: POD_KEY,
          entityKeys: [POD_KEY],
        }),
      },
    ]);
    expect(detailOf(chips[0]!).summary).toBe(
      "Only exceptions linked to this resource are shown.",
    );
  });

  test("an empty display map, or an explicit undefined one, reads the same", () => {
    const fallback: Array<ActiveFilter> = buildExceptionLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY],
    });

    expect(
      buildExceptionLockedEntityKeyChips({
        entityKeysFilter: [POD_KEY],
        entityKeyDisplays: {},
      }),
    ).toEqual(fallback);
    expect(
      buildExceptionLockedEntityKeyChips({
        entityKeysFilter: [POD_KEY],
        entityKeyDisplays: undefined,
        storedScopeChips: undefined,
      }),
    ).toEqual(fallback);
  });

  test.each([
    ["empty strings", { displayKey: "", displayValue: "" }],
    ["whitespace", { displayKey: "   ", displayValue: "\t\n " }],
  ])(
    "a display entry of %s falls back to 'Resource: <key>'",
    (_label: string, display: LockedEntityKeyDisplay) => {
      const chip: ActiveFilter = onlyChip(
        buildExceptionLockedEntityKeyChips({
          entityKeysFilter: [POD_KEY],
          entityKeyDisplays: { [POD_KEY]: display },
        }),
      );

      expect(chip.displayKey).toBe("Resource");
      expect(chip.displayValue).toBe(POD_KEY);
      expect(detailOf(chip).summary).toBe(
        "Only exceptions linked to this resource are shown.",
      );
    },
  );

  test("a blank key with a real name keeps the name; a real key with a blank name shows the key", () => {
    const namedOnly: ActiveFilter = onlyChip(
      buildExceptionLockedEntityKeyChips({
        entityKeysFilter: [POD_KEY],
        entityKeyDisplays: {
          [POD_KEY]: { displayKey: " ", displayValue: "checkout-7d9f" },
        },
      }),
    );

    expect(namedOnly.displayKey).toBe("Resource");
    expect(namedOnly.displayValue).toBe("checkout-7d9f");
    expect(detailOf(namedOnly).summary).toBe(
      "Only exceptions linked to this resource are shown.",
    );

    const typedOnly: ActiveFilter = onlyChip(
      buildExceptionLockedEntityKeyChips({
        entityKeysFilter: [POD_KEY],
        entityKeyDisplays: {
          [POD_KEY]: { displayKey: "Kubernetes Pod", displayValue: "" },
        },
      }),
    );

    expect(typedOnly.displayKey).toBe("Kubernetes Pod");
    expect(typedOnly.displayValue).toBe(POD_KEY);
    expect(detailOf(typedOnly).summary).toBe(
      "Only exceptions linked to this Kubernetes Pod are shown.",
    );
  });

  test("the page's key and name are trimmed before they are shown", () => {
    const chip: ActiveFilter = onlyChip(
      buildExceptionLockedEntityKeyChips({
        entityKeysFilter: [POD_KEY],
        entityKeyDisplays: {
          [POD_KEY]: {
            displayKey: "  Kubernetes Pod ",
            displayValue: " checkout-7d9f\t",
          },
        },
      }),
    );

    expect(chip.displayKey).toBe("Kubernetes Pod");
    expect(chip.displayValue).toBe("checkout-7d9f");
    expect(detailOf(chip).summary).toBe(
      "Only exceptions linked to this Kubernetes Pod are shown.",
    );
  });

  test("a key the display map does not know falls back while the known key keeps its name", () => {
    const chips: Array<ActiveFilter> = buildExceptionLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY, NODE_KEY],
      entityKeyDisplays: POD_DISPLAYS,
    });

    expect(
      chips.map((chip: ActiveFilter): string => {
        return `${chip.displayKey}: ${chip.displayValue}`;
      }),
    ).toEqual(["Kubernetes Pod: checkout-7d9f", `Resource: ${NODE_KEY}`]);
  });
});

describe("buildExceptionLockedEntityKeyChips — several keys, duplicates and blanks", () => {
  test("one pill per key, in the page's order, each saying the scope widens rather than narrows", () => {
    const chips: Array<ActiveFilter> = buildExceptionLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY, NODE_KEY],
    });

    expect(chipValues(chips)).toEqual([POD_KEY, NODE_KEY]);

    for (const chip of chips) {
      expect(detailOf(chip)).toEqual(
        describeLockedEntityKeyFilter({
          rows: "exceptions",
          entityKey: chip.value,
          entityKeys: [POD_KEY, NODE_KEY],
        }),
      );
      expect(detailOf(chip).summary).toBe(
        "Exceptions linked to this resource are shown, along with exceptions linked to the 1 other resource this page pins.",
      );
      expect(detailOf(chip).searchTokenUnavailableReason).toBe(
        "Entity keys have no search syntax.",
      );
    }
  });

  test("three keys count two other resources", () => {
    const chips: Array<ActiveFilter> = buildExceptionLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY, NODE_KEY, VOLUME_KEY],
    });

    expect(chipValues(chips)).toEqual([POD_KEY, NODE_KEY, VOLUME_KEY]);

    for (const chip of chips) {
      expect(detailOf(chip).summary).toBe(
        "Exceptions linked to this resource are shown, along with exceptions linked to the 2 other resources this page pins.",
      );
    }

    expect(detailOf(chips[2]!).predicates[0]!.expression).toBe(
      `entityKeys has any of ${VOLUME_KEY}, ${POD_KEY}, ${NODE_KEY}`,
    );
  });

  test("a named key keeps its type in the widened wording; an unnamed one says resource", () => {
    const chips: Array<ActiveFilter> = buildExceptionLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY, NODE_KEY],
      entityKeyDisplays: POD_DISPLAYS,
    });

    expect(detailOf(chips[0]!).summary).toBe(
      "Exceptions linked to this Kubernetes Pod are shown, along with exceptions linked to the 1 other resource this page pins.",
    );
    expect(detailOf(chips[1]!).summary).toBe(
      "Exceptions linked to this resource are shown, along with exceptions linked to the 1 other resource this page pins.",
    );
  });

  test("duplicates and whitespace collapse to one pill, and a duplicate never counts as another resource", () => {
    const chips: Array<ActiveFilter> = buildExceptionLockedEntityKeyChips({
      entityKeysFilter: [` ${POD_KEY} `, POD_KEY, "", "   ", `${POD_KEY}\t`],
      entityKeyDisplays: POD_DISPLAYS,
    });

    expect(chips).toEqual(
      buildExceptionLockedEntityKeyChips({
        entityKeysFilter: [POD_KEY],
        entityKeyDisplays: POD_DISPLAYS,
      }),
    );
    expect(detailOf(onlyChip(chips)).summary).toBe(
      "Only exceptions linked to this Kubernetes Pod are shown.",
    );
  });

  test("the first spelling of a key decides its place in the row", () => {
    const chips: Array<ActiveFilter> = buildExceptionLockedEntityKeyChips({
      entityKeysFilter: [NODE_KEY, ` ${POD_KEY}`, NODE_KEY, VOLUME_KEY],
    });

    expect(chipValues(chips)).toEqual([NODE_KEY, POD_KEY, VOLUME_KEY]);
  });

  test.each([
    ["no key list", undefined],
    ["an empty key list", []],
    ["only blank keys", ["", "  ", "\t"]],
  ])(
    "%s builds no pill, even with a display map",
    (_label: string, entityKeysFilter: Array<string> | undefined) => {
      expect(
        buildExceptionLockedEntityKeyChips({
          entityKeysFilter,
          entityKeyDisplays: POD_DISPLAYS,
        }),
      ).toEqual([]);
    },
  );

  test("never mutates the page's key list, display map or stored chips", () => {
    const entityKeysFilter: Array<string> = [` ${POD_KEY}`, NODE_KEY, POD_KEY];
    const entityKeyDisplays: LockedEntityKeyDisplayMap = {
      [POD_KEY]: { displayKey: " Kubernetes Pod ", displayValue: "checkout" },
    };
    const storedScopeChips: Array<ExceptionEntityChipRef> = [
      { facetKey: "entityKeys", value: NODE_KEY },
    ];

    const keysBefore: Array<string> = [...entityKeysFilter];
    const displaysBefore: string = JSON.stringify(entityKeyDisplays);
    const storedBefore: string = JSON.stringify(storedScopeChips);

    buildExceptionLockedEntityKeyChips({
      entityKeysFilter,
      entityKeyDisplays,
      storedScopeChips,
    });

    expect(entityKeysFilter).toEqual(keysBefore);
    expect(JSON.stringify(entityKeyDisplays)).toBe(displaysBefore);
    expect(JSON.stringify(storedScopeChips)).toBe(storedBefore);
  });
});

describe("buildExceptionLockedEntityKeyChips — the pill names exactly what the list is filtered by", () => {
  test.each([
    ["one key", [POD_KEY]],
    ["several keys", [NODE_KEY, POD_KEY, VOLUME_KEY]],
    ["duplicates and blanks", [` ${NODE_KEY}`, POD_KEY, NODE_KEY, "", "  "]],
  ])(
    "with %s, the pills and the instance scope carry the same keys",
    (_label: string, entityKeysFilter: Array<string>) => {
      const scope: ExceptionInstanceScope =
        buildExceptionEntityKeyScope(entityKeysFilter);
      const membership: Includes = scope.columnPredicates[
        "entityKeys"
      ]![0] as Includes;
      const filtered: Array<string> = (membership.values as Array<unknown>)
        .map((value: unknown): string => {
          return String(value);
        })
        .sort();

      const pills: Array<string> = chipValues(
        buildExceptionLockedEntityKeyChips({ entityKeysFilter }),
      ).sort();

      expect(pills).toEqual(filtered);
    },
  );

  test.each([
    ["no key list", undefined],
    ["only blank keys", ["", " "]],
  ])(
    "with %s there is neither a scope nor a pill — never one without the other",
    (_label: string, entityKeysFilter: Array<string> | undefined) => {
      expect(
        hasExceptionInstanceScope(
          buildExceptionEntityKeyScope(entityKeysFilter),
        ),
      ).toBe(false);
      expect(buildExceptionLockedEntityKeyChips({ entityKeysFilter })).toEqual(
        [],
      );
    },
  );
});

describe("buildExceptionLockedEntityKeyChips — stored query scopes (the entity-scope regression)", () => {
  const STORED_ENTITY_KEY_QUERY: JSONObject = {
    entityKeys: { _type: ObjectType.Includes, value: [POD_KEY] },
  };

  test("the stored reader already shows a stored entity-key filter as its own 'Resource' chip", () => {
    const storedScope: ExceptionQueryScope = buildExceptionQueryScope(
      STORED_ENTITY_KEY_QUERY,
    );

    expect(storedScope.chips).toEqual([
      {
        facetKey: "entityKeys",
        value: POD_KEY,
        displayKey: "Resource",
        displayValue: POD_KEY,
      },
    ]);
  });

  test("REGRESSION: a key the stored query already shows gets no second pill, so no two pills share a React key", () => {
    const storedScope: ExceptionQueryScope = buildExceptionQueryScope(
      STORED_ENTITY_KEY_QUERY,
    );

    const chips: Array<ActiveFilter> = buildExceptionLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY, NODE_KEY],
      storedScopeChips: storedScope.chips,
    });

    expect(chipValues(chips)).toEqual([NODE_KEY]);

    const lockedRow: Array<ExceptionEntityChipRef> = [
      ...chips,
      ...storedScope.chips,
    ];
    const keys: Array<string> = lockedRow.map(readOnlyChipKey);

    expect(new Set<string>(keys).size).toBe(keys.length);
  });

  test("a host scoped only by its stored query gets no extra pill — its own chip already explains the scope", () => {
    const storedScope: ExceptionQueryScope = buildExceptionQueryScope(
      STORED_ENTITY_KEY_QUERY,
    );

    expect(
      buildExceptionLockedEntityKeyChips({
        entityKeysFilter: undefined,
        storedScopeChips: storedScope.chips,
      }),
    ).toEqual([]);
    expect(
      buildExceptionLockedEntityKeyChips({
        entityKeysFilter: [],
        storedScopeChips: storedScope.chips,
      }),
    ).toEqual([]);
  });

  test("only a stored chip on the entityKeys facet suppresses a key; the same text under another facet does not", () => {
    const chips: Array<ActiveFilter> = buildExceptionLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY],
      storedScopeChips: [
        { facetKey: "fingerprint", value: POD_KEY },
        { facetKey: "attributes.entityKeys", value: POD_KEY },
        { facetKey: "primaryEntityId", value: POD_KEY },
      ],
    });

    expect(chipValues(chips)).toEqual([POD_KEY]);
  });

  test("a stored key with stray whitespace still suppresses the same page key", () => {
    expect(
      buildExceptionLockedEntityKeyChips({
        entityKeysFilter: [POD_KEY],
        storedScopeChips: [{ facetKey: "entityKeys", value: ` ${POD_KEY} ` }],
      }),
    ).toEqual([]);
  });

  test("a stored scope with no entity keys leaves the page's pill exactly as it would be", () => {
    const storedScope: ExceptionQueryScope = buildExceptionQueryScope({
      exceptionType: "TypeError",
      attributes: { "resource.k8s.cluster.name": "prod" },
    });

    expect(storedScope.chips.length).toBeGreaterThan(0);
    expect(
      buildExceptionLockedEntityKeyChips({
        entityKeysFilter: [POD_KEY],
        entityKeyDisplays: POD_DISPLAYS,
        storedScopeChips: storedScope.chips,
      }),
    ).toEqual(
      buildExceptionLockedEntityKeyChips({
        entityKeysFilter: [POD_KEY],
        entityKeyDisplays: POD_DISPLAYS,
      }),
    );
  });
});

describe("buildExceptionLockedEntityKeyChips — display only", () => {
  const PILLS: Array<ActiveFilter> = buildExceptionLockedEntityKeyChips({
    entityKeysFilter: [POD_KEY, NODE_KEY],
    entityKeyDisplays: POD_DISPLAYS,
  });

  const PILL_REFS: Array<ExceptionEntityChipRef> = PILLS.map(
    (chip: ActiveFilter): ExceptionEntityChipRef => {
      return { facetKey: chip.facetKey, value: chip.value };
    },
  );

  test("the entityKeys facet is not an entity id, so a pill never reaches the name resolver or its type hints", () => {
    expect(isExceptionNamedResourceFacetKey("entityKeys")).toBe(false);
    expect(collectExceptionEntityChipIds({ chips: PILL_REFS })).toEqual([]);
    expect(
      collectExceptionEntityChipIds({
        chips: PILL_REFS,
        knownIds: {},
        isKnownIdsPending: false,
      }),
    ).toEqual([]);
    expect(buildExceptionEntityTypeHints({ chips: PILL_REFS })).toEqual({});
  });

  test("names keyed entityKeys are never indexed as ids the viewer already knows", () => {
    expect(
      buildExceptionKnownChipIds({
        facetConfigs: [
          {
            key: "entityKeys",
            title: "Resource",
            valueDisplayMap: { [POD_KEY]: "checkout-7d9f" },
          },
        ],
        facetDisplayNames: { entityKeys: { [POD_KEY]: "checkout-7d9f" } },
      }),
    ).toEqual({});
  });

  test("no resource facet is keyed entityKeys, so the sidebar has no row a pill could mark selected", () => {
    expect(RESOURCE_FACET_CATALOG_KEYS).not.toContain("entityKeys");
  });

  test("a selection under entityKeys cannot unfold, reveal or add a sidebar section", () => {
    const base: Omit<FacetVisibilityOptions, "activeValuesByKey"> = {
      keys: ["primaryEntityId", "hostId", "kubernetesClusterId"],
      facetData: {
        primaryEntityId: [],
        hostId: [],
        kubernetesClusterId: [{ value: "cluster-a", count: 3 }],
      },
      isHideable: (facetKey: string): boolean => {
        return facetKey !== "primaryEntityId";
      },
      searchExemptKeys: new Set<string>(),
      showHidden: false,
    };

    const withoutPill: FacetVisibility = computeFacetVisibility({
      ...base,
      activeValuesByKey: {},
    });
    const withPill: FacetVisibility = computeFacetVisibility({
      ...base,
      activeValuesByKey: {
        entityKeys: new Set<string>(chipValues(PILLS)),
      },
    });

    expect(withPill).toEqual(withoutPill);
    expect(withPill.visibleKeys).toEqual([
      "primaryEntityId",
      "kubernetesClusterId",
    ]);
    expect(withPill.hiddenKeys).toEqual(["hostId"]);
    expect(withPill.visibleKeys).not.toContain("entityKeys");
  });

  test("with no facet keyed entityKeys, the display resolver would hand a pill back unchanged", () => {
    for (const pill of PILLS) {
      expect(
        resolveExceptionChipDisplay({
          chip: pill,
          config: undefined,
          entityNames: undefined,
        }),
      ).toEqual(pill);
    }
  });
});
