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
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import McpOAuthGrant from "../../../Models/DatabaseModels/McpOAuthGrant";
import User from "../../../Models/DatabaseModels/User";
import Route from "../../../Types/API/Route";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import IconProp from "../../../Types/Icon/IconProp";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { ModalTableBulkDefaultActions } from "../../../UI/Components/ModelTable/BaseModelTable";
import { CODE_BLOCK_WRAP_CLASS_NAME } from "../../../UI/Components/CodeBlock/CodeBlock";
import FieldType from "../../../UI/Components/Types/FieldType";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * Settings > MCP Server, rendered.
 *
 * Two things on this page matter beyond its copy.
 *
 * THE CONNECTED CLIENTS TABLE is where a member - or an admin, for the whole
 * project - sees which MCP clients hold delegated access and takes it away.
 * What it must get right:
 *
 *  - it lists grants that are LIVE in THIS project. An approval a client never
 *    came back to collect (no activatedAt) is not a connection, and showing
 *    it would list "clients" that hold nothing;
 *  - a row can be disconnected, and can be neither created nor edited: a
 *    grant only ever comes from the consent screen, and its scope is what the
 *    member approved there. And the page calls that "Disconnect" everywhere -
 *    on the row, in the confirmation, in the bulk action - because the table's
 *    stock "Delete ... this action cannot be undone" would say the wrong
 *    thing about a client that can simply be connected again;
 *  - a row says what the client may do (read only, unless the grant really
 *    carries write) and shows a host ONLY for a client whose id is the URL of
 *    a metadata document - the one part of a client's identity the client did
 *    not simply type.
 *
 * THE MCP SERVER CARD asks how a client signs in, then shows the setup of
 * the one client picked for that way only (the page had an Authentication
 * card, then every client's setup twice on a card each). Its snippets are
 * copied into terminals and config files, so they have to name this
 * instance's own /mcp endpoint, and the sign-in ones must carry no
 * credential at all. And its words are the card's body: a card description
 * is a <p> that phones never show.
 *
 * ModelTable is a stand-in that draws the page's own columns over a few
 * rows, so the cells the page renders are the page's real getElement output.
 * Everything else - cards, code blocks, links, the user element - is real.
 * The instance address is pinned so the expected snippets can be literal.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/settings/mcp-server`;
const MCP_URL: string = "https://oneuptime.example.com/mcp";

// The table's stock words for removing a row: "Delete", "delete this ...".
const STOCK_DELETE_WORDING: RegExp =
  /\bDelete\b|\bdelete (it|them|this|these)\b/;

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const protocolModule: { default: Record<string, unknown> } =
    jest.requireActual("../../../Types/API/Protocol") as {
      default: Record<string, unknown>;
    };

  return {
    ...actual,
    __esModule: true,
    HOST: "oneuptime.example.com",
    HTTP_PROTOCOL: protocolModule.default["HTTPS"],
  };
});

interface MockColumn {
  title: string;
  type: string;
  field: Record<string, unknown>;
  noValueMessage?: string | undefined;
  contentClassName?: string | undefined;
  wrapContent?: boolean | undefined;
  getElement?: ((item: McpOAuthGrant) => ReactElement) | undefined;
}

interface MockDeleteConfirmation {
  title?: string | undefined;
  description: string | ReactElement;
  submitButtonText?: string | undefined;
}

interface MockBulkActions {
  buttons: Array<unknown>;
  deleteVerb?: string | undefined;
  deleteIcon?: string | undefined;
  deleteConfirmationWarning?: string | undefined;
}

interface MockTableProps {
  id: string;
  name: string;
  modelType: { new (): McpOAuthGrant };
  query: Record<string, unknown>;
  userPreferencesKey?: string | undefined;
  singularName?: string | undefined;
  pluralName?: string | undefined;
  isDeleteable?: boolean | undefined;
  deleteButtonText?: string | undefined;
  getDeleteConfirmation?:
    | ((item: McpOAuthGrant) => Promise<MockDeleteConfirmation>)
    | undefined;
  isEditable?: boolean | undefined;
  isCreateable?: boolean | undefined;
  isViewable?: boolean | undefined;
  showViewIdButton?: boolean | undefined;
  showRefreshButton?: boolean | undefined;
  cardProps?: { title?: string; description?: string } | undefined;
  noItemsMessage?: string | undefined;
  searchableFields?: Array<string> | undefined;
  filters?: Array<{ title: string; field: Record<string, unknown> }>;
  selectMoreFields?: Record<string, unknown> | undefined;
  columns: Array<MockColumn>;
  actionButtons?: Array<unknown> | undefined;
  bulkActions?: MockBulkActions | undefined;
  formFields?: Array<unknown> | undefined;
}

// What the page handed the table on its last render, and the rows to draw.
let mockTableProps: MockTableProps | null = null;
let mockRows: Array<McpOAuthGrant> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  const MockModelTable: (props: MockTableProps) => ReactElement = (
    props: MockTableProps,
  ): ReactElement => {
    mockTableProps = props;

    return react.createElement(
      "section",
      { "data-testid": `model-table-${props.id}` },
      react.createElement("h2", null, props.cardProps?.title),
      react.createElement("p", null, props.cardProps?.description),
      react.createElement(
        "table",
        null,
        react.createElement(
          "tbody",
          null,
          mockRows.map((row: McpOAuthGrant, rowIndex: number): ReactElement => {
            return react.createElement(
              "tr",
              { key: rowIndex, "data-testid": `row-${rowIndex}` },
              props.columns.map((column: MockColumn): ReactElement => {
                return react.createElement(
                  "td",
                  { key: column.title, "data-column": column.title },
                  column.getElement ? column.getElement(row) : null,
                );
              }),
            );
          }),
        ),
      ),
    );
  };

  return { __esModule: true, default: MockModelTable };
});

import McpServerPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/McpServer";

interface GrantData {
  name?: string | undefined;
  clientId?: string | undefined;
  scope?: string | undefined;
  user?: { name: string; email: string } | undefined;
  activatedAt?: Date | undefined;
  lastUsedAt?: Date | undefined;
}

type GrantFunction = (data: GrantData) => McpOAuthGrant;

const grant: GrantFunction = (data: GrantData): McpOAuthGrant => {
  const row: McpOAuthGrant = new McpOAuthGrant();

  row._id = ObjectID.generate().toString();

  if (data.activatedAt) {
    row.activatedAt = data.activatedAt;
  }

  if (data.lastUsedAt) {
    row.lastUsedAt = data.lastUsedAt;
  }

  if (data.name !== undefined) {
    row.name = data.name;
  }

  if (data.clientId !== undefined) {
    row.clientId = data.clientId;
  }

  if (data.scope !== undefined) {
    row.scope = data.scope;
  }

  if (data.user) {
    const user: User = new User();

    user._id = ObjectID.generate().toString();
    user.name = new Name(data.user.name);
    user.email = new Email(data.user.email);
    row.user = user;
  }

  return row;
};

const CONNECTED_ON: Date = new Date("2026-09-01T10:00:00.000Z");
const LAST_USED_ON: Date = new Date("2026-09-30T08:15:00.000Z");

// A client identified by a metadata document, allowed to read and write.
const HOSTED: McpOAuthGrant = grant({
  name: "Claude",
  clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata",
  scope: "mcp:read mcp:write",
  user: { name: "Ada Lovelace", email: "ada@example.com" },
  activatedAt: CONNECTED_ON,
  lastUsedAt: LAST_USED_ON,
});

// A client that registered itself (an opaque id), read only, never used.
const REGISTERED: McpOAuthGrant = grant({
  name: "Claude Code",
  clientId: "0b2f8c0e-7c1f-4c62-9b3a-0d6f4a3d2e11",
  scope: "mcp:read",
  user: { name: "Grace Hopper", email: "grace@example.com" },
  activatedAt: CONNECTED_ON,
});

// A row with nothing filled in, as a partial answer would leave it.
const BARE: McpOAuthGrant = grant({});

type RenderPageFunction = () => ReturnType<typeof render>;

const renderPage: RenderPageFunction = (): ReturnType<typeof render> => {
  window.history.pushState({}, "", PAGE_PATH);
  Navigation.setLocation(window.location as unknown as never);

  return render(
    <McpServerPage
      pageRoute={new Route(PAGE_PATH)}
      currentProject={null}
      hasPaymentMethod={true}
    />,
  );
};

type TablePropsFunction = () => MockTableProps;

const tableProps: TablePropsFunction = (): MockTableProps => {
  if (!mockTableProps) {
    throw new Error("The page did not render a ModelTable");
  }

  return mockTableProps;
};

type CellFunction = (rowIndex: number, column: string) => HTMLElement;

const cell: CellFunction = (rowIndex: number, column: string): HTMLElement => {
  const found: HTMLElement | null = screen
    .getByTestId(`row-${rowIndex}`)
    .querySelector(`td[data-column="${column}"]`);

  if (!found) {
    throw new Error(`Row ${rowIndex} has no "${column}" cell`);
  }

  return found;
};

type SnippetsFunction = (container: HTMLElement) => Array<string>;

// The text of every copyable code block, in page order.
const snippets: SnippetsFunction = (container: HTMLElement): Array<string> => {
  return Array.from(container.querySelectorAll("pre > code")).map(
    (block: Element): string => {
      return block.textContent || "";
    },
  );
};

type CardFunction = (title: string) => HTMLElement;

// The card with this title, its header and its body.
const card: CardFunction = (title: string): HTMLElement => {
  const found: HTMLElement | null = screen
    .getByText(title, {
      selector: "h1, h2, h3, h4",
    })
    .closest('[data-testid="card"]');

  if (!found) {
    throw new Error(`No card titled "${title}"`);
  }

  return found;
};

type PickFunction = (choice: string) => void;

// Picks how the client signs in.
const pickSignIn: PickFunction = (choice: string): void => {
  fireEvent.click(
    within(screen.getByTestId("mcp-sign-in")).getByLabelText(choice),
  );
};

// Opens a client's tab.
const pickClient: PickFunction = (client: string): void => {
  fireEvent.click(screen.getByRole("tab", { name: client }));
};

type SetupFunction = () => HTMLElement;

// The setup the open tab shows: its sentence and its snippet, if any.
const setup: SetupFunction = (): HTMLElement => {
  return screen.getByRole("tabpanel");
};

type IsBeforeFunction = (first: Node, second: Node) => boolean;

const isBefore: IsBeforeFunction = (first: Node, second: Node): boolean => {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
};

beforeEach(() => {
  mockTableProps = null;
  mockRows = [HOSTED, REGISTERED, BARE];
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Connected MCP Clients table", () => {
  test("lists McpOAuthGrant rows", () => {
    renderPage();

    const model: McpOAuthGrant = new (tableProps().modelType)();

    expect(model).toBeInstanceOf(McpOAuthGrant);
    expect(tableProps().modelType).toBe(McpOAuthGrant);
    expect(tableProps().id).toBe("mcp-client-authorizations-table");
    expect(tableProps().userPreferencesKey).toBe(
      "mcp-client-authorizations-table",
    );
    expect(tableProps().name).toBe(
      "Settings > MCP Server > Connected MCP Clients",
    );
  });

  test("asks only for this project's grants that a client actually collected", () => {
    renderPage();

    const query: Record<string, unknown> = tableProps().query;

    expect(Object.keys(query).sort()).toEqual(["activatedAt", "projectId"]);
    expect(String(query["projectId"])).toBe(PROJECT_ID);
    expect(query["projectId"]).toBeInstanceOf(ObjectID);

    /*
     * A pending approval has no activatedAt. Without this filter the table
     * would list every consent screen somebody pressed Authorize on, whether
     * or not the client ever came back for its tokens.
     */
    expect(query["activatedAt"]).toBeInstanceOf(NotNull);
  });

  test("a client can be disconnected, and that is the only thing that can be done to a row", () => {
    renderPage();

    expect(tableProps().isDeleteable).toBe(true);
    expect(tableProps().deleteButtonText).toBe("Disconnect");

    // What the table calls a row in its own sentences.
    expect(tableProps().singularName).toBe("connected client");
    expect(tableProps().pluralName).toBe("connected clients");

    // A grant only ever comes from the consent screen, as it was approved.
    expect(tableProps().isCreateable).toBe(false);
    expect(tableProps().isEditable).toBe(false);
    expect(tableProps().isViewable).toBe(false);
    expect(tableProps().showViewIdButton).toBe(false);
    expect(tableProps().formFields).toBeUndefined();
    expect(tableProps().actionButtons).toBeUndefined();

    expect(tableProps().showRefreshButton).toBe(true);
  });

  test("says what it lists, what disconnecting does, and why a key-based client is missing", () => {
    renderPage();

    expect(tableProps().cardProps?.title).toBe("Connected MCP Clients");
    expect(tableProps().cardProps?.description).toBe(
      "MCP clients that were connected to this project by signing in with OneUptime. Each one acts as the person who connected it. Disconnect a client to sign it out immediately.",
    );
    expect(tableProps().noItemsMessage).toBe(
      "No MCP clients are connected by sign-in. Clients that use an API key are not listed here.",
    );
  });

  test("can be searched and filtered by the client's name", () => {
    renderPage();

    expect(tableProps().searchableFields).toEqual(["name"]);
    expect(tableProps().filters).toHaveLength(1);
    expect(tableProps().filters![0]!.title).toBe("Client");
    expect(tableProps().filters![0]!.field).toEqual({ name: true });
  });

  test("fetches the two fields no column is keyed on: the client id for the host line, the connection date for the last-used cell", () => {
    renderPage();

    expect(tableProps().selectMoreFields).toEqual({
      clientId: true,
      activatedAt: true,
    });
  });

  test("has four columns: who, by whom, what, and whether it is still in use", () => {
    renderPage();

    expect(
      tableProps().columns.map((column: MockColumn): string => {
        return column.title;
      }),
    ).toEqual(["Client", "Connected By", "Access", "Last Used"]);

    expect(
      tableProps().columns.map(
        (column: MockColumn): Record<string, unknown> => {
          return column.field;
        },
      ),
    ).toEqual([
      { name: true },
      { user: { name: true, email: true, profilePictureId: true } },
      { scope: true },
      { lastUsedAt: true },
    ]);

    // Every cell is the page's own rendering.
    for (const column of tableProps().columns) {
      expect(column.type).toBe(FieldType.Element);
      expect(typeof column.getElement).toBe("function");
    }
  });

  describe("disconnecting", () => {
    test("the confirmation names the client and says what disconnecting does, in the page's own word", async () => {
      renderPage();

      expect(typeof tableProps().getDeleteConfirmation).toBe("function");

      const confirmation: MockDeleteConfirmation =
        await tableProps().getDeleteConfirmation!(HOSTED);

      expect(confirmation.title).toBe("Disconnect MCP Client");
      expect(confirmation.submitButtonText).toBe("Disconnect");
      expect(confirmation.description).toBe(
        'Disconnect "Claude"? It is signed out at once and must connect again to work here. Nothing it created is deleted.',
      );

      /*
       * The table's stock dialog says "Delete" and "this action cannot be
       * undone". Neither is true of a client that can be connected again.
       */
      const everything: string = `${confirmation.title} ${String(confirmation.description)} ${confirmation.submitButtonText}`;

      expect(everything).not.toMatch(/delete (it|this|")/i);
      expect(everything).not.toContain("cannot be undone");
    });

    test("a client with no name is still asked about in a whole sentence", async () => {
      renderPage();

      const confirmation: MockDeleteConfirmation =
        await tableProps().getDeleteConfirmation!(BARE);

      expect(confirmation.description).toBe(
        "Disconnect this MCP client? It is signed out at once and must connect again to work here. Nothing it created is deleted.",
      );
    });

    test("a name is quoted into the confirmation as text", async () => {
      renderPage();

      const confirmation: MockDeleteConfirmation = await tableProps()
        .getDeleteConfirmation!(grant({ name: "<b>Claude</b>" }));

      // A string, which the dialog renders as text; never an element.
      expect(typeof confirmation.description).toBe("string");
      expect(confirmation.description).toContain('"<b>Claude</b>"');
    });

    test("several clients can be disconnected at once, under the same word", () => {
      renderPage();

      const bulk: MockBulkActions | undefined = tableProps().bulkActions;

      expect(bulk).toBeDefined();
      expect(bulk!.buttons).toEqual([ModalTableBulkDefaultActions.Delete]);
      expect(bulk!.deleteVerb).toBe("Disconnect");
      expect(bulk!.deleteIcon).toBe(IconProp.LinkSlash);
      expect(bulk!.deleteConfirmationWarning).toBe(
        "They are signed out immediately and have to be connected again before they can work with this project. Nothing they created is deleted.",
      );
    });

    test('nothing the page says about disconnecting calls it a deletion that "cannot be undone"', async () => {
      /*
       * The table appends "This action cannot be undone." to its bulk
       * question only when it has no verb of its own to use, and its stock
       * per-row dialog says it outright. The page replaces both, so every
       * sentence it supplies is checked: a disconnected client can be
       * connected again, and nothing it made goes with it.
       */
      renderPage();

      const named: MockDeleteConfirmation =
        await tableProps().getDeleteConfirmation!(HOSTED);
      const unnamed: MockDeleteConfirmation =
        await tableProps().getDeleteConfirmation!(BARE);
      const bulk: MockBulkActions = tableProps().bulkActions!;

      const sentences: Array<string> = [
        tableProps().deleteButtonText || "",
        named.title || "",
        String(named.description),
        named.submitButtonText || "",
        unnamed.title || "",
        String(unnamed.description),
        unnamed.submitButtonText || "",
        bulk.deleteVerb || "",
        bulk.deleteConfirmationWarning || "",
        tableProps().cardProps?.description || "",
      ];

      expect(bulk.deleteVerb).toBeTruthy();

      for (const sentence of sentences) {
        expect(sentence.length).toBeGreaterThan(0);
        expect(sentence).not.toContain("cannot be undone");
        expect(sentence).not.toMatch(STOCK_DELETE_WORDING);
      }
    });
  });

  describe("the Last Used cell", () => {
    type FormatFunction = (date: Date, onlyDate?: boolean) => string;

    // Formatted by the same helper the page uses, in this run's own timezone.
    const format: FormatFunction = (date: Date, onlyDate?: boolean): string => {
      return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        date,
        onlyDate,
      );
    };

    // Three hours after the hosted client's last request.
    const NOW: Date = new Date("2026-09-30T11:15:00.000Z");

    type LinesFunction = (rowIndex: number) => Array<Element>;

    const lines: LinesFunction = (rowIndex: number): Array<Element> => {
      return Array.from(cell(rowIndex, "Last Used").querySelectorAll("span"));
    };

    type TextOfFunction = (line: Element) => string;

    const textOf: TextOfFunction = (line: Element): string => {
      return line.textContent || "";
    };

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(NOW);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test("says how long ago the client last made a request, with the day it was connected underneath", () => {
      renderPage();

      expect(lines(0).map(textOf)).toEqual([
        "3 hours ago",
        `Connected ${format(CONNECTED_ON, true)}`,
      ]);

      /*
       * Relative, not a timestamp: two full timestamps side by side were what
       * pushed the row's Disconnect button off the edge of the table.
       */
      expect(textOf(lines(0)[0]!)).toBe(OneUptimeDate.fromNow(LAST_USED_ON));
      expect(textOf(lines(0)[0]!)).not.toBe(format(LAST_USED_ON));
    });

    test("the exact time is still there, on hover", () => {
      renderPage();

      expect(lines(0)[0]).toHaveAttribute("title", format(LAST_USED_ON));
      expect(format(LAST_USED_ON)).not.toBe("3 hours ago");
    });

    test("the connection line carries the day and no time of day", () => {
      renderPage();

      expect(format(CONNECTED_ON, true)).not.toBe(format(CONNECTED_ON));
      expect(format(CONNECTED_ON, true).length).toBeLessThan(
        format(CONNECTED_ON).length,
      );
      expect(textOf(lines(0)[1]!)).toBe(
        `Connected ${format(CONNECTED_ON, true)}`,
      );
      expect(textOf(lines(0)[1]!)).not.toBe(
        `Connected ${format(CONNECTED_ON)}`,
      );
    });

    test("a client that has not been used yet says so instead of showing a blank", () => {
      renderPage();

      expect(lines(1).map(textOf)).toEqual([
        "Never",
        `Connected ${format(CONNECTED_ON, true)}`,
      ]);

      // Nothing to hover for: there is no exact time to show.
      expect(lines(1)[0]).not.toHaveAttribute("title");
    });

    test("a row with neither date shows Never and no connection line", () => {
      renderPage();

      expect(cell(2, "Last Used").textContent).toBe("Never");
      expect(lines(2)).toHaveLength(1);
    });
  });

  describe("the Client cell", () => {
    test("a client identified by a metadata document shows its name and the host it is published at", () => {
      renderPage();

      const client: HTMLElement = cell(0, "Client");

      expect(within(client).getByText("Claude")).toBeInTheDocument();
      expect(within(client).getByText("claude.ai")).toBeInTheDocument();
      expect(
        Array.from(client.querySelectorAll("span")).map(
          (line: Element): string => {
            return line.textContent || "";
          },
        ),
      ).toEqual(["Claude", "claude.ai"]);

      // The host, not the document's address.
      expect(client.textContent).not.toContain("https://");
      expect(client.textContent).not.toContain("mcp-oauth-client-metadata");
    });

    test("a client that registered itself shows its name and nothing under it", () => {
      renderPage();

      const client: HTMLElement = cell(1, "Client");

      expect(client.textContent).toBe("Claude Code");
      expect(client.querySelectorAll("span")).toHaveLength(1);

      // Its id is an opaque UUID: it is not printed as if it meant something.
      expect(client.textContent).not.toContain("0b2f8c0e");
    });

    test("a client with no name is still a row somebody can find and disconnect", () => {
      renderPage();

      expect(cell(2, "Client").textContent).toBe("MCP Client");
    });

    test("a name is shown as text", () => {
      mockRows = [
        grant({
          name: '<img src=x onerror="alert(1)"> Claude',
          clientId: "https://claude.ai/client.json",
        }),
      ];

      const { container } = renderPage();

      expect(
        within(cell(0, "Client")).getByText(
          '<img src=x onerror="alert(1)"> Claude',
        ),
      ).toBeInTheDocument();
      expect(container.querySelector('img[src="x"]')).toBeNull();
    });
  });

  describe("the Access cell", () => {
    test("says read and write only for a grant that carries write", () => {
      renderPage();

      expect(cell(0, "Access").textContent).toBe("Read and write");
      expect(cell(1, "Access").textContent).toBe("Read only");
    });

    test("a row with no scope reads as read only, never as blank", () => {
      renderPage();

      expect(cell(2, "Access").textContent).toBe("Read only");
    });
  });

  describe("fitting the row on a laptop screen", () => {
    /*
     * Table cells do not wrap, so one long client name or email address makes
     * the table wider than its card and pushes Disconnect - the thing the
     * table is for - out of sight. The two free-text columns are capped. And
     * a capped cell whose text did NOT truncate would paint that text over
     * the column beside it (see Common/UI/Components/Table/Types/Column.ts),
     * so every line in those two cells has to.
     */
    const LONG_CLIENT_NAME: string =
      "An MCP Client With A Remarkably Long Name (workstation-eu-west-1)";
    const LONG_MEMBER_NAME: string = "Bartholomew Maximilian Featherstonehaugh";
    const LONG_EMAIL: string =
      "a.very.long.mailbox.name@a-long-subdomain.engineering.example.com";

    type ColumnTitledFunction = (title: string) => MockColumn;

    const columnTitled: ColumnTitledFunction = (title: string): MockColumn => {
      const found: MockColumn | undefined = tableProps().columns.find(
        (column: MockColumn): boolean => {
          return column.title === title;
        },
      );

      if (!found) {
        throw new Error(`The table has no "${title}" column`);
      }

      return found;
    };

    test("caps the two free-text columns, with more room on a wide screen", () => {
      renderPage();

      expect(columnTitled("Client").contentClassName).toBe(
        "max-w-[10rem] 2xl:max-w-[18rem]",
      );
      expect(columnTitled("Connected By").contentClassName).toBe(
        "max-w-[11rem] 2xl:max-w-[18rem]",
      );
    });

    test("leaves the columns that are short by nature alone", () => {
      renderPage();

      expect(columnTitled("Access").contentClassName).toBeUndefined();
      expect(columnTitled("Last Used").contentClassName).toBeUndefined();
    });

    test("no column wraps: a cap here cuts text short, it does not fold it", () => {
      renderPage();

      for (const column of tableProps().columns) {
        expect(column.wrapContent).toBeUndefined();
      }
    });

    test("every line of the Client cell truncates, and says the whole of itself on hover", () => {
      mockRows = [
        grant({
          name: LONG_CLIENT_NAME,
          clientId:
            "https://a-very-long-host-name.clients.example.com/oauth/client.json",
        }),
      ];

      renderPage();

      const lines: Array<HTMLElement> = Array.from(
        cell(0, "Client").querySelectorAll("span"),
      );

      expect(lines).toHaveLength(2);

      for (const line of lines) {
        expect(line).toHaveClass("truncate");
        expect(line.getAttribute("title")).toBe(line.textContent);
      }

      expect(lines[0]!.getAttribute("title")).toBe(LONG_CLIENT_NAME);
      expect(lines[1]!.getAttribute("title")).toBe(
        "a-very-long-host-name.clients.example.com",
      );
    });

    test("the lines can shrink inside the cap: their container does not hold them at full width", () => {
      renderPage();

      expect(cell(0, "Client").firstElementChild).toHaveClass("min-w-0");
    });

    test("a client with no name still has a tooltip that says what the row shows", () => {
      renderPage();

      expect(
        cell(2, "Client").querySelector("span")!.getAttribute("title"),
      ).toBe("MCP Client");
    });

    test("every line of the Connected By cell truncates", () => {
      mockRows = [
        grant({
          name: "Claude",
          user: { name: LONG_MEMBER_NAME, email: LONG_EMAIL },
        }),
      ];

      renderPage();

      const connectedBy: HTMLElement = cell(0, "Connected By");
      const name: HTMLElement = within(connectedBy).getByText(LONG_MEMBER_NAME);

      // An inline span cannot be cut short; a block one can.
      expect(name).toHaveClass("block");
      expect(name).toHaveClass("truncate");
      expect(within(connectedBy).getByTestId("user-email")).toHaveClass(
        "truncate",
      );
    });

    test("the Connected By cell says who it is, in full, on hover", () => {
      mockRows = [
        grant({
          name: "Claude",
          user: { name: LONG_MEMBER_NAME, email: LONG_EMAIL },
        }),
      ];

      renderPage();

      expect(
        cell(0, "Connected By").firstElementChild!.getAttribute("title"),
      ).toBe(`${LONG_MEMBER_NAME} - ${LONG_EMAIL}`);
    });

    test("a member with no name on file is described by the email alone", () => {
      const row: McpOAuthGrant = grant({ name: "Claude" });
      const user: User = new User();

      user._id = ObjectID.generate().toString();
      user.email = new Email("solo@example.com");
      row.user = user;
      mockRows = [row];

      renderPage();

      expect(
        cell(0, "Connected By").firstElementChild!.getAttribute("title"),
      ).toBe("solo@example.com");
    });

    test("a row whose member could not be read has nothing to say on hover", () => {
      renderPage();

      expect(cell(2, "Connected By").querySelector("[title]")).toBeNull();
    });
  });

  describe("the Connected By cell", () => {
    test("names the member the client acts as", () => {
      renderPage();

      expect(cell(0, "Connected By")).toHaveTextContent("Ada Lovelace");
      expect(cell(0, "Connected By")).toHaveTextContent("ada@example.com");
      expect(cell(1, "Connected By")).toHaveTextContent("Grace Hopper");
    });

    test("a row whose member could not be read shows a dash", () => {
      renderPage();

      expect(cell(2, "Connected By").textContent).toBe("-");
    });
  });
});

describe("the MCP Server card", () => {
  test("shows this instance's own /mcp address before anything else", () => {
    const { container } = renderPage();

    expect(snippets(container)[0]).toBe(MCP_URL);
    expect(within(card("MCP Server")).getByText(MCP_URL)).toBeInTheDocument();
    expect(
      within(card("MCP Server")).getByText("Server URL", { selector: "h3" }),
    ).toBeInTheDocument();
  });

  test("its address, its choice and its setup are the card's body, which a phone shows too", () => {
    renderPage();

    /*
     * Card draws a description inside a <p> hidden below md: the page had
     * the address and every setup there, so a phone showed none of them.
     */
    const description: HTMLElement | null = within(
      card("MCP Server"),
    ).queryByTestId("card-description");

    for (const shown of [
      screen.getByText(MCP_URL),
      screen.getByTestId("mcp-sign-in"),
      setup(),
    ]) {
      expect(description?.contains(shown) ?? false).toBe(false);
      expect(shown.closest(".max-md\\:hidden")).toBeNull();
    }
  });

  test("draws no paragraph, list or block inside a paragraph", () => {
    /*
     * Read off the DOM, not React's warning: React gives that once per
     * process, and an earlier render in this file would have used it up.
     */
    const NESTED: string = ["p", "div", "ul", "ol", "pre", "h3", "table"]
      .map((tag: string): string => {
        return `p ${tag}`;
      })
      .join(", ");

    const { container } = renderPage();
    const nested: Array<string> = [];

    for (const signIn of ["OneUptime", "API key"]) {
      pickSignIn(signIn);

      for (const client of [
        "Claude Code",
        "Claude Desktop",
        "VS Code",
        "Cursor",
      ]) {
        pickClient(client);
        container.querySelectorAll(NESTED).forEach((element: Element) => {
          nested.push(`${signIn} / ${client}: <${element.tagName}>`);
        });
      }
    }

    expect(nested).toEqual([]);
  });
});

describe("how a client signs in", () => {
  test("is one choice: OneUptime first and picked, an API key second", () => {
    renderPage();

    const choice: HTMLElement = screen.getByTestId("mcp-sign-in");
    const options: Array<HTMLInputElement> = within(choice).getAllByRole(
      "radio",
    ) as Array<HTMLInputElement>;

    expect(choice).toHaveAccessibleName("Sign in with");
    expect(
      options.map((option: HTMLInputElement): string => {
        return (
          choice.querySelector(`label[for="${option.id}"]`)?.textContent || ""
        );
      }),
    ).toEqual(["OneUptime", "API key"]);
    expect(
      options.map((option: HTMLInputElement): boolean => {
        return option.checked;
      }),
    ).toEqual([true, false]);
  });

  test("says in a line under each answer what it means", () => {
    renderPage();

    const signIn: HTMLElement = within(
      screen.getByTestId("mcp-sign-in"),
    ).getByLabelText("OneUptime");
    const apiKey: HTMLElement = within(
      screen.getByTestId("mcp-sign-in"),
    ).getByLabelText("API key");

    // Signing in: the member's own permissions and never more, read only if chosen.
    expect(signIn).toHaveAccessibleDescription(
      "The client opens OneUptime for you to sign in, then acts as you, with your permissions and never more. You can limit it to read only.",
    );
    expect(apiKey).toHaveAccessibleDescription(
      "For an agent that runs unattended, such as a scheduled job. It acts with the key's permissions, in the key's project.",
    );
  });

  test("signing in: says where a connected client is listed and disconnected", () => {
    renderPage();

    const note: HTMLElement = screen.getByTestId("mcp-sign-in-note");

    expect(note).toHaveTextContent(
      "Clients connected this way are listed under Connected MCP Clients, where you can disconnect them.",
    );
    expect(within(note).queryByRole("link")).toBeNull();
  });

  test("an API key: links to this project's API keys and still warns against a master key", () => {
    renderPage();
    pickSignIn("API key");

    const note: HTMLElement = screen.getByTestId("mcp-sign-in-note");
    const link: HTMLElement = within(note).getByRole("link");

    expect(link).toHaveTextContent("Project Settings → Advanced → API Keys");
    expect(link).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/settings/api-keys`,
    );
    expect(note).toHaveTextContent(
      "Create a key in Project Settings → Advanced → API Keys with the least access the agent needs.",
    );
    expect(note).toHaveTextContent(
      "Never give an agent a master API key: it grants admin access to the whole instance.",
    );
  });
});

// Every client, each way: the sentence's own words and the snippet to copy.
const SETUPS: Array<[string, string, string, string | null]> = [
  [
    "Claude Code",
    "OneUptime",
    "Add the server, then run /mcp inside Claude Code and choose OneUptime to sign in:",
    `claude mcp add --transport http oneuptime ${MCP_URL}`,
  ],
  [
    "Claude Code",
    "API key",
    "Add the server with your API key:",
    `claude mcp add --transport http oneuptime ${MCP_URL} --header "x-api-key: your-api-key-here"`,
  ],
  [
    "Claude Desktop",
    "OneUptime",
    "In Claude, open Customize → Connectors, choose Add custom connector and enter the server URL above. Claude asks you to sign in to OneUptime the first time it needs your data.",
    null,
  ],
  [
    "Claude Desktop",
    "API key",
    "Add this to claude_desktop_config.json:",
    JSON.stringify(
      {
        mcpServers: {
          oneuptime: {
            transport: "streamable-http",
            url: MCP_URL,
            headers: { "x-api-key": "your-api-key-here" },
          },
        },
      },
      null,
      2,
    ),
  ],
  [
    "VS Code",
    "OneUptime",
    "Add this to .vscode/mcp.json. VS Code opens OneUptime for you to sign in when you start the server:",
    JSON.stringify(
      { servers: { oneuptime: { type: "http", url: MCP_URL } } },
      null,
      2,
    ),
  ],
  [
    "VS Code",
    "API key",
    "Add this to .vscode/mcp.json. VS Code asks for your API key when you start the server:",
    JSON.stringify(
      {
        servers: {
          oneuptime: {
            type: "http",
            url: MCP_URL,
            headers: { "x-api-key": "${input:oneuptime-api-key}" },
          },
        },
        inputs: [
          {
            type: "promptString",
            id: "oneuptime-api-key",
            description: "OneUptime API Key",
            password: true,
          },
        ],
      },
      null,
      2,
    ),
  ],
  [
    "Cursor",
    "OneUptime",
    "Add this to ~/.cursor/mcp.json. Cursor opens OneUptime for you to sign in:",
    JSON.stringify({ mcpServers: { oneuptime: { url: MCP_URL } } }, null, 2),
  ],
  [
    "Cursor",
    "API key",
    "Add this to ~/.cursor/mcp.json:",
    JSON.stringify(
      {
        mcpServers: {
          oneuptime: {
            url: MCP_URL,
            headers: { "x-api-key": "your-api-key-here" },
          },
        },
      },
      null,
      2,
    ),
  ],
];

type AllSnippetsFunction = () => Array<string>;

// Every client's snippet, each way, as the page shows them one at a time.
const allSetupSnippets: AllSnippetsFunction = (): Array<string> => {
  const found: Array<string> = [];

  for (const signIn of ["OneUptime", "API key"]) {
    pickSignIn(signIn);

    for (const client of [
      "Claude Code",
      "Claude Desktop",
      "VS Code",
      "Cursor",
    ]) {
      pickClient(client);
      found.push(...snippets(setup()));
    }
  }

  return found;
};

describe("a client's setup", () => {
  test("is a tab per client, Claude Code first and open", () => {
    renderPage();

    const tabs: Array<HTMLElement> = within(
      screen.getByTestId("mcp-server-connect"),
    ).getAllByRole("tab");

    expect(
      tabs.map((tab: HTMLElement): string => {
        return tab.textContent || "";
      }),
    ).toEqual(["Claude Code", "Claude Desktop", "VS Code", "Cursor"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(setup()).toHaveTextContent("inside Claude Code");
  });

  test("the four clients wrap onto a second line on a phone, so Cursor is never scrolled out of sight", () => {
    renderPage();

    const row: HTMLElement = within(
      screen.getByTestId("mcp-server-connect"),
    ).getByRole("tablist");

    // A row that scrolls hid VS Code and Cursor past the edge at 390px.
    expect(row).toHaveClass("flex-wrap");
    expect(row).not.toHaveClass("overflow-x-auto");
  });

  test("a client's setup lines up with the address and the sign-in choice above it", () => {
    renderPage();

    const panel: HTMLElement = within(
      screen.getByTestId("mcp-server-connect"),
    ).getByRole("tabpanel");

    // The shared panel's ml-1 set the setup 4px in from the rest of the card.
    expect(panel).not.toHaveClass("ml-1");
    expect(panel).toContainElement(setup());
  });

  test.each(SETUPS)(
    "%s, signing in with %s: the one setup for that client and that way",
    (
      client: string,
      signIn: string,
      sentence: string,
      snippet: string | null,
    ) => {
      renderPage();
      pickSignIn(signIn);
      pickClient(client);

      const shown: HTMLElement = setup();

      expect(shown.querySelector("p")).toHaveTextContent(sentence, {
        normalizeWhitespace: true,
      });
      expect(snippets(shown)).toEqual(snippet === null ? [] : [snippet]);
    },
  );

  test("the tab stays open when the way of signing in changes, and its setup follows", () => {
    renderPage();
    pickClient("Cursor");
    pickSignIn("API key");

    expect(screen.getByRole("tab", { name: "Cursor" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(snippets(setup())[0]).toContain('"x-api-key"');

    pickSignIn("OneUptime");

    expect(snippets(setup())[0]).not.toContain("x-api-key");
  });

  test("the page shows the address and one setup at a time: no client's setup twice", () => {
    const { container } = renderPage();

    expect(snippets(container)).toHaveLength(2);

    pickSignIn("API key");

    expect(snippets(container)).toHaveLength(2);
  });

  test("the address and a command wrap on a narrow screen; a file's JSON keeps its lines", () => {
    const { container } = renderPage();

    type WrapsFunction = (block: Element) => boolean;

    const wraps: WrapsFunction = (block: Element): boolean => {
      return block.className.includes(CODE_BLOCK_WRAP_CLASS_NAME);
    };

    const codeBlocks: () => Array<Element> = (): Array<Element> => {
      return Array.from(container.querySelectorAll("pre > code"));
    };

    // The address, and Claude Code's command.
    expect(codeBlocks().map(wraps)).toEqual([true, true]);

    pickSignIn("API key");

    expect(codeBlocks().map(wraps)).toEqual([true, true]);

    for (const client of ["Claude Desktop", "VS Code", "Cursor"]) {
      pickClient(client);

      expect({ client, wraps: codeBlocks().map(wraps) }).toEqual({
        client,
        wraps: [true, false],
      });
    }
  });

  test("each sentence keeps its command, file or menu in place, drawn as such", () => {
    renderPage();

    expect(within(setup()).getByText("/mcp").tagName).toBe("CODE");

    pickClient("Claude Desktop");

    expect(within(setup()).getByText("Customize → Connectors").tagName).toBe(
      "STRONG",
    );
    expect(within(setup()).getByText("Add custom connector").tagName).toBe(
      "STRONG",
    );

    pickClient("VS Code");

    expect(within(setup()).getByText(".vscode/mcp.json").tagName).toBe("CODE");

    pickClient("Cursor");

    expect(within(setup()).getByText("~/.cursor/mcp.json").tagName).toBe(
      "CODE",
    );

    pickSignIn("API key");
    pickClient("Claude Desktop");

    expect(
      within(setup()).getByText("claude_desktop_config.json").tagName,
    ).toBe("CODE");
  });

  test("signing in, no snippet carries a key or a header", () => {
    renderPage();
    pickSignIn("OneUptime");

    for (const client of [
      "Claude Code",
      "Claude Desktop",
      "VS Code",
      "Cursor",
    ]) {
      pickClient(client);

      for (const snippet of snippets(setup())) {
        expect({ client, snippet }).toEqual({
          client,
          snippet: expect.not.stringMatching(/header|api-key|x-api-key/i),
        });
      }
    }
  });

  test("with an API key, every snippet sends it in x-api-key, and VS Code asks for it rather than keep it in the file", () => {
    renderPage();
    pickSignIn("API key");

    for (const client of [
      "Claude Code",
      "Claude Desktop",
      "VS Code",
      "Cursor",
    ]) {
      pickClient(client);

      const [snippet] = snippets(setup());

      expect({ client, sendsKey: snippet?.includes("x-api-key") }).toEqual({
        client,
        sendsKey: true,
      });
    }

    pickClient("VS Code");

    expect(snippets(setup())[0]).not.toContain("your-api-key-here");
    expect(snippets(setup())[0]).toContain('"password": true');
  });

  test("every snippet names this instance, and none names another", () => {
    renderPage();

    const all: Array<string> = allSetupSnippets();

    expect(all).toHaveLength(7);

    for (const snippet of all) {
      expect(snippet).toContain(MCP_URL);
      // Not the cloud's address on a self-hosted instance.
      expect(snippet).not.toContain("oneuptime.com/mcp");
      expect(snippet).not.toContain("localhost");
    }
  });

  test("no snippet contains anything that looks like a real credential", () => {
    renderPage();

    const LOOKS_LIKE_A_SECRET: RegExp =
      /oumcp_|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

    for (const snippet of allSetupSnippets()) {
      expect(LOOKS_LIKE_A_SECRET.test(snippet)).toBe(false);
    }
  });
});

describe("the page's other cards", () => {
  test("the table of connected clients sits right under the MCP Server card, above What agents can do", () => {
    renderPage();

    const table: HTMLElement = screen.getByTestId(
      "model-table-mcp-client-authorizations-table",
    );

    expect(isBefore(card("MCP Server"), table)).toBe(true);
    expect(isBefore(table, card("What agents can do"))).toBe(true);
  });

  test("the page no longer explains signing in on a card of its own, or gives a card per client", () => {
    renderPage();

    for (const title of [
      "Authentication",
      "Connect Claude Code",
      "Connect Claude Desktop",
      "Connect VS Code or Cursor",
    ]) {
      expect(
        screen.queryByText(title, { selector: "h1, h2, h3, h4" }),
      ).toBeNull();
    }
  });

  test("What agents can do is the card's body, which a phone shows too", () => {
    renderPage();

    const agents: HTMLElement = card("What agents can do");
    const safety: HTMLElement = within(agents).getByText(/^Safety:/);

    expect(within(agents).queryByTestId("card-description")).toBeNull();
    expect(safety.closest(".max-md\\:hidden")).toBeNull();
  });

  test("links to the documentation in a new tab", () => {
    renderPage();

    const link: HTMLElement = screen.getByRole("link", {
      name: "MCP server documentation",
    });

    expect(link).toHaveAttribute("href", "/docs/ai/mcp-server");
    expect(link).toHaveAttribute("target", "_blank");
  });

  /*
   * The other way round: this page lets agents use OneUptime's tools, and
   * External MCP Servers lets OneUptime AI use other servers' - a person
   * who came here looking for that finds it, one link away, in the same
   * tab (it is a page of the same Settings).
   */
  test("points the other way: OneUptime AI uses other MCP servers' tools from External MCP Servers", () => {
    renderPage();

    const agents: HTMLElement = card("What agents can do");
    const line: HTMLElement = within(agents).getByTestId(
      "mcp-server-external-servers",
    );

    expect(line).toHaveTextContent(
      "To let OneUptime AI use the tools of other MCP servers, such as AWS's or GitHub's, add them in External MCP Servers.",
    );

    const link: HTMLElement = within(line).getByRole("link", {
      name: "External MCP Servers",
    });

    expect(link).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/settings/external-mcp-servers`,
    );
    expect(link).not.toHaveAttribute("target", "_blank");
    // After the documentation's line: what this page is, then the other way.
    expect(
      isBefore(
        within(agents).getByRole("link", { name: "MCP server documentation" }),
        line,
      ),
    ).toBe(true);
  });

  test("tells the reader a signed-in client can be limited to read-only", () => {
    renderPage();

    expect(card("What agents can do")).toHaveTextContent(
      "A client connected by sign-in can be limited to read only.",
    );
  });

  test("says what agents can do in the reader's words, not the protocol's", () => {
    renderPage();

    const agents: HTMLElement = card("What agents can do");

    expect(
      within(agents)
        .getAllByRole("listitem")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
    ).toEqual([
      "Incident response: acknowledge and resolve incidents and alerts, add notes and post status page updates.",
      "Investigation: search logs, metrics, traces, exceptions and monitor results over a time range.",
      "Management: create, change and delete incidents, alerts, monitors, status pages, on-call policies, teams, labels and more.",
      "Safety: clients may run read-only tools without asking, and ask before anything that deletes. A client connected by sign-in can be limited to read only.",
    ]);

    for (const jargon of [
      "create/read/update/delete",
      "annotated",
      "auto-approve",
      "tool call",
      "time-range filters",
    ]) {
      expect(agents.textContent).not.toContain(jargon);
    }

    expect(agents).toHaveTextContent(
      "See the MCP server documentation for every tool.",
    );
  });
});
