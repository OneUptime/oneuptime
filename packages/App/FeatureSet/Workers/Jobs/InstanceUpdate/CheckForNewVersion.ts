import RunCron from "../../Utils/Cron";
import { runWithInstanceHealthLease } from "../InstanceHealth/InstanceHealthLock";
import { notifyOwnersOfSecurityAdvisories } from "./SecurityAdvisoryNotification";
import { EVERY_DAY, EVERY_THREE_HOURS } from "Common/Utils/CronTime";
import {
  AppVersion,
  DisableUpdateCheck,
  IsBillingEnabled,
  IsDevelopment,
  LatestReleaseCheckUrl,
  SecurityAdvisoriesCheckUrl,
} from "Common/Server/EnvironmentConfig";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import GitHubUpdateCheck, {
  LatestRelease,
  UpdateCheckResult,
} from "Common/Server/Utils/UpdateCheck/GitHubUpdateCheck";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import PartialEntity from "Common/Types/Database/PartialEntity";
import SecurityAdvisoryUtil, {
  SecurityAdvisory,
} from "Common/Types/UpdateCheck/SecurityAdvisory";
import UpdateCheckFailure from "Common/Types/UpdateCheck/UpdateCheckFailure";
import VersionUtil from "Common/Utils/VersionUtil";
import logger from "Common/Server/Utils/Logger";

/*
 * THE DAILY UPDATE CHECK.
 *
 * Once a day this installation asks GitHub two public questions - which
 * OneUptime release is the latest, and which security advisories OneUptime
 * has published for OneUptime/oneuptime (GitHubUpdateCheck) - and keeps the
 * answers on GlobalConfig. Whether a newer release is out, or an advisory
 * affects the version this installation runs, is worked out from them on
 * the server (SecurityAdvisoryMatcher), so no browser ever calls GitHub and
 * nothing about the installation is sent. Master admins see the result in
 * the Dashboard's and the Admin Dashboard's footers and, for an advisory, a
 * notice on the Admin Dashboard's first page; the owners are emailed once
 * about each advisory that affects the version (SecurityAdvisoryNotification).
 *
 * What it never does:
 *
 *   - run when DISABLE_UPDATE_CHECK is set, for a build that reports no
 *     release version (nothing to compare), or ask about advisories on
 *     OneUptime Cloud (IsBillingEnabled), which is not told to upgrade
 *     itself - Cloud still reads the latest release, which its Enterprise
 *     licenses page compares customers' instances against;
 *   - ask GitHub again within MIN_HOURS_BETWEEN_CHECKS of an answer, or
 *     within MIN_MINUTES_BETWEEN_ATTEMPTS of any try, so a worker that
 *     restarts in a loop, or GitHub's 60-an-hour limit, never turns into a
 *     stream of requests;
 *   - fail, or log above debug, when GitHub cannot be reached.
 *     Air-gapped installations have no route to api.github.com. That is an
 *     expected state, not a fault, so a failed read keeps the last good
 *     answer and records why it failed, which the Admin Dashboard shows
 *     beside when the check last ran (GitHubUpdateCheck never throws);
 *   - run twice at once: two replicas share one lease, so the owners are
 *     never emailed twice about one advisory.
 */

export const UPDATE_CHECK_JOB_NAME: string =
  "InstanceUpdate:CheckForNewVersion";

/*
 * Skips asking while the stored answer is younger than this, so a restart
 * loop, a re-dispatched job or the more frequent development schedule
 * cannot turn into a stream of requests at GitHub's 60/hour unauthenticated
 * limit. It also makes runOnStartup safe: a pod that restarts ten times in an
 * hour still makes at most one call.
 */
export const MIN_HOURS_BETWEEN_CHECKS: number = 12;

/*
 * Skips asking for this long after any attempt, answered or not: an
 * installation with no route to GitHub, or one GitHub has rate limited,
 * tries again an hour later at the soonest.
 */
export const MIN_MINUTES_BETWEEN_ATTEMPTS: number = 60;

// Two requests, ten pages at the most, a 15 second timeout each, and the emails.
export const UPDATE_CHECK_TIMEOUT_IN_MS: number = 5 * 60 * 1000;

// Outlives the job, as the lease must (InstanceHealthLock).
export const UPDATE_CHECK_LEASE_TTL_IN_SECONDS: number = 10 * 60;

const isDue: (lastAt: Date | undefined | null, hours: number) => boolean = (
  lastAt: Date | undefined | null,
  hours: number,
): boolean => {
  if (!lastAt) {
    return true;
  }

  return !OneUptimeDate.isInTheFuture(
    OneUptimeDate.addRemoveHours(lastAt, hours),
  );
};

export async function runUpdateCheck(): Promise<void> {
  const config: GlobalConfig | null = await GlobalConfigService.findOneById({
    id: ObjectID.getZeroObjectID(),
    select: {
      latestReleaseVersion: true,
      latestReleaseCheckedAt: true,
      securityAdvisories: true,
      securityAdvisoriesCheckedAt: true,
      securityAdvisoriesEmailed: true,
      updateCheckLastAttemptAt: true,
      adminNotificationEmail: true,
    },
    props: {
      isRoot: true,
    },
  });

  const isSelfHosted: boolean = !IsBillingEnabled;

  const isReleaseDue: boolean = isDue(
    config?.latestReleaseCheckedAt,
    MIN_HOURS_BETWEEN_CHECKS,
  );

  const areAdvisoriesDue: boolean =
    isSelfHosted &&
    isDue(config?.securityAdvisoriesCheckedAt, MIN_HOURS_BETWEEN_CHECKS);

  const lastAttemptAt: Date | undefined = config?.updateCheckLastAttemptAt;
  const wasAttemptedRecently: boolean = Boolean(
    lastAttemptAt &&
      OneUptimeDate.isInTheFuture(
        OneUptimeDate.addRemoveMinutes(
          lastAttemptAt,
          MIN_MINUTES_BETWEEN_ATTEMPTS,
        ),
      ),
  );

  let latestVersion: string | null = config?.latestReleaseVersion || null;
  let advisories: Array<SecurityAdvisory> = SecurityAdvisoryUtil.fromJSONArray(
    config?.securityAdvisories,
  );

  if ((isReleaseDue || areAdvisoriesDue) && !wasAttemptedRecently) {
    const now: Date = OneUptimeDate.getCurrentDate();
    let failure: UpdateCheckFailure | null = null;

    const update: PartialEntity<GlobalConfig> = {
      updateCheckLastAttemptAt: now,
    };

    if (isReleaseDue) {
      const release: UpdateCheckResult<LatestRelease> =
        await GitHubUpdateCheck.fetchLatestRelease(LatestReleaseCheckUrl);

      if (release.ok) {
        latestVersion = release.value.version;
        update.latestReleaseVersion = release.value.version;
        update.latestReleaseCheckedAt = now;

        if (release.value.publishedAt) {
          update.latestReleasePublishedAt = release.value.publishedAt;
        }
      } else {
        failure = release.failure;
        logger.debug(
          `${UPDATE_CHECK_JOB_NAME}: Could not read the latest release (${release.failure}): ${release.detail}. Keeping the last one read.`,
        );
      }
    }

    if (areAdvisoriesDue) {
      const published: UpdateCheckResult<Array<SecurityAdvisory>> =
        await GitHubUpdateCheck.fetchPublishedSecurityAdvisories(
          SecurityAdvisoriesCheckUrl,
        );

      if (published.ok) {
        advisories = published.value;
        update.securityAdvisories = published.value.map(
          SecurityAdvisoryUtil.toJSON,
        );
        update.securityAdvisoriesCheckedAt = now;
      } else {
        failure = failure || published.failure;
        logger.debug(
          `${UPDATE_CHECK_JOB_NAME}: Could not read the published security advisories (${published.failure}): ${published.detail}. Keeping the last ones read.`,
        );
      }
    }

    update.updateCheckLastFailure = failure
      ? failure
      : (null as unknown as string);

    await GlobalConfigService.updateOneById({
      id: ObjectID.getZeroObjectID(),
      data: update,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });
  } else {
    logger.debug(`${UPDATE_CHECK_JOB_NAME}: Checked recently. Skipping.`);
  }

  if (
    VersionUtil.isUpdateAvailable({
      currentVersion: AppVersion,
      latestVersion: latestVersion,
    })
  ) {
    logger.info(
      `${UPDATE_CHECK_JOB_NAME}: OneUptime ${latestVersion} is available. This installation is running ${AppVersion}.`,
    );
  } else {
    logger.debug(
      `${UPDATE_CHECK_JOB_NAME}: This installation (${AppVersion}) is up to date. Latest release is ${latestVersion}.`,
    );
  }

  /*
   * Every run, not only one that asked GitHub: an advisory read yesterday
   * that nobody could be emailed about is tried again, and a version that
   * started since is compared against what is stored.
   */
  if (isSelfHosted) {
    await notifyOwnersOfSecurityAdvisories({
      currentVersion: AppVersion,
      latestVersion: latestVersion,
      advisories: advisories,
      emailed: config?.securityAdvisoriesEmailed,
      adminNotificationEmail: config?.adminNotificationEmail,
    });
  }
}

export async function checkForUpdates(): Promise<void> {
  if (DisableUpdateCheck) {
    logger.debug(
      `${UPDATE_CHECK_JOB_NAME}: DISABLE_UPDATE_CHECK is set. Skipping.`,
    );
    return;
  }

  /*
   * Dev builds and images built without APP_VERSION have nothing to compare
   * against, so calling GitHub could not produce a useful answer.
   */
  if (!VersionUtil.isValid(AppVersion)) {
    logger.debug(
      `${UPDATE_CHECK_JOB_NAME}: This build reports version "${AppVersion}", which cannot be compared to a release. Skipping.`,
    );
    return;
  }

  await runWithInstanceHealthLease({
    jobName: UPDATE_CHECK_JOB_NAME,
    lockLabel: "instance-update-check",
    leaseTtlInSeconds: UPDATE_CHECK_LEASE_TTL_IN_SECONDS,
    run: runUpdateCheck,
  });
}

RunCron(
  UPDATE_CHECK_JOB_NAME,
  {
    schedule: IsDevelopment ? EVERY_THREE_HOURS : EVERY_DAY,
    /*
     * Without this a fresh install, and every install right after an upgrade,
     * would read "has not checked for updates yet" until the next 08:00 UTC.
     * The MIN_HOURS_BETWEEN_CHECKS gate above keeps it cheap.
     */
    runOnStartup: true,
    timeoutInMS: UPDATE_CHECK_TIMEOUT_IN_MS,
  },
  checkForUpdates,
);
