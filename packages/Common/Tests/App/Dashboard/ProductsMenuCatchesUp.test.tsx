import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import ResourceConnectionWatch from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOnboarding/ResourceConnectionWatch";
import { RESOURCE_CONNECTION_POLL_INTERVAL_MS } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOnboarding/ResourceOnboarding";
import {
  PRODUCTS_SET_UP_BY_TYPE,
  getProductsSetUpByGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetryGuideProducts";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import ProjectProducts, {
  CREATE_SETTLE_MS,
  DELETE_SETTLE_MS,
  EXPECT_CHANGE_EVERY_MS,
  EXPECT_CHANGE_FOR_MS,
  REFRESH_AFTER_MS,
  REMEMBERED_PROJECT_PRODUCTS_KEY_PREFIX,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProjectProductsStore";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Service from "../../../Models/DatabaseModels/Service";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import ActivationMilestone, {
  ACTIVATION_MILESTONE_OF_TELEMETRY_KIND,
  ActivationTelemetryKind,
} from "../../../Types/Analytics/ActivationMilestone";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import ProductKey from "../../../Types/Product/ProductKey";
import {
  PRODUCT_USAGE_MILESTONES,
  ProductUsage,
} from "../../../Types/Product/ProductUsage";
import {
  ProjectProductsAnswer,
  getEmptyProjectProductsAnswer,
  toProjectProductsAnswerJSON,
} from "../../../Types/Product/ProjectProductsAnswer";
import DashboardAPI from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import RecordChanges, {
  RecordChangeKind,
} from "../../../UI/Utils/ModelAPI/RecordChanges";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * THE PRODUCTS MENU CATCHES UP AT ONCE (#8204).
 *
 * #7465 made the products menu follow what a project uses: a product's
 * first record made on the page marks it in use at once, and anything else
 * shows on the next look at the products once the answer is fifteen
 * seconds old. Three cases still waited for that next look:
 *
 *   1. a setup guide's first data - sent by an agent, not the page: the
 *      guide said "The first data arrived" while the menu beside it still
 *      said "Logs - Not set up". The server keeps the first logs a few
 *      seconds after the guide sees them sent (the telemetry writer stores
 *      a batch within maxWaitMs), so asking once at that moment is too
 *      early: the store asks until the guide's products are in use;
 *   2. a delete on the page: the project's last monitor deleted, the menu
 *      kept saying Monitors was in use. ModelAPI announces deletes now, and
 *      the store asks again once every server knows of it;
 *   3. another tab of the same browser: a monitor made in one showed in
 *      the other only on its next look. A tab takes the answer another tab
 *      remembered from the storage event, asking nothing.
 *
 * Here, end to end at the store - the real store, its timers and the
 * browser's storage, with the server answered by the test - and the
 * negative controls: nothing changed asks nothing, the store keeps no
 * timer while it awaits nothing, and a deleted last record turns the
 * product back to "Not set up". The server's side (usage read again after
 * a delete, a first record and a first-data milestone, on every server
 * within a second) is ProjectUsageCache.test.ts,
 * ProductRecordWritesForgetUsage.test.ts and
 * ProductsMenuCatchUpServer.test.ts.
 */

const PROJECT_A: string = "a1000000-0000-4000-8000-00000000a001";
const PROJECT_B: string = "b2000000-0000-4000-8000-00000000b002";
const MONITOR_ID: string = "c3000000-0000-4000-8000-00000000c003";
const KEY_ID: string = "d4000000-0000-4000-8000-00000000d004";
const SERVICE_ID: string = "e5000000-0000-4000-8000-00000000e005";
const CLUSTER_ID: string = "f6000000-0000-4000-8000-00000000f006";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const NOT_SET_UP: ProjectProductsAnswer = {
  ...getEmptyProjectProductsAnswer(),
  usage: {
    [ProductKey.Monitors]: ProductUsage.NotSetUp,
    [ProductKey.OnCall]: ProductUsage.NotSetUp,
    [ProductKey.Logs]: ProductUsage.NotSetUp,
    [ProductKey.Traces]: ProductUsage.NotSetUp,
    [ProductKey.Topology]: ProductUsage.NotSetUp,
    [ProductKey.Metrics]: ProductUsage.NotSetUp,
    [ProductKey.Services]: ProductUsage.NotSetUp,
    [ProductKey.Kubernetes]: ProductUsage.NotSetUp,
  },
};

const withInUse: (
  answer: ProjectProductsAnswer,
  ...products: Array<ProductKey>
) => ProjectProductsAnswer = (
  answer: ProjectProductsAnswer,
  ...products: Array<ProductKey>
): ProjectProductsAnswer => {
  const usage: ProjectProductsAnswer["usage"] = { ...answer.usage };

  for (const product of products) {
    usage[product] = ProductUsage.InUse;
  }

  return { ...answer, usage: usage };
};

// What the server answers each project, as the test sets it.
const serverAnswers: Map<string, ProjectProductsAnswer> = new Map<
  string,
  ProjectProductsAnswer
>();
// Every ask, by project, with the clock when it was made.
let asks: Array<{ projectId: string; at: number }>;
let failingAsks: number;

const START: number = Date.UTC(2026, 10, 15, 21, 30, 0);

function asksOf(projectId: string = PROJECT_A): number {
  return asks.filter((ask: { projectId: string }): boolean => {
    return ask.projectId === projectId;
  }).length;
}

function serverSays(
  answer: ProjectProductsAnswer,
  projectId: string = PROJECT_A,
): void {
  serverAnswers.set(projectId, answer);
}

function usageOf(
  product: ProductKey,
  projectId: string = PROJECT_A,
): ProductUsage | undefined {
  return ProjectProducts.getState(projectId).answer.usage[product];
}

function remembered(
  projectId: string = PROJECT_A,
): ProjectProductsAnswer["usage"] | null {
  const stored: string | null = window.localStorage.getItem(
    `${REMEMBERED_PROJECT_PRODUCTS_KEY_PREFIX}${projectId}`,
  );

  return stored ? JSON.parse(stored).usage : null;
}

async function flush(): Promise<void> {
  for (let tick: number = 0; tick < 10; tick++) {
    await Promise.resolve();
  }
}

/*
 * Moves the clock on, a little at a time, so an answer that lands can set
 * the store's next ask before the clock passes it.
 */
async function pass(ms: number): Promise<void> {
  const step: number = 50;

  for (let passed: number = 0; passed < ms; passed += step) {
    jest.advanceTimersByTime(Math.min(step, ms - passed));
    await flush();
  }
}

// The navbar drawn: the project's first ask, answered.
async function drawn(projectId: string = PROJECT_A): Promise<void> {
  await ProjectProducts.load(projectId);
  await flush();
}

// What ModelAPI tells the page once the server confirms a change.
function created(
  tableName: string,
  projectId: string | null = PROJECT_A,
): void {
  RecordChanges.announce({
    kind: RecordChangeKind.Created,
    tableName: tableName,
    projectId: projectId,
  });
}

function deleted(
  tableName: string,
  projectId: string | null = PROJECT_A,
): void {
  RecordChanges.announce({
    kind: RecordChangeKind.Deleted,
    tableName: tableName,
    projectId: projectId,
  });
}

/*
 * localStorage's methods, to spy on: Storage's own type answers any key,
 * which leaves jest nothing to infer a method from.
 */
function storagePrototype(): { setItem: Storage["setItem"] } {
  return Storage.prototype as unknown as { setItem: Storage["setItem"] };
}

/*
 * The browser telling this tab that another tab of the address wrote an
 * answer: the storage event, which never reaches the tab that wrote.
 */
function anotherTabRemembers(
  answer: ProjectProductsAnswer,
  projectId: string = PROJECT_A,
): void {
  const key: string = `${REMEMBERED_PROJECT_PRODUCTS_KEY_PREFIX}${projectId}`;
  const newValue: string = JSON.stringify(toProjectProductsAnswerJSON(answer));
  window.localStorage.setItem(key, newValue);
  window.dispatchEvent(
    new StorageEvent("storage", { key: key, newValue: newValue }),
  );
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: {
        translation: JSON.parse(
          fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
        ) as Record<string, string>,
      },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  jest.useFakeTimers({ now: START });
  window.localStorage.clear();
  ProjectProducts.reset();
  serverAnswers.clear();
  serverSays(NOT_SET_UP, PROJECT_A);
  serverSays(NOT_SET_UP, PROJECT_B);
  asks = [];
  failingAsks = 0;
  ProjectProducts.setFetcher(
    async (projectId: ObjectID): Promise<ProjectProductsAnswer | null> => {
      asks.push({ projectId: projectId.toString(), at: Date.now() });

      if (failingAsks > 0) {
        failingAsks--;
        throw new Error("offline");
      }

      return serverAnswers.get(projectId.toString()) || null;
    },
  );
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_A));
});

afterEach(() => {
  cleanup();
  ProjectProducts.setFetcher(null);
  ProjectProducts.reset();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("2. a delete on the page", () => {
  beforeEach(async () => {
    serverSays(withInUse(NOT_SET_UP, ProductKey.Monitors));
    await drawn();
    expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.InUse);
    expect(asksOf()).toBe(1);
  });

  test("the project's last monitor deleted: Monitors says Not set up again DELETE_SETTLE_MS later, with no look at the products", async () => {
    serverSays(NOT_SET_UP);
    deleted("Monitor");

    // Only the server can say whether it was the last: nothing guessed.
    expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.InUse);

    await pass(DELETE_SETTLE_MS - 100);
    expect(asksOf()).toBe(1);

    await pass(100);
    expect(asksOf()).toBe(2);
    expect(asks[1]!.at).toBe(START + DELETE_SETTLE_MS);
    expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.NotSetUp);

    // The next page load's first paint, and every other tab, have it too.
    expect(remembered()?.[ProductKey.Monitors]).toBe(ProductUsage.NotSetUp);
  });

  test("everyone drawing the products hears it", async () => {
    const listener: Mock = jest.fn();
    const stop: () => void = ProjectProducts.subscribe(
      listener as unknown as () => void,
    );

    serverSays(NOT_SET_UP);
    deleted("Monitor");
    await pass(DELETE_SETTLE_MS);
    stop();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("not the last monitor: it stays in use, at one ask, and nothing more is asked after it", async () => {
    deleted("Monitor");
    await pass(DELETE_SETTLE_MS);

    expect(asksOf()).toBe(2);
    expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.InUse);

    // The answer stands again: a minute of looks asks once more, at most.
    for (let look: number = 0; look < 12; look++) {
      await ProjectProducts.load(PROJECT_A);
      await pass(1_000);
    }
    expect(asksOf()).toBe(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("a bulk delete is one ask, after the last delete", async () => {
    serverSays(NOT_SET_UP);

    for (let row: number = 0; row < 20; row++) {
      deleted("Monitor");
      await pass(200);
    }

    // The last delete was at 3.8 seconds; nothing was asked meanwhile.
    expect(asksOf()).toBe(1);

    await pass(DELETE_SETTLE_MS);
    expect(asksOf()).toBe(2);
    expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.NotSetUp);
  });

  test("the menu opened before every server knows: it asks, and the store still asks once they do", async () => {
    deleted("Monitor");
    await pass(300);

    // Another server still goes by what it kept: Monitors in use.
    await ProjectProducts.load(PROJECT_A);
    await flush();
    expect(asksOf()).toBe(2);
    expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.InUse);

    // That answer is not kept as current: another look asks again.
    await ProjectProducts.load(PROJECT_A);
    await flush();
    expect(asksOf()).toBe(3);

    serverSays(NOT_SET_UP);
    await pass(DELETE_SETTLE_MS);
    expect(asksOf()).toBe(4);
    expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.NotSetUp);

    // Settled: the answer stands for REFRESH_AFTER_MS.
    await ProjectProducts.load(PROJECT_A);
    await flush();
    expect(asksOf()).toBe(4);
  });

  test("a monitor made and deleted again on this page keeps no mark", async () => {
    serverSays(NOT_SET_UP);
    ProjectProducts.reset();
    await drawn();

    created("Monitor");
    expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.InUse);

    deleted("Monitor");
    await pass(DELETE_SETTLE_MS);

    // Within CREATE_SETTLE_MS of the create, but the create is undone.
    expect(DELETE_SETTLE_MS).toBeLessThan(CREATE_SETTLE_MS);
    expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.NotSetUp);
  });

  test("a follow-up that fails keeps what was known, and the next look asks", async () => {
    failingAsks = 1;
    deleted("Monitor");
    await pass(DELETE_SETTLE_MS);

    expect(asksOf()).toBe(2);
    expect(ProjectProducts.getState(PROJECT_A).error).toBe("offline");
    expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.InUse);
    expect(jest.getTimerCount()).toBe(0);

    serverSays(NOT_SET_UP);
    await ProjectProducts.load(PROJECT_A);
    await flush();
    expect(asksOf()).toBe(3);
    expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.NotSetUp);
  });

  test("a delete that names no project is the open project's", async () => {
    serverSays(NOT_SET_UP);
    deleted("Monitor", null);
    await pass(DELETE_SETTLE_MS);

    expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.NotSetUp);
  });

  test("forgotten on reset: a pending ask is not made", async () => {
    deleted("Monitor");
    ProjectProducts.reset();
    await pass(DELETE_SETTLE_MS * 2);

    expect(asksOf()).toBe(1);
  });

  test("end to end: ModelAPI.deleteItem confirmed by the server takes Monitors back to Not set up", async () => {
    (
      jest.spyOn(DashboardAPI, "fetch") as unknown as SpyInstance<
        typeof DashboardAPI.fetch
      >
    ).mockResolvedValue(new HTTPResponse(200, {}, {}) as never);

    serverSays(NOT_SET_UP);
    await ModelAPI.deleteItem<Monitor>({
      modelType: Monitor,
      id: new ObjectID(MONITOR_ID),
    });
    await pass(DELETE_SETTLE_MS);

    expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.NotSetUp);
  });

  test("a delete the server refused asks nothing", async () => {
    (
      jest.spyOn(DashboardAPI, "fetch") as unknown as SpyInstance<
        typeof DashboardAPI.fetch
      >
    ).mockResolvedValue(
      new HTTPErrorResponse(403, { message: "Not allowed" }, {}) as never,
    );

    await expect(
      ModelAPI.deleteItem<Monitor>({
        modelType: Monitor,
        id: new ObjectID(MONITOR_ID),
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
    await pass(DELETE_SETTLE_MS * 2);

    expect(asksOf()).toBe(1);
  });
});

describe("2. deletes that change nothing ask nothing", () => {
  test("a product not set up, or one this person may not read", async () => {
    serverSays({
      ...NOT_SET_UP,
      usage: { [ProductKey.Monitors]: ProductUsage.NotSetUp },
    });
    await drawn();

    deleted("Monitor");
    deleted("OnCallDutyPolicy");
    await pass(DELETE_SETTLE_MS * 2);

    expect(asksOf()).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("a record of no product: a label, a note", async () => {
    serverSays(withInUse(NOT_SET_UP, ProductKey.Monitors));
    await drawn();

    deleted("Label");
    deleted("IncidentInternalNote");
    deleted("");
    await pass(DELETE_SETTLE_MS * 2);

    expect(asksOf()).toBe(1);
  });

  test("a project nothing has drawn yet: its first ask reads it", async () => {
    deleted("Monitor", PROJECT_B);
    await pass(DELETE_SETTLE_MS * 2);

    expect(asks).toEqual([]);
  });

  test("another project's delete asks for that project alone", async () => {
    serverSays(withInUse(NOT_SET_UP, ProductKey.Monitors), PROJECT_A);
    serverSays(withInUse(NOT_SET_UP, ProductKey.Monitors), PROJECT_B);
    await drawn(PROJECT_A);
    await drawn(PROJECT_B);

    serverSays(NOT_SET_UP, PROJECT_B);
    deleted("Monitor", PROJECT_B);
    await pass(DELETE_SETTLE_MS);

    expect(asksOf(PROJECT_A)).toBe(1);
    expect(asksOf(PROJECT_B)).toBe(2);
    expect(usageOf(ProductKey.Monitors, PROJECT_A)).toBe(ProductUsage.InUse);
    expect(usageOf(ProductKey.Monitors, PROJECT_B)).toBe(ProductUsage.NotSetUp);
  });
});

describe("1. a setup guide's products, about to be in use", () => {
  beforeEach(async () => {
    await drawn();
    expect(asksOf()).toBe(1);
  });

  test("asks at once, then every EXPECT_CHANGE_EVERY_MS until Logs is in use - and nothing after", async () => {
    ProjectProducts.expectProductsInUse({ products: [ProductKey.Logs] });
    await flush();
    expect(asksOf()).toBe(2);

    // The telemetry writer stores the first batch five seconds later.
    await pass(EXPECT_CHANGE_EVERY_MS);
    expect(asksOf()).toBe(3);
    expect(usageOf(ProductKey.Logs)).toBe(ProductUsage.NotSetUp);

    serverSays(withInUse(NOT_SET_UP, ProductKey.Logs));
    await pass(EXPECT_CHANGE_EVERY_MS);
    expect(asksOf()).toBe(4);
    expect(usageOf(ProductKey.Logs)).toBe(ProductUsage.InUse);
    expect(remembered()?.[ProductKey.Logs]).toBe(ProductUsage.InUse);

    // Done: the store waits for nothing, and a minute asks nothing more.
    expect(jest.getTimerCount()).toBe(0);
    await pass(60_000);
    expect(asksOf()).toBe(4);

    expect(
      asks.slice(1).map((ask: { at: number }): number => {
        return ask.at - START;
      }),
    ).toEqual([0, EXPECT_CHANGE_EVERY_MS, EXPECT_CHANGE_EVERY_MS * 2]);
  });

  test("data that never turns up stops being asked for after EXPECT_CHANGE_FOR_MS", async () => {
    ProjectProducts.expectProductsInUse({ products: [ProductKey.Logs] });
    await pass(EXPECT_CHANGE_FOR_MS + 60_000);

    const expected: number =
      1 + Math.ceil(EXPECT_CHANGE_FOR_MS / EXPECT_CHANGE_EVERY_MS);
    expect(asksOf()).toBe(1 + expected);
    expect(asks[asks.length - 1]!.at - START).toBe(EXPECT_CHANGE_FOR_MS);
    expect(jest.getTimerCount()).toBe(0);
    expect(usageOf(ProductKey.Logs)).toBe(ProductUsage.NotSetUp);
  });

  test("looks at the products while the store waits add no request of their own", async () => {
    ProjectProducts.expectProductsInUse({ products: [ProductKey.Logs] });
    await flush();

    for (let look: number = 0; look < 10; look++) {
      await ProjectProducts.load(PROJECT_A);
      await pass(EXPECT_CHANGE_EVERY_MS / 5);
    }

    // Five seconds: the ask at once, and the two the wait makes.
    expect(asksOf()).toBe(1 + 3);
  });

  test("a guide of several products waits for each: Traces and Topology", async () => {
    ProjectProducts.expectProductsInUse({
      products: [ProductKey.Traces, ProductKey.Topology],
    });
    await flush();

    serverSays(withInUse(NOT_SET_UP, ProductKey.Traces));
    await pass(EXPECT_CHANGE_EVERY_MS);
    expect(jest.getTimerCount()).toBe(1);

    serverSays(withInUse(NOT_SET_UP, ProductKey.Traces, ProductKey.Topology));
    await pass(EXPECT_CHANGE_EVERY_MS);
    const asked: number = asksOf();
    await pass(EXPECT_CHANGE_FOR_MS);

    expect(asksOf()).toBe(asked);
    expect(usageOf(ProductKey.Topology)).toBe(ProductUsage.InUse);
  });

  test("a second guide's data while the first waits: one wait, for both, from the latest", async () => {
    ProjectProducts.expectProductsInUse({ products: [ProductKey.Logs] });
    await pass(EXPECT_CHANGE_FOR_MS - 1_000);
    ProjectProducts.expectProductsInUse({ products: [ProductKey.Metrics] });
    await flush();

    serverSays(withInUse(NOT_SET_UP, ProductKey.Metrics));
    await pass(EXPECT_CHANGE_EVERY_MS * 2);
    // Logs is still awaited: the wait goes on past the first one's end.
    expect(jest.getTimerCount()).toBe(1);

    serverSays(withInUse(NOT_SET_UP, ProductKey.Metrics, ProductKey.Logs));
    await pass(EXPECT_CHANGE_EVERY_MS);
    expect(usageOf(ProductKey.Logs)).toBe(ProductUsage.InUse);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("a request already out stands for the first ask", async () => {
    let release: () => void = (): void => {};
    ProjectProducts.setFetcher(
      (projectId: ObjectID): Promise<ProjectProductsAnswer | null> => {
        asks.push({ projectId: projectId.toString(), at: Date.now() });
        return new Promise(
          (resolve: (value: ProjectProductsAnswer | null) => void) => {
            release = (): void => {
              resolve(NOT_SET_UP);
            };
          },
        );
      },
    );

    const refreshing: Promise<void> = ProjectProducts.refresh(PROJECT_A);
    ProjectProducts.expectProductsInUse({ products: [ProductKey.Logs] });
    expect(asksOf()).toBe(2);

    release();
    await refreshing;
    await flush();
    expect(jest.getTimerCount()).toBe(1);
  });

  test("asks that fail go on until the wait is over", async () => {
    failingAsks = 2;
    ProjectProducts.expectProductsInUse({ products: [ProductKey.Logs] });
    await flush();
    await pass(EXPECT_CHANGE_EVERY_MS);

    serverSays(withInUse(NOT_SET_UP, ProductKey.Logs));
    await pass(EXPECT_CHANGE_EVERY_MS);

    expect(asksOf()).toBe(4);
    expect(usageOf(ProductKey.Logs)).toBe(ProductUsage.InUse);
  });

  test("products in use already, ones this person may not read, or none: nothing is asked", async () => {
    serverSays({
      ...withInUse(NOT_SET_UP, ProductKey.Logs),
      usage: { [ProductKey.Logs]: ProductUsage.InUse },
    });
    await ProjectProducts.refresh(PROJECT_A);
    const asked: number = asksOf();

    ProjectProducts.expectProductsInUse({ products: [ProductKey.Logs] });
    ProjectProducts.expectProductsInUse({ products: [ProductKey.Metrics] });
    ProjectProducts.expectProductsInUse({ products: [] });
    await pass(EXPECT_CHANGE_FOR_MS);

    expect(asksOf()).toBe(asked);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("a project nothing has drawn yet asks nothing: its first ask reads it", async () => {
    ProjectProducts.expectProductsInUse({
      projectId: PROJECT_B,
      products: [ProductKey.Logs],
    });
    await pass(EXPECT_CHANGE_FOR_MS);

    expect(asksOf(PROJECT_B)).toBe(0);
  });

  test("forgotten on reset", async () => {
    ProjectProducts.expectProductsInUse({ products: [ProductKey.Logs] });
    await flush();
    ProjectProducts.reset();
    await pass(EXPECT_CHANGE_FOR_MS);

    expect(asksOf()).toBe(2);
  });

  test("a record the guide saw arrive marks its product in use at once, asking nothing", async () => {
    ProjectProducts.noteRecordFound({
      tableName: "KubernetesCluster",
      projectId: null,
    });

    expect(usageOf(ProductKey.Kubernetes)).toBe(ProductUsage.InUse);
    expect(asksOf()).toBe(1);

    // Another server may not have seen it yet: the mark holds.
    await ProjectProducts.load(PROJECT_A);
    await flush();
    expect(asksOf()).toBe(2);
    expect(usageOf(ProductKey.Kubernetes)).toBe(ProductUsage.InUse);
  });
});

describe("1. end to end: the setup guide's last step and the products menu", () => {
  type Row = Record<string, unknown>;
  let services: Array<Row>;
  let clusters: Array<Row>;
  let key: Row;

  async function settle(): Promise<void> {
    for (let tick: number = 0; tick < 20; tick++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  async function advance(ms: number): Promise<void> {
    const step: number = 250;

    for (let passed: number = 0; passed < ms; passed += step) {
      await act(async () => {
        jest.advanceTimersByTime(Math.min(step, ms - passed));
      });
      await settle();
    }
  }

  beforeEach(async () => {
    services = [];
    clusters = [];
    key = { _id: KEY_ID, name: "Production", lastUsedAt: null };

    jest.spyOn(ModelAPI, "getList").mockImplementation(((data: {
      modelType: { new (): BaseModel };
    }): Promise<ListResult<BaseModel>> => {
      let rows: Array<Row> = [];

      if (data.modelType === TelemetryIngestionKey) {
        rows = [key];
      } else if (data.modelType === Service) {
        rows = services;
      } else if (data.modelType === KubernetesCluster) {
        rows = clusters;
      }

      const models: Array<BaseModel> = rows.map((row: Row): BaseModel => {
        return Object.assign(new data.modelType(), row);
      });

      return Promise.resolve({
        data: models,
        count: models.length,
        skip: 0,
        limit: 10,
      } as ListResult<BaseModel>);
    }) as never);

    await drawn();
  });

  async function showWatch(element: ReactElement): Promise<void> {
    await act(async () => {
      render(<MemoryRouter>{element}</MemoryRouter>);
    });
    await settle();
  }

  test("FluentBit's first logs: the guide says the data arrived, and Logs is in use within moments, not fifteen seconds", async () => {
    await showWatch(
      <ResourceConnectionWatch
        modelType={Service}
        viewPage={PageMap.SERVICE_VIEW_LOGS}
        viewText="View logs"
        dataPage={PageMap.LOGS}
        ingestionKey={Object.assign(new TelemetryIngestionKey(), key)}
        products={getProductsSetUpByGuide({ telemetryType: "logs" })}
      />,
    );
    const asksBefore: number = asksOf();

    // The shipper's first batch: the key is stamped at once.
    key["lastUsedAt"] = new Date();
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    expect(
      screen.getByTestId("resource-connection-data-arrived"),
    ).toBeInTheDocument();
    expect(usageOf(ProductKey.Logs)).toBe(ProductUsage.NotSetUp);
    expect(asksOf()).toBe(asksBefore + 1);

    // The telemetry writer stores it, and keeps the milestone, 5 s later.
    await advance(5_000);
    serverSays(withInUse(NOT_SET_UP, ProductKey.Logs));
    await advance(EXPECT_CHANGE_EVERY_MS);

    expect(usageOf(ProductKey.Logs)).toBe(ProductUsage.InUse);

    // Done: the menu waits for nothing more.
    const asked: number = asksOf();
    await advance(30_000);
    expect(asksOf()).toBe(asked);
  });

  test("a service that sent its first traces: Services in use at once, and Traces once the server keeps them", async () => {
    await showWatch(
      <ResourceConnectionWatch
        modelType={Service}
        viewPage={PageMap.SERVICE_VIEW_TRACES}
        viewText="View traces"
        products={getProductsSetUpByGuide({ telemetryType: "traces" })}
      />,
    );
    const asksBefore: number = asksOf();

    services.push({
      _id: SERVICE_ID,
      name: "checkout-api",
      createdAt: new Date(),
      lastSeenAt: new Date(),
    });
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    expect(
      screen.getByTestId("resource-connection-connected"),
    ).toBeInTheDocument();
    expect(usageOf(ProductKey.Services)).toBe(ProductUsage.InUse);
    expect(asksOf()).toBe(asksBefore + 1);

    serverSays(
      withInUse(
        NOT_SET_UP,
        ProductKey.Services,
        ProductKey.Traces,
        ProductKey.Topology,
      ),
    );
    await advance(EXPECT_CHANGE_EVERY_MS);

    expect(usageOf(ProductKey.Traces)).toBe(ProductUsage.InUse);
    expect(usageOf(ProductKey.Topology)).toBe(ProductUsage.InUse);
  });

  test("an agent's first cluster: Kubernetes in use at once, and no wait for products the guide did not name", async () => {
    await showWatch(
      <ResourceConnectionWatch
        modelType={KubernetesCluster}
        nameField="clusterIdentifier"
        viewPage={PageMap.KUBERNETES_CLUSTER_VIEW}
        viewText="View cluster"
      />,
    );
    const asksBefore: number = asksOf();

    clusters.push({
      _id: CLUSTER_ID,
      name: "production",
      clusterIdentifier: "production",
      createdAt: new Date(),
      lastSeenAt: new Date(),
    });
    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    expect(
      screen.getByTestId("resource-connection-connected"),
    ).toBeInTheDocument();
    expect(usageOf(ProductKey.Kubernetes)).toBe(ProductUsage.InUse);

    await advance(EXPECT_CHANGE_FOR_MS);
    expect(asksOf()).toBe(asksBefore);
  });

  test("a guide that waits and sees nothing asks the products nothing", async () => {
    await showWatch(
      <ResourceConnectionWatch
        modelType={Service}
        viewPage={PageMap.SERVICE_VIEW_LOGS}
        viewText="View logs"
        dataPage={PageMap.LOGS}
        ingestionKey={Object.assign(new TelemetryIngestionKey(), key)}
        products={getProductsSetUpByGuide({ telemetryType: "logs" })}
      />,
    );
    const asksBefore: number = asksOf();

    await advance(RESOURCE_CONNECTION_POLL_INTERVAL_MS * 6);

    expect(
      screen.getByTestId("resource-connection-waiting"),
    ).toBeInTheDocument();
    expect(asksOf()).toBe(asksBefore);
  });
});

describe("1. the products each telemetry guide sets up", () => {
  const kindOf: Record<string, ActivationTelemetryKind> = {
    logs: ActivationTelemetryKind.Logs,
    metrics: ActivationTelemetryKind.Metrics,
    traces: ActivationTelemetryKind.Traces,
    exceptions: ActivationTelemetryKind.Exceptions,
    profiles: ActivationTelemetryKind.Profiles,
  };

  test.each(Object.keys(PRODUCTS_SET_UP_BY_TYPE))(
    "%s: exactly the products its first data puts in use",
    (type: string) => {
      const milestone: ActivationMilestone =
        ACTIVATION_MILESTONE_OF_TELEMETRY_KIND[kindOf[type]!];
      const products: Array<ProductKey> = (
        Object.keys(PRODUCT_USAGE_MILESTONES) as Array<ProductKey>
      ).filter((product: ProductKey): boolean => {
        return (PRODUCT_USAGE_MILESTONES[product] || []).includes(milestone);
      });

      expect(
        [
          ...PRODUCTS_SET_UP_BY_TYPE[
            type as keyof typeof PRODUCTS_SET_UP_BY_TYPE
          ],
        ].sort(),
      ).toEqual(products.sort());
    },
  );

  test("a guide of a whole service sets up every signal's products, once each", () => {
    expect(
      getProductsSetUpByGuide({ telemetryType: "traces", everySignal: true }),
    ).toEqual([
      ProductKey.Traces,
      ProductKey.Topology,
      ProductKey.Metrics,
      ProductKey.Logs,
    ]);
    expect(getProductsSetUpByGuide({ telemetryType: "exceptions" })).toEqual([
      ProductKey.Exceptions,
    ]);
  });
});

describe("3. another tab of the same browser", () => {
  beforeEach(async () => {
    await drawn();
  });

  test("a monitor made in another tab shows here at once, asking nothing", async () => {
    const listener: Mock = jest.fn();
    const stop: () => void = ProjectProducts.subscribe(
      listener as unknown as () => void,
    );

    anotherTabRemembers(withInUse(NOT_SET_UP, ProductKey.Monitors));
    stop();

    expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.InUse);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(asksOf()).toBe(1);
  });

  test("the project's last monitor deleted in another tab: Not set up here too", async () => {
    serverSays(withInUse(NOT_SET_UP, ProductKey.Monitors));
    await ProjectProducts.refresh(PROJECT_A);
    const asked: number = asksOf();

    anotherTabRemembers(NOT_SET_UP);

    expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.NotSetUp);
    expect(asksOf()).toBe(asked);
  });

  test("taking it writes nothing back: no tab echoes another", async () => {
    const setItem: SpyInstance<Storage["setItem"]> = jest.spyOn(
      storagePrototype(),
      "setItem",
    );
    const answer: string = JSON.stringify(
      toProjectProductsAnswerJSON(withInUse(NOT_SET_UP, ProductKey.Monitors)),
    );

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: `${REMEMBERED_PROJECT_PRODUCTS_KEY_PREFIX}${PROJECT_A}`,
        newValue: answer,
      }),
    );

    expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.InUse);
    expect(setItem).not.toHaveBeenCalled();
  });

  test("the same answer changes nothing: the same state, no one told", async () => {
    const before: unknown = ProjectProducts.getState(PROJECT_A);
    const listener: Mock = jest.fn();
    const stop: () => void = ProjectProducts.subscribe(
      listener as unknown as () => void,
    );

    anotherTabRemembers(NOT_SET_UP);
    stop();

    expect(ProjectProducts.getState(PROJECT_A)).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  test("a product this tab just made a record of keeps its mark against another tab's older answer", async () => {
    created("OnCallDutyPolicy");
    anotherTabRemembers(withInUse(NOT_SET_UP, ProductKey.Monitors));

    expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.InUse);
    expect(usageOf(ProductKey.OnCall)).toBe(ProductUsage.InUse);
  });

  test("another tab's answer ends this tab's wait for a guide's products", async () => {
    ProjectProducts.expectProductsInUse({ products: [ProductKey.Logs] });
    await flush();
    expect(jest.getTimerCount()).toBe(1);

    anotherTabRemembers(withInUse(NOT_SET_UP, ProductKey.Logs));

    expect(usageOf(ProductKey.Logs)).toBe(ProductUsage.InUse);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("another tab's older answer does not end this tab's wait for its own delete", async () => {
    serverSays(withInUse(NOT_SET_UP, ProductKey.Monitors));
    await ProjectProducts.refresh(PROJECT_A);
    const asked: number = asksOf();

    deleted("Monitor");
    anotherTabRemembers(
      withInUse(NOT_SET_UP, ProductKey.Monitors, ProductKey.Logs),
    );
    serverSays(NOT_SET_UP);
    await pass(DELETE_SETTLE_MS);

    expect(asksOf()).toBe(asked + 1);
    expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.NotSetUp);
  });

  test("another project's answer, a project nothing here has drawn: nothing changes, nothing is asked", async () => {
    const before: unknown = ProjectProducts.getState(PROJECT_A);

    anotherTabRemembers(withInUse(NOT_SET_UP, ProductKey.Monitors), PROJECT_B);

    expect(ProjectProducts.getState(PROJECT_A)).toBe(before);
    expect(asks).toHaveLength(1);
  });

  test("other keys, a removed answer and one that cannot be read change nothing", async () => {
    const before: unknown = ProjectProducts.getState(PROJECT_A);
    const send: (key: string, newValue: string | null) => void = (
      key: string,
      newValue: string | null,
    ): void => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: key, newValue: newValue }),
      );
    };

    send("table-density", "compact");
    send(`${REMEMBERED_PROJECT_PRODUCTS_KEY_PREFIX}${PROJECT_A}`, null);
    send(`${REMEMBERED_PROJECT_PRODUCTS_KEY_PREFIX}${PROJECT_A}`, "{not json");
    send(REMEMBERED_PROJECT_PRODUCTS_KEY_PREFIX, "{}");

    expect(ProjectProducts.getState(PROJECT_A)).toBe(before);
    await ProjectProducts.load(PROJECT_A);
    expect(asksOf()).toBe(1);
  });

  test("storage cleared in another tab (signed out there): the next look asks", async () => {
    window.dispatchEvent(new StorageEvent("storage", { key: null }));

    expect(asksOf()).toBe(1);
    await ProjectProducts.load(PROJECT_A);
    await flush();
    expect(asksOf()).toBe(2);
  });

  test("two tabs, end to end: one makes the monitor, the other shows it, and neither asks more than it did", async () => {
    // The other tab: its own copy of the store and of the page's feed.
    const otherTab: {
      store?: typeof ProjectProducts;
      changes?: typeof RecordChanges;
    } = {};

    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      otherTab.store =
        require("../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProjectProductsStore")
          .default as typeof ProjectProducts;
      otherTab.changes = require("../../../UI/Utils/ModelAPI/RecordChanges")
        .default as typeof RecordChanges;
      /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    });

    const tab: typeof ProjectProducts = otherTab.store!;
    const tabChanges: typeof RecordChanges = otherTab.changes!;
    let otherTabAsks: number = 0;
    tab.setFetcher(async (): Promise<ProjectProductsAnswer> => {
      otherTabAsks++;
      return NOT_SET_UP;
    });

    /*
     * The browser: an answer one tab writes reaches every other tab's
     * storage event, and only when it changed.
     */
    const realSetItem: Storage["setItem"] = Storage.prototype.setItem;
    jest.spyOn(storagePrototype(), "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ): void {
      const oldValue: string | null = this.getItem(key);
      realSetItem.call(this, key, value);

      if (oldValue !== value) {
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: key,
            oldValue: oldValue,
            newValue: value,
          }),
        );
      }
    });

    try {
      await tab.load(PROJECT_A);
      await flush();

      // The other tab makes the project's first monitor.
      tabChanges.announce({
        kind: RecordChangeKind.Created,
        tableName: "Monitor",
        projectId: PROJECT_A,
      });

      expect(tab.getState(PROJECT_A).answer.usage[ProductKey.Monitors]).toBe(
        ProductUsage.InUse,
      );
      expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.InUse);
      expect(asksOf()).toBe(1);
      expect(otherTabAsks).toBe(1);
    } finally {
      tab.setFetcher(null);
      tab.reset();
    }
  });
});

describe("nothing changed: nothing more is asked", () => {
  test("a minute of looks at the products, pages and tabs asks once, and the store keeps no timer", async () => {
    await drawn();

    for (let look: number = 0; look < 4; look++) {
      await ProjectProducts.load(PROJECT_A);
      await pass(REFRESH_AFTER_MS / 4 - 50);
    }

    expect(asksOf()).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("a create of a product in use, and records of no product, ask nothing and wait for nothing", async () => {
    serverSays(withInUse(NOT_SET_UP, ProductKey.Monitors));
    await drawn();

    created("Monitor");
    created("Label");
    deleted("Label");
    await pass(REFRESH_AFTER_MS - 1_000);
    await ProjectProducts.load(PROJECT_A);

    expect(asksOf()).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
