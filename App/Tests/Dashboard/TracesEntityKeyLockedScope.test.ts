/*
 * An Inventory item's Traces tab, end to end through the pure half of the
 * viewer: the item's own fields become the chip's names
 * (buildInventoryEntityKeyDisplays), the names become the locked chip
 * (buildTracesLockedEntityKeyChips), and the locked chips become the
 * "Copy filter" / "Open in Traces" actions through the builder TracesViewer's
 * `lockedFilterActions` memo calls (buildLockedScopeFilterActions; the call is
 * pinned in TracesLockedScopeWiring.test.ts).
 *
 * An entity key has no search syntax and no explorer URL chip. So an
 * entity-key-only scope must copy NOTHING (the actions component hides a
 * blank Copy button, pinned in Common's LockedFilterActions.test.tsx) and
 * offer no "Open in Traces" link, which could carry none of the scope and
 * would open every span in the project. Next to a filter the link does
 * carry, the link comes back and names the resource as not carried.
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

import { beforeAll, describe, expect, test } from "@jest/globals";
import TimeRange from "Common/Types/Time/TimeRange";
import type RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import type { ActiveFilter } from "Common/UI/Components/TelemetryViewer/types";
import type { LockedFilterActionOptions } from "Common/UI/Components/TelemetryViewer/components/LockedFilterActions";
import type { LockedEntityKeyDisplayMap } from "../../FeatureSet/Dashboard/src/Utils/LockedEntityKeyChips";
/*
 * Pure modules, imported statically: none reads `window` at load, and these
 * are the builders the viewer's chip memo really runs. Only the actions
 * builder, which resolves the explorer route, waits for the browser stub.
 */
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
  describeLockedAttributeFilter,
  isFilterCarriedByExplorerLink,
} from "../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScope";

type LinkModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScopeLink");

let Link: LinkModule;

const PROJECT_ID: string = "7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const ITEM_ID: string = "1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/inventory/${ITEM_ID}/traces`;

const POD_KEY: string = "3f9a1b2c4d5e6f70";
const NODE_KEY: string = "9c8b7a6d5e4f3021";
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";

const PAST_ONE_HOUR: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
};

const CANNOT_TRAVEL: string =
  "This filter cannot be copied or carried to the explorer.";

/*
 * The actions builder resolves the project through ProjectUtil and reads the
 * current URL through Navigation, and Common/UI/Config reads `window` the
 * moment it loads, so the stub has to exist before that module is imported.
 * Same approach as LockedTelemetryScopeLink.test.ts.
 */
beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: {
      pathname: PAGE_PATH,
      search: "",
      hash: "",
      href: `https://app.example.com${PAGE_PATH}`,
    },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  Link = await import(
    "../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScopeLink"
  );
});

type ActionsForFunction = (
  lockedChips: Array<ActiveFilter>,
  timeRange?: RangeStartAndEndDateTime,
) => LockedFilterActionOptions | undefined;

// The viewer's call: its locked chips, the traces signal and its window.
const actionsFor: ActionsForFunction = (
  lockedChips: Array<ActiveFilter>,
  timeRange: RangeStartAndEndDateTime = PAST_ONE_HOUR,
): LockedFilterActionOptions | undefined => {
  return Link.buildLockedScopeFilterActions({
    signal: "traces",
    chips: lockedChips,
    timeRange,
  });
};

type VisibleActionsOfFunction = (
  options: LockedFilterActionOptions | undefined,
) => { copy: boolean; open: boolean };

/*
 * What LockedFilterActions renders from the options: Copy only for a
 * non-blank copy text, Open only with a route.
 */
const visibleActionsOf: VisibleActionsOfFunction = (
  options: LockedFilterActionOptions | undefined,
): { copy: boolean; open: boolean } => {
  return {
    copy: (options?.copyText || "").trim().length > 0,
    open: Boolean(options?.openExplorerRoute),
  };
};

type ExplorerUrlOfFunction = (
  options: LockedFilterActionOptions,
) => globalThis.URL;

const explorerUrlOf: ExplorerUrlOfFunction = (
  options: LockedFilterActionOptions,
): globalThis.URL => {
  return new globalThis.URL(options.openExplorerRoute!.toString());
};

type PodChipsFunction = () => Array<ActiveFilter>;

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

describe("Copy filter / Open in Traces for an entity-key scope", () => {
  test("an entity-key-only scope copies nothing and links nowhere, so neither action renders", () => {
    const actions: LockedFilterActionOptions | undefined =
      actionsFor(podChips());

    expect(actions).toEqual({ copyText: "" });
    expect(visibleActionsOf(actions)).toEqual({ copy: false, open: false });
  });

  test("no Open in Traces and no caveat: a link carrying none of the scope is withheld", () => {
    /*
     * The only link the builder could make is the Traces explorer on the
     * same window with no filter (carriedFilterCount 0, pinned in
     * LockedTelemetryScopeLink.test.ts) — every span in the project under a
     * label promising this item's. Deliberately changed from the earlier
     * expectation that the tab offered that link with a "not carried over:
     * resource" caveat.
     */
    const actions: LockedFilterActionOptions = actionsFor(podChips())!;

    expect(actions.openExplorerRoute).toBeUndefined();
    expect(actions.notCarried).toBeUndefined();
  });

  test("a custom window does not bring the link back", () => {
    const start: Date = new Date("2026-09-01T10:00:00.000Z");
    const end: Date = new Date("2026-09-01T11:00:00.000Z");
    const custom: RangeStartAndEndDateTime = {
      range: TimeRange.CUSTOM,
      startAndEndDate: { startValue: start, endValue: end },
    } as RangeStartAndEndDateTime;

    expect(actionsFor(podChips(), custom)).toEqual({ copyText: "" });
  });

  test("the chip's own tooltip agrees with the actions: an entity key cannot travel", () => {
    expect(podChips()[0]!.lockedDetail!.searchTokenUnavailableReason).toBe(
      CANNOT_TRAVEL,
    );
    expect(isFilterCarriedByExplorerLink("traces", "entityKeys")).toBe(false);
  });

  test("several keys are still nothing to carry — no link, and nothing to copy", () => {
    const chips: Array<ActiveFilter> = buildTracesLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY, NODE_KEY],
    });

    const actions: LockedFilterActionOptions = actionsFor(chips)!;

    expect(chips).toHaveLength(2);
    expect(actions).toEqual({ copyText: "" });
    expect(visibleActionsOf(actions)).toEqual({ copy: false, open: false });
  });

  test("next to a stored trace: the trace is copied and carried, the resource is named as not carried", () => {
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

    const actions: LockedFilterActionOptions = actionsFor(lockedChips)!;

    expect(actions.copyText).toBe(`trace:${TRACE_ID}`);
    // The trace rides, so the link is offered — with the resource caveat.
    expect(visibleActionsOf(actions)).toEqual({ copy: true, open: true });
    expect(explorerUrlOf(actions).pathname).toBe(
      `/dashboard/${PROJECT_ID}/traces`,
    );
    expect(
      JSON.parse(explorerUrlOf(actions).searchParams.get("filters")!),
    ).toEqual([["traceId", TRACE_ID]]);
    expect(actions.notCarried).toEqual(["resource"]);
  });

  test("next to a page attribute: the attribute is copied and carried, the resource is named as not carried", () => {
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

    const actions: LockedFilterActionOptions = actionsFor(lockedChips)!;

    expect(actions.copyText).toBe("@resource.host.name:web-01");
    expect(visibleActionsOf(actions)).toEqual({ copy: true, open: true });
    expect(
      JSON.parse(explorerUrlOf(actions).searchParams.get("filters")!),
    ).toEqual([["attributes.resource.host.name", "web-01"]]);
    expect(actions.notCarried).toEqual(["resource"]);
  });

  test("a key the page and the stored query both pin is one chip, copies nothing and links nowhere", () => {
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

    const actions: LockedFilterActionOptions = actionsFor(lockedChips)!;

    expect(actions).toEqual({ copyText: "" });
    expect(visibleActionsOf(actions)).toEqual({ copy: false, open: false });
  });
});
