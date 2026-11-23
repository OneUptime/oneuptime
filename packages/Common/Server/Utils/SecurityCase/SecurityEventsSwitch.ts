import ProductKey from "../../../Types/Product/ProductKey";
import logger from "../Logger";
import ServerProducts from "../ServerProducts/ServerProducts";

/*
 * WHETHER SECURITY EVENTS IS SWITCHED OFF ON THE SERVER, for OneUptime's
 * own work on security cases (#10816): OneUptime AI responding first to a
 * case (SecurityCaseAiHold, #10353) and working one end to end
 * (Server/Utils/AI/Security/Response, #10352). While it is off, none of
 * that work starts or goes on - as OneUptime AI starts nothing on a product
 * that is off (#9489) - and each hands its cases to people, saying why.
 *
 * Read as the server's own work reads a product (getOffReasonOfServerWork):
 * kept for a few seconds (OFF_PRODUCTS_CACHE_TTL_MS), so asking before
 * every step OneUptime AI takes costs nothing. A read that fails answers
 * "on", as ServerProducts does: switching a product off is never a lock.
 */
export default class SecurityEventsSwitch {
  public static async isOff(): Promise<boolean> {
    try {
      return Boolean(
        await ServerProducts.getOffReasonOfServerWork(
          ProductKey.SecurityEvents,
        ),
      );
    } catch (error) {
      logger.error(
        "SecurityEventsSwitch: could not read whether Security Events is switched off; reading it as on:",
      );
      logger.error(error);
      return false;
    }
  }
}
