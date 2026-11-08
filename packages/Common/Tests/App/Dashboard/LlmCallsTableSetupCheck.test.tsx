import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * AI / LLM > CALLS (#5776): an OpenAI or Azure OpenAI call reads as what it
 * was - its provider by name ("Azure OpenAI", not "azure.ai.openai" or
 * "az.ai.openai"), the deployment it asked for and the model that served
 * it, how long it took - and an empty list says why, from the project's
 * setup check, instead of a sentence about instrumenting apps in general.
 *
 * The table is mocked to capture its props (LlmCallsTableIdentity does the
 * same): the cells' getElement closures are rendered directly, and the
 * empty state is read as the table would draw it.
 */

type CapturedColumn = {
  field: Record<string, boolean>;
  title: string;
  isHiddenByDefault?: boolean | undefined;
  getElement?: ((item: Span) => React.ReactElement) | undefined;
  getExportValue?: ((item: Span) => string) | undefined;
};

type CapturedAction = {
  title: string;
  onClick: () => void;
  style?: string | undefined;
  dataTestId?: string | undefined;
};

type CapturedTableProps = {
  columns?: Array<CapturedColumn>;
  noItemsMessage?: unknown;
  emptyState?: {
    title?: string;
    description?: React.ReactElement | string;
    actions?: Array<CapturedAction>;
    hideCreateButton?: boolean;
  };
  onFetchSuccess?: (data: Array<Span>, totalCount: number) => void;
};

let capturedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/AnalyticsModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      return null;
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();

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

const fetchCheckMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmObservabilityReads",
  () => {
    return {
      __esModule: true,
      fetchLlmSetupCheck: (...args: Array<unknown>) => {
        return fetchCheckMock(...args);
      },
    };
  },
);

const navigateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (...args: Array<unknown>) => {
        return navigateMock(...args);
      },
      getCurrentRoute: () => {
        return {
          toString: () => {
            return "/dashboard";
          },
        };
      },
      getQueryStringByName: () => {
        return null;
      },
    },
  };
});

import LlmCallsTable from "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmCallsTable";
import Span from "../../../Models/AnalyticsModels/Span";
import Service from "../../../Models/DatabaseModels/Service";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import LlmConnectionProvider from "../../../Types/LlmObservability/LlmConnectionProvider";
import { LlmSetupCheckResponse } from "../../../Types/Telemetry/LlmSetupCheckApi";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SERVICE_ID: string = "22222222-2222-4222-8222-222222222222";

function columnByTitle(title: string): CapturedColumn {
  const column: CapturedColumn | undefined = capturedTableProps?.columns?.find(
    (candidate: CapturedColumn): boolean => {
      return candidate.title === title;
    },
  );

  expect(column).toBeDefined();

  return column!;
}

function spanWith(values: Partial<Record<keyof Span, unknown>>): Span {
  const span: Span = new Span();

  for (const key of Object.keys(values)) {
    (span as unknown as Record<string, unknown>)[key] =
      values[key as keyof Span];
  }

  return span;
}

function cellText(column: string, span: Span): string {
  const rendered: ReturnType<typeof render> = render(
    columnByTitle(column).getElement!(span),
  );
  const text: string = rendered.container.textContent || "";

  rendered.unmount();

  return text;
}

async function renderTable(): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <LlmCallsTable />
      </MemoryRouter>,
    );
  });

  expect(capturedTableProps).not.toBeNull();
}

function emptyDescription(): string {
  const description: React.ReactElement | string | undefined =
    capturedTableProps?.emptyState?.description;

  if (typeof description === "string") {
    return description;
  }

  const rendered: ReturnType<typeof render> = render(description!);
  const text: string = rendered.container.textContent || "";

  rendered.unmount();

  return text;
}

function checkWith(
  overrides: Partial<LlmSetupCheckResponse>,
): LlmSetupCheckResponse {
  return {
    checkedAt: new Date().toISOString(),
    apps: {
      callsInWindow: null,
      callsRecently: 0,
      newestCallAt: null,
      services: [],
      providers: [],
      answersRecently: 0,
      answersWithContent: 0,
      contentInLogs: null,
      uninstrumented: null,
    },
    metrics: [],
    connections: [],
    ...overrides,
  };
}

async function listComesBack(totalCount: number): Promise<void> {
  await act(async () => {
    capturedTableProps!.onFetchSuccess!([], totalCount);
  });
  // The check's promise, then its state.
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  capturedTableProps = null;
  fetchCheckMock.mockReset();
  navigateMock.mockReset();
  getListMock.mockReset();
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 0 });
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a call's provider", () => {
  test.each([
    ["azure.ai.openai", "Azure OpenAI"],
    ["az.ai.openai", "Azure OpenAI"],
    ["azure.ai.inference", "Azure AI Inference"],
    ["az.ai.inference", "Azure AI Inference"],
    ["openai", "OpenAI"],
    ["OpenAI", "OpenAI"],
    ["aws.bedrock", "Amazon Bedrock"],
    ["my-gateway", "my-gateway"],
  ])("%s reads as %s", async (stored: string, title: string) => {
    await renderTable();

    expect(cellText("Provider", spanWith({ llmSystem: stored }))).toBe(title);
  });

  test("no provider is a dash", async () => {
    await renderTable();

    expect(cellText("Provider", spanWith({ llmSystem: "" }))).toBe("—");
  });

  test("an export keeps the stored value, so a filter on it still matches", async () => {
    await renderTable();

    expect(
      columnByTitle("Provider").getExportValue!(
        spanWith({ llmSystem: "azure.ai.openai" }),
      ),
    ).toBe("azure.ai.openai");
  });
});

describe("a call's model", () => {
  test("an Azure deployment: the deployment asked for, and the model that served it", async () => {
    await renderTable();

    const span: Span = spanWith({
      llmRequestModel: "support-chat",
      llmResponseModel: "gpt-4o-2024-08-06",
    });

    expect(cellText("Model", span)).toBe("support-chatgpt-4o-2024-08-06");

    const rendered: ReturnType<typeof render> = render(
      columnByTitle("Model").getElement!(span),
    );

    expect(rendered.getByTestId("llm-call-served-model")).toHaveTextContent(
      "gpt-4o-2024-08-06",
    );
  });

  test.each([
    ["gpt-4o", "gpt-4o-2024-08-06"],
    ["gpt-4o", "gpt-4o"],
    ["GPT-4o", "gpt-4o-2024-08-06"],
  ])(
    "%s served by %s is one model: not said twice",
    async (requested: string, served: string) => {
      await renderTable();

      const rendered: ReturnType<typeof render> = render(
        columnByTitle("Model").getElement!(
          spanWith({ llmRequestModel: requested, llmResponseModel: served }),
        ),
      );

      expect(rendered.container).toHaveTextContent(requested);
      expect(
        rendered.queryByTestId("llm-call-served-model"),
      ).not.toBeInTheDocument();
    },
  );

  test("only the served model known: that one", async () => {
    await renderTable();

    expect(
      cellText(
        "Model",
        spanWith({ llmRequestModel: "", llmResponseModel: "gpt-4.1-mini" }),
      ),
    ).toBe("gpt-4.1-mini");
  });

  test("no model: a dash", async () => {
    await renderTable();

    expect(cellText("Model", spanWith({}))).toBe("—");
  });

  test("an export keeps the model asked for", async () => {
    await renderTable();

    expect(
      columnByTitle("Model").getExportValue!(
        spanWith({
          llmRequestModel: "support-chat",
          llmResponseModel: "gpt-4o-2024-08-06",
        }),
      ),
    ).toBe("support-chat");
  });
});

describe("how long a call took", () => {
  test.each([
    [850_000_000, "850 ms"],
    [2_300_000_000, "2.3 s"],
    [42_000_000_000, "42 s"],
    [999_600_000, "1.0 s"],
  ])("%d ns reads %s", async (nanos: number, text: string) => {
    await renderTable();

    expect(cellText("Duration", spanWith({ durationUnixNano: nanos }))).toBe(
      text,
    );
    expect(
      columnByTitle("Duration").getExportValue!(
        spanWith({ durationUnixNano: nanos }),
      ),
    ).toBe(text);
  });

  test.each([[0], [undefined], [Number.NaN]])(
    "%p: a dash, never 0 ms",
    async (nanos: number | undefined) => {
      await renderTable();

      expect(cellText("Duration", spanWith({ durationUnixNano: nanos }))).toBe(
        "—",
      );
      expect(
        columnByTitle("Duration").getExportValue!(
          spanWith({ durationUnixNano: nanos }),
        ),
      ).toBe("");
    },
  );

  test("read from the span's own duration", async () => {
    await renderTable();

    expect(columnByTitle("Duration").field).toEqual({
      durationUnixNano: true,
    });
  });
});

describe("an empty Calls list says why", () => {
  test("before the list comes back, nothing is asked; the generic sentence is gone", async () => {
    await renderTable();

    expect(fetchCheckMock).not.toHaveBeenCalled();
    expect(capturedTableProps?.noItemsMessage).toBeUndefined();
    expect(capturedTableProps?.emptyState?.hideCreateButton).toBe(true);
  });

  test("a list with calls never asks", async () => {
    await renderTable();
    await listComesBack(12);

    expect(fetchCheckMock).not.toHaveBeenCalled();
  });

  test("an empty list asks once, for the project, without a window", async () => {
    fetchCheckMock.mockReturnValue(new Promise(() => {}) as never);

    await renderTable();
    await listComesBack(0);

    expect(fetchCheckMock).toHaveBeenCalledTimes(1);
    expect(fetchCheckMock.mock.calls[0]![0]).toBeUndefined();

    // While it reads: the view's own heading, and that it is checking.
    expect(capturedTableProps?.emptyState?.title).toBe("No AI calls here yet");
    expect(emptyDescription()).toBe("Checking what your AI is sending…");
    expect(capturedTableProps?.emptyState?.actions).toEqual([]);

    await listComesBack(0);

    expect(fetchCheckMock).toHaveBeenCalledTimes(1);
  });

  test("connected provider accounts and no app calls: accounts bring usage, never a call", async () => {
    fetchCheckMock.mockResolvedValue(
      checkWith({
        connections: [
          {
            connectionId: "c1",
            name: "Azure production",
            provider: LlmConnectionProvider.AzureOpenAI,
            kind: "provider-account",
            isEnabled: true,
            lastReadAt: new Date().toISOString(),
            lastSuccessfulReadAt: new Date().toISOString(),
            lastError: "",
            newestUsageAt: "2026-11-03T00:00:00.000Z",
            resources: 2,
            readSince: null,
            callsRecently: null,
          },
        ],
      }) as never,
    );

    await renderTable();
    await listComesBack(0);

    expect(capturedTableProps?.emptyState?.title).toBe(
      "AI calls come from your apps",
    );
    expect(emptyDescription()).toBe(
      "Your connected provider account reports usage and cost by day, never a call or a conversation. None of your apps has sent an AI call in the past 7 days.",
    );

    const actions: Array<CapturedAction> =
      capturedTableProps?.emptyState?.actions || [];

    expect(
      actions.map((action: CapturedAction) => {
        return [action.title, action.dataTestId];
      }),
    ).toEqual([
      ["Send your app's AI calls", "llm-empty-send-calls"],
      ["See provider usage", "llm-empty-see-provider-usage"],
    ]);

    actions[0]!.onClick();
    actions[1]!.onClick();

    const routes: Array<string> = navigateMock.mock.calls.map(
      (call: Array<unknown>): string => {
        return String(call[0]);
      },
    );

    expect(routes[0]).toContain("llm/connect");
    expect(routes[0]).toContain("way=apps");
    expect(routes[1]).toContain("llm/usage");
    expect(routes[1]).toContain("source=providers");
  });

  test("an app calling Azure OpenAI that nothing records: the app by name", async () => {
    const service: Service = new Service();
    service.id = new ObjectID(SERVICE_ID);
    service.name = "checkout";
    getListMock.mockResolvedValue({
      data: [service],
      count: 1,
      skip: 0,
      limit: 1,
    });
    fetchCheckMock.mockResolvedValue(
      checkWith({
        apps: {
          callsInWindow: null,
          callsRecently: 0,
          newestCallAt: null,
          services: [],
          providers: [],
          answersRecently: 0,
          answersWithContent: 0,
          contentInLogs: null,
          uninstrumented: [
            {
              serviceId: SERVICE_ID,
              host: "contoso.openai.azure.com",
              provider: "azure.ai.openai",
              calls: 9,
            },
          ],
        },
      }) as never,
    );

    await renderTable();
    await listComesBack(0);

    expect(capturedTableProps?.emptyState?.title).toBe(
      "Your app's AI calls aren't recorded",
    );
    expect(emptyDescription()).toContain(
      "checkout called contoso.openai.azure.com 9 times in the past day",
    );
  });

  /*
   * Calls lists every call, with no time range of its own: "your newest
   * call is outside this range" can never be why it is empty.
   */
  test("never says the time range is why", async () => {
    fetchCheckMock.mockResolvedValue(
      checkWith({
        apps: {
          callsInWindow: 0,
          callsRecently: 0,
          newestCallAt: "2026-10-01T00:00:00.000Z",
          services: [],
          providers: [],
          answersRecently: 0,
          answersWithContent: 0,
          contentInLogs: null,
          uninstrumented: null,
        },
      }) as never,
    );

    await renderTable();
    await listComesBack(0);

    expect(capturedTableProps?.emptyState?.title).toBe("No AI calls here yet");
    expect(
      (capturedTableProps?.emptyState?.actions || []).map(
        (action: CapturedAction) => {
          return action.dataTestId;
        },
      ),
    ).toEqual(["llm-empty-send-calls"]);
  });

  test("a check that cannot be read: the view's own empty words", async () => {
    fetchCheckMock.mockRejectedValue(new Error("Timeout exceeded") as never);

    await renderTable();
    await listComesBack(0);

    expect(capturedTableProps?.emptyState?.title).toBe("No AI calls here yet");
    expect(emptyDescription()).toBe(
      "Every AI call your apps send shows here: its model, tokens, cost, time and errors, with the app and the person that made it.",
    );
  });

  test("the diagnosis sentence can be found on the page", async () => {
    fetchCheckMock.mockResolvedValue(checkWith({}) as never);

    await renderTable();
    await listComesBack(0);

    render(capturedTableProps!.emptyState!.description as React.ReactElement);

    expect(screen.getByTestId("llm-calls-diagnosis")).toBeInTheDocument();
  });
});
