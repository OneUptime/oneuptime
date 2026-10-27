import {
  APIRequestContext,
  BrowserContext,
  expect,
  Page,
  test,
  TestInfo,
} from "@playwright/test";

/*
 * The sign-in pages in the person's theme, in a real browser, on the real
 * pages: Accounts' own index.ejs rendered as its server renders it - its
 * first script is Common's Theme partial - and Accounts' own app
 * (App/FeatureSet/Accounts/src/Index.tsx), with only what the pages ask a
 * server answered (AccountsTheme/Fixture). See README.md.
 *
 *   - The theme is the person's: Light or Dark as they picked it in the
 *     Dashboard's user menu, on this browser, or as their device is set when
 *     they picked System or nothing. It is drawn before the first paint: with
 *     Tailwind and the app held back, the page is already in it.
 *   - While a page is open it follows the device (System, or nothing
 *     picked), and a pick made in another tab.
 *   - A public form is its owner's page and is light, whatever was picked.
 *   - In the dark theme no page, nor any state of a page a person meets,
 *     leaves a light box on the dark page, and its words read at 4.5:1 on
 *     what is behind them: the sign-in page and its second steps, single
 *     sign-on, sign-up and the "check your inbox" screen after it, the
 *     password and email pages, the master admins' page, an MCP client
 *     asking for access, a marketplace purchase, signing in to the mobile
 *     app, and the pages for a wrong link - at a laptop's width and a
 *     phone's, in English, German and Persian, nothing wider than the
 *     screen.
 *   - What a dark page draws quietly stays quiet: the footer is on the
 *     page's own ground, a state icon's halo is a faint ring of its own
 *     colour, and the backup codes' one action is as wide as the card's
 *     content, as every other step's is.
 *   - An installation's only logo, made for light backgrounds, sits on a
 *     light plate on a dark page; its logo for dark backgrounds, when it has
 *     one, is drawn as it is.
 *
 * Screenshots of every page in both themes are saved for review under
 * output/playwright/accounts-theme-ui.
 */

interface FixtureRecord {
  requests: Array<string>;
  unexpected: Array<string>;
}

declare global {
  interface Window {
    __accountsThemeFixture: FixtureRecord;
  }
}

type Scheme = "light" | "dark";

const THEME_KEY: string = "oneuptime-dashboard-theme";
const LANGUAGE_KEY: string = "oneuptimeLang";

const LIGHT_CANVAS: string = "rgb(249, 250, 251)";
const DARK_CANVAS: string = "rgb(15, 23, 42)";

const SCREENSHOTS: string = "../../output/playwright/accounts-theme-ui";

const SHARE_KEY: string = "0f8fad5b-d9cb-469f-a165-70867728950e";
const MCP_TICKET: string = `v1.${"cGF5bG9hZA".repeat(4)}.${"A".repeat(43)}`;

const LAPTOP: { width: number; height: number } = { width: 1280, height: 900 };
const PHONE: { width: number; height: number } = { width: 390, height: 844 };

interface DrawnPage {
  dark: boolean;
  dataTheme: string | null;
  colorScheme: string;
  themeColor: string | null;
  canvas: string;
}

const drawnPage: (page: Page) => Promise<DrawnPage> = async (
  page: Page,
): Promise<DrawnPage> => {
  return page.evaluate((): DrawnPage => {
    const root: HTMLElement = document.documentElement;

    return {
      dark: root.classList.contains("dark"),
      dataTheme: root.getAttribute("data-theme"),
      colorScheme: root.style.colorScheme,
      themeColor:
        document
          .querySelector('meta[name="theme-color"]')
          ?.getAttribute("content") || null,
      // What is behind everything: the body's ground, or the page's own.
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

  expect(drawn.dark).toBe(scheme === "dark");
  expect(drawn.colorScheme).toBe(scheme);
  expect(drawn.themeColor).toBe(scheme === "dark" ? "#0f172a" : "#f9fafb");
};

/*
 * What this browser kept before the page opens: the theme picked in the
 * Dashboard (null: nothing) and the language picked in a footer.
 */
const keep: (
  context: BrowserContext,
  data: { theme?: string | null | undefined; language?: string | undefined },
) => Promise<void> = async (
  context: BrowserContext,
  data: { theme?: string | null | undefined; language?: string | undefined },
): Promise<void> => {
  await context.addInitScript(
    (kept: {
      themeKey: string;
      languageKey: string;
      theme: string | null;
      language: string;
    }): void => {
      /*
       * Once per visit, before the page's own scripts: a pick made on the
       * page afterwards is the page's to keep.
       */
      if (window.sessionStorage.getItem("__accounts_theme_spec_kept")) {
        return;
      }

      window.sessionStorage.setItem("__accounts_theme_spec_kept", "1");

      if (kept.theme === null) {
        window.localStorage.removeItem(kept.themeKey);
      } else {
        window.localStorage.setItem(kept.themeKey, kept.theme);
      }

      window.localStorage.setItem(kept.languageKey, kept.language);
    },
    {
      themeKey: THEME_KEY,
      languageKey: LANGUAGE_KEY,
      theme: data.theme === undefined ? null : data.theme,
      language: data.language || "en",
    },
  );
};

const settle: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  // A dialog or a card that grows in has finished doing so.
  await page.waitForFunction((): boolean => {
    return document.getAnimations().every((animation: Animation): boolean => {
      const timing: ComputedEffectTiming | undefined =
        animation.effect?.getComputedTiming();

      return (
        animation.playState !== "running" || timing?.iterations === Infinity
      );
    });
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
 * luminance is near white, on an element a person can see. On a dark page
 * there is none, but a logo's light plate. (The QR code an authenticator
 * app scans is an image, dark on light on purpose, with no background.)
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

      if (luminance > 0.6) {
        const testId: string | null = element.getAttribute("data-testid");
        found.push(
          `${element.tagName.toLowerCase()}${testId ? `[${testId}]` : ""} ${style.backgroundColor}`,
        );
      }
    }

    return found;
  });
};

/*
 * Every piece of words on the page that reads under 4.5:1 against the
 * opaque ground behind it, as WCAG measures it: its text, its colour and
 * the ratio. Words in a control a person cannot use now (disabled, or faded
 * while another sign-in runs) are left out, as WCAG leaves them.
 */
const faintWords: (page: Page) => Promise<Array<string>> = async (
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

    const found: Array<string> = [];

    for (const element of Array.from(document.querySelectorAll("body *"))) {
      const words: string = Array.from(element.childNodes)
        .filter((node: ChildNode): boolean => {
          return node.nodeType === Node.TEXT_NODE;
        })
        .map((node: ChildNode): string => {
          return node.textContent || "";
        })
        .join("")
        .trim();

      if (!words) {
        continue;
      }

      const box: DOMRect = element.getBoundingClientRect();
      const style: CSSStyleDeclaration = getComputedStyle(element);

      if (
        box.width < 1 ||
        box.height < 1 ||
        style.visibility === "hidden" ||
        element.closest(
          "[disabled], [aria-disabled='true'], fieldset:disabled, .sr-only, option, [data-ou-logo-plate]",
        )
      ) {
        continue;
      }

      let faded: boolean = false;

      for (
        let ancestor: Element | null = element;
        ancestor;
        ancestor = ancestor.parentElement
      ) {
        if (Number(getComputedStyle(ancestor).opacity) < 1) {
          faded = true;
        }
      }

      if (faded) {
        continue;
      }

      const text: Array<number> | null = parse(style.color);
      let ground: Array<number> | null = null;

      for (
        let ancestor: Element | null = element;
        ancestor && !ground;
        ancestor = ancestor.parentElement
      ) {
        const candidate: Array<number> | null = parse(
          getComputedStyle(ancestor).backgroundColor,
        );

        if (candidate && candidate[3]! >= 0.95) {
          ground = candidate;
        }
      }

      ground = ground || parse(getComputedStyle(document.body).backgroundColor);

      if (!text || !ground) {
        continue;
      }

      const first: number = luminance(text);
      const second: number = luminance(ground);
      const ratio: number =
        (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);

      if (ratio < 4.5) {
        found.push(`${words.slice(0, 40)} ${style.color} ${ratio.toFixed(2)}`);
      }
    }

    return found;
  });
};

const widerThanTheScreen: (page: Page) => Promise<boolean> = async (
  page: Page,
): Promise<boolean> => {
  return page.evaluate((): boolean => {
    return document.documentElement.scrollWidth > window.innerWidth + 1;
  });
};

test.afterEach(async ({ page }: { page: Page }) => {
  const record: FixtureRecord | null = await page
    .evaluate((): FixtureRecord | null => {
      return window.__accountsThemeFixture || null;
    })
    .catch((): null => {
      return null;
    });

  expect(record?.unexpected || []).toEqual([]);
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

  test.afterEach(async ({ request }: { request: APIRequestContext }) => {
    await request.get("/release");
  });

  test("a pick of Dark is dark with nothing but the page's HTML, on a light device", async ({
    page,
    context,
    request,
  }: {
    page: Page;
    context: BrowserContext;
    request: APIRequestContext;
  }) => {
    await keep(context, { theme: "dark" });
    await page.emulateMedia({ colorScheme: "light" });
    await holdAndOpen(page, request, "/accounts/login");

    // Tailwind has not run, and the app has not started.
    expect(
      await page.evaluate((): boolean => {
        return "tailwind" in window;
      }),
    ).toBe(false);
    expect(await page.getByTestId("email").count()).toBe(0);

    const drawn: DrawnPage = await drawnPage(page);

    expect(drawn.dark).toBe(true);
    expect(drawn.dataTheme).toBe("dark");
    expect(drawn.colorScheme).toBe("dark");
    expect(drawn.themeColor).toBe("#0f172a");
    expect(drawn.canvas).toBe(DARK_CANVAS);
  });

  test("nothing picked, on a dark device, is dark with nothing but the page's HTML", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await holdAndOpen(page, request, "/accounts/register");

    const drawn: DrawnPage = await drawnPage(page);

    expect(drawn.dataTheme).toBe("dark");
    expect(drawn.canvas).toBe(DARK_CANVAS);
  });

  test("a pick of Light is light on a dark device", async ({
    page,
    context,
    request,
  }: {
    page: Page;
    context: BrowserContext;
    request: APIRequestContext;
  }) => {
    await keep(context, { theme: "light" });
    await page.emulateMedia({ colorScheme: "dark" });
    await holdAndOpen(page, request, "/accounts/sso");

    const drawn: DrawnPage = await drawnPage(page);

    expect(drawn.dark).toBe(false);
    expect(drawn.themeColor).toBe("#f9fafb");
  });

  test("a public form is light before anything loads, whatever was picked", async ({
    page,
    context,
    request,
  }: {
    page: Page;
    context: BrowserContext;
    request: APIRequestContext;
  }) => {
    await keep(context, { theme: "dark" });
    await page.emulateMedia({ colorScheme: "dark" });
    await holdAndOpen(page, request, `/accounts/form/${SHARE_KEY}`);

    const drawn: DrawnPage = await drawnPage(page);

    expect(drawn.dark).toBe(false);
    expect(drawn.dataTheme).toBe("light");
  });
});

test.describe("while a page is open", () => {
  test("with nothing picked, it changes with the device", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/accounts/login");
    await expect(page.getByTestId("email")).toBeVisible();
    await expectScheme(page, "light");

    await page.emulateMedia({ colorScheme: "dark" });
    await expectScheme(page, "dark");

    await page.emulateMedia({ colorScheme: "light" });
    await expectScheme(page, "light");
  });

  test("a pick of Light or Dark stays when the device changes", async ({
    page,
    context,
  }: {
    page: Page;
    context: BrowserContext;
  }) => {
    await keep(context, { theme: "light" });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/accounts/login");
    await expect(page.getByTestId("email")).toBeVisible();

    await page.emulateMedia({ colorScheme: "dark" });
    // Give the page a moment to (wrongly) follow the device.
    await page.waitForTimeout(300);
    await expectScheme(page, "light");
  });

  test("a pick made in the Dashboard in another tab is drawn here too", async ({
    context,
  }: {
    context: BrowserContext;
  }) => {
    const signIn: Page = await context.newPage();
    const otherTab: Page = await context.newPage();

    await signIn.emulateMedia({ colorScheme: "light" });
    await signIn.goto("/accounts/login");
    await expect(signIn.getByTestId("email")).toBeVisible();
    await expectScheme(signIn, "light");

    // The other tab is on the same address, as the Dashboard is.
    await otherTab.goto("/accounts/forbidden");
    await otherTab.evaluate((key: string): void => {
      window.localStorage.setItem(key, "dark");
    }, THEME_KEY);

    await expectScheme(signIn, "dark");

    await otherTab.evaluate((key: string): void => {
      window.localStorage.setItem(key, "system");
    }, THEME_KEY);

    await expectScheme(signIn, "light");
  });

  test("moving on from the sign-in page to single sign-on keeps the theme", async ({
    page,
    context,
  }: {
    page: Page;
    context: BrowserContext;
  }) => {
    await keep(context, { theme: "dark" });
    await page.goto("/accounts/login");
    await expect(page.getByTestId("email")).toBeVisible();

    await page.getByTestId("sso-login").click();
    await expect(page).toHaveURL(/\/accounts\/sso$/);
    await expectScheme(page, "dark");
  });
});

test.describe("a public form", () => {
  test("is light, on a dark device, after Dark was picked", async ({
    page,
    context,
  }: {
    page: Page;
    context: BrowserContext;
  }, testInfo: TestInfo) => {
    await keep(context, { theme: "dark" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`/accounts/form/${SHARE_KEY}`);

    await expect(page.getByText("Report a problem")).toBeVisible();
    await settle(page);
    await expectScheme(page, "light");
    expect((await drawnPage(page)).canvas).toBe(LIGHT_CANVAS);
    await shoot(page, testInfo, "form-picked-dark");
  });
});

interface PageVisit {
  name: string;
  address: string;
  // What says the page is ready.
  ready: (page: Page) => Promise<void>;
  // Steps to the state looked at, from the page as it opens.
  steps?: ((page: Page) => Promise<void>) | undefined;
}

const signInWithPassword: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await page.getByTestId("email").fill("jane@acme.example");
  await page.getByTestId("password").fill("correct-horse-battery");
  await page.getByTestId("Sign in").click();
};

// The second step with an authenticator app's code, once signed in with a password.
const enterAuthenticatorCode: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await signInWithPassword(page);
  await page.getByText("Phone").click();
  await page.getByTestId("code").fill("123456");
  await page.getByTestId("Sign in").click();
};

/*
 * A sign-up with an address of a webmail the page knows, so the screen that
 * follows offers to open its inbox.
 */
const signUp: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await page.getByTestId("email").fill("jane@gmail.com");
  await page.getByTestId("name").fill("Jane Doe");
  await page.getByTestId("password").fill("correct-horse-battery");
  await page.getByTestId("confirmPassword").fill("correct-horse-battery");
  await page.getByTestId("Sign Up").click();
};

const visible: (testId: string) => (page: Page) => Promise<void> = (
  testId: string,
): ((page: Page) => Promise<void>) => {
  return async (page: Page): Promise<void> => {
    await expect(page.getByTestId(testId).first()).toBeVisible();
  };
};

const shown: (text: string) => (page: Page) => Promise<void> = (
  text: string,
): ((page: Page) => Promise<void>) => {
  return async (page: Page): Promise<void> => {
    await expect(page.getByText(text).first()).toBeVisible();
  };
};

const PAGES: Array<PageVisit> = [
  { name: "sign-in", address: "/accounts/login", ready: visible("email") },
  {
    // The edition pill's Learn more: what this server is, and what Enterprise adds.
    name: "edition-dialog",
    address: "/accounts/login",
    ready: visible("email"),
    steps: async (page: Page): Promise<void> => {
      await page.getByText("Learn more").click();
      await expect(page.getByRole("dialog")).toBeVisible();
    },
  },
  {
    name: "sign-in-wrong-password",
    address: "/accounts/login?signin=wrong",
    ready: visible("email"),
    steps: async (page: Page): Promise<void> => {
      await signInWithPassword(page);
      await expect(page.getByText("Invalid email or password.")).toBeVisible();
    },
  },
  {
    name: "second-step-methods",
    address: "/accounts/login?signin=methods",
    ready: visible("email"),
    steps: async (page: Page): Promise<void> => {
      await signInWithPassword(page);
      await expect(page.getByText("YubiKey 5C")).toBeVisible();
    },
  },
  {
    name: "second-step-code",
    address: "/accounts/login?signin=totp",
    ready: visible("email"),
    steps: async (page: Page): Promise<void> => {
      await signInWithPassword(page);
      await page.getByText("Phone").click();
      await expect(page.getByTestId("code")).toBeVisible();
    },
  },
  {
    name: "second-step-enrolment",
    address: "/accounts/login?signin=enrol",
    ready: visible("email"),
    steps: async (page: Page): Promise<void> => {
      await signInWithPassword(page);
      await expect(page.getByTestId("enrolment-code")).toBeVisible();
    },
  },
  {
    name: "backup-codes",
    address: "/accounts/login?signin=codes",
    ready: visible("email"),
    steps: async (page: Page): Promise<void> => {
      await enterAuthenticatorCode(page);
      await expect(page.getByTestId("backup-codes-list")).toBeVisible();
    },
  },
  {
    name: "backup-codes-offer",
    address: "/accounts/login?signin=nocodes",
    ready: visible("email"),
    steps: async (page: Page): Promise<void> => {
      await enterAuthenticatorCode(page);
      await expect(page.getByTestId("generate-backup-codes")).toBeVisible();
    },
  },
  {
    name: "single-sign-on",
    address: "/accounts/sso",
    ready: visible("email"),
  },
  {
    name: "single-sign-on-projects",
    address: "/accounts/sso?lookup=found",
    ready: visible("email"),
    steps: async (page: Page): Promise<void> => {
      await page.getByTestId("email").fill("jane@acme.example");
      await page.getByRole("button", { name: "Sign in with SSO" }).click();
      await expect(page.getByText("Acme Okta").first()).toBeVisible();
    },
  },
  {
    name: "sso-required",
    address: "/accounts/login?ssorequired=1&providers=2&projectsso=1",
    ready: shown("Google Workspace"),
  },
  {
    name: "master-admin-sign-in",
    address: "/accounts/admin-login?ssorequired=1",
    ready: visible("email"),
  },
  {
    name: "sign-up",
    address: "/accounts/register",
    ready: visible("email"),
  },
  {
    name: "verify-email-pending",
    address: "/accounts/register?signup=verify",
    ready: visible("email"),
    steps: async (page: Page): Promise<void> => {
      await signUp(page);
      await expect(page.getByTestId("verify-email-required")).toBeVisible();
    },
  },
  {
    name: "forgot-password",
    address: "/accounts/forgot-password",
    ready: visible("forgot-password-card"),
  },
  {
    name: "reset-password",
    address: "/accounts/reset-password",
    ready: shown("Reset your password"),
  },
  {
    name: "email-verified",
    address: `/accounts/verify-email/${SHARE_KEY}`,
    ready: shown("Your email is verified."),
  },
  {
    name: "email-link-expired",
    address: `/accounts/verify-email/${SHARE_KEY}?verify=failed`,
    ready: shown("This verification link is no longer valid"),
  },
  {
    name: "mcp-authorize",
    address: `/accounts/mcp-authorize?request=${MCP_TICKET}&mcp=write`,
    ready: visible("mcp-authorize-client"),
  },
  {
    name: "mcp-authorize-this-device",
    address: `/accounts/mcp-authorize?request=${MCP_TICKET}&mcp=loopback`,
    ready: visible("mcp-authorize-loopback-warning"),
  },
  {
    name: "marketplace",
    address: "/accounts/marketplace",
    ready: shown("AWS Marketplace"),
  },
  {
    name: "mobile-passkey",
    address: "/accounts/mobile-passkey",
    ready: shown("127.0.0.1"),
  },
  {
    name: "not-found",
    address: "/accounts/nothing-here",
    ready: shown("Page not found"),
  },
  {
    name: "forbidden",
    address: "/accounts/forbidden",
    ready: shown("Forbidden"),
  },
];

// A visit by its name, so adding a page to the list moves no other test.
const visitNamed: (name: string) => PageVisit = (name: string): PageVisit => {
  const visit: PageVisit | undefined = PAGES.find(
    (candidate: PageVisit): boolean => {
      return candidate.name === name;
    },
  );

  if (!visit) {
    throw new Error(`No page visit is named ${name}`);
  }

  return visit;
};

const openAndReach: (page: Page, visit: PageVisit) => Promise<void> = async (
  page: Page,
  visit: PageVisit,
): Promise<void> => {
  await page.goto(visit.address);
  await visit.ready(page);

  if (visit.steps) {
    await visit.steps(page);
  }

  await settle(page);
};

test.describe("every page in the dark theme", () => {
  for (const visit of PAGES) {
    test(`${visit.name}: no light box, words that read, nothing wider than a phone`, async ({
      page,
      context,
    }: {
      page: Page;
      context: BrowserContext;
    }, testInfo: TestInfo) => {
      await keep(context, { theme: "dark" });
      await page.setViewportSize(LAPTOP);
      await openAndReach(page, visit);

      await expectScheme(page, "dark");
      expect((await drawnPage(page)).canvas).toBe(DARK_CANVAS);
      expect(await lightBoxes(page)).toEqual([]);
      expect(await faintWords(page)).toEqual([]);
      await shoot(page, testInfo, `${visit.name}-dark-1280`);

      await page.setViewportSize(PHONE);
      await settle(page);
      expect(await lightBoxes(page)).toEqual([]);
      expect(await widerThanTheScreen(page)).toBe(false);
      await shoot(page, testInfo, `${visit.name}-dark-390`);
    });
  }
});

test.describe("every page in the light theme, as before", () => {
  for (const visit of PAGES) {
    test(`${visit.name}: light, nothing wider than a phone`, async ({
      page,
      context,
    }: {
      page: Page;
      context: BrowserContext;
    }, testInfo: TestInfo) => {
      await keep(context, { theme: "light" });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.setViewportSize(LAPTOP);
      await openAndReach(page, visit);

      await expectScheme(page, "light");
      expect((await drawnPage(page)).canvas).toBe(LIGHT_CANVAS);
      await shoot(page, testInfo, `${visit.name}-light-1280`);

      await page.setViewportSize(PHONE);
      await settle(page);
      expect(await widerThanTheScreen(page)).toBe(false);
      await shoot(page, testInfo, `${visit.name}-light-390`);
    });
  }
});

test.describe("in a long language and one read right to left", () => {
  for (const language of ["de", "fa"]) {
    for (const visit of [
      visitNamed("sign-in"),
      visitNamed("single-sign-on"),
      visitNamed("sign-up"),
    ]) {
      test(`${visit.name} in ${language}, dark`, async ({
        page,
        context,
      }: {
        page: Page;
        context: BrowserContext;
      }, testInfo: TestInfo) => {
        await keep(context, { theme: "dark", language });
        await page.setViewportSize(PHONE);
        await openAndReach(page, visit);

        await expect(page.locator("html")).toHaveAttribute("lang", language);
        await expect(page.locator("html")).toHaveAttribute(
          "dir",
          language === "fa" ? "rtl" : "ltr",
        );
        await expectScheme(page, "dark");
        expect(await lightBoxes(page)).toEqual([]);
        expect(await faintWords(page)).toEqual([]);
        expect(await widerThanTheScreen(page)).toBe(false);
        await shoot(page, testInfo, `${visit.name}-${language}-dark-390`);

        await page.setViewportSize(LAPTOP);
        await settle(page);
        await shoot(page, testInfo, `${visit.name}-${language}-dark-1280`);
      });
    }
  }
});

test.describe("what a dark page draws quietly", () => {
  test("the footer sits on the page's own ground, under a hairline", async ({
    page,
    context,
  }: {
    page: Page;
    context: BrowserContext;
  }) => {
    await keep(context, { theme: "dark" });
    await page.goto("/accounts/login");
    await expect(page.getByTestId("email")).toBeVisible();
    await settle(page);

    const footer: { ground: string; edge: string } = await page
      .locator("footer")
      .evaluate((element: Element): { ground: string; edge: string } => {
        const style: CSSStyleDeclaration = getComputedStyle(element);

        return { ground: style.backgroundColor, edge: style.borderTopWidth };
      });

    // No ground of its own: not a lighter band across the dark page.
    expect(footer.ground).toBe("rgba(0, 0, 0, 0)");
    expect(footer.edge).toBe("1px");
  });

  const HALOS: Array<{
    name: string;
    visit: () => PageVisit;
    testId: string;
    halo: string;
  }> = [
    {
      name: "the email verified page's tick",
      visit: (): PageVisit => {
        return visitNamed("email-verified");
      },
      testId: "verify-email-success",
      halo: "rgba(52, 211, 153, 0.1)",
    },
    {
      name: "an expired link's clock",
      visit: (): PageVisit => {
        return visitNamed("email-link-expired");
      },
      testId: "verify-email-error",
      halo: "rgba(251, 191, 36, 0.1)",
    },
    {
      name: "the check-your-inbox envelope",
      visit: (): PageVisit => {
        return visitNamed("verify-email-pending");
      },
      testId: "verify-email-required",
      halo: "rgba(129, 140, 248, 0.12)",
    },
  ];

  for (const icon of HALOS) {
    test(`${icon.name} has a faint halo of its own colour`, async ({
      page,
      context,
    }: {
      page: Page;
      context: BrowserContext;
    }) => {
      await keep(context, { theme: "dark" });
      await page.setViewportSize(LAPTOP);
      await openAndReach(page, icon.visit());

      const shadow: string = await page
        .getByTestId(icon.testId)
        .locator(".ring-8")
        .evaluate((element: Element): string => {
          return getComputedStyle(element).boxShadow;
        });

      // An 8px ring in the icon's hue - not one indigo ring round every colour.
      expect(shadow).toContain(`${icon.halo} 0px 0px 0px 8px`);
    });
  }

  for (const codesScreen of [
    { name: "backup-codes", testId: "backup-codes-continue" },
    { name: "backup-codes-offer", testId: "generate-backup-codes" },
  ]) {
    test(`${codesScreen.name}: its one action is as wide as the card's content, flush with it`, async ({
      page,
      context,
    }: {
      page: Page;
      context: BrowserContext;
    }) => {
      await keep(context, { theme: "dark" });
      await page.setViewportSize(LAPTOP);
      await openAndReach(page, visitNamed(codesScreen.name));

      const drawn: {
        start: number;
        width: number;
        column: number;
        columnWidth: number;
      } = await page.getByTestId(codesScreen.testId).evaluate(
        (
          element: Element,
        ): {
          start: number;
          width: number;
          column: number;
          columnWidth: number;
        } => {
          const own: DOMRect = element.getBoundingClientRect();
          const column: DOMRect =
            element.parentElement!.getBoundingClientRect();

          return {
            start: own.left,
            width: own.width,
            column: column.left,
            columnWidth: column.width,
          };
        },
      );

      // Not 12px in from the codes and the checkbox above it, as a dialog's button is.
      expect(Math.abs(drawn.start - drawn.column)).toBeLessThan(1);
      expect(Math.abs(drawn.width - drawn.columnWidth)).toBeLessThan(1);
    });
  }
});

test.describe("an installation's own logo on a dark page", () => {
  test("its only logo, made for light backgrounds, sits on a light plate", async ({
    page,
    context,
  }: {
    page: Page;
    context: BrowserContext;
  }, testInfo: TestInfo) => {
    await keep(context, { theme: "dark" });
    await page.goto("/accounts/login?brand=logo");

    const logo: ReturnType<Page["getByRole"]> = page.getByRole("img", {
      name: "Acme Ops",
    });

    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute("src", "/fixture/brand-logo-light.svg");
    await expect(logo).toHaveAttribute("data-ou-logo-plate", "");
    expect(
      await logo.evaluate((element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      }),
    ).toBe("rgb(248, 250, 252)");
    await settle(page);
    await shoot(page, testInfo, "brand-logo-plate-dark");
  });

  test("its logo for dark backgrounds is drawn as it is", async ({
    page,
    context,
  }: {
    page: Page;
    context: BrowserContext;
  }) => {
    await keep(context, { theme: "dark" });
    await page.goto("/accounts/login?brand=logos");

    const logo: ReturnType<Page["getByRole"]> = page.getByRole("img", {
      name: "Acme Ops",
    });

    await expect(logo).toHaveAttribute("src", "/fixture/brand-logo-dark.svg");
    await expect(logo).not.toHaveAttribute("data-ou-logo-plate", "");
  });

  test("on a light page, its logo sits on nothing", async ({
    page,
    context,
  }: {
    page: Page;
    context: BrowserContext;
  }) => {
    await keep(context, { theme: "light" });
    await page.goto("/accounts/login?brand=logo");

    await expect(
      page.getByRole("img", { name: "Acme Ops" }),
    ).not.toHaveAttribute("data-ou-logo-plate", "");
  });
});
