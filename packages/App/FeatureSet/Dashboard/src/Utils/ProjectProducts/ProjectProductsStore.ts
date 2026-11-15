import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import ProductKey from "Common/Types/Product/ProductKey";
import { getProductOfTable } from "Common/Types/Product/ProductOfTable";
import { withProductPinned } from "Common/Types/Product/ProductPins";
import { ProductUsage } from "Common/Types/Product/ProductUsage";
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
import RecordChanges, {
  RecordChange,
  RecordChangeKind,
} from "Common/UI/Utils/ModelAPI/RecordChanges";
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
 * product page's title. However many of them are on screen, the server is
 * asked once: askers that arrive while the request is out share it, and an
 * answer is kept for REFRESH_AFTER_MS.
 *
 * What is in use changes while the page is open (#7465, #8204): the first
 * monitor, the first logs, the last monitor deleted. So the answer follows
 * it:
 *
 *   - a product's first record this page creates (RecordChanges, from
 *     ModelAPI) marks it in use at once - Create Monitor, a guided setup,
 *     an import - and the next ask brings the server's word. An answer that
 *     may have been worked out before that create (asked before it, or
 *     within CREATE_SETTLE_MS after it, while other servers may still go by
 *     what they kept) keeps the mark. A record a setup guide saw arrive -
 *     the cluster an agent registered, the service that sent its first
 *     traces (noteRecordFound) - marks its product the same way;
 *   - a record of a product in use that this page deletes (RecordChanges,
 *     from ModelAPI.deleteItem) has the store ask again DELETE_SETTLE_MS
 *     later, by itself, once every server knows of the delete: with the
 *     project's last monitor gone, Monitors says "Not set up" again. A
 *     burst of deletes (a bulk delete) is one ask, after the last;
 *   - a setup guide whose data has just arrived (ResourceConnectionWatch)
 *     says which products it set up (expectProductsInUse): the server keeps
 *     the first logs only once the telemetry writer has stored them, a few
 *     seconds after the guide sees them sent, so the store asks at once and
 *     every EXPECT_CHANGE_EVERY_MS until those products are in use, for
 *     EXPECT_CHANGE_FOR_MS at most;
 *   - another tab of this browser that gets a newer answer remembers it
 *     (below), and this tab takes it from the browser's storage event as it
 *     lands, asking nothing: a monitor made, or a project's last one
 *     deleted, in one tab shows in every other at once;
 *   - an answer older than REFRESH_AFTER_MS is asked again when the person
 *     opens the products menu or the phone menu, moves to another page or
 *     comes back to the tab (load): a product set up elsewhere - its first
 *     logs, an agent's first host, a teammate's monitor - shows within
 *     moments of being looked for, at one light request at most every
 *     REFRESH_AFTER_MS. The server reads what is in use again as soon as it
 *     changes (ProjectUsageCache), so the answer it gives is current.
 *
 * None of these asks on a page view: a page that only draws the products
 * asks what it asked before, and nothing more while nothing changes.
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

/*
 * How long an answer is kept before the next look at the products - the
 * menu opened, another page, the tab shown again - asks again.
 */
export const REFRESH_AFTER_MS: number = 15_000;

/*
 * How long after this page creates a product's first record an answer may
 * still have been worked out without it: other servers see the change
 * within a second (CacheGenerations.SHARED_READ_TTL_MS).
 */
export const CREATE_SETTLE_MS: number = 5_000;

/*
 * How long after this page deletes a product's record the store asks again
 * by itself: every server knows of the delete by then
 * (CacheGenerations.SHARED_READ_TTL_MS), so the answer says whether it was
 * the product's last. An answer asked before then is drawn, but the next
 * look asks again all the same.
 */
export const DELETE_SETTLE_MS: number = 2_000;

/*
 * How long the store keeps asking for the products a setup guide set up,
 * once its data arrived, and how often: the server keeps the first logs
 * once the telemetry writer stored them (TelemetryFanInWriter's
 * maxWaitMs, 5 seconds by default) and every server sees it within
 * CacheGenerations.SHARED_READ_TTL_MS.
 */
export const EXPECT_CHANGE_FOR_MS: number = 15_000;
export const EXPECT_CHANGE_EVERY_MS: number = 2_500;

const rememberedKey: (projectId: string) => string = (
  projectId: string,
): string => {
  return `${REMEMBERED_PROJECT_PRODUCTS_KEY_PREFIX}${projectId}`;
};

const readRemembered: (projectId: string) => ProjectProductsAnswer | null = (
  projectId: string,
): ProjectProductsAnswer | null => {
  try {
    return parseRemembered(
      window.localStorage.getItem(rememberedKey(projectId)),
    );
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
 * The project a remembered answer's key is for, or null for a key of
 * something else.
 */
const projectOfRememberedKey: (key: string | null) => string | null = (
  key: string | null,
): string | null => {
  if (!key || !key.startsWith(REMEMBERED_PROJECT_PRODUCTS_KEY_PREFIX)) {
    return null;
  }

  return key.slice(REMEMBERED_PROJECT_PRODUCTS_KEY_PREFIX.length) || null;
};

const parseRemembered: (
  stored: string | null,
) => ProjectProductsAnswer | null = (
  stored: string | null,
): ProjectProductsAnswer | null => {
  if (!stored) {
    return null;
  }

  try {
    return parseProjectProductsAnswer(JSON.parse(stored));
  } catch {
    return null;
  }
};

const isSameAnswer: (
  first: ProjectProductsAnswer,
  second: ProjectProductsAnswer,
) => boolean = (
  first: ProjectProductsAnswer,
  second: ProjectProductsAnswer,
): boolean => {
  return (
    JSON.stringify(toProjectProductsAnswerJSON(first)) ===
    JSON.stringify(toProjectProductsAnswerJSON(second))
  );
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
  /*
   * When the answer drawn was asked for (or recorded), or null when the next
   * look at the products is to ask again whatever its age.
   */
  answeredAt: number | null;
  /*
   * The products whose record this page created (or a setup guide saw
   * arrive), and when: an answer worked out before then, or within
   * CREATE_SETTLE_MS after, keeps them in use.
   */
  created: Map<ProductKey, number>;
  /*
   * Until when an answer may not know of a record this page deleted
   * (DELETE_SETTLE_MS after the last delete): one asked before then is not
   * kept as current, and the store asks again then. 0 for none.
   */
  settlingUntil: number;
  /*
   * The products a setup guide said are about to be in use, and until when
   * the store keeps asking for them (expectProductsInUse).
   */
  expected: { products: Set<ProductKey>; until: number } | null;
  // The store's own next ask: a delete settling, a guide's products awaited.
  followUp: ReturnType<typeof setTimeout> | null;
}

/*
 * The answer, with the products this page created a record of marked in use
 * where an answer worked out at `askedAt` may not know of it yet. Products
 * created long enough before `askedAt` are the server's to answer from now
 * on, and forgotten here.
 */
const keepCreatedInUse: (
  entry: ProjectEntry,
  answer: ProjectProductsAnswer,
  askedAt: number,
) => ProjectProductsAnswer = (
  entry: ProjectEntry,
  answer: ProjectProductsAnswer,
  askedAt: number,
): ProjectProductsAnswer => {
  let usage: ProjectProductsAnswer["usage"] | null = null;

  for (const [product, createdAt] of Array.from(entry.created.entries())) {
    if (askedAt >= createdAt + CREATE_SETTLE_MS) {
      entry.created.delete(product);
      continue;
    }

    const said: ProductUsage | undefined = answer.usage[product];

    // A product this person may not read has no mark, created or not.
    if (said === undefined || said === ProductUsage.InUse) {
      continue;
    }

    usage = { ...(usage || answer.usage), [product]: ProductUsage.InUse };
  }

  return usage ? { ...answer, usage: usage } : answer;
};

// Outside a project there is nothing to hide or pin.
const OUTSIDE_A_PROJECT: ProjectProductsState = Object.freeze({
  answer: getEmptyProjectProductsAnswer(),
  isFresh: false,
  error: null,
});

type ProjectIdInput = ObjectID | string | null | undefined;

// A record of a project's, as a create or delete announces it.
export type RecordOfProject = Pick<RecordChange, "tableName" | "projectId">;

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
   * Asks the server unless a fresh answer is younger than REFRESH_AFTER_MS:
   * what every look at the products calls - the navbar drawn, the menu
   * opened, another page, the tab shown again. A second call while the first
   * is out shares it. After a failed request it asks again, so the next
   * page can recover.
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

    if (
      entry.state.isFresh &&
      entry.answeredAt !== null &&
      Date.now() - entry.answeredAt < REFRESH_AFTER_MS
    ) {
      return Promise.resolve();
    }

    return ProjectProducts.ask(key, entry);
  }

  /*
   * This page created a record (RecordChanges, from ModelAPI): a product's
   * main record (ProductOfTable) marks the product in use at once, rather
   * than "Not set up" until the server is asked again - and the next look
   * at the products asks it. An answer already on its way, or worked out
   * within CREATE_SETTLE_MS, keeps the mark (keepCreatedInUse). A project
   * nothing has drawn yet is left alone: its first ask reads the record.
   */
  public static noteRecordCreated(record: RecordOfProject): void {
    const product: ProductKey | null = getProductOfTable(record.tableName);

    if (!product) {
      return;
    }

    const key: string = ProjectProducts.keyOfRecord(record);
    const entry: ProjectEntry | undefined = key
      ? ProjectProducts.entries.get(key)
      : undefined;

    if (!entry) {
      return;
    }

    entry.created.set(product, Date.now());

    const said: ProductUsage | undefined = entry.state.answer.usage[product];

    if (said === undefined || said === ProductUsage.InUse) {
      return;
    }

    entry.answeredAt = null;
    entry.state = {
      ...entry.state,
      answer: {
        ...entry.state.answer,
        usage: { ...entry.state.answer.usage, [product]: ProductUsage.InUse },
      },
    };

    if (entry.state.isFresh) {
      remember(key, entry.state.answer);
    }

    ProjectProducts.emit();
  }

  /*
   * A setup guide saw a record arrive that someone else made - the cluster
   * an agent registered, the service whose first traces named it
   * (ResourceConnectionWatch): it is there, so its product is in use, as
   * if this page had created it (noteRecordCreated).
   */
  public static noteRecordFound(record: RecordOfProject): void {
    ProjectProducts.noteRecordCreated(record);
  }

  /*
   * This page deleted a record (RecordChanges, from ModelAPI.deleteItem):
   * a product's main record may have been its last, and only the server
   * can say. So the store asks again by itself DELETE_SETTLE_MS after the
   * last delete (once every server knows of it), and the next look asks
   * too. A product not in use, or one this person may not read, is left
   * alone, and so is a project nothing has drawn yet.
   */
  public static noteRecordDeleted(record: RecordOfProject): void {
    const product: ProductKey | null = getProductOfTable(record.tableName);

    if (!product) {
      return;
    }

    const key: string = ProjectProducts.keyOfRecord(record);
    const entry: ProjectEntry | undefined = key
      ? ProjectProducts.entries.get(key)
      : undefined;

    if (!entry) {
      return;
    }

    // A record this page created and deleted again keeps nothing in use.
    entry.created.delete(product);

    if (entry.state.answer.usage[product] !== ProductUsage.InUse) {
      return;
    }

    entry.settlingUntil = Date.now() + DELETE_SETTLE_MS;
    entry.answeredAt = null;
    ProjectProducts.scheduleFollowUp(key, entry, entry.settlingUntil);
  }

  /*
   * A setup guide's data has just arrived (ResourceConnectionWatch): the
   * products it set up are about to be in use, but the server may not know
   * yet - it keeps the first logs once the telemetry writer stored them, a
   * few seconds after the guide sees them sent. So the store asks at once,
   * and again every EXPECT_CHANGE_EVERY_MS until each of them is in use, or
   * EXPECT_CHANGE_FOR_MS has passed. Products in use already, or that this
   * person may not read, ask nothing; nor does a project nothing has drawn
   * yet (its first ask reads them).
   */
  public static expectProductsInUse(data: {
    projectId?: ProjectIdInput;
    products: ReadonlyArray<ProductKey>;
  }): void {
    const key: string = toProjectKey(
      data.projectId === undefined
        ? ProjectUtil.getCurrentProjectId()
        : data.projectId,
    );
    const entry: ProjectEntry | undefined = key
      ? ProjectProducts.entries.get(key)
      : undefined;

    if (!entry) {
      return;
    }

    const waiting: Array<ProductKey> = data.products.filter(
      (product: ProductKey): boolean => {
        const said: ProductUsage | undefined =
          entry.state.answer.usage[product];

        return said !== undefined && said !== ProductUsage.InUse;
      },
    );

    if (waiting.length === 0) {
      return;
    }

    const now: number = Date.now();
    const products: Set<ProductKey> = new Set<ProductKey>(
      entry.expected && now < entry.expected.until
        ? entry.expected.products
        : [],
    );

    for (const product of waiting) {
      products.add(product);
    }

    entry.expected = { products: products, until: now + EXPECT_CHANGE_FOR_MS };
    entry.answeredAt = null;

    // A request already out: its answer decides when to ask next.
    if (entry.request) {
      return;
    }

    ProjectProducts.cancelFollowUp(entry);
    ProjectProducts.ask(key, entry).catch(() => {
      // The store keeps what it knew; the next ask tries again.
    });
  }

  /*
   * Another tab of this browser remembered an answer (the storage event,
   * which every other tab of the same address hears): this tab takes it,
   * asking nothing - a monitor made there, a project's last monitor deleted
   * there, shows here at once. The products this tab created a record of
   * keep their mark (keepCreatedInUse), and a tab still waiting for its own
   * delete or a guide's products still asks when it meant to. Storage
   * cleared has the next look ask. Anything else is let be: a key of
   * something else, a project nothing here has drawn, a removed or
   * unreadable answer.
   */
  public static noteRememberedElsewhere(data: {
    key: string | null;
    newValue: string | null;
  }): void {
    if (data.key === null) {
      for (const entry of ProjectProducts.entries.values()) {
        entry.answeredAt = null;
      }

      return;
    }

    const key: string | null = projectOfRememberedKey(data.key);
    const entry: ProjectEntry | undefined = key
      ? ProjectProducts.entries.get(key)
      : undefined;

    if (!key || !entry) {
      return;
    }

    const answer: ProjectProductsAnswer | null = parseRemembered(data.newValue);

    if (!answer) {
      return;
    }

    const now: number = Date.now();
    const kept: ProjectProductsAnswer = keepCreatedInUse(entry, answer, now);

    if (isSameAnswer(kept, entry.state.answer)) {
      return;
    }

    entry.state = { ...entry.state, answer: kept };
    ProjectProducts.planFollowUp(key, entry, now);
    ProjectProducts.emit();
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
    const now: number = Date.now();
    const kept: ProjectProductsAnswer = keepCreatedInUse(entry, answer, now);

    entry.generation++;
    entry.request = null;
    entry.answeredAt = now < entry.settlingUntil ? null : now;
    entry.state = { answer: kept, isFresh: true, error: null };
    remember(key, kept);
    ProjectProducts.planFollowUp(key, entry, now);
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
    for (const [key, entry] of ProjectProducts.entries.entries()) {
      ProjectProducts.cancelFollowUp(entry);

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
      answeredAt: null,
      created: new Map<ProductKey, number>(),
      settlingUntil: 0,
      expected: null,
      followUp: null,
    };

    ProjectProducts.entries.set(key, entry);

    return entry;
  }

  private static ask(key: string, entry: ProjectEntry): Promise<void> {
    entry.generation++;

    const generation: number = entry.generation;
    const askedAt: number = Date.now();
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
        const kept: ProjectProductsAnswer = keepCreatedInUse(
          entry,
          answer,
          askedAt,
        );

        /*
         * Asked before every server knew of a delete this page made: drawn,
         * but not kept as current - the next look asks again, and so does
         * the store itself (planFollowUp).
         */
        entry.answeredAt = askedAt < entry.settlingUntil ? null : askedAt;
        entry.state = { answer: kept, isFresh: true, error: null };
        remember(key, kept);
      } else {
        entry.state = { ...entry.state, error: error };
      }

      ProjectProducts.planFollowUp(key, entry, askedAt);
      ProjectProducts.emit();
    })();

    entry.request = request;

    return request;
  }

  /*
   * After an answer (or a failed ask): whether the store asks again by
   * itself, and when. A delete this page made that the answer may not know
   * of yet asks once every server does (settlingUntil); a guide's products
   * not in use yet ask every EXPECT_CHANGE_EVERY_MS until they are, or
   * until the guide's wait is over. Otherwise nothing more is asked.
   */
  private static planFollowUp(
    key: string,
    entry: ProjectEntry,
    askedAt: number,
  ): void {
    const now: number = Date.now();

    if (entry.expected) {
      for (const product of Array.from(entry.expected.products)) {
        const said: ProductUsage | undefined =
          entry.state.answer.usage[product];

        if (said === undefined || said === ProductUsage.InUse) {
          entry.expected.products.delete(product);
        }
      }

      if (entry.expected.products.size === 0 || now >= entry.expected.until) {
        entry.expected = null;
      }
    }

    let askAt: number | null =
      askedAt < entry.settlingUntil ? entry.settlingUntil : null;

    if (entry.expected) {
      const nextLook: number = Math.min(
        now + EXPECT_CHANGE_EVERY_MS,
        entry.expected.until,
      );

      askAt = askAt === null ? nextLook : Math.min(askAt, nextLook);
    }

    if (askAt === null) {
      ProjectProducts.cancelFollowUp(entry);
      return;
    }

    ProjectProducts.scheduleFollowUp(key, entry, askAt);
  }

  /*
   * The store's one next ask of the project, at `askAt`: it replaces any
   * other. When it comes, a request already out stands for it (its answer
   * plans what follows), and a project forgotten since asks nothing.
   */
  private static scheduleFollowUp(
    key: string,
    entry: ProjectEntry,
    askAt: number,
  ): void {
    ProjectProducts.cancelFollowUp(entry);

    entry.followUp = setTimeout(
      (): void => {
        entry.followUp = null;

        if (ProjectProducts.entries.get(key) !== entry || entry.request) {
          return;
        }

        ProjectProducts.ask(key, entry).catch(() => {
          // The store keeps what it knew; the next ask tries again.
        });
      },
      Math.max(0, askAt - Date.now()),
    );
  }

  private static cancelFollowUp(entry: ProjectEntry): void {
    if (entry.followUp) {
      clearTimeout(entry.followUp);
      entry.followUp = null;
    }
  }

  // The project a record is of: the one it names, else the open one.
  private static keyOfRecord(record: RecordOfProject): string {
    return toProjectKey(record.projectId || ProjectUtil.getCurrentProjectId());
  }

  private static emit(): void {
    for (const listener of ProjectProducts.listeners) {
      listener();
    }
  }
}

// Every record this page creates or deletes, for as long as the page lives.
RecordChanges.subscribe((change: RecordChange): void => {
  if (change.kind === RecordChangeKind.Deleted) {
    ProjectProducts.noteRecordDeleted(change);
    return;
  }

  ProjectProducts.noteRecordCreated(change);
});

/*
 * Every answer another tab of this browser remembers (#8204). The storage
 * event reaches every tab of the address but the one that wrote, and only
 * when the value changed.
 */
try {
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("storage", (event: StorageEvent): void => {
      ProjectProducts.noteRememberedElsewhere({
        key: event.key,
        newValue: event.newValue,
      });
    });
  }
} catch {
  // No other tab is heard: each still asks on its next look.
}
