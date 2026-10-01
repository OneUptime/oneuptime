export type SleepFunction = (
  ms: number,
  signal?: AbortSignal | undefined,
) => Promise<void>;

/*
 * Wait ms, or until the signal aborts — whichever comes first. Resolves
 * either way (never rejects), so a loop that is shutting down simply wakes
 * up and checks whether it should go on.
 */
export const sleep: SleepFunction = (
  ms: number,
  signal?: AbortSignal | undefined,
): Promise<void> => {
  return new Promise<void>((resolve: () => void): void => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const onAbort: () => void = (): void => {
      clearTimeout(timer);
      resolve();
    };

    const timer: ReturnType<typeof setTimeout> = setTimeout(
      (): void => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      },
      Math.max(0, ms),
    );

    signal?.addEventListener("abort", onAbort, { once: true });
  });
};

// Resolves with the promise's outcome, or after ms, whichever is first.
export async function waitAtMost(
  promise: Promise<unknown> | null,
  ms: number,
): Promise<boolean> {
  if (!promise) {
    return true;
  }

  let timer: ReturnType<typeof setTimeout> | null = null;

  const settled: boolean = await Promise.race([
    promise.then(
      (): boolean => {
        return true;
      },
      (): boolean => {
        return true;
      },
    ),
    new Promise<boolean>((resolve: (value: boolean) => void): void => {
      timer = setTimeout((): void => {
        resolve(false);
      }, ms);
    }),
  ]);

  if (timer) {
    clearTimeout(timer);
  }

  return settled;
}
