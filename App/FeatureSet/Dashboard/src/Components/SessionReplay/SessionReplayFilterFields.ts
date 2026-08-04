import FieldType from "Common/UI/Components/Types/FieldType";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import Filter from "Common/UI/Components/Filters/Types/Filter";
import FilterData from "Common/UI/Components/Filters/Types/FilterData";
import { SessionReplayAdvancedFilters } from "./SessionReplayListFilters";
import type { SessionReplaySummary } from "./SessionReplayTable";

/*
 * One description of the eight advanced filters, shared by the two things
 * that have to agree about them: the filter modal that edits them and the
 * chips banner above the table that states which of them are applied.
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
  /*
   * Chip identity only. Filter<T> requires a `keyof T` and FilterViewer uses
   * it for nothing but the `filterData[key]` lookup - the visible text comes
   * from `title` - so the three filters with no column of their own borrow
   * the nearest real one. All eight MUST stay distinct or one chip would
   * silently overwrite another.
   */
  chipKey: keyof SessionReplaySummary;
  options?: Array<DropdownOption> | undefined;
}

export const DEVICE_TYPE_OPTIONS: Array<DropdownOption> = [
  { value: "desktop", label: "Desktop" },
  { value: "mobile", label: "Mobile" },
  { value: "tablet", label: "Tablet" },
];

export const TRIGGER_REASON_OPTIONS: Array<DropdownOption> = [
  { value: "error", label: "Error" },
  { value: "frustration", label: "Frustration" },
  { value: "sampled", label: "Sampled" },
  { value: "manual", label: "Manual" },
];

export const SESSION_REPLAY_FILTER_FIELDS: Array<SessionReplayFilterField> = [
  {
    field: "browserName",
    title: "Browser",
    placeholder: "Chrome",
    kind: SessionReplayFilterKind.Text,
    type: FieldType.Text,
    chipKey: "browserName",
  },
  {
    field: "osName",
    title: "OS",
    placeholder: "macOS",
    kind: SessionReplayFilterKind.Text,
    type: FieldType.Text,
    chipKey: "osName",
  },
  {
    field: "deviceType",
    title: "Device",
    placeholder: "Any device",
    kind: SessionReplayFilterKind.Dropdown,
    type: FieldType.Dropdown,
    chipKey: "deviceType",
    options: DEVICE_TYPE_OPTIONS,
  },
  {
    field: "countryCode",
    title: "Country",
    placeholder: "DE",
    kind: SessionReplayFilterKind.Text,
    type: FieldType.Text,
    chipKey: "countryCode",
  },
  {
    field: "triggerReason",
    title: "Trigger",
    placeholder: "Any trigger",
    kind: SessionReplayFilterKind.Dropdown,
    type: FieldType.Dropdown,
    chipKey: "triggerReason",
    options: TRIGGER_REASON_OPTIONS,
  },
  {
    /*
     * Exact match against a stored scrubbed URL - the server deliberately
     * refuses substring scans over this column - so the label says so. A
     * "/checkout" fragment matches nothing.
     */
    field: "route",
    title: "Exit page URL (exact)",
    placeholder: "https://app.example.com/checkout",
    kind: SessionReplayFilterKind.Text,
    type: FieldType.Text,
    chipKey: "exitUrl",
  },
  {
    field: "minDurationSeconds",
    title: "Min duration (s)",
    placeholder: "120",
    kind: SessionReplayFilterKind.Number,
    type: FieldType.Number,
    chipKey: "durationMs",
  },
  {
    field: "identifiedUserKey",
    title: "User key",
    placeholder: "hashed identifier",
    kind: SessionReplayFilterKind.Text,
    type: FieldType.Text,
    chipKey: "identifiedUserLabel",
  },
];

/* The chip definitions the table hands to Table's FilterViewer. */
export const SESSION_REPLAY_CHIP_FILTERS: Array<Filter<SessionReplaySummary>> =
  SESSION_REPLAY_FILTER_FIELDS.map(
    (field: SessionReplayFilterField): Filter<SessionReplaySummary> => {
      return {
        title: field.title,
        key: field.chipKey,
        type: field.type,
        ...(field.options ? { filterDropdownOptions: field.options } : {}),
      };
    },
  );

/*
 * Which chips to draw for a given filter state. Every rule here mirrors
 * buildSessionReplayListFilters: a value that is dropped on its way to the
 * endpoint (blank after trimming, an unparseable duration) must not be
 * announced as an applied filter either.
 */
export function buildSessionReplayFilterChipData(
  advanced: SessionReplayAdvancedFilters,
): FilterData<SessionReplaySummary> {
  const data: FilterData<SessionReplaySummary> = {};

  for (const field of SESSION_REPLAY_FILTER_FIELDS) {
    const rawValue: string = (advanced[field.field] || "").trim();

    if (!rawValue) {
      continue;
    }

    if (field.field === "minDurationSeconds") {
      const seconds: number = parseFloat(rawValue);

      if (!Number.isFinite(seconds) || seconds <= 0) {
        continue;
      }

      // Rendered by FilterViewer as "Min duration (s) is >= 120".
      data.durationMs = new GreaterThanOrEqual<number>(seconds);
      continue;
    }

    // countryCode is upper-cased before it is sent; the chip shows what was sent.
    data[field.chipKey] = (
      field.field === "countryCode" ? rawValue.toUpperCase() : rawValue
    ) as never;
  }

  return data;
}
