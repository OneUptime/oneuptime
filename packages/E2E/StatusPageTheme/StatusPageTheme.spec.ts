import {
  APIRequestContext,
  expect,
  Locator,
  Page,
  test,
  TestInfo,
} from "@playwright/test";

/*
 * A status page's theme, in a real browser, on the real status page: its own
 * index.ejs rendered as its servers render it and its own app
 * (App/FeatureSet/StatusPage/src/Index.tsx), with only its API answered from
 * fixture data (StatusPageTheme/Fixture). See README.md.
 *
 *   - Light and Dark are what they say; System follows the device's
 *     prefers-color-scheme, live, and offers the visitor a switch in the
 *     footer that their browser remembers.
 *   - The theme is applied before the first paint: with Tailwind and the
 *     app held back, the page is already in its scheme.
 *   - In the dark theme no surface of the overview, the incident, the
 *     announcement, the maintenance event, the subscribe form, the sign-in
 *     pages or the not-found page is left a light box; status text reads at
 *     4.5:1; the very dark red of a long outage's bar has an edge; a Dark
 *     page and one that follows the device put the logo on a light backdrop.
 *   - A logo made for the dark theme is shown instead while the page is
 *     dark, with no backdrop, in the header and on the sign-in pages.
 *   - On its own domain a Light or Dark page offers no switch; on the
 *     Dashboard's preview (its OneUptime address, where the rest of this
 *     suite opens it) every page does, for the visit only.
 *   - The SSO page offers Log in with password under its providers, lined
 *     up with them.
 *   - The footer's language and theme controls sit centred on a phone, and
 *     the switch is a target a thumb can hit.
 *
 * Screenshots of every surface in both themes are saved for review under
 * output/playwright/status-page-theme-ui.
 */

interface FixtureRecord {
  requests: Array<string>;
  unexpected: Array<string>;
}

declare global {
  interface Window {
    __statusPageThemeFixture: FixtureRecord;
  }
}

const PAGE: string = "/status-page/00000000-0000-4000-8000-000000000001";
const INCIDENT: string = `${PAGE}/incidents/00000000-0000-4000-8000-000000000500`;
const ANNOUNCEMENT: string = `${PAGE}/announcements/00000000-0000-4000-8000-000000000600`;
const MAINTENANCE: string = `${PAGE}/scheduled-events/00000000-0000-4000-8000-000000000700`;

/*
 * The same page on its own domain: the fixture answers the app's lookup of
 * this host with the page, as the API answers for a verified custom domain.
 * PAGE above is its OneUptime address - the Dashboard's preview.
 */
const OWN_DOMAIN: string = "/";

const LIGHT_CANVAS: string = "rgb(249, 250, 251)";
const DARK_CANVAS: string = "rgb(15, 23, 42)";
const DARK_CARD: string = "rgb(23, 32, 51)";

const STORAGE_KEY: string = "oneuptime-status-page-theme";

const SCREENSHOTS: string = "../../output/playwright/status-page-theme-ui";

type Scheme = "light" | "dark";

interface DrawnPage {
  htmlClass: string;
  dataTheme: string | null;
  colorScheme: string;
  themeColor: string | null;
  setting: string | null;
  canvas: string;
}

const drawnPage: (page: Page) => Promise<DrawnPage> = async (
  page: Page,
): Promise<DrawnPage> => {
  return page.evaluate((): DrawnPage => {
    const root: HTMLElement = document.documentElement;

    return {
      htmlClass: root.className,
      dataTheme: root.getAttribute("data-theme"),
      colorScheme: root.style.colorScheme,
      themeColor:
        document
          .querySelector('meta[name="theme-color"]')
          ?.getAttribute("content") || null,
      setting: root.getAttribute("data-status-page-theme"),
      /*
       * What the visitor sees behind everything: the body's ground, or, while
       * the parser is still in <head>, the page's own.
       */
      canvas: getComputedStyle(document.body || root).backgroundColor,
    };
  });
};

const expectScheme: (page: Page, scheme: Scheme) => Promise<void> = async (
  page: Page,
  scheme: Scheme,
): Promise<void> => {
  await expect
    .poll(async (): Promise<string> => {
      return (await drawnPage(page)).dataTheme || "";
    })
    .toBe(scheme);

  const drawn: DrawnPage = await drawnPage(page);

  expect(drawn.htmlClass.split(" ").includes("dark")).toBe(scheme === "dark");
  expect(drawn.colorScheme).toBe(scheme);
  expect(drawn.themeColor).toBe(scheme === "dark" ? "#0f172a" : "#f9fafb");
};

const openPage: (
  page: Page,
  path: string,
  query: string,
  ready?: string,
) => Promise<void> = async (
  page: Page,
  path: string,
  query: string,
  ready: string = "status-page-overview",
): Promise<void> => {
  await page.goto(`${path}?${query}`);

  if (ready) {
    await expect(page.getByTestId(ready)).toBeVisible();
  }

  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
};

const shoot: (
  page: Page,
  testInfo: TestInfo,
  name: string,
) => Promise<void> = async (
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> => {
  await page.screenshot({
    path: `${SCREENSHOTS}/${testInfo.project.name}-${name}.png`,
    fullPage: true,
  });
};

/*
 * Every box drawn in a light colour on the page: a background whose
 * luminance is near white, on an element the visitor can see. In the dark
 * theme there is none, but the logo's own backdrop and what is inside it.
 */
const lightBoxes: (page: Page) => Promise<Array<string>> = async (
  page: Page,
): Promise<Array<string>> => {
  return page.evaluate((): Array<string> => {
    const RGB: RegExp =
      /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/;
    const linear: (channel: number) => number = (channel: number): number => {
      const value: number = channel / 255;
      return value <= 0.03928
        ? value / 12.92
        : Math.pow((value + 0.055) / 1.055, 2.4);
    };
    const found: Array<string> = [];

    for (const element of Array.from(document.querySelectorAll("body *"))) {
      if (element.closest("[data-ou-logo-plate]")) {
        continue;
      }

      const box: DOMRect = element.getBoundingClientRect();

      if (box.width < 4 || box.height < 4) {
        continue;
      }

      const style: CSSStyleDeclaration = getComputedStyle(element);

      if (style.visibility === "hidden" || style.display === "none") {
        continue;
      }

      const match: RegExpExecArray | null = RGB.exec(style.backgroundColor);

      if (!match) {
        continue;
      }

      const alpha: number = match[4] === undefined ? 1 : Number(match[4]);

      if (alpha < 0.5) {
        continue;
      }

      const luminance: number =
        0.2126 * linear(Number(match[1])) +
        0.7152 * linear(Number(match[2])) +
        0.0722 * linear(Number(match[3]));

      if (luminance > 0.8) {
        const testId: string | null = element.getAttribute("data-testid");
        found.push(
          `${element.tagName.toLowerCase()}${testId ? `[${testId}]` : ""} ${style.backgroundColor}`,
        );
      }
    }

    return found;
  });
};

// Each status text against the opaque ground behind it, as WCAG measures it.
const statusTextContrasts: (page: Page) => Promise<Array<number>> = async (
  page: Page,
): Promise<Array<number>> => {
  return page.evaluate((): Array<number> => {
    const RGB: RegExp =
      /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/;
    const parse: (value: string) => Array<number> | null = (
      value: string,
    ): Array<number> | null => {
      const match: RegExpExecArray | null = RGB.exec(value);

      if (!match) {
        return null;
      }

      return [
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
        match[4] === undefined ? 1 : Number(match[4]),
      ];
    };
    const luminance: (rgb: Array<number>) => number = (
      rgb: Array<number>,
    ): number => {
      const linear: (channel: number) => number = (channel: number): number => {
        const value: number = channel / 255;
        return value <= 0.03928
          ? value / 12.92
          : Math.pow((value + 0.055) / 1.055, 2.4);
      };

      return (
        0.2126 * linear(rgb[0]!) +
        0.7152 * linear(rgb[1]!) +
        0.0722 * linear(rgb[2]!)
      );
    };

    const contrasts: Array<number> = [];

    for (const element of Array.from(
      document.querySelectorAll("[data-ou-status-text]"),
    )) {
      const text: Array<number> | null = parse(getComputedStyle(element).color);
      let ground: Array<number> | null = null;
      let ancestor: Element | null = element;

      while (ancestor && !ground) {
        const candidate: Array<number> | null = parse(
          getComputedStyle(ancestor).backgroundColor,
        );

        if (candidate && candidate[3]! >= 0.95) {
          ground = candidate;
        }

        ancestor = ancestor.parentElement;
      }

      if (!text || !ground) {
        continue;
      }

      const first: number = luminance(text);
      const second: number = luminance(ground);

      contrasts.push(
        (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05),
      );
    }

    return contrasts;
  });
};

test.afterEach(async ({ page }: { page: Page }) => {
  const record: FixtureRecord | null = await page
    .evaluate((): FixtureRecord | null => {
      return window.__statusPageThemeFixture || null;
    })
    .catch((): null => {
      return null;
    });

  expect(record?.unexpected || []).toEqual([]);
});

test.describe("each theme, as a visitor first sees it", () => {
  test("Light is light, on a dark device too", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openPage(page, PAGE, "theme=Light");

    await expectScheme(page, "light");
    expect((await drawnPage(page)).canvas).toBe(LIGHT_CANVAS);
    await shoot(page, testInfo, "overview-light");
  });

  test("Dark is dark, on a light device too", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openPage(page, PAGE, "theme=Dark");

    await expectScheme(page, "dark");
    expect((await drawnPage(page)).canvas).toBe(DARK_CANVAS);
    await shoot(page, testInfo, "overview-dark");
  });

  test("System follows a dark device, and a light one", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openPage(page, PAGE, "theme=System");
    await expectScheme(page, "dark");
    await shoot(page, testInfo, "overview-system-dark");

    await page.emulateMedia({ colorScheme: "light" });
    await openPage(page, PAGE, "theme=System");
    await expectScheme(page, "light");
  });
});

test.describe("before the first paint", () => {
  const holdAndOpen: (
    page: Page,
    request: APIRequestContext,
    query: string,
  ) => Promise<void> = async (
    page: Page,
    request: APIRequestContext,
    query: string,
  ): Promise<void> => {
    // Tailwind and the app's bundle are held back by the fixture's server.
    await request.get("/hold");
    await page.goto(`${PAGE}?${query}`, { waitUntil: "commit" });
    await page.waitForFunction((): boolean => {
      return Boolean(document.documentElement.getAttribute("data-theme"));
    });
  };

  test.afterEach(async ({ request }: { request: APIRequestContext }) => {
    await request.get("/release");
  });

  test("a Dark page is dark with nothing but its HTML", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await holdAndOpen(page, request, "theme=Dark");

    const drawn: DrawnPage = await drawnPage(page);

    // Tailwind has not run, and the app has not started.
    expect(
      await page.evaluate((): boolean => {
        return "tailwind" in window;
      }),
    ).toBe(false);
    expect(await page.getByTestId("status-page-overview").count()).toBe(0);

    expect(drawn.htmlClass).toBe("dark");
    expect(drawn.dataTheme).toBe("dark");
    expect(drawn.colorScheme).toBe("dark");
    expect(drawn.themeColor).toBe("#0f172a");
    expect(drawn.canvas).toBe(DARK_CANVAS);
  });

  test("a System page on a dark device is dark with nothing but its HTML", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await holdAndOpen(page, request, "theme=System");

    const drawn: DrawnPage = await drawnPage(page);

    expect(drawn.setting).toBe("system");
    expect(drawn.dataTheme).toBe("dark");
    expect(drawn.canvas).toBe(DARK_CANVAS);
  });

  test("a System page keeps the visitor's own pick from an earlier visit, before anything loads", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/release");
    await page.evaluate((key: string): void => {
      window.localStorage.setItem(key, "dark");
    }, STORAGE_KEY);

    await holdAndOpen(page, request, "theme=System");

    expect((await drawnPage(page)).dataTheme).toBe("dark");
  });

  test("a page its server could not read is sent light, and drawn in its own theme once it loads", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openPage(page, PAGE, "theme=Dark&seoTheme=none");

    expect((await drawnPage(page)).setting).toBe("dark");
    await expectScheme(page, "dark");
  });
});

test.describe("a page that follows the visitor's device", () => {
  test("changes with the device while it is open", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openPage(page, PAGE, "theme=System");
    await expectScheme(page, "light");

    await page.emulateMedia({ colorScheme: "dark" });
    await expectScheme(page, "dark");

    await page.emulateMedia({ colorScheme: "light" });
    await expectScheme(page, "light");
  });

  test("offers the visitor a switch that their browser remembers", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openPage(page, PAGE, "theme=System");

    const toDark: Locator = page.getByRole("button", {
      name: "Switch to dark theme",
    });

    await expect(toDark).toBeVisible();
    await toDark.click();
    await expectScheme(page, "dark");
    expect(
      await page.evaluate((key: string): string | null => {
        return window.localStorage.getItem(key);
      }, STORAGE_KEY),
    ).toBe("dark");

    await page.getByTestId("status-page-theme-switch").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${SCREENSHOTS}/${testInfo.project.name}-footer-switch-dark.png`,
    });

    // Remembered on the next visit, whatever the device says.
    await openPage(page, PAGE, "theme=System");
    await expectScheme(page, "dark");

    // Back to what the device asks for: forgotten, and the device decides.
    await page.getByRole("button", { name: "Switch to light theme" }).click();
    await expectScheme(page, "light");
    expect(
      await page.evaluate((key: string): string | null => {
        return window.localStorage.getItem(key);
      }, STORAGE_KEY),
    ).toBeNull();

    await page.emulateMedia({ colorScheme: "dark" });
    await expectScheme(page, "dark");
  });

  test("sits beside the language switcher, in the footer's one row", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, PAGE, "theme=System");

    const themeSwitch: Locator = page.getByTestId("status-page-theme-switch");
    const language: Locator = page.getByRole("combobox", {
      name: "Switch language",
    });

    const switchBox: { y: number; height: number } | null =
      await themeSwitch.boundingBox();
    const languageBox: { y: number; height: number } | null =
      await language.boundingBox();

    expect(switchBox).not.toBeNull();
    expect(languageBox).not.toBeNull();

    // On one line: their middles within a few pixels of each other.
    expect(
      Math.abs(
        switchBox!.y +
          switchBox!.height / 2 -
          (languageBox!.y + languageBox!.height / 2),
      ),
    ).toBeLessThan(6);
  });
});

test.describe("the footer's controls for the visitor", () => {
  test("the light / dark switch is a target a thumb can hit", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, PAGE, "theme=System");

    const box: { width: number; height: number } | null = await page
      .getByTestId("status-page-theme-switch")
      .boundingBox();

    expect(box).not.toBeNull();
    // WCAG 2.2's 24px minimum; the switch is 28px around its 16px icon.
    expect(box!.width).toBeGreaterThanOrEqual(24);
    expect(box!.height).toBeGreaterThanOrEqual(24);
  });

  for (const theme of ["Light", "Dark", "System"]) {
    test(`${theme}: on a phone they sit centred, like every other entry of the footer`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openPage(page, PAGE, `theme=${theme}`);

      const controls: Locator = page.getByTestId(
        "status-page-footer-visitor-controls",
      );

      await controls.scrollIntoViewIfNeeded();

      // The middle of what the entry draws: the language switcher, and the switch.
      const middle: number = await controls.evaluate(
        (element: Element): number => {
          const boxes: Array<DOMRect> = Array.from(element.children)
            .map((child: Element): DOMRect => {
              return child.getBoundingClientRect();
            })
            .filter((box: DOMRect): boolean => {
              return box.width > 0;
            });

          const left: number = Math.min(
            ...boxes.map((box: DOMRect): number => {
              return box.left;
            }),
          );
          const right: number = Math.max(
            ...boxes.map((box: DOMRect): number => {
              return box.right;
            }),
          );

          return (left + right) / 2;
        },
      );

      expect(Math.abs(middle - 390 / 2)).toBeLessThanOrEqual(2);
    });
  }
});

test.describe("a Light or Dark page, on its own domain", () => {
  for (const theme of ["Light", "Dark"]) {
    test(`${theme} offers no switch, and the device does not move it`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.emulateMedia({ colorScheme: "light" });
      await openPage(page, OWN_DOMAIN, `theme=${theme}`);

      await expect(page.getByTestId("status-page-theme-switch")).toHaveCount(0);

      const scheme: Scheme = theme === "Dark" ? "dark" : "light";

      await expectScheme(page, scheme);
      await page.emulateMedia({
        colorScheme: scheme === "dark" ? "light" : "dark",
      });
      await expectScheme(page, scheme);
    });
  }
});

/*
 * At its OneUptime address - the Dashboard's preview, /status-page/<id> - a
 * Light or Dark page offers the footer's switch too, so its owner can see
 * it in the other theme, and its logo for the dark theme, without changing
 * what its visitors get. It opens in its own theme every time: the pick
 * lasts for the visit and is kept nowhere, not even as the pick that pages
 * following the device remember.
 */
test.describe("the Dashboard's preview of a Light or Dark page", () => {
  const PREVIEWS: Array<[string, Scheme, Scheme]> = [
    ["Light", "light", "dark"],
    ["Dark", "dark", "light"],
  ];

  const switchTo: (scheme: Scheme) => string = (scheme: Scheme): string => {
    return scheme === "dark" ? "Switch to dark theme" : "Switch to light theme";
  };

  const storedPick: (page: Page) => Promise<string | null> = async (
    page: Page,
  ): Promise<string | null> => {
    return page.evaluate((key: string): string | null => {
      return window.localStorage.getItem(key);
    }, STORAGE_KEY);
  };

  for (const [theme, own, other] of PREVIEWS) {
    test(`${theme}: the footer's switch shows it ${other}, and back, whatever the device`, async ({
      page,
    }: { page: Page }, testInfo: TestInfo) => {
      // A device set the other way does not move it, before or after.
      await page.emulateMedia({ colorScheme: other });
      await openPage(page, PAGE, `theme=${theme}`);
      await expectScheme(page, own);

      await page.getByRole("button", { name: switchTo(other) }).click();
      await expectScheme(page, other);
      expect(await storedPick(page)).toBeNull();

      await page.emulateMedia({ colorScheme: own });
      await expectScheme(page, other);
      await shoot(page, testInfo, `preview-${theme.toLowerCase()}-as-${other}`);

      await page.getByRole("button", { name: switchTo(own) }).click();
      await expectScheme(page, own);
      expect(await storedPick(page)).toBeNull();
    });

    test(`${theme}: opens in its own theme again on the next visit`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.emulateMedia({ colorScheme: "light" });
      await openPage(page, PAGE, `theme=${theme}`);
      await page.getByRole("button", { name: switchTo(other) }).click();
      await expectScheme(page, other);

      await openPage(page, PAGE, `theme=${theme}`);
      await expectScheme(page, own);
      expect(await storedPick(page)).toBeNull();
    });
  }

  test("the pick lasts while the owner moves around the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openPage(page, PAGE, "theme=Light");
    await page.getByRole("button", { name: switchTo("dark") }).click();
    await expectScheme(page, "dark");

    // On a phone the page's links are behind the navigation button.
    const navigation: Locator = page.getByRole("button", {
      name: "Navigation",
    });

    if (await navigation.isVisible()) {
      await navigation.click();
    }

    await page.getByRole("link", { name: "Incidents", exact: true }).click();
    await expect(
      page.getByText("Webhook deliveries are delayed", { exact: true }).first(),
    ).toBeVisible();
    await expectScheme(page, "dark");
  });

  test("a page that follows the device keeps the visitor's remembered pick there, as on its own domain", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openPage(page, PAGE, "theme=System");
    await page.getByRole("button", { name: switchTo("dark") }).click();
    await expectScheme(page, "dark");

    expect(await storedPick(page)).toBe("dark");
  });
});

test.describe("the dark theme on every surface", () => {
  // A surface, where it is, its page's query, and words it shows once drawn.
  const SURFACES: Array<[string, string, string, string]> = [
    ["overview", PAGE, "theme=Dark", "Core services"],
    [
      "incidents",
      `${PAGE}/incidents`,
      "theme=Dark",
      "Webhook deliveries are delayed",
    ],
    ["incident", INCIDENT, "theme=Dark", "Webhook deliveries are delayed"],
    ["announcement", ANNOUNCEMENT, "theme=Dark", "New EU region"],
    [
      "scheduled-events",
      `${PAGE}/scheduled-events`,
      "theme=Dark",
      "Database upgrade",
    ],
    ["maintenance", MAINTENANCE, "theme=Dark", "Database upgrade"],
    [
      "subscribe",
      `${PAGE}/subscribe/email`,
      "theme=Dark",
      "Subscribe by Email",
    ],
    ["sign-in", `${PAGE}/login`, "theme=Dark&private=1&sso=1", "Welcome back!"],
    ["sso", `${PAGE}/sso`, "theme=Dark&private=1&sso=1", "Acme Okta"],
    ["not-found", `${PAGE}/no-such-page`, "theme=Dark", "Page not found."],
  ];

  for (const [name, path, query, words] of SURFACES) {
    test(`${name}: no light box anywhere`, async ({
      page,
    }: { page: Page }, testInfo: TestInfo) => {
      await openPage(page, path, query, "");
      await expect(
        page.getByText(words, { exact: true }).first(),
      ).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expectScheme(page, "dark");

      expect(await lightBoxes(page)).toEqual([]);
      await shoot(page, testInfo, `${name}-dark`);
    });
  }

  test("status text reads at 4.5:1 on its ground", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, PAGE, "theme=Dark");

    const contrasts: Array<number> = await statusTextContrasts(page);

    // The resources' statuses, the groups' rollups and the grid's cells.
    expect(contrasts.length).toBeGreaterThan(5);

    for (const contrast of contrasts) {
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("the very dark red of a long outage has an edge that stands out from the card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, PAGE, "theme=Dark");

    const edged: Locator = page.locator("[data-ou-bar-edge]");

    expect(await edged.count()).toBeGreaterThan(0);

    const shadows: Array<string> = await edged.evaluateAll(
      (bars: Array<Element>): Array<string> => {
        return bars.map((bar: Element): string => {
          return getComputedStyle(bar).boxShadow;
        });
      },
    );

    for (const shadow of shadows) {
      expect(shadow).toContain("inset");
      expect(shadow).not.toBe("none");
    }

    // The same bars carry no edge on the light page.
    await openPage(page, PAGE, "theme=Light");
    const lightShadow: string = await page
      .locator("[data-ou-bar-edge]")
      .first()
      .evaluate((bar: Element): string => {
        return getComputedStyle(bar).boxShadow;
      });

    expect(lightShadow).toBe("none");
  });

  test("the cards are the dark card, under light text", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, PAGE, "theme=Dark");

    const card: Locator = page.locator("#status-page-description");

    expect(
      await card.evaluate((element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      }),
    ).toBe(DARK_CARD);
  });
});

test.describe("the logo", () => {
  const plateOf: (page: Page) => Promise<string> = async (
    page: Page,
  ): Promise<string> => {
    return page
      .locator("#status-page-logo")
      .evaluate((element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      });
  };

  test("sits on a light backdrop on the dark page of a page that follows the device", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openPage(page, PAGE, "theme=System");

    expect(await plateOf(page)).toBe("rgb(248, 250, 252)");
    await page.locator("#status-page-logo").screenshot({
      path: `${SCREENSHOTS}/${testInfo.project.name}-logo-plate.png`,
    });

    // And on nothing on its light page.
    await page.emulateMedia({ colorScheme: "light" });
    await expectScheme(page, "light");
    expect(await plateOf(page)).toBe("rgba(0, 0, 0, 0)");
  });

  test("sits on the backdrop on a Dark page too, whatever the device: the one logo is made for light", async ({
    page,
  }: {
    page: Page;
  }) => {
    /*
     * The page's one logo is the light page's and the emails' too, so a
     * Dark page puts it on the backdrop as well: its owner has nothing to
     * change, and nothing to break in their emails.
     */
    await page.emulateMedia({ colorScheme: "light" });
    await openPage(page, PAGE, "theme=Dark");

    expect(await plateOf(page)).toBe("rgb(248, 250, 252)");
  });

  test("sits on nothing on a Light page, on a dark device too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openPage(page, OWN_DOMAIN, "theme=Light");

    expect(await plateOf(page)).toBe("rgba(0, 0, 0, 0)");
    await expect(page.locator("[data-ou-logo-plate]")).toHaveCount(0);
  });

  test("on the Dashboard's preview of a Light page: on nothing, then on the backdrop once switched dark", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openPage(page, PAGE, "theme=Light");

    expect(await plateOf(page)).toBe("rgba(0, 0, 0, 0)");

    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await expectScheme(page, "dark");

    expect(await plateOf(page)).toBe("rgb(248, 250, 252)");
  });

  test("sits on the backdrop on a sign-in page too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openPage(page, `${PAGE}/login`, "theme=System&private=1", "");
    await expectScheme(page, "dark");

    const plate: Locator = page.locator("[data-ou-logo-plate]");

    await expect(plate).toHaveCount(1);
    expect(
      await plate.evaluate((element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      }),
    ).toBe("rgb(248, 250, 252)");
  });
});

/*
 * A logo made for the dark theme (Branding's Dark Theme Logo): light
 * lettering (Fixture/logo-dark.svg) where the logo is dark lettering. While
 * the page is dark it is drawn instead of the logo, as it is, on nothing;
 * while it is light the logo is drawn, as before.
 */
test.describe("a logo made for the dark theme", () => {
  interface DrawnLogo {
    // Which logo LogoPlate drew: "light" (the logo) or "dark".
    variant: string | null;
    // The lettering of the image that is drawn: "dark" (#111827) or "light".
    lettering: string;
    backdrop: string;
  }

  // What the header draws, read from the image's own bytes.
  const headerLogo: (page: Page) => Promise<DrawnLogo> = async (
    page: Page,
  ): Promise<DrawnLogo> => {
    return page
      .locator("#status-page-logo")
      .evaluate(async (element: Element): Promise<DrawnLogo> => {
        const image: HTMLImageElement | null = element.querySelector("img");
        const svg: string = image ? await (await fetch(image.src)).text() : "";

        return {
          variant: element.getAttribute("data-ou-logo-variant"),
          lettering: svg.includes('fill="#f8fafc"')
            ? "light"
            : svg.includes('fill="#111827"')
              ? "dark"
              : "none",
          backdrop: getComputedStyle(element).backgroundColor,
        };
      });
  };

  const DARK_LOGO_DRAWN: DrawnLogo = {
    variant: "dark",
    lettering: "light",
    backdrop: "rgba(0, 0, 0, 0)",
  };

  test("is the logo of a Dark page, on nothing, whatever the device", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openPage(page, OWN_DOMAIN, "theme=Dark&darkLogo=1");

    await expect
      .poll(async (): Promise<DrawnLogo> => {
        return headerLogo(page);
      })
      .toEqual(DARK_LOGO_DRAWN);
    await expect(page.locator("[data-ou-logo-plate]")).toHaveCount(0);
    await page.locator("#status-page-logo").screenshot({
      path: `${SCREENSHOTS}/${testInfo.project.name}-dark-theme-logo.png`,
    });
  });

  test("takes turns with the logo on a page that follows the device, live", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openPage(page, PAGE, "theme=System&darkLogo=1");

    await expect
      .poll(async (): Promise<DrawnLogo> => {
        return headerLogo(page);
      })
      .toEqual(DARK_LOGO_DRAWN);

    await page.emulateMedia({ colorScheme: "light" });
    await expectScheme(page, "light");
    await expect
      .poll(async (): Promise<DrawnLogo> => {
        return headerLogo(page);
      })
      .toEqual({
        variant: "light",
        lettering: "dark",
        backdrop: "rgba(0, 0, 0, 0)",
      });

    await page.emulateMedia({ colorScheme: "dark" });
    await expect
      .poll(async (): Promise<DrawnLogo> => {
        return headerLogo(page);
      })
      .toEqual(DARK_LOGO_DRAWN);
  });

  test("is not drawn on a Light page, on a dark device too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openPage(page, OWN_DOMAIN, "theme=Light&darkLogo=1");

    await expect
      .poll(async (): Promise<DrawnLogo> => {
        return headerLogo(page);
      })
      .toEqual({
        variant: "light",
        lettering: "dark",
        backdrop: "rgba(0, 0, 0, 0)",
      });
  });

  test("is what the Dashboard's preview of a Light page shows once switched dark", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openPage(page, PAGE, "theme=Light&darkLogo=1");
    expect((await headerLogo(page)).variant).toBe("light");

    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await expectScheme(page, "dark");
    await expect
      .poll(async (): Promise<DrawnLogo> => {
        return headerLogo(page);
      })
      .toEqual(DARK_LOGO_DRAWN);
    await shoot(page, testInfo, "preview-light-as-dark-with-dark-theme-logo");
  });

  test("is the sign-in page's logo while it is dark, from its own address", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openPage(
      page,
      `${PAGE}/login`,
      "theme=System&private=1&darkLogo=1",
      "",
    );
    await expectScheme(page, "dark");

    const image: Locator = page.locator("[data-ou-logo-variant] img");

    await expect(image).toHaveCount(1);
    await expect(image).toHaveAttribute(
      "src",
      /\/status-page-api\/dark-theme-logo\/00000000-0000-4000-8000-000000000001$/,
    );
    await expect(page.locator("[data-ou-logo-variant]")).toHaveAttribute(
      "data-ou-logo-variant",
      "dark",
    );
    await expect(page.locator("[data-ou-logo-plate]")).toHaveCount(0);
    await expect
      .poll(async (): Promise<number> => {
        return image.evaluate((element: Element): number => {
          return (element as HTMLImageElement).naturalWidth;
        });
      })
      .toBeGreaterThan(0);

    // Light again: the logo, from its own address.
    await page.emulateMedia({ colorScheme: "light" });
    await expectScheme(page, "light");
    await expect(image).toHaveAttribute(
      "src",
      /\/status-page-api\/logo\/00000000-0000-4000-8000-000000000001$/,
    );
  });
});

/*
 * The SSO page, while it lists the page's providers (#4911 follow-up): under
 * them, "or" and Log in with password, back to the email and password form,
 * as the sign-in page offers Log in with SSO the other way.
 */
test.describe("the SSO page", () => {
  test("offers the way back to the password form under its providers", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openPage(page, `${PAGE}/sso`, "theme=System&private=1&sso=1", "");
    await expect(page.getByText("Acme Okta", { exact: true })).toBeVisible();

    const back: Locator = page.getByRole("link", {
      name: "Log in with password",
    });

    await expect(back).toBeVisible();
    await expect(page.getByTestId("sign-in-options-divider")).toBeVisible();

    // Under the providers, as wide as they are.
    const provider: { y: number; width: number } | null = await page
      .getByText("Acme Okta", { exact: true })
      .boundingBox();
    const link: { y: number } | null = await back.boundingBox();

    expect(provider).not.toBeNull();
    expect(link).not.toBeNull();
    expect(link!.y).toBeGreaterThan(provider!.y);

    // The provider's card and the link line up, edge to edge.
    const card: { x: number; width: number } | null = await page
      .getByText("Acme Okta", { exact: true })
      .locator("xpath=ancestor::div[contains(@class, 'rounded-lg')][1]")
      .boundingBox();
    const linkBox: { x: number; width: number } | null =
      await back.boundingBox();

    expect(card).not.toBeNull();
    expect(Math.abs(card!.x - linkBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(card!.width - linkBox!.width)).toBeLessThanOrEqual(1);
    await shoot(page, testInfo, "sso-light");

    await back.click();
    await expect(
      page.getByText("Welcome back!", { exact: true }),
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`${PAGE}/login`);
  });
});

test("nothing scrolls sideways on a phone in the dark theme", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ colorScheme: "dark" });
  await openPage(page, PAGE, "theme=System");

  expect(
    await page.evaluate((): boolean => {
      return (
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth
      );
    }),
  ).toBe(true);
});

/*
 * The overall status banner ("Some Resources are Offline"), filled with the
 * colour the page's owner gave the status. Its words were white whatever the
 * fill - 3:1 on the default Offline red, 1.6:1 on the Degraded yellow, 2.6:1
 * on the Operational green - the one sentence every visitor reads first. They now take the
 * colour that reads on the fill, at 4.5:1, the same in both themes.
 */
test.describe("the overall status banner's words read on the status colour", () => {
  const bannerColours: (
    page: Page,
  ) => Promise<{ text: string; ground: string; contrast: number }> = async (
    page: Page,
  ): Promise<{ text: string; ground: string; contrast: number }> => {
    return page
      .locator("#overview-alert")
      .evaluate(
        (
          element: Element,
        ): { text: string; ground: string; contrast: number } => {
          const RGB: RegExp = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/;
          const parse: (value: string) => Array<number> = (
            value: string,
          ): Array<number> => {
            const match: RegExpExecArray | null = RGB.exec(value);

            return match
              ? [Number(match[1]), Number(match[2]), Number(match[3])]
              : [0, 0, 0];
          };
          const linear: (channel: number) => number = (
            channel: number,
          ): number => {
            const value: number = channel / 255;
            return value <= 0.03928
              ? value / 12.92
              : Math.pow((value + 0.055) / 1.055, 2.4);
          };
          const luminance: (rgb: Array<number>) => number = (
            rgb: Array<number>,
          ): number => {
            return (
              0.2126 * linear(rgb[0]!) +
              0.7152 * linear(rgb[1]!) +
              0.0722 * linear(rgb[2]!)
            );
          };

          // The words as drawn: the banner's message, where its sentence is.
          const message: Element =
            element.querySelector(".alert-message") || element;
          const text: string = getComputedStyle(message).color;
          const ground: string = getComputedStyle(element).backgroundColor;
          const first: number = luminance(parse(text));
          const second: number = luminance(parse(ground));

          return {
            text,
            ground,
            contrast:
              (Math.max(first, second) + 0.05) /
              (Math.min(first, second) + 0.05),
          };
        },
      );
  };

  for (const theme of ["Light", "Dark"]) {
    test(`on a ${theme} page, at 4.5:1 and not white where white did not read`, async ({
      page,
    }: { page: Page }, testInfo: TestInfo) => {
      await openPage(page, PAGE, `theme=${theme}`);

      const banner: Locator = page.locator("#overview-alert");

      await expect(banner).toBeVisible();

      const colours: { text: string; ground: string; contrast: number } =
        await bannerColours(page);

      expect(colours.contrast).toBeGreaterThanOrEqual(4.5);
      /*
       * The fixture's page has a resource offline: the default Offline red,
       * on which white was 3:1 - so its words are a deep red now.
       */
      expect(colours.ground).toBe("rgb(253, 98, 94)");
      expect(colours.text).not.toBe("rgb(255, 255, 255)");

      await banner.screenshot({
        path: `${SCREENSHOTS}/${testInfo.project.name}-banner-${theme.toLowerCase()}.png`,
      });
    });
  }

  test("the same banner in both themes: the owner's colour, and the words on it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, PAGE, "theme=Light");
    const light: { text: string; ground: string } = await bannerColours(page);

    await openPage(page, PAGE, "theme=Dark");
    const dark: { text: string; ground: string } = await bannerColours(page);

    expect(dark.ground).toBe(light.ground);
    expect(dark.text).toBe(light.text);
  });
});
