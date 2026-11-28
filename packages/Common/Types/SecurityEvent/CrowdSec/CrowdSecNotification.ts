import SecurityEventFormat from "../SecurityEventFormat";
import { getPushedConnectionAddress } from "../Connectors/PushedConnectionAddress";

/*
 * THE NOTIFICATION THAT SENDS CROWDSEC'S ALERTS TO ONEUPTIME (#11158).
 *
 * CrowdSec's Local API hands each alert a profile names a notification for
 * to that notification's plugin. Its http plugin (cmd/notification-http in
 * crowdsecurity/crowdsec, v1.8.2) renders the alerts with the
 * notification's Go template and posts the result to its url. This is that
 * notification, for one connection, as the Dashboard hands it out and the
 * docs print it:
 *
 *   - format `{{.|toJson}}`: the alerts in CrowdSec's own JSON, a list of
 *     models.Alert, which the ingest reads (CrowdSecNormalizer) - the
 *     template CrowdSec's own http.yaml starts from;
 *   - url: the ingest, naming the connection and the format, nothing
 *     secret (getPushedConnectionAddress);
 *   - the ingestion key in x-oneuptime-token, never in the address;
 *   - Content-Type: the plugin sets none of its own;
 *   - log_level info: at debug, the plugin logs every request with its
 *     headers, the ingestion key among them.
 *
 * The file goes in CrowdSec's notification folder, on the host that runs
 * its Local API, which sends the notifications of every machine that
 * reports to it; its profiles name it to send their alerts.
 */

// The notification's name: what profiles.yaml and `cscli notifications` call it.
export const CROWDSEC_NOTIFICATION_NAME: string = "oneuptime";

// Where it is saved, in a package install's notification folder.
export const CROWDSEC_NOTIFICATION_FILE: string =
  "/etc/crowdsec/notifications/oneuptime.yaml";

// The profiles that send their alerts to it.
export const CROWDSEC_PROFILES_FILE: string = "/etc/crowdsec/profiles.yaml";

// Reloading CrowdSec reads both files again.
export const CROWDSEC_RELOAD_COMMAND: string = "sudo systemctl reload crowdsec";

// Sends a test alert through the notification, and through nothing else.
export const CROWDSEC_TEST_COMMAND: string = `sudo cscli notifications test ${CROWDSEC_NOTIFICATION_NAME}`;

// What a profile's notifications hold to send its alerts here.
export const CROWDSEC_PROFILE_NOTIFICATIONS: string = [
  "notifications:",
  `  - ${CROWDSEC_NOTIFICATION_NAME}`,
].join("\n");

// The address one connection's alerts are sent to.
export function getCrowdSecAlertsAddress(data: {
  ingestUrl: string;
  connectionId: string;
}): string {
  return getPushedConnectionAddress({
    ingestUrl: data.ingestUrl,
    connectionId: data.connectionId,
    format: SecurityEventFormat.CrowdSec,
  });
}

// The notification's file, for one connection and one ingestion key.
export function getCrowdSecNotificationYaml(data: {
  address: string;
  token: string;
}): string {
  return [
    "type: http",
    `name: ${CROWDSEC_NOTIFICATION_NAME}`,
    "",
    "# info or quieter: at debug, CrowdSec logs each request's headers.",
    "log_level: info",
    "",
    "format: |",
    "  {{.|toJson}}",
    "",
    `url: ${data.address}`,
    "method: POST",
    "headers:",
    "  Content-Type: application/json",
    `  x-oneuptime-token: ${data.token}`,
    "",
  ].join("\n");
}
