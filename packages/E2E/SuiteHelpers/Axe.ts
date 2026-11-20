import AxeBuilder from "@axe-core/playwright";
import { expect, Page } from "@playwright/test";

/*
 * Runs axe's rules on part of a page, in a real browser (#10297).
 *
 * The suites held each accessibility fix by hand - a role here, a name
 * there - and source guards such as AriaRolesGuard and NestedControlsGuard.
 * The bugs those fixes were for are what axe's rules catch: a role="menu"
 * with no menu items, two navigation landmarks with one name, a control
 * inside a control, a made-up role (#7964, #7963, #7237, #6922, #7360). So
 * a suite that draws the shared chrome and widgets runs these rules on what
 * it draws, as it draws it: light and dark, at 1280 and 390 pixels, with a
 * menu or a dialog open.
 *
 * The rules are named, never axe's whole set: a suite asks only what the
 * shared UI has been held to, and a rule added here is one every suite that
 * calls this then holds.
 */
export const SHARED_UI_AXE_RULES: ReadonlyArray<string> = [
  // A menu, a list or a tab list holds the items its role needs.
  "aria-required-children",
  // Two landmarks of one kind have names of their own.
  "landmark-unique",
  // No control inside another: a screen reader hears only the outer one.
  "nested-interactive",
  // Every role is one ARIA has.
  "aria-roles",
  // An element carries only a role its kind may have.
  "aria-allowed-role",
  // Every button and link has a name a screen reader says.
  "button-name",
  "link-name",
];

// One rule broken, and every element it is broken on, as a spec reads it.
export interface AxeViolation {
  rule: string;
  help: string;
  targets: Array<string>;
}

export interface AxeScope {
  // The CSS selectors of what to check: a section, a dialog, an open menu.
  include: Array<string>;
  // What inside them not to check.
  exclude?: Array<string>;
  // The rules to run, SHARED_UI_AXE_RULES when left out.
  rules?: ReadonlyArray<string>;
}

// Runs the rules on what `scope` includes, and returns each one broken.
export async function axeViolations(
  page: Page,
  scope: AxeScope,
): Promise<Array<AxeViolation>> {
  let builder: AxeBuilder = new AxeBuilder({ page: page }).withRules([
    ...(scope.rules || SHARED_UI_AXE_RULES),
  ]);

  for (const selector of scope.include) {
    builder = builder.include(selector);
  }

  for (const selector of scope.exclude || []) {
    builder = builder.exclude(selector);
  }

  const results: Awaited<ReturnType<AxeBuilder["analyze"]>> =
    await builder.analyze();

  return results.violations.map(
    (violation: (typeof results.violations)[number]): AxeViolation => {
      return {
        rule: violation.id,
        help: violation.help,
        targets: violation.nodes.map(
          (node: (typeof violation.nodes)[number]): string => {
            return node.target.join(" ");
          },
        ),
      };
    },
  );
}

/*
 * Fails naming every rule broken and where, so a failure on CI reads as
 * the fix it asks for.
 */
export async function expectNoAxeViolations(
  page: Page,
  scope: AxeScope & { message?: string },
): Promise<void> {
  expect(
    await axeViolations(page, scope),
    scope.message || `axe's rules on ${scope.include.join(", ")}`,
  ).toEqual([]);
}
