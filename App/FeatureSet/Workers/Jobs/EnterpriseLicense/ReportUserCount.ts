import RunCron from "../../Utils/Cron";
import { EVERY_DAY, EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import {
  EnterpriseLicenseUserCountReportUrl,
  Host,
  IsBillingEnabled,
  IsDevelopment,
  IsEnterpriseEdition,
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
import EnterpriseLicenseInstanceSummary from "Common/Types/EnterpriseLicense/EnterpriseLicenseInstanceSummary";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import PartialEntity from "Common/Types/Database/PartialEntity";
import logger from "Common/Server/Utils/Logger";

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

RunCron(
  "EnterpriseLicense:ReportUserCount",
  {
    schedule: IsDevelopment ? EVERY_FIVE_MINUTE : EVERY_DAY,
    runOnStartup: false,
  },
  async () => {
    /*
     * Only self-hosted enterprise installs report usage back to oneuptime.com.
     * The hosted oneuptime.com itself runs with billing enabled and should skip.
     */
    if (IsBillingEnabled) {
      return;
    }

    if (!IsEnterpriseEdition) {
      return;
    }

    const config: GlobalConfig | null = await GlobalConfigService.findOneById({
      id: ObjectID.getZeroObjectID(),
      select: {
        enterpriseLicenseKey: true,
        instanceId: true,
      },
      props: {
        isRoot: true,
      },
    });

    const licenseKey: string | undefined = config?.enterpriseLicenseKey;

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
    }

    const userEmailHashes: Array<string> = await getUserEmailHashes();

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: EnterpriseLicenseUserCountReportUrl,
        data: {
          licenseKey: licenseKey,
          userCount: userEmailHashes.length,
          instanceId: instanceId.toString(),
          host: Host,
          userEmailHashes: userEmailHashes,
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
     * The license server responds with the user count deduplicated across
     * all instances that share this license, plus the instance list — store
     * both so the license modal can show them. If the response has no valid
     * count, keep whatever we had rather than storing a local-only count as
     * if it were the cross-instance aggregate.
     */
    const aggregatedUserCountRaw: unknown = payload["currentUserCount"];

    if (
      typeof aggregatedUserCountRaw !== "number" ||
      !Number.isFinite(aggregatedUserCountRaw)
    ) {
      logger.error(
        "EnterpriseLicense:ReportUserCount: License server did not return a valid currentUserCount. Keeping previously stored usage.",
      );
      return;
    }

    const aggregatedUserCount: number = aggregatedUserCountRaw;

    const updateData: PartialEntity<GlobalConfig> = {
      enterpriseLicenseCurrentUserCount: aggregatedUserCount,
      enterpriseLicenseUserCountUpdatedAt: reportedAt,
    };

    if (Array.isArray(payload["instances"])) {
      updateData.enterpriseLicenseInstances = payload[
        "instances"
      ] as Array<EnterpriseLicenseInstanceSummary>;
    }

    await GlobalConfigService.updateOneById({
      id: ObjectID.getZeroObjectID(),
      data: updateData,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    logger.debug(
      `EnterpriseLicense:ReportUserCount: Reported ${userEmailHashes.length} users on this instance to OneUptime. Unique users across all instances: ${aggregatedUserCount}.`,
    );
  },
);
