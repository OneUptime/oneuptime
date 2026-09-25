import {
  DISAGREEING_PIECES_ADVICE,
  DISCLOSURE_EXAMPLE_FILE,
  ForeignHiddenRuleFinding,
  ForeignHiddenRuleScan,
  GROUP_HOVER_EXAMPLE_FILE,
  MIXED_BREAKPOINT_ADVICE,
  STATE_VARIANT_ADVICE,
  VariantHiddenSite,
  WHY_PARAGRAPH,
  findForeignHiddenRuleHazards,
  formatFindings,
  listScanRoots,
  listSourceFiles,
  scanFiles,
  toRelativePath,
} from "../ForeignHiddenRuleGuard";
import {
  PHONE_WIDTH_IN_PX,
  TAILWIND_BREAKPOINTS_IN_PX,
  VisibilityOptions,
  WIDE_DESKTOP_WIDTH_IN_PX,
  resolveDisplay,
} from "../ResponsiveVisibility";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * A customer's dashboard rendered with no navigation bar - no Home, no
 * Products menu, so no way into any product. Their browser carried a rule the
 * app does not ship, `.hidden{display:none !important}` (Bootstrap 3 and HTML5
 * Boilerplate define exactly that; browser extensions and user stylesheets
 * inject it), and the bar was written `hidden md:flex`. The foreign rule
 * matches the bare class and outranks `md:flex`, so the bar was gone at every
 * width. The fix rewrote every such string to `max-md:hidden md:flex`, which
 * displays identically and never carries the class the rule targets.
 *
 * Nothing about the old idiom shows up in a type check, in jsdom, or on a
 * developer's clean browser: it only breaks on a machine that carries the
 * foreign rule. This guard is what stops it coming back. It reads every
 * browser module (packages/App/FeatureSet/<name>/src, Common/UI and, when the
 * checkout has it, ee/Dashboard and ee/AdminDashboard) through the TypeScript
 * AST and names the file, the line, the string and what to write instead.
 *
 * The detector lives in Common/Tests/ForeignHiddenRuleGuard.ts. This file
 * pins it on inline snippets first - every shape it must catch and every
 * shape it must leave alone - and only then runs it over the real tree, with
 * checks that the scan really read the tree so a broken walk cannot make the
 * main assertion pass over nothing.
 */

// packages/Common/Tests/UI -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const FIXTURE_FILE: string = "Fixture.tsx";

// The Common NavBar's desktop row before and after the fix.
const OLD_NAVBAR_CLASS: string =
  "bg-white flex text-center items-center lg:py-2 hidden md:flex";
const NEW_NAVBAR_CLASS: string =
  "bg-white flex text-center items-center lg:py-2 max-md:hidden md:flex";

// FacetValueRow's exclude button before and after it was converted by hand.
const OLD_FACET_EXCLUDE_CLASS: string =
  "hidden h-5 w-5 items-center justify-center rounded text-[10px] text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 group-hover:flex";
const NEW_FACET_EXCLUDE_CLASS: string =
  "flex h-5 w-5 items-center justify-center rounded text-[10px] text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 group-[:not(:hover)]:hidden";

// ExecutionView's "Hide output" label before and after.
const OLD_DISCLOSURE_CLASS: string = "hidden group-open:inline";
const NEW_DISCLOSURE_CLASS: string =
  "inline [details:not([open])>summary>&]:hidden";

const NAVBAR_FILE: string = "packages/Common/UI/Components/Navbar/NavBar.tsx";
const TELEMETRY_FACET_FILE: string =
  "packages/Common/UI/Components/TelemetryViewer/components/TelemetryFacetValueRow.tsx";
const ENTERPRISE_AUDIT_LOG_FILE: string =
  "ee/Dashboard/AuditLogs/AuditLogChangesModal.tsx";

const FOREIGN_RULE: VisibilityOptions = { withForeignHiddenRule: true };

// Both sides of every breakpoint, plus the phone and the customer's screen.
const WIDTHS_IN_PX: Array<number> = [
  320,
  PHONE_WIDTH_IN_PX,
  ...Object.values(TAILWIND_BREAKPOINTS_IN_PX).flatMap(
    (breakpoint: number): Array<number> => {
      return [breakpoint - 1, breakpoint];
    },
  ),
  WIDE_DESKTOP_WIDTH_IN_PX,
];

function lines(...sourceLines: Array<string>): string {
  return sourceLines.join("\n");
}

function findingsIn(source: string): Array<ForeignHiddenRuleFinding> {
  return findForeignHiddenRuleHazards(FIXTURE_FILE, source);
}

function onlyFinding(source: string): ForeignHiddenRuleFinding {
  const findings: Array<ForeignHiddenRuleFinding> = findingsIn(source);

  expect(findings).toHaveLength(1);

  return findings[0]!;
}

function jsxWithClass(classAttribute: string): string {
  return `const element = <div className="${classAttribute}" />;`;
}

function readRepositoryFile(relative: string): string {
  return fs.readFileSync(
    path.join(REPOSITORY_ROOT, ...relative.split("/")),
    "utf8",
  );
}

function lineContaining(source: string, text: string): number {
  return (
    source.split("\n").findIndex((sourceLine: string): boolean => {
      return sourceLine.includes(text);
    }) + 1
  );
}

describe("ForeignHiddenRuleGuard detector", () => {
  test("flags the class string that took the customer's navigation bar away", () => {
    const finding: ForeignHiddenRuleFinding = onlyFinding(
      lines(
        "const className: string =",
        "  props.className ||",
        `  "${OLD_NAVBAR_CLASS}";`,
      ),
    );

    expect(finding).toEqual({
      file: FIXTURE_FILE,
      line: 3,
      kind: "same-string",
      text: OLD_NAVBAR_CLASS,
      partnerText: null,
      unhidingTokens: ["md:flex"],
      replacement: NEW_NAVBAR_CLASS,
      advice: "replace the bare `hidden` with `max-md:hidden`",
    });

    // The string the fix shipped is the one the guard recommends, and passes.
    expect(readRepositoryFile(NAVBAR_FILE)).toContain(`"${NEW_NAVBAR_CLASS}"`);
    expect(
      findingsIn(`const className: string = "${NEW_NAVBAR_CLASS}";`),
    ).toEqual([]);
  });

  test("reverting the NavBar fix in memory makes the real file fail the guard", () => {
    /*
     * Negative control on the real file: the guard over NavBar.tsx as it was
     * before the fix. Only the class string is reverted - the comment above
     * it, which quotes `hidden md:flex` on purpose, stays and is not read.
     */
    const current: string = readRepositoryFile(NAVBAR_FILE);
    const reverted: string = current.replace(
      `"${NEW_NAVBAR_CLASS}"`,
      `"${OLD_NAVBAR_CLASS}"`,
    );

    expect(reverted).not.toBe(current);
    expect(current).toContain("never `hidden md:flex`");
    expect(findForeignHiddenRuleHazards(NAVBAR_FILE, current)).toEqual([]);

    const findings: Array<ForeignHiddenRuleFinding> =
      findForeignHiddenRuleHazards(NAVBAR_FILE, reverted);

    expect(
      findings.map((finding: ForeignHiddenRuleFinding): string => {
        return `${finding.file}:${finding.line} ${finding.replacement}`;
      }),
    ).toEqual([
      `${NAVBAR_FILE}:${lineContaining(reverted, OLD_NAVBAR_CLASS)} ${NEW_NAVBAR_CLASS}`,
    ]);
  });

  test("a breakpoint un-hider gets the exact max-<bp>:hidden rewrite, display-equivalent at every width", () => {
    /*
     * The rewrite is only worth printing if pasting it is safe. Each pair is
     * resolved with the same cascade model the header suites use: the
     * replacement must display exactly like the original at every width,
     * stay that way with the foreign rule on the page - while the original
     * vanishes at every width under it, which is the bug.
     */
    const cases: Array<[string, string]> = [
      ["hidden md:flex", "max-md:hidden md:flex"],
      ["hidden lg:flex items-center", "max-lg:hidden lg:flex items-center"],
      ["hidden sm:flex sm:flex-wrap", "max-sm:hidden sm:flex sm:flex-wrap"],
      ["mr-3 hidden md:inline-flex", "mr-3 max-md:hidden md:inline-flex"],
      ["hidden w-32 xl:block", "max-xl:hidden w-32 xl:block"],
      [
        "text-gray-400 hidden 2xl:inline",
        "text-gray-400 max-2xl:hidden 2xl:inline",
      ],
      ["hidden sm:grid sm:grid-cols-2", "max-sm:hidden sm:grid sm:grid-cols-2"],
      // Several screens: the narrowest one decides.
      ["hidden lg:flex md:block", "max-md:hidden lg:flex md:block"],
      // A max-width un-hider is mirrored: hide from the widest screen up.
      ["hidden max-md:flex", "md:hidden max-md:flex"],
      ["hidden max-lg:block max-md:flex", "lg:hidden max-lg:block max-md:flex"],
    ];

    for (const [original, replacement] of cases) {
      const finding: ForeignHiddenRuleFinding = onlyFinding(
        jsxWithClass(original),
      );

      expect(finding.text).toBe(original);
      expect(finding.replacement).toBe(replacement);
      expect(findingsIn(jsxWithClass(replacement))).toEqual([]);

      for (const width of WIDTHS_IN_PX) {
        expect(
          `${replacement} @ ${width}px: ${resolveDisplay(replacement, width)}`,
        ).toBe(
          `${replacement} @ ${width}px: ${resolveDisplay(original, width)}`,
        );
        expect(
          `${replacement} @ ${width}px, foreign rule: ${resolveDisplay(replacement, width, FOREIGN_RULE)}`,
        ).toBe(
          `${replacement} @ ${width}px, foreign rule: ${resolveDisplay(original, width)}`,
        );
        expect(resolveDisplay(original, width, FOREIGN_RULE)).toBe("hidden");
      }
    }
  });

  test("the important modifier does not hide a display utility", () => {
    expect(onlyFinding(jsxWithClass("hidden md:!flex")).replacement).toBe(
      "max-md:hidden md:!flex",
    );
  });

  test("state and arbitrary variants are flagged too, and pointed at the inverted pattern", () => {
    /*
     * The foreign rule beats `group-hover:flex` exactly as it beats `md:flex`,
     * so a hover affordance written that way never appears. There is no
     * breakpoint to move the `hidden` behind; the fix is to show the element
     * by default and hide it under the negated state.
     */
    const facet: ForeignHiddenRuleFinding = onlyFinding(
      jsxWithClass(OLD_FACET_EXCLUDE_CLASS),
    );

    expect(facet.unhidingTokens).toEqual(["group-hover:flex"]);
    // The mechanical inversion is exactly what FacetValueRow.tsx now ships.
    expect(facet.replacement).toBe(NEW_FACET_EXCLUDE_CLASS);
    expect(readRepositoryFile(GROUP_HOVER_EXAMPLE_FILE)).toContain(
      `"${NEW_FACET_EXCLUDE_CLASS}"`,
    );

    const stateVariants: Array<string> = [
      OLD_DISCLOSURE_CLASS,
      "hidden peer-checked:flex",
      "hidden [&.active]:flex",
      "hidden data-[state=open]:block",
      "hidden aria-expanded:grid",
      "hidden dark:block",
      "hidden print:block",
      "hidden lg:group-hover:flex",
      "hidden group-hover/nav-row:flex",
      "hidden group-[.is-open]:inline-flex",
      "hidden min-[900px]:flex",
      // A second unprefixed display would compete with the one moved forward.
      "flex hidden group-hover:block",
    ];

    for (const classAttribute of stateVariants) {
      const finding: ForeignHiddenRuleFinding = onlyFinding(
        jsxWithClass(classAttribute),
      );

      expect(`${classAttribute}: ${finding.replacement}`).toBe(
        `${classAttribute}: null`,
      );
      expect(finding.advice).toBe(STATE_VARIANT_ADVICE);
    }

    expect(STATE_VARIANT_ADVICE).toContain(DISCLOSURE_EXAMPLE_FILE);
    expect(STATE_VARIANT_ADVICE).toContain(NEW_DISCLOSURE_CLASS);
    expect(STATE_VARIANT_ADVICE).toContain("group-[:not(:hover)]:hidden");
  });

  test("min-width and max-width un-hiders together get advice, not a wrong rewrite", () => {
    const finding: ForeignHiddenRuleFinding = onlyFinding(
      jsxWithClass("hidden max-sm:block lg:flex"),
    );

    expect(finding.replacement).toBe(null);
    expect(finding.advice).toBe(MIXED_BREAKPOINT_ADVICE);
  });

  test("template literals: the static text is one string, and each substitution is read", () => {
    const withTrailingSubstitution: ForeignHiddenRuleFinding = onlyFinding(
      "const element = <div className={`hidden md:flex ${props.className}`} />;",
    );

    expect(withTrailingSubstitution.text).toBe(
      "hidden md:flex ${props.className}",
    );
    expect(withTrailingSubstitution.replacement).toBe(
      "max-md:hidden md:flex ${props.className}",
    );

    expect(
      onlyFinding(
        "const element = <div className={`${base} hidden md:flex`} />;",
      ).replacement,
    ).toBe("${base} max-md:hidden md:flex");

    // The `hidden` and the un-hider on either side of a substitution still meet.
    expect(
      onlyFinding(
        "const element = <div className={`hidden ${gap} md:flex`} />;",
      ).replacement,
    ).toBe("max-md:hidden ${gap} md:flex");

    // A string inside a substitution is a string of its own (Card.tsx's shape).
    const nested: ForeignHiddenRuleFinding = onlyFinding(
      'const element = <div className={`flex mb-5${props.hideOnMobile ? " hidden md:flex" : ""}`} />;',
    );

    expect(nested.kind).toBe("same-string");
    expect(nested.text).toBe(" hidden md:flex");
    expect(nested.replacement).toBe(" max-md:hidden md:flex");
  });

  test("multi-line strings are read whole, and reported at the line they start on", () => {
    const template: ForeignHiddenRuleFinding = onlyFinding(
      lines(
        "const element = (",
        "  <div",
        "    className={`",
        "      hidden",
        "      items-center",
        "      md:flex",
        "    `}",
        "  />",
        ");",
      ),
    );

    expect(template.line).toBe(3);
    expect(template.text).toBe("hidden items-center md:flex");
    expect(template.replacement).toBe("max-md:hidden items-center md:flex");

    // A string literal continued with a backslash.
    const continued: ForeignHiddenRuleFinding = onlyFinding(
      lines('const menuClassName: string = "hidden \\', 'lg:flex";'),
    );

    expect(continued.line).toBe(1);
    expect(continued.replacement).toBe("max-lg:hidden lg:flex");
  });

  test("a hidden and its un-hider in different pieces of one class expression are flagged together", () => {
    const ternaryInTemplate: ForeignHiddenRuleFinding = onlyFinding(
      'const element = <div className={`${isOpen ? "flex" : "hidden"} md:flex`} />;',
    );

    expect(ternaryInTemplate).toEqual({
      file: FIXTURE_FILE,
      line: 1,
      kind: "cross-piece",
      text: "hidden",
      partnerText: '${isOpen ? "flex" : "hidden"} md:flex',
      unhidingTokens: ["md:flex"],
      replacement: "max-md:hidden",
      advice: "replace the bare `hidden` with `max-md:hidden`",
    });

    // One finding per bare `hidden`, each at its own line.
    expect(
      findingsIn(
        lines(
          "const element = (",
          "  <aside",
          "    className={`${",
          '      isPaneOpenOnMobile ? "hidden" : "block"',
          "    } rounded-b-xl bg-gray-50 px-5 py-5 lg:block md:px-6`}",
          "  />",
          ");",
          "const panel = (",
          "  <section",
          "    className={`${",
          '      isPaneOpenOnMobile ? "block" : "hidden"',
          "    } px-5 py-5 lg:block lg:min-w-0 md:px-6`}",
          "  />",
          ");",
        ),
      ).map((finding: ForeignHiddenRuleFinding): string => {
        return `${finding.line} ${finding.kind} ${finding.replacement}`;
      }),
    ).toEqual(["4 cross-piece max-lg:hidden", "11 cross-piece max-lg:hidden"]);

    const crossPieceSources: Array<string> = [
      'const element = <div className={clsx("hidden", "md:flex")} />;',
      'const element = <div className={cn("hidden", isWide && "lg:flex")} />;',
      'const merged: string = twMerge("hidden", "sm:block");',
      'const names: string = classNames("hidden", { "md:flex": isWide });',
      'const names: string = cx({ hidden: !isOpen }, "lg:block");',
      'const navClassName: string = "hidden " + "md:flex";',
      'const props = { menuClassName: ["hidden", "md:flex"].join(" ") };',
      'element.className = "hidden " + "sm:block";',
      'function Nav({ className = "hidden" + " md:flex" }: Props): void {}',
      'const link = <NavLink className={({ isActive }) => { return (isActive ? "font-bold" : "hidden") + " lg:flex"; }} />;',
      lines(
        "const containerClassName: string =",
        '  "hidden " +',
        '  "md:flex";',
      ),
    ];

    for (const source of crossPieceSources) {
      const findings: Array<ForeignHiddenRuleFinding> = findingsIn(source);

      expect(
        `${source}\n=> ${findings
          .map((finding: ForeignHiddenRuleFinding): string => {
            return finding.kind;
          })
          .join(", ")}`,
      ).toBe(`${source}\n=> cross-piece`);
    }
  });

  test("cross-piece state variants and disagreeing branches get advice, not a wrong rewrite", () => {
    // ResourceGroupNavigator's shape: a named group un-hides a ternary's hidden.
    const namedGroup: ForeignHiddenRuleFinding = onlyFinding(
      'const actions = <div className={`absolute group-hover/nav-row:flex ${isSelected ? "flex bg-indigo-50" : "hidden bg-gray-100"}`} />;',
    );

    expect(namedGroup.kind).toBe("cross-piece");
    expect(namedGroup.text).toBe("hidden bg-gray-100");
    expect(namedGroup.replacement).toBe(null);
    expect(namedGroup.advice).toBe(STATE_VARIANT_ADVICE);

    /*
     * The two un-hiders are alternatives that never meet, and they un-hide
     * at different screens: `max-md:hidden` would leave the lg branch
     * visible between 768px and 1024px, so no one rewrite is offered.
     */
    const disagreeing: ForeignHiddenRuleFinding = onlyFinding(
      'const element = <div className={`${isWide ? "md:flex" : "lg:block"} ${isCollapsed ? "hidden" : ""}`} />;',
    );

    expect(disagreeing.replacement).toBe(null);
    expect(disagreeing.advice).toBe(DISAGREEING_PIECES_ADVICE);
  });

  test("leaves alone every shape the foreign rule cannot break, and anything that is not a string", () => {
    const safeSources: Array<string> = [
      jsxWithClass("max-md:hidden md:flex"),
      jsxWithClass(NEW_NAVBAR_CLASS),
      jsxWithClass("flex lg:hidden"),
      jsxWithClass("block md:hidden lg:block"),
      // Toggled from JavaScript: the foreign rule can only hide more.
      jsxWithClass("hidden"),
      'const element = <div className={isOpen ? "block" : "hidden"} />;',
      // The two branches of a ternary never meet in one class list.
      'const element = <div className={isOpen ? "hidden" : "md:flex"} />;',
      'const element = <div className={label || "hidden"} />;',
      jsxWithClass("md:hidden"),
      jsxWithClass("overflow-hidden md:flex"),
      jsxWithClass("sr-only md:not-sr-only"),
      // `.\!hidden` is not the class the foreign rule names.
      jsxWithClass("!hidden md:flex"),
      // Variants that do not set a display.
      jsxWithClass(
        "hidden md:flex-col md:opacity-100 group-hover:text-gray-900",
      ),
      // The converted forms themselves.
      jsxWithClass(NEW_FACET_EXCLUDE_CLASS),
      jsxWithClass(NEW_DISCLOSURE_CLASS),
      // Comments and JSX text are not strings.
      '// <div className="hidden md:flex" />',
      "/* hidden lg:flex */ const value: number = 1;",
      "/** Use `hidden md:flex` for desktop-only rows. */ const doc: number = 1;",
      'const element = <div>{/* className="hidden md:flex" */}</div>;',
      "const element = <p>hidden md:flex hides it on phones</p>;",
      // A ternary's condition is not class text.
      'const element = <div className={mode === "hidden" ? "flex" : "md:flex"} />;',
      // An object literal holds classes for different elements.
      'const classes = { nav: "hidden", panel: "md:flex" };',
      // Tokens glued to a substitution are only part of a class name.
      "const element = <div className={`peer-${state}:hidden md:flex`} />;",
      // Strings in no class expression never meet.
      'const first: string = "hidden"; const second: string = "md:flex";',
    ];

    for (const source of safeSources) {
      expect(`${source}\n=> ${formatFindings(findingsIn(source))}`).toBe(
        `${source}\n=> `,
      );
    }
  });

  test("the failure message names file:line, the string, the exact replacement and why", () => {
    const findings: Array<ForeignHiddenRuleFinding> = findingsIn(
      lines(
        'const nav = <nav className="hidden md:flex" />;',
        'const hint = <span className="hidden group-open:inline" />;',
        'const pane = <div className={`${isOpen ? "block" : "hidden"} lg:block`} />;',
      ),
    );

    const message: string = formatFindings(findings);

    expect(message).toContain("3 class string(s)");
    expect(message).toContain("max-<bp>:hidden <bp>:<display>");

    expect(message).toContain(`${FIXTURE_FILE}:1\n`);
    expect(message).toContain('offending string: "hidden md:flex"');
    expect(message).toContain('replace with:     "max-md:hidden md:flex"');

    expect(message).toContain(`${FIXTURE_FILE}:2\n`);
    expect(message).toContain(`offending string: "${OLD_DISCLOSURE_CLASS}"`);
    expect(message).toContain(DISCLOSURE_EXAMPLE_FILE);
    expect(message).toContain(GROUP_HOVER_EXAMPLE_FILE);

    expect(message).toContain(
      `${FIXTURE_FILE}:3 (the bare \`hidden\` and the utility that shows the element again are in different pieces of one class expression)`,
    );
    expect(message).toContain('replace with:     "max-lg:hidden"');

    expect(message.endsWith(WHY_PARAGRAPH)).toBe(true);
    expect(WHY_PARAGRAPH).toContain(".hidden{display:none !important}");
    expect(WHY_PARAGRAPH).toContain("Bootstrap 3");
    expect(WHY_PARAGRAPH).toContain("navigation bar");

    expect(formatFindings([])).toBe("");
  });

  test("the files the advice points at still show the pattern it describes", () => {
    /*
     * A failure message that sends a developer to an example that no longer
     * exists is worse than none.
     */
    expect(readRepositoryFile(GROUP_HOVER_EXAMPLE_FILE)).toContain(
      "group-[:not(:hover)]:hidden",
    );
    expect(readRepositoryFile(DISCLOSURE_EXAMPLE_FILE)).toContain(
      `"${NEW_DISCLOSURE_CLASS}"`,
    );
  });
});

describe("ForeignHiddenRuleGuard file walk", () => {
  const temporaryRoots: Array<string> = [];

  afterAll(() => {
    for (const root of temporaryRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function writeFixture(
    root: string,
    relative: string,
    contents: string,
  ): void {
    const filePath: string = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  }

  test("a checkout without ee/ scans the core roots only, and skips what is not source", () => {
    /*
     * The Community Edition checkout - and the Common Test job, which deletes
     * ee/ before it runs - has no ee/ at all. The walk must not fail there,
     * and must not read build output, dependencies or declaration files.
     */
    const root: string = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "foreign-hidden-guard-")),
    );
    temporaryRoots.push(root);

    const offending: string = jsxWithClass("hidden md:flex");

    writeFixture(
      root,
      "packages/App/FeatureSet/Dashboard/src/Nav.tsx",
      offending,
    );
    writeFixture(root, "packages/App/FeatureSet/Docs/Index.ts", offending);
    writeFixture(root, "packages/Common/UI/Card.tsx", jsxWithClass("hidden"));
    writeFixture(
      root,
      "packages/Common/UI/node_modules/x/Index.tsx",
      offending,
    );
    writeFixture(root, "packages/Common/UI/build/Nav.tsx", offending);
    writeFixture(root, "packages/Common/UI/dist/Nav.tsx", offending);
    writeFixture(root, "packages/Common/UI/Types.d.ts", offending);

    const roots: Array<string> = listScanRoots(root);

    expect(
      roots.map((directory: string): string => {
        return toRelativePath(root, directory);
      }),
    ).toEqual(["packages/App/FeatureSet/Dashboard/src", "packages/Common/UI"]);

    const scan: ForeignHiddenRuleScan = scanFiles(
      roots.flatMap(listSourceFiles),
      root,
    );

    expect(scan.files.sort()).toEqual([
      "packages/App/FeatureSet/Dashboard/src/Nav.tsx",
      "packages/Common/UI/Card.tsx",
    ]);
    expect(
      scan.findings.map((finding: ForeignHiddenRuleFinding): string => {
        return `${finding.file}:${finding.line}`;
      }),
    ).toEqual(["packages/App/FeatureSet/Dashboard/src/Nav.tsx:1"]);

    // With ee/ present, both Enterprise screens are read as well.
    writeFixture(root, "ee/Dashboard/AuditLogs/Modal.tsx", offending);
    writeFixture(root, "ee/AdminDashboard/Index.tsx", "export {};");

    expect(
      listScanRoots(root).map((directory: string): string => {
        return toRelativePath(root, directory);
      }),
    ).toEqual([
      "packages/App/FeatureSet/Dashboard/src",
      "packages/Common/UI",
      "ee/Dashboard",
      "ee/AdminDashboard",
    ]);
  });
});

describe("ForeignHiddenRuleGuard over the real source tree", () => {
  let roots: Array<string> = [];
  let files: Array<string> = [];
  let scan: ForeignHiddenRuleScan = {
    files: [],
    findings: [],
    variantHiddenSites: [],
  };

  /*
   * Parsing ~3,300 files takes seconds. Doing it in beforeAll rather than in
   * the describe body keeps it under a timeout and reports a failure as a
   * failed test instead of a suite that could not even be collected.
   */
  beforeAll(() => {
    roots = listScanRoots(REPOSITORY_ROOT);
    files = roots.flatMap(listSourceFiles);
    scan = scanFiles(files, REPOSITORY_ROOT);
  }, 180000);

  const enterprisePresent: boolean = fs.existsSync(
    path.join(REPOSITORY_ROOT, "ee", "Dashboard"),
  );

  function sitesIn(relative: string): Array<string> {
    return scan.variantHiddenSites
      .filter((site: VariantHiddenSite): boolean => {
        return site.file === relative;
      })
      .map((site: VariantHiddenSite): string => {
        return site.text;
      });
  }

  test("the scan read every frontend, Common/UI and, when the checkout has it, ee/", () => {
    /*
     * Guards the guard: a moved directory or a broken walk would otherwise
     * leave the zero-findings assertion below passing over nothing.
     */
    const relativeRoots: Array<string> = roots.map((root: string): string => {
      return toRelativePath(REPOSITORY_ROOT, root);
    });

    expect(relativeRoots).toEqual(
      expect.arrayContaining([
        "packages/App/FeatureSet/Accounts/src",
        "packages/App/FeatureSet/AdminDashboard/src",
        "packages/App/FeatureSet/Dashboard/src",
        "packages/App/FeatureSet/PublicDashboard/src",
        "packages/App/FeatureSet/StatusPage/src",
        "packages/Common/UI",
      ]),
    );

    // The Community Edition checkout has no ee/, and must still pass.
    expect(relativeRoots.includes("ee/Dashboard")).toBe(enterprisePresent);
    expect(relativeRoots.includes("ee/AdminDashboard")).toBe(
      fs.existsSync(path.join(REPOSITORY_ROOT, "ee", "AdminDashboard")),
    );

    expect(scan.files.length).toBeGreaterThan(2500);
    expect(scan.files).toContain(NAVBAR_FILE);
    expect(scan.files).toContain(
      "packages/App/FeatureSet/Dashboard/src/Components/Header/Header.tsx",
    );

    const skippedDirectory: RegExp = /(^|\/)(node_modules|dist|build)\//;

    expect(
      scan.files.filter((file: string): boolean => {
        return skippedDirectory.test(file) || file.endsWith(".d.ts");
      }),
    ).toEqual([]);

    if (enterprisePresent) {
      expect(scan.files).toContain(ENTERPRISE_AUDIT_LOG_FILE);
    }
  });

  test("the scan read the class strings the fix converted", () => {
    /*
     * Every converted site carries a variant-prefixed `hidden`. Finding them
     * by file proves the parser reads real class strings in these modules -
     * including bracketed arbitrary variants - rather than skipping them.
     */
    expect(sitesIn(NAVBAR_FILE)).toContain(NEW_NAVBAR_CLASS);
    expect(
      sitesIn(
        "packages/App/FeatureSet/Dashboard/src/Components/Header/Header.tsx",
      ),
    ).toContain("max-lg:hidden items-center gap-2 lg:flex");
    expect(
      sitesIn("packages/Common/UI/Components/SideMenu/SideMenu.tsx").some(
        (text: string): boolean => {
          return text.startsWith("max-md:hidden md:block");
        },
      ),
    ).toBe(true);
    expect(sitesIn(GROUP_HOVER_EXAMPLE_FILE)).toContain(
      NEW_FACET_EXCLUDE_CLASS,
    );
    expect(sitesIn(TELEMETRY_FACET_FILE)).toContain(NEW_FACET_EXCLUDE_CLASS);
    expect(sitesIn(DISCLOSURE_EXAMPLE_FILE)).toContain(NEW_DISCLOSURE_CLASS);

    expect(scan.variantHiddenSites.length).toBeGreaterThan(100);

    if (enterprisePresent) {
      expect(
        sitesIn(ENTERPRISE_AUDIT_LOG_FILE).some((text: string): boolean => {
          return text.startsWith("max-md:hidden md:flex");
        }),
      ).toBe(true);
    }
  });

  test("reverting the fix in memory fails the guard in every converted module", () => {
    /*
     * The tree as it was before the fix, rebuilt in memory: every
     * `max-<bp>:hidden` goes back to the bare `hidden`, and the three state
     * variants converted by hand go back to their old strings. Each of those
     * modules must then fail, and FacetValueRow's must be answered with the
     * very string it was converted to.
     */
    const maxHidden: RegExp =
      /(^|[\s"'`])max-(?:sm|md|lg|xl|2xl):hidden(?=[\s"'`]|$)/gm;
    const failingModules: Set<string> = new Set<string>();

    for (const file of files) {
      const source: string = fs.readFileSync(file, "utf8");
      const reverted: string = source
        .replace(maxHidden, "$1hidden")
        .split(`"${NEW_FACET_EXCLUDE_CLASS}"`)
        .join(`"${OLD_FACET_EXCLUDE_CLASS}"`)
        .split(`"${NEW_DISCLOSURE_CLASS}"`)
        .join(`"${OLD_DISCLOSURE_CLASS}"`);

      if (reverted === source) {
        continue;
      }

      const relative: string = toRelativePath(REPOSITORY_ROOT, file);

      if (findForeignHiddenRuleHazards(relative, reverted).length > 0) {
        failingModules.add(relative);
      }
    }

    for (const relative of [
      NAVBAR_FILE,
      "packages/App/FeatureSet/Dashboard/src/Components/Header/Header.tsx",
      "packages/App/FeatureSet/AdminDashboard/src/Components/Header/Header.tsx",
      "packages/App/FeatureSet/StatusPage/src/Components/NavBar/NavBar.tsx",
      "packages/Common/UI/Components/SideMenu/SideMenu.tsx",
      "packages/Common/UI/Components/Card/Card.tsx",
      "packages/Common/UI/Components/Pagination/Pagination.tsx",
      GROUP_HOVER_EXAMPLE_FILE,
      TELEMETRY_FACET_FILE,
      DISCLOSURE_EXAMPLE_FILE,
    ]) {
      expect(`${relative}: ${failingModules.has(relative)}`).toBe(
        `${relative}: true`,
      );
    }

    expect(failingModules.size).toBeGreaterThan(60);

    const facetSource: string = readRepositoryFile(GROUP_HOVER_EXAMPLE_FILE);
    const facetFindings: Array<ForeignHiddenRuleFinding> =
      findForeignHiddenRuleHazards(
        GROUP_HOVER_EXAMPLE_FILE,
        facetSource.replace(NEW_FACET_EXCLUDE_CLASS, OLD_FACET_EXCLUDE_CLASS),
      );

    expect(
      facetFindings.map((finding: ForeignHiddenRuleFinding): string | null => {
        return finding.replacement;
      }),
    ).toEqual([NEW_FACET_EXCLUDE_CLASS]);
  });

  test("no class string relies on a variant to undo a bare `hidden`", () => {
    /*
     * The guard itself. The message lists each offender with its file:line,
     * the string, the exact replacement where one exists, and why.
     */
    expect(formatFindings(scan.findings)).toBe("");
  });
});
