import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  MARKDOWN_CALLOUT_KINDS,
  getMarkdownCalloutKind,
  getMarkdownCalloutKindOfLabel,
} from "Common/UI/Components/Markdown.tsx/MarkdownCallouts";

/*
 * A warning a setup guide gives is drawn as a callout, never as a quote.
 *
 * The Markdown viewer drew every blockquote as an amber box with a warning
 * sign, so the setup guides wrote their warnings as plain quotes with a bold
 * lead - "> **This token is a secret.** ..." - and quotes in notes read as
 * warnings too. Now a blockquote is a quote, and only one that asks to be a
 * callout is drawn as one (MarkdownCallouts): "> [!WARNING]" on the line
 * above, or a bold kind label opening it ("> **Note:** ...").
 *
 * So in the apps' own Markdown - setup guides, settings help - a quote that
 * opens with a bold lead is a callout that must say so: its bold is a kind's
 * label, or a "> [!KIND]" line comes first. A bold lead in a plain quote
 * would draw a product warning as somebody's words.
 */

const FEATURE_SET_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
);

const APPS: Array<string> = [
  "Dashboard",
  "AdminDashboard",
  "StatusPage",
  "Accounts",
  "PublicDashboard",
];

// A line of a source file is Markdown on one or more lines: "\n" in a string.
const ESCAPED_NEWLINE: string = "\\n";

const STRING_QUOTES: Array<string> = ['"', "'", "`"];

/*
 * Where a quote's Markdown starts on a line of source: at the line's start
 * (a template literal's line), or just inside a string that opens with ">"
 * ("> **...", const NOTE: string = `> [!WARNING]). "" when it holds none.
 */
const quoteMarkdownIn: (piece: string) => string = (piece: string): string => {
  const trimmed: string = piece.trimStart();

  if (trimmed.startsWith(">")) {
    return trimmed;
  }

  for (let index: number = 0; index < piece.length - 1; index++) {
    if (STRING_QUOTES.includes(piece[index]!) && piece[index + 1] === ">") {
      return piece.slice(index + 1);
    }
  }

  return "";
};

// "> **Bold lead** ..." - the bold's text, up to its closing "**".
const QUOTED_BOLD_LEAD: RegExp = /^>\s?\*\*([^*]{1,200})\*\*/;

// "> [!WARNING]" alone, as a callout's first line.
const CALLOUT_MARKER_LINE: RegExp =
  /^>\s?\[!([A-Za-z]{1,16})\]\s*["'`,;)]*\s*$/;

interface MarkdownLine {
  file: string;
  line: number;
  text: string;
}

const sourceFilesOf: (dir: string) => Array<string> = (
  dir: string,
): Array<string> => {
  const files: Array<string> = [];
  const pending: Array<string> = [dir];

  while (pending.length > 0) {
    const current: string = pending.pop()!;

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full: string = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "build") {
          pending.push(full);
        }
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        files.push(full);
      }
    }
  }

  return files;
};

// Every line of Markdown the apps' source writes, comments left out.
const markdownLinesOf: (file: string) => Array<MarkdownLine> = (
  file: string,
): Array<MarkdownLine> => {
  const lines: Array<MarkdownLine> = [];
  const relative: string = path.relative(FEATURE_SET_DIR, file);

  fs.readFileSync(file, "utf8")
    .split("\n")
    .forEach((sourceLine: string, index: number): void => {
      const trimmed: string = sourceLine.trim();

      if (trimmed.startsWith("*") || trimmed.startsWith("//")) {
        return;
      }

      for (const piece of sourceLine.split(ESCAPED_NEWLINE)) {
        lines.push({
          file: relative,
          line: index + 1,
          text: quoteMarkdownIn(piece),
        });
      }
    });

  return lines;
};

const ALL_MARKDOWN_LINES: Array<MarkdownLine> = APPS.flatMap(
  (app: string): Array<MarkdownLine> => {
    const srcDir: string = path.join(FEATURE_SET_DIR, app, "src");

    return fs.existsSync(srcDir)
      ? sourceFilesOf(srcDir).flatMap(markdownLinesOf)
      : [];
  },
);

interface QuotedBoldLead extends MarkdownLine {
  bold: string;
  previous: string;
}

/*
 * The bold leads that open a quote: a quote's first line, or the line after
 * its marker. A bold word later in a quote ("> **Browser** ingestion key")
 * is the callout's text going on.
 */
const QUOTED_BOLD_LEADS: Array<QuotedBoldLead> = ALL_MARKDOWN_LINES.flatMap(
  (line: MarkdownLine, index: number): Array<QuotedBoldLead> => {
    const match: RegExpExecArray | null = QUOTED_BOLD_LEAD.exec(line.text);
    const previous: string = ALL_MARKDOWN_LINES[index - 1]?.text || "";
    const continuesAQuote: boolean =
      previous.startsWith(">") && !CALLOUT_MARKER_LINE.test(previous);

    if (!match || continuesAQuote) {
      return [];
    }

    return [{ ...line, bold: match[1]!, previous: previous }];
  },
);

const isMarkedCallout: (lead: QuotedBoldLead) => boolean = (
  lead: QuotedBoldLead,
): boolean => {
  if (getMarkdownCalloutKindOfLabel(lead.bold)) {
    return true;
  }

  const marker: RegExpExecArray | null = CALLOUT_MARKER_LINE.exec(
    lead.previous,
  );

  return Boolean(marker && getMarkdownCalloutKind(marker[1]));
};

describe("setup guides mark their callouts", () => {
  test("the guides' quoted warnings and notes are found", () => {
    const found: Array<string> = QUOTED_BOLD_LEADS.map(
      (lead: QuotedBoldLead): string => {
        return lead.bold;
      },
    );

    // The ones this rule was written for, in five guides.
    expect(found).toEqual(
      expect.arrayContaining([
        "This token is a secret.",
        "Never ship a Server ingestion key to a browser.",
        "Note for native installs:",
        "Install the contrib build, as above.",
        "Note:",
        "Tip:",
        'Do not install "OneUptime" from the Microsoft Teams store for a self-hosted deployment.',
        'Do not skip this because a "OneUptime" app is already in your tenant.',
      ]),
    );
  });

  test("every quote that opens with a bold lead is a callout that says so", () => {
    const unmarked: Array<string> = QUOTED_BOLD_LEADS.filter(
      (lead: QuotedBoldLead): boolean => {
        return !isMarkedCallout(lead);
      },
    ).map((lead: QuotedBoldLead): string => {
      return `${lead.file}:${lead.line} "> **${lead.bold}**" - put "> [!WARNING]" (or [!NOTE], [!TIP]) on the line above`;
    });

    expect(unmarked).toEqual([]);
  });

  test("every marker names a kind the viewer draws", () => {
    const markers: Array<string> = ALL_MARKDOWN_LINES.flatMap(
      (line: MarkdownLine): Array<string> => {
        const marker: RegExpExecArray | null = CALLOUT_MARKER_LINE.exec(
          line.text,
        );

        return marker ? [`${line.file}:${line.line} ${marker[1]}`] : [];
      },
    );

    expect(markers.length).toBeGreaterThanOrEqual(10);

    for (const marker of markers) {
      const kind: string = marker.split(" ").pop() || "";

      expect(
        `${marker} ${MARKDOWN_CALLOUT_KINDS.includes(kind.toLowerCase() as never)}`,
      ).toBe(`${marker} true`);
    }
  });
});
