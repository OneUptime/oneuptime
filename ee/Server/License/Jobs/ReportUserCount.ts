import RunCron from "App/FeatureSet/Workers/Utils/Cron";
import { EVERY_DAY, EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import {
  AppVersion,
  EnterpriseLicenseUserCountReportUrl,
  Host,
  IsBillingEnabled,
  IsDevelopment,
} from "Common/Server/EnvironmentConfig";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import UserService from "Common/Server/Services/UserService";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import User from "Common/Models/DatabaseModels/User";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import API from "Common/Utils/API";
import Crypto from "Common/Utils/Crypto";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import logger from "Common/Server/Utils/Logger";
import EnterpriseLicenseSyncUtil, {
  EnterpriseLicenseSyncResult,
} from "../EnterpriseLicenseSync";
import LicenseInputsUtil, { LicenseInputs } from "../LicenseInputs";
import licenseProvider from "../LicenseProvider";
import LicenseRanking, { GuardedLicenseUpdate } from "../LicenseRanking";
import LicenseStore from "../LicenseStore";

export const REPORT_USER_COUNT_JOB_NAME: string =
  "EnterpriseLicense:ReportUserCount";

type GetUserEmailHashesFunction = () => Promise<Array<string>>;

/*
 * SHA-256 hashes of user emails identify users uniquely across all of the
 * customer's instances (staging, production, etc.) that share one license,
 * without sending raw emails to OneUptime. The same user on multiple
 * instances consumes a single licensed seat.
 */
const getUserEmailHashes: GetUserEmailHashesFunction = async (): Promise<
  Array<string>
> => {
  const emailHashes: Set<string> = new Set<string>();
  let skip: number = 0;

  for (;;) {
    const users: Array<User> = await UserService.findBy({
      query: {},
      select: {
        email: true,
      },
      sort: {
        createdAt: SortOrder.Ascending,
      },
      skip: skip,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const user of users) {
      const email: string = user.email?.toString().trim().toLowerCase() || "";

      if (!email) {
        continue;
      }

      emailHashes.add(Crypto.getSha256Hash(email));
    }

    if (users.length < LIMIT_MAX) {
      break;
    }

    skip += LIMIT_MAX;
  }

  return Array.from(emailHashes);
};

type GetMasterAdminEmailsFunction = () => Promise<Array<string>>;

/*
 * Master admin emails are sent (raw, not hashed) so OneUptime can contact
 * the customer about license expiry and seat-limit breaches. Only master
 * admins are reported — regular users stay anonymous (hashes only).
 */
const getMasterAdminEmails: GetMasterAdminEmailsFunction = async (): Promise<
  Array<string>
> => {
  const emails: Set<string> = new Set<string>();

  const masterAdmins: Array<User> = await UserService.findBy({
    query: {
      isMasterAdmin: true,
    },
    select: {
      email: true,
    },
    sort: {
      createdAt: SortOrder.Ascending,
    },
    skip: 0,
    limit: LIMIT_MAX,
    props: {
      isRoot: true,
    },
  });

  for (const user of masterAdmins) {
    const email: string = user.email?.toString().trim().toLowerCase() || "";

    if (!email) {
      continue;
    }

    emails.add(email);
  }

  return Array.from(emails);
};

/*
 * The daily call home of an online Enterprise installation: report this
 * instance's (hashed) users, and bring back the license as oneuptime.com knows
 * it today. Registered by the license area's registerWorkerJobs.
 */
export const reportUserCount: () => Promise<void> =
  async (): Promise<void> => {
    /*
     * Only self-hosted enterprise installs report usage back to oneuptime.com.
     * The hosted oneuptime.com itself runs with billing enabled and should skip.
     */
    if (IsBillingEnabled) {
      return;
    }

    const config: GlobalConfig | null = await LicenseStore.readLicenseConfig();
    const inputs: LicenseInputs = LicenseInputsUtil.fromGlobalConfig(config);

    /*
     * An installation activated offline holds a signed token and no key. It is
     * offline on purpose; calling home would only fail every day.
     */
    if (LicenseInputsUtil.isOfflineActivated(inputs)) {
      logger.debug(
        "EnterpriseLicense:ReportUserCount: This installation was activated offline with a license token. Skipping report.",
      );
      return;
    }

    const licenseKey: string | null = inputs.licenseKey;

    if (!licenseKey) {
      logger.debug(
        "EnterpriseLicense:ReportUserCount: No enterprise license key configured. Skipping report.",
      );
      return;
    }

    let instanceId: ObjectID | undefined = config?.instanceId;

    if (!instanceId) {
      // Installs that predate instance ids: generate one now.
      instanceId = ObjectID.generate();

      await GlobalConfigService.updateOneById({
        id: ObjectID.getZeroObjectID(),
        data: {
          instanceId: instanceId,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      inputs.instanceId = instanceId.toString();
    }

    const userEmailHashes: Array<string> = await getUserEmailHashes();
    const masterAdminEmails: Array<string> = await getMasterAdminEmails();

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: EnterpriseLicenseUserCountReportUrl,
        data: {
          licenseKey: licenseKey,
          userCount: userEmailHashes.length,
          instanceId: instanceId.toString(),
          host: Host,
          /*
           * So the customer can see which of their instances are running
           * which build, and OneUptime support can spot stragglers. "unknown"
           * on dev builds with no APP_VERSION baked in — the license server
           * discards anything that is not a real version.
           */
          version: AppVersion,
          userEmailHashes: userEmailHashes,
          masterAdminEmails: masterAdminEmails,
        },
      });

    if (!response.isSuccess()) {
      const message: string =
        response instanceof HTTPErrorResponse
          ? response.message || "Unknown error"
          : "Unknown error";

      logger.error(
        `EnterpriseLicense:ReportUserCount: Failed to report user count to ${EnterpriseLicenseUserCountReportUrl.toString()}: ${message}`,
      );
      return;
    }

    const reportedAt: Date = OneUptimeDate.getCurrentDate();

    const payload: JSONObject = (response.data as JSONObject) || {};

    /*
     * The response is a full picture of the license as oneuptime.com knows it
     * right now - the seat limit, the expiry, the company name, the
     * evaluation flag, the deduplicated user count across every instance
     * sharing this key, and the instance list. Mirroring all of it is what
     * makes this daily call the thing that keeps a self-hosted installation
     * current: before it did, buying seats or renewing on oneuptime.com only
     * reached the customer when somebody re-typed the license key by hand.
     *
     * The mapper is deliberately conservative - a field the server did not
     * send leaves the stored column alone - so an installation upgraded ahead
     * of oneuptime.com cannot have its license blanked by the fields the older
     * server has never heard of.
     */
    const sync: EnterpriseLicenseSyncResult =
      EnterpriseLicenseSyncUtil.getGlobalConfigUpdateFromLicenseResponse({
        payload: payload,
        reportedAt: reportedAt,
      });

    for (const warning of sync.warnings) {
      logger.error(`EnterpriseLicense:ReportUserCount: ${warning}`);
    }

    /*
     * Never downgrade: a returned token that classifies worse than the stored
     * one (a signing misconfiguration on oneuptime.com, a token for another
     * instance) is refused, with the license terms that came with it. The
     * usage figures are still stored.
     */
    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs,
      update: sync.updateData,
      now: reportedAt,
    });

    if (guarded.downgrade) {
      logger.error(
        `EnterpriseLicense:ReportUserCount: ${LicenseRanking.describeDowngrade(guarded.downgrade)}`,
      );
    }

    if (Object.keys(guarded.update).length === 0) {
      logger.error(
        "EnterpriseLicense:ReportUserCount: The license server returned nothing this build could store. Keeping the previously stored license state.",
      );
      return;
    }

    await GlobalConfigService.updateOneById({
      id: ObjectID.getZeroObjectID(),
      data: guarded.update,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    // This process sees the new license at once; other processes within the cache TTL.
    await licenseProvider.refresh();

    const aggregatedUserCount: number | null | undefined = guarded.update
      .enterpriseLicenseCurrentUserCount as number | null | undefined;

    logger.debug(
      `EnterpriseLicense:ReportUserCount: Reported ${
        userEmailHashes.length
      } users on this instance to OneUptime. Unique users across all instances: ${
        typeof aggregatedUserCount === "number"
          ? aggregatedUserCount
          : "unchanged"
      }.`,
    );
  };

RunCron(
  REPORT_USER_COUNT_JOB_NAME,
  {
    schedule: IsDevelopment ? EVERY_FIVE_MINUTE : EVERY_DAY,
    runOnStartup: false,
  },
  reportUserCount,
);
