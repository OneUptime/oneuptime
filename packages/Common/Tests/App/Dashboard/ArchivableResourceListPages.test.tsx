import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * Archive and unarchive, single and bulk, for workflows, monitors, status
 * pages, dashboards and on-call policies.
 *
 * Each resource's list now lists live resources only and offers Archive as
 * a bulk action; each has an Archived page listing archived ones only, with
 * Unarchive as its bulk action, the words for that resource, when and by whom
 * each was archived, and a View that opens the resource's own pages. All of
 * it is wiring - a query, a prop, a hook call - and every way of getting it
 * wrong still renders a table. So the real pages are rendered with ModelTable
 * captured, and the props they hand it are asserted directly.
 */

interface CapturedColumn {
  field?: Record<string, unknown>;
  title: string;
  getElement?: (item: unknown) => ReactElement;
}

interface CapturedFilter {
  field?: Record<string, unknown>;
  title: string;
}

interface CapturedTableProps {
  modelType: unknown;
  id: string;
  userPreferencesKey: string;
  name: string;
  query: Record<string, unknown>;
  isCreateable: boolean;
  isDeleteable: boolean;
  isEditable: boolean;
  isViewable: boolean;
  bulkActions?: { buttons: Array<unknown> };
  cardProps: { title: string; description: string };
  noItemsMessage?: string;
  sortBy?: string;
  sortOrder?: string;
  columns: Array<CapturedColumn>;
  filters?: Array<CapturedFilter>;
  enableJsonImportExport?: boolean;
  cardButtons?: Array<{ title?: string }>;
  onViewPage?: (item: unknown) => Promise<{ toString: () => string }>;
}

let tableProps: CapturedTableProps | null = null;
const archiveActionsMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: [] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      tableProps = props;
      return <div data-testid="model-table" />;
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: async (): Promise<number> => {
        return 0;
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      getItem: async (): Promise<null> => {
        return null;
      },
    },
  };
});

/*
 * The facet bar is replaced (the real one fetches owners and labels on
 * mount); its merge marks the query, so a page that skipped it shows here.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
    ) as Record<string, unknown>;

    return {
      ...actual,
      __esModule: true,
      default: () => {
        return {
          getOwnersForResource: () => {
            return [];
          },
          isLoadingOwners: false,
          onResourcesFetched: () => {
            // no-op
          },
          filterBar: <div data-testid="filter-bar" />,
          mergeFiltersIntoQuery: (
            base: Record<string, unknown> | undefined,
          ) => {
            return { ...(base || {}), merged: true };
          },
          facetSaveState: undefined,
          restoreFacetState: () => {
            // no-op
          },
        };
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/OwnersCell",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <span data-testid="owners-cell" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/CustomFields/useCustomFieldFacets",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { facets: [], isLoading: false };
      },
    };
  },
);

jest.mock("../../../UI/Components/BulkUpdate/BulkLabelActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: ["label-action"], modals: <></> };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkOwnerActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: ["owner-action"], modals: <></> };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkArchiveActions", () => {
  return {
    __esModule: true,
    default: (options: unknown) => {
      archiveActionsMock(options);
      return {
        archiveBulkActions: ["archive-action"],
        unarchiveBulkActions: ["unarchive-action"],
      };
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: async () => {
        return [];
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/User/User",
  () => {
    return {
      __esModule: true,
      default: (props: { user: { name?: unknown } }) => {
        return <span data-testid="user">{String(props.user.name)}</span>;
      },
    };
  },
);

import {
  DASHBOARD_ARCHIVE_COPY,
  MONITOR_ARCHIVE_COPY,
  ON_CALL_POLICY_ARCHIVE_COPY,
  ResourceArchiveCopy,
  STATUS_PAGE_ARCHIVE_COPY,
  WORKFLOW_ARCHIVE_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Archive/ResourceArchiveCopy";
import MonitorTable from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorTable";
import DashboardsArchived, {
  DASHBOARDS_ARCHIVED_TABLE_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/Archived";
import DashboardsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/Dashboards";
import ArchivedMonitors from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/ArchivedMonitors";
import OnCallDutyPoliciesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicies";
import OnCallDutyPoliciesArchived, {
  ON_CALL_POLICIES_ARCHIVED_TABLE_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPoliciesArchived";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import StatusPagesArchived, {
  STATUS_PAGES_ARCHIVED_TABLE_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/Archived";
import StatusPagesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/StatusPages";
import WorkflowsArchived, {
  WORKFLOWS_ARCHIVED_TABLE_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/Archived";
import WorkflowsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/Workflows";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import User from "../../../Models/DatabaseModels/User";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Color from "../../../Types/Color";
import Name from "../../../Types/Name";
import { ModalTableBulkDefaultActions } from "../../../UI/Components/ModelTable/BaseModelTable";

const RESOURCE_ID: string = "4f1c2a9e-7b3d-4c8e-9a2f-6d5e4c3b2a10";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/home`),
  currentProject: null,
  hasPaymentMethod: true,
} as unknown as PageComponentProps;

interface ArchivableList {
  name: string;
  modelType: unknown;
  copy: ResourceArchiveCopy;
  liveTableId: string;
  archivedTableId: string;
  renderLive: () => ReactElement;
  renderArchived: () => ReactElement;
  // Where View on the Archived page must go: the resource's own pages.
  viewPath: string;
}

const LISTS: Array<ArchivableList> = [
  {
    name: "Workflows",
    modelType: Workflow,
    copy: WORKFLOW_ARCHIVE_COPY,
    liveTableId: "workflows-table",
    archivedTableId: WORKFLOWS_ARCHIVED_TABLE_ID,
    renderLive: () => {
      return <WorkflowsPage {...PAGE_PROPS} />;
    },
    renderArchived: () => {
      return <WorkflowsArchived {...PAGE_PROPS} />;
    },
    viewPath: `/dashboard/${PROJECT_ID}/workflows/${RESOURCE_ID}`,
  },
  {
    name: "Status Pages",
    modelType: StatusPage,
    copy: STATUS_PAGE_ARCHIVE_COPY,
    liveTableId: "status-page-table",
    archivedTableId: STATUS_PAGES_ARCHIVED_TABLE_ID,
    renderLive: () => {
      return <StatusPagesPage {...PAGE_PROPS} />;
    },
    renderArchived: () => {
      return <StatusPagesArchived {...PAGE_PROPS} />;
    },
    viewPath: `/dashboard/${PROJECT_ID}/status-pages/${RESOURCE_ID}`,
  },
  {
    name: "Dashboards",
    modelType: Dashboard,
    copy: DASHBOARD_ARCHIVE_COPY,
    liveTableId: "dashboard-table",
    archivedTableId: DASHBOARDS_ARCHIVED_TABLE_ID,
    renderLive: () => {
      return <DashboardsPage {...PAGE_PROPS} />;
    },
    renderArchived: () => {
      return <DashboardsArchived {...PAGE_PROPS} />;
    },
    viewPath: `/dashboard/${PROJECT_ID}/dashboards/${RESOURCE_ID}`,
  },
  {
    name: "On-Call Policies",
    modelType: OnCallDutyPolicy,
    copy: ON_CALL_POLICY_ARCHIVE_COPY,
    liveTableId: "on-call-duty-table",
    archivedTableId: ON_CALL_POLICIES_ARCHIVED_TABLE_ID,
    renderLive: () => {
      return <OnCallDutyPoliciesPage {...PAGE_PROPS} />;
    },
    renderArchived: () => {
      return <OnCallDutyPoliciesArchived {...PAGE_PROPS} />;
    },
    viewPath: `/dashboard/${PROJECT_ID}/on-call-duty/policies/${RESOURCE_ID}`,
  },
];

async function renderPage(element: ReactElement): Promise<CapturedTableProps> {
  await act(async () => {
    render(<MemoryRouter>{element}</MemoryRouter>);
  });

  if (!tableProps) {
    throw new Error("The page rendered no table.");
  }

  return tableProps;
}

function lastArchiveHookOptions(): Record<string, unknown> {
  const calls: Array<Array<unknown>> = archiveActionsMock.mock.calls;
  return calls[calls.length - 1]![0] as Record<string, unknown>;
}

function titles(items: Array<{ title: string }> | undefined): Array<string> {
  return (items || []).map((item: { title: string }): string => {
    return item.title;
  });
}

function archivingUser(): User {
  const user: User = new User();
  user.name = new Name("Priya Raman");
  return user;
}

beforeEach(() => {
  tableProps = null;
  archiveActionsMock.mockReset();
  goTo(`/dashboard/${PROJECT_ID}/home`);
});

afterEach(() => {
  cleanup();
});

describe.each(LISTS)("$name list", (list: ArchivableList) => {
  test("lists only resources that are not archived, through the facet bar", async () => {
    const props: CapturedTableProps = await renderPage(list.renderLive());

    expect(props.id).toBe(list.liveTableId);
    expect(props.query).toEqual({ isArchived: false, merged: true });
  });

  test("offers Archive as a bulk action, after labels and owners, and no Unarchive", async () => {
    const props: CapturedTableProps = await renderPage(list.renderLive());

    expect(props.bulkActions?.buttons).toEqual([
      "label-action",
      "owner-action",
      "archive-action",
    ]);
  });

  test("archives in this resource's words", async () => {
    await renderPage(list.renderLive());

    expect(lastArchiveHookOptions()).toEqual({
      modelType: list.modelType,
      singularName: list.copy.singularName,
      pluralName: list.copy.pluralName,
      archiveConfirmMessage: list.copy.bulkArchiveConfirmMessage,
      unarchiveConfirmMessage: list.copy.bulkUnarchiveConfirmMessage,
    });
  });
});

describe.each(LISTS)("Archived $name page", (list: ArchivableList) => {
  test("lists only archived resources, in a table of its own", async () => {
    const props: CapturedTableProps = await renderPage(list.renderArchived());

    expect(props.modelType).toBe(list.modelType);
    expect(props.query).toEqual({ isArchived: true });
    // Never shares saved columns or URL filters with the live list.
    expect(props.id).toBe(list.archivedTableId);
    expect(props.userPreferencesKey).toBe(list.archivedTableId);
    expect(props.id).not.toBe(list.liveTableId);
  });

  test("offers Unarchive and nothing else in bulk, in this resource's words", async () => {
    const props: CapturedTableProps = await renderPage(list.renderArchived());

    expect(props.bulkActions?.buttons).toEqual(["unarchive-action"]);
    expect(lastArchiveHookOptions()).toEqual({
      modelType: list.modelType,
      singularName: list.copy.singularName,
      pluralName: list.copy.pluralName,
      archiveConfirmMessage: list.copy.bulkArchiveConfirmMessage,
      unarchiveConfirmMessage: list.copy.bulkUnarchiveConfirmMessage,
    });
  });

  test("is titled, described and empty in this resource's words", async () => {
    const props: CapturedTableProps = await renderPage(list.renderArchived());

    expect(props.name).toBe(list.copy.archivedPageTitle);
    expect(props.cardProps).toEqual({
      title: list.copy.archivedPageTitle,
      description: list.copy.archivedPageDescription,
    });
    expect(props.noItemsMessage).toBe(list.copy.noArchivedItemsMessage);
  });

  test("creates and edits nothing, and shows the most recently archived first", async () => {
    const props: CapturedTableProps = await renderPage(list.renderArchived());

    expect(props.isCreateable).toBe(false);
    expect(props.isEditable).toBe(false);
    expect(props.isViewable).toBe(true);
    expect(props.sortBy).toBe("archivedAt");
    expect(props.sortOrder).toBe(SortOrder.Descending);
  });

  test("ends with when and by whom each was archived, and can be filtered by when", async () => {
    const props: CapturedTableProps = await renderPage(list.renderArchived());

    expect(titles(props.columns).slice(-2)).toEqual([
      "Archived At",
      "Archived By",
    ]);
    expect(titles(props.filters)).toContain("Archived At");
  });

  test("names the user who archived it, and a dash when nobody is recorded", async () => {
    const props: CapturedTableProps = await renderPage(list.renderArchived());
    const archivedBy: CapturedColumn = props.columns[props.columns.length - 1]!;

    render(<>{archivedBy.getElement!({ archivedByUser: archivingUser() })}</>);
    expect(screen.getByTestId("user")).toHaveTextContent("Priya Raman");
    cleanup();

    render(<>{archivedBy.getElement!({})}</>);
    expect(screen.queryByTestId("user")).toBeNull();
    expect(document.body).toHaveTextContent("—");
  });

  test("View opens the resource's own pages, not a route under /archived", async () => {
    const props: CapturedTableProps = await renderPage(list.renderArchived());

    const route: { toString: () => string } = await props.onViewPage!({
      _id: RESOURCE_ID,
    });

    expect(route.toString()).toBe(list.viewPath);
    expect(route.toString()).not.toContain("archived");
  });
});

describe("the monitor tables", () => {
  function monitor(values: Partial<Monitor>): Monitor {
    const item: Monitor = new Monitor();
    item._id = RESOURCE_ID;
    const status: MonitorStatus = new MonitorStatus();
    status.name = "Offline";
    status.color = new Color("#ef4444");
    item.currentMonitorStatus = status;
    Object.assign(item, values);
    return item;
  }

  function statusCell(props: CapturedTableProps, item: Monitor): HTMLElement {
    const column: CapturedColumn | undefined = props.columns.find(
      (candidate: CapturedColumn): boolean => {
        return candidate.title === "Monitor Status";
      },
    );

    return render(<MemoryRouter>{column!.getElement!(item)}</MemoryRouter>)
      .container;
  }

  test("every monitor list lists live monitors only, keeping its own scope", async () => {
    const props: CapturedTableProps = await renderPage(
      <MonitorTable query={{ monitorTemplateId: RESOURCE_ID } as never} />,
    );

    expect(props.query).toEqual({
      monitorTemplateId: RESOURCE_ID,
      isArchived: false,
      merged: true,
    });
  });

  test("a monitor list offers Archive among its bulk actions, before Delete, and no Unarchive", async () => {
    const props: CapturedTableProps = await renderPage(
      <MonitorTable query={{}} />,
    );

    const buttons: Array<unknown> = props.bulkActions!.buttons;
    expect(buttons).toContain("archive-action");
    expect(buttons).not.toContain("unarchive-action");
    expect(buttons.indexOf("archive-action")).toBeLessThan(
      buttons.indexOf(ModalTableBulkDefaultActions.Delete),
    );
    expect(lastArchiveHookOptions()).toEqual({
      modelType: Monitor,
      singularName: MONITOR_ARCHIVE_COPY.singularName,
      pluralName: MONITOR_ARCHIVE_COPY.pluralName,
      archiveConfirmMessage: MONITOR_ARCHIVE_COPY.bulkArchiveConfirmMessage,
      unarchiveConfirmMessage: MONITOR_ARCHIVE_COPY.bulkUnarchiveConfirmMessage,
    });
  });

  test("the Archived Monitors page lists archived monitors only, with Unarchive and Delete", async () => {
    const props: CapturedTableProps = await renderPage(
      <ArchivedMonitors {...PAGE_PROPS} />,
    );

    expect(props.query["isArchived"]).toBe(true);
    expect(props.query["projectId"]).toBeDefined();
    expect(props.bulkActions!.buttons).toEqual([
      "unarchive-action",
      ModalTableBulkDefaultActions.Delete,
    ]);
    expect(props.name).toBe(MONITOR_ARCHIVE_COPY.archivedPageTitle);
    expect(props.cardProps.title).toBe(MONITOR_ARCHIVE_COPY.archivedPageTitle);
    expect(props.cardProps.description).toBe(
      MONITOR_ARCHIVE_COPY.archivedPageDescription,
    );
    expect(props.noItemsMessage).toBe(
      MONITOR_ARCHIVE_COPY.noArchivedItemsMessage,
    );
  });

  test("the Archived Monitors page has its own table, creates nothing, and ends with who archived and when", async () => {
    const props: CapturedTableProps = await renderPage(
      <ArchivedMonitors {...PAGE_PROPS} />,
    );

    expect(props.id).toBe("monitors-archived-table");
    expect(props.userPreferencesKey).toBe("monitors-archived-table");
    expect(props.enableJsonImportExport).toBe(false);
    expect(titles(props.cardButtons as Array<{ title: string }>)).not.toContain(
      "Create Monitor",
    );
    expect(titles(props.columns).slice(-2)).toEqual([
      "Archived At",
      "Archived By",
    ]);
  });

  test("a live monitor list does not end with the archive columns", async () => {
    const props: CapturedTableProps = await renderPage(
      <MonitorTable query={{}} />,
    );

    expect(titles(props.columns)).not.toContain("Archived At");
    expect(titles(props.columns)).not.toContain("Archived By");
  });

  test("an archived monitor's status reads Archived, not the status it was frozen at", async () => {
    const props: CapturedTableProps = await renderPage(
      <ArchivedMonitors {...PAGE_PROPS} />,
    );

    const cell: HTMLElement = statusCell(
      props,
      monitor({ isArchived: true, disableActiveMonitoring: true }),
    );

    expect(cell).toHaveTextContent("Archived");
    expect(cell).not.toHaveTextContent("Offline");
    expect(cell).not.toHaveTextContent("Disabled");
  });

  test("a live monitor's status is shown as before", async () => {
    const props: CapturedTableProps = await renderPage(
      <MonitorTable query={{}} />,
    );

    const cell: HTMLElement = statusCell(props, monitor({ isArchived: false }));

    expect(cell).toHaveTextContent("Offline");
    expect(cell).not.toHaveTextContent("Archived");
  });
});
