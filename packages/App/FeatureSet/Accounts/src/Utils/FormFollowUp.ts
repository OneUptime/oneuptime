import { getFormOnCustomDomainUrl, getFormUrl } from "./Form";
import FormAPI from "./FormAPI";
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
import {
  FORM_FOLLOW_UP_ADD_PERSON_ROUTE,
  FORM_FOLLOW_UP_PARAMETER,
  FORM_FOLLOW_UP_REPLY_ROUTE,
  FORM_FOLLOW_UP_ROUTE,
  FORM_FOLLOW_UP_STOP_ROUTE,
  FORM_MY_REQUESTS_PARAMETER,
  FORM_MY_REQUESTS_ROUTE,
  FORM_REQUEST_PARAMETER,
  FormFollowUpAuthor,
  PublicFormMyRequests,
  PublicFormRequest,
  PublicFormRequestAccess,
  PublicFormRequestAnswer,
  PublicFormRequestFile,
  PublicFormRequestMessage,
  PublicFormRequestPerson,
  PublicFormRequestState,
  PublicFormRequestSummary,
  readFormFollowUpCredential,
} from "Common/Types/Form/FormFollowUp";
import { PublicFormSubmissionFollowUp } from "Common/Types/Form/FormPublic";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

/*
 * A FORM'S FOLLOW-UPS ON ITS OWN PAGE (Common/Types/Form/FormFollowUp):
 * which view the page was opened for, the requests it makes, and reading
 * what the server answers - which, as for the form itself, is not trusted
 * to be whole: a request the page cannot read is a request that could not
 * be loaded, never one drawn half-way.
 */

// Which follow-up view the form's page shows, instead of the form.
export type FormFollowUpView =
  // One request: by a link's credential, or (signed in) by its submission.
  | { kind: "request"; access: PublicFormRequestAccess }
  // My requests, on a form that asks its visitors to sign in.
  | { kind: "mine" };

/*
 * Where the page keeps the view it was opened for, by form: a reload keeps
 * it, and so does a single sign-on round trip, which comes back to the
 * form's own address with nothing else in it. Per tab (sessionStorage), and
 * gone once the visitor goes back to the form.
 */
const STORAGE_KEY_PREFIX: string = "oneuptime-form-follow-up:";

const getStorageKey: (formKey: string) => string = (
  formKey: string,
): string => {
  return `${STORAGE_KEY_PREFIX}${formKey}`;
};

type ReadViewFunction = (value: unknown) => FormFollowUpView | null;

const readView: ReadViewFunction = (
  value: unknown,
): FormFollowUpView | null => {
  if (!isPlainObject(value)) {
    return null;
  }

  if (value["kind"] === "mine") {
    return { kind: "mine" };
  }

  if (value["kind"] !== "request" || !isPlainObject(value["access"])) {
    return null;
  }

  const access: Record<string, unknown> = value["access"];
  const credential: unknown = access["credential"];
  const submissionId: unknown = access["submissionId"];

  if (typeof credential === "string" && readFormFollowUpCredential(credential)) {
    return { kind: "request", access: { credential: credential } };
  }

  if (
    typeof submissionId === "string" &&
    ObjectID.isValidUUID(submissionId)
  ) {
    return { kind: "request", access: { submissionId: submissionId } };
  }

  return null;
};

export type TakeFormFollowUpViewFunction = (formKey: string) => FormFollowUpView | null;

/**
 * The follow-up view the page was opened for, if any: its address's
 * follow-up parameter - taken out of the address with replaceState, so
 * neither Back, a bookmark nor a tag on the page keeps a link's credential
 * - else the view this tab kept for the form.
 */
export const takeFormFollowUpView: TakeFormFollowUpViewFunction = (
  formKey: string,
): FormFollowUpView | null => {
  let view: FormFollowUpView | null = null;

  try {
    const address: globalThis.URL = new globalThis.URL(window.location.href);
    const credential: string | null = address.searchParams.get(
      FORM_FOLLOW_UP_PARAMETER,
    );
    const submissionId: string | null = address.searchParams.get(
      FORM_REQUEST_PARAMETER,
    );
    const mine: string | null = address.searchParams.get(
      FORM_MY_REQUESTS_PARAMETER,
    );

    if (credential !== null || submissionId !== null || mine !== null) {
      address.searchParams.delete(FORM_FOLLOW_UP_PARAMETER);
      address.searchParams.delete(FORM_REQUEST_PARAMETER);
      address.searchParams.delete(FORM_MY_REQUESTS_PARAMETER);
      window.history.replaceState(
        window.history.state,
        "",
        `${address.pathname}${address.search}${address.hash}`,
      );

      /*
       * By which parameter is there, not by what it holds: an empty or
       * broken credential opens nothing, never My requests.
       */
      if (credential !== null) {
        view = readView({ kind: "request", access: { credential } });
      } else if (submissionId !== null) {
        view = readView({ kind: "request", access: { submissionId } });
      } else {
        view = { kind: "mine" };
      }
    }
  } catch {
    view = null;
  }

  if (view) {
    keepFormFollowUpView(formKey, view);
    return view;
  }

  try {
    const kept: string | null = window.sessionStorage.getItem(
      getStorageKey(formKey),
    );

    return kept ? readView(JSON.parse(kept)) : null;
  } catch {
    return null;
  }
};

export type KeepFormFollowUpViewFunction = (
  formKey: string,
  view: FormFollowUpView | null,
) => void;

// Keep the view the page shows for this form - or forget it, for null.
export const keepFormFollowUpView: KeepFormFollowUpViewFunction = (
  formKey: string,
  view: FormFollowUpView | null,
): void => {
  try {
    if (view) {
      window.sessionStorage.setItem(
        getStorageKey(formKey),
        JSON.stringify(view),
      );
    } else {
      window.sessionStorage.removeItem(getStorageKey(formKey));
    }
  } catch {
    // Storage off: the view lasts as long as the page does.
  }
};

// Where the page's follow-up requests go: the form's link, or its domain.
export interface FormFollowUpTarget {
  // The form's share key; null on the form's own domain.
  shareKey: string | null;
}

const getBaseUrl: (target: FormFollowUpTarget) => URL = (
  target: FormFollowUpTarget,
): URL => {
  return target.shareKey
    ? getFormUrl(target.shareKey)
    : getFormOnCustomDomainUrl();
};

export const getFormFollowUpUrl: (
  target: FormFollowUpTarget,
  route: string,
) => URL = (target: FormFollowUpTarget, route: string): URL => {
  return URL.fromURL(getBaseUrl(target)).addRoute(route);
};

const post: (url: URL, body: JSONObject) => Promise<unknown> = async (
  url: URL,
  body: JSONObject,
): Promise<unknown> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await FormAPI.post<JSONObject>({
      url: url,
      data: body,
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return response.data;
};

// One request. Refusals are thrown as the HTTPErrorResponse itself.
export const loadFormRequest: (
  target: FormFollowUpTarget,
  access: PublicFormRequestAccess,
) => Promise<PublicFormRequest> = async (
  target: FormFollowUpTarget,
  access: PublicFormRequestAccess,
): Promise<PublicFormRequest> => {
  return readPublicFormRequest(
    await post(getFormFollowUpUrl(target, FORM_FOLLOW_UP_ROUTE), {
      access: access as JSONObject,
    }),
  );
};

/*
 * A message: the reply box's answers, packed as a form's own answers are
 * (packPublicFormAnswers), files and all.
 */
export const sendFormRequestReply: (data: {
  target: FormFollowUpTarget;
  access: PublicFormRequestAccess;
  answers: JSONObject;
}) => Promise<PublicFormRequest> = async (data: {
  target: FormFollowUpTarget;
  access: PublicFormRequestAccess;
  answers: JSONObject;
}): Promise<PublicFormRequest> => {
  return readPublicFormRequest(
    await post(getFormFollowUpUrl(data.target, FORM_FOLLOW_UP_REPLY_ROUTE), {
      access: data.access as JSONObject,
      answers: data.answers,
    }),
  );
};

export const addPersonToFormRequest: (data: {
  target: FormFollowUpTarget;
  access: PublicFormRequestAccess;
  email: string;
  name?: string | undefined;
}) => Promise<PublicFormRequest> = async (data: {
  target: FormFollowUpTarget;
  access: PublicFormRequestAccess;
  email: string;
  name?: string | undefined;
}): Promise<PublicFormRequest> => {
  const body: JSONObject = {
    access: data.access as JSONObject,
    email: data.email,
  };

  if (data.name) {
    body["name"] = data.name;
  }

  return readPublicFormRequest(
    await post(
      getFormFollowUpUrl(data.target, FORM_FOLLOW_UP_ADD_PERSON_ROUTE),
      body,
    ),
  );
};

export const stopFollowingFormRequest: (data: {
  target: FormFollowUpTarget;
  access: PublicFormRequestAccess;
}) => Promise<void> = async (data: {
  target: FormFollowUpTarget;
  access: PublicFormRequestAccess;
}): Promise<void> => {
  await post(getFormFollowUpUrl(data.target, FORM_FOLLOW_UP_STOP_ROUTE), {
    access: data.access as JSONObject,
  });
};

export const loadMyFormRequests: (
  target: FormFollowUpTarget,
) => Promise<PublicFormMyRequests> = async (
  target: FormFollowUpTarget,
): Promise<PublicFormMyRequests> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await FormAPI.get<JSONObject>({
      url: getFormFollowUpUrl(target, FORM_MY_REQUESTS_ROUTE),
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return readPublicFormMyRequests(response.data);
};

// ---------------------------------------------------------------------------
// Reading what the server says.
// ---------------------------------------------------------------------------

type IsPlainObjectFunction = (
  value: unknown,
) => value is Record<string, unknown>;

const isPlainObject: IsPlainObjectFunction = (
  value: unknown,
): value is Record<string, unknown> => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

const readText: (value: unknown) => string = (value: unknown): string => {
  return typeof value === "string" ? value : "";
};

const readDate: (value: unknown) => string = (value: unknown): string => {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? value
    : "";
};

const readState: (value: unknown) => PublicFormRequestState | null = (
  value: unknown,
): PublicFormRequestState | null => {
  if (!isPlainObject(value) || !readText(value["name"]).trim()) {
    return null;
  }

  const state: PublicFormRequestState = {
    name: readText(value["name"]).trim(),
    isClosed: value["isClosed"] === true,
  };

  const color: string = readText(value["color"]);

  if (/^#[0-9a-f]{6}$/i.test(color)) {
    state.color = color;
  }

  return state;
};

const readPerson: (value: unknown) => PublicFormRequestPerson | null = (
  value: unknown,
): PublicFormRequestPerson | null => {
  if (
    !isPlainObject(value) ||
    !readText(value["id"]) ||
    !readText(value["email"])
  ) {
    return null;
  }

  const person: PublicFormRequestPerson = {
    id: readText(value["id"]),
    email: readText(value["email"]),
    isSubmitter: value["isSubmitter"] === true,
    isYou: value["isYou"] === true,
  };

  const name: string = readText(value["name"]).trim();

  if (name) {
    person.name = name;
  }

  return person;
};

const readMessage: (value: unknown) => PublicFormRequestMessage | null = (
  value: unknown,
): PublicFormRequestMessage | null => {
  if (
    !isPlainObject(value) ||
    !readText(value["id"]) ||
    !readDate(value["createdAt"])
  ) {
    return null;
  }

  const files: Array<PublicFormRequestFile> = Array.isArray(value["files"])
    ? (value["files"] as Array<unknown>)
        .filter((file: unknown): file is Record<string, unknown> => {
          return isPlainObject(file) && Boolean(readText(file["name"]));
        })
        .map((file: Record<string, unknown>): PublicFormRequestFile => {
          return {
            name: readText(file["name"]),
            size: typeof file["size"] === "number" ? file["size"] : 0,
          };
        })
    : [];

  return {
    id: readText(value["id"]),
    createdAt: readDate(value["createdAt"]),
    author:
      value["author"] === FormFollowUpAuthor.Team
        ? FormFollowUpAuthor.Team
        : FormFollowUpAuthor.Requester,
    authorName: readText(value["authorName"]).trim(),
    isYou: value["isYou"] === true,
    text: readText(value["text"]),
    files: files,
  };
};

const readBranding: (data: Record<string, unknown>) => {
  logo?: PublicFormImage | undefined;
  logoAltText?: string | undefined;
  favicon?: PublicFormImage | undefined;
} = (
  data: Record<string, unknown>,
): {
  logo?: PublicFormImage | undefined;
  logoAltText?: string | undefined;
  favicon?: PublicFormImage | undefined;
} => {
  const branding: {
    logo?: PublicFormImage | undefined;
    logoAltText?: string | undefined;
    favicon?: PublicFormImage | undefined;
  } = {};

  const logo: PublicFormImage | undefined = readPublicFormImage(
    data["logo"],
    FORM_LOGO_IMAGE,
  );

  if (logo) {
    branding.logo = logo;

    const logoAltText: string | undefined = readFormLogoAltText(
      data["logoAltText"],
    );

    if (logoAltText) {
      branding.logoAltText = logoAltText;
    }
  }

  const favicon: PublicFormImage | undefined = readPublicFormImage(
    data["favicon"],
    FORM_FAVICON_IMAGE,
  );

  if (favicon) {
    branding.favicon = favicon;
  }

  return branding;
};

export type ReadPublicFormRequestFunction = (data: unknown) => PublicFormRequest;

// One request as the server described it, or an error for one it did not.
export const readPublicFormRequest: ReadPublicFormRequestFunction = (
  data: unknown,
): PublicFormRequest => {
  if (
    !isPlainObject(data) ||
    !readText(data["submissionId"]) ||
    !readDate(data["submittedAt"])
  ) {
    throw new Error("The request could not be read.");
  }

  const you: PublicFormRequestPerson | null = readPerson(data["you"]);

  if (!you) {
    throw new Error("The request could not be read.");
  }

  const request: PublicFormRequest = {
    submissionId: readText(data["submissionId"]),
    formName: readText(data["formName"]),
    ...readBranding(data),
    title: readText(data["title"]),
    submittedAt: readDate(data["submittedAt"]),
    state: readState(data["state"]),
    answers: Array.isArray(data["answers"])
      ? (data["answers"] as Array<unknown>)
          .filter((answer: unknown): answer is Record<string, unknown> => {
            return isPlainObject(answer) && Boolean(readText(answer["label"]));
          })
          .map((answer: Record<string, unknown>): PublicFormRequestAnswer => {
            return {
              label: readText(answer["label"]),
              value: readText(answer["value"]),
            };
          })
      : [],
    messages: Array.isArray(data["messages"])
      ? (data["messages"] as Array<unknown>)
          .map(readMessage)
          .filter(
            (
              message: PublicFormRequestMessage | null,
            ): message is PublicFormRequestMessage => {
              return message !== null;
            },
          )
      : [],
    people: Array.isArray(data["people"])
      ? (data["people"] as Array<unknown>)
          .map(readPerson)
          .filter(
            (
              person: PublicFormRequestPerson | null,
            ): person is PublicFormRequestPerson => {
              return person !== null;
            },
          )
      : [],
    you: you,
    canAddPeople: data["canAddPeople"] === true,
  };

  const reference: string = readText(data["reference"]).trim();

  if (reference) {
    request.reference = reference;
  }

  const signedInAs: string = readText(data["signedInAs"]).trim();

  if (signedInAs) {
    request.signedInAs = signedInAs;
  }

  return request;
};

export type ReadPublicFormMyRequestsFunction = (
  data: unknown,
) => PublicFormMyRequests;

// My requests as the server described them, or an error.
export const readPublicFormMyRequests: ReadPublicFormMyRequestsFunction = (
  data: unknown,
): PublicFormMyRequests => {
  if (
    !isPlainObject(data) ||
    !readText(data["signedInAs"]) ||
    !Array.isArray(data["requests"])
  ) {
    throw new Error("Your requests could not be read.");
  }

  const requests: Array<PublicFormRequestSummary> = [];

  for (const entry of data["requests"] as Array<unknown>) {
    if (
      !isPlainObject(entry) ||
      !ObjectID.isValidUUID(readText(entry["submissionId"])) ||
      !readDate(entry["submittedAt"])
    ) {
      continue;
    }

    const summary: PublicFormRequestSummary = {
      submissionId: readText(entry["submissionId"]),
      title: readText(entry["title"]),
      submittedAt: readDate(entry["submittedAt"]),
      lastActivityAt:
        readDate(entry["lastActivityAt"]) || readDate(entry["submittedAt"]),
      state: readState(entry["state"]),
    };

    const reference: string = readText(entry["reference"]).trim();

    if (reference) {
      summary.reference = reference;
    }

    requests.push(summary);
  }

  return {
    formName: readText(data["formName"]),
    ...readBranding(data),
    signedInAs: readText(data["signedInAs"]),
    requests: requests,
  };
};

export type GetSubmissionFollowUpViewFunction = (
  followUp: PublicFormSubmissionFollowUp,
) => FormFollowUpView;

// The view a thank-you screen's Open Your Request opens.
export const getSubmissionFollowUpView: GetSubmissionFollowUpViewFunction = (
  followUp: PublicFormSubmissionFollowUp,
): FormFollowUpView => {
  return followUp.credential
    ? { kind: "request", access: { credential: followUp.credential } }
    : { kind: "request", access: { submissionId: followUp.submissionId } };
};
