import IncomingEmailMonitorRequest from "../../Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";

export default class IncomingEmailMonitorRequestUtil {
  /*
   * Does this payload carry an email?
   *
   * An incoming email monitor evaluates two kinds of payload. Each email it
   * receives is one (Telemetry's processIncomingEmailFromQueue). The other is
   * the worker's scheduled "has an email arrived lately?" check
   * (Workers/Jobs/IncomingEmailMonitor/CheckOnlineStatus), which copies the
   * monitor's last email into its payload. When no email has ever arrived
   * there is nothing to copy: the check sends empty fields and stands the
   * monitor's creation time in for emailReceivedAt, so a "not received in
   * N minutes" criterion counts the silence from creation. That stand-in is
   * not an email, and a summary that showed it as "Last Email Received At"
   * would claim mail arrived when the monitor was created.
   *
   * A real email always has a sender and headers, so a check whose payload
   * has no email field at all is the stand-in.
   */
  public static hasEmail(
    request: IncomingEmailMonitorRequest | null | undefined,
  ): boolean {
    if (!request) {
      return false;
    }

    if (!request.onlyCheckForIncomingEmailReceivedAt) {
      return true;
    }

    return Boolean(
      request.emailFrom ||
        request.emailTo ||
        request.emailSubject ||
        request.emailBody ||
        request.emailBodyHtml ||
        (request.emailHeaders && Object.keys(request.emailHeaders).length > 0),
    );
  }
}
