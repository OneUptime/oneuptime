import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import ObjectID from "../../../Types/ObjectID";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * The PROJECT-level half of the workspace disconnect cascade.
 *
 * The dashboard's "Uninstall OneUptime from Slack / Microsoft Teams" button
 * deletes the WorkspaceProjectAuthToken row through the generic CRUD path.
 * Before this hook existed, that path deleted ONLY the project token: every
 * member's WorkspaceUserAuthToken survived, and with it every UserSlack /
 * UserMicrosoftTeams notification method — verified-looking rows pointing at
 * a workspace the sender deterministically refuses. The on-call fallback
 * would pick them into its zero-cost tier and stop looking, and the
 * readiness surface would keep reporting the responder reachable: the exact
 * false green both of those surfaces exist to make impossible. (The
 * Slack-side app_uninstall webhook already deleted the user tokens — but it
 * only fires for uninstalls initiated inside Slack, and Microsoft Teams has
 * no uninstall webhook at all.)
 *
 * The hook deletes the workspace's user tokens THROUGH THEIR SERVICE, so
 * WorkspaceUserAuthTokenService.onBeforeDelete fires and cascades to the
 * notification methods and their rules — one chain, tested per link:
 * project token -> user tokens (here), user token -> method rows
 * (WorkspaceUserAuthTokenNotificationMethodCascade.test.ts), method row ->
 * rules (UserSlackService.test.ts / UserMicrosoftTeamsService.test.ts).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const TOKEN_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

type OnBeforeDeleteFunction = (deleteBy: {
  query: Record<string, unknown>;
  props: { isRoot: boolean };
}) => Promise<unknown>;

function callOnBeforeDelete(deleteBy: {
  query: Record<string, unknown>;
  props: { isRoot: boolean };
}): Promise<unknown> {
  return (
    WorkspaceProjectAuthTokenService as unknown as {
      onBeforeDelete: OnBeforeDeleteFunction;
    }
  ).onBeforeDelete(deleteBy);
}

function projectTokenRow(
  workspaceType: WorkspaceType,
  projectId: ObjectID = PROJECT_ID,
): WorkspaceProjectAuthToken {
  return {
    id: TOKEN_ID,
    projectId: projectId,
    workspaceType: workspaceType,
  } as unknown as WorkspaceProjectAuthToken;
}

describe("WorkspaceProjectAuthTokenService.onBeforeDelete - workspace disconnect cascade", () => {
  let findTokens: jest.SpyInstance;
  let deleteUserTokens: jest.SpyInstance;

  beforeEach(() => {
    findTokens = jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockResolvedValue([] as never);

    deleteUserTokens = jest
      .spyOn(WorkspaceUserAuthTokenService, "deleteBy")
      .mockResolvedValue([] as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("deleting the Slack project token deletes every Slack user token in the project, through the service", async () => {
    findTokens.mockResolvedValue([
      projectTokenRow(WorkspaceType.Slack),
    ] as never);

    await callOnBeforeDelete({
      query: { _id: TOKEN_ID },
      props: { isRoot: false },
    });

    expect(deleteUserTokens).toHaveBeenCalledTimes(1);
    const arg: {
      query: { projectId: ObjectID; workspaceType: WorkspaceType };
      limit: number;
      props: { isRoot: boolean };
    } = deleteUserTokens.mock.calls[0][0] as {
      query: { projectId: ObjectID; workspaceType: WorkspaceType };
      limit: number;
      props: { isRoot: boolean };
    };
    expect(arg.query.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(arg.query.workspaceType).toBe(WorkspaceType.Slack);
    expect(arg.limit).toBe(LIMIT_MAX);
    /*
     * isRoot matters twice over: the user tokens belong to OTHER users, whom
     * the disconnecting admin's own scope could never delete — and it is the
     * deleteBy going THROUGH the service (rather than raw) that fires the
     * user-token hook which takes the notification methods down with it.
     */
    expect(arg.props.isRoot).toBe(true);
  });

  test("the cascade is scoped to the WORKSPACE TYPE being disconnected - a Teams disconnect leaves Slack links alone", async () => {
    findTokens.mockResolvedValue([
      projectTokenRow(WorkspaceType.MicrosoftTeams),
    ] as never);

    await callOnBeforeDelete({
      query: { _id: TOKEN_ID },
      props: { isRoot: true },
    });

    expect(deleteUserTokens).toHaveBeenCalledTimes(1);
    const arg: { query: { workspaceType: WorkspaceType } } = deleteUserTokens
      .mock.calls[0][0] as { query: { workspaceType: WorkspaceType } };
    expect(arg.query.workspaceType).toBe(WorkspaceType.MicrosoftTeams);
  });

  test("a bulk delete spanning both workspace types cascades each token to its own workspace", async () => {
    findTokens.mockResolvedValue([
      projectTokenRow(WorkspaceType.Slack),
      projectTokenRow(WorkspaceType.MicrosoftTeams),
    ] as never);

    await callOnBeforeDelete({
      query: { projectId: PROJECT_ID },
      props: { isRoot: true },
    });

    expect(deleteUserTokens).toHaveBeenCalledTimes(2);
    const workspaceTypes: Array<WorkspaceType> = deleteUserTokens.mock.calls.map(
      (call: Array<unknown>) => {
        return (call[0] as { query: { workspaceType: WorkspaceType } }).query
          .workspaceType;
      },
    );
    expect(workspaceTypes).toContain(WorkspaceType.Slack);
    expect(workspaceTypes).toContain(WorkspaceType.MicrosoftTeams);
  });

  test("each token's cascade is scoped to that token's OWN project", async () => {
    findTokens.mockResolvedValue([
      projectTokenRow(WorkspaceType.Slack, PROJECT_ID),
      projectTokenRow(WorkspaceType.Slack, OTHER_PROJECT_ID),
    ] as never);

    await callOnBeforeDelete({
      query: { workspaceType: WorkspaceType.Slack },
      props: { isRoot: true },
    });

    const projectIds: Array<string> = deleteUserTokens.mock.calls.map(
      (call: Array<unknown>) => {
        return (
          call[0] as { query: { projectId: ObjectID } }
        ).query.projectId.toString();
      },
    );
    expect(projectIds).toContain(PROJECT_ID.toString());
    expect(projectIds).toContain(OTHER_PROJECT_ID.toString());
  });

  test("the tokens are re-read with the RAW delete query, as root", async () => {
    await callOnBeforeDelete({
      query: { projectId: PROJECT_ID },
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
    expect(arg.query["projectId"]).toBe(PROJECT_ID);
    expect(arg.props.isRoot).toBe(true);
    expect(arg.limit).toBe(LIMIT_MAX);
  });

  test("a token row missing its project or workspace type is skipped rather than issuing an unscoped delete", async () => {
    findTokens.mockResolvedValue([
      { id: TOKEN_ID } as unknown as WorkspaceProjectAuthToken,
    ] as never);

    await callOnBeforeDelete({
      query: { _id: TOKEN_ID },
      props: { isRoot: true },
    });

    /*
     * A deleteBy whose query is { projectId: undefined, workspaceType:
     * undefined } would match every user token in the installation. Skipping
     * the malformed row is the only safe reading.
     */
    expect(deleteUserTokens).not.toHaveBeenCalled();
  });

  test("a delete that matches no project tokens cascades nothing", async () => {
    await callOnBeforeDelete({
      query: { _id: TOKEN_ID },
      props: { isRoot: true },
    });

    expect(deleteUserTokens).not.toHaveBeenCalled();
  });
});
