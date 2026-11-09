/*
 * THE SLOS OF A BULK "ADD RECOMMENDED RULES", SENT A BATCH AT A TIME.
 *
 * The bulk add route takes many SLOs a request (SloBulkRecommendedBurnRate
 * Rules), and the progress dialog counts SLOs, one at a time, as the shared
 * runner reports them (runBulkAction). This joins the two: the runner runs
 * one step per SLO, each step asks for its SLO here, and here the SLOs are
 * sent in batches of `batchSize`, in the order the run names them, one
 * batch per request - so a run of 300 SLOs is 30 requests, and the bar
 * moves as each answers.
 *
 * A batch is sent once every SLO of it has been asked for, and holds only
 * the SLOs that were: an SLO the run never started (the person pressed
 * Stop) is never sent, so the result never calls an SLO "not started" that
 * the server changed. The runner starts a batch's SLOs together - it runs
 * `batchSize` steps at once, and every step of a batch waits for the same
 * answer - so a batch is only ever cut short by a Stop, when what was asked
 * for is sent (onStop).
 *
 * The runner must run at least `batchSize` steps at once, or a batch would
 * wait for SLOs that wait for it.
 */

export interface SloRecommendedRulesBatchesOptions<TAnswer> {
  // The SLOs that are sent, in the order the run starts them.
  ids: ReadonlyArray<string>;
  batchSize: number;
  // One request: the answer for each SLO of it, by id.
  send: (ids: Array<string>) => Promise<Map<string, TAnswer>>;
}

interface Batch<TAnswer> {
  ids: Array<string>;
  asked: Set<string>;
  isSent: boolean;
  answer: Promise<Map<string, TAnswer>>;
  resolve: (answer: Map<string, TAnswer>) => void;
  reject: (error: unknown) => void;
}

export default class SloRecommendedRulesBatches<TAnswer> {
  private batches: Array<Batch<TAnswer>> = [];
  private batchOf: Map<string, Batch<TAnswer>> = new Map();
  private send: (ids: Array<string>) => Promise<Map<string, TAnswer>>;

  public constructor(options: SloRecommendedRulesBatchesOptions<TAnswer>) {
    this.send = options.send;

    const size: number = Math.max(1, Math.floor(options.batchSize) || 1);
    let current: Batch<TAnswer> | null = null;

    for (const id of options.ids) {
      // An SLO named twice is sent once, and both steps read its answer.
      if (this.batchOf.has(id)) {
        continue;
      }

      if (!current || current.ids.length >= size) {
        current = this.createBatch();
        this.batches.push(current);
      }

      current.ids.push(id);
      this.batchOf.set(id, current);
    }
  }

  public get batchCount(): number {
    return this.batches.length;
  }

  /*
   * The answer for one SLO of the run, once its batch has been answered:
   * undefined when the answer leaves it out. A request that fails rejects
   * every SLO of its batch with that error.
   */
  public async run(id: string): Promise<TAnswer | undefined> {
    const batch: Batch<TAnswer> | undefined = this.batchOf.get(id);

    if (!batch) {
      throw new Error(`${id} is not one of the SLOs this run adds to.`);
    }

    batch.asked.add(id);

    if (batch.asked.size === batch.ids.length) {
      this.sendBatch(batch);
    }

    const answer: Map<string, TAnswer> = await batch.answer;

    return answer.get(id);
  }

  /*
   * The person pressed Stop: a batch only part asked for is sent as it is,
   * so the SLOs that were started are answered, and the others never sent.
   */
  public onStop(): void {
    for (const batch of this.batches) {
      if (!batch.isSent && batch.asked.size > 0) {
        this.sendBatch(batch);
      }
    }
  }

  private sendBatch(batch: Batch<TAnswer>): void {
    if (batch.isSent) {
      return;
    }

    batch.isSent = true;

    const ids: Array<string> = batch.ids.filter((id: string): boolean => {
      return batch.asked.has(id);
    });

    // A send that throws at once fails the whole batch too, never one step.
    Promise.resolve()
      .then((): Promise<Map<string, TAnswer>> => {
        return this.send(ids);
      })
      .then(batch.resolve, batch.reject);
  }

  private createBatch(): Batch<TAnswer> {
    let resolve: (answer: Map<string, TAnswer>) => void = (): void => {};
    let reject: (error: unknown) => void = (): void => {};

    const answer: Promise<Map<string, TAnswer>> = new Promise<
      Map<string, TAnswer>
    >(
      (
        resolveAnswer: (answer: Map<string, TAnswer>) => void,
        rejectAnswer: (error: unknown) => void,
      ): void => {
        resolve = resolveAnswer;
        reject = rejectAnswer;
      },
    );

    /*
     * Every step that waits on the batch reads its failure itself; this
     * only keeps the failure from also being reported as unhandled.
     */
    answer.catch((): void => {
      // Read by the steps.
    });

    return {
      ids: [],
      asked: new Set<string>(),
      isSent: false,
      answer: answer,
      resolve: (value: Map<string, TAnswer>): void => {
        resolve(value);
      },
      reject: (error: unknown): void => {
        reject(error);
      },
    };
  }
}
