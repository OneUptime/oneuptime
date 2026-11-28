import { CUSTOM_FIELD_FILE_TYPES } from "../CustomField/CustomFieldFile";
import { PublicFormImage } from "./FormBranding";
import {
  FORM_SUBMITTER_EMAIL_MAX_LENGTH,
  FORM_SUBMITTER_NAME_MAX_LENGTH,
  FORM_TEXT_ANSWER_MAX_LENGTH,
} from "./FormField";
import {
  FORM_FILE_MAX_SIZE_IN_BYTES,
  FORM_FILE_QUESTION_MAX_FILES,
} from "./FormFileAnswer";
import FormTargetType from "./FormTargetType";
import { StateListType } from "../../Utils/StateListType";
import {
  cleanSingleLineAnswer,
  isWholeEmailAddress,
  PublicFormField,
  PublicFormFieldType,
  PublicFormSubmissionFollowUp,
} from "./FormPublic";

// Where the thank-you screen opens a submission's request (FormPublic).
export type { PublicFormSubmissionFollowUp };

/*
 * FOLLOWING UP ON A SUBMISSION.
 *
 * A form with follow-ups on (Form.enableFollowUps) lets the people who send
 * it follow what they sent: the person who submitted, and anybody they or
 * the team add, each by email (FormSubmissionFollower). They read the
 * request's state and its conversation with the team on the form's own
 * page, write to the team there - text and files - and add others.
 * Everything they write lands on the record the submission created as a
 * private note, so the team reads it where it reads everything else, under
 * that record's own access rules; and a responder answers from the record's
 * page, which emails everybody following.
 *
 * HOW THE PAGE IS OPENED
 *
 * On the form's own page - its link, or the root of its custom domain,
 * which answers its root alone (App/FeatureSet/Frontend/FormDomainPage) -
 * with an address parameter, which the page takes out of the address before
 * it shows anything, as it takes a private user's reset token:
 *
 *   ?followUp=<followerId>-<token>   on a form anybody can open: the link
 *                                    each person following is emailed. The
 *                                    id finds the person, the token proves
 *                                    the link is theirs.
 *   ?request=<submissionId>          on a form that asks its visitors to
 *                                    sign in: the request, for a signed-in
 *                                    visitor whose address is following it.
 *   ?myRequests=1                    on a form that asks its visitors to
 *                                    sign in: every request the signed-in
 *                                    visitor is following.
 *
 * A form that asks its visitors to sign in never shows a request to a
 * visitor who is not signed in - a link's token is not enough there - and
 * shows it only to the people following it, by the address they signed in
 * with.
 *
 * Kept free of anything server-side, so the server, the form's page, the
 * dashboard and the suites read the same routes, limits and words.
 */

// The address parameters the form's page is opened with (see above).
export const FORM_FOLLOW_UP_PARAMETER: string = "followUp";
export const FORM_REQUEST_PARAMETER: string = "request";
export const FORM_MY_REQUESTS_PARAMETER: string = "myRequests";

/*
 * The public routes, after the form's public route (/public/<share key>) or
 * its custom-domain route (/custom-domain), under the form's API (/api/form).
 * Each POST takes a JSON body, which names the request it is about
 * (PublicFormRequestAccess): a credential never travels in an address.
 */
export const FORM_FOLLOW_UP_ROUTE: string = "/follow-up";
export const FORM_FOLLOW_UP_REPLY_ROUTE: string = "/follow-up/reply";
export const FORM_FOLLOW_UP_ADD_PERSON_ROUTE: string = "/follow-up/people";
export const FORM_FOLLOW_UP_STOP_ROUTE: string = "/follow-up/stop";
export const FORM_MY_REQUESTS_ROUTE: string = "/follow-up/mine";

/*
 * The dashboard's routes, for a signed-in member of the project, on the
 * record a submission created:
 *
 *   GET  /form-follow-up/<record type>/<record id>
 *   POST /form-follow-up/<record type>/<record id>/reply
 *   POST /form-follow-up/<record type>/<record id>/people
 *   POST /form-follow-up/<record type>/<record id>/people/<follower id>/remove
 *
 * The record type is a FormTargetType: Incident, Alert or
 * ScheduledMaintenance.
 */
export const FORM_FOLLOW_UP_RECORD_ROUTE: string = "/form-follow-up";
export const FORM_FOLLOW_UP_RECORD_REPLY_PATH: string = "reply";
export const FORM_FOLLOW_UP_RECORD_PEOPLE_PATH: string = "people";
export const FORM_FOLLOW_UP_RECORD_REMOVE_PATH: string = "remove";

// The longest message: what a form's text answer takes.
export const FORM_FOLLOW_UP_MESSAGE_MAX_LENGTH: number =
  FORM_TEXT_ANSWER_MAX_LENGTH;

// The most people one request has following it, the submitter included.
export const FORM_FOLLOW_UP_MAX_PEOPLE: number = 20;

// A name and an address, as long as a submitter's are allowed to be.
export const FORM_FOLLOW_UP_NAME_MAX_LENGTH: number =
  FORM_SUBMITTER_NAME_MAX_LENGTH;
export const FORM_FOLLOW_UP_EMAIL_MAX_LENGTH: number =
  FORM_SUBMITTER_EMAIL_MAX_LENGTH;

// The secret half of a link: 32 random bytes as 64 lowercase hex characters.
export const FORM_FOLLOW_UP_TOKEN_LENGTH: number = 64;

// Who wrote a message: somebody following the request, or the team.
export enum FormFollowUpAuthor {
  Requester = "Requester",
  Team = "Team",
}

/*
 * The answer every request a visitor may not open gets: a wrong token, a
 * person no longer following, a request deleted, a form whose follow-ups
 * are off. One answer for all of them, so the routes cannot be used to find
 * out which requests exist.
 */
export const FORM_FOLLOW_UP_NOT_AVAILABLE_MESSAGE: string =
  "This request is not available. The link may be out of date, or you may no longer be following it.";

export const FORM_FOLLOW_UP_BODY_MESSAGE: string =
  "The request must be a JSON object that says which request it is about.";

export const FORM_FOLLOW_UP_EMAIL_MESSAGE: string =
  "Enter one email address, such as jane@example.com.";

export const FORM_FOLLOW_UP_NAME_TOO_LONG_MESSAGE: string = `A name cannot be more than ${FORM_FOLLOW_UP_NAME_MAX_LENGTH} characters.`;

export const FORM_FOLLOW_UP_TOO_MANY_PEOPLE_MESSAGE: string = `A request can have at most ${FORM_FOLLOW_UP_MAX_PEOPLE} people following it.`;

export const FORM_FOLLOW_UP_ALREADY_FOLLOWING_MESSAGE: string =
  "That person is already following this request.";

export const FORM_FOLLOW_UP_MESSAGE_REQUIRED_MESSAGE: string =
  "Write a message, or attach a file.";

export const FORM_FOLLOW_UP_MESSAGE_TOO_LONG_MESSAGE: string = `A message cannot be more than ${FORM_FOLLOW_UP_MESSAGE_MAX_LENGTH} characters.`;

// A message to a request whose record was deleted: nobody would read it.
export const FORM_FOLLOW_UP_RECORD_GONE_MESSAGE: string =
  "This request was closed, so it cannot take new messages.";

// A change to a request on a form whose follow-ups are off, from the dashboard.
export const FORM_FOLLOW_UP_OFF_MESSAGE: string =
  "Follow-ups are off for this form. Turn them on in the form's On Submit page to reply to the people following this request.";

// The dashboard's answer for a record no form submission created.
export const FORM_FOLLOW_UP_NO_SUBMISSION_MESSAGE: string =
  "This record was not created through a form, so there is nobody to follow up with.";

/*
 * The questions of the reply box, as the form's own questions are drawn and
 * checked: the page draws them with the public form's builder
 * (buildPublicFormFields), and the server checks a reply with the one
 * answer check every submission's answers meet (validateFormAnswer) - so a
 * file is held to exactly what a form's file question takes.
 */
export const FORM_FOLLOW_UP_MESSAGE_FIELD_ID: string = "message";
export const FORM_FOLLOW_UP_FILES_FIELD_ID: string = "files";

export type GetFormFollowUpReplyFieldsFunction = () => Array<PublicFormField>;

export const getFormFollowUpReplyFields: GetFormFollowUpReplyFieldsFunction =
  (): Array<PublicFormField> => {
    return [
      {
        id: FORM_FOLLOW_UP_MESSAGE_FIELD_ID,
        label: "Message",
        type: PublicFormFieldType.Markdown,
        isRequired: false,
        maxLength: FORM_FOLLOW_UP_MESSAGE_MAX_LENGTH,
      },
      {
        id: FORM_FOLLOW_UP_FILES_FIELD_ID,
        label: "Files",
        type: PublicFormFieldType.MultipleFiles,
        isRequired: false,
        fileTypes: [...CUSTOM_FIELD_FILE_TYPES],
        maxFileSizeInBytes: FORM_FILE_MAX_SIZE_IN_BYTES,
        maxFiles: FORM_FILE_QUESTION_MAX_FILES,
      },
    ];
  };

/*
 * The credential a follow-up link carries: the person's id and their
 * token, as one value, joined by a hyphen. An id is a UUID - hyphens of its
 * own - and the token is hex, so the token is everything after the last.
 */
export interface FormFollowUpCredential {
  followerId: string;
  token: string;
}

export type FormatFormFollowUpCredentialFunction = (
  credential: FormFollowUpCredential,
) => string;

export const formatFormFollowUpCredential: FormatFormFollowUpCredentialFunction =
  (credential: FormFollowUpCredential): string => {
    return `${credential.followerId.toLowerCase()}-${credential.token.toLowerCase()}`;
  };

const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const TOKEN_PATTERN: RegExp = /^[0-9a-f]{64}$/;

export type IsWellFormedFormFollowUpTokenFunction = (
  value: unknown,
) => value is string;

export const isWellFormedFormFollowUpToken: IsWellFormedFormFollowUpTokenFunction =
  (value: unknown): value is string => {
    return typeof value === "string" && TOKEN_PATTERN.test(value);
  };

export type ReadFormFollowUpCredentialFunction = (
  value: unknown,
) => FormFollowUpCredential | null;

/*
 * The credential in a link's value, or null for anything that is not one:
 * a value of the wrong type or length, an id that is not a UUID, a token
 * that is not 64 hex characters. Read in lower case, as it is written.
 */
export const readFormFollowUpCredential: ReadFormFollowUpCredentialFunction = (
  value: unknown,
): FormFollowUpCredential | null => {
  if (typeof value !== "string") {
    return null;
  }

  const text: string = value.trim().toLowerCase();

  // 36 for the id, one hyphen, 64 for the token: nothing longer is read.
  if (text.length !== 36 + 1 + FORM_FOLLOW_UP_TOKEN_LENGTH) {
    return null;
  }

  const separator: number = text.lastIndexOf("-");
  const followerId: string = text.slice(0, separator);
  const token: string = text.slice(separator + 1);

  if (!UUID_PATTERN.test(followerId) || !isWellFormedFormFollowUpToken(token)) {
    return null;
  }

  return { followerId: followerId, token: token };
};

/*
 * Which request a public route is about: a link's credential, on a form
 * anybody can open, or a submission's id, on a form that asks its visitors
 * to sign in.
 */
export interface PublicFormRequestAccess {
  credential?: string | undefined;
  submissionId?: string | undefined;
}

/*
 * The lists a request's record's state is one of: an incident's, an alert's
 * or a maintenance event's states, each by its table (StateListType).
 */
export type FormFollowUpStateList =
  | StateListType.IncidentState
  | StateListType.AlertState
  | StateListType.ScheduledMaintenanceState;

export const FORM_FOLLOW_UP_STATE_LISTS: ReadonlyArray<FormFollowUpStateList> =
  [
    StateListType.IncidentState,
    StateListType.AlertState,
    StateListType.ScheduledMaintenanceState,
  ];

// The list a record of each kind a form creates takes its states from.
export const FORM_FOLLOW_UP_STATE_LIST_OF_TARGET: Record<
  FormTargetType,
  FormFollowUpStateList
> = {
  [FormTargetType.Incident]: StateListType.IncidentState,
  [FormTargetType.Alert]: StateListType.AlertState,
  [FormTargetType.ScheduledMaintenance]:
    StateListType.ScheduledMaintenanceState,
};

// The state of the record a request created, as the person following reads it.
export interface PublicFormRequestState {
  /*
   * The state's own name in the project: "Investigating", "Resolved". One
   * of OneUptime's own names reads in the reader's language, any other as
   * written - decided by its list (Common/Utils/DefaultRecordNames).
   */
  name: string;
  // The list the state is one of, which decides how its name reads.
  list?: FormFollowUpStateList | undefined;
  // Its color, as #rrggbb, when it has one.
  color?: string | undefined;
  // The record is resolved, completed or deleted: nothing more is under way.
  isClosed: boolean;
}

export interface PublicFormRequestFile {
  name: string;
  size: number;
}

// One message of the conversation, as the person following reads it.
export interface PublicFormRequestMessage {
  id: string;
  // When it was written, as an ISO 8601 date.
  createdAt: string;
  author: FormFollowUpAuthor;
  /*
   * The name the person following wrote under, or for the team the
   * responder's own name - empty when they have none, and the page says
   * "The team".
   */
  authorName: string;
  // The reader wrote it.
  isYou: boolean;
  // The message, as Markdown. Empty for a message that is files alone.
  text: string;
  // The files it carried. Kept with the record, so they are named here only.
  files: Array<PublicFormRequestFile>;
}

// Somebody following a request, as another person following it reads them.
export interface PublicFormRequestPerson {
  id: string;
  name?: string | undefined;
  email: string;
  // They sent the form.
  isSubmitter: boolean;
  // The reader.
  isYou: boolean;
}

// One answer the form was sent with, as the person who sent it reads it.
export interface PublicFormRequestAnswer {
  label: string;
  // The answer as a person reads it; for files, their names.
  value: string;
}

// Everything the form's page is told about one request.
export interface PublicFormRequest {
  submissionId: string;
  // The form's name, the page's heading.
  formName: string;
  logo?: PublicFormImage | undefined;
  logoAltText?: string | undefined;
  favicon?: PublicFormImage | undefined;
  // The request's title: what it was submitted as.
  title: string;
  // The number of what it created, as the project shows it: "INC-42".
  reference?: string | undefined;
  // When it was submitted, as an ISO 8601 date.
  submittedAt: string;
  // Null once the record is gone, or while it cannot be read.
  state: PublicFormRequestState | null;
  answers: Array<PublicFormRequestAnswer>;
  // Oldest first.
  messages: Array<PublicFormRequestMessage>;
  people: Array<PublicFormRequestPerson>;
  // The reader, as they are following it.
  you: PublicFormRequestPerson;
  // Somebody more may be added: the request is below FORM_FOLLOW_UP_MAX_PEOPLE.
  canAddPeople: boolean;
  // On a form that asks its visitors to sign in: the address signed in.
  signedInAs?: string | undefined;
}

// One request in My requests.
export interface PublicFormRequestSummary {
  submissionId: string;
  title: string;
  reference?: string | undefined;
  submittedAt: string;
  // When anybody last wrote, or when it was submitted.
  lastActivityAt: string;
  state: PublicFormRequestState | null;
}

// My requests: everything the signed-in visitor is following on this form.
export interface PublicFormMyRequests {
  formName: string;
  logo?: PublicFormImage | undefined;
  logoAltText?: string | undefined;
  favicon?: PublicFormImage | undefined;
  signedInAs: string;
  // Newest activity first.
  requests: Array<PublicFormRequestSummary>;
}

// The body of the reply route: the request, and the reply box's answers.
export interface PublicFormRequestReplyRequest {
  access: PublicFormRequestAccess;
  // Keyed by the reply box's question ids (getFormFollowUpReplyFields).
  answers: Record<string, unknown>;
}

// The body of the add person route.
export interface PublicFormRequestAddPersonRequest {
  access: PublicFormRequestAccess;
  email: string;
  name?: string | undefined;
}

/*
 * THE DASHBOARD'S VIEW of a record a submission created: who sent it, who
 * is following it, the conversation, and what the reader may do.
 */
export interface FormFollowUpRecordPerson {
  id: string;
  name?: string | undefined;
  email: string;
  isSubmitter: boolean;
  // When they started following, as an ISO 8601 date.
  addedAt: string;
}

export interface FormFollowUpRecordFile {
  fileId: string;
  name: string;
  fileType: string;
  size: number;
}

export interface FormFollowUpRecordMessage {
  id: string;
  createdAt: string;
  author: FormFollowUpAuthor;
  // The person following who wrote it, or the responder's name.
  authorName: string;
  // A requester's address, or nothing for the team.
  authorEmail?: string | undefined;
  text: string;
  files: Array<FormFollowUpRecordFile>;
}

export interface FormFollowUpRecordView {
  submissionId: string;
  formId: string;
  formName: string;
  // The form's follow-ups switch: off, nobody is emailed and nobody writes.
  isFollowUpOn: boolean;
  submittedAt: string;
  submitterName?: string | undefined;
  submitterEmail?: string | undefined;
  people: Array<FormFollowUpRecordPerson>;
  // Oldest first.
  messages: Array<FormFollowUpRecordMessage>;
  // The reader may reply and add or remove people: they may edit the record.
  canReply: boolean;
  maxPeople: number;
}

// The body of the dashboard's reply route.
export interface FormFollowUpRecordReplyRequest {
  message: string;
}

// The body of the dashboard's add person route.
export interface FormFollowUpRecordAddPersonRequest {
  email: string;
  name?: string | undefined;
}

export type GetFormFollowUpRecordRouteFunction = (data: {
  recordType: FormTargetType;
  recordId: string;
}) => string;

// GET /form-follow-up/<record type>/<record id>
export const getFormFollowUpRecordRoute: GetFormFollowUpRecordRouteFunction =
  (data: { recordType: FormTargetType; recordId: string }): string => {
    return `${FORM_FOLLOW_UP_RECORD_ROUTE}/${encodeURIComponent(
      data.recordType,
    )}/${encodeURIComponent(data.recordId)}`;
  };

export type CleanFormFollowUpNameFunction = (value: unknown) => {
  name?: string | undefined;
  error?: string | undefined;
};

/*
 * A name given for somebody added: on one line, trimmed, at most
 * FORM_FOLLOW_UP_NAME_MAX_LENGTH characters. Left out when empty.
 */
export const cleanFormFollowUpName: CleanFormFollowUpNameFunction = (
  value: unknown,
): { name?: string | undefined; error?: string | undefined } => {
  if (value === undefined || value === null) {
    return {};
  }

  if (typeof value !== "string") {
    return { error: FORM_FOLLOW_UP_NAME_TOO_LONG_MESSAGE };
  }

  const name: string = cleanSingleLineAnswer(value);

  if (!name) {
    return {};
  }

  if (name.length > FORM_FOLLOW_UP_NAME_MAX_LENGTH) {
    return { error: FORM_FOLLOW_UP_NAME_TOO_LONG_MESSAGE };
  }

  return { name: name };
};

export type ReadFormFollowUpEmailFunction = (value: unknown) => string | null;

/*
 * An address given for somebody added: one ordinary address, in lower case,
 * as Email stores it - or null.
 */
export const readFormFollowUpEmail: ReadFormFollowUpEmailFunction = (
  value: unknown,
): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const email: string = value.trim();

  if (
    !email ||
    email.length > FORM_FOLLOW_UP_EMAIL_MAX_LENGTH ||
    !isWholeEmailAddress(email)
  ) {
    return null;
  }

  return email.toLowerCase();
};

export type GetFormFollowUpAuthorNameFunction = (data: {
  name?: string | null | undefined;
  email?: string | null | undefined;
}) => string;

// How a person following is named: their name, else their address.
export const getFormFollowUpPersonLabel: GetFormFollowUpAuthorNameFunction =
  (data: {
    name?: string | null | undefined;
    email?: string | null | undefined;
  }): string => {
    const name: string = (data.name || "").trim();

    return name || (data.email || "").trim();
  };
