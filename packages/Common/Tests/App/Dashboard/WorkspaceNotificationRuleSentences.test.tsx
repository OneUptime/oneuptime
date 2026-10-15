import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";

/*
 * WHAT A WORKSPACE NOTIFICATION RULE SAYS IT DOES.
 *
 * A rule's card listed every switch the rule holds, Yes or No - "Automatically
 * Invite On Call Users to New Slack Channel: Yes" - and the customer who had
 * that switch on could not tell that the Incident Commander was not in it.
 * The card and the rule form now say what the rule does, in sentences:
 *
 *   When  Every incident.
 *   Then  - Creates a channel like #inc-42 for each incident.
 *         - Invites on-call responders as they are paged, the Incident
 *           Commander and other incident roles as they are assigned and
 *           owners as they are added.
 *         - Archives the channel when the incident is resolved.
 *         - Posts updates in #ops.
 *
 * The sentences come from NotificationRuleCopy, whole in every language the
 * Dashboard speaks; a list of names goes in built in the sentence's
 * language.
 */

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import * as Copy from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleCopy";
import {
  getExistingChannelNames,
  getNotificationRuleSummary,
  NotificationRuleSummaryInput,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleCopy";
import NotificationRuleViewElement from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleViewElement/NotificationRuleViewElement";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import Name from "../../../Types/Name";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleInvites from "../../../Types/Workspace/NotificationRules/NotificationRuleInvites";
import {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import IncidentNotificationRule from "../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { WorkspaceChannelNumberPrefixes } from "../../../Utils/Workspace/WorkspaceChannelName";
import {
  createTranslator,
  getTemplatePlaceholders,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

const DASHBOARD: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard",
);

const LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DASHBOARD, file), "utf8")) as T;
}

function readLocale(language: string): Record<string, string> {
  return readJson<Record<string, string>>(`src/Locales/${language}.json`);
}

function translatorFor(language: string): Translator {
  const words: Record<string, string> =
    language === "en" ? {} : readLocale(language);

  return createTranslator((text: string): string | undefined => {
    return words[text];
  }, language);
}

const ENGLISH: Translator = translatorFor("en");

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

// A saved rule: the switches a rule's JSON holds, and any of them changed.
function rule(fields: Record<string, unknown>): IncidentNotificationRule {
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

function sentences(
  input: Partial<NotificationRuleSummaryInput> & {
    rule: IncidentNotificationRule;
  },
): Array<string> {
  return getNotificationRuleSummary({
    eventType: NotificationRuleEventType.Incident,
    workspaceType: WorkspaceType.Slack,
    translator: ENGLISH,
    exampleChannelName: "#inc-42",
    userNames: [],
    teamNames: [],
    chatNames: [],
    ...input,
  });
}

afterEach(() => {
  cleanup();
});

describe("the sentences that say what a rule does", () => {
  test("a channel for each incident, everyone the incident has, archived when resolved, and an existing channel", () => {
    expect(
      sentences({
        rule: rule({
          ...NotificationRuleInvites.getNewRuleSwitches(
            NotificationRuleEventType.Incident,
          ),
          archiveChannelAutomatically: true,
          shouldPostToExistingChannel: true,
          existingChannelNames: "#ops",
        }),
      }),
    ).toEqual([
      "Creates a channel like #inc-42 for each incident.",
      "Invites on-call responders as they are paged, the Incident Commander and other incident roles as they are assigned and owners as they are added.",
      "Archives the channel when the incident is resolved.",
      "Posts updates in #ops.",
    ]);
  });

  /*
   * The customer's rule: on-call responders on, saved before incident roles
   * had a switch. It invites the commander too now, and says so.
   */
  test("the customer's on-call rule invites the Incident Commander too", () => {
    expect(
      sentences({
        rule: rule({
          shouldAutomaticallyInviteOnCallUsersToNewChannel: true,
        }),
      }),
    ).toEqual([
      "Creates a channel like #inc-42 for each incident.",
      "Invites on-call responders as they are paged and the Incident Commander and other incident roles as they are assigned.",
    ]);
  });

  test("a rule that says it leaves incident roles out is taken at its word", () => {
    expect(
      sentences({
        rule: rule({
          shouldAutomaticallyInviteOnCallUsersToNewChannel: true,
          shouldInviteIncidentRolesToNewChannel: false,
        }),
      })[1],
    ).toBe("Invites on-call responders as they are paged.");
  });

  test("the people and teams the rule names join when the channel is created", () => {
    expect(
      sentences({
        rule: rule({ shouldInviteOwnersToNewChannel: true }),
        userNames: ["Alice"],
        teamNames: ["Database"],
      })[1],
    ).toBe(
      "Invites the Incident Commander and other incident roles as they are assigned, owners as they are added and Alice and Database when the channel is created.",
    );
  });

  test("a rule that invites nobody says so, and how to add people", () => {
    expect(sentences({ rule: rule({}) })).toEqual([
      "Creates a channel like #inc-42 for each incident.",
      "Invites nobody to the channel: add people to it yourself.",
    ]);
  });

  test("without the project's number prefixes, the channel is not named", () => {
    expect(
      sentences({ rule: rule({}), exampleChannelName: undefined })[0],
    ).toBe("Creates a channel for each incident.");
  });

  test("a rule that posts nowhere has nothing to say", () => {
    expect(
      sentences({ rule: rule({ shouldCreateNewChannel: false }) }),
    ).toEqual([]);
    // The form and the card say what is to pick instead.
    expect(Copy.NOTHING_CHOSEN_SENTENCE).toBe(
      "Pick where this rule posts: existing channels, a channel of its own for each one, or both.",
    );
  });

  test("existing channels are named as written, each once", () => {
    expect(getExistingChannelNames(" #ops, #incidents ,#ops,, ")).toEqual([
      "#ops",
      "#incidents",
    ]);
    expect(getExistingChannelNames(undefined)).toEqual([]);
    expect(
      sentences({
        rule: rule({
          shouldCreateNewChannel: false,
          shouldPostToExistingChannel: true,
          existingChannelNames: "#ops, #incidents, #ops",
        }),
      }),
    ).toEqual(["Posts updates in #ops and #incidents."]);
  });

  /*
   * Microsoft Teams shows a team's channels to everybody in the team, so
   * OneUptime invites nobody one by one there: the sentence says who sees
   * the channel. OneUptime cannot archive a Teams channel, so a rule that
   * asks to says nothing of it. Chats are Teams' alone.
   */
  test("Microsoft Teams: the team sees the channel, and chats are named", () => {
    const teamsRule: IncidentNotificationRule = rule({
      ...NotificationRuleInvites.getNewRuleSwitches(
        NotificationRuleEventType.Incident,
      ),
      archiveChannelAutomatically: true,
      shouldPostToExistingChat: true,
      existingChatIds: ["chat-1"],
    });

    expect(
      sentences({
        rule: teamsRule,
        workspaceType: WorkspaceType.MicrosoftTeams,
        exampleChannelName: "inc-42",
        channelTeamName: "Ops",
        chatNames: ["On-call leads", "Alice"],
      }),
    ).toEqual([
      "Creates a channel like inc-42 for each incident.",
      "Everyone in Ops can open the channel.",
      "Posts updates in the chats On-call leads and Alice.",
    ]);
    expect(
      sentences({
        rule: teamsRule,
        workspaceType: WorkspaceType.MicrosoftTeams,
        exampleChannelName: "inc-42",
      })[1],
    ).toBe("Everyone in the team can open the channel.");
    // A Slack rule has no chats.
    expect(
      sentences({ rule: teamsRule, chatNames: ["On-call leads"] }),
    ).not.toContain("Posts updates in the chats On-call leads.");
  });

  test.each([
    [
      NotificationRuleEventType.Alert,
      "Creates a channel like #alt-42 for each alert.",
      "Invites on-call responders as they are paged and owners as they are added.",
      "Archives the channel when the alert is resolved.",
    ],
    [
      NotificationRuleEventType.IncidentEpisode,
      "Creates a channel like #ie-42 for each incident episode.",
      "Invites on-call responders as they are paged, the Incident Commander and other incident roles as they are assigned and owners as they are added.",
      "Archives the channel when the incident episode is resolved.",
    ],
    [
      NotificationRuleEventType.AlertEpisode,
      "Creates a channel like #ae-42 for each alert episode.",
      "Invites on-call responders as they are paged and owners as they are added.",
      "Archives the channel when the alert episode is resolved.",
    ],
    [
      NotificationRuleEventType.ScheduledMaintenance,
      "Creates a channel like #sm-42 for each scheduled maintenance event.",
      "Invites owners as they are added.",
      "Archives the channel when the event is completed.",
    ],
    [
      NotificationRuleEventType.Monitor,
      "Creates a channel like #website for each monitor.",
      "Invites owners as they are added.",
      "Archives the channel when the monitor is deleted.",
    ],
    [
      NotificationRuleEventType.OnCallDutyPolicy,
      "Creates a channel like #primary for each on-call policy.",
      "Invites owners as they are added.",
      "Archives the channel when the on-call policy is deleted.",
    ],
  ])(
    "a new %s rule says what it does in its own words",
    (
      eventType: NotificationRuleEventType,
      creates: string,
      invites: string,
      archives: string,
    ) => {
      const exampleNames: Partial<Record<NotificationRuleEventType, string>> = {
        [NotificationRuleEventType.Alert]: "#alt-42",
        [NotificationRuleEventType.IncidentEpisode]: "#ie-42",
        [NotificationRuleEventType.AlertEpisode]: "#ae-42",
        [NotificationRuleEventType.ScheduledMaintenance]: "#sm-42",
        [NotificationRuleEventType.Monitor]: "#website",
        [NotificationRuleEventType.OnCallDutyPolicy]: "#primary",
      };

      expect(
        sentences({
          eventType: eventType,
          exampleChannelName: exampleNames[eventType],
          rule: rule({
            ...NotificationRuleInvites.getNewRuleSwitches(eventType),
            archiveChannelAutomatically: true,
          }),
        }),
      ).toEqual([creates, invites, archives]);
    },
  );

  test("every kind of record has each of its words", () => {
    const maps: Array<Readonly<Record<NotificationRuleEventType, string>>> = [
      Copy.NOTIFICATION_RULE_CONDITIONS_TITLES,
      Copy.NOTIFICATION_RULE_CONDITIONS_DESCRIPTIONS,
      Copy.NO_CONDITIONS_YET_SENTENCES,
      Copy.NOTIFICATION_RULES_CARD_DESCRIPTIONS,
      Copy.CREATE_CHANNEL_TITLES,
      Copy.CREATE_CHANNEL_DESCRIPTIONS,
      Copy.ARCHIVE_CHANNEL_TITLES,
      Copy.NO_CONDITIONS_SENTENCES,
      Copy.CREATES_CHANNEL_SENTENCES,
      Copy.CREATES_CHANNEL_WITHOUT_NAME_SENTENCES,
      Copy.ARCHIVES_SENTENCES,
    ];

    for (const map of maps) {
      for (const eventType of ALL_EVENT_TYPES) {
        expect(map[eventType]).toBeTruthy();
      }
    }

    // When conditions are checked: when created, and each time it changes.
    for (const eventType of ALL_EVENT_TYPES) {
      expect(Copy.NOTIFICATION_RULE_CONDITIONS_DESCRIPTIONS[eventType]).toMatch(
        /^Conditions are checked when an? .+ is created and again each time it changes/,
      );
    }
  });
});

describe("the rule's card: When, then Then", () => {
  function renderCard(data: {
    value: IncidentNotificationRule;
    users?: Array<User>;
    teams?: Array<Team>;
  }): void {
    render(
      <NotificationRuleViewElement
        value={data.value}
        eventType={NotificationRuleEventType.Incident}
        monitors={[]}
        labels={[]}
        alertStates={[]}
        alertSeverities={[]}
        incidentSeverities={[]}
        incidentStates={[]}
        scheduledMaintenanceStates={[]}
        monitorStatus={[]}
        workspaceType={WorkspaceType.Slack}
        teams={data.teams || []}
        users={data.users || []}
        numberPrefixes={PREFIXES}
      />,
    );
  }

  function thenSentences(): Array<string> {
    return within(screen.getByTestId("notification-rule-summary"))
      .queryAllByRole("listitem")
      .map((item: HTMLElement): string => {
        return item.textContent || "";
      });
  }

  test("a rule without conditions is for every incident, and says what it does", () => {
    renderCard({
      value: rule({
        shouldAutomaticallyInviteOnCallUsersToNewChannel: true,
        shouldInviteIncidentRolesToNewChannel: true,
        shouldInviteOwnersToNewChannel: true,
        archiveChannelAutomatically: true,
      }),
    });

    expect(screen.getByText("When")).toBeVisible();
    expect(
      screen.getByTestId("notification-rule-no-conditions"),
    ).toHaveTextContent("Every incident.");
    expect(screen.getByText("Then")).toBeVisible();
    expect(thenSentences()).toEqual([
      "Creates a channel like #inc-42 for each incident.",
      "Invites on-call responders as they are paged, the Incident Commander and other incident roles as they are assigned and owners as they are added.",
      "Archives the channel when the incident is resolved.",
    ]);
    // No switch is listed Yes or No any more.
    expect(screen.queryAllByText("Yes")).toHaveLength(0);
    expect(screen.queryAllByText("No")).toHaveLength(0);
  });

  test("a rule with conditions lists them under When", () => {
    renderCard({
      value: rule({
        filters: [
          {
            checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
            conditionType: ConditionType.Contains,
            value: "database",
          },
        ],
      }),
    });

    expect(
      screen.queryByTestId("notification-rule-no-conditions"),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/database/)).toBeVisible();
  });

  test("names the people and teams the rule invites", () => {
    const alice: User = new User();
    alice._id = "aaaaaaaa-0000-4000-8000-000000000001";
    alice.name = new Name("Alice Moreau");

    const database: Team = new Team();
    database._id = "bbbbbbbb-0000-4000-8000-000000000002";
    database.name = "Database";

    renderCard({
      value: rule({
        inviteUsersToNewChannel: [alice._id],
        inviteTeamsToNewChannel: [database._id],
      }),
      users: [alice],
      teams: [database],
    });

    expect(thenSentences()[1]).toBe(
      "Invites Alice Moreau and Database when the channel is created.",
    );
  });

  test("a rule that posts nowhere says what is to pick", () => {
    renderCard({ value: rule({ shouldCreateNewChannel: false }) });

    expect(screen.getByTestId("notification-rule-summary")).toHaveTextContent(
      "Pick where this rule posts: existing channels, a channel of its own for each one, or both.",
    );
  });
});

describe("in every language the Dashboard speaks", () => {
  // Every text the rule form and card say, from NotificationRuleCopy.
  function copyTexts(): Array<string> {
    const texts: Set<string> = new Set<string>();

    for (const value of Object.values(Copy)) {
      if (typeof value === "string") {
        texts.add(value);
      } else if (value && typeof value === "object") {
        for (const text of Object.values(value as Record<string, unknown>)) {
          if (typeof text === "string") {
            texts.add(text);
          }
        }
      }
    }

    return Array.from(texts);
  }

  test("every sentence is translated, with its placeholders", () => {
    const english: Record<string, string> = readLocale("en");
    const everywhere: Array<string> = readJson<Array<string>>(
      "i18n/SameAsEnglish.json",
    );
    const texts: Array<string> = copyTexts();

    expect(texts.length).toBeGreaterThan(100);

    for (const text of texts) {
      expect(english[text]).toBe(text);
    }

    for (const language of LANGUAGES) {
      const words: Record<string, string> = readLocale(language);
      const sameHere: Array<string> = readJson<{
        sameAsEnglish: Array<string>;
      }>(`i18n/Progress/${language}.json`).sameAsEnglish;

      for (const text of texts) {
        const translated: string | undefined = words[text];

        expect({ language, text, translated: typeof translated }).toEqual({
          language,
          text,
          translated: "string",
        });

        if (translated === text) {
          // Only where the word is the same: "Team" in German.
          expect({ language, text, sameAsEnglish: true }).toEqual({
            language,
            text,
            sameAsEnglish: everywhere.includes(text) || sameHere.includes(text),
          });
        }

        expect(getTemplatePlaceholders(translated!).sort()).toEqual(
          getTemplatePlaceholders(text).sort(),
        );
      }
    }
  });

  test("the invites sentence reads as one sentence in German", () => {
    expect(
      sentences({
        translator: translatorFor("de"),
        rule: rule({
          ...NotificationRuleInvites.getNewRuleSwitches(
            NotificationRuleEventType.Incident,
          ),
        }),
      }),
    ).toEqual([
      "Erstellt für jeden Vorfall einen Kanal wie #inc-42.",
      "Lädt Personen in Bereitschaft bei ihrer Alarmierung, den Vorfall-Kommandanten und weitere Vorfallsrollen bei ihrer Zuweisung und Eigentümer beim Hinzufügen ein.",
    ]);
  });

  test("and in Japanese, without spaces between the names", () => {
    expect(
      sentences({
        translator: translatorFor("ja"),
        rule: rule({
          ...NotificationRuleInvites.getNewRuleSwitches(
            NotificationRuleEventType.Incident,
          ),
          archiveChannelAutomatically: true,
        }),
      }),
    ).toEqual([
      "インシデントごとに #inc-42 のようなチャネルを作成します。",
      "オンコール対応者 (呼び出され次第)、インシデントコマンダーなどのインシデントロール (割り当てられ次第)、所有者 (追加され次第)を招待します。",
      "インシデントが解決するとチャネルをアーカイブします。",
    ]);
  });
});
