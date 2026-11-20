import {
  AskAiHowDoICase,
  AskAiSetupCase,
  describeOfferedPage,
  getOfferedPages,
  getQuestionsAsked,
  gradeHowDoITurn,
  gradeSetupTurn,
} from "../../../../../../Server/Utils/AI/Eval/AskAi/AskAiEvalGrades";
import {
  AskAiEvalProject,
  AskAiEvalProjectKind,
  getAskAiEvalProject,
} from "../../../../../../Server/Utils/AI/Eval/AskAi/AskAiEvalProject";
import AskAiEvalReport, {
  AskAiEvalCaseResult,
  AskAiEvalReportInput,
  AskAiEvalRun,
  AskAiEvalSuite,
} from "../../../../../../Server/Utils/AI/Eval/AskAi/AskAiEvalReport";
import {
  AskAiEvalCall,
  AskAiEvalTurn,
} from "../../../../../../Server/Utils/AI/Eval/AskAi/AskAiEvalTurn";
import { JSONObject } from "../../../../../../Types/JSON";
import { DOCS_ANSWER_NOT_COVERED } from "../../../../../../Server/Utils/AI/Chat/ObservabilityChatPrompt";
import {
  AIChatCitation,
  AIChatCitationTargetType,
} from "../../../../../../Types/AI/AIChatTypes";
import { describe, expect, test } from "@jest/globals";

/*
 * How the live-model runner grades Ask AI's answers (#7246, #7066): a setup
 * plan against the request's expected calls, and a how-do-I answer by the
 * docs page it cites and the Go to button under it. And the report both
 * lists share.
 */

const NEW_PROJECT: AskAiEvalProject = getAskAiEvalProject(
  AskAiEvalProjectKind.PagesNobody,
);
const PAGING_PROJECT: AskAiEvalProject = getAskAiEvalProject(
  AskAiEvalProjectKind.PagesPeople,
);

function turnOf(data: Partial<AskAiEvalTurn>): AskAiEvalTurn {
  const proposed: Array<AskAiEvalCall> = data.proposed || [];

  return {
    calls: data.calls || proposed,
    proposed,
    answersWithActions:
      data.answersWithActions ?? (proposed.length > 0 ? 1 : 0),
    onCard: data.onCard || [],
    refusedBeforeCard: data.refusedBeforeCard || [],
    answer: data.answer || "",
    citations: data.citations || [],
    llmCallCount: data.llmCallCount ?? 2,
    totalTokens: data.totalTokens ?? 1000,
    durationMs: data.durationMs ?? 1500,
    ...(data.error ? { error: data.error } : {}),
  };
}

const TEXT_ME: AskAiSetupCase = {
  id: "setup-1",
  request: "Monitor example.com every minute and text me if it is down.",
  projectKind: AskAiEvalProjectKind.PagesNobody,
  expected: [
    {
      tool: "set_up_website_monitoring",
      arguments: { address: "example.com", checkEveryMinutes: 1 },
    },
    { tool: "set_up_paging", arguments: { reachMeBy: ["sms"] } },
  ],
  language: "en",
};

describe("a setup plan", () => {
  test("passes with the request's calls, as the model words them, and arguments the list leaves out", () => {
    const turn: AskAiEvalTurn = turnOf({
      proposed: [
        {
          name: "set_up_website_monitoring",
          arguments: {
            address: "https://example.com/",
            checkEveryMinutes: 1,
            isApi: false,
          },
        },
        { name: "set_up_paging", arguments: { reachMeBy: ["sms", "email"] } },
      ],
    });

    expect(gradeSetupTurn(TEXT_ME, NEW_PROJECT, turn)).toEqual({
      passed: true,
      reasons: [],
    });
  });

  test("names a person by their name or their address", () => {
    const pageAna: AskAiSetupCase = {
      ...TEXT_ME,
      expected: [
        { tool: "set_up_paging", arguments: { alsoPage: ["Ana Lopez"] } },
      ],
    };

    expect(
      gradeSetupTurn(
        pageAna,
        NEW_PROJECT,
        turnOf({
          proposed: [
            {
              name: "set_up_paging",
              arguments: { alsoPage: ["ana@acme.example"] },
            },
          ],
        }),
      ).passed,
    ).toBe(true);
    expect(
      gradeSetupTurn(
        pageAna,
        NEW_PROJECT,
        turnOf({
          proposed: [
            { name: "set_up_paging", arguments: { alsoPage: ["Sam Okafor"] } },
          ],
        }),
      ).reasons,
    ).toEqual([
      'set_up_paging: alsoPage is ["Sam Okafor"], not ["Ana Lopez"].',
    ]);
  });

  test("fails a contradicted argument, a missing call and a call besides, each said", () => {
    const grade: { passed: boolean; reasons: Array<string> } = gradeSetupTurn(
      TEXT_ME,
      NEW_PROJECT,
      turnOf({
        proposed: [
          {
            name: "set_up_website_monitoring",
            arguments: { address: "example.com", checkEveryMinutes: 5 },
          },
          {
            name: "publish_status_page",
            arguments: { monitors: ["example.com"] },
          },
        ],
      }),
    );

    expect(grade.passed).toBe(false);
    expect(grade.reasons).toEqual([
      "set_up_website_monitoring: checkEveryMinutes is 5, not 1.",
      'Did not propose set_up_paging({"reachMeBy":["sms"]}).',
      'Also proposed publish_status_page({"monitors":["example.com"]}).',
    ]);
  });

  test("fails a question in place of a plan, and any question for a phone number", () => {
    expect(
      gradeSetupTurn(
        TEXT_ME,
        NEW_PROJECT,
        turnOf({ answer: "Sure. How often should it be checked?" }),
      ).reasons,
    ).toEqual([
      'Proposed nothing, and asked instead: "How often should it be checked?"',
    ]);
    expect(
      gradeSetupTurn(
        TEXT_ME,
        NEW_PROJECT,
        turnOf({
          answer: "What is your phone number?",
          proposed: TEXT_ME.expected.map(
            (call: { tool: string; arguments: JSONObject }) => {
              return { name: call.tool, arguments: call.arguments };
            },
          ),
        }),
      ).reasons,
    ).toEqual(['Asked for a phone number: "What is your phone number?"']);
  });

  test("fails a second policy in a project that pages people already", () => {
    const grade: { passed: boolean; reasons: Array<string> } = gradeSetupTurn(
      {
        ...TEXT_ME,
        projectKind: AskAiEvalProjectKind.PagesPeople,
        expected: [TEXT_ME.expected[0]!],
      },
      PAGING_PROJECT,
      turnOf({
        proposed: [
          {
            name: "set_up_website_monitoring",
            arguments: { address: "example.com", checkEveryMinutes: 1 },
          },
          { name: "set_up_paging", arguments: {} },
        ],
      }),
    );

    expect(grade.reasons[0]).toBe(
      "Proposed set_up_paging in a project whose on-call policies page people already.",
    );
  });

  test("passes nothing proposed for a request no setup action answers, and fails a proposal", () => {
    const metric: AskAiSetupCase = {
      ...TEXT_ME,
      request: "Alert me when memory on test01 goes above 75%.",
      expected: [],
    };

    expect(
      gradeSetupTurn(
        metric,
        PAGING_PROJECT,
        turnOf({ answer: "No setup action makes a Host monitor." }),
      ).passed,
    ).toBe(true);
    expect(
      gradeSetupTurn(
        metric,
        PAGING_PROJECT,
        turnOf({
          proposed: [
            {
              name: "set_up_website_monitoring",
              arguments: { address: "test01" },
            },
          ],
        }),
      ).reasons,
    ).toEqual([
      'Proposed set_up_website_monitoring({"address":"test01"}), though no setup action answers this.',
    ]);
  });

  test("wants a read the request names among the model's calls", () => {
    const whoIsTold: AskAiSetupCase = {
      ...TEXT_ME,
      expected: [
        { tool: "who_is_told", arguments: { monitor: "example.com" } },
      ],
    };

    expect(
      gradeSetupTurn(
        whoIsTold,
        PAGING_PROJECT,
        turnOf({
          calls: [
            { name: "who_is_told", arguments: { monitor: "example.com" } },
          ],
          answer: "Maya Chen is emailed.",
        }),
      ).passed,
    ).toBe(true);
    expect(
      gradeSetupTurn(whoIsTold, PAGING_PROJECT, turnOf({ answer: "Nobody." }))
        .reasons,
    ).toEqual(['Did not call who_is_told({"monitor":"example.com"}).']);
  });

  test("fails a plan split over two answers no refusal asked for, not one re-proposed after one", () => {
    const proposed: Array<AskAiEvalCall> = TEXT_ME.expected.map(
      (call: { tool: string; arguments: JSONObject }) => {
        return { name: call.tool, arguments: call.arguments };
      },
    );

    expect(
      gradeSetupTurn(
        TEXT_ME,
        NEW_PROJECT,
        turnOf({ proposed, answersWithActions: 2 }),
      ).reasons,
    ).toEqual(["Proposed its plan over 2 answers, not on one card."]);
    expect(
      gradeSetupTurn(
        TEXT_ME,
        NEW_PROJECT,
        turnOf({
          proposed,
          answersWithActions: 2,
          refusedBeforeCard: [{ name: "set_up_paging", reason: "No." }],
        }),
      ).passed,
    ).toBe(true);
  });

  test("fails a turn that failed", () => {
    expect(
      gradeSetupTurn(TEXT_ME, NEW_PROJECT, turnOf({ error: "Timed out." })),
    ).toEqual({ passed: false, reasons: ["The turn failed: Timed out."] });
  });

  test("reads the questions an answer asks, in English and in Persian", () => {
    expect(getQuestionsAsked("Done. Want a status page too? Or not؟")).toEqual([
      "Want a status page too?",
      "Or not؟",
    ]);
  });
});

const TEXT_WHEN_DOWN: AskAiHowDoICase = {
  id: "how-do-i-1",
  question: "How do I get a text when my site is down?",
  language: "en",
  docsPage: "notifications/notification-methods",
  alsoAnswers: ["guides/paging"],
  dashboardPage: "Phone Numbers for SMS Notifications",
  dashboardPath: "/dashboard/:projectId/user-settings/notification-methods",
};

function docsCitation(id: string, page: string): AIChatCitation {
  return {
    id,
    toolName: "read_docs",
    label: page,
    queryArguments: {},
    rowCount: 1,
    target: {
      type: AIChatCitationTargetType.DocsPage,
      params: { page, language: "en" },
    },
  };
}

function pageCitation(id: string, path: string, title: string): AIChatCitation {
  return {
    id,
    toolName: "find_dashboard_page",
    label: title,
    queryArguments: {},
    rowCount: 1,
    target: {
      type: AIChatCitationTargetType.DashboardPage,
      params: { path, title },
    },
  };
}

describe("a how-do-I answer", () => {
  const citations: Array<AIChatCitation> = [
    docsCitation("C2", "notifications/notification-methods"),
    pageCitation(
      "C3",
      "/dashboard/:projectId/user-settings/notification-methods",
      "Notification Methods",
    ),
  ];

  test("passes when it cites the page that answers it and ends with the page's button", () => {
    expect(
      gradeHowDoITurn(
        TEXT_WHEN_DOWN,
        turnOf({
          answer:
            "1. Add your phone number [C2].\n2. Verify it [C2].\n\nOpen Notification Methods [C3]",
          citations,
        }),
      ),
    ).toEqual({ passed: true, reasons: [] });
  });

  test("takes another page the list says answers it", () => {
    expect(
      gradeHowDoITurn(
        TEXT_WHEN_DOWN,
        turnOf({
          answer:
            "Follow the paging guide [C4]. Open Notification Methods [C3]",
          citations: [...citations, docsCitation("C4", "guides/paging")],
        }),
      ).passed,
    ).toBe(true);
  });

  test("fails a page it looked up but did not cite, and a docs page that does not answer it", () => {
    expect(
      gradeHowDoITurn(
        TEXT_WHEN_DOWN,
        turnOf({
          answer: "Add a phone number [C5].",
          citations: [
            ...citations,
            docsCitation("C5", "monitor/website-monitor"),
          ],
        }),
      ).reasons,
    ).toEqual([
      "Cited no page that answers it (notifications/notification-methods or guides/paging); cited monitor/website-monitor.",
      "Offered no Go to Phone Numbers for SMS Notifications button; offered none.",
    ]);
  });

  // Asked on a status page, the button is that status page's own (#7065).
  test("asked on a record's page, passes only with a button to that record's own page", () => {
    const statusPageId: string = "e7246000-0000-4000-8000-0000000000d1";
    const ownDomain: AskAiHowDoICase = {
      id: "how-do-i-60",
      question: "How do I put this on my own domain?",
      language: "en",
      docsPage: "status-pages/branding-and-domains",
      dashboardPage: "Custom Domains",
      dashboardPath: "/dashboard/:projectId/status-pages/:id/domains",
      dashboardRecordId: statusPageId,
    };
    const recordButton: (recordId: string | undefined) => AIChatCitation = (
      recordId: string | undefined,
    ): AIChatCitation => {
      const citation: AIChatCitation = pageCitation(
        "C3",
        "/dashboard/:projectId/status-pages/:id/domains",
        "Custom Domains",
      );

      return {
        ...citation,
        target: {
          type: AIChatCitationTargetType.DashboardPage,
          params: {
            ...citation.target!.params,
            ...(recordId ? { recordId, recordTitle: "Acme Status" } : {}),
          },
        },
      };
    };
    const answerWith: (button: AIChatCitation) => AskAiEvalTurn = (
      button: AIChatCitation,
    ): AskAiEvalTurn => {
      return turnOf({
        answer: "Add your domain [C2].\n\nOpen Custom Domains [C3]",
        citations: [
          docsCitation("C2", "status-pages/branding-and-domains"),
          button,
        ],
      });
    };

    expect(
      gradeHowDoITurn(ownDomain, answerWith(recordButton(statusPageId))),
    ).toEqual({ passed: true, reasons: [] });
    expect(
      getOfferedPages(answerWith(recordButton(statusPageId))).map(
        describeOfferedPage,
      ),
    ).toEqual(["Custom Domains (Acme Status)"]);

    // Another status page's, or no record's, is not the button it wants.
    expect(
      gradeHowDoITurn(
        ownDomain,
        answerWith(recordButton("e7246000-0000-4000-8000-0000000000ff")),
      ).reasons,
    ).toEqual([
      `Offered no Go to Custom Domains button of record ${statusPageId}; offered Custom Domains (Acme Status).`,
    ]);
    expect(
      gradeHowDoITurn(ownDomain, answerWith(recordButton(undefined))).passed,
    ).toBe(false);
  });

  test("a question the docs do not cover passes only when the answer says so", () => {
    const notCovered: AskAiHowDoICase = {
      id: "how-do-i-50",
      question: "How do I pay my OneUptime invoice in Bitcoin?",
      language: "en",
      notCovered: true,
    };

    expect(
      gradeHowDoITurn(
        notCovered,
        turnOf({ answer: `${DOCS_ANSWER_NOT_COVERED} I read Billing.` }),
      ).passed,
    ).toBe(true);
    expect(
      gradeHowDoITurn(notCovered, turnOf({ answer: "Use a card." })).reasons,
    ).toEqual([`Answered instead of saying "${DOCS_ANSWER_NOT_COVERED}"`]);
    expect(
      gradeHowDoITurn(
        TEXT_WHEN_DOWN,
        turnOf({ answer: DOCS_ANSWER_NOT_COVERED, citations }),
      ).reasons[0],
    ).toBe(`Said "${DOCS_ANSWER_NOT_COVERED}"`);
  });

  // In the words the prompt hands the model for the reader's language (#7064).
  test("a question the docs do not cover, asked in German or Persian, passes when the answer says so in that language", () => {
    for (const [language, sentence] of [
      ["de", "Die Dokumentation deckt das nicht ab."],
      ["fa", "مستندات این موضوع را پوشش نمی‌دهد."],
    ]) {
      expect(
        gradeHowDoITurn(
          {
            id: "how-do-i-51",
            question: "Bitcoin?",
            language: language!,
            notCovered: true,
          },
          turnOf({ answer: `${sentence!} …` }),
        ).passed,
      ).toBe(true);
    }
  });
});

function runOf(passed: boolean, reasons: Array<string> = []): AskAiEvalRun {
  return {
    run: 1,
    passed,
    reasons,
    proposed: ['set_up_paging({"reachMeBy":["sms"]})'],
    refusedBeforeCard: [],
    citedDocs: [],
    offeredPages: [],
    answer: "",
    llmCallCount: 2,
    totalTokens: 500,
    durationMs: 1000,
  };
}

describe("the report both lists share", () => {
  test("a case passes when more than half its runs pass", () => {
    const twoOfThree: AskAiEvalCaseResult = AskAiEvalReport.toCaseResult({
      suite: AskAiEvalSuite.Setup,
      id: "setup-1",
      asked: TEXT_ME.request,
      context: "PagesNobody",
      runs: [runOf(true), runOf(false, ["No."]), runOf(true)],
    });
    const oneOfTwo: AskAiEvalCaseResult = AskAiEvalReport.toCaseResult({
      suite: AskAiEvalSuite.Setup,
      id: "setup-2",
      asked: TEXT_ME.request,
      context: "PagesPeople",
      runs: [runOf(true), runOf(false, ["No."])],
    });

    expect([twoOfThree.passed, twoOfThree.passedRuns]).toEqual([true, 2]);
    expect(oneOfTwo.passed).toBe(false);
    expect(AskAiEvalReport.summarize([twoOfThree, oneOfTwo])).toEqual({
      caseCount: 2,
      passedCount: 1,
      bySuite: [{ suite: AskAiEvalSuite.Setup, caseCount: 2, passedCount: 1 }],
      llmCallCount: 10,
      totalTokens: 2500,
    });
  });

  test("says what each case proposed or cited and why it failed, as text and as Markdown", () => {
    const failed: AskAiEvalCaseResult = AskAiEvalReport.toCaseResult({
      suite: AskAiEvalSuite.Setup,
      id: "setup-1",
      asked: "Page me | and Ana",
      context: "PagesNobody",
      runs: [runOf(false, ["Did not propose set_up_website_monitoring."])],
    });
    const input: AskAiEvalReportInput = {
      model: "Anthropic claude-opus-5-5",
      repeat: 1,
      results: [failed],
      summary: AskAiEvalReport.summarize([failed]),
      outputPath: "./ask-ai-eval-results.json",
    };

    expect(AskAiEvalReport.buildTextReport(input)).toContain(
      '  setup-1      Page me | and Ana (PagesNobody): FAIL: Did not propose set_up_website_monitoring. [proposed set_up_paging({"reachMeBy":["sms"]})]',
    );

    const markdown: string = AskAiEvalReport.buildMarkdownReport(input);

    expect(markdown).toContain("## Ask AI eval: Passed 0 of 1 (0%)");
    expect(markdown).toContain(
      "| setup-1 | Page me \\| and Ana | PagesNobody |",
    );
    expect(AskAiEvalReport.buildSkippedMarkdown("no key.")).toBe(
      "## Ask AI eval: skipped\n\nNothing was run and no model was called: no key.\n\n",
    );
  });
});
