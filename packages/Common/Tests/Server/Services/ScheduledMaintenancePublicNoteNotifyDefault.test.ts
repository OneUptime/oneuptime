import ScheduledMaintenancePublicNoteService from "../../../Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenancePublicNote from "../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
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
 * follows its scheduled maintenance event: when the event was created
 * without notifying them, the note stays quiet too. An explicit yes or no is
 * always kept.
 *
 * These tests pin the server half in ScheduledMaintenancePublicNoteService:
 * the onBeforeCreate hook (and its event lookup), addNote() - the path Slack
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
const SCHEDULED_MAINTENANCE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_SCHEDULED_MAINTENANCE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

const SKIPPED_MESSAGE: string =
  "Notifications skipped as subscribers are not to be notified for this scheduled maintenance note.";

type OnBeforeCreateFunction = (
  createBy: CreateBy<ScheduledMaintenancePublicNote>,
) => Promise<OnCreate<ScheduledMaintenancePublicNote>>;

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

// A member whose only way in is the scheduled maintenance public note create permission.
const noteCreatorProps: PropsBuilder = (): DatabaseCommonInteractionProps => {
  return memberProps([Permission.CreateScheduledMaintenancePublicNote]);
};

type EventWithFlagFunction = (
  flag: boolean | null | undefined,
  id?: ObjectID,
) => ScheduledMaintenance;

const eventWithFlag: EventWithFlagFunction = (
  flag: boolean | null | undefined,
  id: ObjectID = SCHEDULED_MAINTENANCE_ID,
): ScheduledMaintenance => {
  const event: ScheduledMaintenance = new ScheduledMaintenance();
  event.id = id;
  // A row from before the setting existed can hold null or nothing.
  event.shouldStatusPageSubscribersBeNotifiedOnEventCreated = flag as boolean;
  return event;
};

type MockEventLookupFunction = (event: ScheduledMaintenance | null) => void;

const mockEventLookup: MockEventLookupFunction = (
  event: ScheduledMaintenance | null,
): void => {
  jest.spyOn(ScheduledMaintenanceService, "findOneBy").mockResolvedValue(event);
};

interface NoteOptions {
  scheduledMaintenanceId?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
  notify?: boolean | null | undefined;
}

type BuildNoteFunction = (
  options?: NoteOptions,
) => ScheduledMaintenancePublicNote;

const buildNote: BuildNoteFunction = (
  options: NoteOptions = {},
): ScheduledMaintenancePublicNote => {
  const note: ScheduledMaintenancePublicNote =
    new ScheduledMaintenancePublicNote();
  note.note = "We are still investigating.";

  const scheduledMaintenanceId: ObjectID | undefined =
    "scheduledMaintenanceId" in options
      ? options.scheduledMaintenanceId
      : SCHEDULED_MAINTENANCE_ID;
  const projectId: ObjectID | undefined =
    "projectId" in options ? options.projectId : PROJECT_ID;

  if (scheduledMaintenanceId) {
    note.scheduledMaintenanceId = scheduledMaintenanceId;
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
  note: ScheduledMaintenancePublicNote,
  props?: DatabaseCommonInteractionProps,
) => Promise<OnCreate<ScheduledMaintenancePublicNote>>;

// Calls the protected hook exactly as create() does.
const runBeforeCreate: RunBeforeCreateFunction = async (
  note: ScheduledMaintenancePublicNote,
  props: DatabaseCommonInteractionProps = rootProps(),
): Promise<OnCreate<ScheduledMaintenancePublicNote>> => {
  return await (
    ScheduledMaintenancePublicNoteService as unknown as {
      onBeforeCreate: OnBeforeCreateFunction;
    }
  ).onBeforeCreate({ data: note, props: props });
};

type LookupFunction = () => FindOneBy<ScheduledMaintenance>;

// The arguments of the single event lookup the hook made.
const eventLookup: LookupFunction = (): FindOneBy<ScheduledMaintenance> => {
  const calls: Array<Array<unknown>> = jest.mocked(
    ScheduledMaintenanceService.findOneBy,
  ).mock.calls as Array<Array<unknown>>;

  expect(calls).toHaveLength(1);

  return calls[0]![0] as FindOneBy<ScheduledMaintenance>;
};

type LookupQueryFunction = () => Record<string, unknown>;

const eventLookupQuery: LookupQueryFunction = (): Record<string, unknown> => {
  return eventLookup().query as Record<string, unknown>;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each([
  ["a root caller", rootProps],
  [
    "a member who may only create scheduled maintenance public notes",
    noteCreatorProps,
  ],
] as Array<[string, PropsBuilder]>)(
  "ScheduledMaintenancePublicNoteService onBeforeCreate for %s",
  (_label: string, buildProps: PropsBuilder) => {
    test("an unsaid choice on an event created without notifying subscribers stays quiet", async () => {
      mockEventLookup(eventWithFlag(false));

      const result: OnCreate<ScheduledMaintenancePublicNote> =
        await runBeforeCreate(buildNote(), buildProps());

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

    test("an unsaid choice on an event that notified subscribers notifies", async () => {
      mockEventLookup(eventWithFlag(true));

      const result: OnCreate<ScheduledMaintenancePublicNote> =
        await runBeforeCreate(buildNote(), buildProps());

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
      "an unsaid choice on an event whose own setting is %s notifies",
      async (_flagLabel: string, eventFlag: null | undefined) => {
        mockEventLookup(eventWithFlag(eventFlag));

        const result: OnCreate<ScheduledMaintenancePublicNote> =
          await runBeforeCreate(buildNote(), buildProps());

        expect(
          result.createBy.data
            .shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
        ).toBe(true);
        expect(
          result.createBy.data.subscriberNotificationStatusOnNoteCreated,
        ).toBe(StatusPageSubscriberNotificationStatus.Pending);
      },
    );

    test("a null choice is treated as unsaid and follows the event", async () => {
      mockEventLookup(eventWithFlag(false));

      const result: OnCreate<ScheduledMaintenancePublicNote> =
        await runBeforeCreate(buildNote({ notify: null }), buildProps());

      expect(ScheduledMaintenanceService.findOneBy).toHaveBeenCalledTimes(1);
      expect(
        result.createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
      ).toBe(false);
      expect(
        result.createBy.data.subscriberNotificationStatusOnNoteCreated,
      ).toBe(StatusPageSubscriberNotificationStatus.Skipped);
    });

    test("an explicit yes on a quiet event is kept, without reading the event", async () => {
      mockEventLookup(eventWithFlag(false));

      const result: OnCreate<ScheduledMaintenancePublicNote> =
        await runBeforeCreate(buildNote({ notify: true }), buildProps());

      expect(ScheduledMaintenanceService.findOneBy).not.toHaveBeenCalled();
      expect(
        result.createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
      ).toBe(true);
      expect(
        result.createBy.data.subscriberNotificationStatusOnNoteCreated,
      ).toBe(StatusPageSubscriberNotificationStatus.Pending);
    });

    test("an explicit no on a notifying event is kept, without reading the event", async () => {
      mockEventLookup(eventWithFlag(true));

      const result: OnCreate<ScheduledMaintenancePublicNote> =
        await runBeforeCreate(buildNote({ notify: false }), buildProps());

      expect(ScheduledMaintenanceService.findOneBy).not.toHaveBeenCalled();
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

    test("an event that cannot be found leaves the choice to the column default", async () => {
      mockEventLookup(null);

      const result: OnCreate<ScheduledMaintenancePublicNote> =
        await runBeforeCreate(buildNote(), buildProps());

      expect(ScheduledMaintenanceService.findOneBy).toHaveBeenCalledTimes(1);
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

    test("a note with no event is not looked up and keeps the column default", async () => {
      mockEventLookup(eventWithFlag(false));

      const result: OnCreate<ScheduledMaintenancePublicNote> =
        await runBeforeCreate(
          buildNote({ scheduledMaintenanceId: undefined }),
          buildProps(),
        );

      expect(ScheduledMaintenanceService.findOneBy).not.toHaveBeenCalled();
      expect(
        result.createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
      ).toBeUndefined();
      expect(
        result.createBy.data.subscriberNotificationStatusOnNoteCreated,
      ).toBeUndefined();
    });

    test("reads the event id from the event relation when scheduledMaintenanceId is not set", async () => {
      mockEventLookup(eventWithFlag(false));

      const note: ScheduledMaintenancePublicNote = buildNote({
        scheduledMaintenanceId: undefined,
      });
      note.scheduledMaintenance = eventWithFlag(undefined);

      const result: OnCreate<ScheduledMaintenancePublicNote> =
        await runBeforeCreate(note, buildProps());

      expect(eventLookupQuery()["_id"]).toBe(
        SCHEDULED_MAINTENANCE_ID.toString(),
      );
      expect(
        result.createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
      ).toBe(false);
      expect(
        result.createBy.data.subscriberNotificationStatusOnNoteCreated,
      ).toBe(StatusPageSubscriberNotificationStatus.Skipped);
    });

    test("prefers scheduledMaintenanceId over the event relation when both are set", async () => {
      mockEventLookup(eventWithFlag(true));

      const note: ScheduledMaintenancePublicNote = buildNote();
      note.scheduledMaintenance = eventWithFlag(
        undefined,
        OTHER_SCHEDULED_MAINTENANCE_ID,
      );

      await runBeforeCreate(note, buildProps());

      expect(eventLookupQuery()["_id"]).toBe(
        SCHEDULED_MAINTENANCE_ID.toString(),
      );
    });

    test("does not take the choice from the event relation the caller sent", async () => {
      // The relation object is caller input; only the stored event counts.
      mockEventLookup(eventWithFlag(true));

      const note: ScheduledMaintenancePublicNote = buildNote();
      note.scheduledMaintenance = eventWithFlag(false);

      const result: OnCreate<ScheduledMaintenancePublicNote> =
        await runBeforeCreate(note, buildProps());

      expect(ScheduledMaintenanceService.findOneBy).toHaveBeenCalledTimes(1);
      expect(
        result.createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
      ).toBe(true);
    });

    test("still stamps postedAt when it is not given", async () => {
      mockEventLookup(eventWithFlag(false));

      const before: number = Date.now();
      const result: OnCreate<ScheduledMaintenancePublicNote> =
        await runBeforeCreate(buildNote(), buildProps());

      expect(result.createBy.data.postedAt).toBeInstanceOf(Date);
      expect(result.createBy.data.postedAt!.getTime()).toBeGreaterThanOrEqual(
        before,
      );
    });

    test("keeps a postedAt that is given", async () => {
      mockEventLookup(eventWithFlag(false));

      const postedAt: Date = new Date("2026-01-02T03:04:05.000Z");
      const note: ScheduledMaintenancePublicNote = buildNote();
      note.postedAt = postedAt;

      const result: OnCreate<ScheduledMaintenancePublicNote> =
        await runBeforeCreate(note, buildProps());

      expect(result.createBy.data.postedAt).toBe(postedAt);
    });

    test("lets a failed event lookup fail the create", async () => {
      jest
        .spyOn(ScheduledMaintenanceService, "findOneBy")
        .mockRejectedValue(new Error("event lookup failed"));

      await expect(runBeforeCreate(buildNote(), buildProps())).rejects.toThrow(
        "event lookup failed",
      );
    });
  },
);

describe("ScheduledMaintenancePublicNoteService onBeforeCreate event lookup", () => {
  test("looks the event up by id within the note's project", async () => {
    mockEventLookup(eventWithFlag(false));

    await runBeforeCreate(buildNote());

    const query: Record<string, unknown> = eventLookupQuery();

    expect(Object.keys(query).sort()).toEqual(["_id", "projectId"]);
    expect(query["_id"]).toBe(SCHEDULED_MAINTENANCE_ID.toString());
    expect(typeof query["_id"]).toBe("string");
    expect((query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("does not scope the lookup to a project when the note has none", async () => {
    mockEventLookup(eventWithFlag(false));

    await runBeforeCreate(buildNote({ projectId: undefined }));

    expect(eventLookupQuery()).toEqual({
      _id: SCHEDULED_MAINTENANCE_ID.toString(),
    });
  });

  test("reads only the event's notify setting", async () => {
    mockEventLookup(eventWithFlag(false));

    await runBeforeCreate(buildNote());

    expect(eventLookup().select).toEqual({
      shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
    });
  });

  test("reads the event as root even when a non-root member posts the note", async () => {
    mockEventLookup(eventWithFlag(false));

    await runBeforeCreate(buildNote(), noteCreatorProps());

    expect(eventLookup().props).toEqual({ isRoot: true });
  });

  test("returns the same create request with no carry-forward", async () => {
    mockEventLookup(eventWithFlag(false));

    const note: ScheduledMaintenancePublicNote = buildNote();
    const props: DatabaseCommonInteractionProps = rootProps();

    const result: OnCreate<ScheduledMaintenancePublicNote> =
      await runBeforeCreate(note, props);

    expect(result.createBy.data).toBe(note);
    expect(result.createBy.props).toBe(props);
    expect(result.carryForward).toBeNull();
  });
});

describe("ScheduledMaintenancePublicNoteService addNote (Slack and Microsoft Teams)", () => {
  type AddNoteFunction = () => Promise<
    CreateBy<ScheduledMaintenancePublicNote>
  >;

  // Runs addNote with create() stubbed and returns what it asked to create.
  const captureAddNote: AddNoteFunction = async (): Promise<
    CreateBy<ScheduledMaintenancePublicNote>
  > => {
    jest
      .spyOn(ScheduledMaintenancePublicNoteService, "create")
      .mockImplementation(
        async (
          createBy: CreateBy<ScheduledMaintenancePublicNote>,
        ): Promise<ScheduledMaintenancePublicNote> => {
          return createBy.data;
        },
      );

    await ScheduledMaintenancePublicNoteService.addNote({
      userId: USER_ID,
      scheduledMaintenanceId: SCHEDULED_MAINTENANCE_ID,
      projectId: PROJECT_ID,
      note: "Posted from the maintenance channel.",
      postedFromSlackMessageId: "1700000000.000100",
    });

    expect(ScheduledMaintenancePublicNoteService.create).toHaveBeenCalledTimes(
      1,
    );

    return jest.mocked(ScheduledMaintenancePublicNoteService.create).mock
      .calls[0]![0];
  };

  test("leaves the notify choice unsaid so the note follows its event", async () => {
    const createBy: CreateBy<ScheduledMaintenancePublicNote> =
      await captureAddNote();

    expect(
      createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
    ).toBeUndefined();
    expect(
      createBy.data.subscriberNotificationStatusOnNoteCreated,
    ).toBeUndefined();
    expect(createBy.data.scheduledMaintenanceId?.toString()).toBe(
      SCHEDULED_MAINTENANCE_ID.toString(),
    );
    expect(createBy.data.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(createBy.props).toEqual({ isRoot: true });
  });

  test("a note posted on a quiet event stays quiet", async () => {
    const createBy: CreateBy<ScheduledMaintenancePublicNote> =
      await captureAddNote();

    mockEventLookup(eventWithFlag(false));

    const result: OnCreate<ScheduledMaintenancePublicNote> =
      await runBeforeCreate(createBy.data, createBy.props);

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

  test("a note posted on an event that notified subscribers notifies", async () => {
    const createBy: CreateBy<ScheduledMaintenancePublicNote> =
      await captureAddNote();

    mockEventLookup(eventWithFlag(true));

    const result: OnCreate<ScheduledMaintenancePublicNote> =
      await runBeforeCreate(createBy.data, createBy.props);

    expect(
      result.createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
    ).toBe(true);
    expect(result.createBy.data.subscriberNotificationStatusOnNoteCreated).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });
});

describe("ScheduledMaintenancePublicNoteService create() with the notify default", () => {
  let save: MockFunction;

  beforeEach(() => {
    save = getJestMockFunction().mockImplementation(
      async (
        entity: ScheduledMaintenancePublicNote,
      ): Promise<ScheduledMaintenancePublicNote> => {
        return entity;
      },
    );

    jest
      .spyOn(ScheduledMaintenancePublicNoteService, "getRepository")
      .mockReturnValue({ save: save } as never);
    jest
      .spyOn(ScheduledMaintenancePublicNoteService, "onCreateSuccess")
      .mockImplementation(
        async (
          _onCreate: OnCreate<ScheduledMaintenancePublicNote>,
          createdItem: ScheduledMaintenancePublicNote,
        ): Promise<ScheduledMaintenancePublicNote> => {
          return createdItem;
        },
      );
    jest
      .spyOn(ScheduledMaintenancePublicNoteService, "onTriggerWorkflow")
      .mockResolvedValue(undefined);
    jest
      .spyOn(ScheduledMaintenancePublicNoteService, "onTriggerRealtime")
      .mockResolvedValue(undefined);
    jest
      .spyOn(ScheduledMaintenancePublicNoteService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
  });

  test("a member who may only create scheduled maintenance public notes saves a quiet note on a quiet event", async () => {
    mockEventLookup(eventWithFlag(false));

    const saved: ScheduledMaintenancePublicNote =
      await ScheduledMaintenancePublicNoteService.create({
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

  test("the same member saves a notifying note on an event that notified subscribers", async () => {
    mockEventLookup(eventWithFlag(true));

    const saved: ScheduledMaintenancePublicNote =
      await ScheduledMaintenancePublicNoteService.create({
        data: buildNote({ projectId: undefined }),
        props: noteCreatorProps(),
      });

    expect(saved.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(true);
    expect(saved.subscriberNotificationStatusOnNoteCreated).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });

  test("an explicit yes from that member on a quiet event is saved as sent", async () => {
    mockEventLookup(eventWithFlag(false));

    const saved: ScheduledMaintenancePublicNote =
      await ScheduledMaintenancePublicNoteService.create({
        data: buildNote({ projectId: undefined, notify: true }),
        props: noteCreatorProps(),
      });

    expect(ScheduledMaintenanceService.findOneBy).not.toHaveBeenCalled();
    expect(saved.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(true);
    expect(saved.subscriberNotificationStatusOnNoteCreated).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });

  test("an explicit no from that member on a notifying event is saved as sent", async () => {
    mockEventLookup(eventWithFlag(true));

    const saved: ScheduledMaintenancePublicNote =
      await ScheduledMaintenancePublicNoteService.create({
        data: buildNote({ projectId: undefined, notify: false }),
        props: noteCreatorProps(),
      });

    expect(ScheduledMaintenanceService.findOneBy).not.toHaveBeenCalled();
    expect(saved.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(
      false,
    );
    expect(saved.subscriberNotificationStatusOnNoteCreated).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
  });

  test("a note on an event that cannot be found is saved without a choice, so the database default applies", async () => {
    mockEventLookup(null);

    const saved: ScheduledMaintenancePublicNote =
      await ScheduledMaintenancePublicNoteService.create({
        data: buildNote({ projectId: undefined }),
        props: noteCreatorProps(),
      });

    expect(save).toHaveBeenCalledTimes(1);
    expect(
      saved.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
    ).toBeUndefined();
    expect(saved.subscriberNotificationStatusOnNoteCreated).toBeUndefined();
  });

  test("scopes the event lookup to the caller's project, not the one the note names", async () => {
    mockEventLookup(eventWithFlag(false));

    await ScheduledMaintenancePublicNoteService.create({
      data: buildNote({ projectId: OTHER_PROJECT_ID }),
      props: noteCreatorProps(),
    });

    expect((eventLookupQuery()["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("a Slack or Microsoft Teams note on a quiet event is saved quiet", async () => {
    mockEventLookup(eventWithFlag(false));

    const saved: ScheduledMaintenancePublicNote =
      await ScheduledMaintenancePublicNoteService.addNote({
        userId: USER_ID,
        scheduledMaintenanceId: SCHEDULED_MAINTENANCE_ID,
        projectId: PROJECT_ID,
        note: "Posted from the maintenance channel.",
      });

    expect(save).toHaveBeenCalledTimes(1);
    expect(saved.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(
      false,
    );
    expect(saved.subscriberNotificationStatusOnNoteCreated).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
  });

  test("a Slack or Microsoft Teams note on an event that notified subscribers is saved notifying", async () => {
    mockEventLookup(eventWithFlag(true));

    const saved: ScheduledMaintenancePublicNote =
      await ScheduledMaintenancePublicNoteService.addNote({
        userId: USER_ID,
        scheduledMaintenanceId: SCHEDULED_MAINTENANCE_ID,
        projectId: PROJECT_ID,
        note: "Posted from the maintenance channel.",
      });

    expect(save).toHaveBeenCalledTimes(1);
    expect(saved.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(true);
    expect(saved.subscriberNotificationStatusOnNoteCreated).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });

  test("harness guard: the create still enforces column permissions on this path", async () => {
    mockEventLookup(eventWithFlag(false));

    const note: ScheduledMaintenancePublicNote = buildNote({
      projectId: undefined,
    });
    note.deletedByUserId = USER_ID;

    await expect(
      ScheduledMaintenancePublicNoteService.create({
        data: note,
        props: noteCreatorProps(),
      }),
    ).rejects.toThrow(
      new BadDataException(
        "User is not allowed to create on deletedByUserId column of Scheduled Event Public Note",
      ),
    );
    expect(save).not.toHaveBeenCalled();
  });

  test("harness guard: a caller who may only read scheduled maintenance public notes is refused", async () => {
    mockEventLookup(eventWithFlag(false));

    await expect(
      ScheduledMaintenancePublicNoteService.create({
        data: buildNote({ projectId: undefined }),
        props: memberProps([Permission.ReadScheduledMaintenancePublicNote]),
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
    expect(save).not.toHaveBeenCalled();
  });
});
