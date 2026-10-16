import Semaphore from "../../../Server/Infrastructure/Semaphore";
import IncidentEpisodePublicNoteService from "../../../Server/Services/IncidentEpisodePublicNoteService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentPublicNoteService from "../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import UserService from "../../../Server/Services/UserService";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodePublicNote from "../../../Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import PrivateRecordPublicNotes, {
  PrivateRecordKind,
} from "../../../Types/StatusPage/PrivateRecordPublicNotes";
import UserType from "../../../Types/UserType";
import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import { stubPrivateRecords } from "../TestingUtils/PrivateRecords";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { stubReadableParents } from "../TestingUtils/ReadableParents";
import { mockProjectStates } from "../TestingUtils/Services/ProjectStatesHelper";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * A PRIVATE INCIDENT OR EPISODE TAKES NO PUBLIC NOTES, WHOEVER POSTS ONE.
 *
 * A customer posted a public note on a private incident: the form promised
 * subscribers and the status page, and the note reached neither - the
 * incident was private. So the server refuses a new public note on a
 * private incident or episode, with one plain sentence, on every way one is
 * made: they all end in the note services' create - the API and the
 * Dashboard, workflows and OneUptime's own writes (root), Slack and
 * Microsoft Teams (addNote), the AI's status update - and an incident state
 * change that comes with a public note is refused whole, before any of it
 * is written.
 *
 * The real create pipeline runs here - its checks, the hooks, the column
 * permissions - with only the save, the success hooks and the incident's
 * read answered by the test.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-000000000002",
);
const EPISODE_ID: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-000000000003",
);
const USER_ID: ObjectID = new ObjectID("6a000000-0000-4000-8000-000000000004");
const STATE_ID: ObjectID = new ObjectID("6a000000-0000-4000-8000-000000000005");

const NOTE: string = "We have rolled back the deploy.";

const INCIDENT_REFUSAL: string = PrivateRecordPublicNotes.getRefusalMessage(
  PrivateRecordKind.Incident,
);
const EPISODE_REFUSAL: string = PrivateRecordPublicNotes.getRefusalMessage(
  PrivateRecordKind.IncidentEpisode,
);

function memberProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      Permission.CurrentUser,
      Permission.ProjectUser,
      ...permissions,
    ].map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  };
}

// Who posts public notes: a member through the API or the Dashboard.
const NOTE_CREATOR_PERMISSIONS: Array<Permission> = [
  Permission.CreateIncidentPublicNote,
  Permission.ReadProjectIncident,
];

// OneUptime itself: a workflow step, an SLA reminder, a migration.
function rootProps(): DatabaseCommonInteractionProps {
  return { isRoot: true, tenantId: PROJECT_ID };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
}

beforeEach(() => {
  stubProjectDirectory({});
  stubReadableParents();
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * One kind of public note, on the record that can be private. A type, not
 * an interface: describe.each wants a Record<string, unknown> row.
 */
type PublicNoteCase = {
  name: string;
  service: unknown;
  refusal: string;
  permissions: Array<Permission>;
  readRecord: (isPrivate: () => boolean | null | undefined) => MockFunction;
  buildNote: () => IncidentPublicNote | IncidentEpisodePublicNote;
  addNote: (props: DatabaseCommonInteractionProps) => Promise<void>;
};

/*
 * The note services' create, with the save and the success hooks answered:
 * what is asked of the database before the note is written is real.
 */
describe.each<PublicNoteCase>([
  {
    name: "an incident's public note",
    service: IncidentPublicNoteService,
    refusal: INCIDENT_REFUSAL,
    permissions: NOTE_CREATOR_PERMISSIONS,
    readRecord: (isPrivate: () => boolean | null | undefined): MockFunction => {
      const read: MockFunction = getJestMockFunction().mockImplementation(
        async (): Promise<Incident> => {
          const incident: Incident = new Incident();
          incident._id = INCIDENT_ID.toString();
          (incident as unknown as JSONObject)["isPrivate"] =
            isPrivate() as boolean;
          incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated =
            true;
          return incident;
        },
      );
      jest
        .spyOn(IncidentService, "findOneBy")
        .mockImplementation(read as never);
      return read;
    },
    buildNote: (): IncidentPublicNote => {
      const note: IncidentPublicNote = new IncidentPublicNote();
      note.incidentId = INCIDENT_ID;
      note.projectId = PROJECT_ID;
      note.note = NOTE;
      return note;
    },
    addNote: async (props: DatabaseCommonInteractionProps): Promise<void> => {
      await IncidentPublicNoteService.addNote({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
        note: NOTE,
        postedFromSlackMessageId: "C1:1700000000.000100",
        props: props,
      });
    },
  },
  {
    name: "an incident episode's public note",
    service: IncidentEpisodePublicNoteService,
    refusal: EPISODE_REFUSAL,
    permissions: [
      Permission.CreateIncidentEpisodePublicNote,
      Permission.ReadIncidentEpisode,
    ],
    readRecord: (isPrivate: () => boolean | null | undefined): MockFunction => {
      const read: MockFunction = getJestMockFunction().mockImplementation(
        async (): Promise<IncidentEpisode> => {
          const episode: IncidentEpisode = new IncidentEpisode();
          episode._id = EPISODE_ID.toString();
          (episode as unknown as JSONObject)["isPrivate"] =
            isPrivate() as boolean;
          episode.shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated = true;
          return episode;
        },
      );
      jest
        .spyOn(IncidentEpisodeService, "findOneBy")
        .mockImplementation(read as never);
      return read;
    },
    buildNote: (): IncidentEpisodePublicNote => {
      const note: IncidentEpisodePublicNote = new IncidentEpisodePublicNote();
      note.incidentEpisodeId = EPISODE_ID;
      note.projectId = PROJECT_ID;
      note.note = NOTE;
      return note;
    },
    addNote: async (props: DatabaseCommonInteractionProps): Promise<void> => {
      await IncidentEpisodePublicNoteService.addNote({
        incidentEpisodeId: EPISODE_ID,
        projectId: PROJECT_ID,
        note: NOTE,
        postedFromSlackMessageId: "C1:1700000000.000100",
        props: props,
      });
    },
  },
])("$name", (noteCase: PublicNoteCase) => {
  type NoteService = typeof IncidentPublicNoteService;

  const service: NoteService = noteCase.service as unknown as NoteService;
  let save: MockFunction;
  let onCreateSuccess: MockFunction;
  let isPrivate: boolean | null | undefined;
  let read: MockFunction;

  beforeEach(() => {
    isPrivate = true;
    read = noteCase.readRecord(() => {
      return isPrivate;
    });

    save = getJestMockFunction().mockImplementation(
      async (entity: unknown): Promise<unknown> => {
        return entity;
      },
    );
    onCreateSuccess = getJestMockFunction().mockImplementation(
      async (_onCreate: unknown, createdItem: unknown): Promise<unknown> => {
        return createdItem;
      },
    );

    jest
      .spyOn(service, "getRepository")
      .mockReturnValue({ save: save } as never);
    jest
      .spyOn(service, "onCreateSuccess")
      .mockImplementation(onCreateSuccess as never);
    jest.spyOn(service, "onTriggerWorkflow").mockResolvedValue(undefined);
    jest.spyOn(service, "onTriggerRealtime").mockResolvedValue(undefined);
    jest.spyOn(service, "countBy").mockResolvedValue(new PositiveNumber(0));
  });

  async function create(
    props: DatabaseCommonInteractionProps,
    note: unknown = noteCase.buildNote(),
  ): Promise<unknown> {
    return await service.create({
      data: note as IncidentPublicNote,
      props: props,
    });
  }

  test("OneUptime's own create - a workflow, an SLA reminder - is refused on a private one, and nothing is written", async () => {
    const error: unknown = await rejectionOf(create(rootProps()));

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(noteCase.refusal);
    expect(save).not.toHaveBeenCalled();
    // No feed entry, no Slack or Microsoft Teams post, no notification.
    expect(onCreateSuccess).not.toHaveBeenCalled();
  });

  test("a member's create through the API or the Dashboard is refused the same way", async () => {
    const error: unknown = await rejectionOf(
      create(memberProps(noteCase.permissions)),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(noteCase.refusal);
    expect(save).not.toHaveBeenCalled();
  });

  test("a note from Slack or Microsoft Teams (addNote) is refused the same way", async () => {
    const error: unknown = await rejectionOf(
      noteCase.addNote(memberProps(noteCase.permissions)),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(noteCase.refusal);
    expect(save).not.toHaveBeenCalled();
  });

  test.each([
    ["notify subscribers", true],
    ["do not notify subscribers", false],
  ])(
    "saying '%s' gets no note through",
    async (_label: string, notify: boolean) => {
      const note: IncidentPublicNote =
        noteCase.buildNote() as IncidentPublicNote;
      note.shouldStatusPageSubscribersBeNotifiedOnNoteCreated = notify;

      const error: unknown = await rejectionOf(create(rootProps(), note));

      expect((error as Error).message).toBe(noteCase.refusal);
      expect(save).not.toHaveBeenCalled();
    },
  );

  test("its record is read as OneUptime, in the note's project, once", async () => {
    await rejectionOf(create(memberProps(noteCase.permissions)));

    expect(read).toHaveBeenCalledTimes(1);
    const findOneBy: {
      query: JSONObject;
      select: JSONObject;
      props: JSONObject;
    } = read.mock.calls[0]![0] as {
      query: JSONObject;
      select: JSONObject;
      props: JSONObject;
    };
    expect(findOneBy.props).toEqual({ isRoot: true });
    expect(findOneBy.select["isPrivate"]).toBe(true);
    expect(String(findOneBy.query["projectId"])).toBe(PROJECT_ID.toString());
  });

  test.each([
    ["not private", false],
    ["with its Private switch never set", null],
  ])(
    "one %s takes the note as always",
    async (_label: string, value: boolean | null) => {
      isPrivate = value;

      await create(memberProps(noteCase.permissions));

      expect(save).toHaveBeenCalledTimes(1);
      expect(onCreateSuccess).toHaveBeenCalledTimes(1);
    },
  );

  test("made private, it takes none; made public again, it takes them again", async () => {
    isPrivate = false;
    await create(rootProps());
    expect(save).toHaveBeenCalledTimes(1);

    isPrivate = true;
    const error: unknown = await rejectionOf(create(rootProps()));
    expect((error as Error).message).toBe(noteCase.refusal);
    expect(save).toHaveBeenCalledTimes(1);

    isPrivate = false;
    await create(rootProps());
    expect(save).toHaveBeenCalledTimes(2);
  });

  test("a record that is not found is not this rule's to refuse", async () => {
    read.mockImplementation(async (): Promise<null> => {
      return null;
    });

    await create(rootProps());

    expect(save).toHaveBeenCalledTimes(1);
  });
});

/*
 * A state change that comes with a public note posts it once the change is
 * saved. On a private incident it is refused whole, before anything of it
 * is read or written - the lock given back - with what to send instead: a
 * change is never saved with a note that is then refused.
 */
describe("an incident state change that comes with a public note", () => {
  type OnBeforeCreate = (
    input: unknown,
  ) => Promise<OnCreate<IncidentStateTimeline>>;

  const onBeforeCreate: OnBeforeCreate = (input: unknown) => {
    return (
      IncidentStateTimelineService as unknown as {
        onBeforeCreate: OnBeforeCreate;
      }
    ).onBeforeCreate.call(IncidentStateTimelineService, input);
  };

  let release: ReturnType<typeof getJestSpyOn>;
  let readTimelines: ReturnType<typeof getJestSpyOn>;

  beforeEach(() => {
    mockProjectStates();
    getJestSpyOn(Semaphore, "lock").mockResolvedValue({
      key: "state-change",
    });
    release = getJestSpyOn(Semaphore, "release").mockResolvedValue(undefined);
    getJestSpyOn(UserService, "getUserMarkdownString").mockResolvedValue(
      FeedMarkdown.asMarkdown("[Ada Lovelace](mailto:ada@example.com)"),
    );
    readTimelines = getJestSpyOn(
      IncidentStateTimelineService,
      "findOneBy",
    ).mockResolvedValue(null);
  });

  function stateChange(): IncidentStateTimeline {
    const timeline: IncidentStateTimeline = new IncidentStateTimeline();
    timeline.projectId = PROJECT_ID;
    timeline.incidentId = INCIDENT_ID;
    timeline.incidentStateId = STATE_ID;
    timeline.startsAt = new Date("2026-10-16T09:00:00.000Z");
    timeline.shouldStatusPageSubscribersBeNotified = true;
    return timeline;
  }

  async function change(
    miscDataProps: JSONObject,
    props: DatabaseCommonInteractionProps = memberProps([
      Permission.IncidentMember,
    ]),
  ): Promise<OnCreate<IncidentStateTimeline>> {
    return await onBeforeCreate({
      data: stateChange(),
      miscDataProps: miscDataProps,
      props: props,
    });
  }

  test("is refused whole on a private incident, saying what to send instead", async () => {
    stubPrivateRecords([INCIDENT_ID]);

    const error: unknown = await rejectionOf(change({ publicNote: NOTE }));

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      PrivateRecordPublicNotes.getStateChangeRefusalMessage(
        PrivateRecordKind.Incident,
      ),
    );
    // Asked before the incident's timeline was read, and the lock is back.
    expect(readTimelines).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  test("is refused for OneUptime's own changes too", async () => {
    stubPrivateRecords([INCIDENT_ID]);

    const error: unknown = await rejectionOf(
      change({ publicNote: NOTE }, rootProps()),
    );

    expect((error as Error).message).toBe(
      PrivateRecordPublicNotes.getStateChangeRefusalMessage(
        PrivateRecordKind.Incident,
      ),
    );
  });

  test("asks about this incident, in the change's project", async () => {
    const lookups: ReturnType<typeof stubPrivateRecords> = stubPrivateRecords();

    await change({ publicNote: NOTE });

    expect(lookups).toEqual([
      {
        kind: PrivateRecordKind.Incident,
        recordId: INCIDENT_ID.toString(),
        projectId: PROJECT_ID.toString(),
      },
    ]);
  });

  test("goes ahead on an incident that is not private, carrying its public note", async () => {
    stubPrivateRecords();

    const result: OnCreate<IncidentStateTimeline> = await change({
      publicNote: NOTE,
    });

    expect(
      (result.carryForward as JSONObject)["publicNoteToPost"],
    ).toBeInstanceOf(IncidentPublicNote);
  });

  test("a private incident's change with a private note goes ahead, never asking about privacy", async () => {
    const lookups: ReturnType<typeof stubPrivateRecords> = stubPrivateRecords([
      INCIDENT_ID,
    ]);

    const result: OnCreate<IncidentStateTimeline> = await change({
      privateNote: NOTE,
    });

    const carried: JSONObject = result.carryForward as JSONObject;
    const notes: Array<IncidentInternalNote> = carried[
      "privateNotesToPost"
    ] as unknown as Array<IncidentInternalNote>;

    expect(lookups).toEqual([]);
    expect(carried["publicNoteToPost"]).toBeUndefined();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toBeInstanceOf(IncidentInternalNote);
    expect(notes[0]!.note).toBe(NOTE);
    expect(notes[0]!.incidentId?.toString()).toBe(INCIDENT_ID.toString());
  });

  test("a change with no note on a private incident goes ahead as always", async () => {
    const lookups: ReturnType<typeof stubPrivateRecords> = stubPrivateRecords([
      INCIDENT_ID,
    ]);

    const result: OnCreate<IncidentStateTimeline> = await change({});

    expect(lookups).toEqual([]);
    expect(
      (result.carryForward as JSONObject)["publicNoteToPost"],
    ).toBeUndefined();
  });

  test("a blank public note is no note: the change goes ahead on a private incident", async () => {
    stubPrivateRecords([INCIDENT_ID]);

    const result: OnCreate<IncidentStateTimeline> = await change({
      publicNote: "   ",
    });

    expect(
      (result.carryForward as JSONObject)["publicNoteToPost"],
    ).toBeUndefined();
  });
});
