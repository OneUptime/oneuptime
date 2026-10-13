import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import fs from "fs";
import path from "path";

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return React.createElement("div", {}, props.text);
    },
  };
});

import FeedItem from "../../../UI/Components/Feed/FeedItem";
import User from "../../../Models/DatabaseModels/User";
import { Blue500 } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";

/*
 * A FEED ITEM NO PERSON MADE, BY THE PROJECT API KEY THAT DID: the key's
 * name in the author's place, marked "API key", with a key where a
 * person's picture would be (FeedItem's apiKeyName, from
 * IncidentFeed.apiKeyName). A person's item shows the person, as before;
 * an item by no one shows only its event's icon, as before.
 */

afterEach(() => {
  cleanup();
});

const renderItem: (props: {
  user?: User | undefined;
  apiKeyName?: string | undefined;
}) => void = (props: {
  user?: User | undefined;
  apiKeyName?: string | undefined;
}): void => {
  render(
    <FeedItem
      key="feed-item"
      textInMarkdown="posted a public note"
      itemDateTime={new Date("2026-10-01T12:00:00.000Z")}
      icon={IconProp.Announcement}
      color={Blue500}
      isLastItem={true}
      user={props.user}
      apiKeyName={props.apiKeyName}
    />,
  );
};

const person: () => User = (): User => {
  const user: User = new User();
  user.id = ObjectID.generate();
  user.name = new Name("Ada Lovelace");
  return user;
};

describe("FeedItem - who it is by", () => {
  test("an API key: its name, marked as a key, with a key for a picture", () => {
    renderItem({ apiKeyName: "Jira Automation" });

    const author: HTMLElement = screen.getByTestId("feed-item-api-key");
    expect(author).toHaveTextContent("Jira Automation");
    expect(author).toHaveTextContent("API key");
    expect(screen.getByTestId("feed-item-api-key-avatar")).toBeInTheDocument();
    expect(screen.getByText("posted a public note")).toBeInTheDocument();
  });

  test("a person: the person, and no key, even when a key name came along", () => {
    renderItem({ user: person(), apiKeyName: "Jira Automation" });

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.queryByTestId("feed-item-api-key")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("feed-item-api-key-avatar"),
    ).not.toBeInTheDocument();
  });

  test.each([undefined, "", "   "])(
    "no one (%p): no author line, only the event's icon",
    (apiKeyName: string | undefined) => {
      renderItem({ apiKeyName });

      expect(screen.queryByTestId("feed-item-api-key")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("feed-item-api-key-avatar"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("API key")).not.toBeInTheDocument();
    },
  );

  test("a long key name wraps rather than pushing the item wider", () => {
    renderItem({ apiKeyName: "k".repeat(100) });

    expect(screen.getByText("k".repeat(100))).toHaveClass("break-all");
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
