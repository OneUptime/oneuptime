import Semaphore, {
  SemaphoreLockTimeoutError,
} from "../../../Server/Infrastructure/Semaphore";
import { getJestSpyOn } from "../../Spy";

/*
 * Locks held in memory behind Semaphore, as Valkey holds them: one holder
 * per key at a time, and a change that asks for a held lock WAITS until it
 * is given back - so tests can run two changes against each other and see
 * one wait for the other, in a set order, with nothing timed.
 *
 *   - lock() takes a free lock, or waits for the one holding it to give it
 *     back (or to lose it); a key marked busy refuses at once, as a lock
 *     held longer than a change waits does (SemaphoreLockTimeoutError);
 *   - keepLock() answers whether the lock is still its holder's;
 *   - release() gives a lock back - only the holder's own;
 *   - lose() takes a lock from its holder, as Valkey losing it does (a
 *     restart, an eviction, a lock that ran out): the holder finds out when
 *     it next keeps it, and a change waiting for it takes it.
 *
 * Every step is recorded in `events`: "lock:<key>", "wait:<key>",
 * "keep:<key>", "release:<key>", "lost:<key>". A key outside the sign-in
 * changes' namespace is recorded as "<namespace>/<key>".
 */

const SIGN_IN_NAMESPACE: string = "ProjectSsoProviderChanges.keepAWayIn";

export interface InMemoryLock {
  key: string;
  namespace: string;
}

export default class InMemoryLocks {
  public events: Array<string> = [];

  // Keys a lock() is refused for at once, as one held longer than a change waits.
  public busy: Set<string> = new Set<string>();

  // Valkey cannot be reached: lock() throws, keepLock() throws.
  public unreachable: boolean = false;

  // Told each time a change starts waiting for a lock, with its label.
  public onWait: ((label: string) => void) | null = null;

  private holders: Map<string, InMemoryLock> = new Map<string, InMemoryLock>();
  private waiters: Map<string, Array<() => void>> = new Map<
    string,
    Array<() => void>
  >();

  public install(): void {
    getJestSpyOn(Semaphore, "lock").mockImplementation((async (data: {
      key: string;
      namespace: string;
    }): Promise<InMemoryLock> => {
      return await this.lock(data.key, data.namespace);
    }) as never);

    getJestSpyOn(Semaphore, "release").mockImplementation((async (
      lock: InMemoryLock,
    ): Promise<void> => {
      this.release(lock);
    }) as never);

    getJestSpyOn(Semaphore, "keepLock").mockImplementation((async (
      lock: InMemoryLock,
    ): Promise<boolean> => {
      return this.keep(lock);
    }) as never);
  }

  // The lock of this key held now, if one is.
  public holderOf(
    key: string,
    namespace: string = SIGN_IN_NAMESPACE,
  ): InMemoryLock | undefined {
    return this.holders.get(InMemoryLocks.fullKey(key, namespace));
  }

  public isHeld(key: string, namespace: string = SIGN_IN_NAMESPACE): boolean {
    return Boolean(this.holderOf(key, namespace));
  }

  // How many changes wait for this key's lock now.
  public waitingFor(key: string, namespace: string = SIGN_IN_NAMESPACE): number {
    return (this.waiters.get(InMemoryLocks.fullKey(key, namespace)) || [])
      .length;
  }

  // Valkey loses the lock of this key: its holder no longer holds it.
  public lose(key: string, namespace: string = SIGN_IN_NAMESPACE): void {
    const fullKey: string = InMemoryLocks.fullKey(key, namespace);

    if (!this.holders.has(fullKey)) {
      return;
    }

    this.holders.delete(fullKey);
    this.events.push(`lost:${InMemoryLocks.label(key, namespace)}`);
    this.wakeNext(fullKey);
  }

  // The events of one kind, in order: "lock", "keep", "release", ...
  public eventsOf(kind: string): Array<string> {
    return this.events.filter((event: string): boolean => {
      return event.startsWith(`${kind}:`);
    });
  }

  private async lock(key: string, namespace: string): Promise<InMemoryLock> {
    if (this.unreachable) {
      throw new Error("Redis client is not connected");
    }

    const label: string = InMemoryLocks.label(key, namespace);

    if (this.busy.has(key)) {
      throw new SemaphoreLockTimeoutError(`Acquire mutex ${label} timeout`);
    }

    const fullKey: string = InMemoryLocks.fullKey(key, namespace);

    while (this.holders.has(fullKey)) {
      this.events.push(`wait:${label}`);

      const woken: Promise<void> = new Promise<void>(
        (resolve: () => void): void => {
          const queue: Array<() => void> = this.waiters.get(fullKey) || [];
          queue.push(resolve);
          this.waiters.set(fullKey, queue);
        },
      );

      this.onWait?.(label);

      await woken;
    }

    const lock: InMemoryLock = { key, namespace };
    this.holders.set(fullKey, lock);
    this.events.push(`lock:${label}`);

    return lock;
  }

  private release(lock: InMemoryLock): void {
    const fullKey: string = InMemoryLocks.fullKey(lock.key, lock.namespace);

    this.events.push(`release:${InMemoryLocks.label(lock.key, lock.namespace)}`);

    // Only the holder's own lock is given back: one lost already is someone else's now, or nobody's.
    if (this.holders.get(fullKey) !== lock) {
      return;
    }

    this.holders.delete(fullKey);
    this.wakeNext(fullKey);
  }

  private keep(lock: InMemoryLock): boolean {
    if (this.unreachable) {
      throw new Error("Redis client is not connected");
    }

    this.events.push(`keep:${InMemoryLocks.label(lock.key, lock.namespace)}`);

    return (
      this.holders.get(InMemoryLocks.fullKey(lock.key, lock.namespace)) === lock
    );
  }

  private wakeNext(fullKey: string): void {
    const queue: Array<() => void> = this.waiters.get(fullKey) || [];
    const next: (() => void) | undefined = queue.shift();

    if (queue.length === 0) {
      this.waiters.delete(fullKey);
    }

    next?.();
  }

  private static fullKey(key: string, namespace: string): string {
    return `${namespace}-${key}`;
  }

  private static label(key: string, namespace: string): string {
    return namespace === SIGN_IN_NAMESPACE ? key : `${namespace}/${key}`;
  }
}
