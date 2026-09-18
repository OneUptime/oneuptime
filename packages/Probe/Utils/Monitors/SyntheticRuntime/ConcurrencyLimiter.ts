type ReleaseFunction = () => void;

const DEFAULT_PENDING_EXECUTIONS_PER_SLOT: number = 4;
const MAXIMUM_DEFAULT_PENDING_EXECUTIONS: number = 1000;

interface PendingAcquire {
  readonly resolve: (release: ReleaseFunction) => void;
  timeout: ReturnType<typeof setTimeout> | undefined;
}

export default class ConcurrencyLimiter {
  private readonly concurrencyLimit: number;
  private readonly maxPendingCount: number;
  private activeCountValue: number = 0;
  private readonly pendingAcquires: PendingAcquire[] = [];

  public constructor(
    concurrencyLimit: number,
    maxPendingCount: number = Math.min(
      MAXIMUM_DEFAULT_PENDING_EXECUTIONS,
      concurrencyLimit * DEFAULT_PENDING_EXECUTIONS_PER_SLOT,
    ),
  ) {
    if (!Number.isSafeInteger(concurrencyLimit) || concurrencyLimit < 1) {
      throw new Error(
        "Synthetic runtime concurrency limit must be a positive integer.",
      );
    }
    if (!Number.isSafeInteger(maxPendingCount) || maxPendingCount < 0) {
      throw new Error(
        "Synthetic runtime pending limit must be a non-negative integer.",
      );
    }

    this.concurrencyLimit = concurrencyLimit;
    this.maxPendingCount = maxPendingCount;
  }

  public get activeCount(): number {
    return this.activeCountValue;
  }

  public get pendingCount(): number {
    return this.pendingAcquires.length;
  }

  public get limit(): number {
    return this.concurrencyLimit;
  }

  public get pendingLimit(): number {
    return this.maxPendingCount;
  }

  public async run<Result>(
    operation: () => Promise<Result>,
    queueTimeoutInMs?: number | undefined,
  ): Promise<Result> {
    if (
      queueTimeoutInMs !== undefined &&
      (!Number.isSafeInteger(queueTimeoutInMs) || queueTimeoutInMs < 1)
    ) {
      throw new Error(
        "Synthetic runtime queue timeout must be a positive integer.",
      );
    }

    const release: ReleaseFunction = await this.acquire(queueTimeoutInMs);

    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async acquire(
    queueTimeoutInMs?: number | undefined,
  ): Promise<ReleaseFunction> {
    if (this.activeCountValue < this.concurrencyLimit) {
      this.activeCountValue++;
      return this.createReleaseFunction();
    }

    if (this.pendingAcquires.length >= this.maxPendingCount) {
      throw new Error("Synthetic runtime execution queue is full.");
    }
    return new Promise<ReleaseFunction>(
      (
        resolve: (release: ReleaseFunction) => void,
        reject: (error: Error) => void,
      ) => {
        const pending: PendingAcquire = {
          resolve,
          timeout: undefined,
        };
        if (queueTimeoutInMs !== undefined) {
          pending.timeout = global.setTimeout(() => {
            const index: number = this.pendingAcquires.indexOf(pending);
            if (index < 0) {
              return;
            }

            this.pendingAcquires.splice(index, 1);
            reject(
              new Error(
                "Synthetic runtime timed out waiting for an execution slot.",
              ),
            );
          }, queueTimeoutInMs);
        }
        this.pendingAcquires.push(pending);
      },
    );
  }

  private createReleaseFunction(): ReleaseFunction {
    let hasReleased: boolean = false;

    return (): void => {
      if (hasReleased) {
        return;
      }

      hasReleased = true;
      const next: PendingAcquire | undefined = this.pendingAcquires.shift();

      if (next) {
        if (next.timeout) {
          global.clearTimeout(next.timeout);
        }
        next.resolve(this.createReleaseFunction());
        return;
      }

      this.activeCountValue = Math.max(0, this.activeCountValue - 1);
    };
  }
}
