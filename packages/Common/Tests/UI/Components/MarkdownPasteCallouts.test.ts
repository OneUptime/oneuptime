import { describe, expect, test } from "@jest/globals";
import {
  htmlToMarkdown,
  markdownToHtml,
} from "../../../UI/Components/Markdown.tsx/MarkdownConverters";
import {
  isRichClipboardHtml,
  pastedHtmlToMarkdown,
} from "../../../UI/Components/Markdown.tsx/MarkdownPaste";
import { MARKDOWN_CALLOUT_KINDS } from "../../../UI/Components/Markdown.tsx/MarkdownCallouts";
import {
  MARKDOWN_CALLOUT_BODY_CLASS_NAME,
  MARKDOWN_CALLOUT_CLASS_NAME,
  MARKDOWN_CALLOUT_STYLES,
  MARKDOWN_QUOTE_CLASS_NAME,
} from "../../../UI/Components/Markdown.tsx/MarkdownQuote";

/*
 * A callout copied out of a note and pasted into another stays a callout.
 *
 * The viewer draws "> [!WARNING]" without its marker (MarkdownCallouts), so
 * the copy's text had none: a pasted callout came back a plain quote, which
 * the viewer now draws as a quote. The viewer keeps the kind on the
 * blockquote (data-callout), and the paste handler writes the marker back on
 * the quote's first line - unless the quote opens with its own bold label
 * ("**Note:**"), which keeps it a callout as it is.
 *
 * The HTML below is what a browser puts on the clipboard for the viewer's
 * markup: its attributes kept, the icon included (the old amber quote's copy
 * is a recorded fixture in MarkdownPaste.test.ts, and still pastes as the
 * plain quote it now is).
 */

// The viewer's callout, as a browser copies it.
const copiedCallout: (kind: string, bodyHtml: string) => string = (
  kind: string,
  bodyHtml: string,
): string => {
  const style: { panel: string; icon: string; iconPath: string } =
    MARKDOWN_CALLOUT_STYLES[kind as keyof typeof MARKDOWN_CALLOUT_STYLES] || {
      panel: "",
      icon: "",
      iconPath: "",
    };

  return [
    "<meta charset='utf-8'>",
    `<blockquote class="${MARKDOWN_CALLOUT_CLASS_NAME} ${style.panel}" role="note" aria-label="Note" data-callout="${kind}" style="box-sizing: border-box; display: flex;">`,
    `<svg class="mt-0.5 h-5 w-5 flex-none ${style.icon}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true" data-markdown-ignore="true"><path stroke-linecap="round" stroke-linejoin="round" d="${style.iconPath}"></path></svg>`,
    `<div class="${MARKDOWN_CALLOUT_BODY_CLASS_NAME}" style="font-size: 0.875rem;">${bodyHtml}</div>`,
    "</blockquote>",
  ].join("");
};

const paragraph: (html: string) => string = (html: string): string => {
  return `<p class="text-sm mt-2 mb-1 text-gray-700 leading-relaxed" style="margin: 0px;">${html}</p>`;
};

describe("a copied callout pastes back as a callout", () => {
  test("the marker goes back on the quote's first line", () => {
    const markdown: string = pastedHtmlToMarkdown(
      copiedCallout(
        "warning",
        paragraph(
          "<strong>This token is a secret.</strong> Use a <strong>Server</strong> ingestion key.",
        ),
      ),
    );

    expect(markdown).toBe(
      "> [!WARNING]\n> **This token is a secret.** Use a **Server** ingestion key.",
    );
  });

  test.each(MARKDOWN_CALLOUT_KINDS.map((kind: string) => [kind]))(
    "%s",
    (kind: string) => {
      expect(
        pastedHtmlToMarkdown(copiedCallout(kind, paragraph("Read this."))),
      ).toBe(`> [!${kind.toUpperCase()}]\n> Read this.`);
    },
  );

  test("each of its paragraphs stays in the quote", () => {
    const markdown: string = pastedHtmlToMarkdown(
      copiedCallout("note", paragraph("First.") + paragraph("Second.")),
    );

    expect(markdown.split("\n")[0]).toBe("> [!NOTE]");
    expect(markdown).toContain("> First.");
    expect(markdown).toContain("> Second.");
    for (const line of markdown.split("\n")) {
      expect(line.startsWith(">")).toBe(true);
    }
  });

  test("one that opens with a list gets the marker on a line of its own", () => {
    const markdown: string = pastedHtmlToMarkdown(
      copiedCallout(
        "tip",
        "<ul class=\"list-disc pl-6 mt-0 mb-1\"><li>restart the pod</li><li>watch the logs</li></ul>",
      ),
    );

    const lines: Array<string> = markdown.split("\n");

    expect(lines[0]).toBe("> [!TIP]");
    expect(markdown).toContain("> - restart the pod");
    expect(markdown).toContain("> - watch the logs");
    for (const line of lines) {
      expect(line.startsWith(">")).toBe(true);
    }
  });

  test("one that opens with its own bold label needs no marker", () => {
    for (const label of ["Note:", "Note"]) {
      expect(
        pastedHtmlToMarkdown(
          copiedCallout(
            "note",
            paragraph(
              `<strong>${label}</strong> The service runs as LocalSystem.`,
            ),
          ),
        ),
      ).toBe(`> **${label}** The service runs as LocalSystem.`);
    }
  });

  test("a bold label of another kind does not stand in for the marker", () => {
    expect(
      pastedHtmlToMarkdown(
        copiedCallout("warning", paragraph("<strong>Note:</strong> careful")),
      ),
    ).toBe("> [!WARNING]\n> **Note:** careful");
  });

  test("the icon is never pasted", () => {
    const markdown: string = pastedHtmlToMarkdown(
      copiedCallout("danger", paragraph("Stop.")),
    );

    expect(markdown).not.toContain("svg");
    expect(markdown).not.toContain(MARKDOWN_CALLOUT_STYLES.danger.iconPath);
  });

  test("is rich content, so the paste converts it", () => {
    expect(
      isRichClipboardHtml(copiedCallout("warning", paragraph("x"))),
    ).toBe(true);
  });
});

describe("what is not a callout pastes as it is", () => {
  test("a quote pastes back as a quote", () => {
    const html: string = `<blockquote class="${MARKDOWN_QUOTE_CLASS_NAME}">${paragraph("They said something")}</blockquote>`;

    expect(pastedHtmlToMarkdown(html)).toBe("> They said something");
  });

  test("a kind the viewer does not draw adds no marker", () => {
    for (const kind of ["alert", "", "toString", "NOTE "]) {
      expect(
        pastedHtmlToMarkdown(
          `<blockquote data-callout="${kind}"><p>words</p></blockquote>`,
        ),
      ).toBe("> words");
    }
  });

  test("a blockquote from another app, with no kind, stays a quote", () => {
    const markdown: string = pastedHtmlToMarkdown(
      "<blockquote><p>On Monday, Ana wrote:</p><p>ship it</p></blockquote>",
    );

    expect(markdown.split("\n")[0]).toBe("> On Monday, Ana wrote:");
    expect(markdown).toContain("> ship it");
    expect(markdown).not.toContain("[!");
    for (const line of markdown.split("\n")) {
      expect(line.startsWith(">")).toBe(true);
    }
  });
});

describe("the editor keeps a marker as typed", () => {
  test("visual mode and back leaves a callout's marker where it was", () => {
    for (const markdown of [
      "> [!WARNING]\n> careful",
      "> [!NOTE] same line",
      "> **Note:** The service runs as LocalSystem.",
    ]) {
      expect(htmlToMarkdown(markdownToHtml(markdown))).toBe(markdown);
    }
  });
});
