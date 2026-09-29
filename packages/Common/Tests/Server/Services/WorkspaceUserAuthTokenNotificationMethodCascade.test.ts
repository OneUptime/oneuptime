import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import UserSlackService from "../../../Server/Services/UserSlackService";
import UserMicrosoftTeamsService from "../../../Server/Services/UserMicrosoftTeamsService";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import ObjectID from "../../../Types/ObjectID";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * Disconnecting a workspace account takes the notification methods pointing at
 * it down too — deliberately. A UserSlack / UserMicrosoftTeams row is a
 * pointer at the WorkspaceUserAuthToken being deleted here, and the two
 * possible stale states are not equivalent:
 *
 *   - Method row kept: rules keep selecting it, every page becomes an Error
 *     timeline row, and nothing re-pages the responder. Silent.
 *   - Method row deleted: its rules cascade away with it (the method service's
 *     own delete hook), the responder's cells go back to "no rule", and the
 *     verified-method fallback rescues the next page.
 *
 * The second is the designed failure mode, so the cascade below is what keeps
 * a disconnect from becoming a silent unpageable responder. Pinned per
 * workspace type, because deleting a Slack link must not touch the Teams
 * method and vice versa.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const TOKEN_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

type OnBeforeDeleteFunction = (deleteBy: {
  query: Record<string, unknown>;
  props: { isRoot: boolean };
}) => Promise<unknown>;

function callOnBeforeDelete(deleteBy: {
  query: Record<string, unknown>;
  props: { isRoot: boolean };
}): Promise<unknown> {
  return (
    WorkspaceUserAuthTokenService as unknown as {
      onBeforeDelete: OnBeforeDeleteFunction;
    }
  ).onBeforeDelete(deleteBy);
}

function tokenRow(workspaceType: WorkspaceType): WorkspaceUserAuthToken {
  return {
    id: TOKEN_ID,
    projectId: PROJECT_ID,
    userId: USER_ID,
    workspaceType: workspaceType,
  } as unknown as WorkspaceUserAuthToken;
}

describe("WorkspaceUserAuthTokenService.onBeforeDelete - notification method cascade", () => {
  let findTokens: jest.SpyInstance;
  let deleteSlack: jest.SpyInstance;
  let deleteTeams: jest.SpyInstance;

  beforeEach(() => {
    findTokens = jest
      .spyOn(WorkspaceUserAuthTokenService, "findBy")
      .mockResolvedValue([] as never);

    deleteSlack = jest
      .spyOn(UserSlackService, "deleteBy")
      .mockResolvedValue([] as never);

    deleteTeams = jest
      .spyOn(UserMicrosoftTeamsService, "deleteBy")
      .mockResolvedValue([] as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("deleting a Slack link deletes the user's UserSlack rows for that project - and nothing else", async () => {
    findTokens.mockResolvedValue([tokenRow(WorkspaceType.Slack)] as never);

    await callOnBeforeDelete({
      query: { _id: TOKEN_ID },
      props: { isRoot: true },
    });

    expect(deleteSlack).toHaveBeenCalledTimes(1);
    const arg: {
      query: { projectId: ObjectID; userId: ObjectID };
      limit: number;
      props: { isRoot: boolean };
    } = deleteSlack.mock.calls[0][0] as {
      query: { projectId: ObjectID; userId: ObjectID };
      limit: number;
      props: { isRoot: boolean };
    };
    expect(arg.query.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(arg.query.userId.toString()).toBe(USER_ID.toString());
    expect(arg.limit).toBe(LIMIT_MAX);
    expect(arg.props.isRoot).toBe(true);

    expect(deleteTeams).not.toHaveBeenCalled();
  });

  test("deleting a Microsoft Teams link deletes the user's UserMicrosoftTeams rows - and nothing else", async () => {
    findTokens.mockResolvedValue([
      tokenRow(WorkspaceType.MicrosoftTeams),
    ] as never);

    await callOnBeforeDelete({
      query: { _id: TOKEN_ID },
      props: { isRoot: true },
    });

    expect(deleteTeams).toHaveBeenCalledTimes(1);
    expect(deleteSlack).not.toHaveBeenCalled();
  });

  test("a bulk delete spanning both workspace types cascades each row to its own channel", async () => {
    findTokens.mockResolvedValue([
      tokenRow(WorkspaceType.Slack),
      tokenRow(WorkspaceType.MicrosoftTeams),
    ] as never);

    await callOnBeforeDelete({
      query: { projectId: PROJECT_ID },
      props: { isRoot: true },
    });

    expect(deleteSlack).toHaveBeenCalledTimes(1);
    expect(deleteTeams).toHaveBeenCalledTimes(1);
  });

  test("the tokens are re-read with the RAW delete query, as root, before the delete narrows anything", async () => {
    await callOnBeforeDelete({
      query: { userId: USER_ID, workspaceType: WorkspaceType.Slack },
      props: { isRoot: false },
    });

    expect(findTokens).toHaveBeenCalledTimes(1);
    const arg: {
      query: Record<string, unknown>;
      props: { isRoot: boolean };
      limit: number;
    } = findTokens.mock.calls[0][0] as {
      query: Record<string, unknown>;
      props: { isRoot: boolean };
      limit: number;
    };
    expect(arg.query["userId"]).toBe(USER_ID);
    expect(arg.props.isRoot).toBe(true);
    expect(arg.limit).toBe(LIMIT_MAX);
  });

  test("a token row missing its project or user ids is skipped rather than issuing an unscoped delete", async () => {
    findTokens.mockResolvedValue([
      {
        id: TOKEN_ID,
        workspaceType: WorkspaceType.Slack,
      } as unknown as WorkspaceUserAuthToken,
    ] as never);

    await callOnBeforeDelete({
      query: { _id: TOKEN_ID },
      props: { isRoot: true },
    });

    /*
     * The dangerous alternative: a deleteBy whose query is
     * { projectId: undefined, userId: undefined } matches every row in the
     * table. Skipping the malformed row is the only safe reading.
     */
    expect(deleteSlack).not.toHaveBeenCalled();
    expect(deleteTeams).not.toHaveBeenCalled();
  });

  test("a delete that matches no tokens cascades nothing", async () => {
    await callOnBeforeDelete({
      query: { _id: TOKEN_ID },
      props: { isRoot: true },
    });

    expect(deleteSlack).not.toHaveBeenCalled();
    expect(deleteTeams).not.toHaveBeenCalled();
  });
});
