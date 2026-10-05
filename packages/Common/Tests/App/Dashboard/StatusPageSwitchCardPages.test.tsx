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
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * Two status page settings that were each a card whose Edit dialog held one
 * switch, and are one switch now, saved when it is flipped:
 *
 *   - Advanced -> Embedded Status: "Enable Embedded Status Badge". The
 *     badge preview below it follows the switch as it moves, and the token
 *     is read along with it.
 *   - AI -> MCP: "Enable MCP Server", on by default.
 *
 * The real pages are rendered; only the network, the route's id and the
 * permission gate are stubbed (and the markdown viewer, drawn as its text).
 */

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

interface MarkdownViewerProps {
  text: string;
}

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: MarkdownViewerProps): React.ReactElement => {
      return React.createElement("div", {}, props.text);
    },
  };
});

import StatusPageEmbeddedStatus, {
  EMBEDDED_STATUS_BADGE_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/EmbeddedStatus";
import StatusPageMcp, {
  STATUS_PAGE_MCP_SERVER_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Mcp";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const STATUS_PAGE_ID: string = "3c3c3c3c-0000-4000-8000-0000000000aa";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: false,
};

let stored: Partial<StatusPage> = {};

beforeEach(() => {
  stored = {};

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID;
    Object.assign(page, stored);
    return page;
  });

  getListMock.mockReset();
  getListMock.mockImplementation(async (): Promise<unknown> => {
    return { data: [], count: 0, skip: 0, limit: 1 };
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(
    async (options: unknown): Promise<unknown> => {
      Object.assign(
        stored,
        (options as { data: Record<string, unknown> }).data,
      );
      return {};
    },
  );

  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockImplementation(
    (): ObjectID => {
      return new ObjectID(STATUS_PAGE_ID);
    },
  );

  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return { isAllowed: true };
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

interface UpdateCall {
  modelType: unknown;
  id: ObjectID;
  data: Record<string, unknown>;
}

function updateCall(index: number = 0): UpdateCall {
  return updateByIdMock.mock.calls[index]![0] as UpdateCall;
}

function statusPageReads(): Array<Record<string, unknown>> {
  return getItemMock.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as { modelType: unknown; select: Record<string, unknown> };
    })
    .filter((options: { modelType: unknown }) => {
      return options.modelType === StatusPage;
    })
    .map((options: { select: Record<string, unknown> }) => {
      return options.select;
    });
}

describe("Embedded Status: the badge is one switch", () => {
  async function renderPage(): Promise<HTMLElement> {
    render(
      <MemoryRouter>
        <StatusPageEmbeddedStatus {...PAGE_PROPS} />
      </MemoryRouter>,
    );
    await flush();
    return await screen.findByTestId(EMBEDDED_STATUS_BADGE_SWITCH_TEST_ID);
  }

  test("no Edit button: the card holds the switch itself, off on a new page", async () => {
    const control: HTMLElement = await renderPage();

    expect(screen.getByText("Embedded Status Badge")).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Enable Embedded Status Badge" }),
    ).toBe(control);
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("button", { name: "Edit Settings" })).toBeNull();
    expect(
      screen.getByText(
        "Enable the embedded status badge to view the live preview.",
      ),
    ).toBeInTheDocument();
  });

  test("it reads the switch's column with the token, once", async () => {
    await renderPage();

    expect(statusPageReads()).toEqual([
      { embeddedOverallStatusToken: true, enableEmbeddedOverallStatus: true },
    ]);
  });

  test("flipping it on saves the column alone, and the preview follows at once", async () => {
    stored.embeddedOverallStatusToken = "badge-token";

    const control: HTMLElement = await renderPage();

    fireEvent.click(control);
    await flush();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(updateCall().modelType).toBe(StatusPage);
    expect(updateCall().id.toString()).toBe(STATUS_PAGE_ID);
    expect(updateCall().data).toEqual({ enableEmbeddedOverallStatus: true });

    const badge: HTMLElement = screen.getByAltText("Status Badge");
    expect(badge.getAttribute("src")).toContain(
      `/status-page/badge/${STATUS_PAGE_ID}?token=badge-token`,
    );
  });

  test("on with no token yet, the preview asks for one", async () => {
    stored.enableEmbeddedOverallStatus = true;

    const control: HTMLElement = await renderPage();

    expect(control).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText("Generate a security token to see the live preview."),
    ).toBeInTheDocument();
  });

  test("a refused change puts the preview back with the switch", async () => {
    stored.embeddedOverallStatusToken = "badge-token";
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error(
        "Please upgrade your plan to Growth to access this feature",
      );
    });

    const control: HTMLElement = await renderPage();

    fireEvent.click(control);
    await flush();

    expect(control).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByAltText("Status Badge")).toBeNull();
    expect(
      screen.getByText(
        "Enable the embedded status badge to view the live preview.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Please upgrade your plan to Growth to access this feature",
    );
  });

  test("the token card shows the token read with the switch", async () => {
    stored.embeddedOverallStatusToken = "badge-token";

    await renderPage();

    expect(
      screen.queryByText(
        "No token has been generated yet. Enable the embedded badge and use “Regenerate Token” to create one.",
      ),
    ).toBeNull();
  });
});

describe("MCP: the MCP server is one switch", () => {
  async function renderPage(): Promise<HTMLElement> {
    render(
      <MemoryRouter>
        <StatusPageMcp {...PAGE_PROPS} />
      </MemoryRouter>,
    );
    await flush();
    return await screen.findByTestId(STATUS_PAGE_MCP_SERVER_SWITCH_TEST_ID);
  }

  test("on by default, with no Edit button", async () => {
    const control: HTMLElement = await renderPage();

    expect(screen.getByText("MCP Server")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable MCP Server" })).toBe(
      control,
    );
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("button", { name: "Edit Settings" })).toBeNull();
    expect(
      screen.getByText(
        "When enabled, AI agents can read this status page over the public OneUptime MCP server. Turning this off does not hide the status page website, its RSS feed, or its public JSON API.",
      ),
    ).toBeInTheDocument();
  });

  test("it reads only its column", async () => {
    await renderPage();

    expect(statusPageReads()).toEqual([{ enableMcpServer: true }]);
  });

  test("turning it off saves at once", async () => {
    const control: HTMLElement = await renderPage();

    fireEvent.click(control);
    await flush();

    expect(updateCall().modelType).toBe(StatusPage);
    expect(updateCall().id.toString()).toBe(STATUS_PAGE_ID);
    expect(updateCall().data).toEqual({ enableMcpServer: false });
    expect(control).toHaveAttribute("aria-checked", "false");
  });

  test("a page that turned it off shows it off", async () => {
    stored.enableMcpServer = false;

    const control: HTMLElement = await renderPage();

    expect(control).toHaveAttribute("aria-checked", "false");
  });

  test("the help below still names the switch it is about", async () => {
    await renderPage();

    expect(screen.getByText("When the toggle is off")).toBeInTheDocument();
    // "Turning off Enable MCP Server gates all four tools..."
    expect(
      screen.getAllByText("Enable MCP Server", { exact: true }).length,
    ).toBeGreaterThanOrEqual(2);
  });
});
