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
  CRITERIA_MATCHED,
  CRITERIA_MATCHED_ALL,
  CRITERIA_MATCHED_ANY,
  RESPONSE_CONTENT_NOT_KEPT,
  SECRETS_ARE_MASKED,
  UNNAMED_CRITERIA_MATCHED,
  getCriteriaSentence,
  getExcerptOmissionNote,
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
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * EVALUATION DETAILS, UNDER AN INCIDENT'S OR AN ALERT'S ROOT CAUSE.
 *
 * Folded, the section says what the check was - when, from which probe,
 * the status code and the response time. Opened, the request, how the
 * criteria matched and each filter: what it found and where, a JavaScript
 * expression's values, the excerpt with the match marked, and what was
 * masked or left out. In English, German and Persian, from the shipped
 * locale files.
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

function renderDetails(value: MonitorEvaluationDetails): RenderResult {
  return render(<EventEvaluationDetails details={value} />);
}

function open(): void {
  fireEvent.click(screen.getByTestId("evaluation-details-toggle"));
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

describe("folded, the section says what the check was", () => {
  test("a heading, then when, from where, what came back", () => {
    renderDetails(details());

    expect(
      screen.getByRole("heading", { name: "Evaluation details" }),
    ).toBeInTheDocument();

    const facts: HTMLElement = screen.getByTestId("evaluation-facts");

    expect(within(facts).getByText("Checked")).toBeInTheDocument();
    expect(within(facts).getByText("Probe")).toBeInTheDocument();
    expect(within(facts).getByText("US West")).toBeInTheDocument();
    expect(within(facts).getByText("Status code")).toBeInTheDocument();
    expect(within(facts).getByText("503")).toBeInTheDocument();
    expect(within(facts).getByText("Response time")).toBeInTheDocument();
    expect(within(facts).getByText("1,234 ms")).toBeInTheDocument();
  });

  test("the filters wait behind Show details", () => {
    renderDetails(details());

    const toggle: HTMLElement = screen.getByTestId("evaluation-details-toggle");

    expect(toggle).toHaveTextContent("Show details");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("evaluation-details-body")).toBeNull();
  });

  test("a check with no probe and no response says only when", () => {
    renderDetails(
      details({
        probeName: undefined,
        response: undefined,
        request: undefined,
        monitorType: MonitorType.Logs,
      }),
    );

    const facts: HTMLElement = screen.getByTestId("evaluation-facts");

    expect(within(facts).getAllByRole("term")).toHaveLength(1);
    expect(within(facts).getByText("Checked")).toBeInTheDocument();
  });
});

describe("opened, it says why", () => {
  test("Hide details folds it again, and the button says which it does", () => {
    renderDetails(details());
    open();

    const toggle: HTMLElement = screen.getByTestId("evaluation-details-toggle");
    const body: HTMLElement = screen.getByTestId("evaluation-details-body");

    expect(toggle).toHaveTextContent("Hide details");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", body.id);

    fireEvent.click(toggle);

    expect(screen.queryByTestId("evaluation-details-body")).toBeNull();
  });

  test("the request line, as configured, its secret masked", () => {
    renderDetails(details());
    open();

    expect(screen.getByTestId("evaluation-request")).toHaveTextContent(
      "POST https://api.acme.example/v1/health?api_key=[REDACTED]",
    );
    expect(screen.getByTestId("evaluation-request")).toHaveAttribute(
      "dir",
      "ltr",
    );
  });

  test("a host check names its host and port", () => {
    renderDetails(
      details({
        request: { destination: "db.acme.example", port: 5432 },
        response: { isOnline: false, failureCause: "Connection refused" },
        filters: [STATUS_FILTER],
      }),
    );
    open();

    expect(screen.getByTestId("evaluation-request")).toHaveTextContent(
      "db.acme.example:5432",
    );
    expect(
      screen.getByTestId("evaluation-request-facts-failure"),
    ).toHaveTextContent("Connection refused");
  });

  test("the criteria by name, and how its filters combine", () => {
    renderDetails(details());
    open();

    expect(screen.getByTestId("evaluation-criteria")).toHaveTextContent(
      "“Payments degraded” matched when all of its filters did.",
    );
  });

  test("one filter of Any was enough", () => {
    renderDetails(
      details({
        filterCondition: FilterCondition.Any,
        filters: [TIME_FILTER, STATUS_FILTER],
      }),
    );
    open();

    expect(screen.getByTestId("evaluation-criteria")).toHaveTextContent(
      "“Payments degraded” matched when one of its filters did.",
    );
  });

  test("a criteria of one filter, and one with no name", () => {
    renderDetails(
      details({ criteriaName: undefined, filters: [STATUS_FILTER] }),
    );
    open();

    expect(screen.getByTestId("evaluation-criteria")).toHaveTextContent(
      "The criteria matched.",
    );
  });

  test("a filter that matched in the body: what it checked, where, and the excerpt", () => {
    renderDetails(details({ filters: [BODY_FILTER] }));
    open();

    const filter: HTMLElement = screen.getByTestId("evaluation-filter");

    expect(filter).toHaveAttribute("data-matched", "true");
    expect(
      within(filter).getByTestId("evaluation-filter-title"),
    ).toHaveTextContent("Matched: Response Body Contains error");
    expect(
      within(filter).getByTestId("evaluation-filter-field"),
    ).toHaveTextContent("Found atchecks[1].status");

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

    expect(
      within(filter).getByTestId("evaluation-filter-message"),
    ).toHaveTextContent("Response body contains error.");
  });

  test("a numeric filter's actual value", () => {
    renderDetails(details({ filters: [STATUS_FILTER] }));
    open();

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
    open();

    expect(
      screen
        .getAllByTestId("evaluation-filter-actual")
        .map((element: HTMLElement) => {
          return element.textContent;
        }),
    ).toEqual(["Actual2,412 ms", "Actual12.5%"]);

    cleanup();
    await inLanguage("de");
    renderDetails(measured);
    open();

    expect(
      screen
        .getAllByTestId("evaluation-filter-actual")
        .map((element: HTMLElement) => {
          return element.textContent;
        }),
    ).toEqual(["Tatsächlich2.412 ms", "Tatsächlich12,5%"]);
  });

  test("true and false are named as the criteria form names them", () => {
    renderDetails(
      details({
        filters: [
          {
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.False,
            met: true,
            message: "Is Online is false.",
            actual: "false",
          },
        ],
      }),
    );
    open();

    expect(screen.getByTestId("evaluation-filter-actual")).toHaveTextContent(
      "ActualFalse",
    );
  });

  test("a filter over a window: the latest check, and the window", () => {
    renderDetails(
      details({
        filters: [
          {
            ...STATUS_FILTER,
            checkOn: CheckOn.ResponseTime,
            actual: "1800 ms",
            windowMinutes: 5,
            windowType: EvaluateOverTimeType.Average,
          },
        ],
      }),
    );
    open();

    expect(screen.getByTestId("evaluation-filter-actual")).toHaveTextContent(
      "Latest check1800 ms",
    );
    expect(screen.getByTestId("evaluation-filter-window")).toHaveTextContent(
      "The last 5 minutes, Average",
    );
  });

  test("a JavaScript expression's values, and a path that found nothing", () => {
    renderDetails(
      details({
        filters: [
          {
            checkOn: CheckOn.JavaScriptExpression,
            filterType: FilterType.EvaluatesToTrue,
            value:
              "'{{responseBody.status}}' === 'down' && {{responseBody.gone}}",
            met: true,
            actual: "true",
            message: "JavaScript Expression - ... - evaluated to true.",
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
          },
        ],
      }),
    );
    open();

    const values: HTMLElement = screen.getByTestId("evaluation-filter-values");

    expect(values).toHaveTextContent('responseBody.status = "down"');
    expect(values).toHaveTextContent("responseBody.gone = not found");
    expect(values).toHaveTextContent("responseHeaders.set-cookie = [REDACTED]");
    expect(within(values).getAllByRole("listitem")).toHaveLength(4);
  });

  test("filters that matched come first; one that did not says so", () => {
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
  });

  test("many filters are each listed", () => {
    const many: Array<MonitorEvaluationFilterDetails> = Array.from(
      { length: 8 },
      (_value: unknown, index: number): MonitorEvaluationFilterDetails => {
        return { ...STATUS_FILTER, value: 400 + index };
      },
    );

    renderDetails(details({ filters: many }));
    open();

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

  test("a several-step monitor names the step", () => {
    renderDetails(details({ stepNumber: 2, stepCount: 3 }));
    open();

    expect(
      screen.getByTestId("evaluation-request-facts-step"),
    ).toHaveTextContent("Step2 of 3");
  });
});

describe("in the reader's language", () => {
  test("German", async () => {
    await inLanguage("de");
    renderDetails(details({ stepNumber: 2, stepCount: 3 }));
    open();

    expect(
      screen.getByRole("heading", { name: "Auswertungsdetails" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("evaluation-details-toggle")).toHaveTextContent(
      "Details ausblenden",
    );
    expect(screen.getByTestId("evaluation-facts")).toHaveTextContent(
      "Statuscode",
    );
    expect(screen.getByTestId("evaluation-facts")).toHaveTextContent(
      "1.234 ms",
    );
    expect(screen.getByTestId("evaluation-criteria")).toHaveTextContent(
      "“Payments degraded” traf zu, als alle Filter zutrafen.",
    );
    expect(
      screen.getByTestId("evaluation-request-facts-step"),
    ).toHaveTextContent("2 von 3");
    expect(
      screen.getAllByTestId("evaluation-filter-title")[0],
    ).toHaveTextContent("Antworttext Enthält error");
  });

  test("Persian, the response still left to right", async () => {
    await inLanguage("fa");
    renderDetails(details());
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
    expect(
      screen.getAllByTestId("evaluation-filter-message")[0],
    ).toHaveAttribute("dir", "auto");
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
});
