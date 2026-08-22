import { describe, expect, test } from "@jest/globals";
import path from "path";
import ts from "typescript";
import { isRouteReservedAgainstSpaFallback } from "../../FeatureSet/Frontend/RouteReservations";
import {
  APP_DIR,
  arrayEntries,
  firstPathSegment,
  joinMountAndRoute,
  parseSourceText,
  readSource,
  scanAppGetPaths,
  scanAppUseMounts,
  scanRouterGetPaths,
  stripComments,
} from "./RouteReservationSource";

/*
 * Unit cover for the source-reading helpers.
 *
 * These are the foundation the reservation guards stand on, and a bug in them
 * does not announce itself: a parser that fails to see a mount reports no
 * mount, which reads exactly like "there is nothing to reserve". Both known
 * bugs in the previous version of this file had that shape, so the cases
 * below are weighted towards proving that unreadable input is REPORTED rather
 * than silently dropped.
 */

function fixture(text: string): ts.SourceFile {
  return parseSourceText("fixture.ts", text);
}

describe("stripComments", () => {
  test("removes line and block comments", () => {
    const code: string = stripComments(
      ["// gone", "const a = 1; // gone", "/* gone */ const b = 2;"].join("\n"),
    );

    expect(code).not.toContain("gone");
    expect(code).toContain("const a = 1;");
    expect(code).toContain("const b = 2;");
  });

  test('a "/*" inside a template literal is not a comment opener', () => {
    /*
     * The exact shape in FeatureSet/Frontend/Index.ts:
     *   [frontendConfig.routePrefix, `${frontendConfig.routePrefix}/*`],
     * A regex stripper reads that "/*" as the start of a comment and deletes
     * everything up to the next "*" + "/", which in the real file was ~1,400
     * characters including a whole function declaration.
     */
    const source: string = [
      "const a = [prefix, `${prefix}/*`];",
      "const KEEP_ME = 1;",
      "/* a real comment */",
      "const ALSO_KEEP = 2;",
    ].join("\n");

    const code: string = stripComments(source);

    expect(code).toContain("KEEP_ME");
    expect(code).toContain("ALSO_KEEP");
    expect(code).toContain("`${prefix}/*`");
    expect(code).not.toContain("a real comment");
  });

  test("comment openers inside plain strings survive", () => {
    const source: string = [
      'const url = "https://example.com/a";',
      'const glob = "/assets/*";',
      'const block = "/* not a comment */";',
      "const KEEP_ME = 1;",
    ].join("\n");

    const code: string = stripComments(source);

    expect(code).toContain("https://example.com/a");
    expect(code).toContain('"/assets/*"');
    expect(code).toContain('"/* not a comment */"');
    expect(code).toContain("KEEP_ME");
  });

  test("a regex literal containing quotes or slashes does not desync the scanner", () => {
    /*
     * A character scanner with no notion of regex literals treats the quote
     * in /["']/ as opening a string and swallows the rest of the file. Going
     * through the parser removes the question.
     */
    const source: string = [
      "const parts = path.split(/['\"]/);",
      "const proto = /https?:\\/\\//g;",
      "const star = /a\\/*b/;",
      "const KEEP_ME = 1;",
      "// gone",
    ].join("\n");

    const code: string = stripComments(source);

    expect(code).toContain("KEEP_ME");
    expect(code).toContain("split(/['\"]/)");
    expect(code).toContain("https?:");
    expect(code).not.toContain("gone");
  });

  test("division is not mistaken for a regex", () => {
    const code: string = stripComments("const half = total / 2; // gone");

    expect(code).toContain("total / 2");
    expect(code).not.toContain("gone");
  });

  test("escaped quotes inside strings are handled", () => {
    const source: string = [
      'const a = "he said \\"hi\\"";',
      'const b = "trailing backslash \\\\";',
      "const KEEP_ME = 1;",
    ].join("\n");

    expect(stripComments(source)).toContain("KEEP_ME");
  });

  test("apostrophes inside comments do not swallow code", () => {
    const source: string = [
      "// don't do this",
      "const KEEP_ME = 1;",
      "/* it's fine */",
      "const ALSO = 2;",
    ].join("\n");

    const code: string = stripComments(source);

    expect(code).toContain("KEEP_ME");
    expect(code).toContain("ALSO");
  });

  test("line numbers are preserved so a block comment cannot shift them", () => {
    const source: string = [
      "const a = 1;",
      "/* one",
      "two",
      "*/",
      "const b = 2;",
    ].join("\n");

    expect(stripComments(source).split("\n")).toHaveLength(
      source.split("\n").length,
    );
  });

  test("tokens either side of a removed comment are not joined", () => {
    /*
     * Deleting the comment outright would turn "a/* x *\/b" into "ab", a
     * different program. Blanking it to spaces keeps them separate and keeps
     * every byte offset identical to the original.
     */
    const source: string = "const ab = a/* x */b;";
    const code: string = stripComments(source);

    expect(code).not.toContain("ab = ab");
    expect(code).toHaveLength(source.length);
    expect(code).toMatch(/a {7}b;/);
  });

  test("output is idempotent and never longer than the input", () => {
    const source: string = readSource(
      APP_DIR,
      "FeatureSet",
      "Frontend",
      "Index.ts",
    );
    const once: string = stripComments(source);

    expect(stripComments(once)).toBe(once);
    expect(once.length).toBeLessThanOrEqual(source.length);
  });

  test("every real file this suite reads survives stripping intact", () => {
    /*
     * The end-to-end guard on the helper. A stripper that eats code shows up
     * here as a declaration going missing, which is precisely how the
     * previous bug stayed hidden.
     */
    const checks: Array<[Array<string>, Array<string>]> = [
      [
        ["FeatureSet", "Frontend", "Index.ts"],
        [
          "const registerCustomDomainFallback",
          "const registerDashboardFallbackForPrimaryHost",
          "const getPrimaryHosts",
        ],
      ],
      [
        ["FeatureSet", "Frontend", "RouteReservations.ts"],
        [
          "export const IngestRoutePrefixesToSkip",
          "export const DashboardFallbackRoutePrefixesToSkip",
          "export const StatusPageDomainFallbackRoutePrefixesToSkip",
        ],
      ],
      [["Index.ts"], ["await FrontendRoutes.init()", "AppMetricsAPI"]],
    ];

    for (const [segments, declarations] of checks) {
      const code: string = stripComments(readSource(APP_DIR, ...segments));

      for (const declaration of declarations) {
        expect({
          file: segments.join("/"),
          declaration,
          present: code.includes(declaration),
        }).toEqual({
          file: segments.join("/"),
          declaration,
          present: true,
        });
      }
    }
  });
});

describe("arrayEntries", () => {
  test("reads a multi-line array", () => {
    expect(
      arrayEntries(
        fixture('const A: Array<string> = [\n  "/a",\n  "/b",\n];'),
        "A",
      ),
    ).toEqual(["/a", "/b"]);
  });

  test("reads a single-line array without running into the next declaration", () => {
    /*
     * A lazy regex anchored on "\n];" runs straight past a single-line array
     * into whatever declaration follows. TELEMETRY_PREFIXES is written this
     * way in the real Telemetry/Index.ts.
     */
    const source: ts.SourceFile = fixture(
      [
        'const A: Array<string> = ["/telemetry", "/"];',
        'const B: Array<string> = ["/other"];',
      ].join("\n"),
    );

    expect(arrayEntries(source, "A")).toEqual(["/telemetry", "/"]);
    expect(arrayEntries(source, "B")).toEqual(["/other"]);
  });

  test("comment prose can never become an entry", () => {
    /*
     * The house style is to precede an entry with a comment quoting OTHER
     * paths. A scrape-every-quoted-string parser turns that prose into
     * entries - and a stray "/" entry would make the predicate reserve every
     * path on earth, hiding any missing reservation.
     */
    const entries: Array<string> = arrayEntries(
      fixture(
        [
          "const A: Array<string> = [",
          '  /* mounted on both "/telemetry" and "/", so beware */',
          '  "/session-replay",',
          '  // another note about "/api"',
          '  "/otlp",',
          "];",
        ].join("\n"),
      ),
      "A",
    );

    expect(entries).toEqual(["/session-replay", "/otlp"]);
    expect(entries).not.toContain("/");
  });

  test("a comment containing brackets does not confuse the parser", () => {
    expect(
      arrayEntries(
        fixture(
          [
            "const A: Array<string> = [",
            "  /* see foo[0] and bar] and [baz */",
            '  "/a",',
            "];",
          ].join("\n"),
        ),
        "A",
      ),
    ).toEqual(["/a"]);
  });

  test("resolves spreads, in either declaration order", () => {
    const forward: ts.SourceFile = fixture(
      [
        'const BASE: Array<string> = ["/x"];',
        'const A: Array<string> = ["/a", ...BASE, "/b"];',
      ].join("\n"),
    );
    const backward: ts.SourceFile = fixture(
      [
        'const A: Array<string> = ["/a", ...BASE, "/b"];',
        'const BASE: Array<string> = ["/x"];',
      ].join("\n"),
    );

    expect(arrayEntries(forward, "A")).toEqual(["/a", "/x", "/b"]);
    expect(arrayEntries(backward, "A")).toEqual(["/a", "/x", "/b"]);
  });

  test("resolves nested spreads", () => {
    expect(
      arrayEntries(
        fixture(
          [
            'const INNER: Array<string> = ["/i"];',
            'const MID: Array<string> = ["/m", ...INNER];',
            'const A: Array<string> = ["/a", ...MID];',
          ].join("\n"),
        ),
        "A",
      ),
    ).toEqual(["/a", "/m", "/i"]);
  });

  test("a diamond spread is not mistaken for a cycle", () => {
    expect(
      arrayEntries(
        fixture(
          [
            'const BASE: Array<string> = ["/x"];',
            'const L: Array<string> = [...BASE, "/l"];',
            'const R: Array<string> = [...BASE, "/r"];',
            "const A: Array<string> = [...L, ...R];",
          ].join("\n"),
        ),
        "A",
      ),
    ).toEqual(["/x", "/l", "/x", "/r"]);
  });

  test("a genuine cycle throws and names the arrays", () => {
    expect(() => {
      return arrayEntries(
        fixture(
          [
            "const A: Array<string> = [...B];",
            "const B: Array<string> = [...A];",
          ].join("\n"),
        ),
        "A",
      );
    }).toThrow(/Circular spread/);
  });

  test("a spread that resolves to nothing throws rather than shrinking the list", () => {
    expect(() => {
      return arrayEntries(
        fixture("const A: Array<string> = [...MISSING];"),
        "A",
      );
    }).toThrow(/resolved to nothing/);
  });

  test("an entry shape it cannot read throws instead of being skipped", () => {
    /*
     * The property that matters most. Silently skipping a computed entry
     * would understate the list, and understating a reservation list is
     * exactly a false pass.
     */
    for (const body of [
      "const A: Array<string> = [SOME_CONST];",
      "const A: Array<string> = [`/tpl/${x}`];",
      'const A: Array<string> = ["/a".concat("b")];',
      'const A: Array<string> = [cond ? "/a" : "/b"];',
    ]) {
      expect(() => {
        return arrayEntries(fixture(body), "A");
      }).toThrow(/Unreadable entry/);
    }
  });

  test("a name that is a prefix of another declaration does not cross-match", () => {
    const source: ts.SourceFile = fixture(
      [
        'const Foo: Array<string> = ["/foo"];',
        'const FooBar: Array<string> = ["/foobar"];',
      ].join("\n"),
    );

    expect(arrayEntries(source, "Foo")).toEqual(["/foo"]);
    expect(arrayEntries(source, "FooBar")).toEqual(["/foobar"]);
  });

  test("trailing commas and blank lines are not entries", () => {
    expect(
      arrayEntries(
        fixture('const A: Array<string> = [\n\n  "/a",\n\n  "/b",\n\n];'),
        "A",
      ),
    ).toEqual(["/a", "/b"]);
  });

  test("an empty array yields no entries, and a missing one yields none either", () => {
    expect(arrayEntries(fixture("const A: Array<string> = [];"), "A")).toEqual(
      [],
    );
    expect(arrayEntries(fixture("const A: Array<string> = [];"), "B")).toEqual(
      [],
    );
  });

  test("a non-array declaration throws rather than reporting an empty list", () => {
    expect(() => {
      return arrayEntries(
        fixture("const A: Array<string> = buildList();"),
        "A",
      );
    }).toThrow(/not an array literal/);
  });
});

describe("scanAppUseMounts", () => {
  /*
   * Parsed under a real path so that relative imports in the fixture resolve
   * to real modules, exactly as they do in the feature sets.
   */
  const FIXTURE_PATH: string = path.join(
    APP_DIR,
    "FeatureSet",
    "Telemetry",
    "Index.fixture.ts",
  );
  const preamble: string = 'import FooAPI from "./API/TelemetryWriter";';

  function scan(body: string): ReturnType<typeof scanAppUseMounts> {
    return scanAppUseMounts(
      parseSourceText(FIXTURE_PATH, `${preamble}\n${body}`),
    );
  }

  test.each([
    ['app.use("/", FooAPI);', ["/"]],
    ['app.use(["/a", "/"], FooAPI);', ["/a", "/"]],
    ['const P: Array<string> = ["/p", "/"];\napp.use(P, FooAPI);', ["/p", "/"]],
    ['const N = "foo";\napp.use(`/${N}`, FooAPI);', ["/foo"]],
    ['app.use("/", new FooAPI().router);', ["/"]],
    ['const f = new FooAPI();\napp.use("/", f.router);', ["/"]],
    ['app.use("/", mw, FooAPI);', ["/"]],
    ['app.use(\n  ["/a", "/"],\n  FooAPI,\n);', ["/a", "/"]],
  ])("reads %s", (body: string, expected: Array<string>) => {
    /*
     * The last case is the one that mattered: Prettier reflows any app.use
     * past 80 columns onto its own lines WITH a trailing comma, and the old
     * regex could not match that - so a newly added root mount was invisible
     * and the guard passed.
     */
    const result: ReturnType<typeof scanAppUseMounts> = scan(body);

    expect(result.unreadable).toEqual([]);
    expect(result.mounts).toHaveLength(1);
    expect(result.mounts[0]?.mountPaths).toEqual(expected);
  });

  test("a mount path it cannot resolve is reported, not dropped", () => {
    const result: ReturnType<typeof scanAppUseMounts> = scan(
      "app.use(Queue.getInspectorRoute(), FooAPI);",
    );

    expect(result.mounts).toEqual([]);
    expect(result.unreadable).toHaveLength(1);
    expect(result.unreadable[0]?.reason).toMatch(/not statically resolvable/);
  });

  test("a router it cannot resolve to a module is reported, not dropped", () => {
    const result: ReturnType<typeof scanAppUseMounts> = scan(
      'app.use("/", locallyBuiltRouter);',
    );

    expect(result.mounts).toEqual([]);
    expect(result.unreadable).toHaveLength(1);
  });

  test("static-file mounts are recognised as serving GET on their prefix", () => {
    const result: ReturnType<typeof scanAppUseMounts> = scan(
      'app.use("/docs/static", ExpressStatic(StaticPath));',
    );

    expect(result.unreadable).toEqual([]);
    expect(result.mounts[0]?.isStaticFileMount).toBe(true);
    expect(result.mounts[0]?.mountPaths).toEqual(["/docs/static"]);
  });

  test("router.use on the app is not confused with a mount of an imported router", () => {
    const result: ReturnType<typeof scanAppUseMounts> = scan(
      "someRouter.use(mw);",
    );

    expect(result.mounts).toEqual([]);
    expect(result.unreadable).toEqual([]);
  });
});

describe("scanRouterGetPaths", () => {
  test("reads plain and template-literal GET paths", () => {
    const result: ReturnType<typeof scanRouterGetPaths> = scanRouterGetPaths(
      fixture(
        [
          'router.get("/a/b", handler);',
          "router.get(`/c/d`, handler);",
          'router.post("/not-a-get", handler);',
        ].join("\n"),
      ),
    );

    expect(result.getPaths).toEqual(["/a/b", "/c/d"]);
    expect(result.unreadable).toEqual([]);
  });

  test("reads this.router.get, which the class-based APIs use", () => {
    const result: ReturnType<typeof scanRouterGetPaths> = scanRouterGetPaths(
      fixture("this.router.get(`/run/:workflowId`, handler);"),
    );

    expect(result.getPaths).toEqual(["/run/:workflowId"]);
  });

  test("router.all counts, because it answers GET too", () => {
    expect(
      scanRouterGetPaths(fixture('router.all("/everything", handler);'))
        .getPaths,
    ).toEqual(["/everything"]);
  });

  test("an array of paths is expanded", () => {
    expect(
      scanRouterGetPaths(fixture('router.get(["/a", "/b"], handler);'))
        .getPaths,
    ).toEqual(["/a", "/b"]);
  });

  test("a path it cannot resolve is reported, not dropped", () => {
    const result: ReturnType<typeof scanRouterGetPaths> = scanRouterGetPaths(
      fixture("router.get(ROUTE_FROM_ELSEWHERE, handler);"),
    );

    expect(result.getPaths).toEqual([]);
    expect(result.unreadable).toHaveLength(1);
  });

  test("a nested router is reported rather than silently ignored", () => {
    /*
     * router.use(sub) would hide the sub-router's whole GET surface. Nothing
     * in App/FeatureSet does this today; reporting it means the day someone
     * starts, the guard says so instead of quietly under-reporting.
     */
    const result: ReturnType<typeof scanRouterGetPaths> = scanRouterGetPaths(
      fixture("router.use(subRouter);"),
    );

    expect(result.unreadable).toHaveLength(1);
    expect(result.unreadable[0]?.reason).toMatch(/nests a router/);
  });

  test("router.route() chains are reported rather than silently ignored", () => {
    const result: ReturnType<typeof scanRouterGetPaths> = scanRouterGetPaths(
      fixture('router.route("/x").get(handler);'),
    );

    expect(result.unreadable.length).toBeGreaterThanOrEqual(1);
  });
});

describe("scanAppGetPaths", () => {
  test("reads direct app.get registrations, as Docs and APIReference use", () => {
    const result: ReturnType<typeof scanAppGetPaths> = scanAppGetPaths(
      fixture(
        ['app.get("/docs", handler);', 'app.get("/docs/zh/*", handler);'].join(
          "\n",
        ),
      ),
    );

    expect(result.getPaths).toEqual(["/docs", "/docs/zh/*"]);
  });

  test("does not pick up router.get", () => {
    expect(
      scanAppGetPaths(fixture('router.get("/x", handler);')).getPaths,
    ).toEqual([]);
  });
});

describe("path helpers", () => {
  test.each([
    ["/metrics/queue-size", "/metrics"],
    ["/metrics", "/metrics"],
    ["//double//slash", "/double"],
    ["/", null],
    ["", null],
  ])("firstPathSegment(%s) is %s", (input: string, expected: string | null) => {
    expect(firstPathSegment(input)).toBe(expected);
  });

  test.each([
    ["/", "/metrics/x", "/metrics/x"],
    ["/telemetry", "/metrics/x", "/telemetry/metrics/x"],
    [
      "/server-monitor-ingest",
      "/server-monitor/q",
      "/server-monitor-ingest/server-monitor/q",
    ],
  ])(
    "joinMountAndRoute(%s, %s) is %s",
    (mount: string, route: string, expected: string) => {
      expect(joinMountAndRoute(mount, route)).toBe(expected);
    },
  );
});

describe("the reservation predicate", () => {
  test("matches an exact path and anything below it", () => {
    expect(isRouteReservedAgainstSpaFallback(["/metrics"], "/metrics")).toBe(
      true,
    );
    expect(
      isRouteReservedAgainstSpaFallback(["/metrics"], "/metrics/queue-size"),
    ).toBe(true);
  });

  test("a string prefix that is not a path prefix does not match", () => {
    /*
     * The bug this change found: the dashboard list had "/server-monitor" and
     * not "/server-monitor-ingest", and the shorter never covered the longer.
     */
    expect(
      isRouteReservedAgainstSpaFallback(
        ["/server-monitor"],
        "/server-monitor-ingest/server-monitor/queue/size",
      ),
    ).toBe(false);
    expect(isRouteReservedAgainstSpaFallback(["/metrics"], "/metricsfoo")).toBe(
      false,
    );
  });

  test("an empty list reserves nothing", () => {
    expect(isRouteReservedAgainstSpaFallback([], "/anything")).toBe(false);
  });

  test('a "/" entry reserves only "/" itself, not every path', () => {
    /*
     * Worth pinning because it is counter-intuitive, and because the comments
     * in the real list quote a bare "/" that a sloppy parser could turn into
     * an entry. The predicate is `path === prefix || startsWith(prefix + "/")`,
     * and for prefix "/" the second test is startsWith("//"), so a stray "/"
     * entry would NOT swallow everything - it would only match "/" exactly.
     */
    expect(isRouteReservedAgainstSpaFallback(["/"], "/")).toBe(true);
    expect(isRouteReservedAgainstSpaFallback(["/"], "/anything/at/all")).toBe(
      false,
    );
  });

  test("it is the same function the server calls", () => {
    const source: string = readSource(
      APP_DIR,
      "FeatureSet",
      "Frontend",
      "RouteReservations.ts",
    );

    for (const predicate of [
      "shouldSkipDashboardFallbackRoute",
      "shouldSkipStatusPageDomainFallbackRoute",
    ]) {
      expect(source).toContain(`export const ${predicate}`);
    }

    // Both delegate, so they cannot drift from each other.
    expect(
      source.match(/isRouteReservedAgainstSpaFallback\(/g)?.length,
    ).toBeGreaterThanOrEqual(2);
  });
});

describe("module resolution", () => {
  test("APP_DIR and REPO_ROOT point where the callers assume", () => {
    expect(path.basename(APP_DIR)).toBe("App");
    expect(
      readSource(APP_DIR, "FeatureSet", "Frontend", "RouteReservations.ts")
        .length,
    ).toBeGreaterThan(0);
  });
});
