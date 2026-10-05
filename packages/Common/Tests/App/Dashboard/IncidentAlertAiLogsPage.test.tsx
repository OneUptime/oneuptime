import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route as PageRoute, Routes } from "react-router-dom";
import IncidentAILogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/AI/Logs";
import AlertAILogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/AI/Logs";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import AIRunAutoGrade from "../../../Types/AI/AIRunAutoGrade";
import AIRunHumanVerdict from "../../../Types/AI/AIRunHumanVerdict";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import {
  IncidentAlertAiLogKind,
  IncidentAlertAiSubjectKind,
} from "../../../Types/AI/IncidentAlertAiLogs";
import AutoRemediationExecutionMode from "../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import { JSONObject } from "../../../Types/JSON";
import RunnerJobOrigin from "../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../Types/Runbook/RunnerJobStatus";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

/*
 * The AI Logs page of the Incidents and Alerts menus (AI → Logs), rendered
 * for real on its real route for each product, with the logs route stubbed.
 * It answers "what has OneUptime AI been doing here?": every investigation,
 * fix, fix pull request and command, newest first, each linked to its
 * incident or alert, a page at a time.
 */

const WAIT_TIMEOUT: number = 20000;

const SUBJECT_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const RUN_ID: string = "66666666-0000-4000-8000-000000000006";
const FIX_ID: string = "77777777-0000-4000-8000-000000000001";
const TASK_ID: string = "88888888-0000-4000-8000-000000000001";
const JOB_ID: string = "99999999-0000-4000-8000-000000000001";

interface Product {
  subjectKind: IncidentAlertAiSubjectKind;
  logsPage: PageMap;
  settingsPage: PageMap;
  viewPage: PageMap;
  route: string;
  page: React.FunctionComponent<PageComponentProps>;
  numberWithPrefix: string;
  // How every AI page names the subject (AiActivityInsightsData.describeSubject).
  subjectLabel: string;
  subtitle: string;
}

const PRODUCTS: Array<Product> = [
  {
    subjectKind: "incident",
    logsPage: PageMap.INCIDENTS_AI_LOGS,
    settingsPage: PageMap.INCIDENTS_SETTINGS_AI,
    viewPage: PageMap.INCIDENT_VIEW,
    route: "/ai-activity/incident/logs",
    page: IncidentAILogs,
    numberWithPrefix: "INC-42",
    subjectLabel: "Incident INC-42: Database down",
    subtitle:
      "Everything OneUptime AI did for your incidents, newest first: every investigation, fix and command, each linked to its incident.",
  },
  {
    subjectKind: "alert",
    logsPage: PageMap.ALERTS_AI_LOGS,
    settingsPage: PageMap.ALERTS_SETTINGS_AI,
    viewPage: PageMap.ALERT_VIEW,
    route: "/ai-activity/alert/logs",
    page: AlertAILogs,
    numberWithPrefix: "ALT-42",
    subjectLabel: "Alert ALT-42: Database down",
    subtitle:
      "Everything OneUptime AI did for your alerts, newest first: every investigation, fix and command, each linked to its alert.",
  },
];

function subject(product: Product): JSONObject {
  return {
    kind: product.subjectKind,
    id: SUBJECT_ID,
    title: "Database down",
    number: 42,
    numberWithPrefix: product.numberWithPrefix,
  };
}

function investigation(
  product: Product,
  overrides: JSONObject = {},
): JSONObject {
  return {
    kind: IncidentAlertAiLogKind.Investigation,
    id: RUN_ID,
    at: "2026-10-05T10:00:00.000Z",
    subject: subject(product),
    status: AIRunStatus.Completed,
    summary: "The disk on db-1 filled up.",
    humanVerdict: AIRunHumanVerdict.Confirmed,
    autoGrade: AIRunAutoGrade.Match,
    ...overrides,
  };
}

function everyKind(product: Product): Array<JSONObject> {
  return [
    investigation(product),
    {
      kind: IncidentAlertAiLogKind.Fix,
      id: FIX_ID,
      at: "2026-10-05T09:59:00.000Z",
      subject: subject(product),
      status: AutoRemediationSuggestionStatus.AutoExecuted,
      suggestionType: AutoRemediationSuggestionType.Runbook,
      executionMode: AutoRemediationExecutionMode.FullAuto,
      rationale: "Free space on db-1.",
      verificationStatus: AutoRemediationVerificationStatus.Verified,
      runbookName: "Clean disk",
      ruleName: "Disk full",
    },
    {
      kind: IncidentAlertAiLogKind.FixTask,
      id: TASK_ID,
      at: "2026-10-05T09:58:00.000Z",
      subject: subject(product),
      status: AIRunStatus.Completed,
      taskNumber: 12,
      codeFixTaskType: CodeFixTaskType.FixFromIncident,
    },
    {
      kind: IncidentAlertAiLogKind.Command,
      id: JOB_ID,
      at: "2026-10-05T09:57:00.000Z",
      subject: subject(product),
      status: RunnerJobStatus.Failed,
      command: "kubectl delete pod web-1",
      commandOrigin: RunnerJobOrigin.AiRemediation,
      exitCode: 1,
      errorMessage: "pods is forbidden",
    },
  ];
}

function logs(
  product: Product,
  entries: Array<JSONObject>,
  overrides: JSONObject = {},
): JSONObject {
  return {
    subjectKind: product.subjectKind,
    entries,
    nextBefore: null,
    hiddenKinds: [],
    ...overrides,
  };
}

type Answer = () => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>;

function ok(body: unknown): Answer {
  return async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPResponse<JSONObject>(200, body as JSONObject, {});
  };
}

function httpError(statusCode: number, message: string): Answer {
  return async (): Promise<HTTPErrorResponse> => {
    return new HTTPErrorResponse(statusCode, { message }, {});
  };
}

// An answer the test releases when it wants: a request still in flight.
function deferred(): {
  answer: Answer;
  release: (body: unknown) => void;
} {
  let release: (body: unknown) => void = (): void => {
    return undefined;
  };
  const promise: Promise<HTTPResponse<JSONObject>> = new Promise<
    HTTPResponse<JSONObject>
  >((resolve: (value: HTTPResponse<JSONObject>) => void) => {
    release = (body: unknown): void => {
      resolve(new HTTPResponse<JSONObject>(200, body as JSONObject, {}));
    };
  });

  return {
    answer: (): Promise<HTTPResponse<JSONObject>> => {
      return promise;
    },
    release: (body: unknown): void => {
      release(body);
    },
  };
}

let postSpy: ReturnType<typeof jest.spyOn>;
let answers: Array<Answer> = [];

function serve(...queue: Array<Answer>): void {
  answers = [...queue];
}

function requests(product: Product): Array<JSONObject> {
  return postSpy.mock.calls
    .map((call: Array<unknown>): JSONObject => {
      return (call[0] || {}) as JSONObject;
    })
    .filter((request: JSONObject): boolean => {
      return String(request["url"]).endsWith(product.route);
    })
    .map((request: JSONObject): JSONObject => {
      return (request["data"] || {}) as JSONObject;
    });
}

function pathOf(page: PageMap, modelId?: string): string {
  return RouteMap[page]!.toString()
    .replace(":projectId", PROJECT_ID)
    .replace(":id", modelId || ":id");
}

function openPage(product: Product): void {
  const path: string = pathOf(product.logsPage);
  goTo(path);
  const Page: Product["page"] = product.page;

  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <PageRoute
          path={String(RouteMap[product.logsPage])}
          element={
            <Page
              pageRoute={RouteMap[product.logsPage] as Route}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function findTestId(testId: string): Promise<HTMLElement> {
  return await screen.findByTestId(testId, {}, { timeout: WAIT_TIMEOUT });
}

async function findText(text: string | RegExp): Promise<HTMLElement> {
  return await screen.findByText(text, {}, { timeout: WAIT_TIMEOUT });
}

function hrefOf(element: HTMLElement): string {
  return element.closest("a")?.getAttribute("href") || "";
}

function shownEntries(): Array<HTMLElement> {
  return screen.queryAllByTestId("ai-log-entry");
}

beforeEach(() => {
  window.localStorage.clear();
  answers = [];

  postSpy = jest.spyOn(API, "post");
  postSpy.mockImplementation(
    async (
      request: unknown,
    ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const url: string = String((request as JSONObject)["url"]);

      if (url.includes("/ai-activity/")) {
        const answer: Answer | undefined =
          answers.length > 1 ? answers.shift() : answers[0];

        if (!answer) {
          throw new Error(`No answer queued for ${url}`);
        }

        return await answer();
      }

      throw new Error(`Unexpected request to ${url}`);
    },
  );
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(
  PRODUCTS.map((product: Product): [IncidentAlertAiSubjectKind, Product] => {
    return [product.subjectKind, product];
  }),
)(
  "the %s AI Logs page",
  (_name: IncidentAlertAiSubjectKind, product: Product) => {
    test("says what it is, and asks this product's logs route for the newest page of everything", async () => {
      serve(ok(logs(product, [investigation(product)])));
      openPage(product);

      const heading: HTMLElement = await findTestId("ai-logs-page-heading");

      expect(heading).toHaveTextContent("AI Logs");
      expect(heading).toHaveTextContent(product.subtitle);

      await findTestId("ai-logs-entries");

      expect(requests(product)).toEqual([{}]);
      expect(
        postSpy.mock.calls.every((call: Array<unknown>): boolean => {
          return String((call[0] as JSONObject)["url"]).endsWith(product.route);
        }),
      ).toBe(true);
    });

    test("shows a loader while the first page loads", async () => {
      const pending: { answer: Answer; release: (body: unknown) => void } =
        deferred();
      serve(pending.answer);
      openPage(product);

      expect(await findTestId("ai-logs-loading")).toBeInTheDocument();
      expect(shownEntries()).toEqual([]);

      await act(async () => {
        pending.release(logs(product, [investigation(product)]));
      });

      await findTestId("ai-logs-entries");
      expect(screen.queryByTestId("ai-logs-loading")).not.toBeInTheDocument();
    });

    test("lists every kind of entry, newest first, each linked to its subject", async () => {
      serve(ok(logs(product, everyKind(product))));
      openPage(product);

      await findTestId("ai-logs-entries");

      const entries: Array<HTMLElement> = shownEntries();

      expect(
        entries.map((element: HTMLElement): string | null => {
          return element.getAttribute("data-kind");
        }),
      ).toEqual([
        IncidentAlertAiLogKind.Investigation,
        IncidentAlertAiLogKind.Fix,
        IncidentAlertAiLogKind.FixTask,
        IncidentAlertAiLogKind.Command,
      ]);

      for (const element of entries) {
        expect(hrefOf(within(element).getByText(product.subjectLabel))).toBe(
          pathOf(product.viewPage, SUBJECT_ID),
        );
      }
    });

    test("an investigation shows its finding, its status and what people and the grader made of it", async () => {
      serve(ok(logs(product, [investigation(product)])));
      openPage(product);

      const entry: HTMLElement = (await findTestId("ai-logs-entries"))
        .children[0] as HTMLElement;

      expect(entry).toHaveTextContent("Investigation");
      expect(entry).toHaveTextContent("The disk on db-1 filled up.");
      expect(entry).toHaveTextContent("Completed");
      expect(entry).toHaveTextContent("Confirmed by your team");
      expect(entry).toHaveTextContent("Matched the recorded root cause");
    });

    test("an investigation without a TL;DR shows the Summary its report opens with", async () => {
      serve(
        ok(
          logs(product, [
            investigation(product, {
              summary: null,
              reportSummary: "The certificate expired at midnight.",
            }),
          ]),
        ),
      );
      openPage(product);

      const detail: HTMLElement = await findTestId("ai-log-entry-detail");

      expect(detail).toHaveTextContent("The certificate expired at midnight.");
    });

    test("an investigation still running, or that recorded nothing, says so as a resource's AI Logs do", async () => {
      serve(
        ok(
          logs(product, [
            investigation(product, {
              id: "run-running",
              status: AIRunStatus.Running,
              summary: null,
            }),
            investigation(product, {
              id: "run-failed",
              status: AIRunStatus.Error,
              summary: null,
            }),
          ]),
        ),
      );
      openPage(product);

      await findTestId("ai-logs-entries");

      const details: Array<string> = screen
        .getAllByTestId("ai-log-entry-detail")
        .map((element: HTMLElement): string => {
          return element.textContent || "";
        });

      expect(details).toEqual([
        "Still investigating.",
        "No summary was recorded.",
      ]);
    });

    test("a fix shows its reason, where it came from, how it ran and whether it worked", async () => {
      serve(ok(logs(product, everyKind(product))));
      openPage(product);

      await findTestId("ai-logs-entries");

      const fix: HTMLElement = shownEntries()[1]!;

      expect(fix).toHaveTextContent("Free space on db-1.");
      expect(fix).toHaveTextContent("Applied automatically");
      expect(
        within(fix).getByTestId("ai-log-entry-fix-source"),
      ).toHaveTextContent("Runbook: Clean disk · Rule: Disk full");
      expect(fix).toHaveTextContent("Runbook");
      expect(fix).toHaveTextContent("Runs without approval");
      expect(fix).toHaveTextContent("It worked: the problem cleared");
    });

    test("a fix pull request says what it was for and links to its task", async () => {
      serve(ok(logs(product, everyKind(product))));
      openPage(product);

      await findTestId("ai-logs-entries");

      const task: HTMLElement = shownEntries()[2]!;

      expect(task).toHaveTextContent("Fix pull request");
      expect(task).toHaveTextContent("Pull request opened");
      expect(task).toHaveTextContent(
        "Fix the root cause the investigation found",
      );
      expect(hrefOf(within(task).getByText("Task #12"))).toBe(
        pathOf(PageMap.AI_AGENT_TASK_VIEW, TASK_ID),
      );
    });

    test("a command shows what ran, why, and how it ended", async () => {
      serve(ok(logs(product, everyKind(product))));
      openPage(product);

      await findTestId("ai-logs-entries");

      const command: HTMLElement = shownEntries()[3]!;
      const detail: HTMLElement = within(command).getByTestId(
        "ai-log-entry-detail",
      );

      expect(detail).toHaveTextContent("kubectl delete pod web-1");
      expect(detail).toHaveClass("font-mono");
      expect(command).toHaveTextContent("Failed");
      expect(command).toHaveTextContent("To fix it");
      expect(command).toHaveTextContent("Exit code 1");
      expect(command).toHaveTextContent("pods is forbidden");
    });

    test("with nothing recorded, says so and points at the AI settings", async () => {
      serve(ok(logs(product, [])));
      openPage(product);

      const empty: HTMLElement = await findTestId("ai-logs-empty");

      expect(empty).toHaveTextContent(
        "OneUptime AI has not done anything here yet",
      );
      expect(
        hrefOf(
          within(empty).getByText(
            "Choose what OneUptime AI does on its own in AI → Settings",
          ),
        ),
      ).toBe(pathOf(product.settingsPage));
      expect(screen.queryByTestId("ai-logs-load-more")).not.toBeInTheDocument();
    });

    test("an error says what went wrong, and Retry loads the page again", async () => {
      serve(
        httpError(500, "The AI logs are not available right now."),
        ok(logs(product, [investigation(product)])),
      );
      openPage(product);

      const error: HTMLElement = await findTestId("ai-logs-error");

      expect(error).toHaveTextContent(
        "The AI logs are not available right now.",
      );

      fireEvent.click(within(error).getByRole("button"));

      await findTestId("ai-logs-entries");
      expect(requests(product)).toHaveLength(2);
    });

    test("a body the page cannot read is an error, not an empty record", async () => {
      serve(ok({ investigations: [] }));
      openPage(product);

      expect(await findTestId("ai-logs-error")).toHaveTextContent(
        "The server returned AI logs this page cannot read.",
      );
    });

    test("the filter asks for one kind, shows which is chosen, and says when there is none of it", async () => {
      serve(ok(logs(product, everyKind(product))), ok(logs(product, [])));
      openPage(product);

      await findTestId("ai-logs-entries");

      const everything: HTMLElement = screen.getByTestId("ai-logs-filter-All");
      const commands: HTMLElement = screen.getByTestId(
        `ai-logs-filter-${IncidentAlertAiLogKind.Command}`,
      );

      expect(everything).toHaveAttribute("aria-pressed", "true");
      expect(commands).toHaveAttribute("aria-pressed", "false");

      fireEvent.click(commands);

      expect(await findText("Nothing of this kind yet")).toBeInTheDocument();
      expect(commands).toHaveAttribute("aria-pressed", "true");
      expect(everything).toHaveAttribute("aria-pressed", "false");
      expect(requests(product)).toEqual([
        {},
        { kinds: [IncidentAlertAiLogKind.Command] },
      ]);
    });

    test.each([
      IncidentAlertAiLogKind.Investigation,
      IncidentAlertAiLogKind.Fix,
      IncidentAlertAiLogKind.FixTask,
      IncidentAlertAiLogKind.Command,
    ])("the %s filter asks for that kind only", async (kind: string) => {
      serve(ok(logs(product, [investigation(product)])), ok(logs(product, [])));
      openPage(product);

      await findTestId("ai-logs-entries");

      fireEvent.click(screen.getByTestId(`ai-logs-filter-${kind}`));

      await waitFor(
        () => {
          expect(requests(product)[1]).toEqual({ kinds: [kind] });
        },
        { timeout: WAIT_TIMEOUT },
      );
    });

    test("Load older entries reads the next page and adds it under the first", async () => {
      serve(
        ok(
          logs(product, [investigation(product)], {
            nextBefore: "2026-10-05T09:00:00.000Z",
          }),
        ),
        ok(
          logs(product, [
            investigation(product, {
              id: "66666666-0000-4000-8000-000000000007",
              at: "2026-10-05T08:00:00.000Z",
              summary: "An older finding.",
            }),
          ]),
        ),
      );
      openPage(product);

      await findTestId("ai-logs-entries");

      fireEvent.click(screen.getByTestId("ai-logs-load-more"));

      expect(await findText("An older finding.")).toBeInTheDocument();
      expect(shownEntries()).toHaveLength(2);
      expect(requests(product)[1]).toEqual({
        before: "2026-10-05T09:00:00.000Z",
      });
      // The record has reached its start.
      expect(await findTestId("ai-logs-end")).toHaveTextContent(
        "That is everything OneUptime AI has done here.",
      );
      expect(screen.queryByTestId("ai-logs-load-more")).not.toBeInTheDocument();
    });

    test("Load older entries keeps the filter", async () => {
      serve(
        ok(logs(product, [])),
        ok(
          logs(product, [investigation(product)], {
            nextBefore: "2026-10-05T09:00:00.000Z",
          }),
        ),
        ok(logs(product, [])),
      );
      openPage(product);

      await findTestId("ai-logs-empty");

      fireEvent.click(
        screen.getByTestId(
          `ai-logs-filter-${IncidentAlertAiLogKind.Investigation}`,
        ),
      );
      await findTestId("ai-logs-entries");

      fireEvent.click(screen.getByTestId("ai-logs-load-more"));

      await waitFor(
        () => {
          expect(requests(product)[2]).toEqual({
            before: "2026-10-05T09:00:00.000Z",
            kinds: [IncidentAlertAiLogKind.Investigation],
          });
        },
        { timeout: WAIT_TIMEOUT },
      );
    });

    test("a failed Load More keeps the entries shown and says why", async () => {
      serve(
        ok(
          logs(product, [investigation(product)], {
            nextBefore: "2026-10-05T09:00:00.000Z",
          }),
        ),
        httpError(500, "The older entries could not be read."),
      );
      openPage(product);

      await findTestId("ai-logs-entries");

      fireEvent.click(screen.getByTestId("ai-logs-load-more"));

      expect(await findTestId("ai-logs-load-more-error")).toHaveTextContent(
        "The older entries could not be read.",
      );
      expect(shownEntries()).toHaveLength(1);
      expect(screen.getByTestId("ai-logs-load-more")).toBeInTheDocument();
    });

    test("says which kinds the reader may not see, and why", async () => {
      serve(
        ok(
          logs(product, [investigation(product)], {
            hiddenKinds: [
              IncidentAlertAiLogKind.Fix,
              IncidentAlertAiLogKind.Command,
            ],
          }),
        ),
      );
      openPage(product);

      const note: HTMLElement = await findTestId("ai-logs-hidden-kinds");

      expect(note).toHaveTextContent(
        "Fixes are not shown: seeing them needs permission to read auto-remediation suggestions.",
      );
      expect(note).toHaveTextContent(
        "Commands are not shown: seeing them needs permission to read Runner jobs.",
      );
    });

    test("says nothing about hidden kinds when every kind is shown", async () => {
      serve(ok(logs(product, [investigation(product)])));
      openPage(product);

      await findTestId("ai-logs-entries");

      expect(
        screen.queryByTestId("ai-logs-hidden-kinds"),
      ).not.toBeInTheDocument();
    });

    test("an answer to an older request never paints over a newer one", async () => {
      const slow: { answer: Answer; release: (body: unknown) => void } =
        deferred();
      serve(slow.answer, ok(logs(product, [])));
      openPage(product);

      await findTestId("ai-logs-loading");

      // Switch to commands while the first page is still loading.
      fireEvent.click(
        screen.getByTestId(`ai-logs-filter-${IncidentAlertAiLogKind.Command}`),
      );

      expect(await findText("Nothing of this kind yet")).toBeInTheDocument();

      await act(async () => {
        slow.release(logs(product, [investigation(product)]));
      });

      expect(shownEntries()).toEqual([]);
      expect(screen.getByText("Nothing of this kind yet")).toBeInTheDocument();
    });
  },
);
