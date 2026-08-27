import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { TelemetryViewerUrlParamNames } from "../../FeatureSet/Dashboard/src/Utils/TelemetryViewerUrlState";

/*
 * The wiring behind the Viewer <-> Insights scope hand-off.
 *
 * The logic itself is pinned in TelemetryTabScope.test.ts,
 * LogsInsightsTabScope.test.ts and InitialSavedView.test.ts, which exercise
 * pure functions. What those cannot see is whether the six surfaces
 * involved — three nav tab bars, three Insights pages, three explorers and
 * the shared saved-views control — actually CALL them. A hand-off is only
 * as good as its least-connected end: the Insights page can parse a scope
 * perfectly and still show "All services and hosts" if the tab link never
 * carried it.
 *
 * So this suite reads the sources and asserts the connections. It is a
 * coarse instrument, deliberately: it guards against a connection being
 * deleted or forgotten on a fourth signal, not against a subtle logic bug —
 * that is the other suites' job.
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

const NAV_TABS: Array<[string, string]> = [
  ["Logs", "Components/Logs/LogsNavTabs.tsx"],
  ["Traces", "Components/Traces/TracesNavTabs.tsx"],
  ["Metrics", "Components/Metrics/MetricsNavTabs.tsx"],
];

const VIEWERS: Array<[string, string]> = [
  ["Logs", "Components/Logs/LogsViewer.tsx"],
  ["Traces", "Components/Traces/TracesViewer.tsx"],
  ["Metrics", "Components/Metrics/MetricsViewer.tsx"],
];

const INSIGHTS_PAGES: Array<[string, string]> = [
  ["Logs", "Components/Logs/LogsDashboard.tsx"],
  ["Traces", "Components/Traces/TracesDashboard.tsx"],
  ["Metrics", "Components/Metrics/MetricsDashboard.tsx"],
];

describe("nav tabs carry the scope", () => {
  test.each(NAV_TABS)(
    "%s marks exactly its Viewer and Insights tabs as scope-carrying",
    (_signal: string, relative: string) => {
      const source: string = readSquashed(relative);

      /*
       * Two, not four. Setup Guide and Settings are not views of the data,
       * and handing them a filtered URL would only be confusing.
       */
      expect(countOccurrences(source, "carriesScope: true")).toBe(2);
    },
  );

  test("the shared tab bar appends the current scope to those links", () => {
    const source: string = readSquashed("Components/Telemetry/NavTabs.tsx");

    expect(source).toContain("readTelemetryTabScopeParams");
    expect(source).toContain("withTelemetryTabScopeParams");
    expect(source).toContain("tab.carriesScope");
  });

  test("the tab bar re-reads the URL when an explorer rewrites it", () => {
    /*
     * The explorers mirror their scope with history.replaceState, which
     * fires no event and re-renders nothing. Without this subscription the
     * tab links would keep the hrefs they were born with and hand the
     * sibling tab whatever the scope was on first render — so a filter set
     * after the tabs rendered would silently not carry.
     */
    const source: string = readSquashed("Components/Telemetry/NavTabs.tsx");

    expect(source).toContain("subscribeToTelemetryViewerUrlState");
    expect(source).toContain('window.addEventListener("popstate", sync)');
    expect(source).toContain('window.removeEventListener("popstate", sync)');
  });
});

describe("the URL state writer", () => {
  test("owns the savedView param, so deselecting a view removes it", () => {
    /*
     * An unregistered param can be set but never cleared, so a view the user
     * deselected would linger in the URL and re-apply on the next refresh.
     */
    expect(TelemetryViewerUrlParamNames).toContain("savedView");
  });

  test("notifies subscribers on every write", () => {
    const source: string = readSquashed("Utils/TelemetryViewerUrlState.ts");

    expect(source).toContain("Navigation.setQueryString");
    expect(source).toContain("notifyTelemetryViewerUrlStateListeners()");
    expect(source).toContain("subscribeToTelemetryViewerUrlState");
  });

  test("isolates subscribers, so one that throws cannot swallow the notice", () => {
    const source: string = readSquashed("Utils/TelemetryViewerUrlState.ts");

    expect(source).toContain(
      "for (const listener of Array.from(urlStateListeners))",
    );
    expect(source).toContain("try { listener(); } catch {");
  });
});

describe("the explorers publish their scope", () => {
  test.each(VIEWERS)(
    "%s writes its window unconditionally, so a tab switch cannot move it",
    (_signal: string, relative: string) => {
      /*
       * These used to omit the default range to keep the URL short. Harmless
       * while each tab was an island; not harmless once the sibling tab
       * reads the window out of the URL and falls back to its own default
       * when it is absent.
       */
      const source: string = readSquashed(relative);

      expect(source).toContain('params.set("range", timeRange.range);');
      expect(source).not.toContain(
        'if (timeRange.range !== TimeRange.PAST_ONE_HOUR) { params.set("range"',
      );
    },
  );

  test.each(VIEWERS)(
    "%s writes the selected saved view into the URL",
    (_signal: string, relative: string) => {
      const source: string = readSquashed(relative);

      expect(source).toContain('params.set("savedView", selectedSavedViewId);');
    },
  );

  test.each(VIEWERS)(
    "%s reads a saved view named by the link back out of it",
    (_signal: string, relative: string) => {
      expect(readSquashed(relative)).toContain('params.get("savedView")');
    },
  );
});

describe("the initial saved view no longer clobbers a deep link", () => {
  test("the Logs explorer defers the precedence to the shared resolver", () => {
    const source: string = readSquashed("Components/Logs/LogsViewer.tsx");

    expect(source).toContain("resolveInitialSavedView<LogSavedView>");
    expect(source).toContain("urlSavedViewId: initialUrlState?.savedViewId");
    expect(source).toContain("hasUrlScope: Boolean(initialUrlState?.hasScope)");
  });

  test("the Logs explorer waits for the saved-view fetch to finish", () => {
    /*
     * It used to gate on `!isSavedViewLoading`, which it read out of the same
     * commit that STARTS the fetch — the flag is still false there, so the
     * effect ran against an empty list, marked itself done, and no default
     * view was ever applied. Gating on "has the fetch settled" removes the
     * race, and is what makes a URL-named view actually apply.
     */
    const source: string = readSquashed("Components/Logs/LogsViewer.tsx");

    expect(source).toContain(
      "if (hasAppliedInitialSavedView.current || !hasFetchedSavedViews)",
    );
    expect(source).toContain("setHasFetchedSavedViews(true);");
  });

  test("the project default stays a standalone-explorer idea", () => {
    /*
     * Un-breaking the race above means the default view now genuinely
     * applies where it never used to. That is right on /logs and wrong
     * inside an embedded panel: applying one on a service's Logs tab would
     * silently re-window and re-filter a panel the user opened to see that
     * service's logs. `!syncUrlState` is this viewer's marker for embedded,
     * and it is the same line the Traces and Metrics explorers already draw
     * with enableSavedViews.
     */
    const source: string = readSquashed("Components/Logs/LogsViewer.tsx");

    expect(source).toContain(
      "hostOwnsView: Boolean( pinnedTimeRange || props.timeRangeOverride || !props.syncUrlState, )",
    );
  });

  test("a URL-named view is applied under the scope the same URL carries", () => {
    /*
     * The trip back from Insights says "the DV-IMS view, but with the window
     * and services I ended up on". The URL is the more recent statement, so
     * it wins over the view's own window and chips — while the view still
     * supplies the columns, sort and page size the URL does not carry.
     */
    const source: string = readSquashed("Components/Logs/LogsViewer.tsx");

    expect(source).toContain(
      'resolution.source === "url" && initialUrlState?.hasScope',
    );
    expect(source).toContain("overrideTimeRange: initialUrlState.hasRange");
    expect(source).toContain(
      "overrideFacetFilters: initialUrlState.hasFilters",
    );
  });

  test("the shared saved-views control uses the same resolver", () => {
    const source: string = readSquashed(
      "Components/Telemetry/TelemetrySavedViewsControl.tsx",
    );

    expect(source).toContain("resolveInitialSavedView<T>");
    expect(source).toContain("urlSavedViewId: initialSavedViewId");
    expect(source).toContain(
      "onSelectionChangeRef.current?.(selectedSavedViewId)",
    );
  });

  test("the shared control drops a stale id rather than leaving it in the URL", () => {
    const source: string = readSquashed(
      "Components/Telemetry/TelemetrySavedViewsControl.tsx",
    );

    expect(source).toContain("if (resolution.isUrlSavedViewMissing)");
  });
});

describe("the Insights pages adopt and re-publish the scope", () => {
  test("Logs seeds its scope, window and saved view from the link", () => {
    const source: string = readSquashed("Components/Logs/LogsDashboard.tsx");

    expect(source).toContain(
      "readLogsInsightsUrlScope(Navigation.getQueryString())",
    );
    expect(source).toContain("initialUrlScope.scopeValues");
    expect(source).toContain("initialUrlScope.unappliedFilters");
    expect(source).toContain("initialUrlScope.savedViewId");
    expect(source).toContain(
      "initialUrlScope.timeRange || { range: LOGS_TAB_DEFAULT_TIME_RANGE }",
    );
  });

  test.each([
    ["Traces", "Components/Traces/TracesDashboard.tsx"],
    ["Metrics", "Components/Metrics/MetricsDashboard.tsx"],
  ])(
    "%s seeds its service scope from the link",
    (_signal: string, relative: string) => {
      const source: string = readSquashed(relative);

      expect(source).toContain(
        "readServiceScopedInsightsUrlScope(Navigation.getQueryString())",
      );
      expect(source).toContain("initialUrlScope.serviceIds");
      expect(source).toContain("initialUrlScope.savedViewId");
    },
  );

  test.each(INSIGHTS_PAGES)(
    "%s mirrors its scope back into the URL",
    (_signal: string, relative: string) => {
      expect(readSquashed(relative)).toContain("writeTelemetryViewerUrlState(");
    },
  );

  test.each(INSIGHTS_PAGES)(
    "%s names the saved view its scope came from, and offers a way out",
    (_signal: string, relative: string) => {
      const source: string = readSquashed(relative);

      expect(source).toContain("Scoped by saved view");
      expect(source).toContain("Stop scoping by this saved view");
    },
  );

  test.each(INSIGHTS_PAGES)(
    "%s says out loud which carried filters it is not applying",
    (_signal: string, relative: string) => {
      const source: string = readSquashed(relative);

      expect(source).toContain("describeUnappliedScopeFilters");
      expect(source).toContain("<HintChip>{unappliedFiltersHint}</HintChip>");
    },
  );

  test.each(INSIGHTS_PAGES)(
    "%s drops the saved-view reference once the user edits the scope",
    (_signal: string, relative: string) => {
      /*
       * The chip is a claim about provenance. Once the user changes the
       * selection the claim is false, and carrying the id onward would send
       * them back into a view whose filters no longer match what they are
       * looking at.
       */
      expect(readSquashed(relative)).toContain("setSavedViewId(null);");
    },
  );

  test.each(INSIGHTS_PAGES)(
    "%s points its in-page Viewer links at the scoped route",
    (_signal: string, relative: string) => {
      /*
       * Not just the tab. A user who followed "Open Viewer" out of an empty
       * Insights page and landed on the unfiltered firehose would reasonably
       * read that as the filter having been lost.
       */
      expect(readSquashed(relative)).toContain("to={viewerRoute}");
    },
  );

  test.each([
    ["Traces", "Components/Traces/TracesDashboard.tsx"],
    ["Metrics", "Components/Metrics/MetricsDashboard.tsx"],
  ])(
    "%s applies the service scope to the fetch, not after it",
    (_signal: string, relative: string) => {
      /*
       * Both pages aggregate a capped fetch client-side. Filtering after the
       * fetch would leave every number describing whichever N rows came back
       * rather than the services the user selected.
       */
      const source: string = readSquashed(relative);

      expect(source).toContain(
        "...(selectedServiceIds.length > 0 ? { primaryEntityId: new Includes(selectedServiceIds) } : {}),",
      );
    },
  );
});

describe("the error drill-down explains and hands off", () => {
  test("builds its findings and classification from its own evidence", () => {
    const source: string = readSquashed(
      "Components/Logs/ErrorPatternDetail.tsx",
    );

    expect(source).toContain(
      "classifyErrorPattern(patternText, props.pattern.sampleBody)",
    );
    expect(source).toContain("buildErrorPatternFindings(evidence)");
    expect(source).toContain("Likely cause and what to check");
    expect(source).toContain("What stands out");
  });

  test("shows the deploys, incidents and alerts around the same window", () => {
    /*
     * The "what else happened when it spiked" the issue asked for. Reuses
     * the same overlay the metric charts draw, so a deploy marked on a chart
     * and a deploy named here are the same record.
     */
    const source: string = readSquashed(
      "Components/Logs/ErrorPatternDetail.tsx",
    );

    expect(source).toContain(
      "useEventTimeReferenceLines({ enabled: true, window: patternWindow, })",
    );
    expect(source).toContain("What else happened in this window");
    expect(source).toContain("readEventKindFromLabel(label)");
  });

  test("hands Ask AI the whole evidence pack, and never auto-sends", () => {
    /*
     * The dispatch carries a prompt, which the panel treats as "open and
     * pre-fill". Sending on the user's behalf — and paying for it — on every
     * drawer open is not what "surfaced in-line" should mean.
     */
    const source: string = readSquashed(
      "Components/Logs/ErrorPatternDetail.tsx",
    );

    expect(source).toContain(
      "GlobalEvents.dispatchEvent(EventName.AI_CHAT_TOGGLE, { prompt: buildErrorPatternPrompt(evidence, findings, classification), });",
    );
    expect(source).toContain("Explain with AI");
  });

  test("resolves the window once for the whole panel", () => {
    /*
     * A preset range resolves against "now" on every call, so resolving it
     * separately for the trend and for the event overlay would let the two
     * describe slightly different windows.
     */
    const source: string = readSquashed(
      "Components/Logs/ErrorPatternDetail.tsx",
    );

    expect(
      countOccurrences(
        source,
        "RangeStartAndEndDateTimeUtil.getStartAndEndDate(",
      ),
    ).toBe(1);
  });
});
