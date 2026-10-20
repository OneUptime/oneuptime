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
import * as React from "react";
import Span from "../../../Models/AnalyticsModels/Span";
import LlmObservabilityConnection from "../../../Models/DatabaseModels/LlmObservabilityConnection";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import Query from "../../../Types/BaseDatabase/Query";
import { LlmConnectionKind } from "../../../Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "../../../Types/LlmObservability/LlmConnectionProvider";
import ObjectID from "../../../Types/ObjectID";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import LlmConnectPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Llm/Connect";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

/*
 * AI / LLM > CONNECT, the page itself, with the network stubbed and the
 * heavy pieces (the snippets' key picker, the connection lists and the
 * connection form) replaced by markers that show what the page told them:
 *
 *   - the checklist ticks itself from what is true in the project - an
 *     app's AI calls in the last week (a company tool's chats aside), a
 *     provider account, a company AI tool, a budget - and says nothing
 *     about what it could not read;
 *   - a list shows only once something is connected; the tiles count what
 *     the lists hold;
 *   - a tile opens that provider's form, and saving it reads everything
 *     again;
 *   - without the right to connect, the tiles are disabled; without the
 *     right to edit, the lists are told so;
 *   - a plan without telemetry says so and reads nothing.
 */

type TableProps = {
  kind: LlmConnectionKind;
  refreshToggle: string;
  updateGate: PermissionGateResult;
  onConnectionsLoaded: (
    kind: LlmConnectionKind,
    connections: Array<LlmObservabilityConnection>,
  ) => void;
};

type FormProps = {
  provider: LlmConnectionProvider;
  connection?: LlmObservabilityConnection | undefined;
  onClose: () => void;
  onSaved: () => void;
};

// What each list marker reports it loaded; undefined is "still loading".
let listedForTest: Partial<
  Record<LlmConnectionKind, Array<LlmObservabilityConnection>>
> = {};

function listedFor(
  kind: LlmConnectionKind,
): Array<LlmObservabilityConnection> | undefined {
  return listedForTest[kind];
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmAppsPath",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        const ReactActual: typeof React = jest.requireActual(
          "react",
        ) as typeof React;
        return ReactActual.createElement("div", {
          "data-testid": "apps-path",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmConnectionsTable",
  () => {
    return {
      __esModule: true,
      default: (props: TableProps): React.ReactElement => {
        const ReactActual: typeof React = jest.requireActual(
          "react",
        ) as typeof React;

        ReactActual.useEffect(() => {
          const listed: Array<LlmObservabilityConnection> | undefined =
            listedFor(props.kind);

          if (listed) {
            props.onConnectionsLoaded(props.kind, listed);
          }
        }, [props.refreshToggle]);

        return ReactActual.createElement("div", {
          "data-testid": `connections-table-${props.kind}`,
          "data-refresh": props.refreshToggle,
          "data-can-update": String(props.updateGate.isAllowed),
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmConnectionFormModal",
  () => {
    return {
      __esModule: true,
      default: (props: FormProps): React.ReactElement => {
        const ReactActual: typeof React = jest.requireActual(
          "react",
        ) as typeof React;

        return ReactActual.createElement(
          "div",
          {
            "data-testid": "connection-form",
            "data-provider": props.provider,
            "data-editing": String(Boolean(props.connection)),
          },
          ReactActual.createElement(
            "button",
            { type: "button", onClick: props.onSaved },
            "Save the connection",
          ),
          ReactActual.createElement(
            "button",
            { type: "button", onClick: props.onClose },
            "Close the form",
          ),
        );
      },
    };
  },
);

const TOOL_SERVICE_ID: string = "6f1e0c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b";

function connection(
  provider: LlmConnectionProvider,
  serviceId?: string,
): LlmObservabilityConnection {
  const item: LlmObservabilityConnection = new LlmObservabilityConnection();
  item.provider = provider;

  if (serviceId) {
    item.serviceId = new ObjectID(serviceId);
  }

  return item;
}

let connectionsForTest: Array<LlmObservabilityConnection> | Error = [];
let budgetCountForTest: number | Error = 0;
let llmSpansForTest: number | Error = 0;
let createGate: PermissionGateResult = { isAllowed: true };
let updateGate: PermissionGateResult = { isAllowed: true };

let getListSpy: jest.SpyInstance<any, any>;
let countSpy: jest.SpyInstance<any, any>;
let analyticsGetListSpy: jest.SpyInstance<any, any>;
let navigateSpy: jest.SpyInstance<any, any>;
let scrolledTo: Array<string> = [];

const pageProps: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/llm/connect`),
  currentProject: null,
  hasPaymentMethod: true,
};

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/llm/connect`);

  connectionsForTest = [];
  budgetCountForTest = 0;
  llmSpansForTest = 0;
  listedForTest = {};
  createGate = { isAllowed: true };
  updateGate = { isAllowed: true };
  scrolledTo = [];

  getListSpy = getJestSpyOn(ModelAPI, "getList").mockImplementation(
    async (): Promise<unknown> => {
      if (connectionsForTest instanceof Error) {
        throw connectionsForTest;
      }

      return {
        data: connectionsForTest,
        count: connectionsForTest.length,
        skip: 0,
        limit: 100,
      };
    },
  );

  countSpy = getJestSpyOn(ModelAPI, "count").mockImplementation(
    async (): Promise<number> => {
      if (budgetCountForTest instanceof Error) {
        throw budgetCountForTest;
      }

      return budgetCountForTest;
    },
  );

  analyticsGetListSpy = getJestSpyOn(
    AnalyticsModelAPI,
    "getList",
  ).mockImplementation(async (): Promise<unknown> => {
    if (llmSpansForTest instanceof Error) {
      throw llmSpansForTest;
    }

    const data: Array<Span> = [];

    for (let index: number = 0; index < llmSpansForTest; index++) {
      data.push(new Span());
    }

    return { data, count: data.length, skip: 0, limit: 1 };
  });

  getJestSpyOn(PermissionGate, "check").mockImplementation(
    (_model: unknown, action: ModelAction): PermissionGateResult => {
      return action === ModelAction.Create ? createGate : updateGate;
    },
  );

  navigateSpy = getJestSpyOn(Navigation, "navigate").mockImplementation(
    (): void => {},
  );

  Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: function (this: HTMLElement): void {
      scrolledTo.push(this.id);
    },
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function openPage(props: PageComponentProps = pageProps): Promise<void> {
  await act(async () => {
    render(<LlmConnectPage {...props} />);
  });
}

function doneState(key: string): string | null {
  return screen
    .getByTestId(`llm-connect-checklist-${key}`)
    .getAttribute("data-done");
}

function listIsShown(kind: LlmConnectionKind): boolean {
  return !screen
    .getByTestId(`connections-table-${kind}`)
    .parentElement!.classList.contains("hidden");
}

describe("the checklist ticks itself", () => {
  test("nothing yet: four things to do, and no list under the tiles", async () => {
    await openPage();

    await waitFor(() => {
      expect(doneState("apps")).toBe("false");
    });
    expect(doneState("providers")).toBe("false");
    expect(doneState("companyTools")).toBe("false");
    expect(doneState("budget")).toBe("false");
    expect(
      screen.getByTestId("llm-connect-checklist-progress"),
    ).toHaveTextContent("0 of 4 done");

    expect(listIsShown(LlmConnectionKind.ProviderAccount)).toBe(false);
    expect(listIsShown(LlmConnectionKind.CompanyTool)).toBe(false);
  });

  test("everything true: an app's calls, a provider account, a company tool and a budget", async () => {
    connectionsForTest = [
      connection(LlmConnectionProvider.OpenAI),
      connection(LlmConnectionProvider.ClaudeEnterprise, TOOL_SERVICE_ID),
    ];
    llmSpansForTest = 1;
    budgetCountForTest = 2;

    await openPage();

    await waitFor(() => {
      expect(
        screen.getByTestId("llm-connect-checklist-progress"),
      ).toHaveTextContent("4 of 4 done");
    });
    expect(listIsShown(LlmConnectionKind.ProviderAccount)).toBe(true);
    expect(listIsShown(LlmConnectionKind.CompanyTool)).toBe(true);
  });

  test("a company tool alone is not a provider account, and shows only its own list", async () => {
    connectionsForTest = [
      connection(LlmConnectionProvider.Microsoft365Copilot, TOOL_SERVICE_ID),
    ];

    await openPage();

    await waitFor(() => {
      expect(doneState("companyTools")).toBe("true");
    });
    expect(doneState("providers")).toBe("false");
    expect(listIsShown(LlmConnectionKind.CompanyTool)).toBe(true);
    expect(listIsShown(LlmConnectionKind.ProviderAccount)).toBe(false);
  });

  test("the AI calls tick reads one of an app's calls from the last week, a company tool's chats left out", async () => {
    connectionsForTest = [
      connection(LlmConnectionProvider.ClaudeEnterprise, TOOL_SERVICE_ID),
    ];

    await openPage();

    await waitFor(() => {
      expect(analyticsGetListSpy).toHaveBeenCalledTimes(1);
    });

    const request: {
      modelType: unknown;
      query: Query<Span>;
      limit: number;
      select: Record<string, boolean>;
    } = analyticsGetListSpy.mock.calls[0]![0];

    expect(request.modelType).toBe(Span);
    expect(request.limit).toBe(1);
    expect(request.select).toEqual({ spanId: true });
    expect(request.query.isLlmSpan).toBe(true);
    expect(String(request.query.projectId)).toBe(PROJECT_ID);

    const excluded: IncludesNone = request.query
      .primaryEntityId as unknown as IncludesNone;

    expect(excluded).toBeInstanceOf(IncludesNone);
    expect(excluded.values.map(String)).toEqual([TOOL_SERVICE_ID]);

    const window: InBetween<Date> = request.query
      .startTime as unknown as InBetween<Date>;
    const days: number =
      (new Date(window.endValue).getTime() -
        new Date(window.startValue).getTime()) /
      (24 * 60 * 60 * 1000);

    expect(window).toBeInstanceOf(InBetween);
    expect(Math.round(days)).toBe(7);
  });

  test("with no company tool, no service is left out", async () => {
    connectionsForTest = [connection(LlmConnectionProvider.Anthropic)];

    await openPage();

    await waitFor(() => {
      expect(analyticsGetListSpy).toHaveBeenCalledTimes(1);
    });

    expect(
      analyticsGetListSpy.mock.calls[0]![0].query.primaryEntityId,
    ).toBeUndefined();
  });

  test("the connections and the budgets are read for this project only", async () => {
    await openPage();

    await waitFor(() => {
      expect(countSpy).toHaveBeenCalledTimes(1);
    });

    expect(String(getListSpy.mock.calls[0]![0].query.projectId)).toBe(
      PROJECT_ID,
    );
    expect(String(countSpy.mock.calls[0]![0].query.projectId)).toBe(PROJECT_ID);
  });

  test("what could not be read is neither done nor to do", async () => {
    connectionsForTest = new Error("Forbidden");
    llmSpansForTest = new Error("Forbidden");
    budgetCountForTest = new Error("Forbidden");

    await openPage();

    await waitFor(() => {
      expect(countSpy).toHaveBeenCalled();
    });

    for (const key of ["apps", "providers", "companyTools", "budget"]) {
      expect(doneState(key)).toBe("unknown");
    }
  });

  test("the lists are the freshest word: a connection deleted from one is no longer counted", async () => {
    connectionsForTest = [connection(LlmConnectionProvider.OpenAI)];
    listedForTest = {
      [LlmConnectionKind.ProviderAccount]: [],
      [LlmConnectionKind.CompanyTool]: [],
    };

    await openPage();

    await waitFor(() => {
      expect(getListSpy).toHaveBeenCalled();
    });

    expect(doneState("providers")).toBe("false");
  });
});

describe("the tiles and the lists", () => {
  test("a tile counts what its list holds", async () => {
    listedForTest = {
      [LlmConnectionKind.ProviderAccount]: [
        connection(LlmConnectionProvider.AzureOpenAI),
        connection(LlmConnectionProvider.AzureOpenAI),
        connection(LlmConnectionProvider.OpenAI),
      ],
      [LlmConnectionKind.CompanyTool]: [],
    };

    await openPage();

    expect(
      screen.getByTestId(
        `llm-connection-tile-${LlmConnectionProvider.AzureOpenAI}`,
      ),
    ).toHaveTextContent("Connected (2)");
    expect(
      screen.getByTestId(`llm-connection-tile-${LlmConnectionProvider.OpenAI}`),
    ).toHaveTextContent("Connect another");
    expect(listIsShown(LlmConnectionKind.ProviderAccount)).toBe(true);
    expect(listIsShown(LlmConnectionKind.CompanyTool)).toBe(false);
  });

  test("a tile opens that provider's form, for a new connection", async () => {
    await openPage();

    fireEvent.click(
      screen.getByTestId(
        `llm-connection-tile-${LlmConnectionProvider.AwsBedrock}`,
      ),
    );

    const form: HTMLElement = screen.getByTestId("connection-form");

    expect(form).toHaveAttribute(
      "data-provider",
      LlmConnectionProvider.AwsBedrock,
    );
    expect(form).toHaveAttribute("data-editing", "false");
  });

  test("saving the form closes it and reads everything again", async () => {
    await openPage();

    await waitFor(() => {
      expect(getListSpy).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(
      screen.getByTestId(
        `llm-connection-tile-${LlmConnectionProvider.Microsoft365Copilot}`,
      ),
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Save the connection"));
    });

    expect(screen.queryByTestId("connection-form")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(getListSpy).toHaveBeenCalledTimes(2);
    });
    expect(
      screen.getByTestId(`connections-table-${LlmConnectionKind.CompanyTool}`),
    ).toHaveAttribute("data-refresh", "1");
  });

  test("closing the form changes nothing", async () => {
    await openPage();

    fireEvent.click(
      screen.getByTestId(`llm-connection-tile-${LlmConnectionProvider.OpenAI}`),
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Close the form"));
    });

    expect(screen.queryByTestId("connection-form")).not.toBeInTheDocument();
    expect(getListSpy).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId(
        `connections-table-${LlmConnectionKind.ProviderAccount}`,
      ),
    ).toHaveAttribute("data-refresh", "0");
  });
});

describe("permissions", () => {
  test("without the right to connect, no tile opens a form", async () => {
    createGate = {
      isAllowed: false,
      disabledReason:
        "You do not have permission to create this AI Connection.",
    };

    await openPage();

    const tiles: Array<HTMLElement> = screen
      .getAllByRole("button")
      .filter((button: HTMLElement): boolean => {
        return (button.getAttribute("data-testid") || "").startsWith(
          "llm-connection-tile-",
        );
      });

    expect(tiles).toHaveLength(7);

    for (const tile of tiles) {
      expect(tile).toBeDisabled();
      fireEvent.click(tile);
    }

    expect(screen.queryByTestId("connection-form")).not.toBeInTheDocument();
  });

  test("without the right to edit, the lists are told so", async () => {
    updateGate = { isAllowed: false };

    await openPage();

    for (const kind of [
      LlmConnectionKind.ProviderAccount,
      LlmConnectionKind.CompanyTool,
    ]) {
      expect(screen.getByTestId(`connections-table-${kind}`)).toHaveAttribute(
        "data-can-update",
        "false",
      );
    }
  });

  test("a plan without telemetry says so, and nothing is read", async () => {
    await openPage({
      ...pageProps,
      currentProject: {
        reseller: { enableTelemetryFeatures: false },
      } as unknown as Project,
    });

    expect(
      screen.getByText(/Telemetry features are disabled for this project/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("llm-connect-page")).not.toBeInTheDocument();
    expect(getListSpy).not.toHaveBeenCalled();
    expect(analyticsGetListSpy).not.toHaveBeenCalled();
    expect(countSpy).not.toHaveBeenCalled();
  });
});

describe("the three ways in", () => {
  test("your apps, your provider accounts and your company's AI tools, in that order", async () => {
    await openPage();

    const page: HTMLElement = screen.getByTestId("llm-connect-page");
    const text: string = page.textContent || "";

    expect(text.indexOf("Your apps")).toBeGreaterThan(-1);
    expect(text.indexOf("Your apps")).toBeLessThan(
      text.indexOf("Your AI provider accounts"),
    );
    expect(text.indexOf("Your AI provider accounts")).toBeLessThan(
      text.indexOf("Your company's AI tools"),
    );
  });

  test("the company tools part asks you to tell your people, and covers the tools with no API", async () => {
    await openPage();

    const section: HTMLElement = document.getElementById(
      "llm-connect-company-tools-section",
    )!;

    expect(
      within(section).getByTestId("llm-tell-your-people"),
    ).toBeInTheDocument();
    expect(
      within(section).getByTestId("llm-other-ai-tools"),
    ).toBeInTheDocument();
    expect(section).toHaveTextContent(
      "Only project owners and admins can read them, unless you choose otherwise.",
    );
  });

  test("a checklist line scrolls to its part of the page; the budget opens Budgets", async () => {
    await openPage();

    await waitFor(() => {
      expect(doneState("apps")).toBe("false");
    });

    fireEvent.click(screen.getByTestId("llm-connect-checklist-open-apps"));
    fireEvent.click(screen.getByTestId("llm-connect-checklist-open-providers"));
    fireEvent.click(
      screen.getByTestId("llm-connect-checklist-open-companyTools"),
    );

    expect(scrolledTo).toEqual([
      "llm-connect-apps-section",
      "llm-connect-providers-section",
      "llm-connect-company-tools-section",
    ]);

    fireEvent.click(screen.getByTestId("llm-connect-checklist-open-budget"));

    expect(String(navigateSpy.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID}/llm/budgets`,
    );
  });
});

// The markers stand in for real modules: make sure they are the ones used.
test("the page is drawn with its real checklist and tiles", async () => {
  await openPage();

  expect(screen.getByTestId("apps-path")).toBeInTheDocument();
  expect(screen.getByTestId("llm-connect-checklist")).toBeInTheDocument();
  expect(
    screen.getByTestId(
      `llm-connection-tiles-${LlmConnectionKind.ProviderAccount}`,
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByTestId(`llm-connection-tiles-${LlmConnectionKind.CompanyTool}`),
  ).toBeInTheDocument();
});
