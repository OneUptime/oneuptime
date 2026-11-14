import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { SiteHeroTileTitle } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteStatusHero";
import NetworkMapSection from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/NetworkMapSection";
import { NETWORK_SITE_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/NetworkSiteMetricDescriptions";
import { INFO_GLUE_ATTRIBUTE } from "../../../UI/Components/Tooltip/WordsWithInfoTooltip";
import { WORDS_KEEP_INFO_ROOM_CLASS_NAME } from "../../../UI/Components/HyphenatedWords/WordsBeforeInfo";
import {
  DrawnLine,
  drawLine,
  isDrawnAsWritten,
} from "../../Helpers/BidiLayout";

/*
 * A network site's hero titles and the Network Map's section headings, with
 * their (i) after their last word (issue #7348), in the reader's language.
 *
 * The (i) used to be each title's flex sibling, so a title that wrapped
 * pushed it to the far edge of its tile. It is now inside the element that
 * holds the title's words, right after the last word. The Network Map's
 * section headings drew their title, hint and count in English whatever the
 * reader's language, though every one of them is in the locale files: they
 * are drawn in the reader's words and digits now.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const EN: Record<string, string> = readLocale("en");
const DE: Record<string, string> = readLocale("de");
const AR: Record<string, string> = readLocale("ar");

// The locale's own words for `key`, which must differ from the English.
function worded(locale: Record<string, string>, key: string): string {
  const text: string | undefined = locale[key];

  expect({ key, translated: Boolean(text) && text !== EN[key] }).toEqual({
    key,
    translated: true,
  });

  return text as string;
}

// The box that holds the (i) after the title's last word.
function glueOf(element: HTMLElement): HTMLElement | null {
  return element.querySelector<HTMLElement>(`[${INFO_GLUE_ATTRIBUTE}]`);
}

/*
 * The (i) right after the words: its box holds it alone, the words before
 * it are `words`, as one text, and their element keeps the (i)'s room free
 * at the end of every line.
 */
function expectGluedAfter(
  element: HTMLElement,
  words: string,
  info: HTMLElement,
): void {
  const glue: HTMLElement | null = glueOf(element);

  expect(glue).not.toBeNull();
  expect(glue).toHaveClass("whitespace-nowrap");
  expect(glue!.firstChild).toBe(info);
  expect(glue!.previousSibling?.nodeType).toBe(Node.TEXT_NODE);
  expect(glue!.previousSibling?.textContent).toBe(words);
  expect(glue!.parentElement).toHaveClass(
    ...WORDS_KEEP_INFO_ROOM_CLASS_NAME.split(" "),
  );
}

// The one character a box of its own is to the line around it (U+FFFC).
const OBJECT: string = String.fromCharCode(0xfffc);

/*
 * An element's line as the bidirectional algorithm reads it: its text, and
 * each box of its own in it - an inline block, a button - as one object
 * character, where it starts.
 */
function lineOf(element: HTMLElement): {
  text: string;
  at: Map<Element, number>;
} {
  let text: string = "";
  const at: Map<Element, number> = new Map<Element, number>();

  const walk: (node: Node) => void = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent || "";
        continue;
      }

      if (!(child instanceof HTMLElement)) {
        continue;
      }

      if (
        child.tagName === "BUTTON" ||
        child.classList.contains("inline-block")
      ) {
        at.set(child, text.length);
        text += OBJECT;
        continue;
      }

      walk(child);
    }
  };

  walk(element);

  return { text, at };
}

const SITES_HINT: string = "Click a site to open it.";

function renderSitesSection(count: number): void {
  render(
    <NetworkMapSection
      title="Sites"
      count={count}
      hint={SITES_HINT}
      description={NETWORK_SITE_METRIC_DESCRIPTIONS.siteCards}
    >
      <div>cards</div>
    </NetworkMapSection>,
  );
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      ar: { translation: AR },
      en: { translation: EN },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("en");
});

afterEach(() => {
  cleanup();
});

describe("a site's hero tile title", () => {
  test("its (i) is inside the title, after its last word, still named for the title", () => {
    render(
      <SiteHeroTileTitle
        title="Uptime (30d)"
        description={NETWORK_SITE_METRIC_DESCRIPTIONS.uptime30d}
      />,
    );

    const title: HTMLElement = screen.getByTestId("site-hero-tile-title");
    const info: HTMLElement = screen.getByRole("button", {
      name: "About Uptime (30d)",
    });

    expect(title.textContent).toBe("Uptime (30d)");
    expect(title).toContainElement(info);
    expectGluedAfter(title, "Uptime (30d)", info);
    // Found by its words, as before.
    expect(title).toContainElement(screen.getByText("Uptime (30d)"));
    // No longer a row the (i) is pushed to the end of.
    expect(title).not.toHaveClass("flex");
  });

  test.each([
    ["de", DE],
    ["ar", AR],
  ])(
    "%s: the title in the locale's words, the (i) after its last one",
    async (language: string, locale: Record<string, string>) => {
      await i18next.changeLanguage(language);
      render(
        <SiteHeroTileTitle
          title="Discovered Devices"
          description={NETWORK_SITE_METRIC_DESCRIPTIONS.endpoints}
        />,
      );

      const translated: string = worded(locale, "Discovered Devices");
      const title: HTMLElement = screen.getByTestId("site-hero-tile-title");

      expect(title.textContent).toBe(translated);
      expectGluedAfter(
        title,
        translated,
        screen.getByRole("button", {
          name: worded(locale, "About {{label}}").replace(
            "{{label}}",
            translated,
          ),
        }),
      );
    },
  );

  test("Site Type names something: no (i), no glue", () => {
    render(<SiteHeroTileTitle title="Site Type" />);

    const title: HTMLElement = screen.getByTestId("site-hero-tile-title");
    expect(title.textContent).toBe("Site Type");
    expect(screen.queryByRole("button")).toBeNull();
    expect(glueOf(title)).toBeNull();
  });
});

describe("a Network Map section's heading", () => {
  test("English: the (i) after the title's last word, the count after the (i), all in the heading", () => {
    renderSitesSection(12);

    const heading: HTMLElement = screen.getByTestId(
      "network-map-section-title",
    );
    const info: HTMLElement = screen.getByRole("button", {
      name: "About Sites",
    });

    expect(heading.tagName).toBe("H3");
    expect(heading).toContainElement(info);
    expectGluedAfter(heading, "Sites", info);

    const count: HTMLElement = heading.lastElementChild as HTMLElement;
    expect(count.textContent).toBe("12");
    expect(count).toHaveClass("ms-1.5", "tabular-nums");
    expect(
      info.compareDocumentPosition(count) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(heading.textContent).toBe("Sites12");
    expect(screen.getByText(SITES_HINT)).toBeInTheDocument();
  });

  test.each([
    ["de", DE, "1.234"],
    ["ar", AR, "1,234"],
  ])(
    "%s: the title, the hint and the count in the locale's words and digits",
    async (language: string, locale: Record<string, string>, count: string) => {
      await i18next.changeLanguage(language);
      renderSitesSection(1234);

      const heading: HTMLElement = screen.getByTestId(
        "network-map-section-title",
      );
      const title: string = worded(locale, "Sites");

      expect(heading.textContent).toBe(`${title}${count}`);
      expect((heading.lastElementChild as HTMLElement).textContent).toBe(count);
      expect(screen.queryByText("Sites")).toBeNull();
      expect(screen.getByText(worded(locale, SITES_HINT))).toBeInTheDocument();
      expect(screen.queryByText(SITES_HINT)).toBeNull();
      expect(heading).toContainElement(
        screen.getByRole("button", {
          name: worded(locale, "About {{label}}").replace("{{label}}", title),
        }),
      );
    },
  );

  test("Arabic: a title that ends in Latin letters keeps its count after it, not drawn between its words", async () => {
    await i18next.changeLanguage("ar");
    render(
      <div dir="rtl">
        <NetworkMapSection
          title="WAN links"
          count={3}
          hint="Connections between these top-level sites."
        >
          <div>links</div>
        </NetworkMapSection>
      </div>,
    );

    const heading: HTMLElement = screen.getByTestId(
      "network-map-section-title",
    );
    const title: string = worded(AR, "WAN links");
    // "روابط WAN": an Arabic word, then a Latin one.
    expect(title.endsWith("WAN")).toBe(true);

    /*
     * The count is a box of its own: to the line it is one neutral object
     * after the title, which a right-to-left line draws at its far left -
     * after the whole title, as it is read.
     */
    const count: HTMLElement = screen.getByTestId("network-map-section-count");
    expect(count.textContent).toBe("3");
    expect(count).toHaveClass("inline-block", "ms-1.5");

    const line: { text: string; at: Map<Element, number> } = lineOf(heading);
    expect(line.text).toBe(`${title}${OBJECT}`);
    const drawn: DrawnLine = drawLine(line.text, "rtl");
    expect(drawn.drawnAt[line.at.get(count)!]).toBe(0);
    // The title's Latin word still reads as written.
    expect(isDrawnAsWritten(drawn, title.indexOf("WAN"), title.length)).toBe(
      true,
    );

    /*
     * Drawn as plain text, as it was, the digit joins "WAN" in one
     * left-to-right run and is drawn between the title's two words.
     */
    const plain: DrawnLine = drawLine(`${title}3`, "rtl");
    expect(plain.drawnAt[title.length]).not.toBe(0);
    expect(
      isDrawnAsWritten(plain, title.indexOf("WAN"), title.length + 1),
    ).toBe(true);
  });

  test("Arabic: the count is drawn after the title and its (i)", async () => {
    await i18next.changeLanguage("ar");
    render(
      <div dir="rtl">
        <NetworkMapSection
          title="Sites"
          count={12}
          hint={SITES_HINT}
          description={NETWORK_SITE_METRIC_DESCRIPTIONS.siteCards}
        >
          <div>cards</div>
        </NetworkMapSection>
      </div>,
    );

    const heading: HTMLElement = screen.getByTestId(
      "network-map-section-title",
    );
    const count: HTMLElement = screen.getByTestId("network-map-section-count");
    const words: HTMLElement = count.previousElementSibling as HTMLElement;
    expect(words.textContent).toBe(worded(AR, "Sites"));

    // The words (with their (i)) and the count: two boxes, right to left.
    const line: { text: string; at: Map<Element, number> } = lineOf(heading);
    expect(line.text).toBe(`${OBJECT}${OBJECT}`);
    const drawn: DrawnLine = drawLine(line.text, "rtl");
    expect(drawn.drawnAt[line.at.get(words)!]).toBe(1);
    expect(drawn.drawnAt[line.at.get(count)!]).toBe(0);
  });

  test("without a description: the title and the count alone", async () => {
    await i18next.changeLanguage("de");
    render(
      <NetworkMapSection
        title="WAN links"
        count={3}
        hint="Connections between these top-level sites."
      >
        <div>links</div>
      </NetworkMapSection>,
    );

    const heading: HTMLElement = screen.getByTestId(
      "network-map-section-title",
    );
    expect(heading.textContent).toBe(`${worded(DE, "WAN links")}3`);
    expect(screen.queryByRole("button")).toBeNull();
    expect(glueOf(heading)).toBeNull();
    expect(
      screen.getByText(
        worded(DE, "Connections between these top-level sites."),
      ),
    ).toBeInTheDocument();
  });
});
