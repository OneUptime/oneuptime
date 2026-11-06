import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import ScheduledMaintenanceFeedService from "../../../Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenanceMeasurementValueService from "../../../Server/Services/ScheduledMaintenanceMeasurementValueService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import LinkedAffectedResources from "../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import WaitingRunsOnRecordChange from "../../../Server/Utils/OnCall/WaitingRunsOnRecordChange";
import StateChangeFollowOn from "../../../Server/Utils/StateChangeFollowOn";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * A STATE WRITTEN ALONE READS NOTHING MORE, FOR EVERY RECORD WHOSE STATE
 * CHANGES IN BULK (fu-bulk-actions).
 *
 * Change State on the incidents, alerts, both episode kinds and scheduled
 * maintenance lists moves each record by creating a row in its state
 * timeline, and the timeline writes the record's current state once the
 * row is saved (StateChangeFollowOn) - as OneUptime's own write, with no
 * project. #5309 made the alert's update hook read nothing more for that
 * write, and fu-bulk-actions the incident's (IncidentStateWriteReadsNothing
 * More). The episodes' and scheduled maintenance's hooks already read
 * nothing for it: this holds them to it, so a bulk Resolve of thousands of
 * episodes or events never reads each one again for a follow-on it does not
 * run - and holds that what does follow from an update still does.
 *
 * onUpdateSuccess runs for real; every read of the record and every
 * follow-on is watched.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-cccc-4ccc-8ccc-000000000001",
);
const RECORD_ID: string = "0193c0de-cccc-4ccc-8ccc-0000000000a1";
const OTHER_RECORD_ID: string = "0193c0de-cccc-4ccc-8ccc-0000000000a2";
const STATE_ID: string = "0193c0de-cccc-4ccc-8ccc-0000000000b1";
const USER_ID: ObjectID = new ObjectID("0193c0de-cccc-4ccc-8ccc-0000000000ab");

type OnUpdateSuccess = (
  onUpdate: OnUpdate<BaseModel>,
  updatedItemIds: Array<ObjectID>,
) => Promise<OnUpdate<BaseModel>>;

// The props a state change's own write carries: who changed it, no project.
const STATE_WRITE_PROPS: DatabaseCommonInteractionProps =
  StateChangeFollowOn.getEventWriteProps({
    userId: USER_ID,
    tenantId: PROJECT_ID,
  });

function runUpdateSuccess(data: {
  service: unknown;
  payload: JSONObject;
  props?: DatabaseCommonInteractionProps;
  carryForward?: unknown;
  ids?: Array<string>;
}): Promise<OnUpdate<BaseModel>> {
  return (data.service as { onUpdateSuccess: OnUpdateSuccess }).onUpdateSuccess(
    {
      updateBy: {
        query: { _id: RECORD_ID },
        data: data.payload,
        props: data.props || STATE_WRITE_PROPS,
        limit: 1,
        skip: 0,
      } as unknown as UpdateBy<BaseModel>,
      carryForward: data.carryForward ?? null,
    },
    (data.ids || [RECORD_ID]).map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
  );
}

// Every read a service could make of its own records.
function spyOnReads(service: unknown): Array<ReturnType<typeof jest.spyOn>> {
  const target: Record<string, unknown> = service as Record<string, unknown>;

  return ["findOneById", "findOneBy", "findBy", "countBy"].map(
    (method: string): ReturnType<typeof jest.spyOn> => {
      return jest
        .spyOn(target as never, method as never)
        .mockImplementation((() => {
          throw new Error(`${method} was not expected after a state write.`);
        }) as never);
    },
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each([
  [
    "an alert episode",
    {
      service: AlertEpisodeService as unknown,
      statePayload: {
        currentAlertStateId: STATE_ID,
        resolvedAt: new Date("2026-11-03T10:00:00.000Z"),
      } as JSONObject,
      startWaitingRuns: "startForAlertEpisode",
      ruleInput: { labels: [] } as JSONObject,
    },
  ],
  [
    "an incident episode",
    {
      service: IncidentEpisodeService as unknown,
      statePayload: {
        currentIncidentStateId: STATE_ID,
        resolvedAt: null,
      } as JSONObject,
      startWaitingRuns: "startForIncidentEpisode",
      ruleInput: { title: "Checkout down in eu-west" } as JSONObject,
    },
  ],
])(
  "%s's update hook after a state change",
  (
    _name: string,
    episodeCase: {
      service: unknown;
      statePayload: JSONObject;
      startWaitingRuns: string;
      ruleInput: JSONObject;
    },
  ) => {
    let reads: Array<ReturnType<typeof jest.spyOn>> = [];
    let changeState: ReturnType<typeof jest.spyOn>;
    let startWaitingRuns: ReturnType<typeof jest.spyOn>;

    beforeEach(() => {
      reads = spyOnReads(episodeCase.service);

      changeState = jest
        .spyOn(
          episodeCase.service as { changeEpisodeState: () => Promise<void> },
          "changeEpisodeState",
        )
        .mockResolvedValue(undefined as never);

      startWaitingRuns = jest
        .spyOn(
          WaitingRunsOnRecordChange as unknown as Record<
            string,
            () => Promise<number>
          >,
          episodeCase.startWaitingRuns,
        )
        .mockResolvedValue(0 as never);
    });

    test("the state written by its timeline reads the episode no more, and runs nothing more", async () => {
      await runUpdateSuccess({
        service: episodeCase.service,
        payload: episodeCase.statePayload,
        ids: [RECORD_ID, OTHER_RECORD_ID],
      });

      for (const read of reads) {
        expect(read).not.toHaveBeenCalled();
      }
      // OneUptime's own write carries no project: not a state change again.
      expect(changeState).not.toHaveBeenCalled();
      expect(startWaitingRuns).not.toHaveBeenCalled();
    });

    test("a state written to it in a project is recorded as a state change, once an episode", async () => {
      await runUpdateSuccess({
        service: episodeCase.service,
        payload: episodeCase.statePayload,
        props: { tenantId: PROJECT_ID, userId: USER_ID },
        ids: [RECORD_ID, OTHER_RECORD_ID],
      });

      expect(changeState).toHaveBeenCalledTimes(2);
      for (const read of reads) {
        expect(read).not.toHaveBeenCalled();
      }
    });

    test("what its on-call rules read, written, still starts the waiting runs", async () => {
      await runUpdateSuccess({
        service: episodeCase.service,
        payload: episodeCase.ruleInput,
        props: { tenantId: PROJECT_ID, userId: USER_ID },
      });

      expect(startWaitingRuns).toHaveBeenCalledTimes(1);
    });
  },
);

describe("a scheduled maintenance event's update hook after a state change", () => {
  let reads: Array<ReturnType<typeof jest.spyOn>> = [];
  let changeState: ReturnType<typeof jest.spyOn>;
  let createFeedItem: ReturnType<typeof jest.spyOn>;
  let refreshReminders: ReturnType<typeof jest.spyOn>;
  let recompute: ReturnType<typeof jest.spyOn>;
  let readAffected: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    reads = spyOnReads(ScheduledMaintenanceService);

    jest
      .spyOn(CustomFieldMappingService, "restampAfterMultiRowUpdate")
      .mockReturnValue(undefined as never);

    changeState = jest
      .spyOn(ScheduledMaintenanceService, "changeScheduledMaintenanceState")
      .mockResolvedValue(undefined as never);

    createFeedItem = jest
      .spyOn(
        ScheduledMaintenanceFeedService,
        "createScheduledMaintenanceFeedItem",
      )
      .mockResolvedValue(undefined as never);

    refreshReminders = jest
      .spyOn(ScheduledMaintenanceService, "refreshReminderSchedule")
      .mockResolvedValue(undefined as never);

    recompute = jest
      .spyOn(
        ScheduledMaintenanceMeasurementValueService,
        "recomputeForScheduledMaintenance",
      )
      .mockResolvedValue(undefined as never);

    readAffected = jest
      .spyOn(LinkedAffectedResources, "readForScheduledMaintenance")
      .mockResolvedValue([] as never);
  });

  test("the state written by its timeline reads the event no more, and runs nothing more", async () => {
    await runUpdateSuccess({
      service: ScheduledMaintenanceService,
      payload: { currentScheduledMaintenanceStateId: STATE_ID },
      ids: [RECORD_ID, OTHER_RECORD_ID],
    });

    for (const read of reads) {
      expect(read).not.toHaveBeenCalled();
    }
    expect(changeState).not.toHaveBeenCalled();
    expect(createFeedItem).not.toHaveBeenCalled();
    expect(refreshReminders).not.toHaveBeenCalled();
    expect(recompute).not.toHaveBeenCalled();
    expect(readAffected).not.toHaveBeenCalled();
  });

  test("a state written to it in a project is recorded as a state change, once an event", async () => {
    await runUpdateSuccess({
      service: ScheduledMaintenanceService,
      payload: { currentScheduledMaintenanceStateId: STATE_ID },
      props: { tenantId: PROJECT_ID, userId: USER_ID },
      ids: [RECORD_ID, OTHER_RECORD_ID],
    });

    expect(changeState).toHaveBeenCalledTimes(2);
    expect(createFeedItem).not.toHaveBeenCalled();
    for (const read of reads) {
      expect(read).not.toHaveBeenCalled();
    }
  });

  test("a title that really changed is still recorded in its feed", async () => {
    await runUpdateSuccess({
      service: ScheduledMaintenanceService,
      payload: { title: "Database upgrade, second window" },
      props: { tenantId: PROJECT_ID, userId: USER_ID },
      carryForward: {
        valuesBeforeUpdate: {
          [RECORD_ID]: { title: "Database upgrade" },
        },
      },
    });

    expect(createFeedItem).toHaveBeenCalledTimes(1);
    expect(
      (createFeedItem.mock.calls[0]![0] as { feedInfoInMarkdown: string })
        .feedInfoInMarkdown,
    ).toContain("Database upgrade, second window");
  });

  test("a start that really moved still recomputes the event's measurements", async () => {
    await runUpdateSuccess({
      service: ScheduledMaintenanceService,
      payload: { startsAt: new Date("2026-11-04T02:00:00.000Z") },
      props: { tenantId: PROJECT_ID, userId: USER_ID },
    });

    expect(recompute).toHaveBeenCalledTimes(1);
  });
});
