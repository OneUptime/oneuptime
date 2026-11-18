import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * WHAT PEOPLE TELL ONEUPTIME, KEPT ON THE SERVER (issue #6832), with the
 * server's config, the person's record, the project's incidents and alerts,
 * the table and Ask AI's messages answered here.
 *
 *  - The switches: the server's (GlobalConfig) and the person's (User).
 *  - A question is asked once, at most one a week, never during an open
 *    incident or alert - and written down on the person's record only when
 *    it is asked.
 *  - An answer keeps only its own fields; words are added only to a fresh
 *    one-click answer that has none yet.
 *  - Ask AI's rated-down questions are listed on a self-hosted server and
 *    never on OneUptime Cloud; what the answers rated down read is counted
 *    everywhere, from their tools' names alone (#7365), and for a project
 *    only its own (getProjectAskAiRatings).
 *  - An answer is kept a year, then the daily purge deletes it; a master
 *    admin may delete one sooner, for good (#7366).
 *  - "Was this page helpful?" is kept only once a master admin switched
 *    keeping it on (#7209), and summed up by page.
 */

let mockIsBillingEnabled: boolean = false;

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual, __esModule: true };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return mockIsBillingEnabled;
    },
  });

  return mocked;
});

import ProductFeedbackService from "../../../Server/Services/ProductFeedbackService";
import AIConversationMessageService from "../../../Server/Services/AIConversationMessageService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import UserService from "../../../Server/Services/UserService";
import AIConversationMessage, {
  AIConversationMessageFeedback,
} from "../../../Models/DatabaseModels/AIConversationMessage";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import ProductFeedback from "../../../Models/DatabaseModels/ProductFeedback";
import User from "../../../Models/DatabaseModels/User";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import Email from "../../../Types/Email";
import {
  DocsFeedbackReason,
  FeedbackQuestionDecision,
  GiveFeedbackDestination,
  PRODUCT_FEEDBACK_RETENTION_IN_DAYS,
  ProductFeedbackKind,
  toDocsFeedbackSubmission,
} from "../../../Types/ProductFeedback/ProductFeedback";
import OlderRowsPurge from "../../../Server/Utils/Retention/OlderRowsPurge";
import {
  AskAiSourceOfNoProduct,
  ASK_AI_RATINGS_DAYS,
} from "../../../Types/AI/AskAiRatings";
import ProductKey from "../../../Types/Product/ProductKey";
import { AIChatCitation } from "../../../Types/AI/AIChatTypes";

const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ANSWER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const STATE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const NOW: Date = new Date("2026-11-12T12:00:00.000Z");
const DAY_MS: number = 24 * 60 * 60 * 1000;

let config: GlobalConfig | null;
let user: User | null;
let openIncidents: number;
let openAlerts: number;

let updateUser: SpyInstance<typeof UserService.updateOneById>;
let incidentCount: SpyInstance<typeof IncidentService.countBy>;
let alertCount: SpyInstance<typeof AlertService.countBy>;
let create: SpyInstance<typeof ProductFeedbackService.create>;
let findAnswer: SpyInstance<typeof ProductFeedbackService.findOneById>;
let updateAnswer: SpyInstance<typeof ProductFeedbackService.updateOneById>;

const makeUser: (data: {
  disableFeedbackQuestions?: boolean;
  feedbackQuestionsAsked?: JSONObject;
}) => User = (data: {
  disableFeedbackQuestions?: boolean;
  feedbackQuestionsAsked?: JSONObject;
}): User => {
  const record: User = new User();
  record.disableFeedbackQuestions = Boolean(data.disableFeedbackQuestions);

  if (data.feedbackQuestionsAsked) {
    record.feedbackQuestionsAsked = data.feedbackQuestionsAsked;
  }

  return record;
};

beforeEach(() => {
  mockIsBillingEnabled = false;
  config = new GlobalConfig();
  config.disableProductFeedback = false;
  user = makeUser({});
  openIncidents = 0;
  openAlerts = 0;

  jest
    .spyOn(GlobalConfigService, "findOneById")
    .mockImplementation((async () => {
      return config;
    }) as never);
  jest.spyOn(UserService, "findOneById").mockImplementation((async () => {
    return user;
  }) as never);
  updateUser = jest
    .spyOn(UserService, "updateOneById")
    .mockResolvedValue(1 as never);

  jest
    .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
    .mockResolvedValue([STATE_ID] as never);
  jest
    .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
    .mockResolvedValue([STATE_ID] as never);
  incidentCount = jest
    .spyOn(IncidentService, "countBy")
    .mockImplementation((async () => {
      return new PositiveNumber(openIncidents);
    }) as never);
  alertCount = jest
    .spyOn(AlertService, "countBy")
    .mockImplementation((async () => {
      return new PositiveNumber(openAlerts);
    }) as never);

  create = jest
    .spyOn(ProductFeedbackService, "create")
    .mockImplementation((async (data: { data: ProductFeedback }) => {
      const created: ProductFeedback = data.data;
      created.id = ANSWER_ID;
      return created;
    }) as never);
  findAnswer = jest.spyOn(ProductFeedbackService, "findOneById");
  updateAnswer = jest
    .spyOn(ProductFeedbackService, "updateOneById")
    .mockResolvedValue(1 as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const askAbout: (key?: string) => Promise<FeedbackQuestionDecision> = async (
  key?: string,
): Promise<FeedbackQuestionDecision> => {
  return ProductFeedbackService.ask({
    userId: USER_ID,
    projectId: PROJECT_ID,
    key: key || "setup_flow:website_down",
    now: NOW,
  });
};

describe("the switches", () => {
  test("the server asks unless a master admin turned it off", async () => {
    expect(await ProductFeedbackService.isServerOn()).toBe(true);

    config!.disableProductFeedback = true;
    expect(await ProductFeedbackService.isServerOn()).toBe(false);

    // A server whose config row has never been read asks.
    config = null;
    expect(await ProductFeedbackService.isServerOn()).toBe(true);
  });

  test("a person is asked when the server and they both say so", async () => {
    expect(await ProductFeedbackService.getSettings(USER_ID)).toEqual({
      isOn: true,
      isAskingMe: true,
      giveFeedbackGoesTo: GiveFeedbackDestination.ServerAdmins,
    });

    user = makeUser({ disableFeedbackQuestions: true });
    expect(await ProductFeedbackService.getSettings(USER_ID)).toEqual({
      isOn: true,
      isAskingMe: false,
      giveFeedbackGoesTo: GiveFeedbackDestination.ServerAdmins,
    });

    user = makeUser({});
    config!.disableProductFeedback = true;
    expect(await ProductFeedbackService.getSettings(USER_ID)).toEqual({
      isOn: false,
      isAskingMe: false,
      giveFeedbackGoesTo: GiveFeedbackDestination.ServerAdmins,
    });
  });
});

describe("where Give feedback goes (#8893)", () => {
  test("on OneUptime Cloud, to the OneUptime team, whatever the admin address", async () => {
    mockIsBillingEnabled = true;
    config!.adminNotificationEmail = new Email("ops@acme.test");

    expect(
      (await ProductFeedbackService.getSettings(USER_ID)).giveFeedbackGoesTo,
    ).toBe(GiveFeedbackDestination.OneUptimeTeam);
  });

  test("on a self-hosted server with an Admin Notification Email, to its admins by email", async () => {
    config!.adminNotificationEmail = new Email("ops@acme.test");

    expect(
      (await ProductFeedbackService.getSettings(USER_ID)).giveFeedbackGoesTo,
    ).toBe(GiveFeedbackDestination.ServerAdminsByEmail);
  });

  test("on a self-hosted server with none, kept for its admins and never emailed", async () => {
    expect(
      (await ProductFeedbackService.getSettings(USER_ID)).giveFeedbackGoesTo,
    ).toBe(GiveFeedbackDestination.ServerAdmins);

    // A server whose config row has never been read.
    config = null;
    expect(
      (await ProductFeedbackService.getSettings(USER_ID)).giveFeedbackGoesTo,
    ).toBe(GiveFeedbackDestination.ServerAdmins);
  });

  test("the server's switch and its admin address are read together, in one read", async () => {
    config!.adminNotificationEmail = new Email("ops@acme.test");

    expect(await ProductFeedbackService.getServerFeedbackSettings()).toEqual({
      isOn: true,
      adminNotificationEmail: "ops@acme.test",
    });
    expect(GlobalConfigService.findOneById).toHaveBeenCalledTimes(1);
    expect(
      (
        jest.mocked(GlobalConfigService.findOneById).mock.calls[0]![0] as {
          select: Record<string, boolean>;
        }
      ).select,
    ).toEqual({ disableProductFeedback: true, adminNotificationEmail: true });

    config = null;
    expect(await ProductFeedbackService.getServerFeedbackSettings()).toEqual({
      isOn: true,
      adminNotificationEmail: null,
    });
  });
});

describe("asking a question", () => {
  test("a person never asked is asked, and the question is written down on their record", async () => {
    expect(await askAbout()).toBe(FeedbackQuestionDecision.Ask);

    expect(updateUser).toHaveBeenCalledTimes(1);

    const update: { data: { feedbackQuestionsAsked: JSONObject } } = updateUser
      .mock.calls[0]![0] as never;
    const written: JSONObject = update.data.feedbackQuestionsAsked;

    expect(written).toEqual({ "setup_flow:website_down": NOW.toISOString() });
  });

  test("a question asked before is not asked again, and nothing is written", async () => {
    user = makeUser({
      feedbackQuestionsAsked: {
        "setup_flow:website_down": new Date(
          NOW.getTime() - 200 * DAY_MS,
        ).toISOString(),
      },
    });

    expect(await askAbout()).toBe(FeedbackQuestionDecision.AlreadyAsked);
    expect(updateUser).not.toHaveBeenCalled();
  });

  test("at most one question a week: another this week waits", async () => {
    user = makeUser({
      feedbackQuestionsAsked: {
        "setup_flow:on_call": new Date(
          NOW.getTime() - 2 * DAY_MS,
        ).toISOString(),
      },
    });

    expect(await askAbout()).toBe(FeedbackQuestionDecision.AskedRecently);
    expect(updateUser).not.toHaveBeenCalled();
  });

  test("never while the project has an open incident, or an open alert", async () => {
    openIncidents = 1;
    expect(await askAbout()).toBe(FeedbackQuestionDecision.IncidentOpen);

    openIncidents = 0;
    openAlerts = 2;
    expect(await askAbout()).toBe(FeedbackQuestionDecision.IncidentOpen);
    expect(updateUser).not.toHaveBeenCalled();
  });

  test("the incidents are read only when everything else says ask", async () => {
    user = makeUser({ disableFeedbackQuestions: true });

    expect(await askAbout()).toBe(FeedbackQuestionDecision.PersonOff);
    expect(incidentCount).not.toHaveBeenCalled();
    expect(alertCount).not.toHaveBeenCalled();
  });

  test("never once the server's switch is off", async () => {
    config!.disableProductFeedback = true;

    expect(await askAbout()).toBe(FeedbackQuestionDecision.ServerOff);
    expect(updateUser).not.toHaveBeenCalled();
  });

  test("without a project, no incidents are read", async () => {
    expect(
      await ProductFeedbackService.ask({
        userId: USER_ID,
        projectId: null,
        key: "setup_flow:website_down",
        now: NOW,
      }),
    ).toBe(FeedbackQuestionDecision.Ask);
    expect(incidentCount).not.toHaveBeenCalled();
  });

  test("a project with no open state has nothing open, and is not counted", async () => {
    jest
      .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
      .mockResolvedValue([] as never);
    jest
      .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
      .mockResolvedValue([] as never);

    expect(await ProductFeedbackService.isProjectInIncident(PROJECT_ID)).toBe(
      false,
    );
    expect(incidentCount).not.toHaveBeenCalled();
  });
});

describe("keeping an answer", () => {
  test("only the answer's own fields reach the row", async () => {
    const id: ObjectID = await ProductFeedbackService.submit({
      kind: ProductFeedbackKind.SetupFlow,
      topic: "website_down",
      score: 4,
      isPositive: null,
      details: "Fine.",
      page: "/dashboard/:projectId/monitors/setup",
      version: "14.0.108",
    });

    expect(id.toString()).toBe(ANSWER_ID.toString());

    const row: ProductFeedback = (
      create.mock.calls[0]![0] as { data: ProductFeedback; props: JSONObject }
    ).data;

    expect(row.kind).toBe(ProductFeedbackKind.SetupFlow);
    expect(row.topic).toBe("website_down");
    expect(row.score).toBe(4);
    expect(row.isPositive).toBeUndefined();
    expect(row.details).toBe("Fine.");
    expect(row.page).toBe("/dashboard/:projectId/monitors/setup");
    expect(row.productVersion).toBe("14.0.108");
    expect(create.mock.calls[0]![0].props).toEqual({ isRoot: true });
  });

  test("words are added to a fresh one-click answer that has none", async () => {
    const answer: ProductFeedback = new ProductFeedback();
    answer.id = ANSWER_ID;
    answer.kind = ProductFeedbackKind.SetupFlow;
    answer.createdAt = new Date(NOW.getTime() - 5 * 60 * 1000);
    findAnswer.mockResolvedValue(answer as never);

    expect(
      await ProductFeedbackService.addDetails({
        answerId: ANSWER_ID,
        details: "The phone step.",
        now: NOW,
      }),
    ).toBe(true);
    expect(
      (updateAnswer.mock.calls[0]![0] as { data: JSONObject }).data,
    ).toEqual({ details: "The phone step." });
  });

  test("never to an old answer, one with words, Give feedback, a thumb, or one that is not there", async () => {
    const answers: Array<ProductFeedback | null> = [];

    const old: ProductFeedback = new ProductFeedback();
    old.kind = ProductFeedbackKind.CheckIn;
    old.createdAt = new Date(NOW.getTime() - 61 * 60 * 1000);
    answers.push(old);

    const written: ProductFeedback = new ProductFeedback();
    written.kind = ProductFeedbackKind.SetupFlow;
    written.details = "Already said.";
    written.createdAt = NOW;
    answers.push(written);

    for (const kind of [
      ProductFeedbackKind.General,
      ProductFeedbackKind.Explanation,
    ]) {
      const other: ProductFeedback = new ProductFeedback();
      other.kind = kind;
      other.createdAt = NOW;
      answers.push(other);
    }

    answers.push(null);

    for (const answer of answers) {
      findAnswer.mockResolvedValue(answer as never);

      expect(
        await ProductFeedbackService.addDetails({
          answerId: ANSWER_ID,
          details: "More.",
          now: NOW,
        }),
      ).toBe(false);
    }

    expect(updateAnswer).not.toHaveBeenCalled();
  });
});

describe("Ask AI's thumbs", () => {
  const ratedDownAnswer: () => AIConversationMessage =
    (): AIConversationMessage => {
      const answer: AIConversationMessage = new AIConversationMessage();
      answer.id = ANSWER_ID;
      answer.conversationId = PROJECT_ID;
      answer.createdAt = new Date(NOW.getTime() - DAY_MS);
      answer.updatedAt = new Date(NOW.getTime() - DAY_MS);
      return answer;
    };

  beforeEach(() => {
    jest
      .spyOn(AIConversationMessageService, "countBy")
      .mockImplementation((async (data: { query: JSONObject }) => {
        return new PositiveNumber(
          data.query["userFeedback"] === AIConversationMessageFeedback.Up
            ? 7
            : 3,
        );
      }) as never);
    jest
      .spyOn(AIConversationMessageService, "findBy")
      .mockResolvedValue([ratedDownAnswer()] as never);

    const question: AIConversationMessage = new AIConversationMessage();
    question.contentInMarkdown = "How do I page my team by phone?";
    jest
      .spyOn(AIConversationMessageService, "findOneBy")
      .mockResolvedValue(question as never);
  });

  test("on a self-hosted server: the counts and the questions behind the answers rated down", async () => {
    const ratings: Awaited<
      ReturnType<typeof ProductFeedbackService.getAskAiRatings>
    > = await ProductFeedbackService.getAskAiRatings(
      new Date(NOW.getTime() - 90 * DAY_MS),
    );

    expect(ratings.helpful).toBe(7);
    expect(ratings.notHelpful).toBe(3);
    expect(ratings.ratedDown).toEqual([
      {
        question: "How do I page my team by phone?",
        ratedAt: new Date(NOW.getTime() - DAY_MS).toISOString(),
      },
    ]);
  });

  test("on OneUptime Cloud: the counts only - customers' questions are never shown across projects", async () => {
    mockIsBillingEnabled = true;

    const ratings: Awaited<
      ReturnType<typeof ProductFeedbackService.getAskAiRatings>
    > = await ProductFeedbackService.getAskAiRatings(
      new Date(NOW.getTime() - 90 * DAY_MS),
    );

    expect(ratings).toEqual({
      helpful: 7,
      notHelpful: 3,
      ratedDown: null,
      // What they read, from their tools' names: no question.
      ratedDownDrewOn: [{ source: AskAiSourceOfNoProduct.Nothing, answers: 1 }],
    });
    expect(AIConversationMessageService.findOneBy).not.toHaveBeenCalled();

    // The one read of the answers rated down asks for their citations alone.
    const reads: Array<{ select: JSONObject }> = (
      AIConversationMessageService.findBy as unknown as {
        mock: { calls: Array<[{ select: JSONObject }]> };
      }
    ).mock.calls.map((call: [{ select: JSONObject }]) => {
      return call[0];
    });

    expect(reads).toHaveLength(1);
    expect(reads[0]!.select).toEqual({ _id: true, citations: true });
  });
});

const citationOf: (toolName: string) => AIChatCitation = (
  toolName: string,
): AIChatCitation => {
  return {
    id: "C1",
    toolName: toolName,
    label: `Ran ${toolName}`,
    queryArguments: { query: "maya@acme.example checkout errors" },
    rowCount: 3,
  };
};

describe("what Ask AI's answers rated down read (#7365)", () => {
  let reads: Array<{ query: JSONObject; select: JSONObject; limit: number }>;
  let counts: Array<{ query: JSONObject }>;

  const answerWith: (
    toolNames: Array<string> | null,
  ) => AIConversationMessage = (
    toolNames: Array<string> | null,
  ): AIConversationMessage => {
    const answer: AIConversationMessage = new AIConversationMessage();
    answer.id = ANSWER_ID;

    if (toolNames) {
      answer.citations = toolNames.map(citationOf);
    }

    return answer;
  };

  beforeEach(() => {
    reads = [];
    counts = [];
    jest
      .spyOn(AIConversationMessageService, "countBy")
      .mockImplementation((async (data: { query: JSONObject }) => {
        counts.push(data);
        return new PositiveNumber(
          data.query["userFeedback"] === AIConversationMessageFeedback.Up
            ? 12
            : 4,
        );
      }) as never);
    jest
      .spyOn(AIConversationMessageService, "findBy")
      .mockImplementation((async (data: {
        query: JSONObject;
        select: JSONObject;
        limit: number;
      }) => {
        reads.push(data);
        return [
          answerWith(["search_logs", "log_histogram"]),
          answerWith(["search_logs", "query_incidents"]),
          answerWith(["read_docs"]),
          answerWith(["query_probes"]),
          answerWith(null),
        ];
      }) as never);
    jest.spyOn(AIConversationMessageService, "findOneBy");
  });

  test("a project's owners read its counts and what its answers rated down read: each source once an answer, most first", async () => {
    const ratings: Awaited<
      ReturnType<typeof ProductFeedbackService.getProjectAskAiRatings>
    > = await ProductFeedbackService.getProjectAskAiRatings({
      projectId: PROJECT_ID,
      now: NOW,
    });

    expect(ratings).toEqual({
      sinceDays: ASK_AI_RATINGS_DAYS,
      helpful: 12,
      notHelpful: 4,
      ratedDownDrewOn: [
        { source: ProductKey.Logs, answers: 2 },
        { source: ProductKey.Incidents, answers: 1 },
        { source: AskAiSourceOfNoProduct.Docs, answers: 1 },
        { source: AskAiSourceOfNoProduct.OtherData, answers: 1 },
        { source: AskAiSourceOfNoProduct.Nothing, answers: 1 },
      ],
    });
  });

  test("only the project's own answers are counted or read, over the last 90 days, and never a question, an answer or a tool's arguments", async () => {
    await ProductFeedbackService.getProjectAskAiRatings({
      projectId: PROJECT_ID,
      now: NOW,
    });

    const since: Date = new Date(NOW.getTime() - 90 * DAY_MS);

    for (const read of [...counts, ...reads]) {
      expect(read.query["projectId"]).toEqual(PROJECT_ID);
      expect(JSON.stringify(read.query["updatedAt"])).toContain(
        since.toISOString(),
      );
    }

    expect(counts).toHaveLength(2);
    expect(reads).toHaveLength(1);
    expect(reads[0]!.query["userFeedback"]).toBe(
      AIConversationMessageFeedback.Down,
    );
    expect(reads[0]!.select).toEqual({ _id: true, citations: true });
    expect(reads[0]!.limit).toBe(1000);
    expect(AIConversationMessageService.findOneBy).not.toHaveBeenCalled();
  });

  test("the Admin Dashboard's count reads every project's", async () => {
    await ProductFeedbackService.getAskAiRatedDownSources({
      since: new Date(NOW.getTime() - 90 * DAY_MS),
      projectId: null,
    });

    expect(reads[0]!.query["projectId"]).toBeUndefined();
  });
});

describe("how long an answer is kept, and deleting one (#7366)", () => {
  test("a year, by when it was given: the daily purge deletes the older ones", () => {
    expect(PRODUCT_FEEDBACK_RETENTION_IN_DAYS).toBe(365);
    expect(ProductFeedbackService.hardDeleteItemByColumnName).toBe("createdAt");
    expect(ProductFeedbackService.hardDeleteItemsOlderThanDays).toBe(365);
    // Read by HardDelete:HardDeleteOlderItemsInDatabase's walk, on every server.
    expect(OlderRowsPurge.isPurged(ProductFeedbackService)).toBe(true);
  });

  test("the cut-off is a year before now", () => {
    jest.spyOn(OlderRowsPurge, "now").mockReturnValue(NOW);

    expect(
      OlderRowsPurge.getCutoff(ProductFeedbackService as never).getTime(),
    ).toBe(NOW.getTime() - 365 * DAY_MS);
  });

  test("a master admin's delete removes the answer for good, at once, by its id", async () => {
    const hardDelete: SpyInstance<typeof ProductFeedbackService.hardDeleteBy> =
      jest.spyOn(ProductFeedbackService, "hardDeleteBy").mockResolvedValue(1);

    expect(await ProductFeedbackService.deleteAnswer(ANSWER_ID)).toBe(true);
    expect(hardDelete).toHaveBeenCalledWith({
      query: { _id: ANSWER_ID.toString() },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });
  });

  test("an answer that is not there is not pretended away", async () => {
    jest.spyOn(ProductFeedbackService, "hardDeleteBy").mockResolvedValue(0);

    expect(await ProductFeedbackService.deleteAnswer(ANSWER_ID)).toBe(false);
  });
});

describe("Was this page helpful?, kept on the server (#7209)", () => {
  const submission: ReturnType<typeof toDocsFeedbackSubmission> =
    toDocsFeedbackSubmission({
      page: "monitor/website-monitor",
      language: "de",
      isHelpful: false,
      reason: DocsFeedbackReason.Missing,
      version: "16.0.0",
    });

  beforeEach(() => {
    ProductFeedbackService.forgetDocsFeedbackSetting();
  });

  afterEach(() => {
    ProductFeedbackService.forgetDocsFeedbackSetting();
  });

  test("off unless a master admin switched it on: nothing is kept", async () => {
    config = new GlobalConfig();

    expect(await ProductFeedbackService.isDocsFeedbackKept()).toBe(false);
    expect(await ProductFeedbackService.keepDocsAnswer(submission!)).toBe(
      false,
    );
    expect(create).not.toHaveBeenCalled();
  });

  test("on: the page, its language, the no and its reason are kept, as a docs page's answer", async () => {
    config = new GlobalConfig();
    config.keepDocsFeedback = true;

    expect(await ProductFeedbackService.keepDocsAnswer(submission!)).toBe(true);

    const kept: ProductFeedback = (
      create.mock.calls[0]![0] as unknown as { data: ProductFeedback }
    ).data;

    expect(kept.kind).toBe(ProductFeedbackKind.DocsPage);
    expect(kept.topic).toBe("monitor/website-monitor");
    expect(kept.isPositive).toBe(false);
    expect(kept.reason).toBe(DocsFeedbackReason.Missing);
    expect(kept.page).toBe("/docs/de/monitor/website-monitor");
    expect(kept.productVersion).toBe("16.0.0");
    expect(kept.details).toBeUndefined();
  });

  test("the setting is read once for the docs pages that ask within half a minute, and a failed read keeps nothing", async () => {
    config = new GlobalConfig();
    config.keepDocsFeedback = true;

    const read: SpyInstance<typeof GlobalConfigService.findOneById> =
      jest.spyOn(GlobalConfigService, "findOneById");

    expect(await ProductFeedbackService.isDocsFeedbackKept()).toBe(true);
    expect(await ProductFeedbackService.isDocsFeedbackKept()).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]![0]).toMatchObject({
      select: { keepDocsFeedback: true },
      props: { isRoot: true },
    });

    ProductFeedbackService.forgetDocsFeedbackSetting();
    read.mockRejectedValueOnce(new Error("The database is asleep."));

    expect(await ProductFeedbackService.isDocsFeedbackKept()).toBe(false);
  });

  test("only a docs page's answer goes through the docs' door", async () => {
    config = new GlobalConfig();
    config.keepDocsFeedback = true;

    expect(
      await ProductFeedbackService.keepDocsAnswer({
        ...submission!,
        kind: ProductFeedbackKind.General,
      }),
    ).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  test("a reason is kept only for a docs page's answer, never for another kind", async () => {
    await ProductFeedbackService.submit({
      kind: ProductFeedbackKind.CheckIn,
      topic: "first_week",
      score: null,
      isPositive: false,
      details: null,
      page: "/dashboard/:projectId/home",
      version: "16.0.0",
      reason: DocsFeedbackReason.Wrong,
    });

    expect(
      (create.mock.calls[0]![0] as unknown as { data: ProductFeedback }).data
        .reason,
    ).toBeUndefined();
  });

  test("the Admin Dashboard's summary sums docs answers up by page, apart from the questions, and says how long answers are kept", async () => {
    jest
      .spyOn(ProductFeedbackService, "findBy")
      .mockImplementation((async () => {
        const docs: (
          helpful: boolean,
          reason?: DocsFeedbackReason,
        ) => ProductFeedback = (
          helpful: boolean,
          reason?: DocsFeedbackReason,
        ): ProductFeedback => {
          const answer: ProductFeedback = new ProductFeedback();
          answer.kind = ProductFeedbackKind.DocsPage;
          answer.topic = "monitor/website-monitor";
          answer.isPositive = helpful;
          if (reason) {
            answer.reason = reason;
          }
          return answer;
        };
        const setup: ProductFeedback = new ProductFeedback();
        setup.kind = ProductFeedbackKind.SetupFlow;
        setup.topic = "website_down";
        setup.score = 4;

        return [
          docs(false, DocsFeedbackReason.Unclear),
          docs(false, DocsFeedbackReason.Unclear),
          docs(true),
          setup,
        ];
      }) as never);
    jest
      .spyOn(ProductFeedbackService, "getAskAiRatings")
      .mockResolvedValue({ helpful: 0, notHelpful: 0, ratedDown: null });

    const summary: Awaited<
      ReturnType<typeof ProductFeedbackService.getAdminSummary>
    > = await ProductFeedbackService.getAdminSummary(NOW);

    expect(summary.retentionInDays).toBe(365);
    expect(
      summary.topics.map((topic: { kind: ProductFeedbackKind }) => {
        return topic.kind;
      }),
    ).toEqual([ProductFeedbackKind.SetupFlow]);
    expect(summary.docsPages).toEqual([
      {
        page: "monitor/website-monitor",
        answers: 3,
        helpful: 1,
        notHelpful: 2,
        reasons: [{ reason: DocsFeedbackReason.Unclear, answers: 2 }],
      },
    ]);
  });
});
