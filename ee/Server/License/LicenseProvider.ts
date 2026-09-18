import type { EnterpriseLicensingProvider } from "Common/Server/Enterprise/EnterpriseServerModule";
import {
  EnterpriseLicenseSnapshot,
  EnterpriseLicenseSnapshotUtil,
  SeatUsage,
} from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import UserService from "Common/Server/Services/UserService";
import logger from "Common/Server/Utils/Logger";
import PositiveNumber from "Common/Types/PositiveNumber";
import EnterpriseLicenseSeatUtil from "./EnterpriseLicenseSeatUtil";
import LicenseInputsUtil, { LicenseInputs } from "./LicenseInputs";
import {
  LICENSE_INPUTS_CACHE_TTL_IN_MS,
  LICENSE_INPUTS_RETRY_AFTER_FAILURE_IN_MS,
} from "./LicenseSettings";
import LicenseStore from "./LicenseStore";
import { LicenseTokenClassification } from "./LicenseToken";

/*
 * The licensing half of the enterprise module: what core's EnterpriseEdition
 * facade asks whenever it needs to know whether this installation is licensed.
 *
 * It caches the license INPUTS read from GlobalConfig - never the verdict -
 * and classifies them against the current time on every read, so the moment a
 * license expires or its grace period ends is exact however long the inputs
 * were cached.
 *
 *   - Inputs are trusted for LICENSE_INPUTS_CACHE_TTL_IN_MS. A license written
 *     by another process (the worker's daily report, an activation served by
 *     another replica) is seen here within that long; a write made by this
 *     process refreshes the cache at once.
 *   - A failed read keeps the last good inputs. It never drops a licensed
 *     installation to "missing" because the database hiccuped.
 *   - Until the first read succeeds, getCachedSnapshot() is null and the
 *     synchronous permission checks fail closed.
 */

export interface LicenseProviderDependencies {
  loadInputs: (now: Date) => Promise<LicenseInputs>;
  now: () => Date;
  getLocalUserCount: () => Promise<number>;
  isBillingEnabled: () => boolean;
  cacheTtlInMs: number;
  retryAfterFailureInMs: number;
}

export const getDefaultLicenseProviderDependencies: () => LicenseProviderDependencies =
  (): LicenseProviderDependencies => {
    return {
      loadInputs: (now: Date): Promise<LicenseInputs> => {
        return LicenseStore.loadLicenseInputs(now);
      },
      now: (): Date => {
        return new Date();
      },
      /*
       * Every user on this installation, not just one project's: a seat is
       * consumed by a person existing here, whichever door they came through.
       */
      getLocalUserCount: async (): Promise<number> => {
        const userCount: PositiveNumber = await UserService.countBy({
          query: {},
          props: {
            isRoot: true,
          },
        });

        return userCount.toNumber();
      },
      // Read at call time, so a test (or a config reload) is seen immediately.
      isBillingEnabled: (): boolean => {
        return IsBillingEnabled;
      },
      cacheTtlInMs: LICENSE_INPUTS_CACHE_TTL_IN_MS,
      retryAfterFailureInMs: LICENSE_INPUTS_RETRY_AFTER_FAILURE_IN_MS,
    };
  };

const describeError: (err: unknown) => string = (err: unknown): string => {
  return err instanceof Error ? err.message : String(err);
};

export class LicenseProvider implements EnterpriseLicensingProvider {
  private readonly dependencies: LicenseProviderDependencies;

  private inputs: LicenseInputs | null = null;
  private inputsLoadedAtInMs: number = 0;
  // The sequence number of the load whose result `inputs` holds.
  private appliedLoadSequence: number = 0;
  // Every load started so far has a number; the next one gets this plus one.
  private lastLoadSequence: number = 0;
  // Loads numbered at or below this started before an invalidation: stale.
  private invalidatedThroughLoadSequence: number = 0;

  private inFlightLoad: Promise<LicenseInputs | null> | null = null;
  private inFlightLoadSequence: number = 0;

  private lastFailedLoadAtInMs: number | null = null;
  private lastLoadError: string | null = null;

  public constructor(dependencies?: Partial<LicenseProviderDependencies>) {
    this.dependencies = {
      ...getDefaultLicenseProviderDependencies(),
      ...(dependencies || {}),
    };
  }

  public async getSnapshot(): Promise<EnterpriseLicenseSnapshot> {
    const inputs: LicenseInputs | null = await this.getInputs();

    if (!inputs) {
      /*
       * Nothing has ever been read. Fail closed: "missing" entitles nothing,
       * and the message says why, so the admin dialog does not claim there is
       * no license when the truth is that it could not be read.
       */
      return EnterpriseLicenseSnapshotUtil.createMissing(
        `The OneUptime Enterprise license could not be read${
          this.lastLoadError ? `: ${this.lastLoadError}` : "."
        }`,
      );
    }

    return this.computeSnapshot(inputs);
  }

  public getCachedSnapshot(): EnterpriseLicenseSnapshot | null {
    this.startBackgroundLoadIfStale();

    if (!this.inputs) {
      return null;
    }

    return this.computeSnapshot(this.inputs);
  }

  // Re-reads the inputs now. Never throws: a failed read keeps the last good ones.
  public async refresh(): Promise<void> {
    this.invalidatedThroughLoadSequence = this.lastLoadSequence;
    await this.startLoad();
  }

  /*
   * Marks the cached inputs stale. They stay as the fallback until the reload
   * that starts here lands, so a permission check in between still sees the
   * last good license rather than none at all.
   */
  public invalidate(): void {
    this.invalidatedThroughLoadSequence = this.lastLoadSequence;
    this.startBackgroundLoadIfStale();
  }

  public async getSeatUsage(): Promise<SeatUsage | null> {
    if (this.dependencies.isBillingEnabled()) {
      return null;
    }

    const inputs: LicenseInputs | null = await this.getInputs();

    if (!inputs) {
      return null;
    }

    return await EnterpriseLicenseSeatUtil.getSeatUsageForLicense({
      inputs,
      snapshot: this.computeSnapshot(inputs),
      getLocalUserCount: this.dependencies.getLocalUserCount,
    });
  }

  /*
   * Throws when one more user would exceed the license's seat limit. Only
   * with billing off (oneuptime.com bounds seats through subscriptions) and
   * only while the license is valid or in grace: an expired or missing license
   * stops limiting seats rather than locking anybody out.
   */
  public async assertSeatAvailableForNewUser(): Promise<void> {
    if (this.dependencies.isBillingEnabled()) {
      return;
    }

    const inputs: LicenseInputs | null = await this.getInputs();

    if (!inputs) {
      return;
    }

    await EnterpriseLicenseSeatUtil.assertSeatAvailableForNewUser({
      inputs,
      snapshot: this.computeSnapshot(inputs),
      getLocalUserCount: this.dependencies.getLocalUserCount,
    });
  }

  /*
   * The inputs, reloaded first when they are stale. Null only when nothing
   * has ever been read successfully.
   */
  public async getInputs(): Promise<LicenseInputs | null> {
    if (this.isFresh()) {
      return this.inputs;
    }

    if (this.inputs && this.isInFailureBackoff()) {
      return this.inputs;
    }

    const loaded: LicenseInputs | null =
      this.inFlightLoad &&
      this.inFlightLoadSequence > this.invalidatedThroughLoadSequence
        ? await this.inFlightLoad
        : await this.startLoad();

    return loaded || this.inputs;
  }

  // The inputs held right now, without reading anything.
  public getCachedInputs(): LicenseInputs | null {
    return this.inputs;
  }

  // The full classification (reason, kid, ...) for ee's own callers.
  public async getClassification(): Promise<LicenseTokenClassification | null> {
    const inputs: LicenseInputs | null = await this.getInputs();

    if (!inputs) {
      return null;
    }

    return LicenseInputsUtil.classify(inputs, this.dependencies.now());
  }

  public getLastLoadError(): string | null {
    return this.lastLoadError;
  }

  private computeSnapshot(inputs: LicenseInputs): EnterpriseLicenseSnapshot {
    return LicenseInputsUtil.toSnapshot(
      LicenseInputsUtil.classify(inputs, this.dependencies.now()),
    );
  }

  private nowInMs(): number {
    return this.dependencies.now().getTime();
  }

  private isFresh(): boolean {
    return (
      this.inputs !== null &&
      this.appliedLoadSequence > this.invalidatedThroughLoadSequence &&
      this.nowInMs() - this.inputsLoadedAtInMs < this.dependencies.cacheTtlInMs
    );
  }

  private isInFailureBackoff(): boolean {
    return (
      this.lastFailedLoadAtInMs !== null &&
      this.nowInMs() - this.lastFailedLoadAtInMs <
        this.dependencies.retryAfterFailureInMs
    );
  }

  private startBackgroundLoadIfStale(): void {
    if (this.isFresh() || this.isInFailureBackoff()) {
      return;
    }

    if (
      this.inFlightLoad &&
      this.inFlightLoadSequence > this.invalidatedThroughLoadSequence
    ) {
      return;
    }

    void this.startLoad();
  }

  /*
   * Starts a read. Loads may overlap (a refresh after a write must not join a
   * read that began before the write), so each carries a sequence number and
   * an older load never overwrites a newer one's result.
   */
  private startLoad(): Promise<LicenseInputs | null> {
    this.lastLoadSequence++;
    const sequence: number = this.lastLoadSequence;
    const startedAt: Date = this.dependencies.now();

    const load: Promise<LicenseInputs | null> = Promise.resolve()
      .then((): Promise<LicenseInputs> => {
        return this.dependencies.loadInputs(startedAt);
      })
      .then(
        (inputs: LicenseInputs): LicenseInputs => {
          if (sequence > this.appliedLoadSequence) {
            this.inputs = inputs;
            this.appliedLoadSequence = sequence;
            this.inputsLoadedAtInMs = this.nowInMs();
          }

          this.lastFailedLoadAtInMs = null;
          this.lastLoadError = null;

          return inputs;
        },
        (err: unknown): null => {
          this.lastFailedLoadAtInMs = this.nowInMs();
          this.lastLoadError = describeError(err);

          logger.warn(
            this.inputs
              ? `OneUptime Enterprise Edition: could not re-read the license; keeping the license read earlier. ${this.lastLoadError}`
              : `OneUptime Enterprise Edition: could not read the license; enterprise configuration stays read-only until it can be read. ${this.lastLoadError}`,
          );

          return null;
        },
      )
      .finally((): void => {
        if (this.inFlightLoad === load) {
          this.inFlightLoad = null;
        }
      });

    this.inFlightLoad = load;
    this.inFlightLoadSequence = sequence;

    return load;
  }
}

/*
 * The one provider of this process. The enterprise module hands it to core,
 * and the license client's routes and jobs refresh it after they write.
 */
const licenseProvider: LicenseProvider = new LicenseProvider();

export default licenseProvider;
