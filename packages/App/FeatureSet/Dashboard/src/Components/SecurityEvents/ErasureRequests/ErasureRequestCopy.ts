import SecurityUserErasureRequest from "Common/Models/DatabaseModels/SecurityUserErasureRequest";
import { SecurityUserErasureRequestStatus } from "Common/Types/SecurityEvent/SecurityUserErasure";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS OF SECURITY EVENTS' ERASURE REQUESTS (#10908): Security
 * Events > Settings > Erasure Requests, where a person is erased from the
 * user vault and the request says when it is done. English keys the
 * extractor reads, looked up where they are drawn; React-free, so a plain
 * test pins them beside the rules that choose them.
 */

export const ERASURE_REQUESTS_TITLE: string =
  translationKey("Erasure Requests");

export const ERASURE_REQUESTS_DESCRIPTION: string = translationKey(
  "Erase a person from Security Events: the user vault forgets them for good, and the events, cases and proposals it named them in show their token instead.",
);

export const NO_ERASURE_REQUESTS: string = translationKey(
  "No erasure requests yet.",
);

// The header's button, its dialog and the dialog's button.
export const ERASE_VERB: string = translationKey("Erase");
export const ERASE_NOUN: string = translationKey("Person");
export const ERASE_PERSON: string = translationKey("Erase Person");
export const ERASE_A_PERSON: string = translationKey("Erase a Person");
export const ERASE_DIALOG_DESCRIPTION: string = translationKey(
  "Security Events stops naming this person within a minute, and takes them out of what it named them in within a few minutes. This can't be undone.",
);

// The dialog's fields.
export const USER_FIELD_TITLE: string = translationKey(
  "User ID, Email Address or Token",
);
export const USER_FIELD_DESCRIPTION: string = translationKey(
  "As your logs held it before your Hash scrub rule hid it, or the token an event shows. An email address is erased in lower case too.",
);
export const REFERENCE_FIELD_TITLE: string = translationKey("Reference");
export const REFERENCE_FIELD_DESCRIPTION: string = translationKey(
  "Your own reference, such as the request's ticket number. Never the person's name or email address.",
);

/*
 * Why what was typed cannot be erased: the server's words
 * (Types/SecurityEvent/SecurityUserErasure.getErasureUserProblem), which
 * the form says first. Here as keys, since the extractor reads no Common.
 */
export const USER_REQUIRED: string = translationKey(
  "Enter the user ID, email address or token of the person to erase.",
);
export const USER_TOO_LONG: string = translationKey(
  "That is longer than any user Security Events keeps. Enter the user ID or email address as your logs hold it.",
);

// Said as the dialog closes.
export const ERASURE_REQUESTED: string = translationKey(
  "Erasure requested. Security Events stops naming this person within a minute, and finishes erasing them in a few minutes.",
);

// The list's columns.
export const REQUEST_COLUMN: string = translationKey("Request");
export const STATUS_COLUMN: string = translationKey("Status");
export const CHANGES_COLUMN: string = translationKey("What It Changed");
export const TOKENS_COLUMN: string = translationKey("Tokens");

// A request with no reference of its own, in its row.
export const UNNAMED_REQUEST: string = translationKey("Erasure request");
export const REQUESTED_AT_BY: string = translationKey(
  "Requested {{time}} by {{name}}",
);
export const REQUESTED_AT: string = translationKey("Requested {{time}}");

// Each state, in its pill, and the line under it.
export const ERASURE_STATUS_LABELS: Readonly<
  Record<SecurityUserErasureRequestStatus, string>
> = {
  [SecurityUserErasureRequestStatus.Pending]: translationKey("Queued"),
  [SecurityUserErasureRequestStatus.InProgress]: translationKey("Erasing"),
  [SecurityUserErasureRequestStatus.Completed]: translationKey("Erased"),
  [SecurityUserErasureRequestStatus.Failed]: translationKey("Failed"),
};

export const ERASURE_STATUS_TONES: Readonly<
  Record<SecurityUserErasureRequestStatus, PillTone>
> = {
  [SecurityUserErasureRequestStatus.Pending]: PillTone.Info,
  [SecurityUserErasureRequestStatus.InProgress]: PillTone.Info,
  [SecurityUserErasureRequestStatus.Completed]: PillTone.Success,
  [SecurityUserErasureRequestStatus.Failed]: PillTone.Danger,
};

export const QUEUED_LINE: string = translationKey(
  "Erasing starts within a few minutes.",
);
export const ERASING_LINE: string = translationKey(
  "Waiting for the last of it to be applied.",
);
export const ERASED_AT: string = translationKey("Erased {{time}}");
export const FAILED_LINE: string = translationKey(
  "{{reason}} Security Events still refuses to name them. File the request again to retry.",
);

// What a request changed, in its row.
export const VAULT_ENTRIES_DELETED: PluralTemplate = {
  one: "{{count}} vault entry deleted",
  other: "{{count}} vault entries deleted",
};
export const EVENTS_UNNAMED: PluralTemplate = {
  one: "{{count}} event unnamed",
  other: "{{count}} events unnamed",
};
export const CASES_UNNAMED: PluralTemplate = {
  one: "{{count}} case unnamed",
  other: "{{count}} cases unnamed",
};
export const PROPOSALS_WITHDRAWN: PluralTemplate = {
  one: "{{count}} proposal withdrawn",
  other: "{{count}} proposals withdrawn",
};
export const NOTHING_NAMED_THEM: string = translationKey(
  "Nothing in Security Events named them.",
);
export const NOT_STARTED: string = translationKey("Not started yet.");

/*
 * The list's help (?): what an erasure does, what it leaves, and who may
 * ask for one - in HelpContent's shape (Docs/ux/README.md#help-dialogs).
 */
export const ERASURE_HELP_DESCRIPTION: string = translationKey(
  "Erase a person from Security Events when they ask you to, for example under GDPR Article 17.",
);
export const ERASURE_HELP_MARKDOWN: string = translationKey(
  `When a Hash scrub rule hides a user in your logs and traces, Security Events keeps the user behind the token in its user vault for 30 days, so it can name them in events, cases and playbooks. An erasure request takes one person out of it for good.

## What it does

- Within a minute of filing it, the user vault refuses the person's tokens: Security Events never names them again, even when a later event carries the token.
- Within a few minutes it deletes the vault's entries of them, puts the token back in the events it named them in, and takes them out of the titles, entities and kept events of cases and detections, and out of entity risk.
- A playbook run or an action of OneUptime AI waiting for approval to act on them is withdrawn.

## What it leaves

- What people wrote: notes, closing notes, tasks, evidence and custom fields.
- Events that named the person because your logs held them in clear, and your logs and traces themselves, which hold only the token.
- Notifications already sent, incidents and alerts a detection opened, and the audit log.

## What the request keeps

- Who filed it and when, your reference, and the person's tokens - never their user ID or email address once it is done.
- Project Owners and Admins, Security Admins and anyone with Create Security Erasure Request can file one. Every Security role can read them.`,
);

// What one request changed, as the row lists it: only what it did.
export function getErasureChanges(request: SecurityUserErasureRequest): Array<{
  template: PluralTemplate;
  count: number;
}> {
  return [
    { template: VAULT_ENTRIES_DELETED, count: request.vaultEntriesDeleted || 0 },
    { template: EVENTS_UNNAMED, count: request.eventsUnnamed || 0 },
    { template: CASES_UNNAMED, count: request.casesUnnamed || 0 },
    { template: PROPOSALS_WITHDRAWN, count: request.proposalsWithdrawn || 0 },
  ].filter((change: { template: PluralTemplate; count: number }): boolean => {
    return change.count > 0;
  });
}

// A request's state, read defensively: anything unknown is Queued.
export function getErasureStatus(
  request: SecurityUserErasureRequest,
): SecurityUserErasureRequestStatus {
  const status: unknown = request.status;

  return Object.values(SecurityUserErasureRequestStatus).includes(
    status as SecurityUserErasureRequestStatus,
  )
    ? (status as SecurityUserErasureRequestStatus)
    : SecurityUserErasureRequestStatus.Pending;
}
