import { JSONObject, JSONValue } from "../JSON";
import HTTPResponse from "./HTTPResponse";

export default class HTTPErrorResponse extends HTTPResponse<JSONObject> {
  public get message(): string {
    if (!this.data) {
      return "";
    }

    /*
     * Body shapes we accept, in priority order. Each field may be a
     * plain string OR an object — some gateways/proxies return
     * `{ error: { message } }` — so every candidate is coerced to a
     * string. Returning a raw object here is what rendered as
     * "[object Object]" in error banners downstream.
     */
    for (const key of ["data", "message", "error"]) {
      const coerced: string = HTTPErrorResponse.coerceToMessage(this.data[key]);
      if (coerced) {
        return coerced;
      }
    }

    return "";
  }

  /*
   * The message the answer states in words, or "" when it states none (#8413):
   * the first text under data, message or error, or under a message or an
   * error nested in one of them ({ error: { message } }). `message` falls
   * back to the JSON of an object it finds there, or to a number written as
   * text - for a log line, never for a person: an answer of a shape nobody
   * expected ({ error: { code: 42 } }) read '{"code":42}' on the page. A
   * page shows this instead, and an answer that states nothing is a failure
   * nobody explained (BaseAPI.getFriendlyMessage).
   */
  public get statedMessage(): string {
    if (!this.data || typeof this.data !== "object") {
      return "";
    }

    for (const key of ["data", "message", "error"]) {
      const stated: string = HTTPErrorResponse.readStatedWords(this.data[key]);

      if (stated) {
        return stated;
      }
    }

    return "";
  }

  // Words a value states: text, or text nested under message or error.
  private static readStatedWords(value: JSONValue | undefined): string {
    if (typeof value === "string") {
      return value.trim() ? value : "";
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const key of ["message", "error"]) {
        const nested: JSONValue | undefined = (value as JSONObject)[key];

        if (typeof nested === "string" && nested.trim()) {
          return nested;
        }
      }
    }

    return "";
  }

  private static coerceToMessage(value: JSONValue | undefined): string {
    if (value === undefined || value === null) {
      return "";
    }

    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "object") {
      // Common nested shapes: { message: "..." } or { error: "..." }.
      const nested: JSONValue | undefined =
        (value as JSONObject)["message"] ?? (value as JSONObject)["error"];
      if (typeof nested === "string" && nested) {
        return nested;
      }

      try {
        return JSON.stringify(value);
      } catch {
        return "Unknown error";
      }
    }

    return String(value);
  }
}
