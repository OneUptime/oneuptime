import { FORM_PUBLIC_API_URL } from "./ApiPaths";
import FormAPI from "./FormAPI";
import FormMessage, { isKnownFormMessage } from "./FormMessage";
import { getRetryAfterSecondsFromError } from "./VerificationEmailResend";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import {
  FORM_FAVICON_IMAGE,
  FORM_LOGO_IMAGE,
  PublicFormImage,
  readFormLogoAltText,
  readPublicFormImage,
} from "Common/Types/Form/FormBranding";
import { isFormFieldId } from "Common/Types/Form/FormField";
import {
  findPublicFormTemplate,
  PublicForm,
  PublicFormField,
  PublicFormFieldOption,
  PublicFormFieldType,
  PublicFormSubmissionRequest,
  PublicFormSubmissionResult,
  PublicFormTemplate,
} from "Common/Types/Form/FormPublic";
import {
  FORM_MAX_TEMPLATES,
  FORM_TEMPLATE_NAME_MAX_LENGTH,
  isFormTemplateId,
} from "Common/Types/Form/FormTemplate";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { packPublicFormAnswers } from "Common/UI/Components/PublicForm/PublicFormFields";

/*
 * Everything the public form page does apart from drawing itself: which
 * link it was opened with, the two requests it makes, what it sends, and
 * what it tells the submitter when something goes wrong.
 *
 * The page is filled in by people with no OneUptime account, so nothing it
 * is handed is trusted either: not the key in its own address bar, and not
 * the form the server describes - a body this page cannot draw is treated
 * as a form that could not be loaded, never rendered half-way.
 */

type IsKnownServerMessageFunction = (
  message: string | undefined,
) => message is string;

// A sentence the server sent that is one of FormMessage.
const isKnownServerMessage: IsKnownServerMessageFunction = (
  message: string | undefined,
): message is string => {
  return typeof message === "string" && isKnownFormMessage(message);
};

export type NormalizeFormShareKeyFunction = (value: unknown) => string | null;

/**
 * The share key from the page's address, or null when it is not one.
 *
 * A key is a UUID (the server accepts nothing else) and it is put into the
 * path of every request this page makes. Checked here, before any request,
 * so that a crafted link - "..%2F..%2Fsomething" - can never point the
 * page's GET or its POST at another route on this host, where the visitor's
 * own session cookies would ride along.
 */
export const normalizeFormShareKey: NormalizeFormShareKeyFunction = (
  value: unknown,
): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const key: string = value.trim().toLowerCase();

  return ObjectID.isValidUUID(key) ? key : null;
};

export type GetFormUrlFunction = (shareKey: string) => URL;

// GET: the form's questions.
export const getFormUrl: GetFormUrlFunction = (shareKey: string): URL => {
  return URL.fromURL(FORM_PUBLIC_API_URL).addRoute(
    `/${encodeURIComponent(shareKey)}`,
  );
};

// POST: create what the form is for, from the answers.
export const getFormSubmitUrl: GetFormUrlFunction = (shareKey: string): URL => {
  return URL.fromURL(FORM_PUBLIC_API_URL).addRoute(
    `/${encodeURIComponent(shareKey)}/submit`,
  );
};

type IsPlainObjectFunction = (
  value: unknown,
) => value is Record<string, unknown>;

const isPlainObject: IsPlainObjectFunction = (
  value: unknown,
): value is Record<string, unknown> => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

const PUBLIC_FORM_FIELD_TYPES: ReadonlyArray<string> =
  Object.values(PublicFormFieldType);

type ReadOptionsFunction = (value: unknown) => Array<PublicFormFieldOption>;

// A choice's options: each needs a value to send back.
const readOptions: ReadOptionsFunction = (
  value: unknown,
): Array<PublicFormFieldOption> => {
  if (!Array.isArray(value)) {
    return [];
  }

  const options: Array<PublicFormFieldOption> = [];

  for (const entry of value) {
    if (
      !isPlainObject(entry) ||
      typeof entry["value"] !== "string" ||
      !entry["value"]
    ) {
      continue;
    }

    const option: PublicFormFieldOption = {
      value: entry["value"],
      label:
        typeof entry["label"] === "string" && entry["label"]
          ? entry["label"]
          : entry["value"],
    };

    if (typeof entry["color"] === "string" && entry["color"]) {
      option.color = entry["color"];
    }

    options.push(option);
  }

  return options;
};

type ReadFieldFunction = (value: unknown) => PublicFormField | null;

/*
 * One question, read with the server's rules (buildPublicForm): it needs an
 * id and a label, a type this page does not know is asked as text, and a
 * choice with nothing to choose from is not asked at all.
 */
const readField: ReadFieldFunction = (
  value: unknown,
): PublicFormField | null => {
  if (!isPlainObject(value) || !isFormFieldId(value["id"])) {
    return null;
  }

  const type: PublicFormFieldType =
    typeof value["type"] === "string" &&
    PUBLIC_FORM_FIELD_TYPES.includes(value["type"])
      ? (value["type"] as PublicFormFieldType)
      : PublicFormFieldType.Text;

  const field: PublicFormField = {
    id: value["id"] as string,
    label: typeof value["label"] === "string" ? value["label"] : "",
    type: type,
    isRequired: value["isRequired"] === true,
  };

  if (typeof value["helpText"] === "string" && value["helpText"].trim()) {
    field.helpText = value["helpText"];
  }

  if (
    typeof value["maxLength"] === "number" &&
    Number.isFinite(value["maxLength"]) &&
    value["maxLength"] > 0
  ) {
    field.maxLength = value["maxLength"];
  }

  if (
    type === PublicFormFieldType.Dropdown ||
    type === PublicFormFieldType.MultiSelectDropdown
  ) {
    field.options = readOptions(value["options"]);

    if (field.options.length === 0) {
      return null;
    }

    const defaultValue: unknown = value["defaultValue"];

    if (
      typeof defaultValue === "string" &&
      field.options.some((option: PublicFormFieldOption): boolean => {
        return option.value === defaultValue;
      })
    ) {
      field.defaultValue = defaultValue;
    }
  }

  return field;
};

type ReadTemplatesFunction = (data: {
  value: unknown;
  fields: Array<PublicFormField>;
}) => Array<PublicFormTemplate>;

/*
 * The templates the server listed, read with the server's rules: each needs
 * an id and a name, an id is listed once, only the first default is one,
 * and a template keeps only its answers to the questions this page asks -
 * what each answer is, the page's inputs read (getPublicFormValuesFromAnswers)
 * and the server checks again.
 */
const readTemplates: ReadTemplatesFunction = (data: {
  value: unknown;
  fields: Array<PublicFormField>;
}): Array<PublicFormTemplate> => {
  if (!Array.isArray(data.value)) {
    return [];
  }

  const fieldIds: Set<string> = new Set<string>(
    data.fields.map((field: PublicFormField): string => {
      return field.id;
    }),
  );
  const templates: Array<PublicFormTemplate> = [];
  let hasDefault: boolean = false;

  for (const entry of data.value.slice(0, FORM_MAX_TEMPLATES)) {
    if (
      !isPlainObject(entry) ||
      !isFormTemplateId(entry["id"]) ||
      typeof entry["name"] !== "string" ||
      !entry["name"].trim()
    ) {
      continue;
    }

    const id: string = entry["id"];

    if (
      templates.some((template: PublicFormTemplate): boolean => {
        return template.id === id;
      })
    ) {
      continue;
    }

    const answers: JSONObject = {};
    const rawAnswers: unknown = entry["answers"];

    if (isPlainObject(rawAnswers)) {
      for (const key of Object.keys(rawAnswers)) {
        if (fieldIds.has(key)) {
          Object.defineProperty(answers, key, {
            value: rawAnswers[key],
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
      }
    }

    const template: PublicFormTemplate = {
      id: id,
      name: entry["name"].trim().slice(0, FORM_TEMPLATE_NAME_MAX_LENGTH),
      answers: answers,
    };

    if (entry["isDefault"] === true && !hasDefault) {
      template.isDefault = true;
      hasDefault = true;
    }

    templates.push(template);
  }

  return templates;
};

export type ReadPublicFormFunction = (data: unknown) => PublicForm;

/**
 * The form GET /form/public/:shareKey described, as the page draws it.
 * Throws for a body that is not a form at all (a proxy's error page served
 * with a 200, say), which the page reports as a form it could not load.
 *
 * Its branding is read as carefully: a logo or favicon is drawn only when it
 * is an allowed image type in real base64 of an allowed size
 * (readPublicFormImage) - anything else is left out, and the page shows
 * OneUptime's - and the logo's alt text only goes with a logo. So are its
 * templates (readTemplates).
 */
export const readPublicForm: ReadPublicFormFunction = (
  data: unknown,
): PublicForm => {
  if (
    !isPlainObject(data) ||
    typeof data["name"] !== "string" ||
    !Array.isArray(data["fields"])
  ) {
    throw new Error("The form could not be read.");
  }

  const fields: Array<PublicFormField> = [];
  const ids: Set<string> = new Set<string>();

  for (const entry of data["fields"]) {
    const field: PublicFormField | null = readField(entry);

    if (field && !ids.has(field.id)) {
      ids.add(field.id);
      fields.push(field);
    }
  }

  const form: PublicForm = {
    name: data["name"],
    fields: fields,
    isCaptchaRequired: data["isCaptchaRequired"] === true,
  };

  if (typeof data["description"] === "string" && data["description"].trim()) {
    form.description = data["description"];
  }

  const templates: Array<PublicFormTemplate> = readTemplates({
    value: data["templates"],
    fields: fields,
  });

  if (templates.length > 0) {
    form.templates = templates;
  }

  const logo: PublicFormImage | undefined = readPublicFormImage(
    data["logo"],
    FORM_LOGO_IMAGE,
  );

  if (logo) {
    form.logo = logo;

    const logoAltText: string | undefined = readFormLogoAltText(
      data["logoAltText"],
    );

    if (logoAltText) {
      form.logoAltText = logoAltText;
    }
  }

  const favicon: PublicFormImage | undefined = readPublicFormImage(
    data["favicon"],
    FORM_FAVICON_IMAGE,
  );

  if (favicon) {
    form.favicon = favicon;
  }

  return form;
};

export type ReadFormSubmissionResultFunction = (
  data: unknown,
) => PublicFormSubmissionResult;

/*
 * What the submitter is shown once the submission is made. It worked
 * whatever the body holds, so a body this page cannot read still ends on the
 * thank-you screen - just without the reference number.
 */
export const readFormSubmissionResult: ReadFormSubmissionResultFunction = (
  data: unknown,
): PublicFormSubmissionResult => {
  const result: PublicFormSubmissionResult = {};

  if (!isPlainObject(data)) {
    return result;
  }

  if (typeof data["reference"] === "string" && data["reference"].trim()) {
    result.reference = data["reference"].trim();
  }

  if (
    typeof data["successMessage"] === "string" &&
    data["successMessage"].trim()
  ) {
    result.successMessage = data["successMessage"];
  }

  return result;
};

export type LoadPublicFormFunction = (shareKey: string) => Promise<PublicForm>;

/**
 * Read the form behind a share key. A refusal is thrown as the
 * HTTPErrorResponse itself, so getFormFailure can tell a form that is gone
 * (404) from a network that is not allowed (403) from a limit (429).
 */
export const loadPublicForm: LoadPublicFormFunction = async (
  shareKey: string,
): Promise<PublicForm> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await FormAPI.get<JSONObject>({
      url: getFormUrl(shareKey),
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return readPublicForm(response.data);
};

export type SubmitPublicFormFunction = (
  shareKey: string,
  request: PublicFormSubmissionRequest,
) => Promise<PublicFormSubmissionResult>;

// Send the answers. Refusals are thrown as for loadPublicForm.
export const submitPublicForm: SubmitPublicFormFunction = async (
  shareKey: string,
  request: PublicFormSubmissionRequest,
): Promise<PublicFormSubmissionResult> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await FormAPI.post<JSONObject>({
      url: getFormSubmitUrl(shareKey),
      data: request as unknown as JSONObject,
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return readFormSubmissionResult(response.data);
};

export type BuildFormSubmissionRequestFunction = (data: {
  form: PublicForm;
  // Everything the page's form submitted, keyed as the page keyed its fields.
  values: JSONObject;
  captchaToken?: string | undefined;
  // The template the submitter started from, if any.
  templateId?: string | null | undefined;
}) => PublicFormSubmissionRequest;

/**
 * The body of the submit request: the answers to the questions the form
 * asks, keyed by question id (packPublicFormAnswers), the template the
 * submitter started from when it is one of the form's - the server answers
 * the form's hidden questions from it - and the captcha answer when there
 * is one. Nothing else is ever sent.
 */
export const buildFormSubmissionRequest: BuildFormSubmissionRequestFunction =
  (data: {
    form: PublicForm;
    values: JSONObject;
    captchaToken?: string | undefined;
    templateId?: string | null | undefined;
  }): PublicFormSubmissionRequest => {
    const request: PublicFormSubmissionRequest = {
      data: {
        answers: packPublicFormAnswers({
          form: data.form,
          values: data.values || {},
        }),
      },
    };

    if (findPublicFormTemplate(data.form, data.templateId)) {
      request.data.templateId = data.templateId as string;
    }

    const captchaToken: string = (data.captchaToken || "").trim();

    if (captchaToken) {
      request.captchaToken = captchaToken;
    }

    return request;
  };

export enum FormFailureKind {
  // 404: the one answer for every link that does not lead to a live form.
  NotAvailable = "NotAvailable",
  // 403: the form's IP allowlist does not include the visitor's network.
  NetworkNotAllowed = "NetworkNotAllowed",
  // 429: a rate limit refused the request.
  RateLimited = "RateLimited",
  // 400: the server refused the answers or the captcha, and said why.
  Refused = "Refused",
  // Anything else: 5xx, no answer at all, an answer this page cannot read.
  Unavailable = "Unavailable",
}

export interface FormFailure {
  kind: FormFailureKind;
  // What the server said, when its answer carried a sentence at all.
  serverMessage?: string | undefined;
  // How long a 429 asked the visitor to wait, in seconds; 0 when it did not say.
  retryAfterSeconds: number;
}

type ReadServerMessageFunction = (
  error: HTTPErrorResponse,
) => string | undefined;

/*
 * The sentence a refusal carried: the "message" (limiters) or "error"
 * (handlers) of a JSON body. Deliberately not HTTPErrorResponse.message,
 * which also reads a body that was not JSON at all - the HTML of a proxy's
 * error page would be shown to the submitter as if it were a sentence.
 */
const readServerMessage: ReadServerMessageFunction = (
  error: HTTPErrorResponse,
): string | undefined => {
  const body: unknown = error.data;

  if (!isPlainObject(body)) {
    return undefined;
  }

  for (const key of ["message", "error"]) {
    const value: unknown = body[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
};

export type GetFormFailureFunction = (error: unknown) => FormFailure;

/**
 * What went wrong with a request, by the status the server answered with.
 * The status decides, never the words: a 404 is "not available" whatever
 * body came with it.
 */
export const getFormFailure: GetFormFailureFunction = (
  error: unknown,
): FormFailure => {
  if (!(error instanceof HTTPErrorResponse)) {
    return { kind: FormFailureKind.Unavailable, retryAfterSeconds: 0 };
  }

  const serverMessage: string | undefined = readServerMessage(error);

  switch (error.statusCode) {
    case 404:
      return {
        kind: FormFailureKind.NotAvailable,
        serverMessage: serverMessage,
        retryAfterSeconds: 0,
      };

    case 403:
      return {
        kind: FormFailureKind.NetworkNotAllowed,
        serverMessage: serverMessage,
        retryAfterSeconds: 0,
      };

    case 429:
      return {
        kind: FormFailureKind.RateLimited,
        serverMessage: serverMessage,
        retryAfterSeconds: getRetryAfterSecondsFromError(error),
      };

    case 400:
      return {
        // A 400 that does not say why is no more use to the submitter than a 500.
        kind: serverMessage
          ? FormFailureKind.Refused
          : FormFailureKind.Unavailable,
        serverMessage: serverMessage,
        retryAfterSeconds: 0,
      };

    default:
      return {
        kind: FormFailureKind.Unavailable,
        serverMessage: serverMessage,
        retryAfterSeconds: 0,
      };
  }
};

// Which request failed: reading the form, or sending the answers.
export enum FormStage {
  Load = "Load",
  Submit = "Submit",
}

export type GetFormFailureMessageFunction = (data: {
  failure: FormFailure;
  stage: FormStage;
}) => string;

/**
 * The sentence to show for a failure, in English: one of FormMessage
 * (translate it with isKnownFormMessage), or - for a 400 - the server's own
 * words as they came.
 *
 * A 404 and a 403 always get the page's sentence, whatever the body said. A
 * limit or an outage repeats the server's sentence when it is one the page
 * knows - the limiters word their refusals by what was limited (this
 * network, or the whole form), and a 503 on submit says submissions are
 * paused - and otherwise gets the page's own: a proxy's "Bad Gateway" or the
 * server's bare "Server Error" tells a submitter nothing.
 */
export const getFormFailureMessage: GetFormFailureMessageFunction = (data: {
  failure: FormFailure;
  stage: FormStage;
}): string => {
  switch (data.failure.kind) {
    case FormFailureKind.NotAvailable:
      return FormMessage.NotAvailable;

    case FormFailureKind.NetworkNotAllowed:
      return FormMessage.NetworkNotAllowed;

    case FormFailureKind.RateLimited:
      if (isKnownServerMessage(data.failure.serverMessage)) {
        return data.failure.serverMessage;
      }

      return data.stage === FormStage.Submit
        ? FormMessage.TooManySubmissions
        : FormMessage.TooManyRequests;

    case FormFailureKind.Refused:
      return (
        data.failure.serverMessage ||
        (data.stage === FormStage.Submit
          ? FormMessage.SubmitFailed
          : FormMessage.LoadFailed)
      );

    default:
      if (isKnownServerMessage(data.failure.serverMessage)) {
        return data.failure.serverMessage;
      }

      return data.stage === FormStage.Submit
        ? FormMessage.SubmitFailed
        : FormMessage.LoadFailed;
  }
};

export type FormatFormRetryAfterFunction = (
  seconds: number,
  locale?: string | undefined,
) => string | null;

/**
 * "in 5 minutes", in the page's language, for the sentence that says when
 * the submitter can try again - or null when the server named no wait (or
 * the browser cannot word one). Rounded UP to the unit shown: coming back a
 * little late costs nothing, coming back early is refused again.
 */
export const formatFormRetryAfter: FormatFormRetryAfterFunction = (
  seconds: number,
  locale?: string | undefined,
): string | null => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  let value: number = Math.ceil(seconds);
  let unit: Intl.RelativeTimeFormatUnit = "second";

  if (seconds >= 60 * 60) {
    value = Math.ceil(seconds / (60 * 60));
    unit = "hour";
  } else if (seconds >= 60) {
    value = Math.ceil(seconds / 60);
    unit = "minute";
  }

  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: "always" }).format(
      value,
      unit,
    );
  } catch {
    // An unknown language tag, or no Intl.RelativeTimeFormat at all.
    return null;
  }
};
