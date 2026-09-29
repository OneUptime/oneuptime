import { describe, expect, test } from "@jest/globals";
import EntityType from "Common/Types/Telemetry/EntityType";
import type { LockedFilterDetail } from "Common/Types/Telemetry/LockedFilterDetail";
import type { ActiveFilter } from "Common/UI/Components/LogsViewer/types";
import { buildSearchTokenForFilter } from "Common/Utils/Telemetry/LockedFilterSearch";
/*
 * STATIC imports, on purpose: the chip builder and its describer are
 * imported by the logs viewer's chip memo, the Inventory display map by the
 * Inventory item's page that hands it over, and all must stay loadable from
 * plain Node. If one of them starts dragging RouteMap / Navigation /
 * Common/UI/Config in, this suite fails at load.
 */
import {
  LockedEntityKeyDisplayMap,
  buildLockedEntityKeyChips,
  normalizeLockedEntityKeys,
} from "../../FeatureSet/Dashboard/src/Utils/LockedEntityKeyChips";
import {
  DEFAULT_ENTITY_KEY_DISPLAY_KEY,
  ENTITY_KEYS_FACET_KEY,
  ENTITY_KEY_NO_ATTRIBUTES_REASON,
  ENTITY_KEY_NO_SYNTAX_REASON,
  EntityKeyScopedRows,
  describeLockedEntityKeyFilter,
} from "../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScope";
import { buildInventoryEntityKeyDisplays } from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryTelemetryScope";

/*
 * The locked chips the logs viewer builds for an entity-key scope — what an
 * Inventory item's Logs page shows above its list. Only the `logs` rows are
 * exercised here, bar one contrast with the exceptions and profiles lists;
 * the viewer's glue (dispatch, and the decoration step these chips pass
 * through untouched) is pinned in LogsLockedScope.test.ts and the wiring in
 * LogsLockedScopeWiring.test.ts. Each chip's tooltip carries the logs search
 * syntax this builder spelled with the entity's identifying resource
 * attributes, or — when the page did not hand them over — the reason there
 * is none; both are spelled out exactly here.
 */

const POD_KEY: string = "3f9a1b2c4d5e6f70";
const NODE_KEY: string = "aaaaaaaaaaaaaaaa";

const NO_ATTRIBUTES: string = ENTITY_KEY_NO_ATTRIBUTES_REASON;

const NO_ATTRIBUTES_DETAIL: LockedFilterDetail = {
  searchTokenUnavailableReason: NO_ATTRIBUTES,
};

type ChipTextFunction = (chip: ActiveFilter) => string;

const chipText: ChipTextFunction = (chip: ActiveFilter): string => {
  return `${chip.displayKey}: ${chip.displayValue}`;
};

type ChipDetailFunction = (
  chip: ActiveFilter,
) => LockedFilterDetail | undefined;

const chipDetail: ChipDetailFunction = (
  chip: ActiveFilter,
): LockedFilterDetail | undefined => {
  return chip.lockedDetail;
};

describe("buildLockedEntityKeyChips for logs", () => {
  test('an Inventory item\'s pod reads "Kubernetes Pod: checkout-7d9f", locked, with the reason it has no search syntax', () => {
    const displays: LockedEntityKeyDisplayMap = buildInventoryEntityKeyDisplays(
      {
        entityKey: POD_KEY,
        entityType: EntityType.KubernetesPod,
        displayName: "checkout-7d9f",
      },
    );

    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
      displays,
    });

    expect(chips).toEqual([
      {
        facetKey: "entityKeys",
        value: POD_KEY,
        displayKey: "Kubernetes Pod",
        displayValue: "checkout-7d9f",
        readOnly: true,
        lockedDetail: describeLockedEntityKeyFilter({ rows: "logs" }),
      },
    ]);
    expect(chips[0]!.facetKey).toBe(ENTITY_KEYS_FACET_KEY);
    /*
     * A locked chip has no open route; and with no identifying attributes
     * handed over, the item has nothing to spell a search token with.
     */
    expect(chips[0]!.openRoute).toBeUndefined();
    expect(chips[0]!.lockedDetail).toStrictEqual(NO_ATTRIBUTES_DETAIL);
    expect(chips[0]!.lockedDetail!.searchToken).toBeUndefined();
    expect(chips[0]!.lockedDetail!.searchTokenUnavailableReason).toBe(
      NO_ATTRIBUTES,
    );
  });

  test('without a display map the chip still renders, as "Resource: <key>" — never an empty chip bar', () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
    });

    expect(chips.map(chipText)).toEqual(["Resource: 3f9a1b2c4d5e6f70"]);
    expect(chips[0]!.displayKey).toBe(DEFAULT_ENTITY_KEY_DISPLAY_KEY);
    expect(chips[0]!.readOnly).toBe(true);
    expect(chips[0]!.lockedDetail).toStrictEqual(NO_ATTRIBUTES_DETAIL);
  });

  test("an empty display map is the same as none", () => {
    const withEmptyMap: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
      displays: {},
    });

    expect(withEmptyMap).toEqual(
      buildLockedEntityKeyChips({ rows: "logs", entityKeys: [POD_KEY] }),
    );
    expect(withEmptyMap.map(chipDetail)).toStrictEqual([NO_ATTRIBUTES_DETAIL]);
  });

  test('blank and whitespace display strings fall back to the key and "Resource"', () => {
    for (const display of [
      { displayKey: "", displayValue: "" },
      { displayKey: "   ", displayValue: "\t \n" },
    ]) {
      const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
        rows: "logs",
        entityKeys: [POD_KEY],
        displays: { [POD_KEY]: display },
      });

      expect(chips.map(chipText)).toEqual(["Resource: 3f9a1b2c4d5e6f70"]);
      expect(chips[0]!.lockedDetail).toStrictEqual(NO_ATTRIBUTES_DETAIL);
    }
  });

  test("only a type name: the type names the chip's key, the entity key its value", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
      displays: { [POD_KEY]: { displayKey: "Host", displayValue: "  " } },
    });

    expect(chips.map(chipText)).toEqual(["Host: 3f9a1b2c4d5e6f70"]);
    expect(chips[0]!.lockedDetail).toStrictEqual(NO_ATTRIBUTES_DETAIL);
  });

  test('only a name: "Resource: <name>"', () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
      displays: { [POD_KEY]: { displayKey: " ", displayValue: "web-01" } },
    });

    expect(chips.map(chipText)).toEqual(["Resource: web-01"]);
    expect(chips[0]!.lockedDetail).toStrictEqual(NO_ATTRIBUTES_DETAIL);
  });

  test("padding around the page's display strings is trimmed", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
      displays: {
        [POD_KEY]: { displayKey: "  Kubernetes Pod ", displayValue: " api-0 " },
      },
    });

    expect(chips.map(chipText)).toEqual(["Kubernetes Pod: api-0"]);
    expect(chips[0]!.lockedDetail).toStrictEqual(NO_ATTRIBUTES_DETAIL);
  });

  test("an Inventory item without a name or type still gets a named chip", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
      displays: buildInventoryEntityKeyDisplays({ entityKey: POD_KEY }),
    });

    expect(chips.map(chipText)).toEqual(["Inventory Item: 3f9a1b2c4d5e6f70"]);
    expect(chips[0]!.lockedDetail).toStrictEqual(NO_ATTRIBUTES_DETAIL);
  });

  test("several keys: one chip each, in page order, each described on its own", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY, NODE_KEY],
      displays: {
        [POD_KEY]: {
          displayKey: "Kubernetes Pod",
          displayValue: "checkout-7d9f",
        },
        [NODE_KEY]: { displayKey: "Kubernetes Node", displayValue: "node-a" },
      },
    });

    expect(chips.map(chipText)).toEqual([
      "Kubernetes Pod: checkout-7d9f",
      "Kubernetes Node: node-a",
    ]);
    expect(chips[1]!.lockedDetail).toStrictEqual(
      describeLockedEntityKeyFilter({ rows: "logs" }),
    );
    expect(chips.map(chipDetail)).toStrictEqual([
      NO_ATTRIBUTES_DETAIL,
      NO_ATTRIBUTES_DETAIL,
    ]);

    for (const chip of chips) {
      expect(chip.readOnly).toBe(true);
      expect(chip.facetKey).toBe("entityKeys");
      expect(chip.lockedDetail!.searchToken).toBeUndefined();
      expect(chip.lockedDetail!.searchTokenUnavailableReason).toBe(
        NO_ATTRIBUTES,
      );
    }
  });

  test("duplicate, padded and blank keys collapse to one chip per real key — the chip row keys pills by facet and value", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [
        ` ${POD_KEY} `,
        "",
        POD_KEY,
        "   ",
        NODE_KEY,
        `${NODE_KEY}\t`,
      ],
    });

    expect(
      chips.map((chip: ActiveFilter): string => {
        return chip.value;
      }),
    ).toEqual([POD_KEY, NODE_KEY]);
    expect(chips.map(chipText)).toEqual([
      "Resource: 3f9a1b2c4d5e6f70",
      "Resource: aaaaaaaaaaaaaaaa",
    ]);
    expect(chips.map(chipDetail)).toStrictEqual([
      NO_ATTRIBUTES_DETAIL,
      NO_ATTRIBUTES_DETAIL,
    ]);
    expect(normalizeLockedEntityKeys([` ${POD_KEY} `, "", POD_KEY])).toEqual([
      POD_KEY,
    ]);
  });

  test("a key the display map does not know falls back on its own while its neighbour keeps its name and its token", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY, NODE_KEY],
      displays: {
        [POD_KEY]: {
          displayKey: "Kubernetes Pod",
          displayValue: "checkout-7d9f",
          searchAttributes: { "k8s.pod.name": "checkout-7d9f" },
        },
        "some-other-key": {
          displayKey: "Host",
          displayValue: "web-01",
          searchAttributes: { "host.name": "web-01" },
        },
      },
    });

    expect(chips.map(chipText)).toEqual([
      "Kubernetes Pod: checkout-7d9f",
      "Resource: aaaaaaaaaaaaaaaa",
    ]);
    // The unknown key borrows neither the map's other name nor its attributes.
    expect(chips.map(chipDetail)).toStrictEqual([
      { searchToken: "@resource.k8s.pod.name:checkout-7d9f" },
      NO_ATTRIBUTES_DETAIL,
    ]);
  });

  test("no keys, no chips — undefined, empty and all-blank alike", () => {
    expect(
      buildLockedEntityKeyChips({ rows: "logs", entityKeys: undefined }),
    ).toEqual([]);
    expect(buildLockedEntityKeyChips({ rows: "logs", entityKeys: [] })).toEqual(
      [],
    );
    expect(
      buildLockedEntityKeyChips({
        rows: "logs",
        entityKeys: ["", "  "],
        displays: { "": { displayKey: "Host", displayValue: "web-01" } },
      }),
    ).toEqual([]);
  });

  test("logs rows have a search bar: the reason is the missing attributes, never the exceptions / profiles lists' no-syntax reason", () => {
    const logsChips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY, NODE_KEY],
    });

    expect(logsChips.map(chipDetail)).toStrictEqual([
      NO_ATTRIBUTES_DETAIL,
      NO_ATTRIBUTES_DETAIL,
    ]);

    for (const chip of logsChips) {
      expect(chip.lockedDetail!.searchTokenUnavailableReason).not.toBe(
        ENTITY_KEY_NO_SYNTAX_REASON,
      );
    }

    // The rows decide: the same keys on those lists have no syntax at all.
    const noSearchBarRows: Array<EntityKeyScopedRows> = [
      "exceptions",
      "profiles",
    ];

    for (const rows of noSearchBarRows) {
      expect(
        buildLockedEntityKeyChips({
          rows,
          entityKeys: [POD_KEY, NODE_KEY],
        }).map(chipDetail),
      ).toStrictEqual([
        { searchTokenUnavailableReason: ENTITY_KEY_NO_SYNTAX_REASON },
        { searchTokenUnavailableReason: ENTITY_KEY_NO_SYNTAX_REASON },
      ]);
    }
  });
});

describe("search syntax for entity-key chips on logs", () => {
  test("without the entity's attributes no chip carries a token — the logs grammar has no entity-key token", () => {
    /*
     * Also what an incident's log snapshot shows: a log monitor writes
     * `logQuery.entityKeys` from its stored query, and the logs viewer hands
     * those keys over without a display map, so they read like any other
     * keys the page cannot name.
     */
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY, NODE_KEY],
    });

    expect(chips).toHaveLength(2);

    for (const chip of chips) {
      expect(chip.lockedDetail).toStrictEqual(NO_ATTRIBUTES_DETAIL);
      expect(chip.lockedDetail!.searchToken).toBeUndefined();
      expect(chip.lockedDetail!.searchTokenUnavailableReason).toBe(
        NO_ATTRIBUTES,
      );
    }

    // Nor could the key itself be spelled: the column has no field token.
    expect(
      buildSearchTokenForFilter("logs", ENTITY_KEYS_FACET_KEY, POD_KEY),
    ).toBeNull();
  });

  test("an Inventory item's identifying attributes spell the logs chip's token; the key never appears in it", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
      displays: buildInventoryEntityKeyDisplays({
        entityKey: POD_KEY,
        entityType: EntityType.KubernetesPod,
        displayName: "checkout-7d9f",
        identifyingAttributes: {
          "k8s.cluster.name": "prod",
          "k8s.namespace.name": "shop",
          "k8s.pod.name": "checkout-7d9f",
        },
      }),
    });

    expect(chips.map(chipText)).toEqual(["Kubernetes Pod: checkout-7d9f"]);
    expect(chips[0]!.value).toBe(POD_KEY);
    expect(chips[0]!.lockedDetail).toStrictEqual({
      searchToken:
        "@resource.k8s.cluster.name:prod @resource.k8s.namespace.name:shop @resource.k8s.pod.name:checkout-7d9f",
    });
    expect(chips[0]!.lockedDetail!.searchToken).toBe(
      "@resource.k8s.cluster.name:prod @resource.k8s.namespace.name:shop @resource.k8s.pod.name:checkout-7d9f",
    );
    expect(chips[0]!.lockedDetail!.searchToken).not.toContain(POD_KEY);
    expect(
      chips[0]!.lockedDetail!.searchTokenUnavailableReason,
    ).toBeUndefined();
  });

  test("several keys with attributes: each chip's token spells only its own entity", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY, NODE_KEY],
      displays: {
        [POD_KEY]: {
          displayKey: "Kubernetes Pod",
          displayValue: "checkout-7d9f",
          searchAttributes: {
            "k8s.pod.name": "checkout-7d9f",
            "k8s.cluster.name": "prod",
          },
        },
        [NODE_KEY]: {
          displayKey: "Kubernetes Node",
          displayValue: "node-a",
          searchAttributes: {
            "k8s.node.name": "node-a",
            "k8s.cluster.name": "prod",
          },
        },
      },
    });

    expect(chips.map(chipText)).toEqual([
      "Kubernetes Pod: checkout-7d9f",
      "Kubernetes Node: node-a",
    ]);
    // Attributes in key order, AND-ed by the search bar; nothing from the neighbour.
    expect(chips.map(chipDetail)).toStrictEqual([
      {
        searchToken:
          "@resource.k8s.cluster.name:prod @resource.k8s.pod.name:checkout-7d9f",
      },
      {
        searchToken:
          "@resource.k8s.cluster.name:prod @resource.k8s.node.name:node-a",
      },
    ]);
  });
});
