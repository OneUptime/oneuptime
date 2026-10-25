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
import { FunctionComponent } from "react";
import { MemoryRouter } from "react-router-dom";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * Adding a resource the way a host is added (Components/ResourceOnboarding,
 * #5269), on the real list pages over a project kept here:
 *
 *  - A list whose resources register themselves when their agent first
 *    reports has no form to type one in. Its card header's Add button opens
 *    the resource's setup guide in a dialog, starting with a name the
 *    project has not used.
 *  - A resource that registers while the dialog is open is announced in it,
 *    with a link to it, and the list reads it at once - no reload. One the
 *    project already had is never taken for it, however busy it is.
 *  - An empty list shows the same guide under its table, and the guide
 *    gives way as soon as its last step sees the resource connect - before
 *    the list's own watch would count again.
 *  - The cloud environments' dialog waits for an environment, not for a
 *    resource a cloud's monitoring API reports, and the summary over the
 *    list counts the new one.
 *
 * Only the data boundary (ModelAPI, API) and the signed-in user are
 * replaced. ResourceOnboarding.test.tsx renders the guide's parts on their
 * own, and InfrastructureListFirstRun.test.tsx the first run of every list.
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

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): { toString: () => string } => {
        return {
          toString: () => {
            return "80000000-0000-4000-8000-000000000001";
          },
        };
      },
      getName: (): string => {
        return "Test User";
      },
      getEmail: (): string => {
        return "test@example.com";
      },
    },
  };
});

// The guide's commands as text, so the name in them can be read.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return React.createElement("div", {}, props.text);
    },
  };
});

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import Route from "../../../Types/API/Route";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import Search from "../../../Types/BaseDatabase/Search";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import {
  hasWildcard,
  unescapeWildcards,
} from "../../../Types/BaseDatabase/WildcardPattern";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import ObjectID from "../../../Types/ObjectID";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import { FIRST_RECORD_POLL_INTERVAL_MS } from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/FirstRecordWatch";
import { RESOURCE_NAME_LOOKUP_DELAY_MS } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOnboarding/AddResourceGuide";
import { RESOURCE_CONNECTION_POLL_INTERVAL_MS } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOnboarding/ResourceOnboarding";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import KubernetesClustersPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Clusters";
import CloudEnvironmentsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/CloudResources";

type PageComponent = FunctionComponent<PageComponentProps>;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/kubernetes`),
  currentProject: null,
  hasPaymentMethod: true,
} as unknown as PageComponentProps;

const SERVER_KEY: string = "acme-server-key-0123456789";

const DAY_MS: number = 24 * 60 * 60 * 1000;

type Row = Record<string, unknown>;

// The project, by table, as each test sets it up.
let store: Map<string, Array<Row>> = new Map<string, Array<Row>>();
// How many times each list's table read its rows.
let tableReads: Map<string, number> = new Map<string, number>();
// Every record anything on the page asked ModelAPI to create.
let created: Array<string> = [];
// How many times each table was counted, as an empty list's watch counts it.
let counts: Map<string, number> = new Map<string, number>();

function tableOf(modelType: { new (): BaseModel }): string {
  return new modelType().tableName || "";
}

function rowsOf(modelType: { new (): BaseModel }): Array<Row> {
  const table: string = tableOf(modelType);
  if (!store.has(table)) {
    store.set(table, []);
  }
  return store.get(table)!;
}

function asTime(value: unknown): number {
  return value ? new Date(value as string | Date).getTime() : NaN;
}

// A query, matched as the server would.
function matches(row: Row, query: Record<string, unknown>): boolean {
  for (const [field, wanted] of Object.entries(query)) {
    // Every row here is the current project's.
    if (field === "projectId") {
      continue;
    }

    const value: unknown = row[field];

    if (wanted instanceof Search) {
      if (
        typeof value !== "string" ||
        !value.toLowerCase().includes(String(wanted.value).toLowerCase())
      ) {
        return false;
      }
      continue;
    }

    // A glob with no wildcard in it: that text exactly, case aside (ILIKE).
    if (wanted instanceof Wildcard) {
      if (hasWildcard(wanted.value)) {
        throw new Error(`Only exact Wildcards are modelled: ${wanted.value}`);
      }
      if (
        typeof value !== "string" ||
        value.toLowerCase() !== unescapeWildcards(wanted.value).toLowerCase()
      ) {
        return false;
      }
      continue;
    }

    if (wanted instanceof NotNull) {
      if (value === null || value === undefined) {
        return false;
      }
      continue;
    }

    if (wanted instanceof GreaterThanOrEqual) {
      if (!(asTime(value) >= asTime(wanted.value))) {
        return false;
      }
      continue;
    }

    if (wanted instanceof ObjectID) {
      if (String(value) !== wanted.toString()) {
        return false;
      }
      continue;
    }

    if (typeof wanted === "string" || typeof wanted === "boolean") {
      if (value !== wanted) {
        return false;
      }
    }
  }
  return true;
}

function isTheGuidesRead(options: {
  query?: Record<string, unknown>;
  select?: Record<string, unknown>;
}): boolean {
  /*
   * The Add guide's own reads: the name it starts with (a Search), whether
   * the typed name is taken (a Wildcard), and its last step's checks, which
   * read each record's createdAt - a column no list's table selects.
   */
  return (
    Object.values(options.query || {}).some((value: unknown): boolean => {
      return value instanceof Search || value instanceof Wildcard;
    }) || Boolean((options.select || {})["createdAt"])
  );
}

function idOf(number: number): string {
  return `30000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

beforeEach(() => {
  jest.useFakeTimers();
  store = new Map<string, Array<Row>>();
  tableReads = new Map<string, number>();
  created = [];
  counts = new Map<string, number>();
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  goTo(`/dashboard/${PROJECT_ID}/kubernetes`);

  rowsOf(TelemetryIngestionKey).push({
    _id: "40000000-0000-4000-8000-000000000001",
    name: "Production",
    secretKey: SERVER_KEY,
    keyType: TelemetryIngestionKeyType.Server,
  });

  jest.spyOn(ModelAPI, "getList").mockImplementation(((options: {
    modelType: { new (): BaseModel };
    query?: Record<string, unknown>;
    select?: Record<string, unknown>;
    sort?: Record<string, unknown>;
    limit?: number;
    skip?: number;
  }): Promise<ListResult<BaseModel>> => {
    const table: string = tableOf(options.modelType);
    const query: Record<string, unknown> = options.query || {};

    if (!isTheGuidesRead(options)) {
      tableReads.set(table, (tableReads.get(table) || 0) + 1);
    }

    const found: Array<Row> = rowsOf(options.modelType).filter((row: Row) => {
      return matches(row, query);
    });

    if (options.sort && options.sort["createdAt"]) {
      found.sort((first: Row, second: Row): number => {
        return asTime(second["createdAt"]) - asTime(first["createdAt"]);
      });
    }

    const models: Array<BaseModel> = found
      .slice(0, options.limit || found.length)
      .map((row: Row): BaseModel => {
        return Object.assign(new options.modelType(), row);
      });

    return Promise.resolve({
      data: models,
      count: found.length,
      skip: options.skip || 0,
      limit: options.limit || 10,
    } as ListResult<BaseModel>);
  }) as never);
  jest.spyOn(ModelAPI, "count").mockImplementation(((options: {
    modelType: { new (): BaseModel };
    query?: Record<string, unknown>;
  }): Promise<number> => {
    const table: string = tableOf(options.modelType);
    counts.set(table, (counts.get(table) || 0) + 1);
    return Promise.resolve(
      rowsOf(options.modelType).filter((row: Row) => {
        return matches(row, options.query || {});
      }).length,
    );
  }) as never);
  jest.spyOn(ModelAPI, "getItem").mockResolvedValue(null as never);
  jest.spyOn(ModelAPI, "create").mockImplementation(((options: {
    model: BaseModel;
  }): Promise<never> => {
    created.push(options.model.tableName || "");
    return Promise.reject(new Error("Nothing is created on these pages."));
  }) as never);
  jest.spyOn(API, "get").mockResolvedValue({ data: {} } as never);
  jest.spyOn(API, "post").mockResolvedValue({ data: {} } as never);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function settle(): Promise<void> {
  for (let i: number = 0; i < 20; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// Moves the clock on, and with it the page's and the guide's checks.
async function advance(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await settle();
}

async function renderPage(Page: PageComponent): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <Page {...PAGE_PROPS} />
      </MemoryRouter>,
    );
  });
  await settle();
}

// The card the list's table is drawn in, by its title.
function listCard(title: string): HTMLElement {
  const card: HTMLElement | undefined = screen
    .getAllByTestId("card")
    .find((candidate: HTMLElement): boolean => {
      const header: HTMLElement | null =
        within(candidate).queryByTestId("card-header");
      return Boolean(header && within(header).queryByText(title));
    });
  if (!card) {
    throw new Error(`No card titled ${title}.`);
  }
  return card;
}

function headerButton(card: HTMLElement, name: string): HTMLElement {
  return within(within(card).getByTestId("card-header-actions")).getByRole(
    "button",
    { name },
  );
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
  await settle();
}

function dialog(): HTMLElement {
  return screen.getByTestId("add-resource-modal");
}

// Ingest registering a cluster when its agent first reports.
function clusterArrives(data: {
  id: number;
  name: string;
  createdAt?: Date;
}): void {
  const now: Date = data.createdAt || new Date();
  rowsOf(KubernetesCluster).push({
    _id: idOf(data.id),
    name: data.name,
    clusterIdentifier: data.name,
    otelCollectorStatus: "connected",
    isArchived: false,
    createdAt: now,
    lastSeenAt: now,
  });
}

const CLUSTERS: string = "Kubernetes Clusters";

describe("Kubernetes Clusters: Add Kubernetes Cluster", () => {
  beforeEach(() => {
    // Registered a month ago, and reporting.
    clusterArrives({
      id: 1,
      name: "my-cluster",
      createdAt: new Date(Date.now() - 30 * DAY_MS),
    });
  });

  test("opens the cluster's setup guide in a dialog, with a name the project has not used: no form to type one in", async () => {
    await renderPage(KubernetesClustersPage);

    const card: HTMLElement = listCard(CLUSTERS);

    expect(within(card).getAllByText("my-cluster").length).toBeGreaterThan(0);
    // The project has a cluster: no first-run guide under the list.
    expect(screen.queryByTestId("resource-name-input")).toBeNull();
    // Nothing to create by hand, here or anywhere on the page.
    expect(screen.queryByRole("button", { name: /^Create / })).toBeNull();

    await click(headerButton(card, "Add Kubernetes Cluster"));
    await advance(RESOURCE_NAME_LOOKUP_DELAY_MS);

    expect(
      within(screen.getByTestId("modal")).getByRole("heading", {
        name: "Add Kubernetes Cluster",
      }),
    ).toBeInTheDocument();
    expect(within(dialog()).getByTestId("resource-name-input")).toHaveValue(
      "my-cluster-2",
    );
    expect(dialog().textContent).toContain('--set clusterName="my-cluster-2"');
    expect(
      within(dialog()).getByTestId("resource-connection-waiting"),
    ).toHaveTextContent("Waiting for my-cluster-2 to connect.");
    // The guide creates nothing: the cluster registers itself.
    expect(created).toEqual([]);
  });

  test("announces the cluster it installs when it registers, and the list reads it at once; the one the project had is not taken for it", async () => {
    await renderPage(KubernetesClustersPage);
    await click(headerButton(listCard(CLUSTERS), "Add Kubernetes Cluster"));
    await advance(RESOURCE_NAME_LOOKUP_DELAY_MS);

    const readsBefore: number = tableReads.get("KubernetesCluster") || 0;

    // The cluster the project had keeps reporting: not the one being added.
    rowsOf(KubernetesCluster)[0]!["lastSeenAt"] = new Date(Date.now() + 1000);
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS * 2);

    expect(
      within(dialog()).queryByTestId("resource-connection-connected"),
    ).toBeNull();
    expect(tableReads.get("KubernetesCluster") || 0).toBe(readsBefore);

    // The agent the guide's command installed reports for the first time.
    clusterArrives({ id: 2, name: "my-cluster-2" });
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    const connected: HTMLElement = within(dialog()).getByTestId(
      "resource-connection-connected",
    );

    expect(connected).toHaveTextContent(
      "my-cluster-2 is connected. Its data arrives within a minute or two.",
    );
    expect(
      within(connected).getByRole("link", { name: "View cluster" }),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/kubernetes/${idOf(2)}`);
    // The list behind the dialog read its rows again: no reload.
    expect(tableReads.get("KubernetesCluster") || 0).toBeGreaterThan(
      readsBefore,
    );
    expect(
      within(listCard(CLUSTERS)).getAllByText("my-cluster-2").length,
    ).toBeGreaterThan(0);

    // Done leaves the list as it is.
    await click(screen.getByRole("button", { name: "Done" }));

    expect(screen.queryByTestId("add-resource-modal")).toBeNull();
    expect(
      within(listCard(CLUSTERS)).getAllByText("my-cluster-2").length,
    ).toBeGreaterThan(0);
    expect(created).toEqual([]);
  });
});

describe("Kubernetes Clusters: a new project's first-run guide", () => {
  test("is the Add guide under the empty table, and gives way as soon as its last step sees the cluster connect", async () => {
    await renderPage(KubernetesClustersPage);
    await advance(RESOURCE_NAME_LOOKUP_DELAY_MS);

    const card: HTMLElement = listCard(CLUSTERS);
    const guideTitle: HTMLElement = screen.getByText(
      "Getting Started with Kubernetes Monitoring",
    );
    // The list's own watch counted once, when the page opened.
    expect(counts.get("KubernetesCluster")).toBe(1);

    // The empty table first, then the same guide the Add button opens.
    expect(
      card.compareDocumentPosition(guideTitle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId("resource-name-input")).toHaveValue("my-cluster");
    expect(
      within(card).getByRole("button", { name: "Add Kubernetes Cluster" }),
    ).toBeInTheDocument();

    clusterArrives({ id: 3, name: "my-cluster" });
    // The guide's next check, sooner than the list's own watch counts again.
    expect(RESOURCE_CONNECTION_POLL_INTERVAL_MS).toBeLessThan(
      FIRST_RECORD_POLL_INTERVAL_MS,
    );
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    expect(
      screen.queryByText("Getting Started with Kubernetes Monitoring"),
    ).toBeNull();
    expect(screen.queryByTestId("resource-name-input")).toBeNull();
    expect(
      within(listCard(CLUSTERS)).getAllByText("my-cluster").length,
    ).toBeGreaterThan(0);
    // The guide said so itself: the list's watch did not count again.
    expect(counts.get("KubernetesCluster")).toBe(1);

    // And it is over: nothing counts again.
    await advance(FIRST_RECORD_POLL_INTERVAL_MS * 2);
    expect(counts.get("KubernetesCluster")).toBe(1);
  });
});

describe("Cloud Environments: Add Cloud Environment", () => {
  function cloudRow(data: {
    id: number;
    name: string;
    kind: CloudResourceKind;
    provider: CloudProvider;
    createdAt?: Date;
  }): Row {
    const now: Date = data.createdAt || new Date();
    return {
      _id: idOf(data.id),
      name: data.name,
      cloudResourceKind: data.kind,
      cloudProvider: data.provider,
      otelCollectorStatus: "connected",
      isArchived: false,
      createdAt: now,
      lastSeenAt: now,
    };
  }

  test("waits for an environment, not a resource a cloud's monitoring API reports, and the summary counts the new one", async () => {
    goTo(`/dashboard/${PROJECT_ID}/cloud`);
    rowsOf(CloudResource).push(
      cloudRow({
        id: 10,
        name: "AWS ECS · us-east-1 · 111111111111",
        kind: CloudResourceKind.Environment,
        provider: CloudProvider.AWS,
        createdAt: new Date(Date.now() - 30 * DAY_MS),
      }),
    );

    await renderPage(CloudEnvironmentsPage);

    // The summary's first tile: how many environments, and on which clouds.
    const environments: () => HTMLElement = (): HTMLElement => {
      return within(screen.getByTestId("cloud-fleet-summary")).getAllByTestId(
        "cloud-fleet-summary-tile",
      )[0]!;
    };

    expect(environments()).toHaveTextContent("Environments");
    expect(environments()).toHaveTextContent(/1\s*1 AWS$/);

    await click(
      headerButton(listCard("Cloud Environments"), "Add Cloud Environment"),
    );
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    // An environment names itself: no name to type.
    expect(within(dialog()).queryByTestId("resource-name-input")).toBeNull();

    // A queue the cloud's monitoring API reports registers: not an environment.
    rowsOf(CloudResource).push(
      cloudRow({
        id: 11,
        name: "orders-queue",
        kind: CloudResourceKind.Resource,
        provider: CloudProvider.AWS,
      }),
    );
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS * 2);

    expect(
      within(dialog()).queryByTestId("resource-connection-connected"),
    ).toBeNull();
    expect(
      within(dialog()).getByTestId("resource-connection-waiting"),
    ).toHaveTextContent("Waiting for the first data.");

    // The app's first data, from Cloud Run.
    rowsOf(CloudResource).push(
      cloudRow({
        id: 12,
        name: "GCP Cloud Run · europe-west1 · acme-prod",
        kind: CloudResourceKind.Environment,
        provider: CloudProvider.GCP,
      }),
    );
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    expect(
      within(dialog()).getByTestId("connected-resource-name"),
    ).toHaveTextContent("GCP Cloud Run · europe-west1 · acme-prod");
    expect(
      within(dialog()).getByRole("link", { name: "View environment" }),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/cloud/${idOf(12)}`);
    // The summary over the list counted again.
    expect(environments()).toHaveTextContent(/2\s*1 AWS · 1 Google Cloud$/);
    expect(
      within(listCard("Cloud Environments")).getAllByText(
        "GCP Cloud Run · europe-west1 · acme-prod",
      ).length,
    ).toBeGreaterThan(0);
  });
});
