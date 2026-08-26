import {
  countMatches,
  PAGE_FIXTURES,
  PageFixture,
  renderPage,
} from "./ReferenceFixtures";
import { describe, expect, it } from "@jest/globals";

/*
 * Structural invariants that hold on every page. These are the things that go
 * wrong quietly: a partial included three times leaves three copies of the same
 * id, an aria-controls survives a rename of the thing it pointed at, an icon
 * button loses the only text it had.
 */

const ALL_PAGES: Array<[string, PageFixture]> = Object.entries(PAGE_FIXTURES);

const HAS_ARIA_LABEL: RegExp = /aria-label="[^"]+"/;
const HAS_ANY_LABEL: RegExp = /aria-label(?:ledby)?="[^"]+"/;
const IS_ARIA_HIDDEN: RegExp = /aria-hidden="true"/;

/*
 * The lookbehind matters: a plain word boundary also matches the tail of
 * `data-panel-id="curl"`, which is not an id.
 */
function attributeValues(html: string, attribute: string): Array<string> {
  return Array.from(
    html.matchAll(new RegExp(`(?<![-\\w])${attribute}="([^"]+)"`, "g")),
  ).map((match: RegExpMatchArray) => {
    return match[1]!;
  });
}

function duplicates(values: Array<string>): Array<string> {
  const seen: Set<string> = new Set<string>();
  const repeated: Set<string> = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      repeated.add(value);
    }
    seen.add(value);
  }

  return Array.from(repeated);
}

describe.each(ALL_PAGES)("%s", (_name: string, fixture: PageFixture) => {
  it("has exactly one first-level heading", async () => {
    const html: string = await renderPage(fixture);

    expect(countMatches(html, /<h1[\s>]/g)).toBe(1);
  });

  it("uses every id once", async () => {
    const html: string = await renderPage(fixture);

    expect(duplicates(attributeValues(html, "id"))).toEqual([]);
  });

  it("points every aria-controls at something that exists", async () => {
    const html: string = await renderPage(fixture);
    const ids: Set<string> = new Set<string>(attributeValues(html, "id"));

    const dangling: Array<string> = attributeValues(
      html,
      "aria-controls",
    ).filter((target: string) => {
      return !ids.has(target);
    });

    expect(dangling).toEqual([]);
  });

  it("points every aria-labelledby at something that exists", async () => {
    const html: string = await renderPage(fixture);
    const ids: Set<string> = new Set<string>(attributeValues(html, "id"));

    const dangling: Array<string> = attributeValues(
      html,
      "aria-labelledby",
    ).filter((target: string) => {
      return !ids.has(target);
    });

    expect(dangling).toEqual([]);
  });

  it("gives every button a name a screen reader can read", async () => {
    const html: string = await renderPage(fixture);

    const nameless: Array<string> = Array.from(
      html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g),
    )
      .filter((match: RegExpMatchArray) => {
        const attributes: string = match[1]!;
        const inner: string = match[2]!;

        if (HAS_ARIA_LABEL.test(attributes)) {
          return false;
        }

        /* Otherwise it needs visible text, not just an icon. */
        const text: string = inner
          .replace(/<svg[\s\S]*?<\/svg>/g, "")
          .replace(/<[^>]+>/g, "")
          .trim();

        return text.length === 0;
      })
      .map((match: RegExpMatchArray) => {
        return match[0]!.slice(0, 120);
      });

    expect(nameless).toEqual([]);
  });

  it("labels every select", async () => {
    const html: string = await renderPage(fixture);

    for (const match of html.matchAll(/<select\b([^>]*)>/g)) {
      const attributes: string = match[1]!;
      const id: RegExpMatchArray | null = attributes.match(/\bid="([^"]+)"/);

      expect([
        attributes.slice(0, 80),
        HAS_ARIA_LABEL.test(attributes) &&
          Boolean(id) &&
          html.includes(`for="${id![1]!}"`),
      ]).toEqual([attributes.slice(0, 80), true]);
    }
  });

  it("keeps every element in the natural tab order", async () => {
    const html: string = await renderPage(fixture);

    /*
     * A positive tabindex jumps that element ahead of everything else on the
     * page, which is never what anybody meant.
     */
    const positive: Array<string> = attributeValues(html, "tabindex").filter(
      (value: string) => {
        return Number(value) > 0;
      },
    );

    expect(positive).toEqual([]);
  });

  it("names every navigation region", async () => {
    const html: string = await renderPage(fixture);

    const unlabelled: Array<string> = Array.from(
      html.matchAll(/<nav\b([^>]*)>/g),
    )
      .filter((match: RegExpMatchArray) => {
        return !HAS_ANY_LABEL.test(match[1]!);
      })
      .map((match: RegExpMatchArray) => {
        return match[0]!;
      });

    expect(unlabelled).toEqual([]);
  });

  it("marks decorative icons hidden from assistive technology", async () => {
    const html: string = await renderPage(fixture);

    const announced: Array<string> = Array.from(
      html.matchAll(/<svg\b([^>]*)>/g),
    )
      .filter((match: RegExpMatchArray) => {
        return !IS_ARIA_HIDDEN.test(match[1]!);
      })
      .map((match: RegExpMatchArray) => {
        return match[0]!.slice(0, 100);
      });

    expect(announced).toEqual([]);
  });
});

describe("landmarks", () => {
  it("gives the page a banner, a main region and a footer", async () => {
    const html: string = await renderPage(PAGE_FIXTURES["model"]!);

    expect(countMatches(html, /<header\b/g)).toBe(1);
    expect(countMatches(html, /<footer\b/g)).toBe(1);
    expect(countMatches(html, /id="reference-content"/g)).toBe(1);
  });

  it("hides the chrome when the page is printed", async () => {
    const html: string = await renderPage(PAGE_FIXTURES["model"]!);

    expect(html).toContain("@media print");
    /* Sidebar, top bar, drawer, pager, table of contents, footer. */
    expect(countMatches(html, /\bno-print\b/g)).toBeGreaterThanOrEqual(6);
  });

  it("respects a reader who has asked for less motion", async () => {
    const html: string = await renderPage(PAGE_FIXTURES["model"]!);

    expect(html).toContain("prefers-reduced-motion: reduce");
  });
});
