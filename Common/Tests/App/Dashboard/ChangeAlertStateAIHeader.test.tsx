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
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

const getListMock: MockFunction = getJestMockFunction();
const modelFormModalMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the compiled
 * requires, so the mock consts above are still unassigned when the factory
 * runs. Dereferencing them lazily, at call time, is what makes this work.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

/*
 * The state-change modal is a full model form with its own API traffic. The
 * header only decides WHICH modal to open and what happens after it saves, so
 * the stub records those props and renders the title.
 */
jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: {
      title: string;
      submitButtonText: string;
    }): ReactElement => {
      modelFormModalMock(props);
      return React.createElement(
        "div",
        { "data-testid": "state-change-modal" },
        `${props.title} / ${props.submitButtonText}`,
      );
    },
  };
});

import ChangeAlertState from "../../../../App/FeatureSet/Dashboard/src/Components/Alert/ChangeState";
import ChangeIncidentState from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/ChangeState";
import { EventStatusFact } from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatusPanel";
import { AI_INVESTIGATION_PANEL_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AIInvestigationStatus";
import AlertNoteTemplate from "../../../Models/DatabaseModels/AlertNoteTemplate";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import IncidentNoteTemplate from "../../../Models/DatabaseModels/IncidentNoteTemplate";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Project from "../../../Models/DatabaseModels/Project";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * The alert header used to have no AI notice at all - only the incident
 * header lifted the investigation status - and neither header showed a
 * completed report. Both now render EventStatusPanel with the same notice
 * (queued / running / completed-with-summary), the same header facts, and a
 * same-sized placeholder while loading instead of a full-page loader with a
 * 208px top margin. These tests drive both real components against a fake
 * API so the two stay in step.
 */

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const EVENT_ID: string = "11111111-1111-4111-8111-111111111111";
const CREATED_STATE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ACKNOWLEDGED_STATE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const RESOLVED_STATE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";

const START: Date = new Date("2026-09-14T18:00:00.000Z");

type StageName =
  | "created"
  | "acknowledged"
  | "resolved"
  | "reopenedAndResolvedAgain";

interface HeaderProps {
  onActionComplete: () => void;
  facts?: Array<EventStatusFact> | undefined;
  aiInvestigationStatus?: AIRunStatus | null | undefined;
  aiInvestigationSummary?: string | null | undefined;
}

interface HeaderCase {
  noun: "alert" | "incident";
  stateModel: typeof AlertState | typeof IncidentState;
  timelineModel: typeof AlertStateTimeline | typeof IncidentStateTimeline;
  templateModel: typeof AlertNoteTemplate | typeof IncidentNoteTemplate;
  placeholderTestId: string;
  placeholderText: string;
  acknowledgeId: string;
  resolveId: string;
  acknowledgeModalTitle: string;
  renderHeader: (props: HeaderProps) => ReactElement;
  buildStates: () => Array<AlertState | IncidentState>;
  buildTimelines: (
    stage: StageName,
  ) => Array<AlertStateTimeline | IncidentStateTimeline>;
}

interface StateSpec {
  id: string;
  name: string;
  color: string;
  flag: "isCreatedState" | "isAcknowledgedState" | "isResolvedState";
}

const STATE_SPECS: Array<StateSpec> = [
  {
    id: CREATED_STATE_ID,
    name: "Created",
    color: "#ef4444",
    flag: "isCreatedState",
  },
  {
    id: ACKNOWLEDGED_STATE_ID,
    name: "Acknowledged",
    color: "#f59e0b",
    flag: "isAcknowledgedState",
  },
  {
    id: RESOLVED_STATE_ID,
    name: "Resolved",
    color: "#10b981",
    flag: "isResolvedState",
  },
];

const STAGE_STATE_IDS: Record<StageName, Array<string>> = {
  created: [CREATED_STATE_ID],
  acknowledged: [CREATED_STATE_ID, ACKNOWLEDGED_STATE_ID],
  resolved: [CREATED_STATE_ID, ACKNOWLEDGED_STATE_ID, RESOLVED_STATE_ID],
  // Resolved at 10 minutes, reopened at 20, resolved again at 40.
  reopenedAndResolvedAgain: [
    CREATED_STATE_ID,
    RESOLVED_STATE_ID,
    CREATED_STATE_ID,
    ACKNOWLEDGED_STATE_ID,
    RESOLVED_STATE_ID,
  ],
};

const ALERT_CASE: HeaderCase = {
  noun: "alert",
  stateModel: AlertState,
  timelineModel: AlertStateTimeline,
  templateModel: AlertNoteTemplate,
  placeholderTestId: "alert-state-placeholder",
  placeholderText: "Loading alert status",
  acknowledgeId: "alert-acknowledge-btn",
  resolveId: "alert-resolve-btn",
  acknowledgeModalTitle: "Acknowledge Alert / Acknowledge",
  renderHeader: (props: HeaderProps): ReactElement => {
    return (
      <ChangeAlertState
        alertId={new ObjectID(EVENT_ID)}
        eventNumber="ALR-12"
        title="Checkout latency above 2s"
        eventStartsAt={START}
        {...props}
      />
    );
  },
  buildStates: (): Array<AlertState> => {
    return STATE_SPECS.map((spec: StateSpec): AlertState => {
      const state: AlertState = new AlertState();
      state.id = new ObjectID(spec.id);
      state.name = spec.name;
      state.color = new Color(spec.color);
      state[spec.flag] = true;
      return state;
    });
  },
  buildTimelines: (stage: StageName): Array<AlertStateTimeline> => {
    return STAGE_STATE_IDS[stage].map(
      (stateId: string, index: number): AlertStateTimeline => {
        const timeline: AlertStateTimeline = new AlertStateTimeline();
        timeline.alertStateId = new ObjectID(stateId);
        timeline.startsAt = new Date(START.getTime() + index * 10 * 60 * 1000);
        return timeline;
      },
    );
  },
};

const INCIDENT_CASE: HeaderCase = {
  noun: "incident",
  stateModel: IncidentState,
  timelineModel: IncidentStateTimeline,
  templateModel: IncidentNoteTemplate,
  placeholderTestId: "incident-state-placeholder",
  placeholderText: "Loading incident status",
  acknowledgeId: "incident-acknowledge-btn",
  resolveId: "incident-resolve-btn",
  acknowledgeModalTitle: "Acknowledge Incident / Acknowledge",
  renderHeader: (props: HeaderProps): ReactElement => {
    return (
      <ChangeIncidentState
        incidentId={new ObjectID(EVENT_ID)}
        eventNumber="INC-42"
        title="Checkout latency above 2s"
        eventStartsAt={START}
        {...props}
      />
    );
  },
  buildStates: (): Array<IncidentState> => {
    return STATE_SPECS.map((spec: StateSpec): IncidentState => {
      const state: IncidentState = new IncidentState();
      state.id = new ObjectID(spec.id);
      state.name = spec.name;
      state.color = new Color(spec.color);
      state[spec.flag] = true;
      return state;
    });
  },
  buildTimelines: (stage: StageName): Array<IncidentStateTimeline> => {
    return STAGE_STATE_IDS[stage].map(
      (stateId: string, index: number): IncidentStateTimeline => {
        const timeline: IncidentStateTimeline = new IncidentStateTimeline();
        timeline.incidentStateId = new ObjectID(stateId);
        timeline.startsAt = new Date(START.getTime() + index * 10 * 60 * 1000);
        return timeline;
      },
    );
  },
};

interface ListResultShape {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
}

const listResult: (data: Array<unknown>) => ListResultShape = (
  data: Array<unknown>,
): ListResultShape => {
  return { data: data, count: data.length, skip: 0, limit: 99 };
};

interface FakeApiOptions {
  stage?: StageName | undefined;
  templatesFail?: boolean | undefined;
  statesFailOnce?: boolean | undefined;
}

type RespondFunction = (
  headerCase: HeaderCase,
  options?: FakeApiOptions,
) => void;

const respondWith: RespondFunction = (
  headerCase: HeaderCase,
  options?: FakeApiOptions,
): void => {
  let hasFailedStates: boolean = false;

  getListMock.mockImplementation((...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };

    if (request.modelType === headerCase.stateModel) {
      if (options?.statesFailOnce && !hasFailedStates) {
        hasFailedStates = true;
        return Promise.reject(new Error("States are unavailable"));
      }

      return Promise.resolve(listResult(headerCase.buildStates()));
    }

    if (request.modelType === headerCase.timelineModel) {
      return Promise.resolve(
        listResult(headerCase.buildTimelines(options?.stage || "created")),
      );
    }

    if (request.modelType === headerCase.templateModel) {
      if (options?.templatesFail) {
        return Promise.reject(new Error("Templates are unavailable"));
      }

      return Promise.resolve(listResult([]));
    }

    return Promise.reject(new Error("Unexpected list request"));
  });
};

const waitForHeader: () => Promise<HTMLElement> =
  async (): Promise<HTMLElement> => {
    return screen.findByRole("heading", {
      level: 2,
      name: "Checkout latency above 2s",
    });
  };

const getLiveRegionText: () => string = (): string => {
  const liveRegion: HTMLElement | undefined = screen
    .getAllByRole("status")
    .find((element: HTMLElement) => {
      return element.getAttribute("aria-atomic") === "true";
    });

  if (!liveRegion) {
    throw new Error("The AI live region is not mounted");
  }

  return liveRegion.textContent || "";
};

beforeEach(() => {
  const project: Project = new Project();
  project.id = new ObjectID(PROJECT_ID);

  jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(project);
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  modelFormModalMock.mockReset();
  jest.restoreAllMocks();
});

describe.each([
  ["ChangeAlertState", ALERT_CASE],
  ["ChangeIncidentState", INCIDENT_CASE],
])("%s header", (_name: string, headerCase: HeaderCase) => {
  describe("loading", () => {
    test("holds a same-sized placeholder instead of a full-page loader", () => {
      getListMock.mockImplementation(() => {
        return new Promise<never>(() => {
          // never settles: the header stays loading
        });
      });

      const { container } = render(
        headerCase.renderHeader({ onActionComplete: jest.fn() }),
      );

      const placeholder: HTMLElement = screen.getByTestId(
        headerCase.placeholderTestId,
      );

      expect(placeholder).toHaveAttribute("role", "status");
      expect(placeholder).toHaveClass("rounded-xl", "border", "bg-white");
      expect(
        within(placeholder).getByText(headerCase.placeholderText),
      ).toHaveClass("sr-only");
      expect(
        placeholder.querySelector(".motion-safe\\:animate-pulse"),
      ).not.toBeNull();
      expect(container.querySelector(".mt-52")).toBeNull();
      expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    });

    test("reads states, timeline and templates together, not one after another", () => {
      getListMock.mockImplementation(() => {
        return new Promise<never>(() => {
          // never settles
        });
      });

      render(headerCase.renderHeader({ onActionComplete: jest.fn() }));

      const requestedModels: Array<unknown> = getListMock.mock.calls.map(
        (call: Array<unknown>) => {
          return (call[0] as { modelType: unknown }).modelType;
        },
      );

      expect(requestedModels).toHaveLength(3);
      expect(requestedModels).toEqual(
        expect.arrayContaining([
          headerCase.stateModel,
          headerCase.timelineModel,
          headerCase.templateModel,
        ]),
      );
    });

    test("keeps the AI live region mounted while loading", () => {
      getListMock.mockImplementation(() => {
        return new Promise<never>(() => {
          // never settles
        });
      });

      render(
        headerCase.renderHeader({
          onActionComplete: jest.fn(),
          aiInvestigationStatus: AIRunStatus.Running,
        }),
      );

      expect(getLiveRegionText()).toBe(
        "AI is investigating. Reviewing telemetry and tracing the likely root cause.",
      );
    });

    test("a failed template read leaves the header and its actions in place", async () => {
      respondWith(headerCase, { templatesFail: true });

      render(headerCase.renderHeader({ onActionComplete: jest.fn() }));

      await waitForHeader();

      expect(
        document.getElementById(headerCase.acknowledgeId),
      ).toBeInTheDocument();

      fireEvent.click(document.getElementById(headerCase.acknowledgeId)!);

      const modalProps: {
        formProps: { fields: Array<{ showIf?: () => boolean }> };
      } = modelFormModalMock.mock.calls[
        modelFormModalMock.mock.calls.length - 1
      ]![0] as { formProps: { fields: Array<{ showIf?: () => boolean }> } };

      // No templates, so the template picker stays hidden.
      expect(modalProps.formProps.fields[0]!.showIf!()).toBe(false);
    });

    test("a failed state read offers a retry that recovers", async () => {
      respondWith(headerCase, { statesFailOnce: true });

      render(headerCase.renderHeader({ onActionComplete: jest.fn() }));

      expect(
        await screen.findByText("States are unavailable"),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("refresh-button"));

      expect(await waitForHeader()).toBeInTheDocument();
    });
  });

  describe("actions", () => {
    test("offers acknowledge and resolve on a new event", async () => {
      respondWith(headerCase, { stage: "created" });

      render(headerCase.renderHeader({ onActionComplete: jest.fn() }));

      await waitForHeader();

      expect(
        document.getElementById(headerCase.acknowledgeId),
      ).toHaveTextContent("Acknowledge");
      expect(document.getElementById(headerCase.resolveId)).toHaveTextContent(
        "Resolve",
      );
    });

    test("offers only resolve, as the primary action, once acknowledged", async () => {
      respondWith(headerCase, { stage: "acknowledged" });

      render(headerCase.renderHeader({ onActionComplete: jest.fn() }));

      await waitForHeader();

      expect(document.getElementById(headerCase.acknowledgeId)).toBeNull();
      expect(document.getElementById(headerCase.resolveId)).toHaveClass(
        "bg-indigo-600",
      );
    });

    test("never paints acknowledge or resolve, even for a frame, on a resolved event", async () => {
      respondWith(headerCase, { stage: "resolved" });

      const addedIds: Array<string> = [];
      const observer: MutationObserver = new MutationObserver(
        (mutations: Array<MutationRecord>) => {
          for (const mutation of mutations) {
            mutation.addedNodes.forEach((node: Node) => {
              if (node instanceof HTMLElement) {
                if (node.id) {
                  addedIds.push(node.id);
                }

                node.querySelectorAll("[id]").forEach((child: Element) => {
                  addedIds.push(child.id);
                });
              }
            });
          }
        },
      );

      observer.observe(document.body, { childList: true, subtree: true });

      render(headerCase.renderHeader({ onActionComplete: jest.fn() }));

      await waitForHeader();

      observer.disconnect();

      expect(addedIds).not.toContain(headerCase.acknowledgeId);
      expect(addedIds).not.toContain(headerCase.resolveId);
      expect(screen.getByText("Lasted")).toBeInTheDocument();
      expect(screen.queryByText("Resolved in")).toBeNull();
    });

    /*
     * The overview's stat bar says "Resolved in" for the time to the FIRST
     * resolution; the header's duration runs to the CURRENT one. With the
     * same label, a reopened event read "Resolved in 40 minutes" in the header
     * right above "Resolved in 10 minutes".
     */
    test("a reopened event resolved again says how long it lasted, not a second 'Resolved in'", async () => {
      respondWith(headerCase, { stage: "reopenedAndResolvedAgain" });

      render(headerCase.renderHeader({ onActionComplete: jest.fn() }));

      await waitForHeader();

      expect(screen.getByText("Lasted")).toBeInTheDocument();
      expect(screen.queryByText("Resolved in")).toBeNull();
      expect(screen.queryByText("Ongoing for")).toBeNull();
      // START -> the current resolution 40 minutes later, not the first at 10.
      expect(screen.getByText("Lasted").parentElement).toHaveTextContent(
        "40 minutes",
      );
      expect(document.getElementById(headerCase.resolveId)).toBeNull();
    });

    test("opens the acknowledge modal and reports completion after a save", async () => {
      respondWith(headerCase, { stage: "created" });

      const onActionComplete: MockFunction = getJestMockFunction();

      render(
        headerCase.renderHeader({
          onActionComplete: onActionComplete as unknown as () => void,
        }),
      );

      await waitForHeader();

      fireEvent.click(document.getElementById(headerCase.acknowledgeId)!);

      expect(screen.getByTestId("state-change-modal")).toHaveTextContent(
        headerCase.acknowledgeModalTitle,
      );

      const listCallsBeforeSave: number = getListMock.mock.calls.length;
      const modalProps: { onSuccess: () => Promise<void> } = modelFormModalMock
        .mock.calls[modelFormModalMock.mock.calls.length - 1]![0] as {
        onSuccess: () => Promise<void>;
      };

      await act(async () => {
        await modalProps.onSuccess();
      });

      expect(onActionComplete).toHaveBeenCalledTimes(1);
      // Only the timeline is read again; the header does not reload itself.
      expect(getListMock.mock.calls.length - listCallsBeforeSave).toBe(1);
      expect(
        (
          getListMock.mock.calls[getListMock.mock.calls.length - 1]![0] as {
            modelType: unknown;
          }
        ).modelType,
      ).toBe(headerCase.timelineModel);
      expect(screen.queryByTestId(headerCase.placeholderTestId)).toBeNull();
    });
  });

  describe("facts", () => {
    test("renders the facts the page passes under the pills", async () => {
      respondWith(headerCase);

      render(
        headerCase.renderHeader({
          onActionComplete: jest.fn(),
          facts: [
            {
              label: "Created",
              value: "Sep 14 2026, 18:00 UTC",
              icon: IconProp.Calendar,
            },
            {
              label: "Monitor",
              value: <span data-testid="monitor-fact">checkout-api</span>,
            },
          ],
        }),
      );

      await waitForHeader();

      const facts: HTMLElement = screen.getByTestId("event-status-facts");

      expect(facts.tagName).toBe("DL");
      expect(within(facts).getByText("Created")).toBeInTheDocument();
      expect(
        within(facts).getByText("Sep 14 2026, 18:00 UTC"),
      ).toBeInTheDocument();
      expect(within(facts).getByTestId("monitor-fact")).toHaveTextContent(
        "checkout-api",
      );
    });

    test("renders no facts row when the page has none", async () => {
      respondWith(headerCase);

      render(
        headerCase.renderHeader({ onActionComplete: jest.fn(), facts: [] }),
      );

      await waitForHeader();

      expect(screen.queryByTestId("event-status-facts")).toBeNull();
    });
  });

  describe("AI investigation notice", () => {
    test("shows live progress while the investigation runs", async () => {
      respondWith(headerCase);

      render(
        headerCase.renderHeader({
          onActionComplete: jest.fn(),
          aiInvestigationStatus: AIRunStatus.Running,
        }),
      );

      await waitForHeader();

      expect(screen.getByText("AI is investigating")).toBeInTheDocument();
      expect(
        screen.getByRole("button", {
          name: "View live AI investigation progress",
        }),
      ).toHaveAttribute("aria-controls", AI_INVESTIGATION_PANEL_ID);
    });

    test("shows the queued notice while waiting for a worker", async () => {
      respondWith(headerCase);

      render(
        headerCase.renderHeader({
          onActionComplete: jest.fn(),
          aiInvestigationStatus: AIRunStatus.Queued,
        }),
      );

      await waitForHeader();

      expect(screen.getByText("AI investigation queued")).toBeInTheDocument();
    });

    test("leads with the completed report's summary and a View full report link", async () => {
      respondWith(headerCase);

      render(
        headerCase.renderHeader({
          onActionComplete: jest.fn(),
          aiInvestigationStatus: AIRunStatus.Completed,
          aiInvestigationSummary:
            "A connection pool change in checkout-api exhausted database connections.",
        }),
      );

      const header: HTMLElement = await waitForHeader();
      const panel: HTMLElement = header.closest(".rounded-xl") as HTMLElement;

      expect(
        within(panel).getByRole("heading", {
          level: 3,
          name: "AI root cause analysis",
        }),
      ).toBeInTheDocument();
      expect(
        within(panel).getByText(
          "A connection pool change in checkout-api exhausted database connections.",
        ),
      ).toHaveClass("line-clamp-3");

      const viewReport: HTMLElement = within(panel).getByRole("button", {
        name: /View full report/,
      });

      expect(viewReport).toHaveAttribute("type", "button");
      expect(viewReport).toHaveAttribute(
        "aria-controls",
        AI_INVESTIGATION_PANEL_ID,
      );
      expect(getLiveRegionText()).toBe("AI root cause analysis ready.");
    });

    test("renders model-authored summary text as text, never as markup", async () => {
      respondWith(headerCase);

      const hostileSummary: string =
        '<img src=x onerror="alert(1)"> [click](https://evil.example)';

      const { container } = render(
        headerCase.renderHeader({
          onActionComplete: jest.fn(),
          aiInvestigationStatus: AIRunStatus.Completed,
          aiInvestigationSummary: hostileSummary,
        }),
      );

      await waitForHeader();

      expect(screen.getByText(hostileSummary)).toBeInTheDocument();
      expect(container.querySelector("img")).toBeNull();
      expect(
        container.querySelector('a[href="https://evil.example"]'),
      ).toBeNull();
    });

    test.each([
      ["no summary", null],
      ["an empty summary", ""],
      ["a whitespace summary", "   "],
    ])(
      "shows nothing for a completed investigation with %s",
      async (_label: string, summary: string | null) => {
        respondWith(headerCase);

        render(
          headerCase.renderHeader({
            onActionComplete: jest.fn(),
            aiInvestigationStatus: AIRunStatus.Completed,
            aiInvestigationSummary: summary,
          }),
        );

        await waitForHeader();

        expect(screen.queryByText("AI root cause analysis")).toBeNull();
        expect(
          screen.queryByRole("button", { name: /View full report/ }),
        ).toBeNull();
        expect(getLiveRegionText()).toBe("");
      },
    );

    test.each([AIRunStatus.Error, AIRunStatus.Cancelled, AIRunStatus.Stale])(
      "shows nothing for a %s investigation, even with a summary",
      async (status: AIRunStatus) => {
        respondWith(headerCase);

        render(
          headerCase.renderHeader({
            onActionComplete: jest.fn(),
            aiInvestigationStatus: status,
            aiInvestigationSummary: "Stale text from an earlier report.",
          }),
        );

        await waitForHeader();

        expect(
          screen.queryByText("Stale text from an earlier report."),
        ).toBeNull();
        expect(screen.queryByText("AI is investigating")).toBeNull();
      },
    );

    test("switches from live progress to the summary when the run completes", async () => {
      respondWith(headerCase);

      const { rerender } = render(
        headerCase.renderHeader({
          onActionComplete: jest.fn(),
          aiInvestigationStatus: AIRunStatus.Running,
        }),
      );

      await waitForHeader();

      expect(screen.getByText("AI is investigating")).toBeInTheDocument();

      rerender(
        headerCase.renderHeader({
          onActionComplete: jest.fn(),
          aiInvestigationStatus: AIRunStatus.Completed,
          aiInvestigationSummary: "Pool exhaustion in checkout-api.",
        }),
      );

      expect(screen.queryByText("AI is investigating")).toBeNull();
      expect(
        screen.getByText("Pool exhaustion in checkout-api."),
      ).toBeInTheDocument();

      await waitFor(() => {
        expect(getLiveRegionText()).toBe("AI root cause analysis ready.");
      });
      // The header did not go back to loading for a prop change.
      expect(screen.queryByTestId(headerCase.placeholderTestId)).toBeNull();
    });
  });
});
