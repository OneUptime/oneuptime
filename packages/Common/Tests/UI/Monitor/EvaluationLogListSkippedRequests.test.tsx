import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
  within,
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import EvaluationLogList, {
  isSkippedRequestsEvent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/EvaluationLogList";
import SummaryInfo from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryInfo";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import Route from "../../../Types/API/Route";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import {
  englishOfEvaluationSentence,
  translatableSentence,
} from "../../../Types/Monitor/EvaluationSentence";
import MonitorEvaluationSummary, {
  MonitorEvaluationEvent,
} from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * "REQUESTS NOT EVALUATED" IS A WARNING, NOT ONE MORE ACTION (#10653).
 *
 * When requests to a grouped Incoming Request monitor are skipped - more
 * were waiting than a monitor keeps, or one failed to evaluate every time -
 * the next evaluation's log says so first (requests-skipped,
 * MonitorResourceUtil.describeSkippedIncomingRequests): an incident or alert
 * a skipped request would have opened or resolved may be missing or still
 * open. The summary drew it as it draws any event it has no case for: the
 * grey arrow and "Action at {{time}}", in the list of the evaluation's
 * actions, where it read as one more thing the evaluation did.
 *
 * It is drawn as a warning now: amber, at the top of the summary beside the
 * slow-evaluation warning, apart from the actions, with links to the
 * monitor's incidents and alerts where the page knows the monitor. Its time
 * is the evaluation's, which the summary already says, not when the
 * requests were skipped, so it is not said again.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const MONITOR_ID: string = "10653000-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INCIDENT_ID: string = "10653000-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EVALUATED_AT: Date = new Date("2026-11-24T09:00:00.000Z");

const TITLE: string = "Requests not evaluated: {{skipped}}";
const OVER_LIMIT: string =
  "More requests were waiting to be evaluated than this monitor keeps, so the oldest of them were skipped. An incident or alert a skipped request would have opened or resolved may be missing or still open.";
const AFTER_FAILURES: string =
  "A request is skipped once evaluating it has failed {{attempts}} times. An incident or alert a skipped request would have opened or resolved may be missing or still open.";

// A requests-skipped event, as MonitorResourceUtil writes it.
function skippedRequests(
  skipped: number,
  message: string,
  values: Record<string, number> = {},
): MonitorEvaluationEvent {
  const titleSentence: ReturnType<typeof translatableSentence> =
    translatableSentence(TITLE, { skipped });
  const messageSentence: ReturnType<typeof translatableSentence> =
    translatableSentence(message, values);

  return {
    type: "requests-skipped",
    title: englishOfEvaluationSentence(titleSentence),
    titleSentence,
    message: englishOfEvaluationSentence(messageSentence),
    messageSentence,
    at: EVALUATED_AT,
  };
}

const INCIDENT_OPENED: MonitorEvaluationEvent = {
  type: "incident-created",
  title: "Incident created: Webhook says down",
  relatedIncidentId: INCIDENT_ID,
  relatedIncidentNumber: 42,
  at: EVALUATED_AT,
};

function summary(
  overrides: Partial<MonitorEvaluationSummary> = {},
): MonitorEvaluationSummary {
  return {
    evaluatedAt: EVALUATED_AT,
    criteriaResults: [
      {
        criteriaId: "criteria-down",
        criteriaName: "Webhook says down",
        filterCondition: FilterCondition.All,
        met: true,
        message: "The request body contains down.",
        filters: [],
      },
    ],
    events: [],
    ...overrides,
  };
}

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {
    en: { translation: readLocale("en") },
  };

  for (const language of DASHBOARD_LANGUAGES) {
    resources[language] = { translation: readLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await readIn("en");
});

function warnings(): Array<HTMLElement> {
  return screen.queryAllByTestId("requests-skipped");
}

/*
 * Text as a person reads it: French sets a no-break space before its colon
 * (Common/Types/NoBreakSpaces), which reads as any other space.
 */
function asRead(textOrElement: string | HTMLElement): string {
  const text: string =
    typeof textOrElement === "string"
      ? textOrElement
      : textOrElement.textContent || "";

  return text.replace(/\s+/g, " ").trim();
}

// What follows the summary's Actions heading, or "" when it has none.
function actionsText(): string {
  const heading: HTMLElement | null = screen.queryByText("Actions");

  return heading?.parentElement?.textContent || "";
}

describe("a requests-skipped event", () => {
  test("is a requests-skipped event, and nothing else is", () => {
    expect(isSkippedRequestsEvent(skippedRequests(3, OVER_LIMIT))).toBe(true);
    expect(isSkippedRequestsEvent(INCIDENT_OPENED)).toBe(false);
  });

  test("is drawn as a warning: amber, announced, saying how many and why", () => {
    render(
      <EvaluationLogList
        evaluationSummary={summary({
          events: [skippedRequests(37, OVER_LIMIT)],
        })}
      />,
    );

    const [warning] = warnings();

    expect(warning).toBeDefined();
    expect(warning).toHaveAttribute("role", "alert");
    expect(warning!.className).toContain("bg-amber-50");
    expect(
      within(warning!).getByTestId("requests-skipped-title"),
    ).toHaveTextContent("Requests not evaluated: 37");
    expect(
      within(warning!).getByTestId("requests-skipped-message"),
    ).toHaveTextContent(OVER_LIMIT);
  });

  test("is not one more action: the actions list neither holds it nor gets a heading for it alone", () => {
    render(
      <EvaluationLogList
        evaluationSummary={summary({
          events: [skippedRequests(37, OVER_LIMIT)],
        })}
      />,
    );

    expect(screen.queryByText("Actions")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Action at /)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Skipped at /)).not.toBeInTheDocument();
  });

  test("leaves the evaluation's own actions where they were", () => {
    render(
      <EvaluationLogList
        evaluationSummary={summary({
          events: [skippedRequests(37, OVER_LIMIT), INCIDENT_OPENED],
        })}
      />,
    );

    expect(actionsText()).toContain("Incident created: Webhook says down");
    expect(actionsText()).not.toContain("Requests not evaluated");
    expect(screen.getByText(/^Created at /)).toBeInTheDocument();
    expect(warnings()).toHaveLength(1);
  });

  test("comes first: before the criteria and before the actions", () => {
    render(
      <EvaluationLogList
        evaluationSummary={summary({
          events: [INCIDENT_OPENED, skippedRequests(37, OVER_LIMIT)],
        })}
      />,
    );

    const warning: HTMLElement = warnings()[0]!;
    const criteria: HTMLElement = screen.getByText("Webhook says down", {
      selector: "div",
    });
    const actions: HTMLElement = screen.getByText("Actions");

    expect(
      warning.compareDocumentPosition(criteria) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      warning.compareDocumentPosition(actions) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("each kind of skip is a warning of its own, in the order the log says them", () => {
    render(
      <EvaluationLogList
        evaluationSummary={summary({
          events: [
            skippedRequests(250, OVER_LIMIT),
            skippedRequests(2, AFTER_FAILURES, { attempts: 3 }),
          ],
        })}
      />,
    );

    expect(
      warnings().map((warning: HTMLElement): string => {
        return (
          within(warning).getByTestId("requests-skipped-title").textContent ||
          ""
        );
      }),
    ).toEqual(["Requests not evaluated: 250", "Requests not evaluated: 2"]);
    expect(
      within(warnings()[1]!).getByTestId("requests-skipped-message"),
    ).toHaveTextContent(
      "A request is skipped once evaluating it has failed 3 times.",
    );
  });

  test("a summary that says only that requests were skipped is still drawn", () => {
    render(
      <EvaluationLogList
        evaluationSummary={summary({
          criteriaResults: [],
          events: [skippedRequests(5, OVER_LIMIT)],
        })}
      />,
    );

    expect(warnings()).toHaveLength(1);
    expect(screen.getByText("Evaluation Logs")).toBeInTheDocument();
  });

  test("sits beside a slow evaluation's warning, first", () => {
    render(
      <EvaluationLogList
        evaluationSummary={summary({
          durationInMs: 9_000,
          events: [skippedRequests(5, OVER_LIMIT)],
        })}
      />,
    );

    const skipped: HTMLElement = warnings()[0]!;
    const slow: HTMLElement = screen.getByTestId("slow-evaluation");

    expect(
      skipped.compareDocumentPosition(slow) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a sentence in another script keeps to its own direction", () => {
    render(
      <EvaluationLogList
        evaluationSummary={summary({
          events: [skippedRequests(5, OVER_LIMIT)],
        })}
      />,
    );

    expect(screen.getByTestId("requests-skipped-title")).toHaveAttribute(
      "dir",
      "auto",
    );
    expect(screen.getByTestId("requests-skipped-message")).toHaveAttribute(
      "dir",
      "auto",
    );
  });

  test("an event stored by hand, with no sentence beside it, reads as stored", () => {
    render(
      <EvaluationLogList
        evaluationSummary={summary({
          events: [
            {
              type: "requests-skipped",
              title: "Requests not evaluated: 9",
              message: "Nine requests were skipped.",
              at: EVALUATED_AT,
            },
          ],
        })}
      />,
    );

    expect(screen.getByTestId("requests-skipped-title")).toHaveTextContent(
      "Requests not evaluated: 9",
    );
    expect(screen.getByTestId("requests-skipped-message")).toHaveTextContent(
      "Nine requests were skipped.",
    );
  });
});

describe("where to look, when the page knows the monitor", () => {
  test("links to the monitor's incidents and alerts", () => {
    const navigate: jest.SpiedFunction<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {});

    render(
      <EvaluationLogList
        evaluationSummary={summary({
          events: [skippedRequests(37, OVER_LIMIT)],
        })}
        monitorId={new ObjectID(MONITOR_ID)}
      />,
    );

    const warning: HTMLElement = warnings()[0]!;

    fireEvent.click(
      within(warning).getByRole("button", { name: "View Incidents" }),
    );
    fireEvent.click(
      within(warning).getByRole("button", { name: "View Alerts" }),
    );

    const routes: Array<string> = navigate.mock.calls.map(
      (call: Array<unknown>): string => {
        return (call[0] as Route).toString();
      },
    );

    expect(routes).toHaveLength(2);
    expect(routes[0]).toMatch(new RegExp(`/monitors/${MONITOR_ID}/incidents$`));
    expect(routes[1]).toMatch(new RegExp(`/monitors/${MONITOR_ID}/alerts$`));
  });

  test("says nothing of where to look when the page does not know the monitor", () => {
    render(
      <EvaluationLogList
        evaluationSummary={summary({
          events: [skippedRequests(37, OVER_LIMIT)],
        })}
      />,
    );

    expect(within(warnings()[0]!).queryAllByRole("button")).toHaveLength(0);
  });

  test("SummaryInfo hands the monitor on, as the Monitoring Logs and the Overview do", () => {
    // The request the evaluation read, its summary beside it as the log keeps it.
    const incomingMonitorRequest: IncomingMonitorRequest = {
      projectId: new ObjectID("10653000-cccc-4ccc-8ccc-cccccccccccc"),
      monitorId: new ObjectID(MONITOR_ID),
      requestHeaders: { "content-type": "application/json" },
      requestBody: { status: "down" },
      requestMethod: HTTPMethod.POST,
      incomingRequestReceivedAt: EVALUATED_AT,
      checkedAt: EVALUATED_AT,
      onlyCheckForIncomingRequestReceivedAt: false,
      evaluationSummary: summary({
        events: [skippedRequests(37, OVER_LIMIT)],
      }),
    };

    render(
      <SummaryInfo
        monitorType={MonitorType.IncomingRequest}
        incomingMonitorRequest={incomingMonitorRequest}
        monitorId={new ObjectID(MONITOR_ID)}
      />,
    );

    expect(
      within(warnings()[0]!).getByRole("button", { name: "View Incidents" }),
    ).toBeInTheDocument();
    expect(
      within(warnings()[0]!).getByRole("button", { name: "View Alerts" }),
    ).toBeInTheDocument();
  });
});

describe.each([...DASHBOARD_LANGUAGES])("in %s", (language: string) => {
  const locale: Record<string, string> = readLocale(language);

  test("the warning and its links read in the language's words", async () => {
    await readIn(language);

    render(
      <EvaluationLogList
        evaluationSummary={summary({
          events: [
            skippedRequests(250, OVER_LIMIT),
            skippedRequests(2, AFTER_FAILURES, { attempts: 3 }),
          ],
        })}
        monitorId={new ObjectID(MONITOR_ID)}
      />,
    );

    const [overLimit, afterFailures] = warnings();

    expect(
      asRead(within(overLimit!).getByTestId("requests-skipped-title")),
    ).toBe(asRead(locale[TITLE]!.replace("{{skipped}}", "250")));
    expect(
      asRead(within(overLimit!).getByTestId("requests-skipped-message")),
    ).toBe(asRead(locale[OVER_LIMIT]!));
    expect(
      asRead(within(afterFailures!).getByTestId("requests-skipped-message")),
    ).toBe(asRead(locale[AFTER_FAILURES]!.replace("{{attempts}}", "3")));

    for (const label of ["View Incidents", "View Alerts"]) {
      expect(locale[label]).toBeTruthy();
      expect(locale[label]).not.toBe(label);
      expect(
        within(overLimit!).getByRole("button", { name: locale[label] }),
      ).toBeInTheDocument();
    }

    expect(
      within(overLimit!).queryByText("Requests not evaluated", {
        exact: false,
      }),
    ).not.toBeInTheDocument();
  });
});
