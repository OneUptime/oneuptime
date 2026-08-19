import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Home page used to be a request waterfall: nothing rendered until the
 * unresolved-incident-states list arrived, then GettingStarted fired four
 * count requests (even when the checklist had been dismissed forever ago),
 * and OverviewStats ran a two-stage fetch in which three counts that need no
 * state list still waited behind two state lists.
 *
 * The fix is structural, not behavioral — the page renders exactly the same
 * pixels, just without serializing independent requests — so there is nothing
 * for a renderer to assert even if one were available (the App suite runs in
 * a plain Node environment, see App/jest.config.json). These tests therefore
 * pin the INTENT against the sources, the same way
 * NetworkTopologyPanelLayering pins the SideOver z-index ladder: tolerant
 * patterns and structural extraction, never exact byte strings.
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
 * Every JSX expression container that gates its children on the page's
 * isLoading/error state — `{isLoading && ...}`, `{!isLoading && ... && (...)}`
 * and friends. Whatever ends up inside one of these mounts only after the
 * incident-states fetch settles.
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

  const braceIndex: number = source.indexOf("{", arrowIndex);

  expect(braceIndex).toBeGreaterThan(arrowIndex);

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

const HOME_SOURCE: string = readDashboardCode("Pages", "Home", "Home.tsx");

const GETTING_STARTED_SOURCE: string = readDashboardCode(
  "Components",
  "Home",
  "GettingStarted.tsx",
);

const OVERVIEW_STATS_SOURCE: string = readDashboardCode(
  "Components",
  "Home",
  "OverviewStats.tsx",
);

describe("Home page request waterfall", () => {
  test("GettingStarted and OverviewStats mount outside the incident-states loading gate", () => {
    /*
     * Both widgets depend only on the project id and paint their own loading
     * states, so parking them behind Home's incident-states fetch would
     * serialize the page's requests for nothing. They must render, and they
     * must render outside every isLoading/error-gated JSX block.
     */
    expect(HOME_SOURCE).toContain("<GettingStarted");
    expect(HOME_SOURCE).toContain("<OverviewStats");

    const gates: Array<string> = loadingGateBlocks(HOME_SOURCE);

    /*
     * Sanity: the loader, the error message and the table gate must still be
     * there — an empty gate list would mean this test is matching nothing.
     */
    expect(gates.length).toBeGreaterThanOrEqual(3);

    for (const gate of gates) {
      expect(gate).not.toContain("<GettingStarted");
      expect(gate).not.toContain("<OverviewStats");
    }
  });

  test("only the incidents table waits for the unresolved states, and it still waits", () => {
    /*
     * The states are not dead weight — the table's query is scoped by them.
     * The fix must not have un-gated the one consumer that genuinely needs
     * the fetch.
     */
    const tableGates: Array<string> = loadingGateBlocks(HOME_SOURCE).filter(
      (gate: string): boolean => {
        return gate.includes("<IncidentsTable");
      },
    );

    expect(tableGates.length).toBe(1);
    expect(tableGates[0]).toContain("unresolvedIncidentStates");
  });

  test("the page still surfaces its loading and error states", () => {
    const gates: Array<string> = loadingGateBlocks(HOME_SOURCE);

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

  test("GettingStarted's effect short-circuits on dismissal before any count request", () => {
    const effect: string = useEffectContaining(
      GETTING_STARTED_SOURCE,
      "fetchTaskCompletion",
    );

    /*
     * The counts only exist to decide whether the checklist should render.
     * A dismissed checklist never renders, so the dismissal read must come
     * first and a bare `return` must sit between it and the fetch — that
     * ordering is the whole fix (four requests on every Home visit, forever,
     * for users who dismissed the card on day one).
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

    // The effect must not count anything itself, before OR after the guard.
    expect(effect).not.toContain("ModelAPI");
  });

  test("a fully completed checklist is remembered so its counts are never re-fetched", () => {
    /*
     * Completion cannot be known without counting once — but once every task
     * has been complete, the card never renders again, so that verdict is
     * persisted and the effect honours it up front.
     */
    const effect: string = useEffectContaining(
      GETTING_STARTED_SOURCE,
      "fetchTaskCompletion",
    );

    expect(effect).toContain("getCompleteKey");

    expect(GETTING_STARTED_SOURCE).toMatch(
      /LocalStorage\.setItem\(\s*getCompleteKey/,
    );
  });

  test("OverviewStats issues all five counts in a single parallel stage", () => {
    /*
     * The old shape awaited two state lists, THEN ran five counts — although
     * the monitor, maintenance and SLO counts need no state list at all. The
     * fixed shape has exactly one await in fetchCounts, and it is the one
     * Promise.all joining every tile's count.
     */
    const body: string = arrowFunctionBody(
      OVERVIEW_STATS_SOURCE,
      "fetchCounts",
    );

    const awaits: Array<string> = body.match(/\bawait\b/g) || [];

    expect(awaits.length).toBe(1);
    expect(body).toMatch(/await\s+Promise\.all/);

    const entries: Array<string> = promiseAllEntries(body);

    expect(entries.length).toBe(5);

    // The three state-independent counts sit directly in the parallel batch…
    expect(
      entries.some((entry: string): boolean => {
        return entry.includes("ModelAPI.count<Monitor>");
      }),
    ).toBe(true);
    expect(
      entries.some((entry: string): boolean => {
        return entry.includes("ScheduledMaintenance");
      }),
    ).toBe(true);
    expect(
      entries.some((entry: string): boolean => {
        return entry.includes("ServiceLevelObjective");
      }),
    ).toBe(true);

    // …next to the two state-dependent chains, not behind them.
    expect(
      entries.some((entry: string): boolean => {
        return entry.includes("Incident");
      }),
    ).toBe(true);
    expect(
      entries.some((entry: string): boolean => {
        return entry.includes("Alert");
      }),
    ).toBe(true);
  });

  test("Home hands the widgets a project id memoized on its string value", () => {
    /*
     * ProjectUtil.getCurrentProjectId() constructs a fresh ObjectID on every
     * call, so passing its raw result to the widgets would change the prop's
     * identity on every Home re-render and re-fire their fetch effects
     * (~3x the count requests per visit). The id handed down must therefore
     * be memoized, and the memo must be keyed on the id's STRING value —
     * the only stable form — not on another ObjectID instance.
     */
    // "useMemo(" — the call, not the identifier in the react import list.
    const memoIndex: number = HOME_SOURCE.indexOf("useMemo(");

    expect(memoIndex).toBeGreaterThanOrEqual(0);

    const memoCall: string = balancedBlock(
      HOME_SOURCE,
      HOME_SOURCE.indexOf("(", memoIndex),
      "(",
      ")",
    );

    // The memo is the (sole) place the widgets' ObjectID gets built...
    expect(memoCall).toContain("ObjectID");

    // ...and its dependency is a plain identifier, not an expression.
    const depsMatch: RegExpMatchArray | null = memoCall.match(
      /\[\s*([A-Za-z0-9_$]+)\s*\]\s*\)$/,
    );

    expect(depsMatch).not.toBeNull();

    /*
     * That identifier must be derived from the current project id's string
     * form — anything else (the raw getter result, a fresh ObjectID) would
     * defeat the memo.
     */
    const depName: string = depsMatch![1] as string;

    expect(HOME_SOURCE).toMatch(
      new RegExp(
        `${depName}[^;]*=[^;]*getCurrentProjectId\\(\\)\\?\\.toString\\(\\)`,
      ),
    );

    // The widgets receive the memoized id, never the raw getter result.
    expect(HOME_SOURCE).not.toMatch(
      /<(?:GettingStarted|OverviewStats)[^/>]*getCurrentProjectId/,
    );
  });

  test("both widgets key their fetch effects on the string form of the project id", () => {
    /*
     * Belt and braces on the consumer side: even a future caller that
     * rebuilds the ObjectID every render must not re-fire the widgets'
     * count requests, so the effects depend on the id's string value —
     * an instance dep (`[props.projectId]`) would refetch on identity
     * churn alone.
     */
    const gettingStartedEffect: string = useEffectContaining(
      GETTING_STARTED_SOURCE,
      "fetchTaskCompletion",
    );

    const overviewStatsEffect: string = useEffectContaining(
      OVERVIEW_STATS_SOURCE,
      "fetchCounts",
    );

    for (const effect of [gettingStartedEffect, overviewStatsEffect]) {
      expect(effect).toMatch(
        /\[\s*props\.projectId\??\.toString\(\)\s*\]\s*\)$/,
      );
    }
  });

  test("the state lists load inside the incident/alert chains, not ahead of everything", () => {
    /*
     * The shared state utils must still be the source of the lists (a caching
     * layer lives inside them), but fetchCounts itself must never await them —
     * the moment it does, the independent counts are back behind the lists.
     */
    expect(OVERVIEW_STATS_SOURCE).toContain("getUnresolvedIncidentStates");
    expect(OVERVIEW_STATS_SOURCE).toContain("getUnresolvedAlertStates");

    const body: string = arrowFunctionBody(
      OVERVIEW_STATS_SOURCE,
      "fetchCounts",
    );

    expect(body).not.toContain("getUnresolvedIncidentStates");
    expect(body).not.toContain("getUnresolvedAlertStates");

    /*
     * And the empty-list shortcut survives: no unresolved states means a
     * count of zero without a request, for incidents and for alerts.
     */
    const shortcuts: Array<string> =
      OVERVIEW_STATS_SOURCE.match(/length\s*(?:===\s*0|>\s*0)/g) || [];

    expect(shortcuts.length).toBeGreaterThanOrEqual(2);
  });
});
