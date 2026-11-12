import OldestKeyMap from "../../Utils/OldestKeyMap";

/*
 * How many answers one person may give in an hour (issue #6832): far more
 * than anyone answers, and few enough that a stuck loop or a script cannot
 * fill the table. Kept in this process's memory, per person, for the
 * PRODUCT_FEEDBACK_RATE_WINDOW_MS window; the oldest people are forgotten
 * first once PRODUCT_FEEDBACK_RATE_MAX_PEOPLE are kept.
 */
export const PRODUCT_FEEDBACK_ANSWERS_PER_HOUR: number = 30;
export const PRODUCT_FEEDBACK_RATE_WINDOW_MS: number = 60 * 60 * 1000;
export const PRODUCT_FEEDBACK_RATE_MAX_PEOPLE: number = 10000;

export class ProductFeedbackRateLimit {
  private readonly answers: OldestKeyMap<string, Array<number>> =
    new OldestKeyMap<string, Array<number>>();

  public constructor(
    private readonly limit: number = PRODUCT_FEEDBACK_ANSWERS_PER_HOUR,
    private readonly windowMs: number = PRODUCT_FEEDBACK_RATE_WINDOW_MS,
    private readonly maxPeople: number = PRODUCT_FEEDBACK_RATE_MAX_PEOPLE,
  ) {}

  /*
   * Whether this person may give one more answer now; counts it when they
   * may.
   */
  public take(personId: string, nowMs: number): boolean {
    const recent: Array<number> = (this.answers.get(personId) || []).filter(
      (atMs: number): boolean => {
        return nowMs - atMs < this.windowMs;
      },
    );

    if (recent.length >= this.limit) {
      this.answers.set(personId, recent);
      return false;
    }

    recent.push(nowMs);
    this.answers.set(personId, recent);

    while (this.answers.size > this.maxPeople) {
      const oldest: string | undefined = this.answers.oldestKey();

      if (oldest === undefined) {
        break;
      }

      this.answers.delete(oldest);
    }

    return true;
  }

  public size(): number {
    return this.answers.size;
  }
}

export default new ProductFeedbackRateLimit();
