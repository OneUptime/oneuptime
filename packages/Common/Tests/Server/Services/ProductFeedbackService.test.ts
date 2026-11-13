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
 *    never on OneUptime Cloud.
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
import {
  FeedbackQuestionDecision,
  ProductFeedbackKind,
} from "../../../Types/ProductFeedback/ProductFeedback";

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
    });

    user = makeUser({ disableFeedbackQuestions: true });
    expect(await ProductFeedbackService.getSettings(USER_ID)).toEqual({
      isOn: true,
      isAskingMe: false,
    });

    user = makeUser({});
    config!.disableProductFeedback = true;
    expect(await ProductFeedbackService.getSettings(USER_ID)).toEqual({
      isOn: false,
      isAskingMe: false,
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

    expect(ratings).toEqual({ helpful: 7, notHelpful: 3, ratedDown: null });
    expect(AIConversationMessageService.findBy).not.toHaveBeenCalled();
    expect(AIConversationMessageService.findOneBy).not.toHaveBeenCalled();
  });
});
