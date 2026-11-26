import {
  JsonSyntaxCheckResult,
  checkJsonSyntax,
} from "../../Types/Code/JsonSyntax";
import Dictionary from "../../Types/Dictionary";
import MonitorType from "../../Types/Monitor/MonitorType";
import MonitorRequestBodyFormat, {
  MonitorRequestBodyFormatUtil,
} from "../../Types/Monitor/MonitorRequestBodyFormat";
import { translationKey } from "../../Types/Translator";
import {
  TemplatePlaceholder,
  findTemplatePlaceholders,
  replaceTemplatePlaceholders,
} from "../TemplatePlaceholders";
import { getReferencedName } from "./MonitorSecretReferences";
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
 *   - fillPlaceholders (the server, as it fills in the monitor's secrets):
 *     each {{...}} written as its place in the body needs it - escaped
 *     inside a JSON string, as it is anywhere else (#10735).
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
 *
 * A step whose body is text (MonitorRequestBodyFormat.Text, #10736) is
 * none of that: it is never read as JSON, never refused for not being
 * JSON, and its placeholders are filled in as they are. The probe sends it
 * byte for byte.
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

/*
 * Where a placeholder stands in a body: inside a string, and the quote that
 * opened it - JSON's ", or the ' JSON5 also reads - or on its own (null).
 */
type PlaceholderQuote = '"' | "'" | null;

// What a body's own text is, at a point in it.
enum BodyTextState {
  Value = "value",
  String = "string",
  LineComment = "line comment",
  BlockComment = "block comment",
}

// Built from their code points: written as they are, a tool reads each as a line break.
const LINE_SEPARATOR: string = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR: string = String.fromCharCode(0x2029);

const LINE_TERMINATORS: ReadonlyArray<string> = [
  "\n",
  "\r",
  LINE_SEPARATOR,
  PARAGRAPH_SEPARATOR,
];

/*
 * A value as text inside a string opened by `quote`: what JSON.stringify
 * writes between its quotes - a quote, a backslash and every control
 * character escaped, anything else as it is - with a single quote escaped
 * too inside a JSON5 string opened by one. The line and paragraph
 * separators are escaped as well: JSON reads them either way, and JSON5
 * warns of one it finds as it is.
 */
const escapeForString: (value: string, quote: '"' | "'") => string = (
  value: string,
  quote: '"' | "'",
): string => {
  const escaped: string = JSON.stringify(value)
    .slice(1, -1)
    .split(LINE_SEPARATOR)
    .join("\\u2028")
    .split(PARAGRAPH_SEPARATOR)
    .join("\\u2029");

  return quote === '"' ? escaped : escaped.split("'").join("\\'");
};

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
   * refuse it. A text body is sent as written, whatever it holds.
   */
  public static getUnreadableError(data: {
    monitorType: MonitorType | undefined | null;
    requestBody: unknown;
    requestBodyFormat?: MonitorRequestBodyFormat | undefined;
  }): string | null {
    if (
      data.monitorType !== MonitorType.API ||
      MonitorRequestBodyFormatUtil.isText(data.requestBodyFormat)
    ) {
      return null;
    }

    return MonitorRequestBody.getProblem(data.requestBody)
      ? REQUEST_BODY_NOT_JSON_MESSAGE
      : null;
  }

  /*
   * A body with its {{...}} placeholders filled in: each one getValue gives
   * a value for, the rest left as written (#10735).
   *
   * A value is text, and where it lands decides how it is written. In a
   * body that is JSON once its placeholders are filled in (getProblem):
   *
   *   - a placeholder inside a string - "password": "{{monitorSecrets.P}}"
   *     - is written escaped for that string, so a value holding a quote, a
   *     backslash or a line break stays one string. The server used to
   *     write every value as it is, so a password ab"c ended the string
   *     early: the body was no JSON any more, and the check failed without
   *     sending anything;
   *   - a placeholder on its own - [{{monitorSecrets.Ids}}] or
   *     {"count": {{monitorSecrets.Count}}} - is written as it is, as it
   *     always was: a value 1,2,3 is three numbers in the array, never one
   *     string.
   *
   * A body that is not JSON, and a text body (#10736), is written as it is
   * throughout.
   *
   * Where a placeholder stands is read from the body as written, never from
   * a value filled in: a quote one value holds never ends a string for the
   * next. A one-time code is digits, which read the same either way, so the
   * probe's per-attempt fill (MonitorSecretTotp's fillTotpCodes) writes the
   * same bytes this would.
   */
  public static fillPlaceholders(data: {
    body: string;
    getValue: (placeholder: TemplatePlaceholder) => string | undefined;
    // JSON when unset.
    format?: MonitorRequestBodyFormat | undefined;
  }): string {
    const placeholders: Array<TemplatePlaceholder> = findTemplatePlaceholders(
      data.body,
    );

    if (placeholders.length === 0) {
      return data.body;
    }

    const quotes: Array<PlaceholderQuote> =
      !MonitorRequestBodyFormatUtil.isText(data.format) &&
      MonitorRequestBody.getProblem(data.body) === null
        ? MonitorRequestBody.getPlaceholderQuotes(data.body, placeholders)
        : placeholders.map((): PlaceholderQuote => {
            return null;
          });

    let filled: string = "";
    let position: number = 0;

    placeholders.forEach((placeholder: TemplatePlaceholder, index: number) => {
      const value: string | undefined = data.getValue(placeholder);
      const quote: PlaceholderQuote = quotes[index] ?? null;

      filled += data.body.slice(position, placeholder.start);

      if (value === undefined) {
        filled += placeholder.text;
      } else {
        filled += quote === null ? value : escapeForString(value, quote);
      }

      position = placeholder.end;
    });

    return filled + data.body.slice(position);
  }

  /*
   * A body with a monitor's secrets filled in, as the server fills them
   * before it hands the check to a probe: each {{monitorSecrets.NAME}} that
   * names one of these values, written as fillPlaceholders writes it. A
   * reference to any other secret - one the monitor may not use, or a
   * one-time code secret, whose code the probe makes - is left as written.
   */
  public static fillSecrets(
    body: string,
    values: ReadonlyMap<string, string>,
    // How the step sends its body: JSON when unset.
    format?: MonitorRequestBodyFormat | undefined,
  ): string {
    if (values.size === 0) {
      return body;
    }

    return MonitorRequestBody.fillPlaceholders({
      body: body,
      format: format,
      getValue: (placeholder: TemplatePlaceholder): string | undefined => {
        const name: string | null = getReferencedName(placeholder);

        return name === null ? undefined : values.get(name);
      },
    });
  }

  /*
   * Where each placeholder stands in a JSON or JSON5 body, read from the
   * body's own text: inside a string and the quote that opened it, or on
   * its own. A placeholder is a value of its own: it neither opens nor
   * ends a string. A comment is no string: a quote in one opens nothing.
   */
  private static getPlaceholderQuotes(
    body: string,
    placeholders: Array<TemplatePlaceholder>,
  ): Array<PlaceholderQuote> {
    const quotes: Array<PlaceholderQuote> = [];
    let state: BodyTextState = BodyTextState.Value;
    let quote: '"' | "'" = '"';
    let isEscaped: boolean = false;
    let position: number = 0;

    for (const placeholder of placeholders) {
      for (let at: number = position; at < placeholder.start; at++) {
        const character: string = body[at] as string;

        switch (state) {
          case BodyTextState.Value:
            if (character === '"' || character === "'") {
              state = BodyTextState.String;
              quote = character;
              isEscaped = false;
            } else if (character === "/" && body[at + 1] === "/") {
              state = BodyTextState.LineComment;
              at++;
            } else if (character === "/" && body[at + 1] === "*") {
              state = BodyTextState.BlockComment;
              at++;
            }
            break;
          case BodyTextState.String:
            if (isEscaped) {
              isEscaped = false;
            } else if (character === "\\") {
              isEscaped = true;
            } else if (character === quote) {
              state = BodyTextState.Value;
            }
            break;
          case BodyTextState.LineComment:
            if (LINE_TERMINATORS.includes(character)) {
              state = BodyTextState.Value;
            }
            break;
          case BodyTextState.BlockComment:
            if (character === "*" && body[at + 1] === "/") {
              state = BodyTextState.Value;
              at++;
            }
            break;
        }
      }

      quotes.push(state === BodyTextState.String ? quote : null);

      // What is written in its place is whole: it escapes nothing after it.
      isEscaped = false;
      position = placeholder.end;
    }

    return quotes;
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

  /*
   * Whether only a probe that sends any request body can send this one
   * (ProbeCapability.AnyRequestBody, #10737): a text body (#10736), or JSON
   * that is not an object - an array or a single value. A probe from before
   * #9737 read every body as a JSON object (JSONFunctions.parseJSONObject):
   * it failed an array or a single value with "Expected JSONObject, but got
   * JSONArray", and knows nothing of a text body. No body, a JSON object,
   * and a JSON body that is no JSON at all - which no probe sends - need no
   * such probe. Read as the server hands the step over, its secrets filled
   * in: a placeholder still in it - a one-time code, which the probe makes -
   * stands for its value, as getProblem reads one.
   */
  public static needsProbeThatSendsAnyBody(
    body: unknown,
    // How the step sends its body: JSON when unset.
    format?: MonitorRequestBodyFormat | undefined,
  ): boolean {
    const text: string | undefined = MonitorRequestBody.getText(body);

    if (text === undefined) {
      return false;
    }

    if (MonitorRequestBodyFormatUtil.isText(format)) {
      return true;
    }

    const reading: MonitorRequestBodyReading = MonitorRequestBody.read(
      replaceTemplatePlaceholders(text, (): string => {
        return "1";
      }),
    );

    return reading.isJson && !MonitorRequestBody.isObject(reading.value);
  }
}
