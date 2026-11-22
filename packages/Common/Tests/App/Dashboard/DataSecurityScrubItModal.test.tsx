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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import DataSecurityApi, {
  DataSecurityApiError,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import ScrubItModal, {
  ALREADY_SCRUBBED,
  SCRUB_IT_METRIC_DESCRIPTION,
  SCRUB_IT_MODAL_TEST_ID,
  SCRUB_IT_SCOPE_SENTENCES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/ScrubItModal";
import { getDashboardWidgetRoute } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardWidgetRoute";
import {
  FIELD_READER_CONSEQUENCES,
  FIELD_READER_UNCHECKED,
  FIELD_READERS_HEADING,
  MAX_FIELD_READERS_SHOWN,
  SECURITY_EVENTS_LOSSES,
  SECURITY_EVENTS_UNCHECKED,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/FieldReaders/TelemetryFieldReadersList";
import {
  LOG_SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY,
  SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/ScrubRuleForm";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import {
  DataSecurityScrubImpact,
  DataSecurityScrubResult,
  DataSecurityScrubRulePlan,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import ObjectID from "../../../Types/ObjectID";
import {
  getEmptyTelemetryFieldReadersByKind,
  SecurityEventsFieldNeed,
  SecurityEventsTelemetrySource,
  TelemetryFieldPart,
  TelemetryFieldReader,
  TelemetryFieldReaderKind,
  TelemetryFieldReaderList,
  TelemetryFieldReaders,
  TelemetryFieldReadersOfKind,
  TelemetryFieldUse,
} from "../../../Types/Telemetry/TelemetryFieldReaders";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { PROJECT_ID, goTo, routeFor } from "./SideMenuHarness";
import type { Mock, SpyInstance } from "jest-mock";

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
 * SCRUB IT SAYS WHAT ITS RULE DOES, AND WHAT IT BREAKS, BEFORE IT IS MADE
 * (Components/DataSecurity/ScrubItModal, #10433).
 *
 * Scrub It's dialog said the rule "masks this kind of data at this place":
 * the rule redacted it, in every service of the project, and nothing said
 * what read it. Every Scrub It now opens this dialog, which asks the server
 * what the rule would be (scrubImpact) and says whose records it changes -
 * the finding's service, the others as they are - what it does there, that
 * what is stored stays, and what reads the values it would hide: monitors,
 * dashboards, saved views, recording rules, SLOs and Security Events. It
 * never blocks the rule: it says, and the person decides.
 */

const FINDING_ID: string = "5a5a5a5a-0000-4000-8000-0000000000a1";
const SERVICE_ID: string = "6b6b6b6b-0000-4000-8000-0000000000b2";
const MONITOR_ID: string = "7c7c7c7c-0000-4000-8000-0000000000c3";
const DASHBOARD_ID: string = "8d8d8d8d-0000-4000-8000-0000000000d4";
const VIEW_ID: string = "9e9e9e9e-0000-4000-8000-0000000000e5";
const RECORDING_RULE_ID: string = "afafafaf-0000-4000-8000-0000000000f6";

const LOG_PLAN: DataSecurityScrubRulePlan = {
  signal: "log",
  name: "Data Security: Email address in log attributes of checkout",
  scrubAction: "redact",
  patternType: "email",
  fieldsToScrub: "attributes",
  dataTypeName: "Email address",
  serviceId: SERVICE_ID,
  serviceName: "checkout",
};

const RESULT: DataSecurityScrubResult = {
  signal: "log",
  scrubRuleId: "b0b0b0b0-0000-4000-8000-0000000000b0",
  scrubRuleName: LOG_PLAN.name,
};

// Nothing reads it, every kind checked.
function nothingReads(): TelemetryFieldReaders {
  return {
    kinds: getEmptyTelemetryFieldReadersByKind(true),
    securityEvents: { isChecked: true, sources: [], loses: [] },
  };
}

function readersOf(
  kinds: Partial<
    Record<TelemetryFieldReaderKind, Partial<TelemetryFieldReadersOfKind>>
  >,
  securityEvents?: Partial<TelemetryFieldReaders["securityEvents"]>,
): TelemetryFieldReaders {
  const readers: TelemetryFieldReaders = nothingReads();

  for (const kind of Object.keys(kinds) as Array<TelemetryFieldReaderKind>) {
    readers.kinds[kind] = { ...readers.kinds[kind], ...kinds[kind] };
  }

  readers.securityEvents = { ...readers.securityEvents, ...securityEvents };

  return readers;
}

function impactOf(
  plan: DataSecurityScrubRulePlan,
  readers: TelemetryFieldReaders | undefined = nothingReads(),
): DataSecurityScrubImpact {
  return { isAvailable: true, rule: plan, readers };
}

let impactSpy: SpyInstance<typeof DataSecurityApi.getScrubImpact>;
let scrubSpy: SpyInstance<typeof DataSecurityApi.scrubFinding>;
let onScrubbed: Mock<(result: DataSecurityScrubResult) => void>;
let onClose: Mock<() => void>;

function renderModal(): void {
  render(
    <MemoryRouter>
      <ScrubItModal
        findingId={new ObjectID(FINDING_ID)}
        onClose={onClose}
        onScrubbed={onScrubbed}
      />
    </MemoryRouter>,
  );
}

function textOf(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

function submitButton(): HTMLElement {
  return within(screen.getByRole("dialog")).getByRole("button", {
    name: "Scrub It",
  });
}

function hrefOf(element: HTMLElement): string {
  return element.closest("a")?.getAttribute("href") || "";
}

function viewRoute(page: PageMap, id: string): string {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: new ObjectID(id),
  }).toString();
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/data-security/issues/x`);
  onScrubbed = jest.fn<(result: DataSecurityScrubResult) => void>();
  onClose = jest.fn<() => void>();
  impactSpy = jest
    .spyOn(DataSecurityApi, "getScrubImpact")
    .mockResolvedValue(impactOf(LOG_PLAN));
  scrubSpy = jest
    .spyOn(DataSecurityApi, "scrubFinding")
    .mockResolvedValue(RESULT);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("what the rule does, before it is made", () => {
  test("whose logs it changes - the finding's service, the others as they are - what it does, where, and that the stored stays", async () => {
    renderModal();

    expect(
      textOf(await screen.findByTestId("data-security-scrub-it-scope")),
    ).toBe(
      "OneUptime adds a scrub rule to the logs checkout sends, before they are stored. Other services' logs stay as they are.",
    );
    expect(impactSpy).toHaveBeenCalledWith(new ObjectID(FINDING_ID));
    // The action as the rule form words it, what it leaves on a line below.
    const action: HTMLElement = screen.getByTestId(
      "data-security-scrub-it-action-words",
    );

    expect(textOf(action)).toMatch(/^Scrub Action: Redact/);
    expect(
      within(action).getByText("Replaces each match with [REDACTED]."),
    ).toBeInTheDocument();
    expect(
      textOf(screen.getByTestId("data-security-scrub-it-fields-words")),
    ).toBe("Fields to Scrub: Attributes Only");
    expect(textOf(screen.getByTestId("data-security-scrub-it-stored"))).toBe(
      "What is stored already is not deleted. It stays until its retention ends.",
    );
    // Nothing reads it: nothing more is said.
    expect(
      screen.queryByTestId("telemetry-field-readers"),
    ).not.toBeInTheDocument();
    // Asked, not made.
    expect(submitButton()).toBeEnabled();
    expect(scrubSpy).not.toHaveBeenCalled();
  });

  test("a span's rule says the spans of its service", async () => {
    impactSpy.mockResolvedValue(
      impactOf({
        ...LOG_PLAN,
        signal: "trace",
        name: "Data Security: Email address in span attributes of checkout",
        fieldsToScrub: "attributes",
      }),
    );
    renderModal();

    expect(
      textOf(await screen.findByTestId("data-security-scrub-it-scope")),
    ).toBe(
      "OneUptime adds a scrub rule to the spans checkout sends, before they are stored. Other services' spans stay as they are.",
    );
    expect(
      textOf(screen.getByTestId("data-security-scrub-it-fields-words")),
    ).toBe("Fields to Scrub: Attributes Only");
  });

  test.each([
    ["log", SCRUB_IT_SCOPE_SENTENCES.log.everyService],
    ["trace", SCRUB_IT_SCOPE_SENTENCES.trace.everyService],
  ] as Array<["log" | "trace", string]>)(
    "a %s rule for no one service - a session replay's - says it scrubs every service and app",
    async (signal: "log" | "trace", sentence: string) => {
      const plan: DataSecurityScrubRulePlan = {
        ...LOG_PLAN,
        signal,
        fieldsToScrub: signal === "log" ? "body" : "all",
      };

      delete plan.serviceId;
      delete plan.serviceName;
      impactSpy.mockResolvedValue(impactOf(plan));
      renderModal();

      expect(
        textOf(await screen.findByTestId("data-security-scrub-it-scope")),
      ).toBe(sentence);
      expect(sentence).toContain("every service and app in this project");
    },
  );

  test.each([
    ["log", LOG_SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY],
    ["trace", SENSITIVE_KEYS_SCRUB_RULE_DEFAULTS_SUMMARY],
  ] as Array<["log" | "trace", string]>)(
    "a %s sensitive-keys rule says what it hides, and no fields it does not ask",
    async (signal: "log" | "trace", summary: string) => {
      impactSpy.mockResolvedValue(
        impactOf({
          ...LOG_PLAN,
          signal,
          patternType: "sensitiveKeys",
          fieldsToScrub: signal === "log" ? "both" : "all",
        }),
      );
      renderModal();

      const action: HTMLElement = await screen.findByTestId(
        "data-security-scrub-it-action-words",
      );

      expect(textOf(action)).toMatch(/^Scrub Action: Redact/);
      expect(within(action).getByText(summary)).toBeInTheDocument();
      expect(
        screen.queryByTestId("data-security-scrub-it-fields"),
      ).not.toBeInTheDocument();
    },
  );

  test("a metric's attribute keeps its one sentence: its service's pipeline rule, which redacts", async () => {
    impactSpy.mockResolvedValue(
      impactOf(
        {
          ...LOG_PLAN,
          signal: "metric",
          name: "Data Security: Email address in attributes.user.email",
          patternType: "",
          fieldsToScrub: "",
        },
        undefined,
      ),
    );
    renderModal();

    expect(
      textOf(await screen.findByTestId("data-security-scrub-it-scope")),
    ).toBe(SCRUB_IT_METRIC_DESCRIPTION);
    expect(
      screen.queryByTestId("data-security-scrub-it-action"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("data-security-scrub-it-stored"),
    ).not.toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });
});

describe("what reads the values it would hide", () => {
  const monitor: TelemetryFieldReader = {
    id: MONITOR_ID,
    name: "Sign-ups by email",
    reads: [
      {
        part: TelemetryFieldPart.Attributes,
        key: "user.email",
        use: TelemetryFieldUse.Filter,
      },
    ],
  };

  test("kind by kind, what the rule does to each, each record opening where it is", async () => {
    impactSpy.mockResolvedValue(
      impactOf(
        LOG_PLAN,
        readersOf({
          [TelemetryFieldReaderKind.Monitor]: {
            readers: [monitor],
            hiddenCount: 1,
          },
          [TelemetryFieldReaderKind.Dashboard]: {
            readers: [
              {
                id: DASHBOARD_ID,
                name: "Support",
                widgets: [
                  {
                    id: "signups",
                    title: "Sign-ups by email",
                    type: "LogChart",
                  },
                ],
                reads: [
                  {
                    part: TelemetryFieldPart.Attributes,
                    key: "user.email",
                    use: TelemetryFieldUse.GroupBy,
                  },
                ],
              },
            ],
          },
          [TelemetryFieldReaderKind.SavedView]: {
            readers: [
              {
                id: VIEW_ID,
                name: "Emails in bodies",
                list: TelemetryFieldReaderList.Logs,
                reads: [
                  {
                    part: TelemetryFieldPart.Body,
                    use: TelemetryFieldUse.Search,
                  },
                ],
              },
            ],
          },
          [TelemetryFieldReaderKind.RecordingRule]: {
            readers: [
              {
                id: RECORDING_RULE_ID,
                name: "logins_by_email",
                list: TelemetryFieldReaderList.Logs,
                reads: [
                  {
                    part: TelemetryFieldPart.Attributes,
                    key: "user.email",
                    use: TelemetryFieldUse.Value,
                  },
                ],
              },
            ],
          },
          [TelemetryFieldReaderKind.ServiceLevelObjective]: { hiddenCount: 2 },
        }),
      ),
    );
    renderModal();

    expect(
      textOf(await screen.findByTestId("telemetry-field-readers-heading")),
    ).toBe(FIELD_READERS_HEADING);

    // Monitors: what happens to them, the one that may be opened, the rest counted.
    const monitors: HTMLElement = screen.getByTestId(
      "telemetry-field-readers-Monitor",
    );

    expect(textOf(monitors)).toContain("Monitors");
    expect(textOf(monitors)).toContain(
      FIELD_READER_CONSEQUENCES[TelemetryFieldReaderKind.Monitor],
    );
    expect(hrefOf(within(monitors).getByText("Sign-ups by email"))).toBe(
      viewRoute(PageMap.MONITOR_VIEW, MONITOR_ID),
    );
    expect(
      textOf(within(monitors).getByTestId("telemetry-field-reader-reads")),
    ).toBe("Filters on user.email");
    expect(
      textOf(
        within(monitors).getByTestId("telemetry-field-readers-Monitor-hidden"),
      ),
    ).toBe("and 1 more you can't see");

    // A dashboard, and its widget that reads it, opening the board there.
    const dashboards: HTMLElement = screen.getByTestId(
      "telemetry-field-readers-Dashboard",
    );

    expect(hrefOf(within(dashboards).getByText("Support"))).toBe(
      viewRoute(PageMap.DASHBOARD_VIEW, DASHBOARD_ID),
    );
    expect(
      hrefOf(
        within(
          within(dashboards).getByTestId("telemetry-field-reader-widgets"),
        ).getByText("Sign-ups by email"),
      ),
    ).toBe(
      getDashboardWidgetRoute({
        dashboardId: DASHBOARD_ID,
        widgetId: "signups",
      }).toString(),
    );
    expect(
      textOf(within(dashboards).getByTestId("telemetry-field-reader-reads")),
    ).toBe("Groups by user.email");

    // A saved view opens its explorer at it, and says which list it is in.
    const views: HTMLElement = screen.getByTestId(
      "telemetry-field-readers-SavedView",
    );

    expect(hrefOf(within(views).getByText("Emails in bodies"))).toBe(
      `${routeFor(PageMap.LOGS)}?savedView=${VIEW_ID}`,
    );
    expect(textOf(views)).toContain("Logs");
    expect(
      textOf(within(views).getByTestId("telemetry-field-reader-reads")),
    ).toBe("Searches the log body");

    // A recording rule opens the rules it is in.
    const recordingRules: HTMLElement = screen.getByTestId(
      "telemetry-field-readers-RecordingRule",
    );

    expect(hrefOf(within(recordingRules).getByText("logins_by_email"))).toBe(
      routeFor(PageMap.LOGS_SETTINGS_RECORDING_RULES),
    );
    expect(
      textOf(
        within(recordingRules).getByTestId("telemetry-field-reader-reads"),
      ),
    ).toBe("Aggregates user.email");

    // SLOs the reader may not open: counted, never named.
    expect(
      textOf(
        screen.getByTestId("telemetry-field-readers-ServiceLevelObjective"),
      ),
    ).toContain("2 SLOs you can't see");

    // It says; it never stops the rule.
    expect(submitButton()).toBeEnabled();
  });

  test(`the first ${MAX_FIELD_READERS_SHOWN} of a kind are named, the rest counted`, async () => {
    const many: Array<TelemetryFieldReader> = [];

    for (let index: number = 0; index < MAX_FIELD_READERS_SHOWN + 2; index++) {
      many.push({
        ...monitor,
        id: `7c7c7c7c-0000-4000-8000-00000000000${index}`,
        name: `Monitor ${index + 1}`,
      });
    }

    impactSpy.mockResolvedValue(
      impactOf(
        LOG_PLAN,
        readersOf({
          [TelemetryFieldReaderKind.Monitor]: { readers: many },
        }),
      ),
    );
    renderModal();

    const monitors: HTMLElement = await screen.findByTestId(
      "telemetry-field-readers-Monitor",
    );

    expect(
      within(monitors).getAllByTestId("telemetry-field-readers-Monitor-reader"),
    ).toHaveLength(MAX_FIELD_READERS_SHOWN);
    expect(textOf(monitors)).toContain("and 2 more");
  });

  test("what Security Events would lose: the address to block, and who signed in", async () => {
    impactSpy.mockResolvedValue(
      impactOf(
        { ...LOG_PLAN, patternType: "ipAddress" },
        readersOf(
          {},
          {
            sources: [SecurityEventsTelemetrySource.Logs],
            loses: [
              SecurityEventsFieldNeed.ClientAddresses,
              SecurityEventsFieldNeed.UserNames,
            ],
          },
        ),
      ),
    );
    renderModal();

    const securityEvents: HTMLElement = await screen.findByTestId(
      "telemetry-field-readers-security-events",
    );

    expect(textOf(securityEvents)).toContain("Security Events");
    expect(
      textOf(
        screen.getByTestId(
          "telemetry-field-readers-security-events-clientAddresses",
        ),
      ),
    ).toBe(SECURITY_EVENTS_LOSSES[SecurityEventsFieldNeed.ClientAddresses]);
    expect(
      textOf(
        screen.getByTestId("telemetry-field-readers-security-events-userNames"),
      ),
    ).toBe(SECURITY_EVENTS_LOSSES[SecurityEventsFieldNeed.UserNames]);
    // No monitor or dashboard reads it: no heading for them.
    expect(
      screen.queryByTestId("telemetry-field-readers-heading"),
    ).not.toBeInTheDocument();
  });

  test("a kind it could not check says so, never that nothing reads it", async () => {
    impactSpy.mockResolvedValue(
      impactOf(
        LOG_PLAN,
        readersOf(
          {
            [TelemetryFieldReaderKind.Monitor]: { isChecked: false },
            [TelemetryFieldReaderKind.ServiceLevelObjective]: {
              isChecked: false,
            },
          },
          { isChecked: false },
        ),
      ),
    );
    renderModal();

    expect(
      textOf(
        await screen.findByTestId("telemetry-field-readers-Monitor-unchecked"),
      ),
    ).toBe(FIELD_READER_UNCHECKED[TelemetryFieldReaderKind.Monitor]);
    expect(
      textOf(
        screen.getByTestId(
          "telemetry-field-readers-ServiceLevelObjective-unchecked",
        ),
      ),
    ).toBe(
      FIELD_READER_UNCHECKED[TelemetryFieldReaderKind.ServiceLevelObjective],
    );
    expect(
      textOf(
        screen.getByTestId("telemetry-field-readers-security-events-unchecked"),
      ),
    ).toBe(SECURITY_EVENTS_UNCHECKED);
    expect(
      screen.queryByTestId("telemetry-field-readers-Dashboard-unchecked"),
    ).not.toBeInTheDocument();
  });
});

describe("when no new rule is made", () => {
  test("the rule that already hides the data is named, opening its list", async () => {
    impactSpy.mockResolvedValue({
      isAvailable: true,
      existingRule: {
        id: "c1c1c1c1-0000-4000-8000-0000000000c1",
        name: "Scrub emails",
        signal: "log",
      },
    });
    renderModal();

    const existing: HTMLElement = await screen.findByTestId(
      "data-security-scrub-it-existing",
    );

    expect(textOf(existing)).toBe(
      ALREADY_SCRUBBED.replace("{{name}}", "Scrub emails"),
    );
    expect(hrefOf(within(existing).getByText("Scrub emails"))).toBe(
      routeFor(PageMap.LOGS_SETTINGS_SCRUB_RULES),
    );
    expect(
      screen.queryByTestId("data-security-scrub-it-scope"),
    ).not.toBeInTheDocument();
  });

  test("no rule can be made: it says why, and Scrub It stays off", async () => {
    impactSpy.mockResolvedValue({
      isAvailable: false,
      unavailableReason:
        "The service this telemetry was sent under no longer exists, so no new telemetry of it is left to scrub.",
    });
    renderModal();

    expect(
      await screen.findByText(
        "The service this telemetry was sent under no longer exists, so no new telemetry of it is left to scrub.",
      ),
    ).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
    fireEvent.click(submitButton());
    expect(scrubSpy).not.toHaveBeenCalled();
  });

  test("while it asks, Scrub It cannot be pressed blind", async () => {
    let answer: (impact: DataSecurityScrubImpact) => void = () => {};

    impactSpy.mockImplementation(() => {
      return new Promise<DataSecurityScrubImpact>(
        (resolve: (impact: DataSecurityScrubImpact) => void) => {
          answer = resolve;
        },
      );
    });
    renderModal();

    expect(submitButton()).toBeDisabled();
    answer(impactOf(LOG_PLAN));
    await waitFor(() => {
      expect(submitButton()).toBeEnabled();
    });
  });

  test("a lookup that fails says so, and asks again when told to", async () => {
    impactSpy.mockRejectedValueOnce(
      new DataSecurityApiError("This finding no longer exists.", 404),
    );
    renderModal();

    expect(
      await screen.findByText(/This finding no longer exists\./),
    ).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /refresh|try again/i }));

    expect(
      await screen.findByTestId("data-security-scrub-it-scope"),
    ).toBeInTheDocument();
    expect(impactSpy).toHaveBeenCalledTimes(2);
  });
});

describe("pressing Scrub It", () => {
  test("makes the rule once and hands back what was made", async () => {
    renderModal();
    await screen.findByTestId("data-security-scrub-it-scope");

    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(onScrubbed).toHaveBeenCalledWith(RESULT);
    });
    expect(scrubSpy).toHaveBeenCalledTimes(1);
    expect(scrubSpy).toHaveBeenCalledWith(new ObjectID(FINDING_ID));
    expect(onClose).not.toHaveBeenCalled();
  });

  test("a refusal is said in the dialog, which stays open", async () => {
    scrubSpy.mockRejectedValue(
      new DataSecurityApiError(
        "You do not have permission to create log scrub rules.",
        403,
      ),
    );
    renderModal();
    await screen.findByTestId("data-security-scrub-it-scope");

    fireEvent.click(submitButton());

    expect(
      await screen.findByText(
        "You do not have permission to create log scrub rules.",
      ),
    ).toBeInTheDocument();
    expect(onScrubbed).not.toHaveBeenCalled();
    expect(screen.getByTestId(SCRUB_IT_MODAL_TEST_ID)).toBeInTheDocument();
  });

  test("Cancel closes it, and makes nothing", async () => {
    renderModal();
    await screen.findByTestId("data-security-scrub-it-scope");

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(scrubSpy).not.toHaveBeenCalled();
  });
});
