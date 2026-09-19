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
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "Common/Tests/MockType";

/*
 * ---------------------------------------------------------------------------
 * The shared audit log table: the "logging is off" notice and its filters
 * ---------------------------------------------------------------------------
 *
 * The table body is Enterprise code (ee/Dashboard/AuditLogs/AuditLogsTable).
 * Every resource page renders core's Components/AuditLogs/AuditLogsTable
 * shell, which decides between this body and the upsell card - that decision
 * is pinned by packages/Common/Tests/App/Dashboard/AuditLogsShells.test.tsx.
 * By the time this body renders, the project may have audit logs.
 *
 * Audit logging is off by default and switched on only in Settings, so for
 * most projects an empty audit page means "nothing is being recorded", not
 * "nothing changed" - and the table used to say the latter. It reads the
 * project's switch and, when it is off, shows a compact notice that links to
 * the setting.
 *
 * Also pinned: the query each page asks for - a resource page that shows its
 * children filters on rootResourceId alone - and where each entry links.
 *
 * AnalyticsModelTable is mocked to capture its props (the real one fetches on
 * mount); the card's right element and empty state it would render are
 * rendered by the mock so the notice can be found in the DOM.
 *
 * And the license: once the trial or grace period is over without a valid
 * Enterprise license (or with a license that leaves audit logs out) nothing
 * is recorded, whatever the switch says. The table stays reachable, so it
 * must not keep saying that changes "will appear here automatically": its
 * header and empty state say it is not recording, in the words Settings >
 * Audit Logs uses. The trial, the grace period, OneUptime Cloud and an
 * unknown license state change nothing - the server records then.
 *
 * Billing is pinned in every test: CI's config.env sets BILLING_ENABLED=true,
 * which would skip the license request altogether.
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
  query?: Record<string, unknown>;
  selectMoreFields?: Record<string, boolean>;
  cardProps?: {
    title?: string;
    description?: string;
    rightElement?: React.ReactElement | undefined;
  };
  noItemsMessage?: React.ReactElement;
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

      return react.createElement(
        "div",
        { "data-testid": "audit-logs-analytics-table" },
        props.cardProps?.rightElement || null,
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
  ComponentProps,
} from "../../../Dashboard/AuditLogs/AuditLogsTable";
import {
  AUDIT_LOGS_LAPSED_DESCRIPTION,
  AUDIT_LOGS_LAPSED_TITLE,
  AUDIT_LOGS_NOT_INCLUDED_DESCRIPTION,
  AUDIT_LOGS_NOT_INCLUDED_TITLE,
} from "../../../Dashboard/AuditLogs/AuditLogsLicenseNotice";
import { JSONObject } from "Common/Types/JSON";
import {
  RESOURCE_META,
  ResourceMeta,
} from "@oneuptime/dashboard/Components/AuditLogs/AuditLogsTableUtils";
import PageMap from "@oneuptime/dashboard/Utils/PageMap";
import RouteMap, { RouteUtil } from "@oneuptime/dashboard/Utils/RouteMap";
import RouteParams from "@oneuptime/dashboard/Utils/RouteParams";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import Project from "Common/Models/DatabaseModels/Project";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SLO_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const RULE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

type RenderTableFunction = (props?: Partial<ComponentProps>) => void;

const renderTable: RenderTableFunction = (
  props?: Partial<ComponentProps>,
): void => {
  render(
    <MemoryRouter>
      <AuditLogsTable
        title="SLO Audit Logs"
        description="Changes people made to this SLO."
        {...(props || {})}
      />
    </MemoryRouter>,
  );
};

type ProjectWithFunction = (enableAuditLogs: boolean | undefined) => Project;

const projectWith: ProjectWithFunction = (
  enableAuditLogs: boolean | undefined,
): Project => {
  const project: Project = new Project();
  project._id = PROJECT_ID.toString();
  if (enableAuditLogs !== undefined) {
    project.enableAuditLogs = enableAuditLogs;
  }
  return project;
};

type RouteHrefFunction = (
  page: PageMap,
  modelId?: ObjectID,
  subModelId?: ObjectID,
) => string;

const routeHref: RouteHrefFunction = (
  page: PageMap,
  modelId?: ObjectID,
  subModelId?: ObjectID,
): string => {
  return RouteUtil.populateRouteParams(
    RouteMap[page] as Route,
    modelId ? { modelId, subModelId } : undefined,
  ).toString();
};

/*
 * Lets the settings read and the license read resolve and their state updates
 * land. The license read is a few promises deep, so this waits for a whole
 * macrotask rather than a fixed number of microtasks.
 */
type FlushFunction = () => Promise<void>;

const flushSettingsRead: FlushFunction = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
};

const answerLicense: (payload: JSONObject) => void = (
  payload: JSONObject,
): void => {
  mockLicenseFetch.mockResolvedValue({
    isSuccess: (): boolean => {
      return true;
    },
    data: payload,
  });
};

// The ordinary empty state, which promises that changes are being recorded.
const RECORDING_PROMISE: RegExp = /will appear here automatically/;

const LICENSE_NOTICE_TEST_ID: string = "audit-logging-license-notice";
const LICENSE_EMPTY_STATE_TEST_ID: string = "audit-logging-license-empty-state";

beforeEach(() => {
  capturedTableProps = null;
  billingEnabledForTest = false;
  getItemMock.mockReset();
  mockLicenseFetch.mockReset();
  // A valid license unless a test says otherwise.
  answerLicense({ status: "valid", licenseValid: true });
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the audit logging switch", () => {
  test("the body renders the table and reads the project's switch at once - eligibility is the core shell's decision", async () => {
    getItemMock.mockResolvedValue(projectWith(true));

    renderTable({ rootResourceId: SLO_ID });
    await flushSettingsRead();

    expect(
      screen.getByTestId("audit-logs-analytics-table"),
    ).toBeInTheDocument();
    expect(capturedTableProps?.cardProps?.title).toBe("SLO Audit Logs");
    expect(capturedTableProps?.cardProps?.description).toBe(
      "Changes people made to this SLO.",
    );
    expect(getItemMock).toHaveBeenCalledTimes(1);
  });

  test("when logging is off, a compact notice links to the Audit Logs settings", async () => {
    getItemMock.mockResolvedValue(projectWith(false));

    renderTable({ rootResourceId: SLO_ID });

    const notice: HTMLElement = await screen.findByTestId(
      "audit-logging-disabled-notice",
    );
    const settingsHref: string = routeHref(
      PageMap.SETTINGS_AUDIT_LOGS_SETTINGS,
    );

    expect(settingsHref).toContain(PROJECT_ID.toString());
    expect(notice).toHaveTextContent("Audit logging is off");
    expect(within(notice).getByRole("link")).toHaveAttribute(
      "href",
      settingsHref,
    );

    // It sits in the card header, not above the page as a banner.
    expect(capturedTableProps?.cardProps?.rightElement).toBeDefined();

    const emptyState: HTMLElement = screen.getByTestId(
      "audit-logging-disabled-empty-state",
    );
    expect(emptyState).toHaveTextContent("Audit logging is turned off");
    expect(within(emptyState).getByRole("link")).toHaveAttribute(
      "href",
      settingsHref,
    );

    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(getItemMock.mock.calls[0]![0]).toEqual({
      modelType: Project,
      id: PROJECT_ID,
      select: { enableAuditLogs: true },
    });
  });

  test("when logging is on, there is no notice and the empty state is the ordinary one", async () => {
    getItemMock.mockResolvedValue(projectWith(true));

    renderTable({ rootResourceId: SLO_ID });
    await flushSettingsRead();

    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("audit-logging-disabled-notice")).toBeNull();
    expect(
      screen.queryByTestId("audit-logging-disabled-empty-state"),
    ).toBeNull();
    expect(screen.getByText("No audit entries yet")).toBeInTheDocument();
  });

  test.each([
    {
      name: "the read fails",
      respond: (): void => {
        getItemMock.mockRejectedValue(new Error("403"));
      },
    },
    {
      name: "the project is not returned",
      respond: (): void => {
        getItemMock.mockResolvedValue(null);
      },
    },
    {
      name: "the switch was not readable",
      respond: (): void => {
        getItemMock.mockResolvedValue(projectWith(undefined));
      },
    },
  ])(
    "no notice is guessed when $name",
    async (data: { respond: () => void }) => {
      data.respond();

      renderTable({ rootResourceId: SLO_ID });
      await flushSettingsRead();

      expect(getItemMock).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("audit-logging-disabled-notice")).toBeNull();
      expect(screen.getByText("No audit entries yet")).toBeInTheDocument();
    },
  );

  test("outside a project there is nothing to read", async () => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);

    renderTable();
    await flushSettingsRead();

    expect(getItemMock).not.toHaveBeenCalled();
  });
});

describe("the Enterprise license", () => {
  test.each([
    [
      "expired, after the grace period",
      { status: "expired", licenseValid: false },
    ],
    ["missing, after the trial", { status: "missing", licenseValid: false }],
    ["invalid", { status: "invalid", licenseValid: false }],
  ])(
    "%s: the table says it is not recording, and never that changes will appear",
    async (_name: string, payload: JSONObject) => {
      answerLicense(payload);
      getItemMock.mockResolvedValue(projectWith(true));

      renderTable({ rootResourceId: SLO_ID });

      const notice: HTMLElement = await screen.findByTestId(
        LICENSE_NOTICE_TEST_ID,
      );

      expect(notice).toHaveTextContent(
        "Audit logging is not recording: Enterprise license required",
      );
      expect(notice).toHaveAttribute(
        "title",
        `${AUDIT_LOGS_LAPSED_TITLE} ${AUDIT_LOGS_LAPSED_DESCRIPTION}`,
      );
      // In the card header, where the "logging is off" pill goes.
      expect(capturedTableProps?.cardProps?.rightElement).toBeDefined();

      const emptyState: HTMLElement = screen.getByTestId(
        LICENSE_EMPTY_STATE_TEST_ID,
      );

      expect(emptyState).toHaveTextContent(AUDIT_LOGS_LAPSED_TITLE);
      expect(emptyState).toHaveTextContent(AUDIT_LOGS_LAPSED_DESCRIPTION);
      expect(screen.queryByText(RECORDING_PROMISE)).not.toBeInTheDocument();
      expect(
        screen.queryByText("No audit entries yet"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("audit-logging-disabled-notice"),
      ).not.toBeInTheDocument();
    },
  );

  test("a valid license that leaves audit logs out: not recording, and says why", async () => {
    answerLicense({
      status: "valid",
      licenseValid: true,
      features: ["sso", "scim"],
    });
    getItemMock.mockResolvedValue(projectWith(true));

    renderTable();

    const notice: HTMLElement = await screen.findByTestId(
      LICENSE_NOTICE_TEST_ID,
    );

    expect(notice).toHaveTextContent(
      "Audit logging is not recording: not included in your Enterprise license",
    );

    const emptyState: HTMLElement = screen.getByTestId(
      LICENSE_EMPTY_STATE_TEST_ID,
    );

    expect(emptyState).toHaveTextContent(AUDIT_LOGS_NOT_INCLUDED_TITLE);
    expect(emptyState).toHaveTextContent(AUDIT_LOGS_NOT_INCLUDED_DESCRIPTION);
    expect(screen.queryByText(RECORDING_PROMISE)).not.toBeInTheDocument();
  });

  /*
   * The license stops recording whatever the switch says, so it wins: turning
   * the switch on would not start recording.
   */
  test("lapsed and switched off: the license notice replaces the 'logging is off' one", async () => {
    answerLicense({ status: "expired", licenseValid: false });
    getItemMock.mockResolvedValue(projectWith(false));

    renderTable({ rootResourceId: SLO_ID });

    expect(
      await screen.findByTestId(LICENSE_NOTICE_TEST_ID),
    ).toBeInTheDocument();
    await flushSettingsRead();

    expect(
      screen.queryByTestId("audit-logging-disabled-notice"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("audit-logging-disabled-empty-state"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId(LICENSE_EMPTY_STATE_TEST_ID)).toBeInTheDocument();
  });

  test("the table asks for the license once, as a screen about audit logs", async () => {
    getItemMock.mockResolvedValue(projectWith(true));

    renderTable();
    await waitFor(() => {
      expect(mockLicenseFetch).toHaveBeenCalledTimes(1);
    });
    await flushSettingsRead();

    const options: { url: { toString: () => string } } = mockLicenseFetch.mock
      .calls[0]![0] as { url: { toString: () => string } };

    expect(options.url.toString()).toContain("/global-config/license");
  });

  test.each([
    ["the trial or grace period", { status: "grace", licenseValid: true }],
    ["a valid license", { status: "valid", licenseValid: true }],
    [
      "a valid license that includes audit logs",
      { status: "valid", licenseValid: true, features: ["audit-logs"] },
    ],
  ])(
    "%s: recording as configured, so nothing about the license",
    async (_name: string, payload: JSONObject) => {
      answerLicense(payload);
      getItemMock.mockResolvedValue(projectWith(true));

      renderTable();
      await waitFor(() => {
        expect(mockLicenseFetch).toHaveBeenCalled();
      });
      await flushSettingsRead();

      expect(
        screen.queryByTestId(LICENSE_NOTICE_TEST_ID),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(LICENSE_EMPTY_STATE_TEST_ID),
      ).not.toBeInTheDocument();
      expect(screen.getByText(RECORDING_PROMISE)).toBeInTheDocument();
    },
  );

  // The server keeps recording while it cannot read the license.
  test("the license cannot be read: nothing about the license", async () => {
    mockLicenseFetch.mockRejectedValue(new Error("network down"));
    getItemMock.mockResolvedValue(projectWith(true));

    renderTable();
    await waitFor(() => {
      expect(mockLicenseFetch).toHaveBeenCalled();
    });
    await flushSettingsRead();

    expect(
      screen.queryByTestId(LICENSE_NOTICE_TEST_ID),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No audit entries yet")).toBeInTheDocument();
  });

  test("OneUptime Cloud (billing on): the plan decides, no license request", async () => {
    billingEnabledForTest = true;
    answerLicense({ status: "expired", licenseValid: false });
    getItemMock.mockResolvedValue(projectWith(true));

    renderTable();
    await flushSettingsRead();

    expect(mockLicenseFetch).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId(LICENSE_NOTICE_TEST_ID),
    ).not.toBeInTheDocument();
    expect(screen.getByText(RECORDING_PROMISE)).toBeInTheDocument();
  });
});

describe("the rows a table asks for", () => {
  beforeEach(() => {
    getItemMock.mockResolvedValue(projectWith(true));
  });

  test("a resource page with children filters on the root pointer alone", async () => {
    renderTable({ rootResourceId: SLO_ID });
    await flushSettingsRead();

    expect(capturedTableProps?.query).toEqual({
      projectId: PROJECT_ID,
      rootResourceId: SLO_ID,
    });
    expect(capturedTableProps?.selectMoreFields?.["rootResourceId"]).toBe(true);
  });

  test("a resource page without children still filters on its own type and id", async () => {
    renderTable({ resourceType: "Monitor", resourceId: RULE_ID });
    await flushSettingsRead();

    expect(capturedTableProps?.query).toEqual({
      projectId: PROJECT_ID,
      resourceType: "Monitor",
      resourceId: RULE_ID,
    });
  });

  test("the project-wide log filters on the project only", async () => {
    renderTable();
    await flushSettingsRead();

    expect(capturedTableProps?.query).toEqual({ projectId: PROJECT_ID });
  });
});

describe("where an entry links to", () => {
  type RenderResourceCellFunction = (item: AuditLog) => void;

  const renderResourceCell: RenderResourceCellFunction = (
    item: AuditLog,
  ): void => {
    const column: CapturedColumn | undefined =
      capturedTableProps?.columns?.find((candidate: CapturedColumn) => {
        return candidate.title === "Resource";
      });

    expect(column?.getElement).toBeDefined();

    render(
      <MemoryRouter>
        <div data-testid="resource-cell">{column!.getElement!(item)}</div>
      </MemoryRouter>,
    );
  };

  type MakeEntryFunction = (data: {
    resourceType: string;
    resourceId: ObjectID;
    rootResourceId?: ObjectID | undefined;
    action: string;
    resourceName: string;
  }) => AuditLog;

  const makeEntry: MakeEntryFunction = (data: {
    resourceType: string;
    resourceId: ObjectID;
    rootResourceId?: ObjectID | undefined;
    action: string;
    resourceName: string;
  }): AuditLog => {
    const entry: AuditLog = new AuditLog();
    entry.resourceType = data.resourceType;
    entry.resourceId = data.resourceId;
    entry.rootResourceId = data.rootResourceId;
    entry.action = data.action;
    entry.resourceName = data.resourceName;
    return entry;
  };

  beforeEach(async () => {
    getItemMock.mockResolvedValue(projectWith(true));
    renderTable({ rootResourceId: SLO_ID });
    await flushSettingsRead();
    cleanup();
  });

  test("an SLO's own entry opens the SLO", () => {
    renderResourceCell(
      makeEntry({
        resourceType: "Service Level Objective",
        resourceId: SLO_ID,
        rootResourceId: SLO_ID,
        action: "Update",
        resourceName: "Checkout availability",
      }),
    );

    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      routeHref(PageMap.SLO_VIEW, SLO_ID),
    );
  });

  test("a deleted SLO's entry opens nothing", () => {
    renderResourceCell(
      makeEntry({
        resourceType: "Service Level Objective",
        resourceId: SLO_ID,
        rootResourceId: SLO_ID,
        action: "Delete",
        resourceName: "Checkout availability",
      }),
    );

    expect(screen.getByTestId("resource-cell")).toHaveTextContent(
      "Checkout availability",
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("a burn-rate rule's entry opens its SLO's Burn Rate Rules tab, even once the rule is deleted", () => {
    renderResourceCell(
      makeEntry({
        resourceType: "SLO Burn Rate Rule",
        resourceId: RULE_ID,
        rootResourceId: SLO_ID,
        action: "Delete",
        resourceName: "Fast burn",
      }),
    );

    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      routeHref(PageMap.SLO_VIEW_BURN_RATE_RULES, SLO_ID),
    );
    expect(screen.getByTestId("resource-cell")).toHaveTextContent(
      "SLO Burn Rate Rule",
    );
  });

  test("an owner entry opens its SLO's Owners tab", () => {
    renderResourceCell(
      makeEntry({
        resourceType: "Service Level Objective Team Owner",
        resourceId: RULE_ID,
        rootResourceId: SLO_ID,
        action: "Create",
        resourceName: "Site Reliability",
      }),
    );

    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      routeHref(PageMap.SLO_VIEW_OWNERS, SLO_ID),
    );
  });

  test.each(["Create", "Update"])(
    "a monitor rule's %s entry opens the rule's own page under its SLO",
    (action: string) => {
      renderResourceCell(
        makeEntry({
          resourceType: "SLO Monitor Rule",
          resourceId: RULE_ID,
          rootResourceId: SLO_ID,
          action,
          resourceName: "Production APIs",
        }),
      );

      const ruleHref: string = routeHref(
        PageMap.SLO_VIEW_MONITOR_RULE_VIEW,
        SLO_ID,
        RULE_ID,
      );

      // Both ids really land in the path: the SLO's, then the rule's.
      expect(ruleHref).toContain(
        `/slos/${SLO_ID.toString()}/monitor-rules/${RULE_ID.toString()}`,
      );
      expect(screen.getByRole("link")).toHaveAttribute("href", ruleHref);
    },
  );

  test("a deleted monitor rule's entry opens its SLO's Monitor Rules tab, not the rule's page that is gone", () => {
    renderResourceCell(
      makeEntry({
        resourceType: "SLO Monitor Rule",
        resourceId: RULE_ID,
        rootResourceId: SLO_ID,
        action: "Delete",
        resourceName: "Production APIs",
      }),
    );

    const link: HTMLElement = screen.getByRole("link");

    expect(link).toHaveAttribute(
      "href",
      routeHref(PageMap.SLO_VIEW_MONITOR_RULES, SLO_ID),
    );
    expect(link.getAttribute("href")).not.toContain(RULE_ID.toString());
  });

  test.each(["SLO Monitor Rule", "SLO Burn Rate Rule"])(
    "an %s entry rooted at itself (the root backfill's fallback) opens nothing, rather than a page keyed by the rule's own id",
    (resourceType: string) => {
      renderResourceCell(
        makeEntry({
          resourceType,
          resourceId: RULE_ID,
          rootResourceId: new ObjectID(RULE_ID.toString()),
          action: "Update",
          resourceName: "Production APIs",
        }),
      );

      expect(screen.getByTestId("resource-cell")).toHaveTextContent(
        "Production APIs",
      );
      expect(screen.queryByRole("link")).toBeNull();
    },
  );

  test("a burn-rate rule has no page of its own, so even a live rule's entry opens its SLO's tab", () => {
    renderResourceCell(
      makeEntry({
        resourceType: "SLO Burn Rate Rule",
        resourceId: RULE_ID,
        rootResourceId: SLO_ID,
        action: "Update",
        resourceName: "Fast burn",
      }),
    );

    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      routeHref(PageMap.SLO_VIEW_BURN_RATE_RULES, SLO_ID),
    );
  });

  test("every page of a child's own that an entry can open is a real route keyed by the root and the child", () => {
    const childPages: Array<PageMap> = [];

    for (const meta of Object.values(RESOURCE_META)) {
      const typedMeta: ResourceMeta = meta;

      if (typedMeta.childViewRoute) {
        childPages.push(typedMeta.childViewRoute);
      }
    }

    expect(childPages).toContain(PageMap.SLO_VIEW_MONITOR_RULE_VIEW);

    for (const page of childPages) {
      const route: Route | undefined = RouteMap[page];

      expect(route).toBeDefined();
      expect(route!.toString()).toContain(`/${RouteParams.ModelID}/`);
      expect(route!.toString()).toContain(`/${RouteParams.SubModelID}`);
    }
  });

  test("a child entry with no root pointer (written before the backfill) opens nothing", () => {
    renderResourceCell(
      makeEntry({
        resourceType: "SLO Monitor Rule",
        resourceId: RULE_ID,
        action: "Update",
        resourceName: "Production APIs",
      }),
    );

    expect(screen.queryByRole("link")).toBeNull();
  });

  test("an unknown resource type opens nothing", () => {
    renderResourceCell(
      makeEntry({
        resourceType: "Something New",
        resourceId: RULE_ID,
        rootResourceId: RULE_ID,
        action: "Update",
        resourceName: "Mystery",
      }),
    );

    expect(screen.queryByRole("link")).toBeNull();
  });
});
