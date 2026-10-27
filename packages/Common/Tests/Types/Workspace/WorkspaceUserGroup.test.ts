import { describe, expect, test } from "@jest/globals";
import {
  getSuggestedSlackHandle,
  getSuggestedUserGroupName,
  getUserGroupMention,
  isValidSlackUserGroupHandle,
  MICROSOFT_TEAMS_TAG_NAME_MAX_LENGTH,
  readSlackUserGroupHandle,
  readWorkspaceUserGroupSyncState,
  SLACK_USER_GROUP_HANDLE_MAX_LENGTH,
  SLACK_USER_GROUP_NAME_MAX_LENGTH,
  SLACK_USER_GROUP_SUGGESTED_HANDLE_MAX_LENGTH,
  WorkspaceUserGroupLeftOutReason,
  WorkspaceUserGroupProblem,
  WorkspaceUserGroupSyncState,
} from "../../../Types/Workspace/WorkspaceUserGroup";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * What the Connect form suggests for a schedule's new user group or tag,
 * what it accepts as a Slack handle, and how a stored sync state is read
 * back - never trusted further than its shape.
 */

describe("the name and handle suggested for a schedule", () => {
  test("Payments Primary: 'Payments Primary on-call', @payments-primary-oncall", () => {
    expect(
      getSuggestedUserGroupName({
        scheduleName: "Payments Primary",
        maxLength: SLACK_USER_GROUP_NAME_MAX_LENGTH,
      }),
    ).toBe("Payments Primary on-call");
    expect(getSuggestedSlackHandle("Payments Primary")).toBe(
      "payments-primary-oncall",
    );
  });

  test("a handle keeps letters and digits, joined by one hyphen, whatever separated them", () => {
    expect(getSuggestedSlackHandle("  DB / Primary (EU-1)  ")).toBe(
      "db-primary-eu-1-oncall",
    );
    expect(getSuggestedSlackHandle("Café Ops")).toBe("cafe-ops-oncall");
  });

  test("a suggested handle stays short: cut between words, keeping -oncall", () => {
    const handle: string = getSuggestedSlackHandle(
      "Payments Platform Primary Rotation",
    );

    expect(handle).toBe("payments-platform-primary-oncall");
    expect(handle.length).toBeLessThanOrEqual(
      SLACK_USER_GROUP_SUGGESTED_HANDLE_MAX_LENGTH,
    );
    expect(isValidSlackUserGroupHandle(handle)).toBe(true);

    expect(
      getSuggestedSlackHandle("Payments Platform Primary Rotation Europe"),
    ).toBe("payments-platform-primary-oncall");
    expect(getSuggestedSlackHandle("Payments Platformprimaryrotation")).toBe(
      "payments-oncall",
    );
  });

  test("one long word is cut where it must be", () => {
    const handle: string = getSuggestedSlackHandle(
      "Superextraordinarilylongschedulename",
    );

    expect(handle).toBe("superextraordinarilylongs-oncall");
    expect(handle.length).toBe(SLACK_USER_GROUP_SUGGESTED_HANDLE_MAX_LENGTH);
  });

  test("a name with no letters or digits still gets a handle Slack takes", () => {
    expect(getSuggestedSlackHandle("!!!")).toBe("team-oncall");
    expect(getSuggestedSlackHandle("")).toBe("team-oncall");
    expect(
      getSuggestedUserGroupName({ scheduleName: "  ", maxLength: 100 }),
    ).toBe("On-call on-call");
  });

  test("a Microsoft Teams tag name fits its 40 characters", () => {
    const name: string = getSuggestedUserGroupName({
      scheduleName: "Payments Platform Primary Rotation For Europe",
      maxLength: MICROSOFT_TEAMS_TAG_NAME_MAX_LENGTH,
    });

    expect(name.length).toBeLessThanOrEqual(
      MICROSOFT_TEAMS_TAG_NAME_MAX_LENGTH,
    );
    expect(name.endsWith(" on-call")).toBe(true);
  });

  test("white space inside the name is one space", () => {
    expect(
      getSuggestedUserGroupName({
        scheduleName: "Payments \t  Primary",
        maxLength: 100,
      }),
    ).toBe("Payments Primary on-call");
  });
});

describe("what a Slack handle may be", () => {
  test("lower-case letters, digits, hyphens, dots and underscores, starting with a letter or digit", () => {
    for (const handle of [
      "payments-oncall",
      "db.oncall",
      "sre_oncall",
      "1st-line",
      "a",
    ]) {
      expect(isValidSlackUserGroupHandle(handle)).toBe(true);
    }
  });

  test("anything else is not", () => {
    for (const handle of [
      "",
      "Payments",
      "payments oncall",
      "-oncall",
      ".oncall",
      "@oncall",
      "pay#ops",
      "x".repeat(SLACK_USER_GROUP_HANDLE_MAX_LENGTH + 1),
    ]) {
      expect(isValidSlackUserGroupHandle(handle)).toBe(false);
    }
  });

  test("a handle as people type it: @ and capitals taken off", () => {
    expect(readSlackUserGroupHandle(" @@Payments-OnCall ")).toBe(
      "payments-oncall",
    );
    expect(readSlackUserGroupHandle("")).toBe("");
  });

  test("a long typed handle is read in time that grows with its length", () => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        readSlackUserGroupHandle("@".repeat(400000));
        isValidSlackUserGroupHandle("a".repeat(400000));
        getSuggestedSlackHandle("a -".repeat(140000));
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("a group's mention", () => {
  test("Slack: its handle; Microsoft Teams: the tag's name", () => {
    expect(
      getUserGroupMention({
        workspaceType: WorkspaceType.Slack,
        name: "Payments on-call",
        handle: "payments-oncall",
      }),
    ).toBe("@payments-oncall");
    expect(
      getUserGroupMention({
        workspaceType: WorkspaceType.MicrosoftTeams,
        name: "Payments on-call",
        handle: null,
      }),
    ).toBe("@Payments on-call");
    expect(
      getUserGroupMention({
        workspaceType: WorkspaceType.Slack,
        name: "Payments on-call",
        handle: null,
      }),
    ).toBe("@Payments on-call");
  });
});

describe("a stored sync state, read back", () => {
  const stored: WorkspaceUserGroupSyncState = {
    members: [{ userId: "u-1", workspaceUserId: "U0ANA" }],
    leftOut: [{ userId: "u-2", reason: WorkspaceUserGroupLeftOutReason.Guest }],
    isTurnedOff: false,
    problem: WorkspaceUserGroupProblem.Refused,
    problemDetail: "invalid_users",
    checkedAt: "2026-10-14T09:00:00.000Z",
  };

  test("a state as it was saved", () => {
    expect(
      readWorkspaceUserGroupSyncState(JSON.parse(JSON.stringify(stored))),
    ).toEqual(stored);
  });

  test("nothing saved is never synced", () => {
    for (const value of [null, undefined, "", 7, [], "state"]) {
      expect(readWorkspaceUserGroupSyncState(value)).toBeNull();
    }
  });

  test("what is not of its shape is dropped, not trusted", () => {
    expect(
      readWorkspaceUserGroupSyncState({
        members: [
          { userId: "u-1", workspaceUserId: "U0ANA" },
          { userId: 7 },
          null,
          "U0BOB",
        ],
        leftOut: [
          { userId: "u-2", reason: "Guest" },
          { userId: "u-3", reason: "Bribed" },
        ],
        isTurnedOff: "yes",
        problem: "On fire",
        problemDetail: 12,
        checkedAt: 5,
      }),
    ).toEqual({
      members: [{ userId: "u-1", workspaceUserId: "U0ANA" }],
      leftOut: [
        { userId: "u-2", reason: WorkspaceUserGroupLeftOutReason.Guest },
      ],
      isTurnedOff: false,
      problem: null,
      checkedAt: "",
    });
  });
});
