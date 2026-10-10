import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * The monitor table and the step form's own pieces, as stand-ins that keep
 * what they were handed: their contracts with the AI pages are the props.
 */
type CapturedTableProps = {
  query?: Record<string, unknown>;
  title?: string;
  description?: string;
  emptyState?: { title?: string; description?: string };
  disableCreate?: boolean;
  cardButtons?: Array<{
    title: string;
    onClick: () => void;
    disabled?: boolean;
  }>;
  saveFilterProps?: { tableId: string };
};

let mockTableProps: CapturedTableProps | null = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorTable",
  () => {
    return {
      __esModule: true,
      default: (props: CapturedTableProps) => {
        mockTableProps = props;
        return null;
      },
    };
  },
);

type CapturedFormProps = {
  initialValues: Record<string, unknown>;
  fields: Array<{
    field: Record<string, boolean>;
    title: string;
    fieldType: string;
    dropdownOptions?: Array<{ label: string; value: unknown }>;
    collapsibleSection?: unknown;
    placeholder?: string;
  }>;
  onChange: (values: Record<string, unknown>) => void;
};

let mockFormProps: CapturedFormProps | null = null;

jest.mock("../../../UI/Components/Forms/BasicForm", () => {
  return {
    __esModule: true,
    default: (props: CapturedFormProps) => {
      mockFormProps = props;
      return null;
    },
  };
});

import LlmAlertsView, {
  LlmAlertTemplateCard,
} from "../../../../App/FeatureSet/Dashboard/src/Components/LlmAlerts/LlmAlertsView";
import LlmMonitorPreview, {
  LLM_MONITOR_PREVIEW_DEBOUNCE_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/LlmAlerts/LlmMonitorPreview";
import LlmMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/LlmMonitor/LlmMonitorStepForm";
import { LLM_MONITOR_TEMPLATE_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/LlmAlerts/LlmMonitorTemplateCopy";
import LlmMonitorTemplates, {
  LlmMonitorTemplateId,
} from "../../../Types/Monitor/LlmMonitor/LlmMonitorTemplates";
import MonitorStepLlmMonitor, {
  MonitorStepLlmMonitorUtil,
} from "../../../Types/Monitor/MonitorStepLlmMonitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { LlmAnswerIssue } from "../../../Types/Telemetry/LlmAnswerIssue";
import { LLM_ANSWER_STATS_ROUTE } from "../../../Types/Telemetry/LlmConversationApi";
import TimeRange from "../../../Types/Time/TimeRange";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Service from "../../../Models/DatabaseModels/Service";
import { PROJECT_ID } from "./LlmConversationFixtures";

/*
 * Being told when the AI answers badly: the Alerts tab's ready-made alerts,
 * the AI / LLM monitor's form and the preview under it that shows what the
 * monitor would count before it is saved.
 */

const SERVICE_ID: string = "6f1e2d3c-4b5a-4968-8776-655443322110";

let postSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  mockTableProps = null;
  mockFormProps = null;
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  postSpy = jest.spyOn(API, "post");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function allowCreating(): void {
  jest
    .spyOn(PermissionGate, "gateCardButton")
    .mockImplementation((button: unknown): never => {
      return button as never;
    });
}

describe("the Alerts tab", () => {
  test("one card per ready-made alert, and spend", () => {
    allowCreating();

    render(
      <MemoryRouter>
        <LlmAlertsView />
      </MemoryRouter>,
    );

    const cards: Array<HTMLElement> =
      screen.getAllByTestId("llm-alert-template");

    expect(
      cards.map((card: HTMLElement): string | null => {
        return card.getAttribute("data-template-id");
      }),
    ).toEqual(
      LlmMonitorTemplates.getAll().map((template: { id: string }): string => {
        return template.id;
      }),
    );

    for (const card of cards) {
      const copy: (typeof LLM_MONITOR_TEMPLATE_COPY)[LlmMonitorTemplateId] =
        LLM_MONITOR_TEMPLATE_COPY[
          card.getAttribute("data-template-id") as LlmMonitorTemplateId
        ];

      expect(card).toHaveTextContent(copy.title);
      expect(card).toHaveTextContent(copy.description);
    }

    expect(screen.getByTestId("llm-alerts-spend")).toHaveTextContent(
      "Spend goes over budget",
    );
    expect(screen.getByText("Open Budgets").closest("a")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/llm/budgets`,
    );
  });

  test("a card's Create alert opens Create Monitor on that template", () => {
    allowCreating();

    render(
      <MemoryRouter>
        <LlmAlertsView />
      </MemoryRouter>,
    );

    const card: HTMLElement = screen
      .getAllByTestId("llm-alert-template")
      .find((element: HTMLElement): boolean => {
        return (
          element.getAttribute("data-template-id") ===
          LlmMonitorTemplateId.Refusals
        );
      })!;
    const href: string | null = card.querySelector("a")!.getAttribute("href");

    expect(href?.split("?")[0]).toBe(
      `/dashboard/${PROJECT_ID}/monitors/create`,
    );
    expect(
      new URLSearchParams(href?.split("?")[1]).get("llmMonitorTemplate"),
    ).toBe(LlmMonitorTemplateId.Refusals);
    expect(card).toHaveTextContent("Create alert");
  });

  test("lists the project's AI / LLM monitors, with its own empty state", () => {
    allowCreating();

    render(
      <MemoryRouter>
        <LlmAlertsView />
      </MemoryRouter>,
    );

    expect(mockTableProps?.query?.["monitorType"]).toBe(MonitorType.Llm);
    expect(String(mockTableProps?.query?.["projectId"])).toBe(PROJECT_ID);
    expect(mockTableProps?.title).toBe("AI alerts");
    expect(mockTableProps?.emptyState?.title).toBe("No AI alerts yet");
    // Creating goes through the AI form, not the table's generic one.
    expect(mockTableProps?.disableCreate).toBe(true);
    expect(mockTableProps?.saveFilterProps?.tableId).toBe(
      "llm-alerts-monitors-table",
    );
  });

  test("Create AI alert opens Create Monitor on the AI / LLM type", () => {
    allowCreating();
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {});

    render(
      <MemoryRouter>
        <LlmAlertsView />
      </MemoryRouter>,
    );

    const button: { title: string; onClick: () => void } =
      mockTableProps!.cardButtons![0]!;

    expect(button.title).toBe("Create AI alert");

    button.onClick();

    const target: string = String(navigate.mock.calls[0]![0]);

    expect(target.split("?")[0]).toBe(
      `/dashboard/${PROJECT_ID}/monitors/create`,
    );
    expect(new URLSearchParams(target.split("?")[1]).get("monitorType")).toBe(
      MonitorType.Llm,
    );
  });

  test("someone who may not create monitors is told so, not handed a form they cannot save", () => {
    jest.spyOn(PermissionGate, "gateCardButton").mockReturnValue(null);

    render(
      <MemoryRouter>
        <LlmAlertsView />
      </MemoryRouter>,
    );

    expect(screen.queryByText("Create alert")).not.toBeInTheDocument();
    expect(
      screen.getAllByText(
        "You need permission to create monitors to set this up.",
      ),
    ).toHaveLength(LlmMonitorTemplates.getAll().length);
    expect(mockTableProps?.cardButtons).toEqual([]);
  });

  test("a locked create button does not count as permission to create", () => {
    jest
      .spyOn(PermissionGate, "gateCardButton")
      .mockImplementation((button: unknown): never => {
        return {
          ...(button as Record<string, unknown>),
          disabled: true,
          tooltip: "You need the Create Monitor permission.",
        } as never;
      });

    render(
      <MemoryRouter>
        <LlmAlertsView />
      </MemoryRouter>,
    );

    expect(screen.queryByText("Create alert")).not.toBeInTheDocument();
    // The table still shows the locked button, with its reason.
    expect(mockTableProps?.cardButtons?.[0]?.disabled).toBe(true);
  });

  test("a single card, for the card's own contract", () => {
    render(
      <MemoryRouter>
        <LlmAlertTemplateCard
          template={LlmMonitorTemplates.get(LlmMonitorTemplateId.NoAnswers)!}
          canCreate={true}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("llm-alert-template")).toHaveTextContent(
      "The AI stops answering",
    );
  });
});

describe("the preview of what a monitor would count", () => {
  const STATS: JSONObject = {
    answerCount: 1204,
    badAnswerCount: 9,
    badAnswerPercent: 0.75,
    startTime: "2026-10-10T08:45:00.000Z",
    endTime: "2026-10-10T09:00:00.000Z",
  };

  function respondWith(body: JSONObject): void {
    postSpy.mockImplementation(async (): Promise<HTTPResponse<JSONObject>> => {
      return new HTTPResponse<JSONObject>(200, body, {});
    });
  }

  test("counts the answers in the window, the bad ones and their share", async () => {
    respondWith(STATS);

    render(
      <MemoryRouter>
        <LlmMonitorPreview step={MonitorStepLlmMonitorUtil.getDefault()} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("llm-monitor-preview-window")).toHaveTextContent(
      "Last 15 minutes",
    );
    expect(
      screen.getByTestId("llm-monitor-preview-loading"),
    ).toBeInTheDocument();

    expect(
      await screen.findByTestId("llm-monitor-preview-answers-value"),
    ).toHaveTextContent("1,204");
    expect(
      screen.getByTestId("llm-monitor-preview-bad-value"),
    ).toHaveTextContent("9");
    expect(
      screen.getByTestId("llm-monitor-preview-share-value"),
    ).toHaveTextContent("0.75%");
    // Bad answers read in red.
    expect(
      screen.getByTestId("llm-monitor-preview-bad-value").className,
    ).toContain("text-red-700");

    const calls: Array<Array<unknown>> = postSpy.mock.calls as Array<
      Array<unknown>
    >;

    expect(
      (calls[0]![0] as { url: { toString: () => string } }).url.toString(),
    ).toContain(LLM_ANSWER_STATS_ROUTE);
  });

  test("links to the conversations it counted, problems first, over the same window", async () => {
    respondWith(STATS);

    render(
      <MemoryRouter>
        <LlmMonitorPreview step={MonitorStepLlmMonitorUtil.getDefault()} />
      </MemoryRouter>,
    );

    const link: HTMLElement = (
      await screen.findByText("See the conversations that need attention")
    ).closest("a")!;
    const href: string = link.getAttribute("href") || "";
    const query: URLSearchParams = new URLSearchParams(href.split("?")[1]);

    expect(href.split("?")[0]).toBe(
      `/dashboard/${PROJECT_ID}/llm/conversations`,
    );
    expect(query.get("range")).toBe(TimeRange.CUSTOM);
    expect(query.get("start")).toBe("2026-10-10T08:45:00.000Z");
    expect(query.get("end")).toBe("2026-10-10T09:00:00.000Z");
    expect(query.get("issue")).toBe("any");
  });

  test("no bad answers read in the normal colour", async () => {
    respondWith({ ...STATS, badAnswerCount: 0, badAnswerPercent: 0 });

    render(
      <MemoryRouter>
        <LlmMonitorPreview step={MonitorStepLlmMonitorUtil.getDefault()} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByTestId("llm-monitor-preview-bad-value"),
    ).toHaveTextContent("0");
    expect(
      screen.getByTestId("llm-monitor-preview-bad-value").className,
    ).not.toContain("text-red-700");
  });

  test("no answers yet: says the monitor counts them as they arrive", async () => {
    respondWith({
      ...STATS,
      answerCount: 0,
      badAnswerCount: 0,
      badAnswerPercent: 0,
    });

    render(
      <MemoryRouter>
        <LlmMonitorPreview step={MonitorStepLlmMonitorUtil.getDefault()} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByTestId("llm-monitor-preview-empty"),
    ).toHaveTextContent("No AI answers in this window yet.");
    expect(
      screen.queryByText("See the conversations that need attention"),
    ).not.toBeInTheDocument();
  });

  test("an error is said in place", async () => {
    postSpy.mockImplementation(async (): Promise<HTTPErrorResponse> => {
      return new HTTPErrorResponse(
        403,
        { error: "You cannot read traces." },
        {},
      );
    });

    render(
      <MemoryRouter>
        <LlmMonitorPreview step={MonitorStepLlmMonitorUtil.getDefault()} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByTestId("llm-monitor-preview-error"),
    ).toHaveTextContent("You cannot read traces.");
  });

  test("an answer it cannot read is an error too", async () => {
    postSpy.mockImplementation(
      async (): Promise<HTTPResponse<Array<JSONObject>>> => {
        return new HTTPResponse<Array<JSONObject>>(200, [], {});
      },
    );

    render(
      <MemoryRouter>
        <LlmMonitorPreview step={MonitorStepLlmMonitorUtil.getDefault()} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByTestId("llm-monitor-preview-error"),
    ).toHaveTextContent("The preview could not be read.");
  });

  test("settings changed in a burst are read once they settle", async () => {
    respondWith(STATS);

    const step: MonitorStepLlmMonitor = MonitorStepLlmMonitorUtil.getDefault();
    const view: ReturnType<typeof render> = render(
      <MemoryRouter>
        <LlmMonitorPreview step={step} />
      </MemoryRouter>,
    );

    for (const seconds of [5, 10, 15, 20]) {
      view.rerender(
        <MemoryRouter>
          <LlmMonitorPreview step={{ ...step, slowAnswerSeconds: seconds }} />
        </MemoryRouter>,
      );
    }

    await screen.findByTestId("llm-monitor-preview-answers-value");

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(
      ((postSpy.mock.calls[0] as Array<unknown>)[0] as { data: JSONObject })
        .data["slowAnswerSeconds"],
    ).toBe(20);
    expect(LLM_MONITOR_PREVIEW_DEBOUNCE_MS).toBe(500);
  });

  test("the same settings, re-rendered, are not read again", async () => {
    respondWith(STATS);

    const view: ReturnType<typeof render> = render(
      <MemoryRouter>
        <LlmMonitorPreview step={MonitorStepLlmMonitorUtil.getDefault()} />
      </MemoryRouter>,
    );

    await screen.findByTestId("llm-monitor-preview-answers-value");

    view.rerender(
      <MemoryRouter>
        <LlmMonitorPreview step={MonitorStepLlmMonitorUtil.getDefault()} />
      </MemoryRouter>,
    );

    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, LLM_MONITOR_PREVIEW_DEBOUNCE_MS + 100);
      });
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  test("an answer that arrives after the settings changed again is dropped", async () => {
    const resolvers: Array<(response: HTTPResponse<JSONObject>) => void> = [];

    postSpy.mockImplementation((): Promise<HTTPResponse<JSONObject>> => {
      return new Promise(
        (resolve: (response: HTTPResponse<JSONObject>) => void) => {
          resolvers.push(resolve);
        },
      );
    });

    const step: MonitorStepLlmMonitor = MonitorStepLlmMonitorUtil.getDefault();
    const view: ReturnType<typeof render> = render(
      <MemoryRouter>
        <LlmMonitorPreview step={step} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(resolvers).toHaveLength(1);
    });

    view.rerender(
      <MemoryRouter>
        <LlmMonitorPreview
          step={{ ...step, issues: [LlmAnswerIssue.Failed] }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(resolvers).toHaveLength(2);
    });

    await act(async () => {
      resolvers[1]!(
        new HTTPResponse<JSONObject>(200, { ...STATS, answerCount: 2 }, {}),
      );
    });
    await act(async () => {
      resolvers[0]!(
        new HTTPResponse<JSONObject>(200, { ...STATS, answerCount: 999 }, {}),
      );
    });

    expect(
      screen.getByTestId("llm-monitor-preview-answers-value"),
    ).toHaveTextContent("2");
  });
});

describe("the AI / LLM monitor's form", () => {
  function service(id: string, name: string): Service {
    const model: Service = new Service();
    model._id = id;
    model.name = name;
    return model;
  }

  test("asks what counts as bad, how slow, how far back, which apps, then the model", () => {
    jest.spyOn(API, "post").mockImplementation(async (): Promise<never> => {
      return new Promise(() => {}) as never;
    });

    render(
      <MemoryRouter>
        <LlmMonitorStepForm
          monitorStepLlmMonitor={MonitorStepLlmMonitorUtil.getDefault()}
          onMonitorStepLlmMonitorChanged={jest.fn()}
          telemetryServices={[service(SERVICE_ID, "Support bot")]}
        />
      </MemoryRouter>,
    );

    expect(
      mockFormProps!.fields.map((field: { title: string }): string => {
        return field.title;
      }),
    ).toEqual([
      "Count an answer as bad when it",
      "Or takes longer than (seconds)",
      "Time window",
      "Apps",
      "Model",
    ]);
    expect(mockFormProps!.fields[0]!.dropdownOptions).toHaveLength(5);
    expect(mockFormProps!.fields[3]!.dropdownOptions).toEqual([
      { label: "Support bot", value: SERVICE_ID },
    ]);
    // The model is the one rarely changed: folded under More fields.
    expect(mockFormProps!.fields[4]!.collapsibleSection).toBeTruthy();
    expect(mockFormProps!.fields[0]!.collapsibleSection).toBeUndefined();
    expect(mockFormProps!.fields[1]!.placeholder).toBe("e.g. 30");
    expect(screen.getByTestId("llm-monitor-preview")).toBeInTheDocument();
  });

  test("a change reaches the monitor as a step, and the preview with it", async () => {
    jest.spyOn(API, "post").mockImplementation(async (): Promise<never> => {
      return new Promise(() => {}) as never;
    });

    const onChanged: jest.Mock<(value: MonitorStepLlmMonitor) => void> =
      jest.fn();

    render(
      <MemoryRouter>
        <LlmMonitorStepForm
          monitorStepLlmMonitor={MonitorStepLlmMonitorUtil.getDefault()}
          onMonitorStepLlmMonitorChanged={onChanged}
          telemetryServices={[]}
        />
      </MemoryRouter>,
    );

    act(() => {
      mockFormProps!.onChange({
        issues: [LlmAnswerIssue.Refused],
        slowAnswerSeconds: "45",
        lastXSecondsOfCalls: 1800,
        telemetryServiceIds: [SERVICE_ID],
        model: " gpt-4o ",
      });
    });

    const step: MonitorStepLlmMonitor = onChanged.mock.calls[0]![0];

    expect(step.issues).toEqual([LlmAnswerIssue.Refused]);
    expect(step.slowAnswerSeconds).toBe(45);
    expect(step.lastXSecondsOfCalls).toBe(1800);
    expect(step.telemetryServiceIds.map(String)).toEqual([SERVICE_ID]);
    expect(step.model).toBe("gpt-4o");

    // The preview reads the window the form now shows.
    expect(screen.getByTestId("llm-monitor-preview-window")).toHaveTextContent(
      "Last 30 minutes",
    );
  });

  test("a monitor opened for editing fills the form", () => {
    jest.spyOn(API, "post").mockImplementation(async (): Promise<never> => {
      return new Promise(() => {}) as never;
    });

    render(
      <MemoryRouter>
        <LlmMonitorStepForm
          monitorStepLlmMonitor={{
            ...MonitorStepLlmMonitorUtil.getDefault(),
            issues: [LlmAnswerIssue.Flagged],
            slowAnswerSeconds: 30,
            model: "claude-sonnet-4",
          }}
          onMonitorStepLlmMonitorChanged={jest.fn()}
          telemetryServices={[]}
        />
      </MemoryRouter>,
    );

    expect(mockFormProps!.initialValues).toEqual({
      issues: [LlmAnswerIssue.Flagged],
      slowAnswerSeconds: 30,
      lastXSecondsOfCalls: 900,
      telemetryServiceIds: [],
      model: "claude-sonnet-4",
    });
  });
});
