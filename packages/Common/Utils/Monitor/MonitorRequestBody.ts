import {
  JsonSyntaxCheckResult,
  checkJsonSyntax,
} from "../../Types/Code/JsonSyntax";
import Dictionary from "../../Types/Dictionary";
import MonitorType from "../../Types/Monitor/MonitorType";
import { translationKey } from "../../Types/Translator";
import JSON5 from "json5";

/*
 * AN API MONITOR'S REQUEST BODY: ANY JSON VALUE, SENT AS IT IS WRITTEN
 * (#9737).
 *
 * An API monitor's step keeps its body as text (MonitorStep.requestBody):
 * JSON as the person wrote it - an object, an array, or a single value such
 * as a string, a number, true, false or null. From March 2024 the probe read
 * it with JSONFunctions.parseJSONObject, so an array or a single value threw
 * "Expected JSONObject, but got JSONArray" before the request was sent: the
 * check failed with that sentence on every run, and a Test Monitor run never
 * answered. Nothing else ever said a body had to be an object - not the
 * form, not the API, not the docs.
 *
 * Every reader of a body reads it here, so they agree on what one is:
 *
 *   - getText: the body there is to send. Text with nothing but whitespace
 *     is no body, as an empty one always was.
 *   - readWritten (MonitorStep.fromJSON): a body an API client wrote as a
 *     JSON value rather than as text is kept as its text. It was kept as the
 *     value, and the probe, which reads text, sent no body at all.
 *   - getProblem and getUnreadableError: a body that cannot be JSON,
 *     whatever its {{...}} placeholders are filled with, is refused with one
 *     sentence - by the monitor form (MonitorStep.getValidationError) and by
 *     the server for the API, Terraform, a workflow or an AI through the MCP
 *     server (MonitorStepsValuesUtil). The code editor of the form's field
 *     judges the body with the same check, so its status line and the form
 *     never disagree.
 *   - read and isSentAsForm (the probe, as each attempt is sent): what the
 *     request carries, once the server has filled in the monitor's secrets
 *     and the probe its one-time codes - or that it is not JSON, and the
 *     check fails saying so (ProbeFailureCause.RequestBodyNotJson) without
 *     sending anything.
 *
 * JSON is read the way the probe always read it, JSONFunctions.parse's way:
 * JSON, or failing that JSON5 (unquoted keys, single quotes, a trailing
 * comma, comments), so every body that is sent today still is. A body in
 * JSON is sent byte for byte as written - no number rounded, no key moved or
 * dropped. One in JSON5, which the API it goes to would not read, is sent as
 * the JSON it stands for, as it always was.
 */

// What the monitor form and the API say of a body no check could send.
export const REQUEST_BODY_NOT_JSON_MESSAGE: string = translationKey(
  "This API monitor's request body is not valid JSON. Use an object, an array or a single value such as a string or a number, or leave the body empty.",
);

/*
 * The Content-Types whose request an object body is sent as the form of:
 * its fields, URL-encoded or as multipart parts.
 */
const FORM_CONTENT_TYPES: ReadonlyArray<string> = [
  "application/x-www-form-urlencoded",
  "multipart/form-data",
];

// A body read for sending.
export type MonitorRequestBodyReading =
  | {
      isJson: true;
      /*
       * The text the request carries: the body as written, or the JSON a
       * JSON5 body stands for.
       */
      json: string;
      // The value it holds.
      value: unknown;
    }
  | {
      isJson: false;
      // Where it stops being JSON, as JSON5 reads it, when the parser says.
      line: number | null;
      column: number | null;
    };

export default class MonitorRequestBody {
  /*
   * The body there is to send, or undefined for none: text with something
   * besides whitespace. Anything else is no body.
   */
  public static getText(body: unknown): string | undefined {
    return typeof body === "string" && body.trim() !== "" ? body : undefined;
  }

  /*
   * A body as stored, read as text. One written as a JSON value - an
   * object, an array, a number or true or false, as an API client may send
   * it - is the JSON text of that value, laid out to read in the form's
   * editor. Text is kept exactly as written: the Terraform provider reads
   * back what it sent.
   */
  public static readWritten(written: unknown): string | undefined {
    if (written === undefined || written === null) {
      return undefined;
    }

    if (typeof written === "string") {
      return written;
    }

    try {
      return JSON.stringify(written, null, 2);
    } catch {
      // A value JSON cannot write was not read from JSON.
      return undefined;
    }
  }

  /*
   * Why a body cannot be JSON once its {{...}} placeholders are filled in -
   * the editor's own check, with JSON5 allowed as the probe allows it - or
   * null when it can be, or there is no body. A placeholder stands for its
   * value wherever it is: inside a string, as a whole value or as a key.
   */
  public static getProblem(body: unknown): JsonSyntaxCheckResult | null {
    const text: string | undefined = MonitorRequestBody.getText(body);

    if (text === undefined) {
      return null;
    }

    const result: JsonSyntaxCheckResult = checkJsonSyntax(text, {
      allowJSON5: true,
    });

    return result.isValid ? null : result;
  }

  /*
   * Why a step's body cannot be sent, or null when it can. Only an API
   * monitor sends one: a step of another type that kept a body from when
   * it was an API monitor sends nothing, so its body is no reason to
   * refuse it.
   */
  public static getUnreadableError(data: {
    monitorType: MonitorType | undefined | null;
    requestBody: unknown;
  }): string | null {
    if (data.monitorType !== MonitorType.API) {
      return null;
    }

    return MonitorRequestBody.getProblem(data.requestBody)
      ? REQUEST_BODY_NOT_JSON_MESSAGE
      : null;
  }

  /*
   * A body as an attempt sends it, its placeholders filled in: JSON as
   * written, the JSON a JSON5 body stands for, or not JSON at all.
   */
  public static read(text: string): MonitorRequestBodyReading {
    try {
      return { isJson: true, json: text, value: JSON.parse(text) };
    } catch {
      // Not JSON: JSON5 may read it.
    }

    try {
      const value: unknown = JSON5.parse(text);
      const json: string | undefined = JSON.stringify(value);

      if (json !== undefined) {
        return { isJson: true, json: json, value: value };
      }
    } catch (error: unknown) {
      const position: { lineNumber?: unknown; columnNumber?: unknown } =
        (error as { lineNumber?: unknown; columnNumber?: unknown } | null) ||
        {};

      return {
        isJson: false,
        line:
          typeof position.lineNumber === "number" ? position.lineNumber : null,
        column:
          typeof position.columnNumber === "number"
            ? position.columnNumber
            : null,
      };
    }

    return { isJson: false, line: null, column: null };
  }

  /*
   * Whether a request with these headers sends an object body as a form:
   * its Content-Type, the header named in any case, is a URL-encoded or a
   * multipart form. Such a body has always gone out as the object's fields
   * (API.fetch and axios write the object as the form), and still does.
   */
  public static isSentAsForm(headers: Dictionary<string> | undefined): boolean {
    for (const name of Object.keys(headers || {})) {
      if (name.toLowerCase() !== "content-type") {
        continue;
      }

      const value: string = String(headers![name] ?? "").toLowerCase();

      if (
        FORM_CONTENT_TYPES.some((formType: string): boolean => {
          return value.includes(formType);
        })
      ) {
        return true;
      }
    }

    return false;
  }

  // Whether a value read from a body is a JSON object, not an array or a single value.
  public static isObject(value: unknown): boolean {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
}
