import { JSONObject } from "../JSON";

/*
 * How a webhook's receiver's certificate is checked, for a sender whose step
 * has the two settings of a Runbook HTTP step (#10440, a playbook's Send
 * Webhook; Types/Runbook/HttpStepCertificates): not at all, or by a CA
 * certificate of its own. Read as there: the switch is on only when exactly
 * true, and the CA certificate is not used while it is.
 */
export interface WebhookCertificates {
  allowSelfSignedCertificates?: boolean | undefined;
  // PEM: the certificates the receiver's chain must end at, and no others.
  caCertificate?: string | undefined;
}

export default interface WebhookMessage {
  url: string;
  eventType: string;
  payload: JSONObject;
  secret?: string | undefined;
  /*
   * Absent, the receiver's certificate is checked as every request checks
   * one. Present, a refused certificate says which of the step's settings
   * would let it through.
   */
  certificates?: WebhookCertificates | undefined;
}
