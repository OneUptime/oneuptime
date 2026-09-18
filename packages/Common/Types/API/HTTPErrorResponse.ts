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
