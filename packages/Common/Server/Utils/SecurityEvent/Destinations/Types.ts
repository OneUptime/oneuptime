import { JSONObject } from "../../../../Types/JSON";
import SecurityEventDestinationProvider from "../../../../Types/SecurityEvent/Destinations/SecurityEventDestinationProvider";
import { SecurityEventRecord } from "../../../../Utils/SecurityEvent/Destinations/SecurityEventRecord";

/*
 * The contract every SIEM OneUptime sends to implements - Google SecOps
 * today, Splunk, Microsoft Sentinel and Elastic next. A sender is
 * stateless: every call gets the decrypted settings, so one instance serves
 * every tenant. The forwarder and the API only ever talk to this interface;
 * a new SIEM is a catalog entry, a mapper to its event shape and one class
 * implementing this.
 */

/*
 * Decrypted, server-only settings of one destination. Never serialize this
 * into a response or a log line.
 */
export interface SecurityEventDestinationSettings {
  provider: SecurityEventDestinationProvider;
  config: JSONObject;
  secrets: JSONObject;
}

export interface SecurityEventSendResult {
  /*
   * How many of the events, from the first, were dealt with - sent or
   * refused - before the send stopped. All of them when nothing stopped it.
   */
  processed: number;
  // Events the SIEM accepted.
  sent: number;
  /*
   * Events the SIEM refused one by one (a field it would not take), left
   * out so the rest of their batch still got through. Never retried.
   */
  rejected: number;
  // The SIEM's reason for the first one it refused.
  rejectionReason: string;
  // Requests made, retries included.
  requests: number;
  /*
   * Why the send stopped before the last event, when it did: the SIEM
   * refused the credentials, could not be reached, or kept answering with
   * an error. The events from `processed` on were not delivered.
   */
  failure: string;
  failureStatus: number | null;
}

/*
 * A failure that stops a send: the SIEM refused the credentials, cannot be
 * reached, or kept answering with an error after the retries. The events
 * were not delivered; the forwarder tries the same window again next time.
 */
export class SecurityEventSendError extends Error {
  public readonly status: number | null;

  public constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "SecurityEventSendError";
    this.status = status;
  }
}

export interface SecurityEventSender {
  // Throws BadDataException naming the setting that is wrong.
  validateSettings(settings: SecurityEventDestinationSettings): void;

  /*
   * Sends the events, in order, in batches the SIEM takes. Returns what was
   * sent and refused, and - when it had to stop - why and where.
   */
  send(data: {
    settings: SecurityEventDestinationSettings;
    events: Array<SecurityEventRecord>;
  }): Promise<SecurityEventSendResult>;

  // Sends one test event, so a person setting it up sees it arrive.
  sendTestEvent(settings: SecurityEventDestinationSettings): Promise<void>;
}
