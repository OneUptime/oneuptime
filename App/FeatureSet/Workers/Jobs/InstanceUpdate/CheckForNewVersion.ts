import RunCron from "../../Utils/Cron";
import { EVERY_DAY, EVERY_THREE_HOURS } from "Common/Utils/CronTime";
import {
  AppVersion,
  DisableUpdateCheck,
  IsDevelopment,
  LatestReleaseCheckUrl,
} from "Common/Server/EnvironmentConfig";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import API from "Common/Utils/API";
import VersionUtil from "Common/Utils/VersionUtil";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import PartialEntity from "Common/Types/Database/PartialEntity";
import logger from "Common/Server/Utils/Logger";

/*
 * Skips the call entirely while the cached answer is younger than this, so a
 * restart loop, a re-dispatched job or the more frequent development schedule
 * cannot turn into a stream of requests at GitHub's 60/hour unauthenticated
 * limit. It also makes runOnStartup safe: a pod that restarts ten times in an
 * hour still makes at most one call.
 */
const MIN_HOURS_BETWEEN_CHECKS: number = 12;

RunCron(
  "InstanceUpdate:CheckForNewVersion",
  {
    schedule: IsDevelopment ? EVERY_THREE_HOURS : EVERY_DAY,
    /*
     * Without this a fresh install, and every install right after an upgrade,
     * would read "has not checked for updates yet" until the next 08:00 UTC.
     * The MIN_HOURS_BETWEEN_CHECKS gate above keeps it cheap.
     */
    runOnStartup: true,
    timeoutInMS: 60 * 1000,
  },
  async () => {
    if (DisableUpdateCheck) {
      logger.debug(
        "InstanceUpdate:CheckForNewVersion: DISABLE_UPDATE_CHECK is set. Skipping.",
      );
      return;
    }

    /*
     * Dev builds and images built without APP_VERSION have nothing to compare
     * against, so calling GitHub could not produce a useful answer.
     */
    if (!VersionUtil.isValid(AppVersion)) {
      logger.debug(
        `InstanceUpdate:CheckForNewVersion: This build reports version "${AppVersion}", which cannot be compared to a release. Skipping.`,
      );
      return;
    }

    const config: GlobalConfig | null = await GlobalConfigService.findOneById({
      id: ObjectID.getZeroObjectID(),
      select: {
        latestReleaseCheckedAt: true,
      },
      props: {
        isRoot: true,
      },
    });

    const lastCheckedAt: Date | undefined = config?.latestReleaseCheckedAt;

    if (lastCheckedAt) {
      const nextCheckDueAt: Date = OneUptimeDate.addRemoveHours(
        lastCheckedAt,
        MIN_HOURS_BETWEEN_CHECKS,
      );

      if (OneUptimeDate.isInTheFuture(nextCheckDueAt)) {
        logger.debug(
          "InstanceUpdate:CheckForNewVersion: Checked recently. Skipping.",
        );
        return;
      }
    }

    /*
     * Air-gapped installations have no route to api.github.com. That is an
     * expected state, not a fault, so every failure below logs and leaves the
     * cached values alone rather than throwing — RunCron does not wrap the job
     * body, and a throwing job would produce a daily error on exactly the
     * deployments that are behaving correctly.
     *
     * Two distinct failure shapes have to be caught. A response with an HTTP
     * error status (403 rate limit, 404, 5xx) resolves to an HTTPErrorResponse,
     * but a failure with no response at all (DNS failure, connection refused,
     * the 15s timeout) makes API.get REJECT — see getErrorResponse in
     * Common/Utils/API.ts, which throws an APIException when error.response is
     * undefined.
     */
    let response: HTTPResponse<JSONObject> | HTTPErrorResponse;

    try {
      response = await API.get<JSONObject>({
        url: LatestReleaseCheckUrl,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": `OneUptime/${AppVersion}`,
        },
        options: {
          timeout: 15000,
        },
      });
    } catch (err) {
      logger.debug(
        `InstanceUpdate:CheckForNewVersion: Could not reach ${LatestReleaseCheckUrl.toString()}: ${
          (err as Error)?.message || "Unknown error"
        }`,
      );
      return;
    }

    if (!response.isSuccess()) {
      const message: string =
        response instanceof HTTPErrorResponse
          ? response.message || "Unknown error"
          : "Unknown error";

      logger.debug(
        `InstanceUpdate:CheckForNewVersion: ${LatestReleaseCheckUrl.toString()} returned an error: ${message}`,
      );
      return;
    }

    const payload: JSONObject = (response.data as JSONObject) || {};

    /*
     * Canonicalized rather than normalized, so what lands in the column is
     * always a bare "11.6.0" — the UIs prefix their own "v", and the repo has
     * tags in both spellings plus non-version ones like "build-number-7866".
     */
    const latestVersion: string | null = VersionUtil.canonicalize(
      payload["tag_name"],
    );

    if (!latestVersion) {
      logger.debug(
        `InstanceUpdate:CheckForNewVersion: The release endpoint returned tag "${String(
          payload["tag_name"],
        )}", which is not a version. Keeping the previously stored release.`,
      );
      return;
    }

    const checkedAt: Date = OneUptimeDate.getCurrentDate();

    const updateData: PartialEntity<GlobalConfig> = {
      latestReleaseVersion: latestVersion,
      latestReleaseCheckedAt: checkedAt,
    };

    if (typeof payload["published_at"] === "string") {
      const publishedAt: Date = OneUptimeDate.fromString(
        payload["published_at"],
      );

      if (!Number.isNaN(publishedAt.getTime())) {
        updateData.latestReleasePublishedAt = publishedAt;
      }
    }

    await GlobalConfigService.updateOneById({
      id: ObjectID.getZeroObjectID(),
      data: updateData,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    if (
      VersionUtil.isUpdateAvailable({
        currentVersion: AppVersion,
        latestVersion: latestVersion,
      })
    ) {
      logger.info(
        `InstanceUpdate:CheckForNewVersion: OneUptime ${latestVersion} is available. This installation is running ${AppVersion}.`,
      );
      return;
    }

    logger.debug(
      `InstanceUpdate:CheckForNewVersion: This installation (${AppVersion}) is up to date. Latest release is ${latestVersion}.`,
    );
  },
);
