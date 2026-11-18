import {
  DASHBOARD_FEEDBACK_KINDS,
  DOCS_FEEDBACK_REASONS,
  DOCS_FEEDBACK_REASON_TITLES,
  DocsFeedbackReason,
  PRODUCT_FEEDBACK_ADMIN_ANSWER_ROUTE,
  PRODUCT_FEEDBACK_KINDS,
  PRODUCT_FEEDBACK_KIND_TITLES,
  PRODUCT_FEEDBACK_RETENTION_IN_DAYS,
  ProductFeedbackKind,
  getProductFeedbackAdminAnswerRoute,
  getProductFeedbackTopicTitle,
  isDashboardFeedbackKind,
  isDocsFeedbackReason,
  isProductFeedbackKind,
  readProductFeedbackSubmission,
  summarizeDocsPageFeedback,
  summarizeProductFeedback,
  toDocsFeedbackSubmission,
} from "../../../Types/ProductFeedback/ProductFeedback";
import { describe, expect, test } from "@jest/globals";

/*
 * "WAS THIS PAGE HELPFUL?" KEPT ON THE SERVER (#7209), AND HOW LONG AN
 * ANSWER IS KEPT (#7366): the rules the docs server, the service and the
 * Admin Dashboard read.
 */

describe("a docs page's answer is the docs server's alone", () => {
  test("it is a kind of answer the Admin Dashboard lists, which the Dashboard never posts", () => {
    expect(PRODUCT_FEEDBACK_KINDS).toContain(ProductFeedbackKind.DocsPage);
    expect(isProductFeedbackKind("docs_page")).toBe(true);
    expect(DASHBOARD_FEEDBACK_KINDS).not.toContain(
      ProductFeedbackKind.DocsPage,
    );
    expect(isDashboardFeedbackKind("docs_page")).toBe(false);
    expect(DASHBOARD_FEEDBACK_KINDS).toEqual([
      ProductFeedbackKind.SetupFlow,
      ProductFeedbackKind.General,
      ProductFeedbackKind.Explanation,
      ProductFeedbackKind.CheckIn,
    ]);
  });

  test("posted as an answer anyway, it is refused with what may be posted", () => {
    const refusal: unknown = readProductFeedbackSubmission({
      kind: "docs_page",
      topic: "monitor/website-monitor",
      isPositive: true,
    });

    expect(typeof refusal).toBe("string");
    expect(refusal).toBe(
      "Set kind to one of setup_flow, general, explanation, check_in, then send the answer again.",
    );
  });

  test("an answer the Dashboard posts never carries a reason, whatever it sends", () => {
    expect(
      readProductFeedbackSubmission({
        kind: "check_in",
        isPositive: false,
        reason: "unclear",
      }),
    ).not.toHaveProperty("reason");
  });
});

describe("a docs answer, as it is kept", () => {
  test("the page is its topic, the page it was read on - with its language - its page, and a no keeps its reason", () => {
    expect(
      toDocsFeedbackSubmission({
        page: "on-call/escalation-rules",
        language: "zh-CN",
        isHelpful: false,
        reason: DocsFeedbackReason.NotFound,
        version: "16.0.0",
      }),
    ).toEqual({
      kind: ProductFeedbackKind.DocsPage,
      topic: "on-call/escalation-rules",
      score: null,
      isPositive: false,
      reason: DocsFeedbackReason.NotFound,
      details: null,
      page: "/docs/zh-CN/on-call/escalation-rules",
      version: "16.0.0",
    });
  });

  test("a yes keeps no reason, and a reason that is not one of the four is dropped", () => {
    expect(
      toDocsFeedbackSubmission({
        page: "monitor/website-monitor",
        language: "en",
        isHelpful: true,
        reason: DocsFeedbackReason.Wrong,
        version: "16.0.0",
      })?.reason,
    ).toBeNull();
    expect(
      toDocsFeedbackSubmission({
        page: "monitor/website-monitor",
        language: "en",
        isHelpful: false,
        reason: "my email is maya@acme.example" as DocsFeedbackReason,
        version: "16.0.0",
      })?.reason,
    ).toBeNull();
  });

  test("anything that is not a docs page's address, or a language, keeps nothing", () => {
    for (const page of [
      "",
      "/monitor/website-monitor",
      "monitor/../../etc/passwd",
      "Monitor/Website-Monitor",
      "monitor/website-monitor?email=maya@acme.example",
      "monitor//website-monitor",
      "x".repeat(101),
    ]) {
      expect({
        page,
        kept: toDocsFeedbackSubmission({
          page: page,
          language: "en",
          isHelpful: true,
          version: "16.0.0",
        }),
      }).toEqual({ page, kept: null });
    }

    expect(
      toDocsFeedbackSubmission({
        page: "monitor/website-monitor",
        language: "english please",
        isHelpful: true,
        version: "16.0.0",
      }),
    ).toBeNull();
  });

  test("a version that is not one is kept as none", () => {
    expect(
      toDocsFeedbackSubmission({
        page: "monitor/website-monitor",
        language: "en",
        isHelpful: true,
        version: "16.0.0 (built by maya@acme.example)",
      })?.version,
    ).toBe("");
  });

  test("the four reasons are the docs page's, in its order, each with its words", () => {
    expect(DOCS_FEEDBACK_REASONS).toEqual([
      "unclear",
      "missing",
      "wrong",
      "not_found",
    ]);
    expect(DOCS_FEEDBACK_REASON_TITLES).toEqual({
      unclear: "Hard to follow",
      missing: "Something is missing",
      wrong: "Wrong or out of date",
      not_found: "Not what I was looking for",
    });
    expect(isDocsFeedbackReason("missing")).toBe(true);
    expect(isDocsFeedbackReason("Missing")).toBe(false);
    expect(isDocsFeedbackReason(null)).toBe(false);
  });

  test("its kind reads as the docs' question, and its topic as the page", () => {
    expect(PRODUCT_FEEDBACK_KIND_TITLES[ProductFeedbackKind.DocsPage]).toBe(
      "Was this page helpful?",
    );
    expect(
      getProductFeedbackTopicTitle({
        kind: ProductFeedbackKind.DocsPage,
        topic: "monitor/website-monitor",
      }),
    ).toBe("monitor/website-monitor");
  });
});

describe("the docs pages, summed up", () => {
  test("by page: the most noes first, then the larger share, then the most answers, each with its reasons most said first", () => {
    expect(
      summarizeDocsPageFeedback([
        { page: "a/one", isHelpful: true, reason: null },
        { page: "a/one", isHelpful: true, reason: null },
        { page: "b/two", isHelpful: false, reason: "missing" },
        { page: "b/two", isHelpful: false, reason: "unclear" },
        { page: "b/two", isHelpful: false, reason: "unclear" },
        { page: "c/three", isHelpful: false, reason: null },
        { page: "d/four", isHelpful: false, reason: "wrong" },
        { page: "d/four", isHelpful: true, reason: null },
        { page: "d/four", isHelpful: true, reason: null },
      ]),
    ).toEqual([
      {
        page: "b/two",
        answers: 3,
        helpful: 0,
        notHelpful: 3,
        reasons: [
          { reason: "unclear", answers: 2 },
          { reason: "missing", answers: 1 },
        ],
      },
      {
        page: "c/three",
        answers: 1,
        helpful: 0,
        notHelpful: 1,
        reasons: [],
      },
      {
        page: "d/four",
        answers: 3,
        helpful: 2,
        notHelpful: 1,
        reasons: [{ reason: "wrong", answers: 1 }],
      },
      {
        page: "a/one",
        answers: 2,
        helpful: 2,
        notHelpful: 0,
        reasons: [],
      },
    ]);
  });

  test("a reason that is not one of the four, or one given with a yes, is not counted", () => {
    expect(
      summarizeDocsPageFeedback([
        { page: "a/one", isHelpful: true, reason: "unclear" },
        { page: "a/one", isHelpful: false, reason: "rubbish" },
        { page: "", isHelpful: false, reason: "unclear" },
      ]),
    ).toEqual([
      { page: "a/one", answers: 2, helpful: 1, notHelpful: 1, reasons: [] },
    ]);
  });

  test("the questions' summary leaves docs answers to theirs", () => {
    expect(
      summarizeProductFeedback([
        {
          kind: ProductFeedbackKind.DocsPage,
          topic: "a/one",
          score: null,
          isPositive: false,
          hasDetails: false,
        },
        {
          kind: ProductFeedbackKind.SetupFlow,
          topic: "website_down",
          score: 2,
          isPositive: null,
          hasDetails: false,
        },
      ]).map((summary: { kind: ProductFeedbackKind }) => {
        return summary.kind;
      }),
    ).toEqual([ProductFeedbackKind.SetupFlow]);
  });
});

describe("how long an answer is kept, and its delete (#7366)", () => {
  test("a year", () => {
    expect(PRODUCT_FEEDBACK_RETENTION_IN_DAYS).toBe(365);
  });

  test("one answer's address, its id encoded", () => {
    expect(PRODUCT_FEEDBACK_ADMIN_ANSWER_ROUTE).toBe(
      "/product-feedback/admin/answer",
    );
    expect(
      getProductFeedbackAdminAnswerRoute(
        "33333333-3333-4333-8333-333333333333",
      ),
    ).toBe(
      "/product-feedback/admin/answer/33333333-3333-4333-8333-333333333333",
    );
    expect(getProductFeedbackAdminAnswerRoute("a/b?c")).toBe(
      "/product-feedback/admin/answer/a%2Fb%3Fc",
    );
  });
});
