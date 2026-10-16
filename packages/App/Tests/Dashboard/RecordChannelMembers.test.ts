import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { WorkspaceChannelRecordType } from "Common/Types/Workspace/WorkspaceChannelLink";
import {
  WorkspaceChannelAddOutcome,
  WorkspaceChannelPerson,
  WorkspaceChannelState,
  WorkspaceChannelViewerStatus,
  WorkspaceRecordChannel,
} from "Common/Types/Workspace/WorkspaceChannelMembers";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import {
  ADD_OUTCOME_TEXT,
  ASK_TO_BE_ADDED,
  AddOutcomeSentence,
  CHANNEL_PEOPLE_FOLDED_COUNT,
  CHANNEL_STATE_TEXT,
  ChannelViewerPrompt,
  PEOPLE_COUNT,
  RECORD_CHANNEL_TEXT,
  SHOW_MORE_PEOPLE,
  UNNAMED_PEOPLE,
  canAddPeopleTo,
  getAddOutcomeSentences,
  getCardTitle,
  getChannelLabel,
  getFoldedCount,
  getPeopleInChannelUserIds,
  getShownPeople,
  getUnnamedCount,
  getViewerPrompt,
  isAddProblem,
} from "../../FeatureSet/Dashboard/src/Components/Workspace/RecordChannelMembers";

/*
 * THE RULES OF A RECORD'S CHANNEL CARD: what it is called, what it offers
 * the person looking at it in each state - Join channel, Connect Slack
 * account, who to ask - and what it says after people were added. And every
 * sentence it draws is a whole English sentence every Dashboard language
 * translates, placeholders kept.
 */

const VIEWER: string = "c7000000-0000-4000-8000-000000000001";
const BOB: string = "c7000000-0000-4000-8000-000000000002";

const channel: (
  overrides?: Partial<WorkspaceRecordChannel>,
) => WorkspaceRecordChannel = (
  overrides?: Partial<WorkspaceRecordChannel>,
): WorkspaceRecordChannel => {
  return {
    channelId: "C0INC42",
    workspaceType: WorkspaceType.Slack,
    name: "inc-42",
    url: "https://slack.com/app_redirect?channel=C0INC42&team=T0ACME",
    isPrivate: true,
    state: WorkspaceChannelState.Members,
    people: [],
    peopleCount: 0,
    viewer: WorkspaceChannelViewerStatus.NotIn,
    ...overrides,
  };
};

const person: (key: string, userId?: string) => WorkspaceChannelPerson = (
  key: string,
  userId?: string,
): WorkspaceChannelPerson => {
  return { key: key, name: key, ...(userId ? { userId: userId } : {}) };
};

describe("the card's title", () => {
  test("names the product, one channel or several, and both products together", () => {
    expect(getCardTitle([channel()])).toBe("Slack Channel");
    expect(getCardTitle([channel(), channel({ channelId: "C2" })])).toBe(
      "Slack Channels",
    );
    expect(
      getCardTitle([channel({ workspaceType: WorkspaceType.MicrosoftTeams })]),
    ).toBe("Microsoft Teams Channel");
    expect(
      getCardTitle([
        channel({ workspaceType: WorkspaceType.MicrosoftTeams }),
        channel({ workspaceType: WorkspaceType.MicrosoftTeams }),
      ]),
    ).toBe("Microsoft Teams Channels");
    expect(
      getCardTitle([
        channel(),
        channel({ workspaceType: WorkspaceType.MicrosoftTeams }),
      ]),
    ).toBe("Chat Channels");
  });

  test("reads the page's links too, while the channels load", () => {
    expect(
      getCardTitle([
        { workspaceType: WorkspaceType.MicrosoftTeams },
        { workspaceType: WorkspaceType.MicrosoftTeams },
      ]),
    ).toBe("Microsoft Teams Channels");
  });
});

describe("a channel's name", () => {
  test("a Slack channel is written with its #, once", () => {
    expect(getChannelLabel(channel({ name: "inc-42" }))).toBe("#inc-42");
    expect(getChannelLabel(channel({ name: "#inc-42" }))).toBe("#inc-42");
    expect(getChannelLabel(channel({ name: " " }))).toBe("#channel");
  });

  test("a Microsoft Teams channel is written as Teams writes it", () => {
    expect(
      getChannelLabel(
        channel({
          workspaceType: WorkspaceType.MicrosoftTeams,
          name: "Incident 42",
        }),
      ),
    ).toBe("Incident 42");
    expect(
      getChannelLabel(
        channel({ workspaceType: WorkspaceType.MicrosoftTeams, name: "" }),
      ),
    ).toBe("Channel");
  });
});

describe("the people listed", () => {
  const many: Array<WorkspaceChannelPerson> = Array.from(
    { length: CHANNEL_PEOPLE_FOLDED_COUNT + 3 },
    (_: unknown, index: number) => {
      return person(`U${index}`);
    },
  );

  test("the first few, with how many more fold under them", () => {
    expect(CHANNEL_PEOPLE_FOLDED_COUNT).toBe(5);
    expect(getShownPeople({ people: many, isUnfolded: false })).toEqual(
      many.slice(0, 5),
    );
    expect(getShownPeople({ people: many, isUnfolded: true })).toEqual(many);
    expect(getFoldedCount(many)).toBe(3);
    expect(getFoldedCount(many.slice(0, 5))).toBe(0);
  });

  test("people counted but not named are said apart", () => {
    expect(
      getUnnamedCount(channel({ people: many.slice(0, 2), peopleCount: 9 })),
    ).toBe(7);
    expect(
      getUnnamedCount(channel({ people: many.slice(0, 2), peopleCount: 2 })),
    ).toBe(0);
  });

  test("the OneUptime people in it are left out of the Add people list", () => {
    expect(
      getPeopleInChannelUserIds(
        channel({ people: [person("U1", BOB), person("U2")] }),
      ),
    ).toEqual([BOB]);
  });
});

describe("what the viewer is offered", () => {
  const prompt: (
    overrides: Partial<WorkspaceRecordChannel>,
    canAddPeople: boolean,
  ) => ChannelViewerPrompt = (
    overrides: Partial<WorkspaceRecordChannel>,
    canAddPeople: boolean,
  ): ChannelViewerPrompt => {
    return getViewerPrompt({
      channel: channel(overrides),
      canAddPeople: canAddPeople,
    });
  };

  test("somebody who may add people and is not in it: Join channel", () => {
    expect(prompt({}, true)).toBe(ChannelViewerPrompt.Join);
  });

  test("somebody OneUptime cannot find in Slack: connect their account first", () => {
    expect(
      prompt({ viewer: WorkspaceChannelViewerStatus.NotFound }, true),
    ).toBe(ChannelViewerPrompt.ConnectToJoin);
  });

  test("somebody in it already: nothing", () => {
    expect(prompt({ viewer: WorkspaceChannelViewerStatus.In }, true)).toBe(
      ChannelViewerPrompt.None,
    );
    expect(prompt({ viewer: WorkspaceChannelViewerStatus.In }, false)).toBe(
      ChannelViewerPrompt.None,
    );
  });

  test("without permission: ask someone for a private channel, open it in Slack for a public one", () => {
    expect(prompt({ isPrivate: true }, false)).toBe(
      ChannelViewerPrompt.AskToBeAdded,
    );
    // Slack did not say: as for a private channel.
    expect(prompt({ isPrivate: null }, false)).toBe(
      ChannelViewerPrompt.AskToBeAdded,
    );
    expect(prompt({ isPrivate: false }, false)).toBe(
      ChannelViewerPrompt.JoinInSlack,
    );
  });

  test("without permission, somebody OneUptime cannot find is told nothing they could not act on", () => {
    expect(
      prompt({ viewer: WorkspaceChannelViewerStatus.NotFound }, false),
    ).toBe(ChannelViewerPrompt.None);
  });

  test("a channel that can take nobody, and a Teams channel, offer nothing", () => {
    for (const state of [
      WorkspaceChannelState.Archived,
      WorkspaceChannelState.Unreachable,
      WorkspaceChannelState.NotConnected,
      WorkspaceChannelState.Unavailable,
    ]) {
      expect(prompt({ state: state }, true)).toBe(ChannelViewerPrompt.None);
      expect(
        canAddPeopleTo({ channel: channel({ state }), canAddPeople: true }),
      ).toBe(false);
    }

    expect(
      prompt(
        {
          workspaceType: WorkspaceType.MicrosoftTeams,
          state: WorkspaceChannelState.ManagedInTeams,
        },
        true,
      ),
    ).toBe(ChannelViewerPrompt.None);
    expect(
      canAddPeopleTo({
        channel: channel({
          workspaceType: WorkspaceType.MicrosoftTeams,
          state: WorkspaceChannelState.ManagedInTeams,
        }),
        canAddPeople: true,
      }),
    ).toBe(false);
  });

  test("Add people only for somebody who may add people, into a Slack channel that takes them", () => {
    expect(canAddPeopleTo({ channel: channel(), canAddPeople: true })).toBe(
      true,
    );
    expect(canAddPeopleTo({ channel: channel(), canAddPeople: false })).toBe(
      false,
    );
  });

  test("who to ask is said for each kind of record by its own name", () => {
    expect(ASK_TO_BE_ADDED).toEqual({
      [WorkspaceChannelRecordType.Incident]:
        "You're not in this channel. Ask someone who can edit this incident to add you.",
      [WorkspaceChannelRecordType.Alert]:
        "You're not in this channel. Ask someone who can edit this alert to add you.",
      [WorkspaceChannelRecordType.IncidentEpisode]:
        "You're not in this channel. Ask someone who can edit this episode to add you.",
      [WorkspaceChannelRecordType.AlertEpisode]:
        "You're not in this channel. Ask someone who can edit this episode to add you.",
      [WorkspaceChannelRecordType.ScheduledMaintenance]:
        "You're not in this channel. Ask someone who can edit this event to add you.",
    });
  });
});

describe("what adding people says", () => {
  test("every outcome has a sentence about the viewer and one about somebody else", () => {
    for (const outcome of Object.values(WorkspaceChannelAddOutcome)) {
      expect(ADD_OUTCOME_TEXT[outcome].self).toBeTruthy();
      expect(ADD_OUTCOME_TEXT[outcome].other).toContain("{{name}}");
      expect(ADD_OUTCOME_TEXT[outcome].self).not.toContain("{{name}}");
    }
  });

  test("the viewer joining is said; the people added are not - they appear in the list", () => {
    const sentences: Array<AddOutcomeSentence> = getAddOutcomeSentences({
      viewerUserId: VIEWER,
      answer: {
        results: [
          {
            userId: VIEWER,
            name: "Alice",
            outcome: WorkspaceChannelAddOutcome.Added,
          },
          {
            userId: BOB,
            name: "Bob",
            outcome: WorkspaceChannelAddOutcome.Added,
          },
        ],
      },
    });

    expect(sentences).toEqual([
      {
        template: "You're in the channel now.",
        name: "Alice",
        isProblem: false,
      },
    ]);
  });

  test("every problem is said, about the viewer as 'you' and about others by name", () => {
    const sentences: Array<AddOutcomeSentence> = getAddOutcomeSentences({
      viewerUserId: VIEWER.toUpperCase(),
      answer: {
        results: [
          {
            userId: VIEWER,
            name: "Alice",
            outcome: WorkspaceChannelAddOutcome.NotFound,
          },
          {
            userId: BOB,
            name: "Bob",
            outcome: WorkspaceChannelAddOutcome.Guest,
          },
          {
            userId: "c7000000-0000-4000-8000-000000000003",
            name: "Carol",
            outcome: WorkspaceChannelAddOutcome.AlreadyIn,
          },
        ],
      },
    });

    expect(sentences).toEqual([
      {
        template:
          "OneUptime can't find your Slack account, so it can't add you.",
        name: "Alice",
        isProblem: true,
      },
      {
        template:
          "{{name}} is a guest in Slack, and Slack doesn't let OneUptime add them to this channel.",
        name: "Bob",
        isProblem: true,
      },
    ]);
  });

  test("a channel that took nobody is said by its state", () => {
    expect(
      getAddOutcomeSentences({
        viewerUserId: VIEWER,
        answer: { channelState: WorkspaceChannelState.Archived, results: [] },
      }),
    ).toEqual([
      {
        template:
          "This channel is archived. Unarchive it in Slack to add people.",
        name: "",
        isProblem: true,
      },
    ]);
  });

  test("added and in it already are not problems; everything else is", () => {
    for (const outcome of Object.values(WorkspaceChannelAddOutcome)) {
      expect(isAddProblem({ userId: BOB, name: "Bob", outcome: outcome })).toBe(
        outcome !== WorkspaceChannelAddOutcome.Added &&
          outcome !== WorkspaceChannelAddOutcome.AlreadyIn,
      );
    }
  });

  test("every state a channel can take nobody in has a sentence", () => {
    expect(Object.keys(CHANNEL_STATE_TEXT).sort()).toEqual(
      [
        WorkspaceChannelState.Archived,
        WorkspaceChannelState.NotConnected,
        WorkspaceChannelState.Unavailable,
        WorkspaceChannelState.Unreachable,
      ].sort(),
    );
  });
});

/*
 * Every sentence the card draws is a key of the Dashboard's locale files,
 * worded in every one of its languages, with the English placeholders.
 */
describe("the card's words in every Dashboard language", () => {
  const LOCALES: string = path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Dashboard",
    "src",
    "Locales",
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
  // Product names, which read the same in every language.
  const SAME_IN_EVERY_LANGUAGE: Array<string> = [];

  const read: (language: string) => Record<string, string> = (
    language: string,
  ): Record<string, string> => {
    return JSON.parse(
      fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
    ) as Record<string, string>;
  };

  const english: Record<string, string> = read("en");

  const placeholders: (text: string) => Array<string> = (
    text: string,
  ): Array<string> => {
    const found: Array<string> = [];
    let from: number = text.indexOf("{{");

    while (from !== -1) {
      const end: number = text.indexOf("}}", from);
      found.push(text.substring(from, end + 2));
      from = text.indexOf("{{", end);
    }

    return found.sort();
  };

  const sentences: Array<string> = Array.from(
    new Set<string>([
      ...Object.values(RECORD_CHANNEL_TEXT),
      ...Object.values(ASK_TO_BE_ADDED),
      ...Object.values(CHANNEL_STATE_TEXT),
      ...Object.values(ADD_OUTCOME_TEXT).flatMap(
        (text: { self: string; other: string }) => {
          return [text.self, text.other];
        },
      ),
      PEOPLE_COUNT.other,
      SHOW_MORE_PEOPLE.other,
      UNNAMED_PEOPLE.other,
      "Channel Member Added",
      "Open in Slack",
      "Open in Microsoft Teams",
      "Try again",
    ]),
  );

  test("English maps each to itself", () => {
    for (const sentence of sentences) {
      expect({ sentence, value: english[sentence] }).toEqual({
        sentence,
        value: sentence,
      });
    }
  });

  test.each(LANGUAGES)(
    "%s words each, keeping its placeholders",
    (language: string) => {
      const locale: Record<string, string> = read(language);

      for (const sentence of sentences) {
        const value: string | undefined = locale[sentence];

        expect({ sentence, hasValue: Boolean(value) }).toEqual({
          sentence,
          hasValue: true,
        });

        if (!SAME_IN_EVERY_LANGUAGE.includes(sentence)) {
          expect({ sentence, isTranslated: value !== sentence }).toEqual({
            sentence,
            isTranslated: true,
          });
        }

        expect({ sentence, placeholders: placeholders(value!) }).toEqual({
          sentence,
          placeholders: placeholders(sentence),
        });
      }
    },
  );

  test.each(LANGUAGES)(
    "%s words the count-dependent ones in both forms",
    (language: string) => {
      const locale: Record<string, string> = read(language);

      for (const plural of [UNNAMED_PEOPLE, PEOPLE_COUNT, SHOW_MORE_PEOPLE]) {
        expect(locale[`${plural.other}_one`]).toBeTruthy();
        expect(placeholders(locale[`${plural.other}_one`]!)).toEqual([
          "{{count}}",
        ]);
      }
    },
  );
});
