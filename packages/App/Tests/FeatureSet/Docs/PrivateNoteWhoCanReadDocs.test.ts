import { describe, expect, test } from "@jest/globals";
import WorkspaceNoteForm from "Common/Server/Utils/Workspace/WorkspaceNoteForm";
import { PrivateRecordKind } from "Common/Types/StatusPage/PrivateRecordPublicNotes";
import { getInlineSeparator } from "Common/Types/Translator";
import { DOCS_LANGUAGES, listPages, readPage } from "./DocsContentSupport";
import { drawnDashboardLabel, isDashboardLabel } from "./DocsDashboardLabels";

/*
 * WHO CAN READ A PRIVATE NOTE, AS THE DOCS SAY IT (#7595).
 *
 * The private note composer said "Private · Only your team can see this",
 * and "team" read as one of OneUptime's Teams. A private note is read
 * through its record: the people who can read it are the people who can
 * see the incident, alert, episode or maintenance event it is on. The docs
 * said "your team" wherever the product did - the composer's badge, the
 * Private Note option of the Slack and Microsoft Teams forms, a 📌's note,
 * OneUptime's MCP and CLI note commands, a subscriber's Internal Note - and
 * every docs language says who can read a private note now:
 *
 *   - the Private Notes page quotes the composer's badge as each
 *     language's Dashboard draws it (it quoted the English badge in every
 *     language, as no check read a quote that is two labels);
 *   - the lines that said "your team" name no team, in any language, nor
 *     does the Private Notes paragraph, which said Attach is for "the
 *     incident response team" right after the badge;
 *   - the old badge, and the English the pages said, are on no page.
 */

const NOTES_PAGE: string = "incidents/notes-owners-and-feed";

// The badge's English: two Dashboard labels, drawn with the mark between.
const PRIVATE_LABEL: string = "Private";
const INCIDENT_HINT: string =
  "Only people who can see this incident can read this";

// A team, as each docs language said it in the old sentences.
const TEAM_WORDS: Record<string, string> = {
  en: "team",
  de: "Team",
  fr: "équipe",
  es: "equipo",
  it: "team",
  pt: "equipe",
  nl: "team",
  da: "team",
  no: "team",
  sv: "team",
  ru: "команд",
  hi: "टीम",
  ja: "チーム",
  ko: "팀",
  "zh-CN": "团队",
  "zh-TW": "團隊",
  fa: "تیم",
};

/*
 * The brand names a line may hold that hold a team word: Microsoft Teams,
 * as every language writes it.
 */
function withoutBrands(text: string): string {
  return text.split("Microsoft Teams").join("");
}

function saysTeam(language: string, text: string): boolean {
  return withoutBrands(text)
    .toLowerCase()
    .includes(TEAM_WORDS[language]!.toLowerCase());
}

// What the old badge said in each language's Dashboard.
const OLD_BADGE: Record<string, string> = {
  en: "Only your team can see this",
  da: "Kun dit team kan se dette",
  de: "Nur Ihr Team kann das sehen",
  es: "Solo tu equipo puede ver esto",
  fa: "فقط تیم شما این را می‌بیند",
  fr: "Seule votre équipe peut voir ceci",
  hi: "इसे सिर्फ़ आपकी टीम देख सकती है",
  it: "Solo il tuo team può vederlo",
  ja: "チームのメンバーだけが閲覧できます",
  ko: "팀만 볼 수 있습니다",
  nl: "Alleen uw team kan dit zien",
  no: "Bare teamet ditt kan se dette",
  pt: "Só sua equipe pode ver isto",
  ru: "Это видит только ваша команда",
  sv: "Bara ditt team kan se detta",
  "zh-CN": "只有你的团队能看到",
  "zh-TW": "只有你的團隊能看到",
};

// What the English pages said: on no English page now.
const OLD_ENGLISH: ReadonlyArray<string> = [
  "Only your team can see this",
  "only visible to team members",
  "for your team only",
  "seen only by your team",
  "the team only, the default",
  "only your team can add subscribers",
  "which only your team sees",
  "Adds a note your team sees",
  "for files meant for the incident response team",
];

// The badge, as `language`'s Dashboard draws it, in bold.
function drawnBadge(language: string): string {
  return `**${drawnDashboardLabel(language, PRIVATE_LABEL)} ${getInlineSeparator(
    language,
  ).trim()} ${drawnDashboardLabel(language, INCIDENT_HINT)}**`;
}

// The lines of a page that are `what`: at least one.
function linesWhere(
  language: string,
  page: string,
  what: string,
  isLine: (line: string) => boolean,
): Array<string> {
  const lines: Array<string> = readPage(language, page)
    .split("\n")
    .filter(isLine);

  expect({ language, page, what, found: lines.length > 0 }).toEqual({
    language,
    page,
    what,
    found: true,
  });

  return lines;
}

/*
 * The Slack and Microsoft Teams form's Private Note option, as a page
 * quotes it: the label as the form says it, in English, and why in the
 * page's language, in its parentheses. The words between them hold no
 * parenthesis of either kind, so each quote is read once: linear.
 */
const PRIVATE_OPTION_QUOTE: RegExp =
  /\*\*Private Note\*\*\s*[(（]([^()（）]*)[)）]/;

describe("the Private Notes page quotes the composer's badge as each language draws it", () => {
  test("the badge's words are the Dashboard's", () => {
    expect(isDashboardLabel(PRIVATE_LABEL)).toBe(true);
    expect(isDashboardLabel(INCIDENT_HINT)).toBe(true);
  });

  test.each(DOCS_LANGUAGES)("%s", (language: string) => {
    const badge: string = drawnBadge(language);

    expect(readPage(language, NOTES_PAGE)).toContain(badge);
    expect(saysTeam(language, badge)).toBe(false);

    if (language !== "en") {
      // In the language's own words, not the English it quoted before.
      expect(drawnDashboardLabel(language, INCIDENT_HINT)).not.toBe(
        INCIDENT_HINT,
      );
      expect(readPage(language, NOTES_PAGE)).not.toContain(
        `**Private · ${OLD_BADGE["en"]}**`,
      );
    }
  });

  test("a Persian page sets the two apart with a bullet, as its Dashboard does", () => {
    expect(drawnBadge("fa")).toContain(" • ");
    expect(drawnBadge("de")).toContain(" · ");
  });
});

describe("the English pages say who can read it, as the product does", () => {
  test("the Slack and Microsoft Teams form's Private Note option, as the form says it", () => {
    const option: string = WorkspaceNoteForm.getRecordPrivateOption(
      PrivateRecordKind.Incident,
    );
    const [label, reason] = option.split(" (") as [string, string];
    const quoted: string = `**${label}** (${reason.charAt(0).toLowerCase()}${reason.slice(1)}`;

    expect(quoted).toBe(
      "**Private Note** (only people who can see the incident can read it)",
    );
    expect(readPage("en", NOTES_PAGE)).toContain(quoted);
  });

  test.each([
    [NOTES_PAGE, "Only people who can see this incident can read this"],
    [
      NOTES_PAGE,
      "and **Attach** for files, which only the people who can read the note can open.",
    ],
    ["alerts/index", "Private notes, only for people who can see the alert"],
    [
      "scheduled-maintenance/index",
      "**Private Notes** can be read only by the people who can see the event.",
    ],
    [
      "scheduled-maintenance/creating-events",
      "**Private Notes** can be read only by the people who can see the event.",
    ],
    [
      "workspace-connections/slack",
      "A private note, read only by the people who can see the record",
    ],
    [
      "workspace-connections/microsoft-teams",
      "A private note, read only by the people who can see the record",
    ],
    ["status-pages/subscribers", "which the subscriber never sees"],
    [
      "status-pages/subscribers",
      "only people in your project can add subscribers",
    ],
    [
      "cli/resource-operations",
      "Adds a note only the people who can see the record can read",
    ],
    [
      "ai/mcp-server",
      "(only the people who can see the incident, the default)",
    ],
  ])("%s says: %s", (page: string, sentence: string) => {
    expect(readPage("en", page)).toContain(sentence);
  });

  test("what they said is on no English page", () => {
    for (const page of listPages("en")) {
      const markdown: string = readPage("en", page);

      for (const old of OLD_ENGLISH) {
        expect({ page, old, kept: markdown.includes(old) }).toEqual({
          page,
          old,
          kept: false,
        });
      }
    }
  });
});

describe("in every docs language, the lines that said a team name none", () => {
  test.each(DOCS_LANGUAGES)("%s", (language: string) => {
    const notesRow: string = `| **${drawnDashboardLabel(language, "Notes")}**`;
    const privateNotes: string = `**${drawnDashboardLabel(language, "Private Notes")}**`;

    const lines: Array<string> = [
      // The Private Notes paragraph: the badge, then what Attach is for.
      ...linesWhere(
        language,
        NOTES_PAGE,
        "the paragraph that quotes the badge",
        (line: string): boolean => {
          return line.includes(drawnBadge(language));
        },
      ),
      // Why, in the Private Note option of the Slack and Microsoft Teams forms.
      ...linesWhere(
        language,
        NOTES_PAGE,
        "the forms' Private Note option",
        (line: string): boolean => {
          return PRIVATE_OPTION_QUOTE.test(line);
        },
      ).map((line: string): string => {
        return line.match(PRIVATE_OPTION_QUOTE)![1]!;
      }),
      // A 📌's note, in the emoji tables of the Slack and Microsoft Teams pages.
      ...[
        "workspace-connections/slack",
        "workspace-connections/microsoft-teams",
      ].flatMap((page: string): Array<string> => {
        return linesWhere(
          language,
          page,
          "the 📌 row",
          (line: string): boolean => {
            return line.startsWith("|") && line.includes("📌");
          },
        );
      }),
      // An alert's Notes, in the table beside an incident's.
      ...linesWhere(
        language,
        "alerts/index",
        "the Notes row",
        (line: string): boolean => {
          return line.startsWith(notesRow);
        },
      ),
      // What a maintenance event's Private Notes are.
      ...[
        "scheduled-maintenance/index",
        "scheduled-maintenance/creating-events",
      ].flatMap((page: string): Array<string> => {
        return linesWhere(
          language,
          page,
          "the Private Notes bullet",
          (line: string): boolean => {
            return line.startsWith("- ") && line.includes(privateNotes);
          },
        );
      }),
      // A subscriber's Internal Note.
      ...linesWhere(
        language,
        "status-pages/subscribers",
        "the Internal Note",
        (line: string): boolean => {
          return line.includes("`internalNote`");
        },
      ),
      // The CLI's add-note and the MCP server's add_incident_note.
      ...linesWhere(
        language,
        "cli/resource-operations",
        "the add-note row",
        (line: string): boolean => {
          return line.startsWith("| `add-note <id>");
        },
      ),
      ...linesWhere(
        language,
        "ai/mcp-server",
        "add_incident_note",
        (line: string): boolean => {
          return line.includes("**`add_incident_note`**");
        },
      ),
    ];

    for (const line of lines) {
      expect({ language, line, saysTeam: saysTeam(language, line) }).toEqual({
        language,
        line,
        saysTeam: false,
      });
    }
  });

  test.each(DOCS_LANGUAGES)(
    "%s: the old badge is on no page",
    (language: string) => {
      for (const page of listPages(language)) {
        expect({
          page,
          kept: readPage(language, page).includes(OLD_BADGE[language]!),
        }).toEqual({ page, kept: false });
      }
    },
  );

  // The negative control: the scan finds a team in each language's old badge.
  test("the team scan finds the team the old badge named, in every language", () => {
    expect(Object.keys(OLD_BADGE).sort()).toEqual([...DOCS_LANGUAGES].sort());

    for (const language of DOCS_LANGUAGES) {
      expect({
        language,
        saysTeam: saysTeam(language, OLD_BADGE[language]!),
      }).toEqual({ language, saysTeam: true });
    }

    // A brand is not a team: Microsoft Teams is named on these pages.
    expect(saysTeam("en", "Slack and Microsoft Teams")).toBe(false);
  });
});
