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
  PeopleSearchNotice,
  PeopleSearchNoticeTone,
} from "Common/UI/Components/PeoplePicker/PeopleSearchNotice";
import {
  createTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  ADDED_FROM_TEAM,
  ADD_OUTCOME_TEXT,
  ADD_PROBLEM_ORDER,
  ADD_PROBLEM_TEXT_FOR_SEVERAL,
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
  getAddProblemSentences,
  getCardTitle,
  getChannelLabel,
  getFoldedCount,
  getPeopleInChannelUserIds,
  getPickNotices,
  getShownPeople,
  getUnnamedCount,
  getViewerPrompt,
  isAddProblem,
  splitAtSlackInviteCommand,
} from "../../FeatureSet/Dashboard/src/Components/Workspace/RecordChannelMembers";
import { FastestRun, fastestRun } from "Common/Tests/Helpers/FastestRun";

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
 * What the Add people list says under it after a pick (getPickNotices): a
 * pick never seems to do nothing, and a team's people with one problem are
 * named in one sentence instead of a long sentence each.
 */
const ENGLISH: Translator = createTranslator(undefined, "en");
const CAROL: string = "c7000000-0000-4000-8000-000000000003";
const DAN: string = "c7000000-0000-4000-8000-000000000004";
const EVE: string = "c7000000-0000-4000-8000-000000000005";
const FAY: string = "c7000000-0000-4000-8000-000000000006";

type Outcome = WorkspaceChannelAddOutcome;

const result: (
  userId: string,
  name: string,
  outcome: Outcome,
) => { userId: string; name: string; outcome: Outcome } = (
  userId: string,
  name: string,
  outcome: Outcome,
): { userId: string; name: string; outcome: Outcome } => {
  return { userId, name, outcome };
};

describe("what a pick in Add people says", () => {
  test("a person: added by name, or the viewer as 'you'", () => {
    expect(
      getPickNotices({
        answer: {
          results: [result(BOB, "Bob", WorkspaceChannelAddOutcome.Added)],
        },
        viewerUserId: VIEWER,
        translator: ENGLISH,
      }),
    ).toEqual([{ tone: PeopleSearchNoticeTone.Done, text: "Added Bob." }]);

    expect(
      getPickNotices({
        answer: {
          results: [result(VIEWER, "Alice", WorkspaceChannelAddOutcome.Added)],
        },
        viewerUserId: VIEWER.toUpperCase(),
        translator: ENGLISH,
      }),
    ).toEqual([
      { tone: PeopleSearchNoticeTone.Done, text: "You're in the channel now." },
    ]);
  });

  test("a person in the channel already is said, in grey - not as a problem", () => {
    expect(
      getPickNotices({
        answer: {
          results: [result(BOB, "Bob", WorkspaceChannelAddOutcome.AlreadyIn)],
        },
        viewerUserId: VIEWER,
        translator: ENGLISH,
      }),
    ).toEqual([
      {
        tone: PeopleSearchNoticeTone.Unchanged,
        text: "Bob is already in this channel.",
      },
    ]);
  });

  test("a team: how many it added, from which team, in the count's own form", () => {
    const notices: (count: number) => Array<PeopleSearchNotice> = (
      count: number,
    ): Array<PeopleSearchNotice> => {
      return getPickNotices({
        answer: {
          results: [
            ...[BOB, CAROL, DAN].slice(0, count).map((userId: string) => {
              return result(userId, userId, WorkspaceChannelAddOutcome.Added);
            }),
            result(EVE, "Eve", WorkspaceChannelAddOutcome.AlreadyIn),
          ],
        },
        viewerUserId: VIEWER,
        teamName: "Platform",
        translator: ENGLISH,
      });
    };

    expect(notices(1)).toEqual([
      {
        tone: PeopleSearchNoticeTone.Done,
        text: "Added 1 person from Platform.",
      },
    ]);
    expect(notices(3)).toEqual([
      {
        tone: PeopleSearchNoticeTone.Done,
        text: "Added 3 people from Platform.",
      },
    ]);
  });

  test("a team whose people are all in the channel says so, so the pick is not silent", () => {
    expect(
      getPickNotices({
        answer: {
          results: [
            result(BOB, "Bob", WorkspaceChannelAddOutcome.AlreadyIn),
            result(CAROL, "Carol", WorkspaceChannelAddOutcome.AlreadyIn),
          ],
        },
        viewerUserId: VIEWER,
        teamName: "Platform",
        translator: ENGLISH,
      }),
    ).toEqual([
      {
        tone: PeopleSearchNoticeTone.Unchanged,
        text: "Everyone in Platform is already in this channel.",
      },
    ]);
  });

  test("a team that added nobody and hit problems says only the problems", () => {
    expect(
      getPickNotices({
        answer: {
          results: [
            result(BOB, "Bob", WorkspaceChannelAddOutcome.AlreadyIn),
            result(CAROL, "Carol", WorkspaceChannelAddOutcome.Refused),
          ],
        },
        viewerUserId: VIEWER,
        teamName: "Platform",
        translator: ENGLISH,
      }),
    ).toEqual([
      {
        tone: PeopleSearchNoticeTone.Problem,
        text: "Slack didn't let OneUptime add Carol.",
      },
    ]);
  });

  test("a channel that took nobody is said by its state", () => {
    expect(
      getPickNotices({
        answer: {
          channelState: WorkspaceChannelState.Unreachable,
          results: [],
        },
        viewerUserId: VIEWER,
        teamName: "Platform",
        translator: ENGLISH,
      }),
    ).toEqual([
      {
        tone: PeopleSearchNoticeTone.Problem,
        text: "OneUptime can't see this channel. It was deleted, or the OneUptime app was removed from it.",
      },
    ]);
  });
});

describe("the problems of one pick", () => {
  test("several people with one problem: one sentence that names them all, in the language's list form", () => {
    expect(
      getAddProblemSentences({
        results: [
          result(BOB, "Bob Jones", WorkspaceChannelAddOutcome.NotFound),
          result(CAROL, "Carol Lee", WorkspaceChannelAddOutcome.NotFound),
        ],
        viewerUserId: VIEWER,
        translator: ENGLISH,
      }),
    ).toEqual([
      "OneUptime can't find Bob Jones and Carol Lee in Slack: their accounts aren't connected, and no Slack account has their email address. Ask them to connect Slack in User Settings.",
    ]);

    expect(
      getAddProblemSentences({
        results: [BOB, CAROL, DAN, EVE].map((userId: string, index: number) => {
          return result(
            userId,
            ["Bob", "Carol", "Dan", "Eve"][index]!,
            WorkspaceChannelAddOutcome.TryAgain,
          );
        }),
        viewerUserId: VIEWER,
        translator: ENGLISH,
      }),
    ).toEqual([
      "Slack didn't answer for Bob, Carol, Dan and Eve. Try again in a minute.",
    ]);
  });

  test("one person: the one-person sentence; the viewer: 'you', before the others", () => {
    expect(
      getAddProblemSentences({
        results: [
          result(BOB, "Bob", WorkspaceChannelAddOutcome.Guest),
          result(VIEWER, "Alice", WorkspaceChannelAddOutcome.Guest),
        ],
        viewerUserId: VIEWER,
        translator: ENGLISH,
      }),
    ).toEqual([
      "You're a guest in Slack, and Slack doesn't let OneUptime add you to this channel.",
      "Bob is a guest in Slack, and Slack doesn't let OneUptime add them to this channel.",
    ]);
  });

  test("said in a fixed order - what to do first, first - whatever order Slack answered in", () => {
    expect(ADD_PROBLEM_ORDER).toEqual([
      WorkspaceChannelAddOutcome.NotFound,
      WorkspaceChannelAddOutcome.NotProjectMember,
      WorkspaceChannelAddOutcome.Guest,
      WorkspaceChannelAddOutcome.Refused,
      WorkspaceChannelAddOutcome.TryAgain,
    ]);

    expect(
      getAddProblemSentences({
        results: [
          result(BOB, "Bob", WorkspaceChannelAddOutcome.TryAgain),
          result(CAROL, "Carol", WorkspaceChannelAddOutcome.NotProjectMember),
          result(DAN, "Dan", WorkspaceChannelAddOutcome.Added),
          result(EVE, "Eve", WorkspaceChannelAddOutcome.NotFound),
          result(FAY, "Fay", WorkspaceChannelAddOutcome.AlreadyIn),
        ],
        viewerUserId: VIEWER,
        translator: ENGLISH,
      }).map((sentence: string): string => {
        return sentence.split(" ").slice(0, 3).join(" ");
      }),
    ).toEqual(["OneUptime can't find", "Carol isn't a", "Slack didn't answer"]);
  });

  test("every problem has a sentence for several people, naming them with {{names}}", () => {
    const problems: Array<WorkspaceChannelAddOutcome> = Object.values(
      WorkspaceChannelAddOutcome,
    ).filter((outcome: WorkspaceChannelAddOutcome): boolean => {
      return isAddProblem({ userId: BOB, name: "Bob", outcome: outcome });
    });

    expect(Object.keys(ADD_PROBLEM_TEXT_FOR_SEVERAL).sort()).toEqual(
      [...problems].sort(),
    );
    expect([...ADD_PROBLEM_ORDER].sort()).toEqual([...problems].sort());

    for (const text of Object.values(ADD_PROBLEM_TEXT_FOR_SEVERAL)) {
      expect(text).toContain("{{names}}");
      expect(text).not.toContain("{{name}}");
    }
  });

  test("in German, the names are listed the German way, inside the German sentence", () => {
    const german: Record<string, string> = JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "FeatureSet",
          "Dashboard",
          "src",
          "Locales",
          "de.json",
        ),
        "utf8",
      ),
    ) as Record<string, string>;
    const translator: Translator = createTranslator((text: string) => {
      return german[text];
    }, "de");

    expect(
      getAddProblemSentences({
        results: [
          result(BOB, "Bob", WorkspaceChannelAddOutcome.Refused),
          result(CAROL, "Carol", WorkspaceChannelAddOutcome.Refused),
        ],
        viewerUserId: VIEWER,
        translator: translator,
      }),
    ).toEqual([
      "Slack hat OneUptime nicht erlaubt, Bob und Carol hinzuzufügen.",
    ]);

    expect(
      getPickNotices({
        answer: {
          results: [result(BOB, "Bob", WorkspaceChannelAddOutcome.Added)],
        },
        viewerUserId: VIEWER,
        teamName: "Plattform",
        translator: translator,
      }),
    ).toEqual([
      {
        tone: PeopleSearchNoticeTone.Done,
        text: "1 Person aus Plattform hinzugefügt.",
      },
    ]);
  });
});

describe("the Slack command in the hint for a channel the app was taken out of", () => {
  test("is cut out of the sentence, without the sentence's own full stop", () => {
    expect(
      splitAtSlackInviteCommand(
        "If it's still there, someone in it can add the app back by typing /invite @OneUptime.",
      ),
    ).toEqual({
      before:
        "If it's still there, someone in it can add the app back by typing ",
      command: "/invite @OneUptime",
      after: ".",
    });
  });

  test("ends where the handle does: at a space, or a word written straight after it", () => {
    expect(
      splitAtSlackInviteCommand(
        "채널이 아직 있다면 채널에 있는 사람이 /invite @OneUptime을 입력해 앱을 다시 추가할 수 있습니다.",
      ).command,
    ).toBe("/invite @OneUptime");
    expect(
      splitAtSlackInviteCommand(
        "Falls er noch existiert, kann jemand darin die App mit /invite @OneUptime wieder hinzufügen.",
      ),
    ).toEqual({
      before: "Falls er noch existiert, kann jemand darin die App mit ",
      command: "/invite @OneUptime",
      after: " wieder hinzufügen.",
    });
  });

  test("a sentence without the command, or with only its start, is left whole", () => {
    expect(splitAtSlackInviteCommand("Ask a Slack admin.")).toEqual({
      before: "Ask a Slack admin.",
      command: "",
      after: "",
    });
    expect(splitAtSlackInviteCommand("Type /invite @.")).toEqual({
      before: "Type /invite @.",
      command: "",
      after: "",
    });
  });

  test("a long run of handle characters is read in one pass", () => {
    const hint: string = `typing /invite @${"a".repeat(400000)}.`;
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(splitAtSlackInviteCommand(hint).command.length).toBe(400009);
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
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
      ...Object.values(ADD_PROBLEM_TEXT_FOR_SEVERAL),
      // Lists two or three names, as the grouped sentences fill {{names}}.
      "{{first}} and {{second}}",
      "{{first}}, {{second}} and {{third}}",
      PEOPLE_COUNT.other,
      SHOW_MORE_PEOPLE.other,
      UNNAMED_PEOPLE.other,
      ADDED_FROM_TEAM.other,
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

      expect(locale[`${ADDED_FROM_TEAM.other}_one`]).toBeTruthy();
      expect(placeholders(locale[`${ADDED_FROM_TEAM.other}_one`]!)).toEqual([
        "{{count}}",
        "{{team}}",
      ]);
      expect(english[`${ADDED_FROM_TEAM.other}_one`]).toBe(ADDED_FROM_TEAM.one);
    },
  );

  test.each(["en", ...LANGUAGES])(
    "%s keeps the Slack command in the hint whole, so the card shows it as one",
    (language: string) => {
      const hint: string | undefined =
        read(language)[RECORD_CHANNEL_TEXT.unreachableHint];

      expect(splitAtSlackInviteCommand(hint || "").command).toBe(
        "/invite @OneUptime",
      );
    },
  );
});
