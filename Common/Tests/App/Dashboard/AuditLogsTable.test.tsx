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
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ---------------------------------------------------------------------------
 * The shared audit log table: the "logging is off" notice and its filters
 * ---------------------------------------------------------------------------
 *
 * Audit logging is off by default and switched on only in Settings, so for
 * most projects an empty audit page means "nothing is being recorded", not
 * "nothing changed" - and the table used to say the latter. It now reads the
 * project's switch (after the Enterprise check, so a project that cannot have
 * audit logs still gets the upsell card) and, when it is off, shows a compact
 * notice that links to the setting.
 *
 * Also pinned: the query each page asks for - a resource page that shows its
 * children filters on rootResourceId alone - and where each entry links.
 *
 * AnalyticsModelTable is mocked to capture its props (the real one fetches on
 * mount); the card's right element and empty state it would render are
 * rendered by the mock so the notice can be found in the DOM.
 */

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
let isEligibleForTest: boolean = true;
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelTable/AnalyticsModelTable", () => {
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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AuditLogs/AuditLogsEnterpriseUpgrade",
  () => {
    return {
      __esModule: true,
      isAuditLogsEnterpriseEligible: (): boolean => {
        return isEligibleForTest;
      },
      default: (props: { title: string }): React.ReactElement => {
        const react: typeof React = jest.requireActual("react") as typeof React;

        return react.createElement(
          "div",
          { "data-testid": "audit-logs-upsell" },
          props.title,
        );
      },
    };
  },
);

import AuditLogsTable, {
  ComponentProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AuditLogs/AuditLogsTable";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import AuditLog from "../../../Models/AnalyticsModels/AuditLog";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

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

type RouteHrefFunction = (page: PageMap, modelId?: ObjectID) => string;

const routeHref: RouteHrefFunction = (
  page: PageMap,
  modelId?: ObjectID,
): string => {
  return RouteUtil.populateRouteParams(
    RouteMap[page] as Route,
    modelId ? { modelId } : undefined,
  ).toString();
};

// Lets the settings read resolve and its state update land.
type FlushFunction = () => Promise<void>;

const flushSettingsRead: FlushFunction = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  capturedTableProps = null;
  isEligibleForTest = true;
  getItemMock.mockReset();
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the audit logging switch", () => {
  test("a project that cannot have audit logs gets the upsell card, and no settings read", async () => {
    isEligibleForTest = false;
    getItemMock.mockResolvedValue(projectWith(false));

    renderTable({ rootResourceId: SLO_ID });
    await flushSettingsRead();

    expect(screen.getByTestId("audit-logs-upsell")).toHaveTextContent(
      "SLO Audit Logs",
    );
    expect(screen.queryByTestId("audit-logs-analytics-table")).toBeNull();
    expect(screen.queryByTestId("audit-logging-disabled-notice")).toBeNull();
    expect(getItemMock).not.toHaveBeenCalled();
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
