import ScheduledMaintenancePublicNoteService from "../../../Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import ScheduledMaintenancePublicNote from "../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import ObjectID from "../../../Types/ObjectID";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import { getJestSpyOn } from "../../Spy";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

const PROJECT_ID: ObjectID = new ObjectID(
  "2f000000-0000-4000-8000-000000000001",
);
const EVENT_ID: ObjectID = new ObjectID("2f000000-0000-4000-8000-000000000002");
const ONGOING_STATE_ID: ObjectID = new ObjectID(
  "2f000000-0000-4000-8000-000000000003",
);
const STARTS_AT: Date = new Date("2026-10-05T08:00:00.000Z");

type Hook = (input: unknown) => Promise<unknown>;

function hookOf(service: unknown, name: string): Hook {
  return (service as Record<string, Hook>)[name]!.bind(service);
}

interface OnBeforeCreateResult<TModel> {
  createBy: { data: TModel };
  carryForward: Record<string, unknown>;
}

let createNote: jest.SpyInstance;

beforeEach(() => {
  stubProjectDirectory({});
  getJestSpyOn(
    ProjectScopedReferenceValidator,
    "validateReferencesBelongToProject",
  ).mockResolvedValue(undefined);
  getJestSpyOn(Semaphore, "lock").mockResolvedValue(null);
  getJestSpyOn(Semaphore, "release").mockResolvedValue(undefined);
  // The event's first state change: nothing before or after it.
  getJestSpyOn(
    ScheduledMaintenanceStateTimelineService,
    "findOneBy",
  ).mockResolvedValue(null);
  createNote = getJestSpyOn(
    ScheduledMaintenancePublicNoteService,
    "create",
  ).mockImplementation(async (createBy: unknown) => {
    return (createBy as { data: ScheduledMaintenancePublicNote }).data;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function changeScheduledMaintenanceState(data: {
  notify: boolean | undefined;
  publicNote?: unknown;
}): Promise<OnBeforeCreateResult<ScheduledMaintenanceStateTimeline>> {
  const timeline: ScheduledMaintenanceStateTimeline =
    new ScheduledMaintenanceStateTimeline();
  timeline.projectId = PROJECT_ID;
  timeline.scheduledMaintenanceId = EVENT_ID;
  timeline.scheduledMaintenanceStateId = ONGOING_STATE_ID;
  timeline.startsAt = STARTS_AT;

  if (data.notify !== undefined) {
    timeline.shouldStatusPageSubscribersBeNotified = data.notify;
  }

  return (await hookOf(ScheduledMaintenanceStateTimelineService, "onBeforeCreate")(
    {
      data: timeline,
      miscDataProps:
        data.publicNote === undefined ? {} : { publicNote: data.publicNote },
      props: { isRoot: true, tenantId: PROJECT_ID },
    },
  )) as OnBeforeCreateResult<ScheduledMaintenanceStateTimeline>;
}

describe("a scheduled maintenance state change with a public note tells subscribers once", () => {
  test("with Notify on, the note is the message: the change itself is not queued", async () => {
    const result: OnBeforeCreateResult<ScheduledMaintenanceStateTimeline> =
      await changeScheduledMaintenanceState({
        notify: true,
        publicNote: "Maintenance has started.",
      });

    expect(createNote).toHaveBeenCalledTimes(1);
    const note: ScheduledMaintenancePublicNote = (
      createNote.mock.calls[0]![0] as { data: ScheduledMaintenancePublicNote }
    ).data;
    expect(note.note).toBe("Maintenance has started.");
    expect(note.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(true);

    expect(result.createBy.data.subscriberNotificationStatus).toBe(
      StatusPageSubscriberNotificationStatus.Success,
    );
  });

  test("without a note, the change itself is queued", async () => {
    const result: OnBeforeCreateResult<ScheduledMaintenanceStateTimeline> =
      await changeScheduledMaintenanceState({ notify: true });

    expect(createNote).not.toHaveBeenCalled();
    expect(result.createBy.data.subscriberNotificationStatus).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });

  test("a note with no text in it is no note: the change itself is queued", async () => {
    const result: OnBeforeCreateResult<ScheduledMaintenanceStateTimeline> =
      await changeScheduledMaintenanceState({
        notify: true,
        publicNote: "  \n\t ",
      });

    expect(createNote).not.toHaveBeenCalled();
    expect(result.createBy.data.subscriberNotificationStatus).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });

  test("with Notify off, neither the change nor the note tells anyone", async () => {
    const result: OnBeforeCreateResult<ScheduledMaintenanceStateTimeline> =
      await changeScheduledMaintenanceState({
        notify: false,
        publicNote: "Maintenance has started.",
      });

    expect(createNote).toHaveBeenCalledTimes(1);
    expect(
      (createNote.mock.calls[0]![0] as { data: ScheduledMaintenancePublicNote })
        .data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
    ).toBe(false);
    expect(result.createBy.data.subscriberNotificationStatus).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
  });
});
