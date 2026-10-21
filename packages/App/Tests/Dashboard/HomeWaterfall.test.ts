import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Home must never become a request waterfall.
 *
 * It used to be one: nothing rendered until the unresolved-incident-states
 * list arrived, then GettingStarted fired four count requests (even when the
 * checklist had been dismissed long ago), and the tiles ran a two-stage
 * fetch in which counts that need no state list still waited behind two
 * state lists. The overview that replaced the tiles reads everything its
 * headline, strip and attention list show in ONE parallel batch
 * (HomeOverviewData.fetchHomeOverview), and every other card reads beside
 * it, never behind it.
 *
 * The shape is structural, not behavioural - the page renders the same
 * pixels either way, just later - so these tests pin the INTENT against the
 * sources (the App suite runs in a plain Node environment): tolerant
 * patterns and structural extraction, never exact byte strings. The batch's
 * behaviour (seven reads in flight before any answers) is checked rendered
 * in Common/Tests/App/Dashboard/HomeOverviewStatsFirstRun.test.tsx.
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");

const DASHBOARD_SRC: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Dashboard",
  "src",
);

/*
 * Comments are stripped before anything is matched: the files under test
 * explain the old waterfall in prose, and an assertion about the code has to
 * read the code rather than the commentary describing what it replaced.
 */
function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readDashboardCode(...relativeParts: Array<string>): string {
  return stripComments(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  );
}

/*
 * Returns the balanced `open...close` block starting at openIndex. The
 * sources under test keep braces/parens/brackets balanced even inside
 * template literals, so a simple depth counter is sufficient and avoids
 * pinning any exact formatting.
 */
function balancedBlock(
  source: string,
  openIndex: number,
  open: string,
  close: string,
): string {
  let depth: number = 0;

  for (let i: number = openIndex; i < source.length; i++) {
    const character: string = source.charAt(i);

    if (character === open) {
      depth++;
    } else if (character === close) {
      depth--;

      if (depth === 0) {
        return source.slice(openIndex, i + 1);
      }
    }
  }

  throw new Error(
    `Unbalanced ${open}${close} block at index ${openIndex} — the source under test changed shape; update HomeWaterfall.test.ts to match.`,
  );
}

/*
 * Every JSX expression container that gates its children on a page's
 * isLoading/error state — `{isLoading && ...}`, `{!isLoading && ... && (...)}`
 * and friends.
 */
function loadingGateBlocks(source: string): Array<string> {
  const blocks: Array<string> = [];
  const gatePattern: RegExp = /\{\s*!?(?:isLoading|error)\b/g;

  let match: RegExpExecArray | null = gatePattern.exec(source);

  while (match !== null) {
    blocks.push(balancedBlock(source, match.index, "{", "}"));
    match = gatePattern.exec(source);
  }

  return blocks;
}

/*
 * The body of the arrow function assigned at the first occurrence of
 * `marker` — tolerant of signature/type changes, it only relies on
 * `marker ... => {`.
 */
function arrowFunctionBody(source: string, marker: string): string {
  const markerIndex: number = source.indexOf(marker);

  expect(markerIndex).toBeGreaterThanOrEqual(0);

  const arrowIndex: number = source.indexOf("=>", markerIndex);

  expect(arrowIndex).toBeGreaterThan(markerIndex);

  /*
   * The arrow of the function's type annotation comes first; the body is
   * the block after the arrow that follows `= async (` / `= (`.
   */
  const assignmentIndex: number = source.indexOf("= ", arrowIndex);
  const bodyArrowIndex: number = source.indexOf("=>", assignmentIndex);
  const braceIndex: number = source.indexOf("{", bodyArrowIndex);

  expect(braceIndex).toBeGreaterThan(bodyArrowIndex);

  return balancedBlock(source, braceIndex, "{", "}");
}

/*
 * The full `useEffect(...)` call whose text contains `needle` — deps array
 * included, so ordering assertions can span the whole effect.
 */
function useEffectContaining(source: string, needle: string): string {
  let searchFrom: number = 0;

  for (;;) {
    const effectIndex: number = source.indexOf("useEffect(", searchFrom);

    if (effectIndex < 0) {
      throw new Error(
        `No useEffect containing "${needle}" found — if the effect was refactored, update HomeWaterfall.test.ts to match.`,
      );
    }

    const block: string = balancedBlock(
      source,
      source.indexOf("(", effectIndex),
      "(",
      ")",
    );

    if (block.includes(needle)) {
      return block;
    }

    searchFrom = effectIndex + 1;
  }
}

/*
 * Top-level entries of the first `Promise.all([...])` array inside `source`,
 * split at depth-zero commas so each entry is one member of the parallel
 * batch regardless of how it is formatted.
 */
function promiseAllEntries(source: string): Array<string> {
  const callIndex: number = source.indexOf("Promise.all");

  expect(callIndex).toBeGreaterThanOrEqual(0);

  const arrayBlock: string = balancedBlock(
    source,
    source.indexOf("[", callIndex),
    "[",
    "]",
  );

  const inner: string = arrayBlock.slice(1, -1);
  const entries: Array<string> = [];

  let depth: number = 0;
  let entryStart: number = 0;

  for (let i: number = 0; i < inner.length; i++) {
    const character: string = inner.charAt(i);

    /*
     * Angle brackets are deliberately not tracked: `=>` and comparison
     * operators would unbalance them, and generic arguments like
     * `count<Monitor>` never carry a top-level comma.
     */
    if (character === "(" || character === "[" || character === "{") {
      depth++;
    } else if (character === ")" || character === "]" || character === "}") {
      depth--;
    } else if (character === "," && depth === 0) {
      entries.push(inner.slice(entryStart, i));
      entryStart = i + 1;
    }
  }

  entries.push(inner.slice(entryStart));

  return entries.filter((entry: string): boolean => {
    return entry.trim().length > 0;
  });
}

// The query object of one request, whitespace collapsed.
function queryOf(entry: string): string {
  const queryIndex: number = entry.indexOf("query:");

  expect(queryIndex).toBeGreaterThanOrEqual(0);

  return balancedBlock(entry, entry.indexOf("{", queryIndex), "{", "}")
    .replace(/\s+/g, " ")
    .replace(/,\s*}/g, " }");
}

const HOME_SOURCE: string = readDashboardCode("Pages", "Home", "Home.tsx");

const OVERVIEW_DATA_SOURCE: string = readDashboardCode(
  "Components",
  "Home",
  "HomeOverviewData.ts",
);

const OVERVIEW_HOOK_SOURCE: string = readDashboardCode(
  "Components",
  "Home",
  "UseHomeOverview.ts",
);

const GETTING_STARTED_SOURCE: string = readDashboardCode(
  "Components",
  "Home",
  "GettingStarted.tsx",
);

const RESOURCES_SOURCE: string = readDashboardCode(
  "Components",
  "Home",
  "ProjectResources.tsx",
);

const UPCOMING_SOURCE: string = readDashboardCode(
  "Components",
  "Home",
  "UpcomingMaintenance.tsx",
);

const STRIP_SOURCE: string = readDashboardCode(
  "Components",
  "Home",
  "OverviewStats.tsx",
);

const ACTIVE_INCIDENTS_SOURCE: string = readDashboardCode(
  "Pages",
  "Home",
  "ActiveIncidents.tsx",
);

const BATCH_BODY: string = arrowFunctionBody(
  OVERVIEW_DATA_SOURCE,
  "export const fetchHomeOverview",
);

describe("Home's one batch", () => {
  test("fetchHomeOverview awaits exactly one thing: the Promise.all of every read", () => {
    const awaits: Array<string> = BATCH_BODY.match(/\bawait\b/g) || [];

    expect(awaits.length).toBe(1);
    expect(BATCH_BODY).toMatch(/await\s+Promise\.all/);
    expect(promiseAllEntries(BATCH_BODY)).toHaveLength(7);
  });

  test("the batch's results are destructured in the order the reads are issued", () => {
    /*
     * Promise.all answers positionally. A destructuring list out of step
     * with the batch would hand the monitor total to the SLO cell (or a
     * list to a total) - two of the slots are plain numbers.
     */
    const destructuring: RegExpMatchArray | null = BATCH_BODY.match(
      /const\s*\[([^\]]*)\]\s*:/,
    );

    expect(destructuring).not.toBeNull();

    const names: Array<string> = destructuring![1]!
      .split(",")
      .map((name: string): string => {
        return name.trim();
      })
      .filter((name: string): boolean => {
        return name.length > 0;
      });

    expect(names).toEqual([
      "activeIncidents",
      "activeAlerts",
      "notOperationalMonitors",
      "ongoingMaintenance",
      "slosNeedingAttention",
      "totalMonitors",
      "totalSlos",
    ]);

    const entries: Array<string> = promiseAllEntries(BATCH_BODY);

    expect(entries[0]).toContain("fetchActiveIncidents(");
    expect(entries[1]).toContain("fetchActiveAlerts(");
    expect(entries[2]).toContain("fetchNotOperationalMonitors(");
    expect(entries[3]).toContain("fetchOngoingMaintenance(");
    expect(entries[4]).toContain("fetchSlosNeedingAttention(");
    expect(entries[5]).toContain("ModelAPI.count<Monitor>");
    expect(entries[6]).toContain("ModelAPI.count<ServiceLevelObjective>");
  });

  test("the two set-up totals count everything not archived, in the same batch", () => {
    const entries: Array<string> = promiseAllEntries(BATCH_BODY);

    /*
     * Every monitor that is not archived, whatever its status or whether it
     * is enabled: zero means the project has none in its Monitors list.
     */
    expect(queryOf(entries[5]!)).toBe(
      "{ projectId: projectId, isArchived: false }",
    );

    // Archived SLOs are gone from the SLOs list; disabled ones are set up.
    expect(queryOf(entries[6]!)).toBe(
      "{ projectId: projectId, isArchived: false }",
    );
  });

  test("the batch never waits on a state list itself", () => {
    /*
     * The shared state utils are still the source of the lists (a caching
     * layer lives inside them), but the batch must never await them: the
     * moment it does, the monitor and SLO reads are back behind them.
     */
    expect(BATCH_BODY).not.toContain("getUnresolvedIncidentStates");
    expect(BATCH_BODY).not.toContain("getUnresolvedAlertStates");
    expect(BATCH_BODY).not.toContain("getInProgressScheduledMaintenanceStates");
  });

  test("each state-scoped read fetches its own states, and asks nothing when there are none", () => {
    const chains: Array<[string, string]> = [
      ["export const fetchActiveIncidents", "getUnresolvedIncidentStates"],
      ["export const fetchActiveAlerts", "getUnresolvedAlertStates"],
      [
        "export const fetchOngoingMaintenance",
        "getInProgressScheduledMaintenanceStates",
      ],
    ];

    for (const [marker, stateRead] of chains) {
      const body: string = arrowFunctionBody(OVERVIEW_DATA_SOURCE, marker);

      expect({ marker, reads: body.includes(stateRead) }).toEqual({
        marker,
        reads: true,
      });
      // No open (or in-progress) state: an empty list, and no request.
      expect(body).toMatch(/\.length === 0\)\s*\{\s*return emptyList/);
      expect(body.indexOf(stateRead)).toBeLessThan(
        body.indexOf("ModelAPI.getList"),
      );
    }
  });

  test("every list in the batch reads the first few rows: its total is the number", () => {
    const firstFewRows: RegExp = /limit: HOME_ATTENTION_LIST_LIMIT/;

    for (const marker of [
      "export const fetchActiveIncidents",
      "export const fetchActiveAlerts",
      "export const fetchNotOperationalMonitors",
      "export const fetchOngoingMaintenance",
      "export const fetchSlosNeedingAttention",
    ]) {
      const body: string = arrowFunctionBody(OVERVIEW_DATA_SOURCE, marker);

      expect({ marker, limit: firstFewRows.test(body) }).toEqual({
        marker,
        limit: true,
      });
      expect(body).toContain("toHomeList");
      // Not a separate count beside the list: the list answers with both.
      expect(body).not.toContain("ModelAPI.count");
    }
  });

  test("the strip makes no request of its own", () => {
    expect(STRIP_SOURCE).not.toContain("ModelAPI");
    expect(STRIP_SOURCE).not.toContain("useEffect");
  });
});

describe("Home and its cards", () => {
  test("Home hands the cards a project id memoized on its string value", () => {
    /*
     * ProjectUtil.getCurrentProjectId() constructs a fresh ObjectID on every
     * call, so passing its raw result down would change the prop's identity
     * on every Home re-render (the clock ticks once a minute) and re-fire
     * their fetch effects. The id handed down must be memoized, and the
     * memo keyed on the id's STRING value.
     */
    const memoIndex: number = HOME_SOURCE.indexOf("useMemo(");

    expect(memoIndex).toBeGreaterThanOrEqual(0);

    const memoCall: string = balancedBlock(
      HOME_SOURCE,
      HOME_SOURCE.indexOf("(", memoIndex),
      "(",
      ")",
    );

    expect(memoCall).toContain("ObjectID");

    const depsMatch: RegExpMatchArray | null = memoCall.match(
      /\[\s*([A-Za-z0-9_$]+)\s*\]\s*\)$/,
    );

    expect(depsMatch).not.toBeNull();

    const depName: string = depsMatch![1] as string;

    expect(HOME_SOURCE).toMatch(
      new RegExp(
        `${depName}[^;]*=[^;]*getCurrentProjectId\\(\\)\\?\\.toString\\(\\)`,
      ),
    );

    // The batch and the cards get the memoized id, never the raw getter.
    expect(HOME_SOURCE).toMatch(/useHomeOverview\(\s*currentProjectId\s*\)/);
    expect(HOME_SOURCE).not.toMatch(
      /<(?:GettingStarted|ProjectResources|UpcomingMaintenance)[^/>]*getCurrentProjectId/,
    );
    for (const card of [
      "GettingStarted",
      "ProjectResources",
      "UpcomingMaintenance",
    ]) {
      expect(HOME_SOURCE).toMatch(
        new RegExp(`<${card}[^>]*projectId=\\{currentProjectId\\}`),
      );
    }
  });

  test("Home itself gates nothing on a load: every card paints its own loading state", () => {
    /*
     * The old Home parked its widgets behind its own incident-states fetch.
     * Nothing on the page waits for anything but itself now.
     */
    expect(loadingGateBlocks(HOME_SOURCE)).toEqual([]);
    expect(HOME_SOURCE).not.toContain("getUnresolvedIncidentStates");
  });

  test("the batch and every card key their fetch effects on the id's string form", () => {
    /*
     * Belt and braces on the consumer side: a caller that rebuilds the
     * ObjectID every render must not re-fire the requests.
     */
    const hookEffect: string = useEffectContaining(
      OVERVIEW_HOOK_SOURCE,
      "load({ isRefresh: false })",
    );

    expect(hookEffect).toMatch(/\[\s*projectIdString\s*\]\s*\)$/);
    expect(OVERVIEW_HOOK_SOURCE).toMatch(
      /projectIdString[^;]*=[^;]*projectId\.toString\(\)/,
    );

    const keyedOnProjectAndRefresh: RegExp =
      /\[\s*projectIdString\s*,\s*props\.refreshKey\s*\]\s*\)$/;

    for (const [name, source, needle] of [
      ["ProjectResources", RESOURCES_SOURCE, "Promise.all"],
      ["UpcomingMaintenance", UPCOMING_SOURCE, "fetchUpcomingMaintenance("],
    ] as Array<[string, string, string]>) {
      const effect: string = useEffectContaining(source, needle);

      expect({
        name,
        keyedOnString: keyedOnProjectAndRefresh.test(effect),
      }).toEqual({ name, keyedOnString: true });
    }

    const gettingStartedEffect: string = useEffectContaining(
      GETTING_STARTED_SOURCE,
      "fetchTaskCompletion",
    );

    expect(gettingStartedEffect).toMatch(
      /\[\s*props\.projectId\??\.toString\(\)\s*\]\s*\)$/,
    );
  });

  test("a response for a project that was left, or for an older request, is dropped", () => {
    // The hook numbers its loads and writes only the latest one's result.
    expect(OVERVIEW_HOOK_SOURCE).toMatch(
      /requestNumber !== latestRequest\.current/,
    );
    // The cards that read on their own stop listening when they unmount.
    for (const source of [RESOURCES_SOURCE, UPCOMING_SOURCE]) {
      expect(source).toMatch(/isCurrent = false/);
      expect(source).toMatch(/if \(!?isCurrent\)/);
    }
  });

  test("a tab nobody reads makes no requests: the hook refreshes on return, it does not poll", () => {
    expect(OVERVIEW_HOOK_SOURCE).toContain("visibilitychange");
    expect(OVERVIEW_HOOK_SOURCE).not.toMatch(/setInterval\(/);
    expect(HOME_SOURCE).not.toMatch(/setInterval\(/);
  });
});

describe("Getting Started", () => {
  test("its effect short-circuits on dismissal before any count request", () => {
    const effect: string = useEffectContaining(
      GETTING_STARTED_SOURCE,
      "fetchTaskCompletion",
    );

    /*
     * The counts only exist to decide whether the checklist should render.
     * A dismissed checklist never renders, so the dismissal read must come
     * first and a bare `return` must sit between it and the fetch.
     */
    const dismissalIndex: number = effect.indexOf("getDismissKey");
    const fetchIndex: number = effect.indexOf("fetchTaskCompletion");

    expect(dismissalIndex).toBeGreaterThanOrEqual(0);
    expect(fetchIndex).toBeGreaterThan(dismissalIndex);

    const betweenDismissalAndFetch: string = effect.slice(
      dismissalIndex,
      fetchIndex,
    );

    expect(betweenDismissalAndFetch).toMatch(/\breturn\b/);
    expect(effect).not.toContain("ModelAPI");
  });

  test("a fully completed checklist is remembered so its counts are never re-fetched", () => {
    const effect: string = useEffectContaining(
      GETTING_STARTED_SOURCE,
      "fetchTaskCompletion",
    );

    expect(effect).toContain("getCompleteKey");

    expect(GETTING_STARTED_SOURCE).toMatch(
      /LocalStorage\.setItem\(\s*getCompleteKey/,
    );
  });
});

describe("Home's Active Incidents page", () => {
  test("only the incidents table waits for the unresolved states, and it still waits", () => {
    /*
     * The states are not dead weight - the table's query is scoped by
     * them. The table moved here from Home; it must still be gated.
     */
    const tableGates: Array<string> = loadingGateBlocks(
      ACTIVE_INCIDENTS_SOURCE,
    ).filter((gate: string): boolean => {
      return gate.includes("<IncidentsTable");
    });

    expect(tableGates.length).toBe(1);
    expect(tableGates[0]).toContain("unresolvedIncidentStates");
  });

  test("the page still surfaces its loading and error states", () => {
    const gates: Array<string> = loadingGateBlocks(ACTIVE_INCIDENTS_SOURCE);

    expect(
      gates.some((gate: string): boolean => {
        return gate.includes("isLoading") && gate.includes("<PageLoader");
      }),
    ).toBe(true);

    expect(
      gates.some((gate: string): boolean => {
        return gate.includes("error") && gate.includes("<ErrorMessage");
      }),
    ).toBe(true);
  });
});
