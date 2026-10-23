import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import UserService from "Common/Server/Services/UserService";
import logger from "Common/Server/Utils/Logger";
import SelfHostedMarketplaceConfig, {
  SelfHostedMarketplaceConfigResult,
  SelfHostedMarketplaceSettings,
} from "./Reporters/SelfHostedMarketplaceConfig";
import {
  SelfHostedMarketplaceReporter,
  SelfHostedUsageOutcome,
} from "./Reporters/SelfHostedMarketplaceReporter";
import EnterpriseMarketplaceBillingUtil, {
  EnterpriseMarketplaceBillingState,
  EnterpriseMarketplaceUsageReport,
} from "Common/Types/EnterpriseLicense/EnterpriseMarketplaceBilling";
import CloudMarketplace, {
  CloudMarketplaceUtil,
} from "Common/Types/Marketplace/CloudMarketplace";
import PositiveNumber from "Common/Types/PositiveNumber";
import licenseProvider from "../License/LicenseProvider";
import MarketplaceBilling, { PreparedReports } from "./MarketplaceBilling";
import MarketplaceBillingStore, {
  StoredMarketplaceBilling,
} from "./MarketplaceBillingStore";

/*
 * One run of the marketplace usage job (Jobs/ReportMarketplaceUsage.ts):
 * bills a self-hosted installation's users through the cloud marketplace it
 * was bought on, by the user-hour.
 *
 *   1. Only on a self-hosted installation (never OneUptime Cloud) that names
 *      a marketplace (ENTERPRISE_MARKETPLACE).
 *   2. Under a lock, so two workers never send the same hour.
 *   3. Count the users - every user of the installation, the people the
 *      Enterprise license counts as seats - and note them for this hour
 *      (MarketplaceBilling.observe). That happens even while the marketplace
 *      settings are incomplete, so usage is kept until they are fixed.
 *   4. Send what is due, oldest first. Each attempt is written down before
 *      it is sent, and each answer as soon as it comes, so a crash between
 *      the two can never bill an hour twice.
 *   5. When the marketplace confirmed or refused the subscription, refresh
 *      this process's license at once (other processes see it within a
 *      minute, as with any license change).
 */

// The usage job's name (Jobs/ReportMarketplaceUsage.ts), and how long a run may take.
export const REPORT_MARKETPLACE_USAGE_JOB_NAME: string =
  "EnterpriseMarketplace:ReportUsage";
export const REPORT_MARKETPLACE_USAGE_TIMEOUT_IN_MS: number = 10 * 60 * 1000;

export const MARKETPLACE_USAGE_LOCK_KEY: string =
  "enterprise-marketplace-usage";
export const MARKETPLACE_USAGE_LOCK_NAMESPACE: string = "EnterpriseMarketplace";
// Longer than any run: a few marketplace calls with 30-second deadlines.
export const MARKETPLACE_USAGE_LOCK_TIMEOUT_IN_MS: number = 10 * 60 * 1000;

export interface MarketplaceUsageRunDependencies {
  isBillingEnabled: () => boolean;
  readConfig: () => SelfHostedMarketplaceConfigResult;
  getReporter: (
    settings: SelfHostedMarketplaceSettings,
  ) => SelfHostedMarketplaceReporter;
  countUsers: () => Promise<number>;
  load: () => Promise<StoredMarketplaceBilling | null>;
  save: (state: EnterpriseMarketplaceBillingState) => Promise<void>;
  /*
   * Runs `work` holding the usage lock. Resolves to false, without running
   * it, when another run holds the lock.
   */
  withLock: (work: () => Promise<void>) => Promise<boolean>;
  refreshLicense: () => Promise<void>;
  now: () => Date;
}

export interface MarketplaceUsageRunReport {
  hourStart: string;
  quantity: number;
  outcome: SelfHostedUsageOutcome["kind"];
}

export type MarketplaceUsageRunResult =
  | { kind: "skipped"; reason: string }
  | {
      kind: "ran";
      marketplace: CloudMarketplace;
      users: number;
      reports: Array<MarketplaceUsageRunReport>;
      problems: Array<string>;
    };

/*
 * One reporter per process and settings: the AWS one caches its IRSA
 * session, the Microsoft one its token, the Google one its access token.
 */
let cachedReporter: {
  key: string;
  reporter: SelfHostedMarketplaceReporter;
} | null = null;

const getCachedReporter: (
  settings: SelfHostedMarketplaceSettings,
) => SelfHostedMarketplaceReporter = (
  settings: SelfHostedMarketplaceSettings,
): SelfHostedMarketplaceReporter => {
  const key: string = JSON.stringify(settings);

  if (!cachedReporter || cachedReporter.key !== key) {
    cachedReporter = {
      key,
      reporter: SelfHostedMarketplaceConfig.createReporter(settings),
    };
  }

  return cachedReporter.reporter;
};

export const getDefaultMarketplaceUsageRunDependencies: () => MarketplaceUsageRunDependencies =
  (): MarketplaceUsageRunDependencies => {
    return {
      isBillingEnabled: (): boolean => {
        return IsBillingEnabled;
      },
      readConfig: (): SelfHostedMarketplaceConfigResult => {
        return SelfHostedMarketplaceConfig.read();
      },
      getReporter: getCachedReporter,
      // Every user on this installation: a seat is consumed by a person existing here.
      countUsers: async (): Promise<number> => {
        const count: PositiveNumber = await UserService.countBy({
          query: {},
          props: {
            isRoot: true,
          },
        });

        return count.toNumber();
      },
      load: (): Promise<StoredMarketplaceBilling | null> => {
        return MarketplaceBillingStore.load();
      },
      save: (state: EnterpriseMarketplaceBillingState): Promise<void> => {
        return MarketplaceBillingStore.save(state);
      },
      withLock: async (work: () => Promise<void>): Promise<boolean> => {
        let mutex: SemaphoreMutex | null = null;

        try {
          mutex = await Semaphore.lock({
            key: MARKETPLACE_USAGE_LOCK_KEY,
            namespace: MARKETPLACE_USAGE_LOCK_NAMESPACE,
            lockTimeout: MARKETPLACE_USAGE_LOCK_TIMEOUT_IN_MS,
            acquireAttemptsLimit: 1,
            onLockLost: (err: Error): void => {
              logger.warn(
                `OneUptime Enterprise marketplace billing: the usage lock was lost during a run (${err.message}).`,
              );
            },
          });
        } catch (err) {
          // Held by another run; anything else (Valkey unreachable) fails the run.
          if (err instanceof SemaphoreLockTimeoutError) {
            return false;
          }

          throw err;
        }

        try {
          await work();
        } finally {
          try {
            await Semaphore.release(mutex);
          } catch (err) {
            logger.warn(err);
          }
        }

        return true;
      },
      refreshLicense: (): Promise<void> => {
        return licenseProvider.refresh();
      },
      now: (): Date => {
        return new Date();
      },
    };
  };

export default class MarketplaceUsageRun {
  public static async run(
    dependencies: MarketplaceUsageRunDependencies = getDefaultMarketplaceUsageRunDependencies(),
  ): Promise<MarketplaceUsageRunResult> {
    if (dependencies.isBillingEnabled()) {
      return {
        kind: "skipped",
        reason:
          "This is OneUptime Cloud: it sells through marketplaces, it is not billed through one.",
      };
    }

    const config: SelfHostedMarketplaceConfigResult = dependencies.readConfig();

    if (config.kind === "none") {
      return {
        kind: "skipped",
        reason: "This installation is not billed through a marketplace.",
      };
    }

    const marketplace: CloudMarketplace | null =
      config.kind === "configured"
        ? config.settings.marketplace
        : config.marketplace;

    if (!marketplace) {
      const problems: string =
        config.kind === "incomplete" ? config.problems.join(" ") : "";
      logger.warn(`OneUptime Enterprise marketplace billing: ${problems}`);

      return { kind: "skipped", reason: problems };
    }

    let result: MarketplaceUsageRunResult = {
      kind: "skipped",
      reason: "The GlobalConfig row does not exist yet.",
    };

    const acquired: boolean = await dependencies.withLock(
      async (): Promise<void> => {
        result = await MarketplaceUsageRun.runLocked(
          dependencies,
          config,
          marketplace,
        );
      },
    );

    if (!acquired) {
      return {
        kind: "skipped",
        reason: "Another run is reporting usage right now.",
      };
    }

    return result;
  }

  private static async runLocked(
    dependencies: MarketplaceUsageRunDependencies,
    config: SelfHostedMarketplaceConfigResult,
    marketplace: CloudMarketplace,
  ): Promise<MarketplaceUsageRunResult> {
    const marketplaceName: string =
      CloudMarketplaceUtil.getDisplayName(marketplace);
    const stored: StoredMarketplaceBilling | null = await dependencies.load();

    if (!stored) {
      return {
        kind: "skipped",
        reason: "The GlobalConfig row does not exist yet.",
      };
    }

    let state: EnterpriseMarketplaceBillingState;

    if (stored.state && stored.state.marketplace === marketplace) {
      state = stored.state;
    } else {
      if (stored.state) {
        const left: number = EnterpriseMarketplaceBillingUtil.summarize(
          stored.state,
        ).pendingUserHours;

        logger.warn(
          `OneUptime Enterprise marketplace billing: this installation now bills through ${marketplaceName} instead of ${CloudMarketplaceUtil.getDisplayName(stored.state.marketplace)}. ${left} user-hours still owed there were NOT billed.`,
        );
      }

      state = EnterpriseMarketplaceBillingUtil.createEmpty(marketplace);
    }

    const users: number = await dependencies.countUsers();
    const instanceId: string = stored.instanceId || "oneuptime";

    state = MarketplaceBilling.observe({
      state,
      now: dependencies.now(),
      users,
      instanceId,
    });

    if (config.kind !== "configured") {
      const problems: Array<string> =
        config.kind === "incomplete" ? config.problems : [];

      state.lastProblem = problems.join(" ");
      state.lastProblemAt = dependencies.now().toISOString();
      await dependencies.save(state);

      logger.warn(
        `OneUptime Enterprise marketplace billing: usage is kept, but cannot be reported to ${marketplaceName} until this is fixed: ${problems.join(" ")}`,
      );

      return {
        kind: "ran",
        marketplace,
        users,
        reports: [],
        problems,
      };
    }

    const reporter: SelfHostedMarketplaceReporter = dependencies.getReporter(
      config.settings,
    );

    const prepared: PreparedReports = MarketplaceBilling.prepare({
      state,
      now: dependencies.now(),
      policy: {
        maxReportAgeInMs: reporter.maxReportAgeInMs,
        acceptsZeroQuantity: reporter.acceptsZeroQuantity,
      },
    });

    state = prepared.state;
    state.unbilledUserHours += prepared.droppedUserHours;

    for (const note of prepared.notes) {
      logger.error(
        `OneUptime Enterprise marketplace billing (${marketplaceName}): ${note}`,
      );
    }

    await dependencies.save(state);

    const verifiedBefore: string | null = state.verifiedAt;
    const refusedBefore: string | null = state.refusedAt;
    const reports: Array<MarketplaceUsageRunReport> = [];

    for (const planned of prepared.toSend) {
      // Read it back: an earlier report of this run may have carried usage into it.
      const current: EnterpriseMarketplaceUsageReport | undefined =
        state.pendingReports.find(
          (candidate: EnterpriseMarketplaceUsageReport): boolean => {
            return candidate.idempotencyKey === planned.idempotencyKey;
          },
        );

      if (!current) {
        continue;
      }

      if (current.quantity === 0 && !reporter.acceptsZeroQuantity) {
        continue;
      }

      state = MarketplaceBilling.claim({
        state,
        idempotencyKey: current.idempotencyKey,
        now: dependencies.now(),
      });
      await dependencies.save(state);

      const outcome: SelfHostedUsageOutcome = await reporter.report(
        MarketplaceBilling.toReport(current),
      );

      state = MarketplaceBilling.applyOutcome({
        state,
        idempotencyKey: current.idempotencyKey,
        outcome,
        now: dependencies.now(),
      });
      await dependencies.save(state);

      reports.push({
        hourStart: current.hourStart,
        quantity: current.quantity,
        outcome: outcome.kind,
      });

      MarketplaceUsageRun.logOutcome(marketplaceName, current, outcome);

      // An outage, a setup problem or a refusal applies to the rest as well.
      if (outcome.kind !== "accepted" && outcome.kind !== "too-old") {
        break;
      }
    }

    if (
      state.verifiedAt !== verifiedBefore ||
      state.refusedAt !== refusedBefore
    ) {
      try {
        await dependencies.refreshLicense();
      } catch (err) {
        logger.warn(err);
      }
    }

    return {
      kind: "ran",
      marketplace,
      users,
      reports,
      problems: [],
    };
  }

  private static logOutcome(
    marketplaceName: string,
    report: EnterpriseMarketplaceUsageReport,
    outcome: SelfHostedUsageOutcome,
  ): void {
    const what: string = `${report.quantity} user-hours for ${report.hourStart}`;

    switch (outcome.kind) {
      case "accepted":
        logger.info(
          `OneUptime Enterprise marketplace billing: ${marketplaceName} accepted ${what} (${outcome.reportId}).`,
        );
        return;
      case "not-entitled":
        logger.error(
          `OneUptime Enterprise marketplace billing: ${marketplaceName} says this installation is not subscribed to OneUptime Enterprise, so ${what} were NOT billed: ${outcome.detail}`,
        );
        return;
      case "conflict":
        logger.error(
          `OneUptime Enterprise marketplace billing: ${marketplaceName} already holds a different record for this hour, so ${what} were NOT billed: ${outcome.detail}`,
        );
        return;
      case "too-old":
        logger.warn(
          `OneUptime Enterprise marketplace billing: ${marketplaceName} found ${what} too old; they ride in the next report: ${outcome.detail}`,
        );
        return;
      case "setup":
        logger.error(
          `OneUptime Enterprise marketplace billing: ${what} could not be reported to ${marketplaceName} because of how this installation is set up; it is tried again on the next run: ${outcome.detail}`,
        );
        return;
      case "retry":
        logger.warn(
          `OneUptime Enterprise marketplace billing: ${what} could not be reported to ${marketplaceName} right now; it is tried again on the next run: ${outcome.detail}`,
        );
        return;
    }
  }
}
