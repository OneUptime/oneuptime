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
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * InvestigationRunDetails is the one collapsed section under a completed AI
 * investigation: the queries it ran, the steps it took and what the run cost.
 * A responder opens it to check the report's working, and a citation chip in
 * the report opens it for them. These tests pin the disclosure and tab
 * contracts (ARIA wiring, keyboard, which panel shows when data arrives
 * late), what the header says while collapsed, and that collapsing never
 * throws away rows the viewer already loaded.
 *
 * The activity feed is the real ChatActivityFeed: the section's step count
 * and its "is there any activity?" decision come from the feed's own
 * countActivitySteps, so a mock would only restate that logic.
 */

const postMock: MockFunction = getJestMockFunction();
const getFriendlyMessageMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (...args: Array<unknown>) => {
        return getFriendlyMessageMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (...args: Array<unknown>) => {
        return getCommonHeadersMock(...args);
      },
    },
  };
});

// Evidence rows render through the chat widgets; their output is not under test.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/WidgetRenderer",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div", { "data-testid": "evidence-widget" });
      },
    };
  },
);

import InvestigationRunDetails, {
  ComponentProps as RunDetailsProps,
  INVESTIGATION_READ_ONLY_TEXT,
  InvestigationRunUsage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationReport/InvestigationRunDetails";
import { EvidenceFocusRequest } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationReport/InvestigationEvidenceList";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import { AIRunEventResultSummary } from "../../../Types/AI/AIChatTypes";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import { InvestigationEvidenceItem } from "../../../Types/AI/InvestigationEvidence";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { InvestigationEvidenceCheckedEntry } from "../../../Utils/AI/InvestigationReport";

interface StepEvent {
  eventType: AIRunEventType;
  toolName?: string | undefined;
  resultSummary?: AIRunEventResultSummary | undefined;
}

interface PostRequest {
  data: JSONObject;
}

const RUN_ID: string = "11111111-1111-4111-8111-111111111111";
const NEXT_RUN_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INCIDENT_ID: string = "33333333-3333-4333-8333-333333333333";
const OTHER_INCIDENT_ID: string = "55555555-5555-4555-8555-555555555555";
const MODEL_NAME: string = "claude-sonnet-4-5";
const DETAILS_TITLE: string = "Evidence and activity";

const incidentsItem: InvestigationEvidenceItem = {
  citationId: "C1",
  toolName: "query_incidents",
  label: "Active incidents (7 total)",
  rowCount: 7,
  queryArguments: { state: "active" },
  canLoadRows: true,
};

const monitorsItem: InvestigationEvidenceItem = {
  citationId: "C2",
  toolName: "query_monitors",
  label: "Monitors (2 found)",
  rowCount: 2,
  queryArguments: {},
  canLoadRows: true,
};

const emptyItem: InvestigationEvidenceItem = {
  citationId: "C3",
  toolName: "top_exceptions",
  label: "Top exceptions, last 24h (0 found)",
  rowCount: 0,
  queryArguments: {},
  canLoadRows: false,
};

const legacyEntries: Array<InvestigationEvidenceCheckedEntry> = [
  { citationId: "C1", label: "Active incidents (7 total)", rowCount: 7 },
  { citationId: "C2", label: "Deployments (0 found)", rowCount: 0 },
];

/*
 * Five tool calls but three evidence items: failed calls count as tool calls
 * and never become evidence, so the two numbers differ on purpose.
 */
const usage: InvestigationRunUsage = { toolCallCount: 5, totalTokens: 12345 };

function events(steps: Array<StepEvent>): Array<AIRunEvent> {
  return steps.map((step: StepEvent): AIRunEvent => {
    const event: AIRunEvent = new AIRunEvent(ObjectID.generate());
    event.eventType = step.eventType;

    if (step.toolName) {
      event.toolName = step.toolName;
    }

    if (step.resultSummary) {
      event.resultSummary = step.resultSummary;
    }

    return event;
  });
}

/*
 * Four events but two steps: the tool call's completion closes the step its
 * start opened, and RunCompleted draws nothing.
 */
const ACTIVITY_EVENTS: Array<AIRunEvent> = events([
  { eventType: AIRunEventType.RunStarted },
  { eventType: AIRunEventType.ToolCallStarted, toolName: "search_logs" },
  {
    eventType: AIRunEventType.ToolCallCompleted,
    toolName: "search_logs",
    resultSummary: { rowCount: 3, durationInMs: 1500 },
  },
  { eventType: AIRunEventType.RunCompleted },
]);

function detailsProps(
  overrides: Partial<RunDetailsProps> = {},
): RunDetailsProps {
  return {
    evidence: [incidentsItem, monitorsItem, emptyItem],
    legacyEntries: [],
    events: ACTIVITY_EVENTS,
    usage,
    modelName: MODEL_NAME,
    subjectType: "incident",
    subjectId: INCIDENT_ID,
    runId: RUN_ID,
    focusRequest: null,
    ...overrides,
  };
}

function renderDetails(
  overrides: Partial<RunDetailsProps> = {},
): ReturnType<typeof render> {
  return render(<InvestigationRunDetails {...detailsProps(overrides)} />);
}

function rerenderDetails(
  view: ReturnType<typeof render>,
  overrides: Partial<RunDetailsProps> = {},
): void {
  view.rerender(<InvestigationRunDetails {...detailsProps(overrides)} />);
}

function focus(citationId: string, requestId: number): EvidenceFocusRequest {
  return { citationId, requestId };
}

function detailsToggle(): HTMLElement {
  return screen.getByTestId("investigation-details-toggle");
}

function detailsBody(): HTMLElement {
  const body: HTMLElement | null = document.getElementById(
    detailsToggle().getAttribute("aria-controls") || "",
  );
  expect(body).not.toBeNull();
  return body!;
}

function headerUsage(): HTMLElement {
  return screen.getByRole("list", { name: "Investigation usage" });
}

// Tabs are matched on their visible label; the count badge follows it.
function evidenceTab(): HTMLElement {
  return screen.getByRole("tab", { name: /^Evidence checked/ });
}

function activityTab(): HTMLElement {
  return screen.getByRole("tab", { name: /^Activity/ });
}

function panelFor(tab: HTMLElement): HTMLElement {
  const panel: HTMLElement | null = document.getElementById(
    tab.getAttribute("aria-controls") || "",
  );
  expect(panel).not.toBeNull();
  return panel!;
}

function evidenceRowToggle(label: RegExp): HTMLElement {
  return screen.getByRole("button", { name: label });
}

function openDetails(): void {
  fireEvent.click(detailsToggle());
  expect(detailsToggle()).toHaveAttribute("aria-expanded", "true");
}

function rowsResponse(overrides: JSONObject = {}): { data: JSONObject } {
  return {
    data: {
      citationId: "C1",
      toolName: "query_incidents",
      label: "Active incidents (7 total)",
      rowCount: 7,
      isTruncated: false,
      executedAt: "2026-09-15T09:00:00.000Z",
      isPinnedToInvestigationTime: false,
      text: "id | title\n1 | Checkout down",
      ...overrides,
    },
  };
}

function postRequestAt(index: number): PostRequest {
  return postMock.mock.calls[index]![0] as PostRequest;
}

async function flush(): Promise<void> {
  await act(async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const scrollIntoViewMock: MockFunction = getJestMockFunction();

beforeEach(() => {
  getCommonHeadersMock.mockReturnValue({ tenantid: "project-id" });
  getFriendlyMessageMock.mockReturnValue("Request failed");
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: scrollIntoViewMock,
  });
});

afterEach(() => {
  cleanup();
  postMock.mockReset();
  getFriendlyMessageMock.mockReset();
  getCommonHeadersMock.mockReset();
  scrollIntoViewMock.mockReset();
  delete (Element.prototype as unknown as { scrollIntoView?: unknown })
    .scrollIntoView;
});

describe("InvestigationRunDetails disclosure", () => {
  test("is a labelled section that starts collapsed", () => {
    renderDetails();

    const section: HTMLElement = screen.getByRole("region", {
      name: DETAILS_TITLE,
    });
    expect(section).toBe(screen.getByTestId("investigation-details"));

    const heading: HTMLElement = within(section).getByRole("heading", {
      level: 3,
      name: DETAILS_TITLE,
    });
    const toggle: HTMLElement = within(heading).getByRole("button");
    expect(toggle).toBe(detailsToggle());
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAccessibleName(DETAILS_TITLE);
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    // Nothing behind the toggle is exposed until the reader opens it.
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("list", { name: "Evidence checked" })).toBeNull();
    expect(screen.getByText("Searching logs")).not.toBeVisible();
  });

  /*
   * The body is mounted while collapsed (it keeps the evidence list's state),
   * so aria-controls must point at an element that already exists.
   */
  test("points aria-controls at the body, which exists while hidden", () => {
    renderDetails();

    const body: HTMLElement = detailsBody();
    expect(screen.getByTestId("investigation-details")).toContainElement(body);
    expect(body).toHaveAttribute("hidden");
    expect(
      within(body).getByRole("tablist", { hidden: true }),
    ).toBeInTheDocument();
    expect(
      within(body).getByRole("list", {
        name: "Evidence checked",
        hidden: true,
      }),
    ).toBeInTheDocument();
  });

  test("the toggle opens and closes the body", () => {
    renderDetails();

    const toggle: HTMLElement = detailsToggle();
    const body: HTMLElement = detailsBody();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(body).not.toHaveAttribute("hidden");
    expect(
      screen.getByRole("tablist", { name: "Investigation details" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Evidence checked" }),
    ).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(body).toHaveAttribute("hidden");
    expect(screen.queryByRole("tablist")).toBeNull();
    // The same body element: collapsing hides it rather than unmounting it.
    expect(detailsBody()).toBe(body);
  });
});

describe("InvestigationRunDetails usage", () => {
  test("the collapsed header says what the run did and that it changed nothing", () => {
    renderDetails();

    const list: HTMLElement = headerUsage();
    const items: Array<HTMLElement> = within(list).getAllByRole("listitem");

    expect(items).toHaveLength(3);
    // The evidence count, not the run's five tool calls.
    expect(items[0]).toHaveTextContent(/^3 telemetry queries$/);
    // Steps the feed draws, not the four raw events.
    expect(items[1]).toHaveTextContent(/^2 steps$/);
    // The whole sentence, at every width.
    expect(items[2]!.textContent).toBe(INVESTIGATION_READ_ONLY_TEXT);
    expect(INVESTIGATION_READ_ONLY_TEXT).toBe(
      "Read-only — nothing in your systems was changed",
    );

    // Visible while collapsed, and outside the toggle's name.
    expect(list).toBeVisible();
    expect(detailsBody()).not.toContainElement(list);
    expect(detailsToggle()).not.toContainElement(list);
  });

  /*
   * The header and the Evidence tab sit in the same section, so they must
   * never disagree about how many queries ran.
   */
  test("counts queries the way the Evidence tab does", () => {
    renderDetails();
    openDetails();

    expect(within(headerUsage()).getByText(/telemetry/)).toHaveTextContent(
      /^3 telemetry queries$/,
    );
    expect(evidenceTab()).toHaveAccessibleName("Evidence checked 3");
    expect(headerUsage()).not.toHaveTextContent("5");
  });

  test("counts legacy evidence entries as the queries", () => {
    renderDetails({ evidence: [], legacyEntries });

    expect(within(headerUsage()).getByText(/telemetry/)).toHaveTextContent(
      /^2 telemetry queries$/,
    );
  });

  test("falls back to the run's tool calls when there is no evidence", () => {
    renderDetails({ evidence: [], legacyEntries: [] });

    const items: Array<HTMLElement> =
      within(headerUsage()).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(/^5 telemetry queries$/);
    expect(items[1]).toHaveTextContent(/^2 steps$/);
    expect(items[2]!.textContent).toBe(INVESTIGATION_READ_ONLY_TEXT);
  });

  test("uses the singular for one query and one step", () => {
    renderDetails({
      evidence: [incidentsItem],
      events: events([{ eventType: AIRunEventType.RunStarted }]),
    });

    const list: HTMLElement = headerUsage();
    expect(within(list).getByText(/^1 telemetry query$/)).toBeInTheDocument();
    expect(within(list).getByText(/^1 step$/)).toBeInTheDocument();
    expect(list).not.toHaveTextContent("queries");
    expect(list).not.toHaveTextContent("steps");
  });

  test("keeps tokens and model out of the header and in the body's footer", () => {
    renderDetails();

    expect(headerUsage()).not.toHaveTextContent("tokens");
    expect(headerUsage()).not.toHaveTextContent(MODEL_NAME);
    expect(headerUsage()).not.toHaveTextContent("Model");

    // The footer is behind the toggle.
    expect(screen.queryByRole("list", { name: "Model and tokens" })).toBeNull();
    const hiddenFooter: HTMLElement = within(detailsBody()).getByRole("list", {
      name: "Model and tokens",
      hidden: true,
    });
    expect(hiddenFooter).not.toBeVisible();

    openDetails();

    const footer: HTMLElement = screen.getByRole("list", {
      name: "Model and tokens",
    });
    expect(footer).toBe(hiddenFooter);
    const items: Array<HTMLElement> = within(footer).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(/^12,345 tokens$/);
    expect(items[1]).toHaveTextContent(`Model ${MODEL_NAME}`);
    // Counts and the guarantee stay in the header only.
    expect(footer).not.toHaveTextContent("queries");
    expect(footer).not.toHaveTextContent("Read-only");
  });

  test("the footer shows the model alone when no tokens were counted", () => {
    renderDetails({ usage: { toolCallCount: 3, totalTokens: 0 } });
    openDetails();

    const footer: HTMLElement = screen.getByRole("list", {
      name: "Model and tokens",
    });
    expect(within(footer).getAllByRole("listitem")).toHaveLength(1);
    expect(footer).toHaveTextContent(`Model ${MODEL_NAME}`);
    expect(footer).not.toHaveTextContent("tokens");
  });

  test.each([
    ["no tokens and no model", { toolCallCount: 3, totalTokens: 0 }],
    ["no usage and no model", null],
  ] as Array<[string, InvestigationRunUsage | null]>)(
    "has no footer with %s",
    (_description: string, runUsage: InvestigationRunUsage | null) => {
      renderDetails({ usage: runUsage, modelName: undefined });
      openDetails();

      expect(
        screen.queryByRole("list", { name: "Model and tokens", hidden: true }),
      ).toBeNull();
      expect(screen.queryByText(/tokens/)).toBeNull();
    },
  );

  test("without usage the header still counts the evidence and the steps", () => {
    renderDetails({ usage: null });

    const items: Array<HTMLElement> =
      within(headerUsage()).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(/^3 telemetry queries$/);
    expect(items[1]).toHaveTextContent(/^2 steps$/);
    expect(items[2]!.textContent).toBe(INVESTIGATION_READ_ONLY_TEXT);
  });

  test("without usage or evidence the header counts steps and states the guarantee", () => {
    renderDetails({ usage: null, evidence: [], legacyEntries: [] });

    const items: Array<HTMLElement> =
      within(headerUsage()).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(/^2 steps$/);
    expect(items[1]!.textContent).toBe(INVESTIGATION_READ_ONLY_TEXT);
    expect(headerUsage()).not.toHaveTextContent("telemetry");
  });
});

describe("InvestigationRunDetails tabs", () => {
  test("offers Evidence checked and Activity tabs with their counts", () => {
    renderDetails();
    openDetails();

    const tablist: HTMLElement = screen.getByRole("tablist", {
      name: "Investigation details",
    });
    const tabs: Array<HTMLElement> = within(tablist).getAllByRole("tab");

    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAccessibleName("Evidence checked 3");
    // Steps, not the four raw events.
    expect(tabs[1]).toHaveAccessibleName("Activity 2");
    tabs.forEach((tab: HTMLElement) => {
      expect(tab).toHaveAttribute("type", "button");
    });
  });

  test("counts legacy evidence entries when there is no structured evidence", () => {
    renderDetails({ evidence: [], legacyEntries });
    openDetails();

    expect(evidenceTab()).toHaveAccessibleName("Evidence checked 2");
    expect(
      screen.getByText("Every query OneUptime AI ran while investigating."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Expand one/)).toBeNull();
  });

  test("prefers structured evidence over the legacy entries for the count", () => {
    renderDetails({ evidence: [incidentsItem], legacyEntries });
    openDetails();

    expect(evidenceTab()).toHaveAccessibleName("Evidence checked 1");
    expect(screen.queryByText("Deployments (0 found)")).toBeNull();
  });

  test("selects Evidence checked by default and wires tabs to their panels", () => {
    renderDetails();
    openDetails();

    const evidence: HTMLElement = evidenceTab();
    const activity: HTMLElement = activityTab();
    const evidencePanel: HTMLElement = panelFor(evidence);
    const activityPanel: HTMLElement = panelFor(activity);

    expect(evidence).toHaveAttribute("aria-selected", "true");
    expect(activity).toHaveAttribute("aria-selected", "false");

    expect(evidencePanel).toHaveAttribute("role", "tabpanel");
    expect(evidencePanel).toHaveAttribute("aria-labelledby", evidence.id);
    expect(activityPanel).toHaveAttribute("role", "tabpanel");
    expect(activityPanel).toHaveAttribute("aria-labelledby", activity.id);
    expect(evidencePanel).not.toBe(activityPanel);

    // Panels are reachable with Tab even when they hold nothing focusable.
    expect(evidencePanel).toHaveAttribute("tabindex", "0");
    expect(activityPanel).toHaveAttribute("tabindex", "0");

    expect(evidencePanel).not.toHaveAttribute("hidden");
    expect(activityPanel).toHaveAttribute("hidden");
    expect(screen.getByRole("tabpanel")).toBe(evidencePanel);
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName(
      "Evidence checked 3",
    );
    expect(
      within(evidencePanel).getByText(
        "Every query OneUptime AI ran. Expand one to see what it asked and the rows it returned.",
      ),
    ).toBeInTheDocument();
    expect(
      within(evidencePanel).getAllByRole("listitem").length,
    ).toBeGreaterThanOrEqual(3);
  });

  test("clicking a tab switches the visible panel", () => {
    renderDetails();
    openDetails();

    const evidencePanel: HTMLElement = panelFor(evidenceTab());
    const activityPanel: HTMLElement = panelFor(activityTab());

    fireEvent.click(activityTab());

    expect(activityTab()).toHaveAttribute("aria-selected", "true");
    expect(evidenceTab()).toHaveAttribute("aria-selected", "false");
    expect(activityPanel).not.toHaveAttribute("hidden");
    expect(evidencePanel).toHaveAttribute("hidden");
    expect(screen.getByRole("tabpanel")).toBe(activityPanel);
    expect(screen.queryByRole("list", { name: "Evidence checked" })).toBeNull();

    fireEvent.click(evidenceTab());

    expect(evidenceTab()).toHaveAttribute("aria-selected", "true");
    expect(evidencePanel).not.toHaveAttribute("hidden");
    expect(activityPanel).toHaveAttribute("hidden");
  });

  test("only the selected tab is in the Tab order", () => {
    renderDetails();
    openDetails();

    expect(evidenceTab()).toHaveAttribute("tabindex", "0");
    expect(activityTab()).toHaveAttribute("tabindex", "-1");

    fireEvent.click(activityTab());

    expect(evidenceTab()).toHaveAttribute("tabindex", "-1");
    expect(activityTab()).toHaveAttribute("tabindex", "0");
  });

  test("arrow keys move between tabs and wrap at both ends", () => {
    renderDetails();
    openDetails();

    evidenceTab().focus();

    // A handled key is consumed so it does not also scroll the page.
    expect(fireEvent.keyDown(evidenceTab(), { key: "ArrowRight" })).toBe(false);
    expect(activityTab()).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(activityTab());
    expect(panelFor(activityTab())).not.toHaveAttribute("hidden");

    fireEvent.keyDown(activityTab(), { key: "ArrowRight" });
    expect(evidenceTab()).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(evidenceTab());

    fireEvent.keyDown(evidenceTab(), { key: "ArrowLeft" });
    expect(activityTab()).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(activityTab());

    fireEvent.keyDown(activityTab(), { key: "ArrowLeft" });
    expect(evidenceTab()).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(evidenceTab());
  });

  test("Home and End jump to the first and last tab", () => {
    renderDetails();
    openDetails();

    evidenceTab().focus();
    fireEvent.keyDown(evidenceTab(), { key: "End" });

    expect(activityTab()).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(activityTab());

    fireEvent.keyDown(activityTab(), { key: "Home" });

    expect(evidenceTab()).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(evidenceTab());
  });

  test("other keys leave the selection and the page alone", () => {
    renderDetails();
    openDetails();

    evidenceTab().focus();

    expect(fireEvent.keyDown(evidenceTab(), { key: "ArrowDown" })).toBe(true);
    expect(fireEvent.keyDown(evidenceTab(), { key: "a" })).toBe(true);
    expect(evidenceTab()).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(evidenceTab());
  });

  test("the activity panel shows the whole finished trail without live chrome", () => {
    const longTrail: Array<AIRunEvent> = events(
      Array.from({ length: 9 }, (_value: unknown, index: number): StepEvent => {
        return {
          eventType: AIRunEventType.ProgressLog,
          resultSummary: { message: `Checked shard ${index + 1}` },
        };
      }),
    );
    renderDetails({ events: longTrail });
    openDetails();
    fireEvent.click(activityTab());

    const panel: HTMLElement = screen.getByRole("tabpanel");
    expect(activityTab()).toHaveAccessibleName("Activity 9");
    for (let index: number = 1; index <= 9; index++) {
      expect(
        within(panel).getByText(`Checked shard ${index}`),
      ).toBeInTheDocument();
    }
    // The chat feed's default keeps only the last seven.
    expect(panel).not.toHaveTextContent("earlier");
    expect(panel).not.toHaveTextContent("Investigating…");
    expect(panel.querySelector('[class~="animate-ping"]')).toBeNull();
  });
});

describe("InvestigationRunDetails titles", () => {
  test("names the section after both when there is evidence and activity", () => {
    renderDetails();

    expect(
      screen.getByRole("heading", { level: 3, name: "Evidence and activity" }),
    ).toBeInTheDocument();
  });

  test("with evidence only it is Evidence checked, without tabs", () => {
    renderDetails({ events: [] });

    const section: HTMLElement = screen.getByRole("region", {
      name: "Evidence checked",
    });
    expect(detailsToggle()).toHaveAccessibleName("Evidence checked");

    openDetails();

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
    const list: HTMLElement = within(section).getByRole("list", {
      name: "Evidence checked",
    });
    expect(
      within(list).getByRole("button", { name: /Active incidents/ }),
    ).toBeInTheDocument();
    expect(within(headerUsage()).queryByText(/step/)).toBeNull();
  });

  test("with legacy evidence only it is Evidence checked, without tabs", () => {
    renderDetails({ evidence: [], legacyEntries, events: [] });

    expect(detailsToggle()).toHaveAccessibleName("Evidence checked");
    openDetails();

    expect(screen.queryByRole("tablist")).toBeNull();
    const list: HTMLElement = screen.getByRole("list", {
      name: "Evidence checked",
    });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("Deployments (0 found)")).toBeInTheDocument();
  });

  test("with activity only it is Investigation activity, without tabs", () => {
    renderDetails({ evidence: [], legacyEntries: [] });

    const section: HTMLElement = screen.getByRole("region", {
      name: "Investigation activity",
    });
    expect(detailsToggle()).toHaveAccessibleName("Investigation activity");

    openDetails();

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
    expect(screen.queryByRole("list", { name: "Evidence checked" })).toBeNull();
    expect(within(section).getByText("Searching logs")).toBeVisible();
    expect(within(section).getByText("Starting investigation")).toBeVisible();
    expect(within(headerUsage()).getByText(/^2 steps$/)).toBeInTheDocument();
  });
});

describe("InvestigationRunDetails without evidence or activity", () => {
  /*
   * Nothing to expand, so no disclosure: a toggle that opens an empty body
   * would be a dead control. What the run did and cost is all that is left.
   */
  test("renders a plain usage strip with no toggle", () => {
    renderDetails({
      evidence: [],
      legacyEntries: [],
      // A terminal-only trail draws no steps, so it is not activity.
      events: events([{ eventType: AIRunEventType.RunCompleted }]),
    });

    expect(screen.queryByTestId("investigation-details")).toBeNull();
    expect(screen.queryByTestId("investigation-details-toggle")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();

    const list: HTMLElement = headerUsage();
    const items: Array<HTMLElement> = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    // No evidence to count, so the run's own tool calls.
    expect(items[0]).toHaveTextContent(/^5 telemetry queries$/);
    expect(items[1]).toHaveTextContent(/^12,345 tokens$/);
    expect(items[2]).toHaveTextContent(`Model ${MODEL_NAME}`);
    expect(items[3]!.textContent).toBe(INVESTIGATION_READ_ONLY_TEXT);
    expect(list).not.toHaveTextContent("step");
    expect(list).toBeVisible();
  });

  test("renders nothing at all when there is no usage either", () => {
    const { container } = renderDetails({
      evidence: [],
      legacyEntries: [],
      events: [],
      usage: null,
    });

    expect(container).toBeEmptyDOMElement();
  });
});

describe("InvestigationRunDetails evidence state", () => {
  /*
   * The body stays mounted while collapsed precisely so this holds: a
   * reader who closes the section and reopens it finds the query still
   * expanded, and re-running it with their permissions is not repeated.
   */
  test("keeps expanded rows and loaded rows across a collapse and expand", async () => {
    postMock.mockResolvedValue(rowsResponse() as never);
    renderDetails();
    openDetails();

    const rowToggle: HTMLElement = evidenceRowToggle(/Active incidents/);
    fireEvent.click(rowToggle);
    expect(await screen.findByText(/Checkout down/)).toBeVisible();
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postRequestAt(0).data).toEqual({
      subjectType: "incident",
      subjectId: INCIDENT_ID,
      investigationRunId: RUN_ID,
      citationId: "C1",
    });

    fireEvent.click(detailsToggle());
    expect(detailsToggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText(/Checkout down/)).not.toBeVisible();

    fireEvent.click(detailsToggle());
    await flush();

    expect(evidenceRowToggle(/Active incidents/)).toBe(rowToggle);
    expect(rowToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Checkout down/)).toBeVisible();
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  test("keeps loaded rows when the reader switches tabs and back", async () => {
    postMock.mockResolvedValue(rowsResponse() as never);
    renderDetails();
    openDetails();

    fireEvent.click(evidenceRowToggle(/Active incidents/));
    expect(await screen.findByText(/Checkout down/)).toBeVisible();

    fireEvent.click(activityTab());
    expect(screen.getByText(/Checkout down/)).not.toBeVisible();
    fireEvent.click(evidenceTab());
    await flush();

    expect(screen.getByText(/Checkout down/)).toBeVisible();
    expect(evidenceRowToggle(/Active incidents/)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(postMock).toHaveBeenCalledTimes(1);
  });
});

describe("InvestigationRunDetails focus requests", () => {
  /*
   * A citation chip in the report asks for a query. The section opens and
   * selects the evidence in the same render, so the list can expand, scroll
   * to, highlight and focus a row that is actually visible.
   */
  test("a new request opens the section on the evidence tab and reveals the row", async () => {
    postMock.mockResolvedValue(rowsResponse() as never);
    const view: ReturnType<typeof render> = renderDetails();

    // The reader was last on Activity, then closed the section.
    openDetails();
    fireEvent.click(activityTab());
    fireEvent.click(detailsToggle());
    expect(detailsToggle()).toHaveAttribute("aria-expanded", "false");

    rerenderDetails(view, { focusRequest: focus("C1", 1) });
    await flush();

    expect(detailsToggle()).toHaveAttribute("aria-expanded", "true");
    expect(detailsBody()).not.toHaveAttribute("hidden");
    expect(evidenceTab()).toHaveAttribute("aria-selected", "true");
    expect(activityTab()).toHaveAttribute("aria-selected", "false");
    expect(panelFor(evidenceTab())).not.toHaveAttribute("hidden");
    expect(panelFor(activityTab())).toHaveAttribute("hidden");

    const rowToggle: HTMLElement = evidenceRowToggle(/Active incidents/);
    const row: HTMLElement = rowToggle.closest("li")!;
    expect(rowToggle).toHaveAttribute("aria-expanded", "true");
    expect(row).toHaveAttribute("data-highlighted", "true");
    expect(document.activeElement).toBe(rowToggle);
    expect(scrollIntoViewMock).toHaveBeenCalled();
    expect(await screen.findByText(/Checkout down/)).toBeVisible();
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postRequestAt(0).data["citationId"]).toBe("C1");
  });

  test("a request opens a section the reader never opened", async () => {
    postMock.mockReturnValue(new Promise(() => {}) as never);
    const view: ReturnType<typeof render> = renderDetails();

    rerenderDetails(view, { focusRequest: focus("C2", 1) });
    await flush();

    expect(detailsToggle()).toHaveAttribute("aria-expanded", "true");
    expect(evidenceTab()).toHaveAttribute("aria-selected", "true");
    expect(evidenceRowToggle(/Monitors/)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(document.activeElement).toBe(evidenceRowToggle(/Monitors/));
  });

  test("a chip pointing at a legacy row focuses the row itself", async () => {
    const view: ReturnType<typeof render> = renderDetails({
      evidence: [],
      legacyEntries,
    });

    rerenderDetails(view, {
      evidence: [],
      legacyEntries,
      focusRequest: focus("C2", 1),
    });
    await flush();

    expect(detailsToggle()).toHaveAttribute("aria-expanded", "true");
    expect(evidenceTab()).toHaveAttribute("aria-selected", "true");
    const row: HTMLElement = screen
      .getByText("Deployments (0 found)")
      .closest("li")!;
    expect(row).toHaveAttribute("tabindex", "-1");
    expect(row).toHaveAttribute("data-highlighted", "true");
    expect(document.activeElement).toBe(row);
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(postMock).not.toHaveBeenCalled();
  });

  /*
   * The panel keeps its last request in state. A section that mounts with
   * one already set (it was remounted, or the report re-rendered) must not
   * spring open or scroll the page on its own.
   */
  test("a request already present on mount does not open the section", async () => {
    renderDetails({ focusRequest: focus("C1", 1) });
    await flush();

    expect(detailsToggle()).toHaveAttribute("aria-expanded", "false");
    expect(detailsBody()).toHaveAttribute("hidden");
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    expect(postMock).not.toHaveBeenCalled();
    expect(document.querySelector('[data-highlighted="true"]')).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  test("the next request after a stale one still opens the section", async () => {
    postMock.mockReturnValue(new Promise(() => {}) as never);
    const view: ReturnType<typeof render> = renderDetails({
      focusRequest: focus("C1", 1),
    });
    await flush();
    expect(detailsToggle()).toHaveAttribute("aria-expanded", "false");

    rerenderDetails(view, { focusRequest: focus("C1", 2) });
    await flush();

    expect(detailsToggle()).toHaveAttribute("aria-expanded", "true");
    expect(evidenceRowToggle(/Active incidents/)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(scrollIntoViewMock).toHaveBeenCalled();
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  test("a re-render with the same request does not reopen a section the reader closed", async () => {
    postMock.mockReturnValue(new Promise(() => {}) as never);
    const request: EvidenceFocusRequest = focus("C1", 1);
    const view: ReturnType<typeof render> = renderDetails();

    rerenderDetails(view, { focusRequest: request });
    await flush();
    expect(detailsToggle()).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(detailsToggle());
    rerenderDetails(view, { focusRequest: { ...request } });
    await flush();

    expect(detailsToggle()).toHaveAttribute("aria-expanded", "false");
    expect(detailsBody()).toHaveAttribute("hidden");
  });

  test("clicking the same chip again reopens a section the reader closed", async () => {
    postMock.mockReturnValue(new Promise(() => {}) as never);
    const view: ReturnType<typeof render> = renderDetails();

    rerenderDetails(view, { focusRequest: focus("C1", 1) });
    await flush();
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

    // The reader moves to Activity, then closes the section.
    fireEvent.click(activityTab());
    fireEvent.click(detailsToggle());
    expect(detailsToggle()).toHaveAttribute("aria-expanded", "false");

    rerenderDetails(view, { focusRequest: focus("C1", 2) });
    await flush();

    expect(detailsToggle()).toHaveAttribute("aria-expanded", "true");
    expect(evidenceTab()).toHaveAttribute("aria-selected", "true");
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);
    // Still one request for that citation on this run.
    expect(postMock).toHaveBeenCalledTimes(1);
  });
});

describe("InvestigationRunDetails late evidence", () => {
  /*
   * The report (and its evidence) can land after the activity is already on
   * screen. A reader who opened the section to read the activity must not
   * have it swapped out from under them: the evidence arrives as a new tab.
   */
  test("opening the only panel pins it when evidence arrives later", () => {
    const view: ReturnType<typeof render> = renderDetails({
      evidence: [],
      legacyEntries: [],
    });

    expect(detailsToggle()).toHaveAccessibleName("Investigation activity");
    openDetails();
    expect(screen.getByText("Searching logs")).toBeVisible();

    rerenderDetails(view);

    expect(detailsToggle()).toHaveAccessibleName(DETAILS_TITLE);
    expect(detailsToggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(activityTab()).toHaveAttribute("aria-selected", "true");
    expect(evidenceTab()).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tabpanel")).toBe(panelFor(activityTab()));
    expect(screen.getByText("Searching logs")).toBeVisible();
    expect(panelFor(evidenceTab())).toHaveAttribute("hidden");
  });

  test("the pin survives closing and reopening the section", () => {
    const view: ReturnType<typeof render> = renderDetails({
      evidence: [],
      legacyEntries: [],
    });

    openDetails();
    fireEvent.click(detailsToggle());
    rerenderDetails(view);
    openDetails();

    expect(activityTab()).toHaveAttribute("aria-selected", "true");
  });

  test("a section never opened shows the evidence first once it arrives", () => {
    const view: ReturnType<typeof render> = renderDetails({
      evidence: [],
      legacyEntries: [],
    });

    rerenderDetails(view);
    openDetails();

    expect(evidenceTab()).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toBe(panelFor(evidenceTab()));
  });
});

describe("InvestigationRunDetails context changes", () => {
  test.each([
    ["run", { runId: NEXT_RUN_ID }],
    ["subject", { subjectId: OTHER_INCIDENT_ID }],
    ["subject type", { subjectType: "alert" }],
  ] as Array<[string, Partial<RunDetailsProps>]>)(
    "a new %s collapses the section and resets the selected tab",
    (_description: string, change: Partial<RunDetailsProps>) => {
      const view: ReturnType<typeof render> = renderDetails();

      openDetails();
      fireEvent.click(activityTab());
      expect(activityTab()).toHaveAttribute("aria-selected", "true");

      rerenderDetails(view, change);

      expect(detailsToggle()).toHaveAttribute("aria-expanded", "false");
      expect(detailsBody()).toHaveAttribute("hidden");

      openDetails();

      expect(evidenceTab()).toHaveAttribute("aria-selected", "true");
      expect(activityTab()).toHaveAttribute("aria-selected", "false");
    },
  );

  test("a request still set when the run changes does not reopen the section", async () => {
    postMock.mockReturnValue(new Promise(() => {}) as never);
    const request: EvidenceFocusRequest = focus("C1", 1);
    const view: ReturnType<typeof render> = renderDetails();

    rerenderDetails(view, { focusRequest: request });
    await flush();
    expect(detailsToggle()).toHaveAttribute("aria-expanded", "true");

    rerenderDetails(view, { focusRequest: request, runId: NEXT_RUN_ID });
    await flush();

    expect(detailsToggle()).toHaveAttribute("aria-expanded", "false");
    // Nothing the old run's request expanded carries over either.
    expect(
      screen.getByRole("button", { name: /Active incidents/, hidden: true }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  test("a new request for the new run opens the section again", async () => {
    postMock.mockReturnValue(new Promise(() => {}) as never);
    const view: ReturnType<typeof render> = renderDetails({
      focusRequest: focus("C1", 1),
    });

    rerenderDetails(view, {
      runId: NEXT_RUN_ID,
      focusRequest: focus("C1", 1),
    });
    rerenderDetails(view, {
      runId: NEXT_RUN_ID,
      focusRequest: focus("C2", 2),
    });
    await flush();

    expect(detailsToggle()).toHaveAttribute("aria-expanded", "true");
    expect(evidenceRowToggle(/Monitors/)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(postRequestAt(0).data["investigationRunId"]).toBe(NEXT_RUN_ID);
  });
});
