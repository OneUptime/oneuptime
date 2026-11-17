import {
  STATUS_CHIPS,
  WHO_WAS_TOLD_COPY,
} from "../../../FeatureSet/Dashboard/src/Components/WhoWasTold/WhoWasToldCopy";
import {
  WHO_WAS_TOLD_REFRESH_INTERVAL_IN_MS,
  WhoWasToldStatus,
} from "Common/Types/Notification/WhoWasTold";
import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import { dashboardLabel } from "./DocsDashboardLabels";
import { describe, expect, test } from "@jest/globals";

/*
 * THE DOCS ON WHO WAS TOLD (#7075, #7525).
 *
 * An incident's and an alert's Overview has a Who Was Told card: who
 * OneUptime told, by what, and what failed, as it happened. The incidents
 * page says what the card shows, the alerts page where it is, and the Ask
 * AI page what who_is_told now names - in every docs language, each naming
 * the card and its statuses as that language's Dashboard draws them.
 * Markdown is not compiled, so these tests are what notices when the pages
 * and the card part ways.
 */

const INCIDENTS: string = "incidents/index";
const ALERTS: string = "alerts/index";
const ASK_AI: string = "ai/ask-ai";

// Every status a person's line can show, in the order the card defines them.
const STATUSES: Array<string> = (
  Object.values(WhoWasToldStatus) as Array<WhoWasToldStatus>
).map((status: WhoWasToldStatus): string => {
  return STATUS_CHIPS[status].text;
});

function bold(text: string): string {
  return `**${text}**`;
}

describe("the English pages say what the card shows", () => {
  test("the incidents page has a section on it, naming the card, where it is, and every status it shows", () => {
    const page: string = readPage("en", INCIDENTS);

    expect(page).toContain("## Who was told");
    expect(page).toContain(
      `The incident's **Overview** has a ${bold(WHO_WAS_TOLD_COPY.title)} card.`,
    );

    for (const status of STATUSES) {
      expect(page).toContain(bold(status));
    }

    expect(page).toContain(bold(WHO_WAS_TOLD_COPY.showDetails));
    expect(page).toContain(bold(WHO_WAS_TOLD_COPY.notificationLogs));
  });

  test("the incidents page says the card reads again while the incident is open, as often as it does", () => {
    // Every few seconds: the card reads again at least once a minute.
    expect(WHO_WAS_TOLD_REFRESH_INTERVAL_IN_MS).toBeLessThan(60 * 1000);
    expect(readPage("en", INCIDENTS)).toContain(
      "While the incident is open, the card reads again every few seconds.",
    );
  });

  test("the incidents page says nothing is shown that the reader can't already read", () => {
    expect(readPage("en", INCIDENTS)).toContain(
      "It shows only what you can already read: a private incident's card is for those who can open the incident, and notifications or on-call policy runs you can't open are counted under the list, never named.",
    );
  });

  test("the alerts page says where the card is on an alert", () => {
    expect(readPage("en", ALERTS)).toContain(
      `- **Who was told.** The alert's **Overview** has a ${bold(WHO_WAS_TOLD_COPY.title)} card`,
    );
  });

  test("the Ask AI page says what who_is_told names besides who is told (#7525)", () => {
    expect(readPage("en", ASK_AI)).toContain(
      "It also names the title of what the monitor opens, the on-call rules that match it and which one runs each policy, and why someone can't be paged, in the words the monitor's page uses, and leaves out what you can't read.",
    );
  });
});

describe.each(
  DOCS_LANGUAGES.filter((language: string): boolean => {
    return language !== "en";
  }),
)("%s", (language: string) => {
  test("the incidents page names the card and its statuses as this language's Dashboard draws them", () => {
    const page: string = readPage(language, INCIDENTS);

    expect(page).toContain(
      bold(dashboardLabel(language, WHO_WAS_TOLD_COPY.title)),
    );

    for (const status of STATUSES) {
      expect({
        status,
        named: page.includes(bold(dashboardLabel(language, status))),
      }).toEqual({
        status,
        named: true,
      });
    }

    expect(page).toContain(
      bold(dashboardLabel(language, WHO_WAS_TOLD_COPY.showDetails)),
    );
  });

  test("the alerts page names the card as this language's Dashboard draws it", () => {
    expect(readPage(language, ALERTS)).toContain(
      bold(dashboardLabel(language, WHO_WAS_TOLD_COPY.title)),
    );
  });
});
