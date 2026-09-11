import { BASE_URL } from "../../Config";
import DocsNav, { NavGroup } from "../../../App/FeatureSet/Docs/Utils/Nav";
import English from "../../../App/FeatureSet/Docs/Locales/en.json";
import French from "../../../App/FeatureSet/Docs/Locales/fr.json";
import { Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

interface DocsLocale {
  ui: {
    documentation: string;
    openNavigation: string;
    closeNavigation: string;
    switchLanguage: string;
    toggleTheme: string;
  };
  navGroups: { [key: string]: string };
  navLinks: { [key: string]: string };
}

interface ToggleTarget {
  title: string;
  controls: string | null;
  matchingLists: number;
  insideGroup: boolean;
}

const locales: { [key: string]: DocsLocale } = { en: English, fr: French };

function docsUrl(language: string, path: string): string {
  return URL.fromString(BASE_URL.toString())
    .addRoute(`/docs/${language}/${path}`)
    .toString();
}

async function iconShapes(nav: Locator): Promise<string[]> {
  return nav.locator(".docs-nav__icon").evaluateAll((icons: Element[]) => {
    return icons.map((icon: Element): string => {
      return icon.innerHTML.replace(/\s+/g, " ").trim();
    });
  });
}

async function expectNavigation(
  page: Page,
  nav: Locator,
  locale: DocsLocale,
): Promise<string[]> {
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("button")).toHaveCount(DocsNav.length);
  await expect(nav.getByRole("button")).toHaveText(
    DocsNav.map((group: NavGroup): string => {
      return locale.navGroups[group.title] || group.title;
    }),
  );
  await expect(nav.locator('.docs-nav__icon[aria-hidden="true"]')).toHaveCount(
    DocsNav.length,
  );

  const shapes: string[] = await iconShapes(nav);
  expect(shapes).toHaveLength(DocsNav.length);
  expect(
    shapes.every((shape: string): boolean => {
      return shape.length > 0;
    }),
  ).toBe(true);
  // The old positional lookup reused the same fallback for the final groups.
  expect(new Set(shapes).size).toBe(DocsNav.length);

  const targets: ToggleTarget[] = await page
    .locator("[data-docs-nav] [data-nav-toggle]")
    .evaluateAll((buttons: Element[]): ToggleTarget[] => {
      const lists: Element[] = Array.from(
        document.querySelectorAll(".docs-nav__links[id]"),
      );
      return buttons.map((button: Element): ToggleTarget => {
        const controls: string | null = button.getAttribute("aria-controls");
        const matchingLists: Element[] = lists.filter(
          (list: Element): boolean => {
            return list.id === controls;
          },
        );
        return {
          title: button.textContent?.trim() || "",
          controls,
          matchingLists: matchingLists.length,
          insideGroup:
            matchingLists.length === 1 &&
            matchingLists[0]?.parentElement === button.parentElement,
        };
      });
    });

  expect(targets).toHaveLength(DocsNav.length * 2);
  for (const target of targets) {
    expect(target.controls, target.title).toBeTruthy();
    expect(target.matchingLists, target.title).toBe(1);
    expect(target.insideGroup, target.title).toBe(true);
  }
  return shapes;
}

test.describe("Docs: category icons", () => {
  test.use({ colorScheme: "light" });

  for (const language of ["en", "fr"]) {
    for (const mobile of [false, true]) {
      test(`${language} ${mobile ? "mobile drawer" : "desktop sidebar"} keeps distinct icons through navigation`, async ({
        page,
      }: {
        page: Page;
      }) => {
        const locale: DocsLocale = locales[language]!;
        await page.setViewportSize(
          mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
        );
        const response: Awaited<ReturnType<Page["goto"]>> = await page.goto(
          docsUrl("en", "introduction/getting-started"),
        );
        expect(response?.status()).toBe(200);

        const sidebar: Locator = page.locator(
          "#docs-sidebar-scroll [data-docs-nav]",
        );
        const drawer: Locator = page.locator("#docs-mobile-drawer");
        const drawerNav: Locator = drawer.locator("[data-docs-nav]");
        const englishShapes: string[] = await iconShapes(sidebar);

        if (language !== "en") {
          if (mobile) {
            await page
              .getByRole("button", { name: English.ui.openNavigation })
              .click();
          }
          await (mobile ? drawer : page)
            .getByRole("combobox", { name: English.ui.switchLanguage })
            .selectOption(language);
          await expect(page).toHaveURL(
            docsUrl(language, "introduction/getting-started"),
          );
          await page.waitForLoadState("load");
        }
        await expect(page.locator("html")).toHaveAttribute("lang", language);

        const openNavigation: Locator = page.getByRole("button", {
          name: locale.ui.openNavigation,
        });
        if (mobile) {
          await expect(openNavigation).toHaveAttribute(
            "aria-controls",
            "docs-mobile-drawer",
          );
          await openNavigation.click();
          await expect(openNavigation).toHaveAttribute("aria-expanded", "true");
          await expect(drawer).toHaveRole("dialog");
          await expect(drawer).toHaveAccessibleName(locale.ui.documentation);
          await expect(
            drawer.getByRole("button", { name: locale.ui.closeNavigation }),
          ).toBeFocused();
        }

        const nav: Locator = mobile ? drawerNav : sidebar;
        const shapes: string[] = await expectNavigation(page, nav, locale);
        expect(shapes).toEqual(englishShapes);
        expect(await iconShapes(mobile ? sidebar : drawerNav)).toEqual(shapes);

        await expect(
          nav.getByRole("button", {
            name: locale.navGroups["Introduction"]!,
            exact: true,
          }),
        ).toHaveAttribute("aria-expanded", "true");
        await expect(
          nav.locator(
            `a[href="/docs/${language}/introduction/getting-started"]`,
          ),
        ).toHaveAttribute("aria-current", "page");

        // Exercise a category at the bottom, where the repeated icons appeared.
        const selfHosted: Locator = nav.getByRole("button", {
          name: locale.navGroups["Self Hosted"]!,
          exact: true,
        });
        await selfHosted.click();
        await expect(selfHosted).toHaveAttribute("aria-expanded", "true");
        await nav
          .getByRole("link", {
            name: locale.navLinks["Slack Integration"]!,
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(
          docsUrl(language, "self-hosted/slack-integration"),
        );
        await page.waitForLoadState("load");

        if (mobile) {
          await openNavigation.click();
        }
        await expect(selfHosted).toHaveAttribute("aria-expanded", "true");
        await expect(
          nav.getByRole("link", {
            name: locale.navLinks["Slack Integration"]!,
            exact: true,
          }),
        ).toHaveAttribute("aria-current", "page");
        expect(await iconShapes(nav)).toEqual(shapes);

        if (mobile) {
          await page.keyboard.press("Escape");
          await expect(drawer).toBeHidden();
          await expect(openNavigation).toHaveAttribute(
            "aria-expanded",
            "false",
          );
          await expect(openNavigation).toBeFocused();
        } else {
          await page
            .getByRole("button", { name: locale.ui.toggleTheme })
            .click();
          await expect(page.locator("html")).toHaveClass(/dark/);
          expect(await iconShapes(nav)).toEqual(shapes);
        }
      });
    }
  }
});
