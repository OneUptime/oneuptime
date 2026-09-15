import { describe, expect, test } from "@jest/globals";
import EntityType from "Common/Types/Telemetry/EntityType";
import type { ActiveFilter } from "Common/UI/Components/LogsViewer/types";
/*
 * STATIC imports, on purpose: the chip builder, its describer and the
 * Inventory display map are all imported by the logs viewer's chip memo and
 * must stay loadable from plain Node. If one of them starts dragging
 * RouteMap / Navigation / Common/UI/Config in, this suite fails at load.
 */
import {
  LockedEntityKeyDisplayMap,
  buildLockedEntityKeyChips,
  normalizeLockedEntityKeys,
} from "../../FeatureSet/Dashboard/src/Utils/LockedEntityKeyChips";
import {
  CANNOT_TRAVEL_REASON,
  DEFAULT_ENTITY_KEY_DISPLAY_KEY,
  ENTITY_KEYS_FACET_KEY,
  LOCKED_FILTER_SOURCE_PAGE,
  LOCKED_FILTER_SOURCE_STORED_QUERY,
  buildLockedScopeCopyText,
  describeLockedEntityKeyFilter,
} from "../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScope";
import { buildInventoryEntityKeyDisplays } from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryTelemetryScope";

/*
 * The locked chips the logs viewer builds for an entity-key scope — what an
 * Inventory item's Logs page shows above its list. Only the `logs` rows noun
 * is exercised here; the viewer's glue (dispatch, decoration, Copy / Open in
 * Logs) is pinned in LogsLockedScope.test.ts and the wiring in
 * LogsLockedScopeWiring.test.ts. The explanation's wording is owned by
 * LockedTelemetryScope.test.ts: here each chip is compared to the describer,
 * with the logs sentence spelled out.
 */

const POD_KEY: string = "3f9a1b2c4d5e6f70";
const NODE_KEY: string = "aaaaaaaaaaaaaaaa";

const NO_TRAVEL: string =
  "This filter cannot be copied or carried to the explorer.";

type ChipTextFunction = (chip: ActiveFilter) => string;

const chipText: ChipTextFunction = (chip: ActiveFilter): string => {
  return `${chip.displayKey}: ${chip.displayValue}`;
};

describe("buildLockedEntityKeyChips for logs", () => {
  test('an Inventory item\'s pod reads "Kubernetes Pod: checkout-7d9f", locked, with its whole explanation', () => {
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
        lockedDetail: describeLockedEntityKeyFilter({
          rows: "logs",
          entityKey: POD_KEY,
          entityKeys: [POD_KEY],
          entityTypeLabel: "Kubernetes Pod",
        }),
      },
    ]);
    expect(chips[0]!.lockedDetail!.summary).toBe(
      "Only logs linked to this Kubernetes Pod are shown.",
    );
    expect(chips[0]!.facetKey).toBe(ENTITY_KEYS_FACET_KEY);
    expect(chips[0]!.lockedDetail!.source).toBe(LOCKED_FILTER_SOURCE_PAGE);
    expect(chips[0]!.lockedDetail!.searchTokenUnavailableReason).toBe(
      CANNOT_TRAVEL_REASON,
    );
    // A locked chip: no remove button, no open-link, no search token.
    expect(chips[0]!.openRoute).toBeUndefined();
    expect(chips[0]!.lockedDetail!.searchToken).toBeUndefined();
  });

  test('without a display map the chip still renders, as "Resource: <key>" — never an empty chip bar', () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
    });

    expect(chips.map(chipText)).toEqual(["Resource: 3f9a1b2c4d5e6f70"]);
    expect(chips[0]!.displayKey).toBe(DEFAULT_ENTITY_KEY_DISPLAY_KEY);
    expect(chips[0]!.readOnly).toBe(true);
    expect(chips[0]!.lockedDetail!.summary).toBe(
      "Only logs linked to this resource are shown.",
    );
  });

  test("an empty display map is the same as none", () => {
    expect(
      buildLockedEntityKeyChips({
        rows: "logs",
        entityKeys: [POD_KEY],
        displays: {},
      }),
    ).toEqual(
      buildLockedEntityKeyChips({ rows: "logs", entityKeys: [POD_KEY] }),
    );
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
      expect(chips[0]!.lockedDetail!.summary).toBe(
        "Only logs linked to this resource are shown.",
      );
    }
  });

  test("only a type name: the key names the chip's value, the type names the summary", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
      displays: { [POD_KEY]: { displayKey: "Host", displayValue: "  " } },
    });

    expect(chips.map(chipText)).toEqual(["Host: 3f9a1b2c4d5e6f70"]);
    expect(chips[0]!.lockedDetail!.summary).toBe(
      "Only logs linked to this Host are shown.",
    );
  });

  test('only a name: "Resource: <name>", and the summary says "resource"', () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
      displays: { [POD_KEY]: { displayKey: " ", displayValue: "web-01" } },
    });

    expect(chips.map(chipText)).toEqual(["Resource: web-01"]);
    expect(chips[0]!.lockedDetail!.summary).toBe(
      "Only logs linked to this resource are shown.",
    );
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
    expect(chips[0]!.lockedDetail!.summary).toBe(
      "Only logs linked to this Kubernetes Pod are shown.",
    );
  });

  test("an Inventory item without a name or type still gets a named chip", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
      displays: buildInventoryEntityKeyDisplays({ entityKey: POD_KEY }),
    });

    expect(chips.map(chipText)).toEqual(["Inventory Item: 3f9a1b2c4d5e6f70"]);
    expect(chips[0]!.lockedDetail!.summary).toBe(
      "Only logs linked to this Inventory Item are shown.",
    );
  });

  test("several keys: one chip each, in page order, each saying the scope widens", () => {
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
    expect(
      chips.map((chip: ActiveFilter): string => {
        return chip.lockedDetail!.summary;
      }),
    ).toEqual([
      "Logs linked to this Kubernetes Pod are shown, along with logs linked to the 1 other resource this page pins.",
      "Logs linked to this Kubernetes Node are shown, along with logs linked to the 1 other resource this page pins.",
    ]);
    expect(chips[1]!.lockedDetail).toStrictEqual(
      describeLockedEntityKeyFilter({
        rows: "logs",
        entityKey: NODE_KEY,
        entityKeys: [POD_KEY, NODE_KEY],
        entityTypeLabel: "Kubernetes Node",
      }),
    );

    for (const chip of chips) {
      expect(chip.readOnly).toBe(true);
      expect(chip.facetKey).toBe("entityKeys");
      expect(chip.lockedDetail!.searchToken).toBeUndefined();
      expect(chip.lockedDetail!.searchTokenUnavailableReason).toBe(NO_TRAVEL);
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
    // Counted after the collapse: one other resource, not four.
    expect(chips[0]!.lockedDetail!.summary).toBe(
      "Logs linked to this resource are shown, along with logs linked to the 1 other resource this page pins.",
    );
    expect(normalizeLockedEntityKeys([` ${POD_KEY} `, "", POD_KEY])).toEqual([
      POD_KEY,
    ]);
  });

  test("a key the display map does not know falls back on its own while its neighbour keeps its name", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY, NODE_KEY],
      displays: {
        [POD_KEY]: {
          displayKey: "Kubernetes Pod",
          displayValue: "checkout-7d9f",
        },
        "some-other-key": { displayKey: "Host", displayValue: "web-01" },
      },
    });

    expect(chips.map(chipText)).toEqual([
      "Kubernetes Pod: checkout-7d9f",
      "Resource: aaaaaaaaaaaaaaaa",
    ]);
  });

  test("keys a stored query pinned — an incident's log snapshot — are said to come from it, in the logs sentence", () => {
    /*
     * A log monitor writes `logQuery.entityKeys` from its stored query, so
     * the logs viewer hands those keys over as the stored query's. The chip
     * must neither say "Pinned by this page" nor count them as keys this
     * page pins.
     */
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY, NODE_KEY],
      source: LOCKED_FILTER_SOURCE_STORED_QUERY,
    });

    expect(
      chips.map((chip: ActiveFilter): [string, string] => {
        return [chip.lockedDetail!.source, chip.lockedDetail!.summary];
      }),
    ).toEqual([
      [
        "Pinned by the stored query this view was opened with",
        "Logs linked to this resource are shown, along with logs linked to the 1 other resource the stored query pins.",
      ],
      [
        "Pinned by the stored query this view was opened with",
        "Logs linked to this resource are shown, along with logs linked to the 1 other resource the stored query pins.",
      ],
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

  test('the logs rows noun is what every summary counts — not "traces" or "exceptions"', () => {
    const summaries: Array<string> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY, NODE_KEY],
    }).map((chip: ActiveFilter): string => {
      return chip.lockedDetail!.summary;
    });

    for (const summary of summaries) {
      expect(summary).toContain("logs linked to");
      expect(summary).not.toContain("traces");
      expect(summary).not.toContain("metrics");
      expect(summary).not.toContain("exceptions");
      expect(summary).not.toContain("profiles");
    }
  });
});

describe("Copy filter for entity-key chips", () => {
  test("an entity-key-only scope copies nothing — the logs grammar has no entity-key token", () => {
    expect(
      buildLockedScopeCopyText(
        "logs",
        buildLockedEntityKeyChips({
          rows: "logs",
          entityKeys: [POD_KEY, NODE_KEY],
        }),
      ),
    ).toBe("");
  });

  test("a bare chip with no explanation copies nothing either", () => {
    expect(
      buildLockedScopeCopyText("logs", [
        { facetKey: "entityKeys", value: POD_KEY },
      ]),
    ).toBe("");
  });
});
