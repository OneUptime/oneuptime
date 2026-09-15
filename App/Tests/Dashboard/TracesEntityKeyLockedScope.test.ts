/*
 * An Inventory item's Traces tab, end to end through the pure half of the
 * viewer: the item's own fields become the chip's names
 * (buildInventoryEntityKeyDisplays), and the names become the locked chip
 * (buildTracesLockedEntityKeyChips) whose tooltip shows the search syntax
 * that reproduces it on the Traces explorer. The viewer's call is pinned in
 * TracesLockedScopeWiring.test.ts.
 *
 * No search bar understands an entity key. So the item's chip is spelled
 * with the item's identifying resource attributes when the page hands them
 * over, and otherwise says plainly that it has no syntax — while a chip next
 * to it that does have one (a stored trace, a page attribute) keeps its own.
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  /*
   * The display module's entity-name resolver imports the API client. No
   * name is resolved here; the mock keeps the client (and whatever it reads
   * at load) out of this plain-Node suite.
   */
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

import { describe, expect, test } from "@jest/globals";
import type { ActiveFilter } from "Common/UI/Components/TelemetryViewer/types";
import type { LockedEntityKeyDisplayMap } from "../../FeatureSet/Dashboard/src/Utils/LockedEntityKeyChips";
// Pure modules: these are the builders the viewer's chip memo really runs.
import {
  SpanQueryScope,
  buildSpanQueryScope,
} from "../../FeatureSet/Dashboard/src/Utils/SpanQueryScope";
import {
  buildLockedAttributeChip,
  buildTracesLockedEntityKeyChips,
  describeStoredQueryChip,
  resolveTraceChipDisplay,
} from "../../FeatureSet/Dashboard/src/Components/Traces/TracesEntityDisplay";
import { buildInventoryEntityKeyDisplays } from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryTelemetryScope";
import {
  ENTITY_KEY_NO_ATTRIBUTES_REASON,
  NO_SEARCH_SYNTAX_REASON,
  describeLockedAttributeFilter,
} from "../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScope";

const POD_KEY: string = "3f9a1b2c4d5e6f70";
const NODE_KEY: string = "9c8b7a6d5e4f3021";
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";

type PodChipsFunction = () => Array<ActiveFilter>;

// A pod item the page names but whose identifying attributes it never read.
const podChips: PodChipsFunction = (): Array<ActiveFilter> => {
  return buildTracesLockedEntityKeyChips({
    entityKeysFilter: [POD_KEY],
    displays: buildInventoryEntityKeyDisplays({
      entityKey: POD_KEY,
      entityType: "k8s.pod",
      displayName: "checkout-7d9f",
    }),
    storedQueryEntityKeys: [],
    lockedChips: [],
  });
};

type StoredQueryChipsFunction = (scope: SpanQueryScope) => Array<ActiveFilter>;

/*
 * The viewer's stored-query loop for a scope nobody overrode: resolve each
 * chip, then describe it.
 */
const storedQueryChips: StoredQueryChipsFunction = (
  scope: SpanQueryScope,
): Array<ActiveFilter> => {
  return scope.chips.map(
    (scopeChip: {
      facetKey: string;
      value: string;
      displayKey: string;
      displayValue: string;
    }): ActiveFilter => {
      const resolved: ActiveFilter = resolveTraceChipDisplay(
        { ...scopeChip, readOnly: true },
        { facetConfigs: [] },
      );

      return {
        ...resolved,
        lockedDetail: describeStoredQueryChip(resolved),
      };
    },
  );
};

type SearchSyntaxOfFunction = (
  chips: Array<ActiveFilter>,
) => Array<[string, string | undefined, string | undefined]>;

// What each chip's tooltip shows: its token, or the reason it has none.
const searchSyntaxOf: SearchSyntaxOfFunction = (
  chips: Array<ActiveFilter>,
): Array<[string, string | undefined, string | undefined]> => {
  return chips.map(
    (chip: ActiveFilter): [string, string | undefined, string | undefined] => {
      return [
        chip.facetKey,
        chip.lockedDetail?.searchToken,
        chip.lockedDetail?.searchTokenUnavailableReason,
      ];
    },
  );
};

describe("an Inventory item's Traces tab names the item on its locked chip", () => {
  test("a pod reads 'Kubernetes Pod: <name>' and says the list is linked to it", () => {
    const chips: Array<ActiveFilter> = podChips();

    expect(chips).toHaveLength(1);
    expect(chips[0]!.facetKey).toBe("entityKeys");
    expect(chips[0]!.value).toBe(POD_KEY);
    expect(chips[0]!.displayKey).toBe("Kubernetes Pod");
    expect(chips[0]!.displayValue).toBe("checkout-7d9f");
    expect(chips[0]!.readOnly).toBe(true);
    expect(chips[0]!.lockedDetail!.source).toBe("Pinned by this page");
    expect(chips[0]!.lockedDetail!.summary).toBe(
      "Only traces linked to this Kubernetes Pod are shown.",
    );
  });

  test("an item with neither type nor name reads 'Inventory Item: <key>'", () => {
    const chips: Array<ActiveFilter> = buildTracesLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY],
      displays: buildInventoryEntityKeyDisplays({
        entityKey: POD_KEY,
      }),
    });

    expect(chips[0]!.displayKey).toBe("Inventory Item");
    expect(chips[0]!.displayValue).toBe(POD_KEY);
    expect(chips[0]!.lockedDetail!.summary).toBe(
      "Only traces linked to this Inventory Item are shown.",
    );
  });

  test("names the page holds for a different key do not rename this one", () => {
    const displays: LockedEntityKeyDisplayMap = buildInventoryEntityKeyDisplays(
      {
        entityKey: NODE_KEY,
        entityType: "k8s.pod",
        displayName: "checkout-7d9f",
      },
    );

    const chips: Array<ActiveFilter> = buildTracesLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY],
      displays,
    });

    expect(chips[0]!.displayKey).toBe("Resource");
    expect(chips[0]!.displayValue).toBe(POD_KEY);
  });

  test("an item without an entity key hands the viewer no names, and no filter means no chip", () => {
    expect(buildInventoryEntityKeyDisplays({})).toEqual({});
    expect(
      buildTracesLockedEntityKeyChips({
        entityKeysFilter: [],
        displays: buildInventoryEntityKeyDisplays({}),
      }),
    ).toEqual([]);
  });
});

describe("the search syntax each locked chip shows on an Inventory item's Traces tab", () => {
  test("an item whose identifying attributes the page never read has no syntax, and says why", () => {
    expect(searchSyntaxOf(podChips())).toEqual([
      ["entityKeys", undefined, ENTITY_KEY_NO_ATTRIBUTES_REASON],
    ]);
  });

  test("an item's identifying attributes spell its chip, one resource token per attribute in key order", () => {
    /*
     * The page's own call: the item's identifying attributes ride on its
     * display entry to the chip. The attribute rules themselves are the
     * Inventory scope's; this pins that they reach the Traces chip intact.
     */
    const chips: Array<ActiveFilter> = buildTracesLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY],
      displays: buildInventoryEntityKeyDisplays({
        entityKey: POD_KEY,
        entityType: "k8s.pod",
        displayName: "checkout-7d9f",
        identifyingAttributes: {
          "k8s.pod.name": "checkout-7d9f",
          "k8s.namespace.name": "shop",
          "k8s.cluster.name": "prod",
        },
      }),
      storedQueryEntityKeys: [],
      lockedChips: [],
    });

    expect(searchSyntaxOf(chips)).toEqual([
      [
        "entityKeys",
        "@resource.k8s.cluster.name:prod @resource.k8s.namespace.name:shop @resource.k8s.pod.name:checkout-7d9f",
        undefined,
      ],
    ]);
  });

  test("several unnamed keys: every chip says it has no syntax", () => {
    const chips: Array<ActiveFilter> = buildTracesLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY, NODE_KEY],
    });

    expect(searchSyntaxOf(chips)).toEqual([
      ["entityKeys", undefined, ENTITY_KEY_NO_ATTRIBUTES_REASON],
      ["entityKeys", undefined, ENTITY_KEY_NO_ATTRIBUTES_REASON],
    ]);
  });

  test("next to a stored trace: the trace's chip keeps its token, the resource's chip still has none", () => {
    const stored: Array<ActiveFilter> = storedQueryChips(
      buildSpanQueryScope({ traceId: TRACE_ID }),
    );

    const lockedChips: Array<ActiveFilter> = [
      ...stored,
      ...buildTracesLockedEntityKeyChips({
        entityKeysFilter: [POD_KEY],
        storedQueryEntityKeys: [],
        lockedChips: stored,
      }),
    ];

    expect(searchSyntaxOf(lockedChips)).toEqual([
      ["traceId", `trace:${TRACE_ID}`, undefined],
      ["entityKeys", undefined, ENTITY_KEY_NO_ATTRIBUTES_REASON],
    ]);
  });

  test("next to a page attribute: the attribute's chip keeps its token, the resource's chip still has none", () => {
    const attributeChip: ActiveFilter = buildLockedAttributeChip({
      key: "resource.host.name",
      value: "web-01",
    });

    const lockedChips: Array<ActiveFilter> = [
      ...podChips(),
      {
        ...attributeChip,
        lockedDetail: describeLockedAttributeFilter({
          signal: "traces",
          attributeKey: "resource.host.name",
          rawValue: "web-01",
          displayKey: attributeChip.displayKey,
          displayValue: attributeChip.displayValue,
        }),
      },
    ];

    expect(searchSyntaxOf(lockedChips)).toEqual([
      ["entityKeys", undefined, ENTITY_KEY_NO_ATTRIBUTES_REASON],
      [
        "attributes.resource.host.name",
        "@resource.host.name:web-01",
        undefined,
      ],
    ]);
  });

  test("a key the page and the stored query both pin is one chip — the stored query's, which has no syntax", () => {
    const scope: SpanQueryScope = buildSpanQueryScope({
      entityKeys: [POD_KEY],
    });
    const stored: Array<ActiveFilter> = storedQueryChips(scope);

    const lockedChips: Array<ActiveFilter> = [
      ...stored,
      ...buildTracesLockedEntityKeyChips({
        entityKeysFilter: [POD_KEY],
        displays: buildInventoryEntityKeyDisplays({
          entityKey: POD_KEY,
          entityType: "k8s.pod",
          displayName: "checkout-7d9f",
        }),
        storedQueryEntityKeys: scope.entityKeys,
        lockedChips: stored,
      }),
    ];

    expect(
      lockedChips.map((chip: ActiveFilter): string => {
        return `${chip.facetKey}=${chip.value}`;
      }),
    ).toEqual([`entityKeys=${POD_KEY}`]);

    expect(searchSyntaxOf(lockedChips)).toEqual([
      ["entityKeys", undefined, NO_SEARCH_SYNTAX_REASON],
    ]);
  });
});
