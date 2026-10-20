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
import { llmConnectWayChoice } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmConnectWayPicker";
import { LLM_CONNECT_WAY_STORAGE_KEY } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmConnectWays";

/*
 * AI / LLM > CONNECT, the page itself, with the network stubbed and the
 * heavy pieces (the snippets' key picker, the connection lists and the
 * connection form) replaced by markers that show what the page told them:
 *
 *   - the three ways in are the page's tabs: your apps first, the one the
 *     address names, or the reader's last pick; one shown at a time;
 *   - each way ticks itself from what is true in the project - an app's AI
 *     calls in the last week (a company tool's chats aside), provider
 *     accounts and company AI tools connected, and how many of them are
 *     not working - and says nothing about what it could not read;
 *   - once something works and there is no budget, a daily budget is the
 *     next step;
 *   - a list shows only once something is connected, and stays when its
 *     search finds nothing; a list that reloads has the connections read
 *     again; the tiles count every connection of the project;
 *   - a tile opens that provider's form, and saving it reads everything
 *     again;
 *   - without the right to connect, the tiles are disabled and say why in
 *     words; without the right to edit, the lists are told so;
 *   - a plan without telemetry says so and reads nothing.
 */

type TableProps = {
  kind: LlmConnectionKind;
  refreshToggle: string;
  updateGate: PermissionGateResult;
  onConnectionsLoaded: (kind: LlmConnectionKind, totalCount: number) => void;
};

type FormProps = {
  provider: LlmConnectionProvider;
  connection?: LlmObservabilityConnection | undefined;
  onClose: () => void;
  onSaved: () => void;
};

// How many rows each list marker reports it found; undefined: still loading.
let listedForTest: Partial<Record<LlmConnectionKind, number>> = {};

function listedFor(kind: LlmConnectionKind): number | undefined {
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
          const listed: number | undefined = listedFor(props.kind);

          if (listed !== undefined) {
            props.onConnectionsLoaded(props.kind, listed);
          }
        }, [props.refreshToggle]);

        return ReactActual.createElement(
          "div",
          {
            "data-testid": `connections-table-${props.kind}`,
            "data-refresh": props.refreshToggle,
            "data-can-update": String(props.updateGate.isAllowed),
          },
          // What a delete, a search or a turn-off in the list does: it loads.
          ReactActual.createElement(
            "button",
            {
              type: "button",
              onClick: () => {
                props.onConnectionsLoaded(props.kind, listedFor(props.kind) || 0);
              },
            },
            `Reload ${props.kind}`,
          ),
        );
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
  fields: Partial<{
    serviceId: string;
    isEnabled: boolean;
    lastError: string;
    lastPulledAt: Date;
    lastSuccessfulPullAt: Date;
  }> = {},
): LlmObservabilityConnection {
  const item: LlmObservabilityConnection = new LlmObservabilityConnection();
  item.provider = provider;

  if (fields.serviceId) {
    item.serviceId = new ObjectID(fields.serviceId);
  }

  if (fields.isEnabled !== undefined) {
    item.isEnabled = fields.isEnabled;
  }

  if (fields.lastError) {
    item.lastError = fields.lastError;
  }

  if (fields.lastPulledAt) {
    item.lastPulledAt = fields.lastPulledAt;
  }

  if (fields.lastSuccessfulPullAt) {
    item.lastSuccessfulPullAt = fields.lastSuccessfulPullAt;
  }

  return item;
}

// A connection whose last read failed after nothing ever worked.
function failing(provider: LlmConnectionProvider): LlmObservabilityConnection {
  return connection(provider, {
    lastError: "HTTP 403: AuthorizationFailed",
    lastPulledAt: new Date("2026-10-19T11:50:00.000Z"),
  });
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
// Where a panel's top is, as getBoundingClientRect answers it.
let panelTop: number = 400;

const pageProps: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/llm/connect`),
  currentProject: null,
  hasPaymentMethod: true,
};

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/llm/connect`);
  window.localStorage.clear();
  llmConnectWayChoice.resetForTesting();

  connectionsForTest = [];
  budgetCountForTest = 0;
  llmSpansForTest = 0;
  listedForTest = {};
  createGate = { isAllowed: true };
  updateGate = { isAllowed: true };
  scrolledTo = [];
  panelTop = 400;

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

  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: 900,
  });

  getJestSpyOn(
    window.HTMLElement.prototype,
    "getBoundingClientRect",
  ).mockImplementation(function (this: HTMLElement): DOMRect {
    const top: number = this.getAttribute("role") === "tabpanel" ? panelTop : 0;
    return {
      top,
      bottom: top + 100,
      left: 0,
      right: 100,
      width: 100,
      height: 100,
      x: 0,
      y: top,
      toJSON: (): string => {
        return "";
      },
    } as DOMRect;
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

function way(key: string): HTMLElement {
  return screen.getByTestId(`llm-connect-way-${key}`);
}

function doneState(key: string): string | null {
  return way(key).getAttribute("data-done");
}

function panel(key: string): HTMLElement {
  return screen.getByTestId(`llm-connect-panel-${key}`);
}

function listIsShown(kind: LlmConnectionKind): boolean {
  return !screen
    .getByTestId(`connections-table-${kind}`)
    .parentElement!.classList.contains("hidden");
}

describe("the three ways tick themselves", () => {
  test("nothing yet: no way is done, nothing to say on any, and no list under the tiles", async () => {
    await openPage();

    await waitFor(() => {
      expect(doneState("apps")).toBe("false");
    });
    expect(doneState("providers")).toBe("false");
    expect(doneState("tools")).toBe("false");

    for (const key of ["apps", "providers", "tools"]) {
      expect(
        screen.queryByTestId(`llm-connect-way-${key}-status`),
      ).not.toBeInTheDocument();
    }

    expect(listIsShown(LlmConnectionKind.ProviderAccount)).toBe(false);
    expect(listIsShown(LlmConnectionKind.CompanyTool)).toBe(false);
  });

  test("everything true: an app's calls, a provider account and a company tool", async () => {
    connectionsForTest = [
      connection(LlmConnectionProvider.OpenAI),
      connection(LlmConnectionProvider.ClaudeEnterprise, {
        serviceId: TOOL_SERVICE_ID,
      }),
    ];
    llmSpansForTest = 1;
    budgetCountForTest = 2;

    await openPage();

    await waitFor(() => {
      expect(doneState("apps")).toBe("true");
    });
    expect(doneState("providers")).toBe("true");
    expect(doneState("tools")).toBe("true");

    expect(screen.getByTestId("llm-connect-way-apps-receiving")).toHaveTextContent(
      "Receiving AI calls",
    );
    expect(
      screen.getByTestId("llm-connect-way-providers-connected"),
    ).toHaveTextContent("Connected");
    expect(
      screen.getByTestId("llm-connect-way-tools-connected"),
    ).toHaveTextContent("Connected");

    expect(listIsShown(LlmConnectionKind.ProviderAccount)).toBe(true);
    expect(listIsShown(LlmConnectionKind.CompanyTool)).toBe(true);
  });

  test("several accounts are counted, and one not working is said", async () => {
    connectionsForTest = [
      connection(LlmConnectionProvider.OpenAI, {
        lastPulledAt: new Date("2026-10-19T11:45:00.000Z"),
        lastSuccessfulPullAt: new Date("2026-10-19T11:45:00.000Z"),
      }),
      failing(LlmConnectionProvider.AzureOpenAI),
      // Turned off: counted, never "not working".
      connection(LlmConnectionProvider.AwsBedrock, {
        isEnabled: false,
        lastError: "HTTP 403",
      }),
    ];

    await openPage();

    await waitFor(() => {
      expect(
        screen.getByTestId("llm-connect-way-providers-connected"),
      ).toHaveTextContent("Connected (3)");
    });
    expect(
      screen.getByTestId("llm-connect-way-providers-failing"),
    ).toHaveTextContent("Not working");
    expect(
      screen.queryByTestId("llm-connect-way-tools-failing"),
    ).not.toBeInTheDocument();
  });

  test("a company tool alone is not a provider account, and shows only its own list", async () => {
    connectionsForTest = [
      connection(LlmConnectionProvider.Microsoft365Copilot, {
        serviceId: TOOL_SERVICE_ID,
      }),
    ];

    await openPage();

    await waitFor(() => {
      expect(doneState("tools")).toBe("true");
    });
    expect(doneState("providers")).toBe("false");
    expect(listIsShown(LlmConnectionKind.CompanyTool)).toBe(true);
    expect(listIsShown(LlmConnectionKind.ProviderAccount)).toBe(false);
  });

  test("the AI calls tick reads one of an app's calls from the last week, a company tool's chats left out", async () => {
    connectionsForTest = [
      connection(LlmConnectionProvider.ClaudeEnterprise, {
        serviceId: TOOL_SERVICE_ID,
      }),
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

  test("the connections are read with their health, for this project only, and so are the budgets", async () => {
    await openPage();

    await waitFor(() => {
      expect(countSpy).toHaveBeenCalledTimes(1);
    });

    const read: {
      query: Record<string, unknown>;
      select: Record<string, boolean>;
    } = getListSpy.mock.calls[0]![0];

    expect(String(read.query["projectId"])).toBe(PROJECT_ID);
    expect(read.select).toMatchObject({
      provider: true,
      serviceId: true,
      isEnabled: true,
      lastPulledAt: true,
      lastSuccessfulPullAt: true,
      lastError: true,
    });
    expect(String(countSpy.mock.calls[0]![0].query.projectId)).toBe(PROJECT_ID);
  });

  test("what could not be read is neither done nor to do, and suggests nothing", async () => {
    connectionsForTest = new Error("Forbidden");
    llmSpansForTest = new Error("Forbidden");
    budgetCountForTest = new Error("Forbidden");

    await openPage();

    await waitFor(() => {
      expect(countSpy).toHaveBeenCalled();
    });

    for (const key of ["apps", "providers", "tools"]) {
      expect(doneState(key)).toBe("unknown");
    }

    expect(
      screen.queryByTestId("llm-connect-budget-hint"),
    ).not.toBeInTheDocument();
  });

  test("a list that loads again has the connections read again: a deleted one is no longer counted", async () => {
    connectionsForTest = [connection(LlmConnectionProvider.OpenAI)];
    listedForTest = { [LlmConnectionKind.ProviderAccount]: 1 };

    await openPage();

    await waitFor(() => {
      expect(doneState("providers")).toBe("true");
    });
    expect(getListSpy).toHaveBeenCalledTimes(1);

    // The connection is deleted from its list, which loads again.
    connectionsForTest = [];
    listedForTest = { [LlmConnectionKind.ProviderAccount]: 0 };

    await act(async () => {
      fireEvent.click(
        screen.getByText(`Reload ${LlmConnectionKind.ProviderAccount}`),
      );
    });

    await waitFor(() => {
      expect(doneState("providers")).toBe("false");
    });
    expect(getListSpy).toHaveBeenCalledTimes(2);
    expect(
      screen.getByTestId(
        `llm-connection-tile-${LlmConnectionProvider.OpenAI}`,
      ),
    ).not.toHaveTextContent("Connected");
  });

  test("the first load of a list reads nothing more", async () => {
    connectionsForTest = [connection(LlmConnectionProvider.OpenAI)];
    listedForTest = {
      [LlmConnectionKind.ProviderAccount]: 1,
      [LlmConnectionKind.CompanyTool]: 0,
    };

    await openPage();

    await waitFor(() => {
      expect(doneState("providers")).toBe("true");
    });
    expect(getListSpy).toHaveBeenCalledTimes(1);
  });

  test("a list that has shown a row stays when its search finds nothing", async () => {
    connectionsForTest = [connection(LlmConnectionProvider.OpenAI)];
    listedForTest = { [LlmConnectionKind.ProviderAccount]: 1 };

    await openPage();

    await waitFor(() => {
      expect(listIsShown(LlmConnectionKind.ProviderAccount)).toBe(true);
    });

    // A search for a name no connection has: the list finds nothing...
    listedForTest = { [LlmConnectionKind.ProviderAccount]: 0 };
    // ...and, read with no search, the project still has none of the kind.
    connectionsForTest = [];

    await act(async () => {
      fireEvent.click(
        screen.getByText(`Reload ${LlmConnectionKind.ProviderAccount}`),
      );
    });

    await waitFor(() => {
      expect(getListSpy).toHaveBeenCalledTimes(2);
    });
    // Still there, so the search can be cleared.
    expect(listIsShown(LlmConnectionKind.ProviderAccount)).toBe(true);
  });
});

describe("the next step: a daily budget", () => {
  test("once something works and there is no budget, it is suggested, and opens Budgets", async () => {
    llmSpansForTest = 1;

    await openPage();

    await waitFor(() => {
      expect(screen.getByTestId("llm-connect-budget-hint")).toBeInTheDocument();
    });
    expect(screen.getByTestId("llm-connect-budget-hint")).toHaveTextContent(
      "Set a daily budget",
    );

    fireEvent.click(screen.getByTestId("llm-connect-budget-open"));

    expect(String(navigateSpy.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID}/llm/budgets`,
    );
  });

  test("a connected company tool is something that works too", async () => {
    connectionsForTest = [
      connection(LlmConnectionProvider.ClaudeEnterprise, {
        serviceId: TOOL_SERVICE_ID,
      }),
    ];

    await openPage();

    await waitFor(() => {
      expect(screen.getByTestId("llm-connect-budget-hint")).toBeInTheDocument();
    });
  });

  test("not before anything works", async () => {
    await openPage();

    await waitFor(() => {
      expect(countSpy).toHaveBeenCalled();
    });

    expect(
      screen.queryByTestId("llm-connect-budget-hint"),
    ).not.toBeInTheDocument();
  });

  test("not once a budget is set", async () => {
    llmSpansForTest = 1;
    budgetCountForTest = 1;

    await openPage();

    await waitFor(() => {
      expect(doneState("apps")).toBe("true");
    });

    expect(
      screen.queryByTestId("llm-connect-budget-hint"),
    ).not.toBeInTheDocument();
  });
});

describe("picking a way", () => {
  test("the page opens on your apps, with the other two a click away", async () => {
    await openPage();

    expect(way("apps")).toHaveAttribute("aria-selected", "true");
    expect(way("providers")).toHaveAttribute("aria-selected", "false");
    expect(way("tools")).toHaveAttribute("aria-selected", "false");

    expect(panel("apps")).toBeVisible();
    expect(panel("providers")).not.toBeVisible();
    expect(panel("tools")).not.toBeVisible();

    expect(screen.getByTestId("apps-path")).toBeInTheDocument();
  });

  test("the ways are tabs a screen reader can follow to their panels", async () => {
    await openPage();

    const list: HTMLElement = screen.getByRole("tablist", {
      name: "Ways to bring AI in",
    });
    const tabs: Array<HTMLElement> = within(list).getAllByRole("tab");

    expect(
      tabs.map((tab: HTMLElement): string => {
        return tab.getAttribute("data-testid") || "";
      }),
    ).toEqual([
      "llm-connect-way-apps",
      "llm-connect-way-providers",
      "llm-connect-way-tools",
    ]);

    for (const tab of tabs) {
      const controls: string = tab.getAttribute("aria-controls") || "";
      const controlled: HTMLElement = document.getElementById(controls)!;

      expect(controlled).toHaveAttribute("role", "tabpanel");
      expect(controlled).toHaveAttribute("aria-labelledby", tab.id);
    }

    // Only the picked tab is in the tab order.
    expect(way("apps")).toHaveAttribute("tabindex", "0");
    expect(way("providers")).toHaveAttribute("tabindex", "-1");
  });

  test("a click shows that way, puts it in the address and remembers it", async () => {
    await openPage();

    fireEvent.click(way("providers"));

    expect(way("providers")).toHaveAttribute("aria-selected", "true");
    expect(panel("providers")).toBeVisible();
    expect(panel("apps")).not.toBeVisible();
    expect(new URL(window.location.href).searchParams.get("way")).toBe(
      "providers",
    );
    expect(window.localStorage.getItem(LLM_CONNECT_WAY_STORAGE_KEY)).toBe(
      "providers",
    );
  });

  test("the address opens the way it names", async () => {
    goTo(`/dashboard/${PROJECT_ID}/llm/connect?way=tools`);

    await openPage();

    expect(way("tools")).toHaveAttribute("aria-selected", "true");
    expect(panel("tools")).toBeVisible();
  });

  test("an address that names no way opens your apps", async () => {
    goTo(`/dashboard/${PROJECT_ID}/llm/connect?way=everything`);

    await openPage();

    expect(way("apps")).toHaveAttribute("aria-selected", "true");
  });

  test("the reader's last pick opens next time, unless the address names another", async () => {
    window.localStorage.setItem(LLM_CONNECT_WAY_STORAGE_KEY, "tools");

    await openPage();

    expect(way("tools")).toHaveAttribute("aria-selected", "true");

    cleanup();
    goTo(`/dashboard/${PROJECT_ID}/llm/connect?way=providers`);

    await openPage();

    expect(way("providers")).toHaveAttribute("aria-selected", "true");
  });

  test("arrow keys move along the ways, Home and End jump, and the page stays put", async () => {
    await openPage();

    way("apps").focus();
    fireEvent.keyDown(way("apps"), { key: "ArrowRight" });

    expect(way("providers")).toHaveAttribute("aria-selected", "true");
    expect(way("providers")).toHaveFocus();

    fireEvent.keyDown(way("providers"), { key: "End" });
    expect(way("tools")).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(way("tools"), { key: "ArrowRight" });
    expect(way("apps")).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(way("apps"), { key: "ArrowLeft" });
    expect(way("tools")).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(way("tools"), { key: "Home" });
    expect(way("apps")).toHaveAttribute("aria-selected", "true");

    // Below the fold or not, a key never scrolls away from the tabs.
    panelTop = 2000;
    fireEvent.keyDown(way("apps"), { key: "ArrowDown" });
    expect(scrolledTo).toEqual([]);
  });

  test("a tap brings the way's path into view when it starts below the screen, as on a phone", async () => {
    await openPage();

    panelTop = 1200;
    fireEvent.click(way("tools"));

    expect(scrolledTo).toEqual(["llm-connect-panel-tools"]);
  });

  test("on a desktop, where the path already shows, nothing scrolls", async () => {
    await openPage();

    panelTop = 340;
    fireEvent.click(way("tools"));

    expect(scrolledTo).toEqual([]);
  });
});

describe("the tiles and the lists", () => {
  test("a tile counts every connection of its provider", async () => {
    connectionsForTest = [
      connection(LlmConnectionProvider.AzureOpenAI),
      connection(LlmConnectionProvider.AzureOpenAI),
      connection(LlmConnectionProvider.OpenAI),
    ];

    await openPage();

    await waitFor(() => {
      expect(
        screen.getByTestId(
          `llm-connection-tile-${LlmConnectionProvider.AzureOpenAI}`,
        ),
      ).toHaveTextContent("Connected (2)");
    });
    expect(
      screen.getByTestId(`llm-connection-tile-${LlmConnectionProvider.OpenAI}`),
    ).toHaveTextContent("Connect another");
    expect(listIsShown(LlmConnectionKind.ProviderAccount)).toBe(true);
    expect(listIsShown(LlmConnectionKind.CompanyTool)).toBe(false);
  });

  test("a tile opens that provider's form, for a new connection", async () => {
    await openPage();

    fireEvent.click(way("providers"));
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
  test("without the right to connect, no tile opens a form, and each panel says why in words", async () => {
    createGate = {
      isAllowed: false,
      disabledReason:
        "You do not have permission to create this AI Connection.",
    };

    await openPage();

    const tiles: Array<HTMLElement> = screen
      .getAllByRole("button", { hidden: true })
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

    const notes: Array<HTMLElement> = screen.getAllByTestId(
      "llm-connect-locked",
    );

    expect(notes).toHaveLength(2);
    expect(within(panel("providers")).getByTestId("llm-connect-locked"))
      .toHaveTextContent(
        "You do not have permission to create this AI Connection.",
      );
    expect(
      within(panel("tools")).getByTestId("llm-connect-locked"),
    ).toBeInTheDocument();
  });

  test("with the right to connect, nothing is said", async () => {
    await openPage();

    expect(screen.queryByTestId("llm-connect-locked")).not.toBeInTheDocument();
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

    const list: HTMLElement = screen.getByTestId("llm-connect-ways");
    const text: string = list.textContent || "";

    expect(text.indexOf("Your apps")).toBeGreaterThan(-1);
    expect(text.indexOf("Your apps")).toBeLessThan(
      text.indexOf("Your AI provider accounts"),
    );
    expect(text.indexOf("Your AI provider accounts")).toBeLessThan(
      text.indexOf("Your company's AI tools"),
    );
  });

  test("the company tools part asks you to tell your people, and folds the tools with no API", async () => {
    await openPage();

    const tools: HTMLElement = panel("tools");

    expect(within(tools).getByTestId("llm-tell-your-people")).toBeInTheDocument();

    const others: HTMLElement = within(tools).getByTestId("llm-other-ai-tools");

    expect(others.tagName).toBe("DETAILS");
    expect(others).not.toHaveAttribute("open");
    expect(tools).toHaveTextContent(
      "Only project owners and admins can read them, unless you choose otherwise.",
    );
  });
});

// The markers stand in for real modules: make sure they are the ones used.
test("the page is drawn with its real ways and tiles", async () => {
  await openPage();

  expect(screen.getByTestId("apps-path")).toBeInTheDocument();
  expect(screen.getByTestId("llm-connect-ways")).toBeInTheDocument();
  expect(
    screen.getByTestId(
      `llm-connection-tiles-${LlmConnectionKind.ProviderAccount}`,
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByTestId(`llm-connection-tiles-${LlmConnectionKind.CompanyTool}`),
  ).toBeInTheDocument();
});
