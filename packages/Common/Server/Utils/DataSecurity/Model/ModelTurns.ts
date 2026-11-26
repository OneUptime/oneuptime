import { JSONObject } from "../../../../Types/JSON";
import { ModelStoreBudget } from "./ModelBudget";
import { CONTENT_STORE_KEY, ModelScanContext } from "./ModelScan";

/*
 * EVERY TABLE AND OBJECT TAKES ITS TURN AT THE MODEL'S TIME (#10928).
 *
 * A content scan gives the names-and-addresses model 2 minutes of a store
 * (ModelBudget), and read a database's tables, a dataset's tables, a
 * storage account's containers and a bucket's objects in the same order
 * every scan. In a store with more free text than 2 minutes reads, the same
 * first tables had the model's time every scan and the rest never did; and
 * a bucket's object the model had no time for was marked as read, and
 * skipped as unchanged for a week. Now each scan keeps where the model
 * stopped, in the store's content scan state, and the next scan's model
 * starts there:
 *
 *  - tables and containers: the name of the first whose free text the model
 *    did not read whole - first in the next scan, the rest after it in
 *    their order, then those before it (rotateForModel). One the model
 *    started its time on and could not finish is passed over: the turn
 *    goes to the one after it, so no table holds the model's time scan
 *    after scan. One a scan did not reach at all (its time limit, its
 *    bytes) is where the next one starts, if none stopped the model first;
 *  - a bucket's objects: one read while the model had no time for its
 *    free text stays due, read again next scan before any other
 *    (ObjectStoreSampler's modelPending), unless the model's time ran out
 *    on it whole.
 *
 * Only while the project has the model on: with it off, nothing turns, and
 * where the model cannot run, the turn stays where it was. A name is a
 * table's or a container's, never anything read.
 */

// The key of the model's turn in a store's content scan state.
export const MODEL_TURN_STATE_KEY: string = "model";

// The longest name a turn keeps: a schema-qualified table or a container.
const MAX_RESUME_NAME_LENGTH: number = 512;

// Where the model's turn starts in a store's next content scan, or null to start at the first.
export function readModelResumeAt(
  state: JSONObject | undefined | null,
): string | null {
  const turn: unknown = state?.[MODEL_TURN_STATE_KEY];

  if (!turn || typeof turn !== "object" || Array.isArray(turn)) {
    return null;
  }

  const resumeAt: unknown = (turn as JSONObject)["resumeAt"];

  return typeof resumeAt === "string" &&
    resumeAt.length > 0 &&
    resumeAt.length <= MAX_RESUME_NAME_LENGTH
    ? resumeAt
    : null;
}

// A state that keeps where the next scan's model starts - nothing when it starts at the first.
export function withModelResumeAt(
  state: JSONObject | undefined,
  resumeAt: string | null,
): JSONObject {
  const next: JSONObject = { ...(state || {}) };

  if (resumeAt && resumeAt.length <= MAX_RESUME_NAME_LENGTH) {
    next[MODEL_TURN_STATE_KEY] = { resumeAt };
  } else {
    delete next[MODEL_TURN_STATE_KEY];
  }

  return next;
}

/*
 * The items in the order the model reads them: from the one it is to
 * resume at, to the end, then from the first. One gone since is resumed
 * after where it was: at the first whose name sorts after it.
 */
export function rotateForModel<T>(
  items: ReadonlyArray<T>,
  nameOf: (item: T) => string,
  resumeAt: string | null,
): Array<T> {
  if (!resumeAt || items.length < 2) {
    return [...items];
  }

  let start: number = items.findIndex((item: T): boolean => {
    return nameOf(item) === resumeAt;
  });

  if (start < 0) {
    start = items.findIndex((item: T): boolean => {
      return nameOf(item) > resumeAt;
    });
  }

  if (start <= 0) {
    return [...items];
  }

  return [...items.slice(start), ...items.slice(0, start)];
}

/*
 * One scan's model, followed through a store's tables (or containers) in
 * the order it read them: which it read whole, and where the next scan's
 * turn starts.
 */
export class ModelTurnTracker {
  private readonly budget: ModelStoreBudget | null;
  private readonly previous: string | null;
  // The first item the model was handed free text of in this scan.
  private first: string | null = null;
  private resumeAt: string | null = null;
  private readBefore: number = 0;
  private toReadBefore: number = 0;

  public constructor(data: {
    model: ModelScanContext | undefined;
    // Where this scan's turn started (readModelResumeAt).
    previous: string | null;
  }) {
    this.budget = data.model
      ? data.model.budget.forStore(CONTENT_STORE_KEY)
      : null;
    this.previous = data.previous;
  }

  public get isTurning(): boolean {
    return this.budget !== null;
  }

  // Before an item's free text is handed to the model.
  public begin(): void {
    if (this.budget) {
      this.readBefore = this.budget.valuesRead;
      this.toReadBefore = this.budget.valuesToRead;
    }
  }

  /*
   * After it: whether it had free text, and the model read it whole. An
   * item the model did not read whole is where the next scan's turn
   * starts - or, when it is the first the model started on in this scan,
   * the one after it (`nextName`).
   */
  public end(
    name: string,
    nextName: string | null,
  ): { hadText: boolean; isReadWhole: boolean } {
    if (!this.budget) {
      return { hadText: false, isReadWhole: true };
    }

    const handed: number = this.budget.valuesToRead - this.toReadBefore;
    const read: number = this.budget.valuesRead - this.readBefore;

    if (handed <= 0) {
      return { hadText: false, isReadWhole: true };
    }

    const isFirst: boolean = this.first === null;

    if (isFirst) {
      this.first = name;
    }

    const isReadWhole: boolean = read >= handed;

    if (!isReadWhole && this.resumeAt === null) {
      this.resumeAt = isFirst ? nextName || name : name;
    }

    return { hadText: true, isReadWhole };
  }

  // An item the scan never reached: if the model did not stop first, the next turn starts there.
  public notReached(name: string): void {
    if (this.budget && this.resumeAt === null) {
      this.resumeAt = name;
    }
  }

  /*
   * Where the next scan's model starts: null when it read every free text
   * it was handed. Where it could not run at all, where this one started.
   */
  public get nextResumeAt(): string | null {
    if (!this.budget) {
      return null;
    }

    if (this.budget.unavailableReason) {
      return this.previous;
    }

    return this.resumeAt;
  }
}
