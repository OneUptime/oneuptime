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
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "Common/Tests/MockType";

/*
 * ---------------------------------------------------------------------------
 * A failed sign-in (issue #6788) and a private status page's reader's
 * session (issue #6790) in the audit log's table and details.
 * ---------------------------------------------------------------------------
 *
 * A failed sign-in has a badge of its own, says why it failed - and how
 * many attempts it stands for - in a few words, and opens its details: why,
 * how it tried, the device, the address and the place. Nobody signed in, so
 * the way it tried is "Tried to sign in with". A reader's session reads as
 * a member's does, its actor the reader's address as a Status Page Private
 * User, and it opens its status page.
 *
 * AnalyticsModelTable is mocked to capture its props, as in
 * AuditLogSessionEntries.test.tsx; the cells are rendered from the
 * captured columns.
 */

jest.mock("Common/UI/Config", () => {
  return {
    ...(jest.requireActual("Common/UI/Config") as Record<string, unknown>),
    BILLING_ENABLED: false,
  };
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
import AuditLogChangesModal, {
  getSessionDetailsDescription,
  readSessionDetailRows,
  SessionDetailRow,
} from "../../../Dashboard/AuditLogs/AuditLogChangesModal";
import {
  getActorTypeLabel,
  getResourceLink,
  getResourceMeta,
  getResourceTypeLabel,
  ResourceLink,
} from "@oneuptime/dashboard/Components/AuditLogs/AuditLogsTableUtils";
import PageMap from "@oneuptime/dashboard/Utils/PageMap";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import Project from "Common/Models/DatabaseModels/Project";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import { AUDIT_LOG_SIGN_IN_ATTEMPT_RESOURCE_TYPE } from "Common/Types/AuditLog/AuditLogSignInFailure";
import {
  AUDIT_LOG_STATUS_PAGE_READER_ACTOR_TYPE,
  AUDIT_LOG_STATUS_PAGE_SESSION_RESOURCE_TYPE,
  AUDIT_LOG_STATUS_PAGE_SESSION_ROOT_RESOURCE_TYPE,
} from "Common/Types/AuditLog/AuditLogStatusPageSession";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "61616161-6161-4161-8161-616161616161",
);
const ATTEMPT_ID: ObjectID = new ObjectID(
  "62626262-6262-4262-8262-626262626262",
);
const USER_ID: ObjectID = new ObjectID("63636363-6363-4363-8363-636363636363");
const READER_SESSION_ID: ObjectID = new ObjectID(
  "64646464-6464-4464-8464-646464646464",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "65656565-6565-4565-8565-656565656565",
);

const FAILED_CHANGES: JSONArray = [
  { field: "reason", newValue: "Wrong password" },
  { field: "failedAttempts", newValue: "37" },
  { field: "signInMethod", newValue: "Password" },
  { field: "device", newValue: "Firefox 132 on Windows" },
  { field: "ipAddress", newValue: "198.51.100.23" },
  { field: "location", newValue: "Lisbon, Portugal" },
  { field: "firstFailedAt", newValue: "2026-11-16T08:12:44.000Z" },
];

const failedSignInEntry: (changes?: JSONArray) => AuditLog = (
  changes?: JSONArray,
): AuditLog => {
  const entry: AuditLog = new AuditLog();
  entry.projectId = PROJECT_ID;
  entry.action = AuditLogAction.SignInFailed;
  entry.resourceType = AUDIT_LOG_SIGN_IN_ATTEMPT_RESOURCE_TYPE;
  entry.resourceId = ATTEMPT_ID;
  entry.resourceName = "Firefox 132 on Windows";
  entry.rootResourceType = "User";
  entry.rootResourceId = USER_ID;
  entry.userId = USER_ID;
  entry.userName = "Grace Hopper";
  entry.userEmail = "grace@acme.test";
  entry.userType = "User";
  entry.changes = changes || FAILED_CHANGES;
  return entry;
};

const readerEntry: (action: AuditLogAction) => AuditLog = (
  action: AuditLogAction,
): AuditLog => {
  const entry: AuditLog = new AuditLog();
  entry.projectId = PROJECT_ID;
  entry.action = action;
  entry.resourceType = AUDIT_LOG_STATUS_PAGE_SESSION_RESOURCE_TYPE;
  entry.resourceId = READER_SESSION_ID;
  entry.resourceName = "Safari 18 on iOS";
  entry.rootResourceType = AUDIT_LOG_STATUS_PAGE_SESSION_ROOT_RESOURCE_TYPE;
  entry.rootResourceId = STATUS_PAGE_ID;
  entry.userEmail = "customer@example.com";
  entry.userType = AUDIT_LOG_STATUS_PAGE_READER_ACTOR_TYPE;
  entry.changes =
    action === AuditLogAction.SignIn
      ? [
          { field: "signInMethod", newValue: "Sign-in link" },
          { field: "device", newValue: "Safari 18 on iOS" },
        ]
      : [
          {
            field: "reason",
            newValue: "Sign-in no longer accepted by the status page",
          },
          { field: "device", newValue: "Safari 18 on iOS" },
        ];
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
      <AuditLogsTable title="Audit Logs" description="Every change." />
    </MemoryRouter>,
  );
  await flush();
};

const renderCell: (title: string, entry: AuditLog) => HTMLElement = (
  title: string,
  entry: AuditLog,
): HTMLElement => {
  const column: CapturedColumn | undefined = capturedTableProps?.columns?.find(
    (candidate: CapturedColumn): boolean => {
      return candidate.title === title;
    },
  );

  expect(column).toBeDefined();

  const { container } = render(
    <MemoryRouter>{column!.getElement!(entry)}</MemoryRouter>,
  );

  return container;
};

beforeEach(() => {
  capturedTableProps = null;
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

describe("a failed sign-in in the table", () => {
  test("its badge reads Sign-In Failed, never the word an entry carries", async () => {
    await renderTable();

    const cell: HTMLElement = renderCell("Action", failedSignInEntry());

    expect(cell).toHaveTextContent("Sign-In Failed");
    expect(cell).not.toHaveTextContent("SignInFailed");
    // A warning's colour, not a sign-in's.
    expect(cell.querySelector("span")?.className).toContain("orange");
  });

  test("its Changes cell says why it failed and how many attempts it stands for", async () => {
    await renderTable();

    const cell: HTMLElement = renderCell("Changes", failedSignInEntry());
    const summary: HTMLElement = within(cell).getByTestId(
      "audit-log-session-summary",
    );

    expect(summary).toHaveTextContent("Wrong password · 37 attempts");
    expect(summary.getAttribute("title")).toBe(
      "Wrong password · 37 attempts - view sign-in attempt details",
    );
    expect(cell).not.toHaveTextContent(/fields? captured/);
  });

  test("an attempt that stands for itself says only why", async () => {
    await renderTable();

    const cell: HTMLElement = renderCell(
      "Changes",
      failedSignInEntry([
        { field: "reason", newValue: "Too many wrong codes" },
        { field: "signInMethod", newValue: "Password" },
      ]),
    );

    expect(
      within(cell).getByTestId("audit-log-session-summary"),
    ).toHaveTextContent(/^Too many wrong codes$/);
  });

  test("its Resource cell is the device the attempt came from, a Sign-In Attempt, with no page to open", async () => {
    await renderTable();

    const cell: HTMLElement = renderCell("Resource", failedSignInEntry());

    expect(cell).toHaveTextContent("Firefox 132 on Windows");
    expect(cell).toHaveTextContent("Sign-In Attempt");
    expect(within(cell).queryByRole("link")).toBeNull();
  });

  test("its Actor is the account the attempt was made on", async () => {
    await renderTable();

    const cell: HTMLElement = renderCell("Actor", failedSignInEntry());

    expect(cell).toHaveTextContent("Grace Hopper");
    expect(cell).toHaveTextContent("grace@acme.test");
  });

  test("clicking it opens why and where it failed", async () => {
    await renderTable();

    const cell: HTMLElement = renderCell("Changes", failedSignInEntry());

    fireEvent.click(within(cell).getByTestId("audit-log-session-summary"));

    expect(
      await screen.findByText("Sign-In Failed · Firefox 132 on Windows"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Why and where the sign-in failed"),
    ).toBeInTheDocument();
  });
});

describe("a failed sign-in's details", () => {
  test("say why, how many, how it tried and from where, in the fields' order", () => {
    const rows: Array<SessionDetailRow> = readSessionDetailRows(
      FAILED_CHANGES,
      undefined,
      AuditLogAction.SignInFailed,
    );

    expect(
      rows.map((row: SessionDetailRow): string => {
        return row.label;
      }),
    ).toEqual([
      "Reason",
      "Failed attempts",
      "Tried to sign in with",
      "Device",
      "IP address",
      "Location",
      "First attempt at",
    ]);
    expect(rows[0]!.value).toBe("Wrong password");
    expect(rows[1]!.value).toBe("37");
    // A time, drawn in the reader's zone - never the stored ISO text.
    expect(rows[6]!.value).not.toBe("2026-11-16T08:12:44.000Z");
    expect(rows[6]!.value.length).toBeGreaterThan(0);
  });

  test("a session's sign-in keeps its own words for the way it signed in", () => {
    const rows: Array<SessionDetailRow> = readSessionDetailRows(
      [{ field: "signInMethod", newValue: "Password" }],
      undefined,
      AuditLogAction.SignIn,
    );

    expect(rows[0]!.label).toBe("Signed in with");
  });

  test("the dialog draws them as details, not as before and after", () => {
    render(
      <AuditLogChangesModal
        isOpen={true}
        onClose={jest.fn()}
        action={AuditLogAction.SignInFailed}
        resourceType="Sign-In Attempt"
        resourceName="Firefox 132 on Windows"
        changes={FAILED_CHANGES}
      />,
    );

    const details: HTMLElement = screen.getByTestId(
      "audit-log-session-details",
    );

    expect(details).toHaveTextContent("Tried to sign in with");
    expect(details).toHaveTextContent("Password");
    expect(details).toHaveTextContent("198.51.100.23");
    expect(screen.queryByText("Before")).toBeNull();
    expect(getSessionDetailsDescription(AuditLogAction.SignInFailed)).toBe(
      "Why and where the sign-in failed",
    );
  });
});

describe("a status page reader's session in the table", () => {
  test("reads as a session, its Action as a member's", async () => {
    await renderTable();

    expect(
      renderCell("Action", readerEntry(AuditLogAction.SignIn)),
    ).toHaveTextContent("Sign In");
    expect(
      within(
        renderCell("Changes", readerEntry(AuditLogAction.SessionRevoked)),
      ).getByTestId("audit-log-session-summary"),
    ).toHaveTextContent("Sign-in no longer accepted by the status page");
  });

  test("its Actor is the reader's address, as a Status Page Private User", async () => {
    await renderTable();

    const cell: HTMLElement = renderCell(
      "Actor",
      readerEntry(AuditLogAction.SignIn),
    );

    expect(cell).toHaveTextContent("customer@example.com");
    expect(cell).toHaveTextContent("Status Page Private User");
    expect(getActorTypeLabel(AUDIT_LOG_STATUS_PAGE_READER_ACTOR_TYPE)).toBe(
      "Status Page Private User",
    );
  });

  test("its Resource is the reader's device, and it opens the status page", async () => {
    await renderTable();

    const cell: HTMLElement = renderCell(
      "Resource",
      readerEntry(AuditLogAction.SignIn),
    );

    expect(cell).toHaveTextContent("Safari 18 on iOS");
    expect(cell).toHaveTextContent("Status Page Private User Session");

    const link: ResourceLink | null = getResourceLink({
      meta: getResourceMeta(AUDIT_LOG_STATUS_PAGE_SESSION_RESOURCE_TYPE),
      action: AuditLogAction.SignIn,
      resourceId: READER_SESSION_ID,
      rootResourceId: STATUS_PAGE_ID,
      rootMeta: getResourceMeta(
        AUDIT_LOG_STATUS_PAGE_SESSION_ROOT_RESOURCE_TYPE,
      ),
    });

    expect(link).toEqual({
      page: PageMap.STATUS_PAGE_VIEW,
      modelId: STATUS_PAGE_ID,
    });
  });
});

describe("how the two resources are drawn", () => {
  test("an attempt as a warning, a reader's session as a device", () => {
    expect(getResourceMeta(AUDIT_LOG_SIGN_IN_ATTEMPT_RESOURCE_TYPE).icon).toBe(
      IconProp.ShieldExclamation,
    );
    expect(
      getResourceMeta(AUDIT_LOG_STATUS_PAGE_SESSION_RESOURCE_TYPE).icon,
    ).toBe(IconProp.ComputerDesktop);
    expect(getResourceTypeLabel(AUDIT_LOG_SIGN_IN_ATTEMPT_RESOURCE_TYPE)).toBe(
      "Sign-In Attempt",
    );
  });
});
