import "@testing-library/jest-dom";
import {
  afterAll,
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
  within,
} from "@testing-library/react";
import React from "react";
import ConnectorTestReportView from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/ConnectorTestReportView";
import {
  connectorCheckGroup,
  connectorCountLabel,
  connectorDocsUrl,
  connectorHealthPillColor,
  connectorHealthTone,
  connectorHealthTooltip,
  connectionTimeTitle,
  formatConnectionLocalDate,
  CONNECTOR_HEALTH_NO_EVENTS_YET,
  CONNECTOR_HEALTH_SUCCEEDED,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionDiagnosticsUtil";
import { Green, LightGray, Red, Yellow } from "../../../Types/BrandColors";
import {
  SecurityConnectorCheck,
  SecurityConnectorTestReport,
} from "../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";

/*
 * The checklist is the product's answer to "connected, but nothing is
 * imported". These tests pin the three-way grouping (provider access /
 * what is available / OneUptime's own workers), the status vocabulary, the
 * remediation disclosure and the copy payload, because a support engineer
 * reads all four before touching a customer's deployment.
 */

const SECRET_VALUE: string = "sk-live-never-in-a-report";

function check(
  overrides: Partial<SecurityConnectorCheck> & {
    key: string;
    status: SecurityConnectorCheck["status"];
  },
): SecurityConnectorCheck {
  return {
    name: overrides.key,
    durationMs: 12,
    message: `${overrides.key} message`,
    ...overrides,
  };
}

function report(
  overrides: Partial<SecurityConnectorTestReport> = {},
): SecurityConnectorTestReport {
  return {
    provider: "okta",
    status: "fail",
    startedAt: "2026-09-10T12:00:00.000Z",
    completedAt: "2026-09-10T12:00:03.500Z",
    durationMs: 3500,
    summary:
      "Okta accepted the token, but no process is consuming the Worker queue.",
    checks: [
      check({
        key: "configuration",
        name: "Configuration",
        status: "pass",
        message: "The Okta System Log configuration is well formed.",
      }),
      check({
        key: "authentication",
        name: "Authenticate with Okta",
        status: "pass",
        durationMs: 1400,
        message: "The API token was accepted.",
      }),
      check({
        key: "read-permission",
        name: "Read the System Log",
        status: "warn",
        message: "Reading one record took 2.1 s.",
        remediation: "Check the org rate limits if polls time out.",
      }),
      check({
        key: "detections-available",
        name: "Records available to import",
        status: "warn",
        message: "No log events were created in the last 7 days.",
        remediation:
          "Polling will import new events as Okta creates them. Widen the filter if you expected events.",
      }),
      check({
        key: "worker-consumers",
        name: "Background workers",
        status: "fail",
        message:
          "No process is consuming the Worker queue, so scheduled polls never execute.",
        remediation:
          "Set DISABLE_QUEUE_WORKERS=false on the app or enable the worker deployment (Helm: worker.enabled: true).",
      }),
      check({
        key: "scheduler",
        name: "Poll scheduler",
        status: "pass",
        message: "The poll scheduler is registered.",
      }),
      check({
        key: "storage",
        name: "Security event storage",
        status: "pass",
        message: "The analytics database answered.",
      }),
      check({
        key: "connection-schedule",
        name: "Scheduled polling",
        status: "skip",
        message: "Skipped: the settings are not saved yet.",
      }),
    ],
    counts: {
      createdLast24h: 0,
      createdLast7d: 0,
      hasMoreLast7d: false,
    },
    samples: [
      {
        id: "evt-1",
        title: "user.session.start",
        severity: "INFO",
        createdTime: "2026-09-10T11:58:00.000Z",
        eventTime: "2026-09-10T11:57:59.000Z",
      },
    ],
    ...overrides,
  };
}

const originalClipboard: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(navigator, "clipboard");
const writeText: ReturnType<typeof jest.fn<(text: string) => Promise<void>>> =
  jest.fn<(text: string) => Promise<void>>();

describe("ConnectorTestReportView", () => {
  beforeEach((): void => {
    writeText.mockReset();
    writeText.mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach((): void => {
    cleanup();
    jest.restoreAllMocks();
  });

  afterAll((): void => {
    if (originalClipboard) {
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  test("groups checks into provider access, availability and platform sections in that order", (): void => {
    render(<ConnectorTestReportView report={report()} />);

    const region: HTMLElement = screen.getByRole("region", {
      name: "Connection test report",
    });
    const sections: Array<HTMLElement> = Array.from(
      region.querySelectorAll("section[data-check-group]"),
    ) as Array<HTMLElement>;

    expect(
      sections.map((section: HTMLElement): string | null => {
        return section.getAttribute("aria-label");
      }),
    ).toEqual([
      "Access to Okta System Log",
      "What is available to import",
      "OneUptime workers and scheduler",
    ]);

    const keysIn: (label: string) => Array<string | null> = (
      label: string,
    ): Array<string | null> => {
      return Array.from(
        screen
          .getByRole("region", { name: label })
          .querySelectorAll("li[data-check-key]"),
      ).map((item: Element): string | null => {
        return item.getAttribute("data-check-key");
      });
    };

    expect(keysIn("Access to Okta System Log")).toEqual([
      "configuration",
      "authentication",
      "read-permission",
    ]);
    expect(keysIn("What is available to import")).toEqual([
      "detections-available",
    ]);
    expect(keysIn("OneUptime workers and scheduler")).toEqual([
      "worker-consumers",
      "scheduler",
      "storage",
      "connection-schedule",
    ]);
  });

  test("omits a section that has no checks and titles the provider section by catalog name", (): void => {
    render(
      <ConnectorTestReportView
        report={report({
          provider: "microsoft-sentinel",
          status: "pass",
          checks: [
            check({ key: "authentication", status: "pass" }),
            check({ key: "worker-consumers", status: "pass" }),
          ],
          counts: undefined,
          samples: undefined,
        })}
      />,
    );

    expect(
      screen.getByRole("region", { name: "Access to Microsoft Sentinel" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("region", { name: "What is available to import" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Availability counts" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Sample records" }),
    ).not.toBeInTheDocument();
  });

  test("Google SecOps reports read as Google SecOps even though it is not in the catalog", (): void => {
    render(
      <ConnectorTestReportView
        report={report({ provider: "google-secops", status: "pass" })}
      />,
    );

    expect(
      screen.getByRole("region", { name: "Access to Google SecOps" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Google SecOps");
  });

  test("an explicit provider title wins over the report's provider", (): void => {
    render(
      <ConnectorTestReportView
        report={report()}
        providerTitle="Customer Okta tenant"
      />,
    );

    expect(
      screen.getByRole("region", { name: "Access to Customer Okta tenant" }),
    ).toBeVisible();
  });

  test.each([
    ["pass", "All checks passed"],
    ["warn", "Passed with warnings"],
    ["fail", "Some checks failed"],
  ] as Array<[SecurityConnectorTestReport["status"], string]>)(
    "a %s report has a banner that says so and carries the summary",
    (status: SecurityConnectorTestReport["status"], title: string): void => {
      render(<ConnectorTestReportView report={report({ status })} />);

      const banner: HTMLElement = screen.getByRole("status");
      expect(banner).toHaveAttribute("data-report-status", status);
      expect(banner).toHaveTextContent(title);
      expect(banner).toHaveTextContent(
        "Okta accepted the token, but no process is consuming the Worker queue.",
      );
      expect(banner).toHaveTextContent("3.5 s");
    },
  );

  test("each check shows its human status label, name, duration and message", (): void => {
    render(<ConnectorTestReportView report={report()} />);

    const rowFor: (key: string) => HTMLElement = (key: string): HTMLElement => {
      return document.querySelector(
        `li[data-check-key="${key}"]`,
      ) as HTMLElement;
    };

    expect(rowFor("authentication")).toHaveTextContent("Passed");
    expect(rowFor("authentication")).toHaveTextContent("1.4 s");
    expect(rowFor("authentication")).toHaveTextContent(
      "The API token was accepted.",
    );
    expect(rowFor("read-permission")).toHaveTextContent("Warning");
    expect(rowFor("worker-consumers")).toHaveTextContent("Failed");
    expect(rowFor("worker-consumers")).toHaveTextContent("12 ms");
    expect(rowFor("connection-schedule")).toHaveTextContent("Skipped");
    expect(rowFor("connection-schedule")).toHaveAttribute(
      "data-check-status",
      "skip",
    );
  });

  test("a failed check opens its remediation by default; a warning discloses it on demand", (): void => {
    render(<ConnectorTestReportView report={report()} />);

    const failedRow: HTMLElement = document.querySelector(
      'li[data-check-key="worker-consumers"]',
    ) as HTMLElement;
    const failedToggle: HTMLElement = within(failedRow).getByRole("button", {
      name: "What to do",
    });
    expect(failedToggle).toHaveAttribute("aria-expanded", "true");
    expect(failedRow).toHaveTextContent("Set DISABLE_QUEUE_WORKERS=false");

    const warnRow: HTMLElement = document.querySelector(
      'li[data-check-key="read-permission"]',
    ) as HTMLElement;
    const warnToggle: HTMLElement = within(warnRow).getByRole("button", {
      name: "What to do",
    });
    expect(warnToggle).toHaveAttribute("aria-expanded", "false");
    expect(warnRow).not.toHaveTextContent("Check the org rate limits");

    fireEvent.click(warnToggle);
    expect(warnToggle).toHaveAttribute("aria-expanded", "true");
    expect(warnRow).toHaveTextContent("Check the org rate limits");
    expect(
      document.getElementById(warnToggle.getAttribute("aria-controls")!),
    ).toHaveTextContent("Check the org rate limits");

    fireEvent.click(warnToggle);
    expect(warnRow).not.toHaveTextContent("Check the org rate limits");

    // A passing check has nothing to do, so it has no disclosure.
    const passRow: HTMLElement = document.querySelector(
      'li[data-check-key="authentication"]',
    ) as HTMLElement;
    expect(
      within(passRow).queryByRole("button", { name: "What to do" }),
    ).not.toBeInTheDocument();
  });

  test("renders counts with readable labels and samples with UTC times and a local-time title", (): void => {
    render(<ConnectorTestReportView report={report()} />);

    const counts: HTMLElement = screen.getByRole("region", {
      name: "Availability counts",
    });
    expect(counts).toHaveTextContent("Created in the last 24 hours");
    expect(counts).toHaveTextContent("Created in the last 7 days");
    expect(counts).toHaveTextContent("More than one page in the last 7 days");
    expect(within(counts).getAllByRole("row")).toHaveLength(4);
    expect(within(counts).getByText("No")).toBeVisible();

    const samples: HTMLElement = screen.getByRole("region", {
      name: "Sample records",
    });
    expect(samples).toHaveTextContent("user.session.start");
    expect(samples).toHaveTextContent("evt-1");
    expect(samples).toHaveTextContent("INFO");
    const created: HTMLElement = within(samples).getByText(
      "2026-09-10 11:58:00 UTC",
    );
    expect(created).toHaveAttribute(
      "title",
      connectionTimeTitle("2026-09-10T11:58:00.000Z"),
    );
    expect(created.getAttribute("title")).toMatch(/^Local time: /);
    expect(within(samples).getByText("2026-09-10 11:57:59 UTC")).toBeVisible();
  });

  test("Copy report copies the JSON report verbatim and never a credential", async (): Promise<void> => {
    const fixture: SecurityConnectorTestReport = report();
    render(<ConnectorTestReportView report={fixture} />);

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: "Copy report" }));
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied: string = writeText.mock.calls[0]?.[0] as string;
    expect(JSON.parse(copied)).toEqual(fixture);
    expect(copied).not.toContain(SECRET_VALUE);
    expect(copied).not.toMatch(/apiToken|clientSecret|secretAccessKey/);
    expect(screen.getByText("Copied!")).toBeVisible();
  });

  test("offers Run again only when a handler is supplied", (): void => {
    const onRunAgain: ReturnType<typeof jest.fn> = jest.fn();
    const view: ReturnType<typeof render> = render(
      <ConnectorTestReportView report={report()} />,
    );
    expect(
      screen.queryByRole("button", { name: "Run again" }),
    ).not.toBeInTheDocument();
    view.unmount();

    render(
      <ConnectorTestReportView
        report={report()}
        onRunAgain={onRunAgain as () => void}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    expect(onRunAgain).toHaveBeenCalledTimes(1);
  });

  test("renders check text literally rather than as markup", (): void => {
    render(
      <ConnectorTestReportView
        report={report({
          checks: [
            check({
              key: "authentication",
              status: "fail",
              message: "Okta rejected <script>alert(1)</script> the token.",
              remediation: "<b>Rotate</b> the token.",
            }),
          ],
        })}
      />,
    );

    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
    expect(
      screen.getByText(/Okta rejected <script>alert\(1\)<\/script> the token/),
    ).toBeVisible();
  });
});

describe("diagnostics util vocabulary", () => {
  test("groups platform and availability keys and leaves the rest to the provider", (): void => {
    for (const key of [
      "worker-consumers",
      "scheduler",
      "storage",
      "connection-schedule",
    ]) {
      expect(connectorCheckGroup(check({ key, status: "pass" }))).toBe(
        "platform",
      );
    }
    for (const key of [
      "detections-available",
      "incidents-available",
      "alerts-count",
    ]) {
      expect(connectorCheckGroup(check({ key, status: "pass" }))).toBe(
        "availability",
      );
    }
    for (const key of [
      "configuration",
      "authentication",
      "read-permission",
      "curated-detections-read",
      "provider-error",
    ]) {
      expect(connectorCheckGroup(check({ key, status: "pass" }))).toBe(
        "provider",
      );
    }
  });

  test("count labels are known for the tester keys and readable for new ones", (): void => {
    expect(connectorCountLabel("ruleDetectionsLast24h")).toBe(
      "Rule detections created in the last 24 hours",
    );
    expect(connectorCountLabel("incidentsCreatedLast7d")).toBe(
      "Incidents created last7d",
    );
    expect(connectorCountLabel("has-more")).toBe("Has more");
  });

  test("health tone, colour and tooltip agree on the no-events-yet state", (): void => {
    expect(connectorHealthTone(CONNECTOR_HEALTH_NO_EVENTS_YET)).toBe("neutral");
    expect(connectorHealthPillColor(CONNECTOR_HEALTH_NO_EVENTS_YET)).toBe(
      LightGray,
    );
    expect(connectorHealthTooltip(CONNECTOR_HEALTH_NO_EVENTS_YET)).toContain(
      "Test connection",
    );

    expect(connectorHealthTone(CONNECTOR_HEALTH_SUCCEEDED)).toBe("good");
    expect(connectorHealthPillColor(CONNECTOR_HEALTH_SUCCEEDED)).toBe(Green);
    expect(connectorHealthPillColor("Last poll failed")).toBe(Red);
    expect(connectorHealthPillColor("Poll overdue")).toBe(Yellow);
    expect(connectorHealthPillColor("No detections returned")).toBe(Green);
    expect(connectorHealthPillColor("Schedule paused")).toBe(LightGray);
  });

  test("local time titles are derived from the same instant and absent for blanks", (): void => {
    const local: string = formatConnectionLocalDate("2026-09-10T12:00:00.000Z");
    expect(local).not.toBe("");
    expect(connectionTimeTitle("2026-09-10T12:00:00.000Z")).toBe(
      `Local time: ${local}`,
    );
    expect(connectionTimeTitle(undefined)).toBeUndefined();
    expect(connectionTimeTitle("not a date")).toBeUndefined();
  });

  test("docs links join the catalog path onto the docs site without doubling /docs", (): void => {
    const url: string = connectorDocsUrl({
      docsPath: "/docs/integrations/okta",
    }).toString();
    expect(url).toMatch(/\/docs\/integrations\/okta$/);
    expect(url).not.toContain("/docs/docs");
  });
});
