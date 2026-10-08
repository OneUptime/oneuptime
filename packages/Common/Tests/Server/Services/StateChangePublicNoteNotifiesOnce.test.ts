import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import IncidentAlertService from "../../../Server/Services/IncidentAlertService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentMeasurementValueService from "../../../Server/Services/IncidentMeasurementValueService";
import IncidentPublicNoteService from "../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import ScheduledMaintenanceFeedService from "../../../Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenanceMeasurementValueService from "../../../Server/Services/ScheduledMaintenanceMeasurementValueService";
import ScheduledMaintenancePublicNoteService from "../../../Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import ScheduledMaintenancePublicNote from "../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import StateChangeSubscriberNotification from "../../../Types/StatusPage/StateChangeSubscriberNotification";
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
import { mockProjectStates } from "../TestingUtils/Services/ProjectStatesHelper";

jest.mock("../../../Server/Utils/Logger");

/*
 * ONE STATE CHANGE, ONE MESSAGE TO STATUS PAGE SUBSCRIBERS.
 *
 * Moving an incident or a scheduled maintenance event to another state can
 * post a public note with it ("Add a public note" in the state change
 * dialog, the Change State bulk action, or `miscDataProps.publicNote` over
 * the API). With "Notify Status Page Subscribers" on, the note notifies
 * subscribers, so the change itself must not: the note is the one message
 * they get. A scheduled maintenance state change marked itself as sent by
 * the note and then, a few lines further down, queued itself anyway, so
 * subscribers got the state change message and the note (found in #4384).
 *
 * Both timelines post the note once the change is saved, never before it
 * (the scheduled maintenance one did until #4442's finding): onBeforeCreate
 * decides the change's notification and carries the note forward, and
 * onCreateSuccess posts it.
 *
 * These tests drive the real state timeline hooks, and the real public note
 * hooks for the note they post, and count what the two subscriber jobs would
 * send: the state change job sends a change that is Pending and notifies,
 * the public note job a note that is Pending and notifies (the queries in
 * App/FeatureSet/Workers/Jobs/*StateTimeline and *PublicNote, driven for
 * scheduled maintenance by StateChangeWithPublicNoteNotifiesOnce in App).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "2f000000-0000-4000-8000-000000000001",
);
const EVENT_ID: ObjectID = new ObjectID("2f000000-0000-4000-8000-000000000002");
const ONGOING_STATE_ID: ObjectID = new ObjectID(
  "2f000000-0000-4000-8000-000000000003",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "2f000000-0000-4000-8000-000000000004",
);
const ACKNOWLEDGED_STATE_ID: ObjectID = new ObjectID(
  "2f000000-0000-4000-8000-000000000005",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "2f000000-0000-4000-8000-000000000006",
);
const STARTS_AT: Date = new Date("2026-10-05T08:00:00.000Z");

const SCHEDULED_MAINTENANCE_SKIPPED_MESSAGE: string =
  "Notifications skipped as subscribers are not to be notified for this scheduled maintenance state change.";
const INCIDENT_SKIPPED_MESSAGE: string =
  "Notifications skipped as subscribers are not to be notified for this incident state change.";

type Hook = (input: unknown, second?: unknown) => Promise<unknown>;

function hookOf(service: unknown, name: string): Hook {
  return (service as Record<string, Hook>)[name]!.bind(service);
}

interface OnBeforeCreateResult<TModel> {
  createBy: { data: TModel; props: Record<string, unknown> };
  carryForward: Record<string, unknown>;
}

interface NotifyingRow {
  shouldNotify: boolean | undefined;
  status: StatusPageSubscriberNotificationStatus | undefined;
}

/*
 * Whether one of the two subscriber jobs would send this row. A column the
 * create left unset takes its database default: notify, Pending.
 */
function isQueued(row: NotifyingRow): boolean {
  return (
    (row.shouldNotify ?? true) === true &&
    (row.status ?? StatusPageSubscriberNotificationStatus.Pending) ===
      StatusPageSubscriberNotificationStatus.Pending
  );
}

beforeEach(() => {
  /*
   * The project's incident and alert states: open records are read by
   * the states that are not resolved (Common/Utils/ResolvedState).
   */
  mockProjectStates();
  stubProjectDirectory({});
  getJestSpyOn(
    ProjectScopedReferenceValidator,
    "validateReferencesBelongToProject",
  ).mockResolvedValue(undefined);
  getJestSpyOn(Semaphore, "lock").mockResolvedValue(null);
  getJestSpyOn(Semaphore, "release").mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a scheduled maintenance state change with a public note tells subscribers once", () => {
  // Each note the change posted, as the real note hook left it.
  let postedNotes: Array<{
    note: ScheduledMaintenancePublicNote;
    props: Record<string, unknown>;
  }>;
  let createNote: jest.SpyInstance;

  beforeEach(() => {
    postedNotes = [];

    // The event's first state change: nothing before or after it.
    getJestSpyOn(
      ScheduledMaintenanceStateTimelineService,
      "findOneBy",
    ).mockResolvedValue(null);

    createNote = getJestSpyOn(
      ScheduledMaintenancePublicNoteService,
      "create",
    ).mockImplementation(async (input: unknown) => {
      const createBy: {
        data: ScheduledMaintenancePublicNote;
        props: Record<string, unknown>;
      } = input as {
        data: ScheduledMaintenancePublicNote;
        props: Record<string, unknown>;
      };

      const result: OnBeforeCreateResult<ScheduledMaintenancePublicNote> =
        (await hookOf(
          ScheduledMaintenancePublicNoteService,
          "onBeforeCreate",
        )(createBy)) as OnBeforeCreateResult<ScheduledMaintenancePublicNote>;

      postedNotes.push({ note: result.createBy.data, props: createBy.props });

      return result.createBy.data;
    });
  });

  async function changeState(data: {
    notify: boolean | undefined;
    publicNote?: unknown;
    props?: Record<string, unknown>;
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

    const miscDataProps: JSONObject =
      data.publicNote === undefined
        ? {}
        : ({ publicNote: data.publicNote } as JSONObject);

    return (await hookOf(
      ScheduledMaintenanceStateTimelineService,
      "onBeforeCreate",
    )({
      data: timeline,
      miscDataProps: miscDataProps,
      props: data.props || { isRoot: true, tenantId: PROJECT_ID },
    })) as OnBeforeCreateResult<ScheduledMaintenanceStateTimeline>;
  }

  // The note a change carries forward, to post once it is saved.
  function carriedNote(
    result: OnBeforeCreateResult<ScheduledMaintenanceStateTimeline>,
  ): ScheduledMaintenancePublicNote | undefined {
    return result.carryForward["publicNoteToPost"] as
      | ScheduledMaintenancePublicNote
      | undefined;
  }

  test("with Notify on, the change is recorded as sent by the note it carries forward, and nothing is posted before it is saved", async () => {
    const result: OnBeforeCreateResult<ScheduledMaintenanceStateTimeline> =
      await changeState({
        notify: true,
        publicNote: "Maintenance has started.",
      });

    // The regression of #4384: this was set to Success and then back to Pending.
    expect(result.createBy.data.subscriberNotificationStatus).toBe(
      StatusPageSubscriberNotificationStatus.Success,
    );
    expect(result.createBy.data.subscriberNotificationStatusMessage).toBe(
      StateChangeSubscriberNotification.sentByPublicNoteMessage,
    );

    // The note waits for the change to be saved (#4442).
    expect(createNote).not.toHaveBeenCalled();
    expect(postedNotes).toHaveLength(0);

    const note: ScheduledMaintenancePublicNote = carriedNote(result)!;
    expect(note).toBeInstanceOf(ScheduledMaintenancePublicNote);
    expect(note.note).toBe("Maintenance has started.");
    expect(note.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(true);

    // The text goes forward too, as it always has.
    expect(result.carryForward["publicNote"]).toBe("Maintenance has started.");
  });

  test("the note it carries is the event's, at the change's time, in its project", async () => {
    const note: ScheduledMaintenancePublicNote = carriedNote(
      await changeState({
        notify: true,
        publicNote: "Maintenance has started.",
      }),
    )!;

    expect(note.scheduledMaintenanceId?.toString()).toBe(EVENT_ID.toString());
    expect(note.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(note.postedAt).toEqual(STARTS_AT);
    expect(note.createdAt).toEqual(STARTS_AT);
  });

  test("without a note, the change is queued and carries none", async () => {
    const result: OnBeforeCreateResult<ScheduledMaintenanceStateTimeline> =
      await changeState({ notify: true });

    expect(result.createBy.data.subscriberNotificationStatus).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(
      result.createBy.data.subscriberNotificationStatusMessage,
    ).toBeUndefined();
    expect(carriedNote(result)).toBeUndefined();
    expect(result.carryForward["publicNote"]).toBeUndefined();
  });

  test.each([
    ["an empty note", ""],
    ["spaces", "   "],
    ["line breaks and tabs", "\n\t \n"],
  ])(
    "a note with no text in it (%s) is no note: nothing is carried forward, and the change is queued",
    async (_name: string, publicNote: string) => {
      const result: OnBeforeCreateResult<ScheduledMaintenanceStateTimeline> =
        await changeState({ notify: true, publicNote: publicNote });

      expect(result.createBy.data.subscriberNotificationStatus).toBe(
        StatusPageSubscriberNotificationStatus.Pending,
      );
      expect(carriedNote(result)).toBeUndefined();
      expect(result.carryForward["publicNote"]).toBeUndefined();
    },
  );

  test("a note that is not text is no note", async () => {
    const result: OnBeforeCreateResult<ScheduledMaintenanceStateTimeline> =
      await changeState({ notify: true, publicNote: 42 });

    expect(carriedNote(result)).toBeUndefined();
    expect(result.createBy.data.subscriberNotificationStatus).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });

  test("with Notify off, the change is skipped and its note still goes forward, quietly", async () => {
    const result: OnBeforeCreateResult<ScheduledMaintenanceStateTimeline> =
      await changeState({
        notify: false,
        publicNote: "Maintenance has started.",
      });

    expect(result.createBy.data.subscriberNotificationStatus).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
    expect(result.createBy.data.subscriberNotificationStatusMessage).toBe(
      SCHEDULED_MAINTENANCE_SKIPPED_MESSAGE,
    );
    expect(
      carriedNote(result)!.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
    ).toBe(false);
  });

  test("with Notify off and no note, the change is skipped", async () => {
    const result: OnBeforeCreateResult<ScheduledMaintenanceStateTimeline> =
      await changeState({ notify: false });

    expect(result.createBy.data.subscriberNotificationStatus).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
    expect(result.createBy.data.subscriberNotificationStatusMessage).toBe(
      SCHEDULED_MAINTENANCE_SKIPPED_MESSAGE,
    );
    expect(carriedNote(result)).toBeUndefined();
  });

  test("a change that does not say keeps its column defaults, and the note it carries stays quiet", async () => {
    const result: OnBeforeCreateResult<ScheduledMaintenanceStateTimeline> =
      await changeState({
        notify: undefined,
        publicNote: "Maintenance has started.",
      });

    expect(
      result.createBy.data.shouldStatusPageSubscribersBeNotified,
    ).toBeUndefined();
    expect(result.createBy.data.subscriberNotificationStatus).toBeUndefined();
    expect(
      carriedNote(result)!.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
    ).toBe(false);
  });

  describe("once the change is saved, the note it carried is posted", () => {
    const ONGOING: string = ONGOING_STATE_ID.toString();

    beforeEach(() => {
      /*
       * The state the event moved to, read by id - and asked again with a
       * flag ({ isOngoingState: true }) to tell which kind it is.
       */
      getJestSpyOn(
        ScheduledMaintenanceStateService,
        "findOneBy",
      ).mockImplementation(
        async (findOneBy: unknown): Promise<ScheduledMaintenanceState | null> => {
          const query: Record<string, unknown> = (
            findOneBy as { query: Record<string, unknown> }
          ).query;

          if (String(query["_id"]) !== ONGOING) {
            return null;
          }

          if (query["isResolvedState"] || query["isEndedState"]) {
            return null;
          }

          const ongoing: ScheduledMaintenanceState =
            new ScheduledMaintenanceState();
          ongoing._id = ONGOING;
          ongoing.name = "Ongoing";
          ongoing.isOngoingState = true;
          ongoing.isScheduledState = false;
          return ongoing;
        },
      );
      getJestSpyOn(
        ScheduledMaintenanceStateTimelineService as never,
        "isLastScheduledMaintenanceState",
      ).mockResolvedValue(false as never);
      getJestSpyOn(ScheduledMaintenanceService, "findOneBy").mockResolvedValue(
        null,
      );
      getJestSpyOn(ScheduledMaintenanceService, "updateOneBy").mockResolvedValue(
        1,
      );
      getJestSpyOn(
        ScheduledMaintenanceService,
        "getScheduledMaintenanceNumber",
      ).mockResolvedValue({ number: 3, numberWithPrefix: "SM-3" });
      getJestSpyOn(
        ScheduledMaintenanceService,
        "getScheduledMaintenanceLinkInDashboard",
      ).mockResolvedValue(
        URL.fromString("https://oneuptime.example/scheduled-maintenance"),
      );
      getJestSpyOn(
        ScheduledMaintenanceFeedService,
        "createScheduledMaintenanceFeedItem",
      ).mockResolvedValue(undefined);
      getJestSpyOn(
        ScheduledMaintenanceMeasurementValueService,
        "recomputeForScheduledMaintenance",
      ).mockResolvedValue(undefined);
    });

    async function saveChange(data: {
      notify: boolean | undefined;
      publicNote?: unknown;
      props?: Record<string, unknown>;
    }): Promise<{
      change: OnBeforeCreateResult<ScheduledMaintenanceStateTimeline>;
      queued: number;
    }> {
      const change: OnBeforeCreateResult<ScheduledMaintenanceStateTimeline> =
        await changeState(data);

      // Nothing is posted before the change is saved.
      expect(postedNotes).toHaveLength(0);

      // What DatabaseService saved: the row as the hook left it.
      const created: ScheduledMaintenanceStateTimeline = change.createBy.data;
      created._id = TIMELINE_ID.toString();

      await hookOf(ScheduledMaintenanceStateTimelineService, "onCreateSuccess")(
        { createBy: change.createBy, carryForward: change.carryForward },
        created,
      );

      const changeQueued: number = isQueued({
        shouldNotify: created.shouldStatusPageSubscribersBeNotified,
        status: created.subscriberNotificationStatus,
      })
        ? 1
        : 0;

      const notesQueued: number = postedNotes.filter(
        (posted: { note: ScheduledMaintenancePublicNote }) => {
          return isQueued({
            shouldNotify:
              posted.note.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
            status: posted.note.subscriberNotificationStatusOnNoteCreated,
          });
        },
      ).length;

      return { change: change, queued: changeQueued + notesQueued };
    }

    test("with Notify on: the note, queued to notify, is the one message", async () => {
      const saved: {
        change: OnBeforeCreateResult<ScheduledMaintenanceStateTimeline>;
        queued: number;
      } = await saveChange({
        notify: true,
        publicNote: "Maintenance has started.",
      });

      expect(createNote).toHaveBeenCalledTimes(1);
      expect(postedNotes).toHaveLength(1);

      const note: ScheduledMaintenancePublicNote = postedNotes[0]!.note;
      expect(note.note).toBe("Maintenance has started.");
      expect(note.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(
        true,
      );
      expect(note.subscriberNotificationStatusOnNoteCreated).toBe(
        StatusPageSubscriberNotificationStatus.Pending,
      );
      expect(saved.change.createBy.data.subscriberNotificationStatus).toBe(
        StatusPageSubscriberNotificationStatus.Success,
      );

      expect(saved.queued).toBe(1);
    });

    test("the note is posted on the event, at the change's time, as the person changing the state", async () => {
      const props: Record<string, unknown> = {
        isRoot: true,
        tenantId: PROJECT_ID,
      };

      const saved: {
        change: OnBeforeCreateResult<ScheduledMaintenanceStateTimeline>;
      } = await saveChange({
        notify: true,
        publicNote: "Maintenance has started.",
        props: props,
      });

      const posted: {
        note: ScheduledMaintenancePublicNote;
        props: Record<string, unknown>;
      } = postedNotes[0]!;
      expect(posted.props).toBe(saved.change.createBy.props);
      expect(posted.note.scheduledMaintenanceId?.toString()).toBe(
        EVENT_ID.toString(),
      );
      expect(posted.note.projectId?.toString()).toBe(PROJECT_ID.toString());
      expect(posted.note.postedAt).toEqual(STARTS_AT);
      expect(posted.note.createdAt).toEqual(STARTS_AT);
    });

    test("the note is posted as written", async () => {
      const written: string = "  Upgrading the primary database.\n\n- step 1\n";

      await saveChange({ notify: true, publicNote: written });

      expect(postedNotes[0]!.note.note).toBe(written);
    });

    test("with Notify off, nobody is told: the note is posted quietly and the change is skipped", async () => {
      const saved: { queued: number } = await saveChange({
        notify: false,
        publicNote: "Maintenance has started.",
      });

      expect(postedNotes).toHaveLength(1);
      expect(
        postedNotes[0]!.note.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
      ).toBe(false);
      expect(postedNotes[0]!.note.subscriberNotificationStatusOnNoteCreated).toBe(
        StatusPageSubscriberNotificationStatus.Skipped,
      );
      expect(saved.queued).toBe(0);
    });

    test("whatever is asked, at most one message is queued, and exactly one when the change notifies", async () => {
      const cases: Array<{
        notify: boolean | undefined;
        publicNote?: string;
        expected: number;
        notesPosted: number;
      }> = [
        {
          notify: true,
          publicNote: "Work has started.",
          expected: 1,
          notesPosted: 1,
        },
        { notify: true, expected: 1, notesPosted: 0 },
        { notify: true, publicNote: " ", expected: 1, notesPosted: 0 },
        {
          notify: false,
          publicNote: "Work has started.",
          expected: 0,
          notesPosted: 1,
        },
        { notify: false, expected: 0, notesPosted: 0 },
        {
          notify: undefined,
          publicNote: "Work has started.",
          expected: 1,
          notesPosted: 1,
        },
        { notify: undefined, expected: 1, notesPosted: 0 },
      ];

      for (const testCase of cases) {
        postedNotes = [];

        const saved: { queued: number } = await saveChange({
          notify: testCase.notify,
          ...(testCase.publicNote !== undefined
            ? { publicNote: testCase.publicNote }
            : {}),
        });

        expect({
          asked: testCase,
          queued: saved.queued,
          notesPosted: postedNotes.length,
        }).toEqual({
          asked: testCase,
          queued: testCase.expected,
          notesPosted: testCase.notesPosted,
        });
      }
    });

    test("a note that cannot be posted once the change is saved: the person who sent it is told, and the event's lock was already let go", async () => {
      const mutex: SemaphoreMutex = {
        key: EVENT_ID.toString(),
      } as unknown as SemaphoreMutex;
      getJestSpyOn(Semaphore, "lock").mockResolvedValue(mutex);
      const release: jest.SpyInstance = getJestSpyOn(
        Semaphore,
        "release",
      ).mockResolvedValue(undefined);

      createNote.mockRejectedValue(new Error("The note could not be saved."));

      await expect(
        saveChange({ notify: true, publicNote: "Maintenance has started." }),
      ).rejects.toThrow("The note could not be saved.");

      expect(release).toHaveBeenCalledWith(mutex);
    });
  });
});

describe("an incident state change with a public note tells subscribers once", () => {
  beforeEach(() => {
    // The incident's first state change: nothing before or after it.
    getJestSpyOn(IncidentStateTimelineService, "findOneBy").mockResolvedValue(
      null,
    );
  });

  async function changeState(data: {
    notify: boolean | undefined;
    publicNote?: unknown;
  }): Promise<OnBeforeCreateResult<IncidentStateTimeline>> {
    const timeline: IncidentStateTimeline = new IncidentStateTimeline();
    timeline.projectId = PROJECT_ID;
    timeline.incidentId = INCIDENT_ID;
    timeline.incidentStateId = ACKNOWLEDGED_STATE_ID;
    timeline.startsAt = STARTS_AT;

    if (data.notify !== undefined) {
      timeline.shouldStatusPageSubscribersBeNotified = data.notify;
    }

    return (await hookOf(
      IncidentStateTimelineService,
      "onBeforeCreate",
    )({
      data: timeline,
      miscDataProps:
        data.publicNote === undefined
          ? {}
          : ({ publicNote: data.publicNote } as JSONObject),
      props: { isRoot: true, tenantId: PROJECT_ID },
    })) as OnBeforeCreateResult<IncidentStateTimeline>;
  }

  test("with Notify on, the change is recorded as sent by the note it carries forward", async () => {
    const result: OnBeforeCreateResult<IncidentStateTimeline> =
      await changeState({
        notify: true,
        publicNote: "We have identified the cause.",
      });

    expect(result.createBy.data.subscriberNotificationStatus).toBe(
      StatusPageSubscriberNotificationStatus.Success,
    );
    expect(result.createBy.data.subscriberNotificationStatusMessage).toBe(
      StateChangeSubscriberNotification.sentByPublicNoteMessage,
    );
    expect(result.carryForward["publicNote"]).toBe(
      "We have identified the cause.",
    );
  });

  test("without a note, the change is queued", async () => {
    const result: OnBeforeCreateResult<IncidentStateTimeline> =
      await changeState({ notify: true });

    expect(result.createBy.data.subscriberNotificationStatus).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(result.carryForward["publicNote"]).toBeUndefined();
  });

  test("a note with no text in it is no note: nothing is carried forward, and the change is queued", async () => {
    const result: OnBeforeCreateResult<IncidentStateTimeline> =
      await changeState({ notify: true, publicNote: " \n " });

    expect(result.createBy.data.subscriberNotificationStatus).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(result.carryForward["publicNote"]).toBeUndefined();
  });

  test("with Notify off, the change is skipped and its note still goes forward, quietly", async () => {
    const result: OnBeforeCreateResult<IncidentStateTimeline> =
      await changeState({
        notify: false,
        publicNote: "We have identified the cause.",
      });

    expect(result.createBy.data.subscriberNotificationStatus).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
    expect(result.createBy.data.subscriberNotificationStatusMessage).toBe(
      INCIDENT_SKIPPED_MESSAGE,
    );
    expect(result.carryForward["publicNote"]).toBe(
      "We have identified the cause.",
    );
  });

  test("a change that does not say keeps its column defaults", async () => {
    const result: OnBeforeCreateResult<IncidentStateTimeline> =
      await changeState({
        notify: undefined,
        publicNote: "We have identified the cause.",
      });

    expect(result.createBy.data.subscriberNotificationStatus).toBeUndefined();
    expect(
      result.createBy.data.subscriberNotificationStatusMessage,
    ).toBeUndefined();
  });

  describe("once the change is saved, the note it carried is posted", () => {
    let postedNotes: Array<{
      note: IncidentPublicNote;
      props: Record<string, unknown>;
    }>;

    beforeEach(() => {
      postedNotes = [];

      const state: IncidentState = new IncidentState();
      state._id = ACKNOWLEDGED_STATE_ID.toString();
      state.name = "Acknowledged";
      state.isAcknowledgedState = true;
      state.isResolvedState = false;

      getJestSpyOn(IncidentStateService, "findOneBy").mockResolvedValue(state);
      getJestSpyOn(IncidentService, "updateOneBy").mockResolvedValue(1);
      getJestSpyOn(IncidentService, "getIncidentNumber").mockResolvedValue({
        number: 17,
        numberWithPrefix: "INC-17",
      });
      getJestSpyOn(
        IncidentService,
        "getIncidentLinkInDashboard",
      ).mockResolvedValue(URL.fromString("https://oneuptime.example/incident"));
      getJestSpyOn(IncidentService, "refreshIncidentMetrics").mockResolvedValue(
        undefined,
      );
      getJestSpyOn(
        IncidentMeasurementValueService,
        "recomputeForIncident",
      ).mockResolvedValue(undefined);
      getJestSpyOn(
        IncidentFeedService,
        "createIncidentFeedItem",
      ).mockResolvedValue(undefined);
      getJestSpyOn(
        IncidentAlertService,
        "cascadeIncidentStateToLinkedAlerts",
      ).mockResolvedValue(undefined);
      getJestSpyOn(
        IncidentStateTimelineService,
        "trackSlaStateChange",
      ).mockResolvedValue(undefined);
      getJestSpyOn(
        IncidentStateTimelineService,
        "isLastIncidentState",
      ).mockResolvedValue(false);

      getJestSpyOn(IncidentPublicNoteService, "create").mockImplementation(
        async (input: unknown) => {
          const createBy: {
            data: IncidentPublicNote;
            props: Record<string, unknown>;
          } = input as {
            data: IncidentPublicNote;
            props: Record<string, unknown>;
          };

          const result: OnBeforeCreateResult<IncidentPublicNote> =
            (await hookOf(
              IncidentPublicNoteService,
              "onBeforeCreate",
            )(createBy)) as OnBeforeCreateResult<IncidentPublicNote>;

          postedNotes.push({
            note: result.createBy.data,
            props: createBy.props,
          });

          return result.createBy.data;
        },
      );
    });

    async function saveChange(data: {
      notify: boolean | undefined;
      publicNote?: unknown;
    }): Promise<{
      change: OnBeforeCreateResult<IncidentStateTimeline>;
      queued: number;
    }> {
      const change: OnBeforeCreateResult<IncidentStateTimeline> =
        await changeState(data);

      // What DatabaseService saved: the row as the hook left it.
      const created: IncidentStateTimeline = change.createBy.data;
      created._id = TIMELINE_ID.toString();

      await hookOf(IncidentStateTimelineService, "onCreateSuccess")(
        { createBy: change.createBy, carryForward: change.carryForward },
        created,
      );

      const changeQueued: number = isQueued({
        shouldNotify: created.shouldStatusPageSubscribersBeNotified,
        status: created.subscriberNotificationStatus,
      })
        ? 1
        : 0;

      const notesQueued: number = postedNotes.filter(
        (posted: { note: IncidentPublicNote }) => {
          return isQueued({
            shouldNotify:
              posted.note.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
            status: posted.note.subscriberNotificationStatusOnNoteCreated,
          });
        },
      ).length;

      return { change: change, queued: changeQueued + notesQueued };
    }

    test("with Notify on: the note, queued to notify, is the one message", async () => {
      const saved: {
        change: OnBeforeCreateResult<IncidentStateTimeline>;
        queued: number;
      } = await saveChange({
        notify: true,
        publicNote: "We have identified the cause.",
      });

      expect(postedNotes).toHaveLength(1);
      const posted: {
        note: IncidentPublicNote;
        props: Record<string, unknown>;
      } = postedNotes[0]!;
      expect(posted.note.note).toBe("We have identified the cause.");
      expect(posted.note.incidentId?.toString()).toBe(INCIDENT_ID.toString());
      expect(posted.note.projectId?.toString()).toBe(PROJECT_ID.toString());
      expect(posted.note.postedAt).toEqual(STARTS_AT);
      expect(
        posted.note.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
      ).toBe(true);
      expect(posted.note.subscriberNotificationStatusOnNoteCreated).toBe(
        StatusPageSubscriberNotificationStatus.Pending,
      );
      expect(posted.props).toBe(saved.change.createBy.props);

      expect(saved.queued).toBe(1);
    });

    test("whatever is asked, at most one message is queued, and exactly one when the change notifies", async () => {
      const cases: Array<{
        notify: boolean | undefined;
        publicNote?: string;
        expected: number;
        notesPosted: number;
      }> = [
        {
          notify: true,
          publicNote: "We have identified the cause.",
          expected: 1,
          notesPosted: 1,
        },
        { notify: true, expected: 1, notesPosted: 0 },
        { notify: true, publicNote: "\t", expected: 1, notesPosted: 0 },
        {
          notify: false,
          publicNote: "We have identified the cause.",
          expected: 0,
          notesPosted: 1,
        },
        { notify: false, expected: 0, notesPosted: 0 },
        {
          notify: undefined,
          publicNote: "We have identified the cause.",
          expected: 1,
          notesPosted: 1,
        },
      ];

      for (const testCase of cases) {
        postedNotes = [];

        const saved: { queued: number } = await saveChange({
          notify: testCase.notify,
          ...(testCase.publicNote !== undefined
            ? { publicNote: testCase.publicNote }
            : {}),
        });

        expect({
          asked: testCase,
          queued: saved.queued,
          notesPosted: postedNotes.length,
        }).toEqual({
          asked: testCase,
          queued: testCase.expected,
          notesPosted: testCase.notesPosted,
        });
      }
    });
  });
});
