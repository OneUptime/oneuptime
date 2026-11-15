import { makeT as makeApiReferenceT } from "../../../FeatureSet/APIReference/Utils/I18n";
import { makeT as makeDocsT } from "../../../FeatureSet/Docs/Utils/I18n";
import DocsRender from "../../../FeatureSet/Docs/Utils/Render";
import DocsPlaceholders from "../../../FeatureSet/Docs/Utils/Placeholders";
import { readPage } from "./DocsContentSupport";
import { stripHtmlTags } from "./DocsHtmlText";
import { describe, expect, it } from "@jest/globals";

/*
 * A FRENCH DOCS PAGE KEEPS EACH OF FRENCH'S MARKS WITH ITS WORDS (#8032).
 *
 * French writes a space before » ? ! : and ; and after «, and the docs'
 * French pages, like the locale files, type a plain one, which a line may
 * break at. The docs draw it as a no-break one: in a French page's text
 * (DocsRender.localize, Common/Types/NoBreakSpaces), and in the labels the
 * docs and the API reference look up (makeT) - never in a page's code, a
 * tag, or another language's page. The Markdown stays as it is written.
 */

const NB: string = "\u00A0";
const NNB: string = "\u202F";

// A space a line may break at: the space and the fixed-width ones.
const BREAKING: string = "[\\u0020\\u2000-\\u2006\\u2008-\\u200A\\u205F]";

// A French mark a line could start with, or a guillemet beside a break.
const FRENCH_BREAK: RegExp = new RegExp(
  `[\\p{L}\\p{N}»)\\]]${BREAKING}+[?!:;](?=\\s|$)|\\S${BREAKING}+»|«${BREAKING}+\\S`,
  "u",
);

/*
 * A page's text as it reads: its code and preformatted text left out, each
 * block on a line of its own, its tags taken out (stripHtmlTags).
 */
function proseOf(html: string): string {
  return stripHtmlTags(
    html
      .replace(/<(pre|code)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|li|h[1-6]|td|th|div|blockquote)>/gi, "\n"),
  )
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function render(markdown: string, lang: string): Promise<string> {
  return DocsRender.render(DocsPlaceholders.render(markdown, lang), {
    lang,
    contentLang: lang,
  });
}

const SAMPLE: string = [
  "Remarque : ouvrez la liste « Flux de travail » et choisissez « Archiver ».",
  "",
  "Vous ne le trouvez pas ? Vérifiez vos filtres ; puis réessayez !",
  "",
  "Lancez `a ? b : c` dans le terminal.",
  "",
  "```bash",
  'echo "x ? y : z « w »"',
  "```",
].join("\n");

describe("a French docs page", () => {
  it("draws its text with French's no-break spaces", async () => {
    const html: string = await render(SAMPLE, "fr");

    expect(html).toContain(
      `Remarque${NB}: ouvrez la liste «${NB}Flux de travail${NB}»`,
    );
    expect(html).toContain(`choisissez «${NB}Archiver${NB}».`);
    expect(html).toContain(
      `trouvez pas${NNB}? Vérifiez vos filtres${NNB}; puis réessayez${NNB}!`,
    );
    expect(proseOf(html).match(FRENCH_BREAK)).toBeNull();
  });

  it("leaves its code as it is written", async () => {
    const html: string = await render(SAMPLE, "fr");

    expect(html).toMatch(/<code\b[^>]*>a \? b : c<\/code>/);
    expect(html).toMatch(/x \? y : z («|&laquo;) w (»|&raquo;)/);
  });

  it("a page in another language is drawn as it is written", async () => {
    const html: string = await render(SAMPLE, "de");

    expect(html).not.toMatch(/[\u00A0\u202F]/);
    expect(html).toContain("Remarque : ouvrez la liste « Flux de travail »");
  });

  it("a real French page: no mark beside a space a line breaks at", async () => {
    const markdown: string = readPage("fr", "workflows/triggers");

    // The page has guillemets and colons to hold.
    expect(markdown).toMatch(FRENCH_BREAK);

    const html: string = await render(
      markdown.split("\n").slice(1).join("\n"),
      "fr",
    );

    expect(proseOf(html).match(FRENCH_BREAK)).toBeNull();
  });
});

describe("the labels the docs and the API reference look up", () => {
  it("are French's, with their no-break spaces", () => {
    expect(makeDocsT("fr")("ui.feedbackQuestion")).toBe(
      `Cette page vous a-t-elle été utile${NNB}?`,
    );
    expect(makeApiReferenceT("fr")("pages.errors.status5xx")).toMatch(
      new RegExp(`côté serveur${NB}: `),
    );
  });

  it("are English's as written, and fill their values as given", () => {
    expect(makeDocsT("en")("ui.feedbackQuestion")).not.toMatch(
      /[\u00A0\u202F]/,
    );
    expect(makeDocsT("de")("ui.feedbackQuestion")).not.toMatch(
      /[\u00A0\u202F]/,
    );
  });
});
