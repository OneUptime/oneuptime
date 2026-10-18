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
 *     is read along with it - and made, the first time the badge is turned
 *     on, so the switch is the one step. The token itself waits under More
 *     settings, with Regenerate Token.
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
  EMBEDDED_STATUS_BADGE_EMBED_TEST_ID,
  EMBEDDED_STATUS_BADGE_MORE_TEST_ID,
  EMBEDDED_STATUS_BADGE_SWITCH_TEST_ID,
  EmbeddedStatusCopy,
  getEmbeddedBadgeTokenButtonTitle,
  shouldMakeBadgeTokenWhenTurnedOn,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/EmbeddedStatus";
import StatusPageMcp, {
  STATUS_PAGE_MCP_DOCS_PATH,
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
    /*
     * Off, there is nothing to embed: no Embed the Badge card, and no
     * sentence under the switch repeating what the switch says.
     */
    expect(
      screen.queryByTestId(EMBEDDED_STATUS_BADGE_EMBED_TEST_ID),
    ).toBeNull();
    expect(screen.queryByText("Embed the Badge")).toBeNull();
    expect(
      screen.queryByText(/Turn on Enable Embedded Status Badge/),
    ).toBeNull();
    // The token's fold is there, folded, whatever the switch says.
    expect(
      within(screen.getByTestId(EMBEDDED_STATUS_BADGE_MORE_TEST_ID)).getByRole(
        "button",
        { name: /More settings/ },
      ),
    ).toHaveAttribute("aria-expanded", "false");
  });

  test("turning it on brings the Embed the Badge card in under the switch", async () => {
    stored.embeddedOverallStatusToken = "badge-token";

    const control: HTMLElement = await renderPage();

    expect(
      screen.queryByTestId(EMBEDDED_STATUS_BADGE_EMBED_TEST_ID),
    ).toBeNull();

    fireEvent.click(control);
    await flush();

    expect(screen.getByText("Embed the Badge")).toBeInTheDocument();
    expect(
      screen.getByTestId(EMBEDDED_STATUS_BADGE_EMBED_TEST_ID),
    ).toBeInTheDocument();

    // And turning it off again takes it away.
    fireEvent.click(control);
    await flush();

    expect(
      screen.queryByTestId(EMBEDDED_STATUS_BADGE_EMBED_TEST_ID),
    ).toBeNull();
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

  test("flipping it on for the first time makes the badge's token too, with no question, and shows the badge", async () => {
    const control: HTMLElement = await renderPage();

    fireEvent.click(control);
    await flush();

    // The switch first, then the token: two writes, one column each.
    expect(updateByIdMock).toHaveBeenCalledTimes(2);
    expect(updateCall(0).data).toEqual({ enableEmbeddedOverallStatus: true });
    expect(Object.keys(updateCall(1).data)).toEqual([
      "embeddedOverallStatusToken",
    ]);

    const token: string = updateCall(1).data[
      "embeddedOverallStatusToken"
    ] as string;

    expect(token.length).toBeGreaterThan(10);
    expect(screen.queryByText("Regenerate Security Token")).toBeNull();

    // No Create Token to press: the badge and its code are there.
    expect(screen.getByAltText("Status Badge").getAttribute("src")).toContain(
      `/status-page/badge/${STATUS_PAGE_ID}?token=${token}`,
    );
    expect(
      within(
        screen.getByTestId(EMBEDDED_STATUS_BADGE_EMBED_TEST_ID),
      ).queryByRole("button", { name: "Create Token" }),
    ).toBeNull();
  });

  test("turning it off and on again keeps the token it has: badges embedded with it keep working", async () => {
    stored.enableEmbeddedOverallStatus = true;
    stored.embeddedOverallStatusToken = "badge-token";

    const control: HTMLElement = await renderPage();

    fireEvent.click(control);
    await flush();
    fireEvent.click(control);
    await flush();

    expect(updateByIdMock).toHaveBeenCalledTimes(2);
    expect(updateCall(0).data).toEqual({ enableEmbeddedOverallStatus: false });
    expect(updateCall(1).data).toEqual({ enableEmbeddedOverallStatus: true });
    expect(screen.getByAltText("Status Badge").getAttribute("src")).toContain(
      `/status-page/badge/${STATUS_PAGE_ID}?token=badge-token`,
    );
  });

  test("a read that was on its way while the token was made does not take the token away", async () => {
    const control: HTMLElement = await renderPage();

    // Every read after the first comes back as the page was before.
    getItemMock.mockImplementation(async (): Promise<unknown> => {
      const page: StatusPage = new StatusPage();
      page._id = STATUS_PAGE_ID;
      page.enableEmbeddedOverallStatus = true;
      return page;
    });

    fireEvent.click(control);
    await flush();

    const token: string = updateCall(1).data[
      "embeddedOverallStatusToken"
    ] as string;

    expect(screen.getByAltText("Status Badge").getAttribute("src")).toContain(
      `?token=${token}`,
    );
  });

  test("a token that cannot be made says why, where the badge would be, and Create Token tries again", async () => {
    updateByIdMock.mockImplementation(
      async (options: unknown): Promise<unknown> => {
        const data: Record<string, unknown> = (
          options as { data: Record<string, unknown> }
        ).data;

        if (data["embeddedOverallStatusToken"]) {
          throw new Error("The token could not be saved.");
        }

        Object.assign(stored, data);
        return {};
      },
    );

    const control: HTMLElement = await renderPage();

    fireEvent.click(control);
    await flush();

    const embed: HTMLElement = screen.getByTestId(
      EMBEDDED_STATUS_BADGE_EMBED_TEST_ID,
    );

    expect(control).toHaveAttribute("aria-checked", "true");
    expect(embed).toHaveTextContent(EmbeddedStatusCopy.needsToken);
    expect(within(embed).getByRole("alert")).toHaveTextContent(
      "The token could not be saved.",
    );

    updateByIdMock.mockImplementation(
      async (options: unknown): Promise<unknown> => {
        Object.assign(
          stored,
          (options as { data: Record<string, unknown> }).data,
        );
        return {};
      },
    );

    await act(async () => {
      fireEvent.click(
        within(embed).getByRole("button", { name: "Create Token" }),
      );
    });
    await flush();

    expect(screen.getByAltText("Status Badge")).toBeInTheDocument();
  });

  test("a page switched on before it had a token offers Create Token where the badge would be", async () => {
    stored.enableEmbeddedOverallStatus = true;

    const control: HTMLElement = await renderPage();
    const embed: HTMLElement = screen.getByTestId(
      EMBEDDED_STATUS_BADGE_EMBED_TEST_ID,
    );

    expect(control).toHaveAttribute("aria-checked", "true");
    expect(embed).toHaveTextContent(
      "The badge needs a token before it can be shown.",
    );
    expect(
      within(embed).getByRole("button", { name: "Create Token" }),
    ).toBeInTheDocument();
    // Nothing is made by opening the page.
    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(
      within(screen.getByTestId(EMBEDDED_STATUS_BADGE_MORE_TEST_ID)).getByText(
        "No token yet.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Regenerate Token" }),
    ).toBeNull();
  });

  test("Create Token saves a new token at once, with no question: nothing is embedded yet", async () => {
    stored.enableEmbeddedOverallStatus = true;

    await renderPage();

    await act(async () => {
      fireEvent.click(
        within(
          screen.getByTestId(EMBEDDED_STATUS_BADGE_EMBED_TEST_ID),
        ).getByRole("button", { name: "Create Token" }),
      );
    });
    await flush();

    // No confirmation: the token was saved straight away.
    expect(screen.queryByText("Regenerate Security Token")).toBeNull();
    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(updateCall().modelType).toBe(StatusPage);
    expect(updateCall().id.toString()).toBe(STATUS_PAGE_ID);
    expect(Object.keys(updateCall().data)).toEqual([
      "embeddedOverallStatusToken",
    ]);

    const token: string = updateCall().data[
      "embeddedOverallStatusToken"
    ] as string;

    expect(token.length).toBeGreaterThan(10);

    // The badge and its code show with the new token.
    expect(screen.getByAltText("Status Badge").getAttribute("src")).toContain(
      `/status-page/badge/${STATUS_PAGE_ID}?token=${token}`,
    );
    expect(
      screen.getByRole("button", { name: "Regenerate Token" }),
    ).toBeInTheDocument();
  });

  test("the token waits folded under More settings, named by its card", async () => {
    stored.enableEmbeddedOverallStatus = true;
    stored.embeddedOverallStatusToken = "badge-token";

    await renderPage();

    const more: HTMLElement = screen.getByTestId(
      EMBEDDED_STATUS_BADGE_MORE_TEST_ID,
    );
    const header: HTMLElement = within(more).getByRole("button", {
      name: /More settings/,
    });

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(header).toHaveTextContent("Security Token");
    expect(
      within(more).getByRole("heading", { name: "Security Token" }),
    ).toBeInTheDocument();

    /*
     * Its one card says what the token is: the fold does not say it a
     * second time above it.
     */
    await act(async () => {
      fireEvent.click(header);
    });

    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(
      within(more).getAllByText(EmbeddedStatusCopy.tokenCardDescription),
    ).toHaveLength(1);
    expect(within(more).queryByText(/Regenerate it if the link/)).toBeNull();
  });

  test("Regenerate Token asks first: the current token stops working", async () => {
    stored.enableEmbeddedOverallStatus = true;
    stored.embeddedOverallStatusToken = "badge-token";

    await renderPage();

    await act(async () => {
      fireEvent.click(
        within(
          screen.getByTestId(EMBEDDED_STATUS_BADGE_MORE_TEST_ID),
        ).getByRole("button", { name: /More settings/ }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Regenerate Token" }));
    });
    await flush();

    expect(screen.getByText("Regenerate Security Token")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The current token stops working, and embedded badges break until you update them with the new one.",
      ),
    ).toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("on with a token, Embed the Badge shows the badge, its HTML and its Markdown linked to the status page", async () => {
    stored.enableEmbeddedOverallStatus = true;
    stored.embeddedOverallStatusToken = "badge-token";

    await renderPage();

    const embed: HTMLElement = screen.getByTestId(
      EMBEDDED_STATUS_BADGE_EMBED_TEST_ID,
    );

    expect(screen.getByText("Embed the Badge")).toBeInTheDocument();
    expect(embed).toHaveTextContent("HTML");
    expect(embed).toHaveTextContent("Markdown, linked to the status page");
    expect(embed.textContent).toContain(`<img src="`);
    expect(embed.textContent).toContain(
      `/status-page/badge/${STATUS_PAGE_ID}?token=badge-token" alt="Status Badge" />`,
    );
    // The Markdown links the badge to the page: its preview link, without a domain.
    expect(embed.textContent).toContain(`[![Status](`);
    expect(embed.textContent).toContain(`/${STATUS_PAGE_ID})`);
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
    // Back off, so nothing to embed: the card goes with the switch.
    expect(
      screen.queryByTestId(EMBEDDED_STATUS_BADGE_EMBED_TEST_ID),
    ).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Please upgrade your plan to Growth to access this feature",
    );
  });

  test("the token card shows the token read with the switch", async () => {
    stored.embeddedOverallStatusToken = "badge-token";

    await renderPage();

    expect(screen.queryByText("No token yet.")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Regenerate Token" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Token" })).toBeNull();
  });

  test("the token button is Create Token until there is a token", () => {
    expect(getEmbeddedBadgeTokenButtonTitle(false)).toBe("Create Token");
    expect(getEmbeddedBadgeTokenButtonTitle(true)).toBe("Regenerate Token");
  });

  test("a token is made only when the badge is turned on without one", () => {
    expect(
      shouldMakeBadgeTokenWhenTurnedOn({ isOn: true, token: undefined }),
    ).toBe(true);
    expect(shouldMakeBadgeTokenWhenTurnedOn({ isOn: true, token: "" })).toBe(
      true,
    );
    expect(
      shouldMakeBadgeTokenWhenTurnedOn({ isOn: true, token: "badge-token" }),
    ).toBe(false);
    expect(
      shouldMakeBadgeTokenWhenTurnedOn({ isOn: false, token: undefined }),
    ).toBe(false);
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
        "AI agents can read this status page over the public OneUptime MCP server.",
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

  test("Connect an AI Assistant gives the server's address and this page's ID, and says what turning it off does not do", async () => {
    await renderPage();

    expect(screen.getByText("Connect an AI Assistant")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Add this server to your AI assistant. It needs no API key.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The assistant names this page by its ID, or by one of its custom domains:",
      ),
    ).toBeInTheDocument();
    expect(document.body.textContent).toContain(STATUS_PAGE_ID);
    expect(document.body.textContent).toContain(
      "Turning the server off does not hide the page itself: who can see it is set on Access. The tools are listed in the MCP Server docs.",
    );

    // Access opens this page's Access screen; the docs open in a new tab.
    const access: HTMLElement = screen.getByRole("link", { name: "Access" });

    expect(access.getAttribute("href")).toContain(
      `/status-pages/${STATUS_PAGE_ID}/authentication-settings`,
    );

    const docs: HTMLElement = screen.getByRole("link", {
      name: "MCP Server docs",
    });

    expect(docs.getAttribute("href")).toBe(STATUS_PAGE_MCP_DOCS_PATH);
    expect(STATUS_PAGE_MCP_DOCS_PATH).toBe("/docs/ai/mcp-server");
  });

  test("no manual of its own: the tools and the toggle are explained in the docs", async () => {
    await renderPage();

    expect(screen.queryByText("When the toggle is off")).toBeNull();
    // Only the switch names itself.
    expect(
      screen.getAllByText("Enable MCP Server", { exact: true }),
    ).toHaveLength(1);
    // The connect cards, each one client.
    for (const title of [
      "Connect Claude Desktop",
      "Connect Claude Code",
      "Connect VS Code or Cursor",
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });
});
