import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageHistoryChartBarColorRule from "../../../Models/DatabaseModels/StatusPageHistoryChartBarColorRule";
import StatusPageHistoryChartBarColorRuleService from "../../../Server/Services/StatusPageHistoryChartBarColorRuleService";
import StatusPageLabelRuleEngineService from "../../../Server/Services/StatusPageLabelRuleEngineService";
import StatusPageOwnerRuleEngineService from "../../../Server/Services/StatusPageOwnerRuleEngineService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import logger from "../../../Server/Utils/Logger";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import {
  ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY,
  HistoryChartBarColorRuleValues,
  RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES,
  isRecommendedHistoryChartBarColorRuleSet,
} from "../../../Utils/StatusPage/HistoryChartBarColors";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A status page made in the dashboard starts with the recommended bar color
 * rules (issue #486): its uptime history grades a day by how long it was
 * down, in colours people with red-green colour blindness can tell apart,
 * rather than painting a whole day in the Offline red for a minute of it.
 *
 * The create asks for them (miscDataProps.addRecommendedBarColorRules). A
 * create that does not ask - Terraform, a script - gets none: it declares
 * its own rules, and rules added for it would sit above them and win.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PAGE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const CREATOR_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
  userType: UserType.User,
};

type SpyInstance = ReturnType<typeof getJestSpyOn>;

interface RecordedRuleCreate {
  data: StatusPageHistoryChartBarColorRule;
  props: DatabaseCommonInteractionProps;
}

function createdPage(): StatusPage {
  const page: StatusPage = new StatusPage();
  page.id = PAGE_ID;
  page.projectId = PROJECT_ID;
  page.name = "Public status";
  return page;
}

// The page's success hook, run as DatabaseService.create runs it.
async function runSuccessHook(
  miscDataProps: JSONObject | undefined,
  page: StatusPage = createdPage(),
): Promise<StatusPage> {
  const onCreate: OnCreate<StatusPage> = {
    createBy: {
      data: new StatusPage(),
      props: CREATOR_PROPS,
      miscDataProps: miscDataProps,
    } as CreateBy<StatusPage>,
    carryForward: null,
  };

  return await (
    StatusPageService as unknown as {
      onCreateSuccess: (
        onCreate: OnCreate<StatusPage>,
        createdItem: StatusPage,
      ) => Promise<StatusPage>;
    }
  ).onCreateSuccess(onCreate, page);
}

// Every rule the hook creates, recorded and answered with an id.
function recordRuleCreates(): Array<RecordedRuleCreate> {
  const recorded: Array<RecordedRuleCreate> = [];

  jest
    .spyOn(StatusPageHistoryChartBarColorRuleService, "create")
    .mockImplementation(
      async (
        createBy: CreateBy<StatusPageHistoryChartBarColorRule>,
      ): Promise<StatusPageHistoryChartBarColorRule> => {
        // A turn of the event loop, as a real insert takes.
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });

        createBy.data.id = ObjectID.generate();
        recorded.push({ data: createBy.data, props: createBy.props });

        return createBy.data;
      },
    );

  return recorded;
}

beforeEach(() => {
  jest.spyOn(ProductAnalytics, "captureForUser").mockReturnValue(undefined);
  jest
    .spyOn(StatusPageLabelRuleEngineService, "applyRulesToStatusPage")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(StatusPageOwnerRuleEngineService, "applyRulesToStatusPage")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a status page created with addRecommendedBarColorRules", () => {
  test("starts with the four recommended rules, in their order", async () => {
    const recorded: Array<RecordedRuleCreate> = recordRuleCreates();

    await runSuccessHook({
      [ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY]: true,
    });

    expect(
      recorded.map((create: RecordedRuleCreate) => {
        return [
          create.data.uptimePercentGreaterThanOrEqualTo,
          create.data.barColor?.toString(),
          create.data.order,
        ];
      }),
    ).toEqual([
      [100, "#22c55e", 1],
      [99, "#fde047", 2],
      [95, "#c2410c", 3],
      [0, "#7f1d1d", 4],
    ]);

    expect(
      isRecommendedHistoryChartBarColorRuleSet(
        recorded.map((create: RecordedRuleCreate) => {
          return create.data;
        }),
      ),
    ).toBe(true);
  });

  test("each rule belongs to the new page and its project", async () => {
    const recorded: Array<RecordedRuleCreate> = recordRuleCreates();

    await runSuccessHook({
      [ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY]: true,
    });

    expect(recorded).toHaveLength(4);

    for (const create of recorded) {
      expect(create.data.statusPageId?.toString()).toBe(PAGE_ID.toString());
      expect(create.data.projectId?.toString()).toBe(PROJECT_ID.toString());
    }
  });

  /*
   * Made as part of making the page, like its default bar color: a creator
   * whose role makes status pages but not bar color rules still gets them.
   */
  test("the rules are made as OneUptime, not as the page's creator", async () => {
    const recorded: Array<RecordedRuleCreate> = recordRuleCreates();

    await runSuccessHook({
      [ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY]: true,
    });

    expect(recorded).toHaveLength(4);

    for (const create of recorded) {
      expect(create.props).toEqual({ isRoot: true });
    }
  });

  test("every rule is made before the create returns, so the page opens with them", async () => {
    const recorded: Array<RecordedRuleCreate> = recordRuleCreates();

    const page: StatusPage = await runSuccessHook({
      [ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY]: true,
    });

    expect(recorded).toHaveLength(4);
    expect(page.id?.toString()).toBe(PAGE_ID.toString());
  });

  test("the rules are copies: changing one never changes the recommended list", async () => {
    const recorded: Array<RecordedRuleCreate> = recordRuleCreates();

    await runSuccessHook({
      [ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY]: true,
    });

    expect(recorded).toHaveLength(4);

    recorded.forEach((create: RecordedRuleCreate, index: number) => {
      const recommended: HistoryChartBarColorRuleValues =
        RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES[index]!;

      expect(create.data.barColor).not.toBe(recommended.barColor);
      expect(create.data.barColor?.toString()).toBe(
        recommended.barColor.toString(),
      );
    });
  });

  /*
   * All of them or none. With only the first rule (100% is green), a day
   * with any downtime matches no rule and takes the default bar color -
   * green on a new page - so a day spent down would read as a good one.
   */
  test("rules that cannot all be made are taken back, logged, and the page is kept", async () => {
    let attempts: number = 0;
    const madeIds: Array<string> = [];

    jest
      .spyOn(StatusPageHistoryChartBarColorRuleService, "create")
      .mockImplementation(
        async (
          createBy: CreateBy<StatusPageHistoryChartBarColorRule>,
        ): Promise<StatusPageHistoryChartBarColorRule> => {
          attempts++;

          if (attempts === 3) {
            throw new Error("database unavailable");
          }

          createBy.data.id = ObjectID.generate();
          madeIds.push(createBy.data.id.toString());

          return createBy.data;
        },
      );

    const removed: SpyInstance = getJestSpyOn(
      StatusPageHistoryChartBarColorRuleService,
      "deleteOneById",
    ).mockResolvedValue(1);

    const logged: SpyInstance = getJestSpyOn(
      logger,
      "error",
    ).mockImplementation((): void => {});

    const page: StatusPage = await runSuccessHook({
      [ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY]: true,
    });

    expect(page.id?.toString()).toBe(PAGE_ID.toString());
    // It stops at the first refusal, and takes back the two it made.
    expect(attempts).toBe(3);
    expect(madeIds).toHaveLength(2);
    expect(
      removed.mock.calls.map((call: Array<unknown>) => {
        const args: { id: ObjectID; props: DatabaseCommonInteractionProps } =
          call[0] as { id: ObjectID; props: DatabaseCommonInteractionProps };

        return [args.id.toString(), args.props];
      }),
    ).toEqual([
      [madeIds[0], { isRoot: true }],
      [madeIds[1], { isRoot: true }],
    ]);
    expect(String(logged.mock.calls[0]![0])).toContain(
      "Error adding the recommended bar color rules",
    );
    expect(String(logged.mock.calls[0]![0])).toContain("database unavailable");
  });

  test("a rule that cannot be taken back is logged, and the rest still are", async () => {
    let attempts: number = 0;

    jest
      .spyOn(StatusPageHistoryChartBarColorRuleService, "create")
      .mockImplementation(
        async (
          createBy: CreateBy<StatusPageHistoryChartBarColorRule>,
        ): Promise<StatusPageHistoryChartBarColorRule> => {
          attempts++;

          if (attempts === 4) {
            throw new Error("database unavailable");
          }

          createBy.data.id = ObjectID.generate();

          return createBy.data;
        },
      );

    let removals: number = 0;

    getJestSpyOn(
      StatusPageHistoryChartBarColorRuleService,
      "deleteOneById",
    ).mockImplementation(async (): Promise<number> => {
      removals++;

      if (removals === 1) {
        throw new Error("lock timeout");
      }

      return 1;
    });

    const logged: SpyInstance = getJestSpyOn(
      logger,
      "error",
    ).mockImplementation((): void => {});

    await runSuccessHook({
      [ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY]: true,
    });

    expect(removals).toBe(3);

    const messages: Array<string> = logged.mock.calls.map(
      (call: Array<unknown>) => {
        return String(call[0]);
      },
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain(
      "Error removing a recommended bar color rule after a failed add",
    );
    expect(messages[0]).toContain("lock timeout");
    expect(messages[1]).toContain(
      "Error adding the recommended bar color rules",
    );
  });

  test("a page the create did not hand back whole gets none", async () => {
    const recorded: Array<RecordedRuleCreate> = recordRuleCreates();

    // Built without an id: setting one to null leaves it as it was.
    const withoutId: StatusPage = new StatusPage();
    withoutId.projectId = PROJECT_ID;
    expect(withoutId.id).toBeNull();

    await runSuccessHook(
      { [ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY]: true },
      withoutId,
    );

    const withoutProject: StatusPage = createdPage();
    delete withoutProject.projectId;

    await runSuccessHook(
      { [ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY]: true },
      withoutProject,
    );

    expect(recorded).toHaveLength(0);
  });
});

describe("a status page created without asking", () => {
  test.each([
    ["no misc data", undefined],
    ["misc data without the flag", { ownerUsers: [] }],
    [
      "the flag off",
      { [ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY]: false },
    ],
    [
      "the flag as text",
      { [ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY]: "true" },
    ],
    [
      "the flag as a number",
      { [ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY]: 1 },
    ],
  ] as Array<[string, JSONObject | undefined]>)(
    "%s: starts with no rules, as Terraform and scripts expect",
    async (_what: string, miscDataProps: JSONObject | undefined) => {
      const recorded: Array<RecordedRuleCreate> = recordRuleCreates();

      await runSuccessHook(miscDataProps);

      expect(recorded).toHaveLength(0);
    },
  );
});

describe("addRecommendedHistoryChartBarColorRules", () => {
  test("hands back the rules it made, in order", async () => {
    recordRuleCreates();

    const rules: Array<StatusPageHistoryChartBarColorRule> =
      await StatusPageService.addRecommendedHistoryChartBarColorRules({
        projectId: PROJECT_ID,
        statusPageId: PAGE_ID,
      });

    expect(
      rules.map((rule: StatusPageHistoryChartBarColorRule) => {
        return rule.uptimePercentGreaterThanOrEqualTo;
      }),
    ).toEqual([100, 99, 95, 0]);

    for (const rule of rules) {
      expect(rule.id).toBeTruthy();
    }
  });

  test("is asked for from the success hook, after the page is saved", () => {
    const source: string = fs.readFileSync(
      path.resolve(__dirname, "../../../Server/Services/StatusPageService.ts"),
      "utf8",
    );
    const start: number = source.indexOf(
      "protected override async onCreateSuccess(",
    );
    const hook: string = source.slice(start, start + 2500);

    expect(start).toBeGreaterThan(-1);
    expect(hook).toContain("ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY");
    expect(hook).toContain(
      "await this.addRecommendedHistoryChartBarColorRules({",
    );
  });
});
