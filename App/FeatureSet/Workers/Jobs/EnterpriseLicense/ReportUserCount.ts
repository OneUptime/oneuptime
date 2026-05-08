import RunCron from "../../Utils/Cron";
import { EVERY_DAY, EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import {
  EnterpriseLicenseUserCountReportUrl,
  IsBillingEnabled,
  IsDevelopment,
  IsEnterpriseEdition,
} from "Common/Server/EnvironmentConfig";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import UserService from "Common/Server/Services/UserService";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import API from "Common/Utils/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import PositiveNumber from "Common/Types/PositiveNumber";
import logger from "Common/Server/Utils/Logger";

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

    const userCount: PositiveNumber = await UserService.countBy({
      query: {},
      props: {
        isRoot: true,
      },
    });

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: EnterpriseLicenseUserCountReportUrl,
        data: {
          licenseKey: licenseKey,
          userCount: userCount.toNumber(),
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

    await GlobalConfigService.updateOneById({
      id: ObjectID.getZeroObjectID(),
      data: {
        enterpriseLicenseCurrentUserCount: userCount.toNumber(),
        enterpriseLicenseUserCountUpdatedAt: reportedAt,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    logger.debug(
      `EnterpriseLicense:ReportUserCount: Reported ${userCount.toNumber()} users to OneUptime.`,
    );
  },
);
