import { expect, Locator, Page, test } from "@playwright/test";

/*
 * A customer's dashboard rendered with no navigation bar at all: no Home link,
 * no Products button, so no way to reach any product. Their browser carried a
 * foreign stylesheet declaring `.hidden { display: none }` — Bootstrap 3 and
 * HTML5 Boilerplate ship exactly that rule with !important, and browser
 * extensions and user stylesheets inject it too. The navbar's desktop row used
 * `hidden md:flex`: the foreign rule matches the bare `hidden` class and beats
 * `md:flex` at every width, so the whole row vanished. The row now uses
 * `max-md:hidden md:flex`, which is display-equivalent but never carries the
 * class the foreign rule targets.
 *
 * jsdom does not evaluate media queries or run Tailwind, so this suite
 * reproduces the customer's environment in real Chromium: the production
 * Dashboard navbar, the vendored Tailwind Play CDN, and the foreign rule
 * injected the ways it reaches real pages.
 */

const projectPath: string = "/dashboard/00000000-0000-4000-8000-000000000001";
const productTitle: string = "Monitors";
const productPath: string = `${projectPath}/monitors`;
const keyboardHint: string = "↑↓ navigate · ↵ open · esc close";

/*
 * The navbar row's class before and after the fix, verbatim from
 * Common/UI/Components/Navbar/NavBar.tsx. The control probes below resolve
 * both in this very page, so every test proves in the real browser that the
 * pre-fix row would have been hidden and the fixed row is shown.
 */
const PRE_FIX_NAVBAR_ROW_CLASS: string =
  "bg-white flex text-center items-center lg:py-2 hidden md:flex";
const FIXED_NAVBAR_ROW_CLASS: string =
  "bg-white flex text-center items-center lg:py-2 max-md:hidden md:flex";

/*
 * At phone width the desktop row is meant to be hidden with or without the
 * foreign rule, so the phone probes use an un-hide utility that is active
 * there instead. The pair still tells the two cases apart: only the element
 * carrying the bare `hidden` class loses to the foreign rule.
 */
const PRE_FIX_PHONE_PROBE_CLASS: string = "hidden max-md:flex";
const FIXED_PHONE_PROBE_CLASS: string = "max-md:flex";

const PRE_FIX_PROBE_TEST_ID: string = "foreign-rule-probe-pre-fix";
const FIXED_PROBE_TEST_ID: string = "foreign-rule-probe-fixed";

type InjectionTiming = "after-render" | "from-first-load";

interface ForeignRuleInjection {
  name: string;
  css: string;
  timing: InjectionTiming;
}

/*
 * Two shapes of the rule. The !important one wins wherever it sits in the
 * document. The plain one has the same specificity as Tailwind's utilities,
 * so it only wins because it cascades after Tailwind's generated <style> —
 * the shape a stylesheet appended to the page by an extension or a host page
 * takes. Each is injected into an already-rendered page and, separately,
 * from the document's first load so it is present before the app renders
 * and through every re-render after it.
 */
const IMPORTANT_HIDDEN_RULE_CSS: string = ".hidden{display:none !important}";
const PLAIN_HIDDEN_RULE_CSS: string = ".hidden{display:none}";

const FOREIGN_RULE_INJECTIONS: Array<ForeignRuleInjection> = [
  {
    name: "an !important .hidden rule is added to the rendered page",
    css: IMPORTANT_HIDDEN_RULE_CSS,
    timing: "after-render",
  },
  {
    name: "a plain .hidden rule is appended after Tailwind's stylesheet on the rendered page",
    css: PLAIN_HIDDEN_RULE_CSS,
    timing: "after-render",
  },
  {
    name: "an !important .hidden rule is present from the first load",
    css: IMPORTANT_HIDDEN_RULE_CSS,
    timing: "from-first-load",
  },
  {
    name: "a plain .hidden rule is present from the first load after Tailwind's stylesheet",
    css: PLAIN_HIDDEN_RULE_CSS,
    timing: "from-first-load",
  },
];

/*
 * Runs in the browser before any page script. Appends the foreign sheet on
 * DOMContentLoaded, before the fixture's #root has rendered anything, and
 * keeps it the last child of <head>: Tailwind's Play CDN creates its <style>
 * lazily after an async compile, so a plain rule could otherwise land before
 * it and silently lose. The control probes would catch that, but the test
 * should model the environment, not flake on it.
 */
const installForeignStylesheetOnFirstLoad: (css: string) => void = (
  css: string,
): void => {
  const appendForeignStylesheet: () => void = (): void => {
    const style: HTMLStyleElement = document.createElement("style");
    style.setAttribute("data-foreign-hidden-rule", "true");
    style.textContent = css;
    document.head.append(style);

    new MutationObserver((): void => {
      if (document.head.lastElementChild !== style) {
        document.head.append(style);
      }
    }).observe(document.head, { childList: true });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", appendForeignStylesheet, {
      once: true,
    });
  } else {
    appendForeignStylesheet();
  }
};

const getNavbar: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("dashboard-navbar");
};

/*
 * The first element each layout needs before anything else is usable: the
 * Home link in the desktop row, the menu toggle on a phone.
 */
const getNavbarEntryPoint: (page: Page, isMobile: boolean) => Locator = (
  page: Page,
  isMobile: boolean,
): Locator => {
  const navbar: Locator = getNavbar(page);
  return isMobile
    ? navbar.getByTestId("mobile-nav-toggle")
    : navbar.getByRole("link", { name: "Home", exact: true });
};

const getProductLink: (page: Page, title: string) => Locator = (
  page: Page,
  title: string,
): Locator => {
  return page.getByRole("link", { name: new RegExp(`^${title}(?:\\s|$)`) });
};

const expectActiveProduct: (
  page: Page,
  title: string,
) => Promise<void> = async (page: Page, title: string): Promise<void> => {
  const navbar: Locator = getNavbar(page);
  await expect(
    navbar.getByRole("button", { name: title, exact: true }),
  ).toBeVisible();
  await expect(
    navbar.getByRole("button", { name: "Products", exact: true }),
  ).toHaveCount(0);
};

const getComputedDisplay: (locator: Locator) => Promise<string> = async (
  locator: Locator,
): Promise<string> => {
  return await locator.evaluate((element: Element): string => {
    return window.getComputedStyle(element).display;
  });
};

const addControlProbes: (
  page: Page,
  isMobile: boolean,
) => Promise<void> = async (page: Page, isMobile: boolean): Promise<void> => {
  const probeClassNames: Record<string, string> = {
    [PRE_FIX_PROBE_TEST_ID]: isMobile
      ? PRE_FIX_PHONE_PROBE_CLASS
      : PRE_FIX_NAVBAR_ROW_CLASS,
    [FIXED_PROBE_TEST_ID]: isMobile
      ? FIXED_PHONE_PROBE_CLASS
      : FIXED_NAVBAR_ROW_CLASS,
  };

  await page.evaluate((classNames: Record<string, string>): void => {
    for (const testId of Object.keys(classNames)) {
      if (document.querySelector(`[data-testid="${testId}"]`)) {
        continue;
      }
      const probe: HTMLDivElement = document.createElement("div");
      probe.setAttribute("data-testid", testId);
      probe.setAttribute("aria-hidden", "true");
      probe.className = classNames[testId] as string;
      document.body.append(probe);
    }
  }, probeClassNames);
};

/*
 * The control that keeps this suite honest: without it, a navbar assertion
 * could pass only because the injection silently failed. The fixed probe
 * resolving to flex proves Tailwind has generated the breakpoint utility the
 * pair shares; after that, the only thing that can hide the pre-fix probe is
 * a rule that beats that utility — the injected one. The baseline test below
 * shows the pre-fix probe resolves to flex when nothing is injected.
 */
const expectForeignRuleIsLive: (
  page: Page,
  isMobile: boolean,
) => Promise<void> = async (page: Page, isMobile: boolean): Promise<void> => {
  await addControlProbes(page, isMobile);
  await expect(page.getByTestId(FIXED_PROBE_TEST_ID)).toHaveCSS(
    "display",
    "flex",
  );
  expect(
    await getComputedDisplay(page.getByTestId(PRE_FIX_PROBE_TEST_ID)),
  ).toBe("none");
};

test("baseline: without a foreign stylesheet the pre-fix class is shown, so the probes measure the injected rule", async ({
  page,
  isMobile,
}: {
  page: Page;
  isMobile: boolean;
}) => {
  await page.goto(`${projectPath}/home?navbar=true`);
  await expect(getNavbarEntryPoint(page, isMobile)).toBeVisible();
  await addControlProbes(page, isMobile);

  await expect(page.getByTestId(FIXED_PROBE_TEST_ID)).toHaveCSS(
    "display",
    "flex",
  );
  await expect(page.getByTestId(PRE_FIX_PROBE_TEST_ID)).toHaveCSS(
    "display",
    "flex",
  );
});

for (const injection of FOREIGN_RULE_INJECTIONS) {
  test(`keeps the navbar and products menu usable when ${injection.name}`, async ({
    page,
    isMobile,
  }: {
    page: Page;
    isMobile: boolean;
  }) => {
    const navbar: Locator = getNavbar(page);

    if (injection.timing === "from-first-load") {
      await page.addInitScript(
        installForeignStylesheetOnFirstLoad,
        injection.css,
      );
      await page.goto(`${projectPath}/home?navbar=true`);
    } else {
      /*
       * Let the navbar render and Tailwind generate its stylesheet first, so
       * the foreign sheet is appended after it — then the navbar has to stay
       * on screen once the rule arrives.
       */
      await page.goto(`${projectPath}/home?navbar=true`);
      await expect(getNavbarEntryPoint(page, isMobile)).toBeVisible();
      await page.addStyleTag({ content: injection.css });
    }

    await expectForeignRuleIsLive(page, isMobile);

    if (isMobile) {
      const toggle: Locator = navbar.getByTestId("mobile-nav-toggle");
      await expect(toggle).toBeVisible();
      await toggle.click();
      await expect(
        navbar.getByRole("link", { name: "Home", exact: true }),
      ).toBeVisible();
      await expect(getProductLink(page, productTitle)).toBeVisible();
    } else {
      await expect(
        navbar.getByRole("link", { name: "Home", exact: true }),
      ).toBeVisible();
      const productsButton: Locator = navbar.getByRole("button", {
        name: "Products",
        exact: true,
      });
      await expect(productsButton).toBeVisible();
      await productsButton.click();

      /*
       * The dialog element itself is a zero-size wrapper around fixed-position
       * panels, so assert on what the user sees inside it.
       */
      const productsMenu: Locator = page.getByRole("dialog", {
        name: "Products menu",
      });
      await expect(productsMenu).toHaveCount(1);
      await expect(
        productsMenu.getByRole("combobox", { name: "Search products…" }),
      ).toBeVisible();
      /*
       * The menu's keyboard hint used `hidden ... md:flex` too; it is the
       * desktop-only part of the dialog the foreign rule would have removed.
       */
      await expect(productsMenu.getByLabel(keyboardHint)).toBeVisible();
      await expect(getProductLink(page, productTitle)).toBeVisible();
    }

    await getProductLink(page, productTitle).click();
    await expect(page).toHaveURL(productPath);
    await expect(page.getByTestId("current-route")).toHaveText(productPath);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expectActiveProduct(page, productTitle);

    /*
     * Navigating re-renders the navbar and makes Tailwind regenerate its
     * stylesheet. The rule must still be live afterwards, or the assertions
     * above could have been checked against a page that had shed it.
     */
    await expectForeignRuleIsLive(page, isMobile);
  });
}
