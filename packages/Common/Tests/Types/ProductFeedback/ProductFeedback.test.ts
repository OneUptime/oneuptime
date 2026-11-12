import {
  CHECK_IN_TOPIC,
  FEEDBACK_QUESTIONS_KEPT,
  FeedbackQuestionDecision,
  GENERAL_FEEDBACK_TOPIC,
  PRODUCT_FEEDBACK_DETAILS_MAX_LENGTH,
  PRODUCT_FEEDBACK_PAGE_MAX_LENGTH,
  PRODUCT_FEEDBACK_SUBMISSION_FIELDS,
  PRODUCT_FEEDBACK_TOPIC_MAX_LENGTH,
  ProductFeedbackKind,
  ProductFeedbackSubmission,
  ProductFeedbackTopicSummary,
  decideFeedbackQuestion,
  getFeedbackQuestionKey,
  getProductFeedbackTopicTitle,
  isCheckInDue,
  isProductFeedbackKind,
  readAskedQuestions,
  readFeedbackQuestionKey,
  readProductFeedbackSettings,
  readProductFeedbackSubmission,
  summarizeProductFeedback,
  toFeedbackDetails,
  toFeedbackPage,
  toFeedbackTopic,
  toFeedbackVersion,
  withAskedQuestion,
} from "../../../Types/ProductFeedback/ProductFeedback";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * Asking people (issue #6832): what an answer may carry - and that nothing
 * else is kept - and the rules for when OneUptime asks a question.
 */

const DAY_MS: number = 24 * 60 * 60 * 1000;
const NOW: Date = new Date("2026-11-12T12:00:00.000Z");

const daysAgo: (days: number) => string = (days: number): string => {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
};

const read: (body: JSONObject) => ProductFeedbackSubmission = (
  body: JSONObject,
): ProductFeedbackSubmission => {
  const submission: ProductFeedbackSubmission | string =
    readProductFeedbackSubmission(body);

  if (typeof submission === "string") {
    throw new Error(`Refused: ${submission}`);
  }

  return submission;
};

describe("the page an answer carries is a route with no ids", () => {
  test("a route pattern from the Dashboard is kept as it is", () => {
    expect(toFeedbackPage("/dashboard/:projectId/monitors/:id")).toBe(
      "/dashboard/:projectId/monitors/:id",
    );
  });

  test("a full address loses its ids, its query and its fragment", () => {
    expect(
      toFeedbackPage(
        "/dashboard/10000000-0000-4000-8000-000000006831/monitors/50000000-0000-4000-8000-000000000001/criteria?tab=2#top",
      ),
    ).toBe("/dashboard/:id/monitors/:id/criteria");
  });

  test("numbers, names, emails, addresses and encoded values become :id", () => {
    expect(
      toFeedbackPage(
        "/dashboard/x/incidents/42/ada@example.com/My%20Monitor/www.acme.com/Acme/v2",
      ),
    ).toBe("/dashboard/x/incidents/:id/:id/:id/:id/:id/:id");
  });

  test("words with hyphens stay; a long one does not", () => {
    expect(toFeedbackPage("/dashboard/on-call-duty/policies")).toBe(
      "/dashboard/on-call-duty/policies",
    );
    expect(toFeedbackPage(`/dashboard/${"a".repeat(41)}`)).toBe(
      "/dashboard/:id",
    );
  });

  test("anything that is not a string is the root", () => {
    expect(toFeedbackPage(undefined)).toBe("/");
    expect(toFeedbackPage(42)).toBe("/");
    expect(toFeedbackPage({ path: "/x" })).toBe("/");
    expect(toFeedbackPage("")).toBe("/");
  });

  test("a page longer than the column is cut at a segment", () => {
    const page: string = toFeedbackPage(
      `/${Array.from({ length: 40 }, () => {
        return "segment";
      }).join("/")}`,
    );

    expect(page.length).toBeLessThanOrEqual(PRODUCT_FEEDBACK_PAGE_MAX_LENGTH);
    expect(page.endsWith("/segment")).toBe(true);
  });
});

describe("the version, the topic and the words", () => {
  test("a version is kept only as a version", () => {
    expect(toFeedbackVersion("14.0.108")).toBe("14.0.108");
    expect(toFeedbackVersion("14.0.108-rc.1+build")).toBe(
      "14.0.108-rc.1+build",
    );
    expect(toFeedbackVersion("14.0 <script>")).toBe("");
    expect(toFeedbackVersion("1".repeat(41))).toBe("");
    expect(toFeedbackVersion(14)).toBe("");
  });

  test("a topic is a lower-case word the code chose", () => {
    expect(toFeedbackTopic("Website Down!")).toBe("website_down_");
    expect(toFeedbackTopic("term.on-call-policy")).toBe("term.on-call-policy");
    expect(toFeedbackTopic("x".repeat(200)).length).toBe(
      PRODUCT_FEEDBACK_TOPIC_MAX_LENGTH,
    );
  });

  test("words are trimmed, cut to the most kept, and nothing is null", () => {
    expect(toFeedbackDetails("  hard to find  ")).toBe("hard to find");
    expect(toFeedbackDetails("   ")).toBeNull();
    expect(toFeedbackDetails(undefined)).toBeNull();
    expect(toFeedbackDetails("x".repeat(5000))?.length).toBe(
      PRODUCT_FEEDBACK_DETAILS_MAX_LENGTH,
    );
  });

  test("the kinds", () => {
    expect(isProductFeedbackKind("setup_flow")).toBe(true);
    expect(isProductFeedbackKind("nps")).toBe(false);
    expect(isProductFeedbackKind(undefined)).toBe(false);
  });
});

describe("what an answer is kept with, and nothing else", () => {
  test("only the answer, the page and the version are read; anything else posted is dropped", () => {
    const submission: ProductFeedbackSubmission = read({
      kind: "general",
      details: "I could not find where to add a phone number.",
      page: "/dashboard/10000000-0000-4000-8000-000000006831/home",
      version: "14.0.108",
      // Nothing below may reach the table.
      userId: "40000000-0000-4000-8000-000000000001",
      projectId: "10000000-0000-4000-8000-000000006831",
      email: "ada@example.com",
      url: "https://oneuptime.example/dashboard/10000000-0000-4000-8000-000000006831/home",
      name: "Ada Lovelace",
      ip: "203.0.113.7",
    });

    expect(Object.keys(submission).sort()).toEqual(
      [...PRODUCT_FEEDBACK_SUBMISSION_FIELDS].sort(),
    );
    expect(submission).toEqual({
      kind: ProductFeedbackKind.General,
      topic: GENERAL_FEEDBACK_TOPIC,
      score: null,
      isPositive: null,
      details: "I could not find where to add a phone number.",
      page: "/dashboard/:id/home",
      version: "14.0.108",
    });
    expect(JSON.stringify(submission)).not.toContain("ada@example.com");
    expect(JSON.stringify(submission)).not.toContain("10000000-0000");
  });

  test("the end of a setup: its key and a score of 1 to 5, words optional", () => {
    expect(
      read({
        kind: "setup_flow",
        topic: "website_down",
        score: 2,
        page: "/dashboard/:projectId/monitors/setup",
        version: "14.0.108",
      }),
    ).toEqual({
      kind: ProductFeedbackKind.SetupFlow,
      topic: "website_down",
      score: 2,
      isPositive: null,
      details: null,
      page: "/dashboard/:projectId/monitors/setup",
      version: "14.0.108",
    });
  });

  test("a setup's answer needs its key and a whole score from 1 to 5", () => {
    for (const score of [0, 6, 2.5, "3", null, undefined]) {
      expect(
        typeof readProductFeedbackSubmission({
          kind: "setup_flow",
          topic: "website_down",
          score: score as never,
        }),
      ).toBe("string");
    }

    expect(
      readProductFeedbackSubmission({ kind: "setup_flow", score: 3 }),
    ).toMatch(/topic/);
  });

  test("Give feedback needs words", () => {
    expect(
      readProductFeedbackSubmission({ kind: "general", details: "  " }),
    ).toMatch(/Write what you were trying to do/);
  });

  test("a thumb carries no words and no score", () => {
    expect(
      read({
        kind: "explanation",
        topic: "term.criteria",
        isPositive: false,
        details: "should be dropped",
        score: 4,
      }),
    ).toEqual({
      kind: ProductFeedbackKind.Explanation,
      topic: "term.criteria",
      score: null,
      isPositive: false,
      details: null,
      page: "/",
      version: "",
    });
  });

  test("the check-in is yes or not yet, under its own topic, with optional words", () => {
    expect(
      read({ kind: "check_in", topic: "anything", isPositive: false }),
    ).toMatchObject({
      kind: ProductFeedbackKind.CheckIn,
      topic: CHECK_IN_TOPIC,
      isPositive: false,
      score: null,
    });
    expect(readProductFeedbackSubmission({ kind: "check_in" })).toMatch(
      /isPositive/,
    );
  });

  test("anything that is not an answer is refused with a sentence that says what to do", () => {
    for (const body of [undefined, null, "text", [], {}, { kind: "nps" }]) {
      const refusal: ProductFeedbackSubmission | string =
        readProductFeedbackSubmission(body as never);

      expect(typeof refusal).toBe("string");
      expect(refusal as string).toMatch(/^[A-Z].*\.$/);
    }
  });
});

describe("question keys", () => {
  test("a question is named by its kind and topic", () => {
    expect(
      getFeedbackQuestionKey({
        kind: ProductFeedbackKind.SetupFlow,
        topic: "website_down",
      }),
    ).toBe("setup_flow:website_down");
  });

  test("only the questions OneUptime asks are keys", () => {
    expect(readFeedbackQuestionKey("setup_flow:website_down")).toBe(
      "setup_flow:website_down",
    );
    expect(
      readFeedbackQuestionKey("check_in:10000000-0000-4000-8000-000000006831"),
    ).toBe("check_in:10000000-0000-4000-8000-000000006831");
    expect(readFeedbackQuestionKey("general:help")).toBeNull();
    expect(readFeedbackQuestionKey("explanation:how_oneuptime_works")).toBe(
      null,
    );
    expect(readFeedbackQuestionKey("setup_flow:")).toBeNull();
    expect(readFeedbackQuestionKey("setup_flow:Website Down")).toBeNull();
    expect(readFeedbackQuestionKey("setup_flow")).toBeNull();
    expect(readFeedbackQuestionKey(7)).toBeNull();
  });

  test("a person's asked questions keep only keys with dates", () => {
    expect(
      readAskedQuestions({
        "setup_flow:website_down": daysAgo(3),
        "general:help": daysAgo(1),
        "setup_flow:on_call": "not a date",
        "check_in:abc": 4,
      } as JSONObject),
    ).toEqual({ "setup_flow:website_down": daysAgo(3) });
    expect(readAskedQuestions(null)).toEqual({});
    expect(readAskedQuestions([] as never)).toEqual({});
  });

  test("a new question is added, and only the newest are kept", () => {
    const asked: Record<string, string> = {};

    for (let index: number = 0; index < FEEDBACK_QUESTIONS_KEPT + 5; index++) {
      asked[`setup_flow:setup_${index}`] = daysAgo(400 - index);
    }

    const kept: Record<string, string> = withAskedQuestion({
      asked: asked,
      key: "setup_flow:website_down",
      now: NOW,
    });

    expect(Object.keys(kept).length).toBe(FEEDBACK_QUESTIONS_KEPT);
    expect(kept["setup_flow:website_down"]).toBe(NOW.toISOString());
    // The oldest went first.
    expect(kept["setup_flow:setup_0"]).toBeUndefined();
  });
});

describe("when OneUptime asks a question", () => {
  const decide: (overrides: {
    isServerOn?: boolean;
    isPersonOn?: boolean;
    asked?: Record<string, string>;
    isIncidentOpen?: boolean;
    key?: string;
  }) => FeedbackQuestionDecision = (overrides: {
    isServerOn?: boolean;
    isPersonOn?: boolean;
    asked?: Record<string, string>;
    isIncidentOpen?: boolean;
    key?: string;
  }): FeedbackQuestionDecision => {
    return decideFeedbackQuestion({
      key: overrides.key || "setup_flow:website_down",
      isServerOn: overrides.isServerOn ?? true,
      isPersonOn: overrides.isPersonOn ?? true,
      asked: overrides.asked || {},
      isIncidentOpen: overrides.isIncidentOpen ?? false,
      now: NOW,
    });
  };

  test("a person never asked is asked", () => {
    expect(decide({})).toBe(FeedbackQuestionDecision.Ask);
  });

  test("never once the server switched questions off", () => {
    expect(decide({ isServerOn: false })).toBe(
      FeedbackQuestionDecision.ServerOff,
    );
  });

  test("never once the person switched them off", () => {
    expect(decide({ isPersonOn: false })).toBe(
      FeedbackQuestionDecision.PersonOff,
    );
  });

  test("each question once per person, however long ago", () => {
    expect(decide({ asked: { "setup_flow:website_down": daysAgo(300) } })).toBe(
      FeedbackQuestionDecision.AlreadyAsked,
    );
  });

  test("never while the project has an open incident or alert", () => {
    expect(decide({ isIncidentOpen: true })).toBe(
      FeedbackQuestionDecision.IncidentOpen,
    );
  });

  test("at most one question a week: another asked 6 days ago waits, 7 days ago does not", () => {
    expect(decide({ asked: { "setup_flow:on_call": daysAgo(6.9) } })).toBe(
      FeedbackQuestionDecision.AskedRecently,
    );
    expect(decide({ asked: { "setup_flow:on_call": daysAgo(7) } })).toBe(
      FeedbackQuestionDecision.Ask,
    );
  });

  test("the switches come first, then the rest", () => {
    expect(
      decide({
        isServerOn: false,
        isPersonOn: false,
        isIncidentOpen: true,
        asked: { "setup_flow:website_down": daysAgo(1) },
      }),
    ).toBe(FeedbackQuestionDecision.ServerOff);
    expect(
      decide({
        isPersonOn: false,
        asked: { "setup_flow:website_down": daysAgo(1) },
      }),
    ).toBe(FeedbackQuestionDecision.PersonOff);
  });
});

describe("the first-week check-in's window", () => {
  test("from the 7th day to the 30th after the project was made", () => {
    expect(isCheckInDue({ projectCreatedAt: daysAgo(6.9), now: NOW })).toBe(
      false,
    );
    expect(isCheckInDue({ projectCreatedAt: daysAgo(7), now: NOW })).toBe(true);
    expect(isCheckInDue({ projectCreatedAt: daysAgo(30), now: NOW })).toBe(
      true,
    );
    expect(isCheckInDue({ projectCreatedAt: daysAgo(30.1), now: NOW })).toBe(
      false,
    );
  });

  test("no date, or one that is not a date, is never due", () => {
    expect(isCheckInDue({ projectCreatedAt: null, now: NOW })).toBe(false);
    expect(isCheckInDue({ projectCreatedAt: "yesterday", now: NOW })).toBe(
      false,
    );
    expect(
      isCheckInDue({ projectCreatedAt: new Date(daysAgo(10)), now: NOW }),
    ).toBe(true);
  });
});

describe("the settings the Dashboard reads", () => {
  test("both switches, or nothing", () => {
    expect(
      readProductFeedbackSettings({ isOn: true, isAskingMe: false }),
    ).toEqual({ isOn: true, isAskingMe: false });
    // What an endpoint over nothing answers (the journeys' fixture): off.
    expect(readProductFeedbackSettings({ data: [], count: 0 })).toBeNull();
    expect(readProductFeedbackSettings({ isOn: "yes", isAskingMe: true })).toBe(
      null,
    );
    expect(readProductFeedbackSettings(null)).toBeNull();
  });
});

describe("the Admin Dashboard's summary", () => {
  const summary: Array<ProductFeedbackTopicSummary> = summarizeProductFeedback([
    {
      kind: ProductFeedbackKind.SetupFlow,
      topic: "on_call",
      score: 5,
      isPositive: null,
      hasDetails: false,
    },
    {
      kind: ProductFeedbackKind.SetupFlow,
      topic: "website_down",
      score: 1,
      isPositive: null,
      hasDetails: true,
    },
    {
      kind: ProductFeedbackKind.SetupFlow,
      topic: "website_down",
      score: 4,
      isPositive: null,
      hasDetails: false,
    },
    {
      kind: ProductFeedbackKind.General,
      topic: "help",
      score: null,
      isPositive: null,
      hasDetails: true,
    },
    {
      kind: ProductFeedbackKind.Explanation,
      topic: "term.criteria",
      score: null,
      isPositive: false,
      hasDetails: false,
    },
    {
      kind: ProductFeedbackKind.Explanation,
      topic: "how_oneuptime_works",
      score: null,
      isPositive: true,
      hasDetails: false,
    },
    {
      kind: ProductFeedbackKind.CheckIn,
      topic: "first_week",
      score: null,
      isPositive: false,
      hasDetails: true,
    },
  ]);

  test("setups first, hardest first, then the check-in, explanations (least clear first) and Give feedback", () => {
    expect(
      summary.map((row: ProductFeedbackTopicSummary): string => {
        return `${row.kind}:${row.topic}`;
      }),
    ).toEqual([
      "setup_flow:website_down",
      "setup_flow:on_call",
      "check_in:first_week",
      "explanation:term.criteria",
      "explanation:how_oneuptime_works",
      "general:help",
    ]);
  });

  test("a setup's average, its hard answers and its answers with words", () => {
    expect(summary[0]).toEqual({
      kind: ProductFeedbackKind.SetupFlow,
      topic: "website_down",
      answers: 2,
      averageScore: 2.5,
      hardAnswers: 1,
      positiveAnswers: 0,
      negativeAnswers: 0,
      answersWithDetails: 1,
    });
  });

  test("thumbs and the check-in count yes and no, with no average", () => {
    expect(summary[3]).toMatchObject({
      averageScore: null,
      positiveAnswers: 0,
      negativeAnswers: 1,
    });
    expect(summary[2]).toMatchObject({
      negativeAnswers: 1,
      answersWithDetails: 1,
    });
  });

  test("nothing answered is an empty summary", () => {
    expect(summarizeProductFeedback([])).toEqual([]);
  });
});

describe("what an answer was about, in words", () => {
  test("a setup by its name, an explanation, the check-in", () => {
    expect(
      getProductFeedbackTopicTitle({
        kind: ProductFeedbackKind.SetupFlow,
        topic: "website_down",
      }),
    ).toBe("Know when my website or API is down");
    expect(
      getProductFeedbackTopicTitle({
        kind: ProductFeedbackKind.SetupFlow,
        topic: "a_new_setup",
      }),
    ).toBe("a_new_setup");
    expect(
      getProductFeedbackTopicTitle({
        kind: ProductFeedbackKind.Explanation,
        topic: "how_oneuptime_works",
      }),
    ).toBe("How OneUptime works");
    expect(
      getProductFeedbackTopicTitle({
        kind: ProductFeedbackKind.Explanation,
        topic: "term.on-call-policy",
      }),
    ).toBe("Glossary: on call policy");
    expect(
      getProductFeedbackTopicTitle({
        kind: ProductFeedbackKind.CheckIn,
        topic: "first_week",
      }),
    ).toBe("Is OneUptime set up the way you wanted?");
  });
});
