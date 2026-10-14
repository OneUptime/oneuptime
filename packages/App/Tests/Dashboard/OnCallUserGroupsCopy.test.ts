import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  WorkspaceAvailableUserGroup,
  WorkspaceUserGroupLeftOutReason,
  WorkspaceUserGroupProblem,
  WorkspaceUserGroupView,
} from "Common/Types/Workspace/WorkspaceUserGroup";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import { PluralTemplate } from "Common/UI/Utils/TranslateTemplate";
import {
  CONNECT_FORM_TEXT,
  ConnectNote,
  DISCONNECT_MANY_OTHERS,
  DISCONNECT_TEXT,
  FOLLOWS_MANY,
  getConnectNotes,
  getLeftOutText,
  getMention,
  getPersonName,
  getUserGroupProblemText,
  getUserGroupStatus,
  isMembersShown,
  PEOPLE_COUNT,
  REPLACES_PEOPLE,
  TEAM_SUBTITLE,
  USER_GROUP_LABELS,
  USER_GROUP_STATUS_LABELS,
  USER_GROUP_TIME_TEXT,
  USER_GROUPS_COPY,
  UserGroupStatusKind,
} from "../../FeatureSet/Dashboard/src/Components/OnCallPolicy/UserGroups/UserGroupsCopy";

/*
 * WHAT THE SCHEDULE PAGE'S USER GROUP CARD SAYS, and when (UserGroupsCopy).
 *
 * Customer feedback #3: "We have a number of @teamname-oncall user group in
 * Slack that is always updated with the on-call person(s)". Each decision
 * the card's words make is pinned here on its own: where a group stands, what
 * each refusal tells the reader to do in its own chat, why somebody on call
 * is not in a group, what connecting a group picked does. And every sentence
 * is one the Dashboard's locales carry - plurals with their "one" form - so
 * none is shown in English to the sixteen other languages for want of a key.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const ENGLISH: Record<string, unknown> = JSON.parse(
  fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
) as Record<string, unknown>;

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json") && file !== "en.json";
  })
  .map((file: string): string => {
    return file.replace(/\.json$/, "");
  });

function viewOf(
  data: Partial<WorkspaceUserGroupView> = {},
): WorkspaceUserGroupView {
  return {
    workspaceUserGroupId: "8a000000-0000-4000-8000-000000000001",
    workspaceType: WorkspaceType.Slack,
    name: "Payments on-call",
    handle: "payments-oncall",
    teamName: null,
    schedules: [],
    members: [],
    leftOut: [],
    isTurnedOff: false,
    problem: null,
    problemDetail: null,
    syncedAt: "2026-10-14T09:00:00.000Z",
    checkedAt: "2026-10-14T09:00:00.000Z",
    ...data,
  };
}

function availableOf(
  data: Partial<WorkspaceAvailableUserGroup> = {},
): WorkspaceAvailableUserGroup {
  return {
    workspaceGroupId: "S0PAY",
    name: "Payments on-call",
    handle: "payments-oncall",
    userCount: 0,
    isTurnedOff: false,
    workspaceUserGroupId: null,
    followsScheduleNames: [],
    ...data,
  };
}

// Every sentence and label the card draws, by where it is drawn.
function everySentence(): Array<string> {
  const sentences: Array<string> = [];

  for (const copy of Object.values(USER_GROUPS_COPY)) {
    sentences.push(
      copy.title,
      copy.description,
      copy.connectButton,
      copy.emptyTitle,
      copy.emptyText,
      copy.loadError,
      copy.connectTitle,
      copy.connectDescription,
      copy.groupNoun,
      copy.turnedOffText,
    );
  }

  sentences.push(
    ...Object.values(DISCONNECT_TEXT),
    TEAM_SUBTITLE,
    ...Object.values(USER_GROUP_LABELS),
    ...Object.values(USER_GROUP_STATUS_LABELS),
    ...Object.values(USER_GROUP_TIME_TEXT),
    ...Object.values(CONNECT_FORM_TEXT),
  );

  for (const workspaceType of [
    WorkspaceType.Slack,
    WorkspaceType.MicrosoftTeams,
  ]) {
    // With the workspace's own words for a refusal, and without them.
    for (const problemDetail of ["invalid_users", null]) {
      for (const problem of Object.values(WorkspaceUserGroupProblem)) {
        sentences.push(
          getUserGroupProblemText(
            viewOf({
              workspaceType: workspaceType,
              problem: problem,
              problemDetail: problemDetail,
            }),
          )!,
        );
      }
    }

    for (const reason of Object.values(WorkspaceUserGroupLeftOutReason)) {
      sentences.push(
        getLeftOutText({
          workspaceType: workspaceType,
          person: {
            userId: "9a000000-0000-4000-8000-0000000000b1",
            name: "Bob Lee",
            email: "bob@acme.test",
            reason: reason,
          },
        }),
      );
    }
  }

  return Array.from(new Set(sentences));
}

const PLURALS: Array<PluralTemplate> = [
  PEOPLE_COUNT,
  FOLLOWS_MANY,
  REPLACES_PEOPLE,
  DISCONNECT_MANY_OTHERS,
];

describe("where a group stands", () => {
  test("in step, turned off for nobody on call, not looked at yet, refused, turned off by somebody - in that order of telling", () => {
    expect(getUserGroupStatus(viewOf())).toBe(UserGroupStatusKind.InStep);
    expect(getUserGroupStatus(viewOf({ isTurnedOff: true }))).toBe(
      UserGroupStatusKind.TurnedOff,
    );
    expect(getUserGroupStatus(viewOf({ checkedAt: null }))).toBe(
      UserGroupStatusKind.NotYet,
    );
    expect(
      getUserGroupStatus(
        viewOf({ problem: WorkspaceUserGroupProblem.PaidPlanNeeded }),
      ),
    ).toBe(UserGroupStatusKind.Problem);
    expect(
      getUserGroupStatus(
        viewOf({ problem: WorkspaceUserGroupProblem.TurnedOffInWorkspace }),
      ),
    ).toBe(UserGroupStatusKind.TurnedOffInWorkspace);

    // A refusal outranks never having been looked at, or being off.
    expect(
      getUserGroupStatus(
        viewOf({
          checkedAt: null,
          isTurnedOff: true,
          problem: WorkspaceUserGroupProblem.Unavailable,
        }),
      ),
    ).toBe(UserGroupStatusKind.Problem);
  });

  test("only a Slack user group can be turned off by somebody: said of a Teams tag, it is a refusal - never 'Turned off in Slack'", () => {
    expect(
      getUserGroupStatus(
        viewOf({
          workspaceType: WorkspaceType.MicrosoftTeams,
          handle: null,
          problem: WorkspaceUserGroupProblem.TurnedOffInWorkspace,
        }),
      ),
    ).toBe(UserGroupStatusKind.Problem);
  });

  test("each status has its pill's word", () => {
    expect(USER_GROUP_STATUS_LABELS).toEqual({
      [UserGroupStatusKind.InStep]: "Up to date",
      [UserGroupStatusKind.NotYet]: "Updating",
      [UserGroupStatusKind.TurnedOff]: "Nobody on call",
      [UserGroupStatusKind.TurnedOffInWorkspace]: "Turned off in Slack",
      [UserGroupStatusKind.Problem]: "Not up to date",
    });
  });
});

describe("what each refusal says to do", () => {
  test("no problem, no sentence", () => {
    expect(getUserGroupProblemText(viewOf())).toBeNull();
  });

  test("Slack: each problem names Slack's own fix - the plan, the scope, the admin setting, the group gone", () => {
    const slack: (problem: WorkspaceUserGroupProblem) => string = (
      problem: WorkspaceUserGroupProblem,
    ): string => {
      return getUserGroupProblemText(viewOf({ problem: problem }))!;
    };

    expect(slack(WorkspaceUserGroupProblem.PaidPlanNeeded)).toContain(
      "Upgrade your Slack workspace",
    );
    expect(slack(WorkspaceUserGroupProblem.MissingScope)).toContain(
      "Reconnect Slack in Project Settings > Workspace > Slack",
    );
    expect(slack(WorkspaceUserGroupProblem.AdminsOnly)).toContain(
      "under Permissions > User Groups",
    );
    expect(slack(WorkspaceUserGroupProblem.Gone)).toContain(
      "Disconnect it, or connect another user group.",
    );
    expect(slack(WorkspaceUserGroupProblem.NotConnected)).toContain(
      "Connect Slack again in Project Settings > Workspace > Slack.",
    );
    expect(slack(WorkspaceUserGroupProblem.Unavailable)).toContain(
      "It tries again in a few minutes.",
    );
    expect(slack(WorkspaceUserGroupProblem.PaidPlanNeeded)).toBe(
      "User groups need a paid Slack plan, so OneUptime can't update {{mention}}. Upgrade your Slack workspace to use them.",
    );
    // Slack never says it this way; if it did, the fix is the scopes'.
    expect(slack(WorkspaceUserGroupProblem.MissingPermission)).toBe(
      slack(WorkspaceUserGroupProblem.MissingScope),
    );
  });

  test("a refusal in the workspace's own words, and without them - never 'refused the change: .'", () => {
    expect(
      getUserGroupProblemText(
        viewOf({
          problem: WorkspaceUserGroupProblem.Refused,
          problemDetail: "invalid_users",
        }),
      ),
    ).toBe("Slack refused the change: {{detail}}.");

    for (const problemDetail of [null, "", "   "]) {
      expect(
        getUserGroupProblemText(
          viewOf({
            problem: WorkspaceUserGroupProblem.Refused,
            problemDetail: problemDetail,
          }),
        ),
      ).toBe("Slack refused the change.");
      expect(
        getUserGroupProblemText(
          viewOf({
            workspaceType: WorkspaceType.MicrosoftTeams,
            handle: null,
            problem: WorkspaceUserGroupProblem.Refused,
            problemDetail: problemDetail,
          }),
        ),
      ).toBe("Microsoft Teams refused the change.");
    }

    // A problem with words of its own never needs the detail.
    expect(
      getUserGroupProblemText(
        viewOf({ problem: WorkspaceUserGroupProblem.AdminsOnly }),
      ),
    ).toContain("Permissions > User Groups");
  });

  test("Microsoft Teams: consent for tags, the app gone from the team, the tag gone", () => {
    const teams: (problem: WorkspaceUserGroupProblem) => string = (
      problem: WorkspaceUserGroupProblem,
    ): string => {
      return getUserGroupProblemText(
        viewOf({
          workspaceType: WorkspaceType.MicrosoftTeams,
          problem: problem,
        }),
      )!;
    };

    expect(teams(WorkspaceUserGroupProblem.MissingPermission)).toBe(
      "Your Microsoft 365 organization hasn't let OneUptime manage tags yet. A Microsoft 365 admin can allow it with Grant Admin Consent, in Project Settings > Workspace > Microsoft Teams.",
    );
    expect(teams(WorkspaceUserGroupProblem.TeamGone)).toBe(
      "OneUptime's app isn't in the {{team}} team any more, so it can't update {{mention}}. Add the app to the team in Microsoft Teams again.",
    );
    expect(teams(WorkspaceUserGroupProblem.Gone)).toContain(
      "connect another tag.",
    );
    // Slack's words are never shown for a Teams tag.
    for (const problem of Object.values(WorkspaceUserGroupProblem)) {
      expect({ problem, slack: teams(problem).includes("Slack") }).toEqual({
        problem,
        slack: false,
      });
    }
  });

  test("every sentence fills only the values the row hands it", () => {
    for (const sentence of everySentence()) {
      const names: Array<string> = Array.from(
        sentence.matchAll(/\{\{(\w+)\}\}/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      for (const name of names) {
        expect({ sentence, name, known: true }).toEqual({
          sentence,
          name,
          known: [
            "mention",
            "team",
            "detail",
            "name",
            "when",
            "schedule",
            "count",
          ].includes(name),
        });
      }
    }
  });
});

describe("who is on call but not in a group", () => {
  test("Slack: not found, a guest, deactivated - each says why, and what would put them in", () => {
    const why: (reason: WorkspaceUserGroupLeftOutReason) => string = (
      reason: WorkspaceUserGroupLeftOutReason,
    ): string => {
      return getLeftOutText({
        workspaceType: WorkspaceType.Slack,
        person: {
          userId: "9a000000-0000-4000-8000-0000000000b1",
          name: "Bob Lee",
          email: "bob@acme.test",
          reason: reason,
        },
      });
    };

    expect(why(WorkspaceUserGroupLeftOutReason.NotFound)).toBe(
      "{{name}} is on call but isn't in the group: OneUptime can't find them in Slack. They can connect their Slack account in User Settings > Slack, or use the same email address in both.",
    );
    expect(why(WorkspaceUserGroupLeftOutReason.Guest)).toBe(
      "{{name}} is on call but isn't in the group: they are a guest in Slack, and Slack keeps guests out of user groups.",
    );
    expect(why(WorkspaceUserGroupLeftOutReason.Deactivated)).toBe(
      "{{name}} is on call but isn't in the group: their Slack account is deactivated.",
    );
  });

  test("Microsoft Teams: a tag holds only its team's people - and what puts them in", () => {
    for (const reason of Object.values(WorkspaceUserGroupLeftOutReason)) {
      expect(
        getLeftOutText({
          workspaceType: WorkspaceType.MicrosoftTeams,
          person: {
            userId: "9a000000-0000-4000-8000-0000000000b1",
            name: "Bob Lee",
            email: "bob@acme.test",
            reason: reason,
          },
        }),
      ).toBe(
        "{{name}} is on call but isn't in the tag: a tag holds only people in its team, and they aren't in the {{team}} team. Add them to it in Microsoft Teams.",
      );
    }
  });

  test("a person by their name, or their email address when they have none", () => {
    expect(getPersonName({ name: " Ana Silva ", email: "ana@acme.test" })).toBe(
      "Ana Silva",
    );
    expect(getPersonName({ name: "", email: "ana@acme.test" })).toBe(
      "ana@acme.test",
    );
  });
});

describe("who is in it", () => {
  test("listed once OneUptime has put people in it, or has had it in step", () => {
    expect(isMembersShown(viewOf())).toBe(true);
    expect(
      isMembersShown(
        viewOf({
          members: [
            {
              userId: "9a000000-0000-4000-8000-0000000000a1",
              name: "Ana Silva",
              email: "ana@acme.test",
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  test("not before OneUptime looked at it, nor while it is off for nobody on call - the row's note says so", () => {
    expect(isMembersShown(viewOf({ checkedAt: null, syncedAt: null }))).toBe(
      false,
    );
    expect(isMembersShown(viewOf({ isTurnedOff: true }))).toBe(false);
  });

  test("refused before it was ever in step: OneUptime does not know who is in it, so it says nothing rather than 'None'", () => {
    expect(
      isMembersShown(
        viewOf({
          problem: WorkspaceUserGroupProblem.MissingScope,
          syncedAt: null,
        }),
      ),
    ).toBe(false);

    // Once in step, the people it put in are shown, as they stand.
    expect(
      isMembersShown(
        viewOf({ problem: WorkspaceUserGroupProblem.MissingScope }),
      ),
    ).toBe(true);
  });

  test("an empty list says None - 'Nobody' is translated as 'page nobody' in some locales", () => {
    expect(USER_GROUP_LABELS.members).toBe("Members");
    expect(USER_GROUP_LABELS.noMembers).toBe("None");
  });
});

describe("a group as people mention it", () => {
  test("Slack by its handle, a Teams tag by its name", () => {
    expect(getMention(viewOf())).toBe("@payments-oncall");
    expect(
      getMention(
        viewOf({
          workspaceType: WorkspaceType.MicrosoftTeams,
          name: "Payments on-call",
          handle: null,
        }),
      ),
    ).toBe("@Payments on-call");
  });
});

describe("what connecting the group picked does", () => {
  test("nothing picked, or a new group: nothing to say", () => {
    expect(getConnectNotes({ group: undefined })).toEqual([]);
    expect(getConnectNotes({ group: availableOf() })).toEqual([]);
  });

  test("a group that follows one schedule already names it", () => {
    expect(
      getConnectNotes({
        group: availableOf({ followsScheduleNames: ["Payments Secondary"] }),
      }),
    ).toEqual([
      {
        template: CONNECT_FORM_TEXT.followsOne,
        values: { schedule: "Payments Secondary" },
      },
    ]);
  });

  test("a group that follows several says how many", () => {
    expect(
      getConnectNotes({
        group: availableOf({
          followsScheduleNames: ["Database", "Payments Secondary"],
          userCount: 4,
        }),
      }),
    ).toEqual([{ template: FOLLOWS_MANY, count: 2, values: {} }]);
  });

  test("a group of nobody's yet, with people in it: they are replaced", () => {
    expect(getConnectNotes({ group: availableOf({ userCount: 12 }) })).toEqual([
      { template: REPLACES_PEOPLE, count: 12, values: {} },
    ]);
  });

  test("a group turned off in Slack: connecting turns it back on", () => {
    const notes: Array<ConnectNote> = getConnectNotes({
      group: availableOf({ userCount: 1, isTurnedOff: true }),
    });

    expect(notes).toEqual([
      { template: REPLACES_PEOPLE, count: 1, values: {} },
      { template: CONNECT_FORM_TEXT.turnsOn, values: {} },
    ]);
  });
});

describe("in every language the Dashboard speaks", () => {
  test("every sentence is a key of the English locale, and every plural has its one-form", () => {
    for (const sentence of everySentence()) {
      expect({ sentence, isKey: true }).toEqual({
        sentence,
        isKey: ENGLISH[sentence] === sentence,
      });
    }

    for (const plural of PLURALS) {
      expect(ENGLISH[plural.other]).toBe(plural.other);
      expect(ENGLISH[`${plural.other}_one`]).toBe(plural.one);
    }
  });

  test("and every other locale has each of them - translated, or kept for its translators", () => {
    for (const language of LANGUAGES) {
      const locale: Record<string, unknown> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
      ) as Record<string, unknown>;

      for (const sentence of everySentence()) {
        expect({ language, sentence, has: true }).toEqual({
          language,
          sentence,
          has: typeof locale[sentence] === "string",
        });
      }

      for (const plural of PLURALS) {
        expect({
          language,
          plural: plural.other,
          has: typeof locale[`${plural.other}_one`] === "string",
        }).toEqual({ language, plural: plural.other, has: true });
      }
    }
  });

  test("the card's own sentences are translated in each of them", () => {
    const teamsLeftOut: string = getLeftOutText({
      workspaceType: WorkspaceType.MicrosoftTeams,
      person: {
        userId: "9a000000-0000-4000-8000-0000000000b1",
        name: "Bob Lee",
        email: "bob@acme.test",
        reason: WorkspaceUserGroupLeftOutReason.NotInTeam,
      },
    });

    const own: Array<string> = [
      ...Object.values(USER_GROUPS_COPY).flatMap(
        (copy: (typeof USER_GROUPS_COPY)[WorkspaceType]): Array<string> => {
          return [
            copy.title,
            copy.description,
            copy.emptyTitle,
            copy.emptyText,
            copy.loadError,
            copy.connectDescription,
            copy.turnedOffText,
          ];
        },
      ),
      USER_GROUP_STATUS_LABELS[UserGroupStatusKind.TurnedOff],
      USER_GROUP_STATUS_LABELS[UserGroupStatusKind.Problem],
      USER_GROUP_LABELS.members,
      USER_GROUP_LABELS.noMembers,
      USER_GROUP_LABELS.checking,
      USER_GROUP_TIME_TEXT.notYet,
      DISCONNECT_TEXT.last,
      CONNECT_FORM_TEXT.teamDescription,
      CONNECT_FORM_TEXT.tagDescription,
      CONNECT_FORM_TEXT.followsOne,
      FOLLOWS_MANY.other,
      REPLACES_PEOPLE.other,
      teamsLeftOut,
      getUserGroupProblemText(
        viewOf({ problem: WorkspaceUserGroupProblem.PaidPlanNeeded }),
      )!,
      getUserGroupProblemText(
        viewOf({
          workspaceType: WorkspaceType.MicrosoftTeams,
          handle: null,
          problem: WorkspaceUserGroupProblem.MissingPermission,
        }),
      )!,
      getUserGroupProblemText(
        viewOf({ problem: WorkspaceUserGroupProblem.Refused }),
      )!,
      ...Object.values(WorkspaceUserGroupLeftOutReason).map(
        (reason: WorkspaceUserGroupLeftOutReason): string => {
          return getLeftOutText({
            workspaceType: WorkspaceType.Slack,
            person: {
              userId: "9a000000-0000-4000-8000-0000000000b1",
              name: "Bob Lee",
              email: "bob@acme.test",
              reason: reason,
            },
          });
        },
      ),
    ];

    for (const language of LANGUAGES) {
      const locale: Record<string, unknown> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
      ) as Record<string, unknown>;

      for (const sentence of own) {
        expect({ language, sentence, translated: true }).toEqual({
          language,
          sentence,
          translated:
            typeof locale[sentence] === "string" &&
            locale[sentence] !== sentence,
        });
      }
    }
  });
});
