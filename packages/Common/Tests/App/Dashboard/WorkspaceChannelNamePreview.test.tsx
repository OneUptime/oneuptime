import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

/*
 * What the rule form and a rule's card say the channel a rule creates is
 * called (Components/Workspace/NotificationRuleForm/ChannelNamePreview).
 *
 * The customer asked for inc-123 instead of foo-inc-123: the prefix is
 * optional, and both places show the name an example record's channel gets -
 * worked out by the function the server names channels with, from the
 * project's own number prefixes. Every sentence is looked up whole in the
 * reader's language: the translation stub below answers German for the keys
 * it knows and marks every key it is asked for.
 */

const GERMAN: Record<string, string> = {
  "Preview:": "Vorschau:",
  "For incident {{record}}.": "Für Vorfall {{record}}.",
  "If Slack already has a channel with this name, OneUptime adds -2 to the end.":
    "Wenn Slack bereits einen Kanal mit diesem Namen hat, hängt OneUptime -2 an.",
  "No prefix": "Kein Präfix",
  "Example:": "Beispiel:",
};

const askedFor: Array<string> = [];
let language: "en" | "de" = "en";

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          if (value) {
            askedFor.push(value);
          }

          return language === "de" && value && GERMAN[value]
            ? GERMAN[value]
            : value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import {
  CHANNEL_NAME_CHARACTER_NOTES,
  CHANNEL_NAME_EXAMPLE_RECORD_SENTENCES,
  CHANNEL_NAME_PREFIX_DESCRIPTIONS,
  CHANNEL_NAME_SHORTENED_NOTES,
  CHANNEL_NAME_TAKEN_NOTES,
  ChannelNamePreview,
  ChannelNameSummary,
  getShownChannelName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/ChannelNamePreview";
import NotificationRuleViewElement from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleViewElement/NotificationRuleViewElement";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import IncidentNotificationRule from "../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { WorkspaceChannelNumberPrefixes } from "../../../Utils/Workspace/WorkspaceChannelName";

const PREFIXES: WorkspaceChannelNumberPrefixes = {
  [NotificationRuleEventType.Incident]: "INC-",
  [NotificationRuleEventType.Alert]: "ALT-",
  [NotificationRuleEventType.IncidentEpisode]: "IE-",
  [NotificationRuleEventType.AlertEpisode]: "AE-",
  [NotificationRuleEventType.ScheduledMaintenance]: "SM-",
};

const ALL_EVENT_TYPES: Array<NotificationRuleEventType> = Object.values(
  NotificationRuleEventType,
);

afterEach(() => {
  cleanup();
  askedFor.length = 0;
  language = "en";
});

function renderPreview(props: {
  prefix: unknown;
  workspaceType?: WorkspaceType;
  eventType?: NotificationRuleEventType;
  numberPrefixes?: WorkspaceChannelNumberPrefixes | undefined;
  exampleRecordName?: string | undefined;
}): void {
  render(
    <ChannelNamePreview
      workspaceType={props.workspaceType || WorkspaceType.Slack}
      eventType={props.eventType || NotificationRuleEventType.Incident}
      prefix={props.prefix}
      numberPrefixes={
        "numberPrefixes" in props ? props.numberPrefixes : PREFIXES
      }
      exampleRecordName={props.exampleRecordName}
      dataTestId="preview"
    />,
  );
}

function shownName(): string {
  return screen.getByTestId("channel-name-preview").textContent || "";
}

function notes(): string {
  return screen.getByTestId("channel-name-preview-notes").textContent || "";
}

describe("the preview under the Channel Name Prefix field", () => {
  test("no prefix: the incident's own name, which incident it is, and what happens to a taken name", () => {
    renderPreview({ prefix: undefined });

    expect(screen.getByTestId("preview")).toHaveTextContent(
      "Preview: #inc-42",
    );
    expect(shownName()).toBe("#inc-42");
    expect(notes()).toBe(
      "For incident INC-42. If Slack already has a channel with this name, OneUptime adds -2 to the end.",
    );
  });

  test("the customer's foo-: #foo-inc-42", () => {
    renderPreview({ prefix: "foo-" });

    expect(shownName()).toBe("#foo-inc-42");
  });

  test("Microsoft Teams shows no #, keeps capitals and spaces, and says the team's name is what is taken", () => {
    renderPreview({
      prefix: "Ops Team-",
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    expect(shownName()).toBe("Ops Team-inc-42");
    expect(notes()).toBe(
      "For incident INC-42. If the team already has a channel with this name, OneUptime adds -2 to the end.",
    );
  });

  test("says when Slack changed the prefix, and when the name was shortened, in that order", () => {
    renderPreview({ prefix: `Ops ${"x".repeat(90)}` });

    // 80 characters: the prefix gives way, the incident's part stays whole.
    expect(shownName()).toBe(`#ops${"x".repeat(71)}inc-42`);
    expect(notes()).toBe(
      [
        "For incident INC-42.",
        "Slack channel names use only lowercase letters, numbers, - and _.",
        "Shortened to Slack's limit of 80 characters.",
        "If Slack already has a channel with this name, OneUptime adds -2 to the end.",
      ].join(" "),
    );
  });

  test("Microsoft Teams' own notes", () => {
    renderPreview({
      prefix: `Ops#${"y".repeat(60)}`,
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    expect(notes()).toContain(
      "OneUptime uses only letters, numbers, spaces, - and _ in Microsoft Teams channel names.",
    );
    expect(notes()).toContain(
      "Shortened to the Microsoft Teams limit of 50 characters.",
    );
  });

  test("shows nothing for a numbered record until the project's number prefixes are known", () => {
    renderPreview({ prefix: "ops-", numberPrefixes: undefined });

    expect(screen.queryByTestId("preview")).toBe(null);
    expect(screen.queryByTestId("channel-name-preview")).toBe(null);
  });

  test("a monitor's needs no number prefixes: one of the project's monitors, or Website", () => {
    renderPreview({
      prefix: "",
      eventType: NotificationRuleEventType.Monitor,
      numberPrefixes: undefined,
      exampleRecordName: "API Health",
    });

    expect(shownName()).toBe("#apihealth");
    expect(notes()).toContain("For the monitor API Health.");

    cleanup();

    renderPreview({
      prefix: "",
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      numberPrefixes: undefined,
    });

    expect(shownName()).toBe("#primary");
    expect(notes()).toContain("For the on-call policy Primary.");
  });

  test("a value that is not text is no prefix", () => {
    renderPreview({ prefix: 42 });

    expect(shownName()).toBe("#inc-42");
  });

  test("every sentence is looked up whole, and read in the reader's language", () => {
    language = "de";
    renderPreview({ prefix: "" });

    expect(screen.getByTestId("preview")).toHaveTextContent(
      "Vorschau: #inc-42",
    );
    expect(notes()).toBe(
      "Für Vorfall INC-42. Wenn Slack bereits einen Kanal mit diesem Namen hat, hängt OneUptime -2 an.",
    );
    // The record sentence is asked for with its placeholder, never in pieces.
    expect(askedFor).toContain("For incident {{record}}.");
  });
});

describe("the channel name on a rule's card", () => {
  function renderSummary(prefix: unknown, numberPrefixes?: WorkspaceChannelNumberPrefixes | undefined): void {
    render(
      <ChannelNameSummary
        workspaceType={WorkspaceType.Slack}
        eventType={NotificationRuleEventType.Incident}
        prefix={prefix}
        numberPrefixes={numberPrefixes}
        dataTestId="summary"
      />,
    );
  }

  test("a prefix, and the name it makes", () => {
    renderSummary("prod-", PREFIXES);

    expect(screen.getByTestId("channel-name-prefix-value")).toHaveTextContent(
      "prod-",
    );
    expect(screen.getByTestId("summary")).toHaveTextContent(
      "prod- Example: #prod-inc-42",
    );
    expect(screen.getByTestId("channel-name-example")).toHaveTextContent(
      "#prod-inc-42",
    );
  });

  test("no prefix, and the record's own name", () => {
    renderSummary("", PREFIXES);

    expect(screen.getByTestId("channel-name-prefix-value")).toHaveTextContent(
      "No prefix",
    );
    expect(screen.getByTestId("channel-name-example")).toHaveTextContent(
      "#inc-42",
    );
  });

  test("without the project's number prefixes: the prefix alone", () => {
    renderSummary("prod-", undefined);

    expect(screen.getByTestId("channel-name-prefix-value")).toHaveTextContent(
      "prod-",
    );
    expect(screen.queryByTestId("channel-name-example")).toBe(null);
  });

  test("in the reader's language", () => {
    language = "de";
    renderSummary(undefined, PREFIXES);

    expect(screen.getByTestId("summary")).toHaveTextContent(
      "Kein Präfix Beispiel: #inc-42",
    );
  });
});

describe("the rule's card shows its channel name", () => {
  function rule(fields: Partial<IncidentNotificationRule>): IncidentNotificationRule {
    return {
      _type: "IncidentNotificationRule",
      filterCondition: FilterCondition.All,
      filters: [],
      shouldPostToExistingChannel: false,
      existingChannelNames: "",
      shouldCreateNewChannel: true,
      inviteTeamsToNewChannel: [],
      inviteUsersToNewChannel: [],
      shouldInviteOwnersToNewChannel: false,
      archiveChannelAutomatically: false,
      shouldAutomaticallyInviteOnCallUsersToNewChannel: false,
      ...fields,
    } as IncidentNotificationRule;
  }

  function renderCard(value: IncidentNotificationRule, workspaceType: WorkspaceType = WorkspaceType.Slack): void {
    render(
      <NotificationRuleViewElement
        value={value}
        eventType={NotificationRuleEventType.Incident}
        monitors={[]}
        labels={[]}
        alertStates={[]}
        alertSeverities={[]}
        incidentSeverities={[]}
        incidentStates={[]}
        scheduledMaintenanceStates={[]}
        monitorStatus={[]}
        workspaceType={workspaceType}
        teams={[]}
        users={[]}
        numberPrefixes={PREFIXES}
      />,
    );
  }

  test("a rule that creates channels: Channel Name Prefix, with the example", () => {
    renderCard(rule({ newChannelTemplateName: "ops-" }));

    expect(screen.getByText("Channel Name Prefix")).toBeVisible();
    expect(screen.getByTestId("channel-name-summary")).toHaveTextContent(
      "ops- Example: #ops-inc-42",
    );
  });

  test("a rule without a prefix says so", () => {
    renderCard(rule({ newChannelTemplateName: "" }));

    expect(screen.getByTestId("channel-name-summary")).toHaveTextContent(
      "No prefix Example: #inc-42",
    );
  });

  test("Microsoft Teams: the name as Teams shows it", () => {
    renderCard(rule({}), WorkspaceType.MicrosoftTeams);

    expect(screen.getByTestId("channel-name-example")).toHaveTextContent(
      /^inc-42$/,
    );
  });

  test("a rule that creates no channel shows no channel name", () => {
    renderCard(rule({ shouldCreateNewChannel: false }));

    expect(screen.queryByText("Channel Name Prefix")).toBe(null);
    expect(screen.queryByTestId("channel-name-summary")).toBe(null);
  });
});

describe("the words", () => {
  test("one description, one record sentence for every kind of record", () => {
    for (const eventType of ALL_EVENT_TYPES) {
      expect(CHANNEL_NAME_PREFIX_DESCRIPTIONS[eventType]).toMatch(
        /^Each new channel is named after its .+\. Anything you write here goes in front of that name\.$/,
      );
      expect(CHANNEL_NAME_EXAMPLE_RECORD_SENTENCES[eventType]).toMatch(
        /^For .*\{\{record\}\}\.$/,
      );
    }
  });

  test("each workspace has its own notes", () => {
    for (const workspaceType of [
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
    ]) {
      expect(CHANNEL_NAME_CHARACTER_NOTES[workspaceType]).toBeTruthy();
      expect(CHANNEL_NAME_SHORTENED_NOTES[workspaceType]).toContain(
        "{{count}}",
      );
      expect(CHANNEL_NAME_TAKEN_NOTES[workspaceType]).toContain("-2");
    }
  });

  test("a channel name as each workspace shows it", () => {
    expect(getShownChannelName(WorkspaceType.Slack, "inc-42")).toBe("#inc-42");
    expect(getShownChannelName(WorkspaceType.MicrosoftTeams, "inc-42")).toBe(
      "inc-42",
    );
  });
});
