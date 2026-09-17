import { afterEach, describe, expect, test } from "@jest/globals";
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeInternalNoteService from "../../../Server/Services/AlertEpisodeInternalNoteService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertEpisodeStateTimelineService from "../../../Server/Services/AlertEpisodeStateTimelineService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeInternalNoteService from "../../../Server/Services/IncidentEpisodeInternalNoteService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "../../../Server/Services/IncidentEpisodeStateTimelineService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import AlertEpisodeInternalNote from "../../../Models/DatabaseModels/AlertEpisodeInternalNote";
import AlertEpisodeStateTimeline from "../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import IncidentEpisodeInternalNote from "../../../Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentEpisodeStateTimeline from "../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";

/*
 * Changing an episode's state can carry an optional private note — from the
 * episode overview panel or from the bulk "Change State" action on the
 * episodes table. The note is not a column on the state timeline: it rides
 * along under `miscDataProps`. These tests cover both halves of that trip.
 * onBeforeCreate has to pick the note up, and onCreateSuccess has to turn it
 * into an internal note on the episode. Miss either half and the textbox
 * silently throws the user's note away.
 */

interface EpisodeTimelineHooks<TTimeline> {
  onBeforeCreate: (createBy: {
    data: TTimeline;
    miscDataProps?: Record<string, unknown> | undefined;
    props: Record<string, unknown>;
  }) => Promise<OnCreate<never>>;
  onCreateSuccess: (
    onCreate: {
      createBy: { data: TTimeline; props: Record<string, unknown> };
      carryForward: Record<string, unknown>;
    },
    createdItem: TTimeline,
  ) => Promise<TTimeline>;
}

const incidentEpisodeHooks: EpisodeTimelineHooks<IncidentEpisodeStateTimeline> =
  IncidentEpisodeStateTimelineService as unknown as EpisodeTimelineHooks<IncidentEpisodeStateTimeline>;

const alertEpisodeHooks: EpisodeTimelineHooks<AlertEpisodeStateTimeline> =
  AlertEpisodeStateTimelineService as unknown as EpisodeTimelineHooks<AlertEpisodeStateTimeline>;

const PROJECT_ID: ObjectID = new ObjectID(
  "019acd20-1111-4111-8111-111111111111",
);
const EPISODE_ID: ObjectID = new ObjectID(
  "019acd20-2222-4222-8222-222222222222",
);
const STATE_ID: ObjectID = new ObjectID("019acd20-3333-4333-8333-333333333333");
const TIMELINE_ID: ObjectID = new ObjectID(
  "019acd20-4444-4444-8444-444444444444",
);

const NOTE_ON_INCIDENT_EPISODE: string = "Mapped to Dynamics case 4821.";
const NOTE_ON_ALERT_EPISODE: string = "Paged the on-call team.";

function mockSemaphore(): void {
  jest.spyOn(Semaphore, "lock").mockResolvedValue(null as never);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncidentEpisodeStateTimelineService note handling", () => {
  function buildTimeline(): IncidentEpisodeStateTimeline {
    const timeline: IncidentEpisodeStateTimeline =
      new IncidentEpisodeStateTimeline();
    timeline.id = TIMELINE_ID;
    timeline.projectId = PROJECT_ID;
    timeline.incidentEpisodeId = EPISODE_ID;
    timeline.incidentStateId = STATE_ID;
    timeline.startsAt = OneUptimeDate.getCurrentDate();
    /*
     * A set endsAt means this row is not the latest one, which keeps
     * onCreateSuccess out of the "cascade to member incidents" branch. The
     * note handling under test is independent of that branch.
     */
    timeline.endsAt = OneUptimeDate.getCurrentDate();

    return timeline;
  }

  function mockOnBeforeCreateLookups(): void {
    mockSemaphore();
    jest
      .spyOn(IncidentEpisodeStateTimelineService, "findOneBy")
      .mockResolvedValue(null);
  }

  function mockOnCreateSuccessLookups(): void {
    jest.spyOn(IncidentStateService, "findOneBy").mockResolvedValue(null);
    jest.spyOn(IncidentEpisodeService, "findOneById").mockResolvedValue(null);
    jest
      .spyOn(IncidentEpisodeFeedService, "createIncidentEpisodeFeedItem")
      .mockResolvedValue(undefined as never);
  }

  function mockInternalNoteCreate(): jest.SpyInstance {
    return jest
      .spyOn(IncidentEpisodeInternalNoteService, "create")
      .mockResolvedValue(new IncidentEpisodeInternalNote() as never);
  }

  test("onBeforeCreate carries the private note forward", async () => {
    mockOnBeforeCreateLookups();

    const onCreate: OnCreate<never> = await incidentEpisodeHooks.onBeforeCreate(
      {
        data: buildTimeline(),
        miscDataProps: {
          privateNote: NOTE_ON_INCIDENT_EPISODE,
        },
        props: { isRoot: true },
      },
    );

    expect(onCreate.carryForward.privateNote).toBe(NOTE_ON_INCIDENT_EPISODE);
  });

  test("onBeforeCreate leaves the note undefined when none was written", async () => {
    mockOnBeforeCreateLookups();

    const onCreate: OnCreate<never> = await incidentEpisodeHooks.onBeforeCreate(
      {
        data: buildTimeline(),
        props: { isRoot: true },
      },
    );

    expect(onCreate.carryForward.privateNote).toBeUndefined();
  });

  test("onCreateSuccess turns the carried note into an episode internal note", async () => {
    mockOnCreateSuccessLookups();
    const createNote: jest.SpyInstance = mockInternalNoteCreate();

    const createdItem: IncidentEpisodeStateTimeline = buildTimeline();

    await incidentEpisodeHooks.onCreateSuccess(
      {
        createBy: { data: createdItem, props: { isRoot: true } },
        carryForward: {
          statusTimelineBeforeThisStatus: null,
          statusTimelineAfterThisStatus: null,
          privateNote: NOTE_ON_INCIDENT_EPISODE,
          mutex: null,
        },
      },
      createdItem,
    );

    expect(createNote).toHaveBeenCalledTimes(1);

    const note: IncidentEpisodeInternalNote = createNote.mock.calls[0]![0].data;

    expect(note.note).toBe(NOTE_ON_INCIDENT_EPISODE);
    expect(note.incidentEpisodeId?.toString()).toBe(EPISODE_ID.toString());
    expect(note.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(note.createdAt).toEqual(createdItem.startsAt);
  });

  test("onCreateSuccess writes no note when the textbox was left empty", async () => {
    mockOnCreateSuccessLookups();
    const createNote: jest.SpyInstance = mockInternalNoteCreate();

    const createdItem: IncidentEpisodeStateTimeline = buildTimeline();

    await incidentEpisodeHooks.onCreateSuccess(
      {
        createBy: { data: createdItem, props: { isRoot: true } },
        carryForward: {
          statusTimelineBeforeThisStatus: null,
          statusTimelineAfterThisStatus: null,
          privateNote: undefined,
          mutex: null,
        },
      },
      createdItem,
    );

    expect(createNote).not.toHaveBeenCalled();
  });
});

describe("AlertEpisodeStateTimelineService note handling", () => {
  function buildTimeline(): AlertEpisodeStateTimeline {
    const timeline: AlertEpisodeStateTimeline = new AlertEpisodeStateTimeline();
    timeline.id = TIMELINE_ID;
    timeline.projectId = PROJECT_ID;
    timeline.alertEpisodeId = EPISODE_ID;
    timeline.alertStateId = STATE_ID;
    timeline.startsAt = OneUptimeDate.getCurrentDate();
    timeline.endsAt = OneUptimeDate.getCurrentDate();

    return timeline;
  }

  function mockOnBeforeCreateLookups(): void {
    mockSemaphore();
    jest
      .spyOn(AlertEpisodeStateTimelineService, "findOneBy")
      .mockResolvedValue(null);
  }

  function mockOnCreateSuccessLookups(): void {
    jest.spyOn(AlertStateService, "findOneBy").mockResolvedValue(null);
    jest.spyOn(AlertEpisodeService, "findOneById").mockResolvedValue(null);
    jest
      .spyOn(AlertEpisodeFeedService, "createAlertEpisodeFeedItem")
      .mockResolvedValue(undefined as never);
  }

  function mockInternalNoteCreate(): jest.SpyInstance {
    return jest
      .spyOn(AlertEpisodeInternalNoteService, "create")
      .mockResolvedValue(new AlertEpisodeInternalNote() as never);
  }

  test("onBeforeCreate carries the private note forward", async () => {
    mockOnBeforeCreateLookups();

    const onCreate: OnCreate<never> = await alertEpisodeHooks.onBeforeCreate({
      data: buildTimeline(),
      miscDataProps: {
        privateNote: NOTE_ON_ALERT_EPISODE,
      },
      props: { isRoot: true },
    });

    expect(onCreate.carryForward.privateNote).toBe(NOTE_ON_ALERT_EPISODE);
  });

  test("onBeforeCreate leaves the note undefined when none was written", async () => {
    mockOnBeforeCreateLookups();

    const onCreate: OnCreate<never> = await alertEpisodeHooks.onBeforeCreate({
      data: buildTimeline(),
      props: { isRoot: true },
    });

    expect(onCreate.carryForward.privateNote).toBeUndefined();
  });

  test("onCreateSuccess turns the carried note into an episode internal note", async () => {
    mockOnCreateSuccessLookups();
    const createNote: jest.SpyInstance = mockInternalNoteCreate();

    const createdItem: AlertEpisodeStateTimeline = buildTimeline();

    await alertEpisodeHooks.onCreateSuccess(
      {
        createBy: { data: createdItem, props: { isRoot: true } },
        carryForward: {
          statusTimelineBeforeThisStatus: null,
          statusTimelineAfterThisStatus: null,
          privateNote: NOTE_ON_ALERT_EPISODE,
          mutex: null,
        },
      },
      createdItem,
    );

    expect(createNote).toHaveBeenCalledTimes(1);

    const note: AlertEpisodeInternalNote = createNote.mock.calls[0]![0].data;

    expect(note.note).toBe(NOTE_ON_ALERT_EPISODE);
    expect(note.alertEpisodeId?.toString()).toBe(EPISODE_ID.toString());
    expect(note.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(note.createdAt).toEqual(createdItem.startsAt);
  });

  test("onCreateSuccess writes no note when the textbox was left empty", async () => {
    mockOnCreateSuccessLookups();
    const createNote: jest.SpyInstance = mockInternalNoteCreate();

    const createdItem: AlertEpisodeStateTimeline = buildTimeline();

    await alertEpisodeHooks.onCreateSuccess(
      {
        createBy: { data: createdItem, props: { isRoot: true } },
        carryForward: {
          statusTimelineBeforeThisStatus: null,
          statusTimelineAfterThisStatus: null,
          mutex: null,
        },
      },
      createdItem,
    );

    expect(createNote).not.toHaveBeenCalled();
  });
});
