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
  configure,
  render,
  renderHook,
  RenderHookResult,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * The first run of every infrastructure list - Hosts, Kubernetes, Docker,
 * Podman, Docker Swarm, Proxmox, VMware, Ceph, storage arrays, IoT fleets,
 * databases, queues, serverless functions and the two Cloud lists - as a
 * new project meets it.
 *
 * The empty table says what the list is ("No Docker hosts yet" and what
 * it is for), and the setup guide under it says only what to do. Create
 * stays in the card header; the empty table repeats it only where adding
 * one by hand is itself a way to connect (a vCenter through a probe, a
 * database or queue endpoint). Agents report on their own, so the page
 * keeps watching while the list is empty: when the first one arrives the
 * table reads its rows again and the guide is put away - no reload. Six of
 * these lists used to hide the guide without refreshing the table (an
 * empty table, and no guide), and the other nine never looked again.
 * Until the first one arrives the filter chips stay away (there is nothing
 * to filter), and a first count that failed offers Refresh.
 *
 * Every real page is rendered with the real ModelTable over a project
 * behind ModelAPI; useFirstRecordWatch and its rules are then tested on
 * their own.
 */

configure({ asyncUtilTimeout: 15000 });

jest.setTimeout(120000);

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
      // A project owner: may create every kind of record listed here.
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

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import { JSONObject } from "../../../Types/JSON";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import API from "../../../UI/Utils/API/API";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import { EMPTY_TABLE_CREATE_BUTTON_TEST_ID } from "../../../UI/Components/ModelTable/ModelTableEmptyState";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  FIRST_RECORD_POLL_INTERVAL_MS,
  FIRST_RUN_GUIDE_DESCRIPTION,
  getCountAfterCheck,
  getFirstRunEmptyState,
  getFirstRunTopContent,
  isWatchingForFirstRecord,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/FirstRecordWatch";
import useFirstRecordWatch, {
  FirstRecordWatch,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/UseFirstRecordWatch";

import Host from "../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import StorageArray from "../../../Models/DatabaseModels/StorageArray";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import MessageQueue from "../../../Models/DatabaseModels/MessageQueue";
import ServerlessFunction from "../../../Models/DatabaseModels/ServerlessFunction";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";

import HostsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Hosts";
import KubernetesClustersPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Clusters";
import DockerHostsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/Hosts";
import PodmanHostsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/Hosts";
import DockerSwarmClustersPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Clusters";
import ProxmoxClustersPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Clusters";
import VCentersPage from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/VCenters";
import CephClustersPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Clusters";
import StorageArraysPage from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/StorageArrays";
import IoTFleetsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/Fleets";
import DatabasesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Databases";
import MessageQueuesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/MessageQueues";
import ServerlessFunctionsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Serverless/ServerlessFunctions";
import CloudEnvironmentsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/CloudResources";
import CloudMonitoredResourcesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/MonitoredResources";

type PageComponent = (props: PageComponentProps) => ReactElement | null;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/home`),
  currentProject: null,
  hasPaymentMethod: true,
} as unknown as PageComponentProps;

const ROW_ID: string = "6c1b2a3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ROW_NAME: string = "first-one";

interface FirstRunCase {
  name: string;
  page: PageComponent;
  modelType: { new (): BaseModel };
  // What the page counts to decide whether the guide shows.
  watchQuery: JSONObject;
  guideTitle: string;
  /*
   * Adding one by hand is a way to connect here, so the empty table keeps
   * its Create button. Elsewhere creating a row by hand connects nothing:
   * the guide is the way in, and Create stays in the card header only.
   */
  isAddedByHand: boolean;
  // Cloud Resources are ingest's rows only: no Create anywhere.
  isCreateable: boolean;
  // It draws filter chips over its table (once it has a record).
  hasChips: boolean;
}

const agentList: (
  name: string,
  page: unknown,
  modelType: { new (): BaseModel },
  guideTitle: string,
) => FirstRunCase = (
  name: string,
  page: unknown,
  modelType: { new (): BaseModel },
  guideTitle: string,
): FirstRunCase => {
  return {
    name,
    page: page as PageComponent,
    modelType,
    watchQuery: {},
    guideTitle,
    isAddedByHand: false,
    isCreateable: true,
    hasChips: true,
  };
};

const FIRST_RUN_CASES: Array<FirstRunCase> = [
  // #5137: Hosts' first run is Add Host's one command (AddHostGuide).
  agentList("Hosts", HostsPage, Host, "Add your first host"),
  agentList(
    "Kubernetes Clusters",
    KubernetesClustersPage,
    KubernetesCluster,
    "Getting Started with Kubernetes Monitoring",
  ),
  agentList(
    "Docker Hosts",
    DockerHostsPage,
    DockerHost,
    "Getting Started with Docker Monitoring",
  ),
  agentList(
    "Podman Hosts",
    PodmanHostsPage,
    PodmanHost,
    "Getting Started with Podman Monitoring",
  ),
  agentList(
    "Docker Swarm Clusters",
    DockerSwarmClustersPage,
    DockerSwarmCluster,
    "Getting Started with Docker Swarm Monitoring",
  ),
  agentList(
    "Proxmox Clusters",
    ProxmoxClustersPage,
    ProxmoxCluster,
    "Getting Started with Proxmox Monitoring",
  ),
  {
    ...agentList(
      "vCenters",
      VCentersPage,
      VMwareVCenter,
      "Getting Started with VMware Monitoring",
    ),
    isAddedByHand: true,
  },
  agentList(
    "Ceph Clusters",
    CephClustersPage,
    CephCluster,
    "Getting Started with Ceph Monitoring",
  ),
  agentList(
    "Storage Arrays",
    StorageArraysPage,
    StorageArray,
    "Getting Started with Storage Array Monitoring",
  ),
  agentList(
    "IoT Fleets",
    IoTFleetsPage,
    IoTFleet,
    "Getting Started with IoT Monitoring",
  ),
  {
    ...agentList(
      "Databases",
      DatabasesPage,
      DatabaseServer,
      "Getting Started with Databases",
    ),
    isAddedByHand: true,
  },
  {
    ...agentList(
      "Queues",
      MessageQueuesPage,
      MessageQueue,
      "Getting Started with Queues",
    ),
    isAddedByHand: true,
  },
  agentList(
    "Serverless Functions",
    ServerlessFunctionsPage,
    ServerlessFunction,
    "Getting Started with Serverless Functions",
  ),
  {
    ...agentList(
      "Cloud Environments",
      CloudEnvironmentsPage,
      CloudResource,
      "Getting Started with Cloud Environments",
    ),
    watchQuery: { cloudResourceKind: CloudResourceKind.Environment },
  },
  {
    ...agentList(
      "Cloud Resources",
      CloudMonitoredResourcesPage,
      CloudResource,
      "Discover your cloud resources",
    ),
    watchQuery: { cloudResourceKind: CloudResourceKind.Resource },
    isCreateable: false,
  },
];

const COUNT_FAILURE: string = "The API is down.";

// The filter chips over a list's table (useResourceOwners' bar).
function chips(): HTMLElement | null {
  return screen.queryByTestId("facet-filter-bar");
}

// The project behind ModelAPI, as each test sets it up.
let currentCase: FirstRunCase | null = null;
let projectCount: number = 0;
let listedRows: Array<BaseModel> = [];
let watchChecks: number = 0;
let tableReads: number = 0;
// How many of the next watch counts fail.
let failingChecks: number = 0;

function isWatchQuery(options: {
  modelType: { new (): BaseModel };
  query?: unknown;
}): boolean {
  return Boolean(
    currentCase &&
      options.modelType === currentCase.modelType &&
      JSON.stringify(options.query || {}) ===
        JSON.stringify(currentCase.watchQuery),
  );
}

function rowOf(modelType: { new (): BaseModel }): BaseModel {
  const row: BaseModel = new modelType();
  const values: Record<string, unknown> = row as unknown as Record<
    string,
    unknown
  >;
  row._id = ROW_ID;
  for (const column of ["name", "title", "displayName"]) {
    if (row.hasColumn(column)) {
      values[column] = ROW_NAME;
    }
  }
  return row;
}

beforeEach(() => {
  currentCase = null;
  projectCount = 0;
  listedRows = [];
  watchChecks = 0;
  tableReads = 0;
  failingChecks = 0;
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  goTo(`/dashboard/${PROJECT_ID}/home`);

  jest
    .spyOn(ModelAPI, "count")
    .mockImplementation(
      async (options: {
        modelType: { new (): BaseModel };
        query?: unknown;
      }): Promise<number> => {
        if (isWatchQuery(options)) {
          watchChecks++;
          if (failingChecks > 0) {
            failingChecks--;
            throw new Error(COUNT_FAILURE);
          }
          return projectCount;
        }
        return 0;
      },
    );
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(
      async (options: {
        modelType: { new (): BaseModel };
        query?: unknown;
        select?: unknown;
        skip?: number;
        limit?: number;
      }): Promise<ListResult<BaseModel>> => {
        /*
         * Hosts' guide (AddHostGuide, #5137) waits for a host whose collector
         * registered since it opened, and every other list's Add guide
         * (Components/ResourceOnboarding) for one newer than the newest the
         * list had then - it reads each record's createdAt, which no table
         * selects - after looking up whether the name it starts with is
         * taken (a Search for the suggestion, a Wildcard for the exact
         * name). Their own checks, not the table's. Nothing registers here:
         * the first-record watch is what finds the first one.
         */
        const query: string = JSON.stringify(options.query || {});
        const select: Record<string, unknown> = (options.select ||
          {}) as Record<string, unknown>;
        if (
          query.includes("collectorRegisteredAt") ||
          query.includes('"createdAt"') ||
          query.includes('"_type":"Search"') ||
          query.includes('"_type":"Wildcard"') ||
          select["createdAt"]
        ) {
          return {
            data: [],
            count: 0,
            skip: options.skip || 0,
            limit: options.limit || 10,
          } as ListResult<BaseModel>;
        }
        const isTheList: boolean = Boolean(
          currentCase && options.modelType === currentCase.modelType,
        );
        if (isTheList) {
          tableReads++;
        }
        const data: Array<BaseModel> = isTheList ? listedRows : [];
        return {
          data,
          count: data.length,
          skip: options.skip || 0,
          limit: options.limit || 10,
        } as ListResult<BaseModel>;
      },
    );
  jest.spyOn(ModelAPI, "getItem").mockResolvedValue(null as never);
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

// Moves the clock on, and with it the page's watch, then lets it land.
async function advance(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await settle();
}

async function renderList(listCase: FirstRunCase): Promise<void> {
  currentCase = listCase;
  const Page: PageComponent = listCase.page;

  await act(async () => {
    render(
      <MemoryRouter>
        <Page {...PAGE_PROPS} />
      </MemoryRouter>,
    );
  });
  await settle();
}

function emptyTable(): HTMLElement | null {
  return document.querySelector('[data-empty-state-kind="empty"]');
}

// The card the list's table is drawn in: the first card on the page.
function tableCard(): HTMLElement {
  const card: HTMLElement | undefined = screen.getAllByTestId("card")[0];
  if (!card) {
    throw new Error("The page drew no card.");
  }
  return card;
}

/*
 * "Create Docker Host", or "Connect vCenter" or "Add Host" (#5137: one
 * command, not a form) where the list names its verb.
 */
const CREATE_BUTTON_TEXT: RegExp = /^(Create|Connect|Add) /;

function headerCreateButtons(): Array<HTMLElement> {
  const actions: HTMLElement | null = within(tableCard()).queryByTestId(
    "card-header-actions",
  );
  if (!actions) {
    return [];
  }
  return within(actions)
    .queryAllByRole("button")
    .filter((button: HTMLElement): boolean => {
      return CREATE_BUTTON_TEXT.test((button.textContent || "").trim());
    });
}

describe.each(FIRST_RUN_CASES)("$name, first run", (listCase: FirstRunCase) => {
  test("a new project: the empty table says what the list is, and the guide under it what to do", async () => {
    await renderList(listCase);

    const guideTitle: HTMLElement = await screen.findByText(
      listCase.guideTitle,
    );
    const guideDescription: HTMLElement = screen.getByText(
      FIRST_RUN_GUIDE_DESCRIPTION,
    );
    const table: HTMLElement | null = emptyTable();

    expect(table).not.toBeNull();
    // The table first, then the guide.
    expect(
      table!.compareDocumentPosition(guideTitle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      table!.compareDocumentPosition(guideDescription) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The guide does not say "No ... yet" a second time.
    expect(guideDescription.textContent || "").not.toMatch(/ yet\b/);
  });

  test(
    listCase.isCreateable
      ? listCase.isAddedByHand
        ? "Create in the card header, and again in the empty table: adding one by hand connects it"
        : "Create stays in the card header only: the guide is the way in"
      : "no Create anywhere: only discovery adds these",
    async () => {
      await renderList(listCase);
      await screen.findByText(listCase.guideTitle);

      expect(headerCreateButtons()).toHaveLength(listCase.isCreateable ? 1 : 0);
      expect(
        screen.queryByTestId(EMPTY_TABLE_CREATE_BUTTON_TEST_ID) !== null,
      ).toBe(listCase.isAddedByHand);

      if (listCase.isAddedByHand) {
        // The same button as the header's, by its words.
        expect(
          screen.getByTestId(EMPTY_TABLE_CREATE_BUTTON_TEST_ID),
        ).toHaveTextContent(
          (headerCreateButtons()[0]!.textContent || "").trim(),
        );
      }
    },
  );

  test("the first one arriving shows in the table and puts the guide away, without a reload", async () => {
    jest.useFakeTimers();
    await renderList(listCase);

    expect(screen.getByText(listCase.guideTitle)).toBeInTheDocument();
    expect(emptyTable()).not.toBeNull();
    expect(watchChecks).toBe(1);
    const readsBefore: number = tableReads;

    // A check that still finds none changes nothing.
    await advance(FIRST_RECORD_POLL_INTERVAL_MS);
    expect(watchChecks).toBe(2);
    expect(tableReads).toBe(readsBefore);
    expect(screen.getByText(listCase.guideTitle)).toBeInTheDocument();

    // The agent reports: the next check finds it.
    projectCount = 1;
    listedRows = [rowOf(listCase.modelType)];
    await advance(FIRST_RECORD_POLL_INTERVAL_MS);

    expect(watchChecks).toBe(3);
    expect(tableReads).toBeGreaterThan(readsBefore);
    expect(screen.queryByText(listCase.guideTitle)).toBeNull();
    expect(screen.queryByText(FIRST_RUN_GUIDE_DESCRIPTION)).toBeNull();
    expect(emptyTable()).toBeNull();
    expect(screen.getAllByText(ROW_NAME).length).toBeGreaterThan(0);

    // And the watch is over.
    await advance(3 * FIRST_RECORD_POLL_INTERVAL_MS);
    expect(watchChecks).toBe(3);
  });

  test(
    listCase.hasChips
      ? "no filter chips over a new project's empty table; they come with the first record"
      : "no filter chips, before or after the first record",
    async () => {
      jest.useFakeTimers();
      await renderList(listCase);

      expect(screen.getByText(listCase.guideTitle)).toBeInTheDocument();
      // Nothing to filter yet: the guide is the one thing to do.
      expect(chips()).toBeNull();

      projectCount = 1;
      listedRows = [rowOf(listCase.modelType)];
      await advance(FIRST_RECORD_POLL_INTERVAL_MS);

      expect(screen.queryByText(listCase.guideTitle)).toBeNull();
      expect(chips() !== null).toBe(listCase.hasChips);
    },
  );

  test("a failed first count says so, and its Refresh counts again", async () => {
    failingChecks = 1;
    await renderList(listCase);

    expect(screen.getByText(COUNT_FAILURE)).toBeInTheDocument();
    expect(screen.queryByText(listCase.guideTitle)).toBeNull();
    expect(watchChecks).toBe(1);

    await act(async () => {
      screen.getByTestId("refresh-button").click();
    });
    await settle();

    expect(watchChecks).toBe(2);
    expect(screen.queryByText(COUNT_FAILURE)).toBeNull();
    expect(await screen.findByText(listCase.guideTitle)).toBeInTheDocument();
    expect(emptyTable()).not.toBeNull();
  });

  test("a project that already has some: no guide, and nothing watched", async () => {
    jest.useFakeTimers();
    projectCount = 2;
    listedRows = [rowOf(listCase.modelType)];

    await renderList(listCase);

    expect(screen.queryByText(listCase.guideTitle)).toBeNull();
    expect(screen.queryByText(FIRST_RUN_GUIDE_DESCRIPTION)).toBeNull();
    expect(screen.queryByTestId(EMPTY_TABLE_CREATE_BUTTON_TEST_ID)).toBeNull();
    // Its chips are there from the start.
    expect(chips() !== null).toBe(listCase.hasChips);

    await advance(3 * FIRST_RECORD_POLL_INTERVAL_MS);
    expect(watchChecks).toBe(1);
  });
});

describe("each Cloud list's empty table names what it lists", () => {
  test.each([
    [
      "Cloud Environments",
      CloudEnvironmentsPage,
      { cloudResourceKind: CloudResourceKind.Environment },
      "No cloud environments yet",
    ],
    [
      "Cloud Resources",
      CloudMonitoredResourcesPage,
      { cloudResourceKind: CloudResourceKind.Resource },
      "No cloud resources discovered yet",
    ],
  ])(
    "%s",
    async (
      name: string,
      page: unknown,
      watchQuery: JSONObject,
      title: string,
    ) => {
      await renderList({
        ...agentList(name, page, CloudResource, ""),
        watchQuery,
      });

      const table: HTMLElement | null = emptyTable();

      expect(table).not.toBeNull();
      expect(within(table!).getByText(title)).toBeInTheDocument();
      // The model's own "No cloud resources yet" is never the title.
      expect(table!.textContent || "").not.toContain("No cloud resources yet");
    },
  );
});

describe("the first-run rules", () => {
  test("an empty list is watched; one with records, or not yet counted, is not", () => {
    expect(isWatchingForFirstRecord(0)).toBe(true);
    expect(isWatchingForFirstRecord(1)).toBe(false);
    expect(isWatchingForFirstRecord(12)).toBe(false);
    expect(isWatchingForFirstRecord(null)).toBe(false);
  });

  test("a check's answer: the first record wins; still none, or a failed check, keeps what is shown", () => {
    expect(getCountAfterCheck({ current: 0, checked: 1 })).toBe(1);
    expect(getCountAfterCheck({ current: 0, checked: 7 })).toBe(7);
    expect(getCountAfterCheck({ current: 0, checked: 0 })).toBe(0);
    expect(getCountAfterCheck({ current: 0, checked: null })).toBe(0);
    expect(getCountAfterCheck({ current: null, checked: null })).toBeNull();
  });

  test("an empty list's table does not repeat Create, unless adding one by hand connects it", () => {
    expect(getFirstRunEmptyState({ emptyState: undefined, count: 0 })).toEqual({
      hideCreateButton: true,
    });
    expect(
      getFirstRunEmptyState({
        emptyState: undefined,
        count: 0,
        isAddedByHand: true,
      }),
    ).toEqual({});
  });

  test("once there are records, the table's own empty state is left as it is (a search that finds nothing)", () => {
    const facetEmptyState: { isFiltered: boolean } = { isFiltered: true };

    expect(
      getFirstRunEmptyState({ emptyState: facetEmptyState, count: 3 }),
    ).toBe(facetEmptyState);
    expect(getFirstRunEmptyState({ emptyState: undefined, count: 3 })).toEqual(
      {},
    );
  });

  test("the page's own empty-state options are kept while Create is hidden", () => {
    const onClearFilters: () => void = (): void => {};

    expect(
      getFirstRunEmptyState({
        emptyState: { isFiltered: false, onClearFilters },
        count: 0,
      }),
    ).toEqual({ isFiltered: false, onClearFilters, hideCreateButton: true });
  });

  test("the guide's sentence says what to do and that the list fills in by itself, briefly", () => {
    expect(FIRST_RUN_GUIDE_DESCRIPTION).toBe(
      "Follow the steps below. This list fills in on its own once data arrives.",
    );
    expect(FIRST_RUN_GUIDE_DESCRIPTION.length).toBeLessThanOrEqual(150);
  });

  test("an empty list looks again every ten seconds", () => {
    expect(FIRST_RECORD_POLL_INTERVAL_MS).toBe(10 * 1000);
  });

  test("the chips are put away only while the list waits for its first record", () => {
    const bar: ReactElement = <div>chips</div>;

    expect(
      getFirstRunTopContent({ topContent: bar, count: 0 }),
    ).toBeUndefined();
    expect(getFirstRunTopContent({ topContent: bar, count: 1 })).toBe(bar);
    expect(getFirstRunTopContent({ topContent: bar, count: 40 })).toBe(bar);
    expect(getFirstRunTopContent({ topContent: bar, count: null })).toBe(bar);
  });
});

interface WatchProps {
  query?: JSONObject | undefined;
  onFirstRecord?: (() => void) | undefined;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {};
  let reject: (error: Error) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>(
    (res: (value: T) => void, rej: (error: Error) => void): void => {
      resolve = res;
      reject = rej;
    },
  );
  return { promise, resolve, reject };
}

describe("useFirstRecordWatch", () => {
  // Each count the hook asks, answered by the test.
  let answers: Array<Deferred<number>> = [];
  let asked: Array<{ modelType: unknown; query: unknown }> = [];

  beforeEach(() => {
    jest.useFakeTimers();
    answers = [];
    asked = [];
    jest
      .spyOn(ModelAPI, "count")
      .mockImplementation(
        (options: { modelType: unknown; query: unknown }): Promise<number> => {
          asked.push(options);
          const answer: Deferred<number> = deferred<number>();
          answers.push(answer);
          return answer.promise;
        },
      );
  });

  function watch(
    props: WatchProps = {},
  ): RenderHookResult<FirstRecordWatch, WatchProps> {
    return renderHook(
      (hookProps: WatchProps): FirstRecordWatch => {
        return useFirstRecordWatch<Host>({
          modelType: Host,
          query: hookProps.query,
          onFirstRecord: hookProps.onFirstRecord,
        });
      },
      { initialProps: props },
    );
  }

  async function answer(index: number, value: number | Error): Promise<void> {
    await act(async () => {
      if (value instanceof Error) {
        answers[index]!.reject(value);
      } else {
        answers[index]!.resolve(value);
      }
    });
    await settle();
  }

  test("counts once, with the list's model and query, and is loading until the count lands", async () => {
    const { result } = watch({ query: { isArchived: false } });

    expect(asked).toEqual([{ modelType: Host, query: { isArchived: false } }]);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.count).toBeNull();
    expect(result.current.error).toBe("");

    await answer(0, 4);

    expect(result.current.isLoading).toBe(false);
    expect(result.current.count).toBe(4);
    expect(result.current.refreshToken).toBe("first-record-0");
  });

  test("a list that has records is not watched", async () => {
    watch();
    await answer(0, 3);

    await advance(5 * FIRST_RECORD_POLL_INTERVAL_MS);

    expect(asked).toHaveLength(1);
  });

  test("an empty list is checked every interval, quietly, while nothing arrives", async () => {
    const onFirstRecord: MockFunction = getJestMockFunction();
    const { result } = watch({ onFirstRecord });
    await answer(0, 0);

    await advance(FIRST_RECORD_POLL_INTERVAL_MS - 1);
    expect(asked).toHaveLength(1);

    await advance(1);
    expect(asked).toHaveLength(2);
    expect(asked[1]).toEqual({ modelType: Host, query: {} });
    await answer(1, 0);

    expect(result.current.count).toBe(0);
    expect(result.current.refreshToken).toBe("first-record-0");
    expect(onFirstRecord).not.toHaveBeenCalled();

    await advance(FIRST_RECORD_POLL_INTERVAL_MS);
    expect(asked).toHaveLength(3);
  });

  test("the first record: the count, a new token for the table, onFirstRecord once, and the watch ends", async () => {
    const onFirstRecord: MockFunction = getJestMockFunction();
    const { result } = watch({ onFirstRecord });
    await answer(0, 0);

    await advance(FIRST_RECORD_POLL_INTERVAL_MS);
    await answer(1, 2);

    expect(result.current.count).toBe(2);
    expect(result.current.refreshToken).toBe("first-record-1");
    expect(result.current.isLoading).toBe(false);
    expect(onFirstRecord).toHaveBeenCalledTimes(1);

    await advance(4 * FIRST_RECORD_POLL_INTERVAL_MS);
    expect(asked).toHaveLength(2);
    expect(onFirstRecord).toHaveBeenCalledTimes(1);
  });

  test("a failed check keeps the guide, says nothing, and keeps watching", async () => {
    const { result } = watch();
    await answer(0, 0);

    await advance(FIRST_RECORD_POLL_INTERVAL_MS);
    await answer(1, new Error("The API is down."));

    expect(result.current.count).toBe(0);
    expect(result.current.error).toBe("");
    expect(result.current.refreshToken).toBe("first-record-0");

    await advance(FIRST_RECORD_POLL_INTERVAL_MS);
    await answer(2, 1);

    expect(result.current.count).toBe(1);
    expect(result.current.refreshToken).toBe("first-record-1");
  });

  test("a failed first count is the page's error, and nothing is watched", async () => {
    const { result } = watch();
    await answer(0, new Error("The API is down."));

    expect(result.current.error).toBe("The API is down.");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.count).toBeNull();

    await advance(3 * FIRST_RECORD_POLL_INTERVAL_MS);
    expect(asked).toHaveLength(1);
  });

  test("retry after a failed first count: the error goes, it loads, counts anew with the same query, and watches", async () => {
    const { result } = watch({ query: { isArchived: false } });
    await answer(0, new Error("The API is down."));

    act(() => {
      result.current.retry();
    });
    await settle();

    expect(result.current.error).toBe("");
    expect(result.current.isLoading).toBe(true);
    expect(asked).toHaveLength(2);
    expect(asked[1]).toEqual({ modelType: Host, query: { isArchived: false } });

    await answer(1, 0);

    expect(result.current.isLoading).toBe(false);
    expect(result.current.count).toBe(0);

    // An empty list: the watch starts as after any first count.
    await advance(FIRST_RECORD_POLL_INTERVAL_MS);
    expect(asked).toHaveLength(3);
  });

  test("a retry that fails again is the page's error again", async () => {
    const { result } = watch();
    await answer(0, new Error("The API is down."));

    act(() => {
      result.current.retry();
    });
    await settle();
    await answer(1, new Error("Still down."));

    expect(result.current.error).toBe("Still down.");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.count).toBeNull();
  });

  test("one created by hand puts the guide away at once and ends the watch; the table reads it itself", async () => {
    const onFirstRecord: MockFunction = getJestMockFunction();
    const { result } = watch({ onFirstRecord });
    await answer(0, 0);

    act(() => {
      result.current.onRecordCreated();
    });

    expect(result.current.count).toBe(1);
    // The table refreshes after its own create: no second read asked for.
    expect(result.current.refreshToken).toBe("first-record-0");
    expect(onFirstRecord).not.toHaveBeenCalled();

    await advance(3 * FIRST_RECORD_POLL_INTERVAL_MS);
    expect(asked).toHaveLength(1);
  });

  test("a check still out when one is created by hand is ignored when it lands", async () => {
    const onFirstRecord: MockFunction = getJestMockFunction();
    const { result } = watch({ onFirstRecord });
    await answer(0, 0);

    await advance(FIRST_RECORD_POLL_INTERVAL_MS);
    expect(asked).toHaveLength(2);

    act(() => {
      result.current.onRecordCreated();
    });
    await answer(1, 5);

    expect(result.current.count).toBe(1);
    expect(result.current.refreshToken).toBe("first-record-0");
    expect(onFirstRecord).not.toHaveBeenCalled();
  });

  test("leaving the page ends the watch", async () => {
    const onFirstRecord: MockFunction = getJestMockFunction();
    const { unmount } = watch({ onFirstRecord });
    await answer(0, 0);

    await advance(FIRST_RECORD_POLL_INTERVAL_MS);
    expect(asked).toHaveLength(2);

    unmount();
    await answer(1, 1);
    await advance(3 * FIRST_RECORD_POLL_INTERVAL_MS);

    expect(asked).toHaveLength(2);
    expect(onFirstRecord).not.toHaveBeenCalled();
  });

  test("each check asks the page's latest query, without restarting the watch", async () => {
    const { rerender } = watch({ query: { isArchived: false } });
    await answer(0, 0);

    await advance(FIRST_RECORD_POLL_INTERVAL_MS / 2);
    rerender({ query: { isArchived: true } });

    // Still on the first interval's clock.
    await advance(FIRST_RECORD_POLL_INTERVAL_MS / 2);
    expect(asked).toHaveLength(2);
    expect(asked[1]).toEqual({ modelType: Host, query: { isArchived: true } });
  });

  test("the latest onFirstRecord is the one told", async () => {
    const first: MockFunction = getJestMockFunction();
    const latest: MockFunction = getJestMockFunction();
    const { rerender } = watch({ onFirstRecord: first });
    await answer(0, 0);

    rerender({ onFirstRecord: latest });
    await advance(FIRST_RECORD_POLL_INTERVAL_MS);
    await answer(1, 1);

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });
});
