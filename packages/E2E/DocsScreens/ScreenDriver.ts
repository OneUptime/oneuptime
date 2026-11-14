import { expect, Locator, Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import {
  DocsScreenAction,
  DocsScreenFixture,
} from "../../App/FeatureSet/Docs/Screens/DocsScreenList";
import { DocsScreenFingerprint } from "../../App/FeatureSet/Docs/Screens/DocsScreenFingerprint";

/*
 * Puts a page in a docs shot's state and draws it (#6823): the steps of
 * DocsScreenList.ts, done the way a person does them, by what is on screen
 * in the language being drawn. The words of a step are the Dashboard's
 * English words, a key of its English locale, so each is looked up in the
 * locale of the language being drawn (Dashboard/src/Locales/<lang>.json),
 * as the Dashboard looks it up.
 */

const LOCALES: string = path.resolve(
  __dirname,
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

// The Dashboard's own key for the reader's language (DashboardLanguage.ts).
export const DASHBOARD_LANGUAGE_KEY: string = "oneuptimeLang";

/*
 * How long the page must be unchanged to be at rest: longer than the
 * pauses pages wait before they read (a rule's preview waits 600ms), as the
 * journeys' driver waits (Journeys/Journey.ts).
 */
const QUIET_MS: number = 700;

const DIALOG: string =
  '[data-testid="modal"], [data-testid="side-over"], .full-page-modal';

// Unicode's isolate marks, which a Persian sentence sets its values in.
const ISOLATE_MARKS: RegExp = /[⁦-⁩]/g;

/*
 * Counts how long the page has been unchanged, in the page, before its own
 * scripts run. Not a counter of anything a person does: only quiet.
 */
const QUIET_SCRIPT: string = `(() => {
  let last = performance.now();
  const observe = () => {
    new MutationObserver(() => { last = performance.now(); }).observe(
      document.documentElement,
      { childList: true, subtree: true, characterData: true, attributes: true },
    );
  };
  if (document.documentElement) { observe(); } else { document.addEventListener("DOMContentLoaded", observe); }
  window.__docsScreensQuietFor = () => {
    const root = document.getElementById("root");
    if (document.readyState !== "complete" || (root && root.childElementCount === 0)) { return -1; }
    const moving = document.getAnimations().some((animation) => {
      const timing = animation.effect ? animation.effect.getComputedTiming() : null;
      return animation.playState === "running" && timing && Number.isFinite(Number(timing.endTime));
    });
    return moving ? -1 : performance.now() - last;
  };
})();`;

const localeCache: Map<string, Record<string, string>> = new Map();

// A language's Dashboard words, by their English key.
export function localeOf(lang: string): Record<string, string> {
  let locale: Record<string, string> | undefined = localeCache.get(lang);

  if (!locale) {
    locale =
      lang === "en"
        ? {}
        : (JSON.parse(
            fs.readFileSync(path.join(LOCALES, `${lang}.json`), "utf8"),
          ) as Record<string, string>);
    localeCache.set(lang, locale);
  }

  return locale;
}

// The Dashboard's English words as a language draws them.
export function wordsIn(lang: string, english: string): string {
  const translated: unknown = localeOf(lang)[english];

  return typeof translated === "string" && translated.trim()
    ? translated
    : english;
}

/*
 * A name as a language draws it, as a pattern: the whole name, or words it
 * contains, with any isolate marks the page sets around a value let through.
 */
function namePattern(
  lang: string,
  english: string,
  exact: boolean = true,
): RegExp {
  const words: string = wordsIn(lang, english)
    .replace(ISOLATE_MARKS, "")
    .trim();
  const body: string = words
    .split(/\s+/)
    .map((word: string): string => {
      return Array.from(word)
        .map((character: string): string => {
          return escapeRegExp(character);
        })
        .join("[\\u2066-\\u2069]*");
    })
    .join("[\\s\\u2066-\\u2069]+");

  return exact
    ? new RegExp(`^[\\s\\u2066-\\u2069]*${body}[\\s\\u2066-\\u2069]*$`)
    : new RegExp(body, "i");
}

export default class ScreenDriver {
  public readonly page: Page;
  public readonly lang: string;

  public constructor(page: Page, lang: string) {
    this.page = page;
    this.lang = lang;
  }

  /*
   * Before anything opens: quiet is counted, the clock is the fixture's, and
   * a fixture that mounts the Dashboard's own i18n reads the language from
   * where the Dashboard keeps it.
   */
  public static async prepare(
    page: Page,
    fixture: DocsScreenFixture,
    lang: string,
  ): Promise<void> {
    await page.addInitScript({ content: QUIET_SCRIPT });
    if (fixture.languageBy === "storage") {
      await page.addInitScript(
        ({ key, value }: { key: string; value: string }) => {
          try {
            window.localStorage.setItem(key, value);
          } catch {
            // A page that cannot keep it draws English: the shot says so.
          }
        },
        { key: DASHBOARD_LANGUAGE_KEY, value: lang },
      );
    }
    await page.clock.setFixedTime(new Date(fixture.now));
  }

  // Waits until nothing on the page has changed for QUIET_MS.
  public async settle(): Promise<void> {
    await expect
      .poll(
        async () => {
          try {
            return await this.page.evaluate(() => {
              const quietFor: (() => number) | undefined = (
                window as unknown as { __docsScreensQuietFor?: () => number }
              ).__docsScreensQuietFor;
              return quietFor ? quietFor() : -1;
            });
          } catch {
            // The page is between two documents.
            return -1;
          }
        },
        { intervals: [100, 100, 150, 250], timeout: 30000 },
      )
      .toBeGreaterThanOrEqual(QUIET_MS);
  }

  public async open(url: string): Promise<void> {
    await this.page.goto(url);
    await this.settle();
  }

  // Where the person works now: the dialog on top, or the whole page.
  private async workArea(): Promise<Locator> {
    const dialogs: Locator = this.page.locator(`${DIALOG} >> visible=true`);

    if ((await dialogs.count()) > 0) {
      return dialogs.last();
    }

    return this.page.locator("body");
  }

  // A button or a link, by its words, in the language being drawn.
  public button(area: Locator, english: string, exact?: boolean): Locator {
    const name: RegExp = namePattern(this.lang, english, exact !== false);

    return area
      .getByRole("button", { name })
      .or(area.getByRole("link", { name }));
  }

  public async act(action: DocsScreenAction): Promise<void> {
    await this.settle();
    const area: Locator = await this.workArea();

    if ("press" in action) {
      await this.button(area, action.press, action.exact).first().click();
    } else if ("tick" in action) {
      const name: RegExp = action.asWritten
        ? namePattern("en", action.tick)
        : namePattern(this.lang, action.tick);
      await area.getByRole("checkbox", { name }).first().click();
    } else if ("type" in action) {
      const field: Locator = area
        .getByLabel(namePattern(this.lang, action.type, action.exact !== false))
        .first();
      await field.click();
      await field.fill(action.value);
    } else if ("option" in action) {
      await this.page
        .getByRole("listbox")
        .getByRole("option", {
          name: new RegExp(`^${escapeRegExp(action.option)}`),
        })
        .first()
        .click();
    } else if ("escape" in action) {
      await this.page.keyboard.press("Escape");
    } else if ("waitFor" in action) {
      await expect(this.page.getByTestId(action.waitFor).first()).toBeVisible({
        timeout: 30000,
      });
    }

    await this.settle();
  }

  // What the shot is cropped to: the first visible match of its selector.
  public crop(selector: string): Locator {
    return this.page.locator(`${selector} >> visible=true`).first();
  }

  /*
   * What a shot says and how it is built, read from the page
   * (DocsScreenFingerprint.ts).
   */
  public async fingerprint(crop: Locator): Promise<DocsScreenFingerprint> {
    return await crop.evaluate((element: Element): DocsScreenFingerprint => {
      const clean: (text: string) => string = (text: string): string => {
        return text.replace(/[⁦-⁩]/g, "").replace(/\s+/g, " ").trim();
      };
      const visible: (node: Element) => boolean = (node: Element): boolean => {
        return (node as HTMLElement).checkVisibility
          ? (node as HTMLElement).checkVisibility()
          : true;
      };
      const text: Array<string> = (element as HTMLElement).innerText
        .split("\n")
        .map(clean)
        .filter(Boolean);

      for (const field of Array.from(
        element.querySelectorAll("input, textarea, select"),
      )) {
        const input: HTMLInputElement = field as HTMLInputElement;
        if (!visible(input) || input.type === "hidden") {
          continue;
        }
        if (input.type === "checkbox" || input.type === "radio") {
          text.push(`${input.type}: ${input.checked ? "on" : "off"}`);
        } else if (input.value) {
          text.push(`value: ${clean(input.value)}`);
        } else if (input.placeholder) {
          text.push(`placeholder: ${clean(input.placeholder)}`);
        }
      }

      const outline: Array<string> = [];
      for (const node of Array.from(
        element.querySelectorAll(
          'h1, h2, h3, h4, h5, h6, button, a[href], input, textarea, select, [role="button"], [role="switch"], [role="checkbox"], [role="combobox"]',
        ),
      )) {
        if (!visible(node) || (node as HTMLInputElement).type === "hidden") {
          continue;
        }
        const tag: string = node.tagName.toLowerCase();
        const isHeading: boolean = [
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
        ].includes(tag);
        const kind: string = node.getAttribute("role")
          ? (node.getAttribute("role") as string)
          : isHeading
            ? "heading"
            : tag === "a"
              ? "link"
              : tag === "input"
                ? `field ${(node as HTMLInputElement).type || "text"}`
                : tag === "button"
                  ? "button"
                  : "field";
        const name: string = clean(
          node.getAttribute("aria-label") ||
            (node as HTMLElement).innerText ||
            (node as HTMLInputElement).placeholder ||
            "",
        ).slice(0, 80);
        outline.push(`${kind}: ${name}`);
      }

      const box: DOMRect = element.getBoundingClientRect();

      return {
        text,
        outline,
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
    });
  }

  /*
   * Draws the crop: no focus ring or hover left over from the steps, the
   * next thing to press ringed, and the page's pixels at the context's
   * ratio, as PNG.
   */
  public async draw(
    crop: Locator,
    padding: number,
    highlight: string | undefined,
  ): Promise<Buffer> {
    await this.page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await this.page.mouse.move(0, 0);

    if (highlight) {
      const target: Locator = this.button(crop, highlight).first();
      await target.evaluate((element: Element) => {
        const box: DOMRect = element.getBoundingClientRect();
        const ring: HTMLDivElement = document.createElement("div");
        ring.setAttribute("data-docs-screens-ring", "");
        ring.style.cssText = [
          "position:absolute",
          `left:${box.left + window.scrollX - 5}px`,
          `top:${box.top + window.scrollY - 5}px`,
          `width:${box.width + 10}px`,
          `height:${box.height + 10}px`,
          "border:3px solid #f97316",
          "border-radius:10px",
          "pointer-events:none",
          "z-index:2147483647",
          "box-sizing:border-box",
        ].join(";");
        document.body.appendChild(ring);
      });
    }

    await this.settle();
    const box: { x: number; y: number; width: number; height: number } =
      await crop.evaluate((element: Element) => {
        const rect: DOMRect = element.getBoundingClientRect();
        return {
          x: rect.left + window.scrollX,
          y: rect.top + window.scrollY,
          width: rect.width,
          height: rect.height,
        };
      });
    // A ring sticks out of the crop by 5px: the picture holds it whole.
    const margin: number = padding + (highlight ? 6 : 0);
    const x: number = Math.max(0, Math.floor(box.x - margin));
    const y: number = Math.max(0, Math.floor(box.y - margin));
    const clip: { x: number; y: number; width: number; height: number } = {
      x,
      y,
      width: Math.ceil(box.x + box.width + margin) - x,
      height: Math.ceil(box.y + box.height + margin) - y,
    };

    const png: Buffer = await this.page.screenshot({
      clip,
      fullPage: true,
      animations: "disabled",
      caret: "hide",
    });

    await this.page.evaluate(() => {
      for (const ring of Array.from(
        document.querySelectorAll("[data-docs-screens-ring]"),
      )) {
        ring.remove();
      }
    });

    return png;
  }
}
