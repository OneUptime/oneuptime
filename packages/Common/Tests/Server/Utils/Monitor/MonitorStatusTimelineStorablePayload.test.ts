import MonitorStatusTimelineUtil from "../../../../Server/Utils/Monitor/MonitorStatusTimeline";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import { JSONObject } from "../../../../Types/JSON";
import IncomingMonitorRequest from "../../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "../../../../Types/ObjectID";
import {
  assertJsonbAccepts,
  jsonbWouldRefuse,
} from "../../../Helpers/PostgresJsonbInput";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * When a criteria moves a monitor to a new status, the timeline row keeps a
 * copy of the payload that did it in MonitorStatusTimeline.statusChangeLog
 * (jsonb). A NUL anywhere in that payload made Postgres refuse the INSERT
 * ("unsupported Unicode escape sequence"), so the status change was lost -
 * on the check that most needed it, since a monitor turning red is often
 * one whose endpoint started returning garbage.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0b5fbbd0-8d1c-4a72-9a2b-4b8bd1cba0e9",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "1b7c5d3e-9a4f-4c2b-8e61-3d5a7f9b1c22",
);
const CURRENT_STATUS_ID: ObjectID = new ObjectID(
  "8ff02a3f-3f18-4c1d-9db1-6cf27bb2a4a1",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "b8a7d5d1-2f5a-45cf-8f2c-2f2b83d1d9aa",
);

function monitor(): Monitor {
  const item: Monitor = new Monitor();
  item._id = MONITOR_ID.toString();
  item.projectId = PROJECT_ID;
  item.currentMonitorStatusId = CURRENT_STATUS_ID;
  return item;
}

function criteriaSwitchingToOffline(): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.name = "Webhook reports an outage";
  instance.data!.monitorStatusId = OFFLINE_STATUS_ID;
  instance.data!.changeMonitorStatus = true;
  return instance;
}

// A webhook whose body carries a NUL in a key and in a value.
function webhook(): IncomingMonitorRequest {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    requestHeaders: { "x-signature": "sig\u0000nature" },
    requestBody: {
      status: "firing\u0000",
      ["labels\u0000"]: { host: "db-1" },
    },
    incomingRequestReceivedAt: new Date("2026-10-06T10:00:00.000Z"),
    checkedAt: new Date("2026-10-06T10:00:00.000Z"),
    onlyCheckForIncomingRequestReceivedAt: false,
  };
}

describe("MonitorStatusTimelineUtil stores a statusChangeLog Postgres can hold", () => {
  let created: Array<MonitorStatusTimeline> = [];

  beforeEach(() => {
    created = [];

    jest
      .spyOn(MonitorStatusTimelineService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
      .mockResolvedValue(true as never);

    jest
      .spyOn(MonitorStatusTimelineService, "create")
      .mockImplementation((async (
        createBy: unknown,
      ): Promise<MonitorStatusTimeline> => {
        const timeline: MonitorStatusTimeline = (
          createBy as { data: MonitorStatusTimeline }
        ).data;

        // Refuse what Postgres refuses.
        assertJsonbAccepts(timeline.statusChangeLog);
        created.push(timeline);
        return timeline;
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("the payload is what Postgres refused", () => {
    expect(jsonbWouldRefuse(JSON.parse(JSON.stringify(webhook())))).toBe(true);
  });

  it("changes the status, storing U+FFFD for each NUL", async () => {
    const result: MonitorStatusTimeline | null =
      await MonitorStatusTimelineUtil.updateMonitorStatusTimeline({
        criteriaInstance: criteriaSwitchingToOffline(),
        monitor: monitor(),
        dataToProcess: webhook(),
        rootCause: "criteria met",
        props: {},
      });

    expect(result).not.toBeNull();
    expect(created).toHaveLength(1);
    expect(created[0]!.monitorStatusId).toBe(OFFLINE_STATUS_ID);

    const statusChangeLog: JSONObject = created[0]!.statusChangeLog!;

    expect(statusChangeLog["requestBody"]).toEqual({
      status: "firing\uFFFD",
      ["labels\uFFFD"]: { host: "db-1" },
    });
    expect(statusChangeLog["requestHeaders"]).toEqual({
      "x-signature": "sig\uFFFDnature",
    });
    // Everything else is the JSON copy it always was.
    expect(statusChangeLog["incomingRequestReceivedAt"]).toBe(
      "2026-10-06T10:00:00.000Z",
    );
  });

  it("leaves the payload it was handed untouched", async () => {
    const payload: IncomingMonitorRequest = webhook();

    await MonitorStatusTimelineUtil.updateMonitorStatusTimeline({
      criteriaInstance: criteriaSwitchingToOffline(),
      monitor: monitor(),
      dataToProcess: payload,
      rootCause: "criteria met",
      props: {},
    });

    expect(payload).toEqual(webhook());
    expect(payload.incomingRequestReceivedAt).toBeInstanceOf(Date);
  });
});
