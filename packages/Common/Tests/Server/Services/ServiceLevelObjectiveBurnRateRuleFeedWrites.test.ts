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
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import { ServiceLevelObjectiveFeedEventType } from "../../../Models/DatabaseModels/ServiceLevelObjectiveFeed";
import User from "../../../Models/DatabaseModels/User";
import ServiceLevelObjectiveBurnRateRuleService from "../../../Server/Services/ServiceLevelObjectiveBurnRateRuleService";
import ServiceLevelObjectiveFeedService from "../../../Server/Services/ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import logger from "../../../Server/Utils/Logger";
import SloFeedUtil from "../../../Server/Utils/Slo/SloFeedUtil";
import { Gray500, Green500, Red500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";

/*
 * Contract under test: the SLO feed items about burn rate rules - added,
 * changed, removed.
 *
 * The rule row is written far more often by OneUptime than by people: the
 * evaluation worker stamps its lifecycle columns through the hooked update
 * path every time it fires or resolves, and every SLO create seeds two rules.
 * So what is pinned first is restraint - the seeded pair posts nothing (the
 * SLO's own "created" item describes them), root writes take no snapshot and
 * post nothing, and a re-submitted form with no real change posts nothing -
 * and then honesty: old -> new, the acting user, escaped names.
 */

const SLO_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_SLO_ID: ObjectID = new ObjectID(
  "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RULE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const LABEL_ID: string = "66666666-6666-4666-8666-666666666666";

const SLO_MARKDOWN_LINK: string =
  "[SLO Checkout](https://oneuptime.test/dashboard/p/slos/s)";
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

interface PrivateWriters {
  writeBurnRateRuleAddedFeed: (data: unknown) => Promise<void>;
  writeBurnRateRuleChangedFeed: (data: unknown) => Promise<void>;
  writeBurnRateRuleRemovedFeed: (data: unknown) => Promise<void>;
}

let feedCalls: Array<FeedCall> = [];
let sloLinkSpy: jest.SpyInstance;

// Calls a protected or private member without widening the service's surface.
function callHook(name: string, ...args: Array<unknown>): Promise<unknown> {
  const members: Record<
    string,
    (...memberArgs: Array<unknown>) => Promise<unknown>
  > = ServiceLevelObjectiveBurnRateRuleService as unknown as Record<
    string,
    (...memberArgs: Array<unknown>) => Promise<unknown>
  >;

  return members[name]!.apply(ServiceLevelObjectiveBurnRateRuleService, args);
}

function privateWriters(): PrivateWriters {
  return ServiceLevelObjectiveBurnRateRuleService as unknown as PrivateWriters;
}

function ruleRow(
  fields: Record<string, unknown> = {},
  id: ObjectID = RULE_ID,
): ServiceLevelObjectiveBurnRateRule {
  const rule: ServiceLevelObjectiveBurnRateRule =
    new ServiceLevelObjectiveBurnRateRule(id);
  rule.projectId = PROJECT_ID;
  rule.serviceLevelObjectiveId = SLO_ID;
  rule.name = "Fast burn";
  Object.assign(rule, fields);
  return rule;
}

function makeUpdateBy(
  data: Record<string, unknown>,
  props: Record<string, unknown>,
): UpdateByShape {
  return {
    query: { _id: RULE_ID.toString() },
    data: data,
    props: props,
    limit: 1,
    skip: 0,
  };
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

  sloLinkSpy = jest
    .spyOn(ServiceLevelObjectiveService, "getSloMarkdownLink")
    .mockResolvedValue(SLO_MARKDOWN_LINK);

  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SLO burn rate rules - added", () => {
  test("a rule a person adds posts what it fires on and what it opens", async () => {
    await callHook("writeBurnRateRuleAddedFeed", {
      onCreate: {
        createBy: { props: { userId: USER_ID } },
        carryForward: null,
      },
      createdItem: ruleRow({
        burnRateThreshold: 14.4,
        longWindowInMinutes: 60,
        shortWindowInMinutes: 5,
        isEnabled: true,
        shouldCreateAlert: true,
        shouldCreateIncident: false,
      }),
      postedAt: POSTED_AT,
    });

    expect(feedCalls).toHaveLength(1);

    const item: FeedCall = feedCalls[0]!;

    expect(item.serviceLevelObjectiveFeedEventType).toBe(
      ServiceLevelObjectiveFeedEventType.BurnRateRuleAdded,
    );
    expect(item.serviceLevelObjectiveId).toBe(SLO_ID);
    expect(item.projectId).toBe(PROJECT_ID);
    expect(item.displayColor).toBe(Gray500);
    expect(item.userId).toBe(USER_ID);
    expect(item.postedAt).toBe(POSTED_AT);
    expect(item.feedInfoInMarkdown).toBe(
      `🔥 Burn rate rule **Fast burn** was added to ${SLO_MARKDOWN_LINK}.`,
    );
    expect(item.moreInformationInMarkdown).toBe(
      [
        "**Fires on**: burn rate above 14.4x over 1 hour, confirmed over 5 minutes",
        "**When it fires**: it raises an alert",
        "**Enabled**: Yes",
      ].join("\n\n"),
    );
    expect(sloLinkSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      sloId: SLO_ID,
    });
  });

  test("a hostile rule name stays inside its bold", async () => {
    await callHook("writeBurnRateRuleAddedFeed", {
      onCreate: { createBy: { props: {} }, carryForward: null },
      createdItem: ruleRow({ name: "burn** ![p](https://t.example/p.png)" }),
      postedAt: POSTED_AT,
    });

    expect(feedCalls[0]!.feedInfoInMarkdown).toBe(
      `🔥 Burn rate rule **burn\\*\\* \\!\\[p\\]\\(https://t.example/p.png\\)** was added to ${SLO_MARKDOWN_LINK}.`,
    );
  });

  test("onCreateSuccess starts the writer for a rule added to an existing SLO, and does not wait for it", async () => {
    const writerSpy: jest.SpyInstance = jest
      .spyOn(privateWriters(), "writeBurnRateRuleAddedFeed")
      .mockReturnValue(new Promise<void>((): void => {}));

    const created: ServiceLevelObjectiveBurnRateRule = ruleRow();

    await expect(
      callHook(
        "onCreateSuccess",
        { createBy: { props: { userId: USER_ID } }, carryForward: null },
        created,
      ),
    ).resolves.toBe(created);

    expect(writerSpy).toHaveBeenCalledTimes(1);
  });

  test("the two rules seeded while the SLO is created post nothing of their own", async () => {
    const writerSpy: jest.SpyInstance = jest.spyOn(
      privateWriters(),
      "writeBurnRateRuleAddedFeed",
    );

    await SloFeedUtil.runWhileSeedingDefaultBurnRateRules({
      sloId: SLO_ID,
      seed: async (): Promise<void> => {
        await callHook(
          "onCreateSuccess",
          { createBy: { props: { isRoot: true } }, carryForward: null },
          ruleRow({ name: "Fast burn" }),
        );
        await callHook(
          "onCreateSuccess",
          { createBy: { props: { isRoot: true } }, carryForward: null },
          ruleRow({ name: "Slow burn" }, OTHER_RULE_ID),
        );
      },
    });

    expect(writerSpy).not.toHaveBeenCalled();
  });

  test("seeding one SLO never silences a rule added to another", async () => {
    const writerSpy: jest.SpyInstance = jest
      .spyOn(privateWriters(), "writeBurnRateRuleAddedFeed")
      .mockResolvedValue(undefined);

    await SloFeedUtil.runWhileSeedingDefaultBurnRateRules({
      sloId: OTHER_SLO_ID,
      seed: async (): Promise<void> => {
        await callHook(
          "onCreateSuccess",
          { createBy: { props: { userId: USER_ID } }, carryForward: null },
          ruleRow(),
        );
      },
    });

    expect(writerSpy).toHaveBeenCalledTimes(1);
  });

  test("a rule an automation creates as root, outside SLO creation, is still described", async () => {
    const writerSpy: jest.SpyInstance = jest
      .spyOn(privateWriters(), "writeBurnRateRuleAddedFeed")
      .mockResolvedValue(undefined);

    await callHook(
      "onCreateSuccess",
      { createBy: { props: { isRoot: true } }, carryForward: null },
      ruleRow(),
    );

    expect(writerSpy).toHaveBeenCalledTimes(1);
  });

  test("a failing writer is logged and never fails the create", async () => {
    jest
      .spyOn(privateWriters(), "writeBurnRateRuleAddedFeed")
      .mockRejectedValue(new Error("feed down"));

    const created: ServiceLevelObjectiveBurnRateRule = ruleRow();

    await expect(
      callHook(
        "onCreateSuccess",
        { createBy: { props: {} }, carryForward: null },
        created,
      ),
    ).resolves.toBe(created);

    // setTimeout, not setImmediate: this suite runs under jsdom.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });

    expect(logger.error).toHaveBeenCalled();
  });
});

describe("SLO burn rate rules - the before-snapshot", () => {
  let findBySpy: jest.SpyInstance;

  beforeEach(() => {
    findBySpy = jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([ruleRow({ burnRateThreshold: 14.4 })]);
  });

  test("a root write - the worker stamping lifecycle columns, or OneUptime's own edits - takes no snapshot", async () => {
    for (const payload of [
      { lastAlertCreatedAt: POSTED_AT },
      { lastIncidentResolvedAt: POSTED_AT },
      { name: "Renamed by an automation" },
    ]) {
      await expect(
        callHook(
          "readFeedSnapshotBeforeUpdate",
          makeUpdateBy(payload, { isRoot: true }),
        ),
      ).resolves.toBeNull();
    }

    expect(findBySpy).not.toHaveBeenCalled();
  });

  test("a hand-made edit that touches no watched column reads nothing", async () => {
    await expect(
      callHook(
        "readFeedSnapshotBeforeUpdate",
        makeUpdateBy({ lastAlertCreatedAt: POSTED_AT }, { userId: USER_ID }),
      ),
    ).resolves.toBeNull();

    expect(findBySpy).not.toHaveBeenCalled();
  });

  test("a hand-made edit of a watched column reads the rule once, as root, selecting what the item prints", async () => {
    const snapshot: {
      columns: Array<{ column: string }>;
      rowsById: Record<string, ServiceLevelObjectiveBurnRateRule>;
    } = (await callHook(
      "readFeedSnapshotBeforeUpdate",
      makeUpdateBy(
        { burnRateThreshold: 10, alertLabels: [{ _id: LABEL_ID }] },
        { userId: USER_ID, tenantId: PROJECT_ID },
      ),
    )) as {
      columns: Array<{ column: string }>;
      rowsById: Record<string, ServiceLevelObjectiveBurnRateRule>;
    };

    expect(findBySpy).toHaveBeenCalledTimes(1);

    const findByArgs: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    } = findBySpy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    };

    // Pinned: the hook runs before DatabaseService applies permissions.
    expect(findByArgs.query).toEqual({
      _id: RULE_ID.toString(),
      projectId: PROJECT_ID,
    });
    expect(findByArgs.props).toEqual({ isRoot: true });
    expect(findByArgs.select).toEqual({
      _id: true,
      projectId: true,
      serviceLevelObjectiveId: true,
      name: true,
      burnRateThreshold: true,
      alertLabels: { _id: true, name: true },
    });
    expect(Object.keys(snapshot.rowsById)).toEqual([RULE_ID.toString()]);
  });

  test("a failed read never blocks the update", async () => {
    findBySpy.mockRejectedValue(new Error("replica lag"));

    await expect(
      callHook(
        "readFeedSnapshotBeforeUpdate",
        makeUpdateBy({ name: "Renamed" }, { userId: USER_ID }),
      ),
    ).resolves.toBeNull();
  });

  test("onBeforeUpdate carries the snapshot of a hand-made edit, and none for a root one", async () => {
    const handMade: { carryForward: { feedSnapshot: unknown } } =
      (await callHook(
        "onBeforeUpdate",
        makeUpdateBy({ name: "Renamed" }, { userId: USER_ID }),
      )) as { carryForward: { feedSnapshot: unknown } };

    expect(handMade.carryForward.feedSnapshot).not.toBeNull();

    const root: { carryForward: { feedSnapshot: unknown } } = (await callHook(
      "onBeforeUpdate",
      makeUpdateBy({ name: "Renamed" }, { isRoot: true }),
    )) as { carryForward: { feedSnapshot: unknown } };

    expect(root.carryForward.feedSnapshot).toBeNull();
  });
});

describe("SLO burn rate rules - changed", () => {
  async function writeChangedFeed(data: {
    payload: Record<string, unknown>;
    before: ServiceLevelObjectiveBurnRateRule;
    after: ServiceLevelObjectiveBurnRateRule | null;
  }): Promise<void> {
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([data.before]);
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findOneById")
      .mockResolvedValue(data.after);

    const updateBy: UpdateByShape = makeUpdateBy(data.payload, {
      userId: USER_ID,
    });

    const snapshot: unknown = await callHook(
      "readFeedSnapshotBeforeUpdate",
      updateBy,
    );

    await callHook("writeBurnRateRuleChangedFeed", {
      onUpdate: {
        updateBy: updateBy,
        carryForward: { feedSnapshot: snapshot },
      },
      updatedItemIds: [RULE_ID],
      postedAt: POSTED_AT,
    });
  }

  test("a real change posts old -> new, attributed to whoever made it", async () => {
    await writeChangedFeed({
      payload: { burnRateThreshold: 10 },
      before: ruleRow({ burnRateThreshold: 14.4 }),
      after: ruleRow({ burnRateThreshold: 10 }),
    });

    expect(feedCalls).toHaveLength(1);
    expect(feedCalls[0]!.serviceLevelObjectiveFeedEventType).toBe(
      ServiceLevelObjectiveFeedEventType.BurnRateRuleChanged,
    );
    expect(feedCalls[0]!.displayColor).toBe(Gray500);
    expect(feedCalls[0]!.userId).toBe(USER_ID);
    expect(feedCalls[0]!.postedAt).toBe(POSTED_AT);
    expect(feedCalls[0]!.feedInfoInMarkdown).toBe(
      `🔥 Burn rate rule **Fast burn** on ${SLO_MARKDOWN_LINK} was updated: **Burn rate threshold** changed from 14.4x to 10x.`,
    );
  });

  test.each([
    { to: false, summary: "was disabled.", color: Gray500 },
    { to: true, summary: "was enabled.", color: Green500 },
  ])(
    "switching a rule enabled=$to is its own sentence",
    async (row: { to: boolean; summary: string; color: Color }) => {
      await writeChangedFeed({
        payload: { isEnabled: row.to },
        before: ruleRow({ isEnabled: !row.to }),
        after: ruleRow({ isEnabled: row.to }),
      });

      expect(feedCalls[0]!.displayColor).toBe(row.color);
      expect(feedCalls[0]!.feedInfoInMarkdown).toBe(
        `🔥 Burn rate rule **Fast burn** on ${SLO_MARKDOWN_LINK} ${row.summary}`,
      );
    },
  );

  test("a form re-submitted without a real change posts nothing", async () => {
    await writeChangedFeed({
      payload: {
        name: "Fast burn",
        burnRateThreshold: "14.4",
        isEnabled: true,
        alertLabels: [{ _id: LABEL_ID.toUpperCase() }],
      },
      before: ruleRow({
        burnRateThreshold: 14.4,
        isEnabled: true,
        alertLabels: [
          Object.assign(new Label(new ObjectID(LABEL_ID)), { name: "P1" }),
        ],
      }),
      after: ruleRow({
        burnRateThreshold: 14.4,
        isEnabled: true,
        alertLabels: [
          Object.assign(new Label(new ObjectID(LABEL_ID)), { name: "P1" }),
        ],
      }),
    });

    expect(feedCalls).toHaveLength(0);
    expect(sloLinkSpy).not.toHaveBeenCalled();
  });

  test("a relation change names what the rule now copies onto its records", async () => {
    await writeChangedFeed({
      payload: { alertLabels: [{ _id: LABEL_ID }] },
      before: ruleRow({ alertLabels: [] }),
      after: ruleRow({
        alertLabels: [
          Object.assign(new Label(new ObjectID(LABEL_ID)), { name: "P1" }),
        ],
      }),
    });

    expect(feedCalls[0]!.feedInfoInMarkdown).toContain(
      "**Alert labels** changed from _none_ to P1.",
    );
  });

  test("an owner-user change reads the user's name, and a template change is noted without quoting it", async () => {
    const jane: User = new User(USER_ID);
    Object.assign(jane, { name: "Jane Doe" });

    await writeChangedFeed({
      payload: {
        alertOwnerUsers: [{ _id: USER_ID.toString() }],
        alertTitleTemplate: "{{sloName}} is burning",
      },
      before: ruleRow({ alertOwnerUsers: [], alertTitleTemplate: null }),
      after: ruleRow({
        alertOwnerUsers: [jane],
        alertTitleTemplate: "{{sloName}} is burning",
      }),
    });

    expect(feedCalls[0]!.moreInformationInMarkdown).toBe(
      "**Alert title template**: changed\n\n**Alert owner users**: _none_ → Jane Doe",
    );
  });

  test("a rename is described with both names escaped", async () => {
    await writeChangedFeed({
      payload: { name: "[fast](https://evil.example)" },
      before: ruleRow({ name: "Fast burn" }),
      after: ruleRow({ name: "[fast](https://evil.example)" }),
    });

    expect(feedCalls[0]!.feedInfoInMarkdown).toBe(
      `🔥 Burn rate rule **\\[fast\\]\\(https://evil.example\\)** on ${SLO_MARKDOWN_LINK} was updated: **Name** changed from Fast burn to \\[fast\\]\\(https://evil.example\\).`,
    );
  });

  test("a rule gone after the write is skipped", async () => {
    await writeChangedFeed({
      payload: { burnRateThreshold: 10 },
      before: ruleRow({ burnRateThreshold: 14.4 }),
      after: null,
    });

    expect(feedCalls).toHaveLength(0);
  });

  test("onUpdateSuccess starts the writer only with a snapshot, and leaves the resolve path as it was", async () => {
    const writerSpy: jest.SpyInstance = jest
      .spyOn(privateWriters(), "writeBurnRateRuleChangedFeed")
      .mockResolvedValue(undefined);

    // No snapshot: the carryForward every existing caller and test passes.
    await callHook(
      "onUpdateSuccess",
      {
        updateBy: makeUpdateBy({ name: "Renamed" }, { isRoot: true }),
        carryForward: null,
      },
      [RULE_ID],
    );

    expect(writerSpy).not.toHaveBeenCalled();

    await callHook(
      "onUpdateSuccess",
      {
        updateBy: makeUpdateBy({ name: "Renamed" }, { userId: USER_ID }),
        carryForward: {
          feedSnapshot: { columns: [{ column: "name" }], rowsById: {} },
        },
      },
      [RULE_ID],
    );

    expect(writerSpy).toHaveBeenCalledTimes(1);
  });
});

describe("SLO burn rate rules - removed", () => {
  /*
   * onDeleteSuccess also resolves what each removed rule left open. That half
   * belongs to ServiceLevelObjectiveDeleteTenancy.test.ts, so it is silenced
   * here rather than reaching for a database.
   */
  beforeEach(() => {
    jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "resolveOpenAlertsAndIncidentsForRule",
      )
      .mockResolvedValue(undefined);
  });

  test("onDeleteSuccess describes each removed rule from the rows read before the delete", async () => {
    const writerSpy: jest.SpyInstance = jest
      .spyOn(privateWriters(), "writeBurnRateRuleRemovedFeed")
      .mockResolvedValue(undefined);

    const doomed: Array<ServiceLevelObjectiveBurnRateRule> = [ruleRow()];

    await callHook(
      "onDeleteSuccess",
      {
        deleteBy: { props: { userId: USER_ID } },
        carryForward: { itemsToDelete: doomed },
      },
      [RULE_ID],
    );

    expect(writerSpy).toHaveBeenCalledTimes(1);
    // A narrowed copy: only the rows the delete reported as removed.
    expect(
      (writerSpy.mock.calls[0]![0] as { itemsToDelete: Array<unknown> })
        .itemsToDelete,
    ).toEqual(doomed);

    // Nothing carried, nothing started.
    await callHook(
      "onDeleteSuccess",
      { deleteBy: { props: {} }, carryForward: null },
      [],
    );

    expect(writerSpy).toHaveBeenCalledTimes(1);
  });

  /*
   * onBeforeDelete reads its rows before DatabaseService applies permissions,
   * so they are only candidates: a delete naming another project's rule (or
   * one the caller may not delete) removes nothing, and must not post
   * "removed" onto that project's SLO feed in the caller's name.
   */
  test("describes only the rules the delete really removed", async () => {
    const writerSpy: jest.SpyInstance = jest
      .spyOn(privateWriters(), "writeBurnRateRuleRemovedFeed")
      .mockResolvedValue(undefined);

    const removed: ServiceLevelObjectiveBurnRateRule = ruleRow();
    const notRemoved: ServiceLevelObjectiveBurnRateRule = ruleRow(
      { name: "Slow burn" },
      OTHER_RULE_ID,
    );

    await callHook(
      "onDeleteSuccess",
      {
        deleteBy: { props: { userId: USER_ID } },
        carryForward: { itemsToDelete: [removed, notRemoved] },
      },
      [RULE_ID],
    );

    expect(writerSpy).toHaveBeenCalledTimes(1);
    expect(
      (writerSpy.mock.calls[0]![0] as { itemsToDelete: Array<unknown> })
        .itemsToDelete,
    ).toEqual([removed]);

    // A delete the permission check narrowed to nothing starts no writer.
    await callHook(
      "onDeleteSuccess",
      {
        deleteBy: { props: { userId: USER_ID } },
        carryForward: { itemsToDelete: [notRemoved] },
      },
      [],
    );

    expect(writerSpy).toHaveBeenCalledTimes(1);
  });

  test("posts a red item naming the rule and what it fired on, attributed to the deleting user", async () => {
    await callHook("writeBurnRateRuleRemovedFeed", {
      onDelete: {
        deleteBy: {
          deletedByUser: new User(USER_ID),
          props: {
            userId: new ObjectID("77777777-7777-4777-8777-777777777777"),
          },
        },
        carryForward: null,
      },
      itemsToDelete: [
        ruleRow({
          name: "Slow burn",
          burnRateThreshold: 6,
          longWindowInMinutes: 360,
          shortWindowInMinutes: 30,
        }),
      ],
      postedAt: POSTED_AT,
    });

    expect(feedCalls).toHaveLength(1);
    expect(feedCalls[0]!.serviceLevelObjectiveFeedEventType).toBe(
      ServiceLevelObjectiveFeedEventType.BurnRateRuleRemoved,
    );
    expect(feedCalls[0]!.displayColor).toBe(Red500);
    // The deleting user's id is read back through the model, so compare values.
    expect(feedCalls[0]!.userId?.toString()).toBe(USER_ID.toString());
    expect(feedCalls[0]!.postedAt).toBe(POSTED_AT);
    expect(feedCalls[0]!.feedInfoInMarkdown).toBe(
      `🔥 Burn rate rule **Slow burn** was removed from ${SLO_MARKDOWN_LINK}.`,
    );
    expect(feedCalls[0]!.moreInformationInMarkdown).toContain(
      "**Fires on**: burn rate above 6x over 6 hours, confirmed over 30 minutes",
    );
  });

  test("skips rows missing their SLO or project, and one failure does not cost the next rule its item", async () => {
    sloLinkSpy
      .mockRejectedValueOnce(new Error("dashboard url unavailable"))
      .mockResolvedValue(SLO_MARKDOWN_LINK);

    // A rule row read without its SLO column.
    const withoutSlo: ServiceLevelObjectiveBurnRateRule =
      new ServiceLevelObjectiveBurnRateRule(OTHER_RULE_ID);
    withoutSlo.projectId = PROJECT_ID;
    withoutSlo.name = "Orphan";

    await callHook("writeBurnRateRuleRemovedFeed", {
      onDelete: { deleteBy: { props: {} }, carryForward: null },
      itemsToDelete: [
        withoutSlo,
        ruleRow({ name: "First" }),
        ruleRow({ name: "Second" }),
      ],
      postedAt: POSTED_AT,
    });

    expect(feedCalls).toHaveLength(1);
    expect(feedCalls[0]!.feedInfoInMarkdown).toContain("**Second**");
    expect(logger.error).toHaveBeenCalled();
  });
});
