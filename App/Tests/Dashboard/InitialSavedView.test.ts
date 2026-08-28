import { describe, expect, test } from "@jest/globals";
import TelemetrySavedViewState from "Common/Types/Telemetry/TelemetrySavedViewState";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  InitialSavedViewResolution,
  buildUrlScopeOverrides,
  resolveInitialSavedView,
} from "../../FeatureSet/Dashboard/src/Utils/InitialSavedView";

/*
 * Which saved view an explorer applies on first mount.
 *
 * This precedence used to live inline in the Logs explorer as "apply the
 * project default", full stop — so on any project with a default view, every
 * filter-carrying deep link into /logs was overwritten a tick after it
 * rendered. The user saw their filtered view flash and then turn into
 * someone else's saved view: cross-signal pivots, AI-investigation links and
 * (once the tabs started handing scope to each other) every trip back from
 * the Insights tab.
 *
 * Each test below pins one rung of the precedence ladder, because getting
 * any of them wrong shows the user data they did not ask for under a label
 * that says they did.
 */

interface FakeSavedView {
  id: string;
  name: string;
  isDefault: boolean;
}

const DV_IMS: FakeSavedView = {
  id: "view-dv-ims",
  name: "DV-IMS",
  isDefault: false,
};

const TEAM_DEFAULT: FakeSavedView = {
  id: "view-default",
  name: "Team default",
  isDefault: true,
};

const SAVED_VIEWS: Array<FakeSavedView> = [DV_IMS, TEAM_DEFAULT];

function resolve(
  overrides: Partial<{
    savedViews: Array<FakeSavedView>;
    urlSavedViewId: string | null | undefined;
    hasUrlScope: boolean;
    hostOwnsView: boolean;
  }> = {},
): InitialSavedViewResolution<FakeSavedView> {
  return resolveInitialSavedView<FakeSavedView>({
    savedViews: overrides.savedViews ?? SAVED_VIEWS,
    getId: (savedView: FakeSavedView): string => {
      return savedView.id;
    },
    isDefault: (savedView: FakeSavedView): boolean => {
      return savedView.isDefault;
    },
    urlSavedViewId: overrides.urlSavedViewId,
    hasUrlScope: overrides.hasUrlScope ?? false,
    hostOwnsView: overrides.hostOwnsView ?? false,
  });
}

describe("resolveInitialSavedView", () => {
  test("applies the project default when the user arrives with no instruction", () => {
    const resolution: InitialSavedViewResolution<FakeSavedView> = resolve();

    expect(resolution.savedView).toBe(TEAM_DEFAULT);
    expect(resolution.source).toBe("default");
  });

  test("applies the view the link named, over the project default", () => {
    /*
     * The trip back from the Insights tab: the link says "the DV-IMS view",
     * and answering with the team default would be a different dataset under
     * the name the user chose.
     */
    const resolution: InitialSavedViewResolution<FakeSavedView> = resolve({
      urlSavedViewId: DV_IMS.id,
    });

    expect(resolution.savedView).toBe(DV_IMS);
    expect(resolution.source).toBe("url");
  });

  test("applies the named view even when the link also carries raw scope", () => {
    /*
     * That combination IS the Insights hand-off: "this view, plus the window
     * and services I ended up on". Both halves are honoured — the explorer
     * layers the URL's scope over the view it applies.
     */
    const resolution: InitialSavedViewResolution<FakeSavedView> = resolve({
      urlSavedViewId: DV_IMS.id,
      hasUrlScope: true,
    });

    expect(resolution.savedView).toBe(DV_IMS);
    expect(resolution.source).toBe("url");
  });

  test("applies the named view even inside a host-owned window", () => {
    /*
     * The host skip exists to protect a moment the user did not choose — an
     * incident's pinned window. Naming a view IS the user choosing.
     */
    const resolution: InitialSavedViewResolution<FakeSavedView> = resolve({
      urlSavedViewId: DV_IMS.id,
      hostOwnsView: true,
    });

    expect(resolution.savedView).toBe(DV_IMS);
    expect(resolution.source).toBe("url");
  });

  test("leaves a scope-carrying deep link alone rather than clobbering it", () => {
    /*
     * The regression this module exists for. A cross-signal pivot lands with
     * filters and no view; applying the project default here replaces the
     * user's filters with the team's a tick after the page renders.
     */
    const resolution: InitialSavedViewResolution<FakeSavedView> = resolve({
      hasUrlScope: true,
    });

    expect(resolution.savedView).toBeNull();
    expect(resolution.source).toBe("none");
  });

  test("leaves a host-owned window alone", () => {
    /*
     * An incident's pinned window, or the entity hub's controlled cursor. A
     * saved view carries its own window, so applying one moves the page off
     * the moment it is about.
     */
    const resolution: InitialSavedViewResolution<FakeSavedView> = resolve({
      hostOwnsView: true,
    });

    expect(resolution.savedView).toBeNull();
    expect(resolution.source).toBe("none");
  });

  test("reports a named view that no longer exists, and applies nothing", () => {
    /*
     * Falling through to the project default would answer a precise request
     * with an unrelated view, which reads as a bug. Reporting it lets the
     * explorer drop the stale id out of the URL instead.
     */
    const resolution: InitialSavedViewResolution<FakeSavedView> = resolve({
      urlSavedViewId: "view-deleted",
    });

    expect(resolution.savedView).toBeNull();
    expect(resolution.source).toBe("none");
    expect(resolution.isUrlSavedViewMissing).toBe(true);
  });

  test("does not report missing when the link named no view at all", () => {
    for (const urlSavedViewId of [undefined, null, "", "   "]) {
      expect(resolve({ urlSavedViewId }).isUrlSavedViewMissing).toBe(false);
    }
  });

  test("matches a named view whose id arrives with surrounding whitespace", () => {
    expect(resolve({ urlSavedViewId: ` ${DV_IMS.id} ` }).savedView).toBe(
      DV_IMS,
    );
  });

  test("applies nothing when the project has no default view", () => {
    const resolution: InitialSavedViewResolution<FakeSavedView> = resolve({
      savedViews: [DV_IMS],
    });

    expect(resolution.savedView).toBeNull();
    expect(resolution.source).toBe("none");
  });

  test("survives an empty or missing saved-view list", () => {
    expect(resolve({ savedViews: [] }).savedView).toBeNull();

    /*
     * Called directly rather than through the helper: the list is the one
     * input the helper cannot default away, and a fetch that failed hands
     * this function whatever the caller's state held.
     */
    expect(
      resolveInitialSavedView<FakeSavedView>({
        savedViews: undefined as unknown as Array<FakeSavedView>,
        getId: (savedView: FakeSavedView): string => {
          return savedView.id;
        },
        isDefault: (savedView: FakeSavedView): boolean => {
          return savedView.isDefault;
        },
        hasUrlScope: false,
        hostOwnsView: false,
      }).savedView,
    ).toBeNull();
  });

  test("picks the first default when a project somehow has two", () => {
    const other: FakeSavedView = {
      id: "view-other-default",
      name: "Other",
      isDefault: true,
    };

    expect(resolve({ savedViews: [TEAM_DEFAULT, other] }).savedView).toBe(
      TEAM_DEFAULT,
    );
  });
});

/*
 * The other half of the trip back from Insights: a link that names a view
 * AND carries scope means "this view, but with the window and filters I
 * ended up on". The URL is the more recent of the two statements, so it is
 * layered over the view — but only where it actually said something.
 */
describe("buildUrlScopeOverrides", () => {
  test("carries the fields the link spelled out", () => {
    const overrides: Partial<TelemetrySavedViewState> | undefined =
      buildUrlScopeOverrides({
        search: "service:api",
        filters: [["primaryEntityId", "svc-a"]],
        timeRange: { range: TimeRange.PAST_ONE_DAY },
      });

    expect(overrides).toEqual({
      search: "service:api",
      filters: [["primaryEntityId", "svc-a"]],
      timeRange: { range: TimeRange.PAST_ONE_DAY },
    });
  });

  test("omits a field the link said nothing about, rather than blanking it", () => {
    /*
     * The distinction that matters. A link carrying chips but no window is
     * not asking for a default window; including `timeRange: undefined` here
     * would move the named view off its own.
     */
    const overrides: Partial<TelemetrySavedViewState> | undefined =
      buildUrlScopeOverrides({
        filters: [["primaryEntityId", "svc-a"]],
      });

    expect(overrides).toEqual({ filters: [["primaryEntityId", "svc-a"]] });
    expect(overrides).not.toHaveProperty("timeRange");
    expect(overrides).not.toHaveProperty("search");
  });

  test("treats an empty search or filter list as nothing said", () => {
    expect(
      buildUrlScopeOverrides({
        search: "",
        filters: [],
        timeRange: { range: TimeRange.PAST_ONE_DAY },
      }),
    ).toEqual({ timeRange: { range: TimeRange.PAST_ONE_DAY } });
  });

  test("returns undefined when the link described nothing at all", () => {
    /*
     * So the caller passes no overrides, and a view applies exactly as
     * saved.
     */
    expect(buildUrlScopeOverrides({})).toBeUndefined();
    expect(buildUrlScopeOverrides({ search: "", filters: [] })).toBeUndefined();
  });
});
