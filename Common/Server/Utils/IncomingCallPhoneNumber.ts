import { AppApiHostname } from "../EnvironmentConfig";
import ClusterKeyAuthorization from "../Middleware/ClusterKeyAuthorization";
import logger from "./Logger";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import API from "../../Utils/API";
import ObjectID from "../../Types/ObjectID";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import { JSONObject } from "../../Types/JSON";
import APIException from "../../Types/Exception/ApiException";

/*
 * Releases a provisioned incoming-call number on the call provider by delegating
 * to the notification app's internal endpoint (the Common layer cannot reach the
 * provider directly). A failed release must block the parent delete; otherwise
 * the only config/SID metadata needed to retry is lost while the customer can
 * continue to be billed for the orphaned provider number.
 */
export default async function releaseIncomingCallPhoneNumber(data: {
  projectCallSMSConfigId: ObjectID;
  callProviderPhoneNumberId: string;
}): Promise<void> {
  try {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: new URL(
          Protocol.HTTP,
          AppApiHostname,
          new Route("/api/notification/phone-number/internal/release"),
        ),
        data: {
          projectCallSMSConfigId: data.projectCallSMSConfigId.toString(),
          callProviderPhoneNumberId: data.callProviderPhoneNumberId,
        },
        headers: {
          ...ClusterKeyAuthorization.getClusterKeyHeaders(),
        },
      });

    if (response.isFailure()) {
      throw new APIException(
        `Notification service could not release the incoming-call phone number (HTTP ${response.statusCode}).`,
      );
    }
  } catch (err) {
    logger.error(
      "Failed to release incoming-call phone number on the provider during cleanup:",
    );
    logger.error(err);
    throw err;
  }
}
