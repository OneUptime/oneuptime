import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";
import ProjectProducts, {
  CREATE_SETTLE_MS,
  ProjectProductsFetcher,
  REFRESH_AFTER_MS,
  REMEMBERED_PROJECT_PRODUCTS_KEY_PREFIX,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProjectProductsStore";
import * as ProjectProductsApi from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProjectProductsApi";
import ObjectID from "../../../Types/ObjectID";
import ProductKey from "../../../Types/Product/ProductKey";
import { ProductUsage } from "../../../Types/Product/ProductUsage";
import CreatedRecords from "../../../UI/Utils/ModelAPI/CreatedRecords";
import { ProjectProductsChosenBy } from "../../../Types/Product/ProjectProducts";
import {
  ProjectProductsAnswer,
  getEmptyProjectProductsAnswer,
  toProjectProductsAnswerJSON,
} from "../../../Types/Product/ProjectProductsAnswer";
import Project from "../../../Models/DatabaseModels/Project";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * THE DASHBOARD'S ONE STORE OF A PROJECT'S PRODUCTS (#6814): asked once per
 * page load however many places draw products, the last answer standing in
 * for the first paint, the project's own list before that, and a pin that
 * moves the bar at once and goes back if the server refuses it.
 */

const PROJECT_A: string = "11111111-1111-4111-8111-111111111111";
const PROJECT_B: string = "22222222-2222-4222-8222-222222222222";

const ANSWER: ProjectProductsAnswer = {
  ...getEmptyProjectProductsAnswer(),
  hidden: [ProductKey.Kubernetes],
  pinned: [ProductKey.Logs],
  canChooseProducts: true,
};

let fetcher: Mock<ProjectProductsFetcher>;

beforeEach(() => {
  ProjectProducts.reset();
  window.localStorage.clear();
  fetcher = jest.fn<ProjectProductsFetcher>().mockResolvedValue(ANSWER);
  ProjectProducts.setFetcher(fetcher);
});

afterEach(() => {
  ProjectProducts.setFetcher(null);
  ProjectProducts.reset();
  jest.restoreAllMocks();
});

describe("asking the server", () => {
  test("outside a project nothing is hidden or pinned, and nothing is asked", async () => {
    await ProjectProducts.load(null);

    expect(ProjectProducts.getState(null).answer).toEqual(
      getEmptyProjectProductsAnswer(),
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("a page load asks once, however many places ask", async () => {
    await Promise.all([
      ProjectProducts.load(PROJECT_A),
      ProjectProducts.load(PROJECT_A),
    ]);
    await ProjectProducts.load(PROJECT_A);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toEqual(new ObjectID(PROJECT_A));
    expect(ProjectProducts.getState(PROJECT_A)).toEqual({
      answer: ANSWER,
      isFresh: true,
      error: null,
    });
  });

  test("each project is asked for its own", async () => {
    await ProjectProducts.load(PROJECT_A);
    await ProjectProducts.load(PROJECT_B);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("refresh asks again", async () => {
    await ProjectProducts.load(PROJECT_A);
    await ProjectProducts.refresh(PROJECT_A);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("the same state comes back until something changes", async () => {
    const before: unknown = ProjectProducts.getState(PROJECT_A);
    expect(ProjectProducts.getState(PROJECT_A)).toBe(before);

    await ProjectProducts.load(PROJECT_A);

    expect(ProjectProducts.getState(PROJECT_A)).not.toBe(before);
  });

  test("a failed request keeps what was known, says why, and asks again next time", async () => {
    fetcher.mockResolvedValueOnce(null);

    await ProjectProducts.load(PROJECT_A);

    expect(ProjectProducts.getState(PROJECT_A).answer).toEqual(
      getEmptyProjectProductsAnswer(),
    );
    expect(ProjectProducts.getState(PROJECT_A).isFresh).toBe(false);
    expect(ProjectProducts.getState(PROJECT_A).error).toBe(
      "The project's products could not be read.",
    );

    await ProjectProducts.load(PROJECT_A);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(ProjectProducts.getState(PROJECT_A).answer).toEqual(ANSWER);
  });

  test("a request that throws says so", async () => {
    fetcher.mockRejectedValueOnce(new Error("offline"));

    await ProjectProducts.load(PROJECT_A);

    expect(ProjectProducts.getState(PROJECT_A).error).toBe("offline");
  });

  test("everyone listening hears an answer arrive", async () => {
    const listener: Mock = jest.fn();
    const unsubscribe: () => void = ProjectProducts.subscribe(
      listener as unknown as () => void,
    );

    await ProjectProducts.load(PROJECT_A);
    unsubscribe();
    await ProjectProducts.refresh(PROJECT_A);

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("the first paint", () => {
  test("the last answer, remembered in the browser, stands in until the server's", () => {
    window.localStorage.setItem(
      `${REMEMBERED_PROJECT_PRODUCTS_KEY_PREFIX}${PROJECT_A}`,
      JSON.stringify(toProjectProductsAnswerJSON(ANSWER)),
    );

    expect(ProjectProducts.getState(PROJECT_A)).toEqual({
      answer: ANSWER,
      isFresh: false,
      error: null,
    });
  });

  test("an answer the server gives is remembered", async () => {
    await ProjectProducts.load(PROJECT_A);

    expect(
      JSON.parse(
        window.localStorage.getItem(
          `${REMEMBERED_PROJECT_PRODUCTS_KEY_PREFIX}${PROJECT_A}`,
        ) as string,
      ),
    ).toEqual(toProjectProductsAnswerJSON(ANSWER));
  });

  test("without one, the selected project's own list says what is hidden", () => {
    const project: Project = new Project();
    project._id = PROJECT_A;
    project.productSettings = {
      hidden: ["docker"],
      chosenBy: "goals",
    };
    jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(project);

    expect(ProjectProducts.getState(PROJECT_A).answer).toEqual({
      ...getEmptyProjectProductsAnswer(),
      hidden: [ProductKey.Docker],
      chosenBy: ProjectProductsChosenBy.Goals,
    });
  });

  test("another project's list is not this one's", () => {
    const project: Project = new Project();
    project._id = PROJECT_B;
    project.productSettings = { hidden: ["docker"] };
    jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(project);

    expect(ProjectProducts.getState(PROJECT_A).answer.hidden).toEqual([]);
  });

  test("a damaged remembered answer is ignored", () => {
    window.localStorage.setItem(
      `${REMEMBERED_PROJECT_PRODUCTS_KEY_PREFIX}${PROJECT_A}`,
      "{not json",
    );

    expect(ProjectProducts.getState(PROJECT_A).answer).toEqual(
      getEmptyProjectProductsAnswer(),
    );
  });

  test("reset forgets the remembered answers too", async () => {
    await ProjectProducts.load(PROJECT_A);

    ProjectProducts.reset();

    expect(
      window.localStorage.getItem(
        `${REMEMBERED_PROJECT_PRODUCTS_KEY_PREFIX}${PROJECT_A}`,
      ),
    ).toBeNull();
  });
});

describe("changing the products", () => {
  test("showing or hiding records the server's answer", async () => {
    const after: ProjectProductsAnswer = { ...ANSWER, hidden: [] };
    const post: SpyInstance<typeof ProjectProductsApi.postProductShown> = jest
      .spyOn(ProjectProductsApi, "postProductShown")
      .mockResolvedValue(after);

    await ProjectProducts.setProductShown(PROJECT_A, {
      product: ProductKey.Kubernetes,
      isShown: true,
    });

    expect(post).toHaveBeenCalledWith({
      product: ProductKey.Kubernetes,
      isShown: true,
    });
    expect(ProjectProducts.getState(PROJECT_A).answer).toEqual(after);
  });

  test("Show Every Product records the server's answer", async () => {
    jest
      .spyOn(ProjectProductsApi, "postEveryProductShown")
      .mockResolvedValue({ ...ANSWER, hidden: [] });

    await ProjectProducts.showEveryProduct(PROJECT_A);

    expect(ProjectProducts.getState(PROJECT_A).answer.hidden).toEqual([]);
  });

  test("a refusal throws, and changes nothing", async () => {
    await ProjectProducts.load(PROJECT_A);
    jest
      .spyOn(ProjectProductsApi, "postProductShown")
      .mockRejectedValue(new Error("Only someone who may edit the project"));

    await expect(
      ProjectProducts.setProductShown(PROJECT_A, {
        product: ProductKey.Monitors,
        isShown: false,
      }),
    ).rejects.toThrow("Only someone who may edit the project");
    expect(ProjectProducts.getState(PROJECT_A).answer).toEqual(ANSWER);
  });
});

describe("pins", () => {
  test("a pin moves the bar at once, then takes the server's answer", async () => {
    await ProjectProducts.load(PROJECT_A);

    let release: (answer: ProjectProductsAnswer) => void = () => {};
    jest
      .spyOn(ProjectProductsApi, "postPinnedProducts")
      .mockImplementation(
        (pinned: ReadonlyArray<ProductKey>): Promise<ProjectProductsAnswer> => {
          return new Promise(
            (resolve: (value: ProjectProductsAnswer) => void) => {
              release = (): void => {
                resolve({ ...ANSWER, pinned: [...pinned] });
              };
            },
          );
        },
      );

    const pinning: Promise<Array<ProductKey>> =
      ProjectProducts.setProductPinned(PROJECT_A, {
        product: ProductKey.Monitors,
        isPinned: true,
      });

    // Before the server answers.
    expect(ProjectProducts.getState(PROJECT_A).answer.pinned).toEqual([
      ProductKey.Logs,
      ProductKey.Monitors,
    ]);

    release(ANSWER);

    expect(await pinning).toEqual([ProductKey.Logs, ProductKey.Monitors]);
    expect(ProjectProducts.getState(PROJECT_A).answer.pinned).toEqual([
      ProductKey.Logs,
      ProductKey.Monitors,
    ]);
  });

  test("a refused pin goes back, and throws", async () => {
    await ProjectProducts.load(PROJECT_A);
    jest
      .spyOn(ProjectProductsApi, "postPinnedProducts")
      .mockRejectedValue(new Error("You can pin up to 5 products."));

    await expect(
      ProjectProducts.setProductPinned(PROJECT_A, {
        product: ProductKey.Monitors,
        isPinned: true,
      }),
    ).rejects.toThrow("You can pin up to 5 products.");
    expect(ProjectProducts.getState(PROJECT_A).answer.pinned).toEqual([
      ProductKey.Logs,
    ]);
  });

  test("a pin that changes nothing sends nothing", async () => {
    await ProjectProducts.load(PROJECT_A);
    const post: SpyInstance<typeof ProjectProductsApi.postPinnedProducts> =
      jest.spyOn(ProjectProductsApi, "postPinnedProducts");

    expect(
      await ProjectProducts.setProductPinned(PROJECT_A, {
        product: ProductKey.Logs,
        isPinned: true,
      }),
    ).toEqual([ProductKey.Logs]);
    expect(post).not.toHaveBeenCalled();
  });

  test("unpinning sends the pins left, in order", async () => {
    await ProjectProducts.load(PROJECT_A);
    const post: SpyInstance<typeof ProjectProductsApi.postPinnedProducts> = jest
      .spyOn(ProjectProductsApi, "postPinnedProducts")
      .mockResolvedValue({ ...ANSWER, pinned: [] });

    await ProjectProducts.setProductPinned(PROJECT_A, {
      product: ProductKey.Logs,
      isPinned: false,
    });

    expect(post).toHaveBeenCalledWith([]);
    expect(ProjectProducts.getState(PROJECT_A).answer.pinned).toEqual([]);
  });

  test("an answer that lands after a newer change is dropped", async () => {
    let release: () => void = () => {};
    fetcher.mockImplementationOnce(
      (): Promise<ProjectProductsAnswer | null> => {
        return new Promise(
          (resolve: (value: ProjectProductsAnswer | null) => void) => {
            release = (): void => {
              resolve({ ...ANSWER, pinned: [ProductKey.Traces] });
            };
          },
        );
      },
    );

    const loading: Promise<void> = ProjectProducts.load(PROJECT_A);
    ProjectProducts.setAnswer(PROJECT_A, { ...ANSWER, pinned: [] });
    release();
    await loading;

    expect(ProjectProducts.getState(PROJECT_A).answer.pinned).toEqual([]);
  });
});

/*
 * #7465: the products menu kept "Not set up" on Monitors, On-Call Duty and
 * Logs after each was set up. The answer was kept until the page was
 * reloaded, and a product's first record made on the page changed nothing.
 */
describe("the answer follows what the project uses (#7465)", () => {
  const NOT_SET_UP: ProjectProductsAnswer = {
    ...ANSWER,
    usage: {
      [ProductKey.Monitors]: ProductUsage.NotSetUp,
      [ProductKey.OnCall]: ProductUsage.NotSetUp,
      [ProductKey.Logs]: ProductUsage.NotSetUp,
      [ProductKey.Incidents]: ProductUsage.NothingYet,
    },
  };

  const usageOf: (
    product: ProductKey,
    projectId?: string,
  ) => ProductUsage | undefined = (
    product: ProductKey,
    projectId: string = PROJECT_A,
  ): ProductUsage | undefined => {
    return ProjectProducts.getState(projectId).answer.usage[product];
  };

  const created: (tableName: string, projectId?: string | null) => void = (
    tableName: string,
    projectId: string | null = PROJECT_A,
  ): void => {
    // What ModelAPI tells the page once the server confirms a create.
    CreatedRecords.announce({ tableName: tableName, projectId: projectId });
  };

  let now: number;

  beforeEach(() => {
    now = Date.UTC(2026, 10, 15, 21, 18, 0);
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return now;
    });
    fetcher.mockResolvedValue(NOT_SET_UP);
  });

  describe("asking again", () => {
    test("an answer that does not change is asked once, however often the products are looked at", async () => {
      for (let look: number = 0; look < 10; look++) {
        await ProjectProducts.load(PROJECT_A);
        now += 1_000;
      }

      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    test("once older than REFRESH_AFTER_MS, the next look asks again, and takes the server's word", async () => {
      await ProjectProducts.load(PROJECT_A);

      now += REFRESH_AFTER_MS - 1;
      await ProjectProducts.load(PROJECT_A);
      expect(fetcher).toHaveBeenCalledTimes(1);

      // The first logs arrived meanwhile.
      fetcher.mockResolvedValue({
        ...NOT_SET_UP,
        usage: { ...NOT_SET_UP.usage, [ProductKey.Logs]: ProductUsage.InUse },
      });
      now += 1;
      await ProjectProducts.load(PROJECT_A);

      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(usageOf(ProductKey.Logs)).toBe(ProductUsage.InUse);
    });

    test("an answer recorded from a change (a pin, a product shown) counts as asked", async () => {
      ProjectProducts.setAnswer(PROJECT_A, NOT_SET_UP);

      await ProjectProducts.load(PROJECT_A);
      expect(fetcher).not.toHaveBeenCalled();

      now += REFRESH_AFTER_MS;
      await ProjectProducts.load(PROJECT_A);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    test("a remembered answer from an earlier page load is only a stand-in: the first look asks", async () => {
      window.localStorage.setItem(
        `${REMEMBERED_PROJECT_PRODUCTS_KEY_PREFIX}${PROJECT_A}`,
        JSON.stringify(toProjectProductsAnswerJSON(NOT_SET_UP)),
      );

      await ProjectProducts.load(PROJECT_A);

      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    test("an answer is asked for from when it was asked, not when it landed", async () => {
      let release: () => void = () => {};
      fetcher.mockImplementationOnce(
        (): Promise<ProjectProductsAnswer | null> => {
          return new Promise(
            (resolve: (value: ProjectProductsAnswer | null) => void) => {
              release = (): void => {
                resolve(NOT_SET_UP);
              };
            },
          );
        },
      );

      const loading: Promise<void> = ProjectProducts.load(PROJECT_A);
      now += REFRESH_AFTER_MS - 1_000;
      release();
      await loading;

      now += 1_000;
      await ProjectProducts.load(PROJECT_A);

      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });

  describe("a product's first record made on this page", () => {
    test("a monitor marks Monitors in use at once, asking nothing", async () => {
      await ProjectProducts.load(PROJECT_A);

      created("Monitor");

      expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.InUse);
      expect(usageOf(ProductKey.OnCall)).toBe(ProductUsage.NotSetUp);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    test("an on-call policy marks On-Call Duty in use at once", async () => {
      await ProjectProducts.load(PROJECT_A);

      created("OnCallDutyPolicy");

      expect(usageOf(ProductKey.OnCall)).toBe(ProductUsage.InUse);
    });

    test("a product with nothing to set up (an incident) is in use too", async () => {
      await ProjectProducts.load(PROJECT_A);

      created("Incident");

      expect(usageOf(ProductKey.Incidents)).toBe(ProductUsage.InUse);
    });

    test("everyone listening hears it, and the next page load's first paint has it", async () => {
      await ProjectProducts.load(PROJECT_A);
      const listener: Mock = jest.fn();
      const unsubscribe: () => void = ProjectProducts.subscribe(
        listener as unknown as () => void,
      );

      created("Monitor");
      unsubscribe();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(
        JSON.parse(
          window.localStorage.getItem(
            `${REMEMBERED_PROJECT_PRODUCTS_KEY_PREFIX}${PROJECT_A}`,
          ) as string,
        ).usage[ProductKey.Monitors],
      ).toBe(ProductUsage.InUse);
    });

    test("the next look asks the server, whatever the answer's age, and its word stands once settled", async () => {
      await ProjectProducts.load(PROJECT_A);
      created("Monitor");

      now += CREATE_SETTLE_MS;
      fetcher.mockResolvedValue({
        ...NOT_SET_UP,
        usage: {
          ...NOT_SET_UP.usage,
          [ProductKey.Monitors]: ProductUsage.InUse,
        },
      });
      await ProjectProducts.load(PROJECT_A);

      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.InUse);
    });

    test("an answer asked for before the create, landing after it, keeps the mark", async () => {
      let release: () => void = () => {};
      fetcher.mockImplementationOnce(
        (): Promise<ProjectProductsAnswer | null> => {
          return new Promise(
            (resolve: (value: ProjectProductsAnswer | null) => void) => {
              release = (): void => {
                resolve(NOT_SET_UP);
              };
            },
          );
        },
      );

      const loading: Promise<void> = ProjectProducts.load(PROJECT_A);
      now += 200;
      created("Monitor");
      now += 300;
      release();
      await loading;

      expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.InUse);
      expect(usageOf(ProductKey.OnCall)).toBe(ProductUsage.NotSetUp);
    });

    test("an answer worked out within CREATE_SETTLE_MS keeps the mark; one after it is the server's", async () => {
      await ProjectProducts.load(PROJECT_A);
      created("Monitor");

      // Another server may still go by what it kept.
      now += CREATE_SETTLE_MS - 1;
      await ProjectProducts.refresh(PROJECT_A);
      expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.InUse);

      // The monitor was deleted since, by someone else.
      now += 1;
      await ProjectProducts.refresh(PROJECT_A);
      expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.NotSetUp);
    });

    test("a product already in use: nothing changes, and nothing more is asked", async () => {
      fetcher.mockResolvedValue({
        ...NOT_SET_UP,
        usage: { [ProductKey.Monitors]: ProductUsage.InUse },
      });
      await ProjectProducts.load(PROJECT_A);
      const before: unknown = ProjectProducts.getState(PROJECT_A);

      created("Monitor");
      await ProjectProducts.load(PROJECT_A);

      expect(ProjectProducts.getState(PROJECT_A)).toBe(before);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    test("a product this person may not read stays unmarked", async () => {
      fetcher.mockResolvedValue({ ...NOT_SET_UP, usage: {} });
      await ProjectProducts.load(PROJECT_A);

      created("Monitor");

      expect(usageOf(ProductKey.Monitors)).toBeUndefined();
    });

    test("a record of no product (a label, a note) changes nothing", async () => {
      await ProjectProducts.load(PROJECT_A);
      const before: unknown = ProjectProducts.getState(PROJECT_A);

      created("Label");
      created("IncidentInternalNote");
      created("");

      expect(ProjectProducts.getState(PROJECT_A)).toBe(before);
    });

    test("another project's record changes only that project's answer", async () => {
      await ProjectProducts.load(PROJECT_A);
      await ProjectProducts.load(PROJECT_B);

      created("Monitor", PROJECT_B);

      expect(usageOf(ProductKey.Monitors, PROJECT_B)).toBe(ProductUsage.InUse);
      expect(usageOf(ProductKey.Monitors, PROJECT_A)).toBe(
        ProductUsage.NotSetUp,
      );
    });

    test("a create that does not say its project is the open project's", async () => {
      await ProjectProducts.load(PROJECT_A);
      jest
        .spyOn(ProjectUtil, "getCurrentProjectId")
        .mockReturnValue(new ObjectID(PROJECT_A));

      created("Monitor", null);

      expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.InUse);
    });

    test("a project nothing has drawn yet is left alone: its first ask reads the record", () => {
      created("Monitor", PROJECT_B);

      expect(usageOf(ProductKey.Monitors, PROJECT_B)).toBeUndefined();
      expect(fetcher).not.toHaveBeenCalled();
    });

    test("forgotten on reset", async () => {
      await ProjectProducts.load(PROJECT_A);
      created("Monitor");

      ProjectProducts.reset();
      await ProjectProducts.load(PROJECT_A);

      expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.NotSetUp);
    });
  });
});
