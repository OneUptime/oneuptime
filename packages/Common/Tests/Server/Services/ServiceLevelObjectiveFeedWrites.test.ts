/*
 * `jest` is the global (as in ServiceLevelObjectiveService.test.ts), not the
 * @jest/globals export: that export's SpiedFunction type does not accept what
 * jest.spyOn returns with this repo's jest-mock version.
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import { ServiceLevelObjectiveFeedEventType } from "../../../Models/DatabaseModels/ServiceLevelObjectiveFeed";
import User from "../../../Models/DatabaseModels/User";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import ServiceLevelObjectiveBurnRateRuleService from "../../../Server/Services/ServiceLevelObjectiveBurnRateRuleService";
import ServiceLevelObjectiveFeedService from "../../../Server/Services/ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveMonitorRuleEngineService from "../../../Server/Services/ServiceLevelObjectiveMonitorRuleEngineService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import logger from "../../../Server/Utils/Logger";
import SloFeedUtil from "../../../Server/Utils/Slo/SloFeedUtil";
import URL from "../../../Types/API/URL";
import {
  Blue500,
  Gray500,
  Green500,
  Orange500,
  Yellow500,
} from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";

/*
 * Contract under test: the SLO feed items ServiceLevelObjectiveService writes
 * about its own lifecycle.
 *
 * The SLO row is the busiest row in the product. The evaluation worker writes
 * it on every tick for every SLO, the cadence stamps go through the same
 * update hook, and the monitor rule engine rewrites its monitor set whenever a
 * monitor changes. So the properties that matter most are the ones about
 * restraint:
 *
 *   - a write that touches no watched column costs NO read and posts nothing;
 *   - a watched column re-submitted unchanged posts nothing;
 *   - the rule engine's root monitor writes are never described here (the
 *     engine posts its own attach/detach items), so nothing is said twice;
 *   - no feed failure can fail the create or update it describes.
 *
 * And the ones about honesty: who did it, what it was before and after, with
 * every user-controlled name escaped.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SLO_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_SLO_ID: ObjectID = new ObjectID(
  "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const MONITOR_A: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MONITOR_B: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MONITOR_C: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MONITOR_D: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const LABEL_PRODUCTION: string = "44444444-4444-4444-8444-444444444444";
const LABEL_TIER_ONE: string = "55555555-5555-4555-8555-555555555555";

const DASHBOARD_URL: string = "https://oneuptime.test/dashboard";
const SLO_LINK: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/slos/${SLO_ID.toString()}`;
const USER_LINK: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/settings/users/${USER_ID.toString()}`;
const POSTED_AT: Date = new Date("2026-09-15T10:00:00.000Z");

interface FeedCall {
  serviceLevelObjectiveId: ObjectID;
  projectId: ObjectID;
  serviceLevelObjectiveFeedEventType: ServiceLevelObjectiveFeedEventType;
  feedInfoInMarkdown: string;
  moreInformationInMarkdown?: string | undefined;
  displayColor?: Color | undefined;
  userId?: ObjectID | undefined;
  postedAt?: Date | undefined;
}

interface UpdateByShape {
  query: Record<string, unknown>;
  data: Record<string, unknown>;
  props: Record<string, unknown>;
  limit: number;
  skip: number;
}

interface SnapshotShape {
  columns: Array<{ column: string }>;
  rowsById: Record<string, ServiceLevelObjective>;
}

interface PrivateWriters {
  writeSloCreatedFeed: (data: unknown) => Promise<void>;
  writeSloUpdatedFeed: (data: unknown) => Promise<void>;
}

let feedCalls: Array<FeedCall> = [];

// Calls a protected or private member without widening the service's surface.
function callHook(name: string, ...args: Array<unknown>): Promise<unknown> {
  const members: Record<
    string,
    (...memberArgs: Array<unknown>) => Promise<unknown>
  > = ServiceLevelObjectiveService as unknown as Record<
    string,
    (...memberArgs: Array<unknown>) => Promise<unknown>
  >;

  return members[name]!.apply(ServiceLevelObjectiveService, args);
}

function privateWriters(): PrivateWriters {
  return ServiceLevelObjectiveService as unknown as PrivateWriters;
}

/*
 * Lets fire-and-forget work that only awaits settled mocks run to completion.
 * setTimeout rather than setImmediate: this suite runs under jsdom, which has
 * no setImmediate.
 */
async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
}

function sloRow(
  fields: Record<string, unknown>,
  id: ObjectID = SLO_ID,
): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective(id);
  slo.projectId = PROJECT_ID;
  slo.name = "Checkout availability";
  slo.isEnabled = true;
  slo.isArchived = false;
  Object.assign(slo, fields);
  return slo;
}

function monitorRow(id: string, name: string): Monitor {
  const monitor: Monitor = new Monitor(new ObjectID(id));
  monitor.name = name;
  return monitor;
}

function labelRow(id: string, name: string): Label {
  const label: Label = new Label(new ObjectID(id));
  label.name = name;
  return label;
}

function makeUpdateBy(
  data: Record<string, unknown>,
  props: Record<string, unknown>,
): UpdateByShape {
  return {
    query: { _id: SLO_ID.toString() },
    data: data,
    props: props,
    limit: 1,
    skip: 0,
  };
}

function monitorLink(id: string): string {
  return `${DASHBOARD_URL}/${PROJECT_ID.toString()}/monitors/${id}`;
}

beforeEach(() => {
  feedCalls = [];

  jest
    .spyOn(
      ServiceLevelObjectiveFeedService,
      "createServiceLevelObjectiveFeedItem",
    )
    .mockImplementation((data: FeedCall): Promise<void> => {
      feedCalls.push(data);
      return Promise.resolve();
    });

  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString(DASHBOARD_URL));

  const jane: User = new User(USER_ID);
  jane.name = new Name("Jane Doe");

  jest.spyOn(UserService, "findOneById").mockResolvedValue(jane);
  jest
    .spyOn(UserService, "getUserLinkInDashboard")
    .mockResolvedValue(URL.fromString(USER_LINK));

  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ServiceLevelObjectiveService - the created item", () => {
  const SEEDED_RULES: Array<ServiceLevelObjectiveBurnRateRule> = [
    Object.assign(new ServiceLevelObjectiveBurnRateRule(), {
      name: "Fast burn",
      burnRateThreshold: 14.4,
      longWindowInMinutes: 60,
      shortWindowInMinutes: 5,
    }),
    Object.assign(new ServiceLevelObjectiveBurnRateRule(), {
      name: "Slow burn",
      burnRateThreshold: 6,
      longWindowInMinutes: 360,
      shortWindowInMinutes: 30,
    }),
  ];

  function createdSlo(
    fields: Record<string, unknown> = {},
  ): ServiceLevelObjective {
    return sloRow({
      targetPercentage: 99.9,
      windowType: SloWindowType.Rolling,
      windowDays: 30,
      sliType: SliType.MonitorUptime,
      atRiskThresholdPercentage: 20,
      ...fields,
    });
  }

  test("names who created it, what it promises, and the default rules that came with it", async () => {
    await callHook("writeSloCreatedFeed", {
      onCreate: {
        createBy: { props: { userId: USER_ID } },
        carryForward: null,
      },
      createdItem: createdSlo(),
      seededBurnRateRules: SEEDED_RULES,
      postedAt: POSTED_AT,
    });

    expect(feedCalls).toHaveLength(1);

    const item: FeedCall = feedCalls[0]!;

    expect(item.serviceLevelObjectiveFeedEventType).toBe(
      ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveCreated,
    );
    expect(item.serviceLevelObjectiveId.toString()).toBe(SLO_ID.toString());
    expect(item.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(item.displayColor).toBe(Green500);
    expect(item.userId).toBe(USER_ID);
    expect(item.postedAt).toBe(POSTED_AT);
    expect(item.feedInfoInMarkdown).toBe(
      `🎯 [SLO Checkout availability](${SLO_LINK}) was created by **[Jane Doe](${USER_LINK})**.`,
    );
    expect(item.moreInformationInMarkdown).toContain("**Target**: 99.9%");
    expect(item.moreInformationInMarkdown).toContain(
      "**Compliance window**: Rolling 30 days",
    );
    expect(item.moreInformationInMarkdown).toContain(
      "**Default burn rate rules**: Fast burn (burn rate above 14.4x over 1 hour, confirmed over 5 minutes); Slow burn (burn rate above 6x over 6 hours, confirmed over 30 minutes)",
    );
  });

  test("prefers the row's own createdByUserId over the request's", async () => {
    const rowUserId: ObjectID = new ObjectID(
      "66666666-6666-4666-8666-666666666666",
    );

    await callHook("writeSloCreatedFeed", {
      onCreate: {
        createBy: { props: { userId: USER_ID } },
        carryForward: null,
      },
      createdItem: createdSlo({ createdByUserId: rowUserId }),
      seededBurnRateRules: [],
      postedAt: POSTED_AT,
    });

    expect(feedCalls[0]!.userId).toBe(rowUserId);
  });

  test("a create with no acting user says so, and looks nobody up", async () => {
    await callHook("writeSloCreatedFeed", {
      onCreate: { createBy: { props: { isRoot: true } }, carryForward: null },
      createdItem: createdSlo(),
      seededBurnRateRules: [],
      postedAt: POSTED_AT,
    });

    expect(feedCalls[0]!.feedInfoInMarkdown).toBe(
      `🎯 [SLO Checkout availability](${SLO_LINK}) was created.`,
    );
    expect(feedCalls[0]!.moreInformationInMarkdown).toContain(
      "**Created by**: No user",
    );
    expect(feedCalls[0]!.userId).toBeUndefined();
    expect(UserService.findOneById).not.toHaveBeenCalled();
  });

  test("a creator who no longer exists is neither named nor given the avatar", async () => {
    jest.spyOn(UserService, "findOneById").mockResolvedValue(null);

    await callHook("writeSloCreatedFeed", {
      onCreate: {
        createBy: { props: { userId: USER_ID } },
        carryForward: null,
      },
      createdItem: createdSlo(),
      seededBurnRateRules: [],
      postedAt: POSTED_AT,
    });

    expect(feedCalls[0]!.feedInfoInMarkdown).toBe(
      `🎯 [SLO Checkout availability](${SLO_LINK}) was created.`,
    );
    expect(feedCalls[0]!.userId).toBeUndefined();
  });

  test("a hostile SLO name cannot re-point the link", async () => {
    await callHook("writeSloCreatedFeed", {
      onCreate: { createBy: { props: {} }, carryForward: null },
      createdItem: createdSlo({
        name: "x](https://evil.example) ![p](https://t.example/p.png)",
      }),
      seededBurnRateRules: [],
      postedAt: POSTED_AT,
    });

    expect(feedCalls[0]!.feedInfoInMarkdown).toBe(
      `🎯 [SLO x\\]\\(https://evil.example\\) \\!\\[p\\]\\(https://t.example/p.png\\)](${SLO_LINK}) was created.`,
    );
  });

  test("an SLO row without an id or project posts nothing", async () => {
    const slo: ServiceLevelObjective = new ServiceLevelObjective();
    slo.name = "No identity";

    await callHook("writeSloCreatedFeed", {
      onCreate: { createBy: { props: {} }, carryForward: null },
      createdItem: slo,
      seededBurnRateRules: [],
      postedAt: POSTED_AT,
    });

    expect(feedCalls).toHaveLength(0);
  });
});

describe("ServiceLevelObjectiveService.onCreateSuccess - feed wiring", () => {
  const CREATED_AT: Date = new Date("2026-09-15T09:59:59.000Z");

  let seedingFlagsAtRuleCreate: Array<boolean> = [];

  beforeEach(() => {
    seedingFlagsAtRuleCreate = [];

    jest
      .spyOn(ServiceLevelObjectiveService, "updateOneById")
      .mockResolvedValue(1);
    jest.spyOn(AlertSeverityService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(
        ServiceLevelObjectiveMonitorRuleEngineService,
        "syncMonitorsForSlo",
      )
      .mockResolvedValue(undefined as never);

    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "create")
      .mockImplementation(
        (
          createBy: CreateBy<ServiceLevelObjectiveBurnRateRule>,
        ): Promise<ServiceLevelObjectiveBurnRateRule> => {
          seedingFlagsAtRuleCreate.push(
            SloFeedUtil.isSeedingDefaultBurnRateRules(SLO_ID),
          );
          return Promise.resolve(createBy.data);
        },
      );
  });

  function onCreate(): unknown {
    return {
      createBy: { data: sloRow({}), props: { userId: USER_ID } },
      carryForward: null,
    };
  }

  test("seeds the default rules under the seeding flag, so they post no items of their own, and clears it", async () => {
    jest
      .spyOn(privateWriters(), "writeSloCreatedFeed")
      .mockResolvedValue(undefined);

    await callHook(
      "onCreateSuccess",
      onCreate(),
      sloRow({ createdAt: CREATED_AT }),
    );

    expect(seedingFlagsAtRuleCreate).toEqual([true, true]);
    expect(SloFeedUtil.isSeedingDefaultBurnRateRules(SLO_ID)).toBe(false);
  });

  test("hands the rules it seeded, and the row's creation time, to the created item", async () => {
    const writerSpy: jest.SpyInstance = jest
      .spyOn(privateWriters(), "writeSloCreatedFeed")
      .mockResolvedValue(undefined);

    await callHook(
      "onCreateSuccess",
      onCreate(),
      sloRow({ createdAt: CREATED_AT }),
    );

    expect(writerSpy).toHaveBeenCalledTimes(1);

    const args: {
      seededBurnRateRules: Array<ServiceLevelObjectiveBurnRateRule>;
      postedAt: Date;
    } = writerSpy.mock.calls[0]![0] as {
      seededBurnRateRules: Array<ServiceLevelObjectiveBurnRateRule>;
      postedAt: Date;
    };

    expect(
      args.seededBurnRateRules.map(
        (rule: ServiceLevelObjectiveBurnRateRule): string | undefined => {
          return rule.name;
        },
      ),
    ).toEqual(["Fast burn", "Slow burn"]);
    // The row's time, so the item sorts ahead of the owner the create adds next.
    expect(args.postedAt).toBe(CREATED_AT);
  });

  test("a default rule that failed to seed is left out of the created item", async () => {
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "create")
      .mockRejectedValueOnce(new Error("fast burn failed"))
      .mockImplementation(
        (
          createBy: CreateBy<ServiceLevelObjectiveBurnRateRule>,
        ): Promise<ServiceLevelObjectiveBurnRateRule> => {
          return Promise.resolve(createBy.data);
        },
      );

    const writerSpy: jest.SpyInstance = jest
      .spyOn(privateWriters(), "writeSloCreatedFeed")
      .mockResolvedValue(undefined);

    await callHook("onCreateSuccess", onCreate(), sloRow({}));

    const args: {
      seededBurnRateRules: Array<ServiceLevelObjectiveBurnRateRule>;
    } = writerSpy.mock.calls[0]![0] as {
      seededBurnRateRules: Array<ServiceLevelObjectiveBurnRateRule>;
    };

    expect(
      args.seededBurnRateRules.map(
        (rule: ServiceLevelObjectiveBurnRateRule): string | undefined => {
          return rule.name;
        },
      ),
    ).toEqual(["Slow burn"]);
  });

  test("does not wait for the created item, and a failing one never fails the create", async () => {
    // A writer that never settles: the create must still return.
    jest
      .spyOn(privateWriters(), "writeSloCreatedFeed")
      .mockReturnValue(new Promise<void>((): void => {}));

    const created: ServiceLevelObjective = sloRow({});

    await expect(
      callHook("onCreateSuccess", onCreate(), created),
    ).resolves.toBe(created);

    jest
      .spyOn(privateWriters(), "writeSloCreatedFeed")
      .mockRejectedValue(new Error("feed down"));

    await expect(
      callHook("onCreateSuccess", onCreate(), created),
    ).resolves.toBe(created);

    await flushPromises();

    expect(logger.error).toHaveBeenCalled();
  });
});

describe("ServiceLevelObjectiveService.onBeforeUpdate - the before-snapshot", () => {
  let findBySpy: jest.SpyInstance;

  beforeEach(() => {
    findBySpy = jest
      .spyOn(ServiceLevelObjectiveService, "findBy")
      .mockResolvedValue([sloRow({ targetPercentage: 99.9 })]);
  });

  test("the evaluation worker's per-tick state write reads nothing, carries nothing and posts nothing", async () => {
    const writerSpy: jest.SpyInstance = jest.spyOn(
      privateWriters(),
      "writeSloUpdatedFeed",
    );
    const findOneByIdSpy: jest.SpyInstance = jest.spyOn(
      ServiceLevelObjectiveService,
      "findOneById",
    );

    const updateBy: UpdateByShape = makeUpdateBy(
      {
        currentSliPercentage: 99.1,
        errorBudgetRemainingPercentage: 42,
        errorBudgetRemainingSeconds: 1089,
        errorBudgetTotalSeconds: 2592,
        currentBurnRate: 1.4,
        sloStatus: SloStatus.AtRisk,
      },
      { isRoot: true },
    );

    const onUpdate: { carryForward: { feedSnapshot: unknown } } =
      (await callHook("onBeforeUpdate", updateBy)) as {
        carryForward: { feedSnapshot: unknown };
      };

    expect(onUpdate.carryForward.feedSnapshot).toBeNull();

    await callHook("onUpdateSuccess", onUpdate, [SLO_ID]);
    await flushPromises();

    expect(findBySpy).not.toHaveBeenCalled();
    expect(findOneByIdSpy).not.toHaveBeenCalled();
    expect(writerSpy).not.toHaveBeenCalled();
    expect(feedCalls).toHaveLength(0);
  });

  test("the cadence stamps read nothing", async () => {
    const onUpdate: { carryForward: { feedSnapshot: unknown } } =
      (await callHook(
        "onBeforeUpdate",
        makeUpdateBy({ nextEvaluationAt: POSTED_AT }, { isRoot: true }),
      )) as { carryForward: { feedSnapshot: unknown } };

    expect(onUpdate.carryForward.feedSnapshot).toBeNull();
    expect(findBySpy).not.toHaveBeenCalled();
  });

  test("the monitor rule engine's root membership write reads nothing - the engine describes its own changes", async () => {
    const onUpdate: { carryForward: { feedSnapshot: unknown } } =
      (await callHook(
        "onBeforeUpdate",
        makeUpdateBy(
          {
            monitors: [{ _id: MONITOR_A }],
            autoAddedMonitors: [{ _id: MONITOR_A }],
          },
          { isRoot: true },
        ),
      )) as { carryForward: { feedSnapshot: unknown } };

    expect(onUpdate.carryForward.feedSnapshot).toBeNull();
    expect(findBySpy).not.toHaveBeenCalled();
  });

  test("a watched edit reads the matched SLOs once, as root, through the caller's own query pinned to the caller's project", async () => {
    const onUpdate: { carryForward: { feedSnapshot: SnapshotShape } } =
      (await callHook(
        "onBeforeUpdate",
        makeUpdateBy(
          { name: "Checkout" },
          { userId: USER_ID, tenantId: PROJECT_ID },
        ),
      )) as { carryForward: { feedSnapshot: SnapshotShape } };

    expect(findBySpy).toHaveBeenCalledTimes(1);

    const findByArgs: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      limit: number;
      skip: number;
      props: Record<string, unknown>;
    } = findBySpy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      limit: number;
      skip: number;
      props: Record<string, unknown>;
    };

    /*
     * Pinned to the caller's project: this hook runs before DatabaseService
     * applies permissions, so the raw query could otherwise match an SLO in a
     * project the caller cannot see.
     */
    expect(findByArgs.query).toEqual({
      _id: SLO_ID.toString(),
      projectId: PROJECT_ID,
    });
    expect(findByArgs.limit).toBe(1);
    expect(findByArgs.skip).toBe(0);
    expect(findByArgs.props).toEqual({ isRoot: true });
    expect(findByArgs.select).toEqual({
      _id: true,
      projectId: true,
      name: true,
      isEnabled: true,
      isArchived: true,
    });

    expect(
      onUpdate.carryForward.feedSnapshot.columns.map(
        (column: { column: string }): string => {
          return column.column;
        },
      ),
    ).toEqual(["name"]);
    expect(Object.keys(onUpdate.carryForward.feedSnapshot.rowsById)).toEqual([
      SLO_ID.toString(),
    ]);
  });

  test("a payload the validators reject never costs a read", async () => {
    await expect(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy({ targetPercentage: 100 }, { userId: USER_ID }),
      ),
    ).rejects.toThrow("SLO target must be greater than 0");

    expect(findBySpy).not.toHaveBeenCalled();
  });

  test("a failed read never blocks the update", async () => {
    findBySpy.mockRejectedValue(new Error("replica lag"));

    const onUpdate: { carryForward: { feedSnapshot: unknown } } =
      (await callHook(
        "onBeforeUpdate",
        makeUpdateBy({ name: "Checkout" }, { userId: USER_ID }),
      )) as { carryForward: { feedSnapshot: unknown } };

    expect(onUpdate.carryForward.feedSnapshot).toBeNull();
  });

  test("a key carrying undefined is not a write and reads nothing", async () => {
    await callHook(
      "onBeforeUpdate",
      makeUpdateBy({ name: undefined }, { userId: USER_ID }),
    );

    expect(findBySpy).not.toHaveBeenCalled();
  });

  test("a hand-made monitor edit snapshots the monitor names; a root one takes no snapshot at all", async () => {
    const handMade: SnapshotShape | null = (await callHook(
      "readFeedSnapshotBeforeUpdate",
      makeUpdateBy({ monitors: [{ _id: MONITOR_A }] }, { userId: USER_ID }),
    )) as SnapshotShape | null;

    expect(handMade).not.toBeNull();
    expect(
      (findBySpy.mock.calls[0]![0] as { select: Record<string, unknown> })
        .select["monitors"],
    ).toEqual({ _id: true, name: true });

    const root: SnapshotShape | null = (await callHook(
      "readFeedSnapshotBeforeUpdate",
      makeUpdateBy({ monitors: [{ _id: MONITOR_A }] }, { isRoot: true }),
    )) as SnapshotShape | null;

    expect(root).toBeNull();
    expect(findBySpy).toHaveBeenCalledTimes(1);
  });
});

describe("ServiceLevelObjectiveService - the items an update posts", () => {
  /*
   * Drives the real snapshot and the real writer end to end, with only the
   * two reads stubbed: the row before the write and the row after it.
   */
  async function writeUpdatedFeed(data: {
    payload: Record<string, unknown>;
    props: Record<string, unknown>;
    before: Array<ServiceLevelObjective>;
    after: ServiceLevelObjective | null;
    ids?: Array<ObjectID> | undefined;
  }): Promise<void> {
    jest
      .spyOn(ServiceLevelObjectiveService, "findBy")
      .mockResolvedValue(data.before);
    jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(data.after);

    const updateBy: UpdateByShape = makeUpdateBy(data.payload, data.props);

    const snapshot: unknown = await callHook(
      "readFeedSnapshotBeforeUpdate",
      updateBy,
    );

    await callHook("writeSloUpdatedFeed", {
      onUpdate: {
        updateBy: updateBy,
        carryForward: { feedSnapshot: snapshot },
      },
      updatedItemIds: data.ids || [SLO_ID],
      postedAt: POSTED_AT,
    });
  }

  test("a real edit posts old -> new, attributed to whoever made it", async () => {
    await writeUpdatedFeed({
      payload: { targetPercentage: 99.95, windowDays: 7 },
      props: { userId: USER_ID },
      before: [sloRow({ targetPercentage: 99.9, windowDays: 30 })],
      after: sloRow({ targetPercentage: 99.95, windowDays: 7 }),
    });

    expect(feedCalls).toHaveLength(1);

    const item: FeedCall = feedCalls[0]!;

    expect(item.serviceLevelObjectiveFeedEventType).toBe(
      ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveUpdated,
    );
    expect(item.displayColor).toBe(Gray500);
    expect(item.userId).toBe(USER_ID);
    expect(item.postedAt).toBe(POSTED_AT);
    expect(item.feedInfoInMarkdown).toBe(
      `📝 [SLO Checkout availability](${SLO_LINK}) was updated: **Target** and **Rolling window length** changed.`,
    );
    expect(item.moreInformationInMarkdown).toBe(
      "**Target**: 99.9% → 99.95%\n\n**Rolling window length**: 30 days → 7 days",
    );
  });

  test("a settings form re-submitted unchanged posts nothing, and looks nothing else up", async () => {
    await writeUpdatedFeed({
      payload: {
        name: "Checkout availability",
        targetPercentage: "99.9",
        timezone: "",
        labels: [{ _id: LABEL_TIER_ONE }, { _id: LABEL_PRODUCTION }],
        isEnabled: true,
        isArchived: false,
      },
      props: { userId: USER_ID },
      before: [
        sloRow({
          targetPercentage: 99.9,
          timezone: null,
          labels: [
            labelRow(LABEL_PRODUCTION, "Production"),
            labelRow(LABEL_TIER_ONE, "Tier 1"),
          ],
        }),
      ],
      after: sloRow({
        targetPercentage: 99.9,
        timezone: null,
        labels: [
          labelRow(LABEL_TIER_ONE, "Tier 1"),
          labelRow(LABEL_PRODUCTION, "Production"),
        ],
      }),
    });

    expect(feedCalls).toHaveLength(0);
    // Not even the link: nothing was going to be said.
    expect(DatabaseConfig.getDashboardUrl).not.toHaveBeenCalled();
  });

  test("a rename is described with both names escaped, and links under the new name", async () => {
    await writeUpdatedFeed({
      payload: { name: "x](https://evil.example)" },
      props: { userId: USER_ID },
      before: [sloRow({ name: "Checkout" })],
      after: sloRow({ name: "x](https://evil.example)" }),
    });

    expect(feedCalls[0]!.feedInfoInMarkdown).toBe(
      `📝 [SLO x\\]\\(https://evil.example\\)](${SLO_LINK}) was updated: **Name** changed from Checkout to x\\]\\(https://evil.example\\).`,
    );
  });

  test("a label added to the set is named", async () => {
    await writeUpdatedFeed({
      payload: {
        labels: [{ _id: LABEL_PRODUCTION }, { _id: LABEL_TIER_ONE }],
      },
      props: { userId: USER_ID },
      before: [sloRow({ labels: [labelRow(LABEL_PRODUCTION, "Production")] })],
      after: sloRow({
        labels: [
          labelRow(LABEL_PRODUCTION, "Production"),
          labelRow(LABEL_TIER_ONE, "Tier 1"),
        ],
      }),
    });

    expect(feedCalls[0]!.feedInfoInMarkdown).toContain(
      "**Labels** changed from Production to Production, Tier 1.",
    );
  });

  test.each([
    {
      label: "disabling",
      payload: { isEnabled: false },
      before: { isEnabled: true },
      after: { isEnabled: false },
      eventType:
        ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveDisabled,
      color: Gray500,
      summary: "was disabled.",
    },
    {
      label: "enabling",
      payload: { isEnabled: true },
      before: { isEnabled: false },
      after: { isEnabled: true },
      eventType:
        ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveEnabled,
      color: Green500,
      summary: "was enabled.",
    },
    {
      label: "archiving",
      payload: { isArchived: true },
      before: { isArchived: false },
      after: { isArchived: true },
      eventType:
        ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveArchived,
      color: Yellow500,
      summary: "was archived.",
    },
    {
      label: "restoring",
      payload: { isArchived: false },
      before: { isArchived: true },
      after: { isArchived: false },
      eventType:
        ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveRestored,
      color: Blue500,
      summary: "was restored from the archive.",
    },
  ])(
    "$label posts its own item",
    async (row: {
      payload: Record<string, unknown>;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
      eventType: ServiceLevelObjectiveFeedEventType;
      color: Color;
      summary: string;
    }) => {
      await writeUpdatedFeed({
        payload: row.payload,
        props: { userId: USER_ID },
        before: [sloRow(row.before)],
        after: sloRow(row.after),
      });

      expect(feedCalls).toHaveLength(1);
      expect(feedCalls[0]!.serviceLevelObjectiveFeedEventType).toBe(
        row.eventType,
      );
      expect(feedCalls[0]!.displayColor).toBe(row.color);
      expect(feedCalls[0]!.feedInfoInMarkdown).toBe(
        `${feedCalls[0]!.feedInfoInMarkdown.split(" ")[0]} [SLO Checkout availability](${SLO_LINK}) ${row.summary}`,
      );
      expect(feedCalls[0]!.userId).toBe(USER_ID);
    },
  );

  test.each([
    {
      label: "an enable toggle that was already on",
      payload: { isEnabled: true },
      state: { isEnabled: true },
    },
    {
      label: "a disable sent as the string 'false' to an already-disabled SLO",
      payload: { isEnabled: "false" },
      state: { isEnabled: false },
    },
    {
      label: "an archive of an SLO that is already archived",
      payload: { isArchived: true },
      state: { isArchived: true },
    },
  ])(
    "$label posts nothing",
    async (row: {
      payload: Record<string, unknown>;
      state: Record<string, unknown>;
    }) => {
      await writeUpdatedFeed({
        payload: row.payload,
        props: { userId: USER_ID },
        before: [sloRow(row.state)],
        after: sloRow(row.state),
      });

      expect(feedCalls).toHaveLength(0);
    },
  );

  test("archiving and disabling in one write posts both, with the archive wording honest about both flags", async () => {
    await writeUpdatedFeed({
      payload: { isArchived: true, isEnabled: false },
      props: { userId: USER_ID },
      before: [sloRow({ isArchived: false, isEnabled: true })],
      after: sloRow({ isArchived: true, isEnabled: false }),
    });

    expect(
      feedCalls.map((item: FeedCall): ServiceLevelObjectiveFeedEventType => {
        return item.serviceLevelObjectiveFeedEventType;
      }),
    ).toEqual([
      ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveArchived,
      ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveDisabled,
    ]);
  });

  test("a hand-made monitor edit posts what was attached and what was detached", async () => {
    await writeUpdatedFeed({
      payload: { monitors: [{ _id: MONITOR_B }, { _id: MONITOR_C }] },
      props: { userId: USER_ID, tenantId: PROJECT_ID },
      before: [
        sloRow({
          monitors: [
            monitorRow(MONITOR_A, "API"),
            monitorRow(MONITOR_B, "Web"),
          ],
        }),
      ],
      after: sloRow({
        monitors: [
          monitorRow(MONITOR_B, "Web"),
          monitorRow(MONITOR_C, "Worker"),
        ],
      }),
    });

    expect(feedCalls).toHaveLength(2);

    const attached: FeedCall = feedCalls.find((item: FeedCall): boolean => {
      return (
        item.serviceLevelObjectiveFeedEventType ===
        ServiceLevelObjectiveFeedEventType.MonitorsAttached
      );
    })!;
    const detached: FeedCall = feedCalls.find((item: FeedCall): boolean => {
      return (
        item.serviceLevelObjectiveFeedEventType ===
        ServiceLevelObjectiveFeedEventType.MonitorsDetached
      );
    })!;

    expect(attached.displayColor).toBe(Blue500);
    expect(attached.userId).toBe(USER_ID);
    expect(attached.feedInfoInMarkdown).toBe(
      `🔗 Monitor [Worker](${monitorLink(MONITOR_C)}) was attached to [SLO Checkout availability](${SLO_LINK}).`,
    );

    expect(detached.displayColor).toBe(Orange500);
    expect(detached.feedInfoInMarkdown).toBe(
      `✂️ Monitor [API](${monitorLink(MONITOR_A)}) was detached from [SLO Checkout availability](${SLO_LINK}).`,
    );
  });

  test("the new monitor set comes from the payload, so a rule sync that lands first is not described twice", async () => {
    await writeUpdatedFeed({
      payload: { monitors: [{ _id: MONITOR_A }, { _id: MONITOR_B }] },
      props: { userId: USER_ID },
      before: [sloRow({ monitors: [monitorRow(MONITOR_A, "API")] })],
      // A rule sync already attached D by the time this writer re-reads.
      after: sloRow({
        monitors: [
          monitorRow(MONITOR_A, "API"),
          monitorRow(MONITOR_B, "Web"),
          monitorRow(MONITOR_D, "Rule-owned"),
        ],
      }),
    });

    expect(feedCalls).toHaveLength(1);
    expect(feedCalls[0]!.feedInfoInMarkdown).toContain(
      `[Web](${monitorLink(MONITOR_B)})`,
    );
    expect(feedCalls[0]!.feedInfoInMarkdown).not.toContain("Rule-owned");
  });

  test("the same monitor written with a different id case is not a change", async () => {
    await writeUpdatedFeed({
      payload: { monitors: [{ _id: MONITOR_A.toUpperCase() }] },
      props: { userId: USER_ID },
      before: [sloRow({ monitors: [monitorRow(MONITOR_A, "API")] })],
      after: sloRow({ monitors: [monitorRow(MONITOR_A, "API")] }),
    });

    expect(feedCalls).toHaveLength(0);
  });

  test("the rule engine's root monitor write is never described here", async () => {
    await writeUpdatedFeed({
      payload: {
        monitors: [{ _id: MONITOR_A }, { _id: MONITOR_B }],
        autoAddedMonitors: [{ _id: MONITOR_B }],
      },
      props: { isRoot: true },
      before: [sloRow({ monitors: [monitorRow(MONITOR_A, "API")] })],
      after: sloRow({
        monitors: [monitorRow(MONITOR_A, "API"), monitorRow(MONITOR_B, "Web")],
      }),
    });

    expect(feedCalls).toHaveLength(0);
    expect(ServiceLevelObjectiveService.findOneById).not.toHaveBeenCalled();
  });

  test("an automation editing a watched column as root is described, with nobody named", async () => {
    await writeUpdatedFeed({
      payload: { description: "Now includes payment" },
      props: { isRoot: true },
      before: [sloRow({ description: "Checkout only" })],
      after: sloRow({ description: "Now includes payment" }),
    });

    expect(feedCalls).toHaveLength(1);
    expect(feedCalls[0]!.userId).toBeUndefined();
    expect(feedCalls[0]!.feedInfoInMarkdown).toBe(
      `📝 [SLO Checkout availability](${SLO_LINK}) was updated: **Description** changed.`,
    );
  });

  test("an SLO the snapshot never saw, or that is gone after the write, is skipped", async () => {
    await writeUpdatedFeed({
      payload: { name: "Renamed" },
      props: { userId: USER_ID },
      before: [],
      after: sloRow({ name: "Renamed" }),
    });

    await writeUpdatedFeed({
      payload: { name: "Renamed" },
      props: { userId: USER_ID },
      before: [sloRow({ name: "Checkout" })],
      after: null,
    });

    expect(feedCalls).toHaveLength(0);
  });

  test("one SLO failing to re-read does not cost the next one its item", async () => {
    jest
      .spyOn(ServiceLevelObjectiveService, "findBy")
      .mockResolvedValue([
        sloRow({ name: "First" }),
        sloRow({ name: "Second" }, OTHER_SLO_ID),
      ]);
    jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockRejectedValueOnce(new Error("row locked"))
      .mockResolvedValueOnce(sloRow({ name: "Second, renamed" }, OTHER_SLO_ID));

    const updateBy: UpdateByShape = {
      query: {},
      data: { name: "Renamed" },
      props: { userId: USER_ID },
      limit: 10,
      skip: 0,
    };

    const snapshot: unknown = await callHook(
      "readFeedSnapshotBeforeUpdate",
      updateBy,
    );

    await callHook("writeSloUpdatedFeed", {
      onUpdate: {
        updateBy: updateBy,
        carryForward: { feedSnapshot: snapshot },
      },
      updatedItemIds: [SLO_ID, OTHER_SLO_ID],
      postedAt: POSTED_AT,
    });

    expect(feedCalls).toHaveLength(1);
    expect(feedCalls[0]!.serviceLevelObjectiveId.toString()).toBe(
      OTHER_SLO_ID.toString(),
    );
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("ServiceLevelObjectiveService.onUpdateSuccess - feed wiring", () => {
  beforeEach(() => {
    jest
      .spyOn(
        ServiceLevelObjectiveService,
        "resolveOpenBurnRateAlertsAndIncidentsForSlo",
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(ServiceLevelObjectiveService, "updateOneById")
      .mockResolvedValue(1);
    jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(sloRow({}));
  });

  test("starts the writer when there is a snapshot, and does not wait for it", async () => {
    const writerSpy: jest.SpyInstance = jest
      .spyOn(privateWriters(), "writeSloUpdatedFeed")
      .mockReturnValue(new Promise<void>((): void => {}));

    const onUpdate: unknown = {
      updateBy: makeUpdateBy({ name: "Renamed" }, { userId: USER_ID }),
      carryForward: {
        feedSnapshot: { columns: [{ column: "name" }], rowsById: {} },
      },
    };

    await expect(callHook("onUpdateSuccess", onUpdate, [SLO_ID])).resolves.toBe(
      onUpdate,
    );

    expect(writerSpy).toHaveBeenCalledTimes(1);

    const args: { updatedItemIds: Array<ObjectID>; postedAt: Date } = writerSpy
      .mock.calls[0]![0] as { updatedItemIds: Array<ObjectID>; postedAt: Date };

    expect(args.updatedItemIds).toEqual([SLO_ID]);
    expect(args.postedAt).toBeInstanceOf(Date);
  });

  test("never starts the writer without a snapshot - which is every existing caller that passes carryForward null", async () => {
    const writerSpy: jest.SpyInstance = jest.spyOn(
      privateWriters(),
      "writeSloUpdatedFeed",
    );

    await callHook(
      "onUpdateSuccess",
      { updateBy: makeUpdateBy({ name: "Renamed" }, {}), carryForward: null },
      [SLO_ID],
    );

    expect(writerSpy).not.toHaveBeenCalled();
  });

  test("a writer that fails is logged, never thrown", async () => {
    jest
      .spyOn(privateWriters(), "writeSloUpdatedFeed")
      .mockRejectedValue(new Error("feed down"));

    const onUpdate: unknown = {
      updateBy: makeUpdateBy({ name: "Renamed" }, { userId: USER_ID }),
      carryForward: {
        feedSnapshot: { columns: [{ column: "name" }], rowsById: {} },
      },
    };

    await expect(callHook("onUpdateSuccess", onUpdate, [SLO_ID])).resolves.toBe(
      onUpdate,
    );

    await flushPromises();

    expect(logger.error).toHaveBeenCalled();
  });
});
