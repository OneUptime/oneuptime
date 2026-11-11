/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import ConnectorTestReportView from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/ConnectorTestReportView";
import SecurityEventAttributeColumnPicker from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventAttributeColumnPicker";
import SecurityEventConnectionDiagnostics from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionDiagnostics";
import SecurityEventConnectionRunDetails from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionRunDetails";
import {
  CONNECTOR_RECORDS_NAMES,
  connectorRecordsName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionDiagnosticsUtil";
import SecurityEventDetailPanel from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventDetailPanel";
import SecurityEventsSetupGuide from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsSetupGuide";
import { RouteUtil } from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectionRun from "../../../Models/DatabaseModels/SecurityEventConnectionRun";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";
import { SecurityConnectorTestReport } from "../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import { SecurityEventConnectionRunResult } from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import { SecurityEventConnectorCatalog } from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import API from "../../../UI/Utils/API/API";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";

/*
 * SECURITY EVENTS IN THE READER'S LANGUAGE - from the Dashboard's shipped
 * locale files (#6658, part 2).
 *
 * A German security engineer opening a connection's diagnostics used to read
 * "Connection diagnostics: Customer SecOps", "Enabled, every 5 minutes",
 * "Find historical detections" and "Preview detections" between German
 * labels, a connection test report said "Some checks failed" and "What is
 * available to import", and the setup guide counted "7 new events" in
 * English. Each is now one sentence looked up whole, with the records a
 * connector imports named inside it in the reader's language - and the
 * English word for word for an English reader (the components' own suites).
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const EN: Record<string, string> = readLocale("en");
const DE: Record<string, string> = readLocale("de");
const AR: Record<string, string> = readLocale("ar");

// The locale's own words for `key`, which must differ from the English.
function worded(
  locale: Record<string, string>,
  key: string,
  values: Record<string, string> = {},
): string {
  const text: string | undefined = locale[key];

  expect({ key, translated: Boolean(text) && text !== EN[key] }).toEqual({
    key,
    translated: true,
  });

  return Object.keys(values).reduce((sentence: string, name: string) => {
    return sentence.split(`{{${name}}}`).join(values[name] as string);
  }, text as string);
}

// The words of a translated sentence around its placeholders.
function pieces(locale: Record<string, string>, key: string): Array<string> {
  return worded(locale, key)
    .split(/\{\{[^}]+\}\}/)
    .map((piece: string): string => {
      return piece.trim();
    })
    .filter((piece: string): boolean => {
      return piece.length > 0;
    });
}

// A text without the isolates a right-to-left sentence sets its values in.
function plain(text: string | null | undefined): string {
  return (text || "")
    .split(FIRST_STRONG_ISOLATE)
    .join("")
    .split(POP_DIRECTIONAL_ISOLATE)
    .join("");
}

function expectSentence(
  element: HTMLElement,
  locale: Record<string, string>,
  key: string,
): void {
  const text: string = plain(element.textContent);

  for (const piece of pieces(locale, key)) {
    expect({ key, piece, shown: text.includes(piece) }).toEqual({
      key,
      piece,
      shown: true,
    });
  }
}

function expectNoEnglish(element: HTMLElement, sentences: Array<string>): void {
  const text: string = plain(element.textContent);

  expect(
    sentences.filter((sentence: string): boolean => {
      return text.includes(sentence);
    }),
  ).toEqual([]);
}

const CONNECTION_ID: string = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const RUN_ID: string = "33333333-3333-4333-8333-333333333333";
const NOW: number = new Date("2026-09-10T12:00:00Z").getTime();

function googleConnection(): SecurityEventConnection {
  const value: SecurityEventConnection = new SecurityEventConnection();
  value._id = CONNECTION_ID;
  value.projectId = new ObjectID(PROJECT_ID);
  value.name = "Customer SecOps";
  value.provider = SecurityEventConnectorProvider.GoogleSecOps;
  value.config = {
    region: "europe",
    instanceResourceName: "projects/acme/locations/europe/instances/i",
  };
  value.isEnabled = true;
  value.pollIntervalInMinutes = 5;
  value.alertingOnly = true;
  value.createdAt = new Date(NOW - 60_000);
  return value;
}

function pollResult(
  overrides: Partial<SecurityEventConnectionRunResult> = {},
): SecurityEventConnectionRunResult {
  return {
    type: "poll",
    provider: SecurityEventConnectorProvider.AwsSecurityHub,
    status: "partial",
    startedAt: "2026-09-10T11:59:00Z",
    completedAt: "2026-09-10T11:59:02Z",
    durationMs: 2000,
    windowStart: "2026-09-10T11:29:00Z",
    windowEnd: "2026-09-10T12:00:00Z",
    fetchedCount: 4,
    ingestedCount: 3,
    duplicateCount: 1,
    rejectedCount: 0,
    failedCount: 0,
    complete: false,
    requestCount: 1,
    warnings: [],
    samples: [],
    checks: [],
    chunkMinutes: 60,
    nextChunkMinutes: 60,
    ...overrides,
  };
}

function pollRun(): SecurityEventConnectionRun {
  const value: SecurityEventConnectionRun = new SecurityEventConnectionRun();
  value._id = RUN_ID;
  value.securityEventConnectionId = new ObjectID(CONNECTION_ID);
  value.type = "poll";
  value.status = "partial";
  value.startedAt = new Date("2026-09-10T12:00:00Z");
  value.completedAt = new Date("2026-09-10T12:00:05Z");
  value.result = pollResult() as unknown as JSONObject;
  return value;
}

function testReport(): SecurityConnectorTestReport {
  return {
    provider: SecurityEventConnectorProvider.OktaSystemLog,
    status: "fail",
    startedAt: "2026-09-10T12:00:00.000Z",
    completedAt: "2026-09-10T12:00:03.500Z",
    durationMs: 3500,
    summary: "Okta accepted the token, but no worker is running.",
    checks: [
      {
        key: "authentication",
        name: "Authenticate with Okta",
        status: "pass",
        durationMs: 1400,
        message: "The API token was accepted.",
      },
      {
        key: "detections-available",
        name: "Records available to import",
        status: "warn",
        durationMs: 12,
        message: "No log events were created in the last 7 days.",
        remediation: "Widen the filter if you expected events.",
      },
      {
        key: "worker-consumers",
        name: "Background workers",
        status: "fail",
        durationMs: 12,
        message: "No process is consuming the Worker queue.",
        remediation: "Set DISABLE_QUEUE_WORKERS=false.",
      },
    ],
    counts: { createdLast24h: 0, createdLast7d: 0, hasMoreLast7d: false },
    samples: [
      {
        id: "evt-1",
        title: "user.session.start",
        severity: "INFO",
        createdTime: "2026-09-10T11:58:00.000Z",
        eventTime: "2026-09-10T11:57:59.000Z",
      },
    ],
  };
}

function history(
  data: Array<SecurityEventConnectionRun>,
): ListResult<SecurityEventConnectionRun> {
  return { data, count: data.length, skip: 0, limit: 20 };
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      ar: { translation: AR },
      en: { translation: EN },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("de");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("the records a connector imports, named in every sentence", () => {
  test("every connector's records have a name the locales word", () => {
    for (const definition of SecurityEventConnectorCatalog) {
      const name: string = connectorRecordsName(definition);

      expect({
        provider: definition.provider,
        importedRecordName: definition.importedRecordName,
        listed: Object.values(CONNECTOR_RECORDS_NAMES).includes(name),
      }).toEqual({
        provider: definition.provider,
        importedRecordName: definition.importedRecordName,
        listed: true,
      });

      for (const locale of [DE, AR]) {
        worded(locale, name);
      }
    }
  });
});

describe("the connection test report in German and Arabic", () => {
  test("German: the verdict, the check groups, the durations and the samples", () => {
    render(<ConnectorTestReportView report={testReport()} />);

    const report: HTMLElement = screen.getByRole("region", {
      name: worded(DE, "Connection test report"),
    });

    expect(
      within(report).getByRole("heading", {
        name: worded(DE, "Some checks failed"),
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("region", {
        name: worded(DE, "What is available to import"),
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("region", {
        name: worded(DE, "OneUptime workers and scheduler"),
      }),
    ).toBeVisible();
    expectSentence(report, DE, "Access to {{provider}}");
    expect(report).toHaveTextContent(worded(DE, "Sample records"));
    expect(report).toHaveTextContent(worded(DE, "What to do"));
    // German writes 3.5 seconds with a decimal comma.
    expect(report).toHaveTextContent("3,5 s");

    expectNoEnglish(report, [
      "Some checks failed",
      "What is available to import",
      "OneUptime workers and scheduler",
      "Sample records",
      "What to do",
      "completed",
    ]);
  });

  test("Arabic: the verdict and the check groups", async () => {
    await i18next.changeLanguage("ar");
    render(<ConnectorTestReportView report={testReport()} />);

    const report: HTMLElement = screen.getByRole("region", {
      name: worded(AR, "Connection test report"),
    });

    expect(plain(report.textContent)).toContain(
      worded(AR, "Some checks failed"),
    );
    expect(plain(report.textContent)).toContain(
      worded(AR, "What is available to import"),
    );
    expect(plain(report.textContent)).toContain(
      worded(AR, "OneUptime workers and scheduler"),
    );
    expectSentence(report, AR, "{{provider}} · completed {{time}}");
    expectNoEnglish(report, [
      "Some checks failed",
      "What is available to import",
      "Sample records",
      "What to do",
      "completed",
    ]);
  });
});

describe("a poll's run details in German and Arabic", () => {
  function renderRun(): HTMLElement {
    render(
      <MemoryRouter>
        <SecurityEventConnectionRunDetails run={pollRun()} />
      </MemoryRouter>,
    );

    return screen.getByRole("region", { name: worded(DE, "Run details") });
  }

  test("German: the window, the counts and the cursor sentence", () => {
    const details: HTMLElement = renderRun();

    expect(details).toHaveTextContent(worded(DE, "Poll details"));
    expect(details).toHaveTextContent(worded(DE, "Requested window (UTC)"));
    expect(details).toHaveTextContent(worded(DE, "Window read by this poll"));
    expect(details).toHaveTextContent(worded(DE, "Next scheduled poll reads"));
    expect(details).toHaveTextContent(
      worded(DE, "{{window}}, the same length", {
        window: worded(DE, "{{count}} hours_one", { count: "1" }),
      }),
    );
    expectSentence(
      details,
      DE,
      "This poll stopped before the end of its window and moved the cursor to the last record it read. The next scheduled poll continues from there with a window of {{window}}.",
    );
    expectSentence(details, DE, "Returned by {{provider}}");
    expect(details).toHaveTextContent(worded(DE, "Imported into OneUptime"));
    expect(details).toHaveTextContent(worded(DE, "Already imported"));

    expectNoEnglish(details, [
      "Poll details",
      "Requested window",
      "Window read by this poll",
      "the same length",
      "moved the cursor",
      "Returned by",
      "Imported into OneUptime",
      "Already imported",
    ]);
  });

  test("Arabic: the same details, worded in Arabic", async () => {
    await i18next.changeLanguage("ar");
    render(
      <MemoryRouter>
        <SecurityEventConnectionRunDetails run={pollRun()} />
      </MemoryRouter>,
    );

    const details: HTMLElement = screen.getByRole("region", {
      name: worded(AR, "Run details"),
    });

    expect(plain(details.textContent)).toContain(worded(AR, "Poll details"));
    expectSentence(
      details,
      AR,
      "This poll stopped before the end of its window and moved the cursor to the last record it read. The next scheduled poll continues from there with a window of {{window}}.",
    );
    expectSentence(details, AR, "Returned by {{provider}}");
    expectNoEnglish(details, [
      "Poll details",
      "Requested window",
      "moved the cursor",
      "Returned by",
      "Already imported",
    ]);
  });
});

describe("a Google SecOps connection's diagnostics in German", () => {
  beforeEach((): void => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    jest.spyOn(ModelAPI, "getList").mockResolvedValue(history([]));
    jest.spyOn(ModelAPI, "getItem").mockResolvedValue(googleConnection());
    jest
      .spyOn(ModelAPI, "getCommonHeaders")
      .mockReturnValue({ "project-id": PROJECT_ID });
    jest
      .spyOn(API, "post")
      .mockResolvedValue(new HTTPResponse(200, { runId: RUN_ID }, {}));
    jest.spyOn(RouteUtil, "populateRouteParams").mockImplementation(() => {
      return new Route(`/dashboard/${PROJECT_ID}/security-events`);
    });
  });

  async function renderDiagnostics(): Promise<void> {
    render(
      <MemoryRouter>
        <SecurityEventConnectionDiagnostics
          connection={googleConnection()}
          canRun={true}
          onClose={(): void => {}}
          onUpdated={(): void => {}}
        />
      </MemoryRouter>,
    );

    // The run history has loaded: nothing has run yet.
    await screen.findByText(
      worded(
        DE,
        "No runs recorded yet. Older polls may not have diagnostic history.",
      ),
    );
  }

  test("the title, the schedule and the historical import name the detections in German", async () => {
    await renderDiagnostics();

    const detections: string = worded(DE, "detections");

    expect(
      await screen.findByText(
        worded(DE, "Connection diagnostics: {{name}}", {
          name: "Customer SecOps",
        }),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: worded(DE, "Find historical {{records}}", {
          records: detections,
        }),
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: worded(DE, "Preview {{records}}", { records: detections }),
      }),
    ).toBeVisible();

    const schedule: HTMLElement = screen.getByRole("region", {
      name: worded(DE, "Scheduled polling"),
    });

    expect(schedule).toHaveTextContent(
      worded(DE, "Enabled, every {{count}} minutes", { count: "5" }),
    );

    expectNoEnglish(document.body, [
      "Connection diagnostics",
      "Find historical",
      "Preview detections",
      "Enabled, every",
      "Scheduled polling",
      "Run history",
    ]);
  });

  test("the import confirmation is one German sentence naming what is imported and what is skipped", async () => {
    await renderDiagnostics();

    fireEvent.click(
      await screen.findByRole("button", {
        name: worded(DE, "Import this time range"),
      }),
    );

    const confirmation: HTMLElement = screen.getByRole("group", {
      name: worded(DE, "Confirm historical import"),
    });

    expectSentence(
      confirmation,
      DE,
      "Import {{what}} from {{start}} to {{end}} into OneUptime? Imported events become available to security rules and monitors. Already imported {{records}} are skipped.",
    );
    // The alerts-only scope imports alerts; what is skipped is detections.
    expect(confirmation).toHaveTextContent(worded(DE, "detections"));
    expectNoEnglish(confirmation, [
      "Import alerts from",
      "into OneUptime?",
      "Already imported",
      "are skipped",
    ]);
  });
});

describe("the attribute column picker in German", () => {
  test("its search, its count line and its buttons", () => {
    const keys: Array<string> = Array.from(
      { length: 120 },
      (_value: unknown, index: number): string => {
        return `target.user.labels.${index}`;
      },
    );

    render(
      <SecurityEventAttributeColumnPicker
        attributeKeys={keys}
        selectedKeys={["device.hostname"]}
        onChange={(): void => {}}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(worded(DE, "Columns")) }),
    );

    expect(
      screen.getByRole("textbox", { name: worded(DE, "Search attributes") }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: worded(DE, "Remove {{key}}", { key: "device.hostname" }),
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: worded(DE, "Add {{key}}", { key: "target.user.labels.0" }),
      }),
    ).toBeVisible();
    expect(document.body).toHaveTextContent(
      worded(
        DE,
        "Showing {{shown}} of {{total}} matching attributes. Keep typing to narrow.",
        { shown: "50", total: "120" },
      ),
    );
    expectNoEnglish(document.body, [
      "matching attributes",
      "Keep typing",
      "Shown on rows",
    ]);
  });
});

describe("an event's attributes in German", () => {
  test("the show-on-rows buttons name their attribute in a German sentence", () => {
    const event: SecurityEvent = Object.assign(new SecurityEvent(), {
      message: "Mass_Password_Reset_Modification",
      attributes: {
        "target.user.firstName": "jdoe",
        "device.hostname": "web-01",
      },
    });

    render(
      <MemoryRouter>
        <SecurityEventDetailPanel
          securityEvent={event}
          onClose={(): void => {}}
          attributeColumnKeys={["target.user.firstName"]}
          onToggleAttributeColumn={(): void => {}}
        />
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("tab", {
        name: new RegExp(`^${worded(DE, "Attributes")}`),
      }),
    );

    expect(
      screen.getByRole("button", {
        name: worded(DE, "Stop showing {{key}} on event rows", {
          key: "target.user.firstName",
        }),
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", {
        name: worded(DE, "Show {{key}} on event rows", {
          key: "device.hostname",
        }),
      }),
    ).toHaveAttribute("aria-pressed", "false");
  });
});

describe("the setup guide in German and Arabic", () => {
  function ingestionKey(): TelemetryIngestionKey {
    const key: TelemetryIngestionKey = new TelemetryIngestionKey();
    key.id = new ObjectID("key-1");
    key.name = "Production Key";
    key.secretKey = new ObjectID("secret-production");
    return key;
  }

  beforeEach((): void => {
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID("project-1"));
    jest.spyOn(ModelAPI, "getList").mockResolvedValue({
      data: [ingestionKey()],
      count: 1,
      skip: 0,
      limit: 50,
    } as never);
    jest.spyOn(AnalyticsModelAPI, "count").mockResolvedValue(7 as never);
  });

  test("German: the steps and the flowing events, counted in German", async () => {
    render(
      <MemoryRouter>
        <SecurityEventsSetupGuide />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(
        worded(
          DE,
          "Security events are flowing! {{count}} new events since you opened this guide.",
          { count: "7" },
        ),
      ),
    ).toBeInTheDocument();
    expect(document.body).toHaveTextContent(worded(DE, "Send Your Events"));
    expect(document.body).toHaveTextContent(worded(DE, "Verify It Is Working"));
    expect(document.body).toHaveTextContent(
      worded(DE, "Put The Events To Work"),
    );
    expect(document.body).toHaveTextContent(worded(DE, "View Security Events"));
    expectNoEnglish(document.body, [
      "Send Your Events",
      "Verify It Is Working",
      "Put The Events To Work",
      "Security events are flowing",
      "new events since you opened this guide",
    ]);
  });

  test("Arabic: the flowing events sentence", async () => {
    await i18next.changeLanguage("ar");
    render(
      <MemoryRouter>
        <SecurityEventsSetupGuide />
      </MemoryRouter>,
    );

    const pieceOfSentence: string = pieces(
      AR,
      "Security events are flowing! {{count}} new events since you opened this guide.",
    )[0] as string;

    expect(
      await screen.findByText(
        (_content: string, element: Element | null): boolean => {
          return (
            element?.tagName !== "BODY" &&
            Array.from(element?.children || []).length === 0 &&
            plain(element?.textContent).includes(pieceOfSentence)
          );
        },
      ),
    ).toBeInTheDocument();
    expectNoEnglish(document.body, [
      "Send Your Events",
      "Security events are flowing",
    ]);
  });
});

/*
 * READ THE WAY IT IS WRITTEN, ON AN ARABIC PAGE TOO (the UI review of #6658,
 * part 2).
 *
 * Laid out right to left, a time alone in a cell put "UTC" first, a requested
 * window read "UTC → ..." with its arrow pointing back to the start, the
 * server's English check text put its full stop first, and the availability
 * counts' labels sat centred. German read "Ausführen" (the Run button's verb)
 * over the column that says what kind of run each row is.
 */

const LTR_TIME: string = "time[dir='ltr']";

function isolatedTimes(text: string): Array<string> {
  return (
    text.match(
      new RegExp(
        `${FIRST_STRONG_ISOLATE}[^${POP_DIRECTIONAL_ISOLATE}]*UTC${POP_DIRECTIONAL_ISOLATE}`,
        "g",
      ),
    ) || []
  );
}

// The element that holds an English line on a right-to-left page.
function readAsWrittenHolder(container: HTMLElement, text: string): Element {
  const holder: Element | undefined = Array.from(
    container.querySelectorAll("bdi"),
  ).find((element: Element): boolean => {
    return element.textContent === text;
  });

  expect({ text, isolated: Boolean(holder) }).toEqual({
    text,
    isolated: true,
  });

  return holder as Element;
}

describe("a poll's run details read as written on an Arabic page", () => {
  function renderRunDetails(
    run: SecurityEventConnectionRun,
    locale: Record<string, string>,
  ): HTMLElement {
    render(
      <MemoryRouter>
        <SecurityEventConnectionRunDetails run={run} />
      </MemoryRouter>,
    );

    return screen.getByRole("region", { name: worded(locale, "Run details") });
  }

  function requestedWindow(
    locale: Record<string, string>,
    details: HTMLElement,
  ): HTMLElement {
    const term: HTMLElement = within(details).getByText(
      worded(locale, "Requested window (UTC)"),
    );

    return term.nextElementSibling as HTMLElement;
  }

  test("Arabic: the window's times read left to right, the arrow pointing from the start on the right", async () => {
    await i18next.changeLanguage("ar");
    const range: HTMLElement = requestedWindow(
      AR,
      renderRunDetails(pollRun(), AR),
    );
    const times: Array<Element> = Array.from(range.querySelectorAll("time"));

    expect(times).toHaveLength(2);
    for (const time of times) {
      expect(time).toHaveAttribute("dir", "ltr");
      // A narrow column breaks the range at the arrow, never inside a time.
      expect(time.closest(".whitespace-nowrap")).not.toBeNull();
    }
    expect(range).toHaveTextContent("←");
    expect(range).not.toHaveTextContent("→");
  });

  test("German: the arrow points right, as the page reads", () => {
    const range: HTMLElement = requestedWindow(
      DE,
      renderRunDetails(pollRun(), DE),
    );

    expect(range.querySelectorAll(LTR_TIME)).toHaveLength(2);
    expect(range).toHaveTextContent("→");
    expect(range).not.toHaveTextContent("←");
  });

  test("Arabic: the server's English warnings and checks keep their full stop at the end", async () => {
    await i18next.changeLanguage("ar");
    const run: SecurityEventConnectionRun = pollRun();
    run.result = pollResult({
      warnings: ["The provider returned 3 duplicate records."],
      checks: [
        {
          key: "authentication",
          name: "Authenticate with AWS",
          status: "fail",
          durationMs: 12,
          message: "The access key was refused.",
          remediation: "Create a new access key.",
        },
      ],
    }) as unknown as JSONObject;

    const details: HTMLElement = renderRunDetails(run, AR);

    for (const text of [
      "The provider returned 3 duplicate records.",
      "Authenticate with AWS",
      "The access key was refused.",
      "Create a new access key.",
    ]) {
      expect(readAsWrittenHolder(details, text)).toHaveAttribute("dir", "ltr");
    }
  });

  test("German: a word in a count's place is quieter than the counts beside it", () => {
    const run: SecurityEventConnectionRun = pollRun();
    run.type = "preview";
    run.result = pollResult({ type: "preview" }) as unknown as JSONObject;

    const details: HTMLElement = renderRunDetails(run, DE);
    const word: HTMLElement = within(details).getByText(
      worded(DE, "Not checked"),
    );
    const count: HTMLElement = within(details).getByText(
      worded(DE, "Imported into OneUptime"),
    ).previousElementSibling as HTMLElement;

    expect(count).toHaveTextContent("3");
    expect(count).toHaveClass("text-xl");
    expect(word).not.toHaveClass("text-xl");
    expect(word).toHaveClass("text-sm", "leading-7");
  });
});

describe("the connection test report read as written on an Arabic page", () => {
  test("the summary and every check's English text read as written; the times left to right", async () => {
    await i18next.changeLanguage("ar");
    render(<ConnectorTestReportView report={testReport()} />);

    const report: HTMLElement = screen.getByRole("region", {
      name: worded(AR, "Connection test report"),
    });

    for (const text of [
      "Okta accepted the token, but no worker is running.",
      "Authenticate with Okta",
      "No log events were created in the last 7 days.",
      "No process is consuming the Worker queue.",
    ]) {
      expect(readAsWrittenHolder(report, text)).toHaveAttribute("dir", "ltr");
    }

    // The completed time in the header, and the sample's created and event times.
    expect(report.querySelectorAll(LTR_TIME)).toHaveLength(3);
  });

  test("an English report on an English page draws its text as it always did", async () => {
    await i18next.changeLanguage("en");
    render(<ConnectorTestReportView report={testReport()} />);

    expect(
      screen.getByText("Okta accepted the token, but no worker is running.")
        .tagName,
    ).toBe("P");
    expect(screen.getByText("Authenticate with Okta").tagName).toBe("SPAN");
  });

  /*
   * A th under a table that leaves its alignment at the default ("start")
   * is centred by the browser: each header cell names its own alignment.
   */
  test("every header cell of the availability counts is start-aligned itself", () => {
    render(<ConnectorTestReportView report={testReport()} />);

    const counts: HTMLElement = screen.getByRole("region", {
      name: worded(DE, "Availability counts"),
    });
    const headers: Array<Element> = Array.from(counts.querySelectorAll("th"));

    expect(headers.length).toBeGreaterThan(2);
    for (const header of headers) {
      expect(header).toHaveClass("text-start");
    }
    expect(counts.querySelector(".text-left")).toBeNull();
  });
});

describe("a connection's run history and import confirmation", () => {
  function bigRun(): SecurityEventConnectionRun {
    const run: SecurityEventConnectionRun = pollRun();
    run.result = pollResult({
      fetchedCount: 12345,
      ingestedCount: 12300,
    }) as unknown as JSONObject;
    return run;
  }

  function mockApis(runs: Array<SecurityEventConnectionRun>): void {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    jest.spyOn(ModelAPI, "getList").mockResolvedValue(history(runs));
    jest.spyOn(ModelAPI, "getItem").mockResolvedValue(googleConnection());
    jest
      .spyOn(ModelAPI, "getCommonHeaders")
      .mockReturnValue({ "project-id": PROJECT_ID });
    jest
      .spyOn(API, "post")
      .mockResolvedValue(new HTTPResponse(200, { runId: RUN_ID }, {}));
    jest.spyOn(RouteUtil, "populateRouteParams").mockImplementation(() => {
      return new Route(`/dashboard/${PROJECT_ID}/security-events`);
    });
  }

  function renderDiagnostics(): void {
    render(
      <MemoryRouter>
        <SecurityEventConnectionDiagnostics
          connection={googleConnection()}
          canRun={true}
          onClose={(): void => {}}
          onUpdated={(): void => {}}
        />
      </MemoryRouter>,
    );
  }

  test("German: the first column is the run's type, not the Run button's verb, and the counts are grouped in German", async () => {
    setDateDisplayLanguage("de");
    try {
      mockApis([bigRun()]);
      renderDiagnostics();

      const viewRun: HTMLElement = await screen.findByRole("button", {
        name: worded(DE, "View run"),
      });
      const table: HTMLElement = viewRun.closest("table") as HTMLElement;
      const firstHeader: HTMLElement = within(table).getAllByRole(
        "columnheader",
      )[0] as HTMLElement;

      expect(firstHeader).toHaveTextContent(worded(DE, "Type"));
      expect(firstHeader).not.toHaveTextContent(worded(DE, "Run"));
      expect(table).toHaveTextContent("12.345 / 12.300");
    } finally {
      setDateDisplayLanguage(null);
    }
  });

  test("Arabic: the import confirmation sets each time apart, so it reads as written in the sentence", async () => {
    await i18next.changeLanguage("ar");
    mockApis([]);
    renderDiagnostics();

    // The run history has loaded: nothing has run yet.
    await screen.findByText(
      worded(
        AR,
        "No runs recorded yet. Older polls may not have diagnostic history.",
      ),
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: worded(AR, "Import this time range"),
      }),
    );

    const confirmation: HTMLElement = screen.getByRole("group", {
      name: worded(AR, "Confirm historical import"),
    });

    expect(isolatedTimes(confirmation.textContent || "")).toHaveLength(2);
    expectSentence(
      confirmation,
      AR,
      "Import {{what}} from {{start}} to {{end}} into OneUptime? Imported events become available to security rules and monitors. Already imported {{records}} are skipped.",
    );
  });
});

describe("the attribute column picker on a right-to-left page", () => {
  test("its panel is held by the page's start and end, never by left and right", async () => {
    await i18next.changeLanguage("ar");
    render(
      <SecurityEventAttributeColumnPicker
        attributeKeys={["target.user.firstName"]}
        selectedKeys={[]}
        onChange={(): void => {}}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(worded(AR, "Columns")) }),
    );

    const panel: HTMLElement = screen
      .getByRole("textbox", { name: worded(AR, "Search attributes") })
      .closest(".absolute") as HTMLElement;

    expect(panel).toHaveClass("start-0", "end-0", "md:start-auto");
    expect(panel.className).not.toMatch(/\b(md:)?(left|right)-/);
  });
});

describe("the setup guide's ingest endpoint in the reader's words", () => {
  function ingestionKey(): TelemetryIngestionKey {
    const key: TelemetryIngestionKey = new TelemetryIngestionKey();
    key.id = new ObjectID("key-1");
    key.name = "Production Key";
    key.secretKey = new ObjectID("secret-production");
    return key;
  }

  beforeEach((): void => {
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID("project-1"));
    jest.spyOn(ModelAPI, "getList").mockResolvedValue({
      data: [ingestionKey()],
      count: 1,
      skip: 0,
      limit: 50,
    } as never);
    jest.spyOn(AnalyticsModelAPI, "count").mockResolvedValue(7 as never);
  });

  test.each([
    ["de", DE],
    ["ar", AR],
  ])(
    "%s: the endpoint's label is worded",
    async (language: string, locale: Record<string, string>) => {
      await i18next.changeLanguage(language);
      render(
        <MemoryRouter>
          <SecurityEventsSetupGuide />
        </MemoryRouter>,
      );

      expect(
        await screen.findByText(
          worded(locale, "Security Events Ingest Endpoint"),
        ),
      ).toBeInTheDocument();
      expectNoEnglish(document.body, ["Security Events Ingest Endpoint"]);
    },
  );

  /*
   * The label is drawn in capitals, spaced out, in a 174px column at phone
   * width: a word longer than "SICHERHEITSEREIGNISSE" was cut at whatever
   * letter filled the line. A longer compound carries a soft hyphen where
   * it may break (Dutch "BEVEILIGINGS-GEBEURTENISSEN").
   */
  test("no locale words the label with a word too long for a phone's column", () => {
    const SOFT_HYPHEN: string = String.fromCharCode(0xad);
    const longest: Array<{ locale: string; word: string }> = [];

    for (const file of fs.readdirSync(LOCALES_DIR).filter((name: string) => {
      return name.endsWith(".json");
    })) {
      const locale: string = file.replace(/\.json$/, "");

      if (["ja", "zh-CN", "zh-TW"].includes(locale)) {
        // Written without spaces: the browser breaks between any characters.
        continue;
      }

      const label: string | undefined =
        readLocale(locale)["Security Events Ingest Endpoint"];

      expect({ locale, worded: typeof label }).toEqual({
        locale,
        worded: "string",
      });

      for (const word of (label as string).split(
        new RegExp(`[\\s\\-${SOFT_HYPHEN}]+`),
      )) {
        if (word.length > "Sicherheitsereignisse".length) {
          longest.push({ locale, word });
        }
      }
    }

    expect(longest).toEqual([]);
  });
});
