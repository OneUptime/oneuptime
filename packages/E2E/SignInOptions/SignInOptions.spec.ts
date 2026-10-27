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
 * While the whole server requires single sign-on (#5193) the sign-in pages
 * are the instance-wide providers' buttons alone - the one provider the
 * page's filled button - and the email lookup only when some project has a
 * provider of its own; the master admins' page is the password form alone.
 * The providers are drawn as the other ways in are, so they are held to the
 * same checks.
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
  // An instance-wide single sign-on provider (SsoProviderOptions).
  '[data-testid="sso-provider"]',
  // A provider of a project an address belongs to, after the email lookup.
  '[data-testid="sso-project-provider"]',
].join(", ");
/*
 * Every divider with words in its middle: "or" over the other ways in, and
 * the single sign-on page's "Or continue with email" under its providers,
 * whose hairlines once shrank to nothing at 320px in long languages.
 */
const DIVIDERS: string = [
  '[data-testid="sign-in-options-divider"]',
  '[data-testid="sign-up-options-divider"]',
  '[data-testid="global-providers-divider"]',
].join(", ");
// The page's own filled button: Sign in, Sign in with SSO, Sign Up.
const SUBMIT: string = '[id$="-form-submit-button"]';
// Between the instance-wide providers and the email lookup.
const PROVIDERS_DIVIDER: string = '[data-testid="global-providers-divider"]';

// Button's PRIMARY: white words on indigo-600.
const FILLED_LOOK: { background: string; color: string } = {
  background: "rgb(79, 70, 229)",
  color: "rgb(255, 255, 255)",
};

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

interface DividerGeometry {
  testId: string;
  words: Rect | null;
  // The words, line by line.
  wordLines: Array<Rect>;
  hairlines: Array<Rect>;
}

interface PageGeometry {
  submit: Rect | null;
  dividers: Array<DividerGeometry>;
  options: Array<OptionGeometry>;
  scrollsSideways: boolean;
}

/*
 * The page as drawn. `dividers` picks the dividers to measure, every one it
 * matches; null for a page that has none.
 */
const measure: (
  page: Page,
  dividers?: string | null,
) => Promise<PageGeometry> = async (
  page: Page,
  dividers: string | null = DIVIDERS,
): Promise<PageGeometry> => {
  return page.evaluate(
    (selectors: {
      options: string;
      dividers: string | null;
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

      const dividers: Array<DividerGeometry> = selectors.dividers
        ? Array.from(document.querySelectorAll(selectors.dividers)).map(
            (divider: Element): DividerGeometry => {
              const words: Element | undefined = divider.children[1];

              return {
                testId: divider.getAttribute("data-testid") || "",
                words: words ? rectOf(words) : null,
                wordLines: words ? linesOf(textOf(words)) : [],
                hairlines: Array.from(
                  divider.querySelectorAll('[aria-hidden="true"]'),
                ).map(rectOf),
              };
            },
          )
        : [];
      const submit: Element | null = document.querySelector(selectors.submit);

      return {
        submit: submit ? rectOf(submit) : null,
        dividers,
        options,
        scrollsSideways:
          document.documentElement.scrollWidth > window.innerWidth,
      };
    },
    { options: OPTIONS, dividers: dividers, submit: SUBMIT },
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
 * What is wrong with a divider, as drawn: its words between two hairlines
 * that never shrink to nothing, each centred on the words, and words that
 * wrap doing so onto lines of about even length (text-balance), not one
 * long line and a word left alone under it.
 */
const dividerProblems: (geometry: DividerGeometry) => Array<string> = (
  geometry: DividerGeometry,
): Array<string> => {
  const words: Rect | null = geometry.words;
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
  if (geometry.wordLines.length > 1) {
    const widths: Array<number> = geometry.wordLines.map(widthOf);
    const shortest: number = Math.min(...widths);
    const longest: number = Math.max(...widths);

    if (shortest < longest / 2) {
      problems.push(
        `its words wrap unevenly: lines of ${widths
          .map((width: number): string => {
            return `${width.toFixed(0)}px`;
          })
          .join(" and ")}`,
      );
    }
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
 * page's language in place (window.__setLanguage). `dividers` names the
 * dividers the page has: it must have one, and each is held to
 * dividerProblems; null for a page with none.
 */
const survey: (
  page: Page,
  languages: ReadonlyArray<string>,
  widths: ReadonlyArray<number>,
  dividers?: string | null,
) => Promise<Survey> = async (
  page: Page,
  languages: ReadonlyArray<string>,
  widths: ReadonlyArray<number>,
  dividers: string | null = DIVIDERS,
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

      const geometry: PageGeometry = await measure(page, dividers);
      const where: string = `${language} at ${width}px`;

      if (geometry.scrollsSideways) {
        result.problems.push(`${where}: the page scrolls sideways`);
      }
      if (dividers && geometry.dividers.length === 0) {
        result.problems.push(`${where}: the page has no divider`);
      }
      for (const divider of geometry.dividers) {
        for (const problem of dividerProblems(divider)) {
          result.problems.push(
            `${where}: the divider ${divider.testId} - ${problem}`,
          );
        }
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
  test("the sign-in page: under Sign in, 'or', then single sign-on, Microsoft and the passkey, each as wide as Sign in and as tall", async ({
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

  test("the single sign-on page: 'or', then Sign in with password, as wide and as tall as Sign in with SSO, in every language", async ({
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

  /*
   * "Or continue with email" filled a 320px row in long languages and its
   * hairlines shrank to nothing (#4911's review). Now each keeps 1.5rem and
   * the words wrap, balanced, between them; the survey above checks every
   * divider of the page, this one included, at every width.
   */
  test("the single sign-on page: 'Or continue with email' keeps both hairlines at 320px in every language, its words wrapping evenly", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=sso&globalsso=1");

    const wrapped: Array<string> = [];

    await page.setViewportSize({ width: 320, height: 900 });
    for (const language of SUPPORTED_ACCOUNTS_LANGUAGE_CODES) {
      await page.evaluate(async (code: string): Promise<void> => {
        await (
          window as unknown as {
            __setLanguage: (language: string) => Promise<void>;
          }
        ).__setLanguage(code);
      }, language);

      const geometry: PageGeometry = await measure(page);
      const providers: DividerGeometry | undefined = geometry.dividers.find(
        (divider: DividerGeometry): boolean => {
          return divider.testId === "global-providers-divider";
        },
      );

      expect(providers, `${language}: the providers' divider`).toBeTruthy();
      expect(dividerProblems(providers!), language).toEqual([]);
      for (const hairline of providers!.hairlines) {
        expect(widthOf(hairline)).toBeGreaterThanOrEqual(SHORTEST_HAIRLINE);
      }
      if (providers!.wordLines.length > 1) {
        wrapped.push(language);
      }
    }

    // The long languages this was about do wrap at 320px.
    expect(wrapped).toEqual(expect.arrayContaining(["ru"]));
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

  /*
   * A self-hosted server with no account yet (fu-platform): the sign-up page
   * says the account made there becomes the server's admin, under its
   * title, and offers no way to sign in - there is nobody to sign in as. The
   * line wraps inside its column at every width, in every language.
   */
  test("the sign-up page of a server with no account yet: its line under the title, and no way to sign in, in every language", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=register&ms=1&firstaccount=1");

    const line: Locator = page.getByTestId("register-subtitle");
    await expect(line).toHaveText(
      "This OneUptime server has no accounts yet. The account you create now becomes its admin.",
    );
    await expect(page.getByTestId("register-have-account")).toHaveCount(0);
    await expect(page.locator('a[href="/accounts/login"]')).toHaveCount(0);

    const problems: Array<string> = [];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      for (const language of SUPPORTED_ACCOUNTS_LANGUAGE_CODES) {
        await page.evaluate(async (code: string): Promise<void> => {
          await (
            window as unknown as {
              __setLanguage: (language: string) => Promise<void>;
            }
          ).__setLanguage(code);
        }, language);

        const fits: {
          scrollsSideways: boolean;
          lineOverflows: boolean;
          lineIsEmpty: boolean;
        } = await line.evaluate(
          (
            element: Element,
          ): {
            scrollsSideways: boolean;
            lineOverflows: boolean;
            lineIsEmpty: boolean;
          } => {
            return {
              scrollsSideways:
                document.documentElement.scrollWidth > window.innerWidth,
              lineOverflows: element.scrollWidth > element.clientWidth + 1,
              lineIsEmpty: (element.textContent || "").trim().length === 0,
            };
          },
        );

        if (fits.scrollsSideways || fits.lineOverflows || fits.lineIsEmpty) {
          problems.push(`${language} at ${width}px: ${JSON.stringify(fits)}`);
        }
      }
    }

    expect(problems).toEqual([]);
    await expect(page.locator('a[href="/accounts/login"]')).toHaveCount(0);
  });

  test("the sign-up page of a server that has accounts: no line under the title, and the way to sign in", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=register&ms=1");

    await expect(page.getByTestId("register-subtitle")).toHaveCount(0);
    await expect(page.getByTestId("register-have-account")).toBeVisible();
    await expect(page.locator('a[href="/accounts/login"]')).toHaveCount(1);
  });

  test("a private status page: 'or', then Log in with SSO, as wide and as tall as its Login, in every language", async ({
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

  /*
   * #5193: while the whole server requires SSO, "only the configured SSO
   * login option should be displayed". The sign-in, single sign-on and
   * sign-up pages are then the one provider's button, filled as the page's
   * own button is, and nothing else.
   */
  test("while the server requires SSO, each sign-in page is its one provider, filled, and nothing else", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const name of ["login", "sso", "register"]) {
      await open(page, `page=${name}&ssorequired=1`);

      await expect(page.getByTestId("sso-provider")).toHaveCount(1);
      for (const testId of [
        "email",
        "password",
        "sso-login",
        "microsoft-sign-in",
        "passkey-login",
        "password-login",
        "sign-in-options-divider",
        "sign-up-options-divider",
        "global-providers-divider",
      ]) {
        await expect(page.getByTestId(testId)).toHaveCount(0);
      }
      await expect(page.locator(SUBMIT)).toHaveCount(0);
      // No way to sign up, and no password to forget.
      await expect(page.locator('a[href="/accounts/register"]')).toHaveCount(0);
      await expect(page.locator('a[href*="forgot-password"]')).toHaveCount(0);

      const provider: Locator = page.getByTestId("sso-provider");
      expect(
        await provider.evaluate(
          (element: Element): { background: string; color: string } => {
            const style: CSSStyleDeclaration = window.getComputedStyle(element);
            return { background: style.backgroundColor, color: style.color };
          },
        ),
      ).toEqual(FILLED_LOOK);

      // As tall as the pages' filled buttons: 38px from md, 42px below.
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        expect(Math.round(heightOf(await box(provider)))).toBe(
          width >= 768 ? 38 : 42,
        );
      }
    }
  });

  test("while the server requires SSO, the provider keeps its icon right before its words, in every language, from 320px up", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=login&ssorequired=1");

    const result: Survey = await survey(
      page,
      SUPPORTED_ACCOUNTS_LANGUAGE_CODES,
      WIDTHS,
      null,
    );

    expect(result.problems).toEqual([]);
    expect(result.checked).toBe(
      SUPPORTED_ACCOUNTS_LANGUAGE_CODES.length * WIDTHS.length,
    );
  });

  /*
   * Several providers, and a project with one of its own: each provider an
   * outlined option, as wide and as tall as the email lookup's button below
   * them, and "or" between them. No way back to a password.
   */
  test("while the server requires SSO, several providers are outlined options above the email lookup, as wide and as tall as its button", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=login&ssorequired=1&providers=3&projectsso=1");

    await expect(page.getByTestId("sso-provider")).toHaveCount(3);
    for (const testId of [
      "password",
      "password-login",
      "sign-in-options-divider",
      "passkey-login",
      "microsoft-sign-in",
    ]) {
      await expect(page.getByTestId(testId)).toHaveCount(0);
    }
    await expect(page.locator('a[href="/accounts/register"]')).toHaveCount(0);

    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const submit: Rect = await box(page.locator(SUBMIT));
      const divider: Rect = await box(page.locator(PROVIDERS_DIVIDER));
      let above: Rect | null = null;

      for (const provider of await page.getByTestId("sso-provider").all()) {
        const rect: Rect = await box(provider);

        if (above) {
          expect(rect.top).toBeGreaterThanOrEqual(above.bottom);
        }
        expect(Math.abs(rect.left - submit.left)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(widthOf(rect) - widthOf(submit))).toBeLessThanOrEqual(
          0.5,
        );
        expect(Math.abs(heightOf(rect) - heightOf(submit))).toBeLessThanOrEqual(
          0.5,
        );
        expect(
          await provider.evaluate((element: Element): string => {
            return window.getComputedStyle(element).backgroundColor;
          }),
        ).not.toBe(FILLED_LOOK.background);
        above = rect;
      }

      expect(divider.top).toBeGreaterThanOrEqual(above!.bottom);
      expect(submit.top).toBeGreaterThanOrEqual(divider.bottom);
    }

    const result: Survey = await survey(
      page,
      SUPPORTED_ACCOUNTS_LANGUAGE_CODES,
      WIDTHS,
      PROVIDERS_DIVIDER,
    );

    expect(result.problems).toEqual([]);
    expect(result.checked).toBe(
      SUPPORTED_ACCOUNTS_LANGUAGE_CODES.length * WIDTHS.length * 3,
    );
  });

  /*
   * The email lookup, kept while some project has a provider of its own:
   * the address stays in its field whatever the answer - the page gave way
   * to a loader and came back empty, under a message naming the address
   * (the screenshot in #5193) - and an address's projects are listed as
   * their providers' buttons, drawn as every other way in and held to the
   * same checks, with the way back to the form.
   */
  test("while the server requires SSO, the email lookup keeps its address, and lists an address's projects as their providers' buttons", async ({
    page,
  }: {
    page: Page;
  }) => {
    const lookUp: () => Promise<void> = async (): Promise<void> => {
      await page.getByTestId("email").fill("ada@example.com");
      await page.locator(SUBMIT).click();
    };

    // An address that finds nothing: the message names it, and it stays.
    await open(page, "page=login&ssorequired=1&providers=1&projectsso=1");
    await lookUp();

    await expect(
      page.getByText(
        "No SSO configuration found for the email: ada@example.com",
      ),
    ).toBeVisible();
    await expect(page.getByTestId("email")).toHaveValue("ada@example.com");

    // An address in two projects: their providers' buttons, by project.
    await open(
      page,
      "page=login&ssorequired=1&providers=1&projectsso=1&lookup=found",
    );
    await lookUp();

    await expect(page.getByTestId("sso-projects")).toBeVisible();
    await expect(page.getByTestId("sso-project")).toHaveCount(2);
    await expect(page.getByTestId("sso-project-provider")).toHaveCount(3);
    await expect(page.getByTestId("email")).toHaveCount(0);

    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const card: Rect = await box(page.getByTestId("sso-projects"));
      let first: Rect | null = null;

      for (const provider of await page
        .getByTestId("sso-project-provider")
        .all()) {
        const rect: Rect = await box(provider);

        // One column of outlined buttons, as wide as each other, in the card.
        if (first) {
          expect(Math.abs(rect.left - first.left)).toBeLessThanOrEqual(0.5);
          expect(Math.abs(widthOf(rect) - widthOf(first))).toBeLessThanOrEqual(
            0.5,
          );
        }
        expect(rect.left).toBeGreaterThan(card.left);
        expect(rect.right).toBeLessThan(card.right);
        expect(
          await provider.evaluate((element: Element): string => {
            return window.getComputedStyle(element).backgroundColor;
          }),
        ).not.toBe(FILLED_LOOK.background);
        first = first || rect;
      }
    }

    const result: Survey = await survey(
      page,
      SUPPORTED_ACCOUNTS_LANGUAGE_CODES,
      WIDTHS,
      null,
    );

    expect(result.problems).toEqual([]);
    expect(result.checked).toBe(
      SUPPORTED_ACCOUNTS_LANGUAGE_CODES.length * WIDTHS.length * 3,
    );

    // The way back: the form, with the address still in it.
    await page.getByTestId("sso-use-different-email").click();

    await expect(page.getByTestId("email")).toHaveValue("ada@example.com");
    await expect(page.getByTestId("sso-projects")).toHaveCount(0);
  });

  /*
   * The master admins' way in while SSO is required (/accounts/admin-login):
   * the password form, and under "or" the way to SSO - no provider, passkey,
   * Microsoft or sign-up - in every language and never wider than a phone.
   */
  test("while the server requires SSO, the master admins' page is the password form and the way to SSO, in every language", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "page=adminlogin&ssorequired=1&ms=1");

    await expect(page.getByTestId("email")).toHaveCount(1);
    await expect(page.getByTestId("password")).toHaveCount(1);
    // SSO stays one click away, under "or"; nothing the server would refuse.
    await expect(page.locator(OPTIONS)).toHaveCount(1);
    await expect(page.getByTestId("sso-login")).toHaveAttribute(
      "href",
      "/accounts/sso",
    );
    await expect(page.locator('a[href="/accounts/register"]')).toHaveCount(0);

    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const login: Rect = await box(page.locator(SUBMIT));
      const sso: Rect = await box(page.getByTestId("sso-login"));

      expect(sso.top).toBeGreaterThanOrEqual(login.bottom);
      expect(Math.abs(widthOf(sso) - widthOf(login))).toBeLessThanOrEqual(0.5);
    }

    const result: Survey = await survey(
      page,
      SUPPORTED_ACCOUNTS_LANGUAGE_CODES,
      WIDTHS,
    );

    expect(result.problems).toEqual([]);
    expect(result.checked).toBe(
      SUPPORTED_ACCOUNTS_LANGUAGE_CODES.length * WIDTHS.length,
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
      // While the whole server requires SSO.
      {
        name: "sso-required-en-390",
        query: "page=login&ssorequired=1",
        width: 390,
      },
      {
        name: "sso-required-providers-de-1280",
        query: "page=login&ssorequired=1&providers=3&projectsso=1&lang=de",
        width: 1280,
      },
      {
        name: "sso-required-fa-390",
        query: "page=login&ssorequired=1&providers=2&lang=fa",
        width: 390,
      },
      {
        name: "sso-required-admin-login-en-390",
        query: "page=adminlogin&ssorequired=1",
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
