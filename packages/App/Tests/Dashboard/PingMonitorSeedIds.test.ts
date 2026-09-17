import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";

/*
 * PingMonitorSeedIds resolves the four project-scoped ids a Ping monitor's
 * default criteria are seeded from, for the discovery import's "create a Ping
 * monitor" option (OneUptime/oneuptime#3447).
 *
 * ModelAPI transitively loads Common/UI/Config, which reads `window` at import
 * time and throws in this node environment, so the module is mocked — the same
 * seam DeviceMonitorLookupUtil.test.ts uses, and the one that lets these
 * queries be asserted directly.
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PingMonitorSeedIds, {
  PingMonitorSeedIdsUnavailableError,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/PingMonitorSeedIds";

const getListMock: jest.Mock = ModelAPI.getList as unknown as jest.Mock;

const ONLINE_ID: string = "aaaa1111-0000-4000-8000-000000000001";
const OFFLINE_ID: string = "aaaa1111-0000-4000-8000-000000000002";
const INCIDENT_SEVERITY_ID: string = "bbbb2222-0000-4000-8000-000000000001";
const ALERT_SEVERITY_ID: string = "cccc3333-0000-4000-8000-000000000001";

function row(id: string, extra: Record<string, unknown> = {}): unknown {
  return { _id: id, id: new ObjectID(id), ...extra };
}

function listOf(data: Array<unknown>): unknown {
  return { data, count: data.length, skip: 0, limit: 100 };
}

/**
 * Queue the three list responses in the order PingMonitorSeedIds issues them:
 * monitor statuses, incident severities, alert severities.
 */
function mockProject(data: {
  statuses?: Array<unknown>;
  incidentSeverities?: Array<unknown>;
  alertSeverities?: Array<unknown>;
}): void {
  getListMock
    .mockResolvedValueOnce(
      listOf(
        data.statuses ?? [
          row(ONLINE_ID, { isOperationalState: true }),
          row(OFFLINE_ID, { isOfflineState: true }),
        ],
      ),
    )
    .mockResolvedValueOnce(
      listOf(data.incidentSeverities ?? [row(INCIDENT_SEVERITY_ID)]),
    )
    .mockResolvedValueOnce(
      listOf(data.alertSeverities ?? [row(ALERT_SEVERITY_ID)]),
    );
}

describe("PingMonitorSeedIds.resolve", () => {
  beforeEach(() => {
    getListMock.mockReset();
  });

  test("returns the project's operational and offline statuses and its first severities", async () => {
    mockProject({});

    const seedIds: {
      onlineMonitorStatusId: ObjectID;
      offlineMonitorStatusId: ObjectID;
      defaultIncidentSeverityId: ObjectID;
      defaultAlertSeverityId: ObjectID;
    } = await PingMonitorSeedIds.resolve();

    expect(seedIds.onlineMonitorStatusId.toString()).toBe(ONLINE_ID);
    expect(seedIds.offlineMonitorStatusId.toString()).toBe(OFFLINE_ID);
    expect(seedIds.defaultIncidentSeverityId.toString()).toBe(
      INCIDENT_SEVERITY_ID,
    );
    expect(seedIds.defaultAlertSeverityId.toString()).toBe(ALERT_SEVERITY_ID);
  });

  test("sorts monitor statuses by priority, matching what the server does on create", async () => {
    mockProject({});

    await PingMonitorSeedIds.resolve();

    const statusCall: { sort?: { priority?: SortOrder } } = getListMock.mock
      .calls[0]![0] as { sort?: { priority?: SortOrder } };

    /*
     * A project can hold MORE than one operational status. Without an explicit
     * sort the read falls back to createdAt DESC and picks whichever was
     * created most recently — which is how monitors silently latched onto a
     * fixture's "TF Operational" and then blocked its deletion through the
     * currentMonitorStatusId foreign key. MonitorService.onBeforeCreate sorts
     * priority ASC; seeding the criteria from a DIFFERENT status than the one
     * the server stamps would be the same bug wearing a new hat.
     */
    expect(statusCall.sort?.priority).toBe(SortOrder.Ascending);
  });

  test("picks the operational status even when it is not first in the list", async () => {
    mockProject({
      statuses: [
        row("dddd4444-0000-4000-8000-000000000009", {}),
        row(OFFLINE_ID, { isOfflineState: true }),
        row(ONLINE_ID, { isOperationalState: true }),
      ],
    });

    const seedIds: { onlineMonitorStatusId: ObjectID } =
      await PingMonitorSeedIds.resolve();

    expect(seedIds.onlineMonitorStatusId.toString()).toBe(ONLINE_ID);
  });

  test("issues exactly three list queries", async () => {
    mockProject({});

    await PingMonitorSeedIds.resolve();

    /*
     * Resolved once per import run, so the cost is fixed rather than per host.
     */
    expect(getListMock).toHaveBeenCalledTimes(3);
  });

  test("a project with no operational status is refused with an actionable message", async () => {
    mockProject({ statuses: [row(OFFLINE_ID, { isOfflineState: true })] });

    await expect(PingMonitorSeedIds.resolve()).rejects.toBeInstanceOf(
      PingMonitorSeedIdsUnavailableError,
    );
  });

  test("a project with no offline status is refused too", async () => {
    mockProject({ statuses: [row(ONLINE_ID, { isOperationalState: true })] });

    await expect(PingMonitorSeedIds.resolve()).rejects.toBeInstanceOf(
      PingMonitorSeedIdsUnavailableError,
    );
  });

  test("a project with no incident severity is refused", async () => {
    mockProject({ incidentSeverities: [] });

    await expect(PingMonitorSeedIds.resolve()).rejects.toBeInstanceOf(
      PingMonitorSeedIdsUnavailableError,
    );
  });

  test("a project with no alert severity is refused", async () => {
    mockProject({ alertSeverities: [] });

    await expect(PingMonitorSeedIds.resolve()).rejects.toBeInstanceOf(
      PingMonitorSeedIdsUnavailableError,
    );
  });

  test("the refusal names the fix rather than just failing", async () => {
    mockProject({ incidentSeverities: [] });

    await expect(PingMonitorSeedIds.resolve()).rejects.toThrow(
      /incident severity/i,
    );
  });
});
