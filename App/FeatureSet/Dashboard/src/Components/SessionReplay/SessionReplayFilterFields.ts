import FieldType from "Common/UI/Components/Types/FieldType";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import {
  parseTagFilter,
  SessionReplayAdvancedFilters,
} from "./SessionReplayListFilters";
import { TRIGGER_REASON_LABELS } from "./SessionReplayPlayability";

/*
 * One description of the advanced filters, shared by the two things that
 * have to agree about them: the filter modal that edits them and the
 * chips above the table that state which of them are applied.
 *
 * Kept out of SessionReplayTable.tsx because a chip that disagrees with the
 * request is worse than no chip at all - it tells the viewer the list is
 * narrowed by something it is not.
 */

export enum SessionReplayFilterKind {
  Text = "text",
  Number = "number",
  Dropdown = "dropdown",
}

export interface SessionReplayFilterField {
  field: keyof SessionReplayAdvancedFilters;
  title: string;
  placeholder: string;
  kind: SessionReplayFilterKind;
  type: FieldType;
  /* One line under the control explaining what the predicate really is. */
  hint?: string | undefined;
  options?: Array<DropdownOption> | undefined;
}

export const DEVICE_TYPE_OPTIONS: Array<DropdownOption> = [
  { value: "desktop", label: "Desktop" },
  { value: "mobile", label: "Mobile" },
  { value: "tablet", label: "Tablet" },
];

/*
 * Every value the recorder can write, labelled the way the Recording
 * column labels it. Built from the enum so a reason added there cannot be
 * left out here (which is what left "performance" sessions unselectable
 * once, and made every always-on session read "Sampled").
 */
export const TRIGGER_REASON_OPTIONS: Array<DropdownOption> = Object.values(
  SessionReplayTriggerReason,
).map((reason: SessionReplayTriggerReason): DropdownOption => {
  return { value: reason, label: TRIGGER_REASON_LABELS[reason] };
});

export const SESSION_REPLAY_FILTER_FIELDS: Array<SessionReplayFilterField> = [
  {
    field: "search",
    title: "Search",
    placeholder: "checkout, a session id, a trace id",
    kind: SessionReplayFilterKind.Text,
    type: FieldType.Text,
    hint: "Matches the session id prefix, any page URL, a trace id, and the user label when you may read it. Searches cover at most 30 days.",
  },
  {
    field: "identifiedUserRef",
    title: "User",
    placeholder: "user-1234 or jane@example.com",
    kind: SessionReplayFilterKind.Text,
    type: FieldType.Text,
    /*
     * The end-user reference as the customer's own page supplies it - the
     * value shown in the "User & device" column - not the digest it is
     * stored under. The server hashes it with the same per-project
     * derivation the ingest used, so what a person can see is what a person
     * can type.
     */
    hint: "The exact reference your page passed to identify(). Needs the end-user identity permission; never written to the URL.",
  },
  {
    field: "urlPrefix",
    title: "Page URL starts with",
    placeholder: "/checkout or https://app.example.com/checkout",
    kind: SessionReplayFilterKind.Text,
    type: FieldType.Text,
    hint: "Any page the session visited, or its entry page. A path like /checkout matches that page on every origin; paste a full URL to pin one origin.",
  },
  {
    field: "tags",
    title: "Tags",
    placeholder: "build=1.4.2, plan=pro",
    kind: SessionReplayFilterKind.Text,
    type: FieldType.Text,
    hint: "key=value pairs set with OneUptimeReplay.setTags(); every pair must match.",
  },
  {
    field: "browserName",
    title: "Browser",
    placeholder: "Chrome",
    kind: SessionReplayFilterKind.Text,
    type: FieldType.Text,
    hint: "Exact browser name as the recorder reports it (Chrome, Mobile Safari, Firefox).",
  },
  {
    field: "osName",
    title: "OS",
    placeholder: "macOS",
    kind: SessionReplayFilterKind.Text,
    type: FieldType.Text,
  },
  {
    field: "deviceType",
    title: "Device",
    placeholder: "Any device",
    kind: SessionReplayFilterKind.Dropdown,
    type: FieldType.Dropdown,
    options: DEVICE_TYPE_OPTIONS,
  },
  {
    field: "countryCode",
    title: "Country",
    placeholder: "DE",
    kind: SessionReplayFilterKind.Text,
    type: FieldType.Text,
    hint: "Two-letter ISO code.",
  },
  {
    field: "triggerReason",
    title: "Trigger",
    placeholder: "Any trigger",
    kind: SessionReplayFilterKind.Dropdown,
    type: FieldType.Dropdown,
    options: TRIGGER_REASON_OPTIONS,
  },
  {
    /*
     * Membership in the session's route list, not its exit page: the server
     * predicate is has(routes, <value>), an exact match against a stored
     * scrubbed URL. "Page URL starts with" above is the one people want;
     * this stays for API parity and saved links.
     */
    field: "route",
    title: "Page URL visited (exact)",
    placeholder: "https://app.example.com/checkout",
    kind: SessionReplayFilterKind.Text,
    type: FieldType.Text,
    hint: "The full stored URL, exactly. A fragment matches nothing; use the field above for prefixes.",
  },
  {
    field: "minDurationSeconds",
    title: "Min duration (s)",
    placeholder: "120",
    kind: SessionReplayFilterKind.Number,
    type: FieldType.Number,
  },
];

export interface SessionReplayFilterChip {
  field: keyof SessionReplayAdvancedFilters;
  /* "User", "Page URL starts with", ... */
  label: string;
  /* The value as it was SENT, so the chip never claims more than the request. */
  text: string;
}

export interface SessionReplayFilterChipOptions {
  /*
   * True when the server ignored the user filter (the caller lacks the
   * identity permission): the chip is withheld and the table shows a
   * notice instead, because a chip over an unfiltered list is a lie.
   */
  hideIdentity?: boolean | undefined;
  /* The search text is visible in the box itself; the chip is redundant there. */
  hideSearch?: boolean | undefined;
}

/*
 * Which chips to draw for a given filter state. Every rule here mirrors
 * buildSessionReplayListFilters: a value that is dropped on its way to the
 * endpoint (blank after trimming, an unparseable duration, a tag pair
 * without "=") must not be announced as an applied filter either.
 */
export function buildSessionReplayFilterChips(
  advanced: SessionReplayAdvancedFilters,
  options?: SessionReplayFilterChipOptions,
): Array<SessionReplayFilterChip> {
  const chips: Array<SessionReplayFilterChip> = [];

  for (const field of SESSION_REPLAY_FILTER_FIELDS) {
    const rawValue: string = (advanced[field.field] || "").trim();

    if (!rawValue) {
      continue;
    }

    if (field.field === "identifiedUserRef" && options?.hideIdentity) {
      continue;
    }

    if (field.field === "search" && options?.hideSearch) {
      continue;
    }

    if (field.field === "minDurationSeconds") {
      const seconds: number = parseFloat(rawValue);

      if (!Number.isFinite(seconds) || seconds <= 0) {
        continue;
      }

      chips.push({
        field: field.field,
        label: "Min duration",
        text: `>= ${seconds}s`,
      });
      continue;
    }

    if (field.field === "tags") {
      const tags: Record<string, string> = parseTagFilter(rawValue);
      const keys: Array<string> = Object.keys(tags);

      if (keys.length === 0) {
        continue;
      }

      chips.push({
        field: field.field,
        label: "Tags",
        text: keys
          .map((key: string): string => {
            return `${key}=${tags[key]}`;
          })
          .join(", "),
      });
      continue;
    }

    if (field.kind === SessionReplayFilterKind.Dropdown) {
      const option: DropdownOption | undefined = (field.options || []).find(
        (candidate: DropdownOption): boolean => {
          return candidate.value.toString() === rawValue;
        },
      );

      chips.push({
        field: field.field,
        label: field.title,
        text: option ? option.label : rawValue,
      });
      continue;
    }

    chips.push({
      field: field.field,
      label: field.title,
      // countryCode is upper-cased before it is sent; the chip shows what was sent.
      text: field.field === "countryCode" ? rawValue.toUpperCase() : rawValue,
    });
  }

  return chips;
}
