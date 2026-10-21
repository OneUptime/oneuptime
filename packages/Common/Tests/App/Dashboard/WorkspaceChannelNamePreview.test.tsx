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

const JAPANESE: Record<string, string> = {
  "Preview:": "プレビュー:",
  "For incident {{record}}.": "インシデント {{record}} の場合。",
  "Slack channel names use only lowercase letters, numbers, - and _.":
    "Slack のチャネル名に使えるのは英小文字、数字、- と _ だけです。",
  "If Slack already has a channel with this name, OneUptime adds -2 to the end.":
    "Slack に同じ名前のチャネルがすでにある場合、OneUptime は末尾に -2 を付けます。",
};

const GERMAN: Record<string, string> = {
  "Preview:": "Vorschau:",
  "For incident {{record}}.": "Für Vorfall {{record}}.",
  "If Slack already has a channel with this name, OneUptime adds -2 to the end.":
    "Wenn Slack bereits einen Kanal mit diesem Namen hat, hängt OneUptime -2 an.",
};

const askedFor: Array<string> = [];
let language: "en" | "de" | "ja" = "en";

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          if (value) {
            askedFor.push(value);
          }

          if (language === "de" && value && GERMAN[value]) {
            return GERMAN[value];
          }

          if (language === "ja" && value && JAPANESE[value]) {
            return JAPANESE[value];
          }

          return value;
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
  getChannelNameTakenNote,
  getShownChannelName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/ChannelNamePreview";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { WorkspaceChannelNumberPrefixes } from "../../../Utils/Workspace/WorkspaceChannelName";
import { Translator } from "../../../UI/Utils/TranslateTemplate";

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
  id?: string | undefined;
}): void {
  render(
    <ChannelNamePreview
      id={props.id}
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

function takenNote(): string {
  return screen.getByTestId("channel-name-preview-taken").textContent || "";
}

describe("the preview under the Channel Name Prefix field", () => {
  test("no prefix: the incident's own name, which incident it is, and what happens to a taken name", () => {
    renderPreview({ prefix: undefined });

    expect(screen.getByTestId("preview")).toHaveTextContent("Preview: #inc-42");
    expect(shownName()).toBe("#inc-42");
    expect(notes()).toBe("For incident INC-42.");
    expect(takenNote()).toBe(
      "If Slack already has a channel with this name, OneUptime adds -2 to the end.",
    );
  });

  test("the name runs on from its label in one line of text, so the two share a baseline and wrap together", () => {
    renderPreview({ prefix: "prod-" });

    const line: HTMLElement = screen.getByTestId("channel-name-preview")
      .parentElement as HTMLElement;

    // One paragraph of text, not a row of flex items centred on each other.
    expect(line.tagName).toBe("P");
    expect(line.className).not.toMatch(/\bflex\b/);
    expect(line).toHaveTextContent(/^Preview: #prod-inc-42$/);
    // A long name breaks inside itself only when it is longer than a line.
    expect(screen.getByTestId("channel-name-preview")).toHaveClass(
      "break-words",
    );
    expect(screen.getByTestId("channel-name-preview")).not.toHaveClass(
      "break-all",
    );
  });

  test("what happens to a taken name is a line of its own, under the sentences about the name shown", () => {
    renderPreview({ prefix: "Prod Team #1-" });

    expect(notes()).toBe(
      "For incident INC-42. Slack channel names use only lowercase letters, numbers, - and _.",
    );
    expect(takenNote()).toBe(
      "If Slack already has a channel with this name, OneUptime adds -2 to the end.",
    );
    expect(
      screen.getByTestId("channel-name-preview-taken").previousElementSibling,
    ).toBe(screen.getByTestId("channel-name-preview-notes"));
  });

  test("takes the id the prefix field is described by", () => {
    renderPreview({ prefix: "", id: "channel-name-preview-of-the-field" });

    expect(screen.getByTestId("preview")).toHaveAttribute(
      "id",
      "channel-name-preview-of-the-field",
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
    expect(notes()).toBe("For incident INC-42.");
    expect(takenNote()).toBe(
      "If the team already has a channel with this name, OneUptime adds -2 to the end.",
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
      ].join(" "),
    );
    expect(takenNote()).toBe(
      "If Slack already has a channel with this name, OneUptime adds -2 to the end.",
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
    expect(notes()).toBe("Für Vorfall INC-42.");
    expect(takenNote()).toBe(
      "Wenn Slack bereits einen Kanal mit diesem Namen hat, hängt OneUptime -2 an.",
    );
    // The record sentence is asked for with its placeholder, never in pieces.
    expect(askedFor).toContain("For incident {{record}}.");
  });

  test("sentences that end the way Japanese ends one run on without a space", () => {
    language = "ja";
    renderPreview({ prefix: "Prod Team #1-" });

    expect(notes()).toBe(
      "インシデント INC-42 の場合。Slack のチャネル名に使えるのは英小文字、数字、- と _ だけです。",
    );
    expect(takenNote()).toBe(
      "Slack に同じ名前のチャネルがすでにある場合、OneUptime は末尾に -2 を付けます。",
    );
  });

  test("a scheduled maintenance event's prefix takes the place of its number prefix, as its field says", () => {
    renderPreview({
      prefix: "",
      eventType: NotificationRuleEventType.ScheduledMaintenance,
    });

    expect(shownName()).toBe("#sm-42");

    cleanup();

    renderPreview({
      prefix: "maint-",
      eventType: NotificationRuleEventType.ScheduledMaintenance,
    });

    expect(shownName()).toBe("#maint-42");
    expect(notes()).toBe("For scheduled maintenance event SM-42.");
    expect(
      CHANNEL_NAME_PREFIX_DESCRIPTIONS[
        NotificationRuleEventType.ScheduledMaintenance
      ],
    ).toBe(
      "Each new channel is named after its scheduled maintenance event. Anything you write here replaces the event's number prefix.",
    );
  });
});

/*
 * A rule's card names the channel the rule creates once, in its Then - "Creates
 * a channel like #ops-inc-42 for each incident." - not again in a Channel
 * Name Prefix row of its own: WorkspaceNotificationRuleCard.test.tsx.
 */

describe("the words", () => {
  test("one description, one record sentence for every kind of record", () => {
    for (const eventType of ALL_EVENT_TYPES) {
      /*
       * A prefix goes in front of the record's own name - but a scheduled
       * maintenance event's takes the place of its number prefix (sm-42,
       * maint-42), and its description says so.
       */
      expect(CHANNEL_NAME_PREFIX_DESCRIPTIONS[eventType]).toMatch(
        eventType === NotificationRuleEventType.ScheduledMaintenance
          ? /^Each new channel is named after its scheduled maintenance event\. Anything you write here replaces the event's number prefix\.$/
          : /^Each new channel is named after its .+\. Anything you write here goes in front of that name\.$/,
      );
      expect(CHANNEL_NAME_EXAMPLE_RECORD_SENTENCES[eventType]).toMatch(
        /^For .*\{\{record\}\}\.$/,
      );
    }
  });

  test("the taken-name line, in each workspace's words", () => {
    const translator: Translator = {
      translateText: (text: string): string => {
        return text;
      },
    } as unknown as Translator;

    expect(
      getChannelNameTakenNote({
        workspaceType: WorkspaceType.Slack,
        translator: translator,
      }),
    ).toBe(CHANNEL_NAME_TAKEN_NOTES[WorkspaceType.Slack]);
    expect(
      getChannelNameTakenNote({
        workspaceType: WorkspaceType.MicrosoftTeams,
        translator: translator,
      }),
    ).toBe(CHANNEL_NAME_TAKEN_NOTES[WorkspaceType.MicrosoftTeams]);
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
