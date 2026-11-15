/*
 * THE READS OF ONE VIEW, A FEW AT A TIME.
 *
 * A page that answers with many independent reads - the Network Overview's
 * fleet tally, its attention lists, its site and endpoint counts - used to
 * start them all at once: ten statements, ten pooled connections held by
 * one request, and a pool of fifty filled by five people opening the page.
 * Every other request - a sign-in, a dashboard - waited behind them.
 *
 * A view hands its reads to ReadLanes instead, and at most `lanes` of them
 * run at once; the others wait their turn in the order they were handed
 * over, holding nothing. Once one fails, the reads still waiting fail with
 * it without running - the view is answered with that error anyway, and a
 * statement nobody will read the answer to is a connection taken for
 * nothing. Reads already running finish.
 */
export default class ReadLanes {
  private running: number = 0;
  private waiting: Array<() => void> = [];
  private failure: { error: unknown } | null = null;
  private mostRunning: number = 0;

  public constructor(private readonly lanes: number) {
    if (!Number.isSafeInteger(lanes) || lanes < 1) {
      throw new Error(
        `A view's reads need at least one lane to run in, not ${lanes}.`,
      );
    }
  }

  /*
   * Runs read when a lane is free, and answers what it answers. A read
   * handed over after another failed is not run: it fails with that error.
   */
  public run<T>(read: () => Promise<T>): Promise<T> {
    return new Promise<T>(
      (resolve: (value: T) => void, reject: (error: unknown) => void) => {
        const start: () => void = (): void => {
          if (this.failure) {
            reject(this.failure.error);
            this.startNext();
            return;
          }

          this.running++;
          this.mostRunning = Math.max(this.mostRunning, this.running);

          let reading: Promise<T>;

          try {
            reading = read();
          } catch (error) {
            reading = Promise.reject(error);
          }

          reading.then(
            (value: T): void => {
              this.running--;
              resolve(value);
              this.startNext();
            },
            (error: unknown): void => {
              this.running--;

              if (!this.failure) {
                this.failure = { error: error };
              }

              reject(error);
              this.startNext();
            },
          );
        };

        if (this.running < this.lanes && this.waiting.length === 0) {
          start();
        } else {
          this.waiting.push(start);
        }
      },
    );
  }

  // The most reads that ran at once so far.
  public getMostRunning(): number {
    return this.mostRunning;
  }

  private startNext(): void {
    while (this.running < this.lanes && this.waiting.length > 0) {
      const next: (() => void) | undefined = this.waiting.shift();

      if (next) {
        next();
      }
    }
  }
}
