import {
  CONDITIONAL_PARTNER_ADVICE,
  ClassAttribute,
  DISAGREEING_PIECES_ADVICE,
  DISCLOSURE_EXAMPLE_FILE,
  EjsTag,
  ForeignHiddenRuleFinding,
  ForeignHiddenRuleScan,
  GROUP_HOVER_EXAMPLE_FILE,
  GROUP_HOVER_REWRITE_ADVICE,
  GROUP_REWRITE_CAVEAT,
  MIXED_BREAKPOINT_ADVICE,
  NAMED_GROUP_EXAMPLE_FILE,
  SR_ONLY_CONDITIONAL_PARTNER_ADVICE,
  SR_ONLY_MEDIA_ADVICE,
  SR_ONLY_MIXED_BREAKPOINT_ADVICE,
  SR_ONLY_WHY_PARAGRAPH,
  STATE_VARIANT_ADVICE,
  THEME_STYLESHEET_FILE,
  VariantHiddenSite,
  WHY_PARAGRAPH,
  extractClassAttributes,
  findEjsTags,
  findForeignHiddenRuleHazards,
  formatFindings,
  isMarkupFile,
  listScanRoots,
  listSourceFiles,
  listViewFiles,
  listViewRoots,
  scanFiles,
  toRelativePath,
} from "../ForeignHiddenRuleGuard";
import {
  PHONE_WIDTH_IN_PX,
  ScreenReaderOnlyOptions,
  TAILWIND_BREAKPOINTS_IN_PX,
  VisibilityOptions,
  WIDE_DESKTOP_WIDTH_IN_PX,
  isVisuallyCollapsed,
  resolveDisplay,
  splitVariants,
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
 * AST, and every server-rendered view that loads the same Play CDN (the Docs,
 * the API Reference, the website in packages/Home/Views, Common's server
 * views and the frontends' index.ejs shells), and names the file, the line,
 * the string and what to write instead. It also holds the `sr-only` analogue:
 * the same stylesheets ship `.sr-only`, which collapses a
 * `sr-only sm:not-sr-only` label to 1px at every width.
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
const VIEW_FIXTURE_FILE: string = "Fixture.ejs";

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

// The Docs desktop sidebar (every page's navigation) before and after.
const OLD_DOCS_SIDEBAR_CLASS: string =
  "docs-layout-sidebar hidden lg:relative lg:block lg:flex-none";
const NEW_DOCS_SIDEBAR_CLASS: string =
  "docs-layout-sidebar max-lg:hidden lg:relative lg:block lg:flex-none";

// The website's primary nav, after the fix.
const HOME_PRIMARY_NAV_CLASS: string = "max-md:hidden space-x-10 md:flex";

// The visible labels that were `sr-only <bp>:not-sr-only`, after the fix.
const NEW_SM_LABEL_CLASS: string = "max-sm:sr-only sm:not-sr-only";
const NEW_XL_LABEL_CLASS: string = "max-xl:sr-only xl:not-sr-only";

// The skip-link idiom the sr-only check must leave alone.
const SKIP_LINK_CLASS_PREFIX: string = "sr-only focus:not-sr-only";

// A JavaScript-chosen `hidden` in a tag, with no un-hider beside it: must stay clean.
const CODE_TABS_PANEL_CLASS: string =
  "code-panel relative <%= index === 0 ? '' : 'hidden' %>";

const NAVBAR_FILE: string = "packages/Common/UI/Components/Navbar/NavBar.tsx";
const TELEMETRY_FACET_FILE: string =
  "packages/Common/UI/Components/TelemetryViewer/components/TelemetryFacetValueRow.tsx";
const ENTERPRISE_AUDIT_LOG_FILE: string =
  "ee/Dashboard/AuditLogs/AuditLogChangesModal.tsx";

const DOCS_INDEX_VIEW: string = "packages/App/FeatureSet/Docs/Views/Index.ejs";
const DOCS_HEADER_VIEW: string =
  "packages/App/FeatureSet/Docs/Views/Partials/Header.ejs";
const API_REFERENCE_NAV_VIEW: string =
  "packages/App/FeatureSet/APIReference/views/partials/nav.ejs";
const API_REFERENCE_PAGE_VIEW: string =
  "packages/App/FeatureSet/APIReference/views/pages/index.ejs";
const API_REFERENCE_CODE_TABS_VIEW: string =
  "packages/App/FeatureSet/APIReference/views/partials/code-tabs.ejs";
const HOME_NAV_VIEW: string = "packages/Home/Views/nav.ejs";
const DASHBOARD_OFFLINE_PAGE: string =
  "packages/App/FeatureSet/Dashboard/public/offline.html";

const SR_ONLY_LABEL_SITES: Array<[string, string]> = [
  [
    "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayScreenshotActions.tsx",
    NEW_SM_LABEL_CLASS,
  ],
  [
    "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayUi.tsx",
    NEW_SM_LABEL_CLASS,
  ],
  [
    "packages/App/FeatureSet/Dashboard/src/Components/Workspace/SendTestNotificationButton.tsx",
    NEW_SM_LABEL_CLASS,
  ],
  [
    "packages/Common/UI/Components/Feed/FeedOptionsButton.tsx",
    NEW_XL_LABEL_CLASS,
  ],
];

const SKIP_LINK_FILES: Array<string> = [
  "packages/Common/UI/Components/MasterPage/MasterPage.tsx",
  "packages/App/FeatureSet/StatusPage/src/Components/MasterPage/MasterPage.tsx",
  API_REFERENCE_PAGE_VIEW,
  HOME_NAV_VIEW,
];

const FOREIGN_RULE: VisibilityOptions = { withForeignHiddenRule: true };
const FOREIGN_SR_ONLY_RULE: ScreenReaderOnlyOptions = {
  withForeignSrOnlyRule: true,
};

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

// `max-md:hidden` -> `hidden`, and the same for `max-md:sr-only`: the pre-fix idioms.
const MAX_WIDTH_HIDDEN: RegExp =
  /(^|[\s"'`])max-(?:sm|md|lg|xl|2xl):hidden(?=[\s"'`]|$)/gm;
const MAX_WIDTH_SR_ONLY: RegExp =
  /(^|[\s"'`])max-(?:sm|md|lg|xl|2xl):sr-only(?=[\s"'`]|$)/gm;

function lines(...sourceLines: Array<string>): string {
  return sourceLines.join("\n");
}

function findingsIn(source: string): Array<ForeignHiddenRuleFinding> {
  return findForeignHiddenRuleHazards(FIXTURE_FILE, source);
}

function viewFindingsIn(source: string): Array<ForeignHiddenRuleFinding> {
  return findForeignHiddenRuleHazards(VIEW_FIXTURE_FILE, source);
}

function onlyFinding(source: string): ForeignHiddenRuleFinding {
  const findings: Array<ForeignHiddenRuleFinding> = findingsIn(source);

  expect(findings).toHaveLength(1);

  return findings[0]!;
}

function onlyViewFinding(source: string): ForeignHiddenRuleFinding {
  const findings: Array<ForeignHiddenRuleFinding> = viewFindingsIn(source);

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

// One line per finding, for a failure message that reads as a list.
function describeFindings(findings: Array<ForeignHiddenRuleFinding>): string {
  return findings
    .map((finding: ForeignHiddenRuleFinding): string => {
      return `${finding.line} ${finding.kind} ${finding.hidingClass}: ${finding.text} -> ${finding.replacement}`;
    })
    .join("\n");
}

// A class attribute as `line: static | text`, one `|` where each tag was.
function readAttributes(source: string): Array<string> {
  return extractClassAttributes(source).map(
    (attribute: ClassAttribute): string => {
      return `${attribute.line}: ${attribute.parts.join("|")}`;
    },
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
      hidingClass: "hidden",
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
    expect(facet.advice).toBe(GROUP_HOVER_REWRITE_ADVICE);
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

  test("the group rewrite advice says when the inversion is exact, how to name an outer group, and what dark mode does", () => {
    /*
     * `group-hover:flex` shows while ANY enclosing `.group` is hovered;
     * `group-[:not(:hover)]:hidden` hides while any is NOT. With one group
     * they agree. With nested groups the rewrite follows the innermost one,
     * so the advice has to say so and name the escape hatch - a named group -
     * and the dark theme brightens these reveals by class substring, so it
     * has to say which substrings Theme.css already knows.
     */
    for (const advice of [STATE_VARIANT_ADVICE, GROUP_HOVER_REWRITE_ADVICE]) {
      expect(advice).toContain(GROUP_REWRITE_CAVEAT);
    }

    expect(GROUP_REWRITE_CAVEAT).toContain("innermost `.group`");
    expect(GROUP_REWRITE_CAVEAT).toContain("`group/card` on the trigger");
    expect(GROUP_REWRITE_CAVEAT).toContain(
      "`group-[:not(:hover)]/card:hidden` on the element",
    );
    expect(GROUP_REWRITE_CAVEAT).toContain(NAMED_GROUP_EXAMPLE_FILE);
    expect(GROUP_REWRITE_CAVEAT).toContain(THEME_STYLESHEET_FILE);
    expect(GROUP_REWRITE_CAVEAT).toContain(
      "already recognises `group-[:not(:hover)` beside `group-hover`",
    );

    // The named form the advice recommends is itself one the guard accepts.
    expect(
      findingsIn(jsxWithClass("flex h-5 w-5 group-[:not(:hover)]/card:hidden")),
    ).toEqual([]);
    expect(splitVariants("group-[:not(:hover)]/card:hidden")).toEqual([
      "group-[:not(:hover)]/card",
      "hidden",
    ]);
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
      hidingClass: "hidden",
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

  test("an un-hider that is only there under its own condition gets advice, not a rewrite that shows the element when it is off", () => {
    /*
     * `cn("hidden", isWide && "lg:flex")` hides the element at every width
     * while isWide is false. Rewriting the `hidden` alone to `max-lg:hidden`
     * would show it from 1024px up in exactly that case - the cascade model
     * says so below - so no rewrite is printed.
     */
    expect(resolveDisplay("hidden", 1024)).toBe("hidden");
    expect(resolveDisplay("max-lg:hidden", 1024)).toBe(null);

    const conditionalSources: Array<string> = [
      'const element = <div className={cn("hidden", isWide && "lg:flex")} />;',
      'const names: string = classNames("hidden", { "lg:flex": isWide });',
      'const element = <div className={`hidden ${isWide ? "lg:flex" : ""}`} />;',
      'const element = <div className={`hidden ${label || "lg:flex"}`} />;',
    ];

    for (const source of conditionalSources) {
      const finding: ForeignHiddenRuleFinding = onlyFinding(source);

      expect(`${source}\n=> ${finding.kind} ${finding.replacement}`).toBe(
        `${source}\n=> cross-piece null`,
      );
      expect(finding.advice).toBe(CONDITIONAL_PARTNER_ADVICE);
    }

    expect(CONDITIONAL_PARTNER_ADVICE).toContain(
      '`condition ? "max-<bp>:hidden <bp>:<display>" : "hidden"`',
    );

    // Only the partner's own condition matters: a conditional `hidden` beside an unconditional un-hider is exact.
    expect(
      onlyFinding('const names: string = cx({ hidden: !isOpen }, "lg:block");')
        .replacement,
    ).toBe("max-lg:hidden");
    expect(
      onlyFinding(
        'const element = <div className={cn(isWide && "hidden", isWide && "lg:flex")} />;',
      ).advice,
    ).toBe(CONDITIONAL_PARTNER_ADVICE);
  });

  test("the sr-only analogue: a breakpoint not-sr-only gets the exact max-<bp>:sr-only rewrite, identical at every width", () => {
    /*
     * Bootstrap 3 and HTML5 Boilerplate also ship `.sr-only`. Appended after
     * Tailwind's <style> it ties with `.sm\:not-sr-only` (a media query adds
     * no specificity) and wins on source order, so a label meant to show
     * from `sm` up stays a 1px box at every width - the session replay
     * actions, test-notification states and the feed options label. The
     * sr-only resolver in ResponsiveVisibility.ts - the same one
     * SrOnlyForeignRule.test.tsx sweeps the tree with - checks each rewrite.
     */
    const cases: Array<[string, string]> = [
      ["sr-only sm:not-sr-only", NEW_SM_LABEL_CLASS],
      ["sr-only xl:not-sr-only", NEW_XL_LABEL_CLASS],
      [
        "text-xs sr-only md:not-sr-only md:ml-1",
        "text-xs max-md:sr-only md:not-sr-only md:ml-1",
      ],
      // Several screens: the narrowest one decides.
      [
        "sr-only lg:not-sr-only md:not-sr-only",
        "max-md:sr-only lg:not-sr-only md:not-sr-only",
      ],
      // A max-width un-hider is mirrored.
      ["sr-only max-md:not-sr-only", "md:sr-only max-md:not-sr-only"],
    ];

    for (const [original, replacement] of cases) {
      const finding: ForeignHiddenRuleFinding = onlyFinding(
        jsxWithClass(original),
      );

      expect(finding.hidingClass).toBe("sr-only");
      expect(finding.text).toBe(original);
      expect(finding.replacement).toBe(replacement);
      expect(findingsIn(jsxWithClass(replacement))).toEqual([]);

      for (const width of WIDTHS_IN_PX) {
        expect(
          `${replacement} @ ${width}px collapsed: ${isVisuallyCollapsed(replacement, width)}`,
        ).toBe(
          `${replacement} @ ${width}px collapsed: ${isVisuallyCollapsed(original, width)}`,
        );
        expect(
          `${replacement} @ ${width}px, foreign rule, collapsed: ${isVisuallyCollapsed(replacement, width, FOREIGN_SR_ONLY_RULE)}`,
        ).toBe(
          `${replacement} @ ${width}px, foreign rule, collapsed: ${isVisuallyCollapsed(original, width)}`,
        );
        expect(isVisuallyCollapsed(original, width, FOREIGN_SR_ONLY_RULE)).toBe(
          true,
        );
      }
    }

    // The four label files ship the recommended strings.
    for (const [file, shipped] of SR_ONLY_LABEL_SITES) {
      expect(readRepositoryFile(file)).toContain(`"${shipped}"`);
    }
  });

  test("a state variant out-specifies a foreign .sr-only, so a not-sr-only behind one is left alone", () => {
    /*
     * The `.sr-only` those stylesheets ship is not !important, so the
     * selector with more specificity wins wherever the sheet sits. Every
     * state or pseudo variant adds to the selector: `.focus\:not-sr-only:focus`
     * keeps the skip links working, and hover, group-*, peer-*, aria-*,
     * data-*, dark: (darkMode "class") and arbitrary [&...] variants beat
     * the lone foreign class the same way - even stacked under a screen.
     * Flagging them would ask for rewrites that fix nothing. The real skip
     * links must stay clean.
     */
    const stateRevealed: Array<string> = [
      `${SKIP_LINK_CLASS_PREFIX} focus:absolute focus:top-4 focus:left-4`,
      "sr-only focus-visible:not-sr-only",
      "sr-only focus-within:not-sr-only",
      "sr-only group-focus:not-sr-only",
      "sr-only group-focus-within/menu:not-sr-only",
      "sr-only peer-focus-visible:not-sr-only",
      "sr-only [&:focus]:not-sr-only",
      "sr-only sm:focus:not-sr-only",
      "sr-only hover:not-sr-only",
      "sr-only group-hover:not-sr-only",
      "sr-only group-hover/card:not-sr-only",
      "sr-only peer-checked:not-sr-only",
      "sr-only aria-expanded:not-sr-only",
      "sr-only data-[state=open]:not-sr-only",
      "sr-only dark:not-sr-only",
      "sr-only [&.is-open]:not-sr-only",
      "sr-only group-[.is-open]:not-sr-only",
      "sr-only lg:group-hover:not-sr-only",
      "sr-only md:hover:not-sr-only",
    ];

    for (const classAttribute of stateRevealed) {
      expect(
        `${classAttribute} => ${formatFindings(findingsIn(jsxWithClass(classAttribute)))}`,
      ).toBe(`${classAttribute} => `);
    }

    // Split across pieces, a state partner is left alone just the same.
    expect(
      findingsIn(
        'const label = <span className={clsx("sr-only", "group-hover:not-sr-only")} />;',
      ),
    ).toEqual([]);

    for (const file of SKIP_LINK_FILES) {
      const source: string = readRepositoryFile(file);

      expect(source).toContain(SKIP_LINK_CLASS_PREFIX);
      expect(
        `${file}: ${formatFindings(findForeignHiddenRuleHazards(file, source))}`,
      ).toBe(`${file}: `);
    }
  });

  test("every media-query not-sr-only is flagged, named screen or not; the others get advice", () => {
    /*
     * An @media wrapper adds no specificity, so a foreign `.sr-only` ties
     * with any of these and wins on source order. Only the named screens
     * have the mechanical max-<bp> rewrite (see the test above); the rest
     * get the advice.
     */
    const mediaRevealed: Array<string> = [
      "sr-only print:not-sr-only",
      "sr-only min-[900px]:not-sr-only",
      "sr-only max-[900px]:not-sr-only",
      "sr-only motion-safe:not-sr-only",
      "sr-only motion-reduce:not-sr-only",
      "sr-only contrast-more:not-sr-only",
      "sr-only contrast-less:not-sr-only",
      "sr-only portrait:not-sr-only",
      "sr-only landscape:not-sr-only",
      "sr-only forced-colors:not-sr-only",
      // A stack of media queries is still one @media block.
      "sr-only md:print:not-sr-only",
    ];

    for (const classAttribute of mediaRevealed) {
      const finding: ForeignHiddenRuleFinding = onlyFinding(
        jsxWithClass(classAttribute),
      );

      expect(
        `${classAttribute}: ${finding.hidingClass} ${finding.replacement}`,
      ).toBe(`${classAttribute}: sr-only null`);
      expect(finding.advice).toBe(SR_ONLY_MEDIA_ADVICE);
    }

    const mixed: ForeignHiddenRuleFinding = onlyFinding(
      jsxWithClass("sr-only max-sm:not-sr-only lg:not-sr-only"),
    );

    expect(mixed.replacement).toBe(null);
    expect(mixed.advice).toBe(SR_ONLY_MIXED_BREAKPOINT_ADVICE);

    // Split across pieces, the pair is read the same way as a split `hidden`.
    const crossPiece: ForeignHiddenRuleFinding = onlyFinding(
      'const label = <span className={clsx("sr-only", "sm:not-sr-only")} />;',
    );

    expect(crossPiece.kind).toBe("cross-piece");
    expect(crossPiece.hidingClass).toBe("sr-only");
    expect(crossPiece.replacement).toBe("max-sm:sr-only");
    expect(
      onlyFinding(
        'const label = <span className={cn("sr-only", isWide && "sm:not-sr-only")} />;',
      ).advice,
    ).toBe(SR_ONLY_CONDITIONAL_PARTNER_ADVICE);

    // What is not the pair: the shipped form, a lone sr-only, `!sr-only`.
    for (const classAttribute of [
      NEW_SM_LABEL_CLASS,
      "sr-only",
      "not-sr-only",
      "md:sr-only",
      "!sr-only md:not-sr-only",
    ]) {
      expect(findingsIn(jsxWithClass(classAttribute))).toEqual([]);
    }
  });

  test("reverting the sr-only labels in memory fails each file, and the guard recommends what shipped", () => {
    for (const [file, shipped] of SR_ONLY_LABEL_SITES) {
      const current: string = readRepositoryFile(file);
      const reverted: string = current.replace(MAX_WIDTH_SR_ONLY, "$1sr-only");

      expect(reverted).not.toBe(current);
      expect(findForeignHiddenRuleHazards(file, current)).toEqual([]);

      const findings: Array<ForeignHiddenRuleFinding> =
        findForeignHiddenRuleHazards(file, reverted);

      expect(findings.length).toBeGreaterThan(0);
      expect(
        findings.map((finding: ForeignHiddenRuleFinding): string => {
          return `${file}:${finding.line} ${finding.hidingClass} ${finding.replacement}`;
        }),
      ).toEqual(
        findings.map((finding: ForeignHiddenRuleFinding): string => {
          return `${file}:${finding.line} sr-only ${shipped}`;
        }),
      );
    }
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
      // The shipped sr-only form, and the skip-link idiom.
      jsxWithClass(NEW_SM_LABEL_CLASS),
      jsxWithClass(`${SKIP_LINK_CLASS_PREFIX} focus:absolute`),
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
        'const row = <div className="hidden text-gray-400 group-hover:flex" />;',
      ),
    );

    const message: string = formatFindings(findings);

    expect(message).toContain("4 class string(s)");
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

    // Both state-variant answers carry the nested-group and dark-mode caveat.
    expect(message).toContain(`${FIXTURE_FILE}:4\n`);
    expect(message).toContain(
      'replace with:     "flex text-gray-400 group-[:not(:hover)]:hidden"',
    );
    expect(message).toContain(`fix:              ${STATE_VARIANT_ADVICE}`);
    expect(message).toContain(
      `fix:              ${GROUP_HOVER_REWRITE_ADVICE}`,
    );
    expect(message).toContain("group-[:not(:hover)]/card:hidden");
    expect(message).toContain(THEME_STYLESHEET_FILE);

    expect(message.endsWith(WHY_PARAGRAPH)).toBe(true);
    expect(message).not.toContain(SR_ONLY_WHY_PARAGRAPH);
    expect(WHY_PARAGRAPH).toContain(".hidden{display:none !important}");
    expect(WHY_PARAGRAPH).toContain("Bootstrap 3");
    expect(WHY_PARAGRAPH).toContain("navigation bar");

    expect(formatFindings([])).toBe("");
  });

  test("the failure message counts sr-only findings apart and explains them", () => {
    const srOnlyMessage: string = formatFindings(
      findingsIn('const label = <span className="sr-only sm:not-sr-only" />;'),
    );

    expect(srOnlyMessage).toContain(
      "1 class string(s) visually hide an element with the bare `sr-only` class",
    );
    expect(srOnlyMessage).toContain(
      "Use `max-<bp>:sr-only <bp>:not-sr-only` instead of `sr-only <bp>:not-sr-only`",
    );
    expect(srOnlyMessage).toContain(
      `replace with:     "${NEW_SM_LABEL_CLASS}"`,
    );
    expect(srOnlyMessage).not.toContain("bare `hidden` class");
    expect(srOnlyMessage.endsWith(SR_ONLY_WHY_PARAGRAPH)).toBe(true);
    expect(SR_ONLY_WHY_PARAGRAPH).toContain("`.sr-only`");
    expect(SR_ONLY_WHY_PARAGRAPH).toContain("skip link");
    expect(SR_ONLY_WHY_PARAGRAPH).toContain("group-hover:not-sr-only");

    const bothMessage: string = formatFindings(
      findingsIn(
        lines(
          'const label = <span className="sr-only sm:not-sr-only" />;',
          'const nav = <nav className="hidden md:flex" />;',
        ),
      ),
    );

    expect(bothMessage).toContain(
      "1 class string(s) hide an element with the bare `hidden` class",
    );
    expect(bothMessage).toContain(
      "1 class string(s) visually hide an element with the bare `sr-only` class",
    );
    expect(bothMessage).toContain(SR_ONLY_WHY_PARAGRAPH);
    expect(bothMessage.endsWith(WHY_PARAGRAPH)).toBe(true);
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

    const namedGroupSource: string = readRepositoryFile(
      NAMED_GROUP_EXAMPLE_FILE,
    );

    expect(namedGroupSource).toContain("group/nav-row ");
    expect(namedGroupSource).toMatch(
      /group-\[:not\(:hover\)[^\s"]*\/nav-row:hidden/,
    );

    const themeStylesheet: string = readRepositoryFile(THEME_STYLESHEET_FILE);

    expect(themeStylesheet).toContain(
      'html.dark .group:hover [class*="group-hover"][class*="text-gray-"]',
    );
    expect(themeStylesheet).toContain(
      'html.dark .group:hover [class*="group-[:not(:hover)"][class*="text-gray-"]',
    );
  });
});

describe("ForeignHiddenRuleGuard view extractor", () => {
  test("reads the static text of a class attribute, with each <% %> tag dropped as a token boundary", () => {
    const source: string = lines(
      "<a href=\"/docs/<%= lang %>/<%= link %>\" class=\"docs-nav__link <%= isActive ? 'is-active' : '' %> px-2\">",
      "  <%= title %>",
      "</a>",
    );

    const attributes: Array<ClassAttribute> = extractClassAttributes(source);

    // The href's tags are not in the class attribute.
    expect(attributes).toHaveLength(1);
    expect(attributes[0]!.line).toBe(1);
    expect(attributes[0]!.parts).toEqual(["docs-nav__link ", " px-2"]);
    expect(
      attributes[0]!.tags.map((tag: EjsTag): [string, string, boolean] => {
        return [tag.text, tag.code, tag.outputs];
      }),
    ).toEqual([
      [
        "<%= isActive ? 'is-active' : '' %>",
        " isActive ? 'is-active' : '' ",
        true,
      ],
    ]);
  });

  test("reads double-, single- and un-quoted values, in any case, over as many lines as they take", () => {
    expect(
      readAttributes(
        lines(
          "<span class='tooltip hidden md:inline'>",
          '<div CLASS="hidden lg:flex">',
          "<p class=hidden>",
          '<b class = "a b">',
        ),
      ),
    ).toEqual([
      "1: tooltip hidden md:inline",
      "2: hidden lg:flex",
      "3: hidden",
      "4: a b",
    ]);

    // Reported at the line of the attribute's name, not of the tag.
    const multiLine: Array<ClassAttribute> = extractClassAttributes(
      lines(
        "<div",
        '  id="toc-panel"',
        '  class="hidden',
        "    items-center",
        '    md:flex"',
        ">",
      ),
    );

    expect(multiLine).toHaveLength(1);
    expect(multiLine[0]!.line).toBe(3);
    expect(multiLine[0]!.parts).toEqual([
      "hidden\n    items-center\n    md:flex",
    ]);
  });

  test("a quote inside a tag, or a > inside another attribute, does not end the markup early", () => {
    expect(
      readAttributes(
        lines(
          '<div class="<%= wide ? "w-full" : "w-1/2" %> hidden md:flex">',
          '<button onclick="items.forEach((item) => item.close())" class="hidden sm:flex">',
          '<<%= headingTag %> class="hidden lg:block">',
        ),
      ),
    ).toEqual([
      "1: | hidden md:flex",
      "2: hidden sm:flex",
      "3: hidden lg:block",
    ]);
  });

  test("other attributes, comments, text and text-only elements are not class attributes", () => {
    const source: string = lines(
      '<div data-class="hidden md:flex"></div>',
      '<div :class="{ hidden: !open }" x-bind:class="md:flex"></div>',
      '<div className="hidden md:flex"></div>',
      "<div title=\"class='hidden md:flex'\"></div>",
      '<p>Write class="hidden md:flex" and it vanishes.</p>',
      '<pre><code>&lt;div class="hidden md:flex"&gt;</code></pre>',
      '<!-- <div class="hidden md:flex"></div> -->',
      "<style>.tip::after { content: '<i class=\"hidden md:flex\">'; }</style>",
      '<textarea><div class="hidden md:flex"></div></textarea>',
      '<title>class="hidden md:flex"</title>',
    );

    expect(readAttributes(source)).toEqual([]);
    expect(viewFindingsIn(source)).toEqual([]);
  });

  test("markup inside a <script>'s strings is read as an attribute; className and classList are not", () => {
    /*
     * The decision for script text: `el.innerHTML = '<span class="...">'`
     * becomes a real class attribute the moment it is inserted, so the
     * foreign rule hits it just the same, and it is read. A class a script
     * sets with `className =` or `classList` is not an attribute and is not
     * read here: toggling a lone `hidden` from JavaScript is the one use the
     * foreign rule cannot break. A JSON <script> that carries markup with
     * escaped quotes is read too.
     */
    const source: string = lines(
      "<script>",
      "  button.innerHTML = '<span class=\"hidden sm:inline\">Copy</span>';",
      '  panel.className = "hidden md:flex";',
      '  if (a < b) { list.innerHTML = "<li class=\'hidden lg:block\'>" + label + "</li>"; }',
      "</script>",
      '<script type="application/json">{"html": "<b class=\\"hidden md:flex\\">"}</script>',
      '<div class="after-script">',
    );

    expect(readAttributes(source)).toEqual([
      "2: hidden sm:inline",
      "4: hidden lg:block",
      "6: hidden md:flex",
      "7: after-script",
    ]);

    expect(
      viewFindingsIn(source).map(
        (finding: ForeignHiddenRuleFinding): string => {
          return `${finding.line} ${finding.replacement}`;
        },
      ),
    ).toEqual([
      "2 max-sm:hidden sm:inline",
      "4 max-lg:hidden lg:block",
      "6 max-md:hidden md:flex",
    ]);
  });

  test("tells output tags from scriptlets and comments, and reads <%% as text", () => {
    const tags: Array<EjsTag> = findEjsTags(
      lines(
        "<%# note %><%- html -%><%_ trim _%>",
        "<%% literal %%><% if (a) { %>",
      ),
    );

    expect(
      tags.map((tag: EjsTag): string => {
        return `${tag.codeLine} ${tag.text} [${tag.code}] outputs=${tag.outputs} comment=${tag.isComment}`;
      }),
    ).toEqual([
      "1 <%# note %> [ note ] outputs=false comment=true",
      "1 <%- html -%> [ html ] outputs=true comment=false",
      "1 <%_ trim _%> [ trim ] outputs=false comment=false",
      "2 <% if (a) { %> [ if (a) { ] outputs=false comment=false",
    ]);
  });

  test("views and HTML pages are read as markup; modules as code", () => {
    expect(isMarkupFile("packages/Home/Views/nav.ejs")).toBe(true);
    expect(isMarkupFile(DASHBOARD_OFFLINE_PAGE)).toBe(true);
    expect(isMarkupFile(NAVBAR_FILE)).toBe(false);

    // In a module this line is a comment; in a page it is markup after some text.
    const text: string = '// <div class="hidden md:flex"></div>';

    expect(findForeignHiddenRuleHazards("offline.html", text)).toHaveLength(1);
    expect(findForeignHiddenRuleHazards("Nav.ts", text)).toEqual([]);
  });
});

describe("ForeignHiddenRuleGuard over views", () => {
  test("flags the Docs sidebar that took every docs page's navigation away, and recommends what shipped", () => {
    const finding: ForeignHiddenRuleFinding = onlyViewFinding(
      lines(
        '<div class="relative z-0 mx-auto flex w-full">',
        "    <!-- Desktop sidebar (left): hidden lg:block -->",
        `    <div class="${OLD_DOCS_SIDEBAR_CLASS}">`,
      ),
    );

    expect(finding).toEqual({
      file: VIEW_FIXTURE_FILE,
      line: 3,
      kind: "same-string",
      hidingClass: "hidden",
      text: OLD_DOCS_SIDEBAR_CLASS,
      partnerText: null,
      // `lg:relative` is not a display utility; `lg:block` is what shows it.
      unhidingTokens: ["lg:block"],
      replacement: NEW_DOCS_SIDEBAR_CLASS,
      advice: "replace the bare `hidden` with `max-lg:hidden`",
    });

    for (const width of WIDTHS_IN_PX) {
      expect(
        `${width}px: ${resolveDisplay(NEW_DOCS_SIDEBAR_CLASS, width, FOREIGN_RULE)}`,
      ).toBe(`${width}px: ${resolveDisplay(OLD_DOCS_SIDEBAR_CLASS, width)}`);
      expect(resolveDisplay(OLD_DOCS_SIDEBAR_CLASS, width, FOREIGN_RULE)).toBe(
        "hidden",
      );
    }

    expect(readRepositoryFile(DOCS_INDEX_VIEW)).toContain(
      `class="${NEW_DOCS_SIDEBAR_CLASS}"`,
    );
  });

  test("reverting Index.ejs in memory makes the real view fail the guard", () => {
    const current: string = readRepositoryFile(DOCS_INDEX_VIEW);
    const reverted: string = current.replace(
      `class="${NEW_DOCS_SIDEBAR_CLASS}"`,
      `class="${OLD_DOCS_SIDEBAR_CLASS}"`,
    );

    expect(reverted).not.toBe(current);
    expect(findForeignHiddenRuleHazards(DOCS_INDEX_VIEW, current)).toEqual([]);
    expect(
      findForeignHiddenRuleHazards(DOCS_INDEX_VIEW, reverted).map(
        (finding: ForeignHiddenRuleFinding): string => {
          return `${finding.file}:${finding.line} ${finding.replacement}`;
        },
      ),
    ).toEqual([
      `${DOCS_INDEX_VIEW}:${lineContaining(reverted, OLD_DOCS_SIDEBAR_CLASS)} ${NEW_DOCS_SIDEBAR_CLASS}`,
    ]);
  });

  test("a tag is a token boundary: the text around it is one string, and a token glued to it is not read", () => {
    const aroundTag: ForeignHiddenRuleFinding = onlyViewFinding(
      '<a href="/" class="docs-brand <%= extra %> hidden sm:flex items-center">',
    );

    expect(aroundTag.text).toBe(
      "docs-brand <%= extra %> hidden sm:flex items-center",
    );
    expect(aroundTag.replacement).toBe(
      "docs-brand <%= extra %> max-sm:hidden sm:flex items-center",
    );

    // The `hidden` and its un-hider on either side of a tag still meet.
    expect(
      onlyViewFinding('<div class="hidden <%= gap %> md:flex">').replacement,
    ).toBe("max-md:hidden <%= gap %> md:flex");

    // A multi-line value is reported at the attribute and printed on one line.
    const multiLine: ForeignHiddenRuleFinding = onlyViewFinding(
      lines("<nav", '  class="hidden', "    <%= navClass %>", '    lg:flex">'),
    );

    expect(multiLine.line).toBe(2);
    expect(multiLine.text).toBe("hidden <%= navClass %> lg:flex");

    for (const glued of [
      '<div class="hidden<%= suffix %> md:flex">',
      '<div class="hidden md:<%= display %>">',
      '<div class="<%= size %>hidden lg:block">',
    ]) {
      expect(`${glued} => ${formatFindings(viewFindingsIn(glued))}`).toBe(
        `${glued} => `,
      );
    }
  });

  test("a string an output tag prints meets the attribute's static text", () => {
    const printed: ForeignHiddenRuleFinding = onlyViewFinding(
      lines(
        "<% tabs.forEach(function (tab, index) { %>",
        "  <div class=\"code-panel md:block <%= index === 0 ? '' : 'hidden' %>\">",
      ),
    );

    expect(printed).toEqual({
      file: VIEW_FIXTURE_FILE,
      line: 2,
      kind: "cross-piece",
      hidingClass: "hidden",
      text: "hidden",
      partnerText: "code-panel md:block <%= index === 0 ? '' : 'hidden' %>",
      unhidingTokens: ["md:block"],
      replacement: "max-md:hidden",
      advice: "replace the bare `hidden` with `max-md:hidden`",
    });

    const printedShapes: Array<string> = [
      "<div class=\"lg:flex <%- collapsed ? 'hidden' : '' %>\">",
      "<div class=\"<%= collapsed ? 'hidden' : '' %> <%= tone %> lg:flex\">",
      '<div class=\'lg:flex <%= collapsed ? "hidden" : "" %>\'>',
      "<div class=\"lg:flex <%= collapsed && 'hidden px-2' %>\">",
    ];

    for (const source of printedShapes) {
      const finding: ForeignHiddenRuleFinding = onlyViewFinding(source);

      expect(`${source} => ${finding.kind} ${finding.replacement}`).toMatch(
        /[=]> cross-piece max-lg:hidden( px-2)?$/,
      );
    }

    // The un-hider only printed under a condition: no rewrite of the static `hidden` is exact.
    const conditional: ForeignHiddenRuleFinding = onlyViewFinding(
      "<div class=\"hidden <%= wide ? 'md:flex' : '' %>\">",
    );

    expect(conditional.kind).toBe("cross-piece");
    expect(conditional.text).toBe("hidden <%= wide ? 'md:flex' : '' %>");
    expect(conditional.replacement).toBe(null);
    expect(conditional.advice).toBe(CONDITIONAL_PARTNER_ADVICE);
  });

  test("only a tag's printed value is class text: conditions, scriptlets and comments are not", () => {
    const safeViews: Array<string> = [
      // The API Reference code tabs: a lone, JavaScript-chosen `hidden`.
      `<div class="${CODE_TABS_PANEL_CLASS}">`,
      "<div class=\"<%= open ? 'block' : 'hidden' %>\">",
      // The branches of one ternary never meet.
      "<div class=\"<%= open ? 'hidden' : 'md:flex' %>\">",
      // A condition is not class text.
      "<div class=\"md:flex <%= mode === 'hidden' ? 'px-2' : 'px-4' %>\">",
      // A scriptlet prints nothing, and a comment is not code.
      "<div class=\"md:flex <% if (mode === 'hidden') { %> px-2 <% } %>\">",
      "<div class=\"md:flex <%# 'hidden' is set by the script %>\">",
      // An object prints [object Object], not its keys.
      '<div class="md:flex <%= { hidden: true } %>">',
      // The converted markup and the skip link.
      `<div class="${NEW_DOCS_SIDEBAR_CLASS}">`,
      `<a href="#main" class="${SKIP_LINK_CLASS_PREFIX} focus:absolute">Skip</a>`,
    ];

    for (const source of safeViews) {
      expect(`${source} => ${formatFindings(viewFindingsIn(source))}`).toBe(
        `${source} => `,
      );
    }

    // The real code tabs file carries that shape, and stays clean.
    const codeTabs: string = readRepositoryFile(API_REFERENCE_CODE_TABS_VIEW);

    expect(codeTabs).toContain(`class="${CODE_TABS_PANEL_CLASS}"`);
    expect(
      findForeignHiddenRuleHazards(API_REFERENCE_CODE_TABS_VIEW, codeTabs),
    ).toEqual([]);
  });

  test("the code in every tag is read like a module, at the line it is on, and reported once", () => {
    // A string literal in a class attribute's tag, holding the whole pair.
    const inTag: Array<ForeignHiddenRuleFinding> = viewFindingsIn(
      "<div class=\"px-2 <%= wide ? 'hidden md:flex' : 'block' %>\">",
    );

    expect(describeFindings(inTag)).toBe(
      "1 same-string hidden: hidden md:flex -> max-md:hidden md:flex",
    );

    // A class built in a scriptlet, far from any attribute.
    const scriptlets: Array<ForeignHiddenRuleFinding> = viewFindingsIn(
      lines(
        "<header>",
        "<% const navClass = 'hidden lg:flex'; %>",
        "<%",
        "  const menuClassName =",
        "    'hidden ' +",
        "    'md:flex';",
        "%>",
        '<nav class="<%= navClass %>"></nav>',
        "</header>",
      ),
    );

    expect(describeFindings(scriptlets)).toBe(
      lines(
        "2 same-string hidden: hidden lg:flex -> max-lg:hidden lg:flex",
        "5 cross-piece hidden: hidden  -> max-md:hidden ",
      ),
    );

    // A template literal the tag prints: its own reading reports the `hidden`, the attribute's does not repeat it.
    expect(
      describeFindings(
        viewFindingsIn(
          "<div class=\"px-2 <%= `${open ? 'hidden' : ''} md:flex` %>\">",
        ),
      ),
    ).toBe("1 cross-piece hidden: hidden -> max-md:hidden");
  });

  test("the sr-only analogue in a view, and the website's skip link left alone", () => {
    const label: ForeignHiddenRuleFinding = onlyViewFinding(
      '<button><svg></svg><span class="sr-only sm:not-sr-only">Copy</span></button>',
    );

    expect(label.hidingClass).toBe("sr-only");
    expect(label.replacement).toBe(NEW_SM_LABEL_CLASS);

    const homeNav: string = readRepositoryFile(HOME_NAV_VIEW);

    expect(homeNav).toContain(`class="${SKIP_LINK_CLASS_PREFIX}`);
    expect(findForeignHiddenRuleHazards(HOME_NAV_VIEW, homeNav)).toEqual([]);
  });

  test("a view's cross-piece finding says the pieces are the attribute's static text and a tag", () => {
    const message: string = formatFindings(
      viewFindingsIn(
        "<div class=\"code-panel md:block <%= index === 0 ? '' : 'hidden' %>\">",
      ),
    );

    expect(message).toContain(
      `${VIEW_FIXTURE_FILE}:1 (the bare \`hidden\` and the utility that shows the element again are in different pieces of one class attribute (its static text and a <% %> tag))`,
    );
    expect(message).toContain('replace with:     "max-md:hidden"');
  });
});

describe("ForeignHiddenRuleGuard file walk", () => {
  const temporaryRoots: Array<string> = [];

  afterAll(() => {
    for (const root of temporaryRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function makeRoot(): string {
    const root: string = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "foreign-hidden-guard-")),
    );
    temporaryRoots.push(root);
    return root;
  }

  function writeFixture(
    root: string,
    relative: string,
    contents: string,
  ): void {
    const filePath: string = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  }

  function relativeTo(root: string): (directory: string) => string {
    return (directory: string): string => {
      return toRelativePath(root, directory);
    };
  }

  test("a checkout without ee/ scans the core roots only, and skips what is not source", () => {
    /*
     * The Community Edition checkout - and the Common Test job, which deletes
     * ee/ before it runs - has no ee/ at all. The walk must not fail there,
     * and must not read build output, dependencies or declaration files.
     * The Docs feature set has no browser source: its server-side TypeScript
     * is not read, but its views are (see the next test).
     */
    const root: string = makeRoot();
    const offending: string = jsxWithClass("hidden md:flex");

    writeFixture(
      root,
      "packages/App/FeatureSet/Dashboard/src/Nav.tsx",
      offending,
    );
    writeFixture(root, "packages/App/FeatureSet/Docs/Index.ts", offending);
    writeFixture(
      root,
      "packages/App/FeatureSet/Docs/Views/Index.ejs",
      '<div class="hidden lg:block"></div>',
    );
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

    expect(roots.map(relativeTo(root))).toEqual([
      "packages/App/FeatureSet/Dashboard/src",
      "packages/Common/UI",
    ]);

    const scan: ForeignHiddenRuleScan = scanFiles(
      [
        ...roots.flatMap(listSourceFiles),
        ...listViewRoots(root).flatMap(listViewFiles),
      ],
      root,
    );

    expect(scan.files.sort()).toEqual([
      "packages/App/FeatureSet/Dashboard/src/Nav.tsx",
      "packages/App/FeatureSet/Docs/Views/Index.ejs",
      "packages/Common/UI/Card.tsx",
    ]);
    expect(
      scan.findings
        .map((finding: ForeignHiddenRuleFinding): string => {
          return `${finding.file}:${finding.line}`;
        })
        .sort(),
    ).toEqual([
      "packages/App/FeatureSet/Dashboard/src/Nav.tsx:1",
      "packages/App/FeatureSet/Docs/Views/Index.ejs:1",
    ]);

    // With ee/ present, both Enterprise screens are read as well.
    writeFixture(root, "ee/Dashboard/AuditLogs/Modal.tsx", offending);
    writeFixture(root, "ee/AdminDashboard/Index.tsx", "export {};");

    expect(listScanRoots(root).map(relativeTo(root))).toEqual([
      "packages/App/FeatureSet/Dashboard/src",
      "packages/Common/UI",
      "ee/Dashboard",
      "ee/AdminDashboard",
    ]);
  });

  test("the views are found by listing, whatever the case of their directory, and each is read once", () => {
    /*
     * git tracks Docs/Views but APIReference/views. A guessed spelling would
     * miss one on a case-sensitive filesystem and read both spellings of the
     * same directory on a case-insensitive one, so the directories are read
     * from the listing and deduped by real path - here through a symlink,
     * which behaves the same on every filesystem.
     */
    const root: string = makeRoot();
    const offendingView: string = '<nav class="hidden md:flex"></nav>';

    writeFixture(
      root,
      "packages/App/FeatureSet/Docs/Views/Partials/Header.ejs",
      offendingView,
    );
    writeFixture(
      root,
      "packages/App/FeatureSet/APIReference/views/partials/nav.ejs",
      offendingView,
    );
    writeFixture(
      root,
      "packages/App/FeatureSet/Dashboard/views/index.ejs",
      '<div id="root" class="h-full"></div>',
    );
    writeFixture(
      root,
      "packages/App/FeatureSet/Dashboard/public/offline.html",
      offendingView,
    );
    writeFixture(
      root,
      "packages/App/FeatureSet/Dashboard/public/assets/logo.svg",
      '<svg class="hidden md:block"></svg>',
    );
    writeFixture(
      root,
      "packages/Common/Server/Views/ViewMessage.ejs",
      '<p class="text-sm"><%= message %></p>',
    );
    writeFixture(root, "packages/Home/Views/nav.ejs", offendingView);
    writeFixture(
      root,
      "packages/Home/Views/node_modules/x/index.ejs",
      offendingView,
    );
    writeFixture(root, "packages/Home/Static/page.html", offendingView);

    fs.mkdirSync(path.join(root, "packages", "App", "FeatureSet", "Legacy"));
    fs.symlinkSync(
      path.join(root, "packages", "App", "FeatureSet", "Docs", "Views"),
      path.join(root, "packages", "App", "FeatureSet", "Legacy", "views"),
      "dir",
    );

    const viewRoots: Array<string> = listViewRoots(root);

    expect(viewRoots.map(relativeTo(root))).toEqual([
      "packages/App/FeatureSet/APIReference/views",
      "packages/App/FeatureSet/Dashboard/views",
      "packages/App/FeatureSet/Dashboard/public",
      "packages/App/FeatureSet/Docs/Views",
      "packages/Common/Server/Views",
      "packages/Home/Views",
    ]);

    const scan: ForeignHiddenRuleScan = scanFiles(
      viewRoots.flatMap(listViewFiles),
      root,
    );

    expect(scan.files.sort()).toEqual([
      "packages/App/FeatureSet/APIReference/views/partials/nav.ejs",
      "packages/App/FeatureSet/Dashboard/public/offline.html",
      "packages/App/FeatureSet/Dashboard/views/index.ejs",
      "packages/App/FeatureSet/Docs/Views/Partials/Header.ejs",
      "packages/Common/Server/Views/ViewMessage.ejs",
      "packages/Home/Views/nav.ejs",
    ]);
    expect(
      scan.findings
        .map((finding: ForeignHiddenRuleFinding): string => {
          return `${finding.file}:${finding.line} ${finding.replacement}`;
        })
        .sort(),
    ).toEqual([
      "packages/App/FeatureSet/APIReference/views/partials/nav.ejs:1 max-md:hidden md:flex",
      "packages/App/FeatureSet/Dashboard/public/offline.html:1 max-md:hidden md:flex",
      "packages/App/FeatureSet/Docs/Views/Partials/Header.ejs:1 max-md:hidden md:flex",
      "packages/Home/Views/nav.ejs:1 max-md:hidden md:flex",
    ]);
  });
});

describe("ForeignHiddenRuleGuard over the real source tree", () => {
  let roots: Array<string> = [];
  let viewRoots: Array<string> = [];
  let files: Array<string> = [];
  let viewFiles: Array<string> = [];
  let scan: ForeignHiddenRuleScan = {
    files: [],
    findings: [],
    variantHiddenSites: [],
  };

  /*
   * Parsing ~3,600 files takes seconds. Doing it in beforeAll rather than in
   * the describe body keeps it under a timeout and reports a failure as a
   * failed test instead of a suite that could not even be collected.
   */
  beforeAll(() => {
    roots = listScanRoots(REPOSITORY_ROOT);
    viewRoots = listViewRoots(REPOSITORY_ROOT);
    files = roots.flatMap(listSourceFiles);
    viewFiles = viewRoots.flatMap(listViewFiles);
    scan = scanFiles([...files, ...viewFiles], REPOSITORY_ROOT);
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

  test("the scan read every frontend, Common/UI, the server-rendered views and, when the checkout has it, ee/", () => {
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

    const relativeViewRoots: Array<string> = viewRoots.map(
      (root: string): string => {
        return toRelativePath(REPOSITORY_ROOT, root);
      },
    );

    expect(relativeViewRoots).toEqual(
      expect.arrayContaining([
        "packages/App/FeatureSet/Docs/Views",
        "packages/App/FeatureSet/APIReference/views",
        "packages/App/FeatureSet/Dashboard/views",
        "packages/App/FeatureSet/Dashboard/public",
        "packages/App/FeatureSet/Identity/Views",
        "packages/Common/Server/Views",
        "packages/Home/Views",
      ]),
    );

    // No directory read twice, whatever the filesystem's case rules.
    expect(
      new Set<string>(
        viewRoots.map((root: string): string => {
          return fs.realpathSync(root);
        }),
      ).size,
    ).toBe(viewRoots.length);

    expect(scan.files.length).toBeGreaterThan(2750);
    expect(viewFiles.length).toBeGreaterThan(250);
    expect(scan.files).toContain(NAVBAR_FILE);
    expect(scan.files).toContain(
      "packages/App/FeatureSet/Dashboard/src/Components/Header/Header.tsx",
    );

    for (const view of [
      DOCS_INDEX_VIEW,
      DOCS_HEADER_VIEW,
      API_REFERENCE_NAV_VIEW,
      API_REFERENCE_PAGE_VIEW,
      HOME_NAV_VIEW,
      DASHBOARD_OFFLINE_PAGE,
      "packages/Common/Server/Views/ViewMessage.ejs",
    ]) {
      expect(scan.files).toContain(view);
    }

    /*
     * Listing a view is not reading it: an extractor that found no class
     * attributes would pass the zero-findings test over every view. The Docs
     * sidebar's converted attribute has to come back out of Index.ejs.
     */
    expect(sitesIn(DOCS_INDEX_VIEW)).toContain(NEW_DOCS_SIDEBAR_CLASS);

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

    // And the class attributes of the views the EJS codemod converted.
    expect(sitesIn(HOME_NAV_VIEW)).toContain(HOME_PRIMARY_NAV_CLASS);
    expect(sitesIn(API_REFERENCE_NAV_VIEW).length).toBeGreaterThan(0);

    expect(scan.variantHiddenSites.length).toBeGreaterThan(400);

    if (enterprisePresent) {
      expect(
        sitesIn(ENTERPRISE_AUDIT_LOG_FILE).some((text: string): boolean => {
          return text.startsWith("max-md:hidden md:flex");
        }),
      ).toBe(true);
    }
  });

  test("reverting the fix in memory fails the guard in every converted module and view, with the shipped string as the fix", () => {
    /*
     * The tree as it was before the fix, rebuilt in memory: every
     * `max-<bp>:hidden` goes back to the bare `hidden` - in the modules and
     * in the Docs, API Reference and website views alike - every
     * `max-<bp>:sr-only` back to `sr-only`, and the three state variants
     * converted by hand go back to their old strings. Each of those files
     * must then fail. And wherever the guard prints a replacement, it must
     * be exactly the string the fix shipped on that line: the codemod and
     * the guard agree, site by site.
     */
    const shippedSites: Set<string> = new Set<string>(
      scan.variantHiddenSites.map((site: VariantHiddenSite): string => {
        return `${site.file}:${site.line} ${site.text}`;
      }),
    );
    const failingFiles: Set<string> = new Set<string>();
    const srOnlyFiles: Set<string> = new Set<string>();
    const disagreements: Array<string> = [];

    for (const file of [...files, ...viewFiles]) {
      const source: string = fs.readFileSync(file, "utf8");
      const reverted: string = source
        .replace(MAX_WIDTH_HIDDEN, "$1hidden")
        .replace(MAX_WIDTH_SR_ONLY, "$1sr-only")
        .split(`"${NEW_FACET_EXCLUDE_CLASS}"`)
        .join(`"${OLD_FACET_EXCLUDE_CLASS}"`)
        .split(`"${NEW_DISCLOSURE_CLASS}"`)
        .join(`"${OLD_DISCLOSURE_CLASS}"`);

      if (reverted === source) {
        continue;
      }

      const relative: string = toRelativePath(REPOSITORY_ROOT, file);
      const findings: Array<ForeignHiddenRuleFinding> =
        findForeignHiddenRuleHazards(relative, reverted);

      if (findings.length > 0) {
        failingFiles.add(relative);
      }

      for (const finding of findings) {
        if (finding.hidingClass === "sr-only") {
          srOnlyFiles.add(relative);
          continue;
        }

        if (
          finding.replacement !== null &&
          !shippedSites.has(
            `${relative}:${finding.line} ${finding.replacement}`,
          )
        ) {
          disagreements.push(
            `${relative}:${finding.line} guard: ${finding.replacement}`,
          );
        }
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
      DOCS_INDEX_VIEW,
      DOCS_HEADER_VIEW,
      API_REFERENCE_NAV_VIEW,
      HOME_NAV_VIEW,
    ]) {
      expect(`${relative}: ${failingFiles.has(relative)}`).toBe(
        `${relative}: true`,
      );
    }

    expect([...srOnlyFiles].sort()).toEqual(
      SR_ONLY_LABEL_SITES.map((site: [string, string]): string => {
        return site[0];
      }).sort(),
    );

    const failingViews: Array<string> = [...failingFiles].filter(isMarkupFile);

    for (const viewRoot of [
      "packages/App/FeatureSet/Docs/Views/",
      "packages/App/FeatureSet/APIReference/views/",
      "packages/Home/Views/",
    ]) {
      expect(
        `${viewRoot}: ${failingViews.some((view: string): boolean => {
          return view.startsWith(viewRoot);
        })}`,
      ).toBe(`${viewRoot}: true`);
    }

    expect(failingViews.length).toBeGreaterThan(85);
    expect(failingFiles.size - failingViews.length).toBeGreaterThan(60);
    expect(disagreements).toEqual([]);

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
  }, 120000);

  test("no class string relies on a variant to undo a bare `hidden` (or `sr-only`)", () => {
    /*
     * The guard itself. The message lists each offender with its file:line,
     * the string, the exact replacement where one exists, and why.
     */
    expect(formatFindings(scan.findings)).toBe("");
  });
});
