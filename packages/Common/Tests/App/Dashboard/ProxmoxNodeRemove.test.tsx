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
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * "Remove Node" on the Proxmox node detail page, rendered for real with
 * only the network, navigation and the chart tab replaced.
 *
 * On the Proxmox VE native push a node taken out of the cluster looks
 * exactly like a dead one, so a native-push node (isNativePush is true)
 * that has stopped reporting (isUp is false) can be removed. The button is
 * offered for that node only; a node that is up, whose status is unknown,
 * an agent node (the agent lets a node go on its own), a node whose
 * transport is unknown, or one that is not in the inventory at all has
 * none. Confirming posts the node's Proxmox name to
 * /proxmox-resource/remove-node/<clusterId> and, on success, reloads the
 * cluster's node list (a forced navigation, so the cluster layout's node
 * count does not keep the removed node). A refusal is shown inside the
 * dialog and the page stays where it is.
 *
 * The overview keeps showing the node's last CPU and memory reading however
 * old, as every Proxmox detail page does (their tooltips say "the last
 * value the agent sent"); the Offline badge and Last Seen beside it say
 * how old it is. The node list is the page that hides stale numbers.
 */

const CLUSTER_ID: string = "0193c0de-7777-4aaa-8bbb-000000000007";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";

const modelGetItemMock: MockFunction = getJestMockFunction();
const modelGetListMock: MockFunction = getJestMockFunction();
const apiPostMock: MockFunction = getJestMockFunction();
const navigateMock: MockFunction = getJestMockFunction();

let mockLastParam: string = encodeURIComponent("node/pve2");

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return modelGetItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return modelGetListMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "10000000-0000-4000-8000-000000000001" };
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  const { default: HTTPErrorResponseType } = jest.requireActual(
    "../../../Types/API/HTTPErrorResponse",
  ) as { default: new (...args: Array<unknown>) => { message: string } };

  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return apiPostMock(...args);
      },
      getFriendlyMessage: (err: unknown): string => {
        if (err instanceof HTTPErrorResponseType) {
          return err.message || "Server Error. Please try again";
        }
        if (err instanceof Error) {
          return err.message;
        }
        return String(err);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("0193c0de-7777-4aaa-8bbb-000000000007");
      },
      getLastParamAsString: (): string => {
        return mockLastParam;
      },
      navigate: (...args: Array<unknown>): void => {
        navigateMock(...args);
      },
      isOnThisPage: (): boolean => {
        return false;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

// The Metrics tab is not this suite's business.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceMetricsTab",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="resource-metrics-tab" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Proxmox/ProxmoxRateChart",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="proxmox-rate-chart" />;
      },
    };
  },
);

import ProxmoxClusterNodeDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/NodeDetail";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const STILL_REPORTING: string =
  "Only a node that has stopped reporting can be removed. A node that is still reporting would come back on its next report.";

const NODE_NOT_FOUND: string =
  "This node is not in the cluster's inventory. It may already have been removed.";

const NOT_NATIVE: string =
  "Only a node that reports over Proxmox VE's built-in metric push can be removed here. With the Proxmox Agent, a node leaves OneUptime on its own once the cluster no longer lists it.";

const REMOVE_NODE_LABEL: string = "Remove Node";

const MINUTE_MS: number = 60 * 1000;
const METRIC_STALE_MS: number = 15 * MINUTE_MS;

type Row = Record<string, unknown>;

function nodeRow(overrides: Row = {}): Row {
  return {
    kind: "Node",
    externalId: "node/pve2",
    name: "pve2",
    isUp: false,
    isNativePush: true,
    lastSeenAt: new Date(Date.now() - 10 * MINUTE_MS),
    ...overrides,
  };
}

// A reading of 42.5 % CPU and 4 GiB of 16 GiB memory, taken ageMs ago.
function withMetrics(ageMs: number | null, overrides: Row = {}): Row {
  const row: Row = nodeRow({
    latestCpuPercent: 42.5,
    latestMemoryBytes: 4 * 1024 * 1024 * 1024,
    maxMemoryBytes: 16 * 1024 * 1024 * 1024,
    ...overrides,
  });
  if (ageMs !== null) {
    row["metricsUpdatedAt"] = new Date(Date.now() - ageMs);
  }
  return row;
}

function arrange(row: Row | null): void {
  modelGetItemMock.mockImplementation(async () => {
    return { _id: CLUSTER_ID, name: "pve-prod" };
  });
  modelGetListMock.mockImplementation(async () => {
    const data: Array<Row> = row ? [row] : [];
    return { data, count: data.length, skip: 0, limit: 1 };
  });
}

async function renderPage(): Promise<void> {
  await act(async () => {
    render(<ProxmoxClusterNodeDetail {...PAGE_PROPS} />);
  });
  // The cluster name is the first thing on the page once it has loaded.
  await screen.findByText("Node Name");
}

function removeButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: REMOVE_NODE_LABEL });
}

async function openDialog(): Promise<void> {
  const button: HTMLElement | null = removeButton();
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  await screen.findByTestId("confirm-modal-description");
}

function dialogSubmit(): HTMLElement {
  /*
   * With the dialog open there are two "Remove Node" buttons: the card's,
   * and the dialog's submit, which is rendered after it.
   */
  const buttons: Array<HTMLElement> = screen.getAllByRole("button", {
    name: REMOVE_NODE_LABEL,
  });
  expect(buttons.length).toBe(2);
  return buttons[buttons.length - 1]!;
}

async function confirm(): Promise<void> {
  await act(async () => {
    fireEvent.click(dialogSubmit());
  });
}

beforeEach(() => {
  mockLastParam = encodeURIComponent("node/pve2");
  for (const mock of [
    modelGetItemMock,
    modelGetListMock,
    apiPostMock,
    navigateMock,
  ]) {
    mock.mockReset();
  }
  apiPostMock.mockImplementation(async () => {
    return new HTTPResponse<JSONObject>(200, { removed: true }, {});
  });
});

afterEach(() => {
  cleanup();
});

describe("which nodes offer Remove Node", () => {
  test("a native-push node that has stopped reporting has the button, explained on its card", async () => {
    arrange(nodeRow({ isUp: false, isNativePush: true }));
    await renderPage();

    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(removeButton()).toBeInTheDocument();
    expect(removeButton()).toHaveTextContent(/^Remove Node$/);
    expect(
      screen.getByText(
        "This node has stopped reporting. If it was taken out of the Proxmox cluster, remove it here so it is no longer reported as offline.",
      ),
    ).toBeInTheDocument();
    // Title Case, never the old "Remove node".
    expect(screen.queryByText(/Remove node/)).toBeNull();
  });

  test("the inventory row is read with isNativePush, or the button could never show", async () => {
    arrange(nodeRow());
    await renderPage();

    expect(modelGetListMock).toHaveBeenCalled();
    const request: { select: Record<string, unknown> } = modelGetListMock.mock
      .calls[0]![0] as never;
    expect(request.select["isNativePush"]).toBe(true);
    expect(request.select["isUp"]).toBe(true);
    expect(request.select["metricsUpdatedAt"]).toBe(true);
  });

  test("a node that is up has no button", async () => {
    arrange(nodeRow({ isUp: true }));
    await renderPage();

    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(removeButton()).toBeNull();
  });

  test("an agent node that has stopped reporting has no button", async () => {
    // The Proxmox Agent lets a node go on its own once the cluster drops it.
    arrange(nodeRow({ isUp: false, isNativePush: false }));
    await renderPage();

    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(removeButton()).toBeNull();
    expect(screen.queryByText("Remove Node")).toBeNull();
  });

  test.each([
    ["a null transport (a row from before the column existed)", null],
    ["no transport at all", undefined],
  ])(
    "an offline node with %s has no button",
    async (_label: string, isNativePush: unknown) => {
      const row: Row = nodeRow({ isUp: false });
      if (isNativePush === undefined) {
        delete row["isNativePush"];
      } else {
        row["isNativePush"] = isNativePush;
      }
      arrange(row);
      await renderPage();

      expect(screen.getByText("Offline")).toBeInTheDocument();
      expect(removeButton()).toBeNull();
    },
  );

  test("a native-push node that is up has no button either", async () => {
    arrange(nodeRow({ isUp: true, isNativePush: true }));
    await renderPage();

    expect(removeButton()).toBeNull();
  });

  test.each([
    ["no status yet", undefined],
    ["a null status", null],
  ])("a node with %s has no button", async (_label: string, isUp: unknown) => {
    const row: Row = nodeRow();
    if (isUp === undefined) {
      delete row["isUp"];
    } else {
      row["isUp"] = isUp;
    }
    arrange(row);
    await renderPage();

    expect(removeButton()).toBeNull();
  });

  test("a node that is not in the inventory has no button", async () => {
    arrange(null);
    await act(async () => {
      render(<ProxmoxClusterNodeDetail {...PAGE_PROPS} />);
    });
    await screen.findByText(
      "Node details not reported yet. Make sure the Proxmox agent is sending metrics.",
    );

    expect(removeButton()).toBeNull();
  });

  test("a route that does not name a node has no button", async () => {
    // Not a node externalId: nothing to post as a node name.
    mockLastParam = encodeURIComponent("qemu/100");
    arrange(nodeRow({ externalId: "qemu/100", isUp: false }));
    await renderPage();

    expect(removeButton()).toBeNull();
  });

  test("nothing is posted just by showing the page", async () => {
    arrange(nodeRow({ isUp: false }));
    await renderPage();

    expect(apiPostMock).not.toHaveBeenCalled();
  });
});

describe("the confirm dialog", () => {
  test("says what removing is for, what happens to the alert, and that the node can come back", async () => {
    arrange(nodeRow({ isUp: false }));
    await renderPage();
    await openDialog();

    const description: string =
      screen.getByTestId("confirm-modal-description").textContent || "";

    expect(description).toContain(
      "Only remove pve2 if it has been removed from the Proxmox cluster.",
    );
    expect(description).toContain(
      "OneUptime cannot tell a node that was removed from one that is down",
    );
    expect(description).toContain("its Node Offline alert resolves");
    expect(description).toContain("If pve2 reports again, it comes back.");
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  test("its submit reads Remove Node", async () => {
    arrange(nodeRow({ isUp: false }));
    await renderPage();
    await openDialog();

    expect(dialogSubmit()).toHaveTextContent(/^Remove Node$/);
    expect(screen.queryByText(/Remove node/)).toBeNull();
  });

  test("Cancel closes it without posting", async () => {
    arrange(nodeRow({ isUp: false }));
    await renderPage();
    await openDialog();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    });

    expect(screen.queryByTestId("confirm-modal-description")).toBeNull();
    expect(apiPostMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

describe("removing", () => {
  test("posts the node's Proxmox name to remove-node for this cluster, with the project headers", async () => {
    arrange(nodeRow({ isUp: false }));
    await renderPage();
    await openDialog();
    await confirm();

    expect(apiPostMock).toHaveBeenCalledTimes(1);
    const request: {
      url: { toString: () => string };
      data: JSONObject;
      headers: Record<string, string>;
    } = apiPostMock.mock.calls[0]![0] as never;

    expect(request.url.toString()).toMatch(
      new RegExp(`/proxmox-resource/remove-node/${CLUSTER_ID}$`),
    );
    expect(request.data).toEqual({ nodeName: "pve2" });
    expect(request.headers).toEqual({ tenantid: PROJECT_ID });
  });

  test("posts the name from the node's id, not its display name", async () => {
    // pve-exporter's *_info name label can differ from the node's id.
    arrange(nodeRow({ isUp: false, name: "Rack 3 / pve2" }));
    await renderPage();
    await openDialog();
    await confirm();

    expect(
      (apiPostMock.mock.calls[0]![0] as { data: JSONObject }).data,
    ).toEqual({ nodeName: "pve2" });
  });

  test("reloads the cluster's node list once the node is removed", async () => {
    arrange(nodeRow({ isUp: false }));
    await renderPage();
    await openDialog();
    await confirm();

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledTimes(1);
    });
    const navigateCall: Array<unknown> = navigateMock.mock
      .calls[0]! as Array<unknown>;
    const route: Route = navigateCall[0] as Route;
    const options: unknown = navigateCall[1];
    expect(route.toString()).toBe(
      `/dashboard/${PROJECT_ID}/proxmox/${CLUSTER_ID}/nodes`,
    );
    /*
     * A full load: the cluster layout (and its sidebar node count) stays
     * mounted across in-app navigations and would keep the removed node.
     */
    expect(options).toEqual({ forceNavigate: true });
  });

  test.each([
    ["the node is still up", 400, STILL_REPORTING],
    ["it is an agent node", 400, NOT_NATIVE],
    ["it is no longer in the inventory", 404, NODE_NOT_FOUND],
  ] as Array<[string, number, string]>)(
    "shows the server's refusal when %s in the dialog and stays on the page",
    async (_label: string, status: number, message: string) => {
      arrange(nodeRow({ isUp: false }));
      apiPostMock.mockImplementation(async () => {
        return new HTTPErrorResponse(status, { message }, {});
      });
      await renderPage();
      await openDialog();
      await confirm();

      expect(await screen.findByText(message)).toBeInTheDocument();
      // The dialog is still open, so the user can read it and cancel.
      expect(
        screen.getByTestId("confirm-modal-description"),
      ).toBeInTheDocument();
      expect(navigateMock).not.toHaveBeenCalled();
    },
  );

  test("shows a network failure in the dialog too", async () => {
    arrange(nodeRow({ isUp: false }));
    apiPostMock.mockImplementation(async () => {
      throw new Error("Network Error");
    });
    await renderPage();
    await openDialog();
    await confirm();

    expect(await screen.findByText("Network Error")).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("clears an earlier error when the dialog is opened again", async () => {
    arrange(nodeRow({ isUp: false }));
    apiPostMock.mockImplementation(async () => {
      return new HTTPErrorResponse(400, { message: STILL_REPORTING }, {});
    });
    await renderPage();
    await openDialog();
    await confirm();
    await screen.findByText(STILL_REPORTING);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    });
    await openDialog();

    expect(screen.queryByText(STILL_REPORTING)).toBeNull();
  });

  test("a retry after a refusal can succeed", async () => {
    arrange(nodeRow({ isUp: false }));
    apiPostMock.mockImplementationOnce(async () => {
      return new HTTPErrorResponse(500, { message: "Try again" }, {});
    });
    await renderPage();
    await openDialog();
    await confirm();
    await screen.findByText("Try again");

    await confirm();

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledTimes(1);
    });
    expect(apiPostMock).toHaveBeenCalledTimes(2);
  });
});

describe("the last CPU and memory reading stays, however old", () => {
  const CPU_TEXT: string = "42.5%";
  const MEMORY_TEXT: string = "4.0 GiB / 16.0 GiB";

  function expectReadingShown(): void {
    expect(screen.getByText("CPU")).toBeInTheDocument();
    expect(screen.getByText(CPU_TEXT)).toBeInTheDocument();
    expect(screen.getByText("Memory (Used / Total)")).toBeInTheDocument();
    expect(screen.getByText(MEMORY_TEXT)).toBeInTheDocument();
  }

  test("a reading a minute old is shown", async () => {
    arrange(withMetrics(MINUTE_MS));
    await renderPage();

    expectReadingShown();
  });

  test("a reading past the node list's 15-minute cutoff is still shown, next to Offline and Last Seen", async () => {
    arrange(withMetrics(METRIC_STALE_MS + MINUTE_MS / 2, { isUp: false }));
    await renderPage();

    expectReadingShown();
    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getByText("Last Seen")).toBeInTheDocument();
  });

  test("an hours-old reading is still shown, with the Remove Node card", async () => {
    arrange(withMetrics(6 * 60 * MINUTE_MS, { isUp: false }));
    await renderPage();

    expectReadingShown();
    expect(removeButton()).toBeInTheDocument();
  });

  test("a reading with no timestamp is still shown", async () => {
    arrange(withMetrics(null));
    await renderPage();

    expectReadingShown();
  });
});
