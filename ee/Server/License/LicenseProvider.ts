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
  LICENSE_SNAPSHOT_REUSE_IN_MS,
} from "./LicenseSettings";
import LicenseStore from "./LicenseStore";
import { LicenseTokenClassification } from "./LicenseToken";
import { getTrustedLicenseKeys, TrustedLicenseKey } from "./TrustedLicenseKeys";

/*
 * The licensing half of the enterprise module: what core's EnterpriseEdition
 * facade asks whenever it needs to know whether this installation is licensed.
 *
 * It caches the license INPUTS read from GlobalConfig and classifies them
 * against the current time, so the moment a license expires or its grace
 * period ends is exact however long the inputs were cached.
 *
 *   - The verdict is asked for on hot paths (EnterpriseEdition.isFeatureActive
 *     runs on every tenant request, every audit entry and every identity
 *     route), and classifying a signed license verifies its signature. So a
 *     computed snapshot is reused for the same inputs and trusted keys until
 *     the next moment its verdict can change (the license's expiry, or the end
 *     of its grace period or trial), and for LICENSE_SNAPSHOT_REUSE_IN_MS at
 *     most. Boundaries stay exact to the millisecond.
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
  // The longest a computed snapshot is reused (see getSnapshotReusableUntilInMs).
  snapshotReuseInMs: number;
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
      snapshotReuseInMs: LICENSE_SNAPSHOT_REUSE_IN_MS,
    };
  };

const describeError: (err: unknown) => string = (err: unknown): string => {
  return err instanceof Error ? err.message : String(err);
};

// A snapshot computed from one set of inputs, reusable until validUntilInMs.
interface ComputedSnapshot {
  inputs: LicenseInputs;
  trustedKeys: ReadonlyArray<TrustedLicenseKey>;
  snapshot: EnterpriseLicenseSnapshot;
  computedAtInMs: number;
  validUntilInMs: number;
}

/*
 * The first moment after `nowInMs` at which classifying the same inputs could
 * give another verdict, capped at `maxReuseInMs` from now. The classification
 * depends on time only through two dates the snapshot carries: a license is
 * valid until expiresAt, and in grace (after expiry, or in the unlicensed
 * trial) up to and including graceEndsAt.
 */
export const getSnapshotReusableUntilInMs: (
  snapshot: EnterpriseLicenseSnapshot,
  nowInMs: number,
  maxReuseInMs: number,
) => number = (
  snapshot: EnterpriseLicenseSnapshot,
  nowInMs: number,
  maxReuseInMs: number,
): number => {
  let reusableUntilInMs: number = nowInMs + Math.max(0, maxReuseInMs);

  const boundaries: Array<number> = [];

  if (snapshot.expiresAt instanceof Date) {
    boundaries.push(snapshot.expiresAt.getTime());
  }

  if (snapshot.graceEndsAt instanceof Date) {
    boundaries.push(snapshot.graceEndsAt.getTime() + 1);
  }

  for (const boundary of boundaries) {
    if (
      Number.isFinite(boundary) &&
      boundary > nowInMs &&
      boundary < reusableUntilInMs
    ) {
      reusableUntilInMs = boundary;
    }
  }

  return reusableUntilInMs;
};

/*
 * A copy for one caller, so a caller that changes the object it was handed
 * can never change what the next caller reads.
 */
const copySnapshot: (
  snapshot: EnterpriseLicenseSnapshot,
) => EnterpriseLicenseSnapshot = (
  snapshot: EnterpriseLicenseSnapshot,
): EnterpriseLicenseSnapshot => {
  const copy: EnterpriseLicenseSnapshot = {
    ...snapshot,
    features: Array.isArray(snapshot.features)
      ? [...snapshot.features]
      : snapshot.features,
  };

  if (snapshot.expiresAt instanceof Date) {
    copy.expiresAt = new Date(snapshot.expiresAt.getTime());
  }

  if (snapshot.graceEndsAt instanceof Date) {
    copy.graceEndsAt = new Date(snapshot.graceEndsAt.getTime());
  }

  return copy;
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

  private computedSnapshot: ComputedSnapshot | null = null;

  // How many times the inputs were classified (for tests).
  private classificationCount: number = 0;

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

  // How many times inputs have been classified into a snapshot (for tests).
  public getClassificationCount(): number {
    return this.classificationCount;
  }

  /*
   * The snapshot of `inputs` now. Reuses the last one computed while it is
   * for the same inputs object and the same trusted keys, the clock has not
   * gone backwards, and no boundary (see getSnapshotReusableUntilInMs) has
   * been reached. Every caller gets its own copy.
   */
  private computeSnapshot(inputs: LicenseInputs): EnterpriseLicenseSnapshot {
    const now: Date = this.dependencies.now();
    const nowInMs: number = now.getTime();
    const trustedKeys: ReadonlyArray<TrustedLicenseKey> =
      getTrustedLicenseKeys();
    const computed: ComputedSnapshot | null = this.computedSnapshot;

    if (
      computed &&
      computed.inputs === inputs &&
      computed.trustedKeys === trustedKeys &&
      nowInMs >= computed.computedAtInMs &&
      nowInMs < computed.validUntilInMs
    ) {
      return copySnapshot(computed.snapshot);
    }

    this.classificationCount++;

    const snapshot: EnterpriseLicenseSnapshot = LicenseInputsUtil.toSnapshot(
      LicenseInputsUtil.classify(inputs, now),
    );

    this.computedSnapshot = {
      inputs,
      trustedKeys,
      snapshot,
      computedAtInMs: nowInMs,
      validUntilInMs: getSnapshotReusableUntilInMs(
        snapshot,
        nowInMs,
        this.dependencies.snapshotReuseInMs,
      ),
    };

    return copySnapshot(snapshot);
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
