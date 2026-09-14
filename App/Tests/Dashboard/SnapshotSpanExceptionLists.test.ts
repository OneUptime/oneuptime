import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Alert and Incident detail pages (and the episode pages, and the
 * companion-signal tabs on all four) used to render a trace monitor's spans
 * and an exception monitor's occurrences through two dense
 * `AnalyticsModelTable`s. They now embed the SAME explorers the /traces and
 * /exceptions pages use, which is what the logs branch has always done with
 * `DashboardLogsViewer`.
 *
 * Everything decidable without a renderer is decided in the pure readers and
 * covered properly in SpanQueryScope.test.ts / ExceptionQueryScope.test.ts.
 * What is left is the wiring — and wiring is exactly where this change can
 * fail invisibly: an embed that forgets `disableUrlSync` rewrites the
 * incident's address bar, one that forgets `defaultStatus="all"` shows an
 * empty list for an incident whose exceptions were since resolved, and one
 * that keeps the group query's `lastSeenAt` clause hides every exception
 * still firing. None of those throw; they just show the wrong rows.
 *
 * The App suite runs in plain Node with no renderer (App/jest.config.json:
 * "testEnvironment": "node"), the same constraint
 * TelemetryPreviewSnapshotWindow.test.ts works around the same way. Sources
 * are comment-stripped and whitespace-squashed first, so a prettier re-wrap
 * cannot turn a real regression check into a red herring.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readSource(...relativeParts: Array<string>): string {
  return squash(
    stripComments(
      fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
    ),
  );
}

/** Source with comments intact — for asserting a rule is explained, not just applied. */
function readRaw(...relativeParts: Array<string>): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8");
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const ALERT_VIEW: string = readSource("Pages", "Alerts", "View", "Index.tsx");
const INCIDENT_VIEW: string = readSource(
  "Pages",
  "Incidents",
  "View",
  "Index.tsx",
);
const SNAPSHOT_PANEL: string = readSource(
  "Components",
  "Telemetry",
  "TelemetrySnapshotPanel.tsx",
);
const COMPANION_TABS: string = readSource(
  "Components",
  "Telemetry",
  "TelemetryCompanionSignalTabs.tsx",
);
const TRACES_VIEWER: string = readSource(
  "Components",
  "Traces",
  "TracesViewer.tsx",
);
const EXCEPTIONS_VIEWER: string = readSource(
  "Components",
  "Exceptions",
  "ExceptionsViewer.tsx",
);
const EXCEPTIONS_VIEWER_RAW: string = readRaw(
  "Components",
  "Exceptions",
  "ExceptionsViewer.tsx",
);

/*
 * The four surfaces that must move together. TelemetrySnapshotPanel is the
 * extracted twin of the two Index pages and is what the alert / incident
 * EPISODE pages mount, so leaving it behind would silently give episodes the
 * old tables. The companion tabs render the trace / exception panels on ALL
 * of them (and in the AI investigation drawer), so a Log-primary incident's
 * Traces tab would otherwise be a table while a Trace-primary one is a list.
 */
const SNAPSHOT_HOSTS: Array<[string, string]> = [
  ["alert page", ALERT_VIEW],
  ["incident page", INCIDENT_VIEW],
  ["shared snapshot panel", SNAPSHOT_PANEL],
  ["companion signal tabs", COMPANION_TABS],
];

describe("the snapshot hosts embed the explorers, not the tables", () => {
  test.each(SNAPSHOT_HOSTS)(
    "%s mounts TracesViewer and ExceptionsViewer",
    (_name: string, source: string) => {
      expect(source).toContain("<TracesViewer");
      expect(source).toContain("<ExceptionsViewer");
    },
  );

  test.each(SNAPSHOT_HOSTS)(
    "%s no longer mounts the dense tables",
    (_name: string, source: string) => {
      expect(source).not.toContain("<TraceTable");
      expect(source).not.toContain("<ExceptionInstanceTable");
    },
  );

  test.each(SNAPSHOT_HOSTS)(
    "%s hands the stored query straight to the explorer",
    (_name: string, source: string) => {
      /*
       * The whole point: the explorer is scoped by the query the monitor
       * evaluated, not by a hand-copied subset of it.
       */
      expect(source).toContain("spanQuery=");
      expect(source).toContain("exceptionInstanceQuery=");
    },
  );

  test.each(SNAPSHOT_HOSTS)(
    "%s owns the URL, so the embed cannot rewrite the host page's address bar",
    (_name: string, source: string) => {
      expect(countOccurrences(source, "disableUrlSync={true}")).toBe(2);
      expect(source).not.toContain("disableUrlState");
    },
  );

  test.each(SNAPSHOT_HOSTS)(
    "%s opens the exception list on every status and every error class",
    (_name: string, source: string) => {
      /*
       * The explorer's own defaults are "unresolved" + the "issues" class
       * lens. On an event page those hide exactly the rows the operator came
       * for: an exception someone resolved after the incident, or one the
       * classifier called a user error. The list would read "No exceptions
       * found" with nothing on screen explaining why.
       */
      expect(source).toContain('defaultStatus="all"');
      expect(source).toContain('defaultClassScope="all"');
    },
  );

  test.each(SNAPSHOT_HOSTS)(
    "%s keeps the block short with an explicit page size",
    (_name: string, source: string) => {
      /*
       * The logs embed's `limit={10}`, for the same reason: a snapshot card
       * must not run the length of the page.
       */
      expect(countOccurrences(source, "limit={10}")).toBeGreaterThanOrEqual(2);
    },
  );

  test.each(SNAPSHOT_HOSTS)(
    "%s names the empty state instead of leaving the explorer's generic copy",
    (_name: string, source: string) => {
      expect(source).toContain("emptyMessage=");
    },
  );
});

describe("the snapshot window stays visible on every card", () => {
  test.each([
    ["alert page", ALERT_VIEW],
    ["incident page", INCIDENT_VIEW],
    ["shared snapshot panel", SNAPSHOT_PANEL],
  ])(
    "%s badges all four preview cards with the window",
    (_name: string, source: string) => {
      /*
       * Card ownership moved from the components to the hosts when the tables
       * were swapped out — the tables drew their own card, the explorers do
       * not. The badge had to move with it: a snapshot with nothing on screen
       * claiming a window reads as live data.
       */
      expect(
        countOccurrences(source, "rightElement={snapshotWindowAlert}"),
      ).toBe(4);
    },
  );

  test("the companion tabs badge their cards from the host's element", () => {
    /*
     * Five, not four: the logs, spans, exceptions and metrics tabs, plus the
     * metrics tab's "no metrics in this scope" card, which has to carry the
     * window too — an empty result is the case where "empty of what?" matters
     * most.
     */
    expect(
      countOccurrences(
        COMPANION_TABS,
        "rightElement={props.snapshotWindowAlert}",
      ),
    ).toBe(5);
  });

  test.each([
    ["alert page", ALERT_VIEW],
    ["incident page", INCIDENT_VIEW],
    ["shared snapshot panel", SNAPSHOT_PANEL],
  ])(
    "%s wraps the span list in its own card",
    (_name: string, source: string) => {
      expect(source).toContain('title={"Spans"}');
    },
  );
});

describe("TracesViewer hosts a stored span query", () => {
  test("it takes the query, a page size and an empty message", () => {
    expect(TRACES_VIEWER).toContain("spanQuery?: Query<Span> | undefined;");
    expect(TRACES_VIEWER).toContain("limit?: number | undefined;");
    expect(TRACES_VIEWER).toContain("emptyMessage?: string | undefined;");
  });

  test("the scope is read ONCE, by the shared reader", () => {
    /*
     * The list query and the histogram / facet payload speak different
     * vocabularies. Reading the stored query separately for each is how a
     * chart ends up counting rows the list excludes, so both must derive from
     * one buildSpanQueryScope result.
     */
    expect(TRACES_VIEWER).toContain("buildSpanQueryScope(props.spanQuery)");
    expect(countOccurrences(TRACES_VIEWER, "buildSpanQueryScope")).toBe(2);
  });

  test("the scope reaches the list query", () => {
    expect(TRACES_VIEWER).toContain("spanScope.serviceIds");
    expect(TRACES_VIEWER).toContain("spanScope.entityKeys");
    expect(TRACES_VIEWER).toContain("spanScope.attributes");
    expect(TRACES_VIEWER).toContain("spanScope.statusCodes");
    expect(TRACES_VIEWER).toContain("spanScope.spanNameSearch");
    // Scope the payload cannot express still filters the list — never dropped.
    expect(TRACES_VIEWER).toContain(
      "for (const [key, value] of Object.entries(spanScope.passthrough))",
    );
  });

  test("the scope reaches the histogram and facet payload too", () => {
    // applyScopeGroup feeds the same `groups` map the chips and search feed.
    expect(TRACES_VIEWER).toContain("const applyScopeGroup:");
    expect(TRACES_VIEWER).toContain(
      'applyScopeGroup("primaryEntityId", spanScope.serviceIds)',
    );
    expect(TRACES_VIEWER).toContain(
      'applyScopeGroup( "statusCode", spanScope.statusCodes',
    );
    expect(TRACES_VIEWER).toContain(
      'applyScopeGroup( "name", spanScope.spanNameSearch',
    );
    /*
     * entityKeys does not ride `groups` — it is its own payload field, and it
     * has to carry the entityKeysFilter prop AND the stored scope together or
     * the counts above the list are project-wide.
     */
    expect(TRACES_VIEWER).toContain(
      "new Set([...(props.entityKeysFilter || []), ...spanScope.entityKeys]),",
    );
    expect(TRACES_VIEWER).toContain(
      'payload["entityKeys"] = scopedEntityKeys;',
    );
  });

  test("a user's own filter on a scoped column wins, in both transports", () => {
    /*
     * Drill-down, matching how `primaryEntityId` has always behaved: the
     * scope is written first in the list query and an explicit selection
     * overwrites it, so the payload must skip a column the user has filtered
     * rather than OR the scope back in.
     */
    expect(TRACES_VIEWER).toContain(
      "if (groups[key] && groups[key]!.length > 0) { return; }",
    );

    /*
     * The primaryEntityId PROP goes through the same gate, and after the
     * stored scope — otherwise a host that set both would union them in the
     * payload while the list intersects, and the chart would count services
     * the list excludes.
     */
    const scopeIndex: number = TRACES_VIEWER.indexOf(
      'applyScopeGroup("primaryEntityId", spanScope.serviceIds)',
    );
    const propIndex: number = TRACES_VIEWER.indexOf(
      'applyScopeGroup("primaryEntityId", [props.primaryEntityId.toString()])',
    );

    expect(scopeIndex).toBeGreaterThan(-1);
    expect(propIndex).toBeGreaterThan(scopeIndex);
    expect(TRACES_VIEWER).not.toContain('groups["primaryEntityId"]!.push(');
  });

  test("the window is adopted as a pin, and the pin outranks a controlled window", () => {
    expect(TRACES_VIEWER).toContain(
      "TelemetryQueryTimeRange.toRangeStartAndEndDateTime(spanScope.window)",
    );
    expect(TRACES_VIEWER).toContain(
      "pinnedTimeRange || props.timeRangeOverride || initialUrlState.timeRange",
    );
  });

  test("a hosted view is not seeded from, or saved over by, the URL", () => {
    /*
     * `hostOwnsView` is the traces counterpart of the logs viewer's guarantee
     * for its incident embeds. Without the saved-view half, the project's
     * DEFAULT saved view auto-applies over the pin a tick after mount, and
     * the card silently shows someone's saved filters instead of the event.
     */
    expect(TRACES_VIEWER).toContain(
      "const hostOwnsView: boolean = Boolean( props.disableUrlSync || props.spanQuery || props.timeRangeOverride, );",
    );
    expect(TRACES_VIEWER).toContain('if (hostOwnsView) { return { search: "",');
    expect(TRACES_VIEWER).toContain("!hostOwnsView && !spanScope.hasScope &&");
    expect(TRACES_VIEWER).toContain("return ( hostOwnsView ||");
  });

  test("the URL mirror follows hostOwnsView, not just the explicit opt-out", () => {
    /*
     * A host that pins a query owns the address bar as much as one that
     * opted out by name. Gating only on `disableUrlSync` would let a future
     * embed write `?search=…&range=…` onto the incident page it sits on.
     */
    expect(TRACES_VIEWER).toContain("if (hostOwnsView) { return; }");
    expect(TRACES_VIEWER).not.toContain(
      "if (props.disableUrlSync) { return; }",
    );
  });

  test("a pinned window is not steered by a controlled one", () => {
    expect(TRACES_VIEWER).toContain(
      "if (pinnedTimeRange) { return; } if ( !shouldAdoptTimeRangeOverride(",
    );
  });

  test("the cross-signal pivots are hidden on a hosted snapshot", () => {
    /*
     * They carry the chips and the window, not the host's stored scope, so
     * from an incident card they would open the logs explorer project-wide
     * under a button promising "scoped like this view".
     */
    expect(TRACES_VIEWER).toContain(
      'props.spanQuery ? "hidden" : "inline-flex"',
    );
  });

  test("a scope chip disappears once the user filters that column themselves", () => {
    /*
     * On that column the user's selection REPLACES the scope, so a chip
     * claiming the scope still applies would be describing a filter that is
     * no longer in the query.
     */
    expect(TRACES_VIEWER).toContain(
      "if (userFilteredFacetKeys.has(chip.facetKey)) { continue; }",
    );

    /*
     * Chips are not the only way a column gets claimed. `status:`, `kind:`
     * and `duration:` deliberately never become chips — their typed spelling
     * is not the value that reaches the database, so the search bar keeps the
     * token in the input and submits it as text. Reading only `activeFilters`
     * left the scope's "Status: Error" chip on screen after a typed
     * `status:ok` had already replaced it in the query.
     */
    expect(TRACES_VIEWER).toContain(
      "const typedSearch: ParsedTraceSearch = parseTraceSearch(submittedSearch);",
    );
    expect(TRACES_VIEWER).toContain(
      "for (const fieldKey of Object.keys(typedSearch.fieldFilters)) { userFilteredFacetKeys.add(fieldKey); }",
    );
  });

  test("free text narrows the chart exactly when it narrows the list", () => {
    /*
     * The list applies bare free text to `name` only when nothing else has
     * claimed that column. With a stored scope pinning `name` — every trace
     * monitor that names a span — an unconditional `nameSearchText` made the
     * chart filter while the list did not.
     */
    expect(TRACES_VIEWER).toContain(
      'if ( freeText && freeText.length > 0 && !(groups["name"] && groups["name"].length > 0) ) { payload["nameSearchText"] = freeText; }',
    );
  });

  test("attribute scope values are strings, because the payload parser drops anything else", () => {
    /*
     * Common/Server/API/TelemetryAPI.ts parseAttributeFilterRecord keeps
     * strings, string arrays and serialized operators — a bare number is
     * DROPPED. A numeric monitor attribute would have narrowed the list while
     * the chart and facet counts above it silently ignored the filter.
     */
    const SPAN_SCOPE: string = readSource("Utils", "SpanQueryScope.ts");

    expect(SPAN_SCOPE).toContain("attributes: Dictionary<string>;");
    expect(SPAN_SCOPE).toContain("scope.attributes[key] = String(value);");
  });

  test("the un-carried scope is rendered, not merely computed", () => {
    // The module's whole "never silent" guarantee depends on a consumer.
    expect(TRACES_VIEWER).toContain(
      'const scopeHint: string = spanScope.notCarried.join(", ");',
    );
    expect(TRACES_VIEWER).toContain("if (!scopeHint) { return viewer; }");
  });
});

describe("ExceptionsViewer hosts a stored exception-instance query", () => {
  test("it takes the query, the lens overrides, a page size and an empty message", () => {
    expect(EXCEPTIONS_VIEWER).toContain(
      "exceptionInstanceQuery?: Query<ExceptionInstance> | undefined;",
    );
    expect(EXCEPTIONS_VIEWER).toContain(
      "defaultClassScope?: ExceptionClassScope | undefined;",
    );
    expect(EXCEPTIONS_VIEWER).toContain("limit?: number | undefined;");
    expect(EXCEPTIONS_VIEWER).toContain("emptyMessage?: string | undefined;");
    expect(EXCEPTIONS_VIEWER).toContain(
      "disableUrlSync?: boolean | undefined;",
    );
  });

  test("the host scope rides the existing fingerprint join, not a second filter path", () => {
    /*
     * TelemetryException has no attributes column, no entityKeys and no
     * per-occurrence time — the join through ClickHouse fingerprints is the
     * only thing that can carry an instance query onto the group list, and it
     * is already what narrows the list, the histogram and the facet counts
     * together.
     */
    expect(EXCEPTIONS_VIEWER).toContain(
      "buildExceptionQueryScope(props.exceptionInstanceQuery)",
    );
    expect(EXCEPTIONS_VIEWER).toContain(
      "mergeExceptionInstanceScopes(hostScope.instanceScope, userScope)",
    );
  });

  test("the class lens can be opened by the host", () => {
    expect(EXCEPTIONS_VIEWER).toContain(
      "initialUrlState.classScope || props.defaultClassScope || DEFAULT_EXCEPTION_CLASS_SCOPE",
    );
  });

  test("a hosted view neither seeds from nor writes to the URL", () => {
    expect(EXCEPTIONS_VIEWER).toContain(
      "const hostOwnsView: boolean = Boolean( props.disableUrlSync || props.exceptionInstanceQuery, );",
    );
    expect(EXCEPTIONS_VIEWER).toContain("if (hostOwnsView) { return; }");
  });

  test("the pinned window seeds the picker", () => {
    expect(EXCEPTIONS_VIEWER).toContain(
      "TelemetryQueryTimeRange.toRangeStartAndEndDateTime(hostScope.window)",
    );
    expect(EXCEPTIONS_VIEWER).toContain(
      "timeRange: pinnedTimeRange || { range: TimeRange.PAST_ONE_DAY }",
    );
  });

  test("a window-only stored query still counts as hosted", () => {
    /*
     * THE case that makes the trap bite. The default exception monitor
     * ("any exception in the last 60 seconds") filters nothing, so its stored
     * query is `{ time }` and nothing else. Branching on "does it filter
     * anything" would leave that — the most common monitor there is — on the
     * lastSeenAt path, hiding every exception still firing. `isHosted` is
     * true for any query a host handed over, filters or not.
     */
    expect(EXCEPTIONS_VIEWER).toContain(
      "if (!hasExceptionInstanceScope(instanceScope) && !hostScope.isHosted) { return null; }",
    );
  });

  test("the group query drops lastSeenAt whenever fingerprints carry the window", () => {
    /*
     * THE trap of the group approach. `lastSeenAt` is the group's last
     * occurrence ANYWHERE, so for an exception still firing after the
     * snapshot ended it sits past the window. ANDing it with the fingerprint
     * set — which was already resolved from instances INSIDE the window —
     * drops exactly the exceptions an operator opens an incident to find.
     * The same applies to attribute/operator searches and fixed entity-key
     * scopes on historical windows, not only hosted snapshots.
     */
    expect(EXCEPTIONS_VIEWER).toContain("applyExceptionGroupQueryScope({");
    expect(EXCEPTIONS_VIEWER).toContain(
      "resolvedFingerprints: resolvedScopeFingerprints",
    );
  });

  test("an in-flight fingerprint resolution reads as loading, not as empty", () => {
    /*
     * While the resolution is in flight the list query carries the no-match
     * sentinel and comes back empty BY DESIGN. Rendering that as the empty
     * state would flash "No exceptions found" on an incident card and then
     * fill in.
     */
    expect(EXCEPTIONS_VIEWER).toContain(
      "isLoading={isLoading || isResolvingScope}",
    );
  });

  test("the reason lastSeenAt is dropped is written down next to the code", () => {
    // A future reader deleting this branch as redundant is the regression.
    expect(EXCEPTIONS_VIEWER_RAW).toContain("still firing");
  });
});

describe("both explorers surface the host's scope as read-only chips", () => {
  test.each([
    ["TracesViewer", TRACES_VIEWER, "spanScope.chips as Array<SpanScopeChip>"],
    ["ExceptionsViewer", EXCEPTIONS_VIEWER, "hostScope.chips"],
  ])(
    "%s renders the scope chips and marks them read-only",
    (_name: string, source: string, chipsExpression: string) => {
      /*
       * A snapshot that filters silently makes a short list look like the
       * whole truth. The chips are also what stops a user "clearing all"
       * their way out of the event's own scope.
       */
      expect(source).toContain(`for (const chip of ${chipsExpression})`);
      expect(source).toContain("readOnly: true,");
    },
  );
});

describe("the two dense tables survive for their non-snapshot users", () => {
  /*
   * The snapshot cards stopped using TraceTable and ExceptionInstanceTable,
   * but neither component is dead: a live monitor-config preview, a trace's
   * own exceptions and the monitor detail page all still want a table,
   * because none of them is an event snapshot. Deleting either would also
   * break TelemetryPreviewSnapshotWindow.test.ts, which readFileSyncs both.
   *
   * Asserted by SCANNING for mounters rather than by naming call sites. An
   * earlier version listed the files it expected and went red the moment
   * unrelated session-replay work removed one of them — pinning another
   * team's file contents to guard THIS change is a promise the test cannot
   * keep. What matters is that the components still exist and still have a
   * user outside the surfaces this change moved.
   */
  const SNAPSHOT_HOST_PATHS: ReadonlyArray<string> = [
    path.join("Pages", "Alerts", "View", "Index.tsx"),
    path.join("Pages", "Incidents", "View", "Index.tsx"),
    path.join("Components", "Telemetry", "TelemetrySnapshotPanel.tsx"),
    path.join("Components", "Telemetry", "TelemetryCompanionSignalTabs.tsx"),
  ];

  function collectSourceFiles(directory: string): Array<string> {
    const files: Array<string> = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        files.push(...collectSourceFiles(full));
        continue;
      }

      if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        files.push(full);
      }
    }

    return files;
  }

  const ALL_SOURCES: Array<string> = collectSourceFiles(DASHBOARD_SRC);

  function findMounters(componentName: string): Array<string> {
    return ALL_SOURCES.filter((file: string): boolean => {
      const relative: string = path.relative(DASHBOARD_SRC, file);

      if (
        SNAPSHOT_HOST_PATHS.includes(relative) ||
        path.basename(file) === `${componentName}.tsx`
      ) {
        return false;
      }

      return squash(stripComments(fs.readFileSync(file, "utf8"))).includes(
        `<${componentName}`,
      );
    });
  }

  test.each([
    ["TraceTable", path.join("Components", "Traces", "TraceTable.tsx")],
    [
      "ExceptionInstanceTable",
      path.join("Components", "Exceptions", "ExceptionInstanceTable.tsx"),
    ],
  ])(
    "%s still exists and is still mounted outside the snapshot hosts",
    (componentName: string, componentRelativePath: string) => {
      expect(
        fs.existsSync(path.join(DASHBOARD_SRC, componentRelativePath)),
      ).toBe(true);
      expect(findMounters(componentName).length).toBeGreaterThan(0);
    },
  );

  test.each(SNAPSHOT_HOST_PATHS)(
    "%s does not mount either table any more",
    (relative: string) => {
      const source: string = squash(
        stripComments(
          fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8"),
        ),
      );

      expect(source).not.toContain("<TraceTable");
      expect(source).not.toContain("<ExceptionInstanceTable");
    },
  );
});
