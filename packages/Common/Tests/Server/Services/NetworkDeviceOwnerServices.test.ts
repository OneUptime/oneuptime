import { afterEach, describe, expect, test } from "@jest/globals";
import NetworkDeviceOwnerUserService, {
  NetworkDeviceOwners,
} from "../../../Server/Services/NetworkDeviceOwnerUserService";
import NetworkDeviceOwnerTeamService from "../../../Server/Services/NetworkDeviceOwnerTeamService";
import NetworkDeviceOwnerUser from "../../../Models/DatabaseModels/NetworkDeviceOwnerUser";
import NetworkDeviceOwnerTeam from "../../../Models/DatabaseModels/NetworkDeviceOwnerTeam";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../Types/ObjectID";

/*
 * getDeviceOwnersForMonitor fans a NetworkDevice's owner users/teams into
 * monitor-created incidents/alerts and the owner-added notification job. The
 * device id lives buried in monitor step config, so these tests pin the step
 * selection rules (prefer the step that produced the probe response, fall
 * back to the first device-referencing step), the no-device fast path that
 * must not touch the database, and the shape/filtering of the returned id
 * arrays. Database access is mocked at the findBy level.
 */

const DEVICE_A: string = "8f2c1f0e-0000-4000-8000-0000000000aa";
const DEVICE_B: string = "8f2c1f0e-0000-4000-8000-0000000000bb";

function buildStep(networkDeviceId?: string): MonitorStep {
  const step: MonitorStep = new MonitorStep();

  if (networkDeviceId) {
    step.data = {
      ...step.data,
      networkDeviceMonitor: {
        networkDeviceId: networkDeviceId,
      },
    } as MonitorStep["data"];
  }

  return step;
}

function buildMonitor(steps: Array<MonitorStep>): Monitor {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: steps,
    defaultMonitorStatusId: undefined,
  };

  const monitor: Monitor = new Monitor();
  monitor.monitorSteps = monitorSteps;

  return monitor;
}

function ownerUserRow(userId?: ObjectID): NetworkDeviceOwnerUser {
  const row: NetworkDeviceOwnerUser = new NetworkDeviceOwnerUser();
  if (userId) {
    row.userId = userId;
  }
  return row;
}

function ownerTeamRow(teamId?: ObjectID): NetworkDeviceOwnerTeam {
  const row: NetworkDeviceOwnerTeam = new NetworkDeviceOwnerTeam();
  if (teamId) {
    row.teamId = teamId;
  }
  return row;
}

function mockOwnerRows(options?: {
  users?: Array<NetworkDeviceOwnerUser> | undefined;
  teams?: Array<NetworkDeviceOwnerTeam> | undefined;
}): {
  userFindBy: jest.SpyInstance;
  teamFindBy: jest.SpyInstance;
} {
  const userFindBy: jest.SpyInstance = jest
    .spyOn(NetworkDeviceOwnerUserService, "findBy")
    .mockResolvedValue(options?.users || []);
  const teamFindBy: jest.SpyInstance = jest
    .spyOn(NetworkDeviceOwnerTeamService, "findBy")
    .mockResolvedValue(options?.teams || []);

  return { userFindBy: userFindBy, teamFindBy: teamFindBy };
}

function queriedDeviceId(spy: jest.SpyInstance): string | undefined {
  return spy.mock.calls[0]?.[0]?.query?.networkDeviceId?.toString();
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("NetworkDeviceOwnerUserService.getDeviceOwnersForMonitor — no-device fast path", () => {
  test("a monitor with no steps returns empty owners without touching the database", async () => {
    const { userFindBy, teamFindBy } = mockOwnerRows();

    const owners: NetworkDeviceOwners =
      await NetworkDeviceOwnerUserService.getDeviceOwnersForMonitor({
        monitor: buildMonitor([]),
      });

    expect(owners).toEqual({ ownerUserIds: [], ownerTeamIds: [] });
    expect(userFindBy).not.toHaveBeenCalled();
    expect(teamFindBy).not.toHaveBeenCalled();
  });

  test("a monitor with no monitorSteps object at all behaves the same", async () => {
    const { userFindBy, teamFindBy } = mockOwnerRows();

    const owners: NetworkDeviceOwners =
      await NetworkDeviceOwnerUserService.getDeviceOwnersForMonitor({
        monitor: new Monitor(),
      });

    expect(owners).toEqual({ ownerUserIds: [], ownerTeamIds: [] });
    expect(userFindBy).not.toHaveBeenCalled();
    expect(teamFindBy).not.toHaveBeenCalled();
  });

  test("steps that reference no device return empty owners without queries", async () => {
    const { userFindBy, teamFindBy } = mockOwnerRows();

    const owners: NetworkDeviceOwners =
      await NetworkDeviceOwnerUserService.getDeviceOwnersForMonitor({
        monitor: buildMonitor([buildStep(), buildStep()]),
      });

    expect(owners).toEqual({ ownerUserIds: [], ownerTeamIds: [] });
    expect(userFindBy).not.toHaveBeenCalled();
    expect(teamFindBy).not.toHaveBeenCalled();
  });
});

describe("NetworkDeviceOwnerUserService.getDeviceOwnersForMonitor — step selection", () => {
  test("the step that produced the probe response is preferred", async () => {
    const stepA: MonitorStep = buildStep(DEVICE_A);
    const stepB: MonitorStep = buildStep(DEVICE_B);
    const { userFindBy, teamFindBy } = mockOwnerRows();

    await NetworkDeviceOwnerUserService.getDeviceOwnersForMonitor({
      monitor: buildMonitor([stepA, stepB]),
      monitorStepId: stepB.id.toString(),
    });

    expect(queriedDeviceId(userFindBy)).toBe(DEVICE_B);
    expect(queriedDeviceId(teamFindBy)).toBe(DEVICE_B);
  });

  test("a monitorStepId matching no step falls back to the first device-referencing step", async () => {
    const stepA: MonitorStep = buildStep(DEVICE_A);
    const stepB: MonitorStep = buildStep(DEVICE_B);
    const { userFindBy } = mockOwnerRows();

    await NetworkDeviceOwnerUserService.getDeviceOwnersForMonitor({
      monitor: buildMonitor([stepA, stepB]),
      monitorStepId: ObjectID.generate().toString(),
    });

    expect(queriedDeviceId(userFindBy)).toBe(DEVICE_A);
  });

  test("a matching step without device config falls back to the device-referencing step", async () => {
    const stepWithoutDevice: MonitorStep = buildStep();
    const stepWithDevice: MonitorStep = buildStep(DEVICE_B);
    const { userFindBy } = mockOwnerRows();

    await NetworkDeviceOwnerUserService.getDeviceOwnersForMonitor({
      monitor: buildMonitor([stepWithoutDevice, stepWithDevice]),
      monitorStepId: stepWithoutDevice.id.toString(),
    });

    expect(queriedDeviceId(userFindBy)).toBe(DEVICE_B);
  });

  test("callers without a step id pick up owners from the first device-referencing step", async () => {
    const stepWithoutDevice: MonitorStep = buildStep();
    const stepWithDevice: MonitorStep = buildStep(DEVICE_A);
    const { userFindBy } = mockOwnerRows();

    await NetworkDeviceOwnerUserService.getDeviceOwnersForMonitor({
      monitor: buildMonitor([stepWithoutDevice, stepWithDevice]),
    });

    expect(queriedDeviceId(userFindBy)).toBe(DEVICE_A);
  });
});

describe("NetworkDeviceOwnerUserService.getDeviceOwnersForMonitor — returned owners", () => {
  test("owner user and team ids come back from the mocked rows", async () => {
    const userId1: ObjectID = ObjectID.generate();
    const userId2: ObjectID = ObjectID.generate();
    const teamId: ObjectID = ObjectID.generate();

    mockOwnerRows({
      users: [ownerUserRow(userId1), ownerUserRow(userId2)],
      teams: [ownerTeamRow(teamId)],
    });

    const owners: NetworkDeviceOwners =
      await NetworkDeviceOwnerUserService.getDeviceOwnersForMonitor({
        monitor: buildMonitor([buildStep(DEVICE_A)]),
      });

    expect(owners.ownerUserIds.map(String)).toEqual([
      userId1.toString(),
      userId2.toString(),
    ]);
    expect(owners.ownerTeamIds.map(String)).toEqual([teamId.toString()]);
  });

  test("rows missing their user/team id are filtered out of the result", async () => {
    const userId: ObjectID = ObjectID.generate();
    const teamId: ObjectID = ObjectID.generate();

    mockOwnerRows({
      users: [ownerUserRow(), ownerUserRow(userId)],
      teams: [ownerTeamRow(teamId), ownerTeamRow()],
    });

    const owners: NetworkDeviceOwners =
      await NetworkDeviceOwnerUserService.getDeviceOwnersForMonitor({
        monitor: buildMonitor([buildStep(DEVICE_A)]),
      });

    expect(owners.ownerUserIds.map(String)).toEqual([userId.toString()]);
    expect(owners.ownerTeamIds.map(String)).toEqual([teamId.toString()]);
  });

  test("a device with no owners at all yields empty arrays (not undefined)", async () => {
    const { userFindBy, teamFindBy } = mockOwnerRows();

    const owners: NetworkDeviceOwners =
      await NetworkDeviceOwnerUserService.getDeviceOwnersForMonitor({
        monitor: buildMonitor([buildStep(DEVICE_A)]),
        monitorStepId: undefined,
      });

    expect(owners.ownerUserIds).toEqual([]);
    expect(owners.ownerTeamIds).toEqual([]);
    // The device IS referenced, so both ownership tables are consulted once.
    expect(userFindBy).toHaveBeenCalledTimes(1);
    expect(teamFindBy).toHaveBeenCalledTimes(1);
  });

  test("both queries are scoped to the referenced device id", async () => {
    const { userFindBy, teamFindBy } = mockOwnerRows();

    await NetworkDeviceOwnerUserService.getDeviceOwnersForMonitor({
      monitor: buildMonitor([buildStep(DEVICE_A)]),
    });

    expect(queriedDeviceId(userFindBy)).toBe(DEVICE_A);
    expect(queriedDeviceId(teamFindBy)).toBe(DEVICE_A);
    expect(
      userFindBy.mock.calls[0]?.[0]?.query?.networkDeviceId,
    ).toBeInstanceOf(ObjectID);
  });
});
