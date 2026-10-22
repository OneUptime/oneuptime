import WorkspaceAskToConnectUtil, {
  WORKSPACE_ASK_TO_CONNECT_MAX_NAMED,
  WorkspaceAskToConnectRun,
  WorkspaceAskToConnectState,
  WorkspaceAskToConnectStatus,
} from "../../../Types/Workspace/WorkspaceAskToConnect";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { describe, expect, test } from "@jest/globals";

/*
 * What the "Ask everyone to connect" card and the server say to each other:
 * the answer goes out as JSON and is read back by the page, and the run is
 * kept in the cache as JSON and read back by the server. Only well-formed
 * values are read back.
 */

const RUN: WorkspaceAskToConnectRun = {
  state: WorkspaceAskToConnectState.Done,
  startedAt: "2026-10-22T10:00:00.000Z",
  finishedAt: "2026-10-22T10:04:12.000Z",
  askedByName: "Jane Admin",
  toAskCount: 688,
  askedCount: 650,
  notFoundCount: 36,
  failedCount: 2,
  notFoundNames: ["Carol", "dave@example.com"],
};

describe("WorkspaceAskToConnectUtil", () => {
  test("a status is read back as it was written", () => {
    const status: WorkspaceAskToConnectStatus = {
      memberCount: 1000,
      connectedCount: 312,
      run: RUN,
    };

    expect(
      WorkspaceAskToConnectUtil.statusFromJSON(
        JSON.parse(
          JSON.stringify(WorkspaceAskToConnectUtil.statusToJSON(status)),
        ),
      ),
    ).toEqual(status);
  });

  test("a status with no run yet reads back with none", () => {
    expect(
      WorkspaceAskToConnectUtil.statusFromJSON({
        memberCount: 3,
        connectedCount: 1,
        run: null,
      }),
    ).toEqual({ memberCount: 3, connectedCount: 1, run: null });
  });

  test.each([null, undefined, "status", 42, [], [{ memberCount: 1 }]])(
    "something that is not an answer (%p) is no status",
    (value: unknown) => {
      expect(WorkspaceAskToConnectUtil.statusFromJSON(value)).toBeNull();
    },
  );

  test("a count that is not a whole number of at least zero reads as zero", () => {
    expect(
      WorkspaceAskToConnectUtil.statusFromJSON({
        memberCount: -4,
        connectedCount: "12",
        run: null,
      }),
    ).toEqual({ memberCount: 0, connectedCount: 0, run: null });

    expect(
      WorkspaceAskToConnectUtil.runFromJSON({
        ...WorkspaceAskToConnectUtil.runToJSON(RUN),
        askedCount: 2.7,
        failedCount: Number.POSITIVE_INFINITY,
      }),
    ).toMatchObject({ askedCount: 2, failedCount: 0 });
  });

  test("a run in a state the page does not know, or without a start, is no run", () => {
    expect(
      WorkspaceAskToConnectUtil.runFromJSON({
        ...WorkspaceAskToConnectUtil.runToJSON(RUN),
        state: "exploding",
      }),
    ).toBeNull();

    expect(
      WorkspaceAskToConnectUtil.runFromJSON({
        ...WorkspaceAskToConnectUtil.runToJSON(RUN),
        startedAt: 1760000000,
      }),
    ).toBeNull();
  });

  test("only names are named, and no more of them than an answer holds", () => {
    const names: Array<unknown> = [
      "Carol",
      "",
      42,
      { name: "Eve" },
      ...Array.from({ length: WORKSPACE_ASK_TO_CONNECT_MAX_NAMED + 10 }).map(
        (_value: unknown, index: number): string => {
          return `Person ${index}`;
        },
      ),
    ];

    const run: WorkspaceAskToConnectRun | null =
      WorkspaceAskToConnectUtil.runFromJSON({
        ...WorkspaceAskToConnectUtil.runToJSON(RUN),
        notFoundNames: names as never,
      });

    expect(run!.notFoundNames[0]).toBe("Carol");
    expect(run!.notFoundNames[1]).toBe("Person 0");
    expect(run!.notFoundNames).toHaveLength(WORKSPACE_ASK_TO_CONNECT_MAX_NAMED);
  });

  test("Slack and Microsoft Teams are the workspaces whose members can be asked", () => {
    expect(WorkspaceAskToConnectUtil.isWorkspaceType(WorkspaceType.Slack)).toBe(
      true,
    );
    expect(
      WorkspaceAskToConnectUtil.isWorkspaceType(WorkspaceType.MicrosoftTeams),
    ).toBe(true);

    for (const value of ["slack", "Discord", "", null, undefined, 1]) {
      expect(WorkspaceAskToConnectUtil.isWorkspaceType(value)).toBe(false);
    }
  });
});
