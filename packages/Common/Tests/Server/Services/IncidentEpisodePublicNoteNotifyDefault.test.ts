import IncidentEpisodePublicNoteService from "../../../Server/Services/IncidentEpisodePublicNoteService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodePublicNote from "../../../Models/DatabaseModels/IncidentEpisodePublicNote";
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
 * follows its incident episode: when the episode was created without
 * notifying them, the note stays quiet too. An explicit yes or no is always
 * kept.
 *
 * These tests pin the server half in IncidentEpisodePublicNoteService: the
 * onBeforeCreate hook (and its episode lookup), addNote() - the path Slack
 * notes take - and the full create() path for a non-root member, where
 * whatever the hook writes is checked against the caller's column
 * permissions.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const EPISODE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_EPISODE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

const SKIPPED_MESSAGE: string =
  "Notifications skipped as subscribers are not to be notified for this episode note.";

type OnBeforeCreateFunction = (
  createBy: CreateBy<IncidentEpisodePublicNote>,
) => Promise<OnCreate<IncidentEpisodePublicNote>>;

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

// A member whose only way in is the episode public note create permission.
const noteCreatorProps: PropsBuilder = (): DatabaseCommonInteractionProps => {
  return memberProps([Permission.CreateIncidentEpisodePublicNote]);
};

type EpisodeWithFlagFunction = (
  flag: boolean | null | undefined,
  id?: ObjectID,
) => IncidentEpisode;

const episodeWithFlag: EpisodeWithFlagFunction = (
  flag: boolean | null | undefined,
  id: ObjectID = EPISODE_ID,
): IncidentEpisode => {
  const episode: IncidentEpisode = new IncidentEpisode();
  episode.id = id;
  // A row from before the setting existed can hold null or nothing.
  episode.shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated =
    flag as boolean;
  return episode;
};

type MockEpisodeLookupFunction = (episode: IncidentEpisode | null) => void;

const mockEpisodeLookup: MockEpisodeLookupFunction = (
  episode: IncidentEpisode | null,
): void => {
  jest.spyOn(IncidentEpisodeService, "findOneBy").mockResolvedValue(episode);
};

interface NoteOptions {
  incidentEpisodeId?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
  notify?: boolean | null | undefined;
}

type BuildNoteFunction = (options?: NoteOptions) => IncidentEpisodePublicNote;

const buildNote: BuildNoteFunction = (
  options: NoteOptions = {},
): IncidentEpisodePublicNote => {
  const note: IncidentEpisodePublicNote = new IncidentEpisodePublicNote();
  note.note = "We are still investigating.";

  const incidentEpisodeId: ObjectID | undefined =
    "incidentEpisodeId" in options ? options.incidentEpisodeId : EPISODE_ID;
  const projectId: ObjectID | undefined =
    "projectId" in options ? options.projectId : PROJECT_ID;

  if (incidentEpisodeId) {
    note.incidentEpisodeId = incidentEpisodeId;
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
  note: IncidentEpisodePublicNote,
  props?: DatabaseCommonInteractionProps,
) => Promise<OnCreate<IncidentEpisodePublicNote>>;

// Calls the protected hook exactly as create() does.
const runBeforeCreate: RunBeforeCreateFunction = async (
  note: IncidentEpisodePublicNote,
  props: DatabaseCommonInteractionProps = rootProps(),
): Promise<OnCreate<IncidentEpisodePublicNote>> => {
  return await (
    IncidentEpisodePublicNoteService as unknown as {
      onBeforeCreate: OnBeforeCreateFunction;
    }
  ).onBeforeCreate({ data: note, props: props });
};

type LookupFunction = () => FindOneBy<IncidentEpisode>;

// The arguments of the single episode lookup the hook made.
const episodeLookup: LookupFunction = (): FindOneBy<IncidentEpisode> => {
  const calls: Array<Array<unknown>> = jest.mocked(
    IncidentEpisodeService.findOneBy,
  ).mock.calls as Array<Array<unknown>>;

  expect(calls).toHaveLength(1);

  return calls[0]![0] as FindOneBy<IncidentEpisode>;
};

type LookupQueryFunction = () => Record<string, unknown>;

const episodeLookupQuery: LookupQueryFunction = (): Record<string, unknown> => {
  return episodeLookup().query as Record<string, unknown>;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each([
  ["a root caller", rootProps],
  ["a member who may only create episode public notes", noteCreatorProps],
] as Array<[string, PropsBuilder]>)(
  "IncidentEpisodePublicNoteService onBeforeCreate for %s",
  (_label: string, buildProps: PropsBuilder) => {
    test("an unsaid choice on an episode created without notifying subscribers stays quiet", async () => {
      mockEpisodeLookup(episodeWithFlag(false));

      const result: OnCreate<IncidentEpisodePublicNote> = await runBeforeCreate(
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

    test("an unsaid choice on an episode that notified subscribers notifies", async () => {
      mockEpisodeLookup(episodeWithFlag(true));

      const result: OnCreate<IncidentEpisodePublicNote> = await runBeforeCreate(
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
      "an unsaid choice on an episode whose own setting is %s notifies",
      async (_flagLabel: string, episodeFlag: null | undefined) => {
        mockEpisodeLookup(episodeWithFlag(episodeFlag));

        const result: OnCreate<IncidentEpisodePublicNote> =
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

    test("a null choice is treated as unsaid and follows the episode", async () => {
      mockEpisodeLookup(episodeWithFlag(false));

      const result: OnCreate<IncidentEpisodePublicNote> = await runBeforeCreate(
        buildNote({ notify: null }),
        buildProps(),
      );

      expect(IncidentEpisodeService.findOneBy).toHaveBeenCalledTimes(1);
      expect(
        result.createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
      ).toBe(false);
      expect(
        result.createBy.data.subscriberNotificationStatusOnNoteCreated,
      ).toBe(StatusPageSubscriberNotificationStatus.Skipped);
    });

    test("an explicit yes on a quiet episode is kept, without reading the episode", async () => {
      mockEpisodeLookup(episodeWithFlag(false));

      const result: OnCreate<IncidentEpisodePublicNote> = await runBeforeCreate(
        buildNote({ notify: true }),
        buildProps(),
      );

      expect(IncidentEpisodeService.findOneBy).not.toHaveBeenCalled();
      expect(
        result.createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
      ).toBe(true);
      expect(
        result.createBy.data.subscriberNotificationStatusOnNoteCreated,
      ).toBe(StatusPageSubscriberNotificationStatus.Pending);
    });

    test("an explicit no on a notifying episode is kept, without reading the episode", async () => {
      mockEpisodeLookup(episodeWithFlag(true));

      const result: OnCreate<IncidentEpisodePublicNote> = await runBeforeCreate(
        buildNote({ notify: false }),
        buildProps(),
      );

      expect(IncidentEpisodeService.findOneBy).not.toHaveBeenCalled();
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

    test("an episode that cannot be found leaves the choice to the column default", async () => {
      mockEpisodeLookup(null);

      const result: OnCreate<IncidentEpisodePublicNote> = await runBeforeCreate(
        buildNote(),
        buildProps(),
      );

      expect(IncidentEpisodeService.findOneBy).toHaveBeenCalledTimes(1);
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

    test("a note with no episode is not looked up and keeps the column default", async () => {
      mockEpisodeLookup(episodeWithFlag(false));

      const result: OnCreate<IncidentEpisodePublicNote> = await runBeforeCreate(
        buildNote({ incidentEpisodeId: undefined }),
        buildProps(),
      );

      expect(IncidentEpisodeService.findOneBy).not.toHaveBeenCalled();
      expect(
        result.createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
      ).toBeUndefined();
      expect(
        result.createBy.data.subscriberNotificationStatusOnNoteCreated,
      ).toBeUndefined();
    });

    test("reads the episode id from the episode relation when incidentEpisodeId is not set", async () => {
      mockEpisodeLookup(episodeWithFlag(false));

      const note: IncidentEpisodePublicNote = buildNote({
        incidentEpisodeId: undefined,
      });
      note.incidentEpisode = episodeWithFlag(undefined);

      const result: OnCreate<IncidentEpisodePublicNote> = await runBeforeCreate(
        note,
        buildProps(),
      );

      expect(episodeLookupQuery()["_id"]).toBe(EPISODE_ID.toString());
      expect(
        result.createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
      ).toBe(false);
      expect(
        result.createBy.data.subscriberNotificationStatusOnNoteCreated,
      ).toBe(StatusPageSubscriberNotificationStatus.Skipped);
    });

    test("prefers incidentEpisodeId over the episode relation when both are set", async () => {
      mockEpisodeLookup(episodeWithFlag(true));

      const note: IncidentEpisodePublicNote = buildNote();
      note.incidentEpisode = episodeWithFlag(undefined, OTHER_EPISODE_ID);

      await runBeforeCreate(note, buildProps());

      expect(episodeLookupQuery()["_id"]).toBe(EPISODE_ID.toString());
    });

    test("does not take the choice from the episode relation the caller sent", async () => {
      // The relation object is caller input; only the stored episode counts.
      mockEpisodeLookup(episodeWithFlag(true));

      const note: IncidentEpisodePublicNote = buildNote();
      note.incidentEpisode = episodeWithFlag(false);

      const result: OnCreate<IncidentEpisodePublicNote> = await runBeforeCreate(
        note,
        buildProps(),
      );

      expect(IncidentEpisodeService.findOneBy).toHaveBeenCalledTimes(1);
      expect(
        result.createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
      ).toBe(true);
    });

    test("still stamps postedAt when it is not given", async () => {
      mockEpisodeLookup(episodeWithFlag(false));

      const before: number = Date.now();
      const result: OnCreate<IncidentEpisodePublicNote> = await runBeforeCreate(
        buildNote(),
        buildProps(),
      );

      expect(result.createBy.data.postedAt).toBeInstanceOf(Date);
      expect(result.createBy.data.postedAt!.getTime()).toBeGreaterThanOrEqual(
        before,
      );
    });

    test("keeps a postedAt that is given", async () => {
      mockEpisodeLookup(episodeWithFlag(false));

      const postedAt: Date = new Date("2026-01-02T03:04:05.000Z");
      const note: IncidentEpisodePublicNote = buildNote();
      note.postedAt = postedAt;

      const result: OnCreate<IncidentEpisodePublicNote> = await runBeforeCreate(
        note,
        buildProps(),
      );

      expect(result.createBy.data.postedAt).toBe(postedAt);
    });

    test("lets a failed episode lookup fail the create", async () => {
      jest
        .spyOn(IncidentEpisodeService, "findOneBy")
        .mockRejectedValue(new Error("episode lookup failed"));

      await expect(runBeforeCreate(buildNote(), buildProps())).rejects.toThrow(
        "episode lookup failed",
      );
    });
  },
);

describe("IncidentEpisodePublicNoteService onBeforeCreate episode lookup", () => {
  test("looks the episode up by id within the note's project", async () => {
    mockEpisodeLookup(episodeWithFlag(false));

    await runBeforeCreate(buildNote());

    const query: Record<string, unknown> = episodeLookupQuery();

    expect(Object.keys(query).sort()).toEqual(["_id", "projectId"]);
    expect(query["_id"]).toBe(EPISODE_ID.toString());
    expect(typeof query["_id"]).toBe("string");
    expect((query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("does not scope the lookup to a project when the note has none", async () => {
    mockEpisodeLookup(episodeWithFlag(false));

    await runBeforeCreate(buildNote({ projectId: undefined }));

    expect(episodeLookupQuery()).toEqual({ _id: EPISODE_ID.toString() });
  });

  test("reads only the episode's notify setting", async () => {
    mockEpisodeLookup(episodeWithFlag(false));

    await runBeforeCreate(buildNote());

    expect(episodeLookup().select).toEqual({
      shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: true,
    });
  });

  test("reads the episode as root even when a non-root member posts the note", async () => {
    mockEpisodeLookup(episodeWithFlag(false));

    await runBeforeCreate(buildNote(), noteCreatorProps());

    expect(episodeLookup().props).toEqual({ isRoot: true });
  });

  test("returns the same create request with no carry-forward", async () => {
    mockEpisodeLookup(episodeWithFlag(false));

    const note: IncidentEpisodePublicNote = buildNote();
    const props: DatabaseCommonInteractionProps = rootProps();

    const result: OnCreate<IncidentEpisodePublicNote> = await runBeforeCreate(
      note,
      props,
    );

    expect(result.createBy.data).toBe(note);
    expect(result.createBy.props).toBe(props);
    expect(result.carryForward).toBeNull();
  });
});

describe("IncidentEpisodePublicNoteService addNote (Slack)", () => {
  type AddNoteFunction = () => Promise<CreateBy<IncidentEpisodePublicNote>>;

  // Runs addNote with create() stubbed and returns what it asked to create.
  const captureAddNote: AddNoteFunction = async (): Promise<
    CreateBy<IncidentEpisodePublicNote>
  > => {
    jest
      .spyOn(IncidentEpisodePublicNoteService, "create")
      .mockImplementation(
        async (
          createBy: CreateBy<IncidentEpisodePublicNote>,
        ): Promise<IncidentEpisodePublicNote> => {
          return createBy.data;
        },
      );

    await IncidentEpisodePublicNoteService.addNote({
      userId: USER_ID,
      incidentEpisodeId: EPISODE_ID,
      projectId: PROJECT_ID,
      note: "Posted from the episode channel.",
      postedFromSlackMessageId: "1700000000.000100",
    });

    expect(IncidentEpisodePublicNoteService.create).toHaveBeenCalledTimes(1);

    return jest.mocked(IncidentEpisodePublicNoteService.create).mock
      .calls[0]![0];
  };

  test("leaves the notify choice unsaid so the note follows its episode", async () => {
    const createBy: CreateBy<IncidentEpisodePublicNote> =
      await captureAddNote();

    expect(
      createBy.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
    ).toBeUndefined();
    expect(
      createBy.data.subscriberNotificationStatusOnNoteCreated,
    ).toBeUndefined();
    expect(createBy.data.incidentEpisodeId?.toString()).toBe(
      EPISODE_ID.toString(),
    );
    expect(createBy.data.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(createBy.props).toEqual({ isRoot: true });
  });

  test("a note posted on a quiet episode stays quiet", async () => {
    const createBy: CreateBy<IncidentEpisodePublicNote> =
      await captureAddNote();

    mockEpisodeLookup(episodeWithFlag(false));

    const result: OnCreate<IncidentEpisodePublicNote> = await runBeforeCreate(
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

  test("a note posted on an episode that notified subscribers notifies", async () => {
    const createBy: CreateBy<IncidentEpisodePublicNote> =
      await captureAddNote();

    mockEpisodeLookup(episodeWithFlag(true));

    const result: OnCreate<IncidentEpisodePublicNote> = await runBeforeCreate(
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

describe("IncidentEpisodePublicNoteService create() with the notify default", () => {
  let save: MockFunction;

  beforeEach(() => {
    save = getJestMockFunction().mockImplementation(
      async (
        entity: IncidentEpisodePublicNote,
      ): Promise<IncidentEpisodePublicNote> => {
        return entity;
      },
    );

    jest
      .spyOn(IncidentEpisodePublicNoteService, "getRepository")
      .mockReturnValue({ save: save } as never);
    jest
      .spyOn(IncidentEpisodePublicNoteService, "onCreateSuccess")
      .mockImplementation(
        async (
          _onCreate: OnCreate<IncidentEpisodePublicNote>,
          createdItem: IncidentEpisodePublicNote,
        ): Promise<IncidentEpisodePublicNote> => {
          return createdItem;
        },
      );
    jest
      .spyOn(IncidentEpisodePublicNoteService, "onTriggerWorkflow")
      .mockResolvedValue(undefined);
    jest
      .spyOn(IncidentEpisodePublicNoteService, "onTriggerRealtime")
      .mockResolvedValue(undefined);
    jest
      .spyOn(IncidentEpisodePublicNoteService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
  });

  test("a member who may only create episode public notes saves a quiet note on a quiet episode", async () => {
    mockEpisodeLookup(episodeWithFlag(false));

    const saved: IncidentEpisodePublicNote =
      await IncidentEpisodePublicNoteService.create({
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

  test("the same member saves a notifying note on an episode that notified subscribers", async () => {
    mockEpisodeLookup(episodeWithFlag(true));

    const saved: IncidentEpisodePublicNote =
      await IncidentEpisodePublicNoteService.create({
        data: buildNote({ projectId: undefined }),
        props: noteCreatorProps(),
      });

    expect(saved.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(true);
    expect(saved.subscriberNotificationStatusOnNoteCreated).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });

  test("an explicit yes from that member on a quiet episode is saved as sent", async () => {
    mockEpisodeLookup(episodeWithFlag(false));

    const saved: IncidentEpisodePublicNote =
      await IncidentEpisodePublicNoteService.create({
        data: buildNote({ projectId: undefined, notify: true }),
        props: noteCreatorProps(),
      });

    expect(IncidentEpisodeService.findOneBy).not.toHaveBeenCalled();
    expect(saved.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(true);
    expect(saved.subscriberNotificationStatusOnNoteCreated).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });

  test("an explicit no from that member on a notifying episode is saved as sent", async () => {
    mockEpisodeLookup(episodeWithFlag(true));

    const saved: IncidentEpisodePublicNote =
      await IncidentEpisodePublicNoteService.create({
        data: buildNote({ projectId: undefined, notify: false }),
        props: noteCreatorProps(),
      });

    expect(IncidentEpisodeService.findOneBy).not.toHaveBeenCalled();
    expect(saved.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(
      false,
    );
    expect(saved.subscriberNotificationStatusOnNoteCreated).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
  });

  test("a note on an episode that cannot be found is saved without a choice, so the database default applies", async () => {
    mockEpisodeLookup(null);

    const saved: IncidentEpisodePublicNote =
      await IncidentEpisodePublicNoteService.create({
        data: buildNote({ projectId: undefined }),
        props: noteCreatorProps(),
      });

    expect(save).toHaveBeenCalledTimes(1);
    expect(
      saved.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
    ).toBeUndefined();
    expect(saved.subscriberNotificationStatusOnNoteCreated).toBeUndefined();
  });

  test("scopes the episode lookup to the caller's project, not the one the note names", async () => {
    mockEpisodeLookup(episodeWithFlag(false));

    await IncidentEpisodePublicNoteService.create({
      data: buildNote({ projectId: OTHER_PROJECT_ID }),
      props: noteCreatorProps(),
    });

    expect((episodeLookupQuery()["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("a Slack note on a quiet episode is saved quiet", async () => {
    mockEpisodeLookup(episodeWithFlag(false));

    const saved: IncidentEpisodePublicNote =
      await IncidentEpisodePublicNoteService.addNote({
        userId: USER_ID,
        incidentEpisodeId: EPISODE_ID,
        projectId: PROJECT_ID,
        note: "Posted from the episode channel.",
      });

    expect(save).toHaveBeenCalledTimes(1);
    expect(saved.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(
      false,
    );
    expect(saved.subscriberNotificationStatusOnNoteCreated).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
  });

  test("a Slack note on an episode that notified subscribers is saved notifying", async () => {
    mockEpisodeLookup(episodeWithFlag(true));

    const saved: IncidentEpisodePublicNote =
      await IncidentEpisodePublicNoteService.addNote({
        userId: USER_ID,
        incidentEpisodeId: EPISODE_ID,
        projectId: PROJECT_ID,
        note: "Posted from the episode channel.",
      });

    expect(save).toHaveBeenCalledTimes(1);
    expect(saved.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(true);
    expect(saved.subscriberNotificationStatusOnNoteCreated).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });

  test("harness guard: the create still enforces column permissions on this path", async () => {
    mockEpisodeLookup(episodeWithFlag(false));

    const note: IncidentEpisodePublicNote = buildNote({ projectId: undefined });
    note.deletedByUserId = USER_ID;

    await expect(
      IncidentEpisodePublicNoteService.create({
        data: note,
        props: noteCreatorProps(),
      }),
    ).rejects.toThrow(
      new BadDataException(
        "User is not allowed to create on deletedByUserId column of Incident Episode Public Note",
      ),
    );
    expect(save).not.toHaveBeenCalled();
  });

  test("harness guard: a caller who may only read episode public notes is refused", async () => {
    mockEpisodeLookup(episodeWithFlag(false));

    await expect(
      IncidentEpisodePublicNoteService.create({
        data: buildNote({ projectId: undefined }),
        props: memberProps([Permission.ReadIncidentEpisodePublicNote]),
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
    expect(save).not.toHaveBeenCalled();
  });
});
