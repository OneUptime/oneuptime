import RunCron from "../../Utils/Cron";
import { EVERY_DAY } from "Common/Utils/CronTime";
import {
  AppVersion,
  DisableInstanceCheckIn,
  IsBillingEnabled,
} from "Common/Server/EnvironmentConfig";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import Hostname from "Common/Types/API/Hostname";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";

/*
 * Where every self-hosted install checks in once a day. oneuptime.com keeps
 * one record per instance URL, so it knows which installs still run and on
 * which release, and can reach the admins who registered them about a
 * security issue.
 */
export const INSTANCE_CHECK_IN_URL: string =
  "https://oneuptime.com/api/open-source-deployment/check-in";

export async function checkIn(): Promise<void> {
  // The hosted service is no self-hosted install.
  if (IsBillingEnabled) {
    return;
  }

  if (DisableInstanceCheckIn) {
    logger.debug(
      "InstanceCheckIn:CheckIn: DISABLE_INSTANCE_CHECK_IN is set. Skipping.",
    );
    return;
  }

  /*
   * The URL a sign-up with release emails ticked sends too, so a check-in
   * keeps the record that sign-up made current.
   */
  const host: Hostname = await DatabaseConfig.getHost();
  const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();
  const instanceUrl: string = new URL(httpProtocol, host).toString();

  /*
   * Air-gapped installations have no route to oneuptime.com. That is an
   * expected state, not a fault, so a failure is logged at debug and the job
   * ends, as the update check does: an HTTP error status resolves to an
   * HTTPErrorResponse, and no response at all (DNS failure, connection
   * refused, the timeout) makes API.post reject.
   */
  let response: HTTPResponse<JSONObject> | HTTPErrorResponse;

  try {
    response = await API.post<JSONObject>({
      url: URL.fromString(INSTANCE_CHECK_IN_URL),
      data: {
        instanceUrl: instanceUrl,
        oneuptimeVersion: AppVersion,
      },
      options: {
        timeout: 15000,
      },
    });
  } catch (err) {
    logger.debug(
      `InstanceCheckIn:CheckIn: Could not reach ${INSTANCE_CHECK_IN_URL}: ${
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
      `InstanceCheckIn:CheckIn: ${INSTANCE_CHECK_IN_URL} returned an error: ${message}`,
    );
    return;
  }

  logger.debug(
    `InstanceCheckIn:CheckIn: Checked in as ${instanceUrl}, running ${AppVersion}.`,
  );
}

RunCron(
  "InstanceCheckIn:CheckIn",
  {
    schedule: EVERY_DAY,
    /*
     * Not on startup, so a CI run or a restart loop does not check in each
     * time it boots. A new install checks in at the next daily run.
     */
    runOnStartup: false,
    timeoutInMS: 60 * 1000,
  },
  checkIn,
);
