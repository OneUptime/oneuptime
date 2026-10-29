import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";

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
import IncidentRoleFeedText from "../../../Server/Utils/Incident/IncidentRoleFeedText";
import { Gray500 } from "../../../Types/BrandColors";
import Email from "../../../Types/Email";
import IconProp from "../../../Types/Icon/IconProp";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { MarkdownText, mdText } from "../../../Utils/Markdown/FeedMarkdown";

/*
 * HOW AN INCIDENT'S FEED DRAWS A ROLE CHANGE, FOR EVERY WAY IT HAPPENS.
 *
 * The entry is stored as the server writes it (IncidentRoleFeedText) and
 * drawn by the Dashboard's FeedItem: the author - the entry's user, or the
 * API key - with their name in front of a sentence written to follow it,
 * and an entry with no author as it is written. The same entries reach
 * Slack and Teams, opening with the same author (IncidentRoleChangeActor).
 */

const TIME: FeedTimelineTime = {
  label: "2:05 PM",
  isShown: true,
  relativeHint: "4 min. ago",
  fullLabel: "Thursday, October 29, 2026 at 2:05:00 PM GMT+08",
  isoString: "2026-10-29T06:05:00.000Z",
};

const INCIDENT: MarkdownText = mdText`[Incident INC-18](https://oneuptime.example/dashboard/p/incidents/i)`;
const DEANE: MarkdownText = mdText`[Deane Looi](https://oneuptime.example/dashboard/p/users/d)`;

const person: (name: string) => User = (name: string): User => {
  const user: User = new User();
  user.id = ObjectID.generate();
  user.name = new Name(name);
  user.email = new Email(`${name.split(" ")[0]!.toLowerCase()}@example.com`);
  return user;
};

afterEach(() => {
  cleanup();
});

const renderEntry: (data: {
  markdown: MarkdownText;
  extra?: Partial<FeedItemProps>;
}) => void = (data: {
  markdown: MarkdownText;
  extra?: Partial<FeedItemProps>;
}): void => {
  render(
    <ol>
      <FeedItem
        entry={{
          item: {
            key: "entry",
            textInMarkdown: data.markdown.toString(),
            itemDateTime: new Date(TIME.isoString),
            icon: IconProp.User,
            color: Gray500,
            ...data.extra,
          },
          time: TIME,
          isInBurst: false,
        }}
        isLastInDay={true}
      />
    </ol>,
  );
};

describe("a role change in the incident's feed", () => {
  test("someone adds Deane: 'Valeria Mustafaeva added Deane Looi as Responder to Incident INC-18'", () => {
    renderEntry({
      markdown: IncidentRoleFeedText.getAddedMarkdown({
        roleName: "Responder",
        incident: INCIDENT,
        person: DEANE,
        isSelf: false,
      }),
      extra: { user: person("Valeria Mustafaeva") },
    });

    const lead: HTMLElement = screen.getByTestId("feed-entry-lead");
    expect(lead).toHaveTextContent(
      /^Valeria Mustafaeva added \*\*\[Deane Looi\]\(.+\)\*\* as \*\*Responder\*\* to \[Incident INC-18\]\(.+\)\.$/,
    );
    // Deane is the one the entry is about, never the one in front of it.
    expect(lead).not.toHaveTextContent(/^Deane/);
  });

  test("someone takes Deane off: 'Valeria Mustafaeva removed Deane Looi ...', Deane linked as when he was added", () => {
    renderEntry({
      markdown: IncidentRoleFeedText.getRemovedMarkdown({
        roleName: "Responder",
        incident: INCIDENT,
        person: DEANE,
        isSelf: false,
      }),
      extra: { user: person("Valeria Mustafaeva") },
    });

    const lead: HTMLElement = screen.getByTestId("feed-entry-lead");
    expect(lead).toHaveTextContent(
      /^Valeria Mustafaeva removed \*\*\[Deane Looi\]\(.+\/users\/d\)\*\* as \*\*Responder\*\* from \[Incident INC-18\]\(.+\)\.$/,
    );
    // No email beside the name: the link opens his page.
    expect(lead).not.toHaveTextContent(/@/);
  });

  test("Deane takes it himself: 'Deane Looi took the Responder role on Incident INC-18', his name once", () => {
    renderEntry({
      markdown: IncidentRoleFeedText.getAddedMarkdown({
        roleName: "Responder",
        incident: INCIDENT,
        person: DEANE,
        isSelf: true,
      }),
      extra: { user: person("Deane Looi") },
    });

    const lead: HTMLElement = screen.getByTestId("feed-entry-lead");
    expect(lead).toHaveTextContent(
      /^Deane Looi took the \*\*Responder\*\* role on \[Incident INC-18\]/,
    );
    expect((lead.textContent || "").split("Deane Looi").length - 1).toBe(1);
  });

  test("Deane leaves it: 'Deane Looi left the Responder role on Incident INC-18'", () => {
    renderEntry({
      markdown: IncidentRoleFeedText.getRemovedMarkdown({
        roleName: "Responder",
        incident: INCIDENT,
        person: DEANE,
        isSelf: true,
      }),
      extra: { user: person("Deane Looi") },
    });

    expect(screen.getByTestId("feed-entry-lead")).toHaveTextContent(
      /^Deane Looi left the \*\*Responder\*\* role on /,
    );
  });

  test("an API key: the key leads, marked as one", () => {
    renderEntry({
      markdown: IncidentRoleFeedText.getAddedMarkdown({
        roleName: "Responder",
        incident: INCIDENT,
        person: DEANE,
        isSelf: false,
      }),
      extra: { apiKeyName: "Jira Automation" },
    });

    expect(screen.getByTestId("feed-entry-lead")).toHaveTextContent(
      /^Jira Automation\s*API key\s*added \*\*\[Deane Looi\]/,
    );
  });

  test.each<[string, MarkdownText, RegExp]>([
    [
      "a workflow names itself",
      IncidentRoleFeedText.getAddedMarkdown({
        roleName: "Responder",
        incident: INCIDENT,
        person: DEANE,
        isSelf: false,
        workflowName: "Page SRE",
      }),
      /^Workflow \*\*Page SRE\*\* added \*\*\[Deane Looi\]/,
    ],
    [
      "a monitor names itself",
      IncidentRoleFeedText.getAddedMarkdown({
        roleName: "Observer",
        incident: INCIDENT,
        person: DEANE,
        isSelf: false,
        cause: { kind: "monitor", monitorName: "API Health" },
      }),
      /^Monitor \*\*API Health\*\* added \*\*\[Deane Looi\]/,
    ],
    [
      "OneUptime says why it made Deane the commander",
      IncidentRoleFeedText.getAddedMarkdown({
        roleName: "Incident Commander",
        incident: INCIDENT,
        person: DEANE,
        isSelf: false,
        cause: { kind: "stateChange", stateName: "Acknowledged" },
      }),
      /^\*\*\[Deane Looi\]\(.+\)\*\* became the \*\*Incident Commander\*\* of .+ when they changed its state to \*\*Acknowledged\*\*\.$/,
    ],
  ])(
    "%s, with no author in front of it",
    (_label: string, markdown: MarkdownText, reads: RegExp) => {
      renderEntry({ markdown: markdown });

      expect(screen.queryByTestId("feed-entry-lead")).not.toBeInTheDocument();
      expect(screen.queryByTestId("feed-entry-author")).not.toBeInTheDocument();
      expect(screen.getByTestId("markdown")).toHaveTextContent(reads);
    },
  );
});
