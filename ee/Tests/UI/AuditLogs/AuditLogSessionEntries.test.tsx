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
import * as React from "react";
import fs from "fs";
import path from "path";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "Common/Tests/MockType";

/*
 * ---------------------------------------------------------------------------
 * People's sessions in the audit log's table and details (issue #6762).
 * ---------------------------------------------------------------------------
 *
 * A sign-in, a sign-out, a session that timed out or was revoked is no
 * change: the table gives each its own badge, says in a few words how the
 * person signed in or why the session ended, and opens the rest - device,
 * address, place, times - in a dialog laid out as details, not as before
 * and after. The Action filter lists every action by its words, so nobody
 * has to know a sign-in is recorded as "SignIn".
 *
 * AnalyticsModelTable is mocked to capture its props, as in
 * AuditLogsTable.test.tsx; the cells are rendered from the captured columns.
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

type CapturedFilter = {
  title: string;
  type: string;
  filterDropdownOptions?: Array<{ label: string; value: string }>;
};

type CapturedTableProps = {
  columns?: Array<CapturedColumn>;
  filters?: Array<CapturedFilter>;
  noItemsMessage?: React.ReactElement;
};

let capturedTableProps: CapturedTableProps | null = null;
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("Common/UI/Components/ModelTable/AnalyticsModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps): React.ReactElement => {
      capturedTableProps = props;
      const react: typeof React = jest.requireActual("react") as typeof React;

      return react.createElement(
        "div",
        { "data-testid": "audit-logs-analytics-table" },
        props.noItemsMessage || null,
      );
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

import AuditLogsTable, {
  AUDIT_LOG_ACTION_FILTER_OPTIONS,
} from "../../../Dashboard/AuditLogs/AuditLogsTable";
import AuditLogChangesModal, {
  getSessionDetailsDescription,
  readSessionDetailRows,
  SessionDetailRow,
} from "../../../Dashboard/AuditLogs/AuditLogChangesModal";
import {
  RESOURCE_META,
  ResourceMeta,
} from "@oneuptime/dashboard/Components/AuditLogs/AuditLogsTableUtils";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import Project from "Common/Models/DatabaseModels/Project";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import { AUDIT_LOG_SESSION_RESOURCE_TYPE } from "Common/Types/AuditLog/AuditLogSessionEvent";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import ProjectUtil from "Common/UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SESSION_ID: ObjectID = new ObjectID(
  "41414141-4141-4141-8141-414141414141",
);
const USER_ID: ObjectID = new ObjectID("42424242-4242-4242-8242-424242424242");

const SIGN_IN_CHANGES: JSONArray = [
  { field: "signInMethod", newValue: "Password" },
  { field: "secondFactor", newValue: "Authenticator app" },
  { field: "device", newValue: "Chrome 130 on macOS" },
  { field: "ipAddress", newValue: "203.0.113.7" },
  { field: "location", newValue: "Berlin, Germany" },
];

const TIMEOUT_CHANGES: JSONArray = [
  { field: "reason", newValue: "Idle timeout reached" },
  { field: "signInMethod", newValue: "SAML single sign-on" },
  { field: "ssoProvider", newValue: "Acme Okta" },
  { field: "device", newValue: "Chrome 130 on macOS" },
  { field: "ipAddress", newValue: "203.0.113.7" },
  { field: "signedInAt", newValue: "2026-11-11T08:00:00.000Z" },
  { field: "lastActiveAt", newValue: "2026-11-11T09:15:00.000Z" },
  { field: "endedAt", newValue: "2026-11-11T09:45:00.000Z" },
];

const sessionEntry: (action: AuditLogAction, changes: JSONArray) => AuditLog = (
  action: AuditLogAction,
  changes: JSONArray,
): AuditLog => {
  const entry: AuditLog = new AuditLog();
  entry.projectId = PROJECT_ID;
  entry.action = action;
  entry.resourceType = AUDIT_LOG_SESSION_RESOURCE_TYPE;
  entry.resourceId = SESSION_ID;
  entry.resourceName = "Chrome 130 on macOS";
  entry.rootResourceType = "User";
  entry.rootResourceId = USER_ID;
  entry.userId = USER_ID;
  entry.userName = "Grace Hopper";
  entry.userEmail = "grace@acme.test";
  entry.userType = "User";
  entry.changes = changes;
  return entry;
};

const flush: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
};

const renderTable: () => Promise<void> = async (): Promise<void> => {
  render(
    <MemoryRouter>
      <AuditLogsTable
        title="Audit Logs"
        description="Every change made to the resources in this project, and every time its members sign in or out."
      />
    </MemoryRouter>,
  );
  await flush();
};

const column: (title: string) => CapturedColumn = (
  title: string,
): CapturedColumn => {
  const found: CapturedColumn | undefined = capturedTableProps?.columns?.find(
    (candidate: CapturedColumn): boolean => {
      return candidate.title === title;
    },
  );

  expect(found).toBeDefined();
  return found!;
};

const renderCell: (title: string, entry: AuditLog) => HTMLElement = (
  title: string,
  entry: AuditLog,
): HTMLElement => {
  const { container } = render(
    <MemoryRouter>{column(title).getElement!(entry)}</MemoryRouter>,
  );
  return container;
};

beforeEach(() => {
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
    data: { status: "valid", licenseValid: true } as JSONObject,
  });
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a session entry in the table", () => {
  test.each([
    [AuditLogAction.SignIn, "Sign In"],
    [AuditLogAction.SignOut, "Sign Out"],
    [AuditLogAction.SessionTimeout, "Session Timeout"],
    [AuditLogAction.SessionRevoked, "Session Revoked"],
  ])(
    "%s reads as %p in the Action column",
    async (action: AuditLogAction, label: string) => {
      await renderTable();

      const cell: HTMLElement = renderCell(
        "Action",
        sessionEntry(action, SIGN_IN_CHANGES),
      );

      expect(cell).toHaveTextContent(label);
      // Its words, never the one word an entry carries ("SignIn").
      expect(cell).not.toHaveTextContent(action);
    },
  );

  test("a sign-in's Changes cell says how they signed in, and opens the details", async () => {
    await renderTable();

    const cell: HTMLElement = renderCell(
      "Changes",
      sessionEntry(AuditLogAction.SignIn, SIGN_IN_CHANGES),
    );
    const summary: HTMLElement = within(cell).getByTestId(
      "audit-log-session-summary",
    );

    expect(summary).toHaveTextContent("Password + Authenticator app");
    // Not a change: no "fields captured".
    expect(cell).not.toHaveTextContent(/fields? captured/);

    fireEvent.click(summary);

    expect(
      await screen.findByText("Sign In · Chrome 130 on macOS"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("How and where they signed in"),
    ).toBeInTheDocument();
  });

  test("a session end's Changes cell says why it ended", async () => {
    await renderTable();

    const cell: HTMLElement = renderCell(
      "Changes",
      sessionEntry(AuditLogAction.SessionTimeout, TIMEOUT_CHANGES),
    );

    expect(
      within(cell).getByTestId("audit-log-session-summary"),
    ).toHaveTextContent("Idle timeout reached");
  });

  test("its Resource cell is the device it signed in from, a User Session", async () => {
    await renderTable();

    const cell: HTMLElement = renderCell(
      "Resource",
      sessionEntry(AuditLogAction.SignIn, SIGN_IN_CHANGES),
    );

    expect(cell).toHaveTextContent("Chrome 130 on macOS");
    expect(cell).toHaveTextContent("User Session");
    // A session is not a page: nothing to open.
    expect(within(cell).queryByRole("link")).toBeNull();
  });

  test("its Actor is the person whose session it is", async () => {
    await renderTable();

    const cell: HTMLElement = renderCell(
      "Actor",
      sessionEntry(AuditLogAction.SessionTimeout, TIMEOUT_CHANGES),
    );

    expect(cell).toHaveTextContent("Grace Hopper");
    expect(cell).toHaveTextContent("grace@acme.test");
  });

  test("a change's Changes cell is as it was", async () => {
    await renderTable();

    const update: AuditLog = new AuditLog();
    update.action = AuditLogAction.Update;
    update.changes = [{ field: "name", oldValue: "a", newValue: "b" }];

    const cell: HTMLElement = renderCell("Changes", update);

    expect(cell).toHaveTextContent("1 field changed");
    expect(within(cell).queryByTestId("audit-log-session-summary")).toBeNull();
  });
});

describe("the Action filter", () => {
  test("is a list of every action, by its words", async () => {
    await renderTable();

    const filter: CapturedFilter | undefined =
      capturedTableProps?.filters?.find(
        (candidate: CapturedFilter): boolean => {
          return candidate.title === "Action";
        },
      );

    expect(filter?.type).toBe("Dropdown");
    expect(filter?.filterDropdownOptions).toEqual([
      { label: "Create", value: "Create" },
      { label: "Update", value: "Update" },
      { label: "Delete", value: "Delete" },
      { label: "Download", value: "Download" },
      { label: "Sign In", value: "SignIn" },
      { label: "Sign Out", value: "SignOut" },
      { label: "Session Timeout", value: "SessionTimeout" },
      { label: "Session Revoked", value: "SessionRevoked" },
    ]);
    expect(filter?.filterDropdownOptions).toEqual(
      AUDIT_LOG_ACTION_FILTER_OPTIONS,
    );
  });

  test("the other filters are as they were", async () => {
    await renderTable();

    expect(
      capturedTableProps?.filters?.map((filter: CapturedFilter): string => {
        return filter.title;
      }),
    ).toEqual(["Resource Type", "Resource Name", "Action", "User Email", "Time"]);
  });
});

describe("the empty state", () => {
  test("says sign-ins appear here too", async () => {
    await renderTable();

    expect(
      screen.getByText(/every time its members\s+sign in or out/),
    ).toBeInTheDocument();
  });
});

describe("a session entry's details", () => {
  test("list what it recorded, in the audit log's order, by their words", () => {
    render(
      <AuditLogChangesModal
        isOpen={true}
        onClose={jest.fn()}
        action="SessionTimeout"
        resourceType={AUDIT_LOG_SESSION_RESOURCE_TYPE}
        resourceName="Chrome 130 on macOS"
        changes={TIMEOUT_CHANGES}
      />,
    );

    expect(
      screen.getByText("Session Timeout · Chrome 130 on macOS"),
    ).toBeInTheDocument();
    expect(screen.getByText("How the session ended")).toBeInTheDocument();

    const details: HTMLElement = screen.getByTestId(
      "audit-log-session-details",
    );
    const labels: Array<string> = Array.from(
      details.querySelectorAll("dt"),
    ).map((term: Element): string => {
      return term.textContent || "";
    });

    expect(labels).toEqual([
      "Reason",
      "Signed in with",
      "SSO provider",
      "Device",
      "IP address",
      "Signed in at",
      "Last active at",
      "Timed out at",
    ]);
    expect(within(details).getByText("Idle timeout reached")).toBeInTheDocument();
    expect(within(details).getByText("Acme Okta")).toBeInTheDocument();
    // A change's before and after has no place here.
    expect(screen.queryByText("Before")).toBeNull();
    expect(screen.queryByText("After")).toBeNull();
    expect(screen.queryByText(/fields? changed/)).toBeNull();
  });

  test("a time reads in the reader's own zone, never as ISO 8601", () => {
    const rows: Array<SessionDetailRow> = readSessionDetailRows(TIMEOUT_CHANGES);
    const endedAt: SessionDetailRow | undefined = rows.find(
      (row: SessionDetailRow): boolean => {
        return row.field === "endedAt";
      },
    );

    expect(endedAt?.value).toBe(
      OneUptimeDate.getDateAsLocalFormattedString("2026-11-11T09:45:00.000Z"),
    );
    expect(endedAt?.value).not.toContain("T09:45");
  });

  test("leave out what the entry does not hold, and anything that is not a session field", () => {
    expect(
      readSessionDetailRows([
        { field: "device", newValue: "curl" },
        { field: "name", newValue: "Not a session field" },
        { field: "ipAddress", newValue: 42 },
      ]).map((row: SessionDetailRow): string => {
        return `${row.label}: ${row.value}`;
      }),
    ).toEqual(["Device: curl"]);
  });

  test("say so when nothing was recorded", () => {
    render(
      <AuditLogChangesModal
        isOpen={true}
        onClose={jest.fn()}
        action="SignOut"
        resourceType={AUDIT_LOG_SESSION_RESOURCE_TYPE}
        resourceName={undefined}
        changes={[]}
      />,
    );

    expect(screen.getByText("Sign Out · User Session")).toBeInTheDocument();
    expect(
      screen.getByText("No details were recorded for this session."),
    ).toBeInTheDocument();
  });

  test("a sign-in says how and where; every end says how it ended", () => {
    expect(getSessionDetailsDescription("SignIn")).toBe(
      "How and where they signed in",
    );

    for (const action of ["SignOut", "SessionTimeout", "SessionRevoked"]) {
      expect(getSessionDetailsDescription(action)).toBe(
        "How the session ended",
      );
    }
  });

  test("a change's details still read as before and after, with the action's words", () => {
    render(
      <AuditLogChangesModal
        isOpen={true}
        onClose={jest.fn()}
        action="Update"
        resourceType="Monitor"
        resourceName="API"
        changes={[{ field: "name", oldValue: "a", newValue: "b" }]}
      />,
    );

    expect(screen.getByText("Update · Monitor — API")).toBeInTheDocument();
    expect(screen.getByText("Before")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-log-session-details")).toBeNull();
  });
});

describe("the session badges and resource", () => {
  const table: string = fs.readFileSync(
    path.join(__dirname, "../../../Dashboard/AuditLogs/AuditLogsTable.tsx"),
    "utf8",
  );
  const theme: string = fs.readFileSync(
    path.join(__dirname, "../../../../packages/Common/UI/Styles/Theme.css"),
    "utf8",
  );

  const badge: (action: string) => string = (action: string): string => {
    const start: number = table.indexOf(`${action}: {`);

    expect(start).toBeGreaterThan(-1);

    return table.substring(start, table.indexOf("},", start));
  };

  test.each([
    ["SignIn", "IconProp.SignIn"],
    ["SignOut", "IconProp.SignOut"],
    ["SessionTimeout", "IconProp.Clock"],
    ["SessionRevoked", "IconProp.NoSymbol"],
  ])("%s has a badge of its own: %s", (action: string, icon: string) => {
    expect(badge(action)).toContain(`icon: ${icon}`);
    expect(badge(action)).toContain(
      `label: AUDIT_LOG_ACTION_LABELS[AuditLogAction.${action}]`,
    );
  });

  /*
   * The dark theme re-colours light utility classes under html.dark, one
   * rule per class (Theme.css); a class with no rule keeps its pale light
   * colour on a slate card.
   */
  test("every colour a session badge draws with is remapped for the dark theme", () => {
    for (const action of [
      "SignIn",
      "SignOut",
      "SessionTimeout",
      "SessionRevoked",
    ]) {
      const tokens: Array<string> = (
        badge(action).match(/(?:border|bg|text)-[a-z]+-\d+/g) || []
      ).filter((token: string, index: number, all: Array<string>): boolean => {
        return all.indexOf(token) === index;
      });

      expect(tokens.length).toBeGreaterThanOrEqual(4);

      for (const token of tokens) {
        expect({ action, token, remapped: theme.includes(`.${token}`) }).toEqual(
          { action, token, remapped: true },
        );
      }
    }
  });

  test("a User Session is drawn as a device, with no page to open", () => {
    const meta: ResourceMeta | undefined =
      RESOURCE_META[AUDIT_LOG_SESSION_RESOURCE_TYPE];

    expect(meta?.icon).toBe(IconProp.ComputerDesktop);
    expect(meta?.viewRoute).toBeUndefined();

    for (const token of [
      ...(meta?.color || "").split(" "),
      ...(meta?.bgColor || "").split(" "),
    ]) {
      expect({ token, remapped: theme.includes(`.${token}`) }).toEqual({
        token,
        remapped: true,
      });
    }
  });
});
