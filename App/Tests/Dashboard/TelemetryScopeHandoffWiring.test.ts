import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The parts of the Viewer <-> Insights scope hand-off that are structural
 * rather than computational.
 *
 * TelemetryTabScope.test.ts, LogsSavedViewOverrideMerge.test.ts and
 * InitialSavedView.test.ts pin the pure functions, and
 * TelemetryInsightsScopeWiring.test.ts pins that the six surfaces call them.
 * What is left over — and what this suite owns — is a handful of properties
 * that live in the SHAPE of a component rather than in any function it
 * calls: where a piece of state is seeded from, which effect is gated on
 * what, which of five sibling tab objects carries the marker, and whether
 * two chips render inside the same block.
 *
 * None of those can be observed from a unit test of a helper, and every one
 * of them was a real defect: each cost the user a filter they had set, with
 * no error and no visible clue that anything had been dropped. So this suite
 * reads the sources and asserts the arrangement. It is deliberately coarse —
 * it exists to make a connection impossible to delete or to move to the
 * wrong sibling by accident, not to re-check logic other suites own.
 */

function readSquashed(relative: string): string {
  return fs
    .readFileSync(
      path.join(__dirname, "../../FeatureSet/Dashboard/src", relative),
      "utf8",
    )
    .replace(/\s+/g, " ");
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/*
 * Returns the balanced `opener`..`closer` region that follows `marker`, so a
 * test can say "inside THIS array" or "inside THIS if-block" instead of
 * matching a string that happens to appear somewhere in the file. That
 * distinction is the whole point of the tab tests below: a marker on the
 * wrong tab still contains the same characters.
 */
function blockAfter(
  source: string,
  marker: string,
  opener: string,
  closer: string,
): string {
  const markerAt: number = source.indexOf(marker);

  if (markerAt < 0) {
    throw new Error(`Marker not found in source: ${marker}`);
  }

  const start: number = source.indexOf(opener, markerAt);

  if (start < 0) {
    throw new Error(`No "${opener}" after marker: ${marker}`);
  }

  let depth: number = 0;

  for (let index: number = start; index < source.length; index++) {
    const character: string = source.charAt(index);

    if (character === opener) {
      depth++;
    } else if (character === closer) {
      depth--;

      if (depth === 0) {
        return source.slice(start + 1, index);
      }
    }
  }

  throw new Error(`Unbalanced "${opener}" after marker: ${marker}`);
}

/*
 * One entry of a tabs array, from its `key` to the next entry's `key`.
 *
 * Correct only while every tab object declares `key` first, which is the
 * convention in all four nav-tab files. Reordering one so `carriesScope`
 * precedes `key` would attribute the marker to the PREVIOUS tab — so the
 * assertion below that each file's tabs all start with `key` is load
 * bearing, not decoration.
 */
function tabEntry(tabsArraySource: string, key: string): string {
  const marker: string = `key: "${key}",`;
  const at: number = tabsArraySource.indexOf(marker);

  if (at < 0) {
    throw new Error(`No tab with key "${key}"`);
  }

  const rest: string = tabsArraySource.slice(at + marker.length);
  const nextAt: number = rest.indexOf('key: "');

  return nextAt < 0 ? rest : rest.slice(0, nextAt);
}

describe("the Logs explorer's first URL write is never narrower than the link", () => {
  const LOGS_VIEWER: string = "Components/Logs/LogsViewer.tsx";

  test("seeds the selected saved view from the URL rather than from null", () => {
    /*
     * The explorer mirrors its whole state into the URL on every commit, and
     * buildTelemetryViewerUrlParams pre-nulls every param it owns so that a
     * deselection actually clears. Seeded null, the very first mirror
     * therefore DELETED the savedView id the Insights link had just handed
     * over, one render before the fetch could apply it.
     *
     * On the happy path that was transient — the id came back when the view
     * applied — but the tab bar re-reads the URL on every write, so the
     * Insights tab's href lost the view in that window too. If the
     * saved-view fetch failed or returned late, the loss was permanent and
     * silent: the user followed a link that named a view and landed on the
     * unfiltered firehose.
     */
    const source: string = readSquashed(LOGS_VIEWER);

    expect(source).toContain(
      "const [selectedSavedViewId, setSelectedSavedViewId] = useState<string | null>( initialUrlState?.savedViewId ?? null, );",
    );
  });

  test("prunes a selection only after the saved-view fetch has settled", () => {
    /*
     * The prune effect clears an id no view matches. Ungated it runs on the
     * first commit, when `savedViews` is still the empty initial array, so
     * EVERY seeded id looks missing and is thrown away — which is the seeding
     * above undone a render later, and the same disappearing filter with a
     * different cause. Gating on "the fetch has settled" is what makes the
     * two effects agree about when the list is knowable.
     */
    const source: string = readSquashed(LOGS_VIEWER);

    const gate: string = "if (!selectedSavedViewId || !hasFetchedSavedViews) {";
    /*
     * The flag also has to be a dependency, or the effect never re-runs to do
     * the pruning it was gated out of and a genuinely stale id survives.
     */
    const deps: string =
      "}, [savedViews, selectedSavedViewId, hasFetchedSavedViews]);";

    const gateAt: number = source.indexOf(gate);
    const depsAt: number = source.indexOf(deps);

    expect(gateAt).toBeGreaterThanOrEqual(0);
    expect(depsAt).toBeGreaterThan(gateAt);

    /*
     * And the gate has to guard the pruning itself — same effect, above the
     * clear — rather than sit next to it.
     */
    const pruneEffect: string = source.slice(gateAt, depsAt);

    expect(pruneEffect).toContain("savedViews.some(");
    expect(pruneEffect).toContain("setSelectedSavedViewId(null);");
  });

  test("clears a named-but-missing view deliberately, not as a side effect", () => {
    /*
     * A link naming a deleted view (or another project's) has to stop
     * carrying that id onward: left in the URL it keeps promising a scope
     * nothing can produce, and travels into the sibling tab's href. The
     * resolver reports the case; the explorer acts on it in the same place it
     * decides everything else about the initial view, rather than leaving it
     * to the prune effect to notice by accident.
     */
    const source: string = readSquashed(LOGS_VIEWER);

    const missingViewBranch: string = blockAfter(
      source,
      "if (resolution.isUrlSavedViewMissing) {",
      "{",
      "}",
    );

    expect(missingViewBranch).toContain("setSelectedSavedViewId(null);");
  });
});

describe("the Exceptions status tabs carry scope, and Overview does not", () => {
  const EXCEPTIONS_NAV_TABS: string =
    "Components/Exceptions/ExceptionsNavTabs.tsx";

  function exceptionsTabsArray(): string {
    return blockAfter(
      readSquashed(EXCEPTIONS_NAV_TABS),
      "const tabs: Array<TelemetryTab> = [",
      "[",
      "]",
    );
  }

  test("exactly three of the five tabs carry the scope", () => {
    /*
     * Three, not five. The count on its own is a weak guard — see the
     * per-tab test below — but it is what catches a sixth tab being added
     * with the marker copy-pasted along with the rest of the object.
     */
    expect(countOccurrences(exceptionsTabsArray(), "carriesScope: true")).toBe(
      3,
    );
  });

  test.each([
    ["unresolved", true],
    ["resolved", true],
    ["archived", true],
    ["overview", false],
    ["setup", false],
  ])(
    "the %s tab object is the one that decides, not the count",
    (key: string, carries: boolean) => {
      /*
       * Unresolved / Resolved / Archived are the SAME viewer with a
       * different status default, so a service filter, a search or a window
       * set on one describes the other two exactly. Those three carry.
       *
       * Overview must not. It is a different, unscoped component: handing it
       * a filtered URL would put a scope in the address bar that none of its
       * numbers honour, which is worse than losing the filter — the user
       * reads project-wide totals under a five-service label and believes
       * them. Setup Guide is not a view of the data at all.
       *
       * Asserting per tab rather than by count is the point: moving the
       * marker from Archived to Overview keeps the count at three and breaks
       * exactly this test.
       */
      const entry: string = tabEntry(exceptionsTabsArray(), key);

      expect(entry.includes("carriesScope: true")).toBe(carries);
    },
  );
});

describe("the provenance chip never outruns the applied scope", () => {
  const INSIGHTS_PAGES: Array<[string, string]> = [
    ["Logs", "Components/Logs/LogsDashboard.tsx"],
    ["Traces", "Components/Traces/TracesDashboard.tsx"],
    ["Metrics", "Components/Metrics/MetricsDashboard.tsx"],
  ];

  test.each(INSIGHTS_PAGES)(
    "%s renders the saved-view chip beside the unapplied-filters hint",
    (_signal: string, relative: string) => {
      /*
       * "Scoped by saved view: DV-IMS" is a claim about the numbers on the
       * page. It is only true of the part of the view this page can apply —
       * a search, an attribute predicate or a root-only flag carried along
       * with it is NOT in the aggregate. Those two facts have to appear
       * together or the chip becomes a lie of omission: the user reads a
       * view's name over numbers that honour half of it.
       *
       * So the two are pinned as one block, sharing one render condition,
       * with no element boundary between them. Splitting them into separate
       * blocks — the natural refactor when someone restyles the header — is
       * what would let the chip render on a page where the hint does not.
       */
      const source: string = readSquashed(relative);

      const guardAt: number = source.indexOf(
        "{(savedViewName || unappliedFiltersHint) && (",
      );
      const chipAt: number = source.indexOf("Scoped by saved view");
      const hintAt: number = source.indexOf(
        "<HintChip>{unappliedFiltersHint}</HintChip>",
      );

      expect(guardAt).toBeGreaterThanOrEqual(0);
      expect(chipAt).toBeGreaterThan(guardAt);
      expect(hintAt).toBeGreaterThan(chipAt);
      expect(source.slice(guardAt, hintAt)).not.toContain("</div>");
    },
  );

  test.each([
    ["Traces", "Components/Traces/TracesDashboard.tsx"],
    ["Metrics", "Components/Metrics/MetricsDashboard.tsx"],
  ])(
    "%s counts the carried search among the filters it is not applying",
    (_signal: string, relative: string) => {
      /*
       * `search` is a real predicate on both explorers, and neither Insights
       * page compiles it. Carrying it silently is the worst of the three
       * options: the page shows an unnarrowed aggregate, the chip says the
       * scope came from a view, and nothing on screen mentions the search
       * text that is still travelling in the URL and will reappear on the
       * way back. Passing it to the describer is what turns it into
       * "search text" in the hint.
       */
      const source: string = readSquashed(relative);

      expect(source).toContain(
        "describeUnappliedScopeFilters(unappliedFilters, { search: carriedSearch,",
      );
    },
  );

  test.each([
    ["Traces", "Components/Traces/TracesDashboard.tsx", true],
    ["Metrics", "Components/Metrics/MetricsDashboard.tsx", false],
  ])(
    "%s hands the carried predicates to every link it builds",
    (_signal: string, relative: string, carriesRootOnly: boolean) => {
      /*
       * The original defect one layer up, and the one gap the rest of this
       * work left open: the codec can carry `search` and `rootOnly`
       * perfectly while the page never hands them over.
       *
       * Both pages call buildServiceScopedInsightsUrlParams TWICE — once to
       * mirror the scope into the URL, once to build the "Open Viewer"
       * route — and dropping the arguments from either one is silent. The
       * hint would still admit the search is not applied while the link
       * back quietly discarded it, which is a worse failure than not
       * carrying it at all: the page would be telling the truth about a
       * predicate it was in the middle of destroying.
       *
       * rootOnly is Traces-only; Metrics has no root-span dimension.
       */
      const source: string = readSquashed(relative);

      const callSites: Array<string> = source
        .split("buildServiceScopedInsightsUrlParams({")
        .slice(1)
        .map((rest: string): string => {
          return rest.slice(0, rest.indexOf("})"));
        });

      expect(callSites).toHaveLength(2);

      for (const callSite of callSites) {
        expect(callSite).toContain("search: carriedSearch,");

        if (carriesRootOnly) {
          expect(callSite).toContain("rootOnly: carriedRootOnly,");
        }
      }
    },
  );
});

describe("every viewer that carries scope writes its window down", () => {
  /*
   * Including the Exceptions viewer, whose three status tabs carry scope for
   * the same reason the telemetry tabs do.
   */
  const SCOPE_CARRYING_VIEWERS: Array<[string, string]> = [
    ["Logs", "Components/Logs/LogsViewer.tsx"],
    ["Traces", "Components/Traces/TracesViewer.tsx"],
    ["Metrics", "Components/Metrics/MetricsViewer.tsx"],
    ["Exceptions", "Components/Exceptions/ExceptionsViewer.tsx"],
  ];

  test.each(SCOPE_CARRYING_VIEWERS)(
    "%s writes the range with no default-value shortcut",
    (_signal: string, relative: string) => {
      /*
       * A window that is not written down cannot be carried. Omitting the
       * range when it equals the explorer's own default kept the URL short
       * and was harmless while each tab was an island; it stops being
       * harmless the moment a sibling reads the window out of the URL and
       * falls back to ITS default when the param is absent. The two defaults
       * differ (an hour here, a day there), so "I am looking at the last
       * hour" silently became "the last day" on arrival — same page, same
       * label, different numbers.
       *
       * The negative match is the load-bearing half: any conditional wrapped
       * around the write reintroduces the bug, whatever it compares against,
       * so it is pinned by shape rather than by the one condition that
       * happened to be there.
       */
      const source: string = readSquashed(relative);

      expect(source).toContain('params.set("range", timeRange.range);');
      expect(source).not.toMatch(
        /*
         * Non-greedy across ANY characters, not `[^)]*`. The obvious form
         * — `if (timeRange.range !== TimeRange.PAST_ONE_DAY)` — has no
         * nested parenthesis, but the two most natural ways to reintroduce
         * the skip do: `if (timeRange.range !== getDefaultRange())` and
         * `if (shouldWriteRange(timeRange))`. A character class that stops
         * at the first ")" misses both and leaves this test green over the
         * exact defect it exists to catch.
         */
        /if \([\s\S]*?\)\s*\{\s*params\.set\("range", timeRange\.range\);/,
      );
    },
  );
});
