import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import fs from "fs";
import path from "path";

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
import User from "../../../Models/DatabaseModels/User";
import { Blue500 } from "../../../Types/BrandColors";
import Email from "../../../Types/Email";
import IconProp from "../../../Types/Icon/IconProp";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";

/*
 * A FEED ENTRY NO PERSON MADE, BY THE PROJECT API KEY THAT DID: the key's
 * name leads the entry as a person's would, with a key for a picture and
 * marked "API key" (FeedItem's apiKeyName, from IncidentFeed.apiKeyName). A
 * person's entry shows the person, and an entry by no one leads with no
 * name, as before.
 */

const TIME: FeedTimelineTime = {
  label: "3:25 PM",
  isShown: true,
  relativeHint: "12 min. ago",
  fullLabel: "Tuesday, October 13, 2026 at 3:25:00 PM GMT+08",
  isoString: "2026-10-13T07:25:00.000Z",
};

afterEach(() => {
  cleanup();
});

const renderEntry: (extra: Partial<FeedItemProps>) => void = (
  extra: Partial<FeedItemProps>,
): void => {
  render(
    <ol>
      <FeedItem
        entry={{
          item: {
            key: "entry",
            textInMarkdown: "posted **public note** for this incident.",
            itemDateTime: new Date(TIME.isoString),
            icon: IconProp.Announcement,
            color: Blue500,
            ...extra,
          },
          time: TIME,
          isInBurst: false,
        }}
        isLastInDay={true}
      />
    </ol>,
  );
};

const person: () => User = (): User => {
  const user: User = new User();
  user.id = ObjectID.generate();
  user.name = new Name("Ada Lovelace");
  user.email = new Email("ada@example.com");
  return user;
};

describe("FeedItem - who it is by", () => {
  test("an API key: its name leads the entry, marked as a key, with a key for a picture", () => {
    renderEntry({ apiKeyName: "Jira Automation" });

    const content: HTMLElement = screen.getByTestId("feed-entry-content");
    expect(content).toHaveTextContent("Jira Automation");
    expect(
      within(content).getByTestId("feed-entry-api-key-badge"),
    ).toHaveTextContent("API key");
    expect(
      within(content).getByTestId("feed-entry-api-key-avatar"),
    ).toBeInTheDocument();
    // No person's picture stands in for the key.
    expect(screen.queryByTestId("feed-entry-avatar")).not.toBeInTheDocument();
  });

  test("the key's name leads the sentence the entry says", () => {
    renderEntry({ apiKeyName: "Jira Automation" });

    const lead: HTMLElement = screen.getByTestId("feed-entry-lead");
    expect(lead).toHaveTextContent(/Jira Automation\s*API key\s*posted/);
  });

  test("a person: the person, and no key, even when a key name came along", () => {
    renderEntry({ user: person(), apiKeyName: "Jira Automation" });

    expect(screen.getByTestId("feed-entry-content")).toHaveTextContent(
      "Ada Lovelace",
    );
    expect(screen.getByTestId("feed-entry-avatar")).toBeInTheDocument();
    expect(
      screen.queryByTestId("feed-entry-api-key-badge"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("feed-entry-api-key-avatar"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Jira Automation")).not.toBeInTheDocument();
  });

  test("an author named for someone who is not a user wins over a key", () => {
    renderEntry({ authorName: "Slack member", apiKeyName: "Jira Automation" });

    expect(screen.getByTestId("feed-entry-content")).toHaveTextContent(
      "Slack member",
    );
    expect(
      screen.queryByTestId("feed-entry-api-key-badge"),
    ).not.toBeInTheDocument();
  });

  test.each([undefined, "", "   "])(
    "no one (%p): no author leads the entry, and no key is named",
    (apiKeyName: string | undefined) => {
      renderEntry({ apiKeyName });

      expect(
        screen.queryByTestId("feed-entry-api-key-badge"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("feed-entry-api-key-avatar"),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("feed-entry-lead")).not.toBeInTheDocument();
      expect(screen.queryByTestId("feed-entry-author")).not.toBeInTheDocument();
    },
  );

  test("a long key name wraps inside the entry rather than pushing it wider", () => {
    renderEntry({ apiKeyName: "k".repeat(100) });

    expect(screen.getByTestId("feed-entry-content")).toHaveClass("break-words");
    expect(screen.getByTestId("feed-entry-content")).toHaveTextContent(
      "k".repeat(100),
    );
  });
});

describe("the incident feed hands each item its key", () => {
  const source: string = fs
    .readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "App",
        "FeatureSet",
        "Dashboard",
        "src",
        "Components",
        "Incident",
        "IncidentFeed.tsx",
      ),
      "utf8",
    )
    .replace(/\s+/g, " ");

  test("reads the key's name with every item", () => {
    expect(source).toContain("apiKeyName: true,");
  });

  test("passes it on only for an item no person made", () => {
    expect(source).toContain(
      "apiKeyName: incidentFeed.user ? undefined : incidentFeed.apiKeyName,",
    );
  });
});
