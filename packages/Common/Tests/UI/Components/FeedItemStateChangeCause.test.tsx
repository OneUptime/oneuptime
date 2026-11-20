import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "markdown" },
        props.text,
      );
    },
  };
});

import FeedItem, { FeedItemProps } from "../../../UI/Components/Feed/FeedItem";
import { FeedTimelineTime } from "../../../UI/Components/Feed/FeedTimeline";
import { Blue500 } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import FeedMarkdown, { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import {
  STATE_CHANGED_BY_EPISODE,
  STATE_CHANGED_WITH_ITS_EPISODE,
} from "../../../Utils/Monitor/StatusChangeNotes";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A STATE CHANGE'S CAUSE, UNFOLDED IN A FEED, IN THE READER'S LANGUAGE
 * (#10126).
 *
 * An incident's feed entry for a state change unfolds why it changed under
 * Show details. It read in English on every page - "Cause: State changed by
 * episode state cascade." - while the change's View Cause said it in the
 * reader's words. The entry keeps its English; the feed words it as it
 * unfolds it, the same way View Cause does.
 */

const TIME: FeedTimelineTime = {
  label: "3:25 PM",
  isShown: true,
  relativeHint: "12 min. ago",
  fullLabel: "Tuesday, October 13, 2026 at 3:25:00 PM GMT+08",
  isoString: "2026-10-13T07:25:00.000Z",
};

// An incident's state change, as IncidentStateTimelineService posts it.
function stateChangeEntry(cause: string): FeedItemProps {
  return {
    key: "state-change",
    textInMarkdown:
      mdText`🔴 Changed **[Incident ${"INC-42"}](${"https://oneuptime.example/dashboard/p/incidents/i"}) State** to **${"Resolved"}**`.toString(),
    moreTextInMarkdown: mdText`**Cause:**
${FeedMarkdown.asMarkdown(cause)}`.toString(),
    itemDateTime: new Date(TIME.isoString),
    icon: IconProp.ArrowCircleRight,
    color: Blue500,
  };
}

const instances: Record<string, i18n> = {};

function translationIn(language: string): i18n {
  if (!instances[language]) {
    const instance: i18n = createInstance();
    void instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        [language]: { translation: readDashboardLocale(language) },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
      initImmediate: false,
    });
    instances[language] = instance;
  }

  return instances[language]!;
}

// The entry in `language`, its details unfolded: what they say.
function unfoldedDetails(language: string, item: FeedItemProps): string {
  const view: RenderResult = render(
    <I18nextProvider i18n={translationIn(language)}>
      <ol>
        <FeedItem
          entry={{ item: item, time: TIME, isInBurst: false }}
          isLastInDay={true}
        />
      </ol>
    </I18nextProvider>,
  );

  fireEvent.click(view.getByTestId("feed-entry-details-toggle"));

  return withoutIsolateMarks(
    view.getByTestId("feed-entry-details").textContent || "",
  );
}

afterEach(() => {
  cleanup();
});

describe("a state change's cause, unfolded in its feed", () => {
  test("regression: an incident's feed in Persian says its episode's cascade in Persian", () => {
    const words: Record<string, string> = readDashboardLocale("fa");
    const details: string = unfoldedDetails(
      "fa",
      stateChangeEntry(STATE_CHANGED_BY_EPISODE),
    );

    expect(details).toBe(
      `**${words["Cause"]}:**\n${words[STATE_CHANGED_WITH_ITS_EPISODE]}`,
    );
    expect(details).not.toContain("cascade");
    expect(details).not.toContain("Cause:");
  });

  test.each(["ar", "de", "ja"])(
    "in %s, the same entry's cause reads in the reader's words",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const details: string = unfoldedDetails(
        language,
        stateChangeEntry(STATE_CHANGED_BY_EPISODE),
      );

      expect(details).toContain(words[STATE_CHANGED_WITH_ITS_EPISODE]!);
      expect(details).toContain(words["Cause"]!);
      expect(details).not.toContain("cascade");
    },
  );

  test("in English, the cause as View Cause says it", () => {
    expect(
      unfoldedDetails("en", stateChangeEntry(STATE_CHANGED_BY_EPISODE)),
    ).toBe(`**Cause:**\n${STATE_CHANGED_WITH_ITS_EPISODE}`);
  });

  test("a cause a person typed reads as typed, under the reader's label", () => {
    const words: Record<string, string> = readDashboardLocale("fa");

    expect(
      unfoldedDetails("fa", stateChangeEntry("Rolled back the deploy.")),
    ).toBe(`**${words["Cause"]}:**\nRolled back the deploy.`);
  });

  test("details of another kind unfold as they were posted", () => {
    const details: string = "**Notified:** Nitin Kumar (nitin@example.com)";

    expect(
      unfoldedDetails("fa", {
        ...stateChangeEntry(""),
        moreTextInMarkdown: details,
      }),
    ).toContain("Nitin Kumar (nitin@example.com)");
  });
});
