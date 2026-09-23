import IncidentPublicNoteService from "../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../Server/Services/IncidentService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import UserType from "../../../Types/UserType";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A public note that does not say whether to notify status page subscribers
 * follows its incident: when the incident was declared without notifying
 * them, the note stays quiet too. An explicit yes or no is always kept.
 *
 * These tests pin the server half in IncidentPublicNoteService: the
 * onBeforeCreate hook (and its incident lookup), addNote() - the path Slack
 * and Microsoft Teams notes take - and the full create() path for a non-root
 * member, where whatever the hook writes is checked against the caller's
 * column permissions.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_INCIDENT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

const SKIPPED_MESSAGE: string =
  "Notifications skipped as subscribers are not to be notified for this incident note.";

type OnBeforeCreateFunction = (
  createBy: CreateBy<IncidentPublicNote>,
) => Promise<OnCreate<IncidentPublicNote>>;

type PropsBuilder = () => DatabaseCommonInteractionProps;

type MemberPropsFunction = (
  permissions: Array<Permission>,
) => DatabaseCommonInteractionProps;

const memberProps: MemberPropsFunction = (
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps => {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission): UserPermission => {
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
  };
};

const rootProps: PropsBuilder = (): DatabaseCommonInteractionProps => {
  return { isRoot: true };
};

// A member whose only way in is the public note create permission.
const noteCreatorProps: PropsBuilder = (): DatabaseCommonInteractionProps => {
  return memberProps([Permission.CreateIncidentPublicNote]);
};

type IncidentWithFlagFunction = (
  flag: boolean | null | undefined,
  id?: ObjectID,
) => Incident;

const incidentWithFlag: IncidentWithFlagFunction = (
  flag: boolean | null | undefined,
  id: ObjectID = INCIDENT_ID,
): Incident => {
  const incident: Incident = new Incident();
  incident.id = id;
  // A row from before the setting existed can hold null or nothing.
  incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated =
    flag as boolean;
  return incident;
};

type MockIncidentLookupFunction = (incident: Incident | null) => void;

const mockIncidentLookup: MockIncidentLookupFunction = (
  incident: Incident | null,
): void => {
  jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident);
};

interface NoteOptions {
  incidentId?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
  notify?: boolean | null | undefined;
}

type BuildNoteFunction = (options?: NoteOptions) => IncidentPublicNote;

const buildNote: BuildNoteFunction = (
  options: NoteOptions = {},
): IncidentPublicNote => {
  const note: IncidentPublicNote = new IncidentPublicNote();
  note.note = "We are still investigating.";

  const incidentId: ObjectID | undefined =
    "incidentId" in options ? options.incidentId : INCIDENT_ID;
  const projectId: ObjectID | undefined =
    "projectId" in options ? options.projectId : PROJECT_ID;

  if (incidentId) {
    note.incidentId = incidentId;
  }

  if (projectId) {
    note.projectId = projectId;
  }

  if ("notify" in options) {
    note.shouldStatusPageSubscribersBeNotifiedOnNoteCreated =
      options.notify as boolean;
  }

  return note;
};

type RunBeforeCreateFunction = (
  note: IncidentPublicNote,
  props?: DatabaseCommonInteractionProps,
) => Promise<OnCreate<IncidentPublicNote>>;

// Calls the protected hook exactly as create() does.
const runBeforeCreate: RunBeforeCreateFunction = async (
  note: IncidentPublicNote,
  props: DatabaseCommonInteractionProps = rootProps(),
): Promise<OnCreate<IncidentPublicNote>> => {
  return await (
    IncidentPublicNoteService as unknown as {
      onBeforeCreate: OnBeforeCreateFunction;
    }
  ).onBeforeCreate({ data: note, props: props });
};

type LookupFunction = () => FindOneBy<Incident>;

// The arguments of the single incident lookup the hook made.
const incidentLookup: LookupFunction = (): FindOneBy<Incident> => {
  const calls: Array<Array<unknown>> = jest.mocked(IncidentService.findOneBy)
    .mock.calls as Array<Array<unknown>>;

  expect(calls).toHaveLength(1);

  return calls[0]![0] as FindOneBy<Incident>;
};

type LookupQueryFunction = () => Record<string, unknown>;

const incidentLookupQuery: LookupQueryFunction = (): Record<
  string,
  unknown
> => {
  return incidentLookup().query as Record<string, unknown>;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each([
  ["a root caller", rootProps],
  ["a member who may only create public notes", noteCreatorProps],
] as Array<[string, PropsBuilder]>)(
  "IncidentPublicNoteService onBeforeCreate for %s",
  (_label: string, buildProps: PropsBuilder) => {
    test("an unsaid choice on an incident declared without notifying subscribers stays quiet", async () => {
      mockIncidentLookup(incidentWithFlag(false));

      const result: OnCreate<IncidentPublicNote> = await runBeforeCreate(
        buildNote(),
        buildProps(),
      );

      expect(
        result.createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
      ).toBe(false);
      expect(
        result.createBy.data.subscriberNotificationStatusOnNoteCreated,
      ).toBe(StatusPageSubscriberNotificationStatus.Skipped);
      expect(result.createBy.data.subscriberNotificationStatusMessage).toBe(
        SKIPPED_MESSAGE,
      );
    });

    test("an unsaid choice on an incident that notified subscribers notifies", async () => {
      mockIncidentLookup(incidentWithFlag(true));

      const result: OnCreate<IncidentPublicNote> = await runBeforeCreate(
        buildNote(),
        buildProps(),
      );

      expect(
        result.createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
      ).toBe(true);
      expect(
        result.createBy.data.subscriberNotificationStatusOnNoteCreated,
      ).toBe(StatusPageSubscriberNotificationStatus.Pending);
      expect(
        result.createBy.data.subscriberNotificationStatusMessage,
      ).toBeUndefined();
    });

    test.each([
      ["unset", undefined],
      ["null", null],
    ] as Array<[string, null | undefined]>)(
      "an unsaid choice on an incident whose own setting is %s notifies",
      async (_flagLabel: string, incidentFlag: null | undefined) => {
        mockIncidentLookup(incidentWithFlag(incidentFlag));

        const result: OnCreate<IncidentPublicNote> = await runBeforeCreate(
          buildNote(),
          buildProps(),
        );

        expect(
          result.createBy.data
            .shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
        ).toBe(true);
        expect(
          result.createBy.data.subscriberNotificationStatusOnNoteCreated,
        ).toBe(StatusPageSubscriberNotificationStatus.Pending);
      },
    );

    test("a null choice is treated as unsaid and follows the incident", async () => {
      mockIncidentLookup(incidentWithFlag(false));

      const result: OnCreate<IncidentPublicNote> = await runBeforeCreate(
        buildNote({ notify: null }),
        buildProps(),
      );

      expect(IncidentService.findOneBy).toHaveBeenCalledTimes(1);
      expect(
        result.createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
      ).toBe(false);
      expect(
        result.createBy.data.subscriberNotificationStatusOnNoteCreated,
      ).toBe(StatusPageSubscriberNotificationStatus.Skipped);
    });

    test("an explicit yes on a quiet incident is kept, without reading the incident", async () => {
      mockIncidentLookup(incidentWithFlag(false));

      const result: OnCreate<IncidentPublicNote> = await runBeforeCreate(
        buildNote({ notify: true }),
        buildProps(),
      );

      expect(IncidentService.findOneBy).not.toHaveBeenCalled();
      expect(
        result.createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
      ).toBe(true);
      expect(
        result.createBy.data.subscriberNotificationStatusOnNoteCreated,
      ).toBe(StatusPageSubscriberNotificationStatus.Pending);
    });

    test("an explicit no on a notifying incident is kept, without reading the incident", async () => {
      mockIncidentLookup(incidentWithFlag(true));

      const result: OnCreate<IncidentPublicNote> = await runBeforeCreate(
        buildNote({ notify: false }),
        buildProps(),
      );

      expect(IncidentService.findOneBy).not.toHaveBeenCalled();
      expect(
        result.createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
      ).toBe(false);
      expect(
        result.createBy.data.subscriberNotificationStatusOnNoteCreated,
      ).toBe(StatusPageSubscriberNotificationStatus.Skipped);
      expect(result.createBy.data.subscriberNotificationStatusMessage).toBe(
        SKIPPED_MESSAGE,
      );
    });

    test("an incident that cannot be found leaves the choice to the column default", async () => {
      mockIncidentLookup(null);

      const result: OnCreate<IncidentPublicNote> = await runBeforeCreate(
        buildNote(),
        buildProps(),
      );

      expect(IncidentService.findOneBy).toHaveBeenCalledTimes(1);
      expect(
        result.createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
      ).toBeUndefined();
      expect(
        result.createBy.data.subscriberNotificationStatusOnNoteCreated,
      ).toBeUndefined();
      expect(
        result.createBy.data.subscriberNotificationStatusMessage,
      ).toBeUndefined();
    });

    test("a note with no incident is not looked up and keeps the column default", async () => {
      mockIncidentLookup(incidentWithFlag(false));

      const result: OnCreate<IncidentPublicNote> = await runBeforeCreate(
        buildNote({ incidentId: undefined }),
        buildProps(),
      );

      expect(IncidentService.findOneBy).not.toHaveBeenCalled();
      expect(
        result.createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
      ).toBeUndefined();
      expect(
        result.createBy.data.subscriberNotificationStatusOnNoteCreated,
      ).toBeUndefined();
    });

    test("reads the incident id from the incident relation when incidentId is not set", async () => {
      mockIncidentLookup(incidentWithFlag(false));

      const note: IncidentPublicNote = buildNote({ incidentId: undefined });
      note.incident = incidentWithFlag(undefined);

      const result: OnCreate<IncidentPublicNote> = await runBeforeCreate(
        note,
        buildProps(),
      );

      expect(incidentLookupQuery()["_id"]).toBe(INCIDENT_ID.toString());
      expect(
        result.createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
      ).toBe(false);
      expect(
        result.createBy.data.subscriberNotificationStatusOnNoteCreated,
      ).toBe(StatusPageSubscriberNotificationStatus.Skipped);
    });

    test("prefers incidentId over the incident relation when both are set", async () => {
      mockIncidentLookup(incidentWithFlag(true));

      const note: IncidentPublicNote = buildNote();
      note.incident = incidentWithFlag(undefined, OTHER_INCIDENT_ID);

      await runBeforeCreate(note, buildProps());

      expect(incidentLookupQuery()["_id"]).toBe(INCIDENT_ID.toString());
    });

    test("still stamps postedAt when it is not given", async () => {
      mockIncidentLookup(incidentWithFlag(false));

      const before: number = Date.now();
      const result: OnCreate<IncidentPublicNote> = await runBeforeCreate(
        buildNote(),
        buildProps(),
      );

      expect(result.createBy.data.postedAt).toBeInstanceOf(Date);
      expect(result.createBy.data.postedAt!.getTime()).toBeGreaterThanOrEqual(
        before,
      );
    });

    test("keeps a postedAt that is given", async () => {
      mockIncidentLookup(incidentWithFlag(false));

      const postedAt: Date = new Date("2026-01-02T03:04:05.000Z");
      const note: IncidentPublicNote = buildNote();
      note.postedAt = postedAt;

      const result: OnCreate<IncidentPublicNote> = await runBeforeCreate(
        note,
        buildProps(),
      );

      expect(result.createBy.data.postedAt).toBe(postedAt);
    });

    test("lets a failed incident lookup fail the create", async () => {
      jest
        .spyOn(IncidentService, "findOneBy")
        .mockRejectedValue(new Error("incident lookup failed"));

      await expect(runBeforeCreate(buildNote(), buildProps())).rejects.toThrow(
        "incident lookup failed",
      );
    });
  },
);

describe("IncidentPublicNoteService onBeforeCreate incident lookup", () => {
  test("looks the incident up by id within the note's project", async () => {
    mockIncidentLookup(incidentWithFlag(false));

    await runBeforeCreate(buildNote());

    const query: Record<string, unknown> = incidentLookupQuery();

    expect(Object.keys(query).sort()).toEqual(["_id", "projectId"]);
    expect(query["_id"]).toBe(INCIDENT_ID.toString());
    expect(typeof query["_id"]).toBe("string");
    expect((query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("does not scope the lookup to a project when the note has none", async () => {
    mockIncidentLookup(incidentWithFlag(false));

    await runBeforeCreate(buildNote({ projectId: undefined }));

    expect(incidentLookupQuery()).toEqual({ _id: INCIDENT_ID.toString() });
  });

  test("reads only the incident's notify setting", async () => {
    mockIncidentLookup(incidentWithFlag(false));

    await runBeforeCreate(buildNote());

    expect(incidentLookup().select).toEqual({
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
    });
  });

  test("reads the incident as root even when a non-root member posts the note", async () => {
    mockIncidentLookup(incidentWithFlag(false));

    await runBeforeCreate(buildNote(), noteCreatorProps());

    expect(incidentLookup().props).toEqual({ isRoot: true });
  });

  test("returns the same create request with no carry-forward", async () => {
    mockIncidentLookup(incidentWithFlag(false));

    const note: IncidentPublicNote = buildNote();
    const props: DatabaseCommonInteractionProps = rootProps();

    const result: OnCreate<IncidentPublicNote> = await runBeforeCreate(
      note,
      props,
    );

    expect(result.createBy.data).toBe(note);
    expect(result.createBy.props).toBe(props);
    expect(result.carryForward).toBeNull();
  });
});

describe("IncidentPublicNoteService addNote (Slack and Microsoft Teams)", () => {
  type AddNoteFunction = () => Promise<CreateBy<IncidentPublicNote>>;

  // Runs addNote with create() stubbed and returns what it asked to create.
  const captureAddNote: AddNoteFunction = async (): Promise<
    CreateBy<IncidentPublicNote>
  > => {
    jest
      .spyOn(IncidentPublicNoteService, "create")
      .mockImplementation(
        async (
          createBy: CreateBy<IncidentPublicNote>,
        ): Promise<IncidentPublicNote> => {
          return createBy.data;
        },
      );

    await IncidentPublicNoteService.addNote({
      userId: USER_ID,
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
      note: "Posted from the incident channel.",
      postedFromSlackMessageId: "1700000000.000100",
    });

    expect(IncidentPublicNoteService.create).toHaveBeenCalledTimes(1);

    return jest.mocked(IncidentPublicNoteService.create).mock.calls[0]![0];
  };

  test("leaves the notify choice unsaid so the note follows its incident", async () => {
    const createBy: CreateBy<IncidentPublicNote> = await captureAddNote();

    expect(
      createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
    ).toBeUndefined();
    expect(
      createBy.data.subscriberNotificationStatusOnNoteCreated,
    ).toBeUndefined();
    expect(createBy.data.incidentId?.toString()).toBe(INCIDENT_ID.toString());
    expect(createBy.data.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(createBy.props).toEqual({ isRoot: true });
  });

  test("a note posted on a quiet incident stays quiet", async () => {
    const createBy: CreateBy<IncidentPublicNote> = await captureAddNote();

    mockIncidentLookup(incidentWithFlag(false));

    const result: OnCreate<IncidentPublicNote> = await runBeforeCreate(
      createBy.data,
      createBy.props,
    );

    expect(
      result.createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
    ).toBe(false);
    expect(result.createBy.data.subscriberNotificationStatusOnNoteCreated).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
    expect(result.createBy.data.subscriberNotificationStatusMessage).toBe(
      SKIPPED_MESSAGE,
    );
  });

  test("a note posted on an incident that notified subscribers notifies", async () => {
    const createBy: CreateBy<IncidentPublicNote> = await captureAddNote();

    mockIncidentLookup(incidentWithFlag(true));

    const result: OnCreate<IncidentPublicNote> = await runBeforeCreate(
      createBy.data,
      createBy.props,
    );

    expect(
      result.createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
    ).toBe(true);
    expect(result.createBy.data.subscriberNotificationStatusOnNoteCreated).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });
});

describe("IncidentPublicNoteService create() with the notify default", () => {
  let save: MockFunction;

  beforeEach(() => {
    save = getJestMockFunction().mockImplementation(
      async (entity: IncidentPublicNote): Promise<IncidentPublicNote> => {
        return entity;
      },
    );

    jest
      .spyOn(IncidentPublicNoteService, "getRepository")
      .mockReturnValue({ save: save } as never);
    jest
      .spyOn(IncidentPublicNoteService, "onCreateSuccess")
      .mockImplementation(
        async (
          _onCreate: OnCreate<IncidentPublicNote>,
          createdItem: IncidentPublicNote,
        ): Promise<IncidentPublicNote> => {
          return createdItem;
        },
      );
    jest
      .spyOn(IncidentPublicNoteService, "onTriggerWorkflow")
      .mockResolvedValue(undefined);
    jest
      .spyOn(IncidentPublicNoteService, "onTriggerRealtime")
      .mockResolvedValue(undefined);
    jest
      .spyOn(IncidentPublicNoteService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
  });

  test("a member who may only create public notes saves a quiet note on a quiet incident", async () => {
    mockIncidentLookup(incidentWithFlag(false));

    const saved: IncidentPublicNote = await IncidentPublicNoteService.create({
      data: buildNote({ projectId: undefined }),
      props: noteCreatorProps(),
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0]).toBe(saved);
    expect(saved.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(
      false,
    );
    expect(saved.subscriberNotificationStatusOnNoteCreated).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
    expect(saved.subscriberNotificationStatusMessage).toBe(SKIPPED_MESSAGE);
    expect(saved.postedAt).toBeInstanceOf(Date);
  });

  test("the same member saves a notifying note on an incident that notified subscribers", async () => {
    mockIncidentLookup(incidentWithFlag(true));

    const saved: IncidentPublicNote = await IncidentPublicNoteService.create({
      data: buildNote({ projectId: undefined }),
      props: noteCreatorProps(),
    });

    expect(saved.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(true);
    expect(saved.subscriberNotificationStatusOnNoteCreated).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });

  test("an explicit yes from that member on a quiet incident is saved as sent", async () => {
    mockIncidentLookup(incidentWithFlag(false));

    const saved: IncidentPublicNote = await IncidentPublicNoteService.create({
      data: buildNote({ projectId: undefined, notify: true }),
      props: noteCreatorProps(),
    });

    expect(IncidentService.findOneBy).not.toHaveBeenCalled();
    expect(saved.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(true);
    expect(saved.subscriberNotificationStatusOnNoteCreated).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });

  test("scopes the incident lookup to the caller's project, not the one the note names", async () => {
    mockIncidentLookup(incidentWithFlag(false));

    await IncidentPublicNoteService.create({
      data: buildNote({ projectId: OTHER_PROJECT_ID }),
      props: noteCreatorProps(),
    });

    expect((incidentLookupQuery()["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("a Slack or Microsoft Teams note on a quiet incident is saved quiet", async () => {
    mockIncidentLookup(incidentWithFlag(false));

    const saved: IncidentPublicNote = await IncidentPublicNoteService.addNote({
      userId: USER_ID,
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
      note: "Posted from the incident channel.",
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(saved.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(
      false,
    );
    expect(saved.subscriberNotificationStatusOnNoteCreated).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
  });

  test("harness guard: the create still enforces column permissions on this path", async () => {
    mockIncidentLookup(incidentWithFlag(false));

    const note: IncidentPublicNote = buildNote({ projectId: undefined });
    note.deletedByUserId = USER_ID;

    await expect(
      IncidentPublicNoteService.create({
        data: note,
        props: noteCreatorProps(),
      }),
    ).rejects.toThrow(
      new BadDataException(
        "User is not allowed to create on deletedByUserId column of Incident Public Note",
      ),
    );
    expect(save).not.toHaveBeenCalled();
  });

  test("harness guard: a caller who may only read public notes is refused", async () => {
    mockIncidentLookup(incidentWithFlag(false));

    await expect(
      IncidentPublicNoteService.create({
        data: buildNote({ projectId: undefined }),
        props: memberProps([Permission.ReadIncidentPublicNote]),
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
    expect(save).not.toHaveBeenCalled();
  });
});
