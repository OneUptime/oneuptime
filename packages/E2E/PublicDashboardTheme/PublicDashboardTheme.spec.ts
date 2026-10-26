import {
  APIRequestContext,
  expect,
  Locator,
  Page,
  test,
  TestInfo,
} from "@playwright/test";

/*
 * A public dashboard's theme, in a real browser, on the real public
 * dashboard: its own index.ejs rendered as its servers render it and its own
 * app (App/FeatureSet/PublicDashboard/src/Index.tsx), with only the public
 * dashboard API answered from fixture data (PublicDashboardTheme/Fixture).
 * See README.md.
 *
 *   - Light and Dark are what they say; System follows the device's
 *     prefers-color-scheme, live. A dashboard made before the setting is the
 *     light page it always was.
 *   - The theme is applied before the first paint: with Tailwind and the app
 *     held back, the page is already in its scheme - the link's own theme
 *     and the visitor's kept pick included.
 *   - Every visitor has a Light / Dark / Auto menu in the toolbar, kept in
 *     their browser for every public dashboard of the address; Auto goes
 *     back to the dashboard's own theme. A link with ?theme= wins over all
 *     of it, offers no menu, and holds through the password prompt and back.
 *   - The password prompt is drawn in the dashboard's theme; Access Denied
 *     and not found show nothing of a dashboard and follow the visitor.
 *   - Every widget kind, on eight boards, is right in the dark theme: no
 *     light box but the logo's backdrop, every text at 4.5:1 (3:1 when
 *     large), the HTML widget transparent; and so are the empty states and
 *     the toolbar's menus and time range picker.
 *
 * Screenshots of every board in both themes, and of the prompt and the
 * error pages, are saved for review under
 * output/playwright/public-dashboard-theme-ui.
 */

interface FixtureRecord {
  requests: Array<string>;
  unexpected: Array<string>;
}

declare global {
  interface Window {
    __publicDashboardThemeFixture: FixtureRecord;
  }
}

type DashboardKey =
  | "light"
  | "dark"
  | "system"
  | "unset"
  | "lightPassword"
  | "darkPassword"
  | "systemPassword"
  | "forbidden"
  | "missing";

const dashboardId: (value: number) => string = (value: number): string => {
  return `da000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
};

// The fixture's dashboards (Fixture/Scenarios.js).
const DASHBOARDS: Record<DashboardKey, string> = {
  light: dashboardId(1),
  dark: dashboardId(2),
  system: dashboardId(3),
  unset: dashboardId(4),
  lightPassword: dashboardId(11),
  darkPassword: dashboardId(12),
  systemPassword: dashboardId(13),
  forbidden: dashboardId(21),
  missing: dashboardId(31),
};

const PASSWORD: string = "open sesame";

// "enter the password", "Enter password", in any case: the prompt's ask.
const ENTER_THE_PASSWORD: RegExp = /enter (the )?password/i;

const STORAGE_KEY: string = "oneuptime-public-dashboard-theme";

const LIGHT_CANVAS: string = "rgb(249, 250, 251)";
const DARK_CANVAS: string = "rgb(15, 23, 42)";

const BOARDS: Array<string> = [
  "kubernetes",
  "host",
  "slo",
  "network",
  "lists",
  "containers",
  "infrastructure",
  "other",
];

const SCREENSHOTS: string = "../../output/playwright/public-dashboard-theme-ui";

type Scheme = "light" | "dark";

type Ready = "dashboard" | "prompt" | "forbidden" | "missing" | "none";

const pathOf: (key: DashboardKey) => string = (key: DashboardKey): string => {
  return `/public-dashboard/${DASHBOARDS[key]}`;
};

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
      setting: root.getAttribute("data-public-dashboard-theme"),
      /*
       * What the visitor sees behind everything: the body's ground, or,
       * while the parser is still in <head>, the page's own.
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

const readyLocator: (page: Page, ready: Ready) => Locator | null = (
  page: Page,
  ready: Ready,
): Locator | null => {
  switch (ready) {
    case "dashboard":
      return page.getByTestId("public-dashboard-powered-by");
    case "prompt":
      return page.getByRole("button", { name: "Unlock Dashboard" });
    case "forbidden":
      return page.getByText("Access Denied", { exact: true });
    case "missing":
      return page.getByText("Dashboard Not Found", { exact: true });
    default:
      return null;
  }
};

// Until the widgets have asked for everything they will ask for.
const settle: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  let last: number = -1;

  await expect
    .poll(
      async (): Promise<boolean> => {
        const count: number = await page.evaluate((): number => {
          return window.__publicDashboardThemeFixture?.requests.length || 0;
        });
        const isSettled: boolean = count === last;

        last = count;

        return isSettled;
      },
      { intervals: [400, 400, 600, 800, 1000] },
    )
    .toBe(true);
};

const openDashboard: (
  page: Page,
  key: DashboardKey,
  query?: string,
  ready?: Ready,
) => Promise<void> = async (
  page: Page,
  key: DashboardKey,
  query: string = "",
  ready: Ready = "dashboard",
): Promise<void> => {
  await page.goto(`${pathOf(key)}${query ? `?${query}` : ""}`);

  const locator: Locator | null = readyLocator(page, ready);

  if (locator) {
    await expect(locator).toBeVisible();
  }

  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });

  if (ready === "dashboard") {
    await settle(page);
  }
};

const kept: (page: Page) => Promise<string | null> = async (
  page: Page,
): Promise<string | null> => {
  return page.evaluate((key: string): string | null => {
    return window.localStorage.getItem(key);
  }, STORAGE_KEY);
};

const themeMenu: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("public-dashboard-theme-menu");
};

/*
 * A press on a control of the dashboard's toolbar, as the visitor makes it.
 *
 * The dashboard's board keeps its 1000px on a phone and scrolls sideways in
 * its own frame (DashboardViewLayout); the toolbar fits the screen. A
 * control the visitor scrolls to is where Playwright's own click cannot
 * reach it: in the phone emulation (isMobile) the browser scrolls the
 * visual viewport, not the page, and Playwright's check of what is under
 * the pointer then looks at the wrong place. So on the phone the control
 * is scrolled to, must be visible and enabled, and gets the click a tap
 * ends in; at 1280 it is Playwright's real click.
 */
const press: (control: Locator) => Promise<void> = async (
  control: Locator,
): Promise<void> => {
  if (!test.info().project.use.isMobile) {
    await control.click();
    return;
  }

  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  await control.dispatchEvent("click");
};

const pickTheme: (
  page: Page,
  choice: "light" | "dark" | "auto",
) => Promise<void> = async (
  page: Page,
  choice: "light" | "dark" | "auto",
): Promise<void> => {
  await press(page.getByTestId("public-dashboard-theme-menu-button"));
  await press(page.getByTestId(`public-dashboard-theme-menu-${choice}`));
  await expect(themeMenu(page)).toHaveAttribute("data-visitor-choice", choice);
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
 * Every box drawn in a light colour on the page: an opaque background whose
 * luminance is past mid-grey, on an element the visitor can see that is big
 * enough to be a box. The logo's backdrop - light on purpose, the logo is
 * made for a light page - and thin marks (a progress bar's fill) are not.
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

      if (box.width < 24 || box.height < 12) {
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

      if (luminance > 0.5) {
        const testId: string | null = element.getAttribute("data-testid");
        found.push(
          `${element.tagName.toLowerCase()}${testId ? `[${testId}]` : ""} ${style.backgroundColor} ${Math.round(box.width)}x${Math.round(box.height)}`,
        );
      }
    }

    return found;
  });
};

/*
 * Every visible text against the opaque ground behind it, as WCAG measures
 * it: the texts below 4.5:1, or 3:1 for large text (24px, or 18.66px bold).
 * Chart drawings (SVG) carry their own colours and are left out.
 */
const lowContrastTexts: (page: Page) => Promise<Array<string>> = async (
  page: Page,
): Promise<Array<string>> => {
  return page.evaluate((): Array<string> => {
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
    const groundOf: (element: Element) => Array<number> | null = (
      element: Element,
    ): Array<number> | null => {
      let ancestor: Element | null = element;

      while (ancestor) {
        const ground: Array<number> | null = parse(
          getComputedStyle(ancestor).backgroundColor,
        );

        if (ground && ground[3]! > 0.5) {
          return ground;
        }

        ancestor = ancestor.parentElement;
      }

      return parse(getComputedStyle(document.documentElement).backgroundColor);
    };

    const found: Array<string> = [];

    for (const element of Array.from(document.querySelectorAll("body *"))) {
      if (element.closest("svg")) {
        continue;
      }

      const hasText: boolean = Array.from(element.childNodes).some(
        (node: ChildNode): boolean => {
          return (
            node.nodeType === Node.TEXT_NODE &&
            (node.textContent || "").trim().length > 0
          );
        },
      );

      if (!hasText) {
        continue;
      }

      const style: CSSStyleDeclaration = getComputedStyle(element);
      const box: DOMRect = element.getBoundingClientRect();

      if (
        style.visibility === "hidden" ||
        style.display === "none" ||
        box.width < 1 ||
        box.height < 1
      ) {
        continue;
      }

      const text: Array<number> | null = parse(style.color);
      const ground: Array<number> | null = groundOf(element);

      if (!text || !ground) {
        continue;
      }

      const lighter: number = Math.max(luminance(text), luminance(ground));
      const darker: number = Math.min(luminance(text), luminance(ground));
      const ratio: number = (lighter + 0.05) / (darker + 0.05);
      const size: number = parseFloat(style.fontSize);
      const isLarge: boolean =
        size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);

      if (ratio < (isLarge ? 3 : 4.5)) {
        found.push(
          `${ratio.toFixed(2)} "${(element.textContent || "").trim().slice(0, 40)}" ${style.color} on rgb(${ground.slice(0, 3).join(", ")})`,
        );
      }
    }

    return found;
  });
};

/*
 * How light an element's pixels are, on average, in its lower third - for
 * an element whose own drawing the page cannot read (the HTML widget's
 * sandboxed frame). Its screenshot is decoded in the page.
 */
const lowerThirdLuminance: (
  page: Page,
  locator: Locator,
) => Promise<number> = async (
  page: Page,
  locator: Locator,
): Promise<number> => {
  const png: Buffer = await locator.screenshot();

  return page.evaluate(async (base64: string): Promise<number> => {
    const image: HTMLImageElement = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();

    const canvas: HTMLCanvasElement = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;

    const context: CanvasRenderingContext2D = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);

    const top: number = Math.floor((image.height * 2) / 3);
    const pixels: Uint8ClampedArray = context.getImageData(
      0,
      top,
      image.width,
      image.height - top,
    ).data;

    let total: number = 0;
    let count: number = 0;

    for (let index: number = 0; index < pixels.length; index += 4) {
      total +=
        (0.2126 * pixels[index]! +
          0.7152 * pixels[index + 1]! +
          0.0722 * pixels[index + 2]!) /
        255;
      count++;
    }

    return count ? total / count : 0;
  }, png.toString("base64"));
};

test.beforeEach(async ({ page }: { page: Page }) => {
  // The fixture's own settings (board, data) are kept per tab: start clean.
  await page.goto("/release");
  await page.evaluate((): void => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  const record: FixtureRecord | undefined = await page
    .evaluate((): FixtureRecord | undefined => {
      return window.__publicDashboardThemeFixture;
    })
    .catch((): undefined => {
      return undefined;
    });

  // Every request the app made is one the fixture models.
  expect(record?.unexpected || []).toEqual([]);
});

test.describe("each theme, as a visitor first sees it", () => {
  test("Light is light, on a dark device", async ({ page }: { page: Page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openDashboard(page, "light");

    await expectScheme(page, "light");
    expect((await drawnPage(page)).setting).toBe("light");
  });

  test("Dark is dark, on a light device", async ({ page }: { page: Page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openDashboard(page, "dark");

    await expectScheme(page, "dark");
    expect((await drawnPage(page)).canvas).toBe(DARK_CANVAS);
  });

  test("System follows a dark device, and a light one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openDashboard(page, "system");
    await expectScheme(page, "dark");

    await page.emulateMedia({ colorScheme: "light" });
    await openDashboard(page, "system");
    await expectScheme(page, "light");
  });

  test("a dashboard made before the setting is the light page it always was, on a dark device", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openDashboard(page, "unset");

    await expectScheme(page, "light");
    expect((await drawnPage(page)).canvas).toBe(LIGHT_CANVAS);
  });
});

test.describe("before the first paint", () => {
  const holdAndOpen: (
    page: Page,
    request: APIRequestContext,
    address: string,
  ) => Promise<void> = async (
    page: Page,
    request: APIRequestContext,
    address: string,
  ): Promise<void> => {
    // Tailwind and the app's bundle are held back by the fixture's server.
    await request.get("/hold");
    await page.goto(address, { waitUntil: "commit" });
    await page.waitForFunction((): boolean => {
      return Boolean(document.documentElement.getAttribute("data-theme"));
    });
  };

  const isAppRunning: (page: Page) => Promise<boolean> = async (
    page: Page,
  ): Promise<boolean> => {
    return page.evaluate((): boolean => {
      return "tailwind" in window || "__publicDashboardThemeFixture" in window;
    });
  };

  test.afterEach(async ({ request }: { request: APIRequestContext }) => {
    await request.get("/release");
  });

  test("a Dark dashboard is dark with nothing but its HTML, on a light device", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await holdAndOpen(page, request, pathOf("dark"));

    // Tailwind has not run, and the app has not started.
    expect(await isAppRunning(page)).toBe(false);

    const drawn: DrawnPage = await drawnPage(page);

    expect(drawn.htmlClass).toBe("dark");
    expect(drawn.dataTheme).toBe("dark");
    expect(drawn.colorScheme).toBe("dark");
    expect(drawn.themeColor).toBe("#0f172a");
    expect(drawn.canvas).toBe(DARK_CANVAS);
  });

  test("a System dashboard on a dark device is dark with nothing but its HTML", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await holdAndOpen(page, request, pathOf("system"));

    expect(await isAppRunning(page)).toBe(false);

    const drawn: DrawnPage = await drawnPage(page);

    expect(drawn.setting).toBe("system");
    expect(drawn.dataTheme).toBe("dark");
    expect(drawn.canvas).toBe(DARK_CANVAS);
  });

  test("the visitor's pick from an earlier visit is drawn before anything loads, on any dashboard", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate((key: string): void => {
      window.localStorage.setItem(key, "dark");
    }, STORAGE_KEY);

    await holdAndOpen(page, request, pathOf("light"));

    expect(await isAppRunning(page)).toBe(false);
    expect((await drawnPage(page)).dataTheme).toBe("dark");
    expect((await drawnPage(page)).canvas).toBe(DARK_CANVAS);
  });

  test("a link's own theme is drawn before anything loads, over the dashboard's and the visitor's", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate((key: string): void => {
      window.localStorage.setItem(key, "light");
    }, STORAGE_KEY);

    await holdAndOpen(page, request, `${pathOf("light")}?theme=dark`);

    expect(await isAppRunning(page)).toBe(false);
    expect((await drawnPage(page)).dataTheme).toBe("dark");
  });

  test("a dashboard its server could not read is sent following the visitor, and drawn in its own theme once it loads", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`${pathOf("dark")}?seoTheme=none`);

    await expect(readyLocator(page, "dashboard")!).toBeVisible();
    expect((await drawnPage(page)).setting).toBe("dark");
    await expectScheme(page, "dark");
  });
});

test.describe("a dashboard that follows the visitor's device", () => {
  test("changes with the device while it is open", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openDashboard(page, "system");
    await expectScheme(page, "light");

    await page.emulateMedia({ colorScheme: "dark" });
    await expectScheme(page, "dark");

    await page.emulateMedia({ colorScheme: "light" });
    await expectScheme(page, "light");
  });

  test("a Light or Dark dashboard does not change with the device", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openDashboard(page, "dark");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.emulateMedia({ colorScheme: "light" });
    await expectScheme(page, "dark");
  });
});

test.describe("the visitor's theme menu", () => {
  test("offers Light, Dark and Auto, with Auto in use until the visitor picks", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openDashboard(page, "light");

    await expect(themeMenu(page)).toHaveAttribute(
      "data-visitor-choice",
      "auto",
    );
    await expect(themeMenu(page)).toHaveAttribute("data-color-scheme", "light");

    const button: Locator = page.getByTestId(
      "public-dashboard-theme-menu-button",
    );

    await expect(button).toHaveAccessibleName("Theme");
    await press(button);

    const items: Locator = page.getByRole("menuitemradio");

    await expect(items).toHaveText(["Light", "Dark", "Auto"]);
    await expect(
      page.getByRole("menuitemradio", { name: "Auto" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  test("Dark turns a Light dashboard dark, is kept, and holds after a reload and on another dashboard of the address", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openDashboard(page, "light");
    await pickTheme(page, "dark");

    await expectScheme(page, "dark");
    expect(await kept(page)).toBe("dark");

    await page.reload();
    await expect(readyLocator(page, "dashboard")!).toBeVisible();
    await expectScheme(page, "dark");
    await expect(themeMenu(page)).toHaveAttribute(
      "data-visitor-choice",
      "dark",
    );

    // Every public dashboard on this address: a System one on a light device.
    await openDashboard(page, "system");
    await expectScheme(page, "dark");
  });

  test("Light turns a Dark dashboard light", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openDashboard(page, "dark");
    await pickTheme(page, "light");

    await expectScheme(page, "light");
    expect(await kept(page)).toBe("light");
  });

  test("Auto forgets the pick: the dashboard's own theme decides again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openDashboard(page, "system");
    await pickTheme(page, "light");
    await expectScheme(page, "light");

    await pickTheme(page, "auto");

    await expectScheme(page, "dark");
    expect(await kept(page)).toBeNull();

    // And it follows the device again.
    await page.emulateMedia({ colorScheme: "light" });
    await expectScheme(page, "light");
  });

  test("works from the keyboard", async ({ page }: { page: Page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openDashboard(page, "light");

    await page.getByTestId("public-dashboard-theme-menu-button").focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("menuitemradio", { name: "Light" }),
    ).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("menuitemradio", { name: "Dark" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");

    await expectScheme(page, "dark");
    expect(await kept(page)).toBe("dark");
  });

  test("draws each choice with its icon, ticks the one in use at the right end of its row, and Auto says what it gives", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    // A Dark dashboard, turned light by this visitor.
    await page.emulateMedia({ colorScheme: "light" });
    await openDashboard(page, "dark");
    await pickTheme(page, "light");
    await press(page.getByTestId("public-dashboard-theme-menu-button"));

    const rows: Array<{
      choice: string;
      icon: boolean;
      tick: boolean;
      tickAfterName: boolean;
      tickAtRowEnd: boolean;
    }> = await page.evaluate(() => {
      return ["light", "dark", "auto"].map((choice: string) => {
        const row: Element = document.querySelector(
          `[data-testid="public-dashboard-theme-menu-${choice}"]`,
        )!;
        const icon: Element | null = row.querySelector("svg");
        const tick: Element | null = row.querySelector(
          `[data-testid="public-dashboard-theme-menu-${choice}-check"]`,
        );
        const rowBox: DOMRect = row.getBoundingClientRect();
        const iconBox: DOMRect | null = icon
          ? icon.getBoundingClientRect()
          : null;
        const tickBox: DOMRect | null = tick
          ? tick.getBoundingClientRect()
          : null;
        const name: Element | null = row.querySelector(".font-medium");
        const nameBox: DOMRect | null = name
          ? name.getBoundingClientRect()
          : null;

        return {
          choice,
          // Its own icon, ahead of its name, drawn at the icons' size.
          icon: Boolean(
            iconBox &&
              nameBox &&
              iconBox.width >= 14 &&
              iconBox.right <= nameBox.left,
          ),
          tick: Boolean(tick),
          tickAfterName: Boolean(
            tickBox && nameBox && tickBox.left >= nameBox.left + 20,
          ),
          tickAtRowEnd: Boolean(tickBox && rowBox.right - tickBox.right < 24),
        };
      });
    });

    expect(rows).toEqual([
      {
        choice: "light",
        icon: true,
        tick: true,
        tickAfterName: true,
        tickAtRowEnd: true,
      },
      {
        choice: "dark",
        icon: true,
        tick: false,
        tickAfterName: false,
        tickAtRowEnd: false,
      },
      {
        choice: "auto",
        icon: true,
        tick: false,
        tickAfterName: false,
        tickAtRowEnd: false,
      },
    ]);
    await expect(
      page.getByRole("menuitemradio", { name: "Light" }),
    ).toHaveAttribute("aria-checked", "true");

    await shoot(page, testInfo, "theme-menu-picked");

    // Resting on Auto says what it turns this dashboard into: its own Dark.
    if (!test.info().project.use.isMobile) {
      await page.getByRole("menuitemradio", { name: "Auto" }).hover();
      await expect(page.getByRole("tooltip")).toHaveText(
        "The dashboard's own theme: dark",
      );
      await shoot(page, testInfo, "theme-menu-auto-hint");
    }
  });
});

test.describe("a link's own theme", () => {
  test("?theme=dark draws a Light dashboard dark, over the visitor's pick, and offers no menu", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate((key: string): void => {
      window.localStorage.setItem(key, "light");
    }, STORAGE_KEY);

    await openDashboard(page, "light", "theme=dark");

    await expectScheme(page, "dark");
    await expect(themeMenu(page)).toHaveCount(0);
    // The visitor's own pick is kept for links without a theme.
    expect(await kept(page)).toBe("light");
  });

  test("?theme=Light (in any case) draws a Dark dashboard light", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openDashboard(page, "dark", "theme=Light");

    await expectScheme(page, "light");
  });

  test("?theme=system follows the device while it is open", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openDashboard(page, "dark", "theme=system");
    await expectScheme(page, "light");

    await page.emulateMedia({ colorScheme: "dark" });
    await expectScheme(page, "dark");
  });

  test("an unknown theme in a link is no theme at all", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openDashboard(page, "dark", "theme=sepia");

    await expectScheme(page, "dark");
    await expect(themeMenu(page)).toHaveCount(1);
  });

  test("holds through the password prompt and back, and the visitor lands on the address they came from", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openDashboard(
      page,
      "darkPassword",
      "theme=light&board=lists&var-region=eu-west-1",
      "prompt",
    );

    // The prompt is drawn in the link's theme.
    await expectScheme(page, "light");
    expect(new URL(page.url()).searchParams.get("theme")).toBe("light");

    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Unlock Dashboard" }).click();

    await expect(readyLocator(page, "dashboard")!).toBeVisible();
    await expectScheme(page, "light");

    const address: URL = new URL(page.url());

    expect(address.pathname).toBe(pathOf("darkPassword"));
    expect(address.searchParams.get("theme")).toBe("light");
    expect(address.searchParams.get("board")).toBe("lists");
    expect(address.searchParams.get("var-region")).toBe("eu-west-1");
  });
});

test.describe("the password prompt", () => {
  test("is drawn in the dashboard's theme from its first paint, readable, and opens the dashboard in it", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }, testInfo: TestInfo) => {
    await page.emulateMedia({ colorScheme: "light" });

    // Before anything loads: the HTML of a Dark dashboard's prompt is dark.
    await request.get("/hold");
    await page.goto(`${pathOf("darkPassword")}/master-password`, {
      waitUntil: "commit",
    });
    await page.waitForFunction((): boolean => {
      return Boolean(document.documentElement.getAttribute("data-theme"));
    });
    expect((await drawnPage(page)).dataTheme).toBe("dark");
    await request.get("/release");

    await openDashboard(page, "darkPassword", "", "prompt");
    await expectScheme(page, "dark");
    expect(await lightBoxes(page)).toEqual([]);
    expect(await lowContrastTexts(page)).toEqual([]);
    await shoot(page, testInfo, "prompt-dark");

    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Unlock Dashboard" }).click();

    await expect(readyLocator(page, "dashboard")!).toBeVisible();
    await expectScheme(page, "dark");
  });

  test("a System dashboard's prompt follows the device, and the visitor's pick", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openDashboard(page, "systemPassword", "", "prompt");
    await expectScheme(page, "dark");

    await page.evaluate((key: string): void => {
      window.localStorage.setItem(key, "light");
    }, STORAGE_KEY);
    await page.reload();
    await expect(readyLocator(page, "prompt")!).toBeVisible();
    await expectScheme(page, "light");
    expect(await lowContrastTexts(page)).toEqual([]);
    await shoot(page, testInfo, "prompt-light");
  });
});

test.describe("pages that show no dashboard follow the visitor", () => {
  test("Access Denied: never the refused dashboard's theme - the visitor's device", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    // The refused dashboard is Dark; a light device sees a light page.
    await page.emulateMedia({ colorScheme: "light" });
    await openDashboard(page, "forbidden", "", "forbidden");
    await expectScheme(page, "light");

    await page.emulateMedia({ colorScheme: "dark" });
    await openDashboard(page, "forbidden", "", "forbidden");
    await expectScheme(page, "dark");
    expect(await lightBoxes(page)).toEqual([]);
    expect(await lowContrastTexts(page)).toEqual([]);
    await shoot(page, testInfo, "forbidden-dark");

    // No sideways scroll on a phone.
    expect(
      await page.evaluate((): number => {
        return document.documentElement.scrollWidth - window.innerWidth;
      }),
    ).toBeLessThanOrEqual(0);
  });

  test("not found: the visitor's own pick, else their device", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openDashboard(page, "missing", "", "missing");
    await expectScheme(page, "dark");
    expect(await lowContrastTexts(page)).toEqual([]);
    await shoot(page, testInfo, "missing-dark");

    await page.evaluate((key: string): void => {
      window.localStorage.setItem(key, "light");
    }, STORAGE_KEY);
    await openDashboard(page, "missing", "", "missing");
    await expectScheme(page, "light");
  });
});

test.describe("every widget kind in the dark theme", () => {
  for (const board of BOARDS) {
    test(`the ${board} board: no light box, every text readable`, async ({
      page,
    }: {
      page: Page;
    }, testInfo: TestInfo) => {
      await page.emulateMedia({ colorScheme: "light" });
      await openDashboard(page, "light", `board=${board}`);
      await expectScheme(page, "light");
      await shoot(page, testInfo, `${board}-light`);

      await openDashboard(page, "dark", `board=${board}`);
      await expectScheme(page, "dark");

      expect(await lightBoxes(page)).toEqual([]);
      expect(await lowContrastTexts(page)).toEqual([]);
      await shoot(page, testInfo, `${board}-dark`);
    });
  }

  test("empty widgets: no light box, every text readable", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    for (const board of ["kubernetes", "lists", "slo"]) {
      await openDashboard(page, "dark", `board=${board}&data=empty`);
      await expectScheme(page, "dark");

      expect(await lightBoxes(page)).toEqual([]);
      expect(await lowContrastTexts(page)).toEqual([]);
      await shoot(page, testInfo, `${board}-empty-dark`);
    }
  });

  test("the HTML widget stays transparent on the dark card, and on the light one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openDashboard(page, "dark", "board=other");

    const frame: Locator = page.locator('iframe[title="HTML widget"]');

    await expect(frame).toBeVisible();
    // The dark card, never the white box a frame in the light scheme gets.
    expect(await lowerThirdLuminance(page, frame)).toBeLessThan(0.15);

    await openDashboard(page, "light", "board=other");
    expect(
      await lowerThirdLuminance(
        page,
        page.locator('iframe[title="HTML widget"]'),
      ),
    ).toBeGreaterThan(0.85);
  });

  test("the logo sits on a light backdrop on the dark page, and on nothing on the light one", async ({
    page,
  }: {
    page: Page;
  }) => {
    const backdrop: (page: Page) => Promise<string> = async (
      page: Page,
    ): Promise<string> => {
      return page.evaluate((): string => {
        const plate: Element | null = document.querySelector(
          "[data-ou-logo-plate]",
        );

        return plate ? getComputedStyle(plate).backgroundColor : "none";
      });
    };

    await openDashboard(page, "dark");
    await expect(page.locator("[data-ou-logo-plate] img")).toBeVisible();
    expect(await backdrop(page)).toBe("rgb(248, 250, 252)");

    await openDashboard(page, "light");
    expect(await backdrop(page)).toBe("rgba(0, 0, 0, 0)");
  });

  test("the toolbar's menus and time range picker are dark, and readable", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openDashboard(page, "dark", "variables=1");

    await press(page.getByTestId("public-dashboard-theme-menu-button"));
    await expect(
      page.getByRole("menuitemradio", { name: "Dark" }),
    ).toBeVisible();
    expect(await lightBoxes(page)).toEqual([]);
    expect(await lowContrastTexts(page)).toEqual([]);
    await shoot(page, testInfo, "theme-menu-dark");
    await page.keyboard.press("Escape");

    await press(page.getByText("Past 1 Hour", { exact: true }));
    await expect(page.getByText("Select Time Range")).toBeVisible();
    expect(await lightBoxes(page)).toEqual([]);
    expect(await lowContrastTexts(page)).toEqual([]);
    await shoot(page, testInfo, "time-range-dark");
  });
});

/*
 * The page at a phone's width (#5106, #5116 follow-up). The page was 1000px
 * wide as a whole, so on a phone the toolbar - auto-refresh, theme, full
 * screen - sat past the right edge and the header and footer scrolled away
 * with the board. Now the page is the screen's width, and only the board,
 * which keeps the 1000px its twelve columns are laid out for, scrolls
 * sideways inside its own frame.
 */
test.describe("the page at a phone's width", () => {
  interface PageBoxes {
    viewport: number;
    pageScroll: number;
    header: { left: number; right: number };
    toolbar: Array<{ name: string; left: number; right: number }>;
    footer: { left: number; right: number };
    frame: { clientWidth: number; scrollWidth: number; overflowX: string };
    board: number;
  }

  const measure: (page: Page) => Promise<PageBoxes> = async (
    page: Page,
  ): Promise<PageBoxes> => {
    return page.evaluate((): PageBoxes => {
      const byTestId: (id: string) => HTMLElement = (
        id: string,
      ): HTMLElement => {
        const element: HTMLElement | null = document.querySelector(
          `[data-testid="${id}"]`,
        );

        if (!element) {
          throw new Error(`No ${id} on the page`);
        }

        return element;
      };
      const span: (element: Element) => { left: number; right: number } = (
        element: Element,
      ): { left: number; right: number } => {
        const box: DOMRect = element.getBoundingClientRect();
        return { left: box.left, right: box.right };
      };
      const frame: HTMLElement = byTestId("public-dashboard-board-frame");
      const toolbar: HTMLElement = byTestId("public-dashboard-toolbar");

      return {
        viewport: document.documentElement.clientWidth,
        pageScroll:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        header: span(byTestId("public-dashboard-header")),
        toolbar: Array.from(toolbar.querySelectorAll("button")).map(
          (button: HTMLButtonElement) => {
            return {
              name:
                button.getAttribute("aria-label") ||
                button.textContent ||
                "button",
              ...span(button),
            };
          },
        ),
        footer: span(byTestId("public-dashboard-powered-by")),
        frame: {
          clientWidth: frame.clientWidth,
          scrollWidth: frame.scrollWidth,
          overflowX: getComputedStyle(frame).overflowX,
        },
        board: byTestId("public-dashboard-board").getBoundingClientRect().width,
      };
    });
  };

  test("the header, the toolbar and the footer are on the screen; only the board scrolls, in its frame", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    test.skip(
      !testInfo.project.use.isMobile,
      "What a phone's width changes: the 1280 test below covers the rest.",
    );

    await openDashboard(page, "light");

    const boxes: PageBoxes = await measure(page);

    // Nothing makes the page itself wider than the screen.
    expect(boxes.pageScroll).toBe(0);
    expect(boxes.header.left).toBeGreaterThanOrEqual(0);
    expect(boxes.header.right).toBeLessThanOrEqual(boxes.viewport + 0.5);
    expect(boxes.footer.right).toBeLessThanOrEqual(boxes.viewport + 0.5);

    // Every toolbar control within reach, without scrolling to it.
    expect(boxes.toolbar.length).toBeGreaterThanOrEqual(3);

    for (const control of boxes.toolbar) {
      expect([control.name, control.left >= 0]).toEqual([control.name, true]);
      expect([control.name, control.right <= boxes.viewport + 0.5]).toEqual([
        control.name,
        true,
      ]);
    }

    // The board keeps its grid's width and scrolls inside its frame.
    expect(boxes.board).toBeGreaterThanOrEqual(1000);
    expect(boxes.frame.overflowX).toBe("auto");
    expect(boxes.frame.scrollWidth).toBeGreaterThan(boxes.frame.clientWidth);

    await shoot(page, testInfo, "phone-page");
  });

  test("a real tap on the toolbar opens its menus: they are on the screen now", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    test.skip(!testInfo.project.use.isMobile, "A phone's tap.");

    await openDashboard(page, "light");

    await page.getByTestId("public-dashboard-theme-menu-button").tap();
    await expect(
      page.getByTestId("public-dashboard-theme-menu-dark"),
    ).toBeVisible();

    const box: { x: number; width: number } | null = await page
      .getByTestId("public-dashboard-theme-menu-dark")
      .boundingBox();
    const viewport: number = await page.evaluate((): number => {
      return document.documentElement.clientWidth;
    });

    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport + 0.5);

    await page.getByTestId("public-dashboard-theme-menu-dark").tap();
    await expectScheme(page, "dark");
    await shoot(page, testInfo, "phone-page-dark");
  });

  test("the board's frame scrolls sideways to its right edge, and back", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    test.skip(!testInfo.project.use.isMobile, "A phone's width.");

    await openDashboard(page, "light");

    const frame: Locator = page.getByTestId("public-dashboard-board-frame");

    const scrolled: { left: number; max: number } = await frame.evaluate(
      (element: Element): { left: number; max: number } => {
        element.scrollLeft = element.scrollWidth;
        return {
          left: element.scrollLeft,
          max: element.scrollWidth - element.clientWidth,
        };
      },
    );

    expect(scrolled.max).toBeGreaterThan(0);
    expect(scrolled.left).toBe(scrolled.max);
    // The page itself has not moved: the header stays where it was.
    expect(
      await page.evaluate((): number => {
        return window.scrollX;
      }),
    ).toBe(0);
  });

  test("at 1280 nothing scrolls sideways, and the board is the page's width", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    test.skip(Boolean(testInfo.project.use.isMobile), "The desktop's width.");

    await openDashboard(page, "light");

    const boxes: PageBoxes = await measure(page);

    expect(boxes.pageScroll).toBe(0);
    // No scroll frame where the board fits: a chart's tooltip is never cut.
    expect(boxes.frame.overflowX).toBe("visible");
    expect(boxes.frame.scrollWidth).toBe(boxes.frame.clientWidth);
    expect(Math.abs(boxes.board - boxes.viewport)).toBeLessThanOrEqual(1);
  });

  test("the password prompt fits a phone, and names the dashboard once", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    test.skip(!testInfo.project.use.isMobile, "A phone's width.");

    await openDashboard(page, "darkPassword", "", "prompt");

    expect(
      await page.evaluate((): number => {
        return (
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
        );
      }),
    ).toBe(0);
    await expect(page.getByTestId("master-password-prompt")).toHaveText(
      "Enter the password to view this dashboard.",
    );
    await expect(page.getByText(ENTER_THE_PASSWORD)).toHaveCount(1);

    await shoot(page, testInfo, "phone-password-prompt");
  });
});
