import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "Common/Tests/MockType";

/*
 * ---------------------------------------------------------------------------
 * The audit log table: what a change was made THROUGH
 * ---------------------------------------------------------------------------
 *
 * The Actor column has always said who made a change. It now also says what
 * they made it through, when that was not their own hands at the dashboard:
 *
 *   - an MCP client the member connected by signing in. The member is still
 *     the actor - the client acts as them - and a line under their name says
 *     "via <client> (MCP client)". Without it, a change an agent made would
 *     read exactly like one the person made themselves;
 *   - the instance master API key, which acts as the master admin user:
 *     "via Master API Key";
 *   - a project API key is NOT a "via": there is no person behind it, so the
 *     key is the actor and is shown by its name. Before the recorder carried
 *     the name every key read "API Key".
 *
 * The table also has to ASK for the columns: the analytics list API returns
 * only what is selected, so a column missing from selectMoreFields is a label
 * that silently never appears.
 *
 * AnalyticsModelTable is mocked to capture its props, as in
 * AuditLogsTable.test.tsx; each test renders the Actor column's own cell for
 * one entry.
 */

let billingEnabledForTest: boolean = false;

jest.mock("Common/UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  return mocked;
});

const mockLicenseFetch: MockFunction = getJestMockFunction();

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      fetch: (...args: Array<unknown>): unknown => {
        return mockLicenseFetch(...args);
      },
      getFriendlyMessage: (): string => {
        return "";
      },
    },
  };
});

type CapturedColumn = {
  title: string;
  getElement?: ((item: AuditLog) => React.ReactElement) | undefined;
};

type CapturedTableProps = {
  selectMoreFields?: Record<string, boolean>;
  columns?: Array<CapturedColumn>;
};

let capturedTableProps: CapturedTableProps | null = null;
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("Common/UI/Components/ModelTable/AnalyticsModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps): React.ReactElement => {
      capturedTableProps = props;
      const react: typeof React = jest.requireActual("react") as typeof React;

      return react.createElement("div", {
        "data-testid": "audit-logs-analytics-table",
      });
    },
  };
});

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
    },
  };
});

import AuditLogsTable from "../../../Dashboard/AuditLogs/AuditLogsTable";
import {
  RESOURCE_META,
  getActorCredentialLabel,
} from "@oneuptime/dashboard/Components/AuditLogs/AuditLogsTableUtils";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import Project from "Common/Models/DatabaseModels/Project";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const API_KEY_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const GRANT_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

const CREDENTIAL_TEST_ID: string = "audit-actor-credential";
const ACTOR_CELL_TEST_ID: string = "actor-cell";

interface EntryData {
  userType?: string | undefined;
  userId?: ObjectID | undefined;
  userName?: string | undefined;
  userEmail?: string | undefined;
  apiKeyId?: ObjectID | undefined;
  apiKeyName?: string | undefined;
  mcpOAuthGrantId?: ObjectID | undefined;
  mcpClientName?: string | undefined;
  workflowId?: ObjectID | undefined;
  workflowName?: string | undefined;
}

type MakeEntryFunction = (data: EntryData) => AuditLog;

// Only what is given is set, as on a row the list API returned.
const makeEntry: MakeEntryFunction = (data: EntryData): AuditLog => {
  const entry: AuditLog = new AuditLog();
  entry.resourceType = "Monitor";
  entry.resourceName = "Checkout API";
  entry.action = "Update";

  if (data.userType !== undefined) {
    entry.userType = data.userType;
  }
  if (data.userId !== undefined) {
    entry.userId = data.userId;
  }
  if (data.userName !== undefined) {
    entry.userName = data.userName;
  }
  if (data.userEmail !== undefined) {
    entry.userEmail = data.userEmail;
  }
  if (data.apiKeyId !== undefined) {
    entry.apiKeyId = data.apiKeyId;
  }
  if (data.apiKeyName !== undefined) {
    entry.apiKeyName = data.apiKeyName;
  }
  if (data.mcpOAuthGrantId !== undefined) {
    entry.mcpOAuthGrantId = data.mcpOAuthGrantId;
  }
  if (data.mcpClientName !== undefined) {
    entry.mcpClientName = data.mcpClientName;
  }
  if (data.workflowId !== undefined) {
    entry.workflowId = data.workflowId;
  }
  if (data.workflowName !== undefined) {
    entry.workflowName = data.workflowName;
  }

  return entry;
};

type RenderActorCellFunction = (data: EntryData) => HTMLElement;

const renderActorCell: RenderActorCellFunction = (
  data: EntryData,
): HTMLElement => {
  const column: CapturedColumn | undefined = capturedTableProps?.columns?.find(
    (candidate: CapturedColumn): boolean => {
      return candidate.title === "Actor";
    },
  );

  expect(column?.getElement).toBeDefined();

  render(
    <MemoryRouter>
      <div data-testid={ACTOR_CELL_TEST_ID}>
        {column!.getElement!(makeEntry(data))}
      </div>
    </MemoryRouter>,
  );

  return screen.getByTestId(ACTOR_CELL_TEST_ID);
};

type FlushFunction = () => Promise<void>;

// Lets the settings read and the license read land before the table is used.
const flushReads: FlushFunction = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
};

beforeEach(async () => {
  capturedTableProps = null;
  billingEnabledForTest = false;

  getItemMock.mockReset();

  const project: Project = new Project();
  project._id = PROJECT_ID.toString();
  project.enableAuditLogs = true;
  getItemMock.mockResolvedValue(project);

  mockLicenseFetch.mockReset();
  mockLicenseFetch.mockResolvedValue({
    isSuccess: (): boolean => {
      return true;
    },
    data: { status: "valid", licenseValid: true },
  });

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);

  // Mount the table once to capture its columns, then clear the DOM.
  render(
    <MemoryRouter>
      <AuditLogsTable
        title="Audit Logs"
        description="Changes in this project."
      />
    </MemoryRouter>,
  );
  await flushReads();
  cleanup();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the table asks for the credential columns", () => {
  test("it selects the MCP client's name and grant, and the API key's name and id", () => {
    expect(capturedTableProps?.selectMoreFields).toEqual(
      expect.objectContaining({
        mcpClientName: true,
        mcpOAuthGrantId: true,
        apiKeyName: true,
        apiKeyId: true,
      }),
    );
  });

  test("it still selects everything the actor cell reads about the person", () => {
    expect(capturedTableProps?.selectMoreFields).toEqual(
      expect.objectContaining({
        userId: true,
        userName: true,
        userType: true,
      }),
    );
  });

  test("the Actor column is there to render", () => {
    const titles: Array<string> = (capturedTableProps?.columns || []).map(
      (column: CapturedColumn): string => {
        return column.title;
      },
    );

    expect(titles).toContain("Actor");
  });
});

/*
 * A workflow step acts as no person (WorkflowPrincipal), so a change it made
 * is the workflow's: the cell names the workflow, as it was called at the
 * time, and adds no "via" line.
 */
describe("a change a workflow made", () => {
  const WORKFLOW_ID: ObjectID = new ObjectID(
    "99999999-9999-4999-8999-999999999999",
  );

  test("the table asks for the workflow's id and name", () => {
    expect(capturedTableProps?.selectMoreFields).toEqual(
      expect.objectContaining({ workflowId: true, workflowName: true }),
    );
  });

  test("the workflow is the actor, by its name", () => {
    const cell: HTMLElement = renderActorCell({
      userType: "Workflow",
      workflowId: WORKFLOW_ID,
      workflowName: "Close stale incidents",
    });

    const actor: HTMLElement = within(cell).getByTestId(
      "audit-log-workflow-actor",
    );

    expect(actor).toHaveTextContent("Close stale incidents");
    expect(actor).toHaveTextContent("Workflow");
    expect(within(cell).queryByTestId(CREDENTIAL_TEST_ID)).toBeNull();
  });

  test("a workflow with no name reads as Workflow", () => {
    const cell: HTMLElement = renderActorCell({
      userType: "Workflow",
      workflowId: WORKFLOW_ID,
    });

    const actor: HTMLElement = within(cell).getByTestId(
      "audit-log-workflow-actor",
    );

    expect(actor.textContent).toBe("WorkflowWorkflow");
  });

  test("it is not drawn as OneUptime's own change", () => {
    const cell: HTMLElement = renderActorCell({
      userType: "Workflow",
      workflowName: "Close stale incidents",
    });

    expect(cell).not.toHaveTextContent("System");
  });
});

describe("a change made through a connected MCP client", () => {
  test("the member is the actor, and a line under them names the client", () => {
    const cell: HTMLElement = renderActorCell({
      userType: "User",
      userId: USER_ID,
      userName: "Ada Lovelace",
      userEmail: "ada@example.com",
      mcpOAuthGrantId: GRANT_ID,
      mcpClientName: "Claude Code",
    });

    expect(cell).toHaveTextContent("Ada Lovelace");
    expect(cell).toHaveTextContent("ada@example.com");

    const credential: HTMLElement =
      within(cell).getByTestId(CREDENTIAL_TEST_ID);

    expect(credential).toHaveTextContent("via Claude Code (MCP client)");
    expect(credential.textContent).toBe("via Claude Code (MCP client)");
  });

  test("the label comes after the member's name and email, not instead of them", () => {
    const cell: HTMLElement = renderActorCell({
      userType: "User",
      userName: "Ada Lovelace",
      userEmail: "ada@example.com",
      mcpClientName: "Claude Code",
    });

    const text: string = cell.textContent || "";

    expect(text.indexOf("Ada Lovelace")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("ada@example.com")).toBeGreaterThan(
      text.indexOf("Ada Lovelace"),
    );
    expect(text.indexOf("via Claude Code (MCP client)")).toBeGreaterThan(
      text.indexOf("ada@example.com"),
    );
  });

  test("it is not shown as an API request or as the system", () => {
    const cell: HTMLElement = renderActorCell({
      userType: "User",
      userName: "Ada Lovelace",
      userEmail: "ada@example.com",
      mcpClientName: "Claude Code",
    });

    expect(cell).not.toHaveTextContent("API request");
    expect(cell).not.toHaveTextContent("Automated change");
    expect(cell).not.toHaveTextContent("System");
  });

  test("a member known only by email still gets the label", () => {
    const cell: HTMLElement = renderActorCell({
      userType: "User",
      userEmail: "ada@example.com",
      mcpClientName: "Cursor",
    });

    expect(cell).toHaveTextContent("ada@example.com");
    expect(within(cell).getByTestId(CREDENTIAL_TEST_ID)).toHaveTextContent(
      "via Cursor (MCP client)",
    );
  });

  test("the client's name is shown as text, never as markup", () => {
    const cell: HTMLElement = renderActorCell({
      userType: "User",
      userName: "Ada Lovelace",
      userEmail: "ada@example.com",
      mcpClientName: '<img src=x onerror="alert(1)"> Agent',
    });

    const credential: HTMLElement =
      within(cell).getByTestId(CREDENTIAL_TEST_ID);

    expect(credential.textContent).toBe(
      'via <img src=x onerror="alert(1)"> Agent (MCP client)',
    );
    expect(credential.querySelector("img")).toBeNull();
    expect(cell.querySelector("img")).toBeNull();
  });

  test("the grant id alone, with no client name, adds no label", () => {
    const cell: HTMLElement = renderActorCell({
      userType: "User",
      userName: "Ada Lovelace",
      userEmail: "ada@example.com",
      mcpOAuthGrantId: GRANT_ID,
    });

    expect(within(cell).queryByTestId(CREDENTIAL_TEST_ID)).toBeNull();
  });

  test("when an entry somehow names both, the MCP client is what is shown", () => {
    const cell: HTMLElement = renderActorCell({
      userType: "User",
      userName: "Ada Lovelace",
      userEmail: "ada@example.com",
      apiKeyName: "CI deploy key",
      mcpClientName: "Claude Code",
    });

    expect(within(cell).getByTestId(CREDENTIAL_TEST_ID).textContent).toBe(
      "via Claude Code (MCP client)",
    );
  });
});

describe("a change made with an API key", () => {
  test("a project API key is the actor itself, shown by its name - there is no person to put a 'via' under", () => {
    const cell: HTMLElement = renderActorCell({
      userType: "API",
      apiKeyId: API_KEY_ID,
      apiKeyName: "CI deploy key",
    });

    expect(cell).toHaveTextContent("CI deploy key");
    expect(cell).toHaveTextContent("API request");
    expect(within(cell).queryByTestId(CREDENTIAL_TEST_ID)).toBeNull();
    expect(cell).not.toHaveTextContent("via");
  });

  test("two project keys read differently", () => {
    const first: string =
      renderActorCell({ userType: "API", apiKeyName: "CI deploy key" })
        .textContent || "";
    cleanup();
    const second: string =
      renderActorCell({ userType: "API", apiKeyName: "Terraform" })
        .textContent || "";

    expect(first).toContain("CI deploy key");
    expect(second).toContain("Terraform");
    expect(first).not.toBe(second);
  });

  test("an entry recorded before the key's name was carried still reads 'API Key'", () => {
    const cell: HTMLElement = renderActorCell({ userType: "API" });

    expect(cell).toHaveTextContent("API Key");
    expect(cell).toHaveTextContent("API request");
    expect(within(cell).queryByTestId(CREDENTIAL_TEST_ID)).toBeNull();
  });

  test("the master API key acts as the master admin, so it is a 'via' under that person", () => {
    const cell: HTMLElement = renderActorCell({
      userType: "MasterAdmin",
      userName: "Root Admin",
      userEmail: "root@example.com",
      apiKeyName: "Master API Key",
    });

    expect(cell).toHaveTextContent("Root Admin");
    expect(within(cell).getByTestId(CREDENTIAL_TEST_ID).textContent).toBe(
      "via Master API Key",
    );
    expect(cell).not.toHaveTextContent("(MCP client)");
  });
});

describe("a change made by hand, or by the system", () => {
  test("an ordinary session shows the person and nothing more", () => {
    const cell: HTMLElement = renderActorCell({
      userType: "User",
      userId: USER_ID,
      userName: "Ada Lovelace",
      userEmail: "ada@example.com",
    });

    expect(cell).toHaveTextContent("Ada Lovelace");
    expect(cell).toHaveTextContent("ada@example.com");
    expect(within(cell).queryByTestId(CREDENTIAL_TEST_ID)).toBeNull();
    expect(cell).not.toHaveTextContent("via");
  });

  test("an empty client or key name adds no label", () => {
    const cell: HTMLElement = renderActorCell({
      userType: "User",
      userName: "Ada Lovelace",
      userEmail: "ada@example.com",
      apiKeyName: "",
      mcpClientName: "",
    });

    expect(within(cell).queryByTestId(CREDENTIAL_TEST_ID)).toBeNull();
  });

  test("a system event shows the system, with no label", () => {
    const cell: HTMLElement = renderActorCell({ userType: "System" });

    expect(cell).toHaveTextContent("System");
    expect(cell).toHaveTextContent("Automated change");
    expect(within(cell).queryByTestId(CREDENTIAL_TEST_ID)).toBeNull();
  });
});

describe("the label itself", () => {
  test.each([
    {
      name: "a member through an MCP client",
      entry: { userType: "User", mcpClientName: "Claude Code" },
      expected: "via Claude Code (MCP client)",
    },
    {
      name: "the master API key",
      entry: { userType: "MasterAdmin", apiKeyName: "Master API Key" },
      expected: "via Master API Key",
    },
    {
      name: "a project API key (the key is the actor)",
      entry: { userType: "API", apiKeyName: "CI deploy key" },
      expected: null,
    },
    {
      name: "a project API key, even if a client name is present",
      entry: {
        userType: "API",
        apiKeyName: "CI deploy key",
        mcpClientName: "Claude Code",
      },
      expected: null,
    },
    {
      name: "an ordinary session",
      entry: { userType: "User" },
      expected: null,
    },
    {
      name: "an entry with no user type at all",
      entry: {},
      expected: null,
    },
    {
      name: "an MCP client on an entry with no user type",
      entry: { mcpClientName: "Cursor" },
      expected: "via Cursor (MCP client)",
    },
  ])(
    "$name -> $expected",
    (data: {
      entry: {
        userType?: string;
        apiKeyName?: string;
        mcpClientName?: string;
      };
      expected: string | null;
    }) => {
      expect(getActorCredentialLabel(data.entry)).toBe(data.expected);
    },
  );
});

describe("the entry for connecting or revoking a client", () => {
  test("'MCP Client Authorization' has an icon of its own and no page to open", () => {
    const meta: (typeof RESOURCE_META)[string] | undefined =
      RESOURCE_META["MCP Client Authorization"];

    expect(meta).toBeDefined();
    expect(meta!.icon).toBe(IconProp.Terminal);
    // Connected clients are a table on Settings > MCP Server, not a page each.
    expect(meta!.viewRoute).toBeUndefined();
    expect(meta!.childViewRoute).toBeUndefined();
  });

  test("its Resource cell names the client and links nowhere", () => {
    const column: CapturedColumn | undefined =
      capturedTableProps?.columns?.find(
        (candidate: CapturedColumn): boolean => {
          return candidate.title === "Resource";
        },
      );

    expect(column?.getElement).toBeDefined();

    const entry: AuditLog = new AuditLog();
    entry.resourceType = "MCP Client Authorization";
    entry.resourceName = "Claude Code";
    entry.resourceId = GRANT_ID;
    entry.rootResourceId = GRANT_ID;
    entry.action = "Create";

    render(
      <MemoryRouter>
        <div data-testid="resource-cell">{column!.getElement!(entry)}</div>
      </MemoryRouter>,
    );

    const cell: HTMLElement = screen.getByTestId("resource-cell");

    expect(cell).toHaveTextContent("Claude Code");
    expect(cell).toHaveTextContent("MCP Client Authorization");
    expect(within(cell).queryByRole("link")).toBeNull();
  });
});
