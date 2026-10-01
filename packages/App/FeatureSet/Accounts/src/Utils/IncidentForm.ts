import { INCIDENT_FORM_PUBLIC_API_URL } from "./ApiPaths";
import IncidentFormAPI from "./IncidentFormAPI";
import IncidentFormMessage, {
  isKnownIncidentFormMessage,
} from "./IncidentFormMessage";
import { getRetryAfterSecondsFromError } from "./VerificationEmailResend";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import Email from "Common/Types/Email";
import {
  DEFAULT_INCIDENT_FORM_DESCRIPTION_SETTING,
  getPublicIncidentFormFields,
  IncidentFormAskedDefinition,
  IncidentFormFieldSetting,
  isIncidentFormFieldSetting,
  PublicIncidentForm,
  PublicIncidentFormField,
  PublicIncidentFormSeverity,
  PublicIncidentFormSubmissionData,
  PublicIncidentFormSubmissionRequest,
  PublicIncidentFormSubmissionResult,
  WHOLE_EMAIL_ADDRESS,
} from "Common/Types/Incident/IncidentFormPublic";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { CustomFieldFormDefinition } from "Common/UI/Components/CustomFields/CustomFieldFormFields";
import { packCustomFieldFormValues } from "Common/UI/Components/CustomFields/CustomFieldModelFormFields";

/*
 * Everything the public incident form page does apart from drawing itself:
 * which link it was opened with, the two requests it makes, what it sends,
 * and what it tells the reporter when something goes wrong.
 *
 * The page is filled in by people with no OneUptime account, so nothing it
 * is handed is trusted either: not the key in its own address bar, and not
 * the form the server describes - a body this page cannot draw is treated
 * as a form that could not be loaded, never rendered half-way.
 */

type IsKnownServerMessageFunction = (
  message: string | undefined,
) => message is string;

// A sentence the server sent that is one of IncidentFormMessage.
const isKnownServerMessage: IsKnownServerMessageFunction = (
  message: string | undefined,
): message is string => {
  return typeof message === "string" && isKnownIncidentFormMessage(message);
};

export type NormalizeIncidentFormShareKeyFunction = (
  value: unknown,
) => string | null;

/**
 * The share key from the page's address, or null when it is not one.
 *
 * A key is a UUID (the server accepts nothing else) and it is put into the
 * path of every request this page makes. Checked here, before any request,
 * so that a crafted link - "..%2F..%2Fsomething" - can never point the
 * page's GET or its POST at another route on this host, where the visitor's
 * own session cookies would ride along.
 */
export const normalizeIncidentFormShareKey: NormalizeIncidentFormShareKeyFunction =
  (value: unknown): string | null => {
    if (typeof value !== "string") {
      return null;
    }

    const key: string = value.trim().toLowerCase();

    return ObjectID.isValidUUID(key) ? key : null;
  };

export type GetIncidentFormUrlFunction = (shareKey: string) => URL;

// GET: the form's questions.
export const getIncidentFormUrl: GetIncidentFormUrlFunction = (
  shareKey: string,
): URL => {
  return URL.fromURL(INCIDENT_FORM_PUBLIC_API_URL).addRoute(
    `/${encodeURIComponent(shareKey)}`,
  );
};

// POST: declare an incident from the answers.
export const getIncidentFormSubmitUrl: GetIncidentFormUrlFunction = (
  shareKey: string,
): URL => {
  return URL.fromURL(INCIDENT_FORM_PUBLIC_API_URL).addRoute(
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

type ReadSeveritiesFunction = (
  value: unknown,
) => Array<PublicIncidentFormSeverity>;

// The severities a reporter may pick from: each needs an id to send back.
const readSeverities: ReadSeveritiesFunction = (
  value: unknown,
): Array<PublicIncidentFormSeverity> => {
  if (!Array.isArray(value)) {
    return [];
  }

  const severities: Array<PublicIncidentFormSeverity> = [];

  for (const entry of value) {
    if (!isPlainObject(entry)) {
      continue;
    }

    const id: unknown = entry["_id"];

    if (typeof id !== "string" || id.length === 0) {
      continue;
    }

    const severity: PublicIncidentFormSeverity = {
      _id: id,
      name: typeof entry["name"] === "string" ? entry["name"] : "",
    };

    if (typeof entry["color"] === "string" && entry["color"]) {
      severity.color = entry["color"];
    }

    severities.push(severity);
  }

  return severities;
};

type ReadCustomFieldsFunction = (
  value: Array<unknown>,
) => Array<PublicIncidentFormField>;

/*
 * The custom fields to ask, read with the same rules the server builds the
 * list with (getPublicIncidentFormFields): a field needs a name, a second
 * field of the same name is dropped - answers are keyed by name - and a type
 * this page does not know is asked as text.
 */
const readCustomFields: ReadCustomFieldsFunction = (
  value: Array<unknown>,
): Array<PublicIncidentFormField> => {
  return getPublicIncidentFormFields(
    value
      .filter(isPlainObject)
      .map((entry: Record<string, unknown>): IncidentFormAskedDefinition => {
        return {
          name: typeof entry["name"] === "string" ? entry["name"] : undefined,
          description:
            typeof entry["description"] === "string"
              ? entry["description"]
              : undefined,
          customFieldType:
            typeof entry["customFieldType"] === "string"
              ? entry["customFieldType"]
              : undefined,
          dropdownOptions:
            typeof entry["dropdownOptions"] === "string"
              ? entry["dropdownOptions"]
              : undefined,
          isRequiredOnCreate: entry["isRequired"] === true,
        };
      }),
  );
};

export type ReadPublicIncidentFormFunction = (
  data: unknown,
) => PublicIncidentForm;

/**
 * The form GET /incident-form/public/:shareKey described, as the page draws
 * it. Throws for a body that is not a form at all (a proxy's error page
 * served with a 200, say), which the page reports as a form it could not
 * load. Everything optional falls back to what the server's own reader
 * falls back to: Optional for the description, details required, no captcha.
 */
export const readPublicIncidentForm: ReadPublicIncidentFormFunction = (
  data: unknown,
): PublicIncidentForm => {
  if (
    !isPlainObject(data) ||
    typeof data["name"] !== "string" ||
    !Array.isArray(data["customFields"])
  ) {
    throw new Error("The incident form could not be read.");
  }

  const form: PublicIncidentForm = {
    name: data["name"],
    descriptionSetting: isIncidentFormFieldSetting(data["descriptionSetting"])
      ? data["descriptionSetting"]
      : DEFAULT_INCIDENT_FORM_DESCRIPTION_SETTING,
    isReporterDetailsRequired: data["isReporterDetailsRequired"] !== false,
    customFields: readCustomFields(data["customFields"]),
    isCaptchaRequired: data["isCaptchaRequired"] === true,
  };

  if (typeof data["description"] === "string" && data["description"].trim()) {
    form.description = data["description"];
  }

  const severities: Array<PublicIncidentFormSeverity> = readSeverities(
    data["severities"],
  );

  if (severities.length > 0) {
    form.severities = severities;

    const defaultId: unknown = data["defaultIncidentSeverityId"];

    if (
      typeof defaultId === "string" &&
      severities.some((severity: PublicIncidentFormSeverity): boolean => {
        return severity._id === defaultId;
      })
    ) {
      form.defaultIncidentSeverityId = defaultId;
    }
  }

  return form;
};

export type ReadIncidentFormSubmissionResultFunction = (
  data: unknown,
) => PublicIncidentFormSubmissionResult;

/*
 * What the reporter is shown once the incident exists. The submission
 * worked whatever the body holds, so a body this page cannot read still ends
 * on the thank-you screen - just without the incident number.
 */
export const readIncidentFormSubmissionResult: ReadIncidentFormSubmissionResultFunction =
  (data: unknown): PublicIncidentFormSubmissionResult => {
    const result: PublicIncidentFormSubmissionResult = {};

    if (!isPlainObject(data)) {
      return result;
    }

    if (
      typeof data["incidentNumber"] === "string" &&
      data["incidentNumber"].trim()
    ) {
      result.incidentNumber = data["incidentNumber"].trim();
    }

    if (
      typeof data["successMessage"] === "string" &&
      data["successMessage"].trim()
    ) {
      result.successMessage = data["successMessage"];
    }

    return result;
  };

export type LoadPublicIncidentFormFunction = (
  shareKey: string,
) => Promise<PublicIncidentForm>;

/**
 * Read the form behind a share key. A refusal is thrown as the
 * HTTPErrorResponse itself, so getIncidentFormFailure can tell a form that
 * is gone (404) from a network that is not allowed (403) from a limit (429).
 */
export const loadPublicIncidentForm: LoadPublicIncidentFormFunction = async (
  shareKey: string,
): Promise<PublicIncidentForm> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await IncidentFormAPI.get<JSONObject>({
      url: getIncidentFormUrl(shareKey),
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return readPublicIncidentForm(response.data);
};

export type SubmitPublicIncidentFormFunction = (
  shareKey: string,
  request: PublicIncidentFormSubmissionRequest,
) => Promise<PublicIncidentFormSubmissionResult>;

// Declare the incident. Refusals are thrown as for loadPublicIncidentForm.
export const submitPublicIncidentForm: SubmitPublicIncidentFormFunction =
  async (
    shareKey: string,
    request: PublicIncidentFormSubmissionRequest,
  ): Promise<PublicIncidentFormSubmissionResult> => {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await IncidentFormAPI.post<JSONObject>({
        url: getIncidentFormSubmitUrl(shareKey),
        data: request as unknown as JSONObject,
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    return readIncidentFormSubmissionResult(response.data);
  };

export type ToCustomFieldFormDefinitionsFunction = (
  fields: Array<PublicIncidentFormField>,
) => Array<CustomFieldFormDefinition>;

/*
 * The asked custom fields in the shape the shared custom field inputs are
 * built from (buildCustomFieldFormFields). Every one is shown; whether it is
 * required is the FORM's choice, which is what isRequired carries.
 */
export const toCustomFieldFormDefinitions: ToCustomFieldFormDefinitionsFunction =
  (
    fields: Array<PublicIncidentFormField>,
  ): Array<CustomFieldFormDefinition> => {
    return fields.map(
      (field: PublicIncidentFormField): CustomFieldFormDefinition => {
        return {
          name: field.name,
          description: field.description,
          customFieldType: field.customFieldType,
          dropdownOptions: field.dropdownOptions,
          showOnCreate: true,
          isRequiredOnCreate: field.isRequired,
        };
      },
    );
  };

// The text custom field types, whose answers the server caps in length.
export const INCIDENT_FORM_TEXT_CUSTOM_FIELD_TYPES: ReadonlyArray<CustomFieldType> =
  [CustomFieldType.Text, CustomFieldType.LongText, CustomFieldType.Markdown];

// Of those, the ones answered on several lines, which the server cleans as such.
export const INCIDENT_FORM_MULTI_LINE_CUSTOM_FIELD_TYPES: ReadonlyArray<CustomFieldType> =
  [CustomFieldType.LongText, CustomFieldType.Markdown];

/*
 * Postgres cannot store a NUL character, so the server drops them from every
 * answer; control characters in a one-line answer become spaces there. The
 * two patterns are the server's own (IncidentFormPublic), and matching
 * control characters is exactly what they are for.
 */
// eslint-disable-next-line no-control-regex
const NUL_CHARACTERS: RegExp = /\u0000/g;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS: RegExp = /[\u0000-\u001F\u007F]/g;

export type IsBlankIncidentFormAnswerFunction = (
  value: string,
  isMultiLine: boolean,
) => boolean;

/**
 * Whether the server finds nothing in a text answer once it has cleaned it,
 * and so refuses it for a required question: a one-line answer (the title,
 * the reporter's name, a Text field) with its control characters read as
 * spaces, a multi-line one (the description, a Long text or Markdown field)
 * with its NUL characters dropped - then, either way, trimmed.
 *
 * The form's own required check passes an answer of nothing but spaces, so
 * the page asks this too: the refusal then comes from the browser, in the
 * reporter's language, before a captcha answer is spent on it.
 */
export const isBlankIncidentFormAnswer: IsBlankIncidentFormAnswerFunction = (
  value: string,
  isMultiLine: boolean,
): boolean => {
  const kept: string = isMultiLine
    ? value.replace(NUL_CHARACTERS, "")
    : value.replace(CONTROL_CHARACTERS, " ");

  return kept.trim().length === 0;
};

export type IsIncidentFormReporterEmailFunction = (value: string) => boolean;

/**
 * Whether the server takes an answer to Your Email as an address: cleaned
 * as it cleans it (NUL characters dropped, the ends trimmed), the whole
 * answer must be one ordinary address - its own WHOLE_EMAIL_ADDRESS, and
 * Email's check too, as validateIncidentFormSubmission applies them.
 *
 * The form's own email check finds an address anywhere in the text, so
 * "Ada Lovelace <ada@example.com>" (as Outlook copies it), "ada@example.com."
 * and "a@example.com, b@example.com" pass it - and the server then refuses
 * them, in English, after the captcha answer was spent. The length cap is
 * the form's maxLength check's; an empty answer is the required check's.
 */
export const isIncidentFormReporterEmail: IsIncidentFormReporterEmailFunction =
  (value: string): boolean => {
    const address: string = value.replace(NUL_CHARACTERS, "").trim();

    return WHOLE_EMAIL_ADDRESS.test(address) && Email.isValid(address);
  };

type ReadTextFunction = (value: unknown) => string;

const readText: ReadTextFunction = (value: unknown): string => {
  return typeof value === "string" ? value : "";
};

type ReadDropdownValueFunction = (value: unknown) => string;

// A dropdown can hold the option it was picked as ({label, value}) or its value.
const readDropdownValue: ReadDropdownValueFunction = (
  value: unknown,
): string => {
  const picked: unknown = isPlainObject(value) ? value["value"] : value;

  return typeof picked === "string" ? picked.trim() : "";
};

export type BuildIncidentFormSubmissionRequestFunction = (data: {
  form: PublicIncidentForm;
  // Everything the page's form submitted, keyed as the page keyed its fields.
  values: JSONObject;
  captchaToken?: string | undefined;
}) => PublicIncidentFormSubmissionRequest;

/**
 * The body of the submit request, built only from the questions the form
 * asks: the description only when it is asked, a severity only when the form
 * offers a choice, and each custom field answer under the field's name (read
 * from the key the page held it under, never from its bare name - see
 * getCustomFieldFormKey). Answers left empty are left out, so the form's -
 * or its template's - own values apply. The title and the reporter's details
 * are trimmed; the server cleans every answer again, and has the last word.
 */
export const buildIncidentFormSubmissionRequest: BuildIncidentFormSubmissionRequestFunction =
  (data: {
    form: PublicIncidentForm;
    values: JSONObject;
    captchaToken?: string | undefined;
  }): PublicIncidentFormSubmissionRequest => {
    const values: JSONObject = data.values || {};

    const submission: PublicIncidentFormSubmissionData = {
      title: readText(values["title"]).trim(),
    };

    if (data.form.descriptionSetting !== IncidentFormFieldSetting.Hidden) {
      const description: string = readText(values["description"]);

      if (description.trim()) {
        submission.description = description;
      }
    }

    if (data.form.severities && data.form.severities.length > 0) {
      const severityId: string = readDropdownValue(
        values["incidentSeverityId"],
      );

      if (severityId) {
        submission.incidentSeverityId = severityId;
      }
    }

    const reporterName: string = readText(values["reporterName"]).trim();

    if (reporterName) {
      submission.reporterName = reporterName;
    }

    const reporterEmail: string = readText(values["reporterEmail"]).trim();

    if (reporterEmail) {
      submission.reporterEmail = reporterEmail;
    }

    const customFields: JSONObject | undefined = packCustomFieldFormValues({
      definitions: toCustomFieldFormDefinitions(data.form.customFields),
      formValues: values,
    });

    if (customFields) {
      submission.customFields = customFields;
    }

    const request: PublicIncidentFormSubmissionRequest = {
      data: submission,
    };

    const captchaToken: string = (data.captchaToken || "").trim();

    if (captchaToken) {
      request.captchaToken = captchaToken;
    }

    return request;
  };

export enum IncidentFormFailureKind {
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

export interface IncidentFormFailure {
  kind: IncidentFormFailureKind;
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
 * error page would be shown to the reporter as if it were a sentence.
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

export type GetIncidentFormFailureFunction = (
  error: unknown,
) => IncidentFormFailure;

/**
 * What went wrong with a request, by the status the server answered with.
 * The status decides, never the words: a 404 is "not available" whatever
 * body came with it.
 */
export const getIncidentFormFailure: GetIncidentFormFailureFunction = (
  error: unknown,
): IncidentFormFailure => {
  if (!(error instanceof HTTPErrorResponse)) {
    return { kind: IncidentFormFailureKind.Unavailable, retryAfterSeconds: 0 };
  }

  const serverMessage: string | undefined = readServerMessage(error);

  switch (error.statusCode) {
    case 404:
      return {
        kind: IncidentFormFailureKind.NotAvailable,
        serverMessage: serverMessage,
        retryAfterSeconds: 0,
      };

    case 403:
      return {
        kind: IncidentFormFailureKind.NetworkNotAllowed,
        serverMessage: serverMessage,
        retryAfterSeconds: 0,
      };

    case 429:
      return {
        kind: IncidentFormFailureKind.RateLimited,
        serverMessage: serverMessage,
        retryAfterSeconds: getRetryAfterSecondsFromError(error),
      };

    case 400:
      return {
        // A 400 that does not say why is no more use to the reporter than a 500.
        kind: serverMessage
          ? IncidentFormFailureKind.Refused
          : IncidentFormFailureKind.Unavailable,
        serverMessage: serverMessage,
        retryAfterSeconds: 0,
      };

    default:
      return {
        kind: IncidentFormFailureKind.Unavailable,
        serverMessage: serverMessage,
        retryAfterSeconds: 0,
      };
  }
};

// Which request failed: reading the form, or sending the answers.
export enum IncidentFormStage {
  Load = "Load",
  Submit = "Submit",
}

export type GetIncidentFormFailureMessageFunction = (data: {
  failure: IncidentFormFailure;
  stage: IncidentFormStage;
}) => string;

/**
 * The sentence to show for a failure, in English: one of IncidentFormMessage
 * (translate it with isKnownIncidentFormMessage), or - for a 400 - the
 * server's own words as they came.
 *
 * A 404 and a 403 always get the page's sentence, whatever the body said.
 * A limit or an outage repeats the server's sentence when it is one the page
 * knows - the limiters word their refusals by what was limited (this
 * network, or the whole form), and a 503 on submit says reports are paused -
 * and otherwise gets the page's own: a proxy's "Bad Gateway" or the server's
 * bare "Server Error" tells a reporter nothing.
 */
export const getIncidentFormFailureMessage: GetIncidentFormFailureMessageFunction =
  (data: {
    failure: IncidentFormFailure;
    stage: IncidentFormStage;
  }): string => {
    switch (data.failure.kind) {
      case IncidentFormFailureKind.NotAvailable:
        return IncidentFormMessage.NotAvailable;

      case IncidentFormFailureKind.NetworkNotAllowed:
        return IncidentFormMessage.NetworkNotAllowed;

      case IncidentFormFailureKind.RateLimited:
        if (isKnownServerMessage(data.failure.serverMessage)) {
          return data.failure.serverMessage;
        }

        return data.stage === IncidentFormStage.Submit
          ? IncidentFormMessage.TooManySubmissions
          : IncidentFormMessage.TooManyRequests;

      case IncidentFormFailureKind.Refused:
        return (
          data.failure.serverMessage ||
          (data.stage === IncidentFormStage.Submit
            ? IncidentFormMessage.SubmitFailed
            : IncidentFormMessage.LoadFailed)
        );

      default:
        if (isKnownServerMessage(data.failure.serverMessage)) {
          return data.failure.serverMessage;
        }

        return data.stage === IncidentFormStage.Submit
          ? IncidentFormMessage.SubmitFailed
          : IncidentFormMessage.LoadFailed;
    }
  };

export type FormatIncidentFormRetryAfterFunction = (
  seconds: number,
  locale?: string | undefined,
) => string | null;

/**
 * "in 5 minutes", in the page's language, for the sentence that says when
 * the reporter can try again - or null when the server named no wait (or
 * the browser cannot word one). Rounded UP to the unit shown: coming back a
 * little late costs nothing, coming back early is refused again.
 */
export const formatIncidentFormRetryAfter: FormatIncidentFormRetryAfterFunction =
  (seconds: number, locale?: string | undefined): string | null => {
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
