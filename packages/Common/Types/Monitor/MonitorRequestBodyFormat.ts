/*
 * HOW AN API MONITOR'S STEP SENDS ITS REQUEST BODY (#10736).
 *
 * A body was always read as JSON: since #9737 any JSON value, sent as
 * written. A body that is not JSON - XML for a SOAP endpoint, plain text,
 * form fields written as a=1&b=2 - was refused by the form and the API, and
 * no probe ever sent one. A step says now how its body is read:
 *
 *   - JSON (the default): any JSON value, or JSON5, sent as written under
 *     application/json unless the headers name another Content-Type
 *     (Common/Utils/Monitor/MonitorRequestBody). A step saved before the
 *     format existed has none, and is JSON, so every stored monitor keeps
 *     sending what it sent.
 *   - Text: sent byte for byte and never parsed, under the Content-Type the
 *     headers name, or text/plain;charset=UTF-8. A monitor secret or a
 *     one-time code is filled into it as it is.
 *
 * The wire strings are the contract: the API, the Terraform provider and
 * every stored step write them.
 */
enum MonitorRequestBodyFormat {
  JSON = "json",
  Text = "text",
}

// The Content-Type a text body is sent under when the headers name none.
export const TEXT_REQUEST_BODY_CONTENT_TYPE: string =
  "text/plain;charset=UTF-8";

export class MonitorRequestBodyFormatUtil {
  // Every format, JSON first: the order a picker lists them in.
  public static readonly ALL_FORMATS: ReadonlyArray<MonitorRequestBodyFormat> =
    [MonitorRequestBodyFormat.JSON, MonitorRequestBodyFormat.Text];

  /*
   * The format a step's body is read in: Text only when the step says so;
   * JSON for anything else - no format at all, as every step saved before
   * #10736 has, or a value that names none.
   */
  public static read(value: unknown): MonitorRequestBodyFormat {
    return value === MonitorRequestBodyFormat.Text
      ? MonitorRequestBodyFormat.Text
      : MonitorRequestBodyFormat.JSON;
  }

  public static isText(value: unknown): boolean {
    return (
      MonitorRequestBodyFormatUtil.read(value) === MonitorRequestBodyFormat.Text
    );
  }

  /*
   * A format as stored (MonitorStep.fromJSON): the one written, when it is
   * one, so an API client or Terraform reads back what it sent; nothing
   * otherwise, which reads as JSON.
   */
  public static readWritten(
    value: unknown,
  ): MonitorRequestBodyFormat | undefined {
    return MonitorRequestBodyFormatUtil.ALL_FORMATS.find(
      (format: MonitorRequestBodyFormat): boolean => {
        return format === value;
      },
    );
  }
}

export default MonitorRequestBodyFormat;
