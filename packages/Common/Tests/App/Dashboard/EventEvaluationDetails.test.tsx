import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React from "react";
import EventEvaluationDetails from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventEvaluationDetails";
import {
  BODY_WAS_EMPTY,
  CRITERIA_MATCHED,
  CRITERIA_MATCHED_ALL,
  CRITERIA_MATCHED_ANY,
  DETAILS_WERE_TRIMMED,
  EVALUATION_DETAILS_HEADING,
  EVALUATION_FACT_LABELS,
  FIELD_VALUE_NOT_FOUND,
  FILTER_FACT_LABELS,
  FILTER_MATCHED,
  FILTER_NOT_MATCHED,
  HIDE_EVALUATION_DETAILS,
  LONG_FILTER_VALUE_CHARS,
  MATCHED_TEXT_MASKED,
  MORE_FILTERS_THAN_SHOWN,
  SHOW_EVALUATION_DETAILS,
  STEP_OF_STEPS,
  UNNAMED_CRITERIA_MATCHED_ALL,
  UNNAMED_CRITERIA_MATCHED_ANY,
  WINDOW_SENTENCE,
  REQUEST_CONTENT_NOT_KEPT,
  RESPONSE_CONTENT_NOT_KEPT,
  SECRETS_ARE_MASKED,
  SECRETS_IN_REQUEST_ARE_MASKED,
  UNNAMED_CRITERIA_MATCHED,
  getContentNotKeptNote,
  getCriteriaSentence,
  getExcerptOmissionNote,
  getRequestText,
  getSecretsMaskedNote,
  getShownActual,
  getShownFilters,
  hasDetailsToShow,
  hasFoundValues,
  isFilterSentenceShown,
  isFilterValueOnItsOwnLine,
  orderFilters,
  showsResponseContent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventEvaluationDetailsCopy";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorEvaluationDetails, {
  MonitorEvaluationDetailsVersion,
  MonitorEvaluationFilterDetails,
} from "../../../Types/Monitor/MonitorEvaluationDetails";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * EVALUATION DETAILS, UNDER AN INCIDENT'S OR AN ALERT'S ROOT CAUSE.
 *
 * Folded, the section says why the monitor opened the record: the criteria
 * that matched, each filter that matched with what the check found and
 * where, and how the check failed when it did. Show details - beside the
 * heading - adds what takes room: a JavaScript expression's values, the
 * excerpt with the match marked, the filters that did not match, the check
 * itself (the request, when it ran, the probe, what came back) and what was
 * masked or left out. A filter's own sentence shows only where it says
 * something the section does not. In English, German and Persian, from the
 * shipped locale files.
 */

const EVALUATED_AT: Date = new Date("2026-11-08T10:04:12.000Z");

const BODY_FILTER: MonitorEvaluationFilterDetails = {
  checkOn: CheckOn.ResponseBody,
  filterType: FilterType.Contains,
  value: "error",
  met: true,
  message: "Response body contains error.",
  field: "checks[1].status",
  excerpt: {
    before: '{"name":"payments","status":"',
    match: "error",
    after: ': connection refused"},{"token":"[REDACTED]"}',
    isCutAtStart: true,
    isCutAtEnd: true,
  },
};

const STATUS_FILTER: MonitorEvaluationFilterDetails = {
  checkOn: CheckOn.ResponseStatusCode,
  filterType: FilterType.GreaterThan,
  value: 499,
  met: true,
  message: "Response Status Code was 503, above the 499 threshold.",
  actual: "503",
};

const TIME_FILTER: MonitorEvaluationFilterDetails = {
  checkOn: CheckOn.ResponseTime,
  filterType: FilterType.GreaterThan,
  value: 5000,
  met: false,
  message:
    "Response Time (in ms) was 120 ms (expected to be greater than 5000).",
};

const WINDOW_FILTER: MonitorEvaluationFilterDetails = {
  checkOn: CheckOn.ResponseTime,
  filterType: FilterType.GreaterThan,
  value: 1500,
  met: true,
  message:
    "Average of Response Time (in ms) over the last 5 minutes was 1,912 ms across 4 readings, above the 1500 threshold.",
  actual: "1800 ms",
  actualNumber: 1800,
  actualUnit: "ms",
  windowMinutes: 5,
  windowType: EvaluateOverTimeType.Average,
};

const EXPRESSION_FILTER: MonitorEvaluationFilterDetails = {
  checkOn: CheckOn.JavaScriptExpression,
  filterType: FilterType.EvaluatesToTrue,
  value: "'{{responseBody.status}}' === 'down' && {{responseBody.gone}}",
  met: true,
  actual: "true",
  message:
    "JavaScript Expression - '{{responseBody.status}}' === 'down' && {{responseBody.gone}} - evaluated to true. Values: responseBody.status = \"down\".",
  fieldValues: [
    { path: "responseBody.status", value: '"down"' },
    { path: "responseBody.gone", isMissing: true },
    {
      path: "responseHeaders.set-cookie",
      value: "[REDACTED]",
      isRedacted: true,
    },
  ],
  areFieldValuesTruncated: true,
};

// A Logs monitor's filter: its sentence is all the section has of it.
const LOG_COUNT_FILTER: MonitorEvaluationFilterDetails = {
  checkOn: CheckOn.LogCount,
  filterType: FilterType.GreaterThan,
  value: 100,
  met: true,
  message: "Log Count was 412 in the last 5 minutes, above the 100 threshold.",
};

function details(
  overrides: Partial<MonitorEvaluationDetails> = {},
): MonitorEvaluationDetails {
  return {
    version: MonitorEvaluationDetailsVersion,
    monitorType: MonitorType.API,
    evaluatedAt: EVALUATED_AT,
    criteriaId: "criteria-1",
    criteriaName: "Payments degraded",
    filterCondition: FilterCondition.All,
    probeName: "US West",
    filters: [BODY_FILTER, STATUS_FILTER],
    request: {
      method: "POST",
      url: "https://api.acme.example/v1/health?api_key=[REDACTED]",
    },
    response: { statusCode: 503, responseTimeInMs: 1234, isOnline: true },
    ...overrides,
  };
}

// A Logs monitor's details: no request, no probe, nothing read from a body.
function logDetails(
  overrides: Partial<MonitorEvaluationDetails> = {},
): MonitorEvaluationDetails {
  return {
    version: MonitorEvaluationDetailsVersion,
    monitorType: MonitorType.Logs,
    evaluatedAt: EVALUATED_AT,
    criteriaName: "Checkout logs errors",
    filterCondition: FilterCondition.All,
    filters: [LOG_COUNT_FILTER],
    ...overrides,
  };
}

function renderDetails(value: MonitorEvaluationDetails): RenderResult {
  return render(<EventEvaluationDetails details={value} />);
}

function toggle(): HTMLElement {
  return screen.getByTestId("evaluation-details-toggle");
}

function open(): void {
  fireEvent.click(toggle());
}

function texts(testId: string): Array<string | null> {
  return screen.queryAllByTestId(testId).map((element: HTMLElement) => {
    return element.textContent;
  });
}

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      de: { translation: readDashboardLocale("de") },
      fa: { translation: readDashboardLocale("fa") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await inLanguage("en");
});

afterEach(() => {
  cleanup();
});

describe("folded, the section says why the monitor opened the record", () => {
  test("a heading, the criteria, then each filter that matched with what it found and where", () => {
    renderDetails(details());

    expect(
      screen.getByRole("heading", { name: "Evaluation details" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("evaluation-criteria")).toHaveTextContent(
      "“Payments degraded” matched when all of its filters did.",
    );

    const filters: Array<HTMLElement> =
      screen.getAllByTestId("evaluation-filter");

    expect(filters).toHaveLength(2);
    expect(
      within(filters[0]!).getByTestId("evaluation-filter-title"),
    ).toHaveTextContent("Matched: Response Body Contains error");
    expect(
      within(filters[0]!).getByTestId("evaluation-filter-field"),
    ).toHaveTextContent("Found atchecks[1].status");
    expect(
      within(filters[1]!).getByTestId("evaluation-filter-actual"),
    ).toHaveTextContent("Actual503");
  });

  test("what takes room waits behind Show details: the excerpt, the request and the check", () => {
    renderDetails(details());

    expect(screen.queryByTestId("evaluation-filter-excerpt")).toBeNull();
    expect(screen.queryByTestId("evaluation-request")).toBeNull();
    expect(screen.queryByTestId("evaluation-facts")).toBeNull();
    expect(screen.queryByTestId("evaluation-notes")).toBeNull();
    // When the check ran and from which probe: the stat bar says so above.
    expect(screen.queryByText("US West")).toBeNull();
    expect(screen.queryByText("Checked")).toBeNull();
  });

  test("the toggle sits beside the heading, and names what it does", () => {
    renderDetails(details());

    const heading: HTMLElement = screen.getByRole("heading", {
      name: "Evaluation details",
    });

    expect(heading.parentElement).toContainElement(toggle());
    expect(toggle()).toHaveTextContent("Show details");
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    // It controls the section's content, which is there folded too.
    expect(toggle()).toHaveAttribute(
      "aria-controls",
      screen.getByTestId("evaluation-details-content").id,
    );
  });

  test("a filter that did not match waits behind Show details", () => {
    renderDetails(
      details({
        filterCondition: FilterCondition.Any,
        filters: [TIME_FILTER, STATUS_FILTER],
      }),
    );

    expect(screen.getAllByTestId("evaluation-filter")).toHaveLength(1);
    expect(screen.getByTestId("evaluation-filter")).toHaveAttribute(
      "data-matched",
      "true",
    );

    open();

    expect(screen.getAllByTestId("evaluation-filter")).toHaveLength(2);
  });

  test("a check that failed says how, folded", () => {
    renderDetails(
      details({
        request: { destination: "db.acme.example", port: 5432 },
        response: { isOnline: false, failureCause: "Connection refused" },
        filters: [
          {
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.False,
            met: true,
            message: "Monitor reported offline status.",
            actual: "false",
          },
        ],
      }),
    );

    expect(screen.getByTestId("evaluation-facts-failure")).toHaveTextContent(
      "FailureConnection refused",
    );
    expect(screen.queryByTestId("evaluation-request")).toBeNull();

    open();

    // Still first: nothing moves when the rest opens under it.
    expect(
      within(screen.getByTestId("evaluation-facts"))
        .getAllByRole("term")
        .map((term: HTMLElement) => {
          return term.textContent;
        }),
    ).toEqual(["Failure", "Request", "Checked", "Probe"]);
    expect(screen.getByTestId("evaluation-request")).toHaveTextContent(
      "db.acme.example:5432",
    );
  });

  test("a filter only its sentence describes shows the sentence", () => {
    renderDetails(logDetails());

    expect(screen.getByTestId("evaluation-filter-message")).toHaveTextContent(
      "Log Count was 412 in the last 5 minutes, above the 100 threshold.",
    );
  });

  test("a check with nothing more to show than when it ran has no Show details", () => {
    renderDetails(logDetails());

    expect(screen.queryByTestId("evaluation-details-toggle")).toBeNull();
    expect(screen.getByTestId("evaluation-criteria")).toHaveTextContent(
      "“Checkout logs errors” matched.",
    );
    expect(screen.queryByTestId("evaluation-facts")).toBeNull();
  });

  test("a section with no filter that matched lists them all, rather than none", () => {
    renderDetails(details({ filters: [TIME_FILTER] }));

    expect(screen.getAllByTestId("evaluation-filter")).toHaveLength(1);
    expect(screen.getByTestId("evaluation-filter")).toHaveAttribute(
      "data-matched",
      "false",
    );
  });
});

describe("opened, it adds the evidence and the check", () => {
  test("Hide details folds it again, and the button says which it does", () => {
    renderDetails(details());
    open();

    expect(toggle()).toHaveTextContent("Hide details");
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("evaluation-check")).toBeInTheDocument();

    fireEvent.click(toggle());

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("evaluation-request")).toBeNull();
    expect(screen.queryByTestId("evaluation-filter-excerpt")).toBeNull();
  });

  test("the check: the request as configured, its secret masked, when, where and what came back", () => {
    renderDetails(details());
    open();

    expect(screen.getByTestId("evaluation-request")).toHaveTextContent(
      "POST https://api.acme.example/v1/health?api_key=[REDACTED]",
    );
    expect(screen.getByTestId("evaluation-request")).toHaveAttribute(
      "dir",
      "ltr",
    );

    const facts: HTMLElement = screen.getByTestId("evaluation-facts");

    expect(
      within(facts)
        .getAllByRole("term")
        .map((term: HTMLElement) => {
          return term.textContent;
        }),
    ).toEqual(["Request", "Checked", "Probe", "Status code", "Response time"]);
    expect(screen.getByTestId("evaluation-facts-probe")).toHaveTextContent(
      "ProbeUS West",
    );
    expect(
      screen.getByTestId("evaluation-facts-status-code"),
    ).toHaveTextContent("Status code503");
    expect(
      screen.getByTestId("evaluation-facts-response-time"),
    ).toHaveTextContent("Response time1,234 ms");
  });

  test("a check with no probe and no response says only when it ran", () => {
    renderDetails(
      details({
        probeName: undefined,
        response: undefined,
        request: undefined,
        filters: [BODY_FILTER],
      }),
    );
    open();

    const facts: HTMLElement = screen.getByTestId("evaluation-facts");

    expect(within(facts).getAllByRole("term")).toHaveLength(1);
    expect(within(facts).getByText("Checked")).toBeInTheDocument();
  });

  test("a body filter: where it matched, then the excerpt with the match marked", () => {
    renderDetails(details({ filters: [BODY_FILTER] }));
    open();

    const filter: HTMLElement = screen.getByTestId("evaluation-filter");
    const excerpt: HTMLElement = within(filter).getByTestId(
      "evaluation-filter-excerpt",
    );

    expect(excerpt).toHaveTextContent(
      '…{"name":"payments","status":"error: connection refused"},{"token":"[REDACTED]"}…',
    );
    expect(
      within(excerpt).getByTestId("evaluation-excerpt-match"),
    ).toHaveTextContent("error");
    // A response reads left to right on every page.
    expect(
      within(excerpt)
        .getByText(/connection refused/)
        .closest("pre"),
    ).toHaveAttribute("dir", "ltr");
  });

  test("a sentence that only repeats the filter is left out, opened or not", () => {
    renderDetails(details());

    expect(screen.queryByTestId("evaluation-filter-message")).toBeNull();

    open();

    // "Response body contains error." and "...was 503, above the 499 threshold."
    expect(screen.queryByTestId("evaluation-filter-message")).toBeNull();
  });

  test("a filter over a window: the latest check and the window folded, what the window held opened", () => {
    renderDetails(details({ filters: [WINDOW_FILTER] }));

    expect(screen.getByTestId("evaluation-filter-actual")).toHaveTextContent(
      "Latest check1,800 ms",
    );
    expect(screen.getByTestId("evaluation-filter-window")).toHaveTextContent(
      "The last 5 minutes, Average",
    );
    expect(screen.queryByTestId("evaluation-filter-message")).toBeNull();

    open();

    expect(screen.getByTestId("evaluation-filter-message")).toHaveTextContent(
      "was 1,912 ms across 4 readings",
    );
  });

  test("a numeric filter's actual value", () => {
    renderDetails(details({ filters: [STATUS_FILTER] }));

    expect(screen.getByTestId("evaluation-filter-actual")).toHaveTextContent(
      "Actual503",
    );
  });

  test("a measurement is written the reader's way, with its unit", async () => {
    const measured: MonitorEvaluationDetails = details({
      filters: [
        {
          ...STATUS_FILTER,
          checkOn: CheckOn.ResponseTime,
          actual: "2412 ms",
          actualNumber: 2412,
          actualUnit: "ms",
        },
        {
          ...STATUS_FILTER,
          checkOn: CheckOn.PacketLossPercent,
          actual: "12.5%",
          actualNumber: 12.5,
          actualUnit: "%",
        },
      ],
    });

    renderDetails(measured);

    expect(texts("evaluation-filter-actual")).toEqual([
      "Actual2,412 ms",
      "Actual12.5%",
    ]);

    cleanup();
    await inLanguage("de");
    renderDetails(measured);

    expect(texts("evaluation-filter-actual")).toEqual([
      "Tatsächlich2.412 ms",
      "Tatsächlich12,5%",
    ]);
  });

  test("an actual of true or false that says something is named as the criteria form names it", () => {
    renderDetails(
      details({
        filters: [
          {
            checkOn: CheckOn.ResultValue,
            filterType: FilterType.EqualTo,
            value: "true",
            met: true,
            message: "Result Value is true.",
            actual: "true",
            field: "checks.ok",
          },
        ],
      }),
    );

    expect(screen.getByTestId("evaluation-filter-actual")).toHaveTextContent(
      "ActualTrue",
    );
  });

  test("a yes-or-no filter that matched shows no actual value: its title already says it", () => {
    renderDetails(
      details({
        filters: [
          {
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.False,
            met: true,
            message: "Monitor reported offline status.",
            actual: "false",
          },
        ],
      }),
    );
    open();

    expect(screen.queryByTestId("evaluation-filter-actual")).toBeNull();
    // Its sentence is then the account of what the check found.
    expect(screen.getByTestId("evaluation-filter-message")).toHaveTextContent(
      "Monitor reported offline status.",
    );
  });

  test("a JavaScript expression: the expression as code under its title, its values opened, no 'True' and no sentence", () => {
    renderDetails(details({ filters: [EXPRESSION_FILTER] }));

    const filter: HTMLElement = screen.getByTestId("evaluation-filter");
    const value: HTMLElement = within(filter).getByTestId(
      "evaluation-filter-value",
    );

    expect(value).toHaveTextContent(
      "'{{responseBody.status}}' === 'down' && {{responseBody.gone}}",
    );
    // A block of its own under the title, not a chip in its line.
    expect(
      within(filter).getByTestId("evaluation-filter-title"),
    ).not.toContainElement(value);
    expect(value.className).toContain("block");
    expect(value).toHaveAttribute("dir", "ltr");
    expect(screen.queryByTestId("evaluation-filter-actual")).toBeNull();
    expect(screen.queryByTestId("evaluation-filter-values")).toBeNull();

    open();

    const values: HTMLElement = screen.getByTestId("evaluation-filter-values");

    expect(values).toHaveTextContent('responseBody.status = "down"');
    expect(values).toHaveTextContent("responseBody.gone = not found");
    expect(values).toHaveTextContent("responseHeaders.set-cookie = [REDACTED]");
    expect(within(values).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.queryByTestId("evaluation-filter-actual")).toBeNull();
    expect(screen.queryByTestId("evaluation-filter-message")).toBeNull();
  });

  test("a short value sits in the title's line", () => {
    renderDetails(details({ filters: [STATUS_FILTER] }));

    expect(
      within(screen.getByTestId("evaluation-filter-title")).getByTestId(
        "evaluation-filter-value",
      ),
    ).toHaveTextContent("499");
  });

  test("filters that matched come first; one that did not says so, with its sentence", () => {
    renderDetails(
      details({
        filterCondition: FilterCondition.Any,
        filters: [TIME_FILTER, STATUS_FILTER],
      }),
    );
    open();

    const filters: Array<HTMLElement> =
      screen.getAllByTestId("evaluation-filter");

    expect(filters).toHaveLength(2);
    expect(filters[0]).toHaveAttribute("data-matched", "true");
    expect(filters[1]).toHaveAttribute("data-matched", "false");
    expect(
      within(filters[1]!).getByTestId("evaluation-filter-not-matched"),
    ).toHaveTextContent("Did not match");
    expect(
      within(filters[1]!).getByTestId("evaluation-filter-title"),
    ).toHaveTextContent(
      "Did not match: Response Time (in ms) Greater Than 5000",
    );
    expect(
      within(filters[1]!).getByTestId("evaluation-filter-message"),
    ).toHaveTextContent("was 120 ms (expected to be greater than 5000)");
  });

  test("the criteria by name, and how its filters combine", () => {
    renderDetails(
      details({
        filterCondition: FilterCondition.Any,
        filters: [TIME_FILTER, STATUS_FILTER],
      }),
    );

    expect(screen.getByTestId("evaluation-criteria")).toHaveTextContent(
      "“Payments degraded” matched when one of its filters did.",
    );

    cleanup();
    renderDetails(
      details({ criteriaName: undefined, filters: [STATUS_FILTER] }),
    );

    expect(screen.getByTestId("evaluation-criteria")).toHaveTextContent(
      "The criteria matched.",
    );
  });

  test("many filters are each listed", () => {
    const many: Array<MonitorEvaluationFilterDetails> = Array.from(
      { length: 8 },
      (_value: unknown, index: number): MonitorEvaluationFilterDetails => {
        return { ...STATUS_FILTER, value: 400 + index };
      },
    );

    renderDetails(details({ filters: many }));

    expect(screen.getAllByTestId("evaluation-filter")).toHaveLength(8);
  });

  test("long values wrap inside the card rather than widen it", () => {
    const longPath: string = `data.${"segment".repeat(60)}`;
    const longUrl: string = `https://api.acme.example/${"p".repeat(400)}`;

    renderDetails(
      details({
        request: { method: "GET", url: longUrl },
        filters: [
          {
            ...BODY_FILTER,
            field: longPath,
            excerpt: {
              before: "x".repeat(160),
              match: "y".repeat(200),
              after: "z".repeat(160),
              isCutAtStart: true,
              isCutAtEnd: true,
            },
          },
        ],
      }),
    );
    open();

    expect(screen.getByTestId("evaluation-request").className).toContain(
      "[overflow-wrap:anywhere]",
    );
    expect(
      screen.getByTestId("evaluation-filter-excerpt").querySelector("pre")!
        .className,
    ).toContain("whitespace-pre-wrap");
    expect(screen.getByText(longPath).className).toContain(
      "[overflow-wrap:anywhere]",
    );
  });

  test("a several-step monitor names the step", () => {
    renderDetails(details({ stepNumber: 2, stepCount: 3 }));
    open();

    expect(screen.getByTestId("evaluation-facts-step")).toHaveTextContent(
      "Step2 of 3",
    );
  });
});

describe("what was masked or left out, said once", () => {
  test("a section that shows response content says secrets are masked", () => {
    renderDetails(details());
    open();

    expect(screen.getByTestId("evaluation-note-masked")).toHaveTextContent(
      "Secrets and personal data in the response are masked.",
    );
  });

  test("a monitor that keeps no response content says so, and nothing else about masking", () => {
    renderDetails(
      details({
        areResponseExcerptsOff: true,
        filters: [
          {
            ...BODY_FILTER,
            field: undefined,
            excerpt: undefined,
            excerptOmission: "response-excerpts-off",
          },
          STATUS_FILTER,
        ],
      }),
    );
    open();

    expect(screen.getByTestId("evaluation-note-not-kept")).toHaveTextContent(
      "The monitor keeps no response content on its incidents and alerts.",
    );
    expect(screen.queryByTestId("evaluation-note-masked")).toBeNull();
    expect(screen.queryByTestId("evaluation-filter-excerpt")).toBeNull();
    // Said for the section, not on every filter.
    expect(screen.queryByTestId("evaluation-filter-omission")).toBeNull();
  });

  test("an Incoming Request monitor's notes speak of the request it received", () => {
    renderDetails(
      details({
        monitorType: MonitorType.IncomingRequest,
        request: { method: "POST" },
        response: undefined,
        filters: [
          {
            ...BODY_FILTER,
            checkOn: CheckOn.RequestBody,
            message: "Request body contains error.",
          },
        ],
      }),
    );
    open();

    expect(screen.getByTestId("evaluation-note-masked")).toHaveTextContent(
      "Secrets and personal data in the request are masked.",
    );

    cleanup();
    renderDetails(
      details({
        monitorType: MonitorType.IncomingRequest,
        areResponseExcerptsOff: true,
        request: { method: "POST" },
        response: undefined,
        filters: [
          {
            checkOn: CheckOn.RequestBody,
            filterType: FilterType.Contains,
            value: "error",
            met: true,
            message: "Request body contains error.",
            excerptOmission: "response-excerpts-off",
          },
        ],
      }),
    );
    open();

    expect(screen.getByTestId("evaluation-note-not-kept")).toHaveTextContent(
      "The monitor keeps no request content on its incidents and alerts.",
    );
  });

  test("a match that was itself a secret", () => {
    renderDetails(
      details({
        filters: [
          {
            ...BODY_FILTER,
            excerpt: undefined,
            excerptOmission: "matched-text-masked",
          },
        ],
      }),
    );

    // Said with the details, where the excerpt would be.
    expect(screen.queryByTestId("evaluation-filter-omission")).toBeNull();

    open();

    expect(screen.getByTestId("evaluation-filter-omission")).toHaveTextContent(
      "The matched text looks like a secret or personal data, so it was not kept.",
    );
  });

  test("trimmed to its size, and more filters than kept", () => {
    renderDetails(
      details({ isTrimmedToSizeLimit: true, areFiltersTruncated: true }),
    );
    open();

    expect(screen.getByTestId("evaluation-note-trimmed")).toBeInTheDocument();
    expect(
      screen.getByTestId("evaluation-note-more-filters"),
    ).toBeInTheDocument();
  });
});

describe("in the reader's language", () => {
  test("German", async () => {
    await inLanguage("de");
    renderDetails(details({ stepNumber: 2, stepCount: 3 }));

    expect(
      screen.getByRole("heading", { name: "Auswertungsdetails" }),
    ).toBeInTheDocument();
    expect(toggle()).toHaveTextContent("Details anzeigen");
    expect(screen.getByTestId("evaluation-criteria")).toHaveTextContent(
      "“Payments degraded” traf zu, als alle Filter zutrafen.",
    );
    expect(
      screen.getAllByTestId("evaluation-filter-title")[0],
    ).toHaveTextContent("Antworttext Enthält error");
    expect(screen.getByTestId("evaluation-filter-field")).toHaveTextContent(
      "Gefunden inchecks[1].status",
    );

    open();

    expect(toggle()).toHaveTextContent("Details ausblenden");
    expect(screen.getByTestId("evaluation-facts")).toHaveTextContent(
      "Statuscode",
    );
    expect(screen.getByTestId("evaluation-facts")).toHaveTextContent(
      "1.234 ms",
    );
    expect(screen.getByTestId("evaluation-facts-step")).toHaveTextContent(
      "2 von 3",
    );
    expect(screen.getByTestId("evaluation-note-masked")).toHaveTextContent(
      "Geheimnisse und personenbezogene Daten in der Antwort werden maskiert.",
    );
  });

  test("German, for a request", async () => {
    await inLanguage("de");
    renderDetails(
      details({
        monitorType: MonitorType.IncomingRequest,
        areResponseExcerptsOff: true,
        filters: [STATUS_FILTER],
      }),
    );
    open();

    expect(screen.getByTestId("evaluation-note-not-kept")).toHaveTextContent(
      "Der Monitor behält keinen Anfrageinhalt bei seinen Vorfällen und Warnungen.",
    );
  });

  test("Persian, the response still left to right", async () => {
    await inLanguage("fa");
    renderDetails(
      details({
        filters: [BODY_FILTER, { ...TIME_FILTER }],
        filterCondition: FilterCondition.Any,
      }),
    );
    open();

    expect(
      screen.getByRole("heading", { name: "جزئیات ارزیابی" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("evaluation-request")).toHaveAttribute(
      "dir",
      "ltr",
    );
    expect(
      screen.getByTestId("evaluation-filter-excerpt").querySelector("pre"),
    ).toHaveAttribute("dir", "ltr");
    expect(screen.getByTestId("evaluation-filter-message")).toHaveAttribute(
      "dir",
      "auto",
    );
  });
});

describe("every word the section writes", () => {
  test("is in each of the Dashboard's languages", () => {
    const words: Array<string> = [
      EVALUATION_DETAILS_HEADING,
      SHOW_EVALUATION_DETAILS,
      HIDE_EVALUATION_DETAILS,
      ...Object.values(EVALUATION_FACT_LABELS),
      ...Object.values(FILTER_FACT_LABELS),
      STEP_OF_STEPS,
      CRITERIA_MATCHED_ALL,
      CRITERIA_MATCHED_ANY,
      CRITERIA_MATCHED,
      UNNAMED_CRITERIA_MATCHED_ALL,
      UNNAMED_CRITERIA_MATCHED_ANY,
      UNNAMED_CRITERIA_MATCHED,
      FILTER_MATCHED,
      FILTER_NOT_MATCHED,
      FIELD_VALUE_NOT_FOUND,
      WINDOW_SENTENCE.one,
      WINDOW_SENTENCE.other,
      RESPONSE_CONTENT_NOT_KEPT,
      REQUEST_CONTENT_NOT_KEPT,
      MATCHED_TEXT_MASKED,
      BODY_WAS_EMPTY,
      SECRETS_ARE_MASKED,
      SECRETS_IN_REQUEST_ARE_MASKED,
      DETAILS_WERE_TRIMMED,
      MORE_FILTERS_THAN_SHOWN,
    ];

    const missing: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      const locale: Record<string, string> = readDashboardLocale(language);

      for (const word of words) {
        if (!locale[word]?.trim()) {
          missing.push(`${language}: ${word}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});

describe("the rules the section is drawn by", () => {
  test("the criteria's sentence", () => {
    expect(getCriteriaSentence(details())).toEqual({
      template: CRITERIA_MATCHED_ALL,
      hasName: true,
    });
    expect(
      getCriteriaSentence(details({ filterCondition: FilterCondition.Any })),
    ).toEqual({ template: CRITERIA_MATCHED_ANY, hasName: true });
    expect(getCriteriaSentence(details({ filters: [STATUS_FILTER] }))).toEqual({
      template: CRITERIA_MATCHED,
      hasName: true,
    });
    expect(
      getCriteriaSentence(
        details({ criteriaName: "  ", filters: [STATUS_FILTER] }),
      ),
    ).toEqual({ template: UNNAMED_CRITERIA_MATCHED, hasName: false });
  });

  test("an omission is noted on its filter, but for the monitor's setting", () => {
    expect(getExcerptOmissionNote("response-excerpts-off")).toBeUndefined();
    expect(getExcerptOmissionNote(undefined)).toBeUndefined();
    expect(getExcerptOmissionNote("empty-body")).toBe("The body was empty.");
  });

  test("whether the section shows response content", () => {
    expect(showsResponseContent(details())).toBe(true);
    expect(showsResponseContent(details({ filters: [STATUS_FILTER] }))).toBe(
      false,
    );
    expect(SECRETS_ARE_MASKED).toBe(
      "Secrets and personal data in the response are masked.",
    );
    expect(RESPONSE_CONTENT_NOT_KEPT).toContain("no response content");
  });

  test("the notes name a request for an Incoming Request monitor, a response for the rest", () => {
    expect(getContentNotKeptNote(MonitorType.IncomingRequest)).toBe(
      REQUEST_CONTENT_NOT_KEPT,
    );
    expect(getSecretsMaskedNote(MonitorType.IncomingRequest)).toBe(
      SECRETS_IN_REQUEST_ARE_MASKED,
    );

    for (const monitorType of [
      MonitorType.API,
      MonitorType.Website,
      MonitorType.CustomJavaScriptCode,
    ]) {
      expect(getContentNotKeptNote(monitorType)).toBe(
        RESPONSE_CONTENT_NOT_KEPT,
      );
      expect(getSecretsMaskedNote(monitorType)).toBe(SECRETS_ARE_MASKED);
    }
  });

  test("matched filters first, each group in the criteria's order", () => {
    expect(
      orderFilters([TIME_FILTER, BODY_FILTER, STATUS_FILTER]).map(
        (filter: MonitorEvaluationFilterDetails) => {
          return filter.checkOn;
        },
      ),
    ).toEqual([
      CheckOn.ResponseBody,
      CheckOn.ResponseStatusCode,
      CheckOn.ResponseTime,
    ]);
  });

  test("folded, only the filters that matched; opened, every one", () => {
    const filters: Array<MonitorEvaluationFilterDetails> = [
      TIME_FILTER,
      BODY_FILTER,
      STATUS_FILTER,
    ];

    expect(getShownFilters(filters, false)).toEqual([
      BODY_FILTER,
      STATUS_FILTER,
    ]);
    expect(getShownFilters(filters, true)).toEqual([
      BODY_FILTER,
      STATUS_FILTER,
      TIME_FILTER,
    ]);
    // None matched: all of them, never an empty list.
    expect(getShownFilters([TIME_FILTER], false)).toEqual([TIME_FILTER]);
  });

  test("an actual value that only repeats a yes-or-no condition is not shown", () => {
    expect(getShownActual(STATUS_FILTER)).toBe("503");
    expect(getShownActual(EXPRESSION_FILTER)).toBeUndefined();
    expect(
      getShownActual({
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.False,
        met: true,
        message: "",
        actual: "false",
      }),
    ).toBeUndefined();
    expect(
      getShownActual({
        checkOn: CheckOn.IsRequestTimeout,
        filterType: FilterType.True,
        met: true,
        message: "",
        actual: "true",
      }),
    ).toBeUndefined();
    // A filter that did not match, or a value compared to a text, keeps it.
    expect(
      getShownActual({
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.False,
        met: false,
        message: "",
        actual: "true",
      }),
    ).toBe("true");
    expect(
      getShownActual({
        checkOn: CheckOn.ResultValue,
        filterType: FilterType.EqualTo,
        met: true,
        message: "",
        actual: "true",
      }),
    ).toBe("true");
    expect(getShownActual(BODY_FILTER)).toBeUndefined();
  });

  test("what the section can say a filter found, other than in its sentence", () => {
    expect(hasFoundValues(BODY_FILTER)).toBe(true);
    expect(hasFoundValues(STATUS_FILTER)).toBe(true);
    expect(hasFoundValues(EXPRESSION_FILTER)).toBe(true);
    expect(hasFoundValues(LOG_COUNT_FILTER)).toBe(false);
    expect(hasFoundValues(TIME_FILTER)).toBe(false);
    expect(
      hasFoundValues({
        ...EXPRESSION_FILTER,
        fieldValues: undefined,
        excerptOmission: "response-excerpts-off",
      }),
    ).toBe(false);
  });

  test("when a filter's own sentence shows", () => {
    // The only account: shown folded and opened.
    expect(isFilterSentenceShown(LOG_COUNT_FILTER, false)).toBe(true);
    expect(isFilterSentenceShown(LOG_COUNT_FILTER, true)).toBe(true);
    expect(isFilterSentenceShown(TIME_FILTER, true)).toBe(true);
    // It only repeats the filter.
    expect(isFilterSentenceShown(BODY_FILTER, false)).toBe(false);
    expect(isFilterSentenceShown(BODY_FILTER, true)).toBe(false);
    expect(isFilterSentenceShown(STATUS_FILTER, true)).toBe(false);
    // What a window held: with the details.
    expect(isFilterSentenceShown(WINDOW_FILTER, false)).toBe(false);
    expect(isFilterSentenceShown(WINDOW_FILTER, true)).toBe(true);
    // A JavaScript expression that matched: never, values or none.
    expect(isFilterSentenceShown(EXPRESSION_FILTER, true)).toBe(false);
    expect(
      isFilterSentenceShown(
        { ...EXPRESSION_FILTER, fieldValues: undefined },
        true,
      ),
    ).toBe(false);
    // One that did not match may say why.
    expect(
      isFilterSentenceShown(
        {
          ...EXPRESSION_FILTER,
          met: false,
          actual: undefined,
          fieldValues: undefined,
          message: "JavaScript Expression failed: x is not defined.",
        },
        true,
      ),
    ).toBe(true);
    // No sentence, nothing to show.
    expect(
      isFilterSentenceShown({ ...LOG_COUNT_FILTER, message: " " }, true),
    ).toBe(false);
  });

  test("a value goes under the title when it is an expression or long", () => {
    expect(isFilterValueOnItsOwnLine(STATUS_FILTER)).toBe(false);
    expect(isFilterValueOnItsOwnLine(BODY_FILTER)).toBe(false);
    expect(isFilterValueOnItsOwnLine(EXPRESSION_FILTER)).toBe(true);
    expect(
      isFilterValueOnItsOwnLine({
        ...BODY_FILTER,
        value: "x".repeat(LONG_FILTER_VALUE_CHARS),
      }),
    ).toBe(false);
    expect(
      isFilterValueOnItsOwnLine({
        ...BODY_FILTER,
        value: "x".repeat(LONG_FILTER_VALUE_CHARS + 1),
      }),
    ).toBe(true);
    expect(isFilterValueOnItsOwnLine({ ...BODY_FILTER, value: "a\nb" })).toBe(
      true,
    );
    expect(
      isFilterValueOnItsOwnLine({ ...EXPRESSION_FILTER, value: undefined }),
    ).toBe(false);
  });

  test("the request line", () => {
    expect(getRequestText(undefined)).toBeUndefined();
    expect(
      getRequestText({ method: "GET", url: "https://acme.example/health" }),
    ).toBe("GET https://acme.example/health");
    expect(getRequestText({ url: "https://acme.example" })).toBe(
      "https://acme.example",
    );
    expect(getRequestText({ destination: "db.acme.example", port: 5432 })).toBe(
      "db.acme.example:5432",
    );
    expect(getRequestText({ destination: "10.0.0.7" })).toBe("10.0.0.7");
    expect(getRequestText({ method: "POST" })).toBe("POST");
    expect(getRequestText({})).toBeUndefined();
  });

  test("whether Show details has anything to add", () => {
    expect(hasDetailsToShow(details())).toBe(true);
    // A Logs monitor's count, its sentence shown: only when it ran is left.
    expect(hasDetailsToShow(logDetails())).toBe(false);
    expect(hasDetailsToShow(logDetails({ probeName: "US West" }))).toBe(true);
    expect(hasDetailsToShow(logDetails({ stepNumber: 1, stepCount: 2 }))).toBe(
      true,
    );
    expect(hasDetailsToShow(logDetails({ stepNumber: 1, stepCount: 1 }))).toBe(
      false,
    );
    expect(
      hasDetailsToShow(logDetails({ response: { responseTimeInMs: 12 } })),
    ).toBe(true);
    // A failure shows folded: nothing more to open for it.
    expect(
      hasDetailsToShow(logDetails({ response: { failureCause: "Refused" } })),
    ).toBe(false);
    expect(
      hasDetailsToShow(
        logDetails({ filters: [LOG_COUNT_FILTER, { ...TIME_FILTER }] }),
      ),
    ).toBe(true);
    expect(hasDetailsToShow(logDetails({ filters: [WINDOW_FILTER] }))).toBe(
      true,
    );
    expect(hasDetailsToShow(logDetails({ filters: [EXPRESSION_FILTER] }))).toBe(
      true,
    );
    expect(hasDetailsToShow(logDetails({ isTrimmedToSizeLimit: true }))).toBe(
      true,
    );
    expect(hasDetailsToShow(logDetails({ areFiltersTruncated: true }))).toBe(
      true,
    );
    expect(hasDetailsToShow(logDetails({ areResponseExcerptsOff: true }))).toBe(
      true,
    );
    expect(
      hasDetailsToShow(
        logDetails({
          filters: [
            {
              ...LOG_COUNT_FILTER,
              excerptOmission: "matched-text-masked",
            },
          ],
        }),
      ),
    ).toBe(true);
  });
});
