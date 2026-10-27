import CustomNotificationChannelService from "../../../../Server/Services/CustomNotificationChannelService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import UserNotificationRuleService from "../../../../Server/Services/UserNotificationRuleService";
import AddCustomChannelToEveryonesRules from "../../../../Server/Utils/OnCall/AddCustomChannelToEveryonesRules";
import CustomNotificationChannel from "../../../../Models/DatabaseModels/CustomNotificationChannel";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * Adding a channel that pages everyone to everybody's rules: every accepted
 * member of every project, once each however many teams they are on, page
 * after page; a channel marked done only once all of them have it, so a run
 * stopped part way is taken up by the next; and one channel that fails
 * leaves the others to be done.
 */

const PAGE_SIZE: number = AddCustomChannelToEveryonesRules.PAGE_SIZE;

function member(projectId: ObjectID, userId: ObjectID): TeamMember {
  const row: TeamMember = new TeamMember();
  row._id = ObjectID.generate().toString();
  row.projectId = projectId;
  row.userId = userId;
  return row;
}

function channel(name: string): CustomNotificationChannel {
  const row: CustomNotificationChannel = new CustomNotificationChannel();
  row._id = ObjectID.generate().toString();
  row.name = name;
  return row;
}

let findMembers: jest.SpiedFunction<typeof TeamMemberService.findBy>;
let addDefaults: jest.SpiedFunction<
  typeof UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod
>;
let markDone: jest.SpiedFunction<
  typeof CustomNotificationChannelService.updateOneById
>;
let findChannels: jest.SpiedFunction<typeof CustomNotificationChannelService.findBy>;

beforeEach(() => {
  findMembers = jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([]);
  addDefaults = jest
    .spyOn(
      UserNotificationRuleService,
      "addDefaultNotificationRulesForVerifiedMethod",
    )
    .mockResolvedValue(undefined);
  markDone = jest
    .spyOn(CustomNotificationChannelService, "updateOneById")
    .mockResolvedValue(undefined as never);
  findChannels = jest
    .spyOn(CustomNotificationChannelService, "findBy")
    .mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("addToEveryonesRules", () => {
  test("adds the channel to each accepted member's default rules, in each project", async () => {
    const channelId: ObjectID = ObjectID.generate();
    const projectA: ObjectID = ObjectID.generate();
    const projectB: ObjectID = ObjectID.generate();
    const jane: ObjectID = ObjectID.generate();
    const ravi: ObjectID = ObjectID.generate();

    findMembers.mockResolvedValueOnce([
      member(projectA, jane),
      member(projectA, ravi),
      member(projectB, jane),
    ]);

    const count: number =
      await AddCustomChannelToEveryonesRules.addToEveryonesRules(channelId);

    expect(count).toBe(3);
    expect(addDefaults).toHaveBeenCalledTimes(3);
    expect(addDefaults.mock.calls.map((call: Array<unknown>) => call[0])).toEqual([
      {
        projectId: projectA,
        userId: jane,
        notificationMethod: { customNotificationChannelId: channelId },
      },
      {
        projectId: projectA,
        userId: ravi,
        notificationMethod: { customNotificationChannelId: channelId },
      },
      {
        projectId: projectB,
        userId: jane,
        notificationMethod: { customNotificationChannelId: channelId },
      },
    ]);
  });

  test("reads only accepted members, as root, in a stable order", async () => {
    await AddCustomChannelToEveryonesRules.addToEveryonesRules(
      ObjectID.generate(),
    );

    const call: Record<string, unknown> = findMembers.mock.calls[0]![0] as never;
    expect(call["query"]).toEqual({ hasAcceptedInvitation: true });
    expect(call["props"]).toEqual({ isRoot: true });
    expect(call["sort"]).toEqual({ _id: "ASC" });
  });

  test("a person on several teams of one project is added once", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const userId: ObjectID = ObjectID.generate();

    findMembers.mockResolvedValueOnce([
      member(projectId, userId),
      member(projectId, userId),
      member(projectId, new ObjectID(userId.toString().toUpperCase())),
    ]);

    await AddCustomChannelToEveryonesRules.addToEveryonesRules(
      ObjectID.generate(),
    );

    expect(addDefaults).toHaveBeenCalledTimes(1);
  });

  test("a row with no project or no person is skipped", async () => {
    const half: TeamMember = new TeamMember();
    half.userId = ObjectID.generate();

    findMembers.mockResolvedValueOnce([half]);

    expect(
      await AddCustomChannelToEveryonesRules.addToEveryonesRules(
        ObjectID.generate(),
      ),
    ).toBe(0);
    expect(addDefaults).not.toHaveBeenCalled();
  });

  test("reads page after page until a page is short", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const fullPage: Array<TeamMember> = Array.from(
      { length: PAGE_SIZE },
      (): TeamMember => {
        return member(projectId, ObjectID.generate());
      },
    );

    findMembers
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce([member(projectId, ObjectID.generate())]);

    const count: number =
      await AddCustomChannelToEveryonesRules.addToEveryonesRules(
        ObjectID.generate(),
      );

    expect(findMembers).toHaveBeenCalledTimes(2);
    expect(
      (findMembers.mock.calls[1]![0] as Record<string, unknown>)["skip"],
    ).toBe(PAGE_SIZE);
    expect(count).toBe(PAGE_SIZE + 1);
  });

  test("a rule that cannot be written stops the channel, to be taken up again", async () => {
    findMembers.mockResolvedValueOnce([
      member(ObjectID.generate(), ObjectID.generate()),
    ]);
    addDefaults.mockRejectedValue(new Error("database down"));

    await expect(
      AddCustomChannelToEveryonesRules.addToEveryonesRules(ObjectID.generate()),
    ).rejects.toThrow("database down");
  });
});

describe("run", () => {
  test("does every channel still to do, and marks each done", async () => {
    const corpoApp: CustomNotificationChannel = channel("CorpoApp");
    const pager: CustomNotificationChannel = channel("Pager");
    findChannels.mockResolvedValue([corpoApp, pager]);

    const finished: number = await AddCustomChannelToEveryonesRules.run();

    expect(finished).toBe(2);
    expect(markDone).toHaveBeenCalledTimes(2);

    for (const [index, done] of [corpoApp, pager].entries()) {
      const call: Record<string, unknown> = markDone.mock.calls[
        index
      ]![0] as never;
      expect((call["id"] as ObjectID).toString()).toBe(done.id!.toString());
      expect(
        (call["data"] as Record<string, unknown>)["addedToEveryonesRulesAt"],
      ).toBeInstanceOf(Date);
      expect(call["props"]).toEqual({ isRoot: true, ignoreHooks: true });
    }
  });

  test("its work is the channels that are on, page everyone and are not done", async () => {
    await AddCustomChannelToEveryonesRules.run();

    const call: Record<string, unknown> = findChannels.mock.calls[0]![0] as never;
    const query: Record<string, unknown> = call["query"] as Record<
      string,
      unknown
    >;

    expect(query["isEnabled"]).toBe(true);
    expect(query["pageEveryoneByDefault"]).toBe(true);
    expect(query["addedToEveryonesRulesAt"]).toBeDefined();
    expect(call["props"]).toEqual({ isRoot: true });
  });

  test("with nothing to do, it writes nothing", async () => {
    expect(await AddCustomChannelToEveryonesRules.run()).toBe(0);
    expect(findMembers).not.toHaveBeenCalled();
    expect(markDone).not.toHaveBeenCalled();
  });

  test("a channel that fails is not marked done, and the others still are", async () => {
    const failing: CustomNotificationChannel = channel("Failing");
    const working: CustomNotificationChannel = channel("Working");
    findChannels.mockResolvedValue([failing, working]);

    const projectId: ObjectID = ObjectID.generate();
    findMembers.mockResolvedValue([member(projectId, ObjectID.generate())]);

    addDefaults.mockImplementation(
      async (data: {
        notificationMethod: { customNotificationChannelId?: ObjectID };
      }): Promise<void> => {
        if (
          data.notificationMethod.customNotificationChannelId?.toString() ===
          failing.id!.toString()
        ) {
          throw new Error("boom");
        }
      },
    );

    const finished: number = await AddCustomChannelToEveryonesRules.run();

    expect(finished).toBe(1);
    expect(markDone).toHaveBeenCalledTimes(1);
    expect(
      ((markDone.mock.calls[0]![0] as Record<string, unknown>)[
        "id"
      ] as ObjectID).toString(),
    ).toBe(working.id!.toString());
  });
});
