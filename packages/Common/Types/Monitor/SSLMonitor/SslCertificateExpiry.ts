import OneUptimeDate from "../../Date";
import SslMonitorResponse from "./SslMonitorResponse";

/*
 * HOW MANY DAYS A CERTIFICATE HAS LEFT, as Expires In Days reads it: whole
 * days from now to its expiry, a certificate that expires in 14 days and 20
 * hours having 14 (negative once it has expired). One reading, shared by the
 * criteria that judges it (SSLMonitorCriteria) and the series each check
 * writes (MonitorMetricUtil, #10905), so a window of the series and the
 * latest check say the same thing.
 */
export default class SslCertificateExpiry {
  // Null when the check read no expiry: no certificate, or none it could read.
  public static getDaysLeft(data: {
    sslResponse: SslMonitorResponse | undefined | null;
    at: Date;
  }): number | null {
    const expiresAt: Date | string | undefined = data.sslResponse?.expiresAt as
      | Date
      | string
      | undefined;

    if (!expiresAt) {
      return null;
    }

    const days: number = OneUptimeDate.getWholeDaysOfTimeBetween(
      data.at,
      expiresAt,
    );

    return Number.isFinite(days) ? days : null;
  }
}
