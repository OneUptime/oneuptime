import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import ProductKey from "Common/Types/Product/ProductKey";
import { withProductPinned } from "Common/Types/Product/ProductPins";
import {
  getHiddenProducts,
  parseProjectProductSettings,
} from "Common/Types/Product/ProjectProducts";
import {
  ProjectProductsAnswer,
  getEmptyProjectProductsAnswer,
  parseProjectProductsAnswer,
  toProjectProductsAnswerJSON,
} from "Common/Types/Product/ProjectProductsAnswer";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  fetchProjectProducts,
  postEveryProductShown,
  postPinnedProducts,
  postProductShown,
} from "./ProjectProductsApi";

/*
 * A PROJECT'S PRODUCTS, IN THE DASHBOARD (issue #6814): the products it
 * hides, the products this person pinned, what is in use and the plan each
 * product needs (Types/Product/ProjectProductsAnswer).
 *
 * Every place that draws products asks this one store - the products menu
 * and the phone menu, Home's Explore and Your project card, Search, the
 * keyboard shortcuts, Project Settings > Products and the pin beside a
 * product page's title. A page load asks the server once however many of
 * them are on screen: the answer is kept until the page is reloaded, and
 * askers that arrive while the request is out share it.
 *
 * Until this page load's answer arrives, the last one is remembered in the
 * browser per project and stands in, so the bar's pins and the menu's
 * hidden products are right on the first paint; without one, the hidden
 * products come from the project itself (Project.productSettings, read with
 * the project list). It is only ever a stand-in: `isFresh` says whether an
 * answer is this page load's, and the server's replaces it.
 *
 * Browser storage can be missing, full or refused, so every read and write
 * of it is allowed to fail: the store then simply has nothing remembered.
 */

export interface ProjectProductsState {
  answer: ProjectProductsAnswer;
  // Whether the answer is the server's, for this page load.
  isFresh: boolean;
  // Why this page load's request failed, if it did.
  error: string | null;
}

export type ProjectProductsFetcher = (
  projectId: ObjectID,
) => Promise<ProjectProductsAnswer | null>;

export const REMEMBERED_PROJECT_PRODUCTS_KEY_PREFIX: string =
  "project-products-";

const rememberedKey: (projectId: string) => string = (
  projectId: string,
): string => {
  return `${REMEMBERED_PROJECT_PRODUCTS_KEY_PREFIX}${projectId}`;
};

const readRemembered: (projectId: string) => ProjectProductsAnswer | null = (
  projectId: string,
): ProjectProductsAnswer | null => {
  try {
    const stored: string | null = window.localStorage.getItem(
      rememberedKey(projectId),
    );

    if (!stored) {
      return null;
    }

    return parseProjectProductsAnswer(JSON.parse(stored));
  } catch {
    return null;
  }
};

const remember: (projectId: string, answer: ProjectProductsAnswer) => void = (
  projectId: string,
  answer: ProjectProductsAnswer,
): void => {
  try {
    window.localStorage.setItem(
      rememberedKey(projectId),
      JSON.stringify(toProjectProductsAnswerJSON(answer)),
    );
  } catch {
    // Nothing remembered: the next page load asks before it knows.
  }
};

/*
 * What the selected project itself says it hides, when nothing is
 * remembered: Project.productSettings, read with the project list.
 */
const readFromProject: (projectId: string) => ProjectProductsAnswer | null = (
  projectId: string,
): ProjectProductsAnswer | null => {
  try {
    const project: Project | null = ProjectUtil.getCurrentProject();

    if (!project || project._id?.toString() !== projectId) {
      return null;
    }

    const settings: ReturnType<typeof parseProjectProductSettings> =
      parseProjectProductSettings(project.productSettings);

    if (!settings) {
      return null;
    }

    return {
      ...getEmptyProjectProductsAnswer(),
      hidden: getHiddenProducts(settings),
      chosenBy: settings.chosenBy,
    };
  } catch {
    return null;
  }
};

interface ProjectEntry {
  state: ProjectProductsState;
  request: Promise<void> | null;
  /*
   * Bumped by every request and every recorded answer, so an answer that
   * lands after a newer one was asked for (or recorded) is dropped instead
   * of overwriting it.
   */
  generation: number;
}

// Outside a project there is nothing to hide or pin.
const OUTSIDE_A_PROJECT: ProjectProductsState = Object.freeze({
  answer: getEmptyProjectProductsAnswer(),
  isFresh: false,
  error: null,
});

type ProjectIdInput = ObjectID | string | null | undefined;

const toProjectKey: (projectId: ProjectIdInput) => string = (
  projectId: ProjectIdInput,
): string => {
  return projectId ? projectId.toString() : "";
};

export default class ProjectProducts {
  private static entries: Map<string, ProjectEntry> = new Map();
  private static listeners: Set<() => void> = new Set();
  private static fetcher: ProjectProductsFetcher = fetchProjectProducts;

  public static subscribe(listener: () => void): () => void {
    ProjectProducts.listeners.add(listener);

    return (): void => {
      ProjectProducts.listeners.delete(listener);
    };
  }

  /*
   * What is known about a project's products right now. The same object
   * comes back until something changes, as useSyncExternalStore requires.
   */
  public static getState(projectId: ProjectIdInput): ProjectProductsState {
    const key: string = toProjectKey(projectId);

    if (!key) {
      return OUTSIDE_A_PROJECT;
    }

    return ProjectProducts.entryFor(key).state;
  }

  /*
   * Asks the server once per page load. A second call while the first is
   * out shares it; a call after a fresh answer does nothing. After a failed
   * request it asks again, so the next page can recover.
   */
  public static load(projectId: ProjectIdInput): Promise<void> {
    const key: string = toProjectKey(projectId);

    if (!key) {
      return Promise.resolve();
    }

    const entry: ProjectEntry = ProjectProducts.entryFor(key);

    if (entry.request) {
      return entry.request;
    }

    if (entry.state.isFresh) {
      return Promise.resolve();
    }

    return ProjectProducts.ask(key, entry);
  }

  // Asks again even after a fresh answer.
  public static refresh(projectId: ProjectIdInput): Promise<void> {
    const key: string = toProjectKey(projectId);

    if (!key) {
      return Promise.resolve();
    }

    return ProjectProducts.ask(key, ProjectProducts.entryFor(key));
  }

  // Records an answer, as if the server had just given it.
  public static setAnswer(
    projectId: ObjectID | string,
    answer: ProjectProductsAnswer,
  ): void {
    const key: string = toProjectKey(projectId);

    if (!key) {
      return;
    }

    const entry: ProjectEntry = ProjectProducts.entryFor(key);

    entry.generation++;
    entry.request = null;
    entry.state = { answer: answer, isFresh: true, error: null };
    remember(key, answer);
    ProjectProducts.emit();
  }

  /*
   * Shows or hides one product for the project, and records the server's
   * answer. Throws with the server's words when it refuses.
   */
  public static async setProductShown(
    projectId: ObjectID | string,
    data: { product: ProductKey; isShown: boolean },
  ): Promise<void> {
    ProjectProducts.setAnswer(projectId, await postProductShown(data));
  }

  // Shows every product again, for the project.
  public static async showEveryProduct(
    projectId: ObjectID | string,
  ): Promise<void> {
    ProjectProducts.setAnswer(projectId, await postEveryProductShown());
  }

  /*
   * Pins a product, or unpins it: the bar changes at once, and goes back if
   * the server refuses (then this throws). A sixth pin changes nothing.
   * Answers the pins as they now stand.
   */
  public static async setProductPinned(
    projectId: ObjectID | string,
    data: { product: ProductKey; isPinned: boolean },
  ): Promise<Array<ProductKey>> {
    const key: string = toProjectKey(projectId);
    const before: ProjectProductsAnswer = ProjectProducts.getState(key).answer;
    const pinned: Array<ProductKey> = withProductPinned({
      pinned: before.pinned,
      product: data.product,
      isPinned: data.isPinned,
    });

    if (
      pinned.length === before.pinned.length &&
      pinned.every((product: ProductKey, index: number): boolean => {
        return before.pinned[index] === product;
      })
    ) {
      return pinned;
    }

    ProjectProducts.setAnswer(key, { ...before, pinned: pinned });

    try {
      const answer: ProjectProductsAnswer = await postPinnedProducts(pinned);
      ProjectProducts.setAnswer(key, answer);
      return answer.pinned;
    } catch (err) {
      ProjectProducts.setAnswer(key, {
        ...ProjectProducts.getState(key).answer,
        pinned: before.pinned,
      });
      throw err;
    }
  }

  /*
   * Where the answers come from. Tests hand in their own; null puts the
   * server back.
   */
  public static setFetcher(fetcher: ProjectProductsFetcher | null): void {
    ProjectProducts.fetcher = fetcher || fetchProjectProducts;
  }

  // Forgets every answer, remembered ones included.
  public static reset(): void {
    for (const key of ProjectProducts.entries.keys()) {
      try {
        window.localStorage.removeItem(rememberedKey(key));
      } catch {
        // Nothing remembered to forget.
      }
    }

    ProjectProducts.entries = new Map();
    ProjectProducts.emit();
  }

  private static entryFor(key: string): ProjectEntry {
    const existing: ProjectEntry | undefined = ProjectProducts.entries.get(key);

    if (existing) {
      return existing;
    }

    const entry: ProjectEntry = {
      state: {
        answer:
          readRemembered(key) ||
          readFromProject(key) ||
          getEmptyProjectProductsAnswer(),
        isFresh: false,
        error: null,
      },
      request: null,
      generation: 0,
    };

    ProjectProducts.entries.set(key, entry);

    return entry;
  }

  private static ask(key: string, entry: ProjectEntry): Promise<void> {
    entry.generation++;

    const generation: number = entry.generation;
    const fetcher: ProjectProductsFetcher = ProjectProducts.fetcher;

    const request: Promise<void> = (async (): Promise<void> => {
      let answer: ProjectProductsAnswer | null = null;
      let error: string | null = null;

      try {
        answer = await fetcher(new ObjectID(key));

        if (!answer) {
          error = "The project's products could not be read.";
        }
      } catch (err) {
        error = (err as Error)?.message || "Could not read the products.";
      }

      if (entry.generation !== generation) {
        // A newer request or a recorded answer took over.
        return;
      }

      entry.request = null;

      if (answer) {
        entry.state = { answer: answer, isFresh: true, error: null };
        remember(key, answer);
      } else {
        entry.state = { ...entry.state, error: error };
      }

      ProjectProducts.emit();
    })();

    entry.request = request;

    return request;
  }

  private static emit(): void {
    for (const listener of ProjectProducts.listeners) {
      listener();
    }
  }
}
