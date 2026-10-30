import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup } from "@testing-library/react";
import fs from "fs";
import path from "path";

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
import {
  canRuleCreateChannel,
  CHANNEL_RECORD_EVENT_TYPES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleOwnChannel";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleInvites from "../../../Types/Workspace/NotificationRules/NotificationRuleInvites";
import {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import IncidentNotificationRule from "../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
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

  /*
   * In a sentence of their own, as the form asks them under "Also invite":
   * they were the last item of one long list, "... owners as they are added
   * and Alice and Database when the channel is created".
   */
  test("the people and teams the rule names join when the channel is created", () => {
    expect(
      sentences({
        rule: rule({ shouldInviteOwnersToNewChannel: true }),
        userNames: ["Alice"],
        teamNames: ["Database"],
      }).slice(1),
    ).toEqual([
      "Invites the Incident Commander and other incident roles as they are assigned and owners as they are added.",
      "Also invites Alice and Database when the channel is created.",
    ]);
    // Named alone, they are who the rule invites.
    expect(
      sentences({
        rule: rule({}),
        userNames: ["Alice"],
        teamNames: ["Database"],
      })[1],
    ).toBe("Invites Alice and Database when the channel is created.");
  });

  /*
   * The on-call schedules a rule names: whoever is on call in them when the
   * channel is created joins it, without being paged - in a sentence of
   * their own, after the people and teams the rule names.
   */
  test("whoever is on call in the rule's schedules joins when the channel is created", () => {
    expect(
      sentences({
        rule: rule({ shouldInviteOwnersToNewChannel: true }),
        userNames: ["Alice"],
        scheduleNames: ["Payments Primary", "Payments Secondary"],
      }).slice(1),
    ).toEqual([
      "Invites the Incident Commander and other incident roles as they are assigned and owners as they are added.",
      "Also invites Alice when the channel is created.",
      "Also invites whoever is on call in Payments Primary and Payments Secondary when the channel is created.",
    ]);
    // Named alone, they are who the rule invites.
    expect(
      sentences({
        rule: rule({}),
        scheduleNames: ["Payments Primary"],
      }).slice(1),
    ).toEqual([
      "Invites whoever is on call in Payments Primary when the channel is created.",
    ]);
  });

  test("Microsoft Teams: whoever is on call in the rule's schedules is mentioned in the channel", () => {
    expect(
      sentences({
        rule: rule({}),
        workspaceType: WorkspaceType.MicrosoftTeams,
        exampleChannelName: "inc-42",
        channelTeamName: "Ops",
        scheduleNames: ["Payments Primary"],
      }),
    ).toEqual([
      "Creates a channel like inc-42 for each incident.",
      "Everyone in Ops can open the channel.",
      "Mentions whoever is on call in Payments Primary when the channel is created.",
    ]);
  });

  test("a German reader reads the people named in a sentence of their own", () => {
    expect(
      sentences({
        translator: translatorFor("de"),
        rule: rule({ shouldAutomaticallyInviteOnCallUsersToNewChannel: true }),
        userNames: ["Alice"],
        teamNames: ["Database"],
      }).slice(1),
    ).toEqual([
      "Lädt Personen in Bereitschaft bei ihrer Alarmierung und den Vorfall-Kommandanten und weitere Vorfallsrollen bei ihrer Zuweisung ein.",
      "Lädt außerdem Alice und Database beim Erstellen des Kanals ein.",
    ]);
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
   * A Slack rule that keeps each record's updates in one thread in the
   * channels it names says so, after the channels. Microsoft Teams posts
   * every update as a message of its own, and a monitor or an on-call
   * policy has no thread, so a rule that asks says nothing of it there.
   */
  test("a rule that keeps each incident's updates in one thread says so, in Slack only", () => {
    const threadRule: IncidentNotificationRule = rule({
      shouldCreateNewChannel: false,
      shouldPostToExistingChannel: true,
      existingChannelNames: "#ops",
      shouldPostUpdatesInThread: true,
    });

    expect(sentences({ rule: threadRule })).toEqual([
      "Posts updates in #ops.",
      "Keeps each incident's updates in one thread there.",
    ]);
    // Off: the channels alone.
    expect(
      sentences({
        rule: rule({
          shouldCreateNewChannel: false,
          shouldPostToExistingChannel: true,
          existingChannelNames: "#ops",
        }),
      }),
    ).toEqual(["Posts updates in #ops."]);
    expect(
      sentences({
        rule: threadRule,
        workspaceType: WorkspaceType.MicrosoftTeams,
      }),
    ).toEqual(["Posts updates in #ops."]);
    for (const eventType of [
      NotificationRuleEventType.Monitor,
      NotificationRuleEventType.OnCallDutyPolicy,
    ]) {
      expect(sentences({ rule: threadRule, eventType: eventType })).toEqual([
        "Posts updates in #ops.",
      ]);
    }
    // With no channel to post in, there is no thread either.
    expect(
      sentences({
        rule: { ...threadRule, existingChannelNames: "" },
      }),
    ).toEqual([]);
  });

  test.each([
    [
      NotificationRuleEventType.Alert,
      "Keeps each alert's updates in one thread there.",
    ],
    [
      NotificationRuleEventType.IncidentEpisode,
      "Keeps each incident episode's updates in one thread there.",
    ],
    [
      NotificationRuleEventType.AlertEpisode,
      "Keeps each alert episode's updates in one thread there.",
    ],
    [
      NotificationRuleEventType.ScheduledMaintenance,
      "Keeps each event's updates in one thread there.",
    ],
  ])(
    "%s rules name their own records in the thread sentence",
    (eventType: NotificationRuleEventType, inThread: string) => {
      expect(
        sentences({
          eventType: eventType,
          rule: rule({
            shouldCreateNewChannel: false,
            shouldPostToExistingChannel: true,
            existingChannelNames: "#ops",
            shouldPostUpdatesInThread: true,
          }),
        }),
      ).toEqual(["Posts updates in #ops.", inThread]);
    },
  );

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
    // One chat is one chat: "in the chats On-call leads" read as several.
    expect(
      sentences({
        rule: teamsRule,
        workspaceType: WorkspaceType.MicrosoftTeams,
        exampleChannelName: "inc-42",
        channelTeamName: "Ops",
        chatNames: ["On-call leads"],
      })[2],
    ).toBe("Posts updates in the chat On-call leads.");
    // A Slack rule has no chats.
    expect(
      sentences({ rule: teamsRule, chatNames: ["On-call leads"] }).join(" "),
    ).not.toContain("On-call leads");
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

  /*
   * A security case gets no channel of its own (SecurityCaseNotificationRule):
   * its rule posts to channels and chats people have, and says only that -
   * even a rule saved through the API that holds the switches of a channel.
   */
  test("a security case rule says only where it posts, whatever channel switches it holds", () => {
    expect(canRuleCreateChannel(NotificationRuleEventType.SecurityCase)).toBe(
      false,
    );

    const savedThroughTheApi: IncidentNotificationRule = rule({
      shouldCreateNewChannel: true,
      shouldInviteOwnersToNewChannel: true,
      archiveChannelAutomatically: true,
      shouldPostToExistingChannel: true,
      existingChannelNames: "#security, #soc",
    });

    expect(
      sentences({
        eventType: NotificationRuleEventType.SecurityCase,
        exampleChannelName: "#security-case",
        rule: savedThroughTheApi,
      }),
    ).toEqual(["Posts updates in #security and #soc."]);

    expect(
      sentences({
        eventType: NotificationRuleEventType.SecurityCase,
        workspaceType: WorkspaceType.MicrosoftTeams,
        exampleChannelName: "security-case",
        channelTeamName: "Security",
        chatNames: ["SOC on call"],
        rule: rule({
          shouldCreateNewChannel: true,
          shouldPostToExistingChannel: true,
          existingChannelNames: "Incidents",
          shouldPostToExistingChat: true,
          existingChatIds: ["chat-1"],
        }),
      }),
    ).toEqual([
      "Posts updates in Incidents.",
      "Posts updates in the chat SOC on call.",
    ]);

    // Posting nowhere, it says nothing; the form says what is left to pick.
    expect(
      sentences({
        eventType: NotificationRuleEventType.SecurityCase,
        rule: rule({ shouldCreateNewChannel: true }),
      }),
    ).toEqual([]);
  });

  test("what is left to pick, and the Destination step's words, for a rule that only posts", () => {
    expect(
      Copy.getNothingChosenSentence({
        eventType: NotificationRuleEventType.SecurityCase,
        workspaceType: WorkspaceType.Slack,
      }),
    ).toBe("Name the channels this rule posts in.");
    expect(
      Copy.getNothingChosenSentence({
        eventType: NotificationRuleEventType.SecurityCase,
        workspaceType: WorkspaceType.MicrosoftTeams,
      }),
    ).toBe("Pick where this rule posts: existing channels, chats, or both.");
    expect(
      Copy.getNotificationRuleDestinationDescription({
        eventType: NotificationRuleEventType.SecurityCase,
        workspaceType: WorkspaceType.Slack,
      }),
    ).toBe("The channels the rule posts in.");
    expect(
      Copy.getNotificationRuleDestinationDescription({
        eventType: NotificationRuleEventType.SecurityCase,
        workspaceType: WorkspaceType.MicrosoftTeams,
      }),
    ).toBe("The channels and chats the rule posts in.");

    // Every other kind keeps its words: a channel of its own, and who joins it.
    for (const eventType of CHANNEL_RECORD_EVENT_TYPES) {
      for (const workspaceType of [
        WorkspaceType.Slack,
        WorkspaceType.MicrosoftTeams,
      ]) {
        expect(
          Copy.getNothingChosenSentence({ eventType, workspaceType }),
        ).toBe(Copy.NOTHING_CHOSEN_SENTENCE);
        expect(
          Copy.getNotificationRuleDestinationDescription({
            eventType,
            workspaceType,
          }),
        ).toBe(Copy.NOTIFICATION_RULE_DESTINATION_DESCRIPTION);
      }
    }
  });

  test("a security case rule is named, and its records counted, in its own words", () => {
    expect(
      Copy.NOTIFICATION_RULE_CONDITIONS_TITLES[
        NotificationRuleEventType.SecurityCase
      ],
    ).toBe("Which security cases");
    expect(
      Copy.NO_CONDITIONS_SENTENCES[NotificationRuleEventType.SecurityCase],
    ).toBe("Every security case.");
    expect(
      Copy.RULE_SINGULAR_NAMES[NotificationRuleEventType.SecurityCase],
    ).toBe("Security Case Notification Rule");
    expect(
      Copy.NOTIFICATION_RULES_CARD_DESCRIPTIONS[
        NotificationRuleEventType.SecurityCase
      ],
    ).toBe(
      "Each rule picks the security cases it is for, then posts to channels you have when a case opens, is assigned or has a playbook step waiting for approval.",
    );
    // It never offers a channel of its own.
    expect(
      Copy.NOTIFICATION_RULES_CARD_DESCRIPTIONS[
        NotificationRuleEventType.SecurityCase
      ],
    ).not.toMatch(/creates a channel/i);
  });

  test("every kind of record has each of its words", () => {
    const maps: Array<Readonly<Record<NotificationRuleEventType, string>>> = [
      Copy.NOTIFICATION_RULE_CONDITIONS_TITLES,
      Copy.NOTIFICATION_RULE_CONDITIONS_DESCRIPTIONS,
      Copy.APPLIES_TO_ALL_ANSWERS,
      Copy.APPLIES_TO_MATCHING_ANSWERS,
      Copy.NOTIFICATION_RULES_CARD_DESCRIPTIONS,
      Copy.NO_CONDITIONS_SENTENCES,
    ];

    for (const map of maps) {
      for (const eventType of ALL_EVENT_TYPES) {
        expect(map[eventType]).toBeTruthy();
      }
    }

    /*
     * When conditions are checked: when created, and each time it changes.
     * A security case's are checked each time there is something to post
     * about it (SecurityCaseNotifications).
     */
    for (const eventType of CHANNEL_RECORD_EVENT_TYPES) {
      expect(Copy.NOTIFICATION_RULE_CONDITIONS_DESCRIPTIONS[eventType]).toMatch(
        /^Conditions are checked when an? .+ is created and again each time it changes/,
      );
    }

    expect(
      Copy.NOTIFICATION_RULE_CONDITIONS_DESCRIPTIONS[
        NotificationRuleEventType.SecurityCase
      ],
    ).toBe(
      "Conditions are checked each time there is something to post about a security case: when it opens or rises to a higher priority, is assigned, or has a playbook step waiting for approval.",
    );
  });

  // The words about a channel of the record's own: only where it can have one.
  test("every kind of record a rule can create a channel for has the words of that channel, and a security case has none", () => {
    const channelMaps: Array<Readonly<Record<string, string>>> = [
      Copy.CREATE_CHANNEL_TITLES,
      Copy.CREATE_CHANNEL_DESCRIPTIONS,
      Copy.ARCHIVE_CHANNEL_TITLES,
      Copy.CREATES_CHANNEL_SENTENCES,
      Copy.CREATES_CHANNEL_WITHOUT_NAME_SENTENCES,
      Copy.ARCHIVES_SENTENCES,
    ];

    expect([...CHANNEL_RECORD_EVENT_TYPES].sort()).toEqual(
      ALL_EVENT_TYPES.filter((eventType: NotificationRuleEventType) => {
        return eventType !== NotificationRuleEventType.SecurityCase;
      }).sort(),
    );

    for (const map of channelMaps) {
      expect(Object.keys(map).sort()).toEqual(
        [...CHANNEL_RECORD_EVENT_TYPES].sort(),
      );

      for (const eventType of CHANNEL_RECORD_EVENT_TYPES) {
        expect(map[eventType]).toBeTruthy();
      }

      expect(map[NotificationRuleEventType.SecurityCase]).toBeUndefined();
    }
  });

  /*
   * Which records the rule is for, asked as every rule's conditions are:
   * the same answers, in the same words, as an incident on-call rule's.
   */
  test("the Conditions step asks 'All <records>' or 'Only <records> that match conditions'", () => {
    expect(Copy.APPLIES_TO_ALL_ANSWERS).toEqual({
      [NotificationRuleEventType.Incident]: "All incidents",
      [NotificationRuleEventType.Alert]: "All alerts",
      [NotificationRuleEventType.IncidentEpisode]: "All incident episodes",
      [NotificationRuleEventType.AlertEpisode]: "All alert episodes",
      [NotificationRuleEventType.ScheduledMaintenance]:
        "All scheduled maintenance events",
      [NotificationRuleEventType.Monitor]: "All monitors",
      [NotificationRuleEventType.OnCallDutyPolicy]: "All on-call policies",
      [NotificationRuleEventType.SecurityCase]: "All security cases",
    });

    for (const eventType of ALL_EVENT_TYPES) {
      const records: string = Copy.APPLIES_TO_ALL_ANSWERS[eventType].replace(
        /^All /,
        "",
      );

      expect(Copy.APPLIES_TO_MATCHING_ANSWERS[eventType]).toBe(
        `Only ${records} that match conditions`,
      );
      // "Which incidents" is the question; these are its answers.
      expect(
        Copy.NOTIFICATION_RULE_CONDITIONS_TITLES[eventType].toLowerCase(),
      ).toBe(`which ${records}`);
    }
  });
});

/*
 * The rule's card - which records it is for, then these sentences - is drawn
 * by the rules list: WorkspaceNotificationRuleCard.test.tsx.
 */

/*
 * What a rule's conditions check and how, by the words the Conditions
 * step's dropdowns and the card show them: every condition the rules know
 * has its words, translated with the rest.
 */
describe("the words of a rule's conditions", () => {
  test("every field a condition can check, and every way it compares, is listed", () => {
    expect([...Copy.CONDITION_FIELD_WORDS].sort()).toEqual(
      Object.values(NotificationRuleConditionCheckOn).sort(),
    );
    expect([...Copy.CONDITION_OPERATOR_WORDS].sort()).toEqual(
      Object.values(ConditionType).sort(),
    );
  });

  test("read in the reader's language, as a German reader sees them", () => {
    const german: Translator = translatorFor("de");

    expect(german.translateText(ConditionType.ContainsAny)).toBe(
      "Enthält eines von",
    );
    expect(
      german.translateText(NotificationRuleConditionCheckOn.IncidentState),
    ).toBe("Vorfallsstatus");
    expect(
      german.translateText(
        NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
      ),
    ).toBe("Beschriftungen der Bereitschaftsrichtlinie");
  });
});

/*
 * What one rule of each kind is called - on the Create button, the form's
 * title, the list's count and empty state - whole, so it reads in the
 * reader's language. It was "Incident" + " Notification Rule", which no
 * locale had: "Neu erstellen: Incident Notification Rule".
 */
describe("the name of each kind of rule", () => {
  test("every kind of record has a rule's name, one and many, each its own", () => {
    for (const eventType of ALL_EVENT_TYPES) {
      expect(Copy.RULE_SINGULAR_NAMES[eventType]).toMatch(
        / Notification Rule$/,
      );
      expect(Copy.RULE_PLURAL_NAMES[eventType]).toBe(
        `${Copy.RULE_SINGULAR_NAMES[eventType]}s`,
      );
    }

    expect(new Set(Object.values(Copy.RULE_SINGULAR_NAMES)).size).toBe(
      ALL_EVENT_TYPES.length,
    );
    // The product's word for an on-call policy, not the record's type name.
    expect(
      Copy.RULE_SINGULAR_NAMES[NotificationRuleEventType.OnCallDutyPolicy],
    ).toBe("On-Call Policy Notification Rule");
  });

  test("a German reader reads the whole name", () => {
    const german: Translator = translatorFor("de");

    expect(
      german.translateText(
        Copy.RULE_SINGULAR_NAMES[NotificationRuleEventType.Incident],
      ),
    ).toBe("Benachrichtigungsregel für Vorfälle");
    expect(
      german.translateTemplate("Create New {{itemName}}", {
        itemName:
          german.translateText(
            Copy.RULE_SINGULAR_NAMES[NotificationRuleEventType.Incident],
          ) || "",
      }),
    ).toBe("Neu erstellen: Benachrichtigungsregel für Vorfälle");
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
