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
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * App Platforms' Overview, the page the product opens on, over a project
 * kept here: the fleet strip, then "Platforms" - one group per platform the
 * apps run on, in the catalogue's order, each with its environments, the
 * ones that went quiet first - and, before the first environment, what the
 * product does and the way to add one. Only the data boundary (ModelAPI)
 * and the signed-in user are replaced.
 */

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
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: ["Public", "User", "CurrentUser"] };
      },
    },
  };
});

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import AppPlatformsOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Overview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  AppPlatformEnvironmentRow,
  AppPlatformGroup,
  AppPlatformGroupTone,
  ENVIRONMENTS_SHOWN_PER_PLATFORM,
  getAppPlatformGroupTone,
  groupEnvironmentsByPlatform,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/AppPlatformsOverview";
import { RESOURCE_SHOWCASE_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceShowcase/ResourceShowcaseCard";

type Row = Record<string, unknown>;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/app-platforms`),
  currentProject: null,
  hasPaymentMethod: true,
} as unknown as PageComponentProps;

const HOUR_MS: number = 60 * 60 * 1000;
const APP_PLATFORMS: string = `/dashboard/${PROJECT_ID}/app-platforms`;

function idOf(number: number): string {
  return `30000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

// The project's CloudResource rows, as each test sets them up.
let rows: Array<Row> = [];
// What the page asked for, so a test can read the query.
let listQueries: Array<Record<string, unknown>> = [];
let failLists: boolean = false;

function environment(data: {
  id: number;
  name: string;
  platform: string;
  provider: CloudProvider | "";
  connected: boolean;
  lastSeenHoursAgo?: number | undefined;
}): Row {
  return {
    _id: idOf(data.id),
    name: data.name,
    cloudResourceKind: CloudResourceKind.Environment,
    cloudPlatform: data.platform,
    cloudProvider: data.provider,
    otelCollectorStatus: data.connected ? "connected" : "disconnected",
    isArchived: false,
    lastSeenAt:
      data.lastSeenHoursAgo === undefined
        ? null
        : new Date(Date.now() - data.lastSeenHoursAgo * HOUR_MS),
  };
}

// A query, matched as the server would, for the columns this page reads.
function matches(row: Row, query: Record<string, unknown>): boolean {
  for (const [field, wanted] of Object.entries(query)) {
    if (field === "projectId") {
      continue;
    }
    if (typeof wanted === "string" || typeof wanted === "boolean") {
      if (row[field] !== wanted) {
        return false;
      }
    }
  }
  return true;
}

function cloudRows(query: Record<string, unknown>): Array<Row> {
  return rows.filter((row: Row): boolean => {
    return matches(row, query);
  });
}

beforeEach(() => {
  rows = [];
  listQueries = [];
  failLists = false;
  PermissionGate.clearPermissionPropsCache();
  window.localStorage.clear();
  goTo(APP_PLATFORMS);

  jest.spyOn(ModelAPI, "getList").mockImplementation(((options: {
    modelType: { new (): BaseModel };
    query?: Record<string, unknown>;
    limit?: number;
  }): Promise<ListResult<BaseModel>> => {
    if (new options.modelType().tableName !== "CloudResource") {
      return Promise.resolve({
        data: [],
        count: 0,
        skip: 0,
        limit: 10,
      } as ListResult<BaseModel>);
    }

    listQueries.push(options.query || {});

    if (failLists) {
      return Promise.reject(new Error("The environments could not be read."));
    }

    const found: Array<Row> = cloudRows(options.query || {});

    return Promise.resolve({
      data: found.map((row: Row): BaseModel => {
        return Object.assign(new CloudResource(), row);
      }),
      count: found.length,
      skip: 0,
      limit: options.limit || 10,
    } as ListResult<BaseModel>);
  }) as never);

  jest.spyOn(ModelAPI, "count").mockImplementation(((options: {
    modelType: { new (): BaseModel };
    query?: Record<string, unknown>;
  }): Promise<number> => {
    if (new options.modelType().tableName !== "CloudResource") {
      return Promise.resolve(0);
    }
    return Promise.resolve(cloudRows(options.query || {}).length);
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderOverview(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[APP_PLATFORMS]}>
        <AppPlatformsOverview {...PAGE_PROPS} />
      </MemoryRouter>,
    );
  });
}

function platformGroups(): Array<HTMLElement> {
  return screen.getAllByTestId("app-platforms-platform");
}

function environmentNames(group: HTMLElement): Array<string> {
  return within(group)
    .getAllByTestId("app-platforms-environment")
    .map((row: HTMLElement): string => {
      return within(row).getByRole("link").textContent || "";
    });
}

describe("grouping the environments by platform", () => {
  function row(
    data: Partial<AppPlatformEnvironmentRow>,
  ): AppPlatformEnvironmentRow {
    return {
      id: data.id || data.name || "",
      name: data.name || "",
      cloudPlatform: data.cloudPlatform ?? "aws_ecs",
      cloudProvider: data.cloudProvider ?? "aws",
      isConnected: data.isConnected ?? true,
      lastSeenAt: data.lastSeenAt ?? null,
    };
  }

  test("one group per platform, in the catalogue's order, named as their users call them", () => {
    const groups: Array<AppPlatformGroup> = groupEnvironmentsByPlatform([
      row({
        name: "web",
        cloudPlatform: "azure_container_apps",
        cloudProvider: "azure",
      }),
      row({
        name: "api",
        cloudPlatform: "gcp_cloud_run",
        cloudProvider: "gcp",
      }),
      row({ name: "checkout", cloudPlatform: "aws_ecs" }),
      row({ name: "billing", cloudPlatform: "aws_ecs" }),
    ]);

    expect(
      groups.map((group: AppPlatformGroup): Array<string | number> => {
        return [group.title, group.providerLabel, group.environments.length];
      }),
    ).toEqual([
      ["AWS ECS / Fargate", "AWS", 2],
      ["Google Cloud Run", "Google Cloud", 1],
      ["Azure Container Apps", "Azure", 1],
    ]);
  });

  test("a platform the catalogue does not know comes after the known ones, and no platform last", () => {
    const groups: Array<AppPlatformGroup> = groupEnvironmentsByPlatform([
      row({ name: "unknown", cloudPlatform: "", cloudProvider: "" }),
      row({
        name: "heroku-like",
        cloudPlatform: "acme_paas",
        cloudProvider: "",
      }),
      row({
        name: "api",
        cloudPlatform: "gcp_app_engine",
        cloudProvider: "gcp",
      }),
    ]);

    expect(
      groups.map((group: AppPlatformGroup): string => {
        return group.platform;
      }),
    ).toEqual(["gcp_app_engine", "acme_paas", ""]);
    // An unknown platform is named by its own value; no platform has no name.
    expect(groups[1]!.title).toBe("acme_paas");
    expect(groups[2]!.title).toBe("");
  });

  test("the disconnected first, the one heard from longest ago before the others, then by name", () => {
    const now: number = Date.now();
    const group: AppPlatformGroup = groupEnvironmentsByPlatform([
      row({ name: "b-live", isConnected: true }),
      row({ name: "a-live", isConnected: true }),
      row({
        name: "quiet-1h",
        isConnected: false,
        lastSeenAt: new Date(now - HOUR_MS),
      }),
      row({
        name: "quiet-3h",
        isConnected: false,
        lastSeenAt: new Date(now - 3 * HOUR_MS),
      }),
      row({ name: "never", isConnected: false, lastSeenAt: null }),
    ])[0]!;

    expect(
      group.environments.map(
        (environmentRow: AppPlatformEnvironmentRow): string => {
          return environmentRow.name;
        },
      ),
    ).toEqual(["never", "quiet-3h", "quiet-1h", "a-live", "b-live"]);
    expect(group.connected).toBe(2);
  });

  test("a group is healthy when every environment is connected, silent when none is, partial between", () => {
    const tone: (connected: Array<boolean>) => AppPlatformGroupTone = (
      connected: Array<boolean>,
    ): AppPlatformGroupTone => {
      return getAppPlatformGroupTone(
        groupEnvironmentsByPlatform(
          connected.map((isConnected: boolean, index: number) => {
            return row({ name: `env-${index}`, isConnected });
          }),
        )[0]!,
      );
    };

    expect(tone([true, true])).toBe(AppPlatformGroupTone.Healthy);
    expect(tone([true, false])).toBe(AppPlatformGroupTone.Partial);
    expect(tone([false, false])).toBe(AppPlatformGroupTone.Silent);
  });
});

describe("the Overview, before the first environment", () => {
  test("shows what the product does and the way to add one, and nothing to count", async () => {
    // A resource in a cloud account is Cloud's: it does not count here.
    rows.push({
      ...environment({
        id: 1,
        name: "orders-queue",
        platform: "",
        provider: CloudProvider.AWS,
        connected: true,
      }),
      cloudResourceKind: CloudResourceKind.Resource,
    });

    await renderOverview();

    await waitFor(() => {
      expect(screen.getByTestId(RESOURCE_SHOWCASE_TEST_ID)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("cloud-fleet-summary")).toBeNull();
    expect(screen.queryByTestId("app-platforms-platforms")).toBeNull();
    expect(listQueries).toEqual([]);
  });
});

describe("the Overview, with environments", () => {
  beforeEach(() => {
    rows.push(
      environment({
        id: 1,
        name: "checkout · us-east-1",
        platform: "aws_ecs",
        provider: CloudProvider.AWS,
        connected: true,
        lastSeenHoursAgo: 0,
      }),
      environment({
        id: 2,
        name: "billing · eu-west-1",
        platform: "aws_ecs",
        provider: CloudProvider.AWS,
        connected: false,
        lastSeenHoursAgo: 3,
      }),
      environment({
        id: 3,
        name: "api · europe-west1",
        platform: "gcp_cloud_run",
        provider: CloudProvider.GCP,
        connected: true,
        lastSeenHoursAgo: 0,
      }),
      environment({
        id: 4,
        name: "web · eastus",
        platform: "azure_app_service",
        provider: CloudProvider.Azure,
        connected: false,
      }),
      // A resource in a cloud account: Cloud's, never listed here.
      {
        ...environment({
          id: 5,
          name: "vm-prod-01",
          platform: "",
          provider: CloudProvider.Azure,
          connected: true,
        }),
        cloudResourceKind: CloudResourceKind.Resource,
      },
      // An archived environment: hidden, as in All Environments.
      {
        ...environment({
          id: 6,
          name: "old · us-west-2",
          platform: "aws_ecs",
          provider: CloudProvider.AWS,
          connected: false,
        }),
        isArchived: true,
      },
    );
  });

  test("counts the fleet, then groups the environments by platform", async () => {
    await renderOverview();

    await waitFor(() => {
      expect(screen.getByTestId("app-platforms-platforms")).toBeInTheDocument();
    });

    // The strip comes first, over the Platforms card.
    const strip: HTMLElement = screen.getByTestId("cloud-fleet-summary");
    const card: HTMLElement = screen.getByTestId("app-platforms-platforms");
    expect(
      strip.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("Platforms")).toBeInTheDocument();

    expect(
      platformGroups().map((group: HTMLElement): string | null => {
        return group.getAttribute("data-platform");
      }),
    ).toEqual(["aws_ecs", "gcp_cloud_run", "azure_app_service"]);

    // Only unarchived environments were read: no resource, no archived row.
    expect(listQueries).toEqual([
      { isArchived: false, cloudResourceKind: CloudResourceKind.Environment },
    ]);
    expect(screen.queryByText("vm-prod-01")).toBeNull();
    expect(screen.queryByText("old · us-west-2")).toBeNull();
  });

  test("each group says whether its environments are connected, the quiet ones first", async () => {
    await renderOverview();

    await waitFor(() => {
      expect(platformGroups()).toHaveLength(3);
    });

    const [ecs, cloudRun, appService] = platformGroups() as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];

    expect(ecs).toHaveTextContent("AWS ECS / Fargate");
    expect(ecs).toHaveTextContent("AWS · 2 environments");
    expect(
      within(ecs).getByTestId("app-platforms-platform-status"),
    ).toHaveTextContent("1 environment disconnected");
    // The one that went quiet is read first, with when it was last heard from.
    expect(environmentNames(ecs)).toEqual([
      "billing · eu-west-1",
      "checkout · us-east-1",
    ]);
    const statuses: Array<string> = within(ecs)
      .getAllByTestId("app-platforms-environment-status")
      .map((status: HTMLElement): string => {
        return status.textContent || "";
      });
    expect(statuses[0]).toMatch(/^Last seen /);
    expect(statuses[1]).toBe("Connected");

    expect(cloudRun).toHaveTextContent("Google Cloud Run");
    expect(
      within(cloudRun).getByTestId("app-platforms-platform-status"),
    ).toHaveTextContent("All connected");

    expect(appService).toHaveTextContent("Azure App Service");
    expect(
      within(appService).getByTestId("app-platforms-platform-status"),
    ).toHaveTextContent("Disconnected");
    expect(
      within(appService).getByTestId("app-platforms-environment-status"),
    ).toHaveTextContent("Waiting for its first data");
  });

  test("each environment links to its page in App Platforms", async () => {
    await renderOverview();

    await waitFor(() => {
      expect(platformGroups()).toHaveLength(3);
    });

    expect(
      screen.getByRole("link", { name: "api · europe-west1" }),
    ).toHaveAttribute("href", `${APP_PLATFORMS}/${idOf(3)}`);
    expect(
      screen.getByRole("link", { name: "billing · eu-west-1" }),
    ).toHaveAttribute("href", `${APP_PLATFORMS}/${idOf(2)}`);
  });

  test("a platform with more environments than the card lists links to all of them", async () => {
    for (
      let index: number = 0;
      index < ENVIRONMENTS_SHOWN_PER_PLATFORM + 2;
      index++
    ) {
      rows.push(
        environment({
          id: 100 + index,
          name: `run-${index} · us-central1`,
          platform: "gcp_cloud_run",
          provider: CloudProvider.GCP,
          connected: true,
        }),
      );
    }

    await renderOverview();

    await waitFor(() => {
      expect(platformGroups()).toHaveLength(3);
    });

    const cloudRun: HTMLElement = platformGroups()[1]!;

    expect(environmentNames(cloudRun)).toHaveLength(
      ENVIRONMENTS_SHOWN_PER_PLATFORM,
    );
    const more: HTMLElement = within(cloudRun).getByRole("link", {
      name: "3 more environments",
    });
    expect(more).toHaveAttribute("href", `${APP_PLATFORMS}/environments`);
  });

  test("a failed read says so, and Refresh reads again", async () => {
    failLists = true;

    await renderOverview();

    await waitFor(() => {
      expect(screen.getByTestId("refresh-button")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("app-platforms-platforms")).toBeNull();

    failLists = false;
    await act(async () => {
      fireEvent.click(screen.getByTestId("refresh-button"));
    });

    await waitFor(() => {
      expect(platformGroups()).toHaveLength(3);
    });
    expect(listQueries).toHaveLength(2);
  });
});
