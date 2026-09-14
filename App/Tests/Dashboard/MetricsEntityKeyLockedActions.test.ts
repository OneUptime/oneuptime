jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  /*
   * The chip module's entity-name resolver imports the API client. No name
   * is resolved here; the mock keeps the client (and whatever it reads at
   * load) out of this plain-Node suite, as MetricsEntityChipDisplay.test.ts
   * does.
   */
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

import { beforeAll, describe, expect, test } from "@jest/globals";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import TimeRange from "Common/Types/Time/TimeRange";
import type RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import type { ActiveFilter } from "Common/UI/Components/TelemetryViewer/types";
import type { LockedFilterActionOptions } from "Common/UI/Components/TelemetryViewer/components/LockedFilterActions";
/*
 * Pure, so imported statically: nothing here reads `window` at load, and the
 * chips below are exactly the ones the metrics viewer builds.
 */
import { buildMetricsActiveFilterChips } from "../../FeatureSet/Dashboard/src/Utils/MetricsEntityChipDisplay";
import type { LockedEntityKeyDisplayMap } from "../../FeatureSet/Dashboard/src/Utils/LockedEntityKeyChips";

/*
 * "Copy filter" / "Open in Metrics" for an Inventory item's entity-key
 * scope. The chip has no search token (no grammar can spell an entity key)
 * and no explorer link carries the column, so the actions the metrics
 * viewer derives for it must be honest about both: no Copy button that
 * copies nothing, and no Open link that would open the metrics list
 * unfiltered. Next to a filter the link does carry, the link comes back and
 * names the resource as left behind.
 *
 * The viewer's lockedFilterActions memo hands its whole chip bar to
 * buildLockedScopeFilterActions (pinned in MetricsLockedScopeWiring.test.ts),
 * so these run that builder on the chips the viewer really builds. The
 * link's own URL grammar and carried count are pinned in
 * LockedTelemetryScopeLink.test.ts, and the chip wording in
 * MetricsEntityChipDisplay.test.ts.
 *
 * The builder resolves the explorer route through Navigation and ProjectUtil,
 * and Common/UI/Config reads `window` the moment it loads, so the browser
 * stub exists before that module is imported (same approach as
 * LockedTelemetryScopeLink.test.ts).
 */

type LinkModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScopeLink");

let Link: LinkModule;

const PROJECT_ID: string = "2d1a3f6e-0f7b-4c1d-9a2e-8b3c4d5e6f70";
const INVENTORY_ITEM_ID: string = "6c0e2b1a-4d3f-4a5b-9c8d-7e6f5a4b3c2d";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/inventory/${INVENTORY_ITEM_ID}/metrics`;

const POD_KEY: string = "3f9a1b2c4d5e6f70";
const OTHER_KEY: string = "aaaaaaaaaaaaaaaa";

const POD_DISPLAYS: LockedEntityKeyDisplayMap = {
  [POD_KEY]: { displayKey: "Kubernetes Pod", displayValue: "checkout-7d9f" },
};

const PAST_ONE_HOUR: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
};

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
  chips: Array<ActiveFilter>,
  timeRange: RangeStartAndEndDateTime,
) => LockedFilterActionOptions | undefined;

// The viewer's call: its whole chip bar, the metrics signal and its window.
const actionsFor: ActionsForFunction = (
  chips: Array<ActiveFilter>,
  timeRange: RangeStartAndEndDateTime,
): LockedFilterActionOptions | undefined => {
  return Link.buildLockedScopeFilterActions({
    signal: "metrics",
    chips,
    timeRange,
  });
};

interface PageChipsInput {
  attributeFilters?: Record<string, string> | undefined;
  entityKeysFilter?: ReadonlyArray<string> | undefined;
  entityKeyDisplays?: LockedEntityKeyDisplayMap | undefined;
  activeFilters?: Array<ActiveFilter> | undefined;
}

type PageChipsFunction = (input: PageChipsInput) => Array<ActiveFilter>;

// The chip bar of a page that pins an entity-key scope (an Inventory item).
const pageChips: PageChipsFunction = (
  input: PageChipsInput,
): Array<ActiveFilter> => {
  return buildMetricsActiveFilterChips({
    scopeIds: undefined,
    scopeEntityType: undefined,
    attributeFilters: input.attributeFilters,
    entityKeysFilter: input.entityKeysFilter,
    entityKeyDisplays: input.entityKeyDisplays,
    activeFilters: input.activeFilters || [],
    facetConfigs: [],
    nameMap: {},
  });
};

type ActionsPredicateFunction = (
  actions: LockedFilterActionOptions | undefined,
) => boolean;

/*
 * What LockedFilterActions renders from these options: the Copy button only
 * for a copy text that is not blank once trimmed, the Open link only with a
 * route, and the whole group only when there is at least one of the two.
 */
const rendersCopy: ActionsPredicateFunction = (
  actions: LockedFilterActionOptions | undefined,
): boolean => {
  return (actions?.copyText || "").trim().length > 0;
};

const rendersOpen: ActionsPredicateFunction = (
  actions: LockedFilterActionOptions | undefined,
): boolean => {
  return Boolean(actions?.openExplorerRoute);
};

const rendersGroup: ActionsPredicateFunction = (
  actions: LockedFilterActionOptions | undefined,
): boolean => {
  return rendersCopy(actions) || rendersOpen(actions);
};

type ExplorerUrlOfFunction = (
  actions: LockedFilterActionOptions | undefined,
) => globalThis.URL;

const explorerUrlOf: ExplorerUrlOfFunction = (
  actions: LockedFilterActionOptions | undefined,
): globalThis.URL => {
  expect(actions).toBeDefined();
  expect(actions!.openExplorerRoute).toBeDefined();

  return new globalThis.URL(actions!.openExplorerRoute!.toString());
};

type FiltersOfFunction = (
  actions: LockedFilterActionOptions | undefined,
) => unknown;

const filtersOf: FiltersOfFunction = (
  actions: LockedFilterActionOptions | undefined,
): unknown => {
  const raw: string | null = explorerUrlOf(actions).searchParams.get("filters");

  return raw === null ? null : JSON.parse(raw);
};

describe("Copy filter / Open in Metrics for an entity-key scope", () => {
  test("the chip is locked, so actions are built — but there is nothing to copy and nothing to carry, so no action renders", () => {
    const actions: LockedFilterActionOptions | undefined = actionsFor(
      pageChips({
        entityKeysFilter: [POD_KEY],
        entityKeyDisplays: POD_DISPLAYS,
      }),
      PAST_ONE_HOUR,
    );

    expect(actions).toEqual({ copyText: "" });
    expect(rendersCopy(actions)).toBe(false);
    expect(rendersOpen(actions)).toBe(false);
    // Neither action, so LockedFilterActions renders no group at all.
    expect(rendersGroup(actions)).toBe(false);
  });

  test("no Open in Metrics and no caveat: a link carrying none of the scope is withheld", () => {
    /*
     * The only link the builder could make is the metrics list with the
     * page's window and no filter (carriedFilterCount 0, pinned in
     * LockedTelemetryScopeLink.test.ts) — every metric in the project under a
     * label promising this item's. Deliberately changed from the earlier
     * expectation that the page offered that link with a "not carried over:
     * resource" caveat.
     */
    const actions: LockedFilterActionOptions | undefined = actionsFor(
      pageChips({
        entityKeysFilter: [POD_KEY],
        entityKeyDisplays: POD_DISPLAYS,
      }),
      PAST_ONE_HOUR,
    );

    expect(actions!.openExplorerRoute).toBeUndefined();
    expect(actions!.notCarried).toBeUndefined();
  });

  test("an unnamed chip behaves the same: the display map changes what the chip reads, never what the actions offer", () => {
    const named: LockedFilterActionOptions | undefined = actionsFor(
      pageChips({
        entityKeysFilter: [POD_KEY],
        entityKeyDisplays: POD_DISPLAYS,
      }),
      PAST_ONE_HOUR,
    );
    const unnamed: LockedFilterActionOptions | undefined = actionsFor(
      pageChips({ entityKeysFilter: [POD_KEY] }),
      PAST_ONE_HOUR,
    );

    expect(unnamed).toEqual({ copyText: "" });
    expect(unnamed).toEqual(named);
  });

  test("several pinned keys are still nothing to carry", () => {
    expect(
      actionsFor(
        pageChips({
          entityKeysFilter: [POD_KEY, OTHER_KEY],
          entityKeyDisplays: POD_DISPLAYS,
        }),
        PAST_ONE_HOUR,
      ),
    ).toEqual({ copyText: "" });
  });

  test("a Custom window does not bring the link back — the window alone was never the problem", () => {
    const custom: RangeStartAndEndDateTime = {
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(
        new Date("2026-08-10T10:00:00.000Z"),
        new Date("2026-08-10T11:00:00.000Z"),
      ),
    };

    expect(
      actionsFor(pageChips({ entityKeysFilter: [POD_KEY] }), custom),
    ).toEqual({ copyText: "" });
  });

  test("the user's own chips never reach the actions — a removable chip the link could carry does not bring the link back", () => {
    const chips: Array<ActiveFilter> = pageChips({
      entityKeysFilter: [POD_KEY],
      entityKeyDisplays: POD_DISPLAYS,
      activeFilters: [
        {
          facetKey: "attributes.container.name",
          value: "postgres",
          displayKey: "attributes.container.name",
          displayValue: "postgres",
        },
      ],
    });

    expect(
      chips.map((chip: ActiveFilter): [string, boolean] => {
        return [chip.facetKey, Boolean(chip.readOnly)];
      }),
    ).toEqual([
      ["entityKeys", true],
      ["attributes.container.name", false],
    ]);

    expect(actionsFor(chips, PAST_ONE_HOUR)).toEqual({ copyText: "" });
  });

  test("alongside a locked attribute, the attribute is copied and carried, the link is offered, and the resource is named as left behind", () => {
    const actions: LockedFilterActionOptions | undefined = actionsFor(
      pageChips({
        attributeFilters: { "resource.host.name": "ip-10-0-0-12" },
        entityKeysFilter: [POD_KEY],
        entityKeyDisplays: POD_DISPLAYS,
      }),
      PAST_ONE_HOUR,
    );

    expect(actions!.copyText).toBe("@resource.host.name:ip-10-0-0-12");
    expect(rendersCopy(actions)).toBe(true);
    expect(rendersOpen(actions)).toBe(true);
    expect(explorerUrlOf(actions).pathname).toBe(
      `/dashboard/${PROJECT_ID}/metrics`,
    );
    expect(filtersOf(actions)).toEqual([
      ["attributes.resource.host.name", "ip-10-0-0-12"],
    ]);
    expect(actions!.notCarried).toEqual(["resource"]);
  });

  test("REGRESSION: a Kubernetes cluster page (attribute + entityScope) keeps its link and invents no resource caveat", () => {
    const chips: Array<ActiveFilter> = buildMetricsActiveFilterChips({
      scopeIds: undefined,
      scopeEntityType: undefined,
      attributeFilters: { "resource.k8s.cluster.name": "prod-eks-01" },
      attributeFilterDisplayKeys: { "resource.k8s.cluster.name": "Cluster" },
      attributeFilterDisplayValues: {
        "resource.k8s.cluster.name": "production",
      },
      entityScope: {
        entityKeys: [POD_KEY],
        attributeKey: "resource.k8s.cluster.name",
        attributeValue: "prod-eks-01",
      },
      activeFilters: [],
      facetConfigs: [],
      nameMap: {},
    });

    const actions: LockedFilterActionOptions | undefined = actionsFor(
      chips,
      PAST_ONE_HOUR,
    );

    expect(actions!.copyText).toBe("@resource.k8s.cluster.name:prod-eks-01");
    expect(rendersOpen(actions)).toBe(true);
    expect(filtersOf(actions)).toEqual([
      ["attributes.resource.k8s.cluster.name", "prod-eks-01"],
    ]);
    expect(actions!.notCarried).toEqual([]);
  });

  test("an explorer with no locked scope has no actions at all, whatever names it is handed", () => {
    expect(
      actionsFor(
        pageChips({ entityKeysFilter: [], entityKeyDisplays: POD_DISPLAYS }),
        PAST_ONE_HOUR,
      ),
    ).toBeUndefined();
  });
});
