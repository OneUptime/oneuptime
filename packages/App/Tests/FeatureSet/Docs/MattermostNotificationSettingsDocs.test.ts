import { describe, expect, test } from "@jest/globals";
import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";

/*
 * Mattermost in Notification Settings. A connected Mattermost account gets the
 * updates a member switches on there, as a Slack or Microsoft Teams account
 * does. So the Notification Settings page names its column, every other page
 * that lists the page's channels names it too, and the sentence that said a
 * Mattermost account gets pages only is gone, in every docs language.
 */

const SETTINGS_PAGE: string = "notifications/notification-settings";
const METHODS_PAGE: string = "notifications/notification-methods";

const PAGES_LISTING_CHANNELS: ReadonlyArray<string> = [
  "incidents/index",
  "incidents/notes-owners-and-feed",
  "telemetry/security-cases",
  "emails/notification-rollup",
];

/*
 * The lines of a page that list the channels: Telegram and Microsoft Teams
 * close together, which is where every language's list has them.
 */
function channelLists(language: string, page: string): Array<string> {
  return readPage(language, page)
    .split("\n")
    .filter((line: string): boolean => {
      const telegram: number = line.indexOf("Telegram");

      return (
        telegram >= 0 &&
        line.indexOf("Microsoft Teams", telegram) > telegram &&
        line.indexOf("Microsoft Teams", telegram) - telegram < 40
      );
    });
}

describe("the Notification Settings page", () => {
  test("names the Mattermost column in English, between Microsoft Teams and Webhook", () => {
    expect(readPage("en", SETTINGS_PAGE)).toContain(
      "Email, SMS, Call, Push, WhatsApp, Telegram, Slack, Microsoft Teams, Mattermost and Webhook. Slack, Microsoft Teams and Mattermost are columns only when the project has connected them.",
    );
  });

  test.each(DOCS_LANGUAGES)(
    "%s names Mattermost among the columns, and among the columns a project connects, on the English line",
    (language: string) => {
      const english: Array<string> = readPage("en", SETTINGS_PAGE).split("\n");
      const index: number = english.findIndex((line: string): boolean => {
        return line.includes("Slack, Microsoft Teams and Mattermost are");
      });

      expect(index).toBeGreaterThan(0);

      const line: string = readPage(language, SETTINGS_PAGE).split("\n")[
        index
      ] as string;

      // Once in the list of columns, once among the ones a project connects.
      expect({ language, count: line.split("Mattermost").length - 1 }).toEqual({
        language,
        count: 2,
      });

      const firstTeams: number = line.indexOf("Microsoft Teams");
      const firstMattermost: number = line.indexOf("Mattermost");

      expect(firstTeams).toBeGreaterThan(line.indexOf("Slack"));
      expect(firstMattermost).toBeGreaterThan(firstTeams);
      expect(line.indexOf("Webhook")).toBeGreaterThan(firstMattermost);
    },
  );
});

describe("the Notification Methods page", () => {
  test.each(DOCS_LANGUAGES)(
    "%s no longer says a Mattermost account gets pages only",
    (language: string) => {
      const english: Array<string> = readPage("en", METHODS_PAGE).split("\n");
      const translated: Array<string> = readPage(language, METHODS_PAGE).split(
        "\n",
      );

      // The section ends with its steps: nothing is left after the third.
      const heading: number = english.findIndex((line: string): boolean => {
        return line === "## Push notifications";
      });

      expect(heading).toBeGreaterThan(0);
      expect(translated.length).toBe(english.length);
      expect(translated[heading - 1]).toBe("");
      expect(translated[heading - 2]?.startsWith("3. ")).toBe(true);
      expect(translated[heading]?.startsWith("## ")).toBe(true);
    },
  );

  test("the English has no sentence saying so anywhere", () => {
    const page: string = readPage("en", METHODS_PAGE);

    expect(page).not.toContain("gets your pages only");
    expect(page).not.toContain("not the updates you choose");
  });
});

describe("the other pages that list the channels of Notification Settings", () => {
  test.each(PAGES_LISTING_CHANNELS)(
    "%s has such a list in English, for this suite to read",
    (page: string) => {
      expect(channelLists("en", page).length).toBeGreaterThan(0);
    },
  );

  test.each(
    DOCS_LANGUAGES.flatMap((language: string): Array<[string, string]> => {
      return PAGES_LISTING_CHANNELS.map((page: string): [string, string] => {
        return [language, page];
      });
    }),
  )(
    "%s %s names Mattermost after Microsoft Teams",
    (language: string, page: string) => {
      const lists: Array<string> = channelLists(language, page);

      expect(lists.length).toBe(channelLists("en", page).length);

      for (const line of lists) {
        const teams: number = line.indexOf("Microsoft Teams");
        const mattermost: number = line.indexOf("Mattermost", teams);

        expect({ language, page, line, named: mattermost > teams }).toEqual({
          language,
          page,
          line,
          named: true,
        });
      }
    },
  );
});
