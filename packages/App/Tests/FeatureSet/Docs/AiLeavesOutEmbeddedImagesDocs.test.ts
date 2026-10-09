import PromptText, {
  formatCount,
  MAX_DRAFT_PROMPT_FIELD_LENGTH,
  MAX_PROMPT_FIELD_LENGTH,
} from "Common/Utils/AI/PromptText";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The docs say what OneUptime AI reads of a record's text, the way the
 * product does it (issue #4587): an image embedded in it - a synthetic
 * monitor's screenshot - is a short note, in the very words the product
 * writes; a long field is cut at the lengths the code uses; people still
 * see every image; and a workflow's AI step measures its input after the
 * images are left out, in every language the workflow page is written in.
 */

const DOCS_ROOT: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "Docs",
  "Content",
);

const LANGUAGES: Array<string> = [
  "en",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

function readPage(language: string, relative: string): string {
  return fs
    .readFileSync(path.join(DOCS_ROOT, language, relative), "utf8")
    .replace(/\s*\n\s*/g, " ");
}

// What the product writes for an image of `kilobytes` KB of `type`.
function noteFor(type: "png" | "jpeg", kilobytes: number): string {
  const signature: Array<number> =
    type === "png"
      ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      : [0xff, 0xd8, 0xff, 0xe0];
  const bytes: Buffer = Buffer.concat([
    Buffer.from(signature),
    Buffer.alloc(kilobytes * 1024 - signature.length, 0x41),
  ]);

  return PromptText.omitEmbeddedData(
    `data:image/${type};base64,${bytes.toString("base64")}`,
  ).text;
}

describe("AI SRE: images are left out of what the model reads", () => {
  const page: string = readPage("en", "ai/ai-sre.md");
  const trust: string = page.slice(page.indexOf("## Trust and safety"));

  test("is part of Trust and safety", () => {
    expect(trust).toContain(
      "**Images are left out of what the model reads.**",
    );
  });

  test("quotes the note the product writes", () => {
    expect(noteFor("jpeg", 340)).toBe("[image omitted: JPEG, 340 KB]");
    expect(trust).toContain("`[image omitted: JPEG, 340 KB]`");
  });

  test("names the lengths the code holds a field to", () => {
    expect(trust).toContain(
      `longer than ${formatCount(MAX_PROMPT_FIELD_LENGTH)} characters`,
    );
    expect(trust).toContain(
      `${formatCount(MAX_DRAFT_PROMPT_FIELD_LENGTH)} characters in a drafted postmortem or note`,
    );
  });

  test("says the activity tells what was left out, and people still see the images", () => {
    expect(trust).toContain(
      "the investigation's activity says what was left out",
    );
    expect(trust).toContain(
      "People still see every image: only what the model reads changes.",
    );
  });

  test("the Persian page says it too", () => {
    expect(readPage("fa", "ai/ai-sre.md")).toContain(
      "`[image omitted: JPEG, 340 KB]`",
    );
  });
});

describe("Templating: a screenshot in a description", () => {
  test("says OneUptime AI reads the text around it, not the screenshot", () => {
    const page: string = readPage("en", "monitor/incident-alert-templating.md");
    const screenshot: string = page.slice(
      page.indexOf("#### Showing a screenshot"),
    );

    expect(noteFor("png", 340)).toBe("[image omitted: PNG, 340 KB]");
    expect(screenshot).toContain(
      "OneUptime AI reads the text around a screenshot, not the screenshot.",
    );
    expect(screenshot).toContain("`[image omitted: PNG, 340 KB]`");
  });
});

describe("Workflows: Generate Text with AI", () => {
  test.each(LANGUAGES)(
    "the %s page says images are left out before the input is measured",
    (language: string) => {
      const page: string = readPage(language, "workflows/components.md");

      expect(page).toContain("`[image omitted: PNG, 340 KB]`");
    },
  );

  test("in English, in the words the product logs", () => {
    expect(readPage("en", "workflows/components.md")).toContain(
      "is replaced by a short note like `[image omitted: PNG, 340 KB]` before they are measured, because the model reads text, not images. The run's log says what was left out.",
    );
  });
});
