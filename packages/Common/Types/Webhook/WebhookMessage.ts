import { JSONObject } from "../JSON";

export default interface WebhookMessage {
  url: string;
  eventType: string;
  payload: JSONObject;
  secret?: string | undefined;
}
