import Queue from "../../../Server/Infrastructure/Queue";
import CustomNotificationChannelService, {
  ADD_CUSTOM_CHANNEL_TO_EVERYONES_RULES_JOB_NAME,
  Service as CustomNotificationChannelServiceClass,
  isPagingEveryone,
} from "../../../Server/Services/CustomNotificationChannelService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import SSRFProtection from "../../../Server/Utils/SSRFProtection";
import CustomNotificationChannel from "../../../Models/DatabaseModels/CustomNotificationChannel";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * The checks on a custom channel as an admin saves it - a name people can
 * tell apart, a URL checked when it is saved and whenever it changes, a
 * secret that is never empty - and the moment it starts paging everyone,
 * which is when the worker is asked to add it to everybody's rules.
 */

interface ServiceHooks {
  onBeforeCreate: (
    createBy: CreateBy<CustomNotificationChannel>,
  ) => Promise<OnCreate<CustomNotificationChannel>>;
  onCreateSuccess: (
    onCreate: OnCreate<CustomNotificationChannel>,
    createdItem: CustomNotificationChannel,
  ) => Promise<CustomNotificationChannel>;
  onBeforeUpdate: (
    updateBy: UpdateBy<CustomNotificationChannel>,
  ) => Promise<OnUpdate<CustomNotificationChannel>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<CustomNotificationChannel>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<CustomNotificationChannel>>;
  onBeforeDelete: (
    deleteBy: DeleteBy<CustomNotificationChannel>,
  ) => Promise<OnDelete<CustomNotificationChannel>>;
  findRowsAndHoldUpdateToThem: (...args: Array<unknown>) => Promise<unknown>;
  findRowsAndHoldDeleteToThem: (...args: Array<unknown>) => Promise<unknown>;
}

function hooks(): ServiceHooks {
  return CustomNotificationChannelService as unknown as ServiceHooks;
}

function channel(data: {
  id?: ObjectID;
  name?: string;
  isEnabled?: boolean;
  pageEveryoneByDefault?: boolean;
}): CustomNotificationChannel {
  const row: CustomNotificationChannel = new CustomNotificationChannel();
  row._id = (data.id || ObjectID.generate()).toString();
  if (data.name !== undefined) {
    row.name = data.name;
  }
  if (data.isEnabled !== undefined) {
    row.isEnabled = data.isEnabled;
  }
  if (data.pageEveryoneByDefault !== undefined) {
    row.pageEveryoneByDefault = data.pageEveryoneByDefault;
  }
  return row;
}

function createBy(
  data: Partial<CustomNotificationChannel>,
): CreateBy<CustomNotificationChannel> {
  const row: CustomNotificationChannel = new CustomNotificationChannel();
  Object.assign(row, data);
  return {
    data: row,
    props: { isRoot: true },
  } as CreateBy<CustomNotificationChannel>;
}

let ssrf: jest.SpiedFunction<typeof SSRFProtection.validateWebhookTargetIsSafe>;
let findBy: jest.SpiedFunction<typeof CustomNotificationChannelService.findBy>;
let addJob: jest.SpiedFunction<typeof Queue.addJob>;

beforeEach(() => {
  ssrf = jest
    .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
    .mockResolvedValue(undefined);
  findBy = jest
    .spyOn(CustomNotificationChannelService, "findBy")
    .mockResolvedValue([]);
  addJob = jest.spyOn(Queue, "addJob").mockResolvedValue({} as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("isPagingEveryone", () => {
  test.each([
    [{}, true],
    [{ isEnabled: true, pageEveryoneByDefault: true }, true],
    [{ isEnabled: false, pageEveryoneByDefault: true }, false],
    [{ isEnabled: true, pageEveryoneByDefault: false }, false],
    [{ isEnabled: false, pageEveryoneByDefault: false }, false],
    [{ isEnabled: undefined, pageEveryoneByDefault: undefined }, true],
  ])("%p pages everyone: %p", (value: object, expected: boolean) => {
    expect(isPagingEveryone(value)).toBe(expected);
  });
});

describe("generateSecret", () => {
  test("is 64 hex digits", () => {
    expect(CustomNotificationChannelServiceClass.generateSecret()).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  test("is never the same twice", () => {
    const secrets: Set<string> = new Set<string>();

    for (let index: number = 0; index < 200; index++) {
      secrets.add(CustomNotificationChannelServiceClass.generateSecret());
    }

    expect(secrets.size).toBe(200);
  });
});

describe("creating a channel", () => {
  test("trims its name", async () => {
    const result: OnCreate<CustomNotificationChannel> =
      await hooks().onBeforeCreate(
        createBy({
          name: "  CorpoApp  ",
          webhookUrl: "https://push.example.com/oneuptime",
        }),
      );

    expect(result.createBy.data.name).toBe("CorpoApp");
  });

  test.each(["", "   ", undefined])(
    "refuses a name of %p",
    async (name: string | undefined) => {
      await expect(
        hooks().onBeforeCreate(
          createBy({
            ...(name !== undefined ? { name: name } : {}),
            webhookUrl: "https://push.example.com/oneuptime",
          }),
        ),
      ).rejects.toThrow(BadDataException);
    },
  );

  test("refuses a name another channel has, whatever its case", async () => {
    findBy.mockResolvedValue([channel({ name: "corpoapp" })]);

    await expect(
      hooks().onBeforeCreate(
        createBy({
          name: "CorpoApp",
          webhookUrl: "https://push.example.com/oneuptime",
        }),
      ),
    ).rejects.toThrow("A custom channel named CorpoApp already exists.");
  });

  test("refuses a channel with no URL", async () => {
    await expect(
      hooks().onBeforeCreate(createBy({ name: "CorpoApp" })),
    ).rejects.toThrow("A webhook URL is required.");
  });

  test("checks the URL, allowing the private network the admin runs it on", async () => {
    await hooks().onBeforeCreate(
      createBy({ name: "CorpoApp", webhookUrl: "http://10.0.0.5/push" }),
    );

    expect(ssrf).toHaveBeenCalledWith("http://10.0.0.5/push", {
      allowPrivateNetworkTargets: true,
    });
  });

  test("a URL the check refuses is not saved", async () => {
    ssrf.mockRejectedValue(new BadDataException("That URL is not allowed."));

    await expect(
      hooks().onBeforeCreate(
        createBy({ name: "CorpoApp", webhookUrl: "http://169.254.169.254/" }),
      ),
    ).rejects.toThrow("That URL is not allowed.");
  });

  test("makes a signing secret when none is given", async () => {
    const result: OnCreate<CustomNotificationChannel> =
      await hooks().onBeforeCreate(
        createBy({
          name: "CorpoApp",
          webhookUrl: "https://push.example.com/oneuptime",
        }),
      );

    expect(result.createBy.data.secret).toMatch(/^[0-9a-f]{64}$/);
  });

  test("makes a signing secret when the one given is blank", async () => {
    const result: OnCreate<CustomNotificationChannel> =
      await hooks().onBeforeCreate(
        createBy({
          name: "CorpoApp",
          webhookUrl: "https://push.example.com/oneuptime",
          secret: "   ",
        }),
      );

    expect(result.createBy.data.secret).toMatch(/^[0-9a-f]{64}$/);
  });

  test("keeps the signing secret the admin chose", async () => {
    const result: OnCreate<CustomNotificationChannel> =
      await hooks().onBeforeCreate(
        createBy({
          name: "CorpoApp",
          webhookUrl: "https://push.example.com/oneuptime",
          secret: "my-own-secret",
        }),
      );

    expect(result.createBy.data.secret).toBe("my-own-secret");
  });

  test("starts with nobody's rules having it, whatever the request says", async () => {
    const result: OnCreate<CustomNotificationChannel> =
      await hooks().onBeforeCreate(
        createBy({
          name: "CorpoApp",
          webhookUrl: "https://push.example.com/oneuptime",
          addedToEveryonesRulesAt: new Date(),
        }),
      );

    expect(result.createBy.data.addedToEveryonesRulesAt).toBeUndefined();
  });

  test("a channel that pages everyone asks the worker to add it to everybody's rules", async () => {
    const created: CustomNotificationChannel = channel({
      isEnabled: true,
      pageEveryoneByDefault: true,
    });

    await hooks().onCreateSuccess(
      { createBy: createBy({}), carryForward: null },
      created,
    );

    expect(addJob).toHaveBeenCalledTimes(1);
    const args: Array<unknown> = addJob.mock.calls[0] as Array<unknown>;
    expect(args[2]).toBe(ADD_CUSTOM_CHANNEL_TO_EVERYONES_RULES_JOB_NAME);
    expect(args[3]).toEqual({
      customNotificationChannelId: created.id!.toString(),
    });
  });

  test.each([
    [{ isEnabled: false, pageEveryoneByDefault: true }],
    [{ isEnabled: true, pageEveryoneByDefault: false }],
  ])("a channel %p does not", async (state: object) => {
    await hooks().onCreateSuccess(
      { createBy: createBy({}), carryForward: null },
      channel(state),
    );

    expect(addJob).not.toHaveBeenCalled();
  });

  test("a channel is still saved when the queue cannot be reached", async () => {
    addJob.mockRejectedValue(new Error("Redis is down"));
    const created: CustomNotificationChannel = channel({});

    await expect(
      hooks().onCreateSuccess(
        { createBy: createBy({}), carryForward: null },
        created,
      ),
    ).resolves.toBe(created);
  });

  test("the job name matches the worker's", () => {
    expect(ADD_CUSTOM_CHANNEL_TO_EVERYONES_RULES_JOB_NAME).toBe(
      "OnCallDutyPolicy:AddCustomChannelToEveryonesRules",
    );
  });
});

describe("changing a channel", () => {
  const CHANNEL_ID: ObjectID = ObjectID.generate();

  function updateBy(
    data: Record<string, unknown>,
  ): UpdateBy<CustomNotificationChannel> {
    return {
      query: { _id: CHANNEL_ID },
      data: data,
      props: { isRoot: true },
    } as unknown as UpdateBy<CustomNotificationChannel>;
  }

  function holdRows(rows: Array<CustomNotificationChannel>): void {
    jest
      .spyOn(
        CustomNotificationChannelService as unknown as {
          findRowsAndHoldUpdateToThem: () => Promise<unknown>;
        },
        "findRowsAndHoldUpdateToThem",
      )
      .mockResolvedValue(rows);
  }

  test("a new name is trimmed and checked against the other channels, not itself", async () => {
    holdRows([channel({ id: CHANNEL_ID, name: "CorpoApp" })]);
    findBy.mockResolvedValue([channel({ id: CHANNEL_ID, name: "corpoapp" })]);

    const result: OnUpdate<CustomNotificationChannel> =
      await hooks().onBeforeUpdate(updateBy({ name: "  CORPOAPP " }));

    expect((result.updateBy.data as Record<string, unknown>)["name"]).toBe(
      "CORPOAPP",
    );
  });

  test("a name another channel has is refused", async () => {
    holdRows([channel({ id: CHANNEL_ID, name: "CorpoApp" })]);
    findBy.mockResolvedValue([channel({ name: "Pager" })]);

    await expect(
      hooks().onBeforeUpdate(updateBy({ name: "pager" })),
    ).rejects.toThrow("A custom channel named pager already exists.");
  });

  test("a blank name is refused", async () => {
    holdRows([channel({ id: CHANNEL_ID })]);

    await expect(hooks().onBeforeUpdate(updateBy({ name: " " }))).rejects.toThrow(
      BadDataException,
    );
  });

  test("a new URL is checked, as it was when the channel was saved", async () => {
    holdRows([channel({ id: CHANNEL_ID })]);

    await hooks().onBeforeUpdate(
      updateBy({ webhookUrl: "https://new.example.com/hook" }),
    );

    expect(ssrf).toHaveBeenCalledWith("https://new.example.com/hook", {
      allowPrivateNetworkTargets: true,
    });
  });

  test.each(["", null])("a URL of %p is refused", async (url: unknown) => {
    holdRows([channel({ id: CHANNEL_ID })]);

    await expect(
      hooks().onBeforeUpdate(updateBy({ webhookUrl: url })),
    ).rejects.toThrow("A webhook URL is required.");
  });

  test("an update that leaves the URL alone does not check it", async () => {
    holdRows([channel({ id: CHANNEL_ID })]);

    await hooks().onBeforeUpdate(updateBy({ isEnabled: false }));

    expect(ssrf).not.toHaveBeenCalled();
  });

  test.each(["", "   ", null, 42])(
    "a signing secret of %p is refused",
    async (secret: unknown) => {
      holdRows([channel({ id: CHANNEL_ID })]);

      await expect(
        hooks().onBeforeUpdate(updateBy({ secret: secret })),
      ).rejects.toThrow("A signing secret is required");
    },
  );

  test("remembers which rows did not page everyone before", async () => {
    const off: CustomNotificationChannel = channel({ isEnabled: false });
    const on: CustomNotificationChannel = channel({});
    holdRows([off, on]);

    const result: OnUpdate<CustomNotificationChannel> =
      await hooks().onBeforeUpdate(updateBy({ isEnabled: true }));

    expect(result.carryForward).toEqual({
      notPagingEveryoneBefore: [off.id!.toString()],
    });
  });

  test("a channel that starts paging everyone is added to everybody's rules again", async () => {
    const id: ObjectID = ObjectID.generate();
    findBy.mockResolvedValue([channel({ id: id })]);
    const update: jest.SpiedFunction<
      typeof CustomNotificationChannelService.updateOneById
    > = jest
      .spyOn(CustomNotificationChannelService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await hooks().onUpdateSuccess(
      {
        updateBy: updateBy({ pageEveryoneByDefault: true }),
        carryForward: { notPagingEveryoneBefore: [id.toString()] },
      },
      [id],
    );

    expect(update).toHaveBeenCalledTimes(1);
    const call: Record<string, unknown> = update.mock.calls[0]![0] as never;
    expect((call["id"] as ObjectID).toString()).toBe(id.toString());
    expect(call["data"]).toEqual({ addedToEveryonesRulesAt: null });
    expect(call["props"]).toEqual({ isRoot: true, ignoreHooks: true });
    expect(addJob).toHaveBeenCalledTimes(1);
  });

  test("a channel that paged everyone before is left as it is", async () => {
    const id: ObjectID = ObjectID.generate();
    const update: jest.SpiedFunction<
      typeof CustomNotificationChannelService.updateOneById
    > = jest.spyOn(CustomNotificationChannelService, "updateOneById");

    await hooks().onUpdateSuccess(
      {
        updateBy: updateBy({ name: "Renamed" }),
        carryForward: { notPagingEveryoneBefore: [] },
      },
      [id],
    );

    expect(update).not.toHaveBeenCalled();
    expect(addJob).not.toHaveBeenCalled();
  });

  test("a channel still not paging everyone after the update is left as it is", async () => {
    const id: ObjectID = ObjectID.generate();
    findBy.mockResolvedValue([channel({ id: id, isEnabled: false })]);
    const update: jest.SpiedFunction<
      typeof CustomNotificationChannelService.updateOneById
    > = jest.spyOn(CustomNotificationChannelService, "updateOneById");

    await hooks().onUpdateSuccess(
      {
        updateBy: updateBy({ pageEveryoneByDefault: true }),
        carryForward: { notPagingEveryoneBefore: [id.toString()] },
      },
      [id],
    );

    expect(update).not.toHaveBeenCalled();
    expect(addJob).not.toHaveBeenCalled();
  });
});

describe("deleting a channel", () => {
  test("deletes the rules that page through it", async () => {
    const first: CustomNotificationChannel = channel({});
    const second: CustomNotificationChannel = channel({});

    jest
      .spyOn(
        CustomNotificationChannelService as unknown as {
          findRowsAndHoldDeleteToThem: () => Promise<unknown>;
        },
        "findRowsAndHoldDeleteToThem",
      )
      .mockResolvedValue([first, second]);

    const deleteRules: jest.SpiedFunction<
      typeof UserNotificationRuleService.deleteBy
    > = jest
      .spyOn(UserNotificationRuleService, "deleteBy")
      .mockResolvedValue(0 as never);

    await hooks().onBeforeDelete({
      query: {},
      props: { isRoot: true },
    } as DeleteBy<CustomNotificationChannel>);

    expect(deleteRules).toHaveBeenCalledTimes(2);

    const deletedFor: Array<string> = deleteRules.mock.calls.map(
      (call: Array<unknown>): string => {
        const args: Record<string, unknown> = call[0] as Record<
          string,
          unknown
        >;
        const query: Record<string, unknown> = args["query"] as Record<
          string,
          unknown
        >;
        expect(args["props"]).toEqual({ isRoot: true });
        return (query["customNotificationChannelId"] as ObjectID).toString();
      },
    );

    expect(deletedFor.sort()).toEqual(
      [first.id!.toString(), second.id!.toString()].sort(),
    );
  });
});

describe("the channels people are offered", () => {
  test("the ones that are on, by name, and nothing secret", async () => {
    await CustomNotificationChannelService.getChannelsThatAreOn();

    const call: Record<string, unknown> = findBy.mock.calls[0]![0] as never;
    expect(call["query"]).toEqual({ isEnabled: true });
    expect(call["select"]).toEqual({
      _id: true,
      name: true,
      pageEveryoneByDefault: true,
    });
  });

  test("the ones a person joining gets: on and paging everyone", async () => {
    await CustomNotificationChannelService.getChannelsPagingEveryone();

    const call: Record<string, unknown> = findBy.mock.calls[0]![0] as never;
    expect(call["query"]).toEqual({
      isEnabled: true,
      pageEveryoneByDefault: true,
    });
    expect(Object.keys(call["select"] as object)).not.toContain("webhookUrl");
    expect(Object.keys(call["select"] as object)).not.toContain("secret");
  });
});
