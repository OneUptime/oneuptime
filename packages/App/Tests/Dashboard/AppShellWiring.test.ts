import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Source-pinning tests for the Dashboard app shell (App.tsx). The App suite
 * runs in a plain Node environment, so the shell cannot be rendered here;
 * instead these pin the INTENT of four perf/UX fixes with tolerant patterns
 * (never exact byte strings), in the style of NetworkTopologyPanelLayering:
 *
 * 1. Every route group lazy()-imports its OWN module under ./Routes/, not the
 *    AllRoutes barrel — the barrel made the first navigation into ANY section
 *    download every page of the app in one multi-megabyte chunk.
 * 2. MasterPage's isLoading no longer includes the payment-methods count —
 *    that gate unmounted the whole app (header, navbar, page) for one count
 *    query and doubled every mount-time request on remount.
 * 3. The command palette is mounted with the always-on chrome, right beside
 *    the AI chat panel and ahead of the routed page tree.
 * 4. onProjectSelected routes its navigate/forceNavigate choice through the
 *    pure ProjectNavigation helper, so a fresh login no longer triggers a
 *    full document reload.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

/*
 * Comments are stripped before matching: App.tsx's own comments narrate the
 * old AllRoutes-barrel behaviour, and an assertion about the code must read
 * the code rather than the prose describing what it replaced.
 */
function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

const APP_SOURCE: string = stripComments(
  fs.readFileSync(path.join(DASHBOARD_SRC, "App.tsx"), "utf8"),
);

function dynamicImportSpecifiers(source: string): Array<string> {
  const specifiers: Array<string> = [];
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    "App.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  // Import types describe lazy page props but never download a module.
  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return specifiers;
}

describe("route splitting: each route group owns its chunk", () => {
  const specifiers: Array<string> = dynamicImportSpecifiers(APP_SOURCE);

  test("counts runtime imports without counting a page's imported props type", () => {
    expect(
      dynamicImportSpecifiers(`
        type Page = typeof import("./Pages/Example").default;
        const Page = lazy(() => import("./Pages/Example"));
      `),
    ).toEqual(["./Pages/Example"]);
  });

  test("App.tsx still declares a healthy number of lazy route groups", () => {
    // Guards the assertions below against the patterns silently matching nothing.
    expect(specifiers.length).toBeGreaterThanOrEqual(30);
  });

  test("no lazy() reaches for the AllRoutes barrel any more", () => {
    for (const specifier of specifiers) {
      expect(specifier).not.toMatch(/\/AllRoutes$/);
    }
  });

  test("every lazily-imported module is a route group or standalone page", () => {
    for (const specifier of specifiers) {
      expect(specifier).toMatch(/^\.\/(Routes|Pages)\//);
    }
  });

  test("each lazy() call imports its own distinct module", () => {
    /*
     * The regression this exists to stop: 41 lazy() calls all funnelling into
     * ONE shared import. Distinct-specifier count must equal lazy-call count.
     */
    const lazyCallCount: number = (APP_SOURCE.match(/\blazy\(/g) || []).length;
    const distinctSpecifiers: Set<string> = new Set(specifiers);

    expect(lazyCallCount).toBeGreaterThanOrEqual(30);
    expect(distinctSpecifiers.size).toBe(lazyCallCount);
    expect(specifiers.length).toBe(lazyCallCount);
  });

  test("every imported specifier resolves to a real module file", () => {
    /*
     * Two module files are named differently from their components
     * (AlertRoutes.tsx, ScheduleMaintenanceEventsRoutes.tsx) — resolving each
     * specifier against the filesystem catches a typo in any of the 41
     * mappings without hardcoding the list here.
     */
    for (const specifier of specifiers) {
      const modulePath: string = path.join(DASHBOARD_SRC, specifier + ".tsx");

      expect([specifier, fs.existsSync(modulePath)]).toEqual([specifier, true]);
    }
  });

  test("the InitRoutes bootstrap module is still lazy-loaded on its own", () => {
    expect(dynamicImportSpecifiers(APP_SOURCE)).toContain(
      "./Routes/InitRoutes",
    );
  });
});

describe("payment gate: the count fetch no longer blanks the app", () => {
  test("MasterPage's isLoading expression makes no mention of payment state", () => {
    const masterPageIsLoading: RegExpMatchArray | null = APP_SOURCE.match(
      /<MasterPage[\s\S]{0,600}?isLoading=\{([^}]+)\}/,
    );

    expect(masterPageIsLoading).not.toBeNull();
    expect(masterPageIsLoading![1]).not.toMatch(/payment/i);
  });

  test("the payment-count loading flag is gone entirely, not just unplugged", () => {
    expect(APP_SOURCE).not.toMatch(/paymentMethodsCountLoading/i);
  });

  test("the count itself is still fetched in the background", () => {
    // Header renders its add-card nag only once the count arrives; the fetch must survive.
    expect(APP_SOURCE).toMatch(/BillingPaymentMethod/);
    expect(APP_SOURCE).toMatch(/ModelAPI\.count/);
    expect(APP_SOURCE).toMatch(/setPaymentMethodsCount\(/);
  });
});

describe("command palette: mounted with the always-on chrome", () => {
  test("App.tsx imports the Dashboard palette wrapper", () => {
    expect(APP_SOURCE).toMatch(
      /import\s+DashboardCommandPalette\s+from\s+["'][^"']*CommandPalette\/DashboardCommandPalette["']/,
    );
  });

  test("the palette renders beside the AI chat panel, ahead of the routed pages", () => {
    const aiChatIndex: number = APP_SOURCE.indexOf("<AIChatPanel");
    const paletteIndex: number = APP_SOURCE.indexOf("<DashboardCommandPalette");
    const routedTreeIndex: number = APP_SOURCE.indexOf("<ErrorBoundary");

    expect(aiChatIndex).toBeGreaterThan(-1);
    expect(paletteIndex).toBeGreaterThan(aiChatIndex);
    expect(routedTreeIndex).toBeGreaterThan(paletteIndex);
  });
});

describe("project selection: navigation decisions come from the pure helper", () => {
  test("App.tsx imports the decision helper from Utils/ProjectNavigation", () => {
    expect(APP_SOURCE).toMatch(
      /import\s*\{[^}]*getProjectSelectionNavigationDecision[^}]*\}\s*from\s*["']\.\/Utils\/ProjectNavigation["']/,
    );
  });

  test("the helper is invoked with the in-memory previous project id", () => {
    const callPattern: RegExp =
      /getProjectSelectionNavigationDecision\(\s*\{[\s\S]{0,400}?previousProjectId/;

    expect(APP_SOURCE).toMatch(callPattern);
  });

  test("forceNavigate is computed, never the old hardcoded true", () => {
    /*
     * The bug: `forceNavigate: true` on every selection turned each fresh
     * login into a full document reload. The option must now be fed from the
     * helper's decision.
     */
    expect(APP_SOURCE).not.toMatch(/forceNavigate:\s*true\b/);
    expect(APP_SOURCE).toMatch(/forceNavigate:\s*[\w.]*\.forceNavigate/);
  });

  test("navigation is gated on the helper's shouldNavigate verdict", () => {
    expect(APP_SOURCE).toMatch(/\.shouldNavigate/);
  });
});
