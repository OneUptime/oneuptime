import ActiveMonitorLimit from "../../../../Server/Utils/Billing/ActiveMonitorLimit";
import { ToolImportAccess } from "../../../../Server/Utils/ToolImport/ToolImportPlanner";
import ToolImportProjectStateReader from "../../../../Server/Utils/ToolImport/ToolImportProjectStateReader";
import {
  ActiveMonitorLimitKind,
  ActiveMonitorLimitStatus,
  NO_ACTIVE_MONITOR_LIMIT,
} from "../../../../Types/Monitor/ActiveMonitorLimit";
import ObjectID from "../../../../Types/ObjectID";
import { ToolImportNoteCode } from "../../../../Types/ToolImport/ToolImportNote";
import ToolImportResourceKind from "../../../../Types/ToolImport/ToolImportResourceKind";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * HOW MANY MONITORS AN IMPORT FROM ANOTHER TOOL MAY BRING IN
 * (ToolImportProjectStateReader.readAccess, planRoomByKind).
 *
 * Every monitor an import makes goes through MonitorService.create, so the
 * project's limit on active monitors holds there either way. The preview
 * should say it first: monitors that are checked are counted against the
 * limit the project's plan sets - the Free plan's, or its own when it
 * bought its plan from a reseller (ActiveMonitorLimit) - and what does not
 * fit is shown as not brought over, with that limit's own note. Asked with
 * the project's count as every create counts it, whoever imports.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "3a000000-0000-4000-8000-000000000001",
);

let status: SpyInstance<typeof ActiveMonitorLimit.getStatus>;

async function readAccess(
  kinds?: Array<ToolImportResourceKind>,
): Promise<ToolImportAccess> {
  return await ToolImportProjectStateReader.readAccess({
    projectId: PROJECT_ID,
    props: { isRoot: true, tenantId: PROJECT_ID },
    kinds: kinds,
  });
}

function withStatus(value: ActiveMonitorLimitStatus): void {
  status.mockResolvedValue(value);
}

beforeEach(() => {
  status = jest
    .spyOn(ActiveMonitorLimit, "getStatus")
    .mockResolvedValue(NO_ACTIVE_MONITOR_LIMIT);

  // The teams people would be invited to: not what this is about.
  jest
    .spyOn(
      ToolImportProjectStateReader as unknown as {
        readInviteTeams: () => Promise<unknown>;
      },
      "readInviteTeams",
    )
    .mockResolvedValue({ teams: [], defaultId: null });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the monitors an import has room for", () => {
  test("under a plan's own limit: the room left, with that limit's note", async () => {
    withStatus({
      limit: { limit: 500, kind: ActiveMonitorLimitKind.Plan },
      activeMonitors: 497,
    });

    const access: ToolImportAccess = await readAccess();

    expect(access.planRoomByKind?.get(ToolImportResourceKind.Monitor)).toEqual(
      {
        room: 3,
        limit: 500,
        noteCode: ToolImportNoteCode.MonitorLimitReached,
      },
    );
    expect(status).toHaveBeenCalledWith(PROJECT_ID);
  });

  // The support report's project: 2,881 active monitors on a plan of 500.
  test("past a plan's own limit: no room at all", async () => {
    withStatus({
      limit: { limit: 500, kind: ActiveMonitorLimitKind.Plan },
      activeMonitors: 2881,
    });

    const access: ToolImportAccess = await readAccess();

    expect(access.planRoomByKind?.get(ToolImportResourceKind.Monitor)).toEqual(
      {
        room: 0,
        limit: 500,
        noteCode: ToolImportNoteCode.MonitorLimitReached,
      },
    );
  });

  test("on the Free plan: its room, with the Free plan's note", async () => {
    withStatus({
      limit: { limit: 10, kind: ActiveMonitorLimitKind.FreePlan },
      activeMonitors: 4,
    });

    const access: ToolImportAccess = await readAccess();

    expect(access.planRoomByKind?.get(ToolImportResourceKind.Monitor)).toEqual(
      {
        room: 6,
        limit: 10,
        noteCode: ToolImportNoteCode.MonitorPlanLimit,
      },
    );
  });

  test("a project whose plan sets no limit has no monitor room to count", async () => {
    const access: ToolImportAccess = await readAccess();

    expect(access.planRoomByKind?.has(ToolImportResourceKind.Monitor)).toBe(
      false,
    );
  });

  test("a tool that brings no monitors counts none", async () => {
    await readAccess([ToolImportResourceKind.Team]);

    expect(status).not.toHaveBeenCalled();
  });
});
