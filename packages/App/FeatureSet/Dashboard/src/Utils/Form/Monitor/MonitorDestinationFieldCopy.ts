import MonitorType from "Common/Types/Monitor/MonitorType";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What the address field of a probe check is called, the line under it, and
 * the example inside it - the first thing a new monitor's criteria step asks.
 *
 * The help used to ask questions with a typo in them ("Whats the URL of the
 * website you want to monitor?"), a Port monitor's said it would ping the
 * host, and an SSL Certificate monitor's field was a bare "URL" with no help
 * at all. Each now says what to type, with an example, in the same words.
 * The examples are placeholders, so they read the same in every language.
 */
export interface MonitorDestinationFieldCopy {
  title: string;
  description: string;
  placeholder: string;
}

export const getMonitorDestinationFieldCopy: (
  monitorType: MonitorType,
) => MonitorDestinationFieldCopy | null = (
  monitorType: MonitorType,
): MonitorDestinationFieldCopy | null => {
  switch (monitorType) {
    case MonitorType.Website:
      return {
        title: translationKey("Website URL"),
        description: translationKey(
          "The page to check, like https://example.com.",
        ),
        placeholder: "https://example.com",
      };
    case MonitorType.API:
      return {
        title: translationKey("API URL"),
        description: translationKey(
          "The endpoint to call, like https://api.example.com/health.",
        ),
        placeholder: "https://api.example.com/health",
      };
    case MonitorType.SSLCertificate:
      return {
        title: translationKey("Website URL"),
        description: translationKey(
          "The site whose certificate to check, like https://example.com.",
        ),
        placeholder: "https://example.com",
      };
    case MonitorType.Ping:
      return {
        title: translationKey("Hostname or IP Address"),
        description: translationKey(
          "The host to ping, like example.com or 192.168.1.1.",
        ),
        placeholder: "example.com",
      };
    case MonitorType.IP:
      return {
        title: translationKey("IP Address"),
        description: translationKey(
          "The IPv4 or IPv6 address to check, like 192.168.1.1.",
        ),
        placeholder: "192.168.1.1",
      };
    case MonitorType.Port:
      return {
        title: translationKey("Hostname or IP Address"),
        description: translationKey(
          "The host the port is on, like example.com.",
        ),
        placeholder: "example.com",
      };
    case MonitorType.NTP:
      return {
        title: translationKey("NTP Server"),
        description: translationKey(
          "The time server to check, like time.example.com or 192.168.1.10.",
        ),
        placeholder: "time.example.com",
      };
    default:
      return null;
  }
};

// The Port monitor's second field.
export const MONITOR_PORT_FIELD_DESCRIPTION: string = translationKey(
  "The TCP or UDP port to check, like 443.",
);

// The NTP monitor's port, under More fields.
export const NTP_PORT_FIELD_DESCRIPTION: string = translationKey(
  "The UDP port the server answers NTP on. Leave it empty for the standard port, 123.",
);

// What the NTP port field says when what was typed is not a port.
export const NTP_PORT_FIELD_ERROR: string = translationKey(
  "Enter a port from 1 to 65535, or leave it empty for 123.",
);
