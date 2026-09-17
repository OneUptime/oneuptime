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

/*
 * "SAID NOTHING" AND "SAID EMPTY" ARE DIFFERENT ANSWERS.
 *
 * The third and subtlest of the Viewer <-> Insights hand-off failures. The
 * two sentences below look alike and mean opposite things:
 *
 *   - a link that carries no `search` param because it never described one
 *     ("this view, as saved") — the named view's own search must survive;
 *   - a link that carries no `search` param because the user emptied the
 *     search box before leaving ("this view, but I cleared the search") —
 *     the named view's search must NOT come back.
 *
 * `hasUrlScope` is the only thing that tells them apart: a link that carries
 * scope of its own is describing the WHOLE slice it left behind, so silence
 * about the search means the search is empty. Collapse the two and a user
 * who cleared the search box, clicked over to Insights and clicked back
 * lands on the same view name showing a narrower result set, with nothing on
 * screen — no chip, no text in the box — to explain where the extra
 * predicate came from.
 *
 * These are written as properties over the whole input space rather than as
 * examples, because the failure is a MISSING key on one branch and an
 * over-eager key on the other; only sweeping both branches catches both.
 */
describe("buildUrlScopeOverrides: cleared search vs unmentioned search", () => {
  test("a scope-carrying link with no search writes an explicit empty search", () => {
    /*
     * The regression itself. Without the explicit "", the shallow merge the
     * explorer performs leaves the saved view's `search` in place and the
     * user's deliberate clear is undone by the round trip.
     */
    const overrides: Partial<TelemetrySavedViewState> | undefined =
      buildUrlScopeOverrides({
        filters: [["primaryEntityId", "svc-a"]],
        timeRange: { range: TimeRange.PAST_ONE_DAY },
        hasUrlScope: true,
      });

    expect(overrides).toHaveProperty("search");
    expect(overrides?.search).toBe("");
  });

  test("a scope-carrying link with only a window still clears the search", () => {
    /*
     * The thinnest scope a hand-off can carry: the Insights tab always emits
     * a window. Clearing the search box and changing nothing else must still
     * survive the trip, so the window alone is enough to make the link
     * authoritative about the search.
     */
    const overrides: Partial<TelemetrySavedViewState> | undefined =
      buildUrlScopeOverrides({
        timeRange: { range: TimeRange.PAST_ONE_HOUR },
        hasUrlScope: true,
      });

    expect(overrides).toEqual({
      search: "",
      timeRange: { range: TimeRange.PAST_ONE_HOUR },
    });
  });

  test("a non-empty search wins over the clear, scope-carrying or not", () => {
    /*
     * `hasUrlScope` only decides what an ABSENT search means. A search the
     * user actually typed is carried verbatim either way — otherwise the
     * flag would start eating real searches.
     */
    for (const hasUrlScope of [true, false, undefined]) {
      expect(
        buildUrlScopeOverrides({ search: "level:error", hasUrlScope })?.search,
      ).toBe("level:error");
    }
  });

  test("without url scope an absent or empty search writes no key at all", () => {
    /*
     * The other half of the property. A link that says nothing about the
     * search — a plain `?savedView=<id>` someone pasted into a channel — must
     * leave the named view's own search alone, so the key has to be absent
     * rather than "".
     */
    const inputs: Array<{
      search?: string | undefined;
      filters?: Array<[string, string]> | undefined;
      timeRange?: { range: string } | undefined;
      hasUrlScope?: boolean | undefined;
    }> = [
      { filters: [["primaryEntityId", "svc-a"]] },
      { filters: [["primaryEntityId", "svc-a"]], hasUrlScope: false },
      { search: "", filters: [["primaryEntityId", "svc-a"]] },
      { search: "", timeRange: { range: TimeRange.PAST_ONE_DAY } },
      {
        search: "",
        filters: [],
        timeRange: { range: TimeRange.PAST_ONE_DAY },
        hasUrlScope: false,
      },
    ];

    for (const input of inputs) {
      const overrides: Partial<TelemetrySavedViewState> | undefined =
        buildUrlScopeOverrides(input);

      expect(overrides).toBeDefined();
      expect(Object.keys(overrides!)).not.toContain("search");
    }
  });

  test("the search key is present iff the link said something or claimed scope", () => {
    /*
     * The invariant stated once over the whole grid, so a future branch added
     * to either side of the condition has to satisfy it: `search` is written
     * exactly when the user typed one OR the link is authoritative about the
     * slice. Anything else is one of the two bugs.
     */
    for (const search of [undefined, "", "level:error"]) {
      for (const hasUrlScope of [true, false, undefined]) {
        for (const filters of [
          undefined,
          [] as Array<[string, string]>,
          [["primaryEntityId", "svc-a"]] as Array<[string, string]>,
        ]) {
          for (const timeRange of [
            undefined,
            { range: TimeRange.PAST_ONE_DAY },
          ]) {
            const overrides: Partial<TelemetrySavedViewState> | undefined =
              buildUrlScopeOverrides({
                search,
                filters,
                timeRange,
                hasUrlScope,
              });

            const hasSearchKey: boolean = Boolean(
              overrides && Object.keys(overrides).includes("search"),
            );

            expect(hasSearchKey).toBe(Boolean(search) || hasUrlScope === true);

            // And when it is written it is either the typed text or a clear.
            if (hasSearchKey) {
              expect(overrides?.search).toBe(search || "");
            }
          }
        }
      }
    }
  });

  test("a scope-carrying link is never undefined, so the clear always reaches the merge", () => {
    /*
     * `undefined` means "pass no overrides", which is how a saved view
     * applies exactly as stored. A hand-off that cleared the search and
     * everything else must not collapse into that, or the clear is dropped
     * before the merge ever sees it.
     */
    expect(buildUrlScopeOverrides({ hasUrlScope: true })).toEqual({
      search: "",
    });
    expect(
      buildUrlScopeOverrides({ search: "", filters: [], hasUrlScope: true }),
    ).toEqual({ search: "" });

    // The same inputs without the flag describe nothing, and stay nothing.
    expect(buildUrlScopeOverrides({ hasUrlScope: false })).toBeUndefined();
  });
});

/*
 * Why the key's presence is worth a suite of its own: the explorer applies
 * these overrides with a shallow spread, `{ ...savedViewState, ...overrides }`.
 * Under that merge an absent key and a key holding "" are not a detail of
 * object shape — they are two different result sets under the same view name.
 * These tests perform the merge here so the consequence is visible rather
 * than inferred.
 */
describe("buildUrlScopeOverrides under the explorer's shallow merge", () => {
  const SAVED_VIEW_STATE: TelemetrySavedViewState = {
    search: "level:error AND service:checkout",
    filters: [["primaryEntityId", "svc-checkout"]],
    timeRange: { range: TimeRange.PAST_ONE_WEEK },
  };

  function applied(
    overrides: Partial<TelemetrySavedViewState> | undefined,
  ): TelemetrySavedViewState {
    return { ...SAVED_VIEW_STATE, ...overrides };
  }

  test("a cleared search stays cleared after the round trip", () => {
    /*
     * User empties the search box, opens Insights, comes back. The view is
     * re-applied underneath, and the merged state must still show an empty
     * box — not the seven-word query the view was saved with.
     */
    const merged: TelemetrySavedViewState = applied(
      buildUrlScopeOverrides({
        filters: [["primaryEntityId", "svc-checkout"]],
        timeRange: { range: TimeRange.PAST_ONE_DAY },
        hasUrlScope: true,
      }),
    );

    expect(merged.search).toBe("");
    // The rest of the view survives; only what the link spoke to changes.
    expect(merged.timeRange).toEqual({ range: TimeRange.PAST_ONE_DAY });
    expect(merged.filters).toEqual([["primaryEntityId", "svc-checkout"]]);
  });

  test("a link that never mentioned the search leaves the view's own intact", () => {
    /*
     * The mirror case, and the reason the fix cannot simply always write "":
     * a pasted `?savedView=<id>` link must reproduce the view as its author
     * saved it, search included.
     */
    const merged: TelemetrySavedViewState = applied(
      buildUrlScopeOverrides({
        filters: [["primaryEntityId", "svc-a"]],
        hasUrlScope: false,
      }),
    );

    expect(merged.search).toBe(SAVED_VIEW_STATE.search);
  });

  test("the same absent search merges to opposite results on the two branches", () => {
    /*
     * Stated as one comparison because that is the whole property: identical
     * inputs apart from `hasUrlScope`, and the user sees a different set of
     * rows. If these two ever agree, one of the two behaviours has been lost.
     */
    const scoped: TelemetrySavedViewState = applied(
      buildUrlScopeOverrides({
        timeRange: { range: TimeRange.PAST_ONE_DAY },
        hasUrlScope: true,
      }),
    );
    const unscoped: TelemetrySavedViewState = applied(
      buildUrlScopeOverrides({
        timeRange: { range: TimeRange.PAST_ONE_DAY },
        hasUrlScope: false,
      }),
    );

    expect(scoped.search).toBe("");
    expect(unscoped.search).toBe(SAVED_VIEW_STATE.search);
    expect(scoped.search).not.toBe(unscoped.search);
  });

  test("a typed search replaces the view's on both branches", () => {
    for (const hasUrlScope of [true, false]) {
      expect(
        applied(
          buildUrlScopeOverrides({
            search: "http.status_code:500",
            hasUrlScope,
          }),
        ).search,
      ).toBe("http.status_code:500");
    }
  });
});
