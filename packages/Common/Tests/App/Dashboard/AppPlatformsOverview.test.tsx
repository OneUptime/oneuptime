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
import AppPlatformsOverview, {
  ENVIRONMENT_ROW_CLASS_NAME,
  ENVIRONMENT_STATE_CLASS_NAME,
  PLATFORM_GROUP_CLASS_NAME,
  PLATFORM_HEADER_CLASS_NAME,
  PLATFORM_STATE_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Overview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  AppPlatformEnvironmentRow,
  AppPlatformEnvironmentState,
  AppPlatformGroup,
  AppPlatformGroupTone,
  ENVIRONMENTS_SHOWN_PER_PLATFORM,
  getAppPlatformEnvironmentState,
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
    select?: Record<string, unknown>;
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

    /*
     * The strip reads the environments' ids alone, to count their apps
     * (CloudFleetSummary); the page's own read is the one with their names.
     */
    const isStripIdRead: boolean =
      Object.keys(options.select || {}).join(",") === "_id";

    if (!isStripIdRead) {
      listQueries.push(options.query || {});
    }

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

// A card on the page, by the id its Card is given.
function cardById(id: string): HTMLElement {
  const card: HTMLElement | null = document.getElementById(id);

  if (!card) {
    throw new Error(`No card with the id ${id}.`);
  }

  return card;
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

  test("a group is healthy when every environment is connected, silent when none is, partial between, waiting before any data", () => {
    const heardFrom: Date = new Date();
    const tone: (
      connected: Array<boolean>,
      lastSeenAt?: Date | null,
    ) => AppPlatformGroupTone = (
      connected: Array<boolean>,
      lastSeenAt: Date | null = heardFrom,
    ): AppPlatformGroupTone => {
      return getAppPlatformGroupTone(
        groupEnvironmentsByPlatform(
          connected.map((isConnected: boolean, index: number) => {
            return row({ name: `env-${index}`, isConnected, lastSeenAt });
          }),
        )[0]!,
      );
    };

    expect(tone([true, true])).toBe(AppPlatformGroupTone.Healthy);
    expect(tone([true, false])).toBe(AppPlatformGroupTone.Partial);
    expect(tone([false, false])).toBe(AppPlatformGroupTone.Silent);
    /*
     * None of them has sent anything yet: nothing broke, so the group
     * waits, in grey, rather than reading as gone silent.
     */
    expect(tone([false, false], null)).toBe(AppPlatformGroupTone.Waiting);
    expect(tone([false], null)).toBe(AppPlatformGroupTone.Waiting);
    // One that was heard from makes the group silent: it went quiet.
    expect(
      getAppPlatformGroupTone(
        groupEnvironmentsByPlatform([
          row({ name: "never", isConnected: false, lastSeenAt: null }),
          row({ name: "quiet", isConnected: false, lastSeenAt: heardFrom }),
        ])[0]!,
      ),
    ).toBe(AppPlatformGroupTone.Silent);
  });

  test("an environment is connected, quiet once heard from, or waiting for its first data", () => {
    expect(
      getAppPlatformEnvironmentState(
        row({ isConnected: true, lastSeenAt: new Date() }),
      ),
    ).toBe(AppPlatformEnvironmentState.Connected);
    expect(
      getAppPlatformEnvironmentState(
        row({ isConnected: false, lastSeenAt: new Date() }),
      ),
    ).toBe(AppPlatformEnvironmentState.Quiet);
    expect(
      getAppPlatformEnvironmentState(
        row({ isConnected: false, lastSeenAt: null }),
      ),
    ).toBe(AppPlatformEnvironmentState.Waiting);
    // Connected wins, even before its first lastSeenAt is written.
    expect(
      getAppPlatformEnvironmentState(
        row({ isConnected: true, lastSeenAt: null }),
      ),
    ).toBe(AppPlatformEnvironmentState.Connected);
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
    // Its only environment has sent nothing yet: it waits, in grey.
    expect(
      within(appService).getByTestId("app-platforms-platform-status"),
    ).toHaveTextContent("Waiting for first data");
    expect(
      within(appService).getByTestId("app-platforms-environment-status"),
    ).toHaveTextContent("Waiting for its first data");
  });

  /*
   * The healthy rows stay quiet - a green dot, and "Connected" for a screen
   * reader only - so the ones that need a look are the rows with words: one
   * that went quiet says when it was last heard from, in amber, and one
   * that has sent nothing yet says it waits for its first data, in grey.
   * Each dot is the colour of its words.
   */
  test("only the rows that need a look say so, each dot the colour of its words", async () => {
    await renderOverview();

    await waitFor(() => {
      expect(platformGroups()).toHaveLength(3);
    });

    const rowsByState: Record<string, Array<HTMLElement>> = {};
    for (const environmentRow of screen.getAllByTestId(
      "app-platforms-environment",
    )) {
      const state: string = environmentRow.getAttribute("data-state") || "";
      rowsByState[state] = [...(rowsByState[state] || []), environmentRow];
    }

    expect(rowsByState[AppPlatformEnvironmentState.Connected]).toHaveLength(2);
    expect(rowsByState[AppPlatformEnvironmentState.Quiet]).toHaveLength(1);
    expect(rowsByState[AppPlatformEnvironmentState.Waiting]).toHaveLength(1);

    for (const connected of rowsByState[
      AppPlatformEnvironmentState.Connected
    ]!) {
      const status: HTMLElement = within(connected).getByTestId(
        "app-platforms-environment-status",
      );
      expect(status).toHaveTextContent("Connected");
      expect(status).toHaveClass("sr-only");
      expect(
        within(connected).getByTestId("app-platforms-environment-dot"),
      ).toHaveClass("bg-emerald-500");
    }

    const quiet: HTMLElement =
      rowsByState[AppPlatformEnvironmentState.Quiet]![0]!;
    const quietStatus: HTMLElement = within(quiet).getByTestId(
      "app-platforms-environment-status",
    );
    expect(quietStatus).toHaveTextContent(/^Last seen /);
    expect(quietStatus).not.toHaveClass("sr-only");
    expect(quietStatus).toHaveClass("text-amber-700");
    expect(
      within(quiet).getByTestId("app-platforms-environment-dot"),
    ).toHaveClass("bg-amber-500");

    const waiting: HTMLElement =
      rowsByState[AppPlatformEnvironmentState.Waiting]![0]!;
    const waitingStatus: HTMLElement = within(waiting).getByTestId(
      "app-platforms-environment-status",
    );
    expect(waitingStatus).toHaveTextContent("Waiting for its first data");
    expect(waitingStatus).toHaveClass("text-gray-500");
    expect(waitingStatus).not.toHaveClass("text-amber-700");
    expect(
      within(waiting).getByTestId("app-platforms-environment-dot"),
    ).toHaveClass("bg-gray-300");

    // A dot is drawn, never read: the words say the state.
    for (const dot of screen.getAllByTestId("app-platforms-environment-dot")) {
      expect(dot).toHaveAttribute("aria-hidden", "true");
    }
  });

  /*
   * Laid out by the room the card gives a platform (container queries),
   * not the window's: a narrow platform puts its state under its name and
   * an environment's state under the environment's name, the same way on
   * every row; a wide one ends each line with them.
   */
  test("each platform and row is laid out by its own width, the same way on every row", async () => {
    await renderOverview();

    await waitFor(() => {
      expect(platformGroups()).toHaveLength(3);
    });

    for (const group of platformGroups()) {
      expect(group.className).toBe(PLATFORM_GROUP_CLASS_NAME);
      expect(group.className).toContain("[container-type:inline-size]");
      const status: HTMLElement = within(group).getByTestId(
        "app-platforms-platform-status",
      );
      expect(status.className).toBe(PLATFORM_STATE_CLASS_NAME);
      expect(status.parentElement!.className).toBe(PLATFORM_HEADER_CLASS_NAME);
    }

    // Narrow: under the name. Wide: its own column at the end of the row.
    expect(PLATFORM_HEADER_CLASS_NAME).toContain(
      "grid-cols-[auto_minmax(0,1fr)]",
    );
    expect(PLATFORM_HEADER_CLASS_NAME).toContain(
      "[@container(min-width:24rem)]:grid-cols-[auto_minmax(0,1fr)_auto]",
    );
    expect(PLATFORM_STATE_CLASS_NAME).toContain("col-start-2");
    expect(PLATFORM_STATE_CLASS_NAME).toContain(
      "[@container(min-width:24rem)]:col-start-auto",
    );
    expect(ENVIRONMENT_ROW_CLASS_NAME).toContain(
      "[@container(min-width:34rem)]:grid-cols-[auto_minmax(0,1fr)_auto]",
    );
    expect(ENVIRONMENT_STATE_CLASS_NAME).toContain("col-start-2");
    expect(ENVIRONMENT_STATE_CLASS_NAME).toContain(
      "[@container(min-width:34rem)]:col-start-auto",
    );
    // A row never wraps its end under itself by chance.
    expect(ENVIRONMENT_ROW_CLASS_NAME).not.toContain("flex-wrap");

    for (const environmentRow of screen.getAllByTestId(
      "app-platforms-environment",
    )) {
      expect(environmentRow.className).toBe(ENVIRONMENT_ROW_CLASS_NAME);
      const status: HTMLElement = within(environmentRow).getByTestId(
        "app-platforms-environment-status",
      );
      if (
        environmentRow.getAttribute("data-state") !==
        AppPlatformEnvironmentState.Connected
      ) {
        expect(status.className).toContain(ENVIRONMENT_STATE_CLASS_NAME);
      }
    }
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

    /*
     * The Platforms card says so, and so does Recent deploys, which reads
     * the environments first; each card reads again on its own.
     */
    await waitFor(() => {
      expect(
        within(cardById("platforms")).getByTestId("refresh-button"),
      ).toBeInTheDocument();
    });
    expect(
      within(cardById("recent-deploys")).getByTestId("refresh-button"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("app-platforms-platforms")).toBeNull();

    failLists = false;
    await act(async () => {
      fireEvent.click(
        within(cardById("platforms")).getByTestId("refresh-button"),
      );
    });

    await waitFor(() => {
      expect(platformGroups()).toHaveLength(3);
    });
    expect(listQueries).toHaveLength(2);
  });
});
