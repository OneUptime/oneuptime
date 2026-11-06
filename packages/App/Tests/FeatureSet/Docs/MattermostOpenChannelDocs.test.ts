import { describe, expect, test } from "@jest/globals";
import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { boldSpans } from "./DocsTranslationChecks";

/*
 * Open in Mattermost on the Mattermost page. The Slack and Microsoft Teams
 * pages say what a record with a channel of its own has in its header, and
 * the Mattermost page says so too, in every docs language: on the same line
 * as the English, naming the buttons as that language's Dashboard draws them.
 */

const MATTERMOST_PAGE: string = "workspace-connections/mattermost";

function lineQuoting(language: string, english: string): number {
  const label: string = drawnDashboardLabel(language, english);

  return readPage(language, MATTERMOST_PAGE)
    .split("\n")
    .findIndex((line: string) => {
      return boldSpans(line).includes(label);
    });
}

describe("the Mattermost page names the record page's button", () => {
  test("the English says where it opens, and when it is one menu instead", () => {
    const paragraph: string | undefined = readPage("en", MATTERMOST_PAGE)
      .split("\n")
      .find((line: string) => {
        return line.includes("**Open in Mattermost**");
      });

    expect(paragraph).toContain("on your Mattermost server");
    expect(paragraph).toContain("**Open channel**");
    expect(paragraph).toContain("Slack or Microsoft Teams");
  });

  test.each(DOCS_LANGUAGES)(
    "%s quotes the buttons as its Dashboard draws them, where the English does",
    (language: string) => {
      const line: number = lineQuoting("en", "Open in Mattermost");

      expect(line).toBeGreaterThan(0);
      expect(lineQuoting(language, "Open in Mattermost")).toBe(line);
      expect(lineQuoting(language, "Open channel")).toBe(line);
    },
  );
});

/*
 * The channel card on the Mattermost page, in every docs language: on the same
 * lines as the English, naming what the card draws as that language's
 * Dashboard draws it, and saying what Mattermost does differently from Slack.
 */
describe("the Mattermost page describes the channel card", () => {
  const CARD_LABELS: ReadonlyArray<string> = [
    "Mattermost Channel",
    "Chat Channels",
    "Join channel",
    "Add people",
  ];

  const sectionOf: (language: string) => string = (
    language: string,
  ): string => {
    const lines: Array<string> = readPage(language, MATTERMOST_PAGE).split(
      "\n",
    );
    const start: number = lines.findIndex((line: string) => {
      return boldSpans(line).includes(
        drawnDashboardLabel(language, "Mattermost Channel"),
      );
    });
    const heading: number = lines
      .slice(0, start)
      .map((line: string) => {
        return line.startsWith("## ");
      })
      .lastIndexOf(true);
    const end: number =
      start +
      lines.slice(start).findIndex((line: string) => {
        return line.startsWith("## ");
      });

    return lines.slice(heading, end).join("\n");
  };

  test("the English says what it shows, and what Mattermost's own rules make of it", () => {
    const section: string = sectionOf("en");

    expect(section.split("\n")[0]).toBe("## Who is in a record's channel");
    expect(section).toContain("on your Mattermost server");
    // Mattermost lets a guest be added, and keeps out whoever is not in the team.
    expect(section).toContain("in the team the project is connected to");
    expect(section).toContain("A guest account in that team can be added");
    // It would take people into an archived channel: OneUptime does not ask it.
    expect(section).toContain("unarchived in Mattermost");
    // It lists a channel's people only for somebody in it.
    expect(section).toContain("even a public channel's");
    expect(section).toContain("remove someone from the channel in Mattermost");
    expect(section).not.toContain("Slack channel");
  });

  test("the page's cards lead to the section", () => {
    expect(readPage("en", MATTERMOST_PAGE)).toContain(
      "- [Who is in a record's channel](#who-is-in-a-records-channel):",
    );
  });

  test.each(DOCS_LANGUAGES)(
    "%s quotes the card as its Dashboard draws it, where the English does",
    (language: string) => {
      for (const label of CARD_LABELS) {
        const line: number = lineQuoting("en", label);

        expect({ label, found: line > 0 }).toEqual({ label, found: true });
        expect({ label, line: lineQuoting(language, label) }).toEqual({
          label,
          line: line,
        });
      }
    },
  );

  test.each(DOCS_LANGUAGES)(
    "%s has the section's every line, and leaves Slack out of what it says of Mattermost",
    (language: string) => {
      const section: Array<string> = sectionOf(language).split("\n");

      expect(section.length).toBe(sectionOf("en").split("\n").length);

      for (const line of section) {
        // Only the sentence about a record with channels elsewhere names Slack.
        if (
          boldSpans(line).includes(
            drawnDashboardLabel(language, "Chat Channels"),
          )
        ) {
          continue;
        }

        expect({ line, namesSlack: line.includes("Slack") }).toEqual({
          line,
          namesSlack: false,
        });
      }
    },
  );

  test.each(DOCS_LANGUAGES)(
    "%s's Troubleshooting says what to do about the card's two messages",
    (language: string) => {
      const rows: Array<string> = readPage(language, MATTERMOST_PAGE)
        .split("\n")
        .filter((line: string) => {
          return line.startsWith("| ");
        });

      expect(rows.length).toBe(
        readPage("en", MATTERMOST_PAGE)
          .split("\n")
          .filter((line: string) => {
            return line.startsWith("| ");
          }).length,
      );
      // Both name the product whose settings hold the answer.
      expect(rows[rows.length - 1]).toContain("Mattermost");
      expect(rows[rows.length - 2]).toContain("Mattermost");
    },
  );
});

describe("the feed page names both products a channel member is added in", () => {
  test.each(DOCS_LANGUAGES)("%s", (language: string) => {
    const line: string | undefined = readPage(
      language,
      "incidents/notes-owners-and-feed",
    )
      .split("\n")
      .find((candidate: string) => {
        return candidate.includes("`ChannelMemberAdded`");
      });

    expect(line).toContain("Slack");
    expect(line).toContain("Mattermost");
  });
});
