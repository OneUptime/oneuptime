import Markdown, {
  EMAIL_SLOW_MARKDOWN_LIMITS,
  MarkdownContentType,
} from "../../../Server/Types/Markdown";
import { holdBackSlowMarkdown } from "../../../Utils/Markdown/SlowMarkdown";
import {
  ORDINARY_EMAIL_MARKDOWN,
  OrdinaryEmailMarkdown,
} from "../../Helpers/OrdinaryEmailMarkdown";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * ORDINARY EMAILS RENDER EXACTLY AS THEY ALWAYS DID (#7597, #7598, #7600).
 *
 * Those issues changed the guard before marked renders an email's Markdown:
 * each inline read now sees only the definitions it names, a list item of
 * many lines is held back, and a link or an address across an over-long
 * line's cut keeps its structure. Ordinary Markdown - Tests/Helpers/
 * OrdinaryEmailMarkdown - must render byte for byte as before: the fixture
 * holds what each rendered to on main before those changes (the HTML, or
 * for a long one its SHA-256 and length).
 */

type Golden = { html: string } | { sha256: string; length: number };

const GOLDEN: Record<string, Golden> = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "Fixtures",
      "OrdinaryEmailMarkdown.golden.json",
    ),
    "utf8",
  ),
) as Record<string, Golden>;

const goldenOf: (html: string) => Golden = (html: string): Golden => {
  return html.length <= 8192
    ? { html: html }
    : {
        sha256: crypto.createHash("sha256").update(html).digest("hex"),
        length: html.length,
      };
};

describe("Ordinary email Markdown renders exactly as it did before", () => {
  test("the fixture holds every ordinary text, and nothing else", () => {
    expect(Object.keys(GOLDEN).sort()).toEqual(
      ORDINARY_EMAIL_MARKDOWN.map((item: OrdinaryEmailMarkdown): string => {
        return item.name;
      }).sort(),
    );
  });

  test.each(
    ORDINARY_EMAIL_MARKDOWN.map(
      (item: OrdinaryEmailMarkdown): [string, string] => {
        return [item.name, item.markdown];
      },
    ),
  )("%s", async (name: string, markdown: string) => {
    const html: string = await Markdown.convertToHTML(
      markdown,
      MarkdownContentType.Email,
    );

    expect(goldenOf(html)).toEqual(GOLDEN[name]);
  });

  test.each(
    ORDINARY_EMAIL_MARKDOWN.map(
      (item: OrdinaryEmailMarkdown): [string, string] => {
        return [item.name, item.markdown];
      },
    ),
  )(
    "nothing of %s is held back as slow Markdown",
    (_name: string, markdown: string) => {
      let held: boolean = false;
      const hold: () => string = (): string => {
        held = true;
        return "";
      };

      holdBackSlowMarkdown(
        markdown,
        { holdLines: hold, holdCode: hold },
        EMAIL_SLOW_MARKDOWN_LIMITS,
      );

      expect(held).toBe(false);
    },
  );
});
