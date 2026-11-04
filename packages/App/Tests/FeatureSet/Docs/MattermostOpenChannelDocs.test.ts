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
