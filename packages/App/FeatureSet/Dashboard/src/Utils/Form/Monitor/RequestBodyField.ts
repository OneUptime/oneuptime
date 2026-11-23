import {
  JsonSyntaxCheckResult,
  describeJsonSyntaxError,
} from "Common/Types/Code/JsonSyntax";
import { FormValidationMessage } from "Common/UI/Components/Forms/Utils/FormValidationMessages";
import {
  Translator,
  translatableTerm,
} from "Common/UI/Utils/TranslateTemplate";
import MonitorRequestBody from "Common/Utils/Monitor/MonitorRequestBody";
import MonitorRequestBodyFormat, {
  MonitorRequestBodyFormatUtil,
} from "Common/Types/Monitor/MonitorRequestBodyFormat";

/*
 * WHAT THE API MONITOR FORM'S REQUEST BODY FIELD SAYS UNDER ITS EDITOR
 * (#9737).
 *
 * The body is any JSON value: an object, an array or a single value such
 * as a string or a number. The field said "Invalid JSON" for anything
 * JSON.parse refused as written - an empty box, a {{monitorSecrets.NAME}}
 * that stands for a number, JSON5 the probe reads - and the code editor's
 * own status line called the same text fine, while the probe refused every
 * body that was not an object.
 *
 * The field asks MonitorRequestBody now, as the editor's status line, the
 * form's Save (MonitorStep.getValidationError), the API and the probe do:
 * no error for an empty body or for one that is JSON once its placeholders
 * are filled in; for any other, the form's sentence for a field that is not
 * JSON, with where it stops being JSON, in the reader's language. A body
 * sent as text (#10736) is sent as written, and never has an error.
 */
export const getRequestBodyFieldError: (
  body: string,
  translator: Translator,
  format?: MonitorRequestBodyFormat | undefined,
) => string | null = (
  body: string,
  translator: Translator,
  format?: MonitorRequestBodyFormat | undefined,
): string | null => {
  if (MonitorRequestBodyFormatUtil.isText(format)) {
    return null;
  }

  const problem: JsonSyntaxCheckResult | null =
    MonitorRequestBody.getProblem(body);

  if (!problem) {
    return null;
  }

  return translator.translateTemplate(FormValidationMessage.InvalidJson, {
    field: translatableTerm("Request Body"),
    parserMessage: describeJsonSyntaxError(problem),
  });
};

export default getRequestBodyFieldError;
