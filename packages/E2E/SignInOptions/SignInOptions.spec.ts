import { Locator, Page, TestInfo, expect, test } from "@playwright/test";
import { SUPPORTED_ACCOUNTS_LANGUAGE_CODES } from "Common/Types/Accounts/AccountsLanguage";
import { SUPPORTED_STATUS_PAGE_LANGUAGE_CODES } from "Common/Types/StatusPage/StatusPageLanguage";

/*
 * The other ways to sign in - "Sign in with SSO", "Sign in with Microsoft",
 * "Sign in with a passkey" - as the browser draws them on the real sign-in
 * pages (Fixture/Fixture.js), in every language they are translated into and
 * from a 320 px phone to a laptop.
 *
 * Under the page's own filled button, an "or" divider, then each other way
 * in as a normal outlined button with an icon before its words. The words
 * and the icon are one run of text (SignInOptionLabel): a label too long for
 * one line - Spanish "Iniciar sesión con una clave de acceso" on a phone -
 * wraps into balanced lines and keeps its icon beside its first words. When
 * the icon and the words were two flex items, the wrapped words took the
 * whole width and left the icon at the button's edge, a hand's width from
 * the words it belongs to.
 *
 * jsdom has no layout, so these are the tests that see it.
 */

const PHONE_WIDTHS: Array<number> = [320, 360, 390];
// Phones, the md breakpoint where the type steps down, and a laptop.
const WIDTHS: Array<number> = [...PHONE_WIDTHS, 768, 1280];

const OPTIONS: string = [
  '[data-testid="sso-login"]',
  '[data-testid="microsoft-sign-in"]',
  '[data-testid="password-login"]',
  '[data-testid="passkey-login"]',
].join(", ");
const DIVIDERS: string =
  '[data-testid="sign-in-options-divider"], [data-testid="sign-up-options-divider"]';
// The page's own filled button: Login, Login with SSO, Sign Up.
const SUBMIT: string = '[id$="-form-submit-button"]';

// The gap between an option's icon and its words (me-2).
const ICON_GAP: number = 8;
// A hairline either side of "or" never shrinks to nothing.
const SHORTEST_HAIRLINE: number = 24;

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface OptionGeometry {
  testId: string;
  words: string;
  option: Rect;
  contentLeft: number;
  contentRight: number;
  /*
   * The box the icon is laid out in. Measured rather than the icon itself,
   * which a busy option spins: a turning square's bounding box is wider
   * than the square.
   */
  icon: Rect;
  hasIcon: boolean;
  // The words, line by line (the text only, not the icon).
  lines: Array<Rect>;
  direction: string;
  overflows: boolean;
}

interface PageGeometry {
  submit: Rect | null;
  dividerWords: Rect | null;
  hairlines: Array<Rect>;
  options: Array<OptionGeometry>;
  scrollsSideways: boolean;
}

const measure: (page: Page) => Promise<PageGeometry> = async (
  page: Page,
): Promise<PageGeometry> => {
  return page.evaluate(
    (selectors: {
      options: string;
      dividers: string;
      submit: string;
    }): PageGeometry => {
      const rectOf: (element: Element) => Rect = (element: Element): Rect => {
        const box: DOMRect = element.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
        };
      };

      // The words' text, wherever the option's markup puts it.
      const textOf: (element: Element) => Array<Text> = (
        element: Element,
      ): Array<Text> => {
        const nodes: Array<Text> = [];
        const walker: TreeWalker = document.createTreeWalker(
          element,
          NodeFilter.SHOW_TEXT,
        );
        while (walker.nextNode()) {
          const node: Text = walker.currentNode as Text;
          if ((node.textContent || "").trim()) {
            nodes.push(node);
          }
        }
        return nodes;
      };

      // The line boxes of some text, grouped by line.
      const linesOf: (nodes: Array<Text>) => Array<Rect> = (
        nodes: Array<Text>,
      ): Array<Rect> => {
        const fragments: Array<DOMRect> = [];
        for (const node of nodes) {
          const range: Range = document.createRange();
          range.selectNodeContents(node);
          fragments.push(
            ...Array.from(range.getClientRects()).filter(
              (fragment: DOMRect): boolean => {
                return fragment.width > 0;
              },
            ),
          );
        }

        const lines: Array<Rect> = [];
        fragments.sort((a: DOMRect, b: DOMRect): number => {
          return a.top - b.top;
        });
        for (const fragment of fragments) {
          const middle: number = (fragment.top + fragment.bottom) / 2;
          const line: Rect | undefined = lines.find((candidate: Rect) => {
            return (
              Math.abs((candidate.top + candidate.bottom) / 2 - middle) < 4
            );
          });
          if (line) {
            line.left = Math.min(line.left, fragment.left);
            line.right = Math.max(line.right, fragment.right);
            line.top = Math.min(line.top, fragment.top);
            line.bottom = Math.max(line.bottom, fragment.bottom);
          } else {
            lines.push({
              left: fragment.left,
              right: fragment.right,
              top: fragment.top,
              bottom: fragment.bottom,
            });
          }
        }
        return lines;
      };

      const options: Array<OptionGeometry> = Array.from(
        document.querySelectorAll(selectors.options),
      ).map((option: Element): OptionGeometry => {
        const text: Array<Text> = textOf(option);
        const words: Element = text[0]?.parentElement || option;
        const icon: SVGElement | null = option.querySelector("svg");
        // The icon's layout box: the element it is drawn in, if any.
        const iconBox: Element | null =
          icon && icon.parentElement && icon.parentElement !== option
            ? icon.parentElement
            : icon;
        const style: CSSStyleDeclaration = window.getComputedStyle(option);
        const box: Rect = rectOf(option);

        return {
          testId: option.getAttribute("data-testid") || "",
          words: (option.textContent || "").trim(),
          option: box,
          contentLeft:
            box.left +
            parseFloat(style.borderLeftWidth) +
            parseFloat(style.paddingLeft),
          contentRight:
            box.right -
            parseFloat(style.borderRightWidth) -
            parseFloat(style.paddingRight),
          icon: iconBox ? rectOf(iconBox) : box,
          hasIcon: Boolean(icon),
          lines: linesOf(text),
          direction: window.getComputedStyle(words).direction,
          overflows:
            words.scrollWidth > words.clientWidth + 1 ||
            option.scrollWidth > option.clientWidth + 1,
        };
      });

      const divider: Element | null = document.querySelector(
        selectors.dividers,
      );
      const submit: Element | null = document.querySelector(selectors.submit);

      return {
        submit: submit ? rectOf(submit) : null,
        dividerWords:
          divider && divider.children[1] ? rectOf(divider.children[1]) : null,
        hairlines: divider
          ? Array.from(divider.querySelectorAll('[aria-hidden="true"]')).map(
              rectOf,
            )
          : [],
        options,
        scrollsSideways:
          document.documentElement.scrollWidth > window.innerWidth,
      };
    },
    { options: OPTIONS, dividers: DIVIDERS, submit: SUBMIT },
  );
};

const widthOf: (rect: Rect) => number = (rect: Rect): number => {
  return rect.right - rect.left;
};

const heightOf: (rect: Rect) => number = (rect: Rect): number => {
  return rect.bottom - rect.top;
};

/*
 * What is wrong with one option, as drawn: an empty list when nothing is.
 * Each finding names the option, so a failure reads as a list of them.
 */
const problemsWith: (
  option: OptionGeometry,
  submit: Rect | null,
) => Array<string> = (
  option: OptionGeometry,
  submit: Rect | null,
): Array<string> => {
  const problems: Array<string> = [];
  const first: Rect | undefined = option.lines[0];

  if (!first) {
    return ["has no words"];
  }
  if (!option.hasIcon) {
    return ["has no icon"];
  }

  const rtl: boolean = option.direction === "rtl";
  const iconMiddle: number = (option.icon.top + option.icon.bottom) / 2;

  // The icon is in the first line of the words ...
  if (iconMiddle < first.top - 1 || iconMiddle > first.bottom + 1) {
    problems.push(
      `its icon (middle ${iconMiddle.toFixed(1)}) is not on its first line (${first.top.toFixed(1)}-${first.bottom.toFixed(1)})`,
    );
  }

  // ... right before them, whichever way they run.
  const gap: number = rtl
    ? option.icon.left - first.right
    : first.left - option.icon.right;
  if (Math.abs(gap - ICON_GAP) > 1) {
    problems.push(
      `its icon is ${gap.toFixed(1)}px from its words, not ${ICON_GAP}px`,
    );
  }

  // Nothing leaves the button.
  if (option.overflows) {
    problems.push("its words overflow it");
  }
  for (const box of [option.icon, ...option.lines]) {
    if (
      box.left < option.contentLeft - 1 ||
      box.right > option.contentRight + 1
    ) {
      problems.push("its icon or words stick out of it");
      break;
    }
  }

  if (option.lines.length === 1) {
    // One line: exactly as tall as the filled button above, and centred.
    if (submit && Math.abs(heightOf(option.option) - heightOf(submit)) > 0.5) {
      problems.push(
        `it is ${heightOf(option.option).toFixed(1)}px tall, the filled button ${heightOf(submit).toFixed(1)}px`,
      );
    }
    const start: number = Math.min(option.icon.left, first.left);
    const end: number = Math.max(option.icon.right, first.right);
    const offCentre: number =
      (start + end) / 2 - (option.contentLeft + option.contentRight) / 2;
    if (Math.abs(offCentre) > 1.5) {
      problems.push(
        `its icon and words are ${offCentre.toFixed(1)}px off its centre`,
      );
    }
  } else {
    // Wrapped: the lines balanced, the first measured from the icon.
    const widths: Array<number> = option.lines.map(
      (line: Rect, index: number): number => {
        if (index > 0) {
          return widthOf(line);
        }
        return rtl
          ? option.icon.right - line.left
          : line.right - option.icon.left;
      },
    );
    const balance: number = Math.min(...widths) / Math.max(...widths);
    if (balance < 0.5) {
      problems.push(
        `its lines are uneven (${widths
          .map((width: number): string => {
            return width.toFixed(0);
          })
          .join(" / ")}px)`,
      );
    }
  }

  return problems;
};

/*
 * What is wrong with the "or" divider, as drawn: its word between two
 * hairlines that never shrink to nothing, each centred on the word.
 */
const dividerProblems: (geometry: PageGeometry) => Array<string> = (
  geometry: PageGeometry,
): Array<string> => {
  const words: Rect | null = geometry.dividerWords;
  /*
   * Left to right on the screen, whichever way the page reads: a Persian
   * page draws the divider's first hairline at the right (<html dir="rtl">).
   */
  const [before, after]: Array<Rect | undefined> = [...geometry.hairlines].sort(
    (one: Rect, other: Rect): number => {
      return one.left - other.left;
    },
  );

  if (!words || !before || !after || geometry.hairlines.length !== 2) {
    return ["it is not a word between two hairlines"];
  }

  const problems: Array<string> = [];
  for (const hairline of [before, after]) {
    if (widthOf(hairline) < SHORTEST_HAIRLINE) {
      problems.push(`a hairline is ${widthOf(hairline).toFixed(1)}px`);
    }
    const offCentre: number =
      (hairline.top + hairline.bottom) / 2 - (words.top + words.bottom) / 2;
    if (Math.abs(offCentre) > 1.5) {
      problems.push(
        `a hairline is ${offCentre.toFixed(1)}px off the word's middle`,
      );
    }
  }
  if (before.right > words.left || words.right > after.left) {
    problems.push("its word is not between its hairlines");
  }

  return problems;
};

interface Survey {
  problems: Array<string>;
  wrapped: Array<string>;
  checked: number;
}

/*
 * Every language at every width, without reloading: the fixture switches the
 * page's language in place (window.__setLanguage).
 */
const survey: (
  page: Page,
  languages: ReadonlyArray<string>,
  widths: ReadonlyArray<number>,
) => Promise<Survey> = async (
  page: Page,
  languages: ReadonlyArray<string>,
  widths: ReadonlyArray<number>,
): Promise<Survey> => {
  const result: Survey = { problems: [], wrapped: [], checked: 0 };

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    for (const language of languages) {
      await page.evaluate(async (code: string): Promise<void> => {
        await (
          window as unknown as {
            __setLanguage: (language: string) => Promise<void>;
          }
        ).__setLanguage(code);
      }, language);

      const geometry: PageGeometry = await measure(page);
      const where: string = `${language} at ${width}px`;

      if (geometry.scrollsSideways) {
        result.problems.push(`${where}: the page scrolls sideways`);
      }
      for (const problem of dividerProblems(geometry)) {
        result.problems.push(`${where}: the divider - ${problem}`);
      }
      for (const option of geometry.options) {
        result.checked += 1;
        if (option.lines.length > 1) {
          result.wrapped.push(`${where}: ${option.words}`);
        }
        for (const problem of problemsWith(option, geometry.submit)) {
          result.problems.push(`${where}: "${option.words}" - ${problem}`);
        }
      }
    }
  }

  return result;
};

const open: (page: Page, query: string) => Promise<void> = async (
  page: Page,
  query: string,
): Promise<void> => {
  await page.goto(`/?${query}`);
  await expect(page.locator(OPTIONS).first()).toBeVisible();
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
};

const box: (locator: Locator) => Promise<Rect> = async (
  locator: Locator,
): Promise<Rect> => {
  return locator.evaluate((element: Element): Rect => {
    const rect: DOMRect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    };
  });
};

test.describe("The other ways to sign in, as the browser draws them", () => {
  test("the sign-in page: under Login, 'or', then single sign-on, Microsoft and the passkey, each as wide as Login and as tall", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=login&ms=1");

    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const login: Rect = await box(page.locator(SUBMIT));
      const divider: Rect = await box(
        page.getByTestId("sign-in-options-divider"),
      );
      const options: Array<Rect> = [];
      for (const testId of [
        "sso-login",
        "microsoft-sign-in",
        "passkey-login",
      ]) {
        options.push(await box(page.getByTestId(testId)));
      }

      expect(divider.top).toBeGreaterThanOrEqual(login.bottom);
      expect(options[0]!.top).toBeGreaterThanOrEqual(divider.bottom);
      let above: Rect = divider;
      for (const option of options) {
        expect(option.top).toBeGreaterThanOrEqual(above.bottom);
        expect(Math.abs(option.left - login.left)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(widthOf(option) - widthOf(login))).toBeLessThanOrEqual(
          0.5,
        );
        expect(
          Math.abs(heightOf(option) - heightOf(login)),
        ).toBeLessThanOrEqual(0.5);
        above = option;
      }
      // 38px from md, where the type steps down to text-sm; 42px below.
      expect(Math.round(heightOf(login))).toBe(width >= 768 ? 38 : 42);
    }
  });

  test("in every language, from 320px up, each option keeps its icon right before its words, and nothing overflows", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=login&ms=1");

    const result: Survey = await survey(
      page,
      SUPPORTED_ACCOUNTS_LANGUAGE_CODES,
      WIDTHS,
    );

    expect(result.problems).toEqual([]);
    expect(result.checked).toBe(
      SUPPORTED_ACCOUNTS_LANGUAGE_CODES.length * WIDTHS.length * 3,
    );
    // The long labels do wrap on a phone, so the wrapping is what was checked.
    expect(result.wrapped).toEqual(
      expect.arrayContaining([
        "es at 390px: Iniciar sesión con una clave de acceso",
        "es at 320px: Iniciar sesión con Microsoft",
      ]),
    );
  });

  test("after a canceled attempt, 'Try passkey again' keeps its icon with its words in every language", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=login&passkey=cancel");
    await page.getByTestId("passkey-login").click();
    await expect(page.getByTestId("passkey-notice")).toBeVisible();

    const result: Survey = await survey(
      page,
      SUPPORTED_ACCOUNTS_LANGUAGE_CODES,
      PHONE_WIDTHS,
    );

    expect(result.problems).toEqual([]);
    expect(result.wrapped).toEqual(
      expect.arrayContaining([
        "pt at 360px: Tentar novamente com chave de acesso",
        "es at 390px: Volver a intentar con clave de acceso",
      ]),
    );
  });

  test("during a passkey attempt the option stays at full strength, its spinner beside its words; the form, the divider and the other ways in pause", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=login&ms=1&passkey=pending");
    await page.setViewportSize({ width: 390, height: 900 });
    const before: Rect = await box(page.getByTestId("passkey-login"));

    await page.getByTestId("passkey-login").click();
    await expect(page.getByTestId("passkey-login-spinner")).toBeVisible();

    const form: Locator = page.locator("fieldset").first();
    await expect(form).toHaveCSS("opacity", "0.5");
    await expect(form).toHaveCSS("pointer-events", "none");
    for (const testId of [
      "sign-in-options-divider",
      "sso-login",
      "microsoft-sign-in",
    ]) {
      expect(await form.getByTestId(testId).count()).toBe(1);
    }
    await expect(page.getByTestId("passkey-option")).toHaveCSS("opacity", "1");
    await expect(page.getByTestId("passkey-login")).toHaveCSS("opacity", "1");

    const during: Rect = await box(page.getByTestId("passkey-login"));
    expect(heightOf(during)).toBe(heightOf(before));
    expect(widthOf(during)).toBe(widthOf(before));

    // Its words say what it waits for, in every language, spinner first.
    const result: Survey = await survey(
      page,
      SUPPORTED_ACCOUNTS_LANGUAGE_CODES,
      PHONE_WIDTHS,
    );
    expect(result.problems).toEqual([]);
  });

  test("a browser without passkeys: the option is drawn unavailable, in the same box", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=login&webauthn=0");
    await page.setViewportSize({ width: 390, height: 900 });
    const option: Locator = page.getByTestId("passkey-login");
    const before: Rect = await box(option);

    await option.click();
    await expect(page.getByTestId("passkey-notice")).toBeVisible();

    await expect(option).toHaveAttribute("aria-disabled", "true");
    await expect(option).toHaveCSS("background-color", "rgb(249, 250, 251)");
    await expect(option).toHaveCSS("color", "rgb(107, 114, 128)");
    const after: Rect = await box(option);
    expect(heightOf(after)).toBe(heightOf(before));
    expect(widthOf(after)).toBe(widthOf(before));

    const geometry: PageGeometry = await measure(page);
    const passkey: OptionGeometry | undefined = geometry.options.find(
      (candidate: OptionGeometry): boolean => {
        return candidate.testId === "passkey-login";
      },
    );
    expect(problemsWith(passkey!, geometry.submit)).toEqual([]);
  });

  test("the single sign-on page: 'or', then Sign in with password, as wide and as tall as Login with SSO, in every language", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=sso&globalsso=1");
    await page.setViewportSize({ width: 390, height: 900 });

    const submit: Rect = await box(page.locator(SUBMIT));
    const divider: Rect = await box(
      page.getByTestId("sign-in-options-divider"),
    );
    const password: Rect = await box(page.getByTestId("password-login"));
    const providers: Rect = await box(
      page.getByTestId("global-providers-divider"),
    );

    expect(providers.bottom).toBeLessThanOrEqual(submit.top);
    expect(divider.top).toBeGreaterThanOrEqual(submit.bottom);
    expect(password.top).toBeGreaterThanOrEqual(divider.bottom);
    expect(Math.abs(widthOf(password) - widthOf(submit))).toBeLessThanOrEqual(
      0.5,
    );
    expect(Math.abs(heightOf(password) - heightOf(submit))).toBeLessThanOrEqual(
      0.5,
    );

    const result: Survey = await survey(
      page,
      SUPPORTED_ACCOUNTS_LANGUAGE_CODES,
      WIDTHS,
    );
    expect(result.problems).toEqual([]);
  });

  test("the sign-up page: 'or', then Sign up with Microsoft, as wide as Sign Up, in every language", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=register&ms=1");
    await page.setViewportSize({ width: 390, height: 900 });

    const submit: Rect = await box(page.locator(SUBMIT));
    const divider: Rect = await box(
      page.getByTestId("sign-up-options-divider"),
    );
    const microsoft: Rect = await box(page.getByTestId("microsoft-sign-in"));

    expect(divider.top).toBeGreaterThanOrEqual(submit.bottom);
    expect(microsoft.top).toBeGreaterThanOrEqual(divider.bottom);
    expect(Math.abs(widthOf(microsoft) - widthOf(submit))).toBeLessThanOrEqual(
      0.5,
    );

    const result: Survey = await survey(
      page,
      SUPPORTED_ACCOUNTS_LANGUAGE_CODES,
      WIDTHS,
    );
    expect(result.problems).toEqual([]);
    expect(result.wrapped).toEqual(
      expect.arrayContaining([
        "ru at 320px: Зарегистрироваться через Microsoft",
      ]),
    );
  });

  test("a private status page: 'or', then Log in with SSO, as wide and as tall as Login, in every language", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=statuspage");
    await page.setViewportSize({ width: 390, height: 900 });

    const submit: Rect = await box(page.locator(SUBMIT));
    const sso: Rect = await box(page.getByTestId("sso-login"));
    expect(Math.abs(widthOf(sso) - widthOf(submit))).toBeLessThanOrEqual(0.5);
    expect(Math.abs(heightOf(sso) - heightOf(submit))).toBeLessThanOrEqual(0.5);

    const result: Survey = await survey(
      page,
      SUPPORTED_STATUS_PAGE_LANGUAGE_CODES,
      WIDTHS,
    );
    expect(result.problems).toEqual([]);
    expect(result.checked).toBe(
      SUPPORTED_STATUS_PAGE_LANGUAGE_CODES.length * WIDTHS.length,
    );
  });

  test("captures the sign-in options for visual review", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    const shots: Array<{ name: string; query: string; width: number }> = [
      { name: "login-en-1280", query: "page=login&ms=1", width: 1280 },
      { name: "login-es-390", query: "page=login&ms=1&lang=es", width: 390 },
      { name: "login-fa-390", query: "page=login&ms=1&lang=fa", width: 390 },
      { name: "sso-en-390", query: "page=sso&globalsso=1", width: 390 },
      {
        name: "status-page-de-390",
        query: "page=statuspage&lang=de",
        width: 390,
      },
    ];

    for (const shot of shots) {
      await page.setViewportSize({ width: shot.width, height: 900 });
      await open(page, shot.query);
      await page.screenshot({
        path: testInfo.outputPath(`${shot.name}.png`),
        fullPage: true,
      });
      await testInfo.attach(shot.name, {
        path: testInfo.outputPath(`${shot.name}.png`),
        contentType: "image/png",
      });
    }
  });
});
