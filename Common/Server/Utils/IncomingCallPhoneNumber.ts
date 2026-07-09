import { AppApiHostname } from "../EnvironmentConfig";
import ClusterKeyAuthorization from "../Middleware/ClusterKeyAuthorization";
import logger from "./Logger";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import API from "../../Utils/API";
import ObjectID from "../../Types/ObjectID";

/*
 * Releases a provisioned incoming-call number on the call provider by delegating
 * to the notification app's internal endpoint (the Common layer cannot reach the
 * provider directly). Best-effort: failures are logged but never thrown, so a
 * provider/network issue during cleanup does not block the parent delete.
 */
export default async function releaseIncomingCallPhoneNumber(data: {
  projectCallSMSConfigId: ObjectID;
  callProviderPhoneNumberId: string;
}): Promise<void> {
  try {
    await API.post({
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
  } catch (err) {
    logger.error(
      "Failed to release incoming-call phone number on the provider during cleanup:",
    );
    logger.error(err);
  }
}
