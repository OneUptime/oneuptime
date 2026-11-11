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
