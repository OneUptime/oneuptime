import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ADDING A CHANNEL THAT PAGES EVERYONE TO EVERYBODY'S RULES (Enterprise
 * Edition): AddCustomChannelToEveryonesRules.
 *
 * Every accepted member of every project, once each however many teams they
 * are on, page after page; a channel marked done only once all of them have
 * it, so a run stopped part way is taken up by the next; one channel that
 * fails leaves the others to be done. While custom channels are not active
 * (CustomChannelEdition) a run adds nothing and reads nothing - and the
 * first run once they are active again catches up.
 *
 * Billing and the edition are pinned in every test (ee/README, "Working on
 * ee/"): CI's config.env sets BILLING_ENABLED=true.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    EXTERNAL_FAULT: {},
  };
});

import AddCustomChannelToEveryonesRules from "../../../Server/CustomNotificationChannels/AddCustomChannelToEveryonesRules";
import CustomNotificationChannelService from "Common/Server/Services/CustomNotificationChannelService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import logger from "Common/Server/Utils/Logger";
import CustomNotificationChannel from "Common/Models/DatabaseModels/CustomNotificationChannel";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import EnterpriseFeature, {
  ALL_ENTERPRISE_FEATURES,
} from "Common/Server/Enterprise/EnterpriseFeature";
import FakeEnterpriseModule, {
  createEditionStateCases,
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
  EditionStateCase,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

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

let findMembers: jest.SpyInstance;
let addDefaults: jest.SpyInstance;
let markDone: jest.SpyInstance;
let findChannels: jest.SpyInstance;

beforeEach(() => {
  setTestBillingEnabled(false);
  installFakeEnterpriseModule();

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
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.clearAllMocks();
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
    expect(
      addDefaults.mock.calls.map((call: Array<unknown>): unknown => {
        return call[0];
      }),
    ).toEqual([
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

  test("reads only accepted members, as root, a project's worth at a time, in a stable order", async () => {
    await AddCustomChannelToEveryonesRules.addToEveryonesRules(
      ObjectID.generate(),
    );

    const call: Record<string, unknown> = findMembers.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(call["query"]).toEqual({ hasAcceptedInvitation: true });
    expect(call["select"]).toEqual({
      _id: true,
      projectId: true,
      userId: true,
    });
    expect(call["props"]).toEqual({ isRoot: true });
    expect(call["sort"]).toEqual({ _id: "ASC" });
    expect(call["limit"]).toBe(PAGE_SIZE);
    expect(call["skip"]).toBe(0);
    expect(PAGE_SIZE).toBe(LIMIT_PER_PROJECT);
  });

  test("a person on several teams of one project is added once, whatever the case of their ids", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const userId: ObjectID = ObjectID.generate();

    findMembers.mockResolvedValueOnce([
      member(projectId, userId),
      member(projectId, userId),
      member(projectId, new ObjectID(userId.toString().toUpperCase())),
      member(
        new ObjectID(projectId.toString().toUpperCase()),
        new ObjectID(userId.toString().toUpperCase()),
      ),
    ]);

    expect(
      await AddCustomChannelToEveryonesRules.addToEveryonesRules(
        ObjectID.generate(),
      ),
    ).toBe(1);
    expect(addDefaults).toHaveBeenCalledTimes(1);
  });

  test("a row with no project or no person is skipped", async () => {
    const noProject: TeamMember = new TeamMember();
    noProject.userId = ObjectID.generate();
    const noPerson: TeamMember = new TeamMember();
    noPerson.projectId = ObjectID.generate();

    findMembers.mockResolvedValueOnce([noProject, noPerson]);

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

  test("a full last page is followed by one more read, which ends it", async () => {
    const projectId: ObjectID = ObjectID.generate();

    findMembers.mockResolvedValueOnce(
      Array.from({ length: PAGE_SIZE }, (): TeamMember => {
        return member(projectId, ObjectID.generate());
      }),
    );

    expect(
      await AddCustomChannelToEveryonesRules.addToEveryonesRules(
        ObjectID.generate(),
      ),
    ).toBe(PAGE_SIZE);
    expect(findMembers).toHaveBeenCalledTimes(2);
  });

  test("a person seen on an earlier page is not added again on a later one", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const jane: ObjectID = ObjectID.generate();
    const firstPage: Array<TeamMember> = [
      member(projectId, jane),
      ...Array.from({ length: PAGE_SIZE - 1 }, (): TeamMember => {
        return member(projectId, ObjectID.generate());
      }),
    ];

    findMembers
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([member(projectId, jane)]);

    expect(
      await AddCustomChannelToEveryonesRules.addToEveryonesRules(
        ObjectID.generate(),
      ),
    ).toBe(PAGE_SIZE);
    expect(addDefaults).toHaveBeenCalledTimes(PAGE_SIZE);
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
      ]![0] as Record<string, unknown>;

      expect((call["id"] as ObjectID).toString()).toBe(done.id!.toString());
      expect(
        (call["data"] as Record<string, unknown>)["addedToEveryonesRulesAt"],
      ).toBeInstanceOf(Date);
      expect(call["props"]).toEqual({ isRoot: true, ignoreHooks: true });
    }
  });

  test("its work is the channels that are on, page everyone and are not done, read as root", async () => {
    await AddCustomChannelToEveryonesRules.run();

    const call: Record<string, unknown> = findChannels.mock
      .calls[0]![0] as Record<string, unknown>;
    const query: Record<string, unknown> = call["query"] as Record<
      string,
      unknown
    >;

    expect(query["isEnabled"]).toBe(true);
    expect(query["pageEveryoneByDefault"]).toBe(true);
    expect(query["addedToEveryonesRulesAt"]).toBeDefined();
    expect(call["select"]).toEqual({ _id: true, name: true });
    expect(call["props"]).toEqual({ isRoot: true });
  });

  test("with nothing to do, it writes nothing", async () => {
    expect(await AddCustomChannelToEveryonesRules.run()).toBe(0);
    expect(findMembers).not.toHaveBeenCalled();
    expect(markDone).not.toHaveBeenCalled();
  });

  test("a channel that fails is not marked done, is logged by name, and the others still are done", async () => {
    const failing: CustomNotificationChannel = channel("Failing");
    const working: CustomNotificationChannel = channel("Working");
    findChannels.mockResolvedValue([failing, working]);

    const projectId: ObjectID = ObjectID.generate();
    findMembers.mockResolvedValue([member(projectId, ObjectID.generate())]);

    addDefaults.mockImplementation((async (data: {
      notificationMethod: { customNotificationChannelId?: ObjectID };
    }): Promise<void> => {
      if (
        data.notificationMethod.customNotificationChannelId?.toString() ===
        failing.id!.toString()
      ) {
        throw new Error("boom");
      }
    }) as never);

    const finished: number = await AddCustomChannelToEveryonesRules.run();

    expect(finished).toBe(1);
    expect(markDone).toHaveBeenCalledTimes(1);
    expect(
      (
        (markDone.mock.calls[0]![0] as Record<string, unknown>)[
          "id"
        ] as ObjectID
      ).toString(),
    ).toBe(working.id!.toString());
    expect(logger.error).toHaveBeenCalledWith(
      `Could not add the custom channel ${failing.id!.toString()} (Failing) to everyone's on-call rules. The next run tries again.`,
    );
  });

  test("a channel whose mark cannot be written is not counted, and is taken up by the next run", async () => {
    findChannels.mockResolvedValue([channel("CorpoApp")]);
    markDone.mockRejectedValue(new Error("database down"));

    expect(await AddCustomChannelToEveryonesRules.run()).toBe(0);
  });
});

describe("while custom channels are not active", () => {
  test("the Community Edition: a run adds nothing and reads nothing", async () => {
    uninstallEnterpriseModule();
    findChannels.mockResolvedValue([channel("CorpoApp")]);

    expect(await AddCustomChannelToEveryonesRules.run()).toBe(0);
    expect(findChannels).not.toHaveBeenCalled();
    expect(findMembers).not.toHaveBeenCalled();
    expect(addDefaults).not.toHaveBeenCalled();
    expect(markDone).not.toHaveBeenCalled();
  });

  test("a lapsed license: nothing is added, nor marked done; the first run once it is renewed catches up", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("missing"),
    });
    const corpoApp: CustomNotificationChannel = channel("CorpoApp");
    findChannels.mockResolvedValue([corpoApp]);
    findMembers.mockResolvedValue([
      member(ObjectID.generate(), ObjectID.generate()),
    ]);

    expect(await AddCustomChannelToEveryonesRules.run()).toBe(0);
    expect(findChannels).not.toHaveBeenCalled();
    expect(markDone).not.toHaveBeenCalled();

    fake.setSnapshot(createLicenseSnapshotWithStatus("valid"));

    expect(await AddCustomChannelToEveryonesRules.run()).toBe(1);
    expect(addDefaults).toHaveBeenCalledTimes(1);
    expect(
      (
        (markDone.mock.calls[0]![0] as Record<string, unknown>)[
          "id"
        ] as ObjectID
      ).toString(),
    ).toBe(corpoApp.id!.toString());
  });

  test("a license that leaves custom channels out adds nothing", async () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({
        features: ALL_ENTERPRISE_FEATURES.filter(
          (feature: EnterpriseFeature): boolean => {
            return feature !== EnterpriseFeature.CustomNotificationChannels;
          },
        ),
      }),
    });
    findChannels.mockResolvedValue([channel("CorpoApp")]);

    expect(await AddCustomChannelToEveryonesRules.run()).toBe(0);
    expect(findChannels).not.toHaveBeenCalled();
  });

  test.each(
    createEditionStateCases().map(
      (state: EditionStateCase): [string, EditionStateCase] => {
        return [state.label, state];
      },
    ),
  )("%s", async (_label: string, state: EditionStateCase) => {
    state.apply();
    findChannels.mockResolvedValue([channel("CorpoApp")]);

    const finished: number = await AddCustomChannelToEveryonesRules.run();

    expect({
      finished,
      read: findChannels.mock.calls.length > 0,
    }).toEqual({
      finished: state.isActive ? 1 : 0,
      read: state.isActive,
    });
  });
});
