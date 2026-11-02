import logger from "Common/Server/Utils/Logger";
import { SessionLengths } from "Common/Types/UserSession/SessionLength";
import SessionLengthStore from "./SessionLengthStore";

/*
 * The session lengths this process holds, and what core is told
 * (EnterpriseServerModule.getUserSessionLengths): how long sign-ins last
 * on this server, asked at every sign-in, renewal and request that carries
 * a session.
 *
 *   - Read at boot (SessionLengthArea.init), and read again once they are
 *     older than SESSION_LENGTHS_CACHE_TTL_IN_MS: the ask is answered from
 *     what is held while the new read is on its way.
 *   - A change - made on this server or announced from another one
 *     (RealtimeAccessChanges) - forgets them (forget): the next ask waits
 *     for a read made after the change, so a shorter length applies to the
 *     very next request. A read that was on its way when the change came is
 *     never kept in place of it.
 *   - A read that fails keeps what was read before, and is tried again
 *     after SESSION_LENGTHS_RETRY_AFTER_FAILURE_IN_MS, so a database blip
 *     never changes how long anyone's sign-in lasts. With nothing read yet
 *     at all, the ask throws: a session check that cannot know the lengths
 *     refuses, rather than let a session last longer than it may.
 *
 * The license does not decide here. Setting or changing the lengths needs
 * it (EditionPermissions); once set they keep applying when it lapses, as
 * custom roles and IP allowlists do, and they can always be removed.
 */

export const SESSION_LENGTHS_CACHE_TTL_IN_MS: number = 30 * 1000;

export const SESSION_LENGTHS_RETRY_AFTER_FAILURE_IN_MS: number = 5 * 1000;

export const SESSION_LENGTHS_UNREAD_MESSAGE: string =
  "The server's session lengths could not be read yet, so no session can be checked against them. Try again in a moment.";

export interface SessionLengthProviderDependencies {
  loadLengths: () => Promise<SessionLengths>;
  now: () => Date;
  cacheTtlInMs: number;
  retryAfterFailureInMs: number;
}

export const getDefaultSessionLengthProviderDependencies: () => SessionLengthProviderDependencies =
  (): SessionLengthProviderDependencies => {
    return {
      loadLengths: (): Promise<SessionLengths> => {
        return SessionLengthStore.readLengths();
      },
      now: (): Date => {
        return new Date();
      },
      cacheTtlInMs: SESSION_LENGTHS_CACHE_TTL_IN_MS,
      retryAfterFailureInMs: SESSION_LENGTHS_RETRY_AFTER_FAILURE_IN_MS,
    };
  };

// One read of the lengths, and the change it was made after.
interface SessionLengthsLoad {
  generation: number;
  promise: Promise<SessionLengths | null>;
}

export class SessionLengthProvider {
  private readonly dependencies: SessionLengthProviderDependencies;

  // Undefined until the first read lands.
  private lengths: SessionLengths | undefined = undefined;
  private loadedAtInMs: number = 0;
  // The change the lengths held were read after.
  private loadedGeneration: number = -1;
  // Moves on at every change (forget).
  private generation: number = 0;
  private lastFailedAtInMs: number | null = null;
  private inFlightLoad: SessionLengthsLoad | null = null;

  public constructor(
    dependencies?: Partial<SessionLengthProviderDependencies>,
  ) {
    this.dependencies = {
      ...getDefaultSessionLengthProviderDependencies(),
      ...(dependencies || {}),
    };
  }

  /*
   * The lengths, as described above. Throws only while nothing has been
   * read, and the read made for this ask failed too.
   */
  public async getLengths(): Promise<SessionLengths> {
    const held: SessionLengths | undefined = this.lengths;

    if (held && this.isCurrent()) {
      if (!this.isFresh() && !this.isInFailureBackoff()) {
        // Read again in the background; this ask is answered now.
        void this.loadCurrent();
      }

      return held;
    }

    // Never read, or read before the last change: wait for a new read.
    if (!this.isInFailureBackoff()) {
      const loaded: SessionLengths | null = await this.loadCurrent();

      if (loaded) {
        return loaded;
      }
    }

    if (held) {
      return held;
    }

    throw new Error(SESSION_LENGTHS_UNREAD_MESSAGE);
  }

  /*
   * The lengths have just changed: the next ask waits for a read made after
   * now. Never throws.
   */
  public forget(): void {
    this.generation++;
    // A change was just written: the database answers, so read at once.
    this.lastFailedAtInMs = null;
  }

  // Reads the lengths now (at boot). Never throws: a failed read is logged and tried again on the next ask.
  public async refresh(): Promise<SessionLengths | null> {
    return await this.loadCurrent();
  }

  private nowInMs(): number {
    return this.dependencies.now().getTime();
  }

  private isCurrent(): boolean {
    return this.loadedGeneration === this.generation;
  }

  private isFresh(): boolean {
    return this.nowInMs() - this.loadedAtInMs < this.dependencies.cacheTtlInMs;
  }

  private isInFailureBackoff(): boolean {
    return (
      this.lastFailedAtInMs !== null &&
      this.nowInMs() - this.lastFailedAtInMs <
        this.dependencies.retryAfterFailureInMs
    );
  }

  /*
   * A read made after the last change: the one already on its way when it
   * was started after it, or a new one. Resolves to null when it fails.
   */
  private loadCurrent(): Promise<SessionLengths | null> {
    if (this.inFlightLoad && this.inFlightLoad.generation === this.generation) {
      return this.inFlightLoad.promise;
    }

    const generation: number = this.generation;

    const promise: Promise<SessionLengths | null> = Promise.resolve()
      .then((): Promise<SessionLengths> => {
        return this.dependencies.loadLengths();
      })
      .then(
        (lengths: SessionLengths): SessionLengths => {
          // Never keep a read older than the lengths held.
          if (generation >= this.loadedGeneration) {
            this.lengths = lengths;
            this.loadedGeneration = generation;
            this.loadedAtInMs = this.nowInMs();
          }

          this.lastFailedAtInMs = null;

          return lengths;
        },
        (err: unknown): null => {
          this.lastFailedAtInMs = this.nowInMs();

          logger.warn(
            `OneUptime Enterprise Edition: could not read the session lengths; ${
              this.lengths
                ? "keeping the lengths read earlier"
                : "sessions cannot be checked against them until they can be read"
            }. ${err instanceof Error ? err.message : String(err)}`,
          );

          return null;
        },
      )
      .finally((): void => {
        if (this.inFlightLoad && this.inFlightLoad.promise === promise) {
          this.inFlightLoad = null;
        }
      });

    this.inFlightLoad = { generation, promise };

    return promise;
  }
}

const sessionLengthProvider: SessionLengthProvider =
  new SessionLengthProvider();

export default sessionLengthProvider;
