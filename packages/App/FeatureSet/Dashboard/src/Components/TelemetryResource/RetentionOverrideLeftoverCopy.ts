import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * A retention override a trial left behind, below the plan that sells
 * retention overrides (Scale on OneUptime Cloud).
 *
 * Retention overrides keep applying whatever the plan: new telemetry is
 * stored with the override, and usage billing follows it. A paid feature
 * can always be switched off, on any plan - the server lets the override
 * columns go back to their default (nothing set) whatever the plan - so the
 * retention pages, which show the plan's upsell below Scale, draw this card
 * under it while an override is set (RetentionOverrideLeftover): what is
 * set, and one button that removes it. Setting one again needs the plan.
 *
 * Removing an override changes the retention new telemetry is stored with;
 * what is already stored keeps the retention it was stored with
 * (OpenTelemetryIngestService stamps it at ingest), so nothing is deleted
 * sooner. The dialog says so.
 *
 * Kept free of React so the card and App/Tests read these exact strings.
 * Every sentence is wrapped in translationKey() so npm run i18n:extract
 * finds it.
 */

/*
 * Which overrides a record can hold: a service's or telemetry resource's own
 * retention and its retention by type, or the project's retention by type.
 */
export enum RetentionOverrideLeftoverKind {
  Resource = "Resource",
  Project = "Project",
}

// The plan-gated override columns of each kind of record.
export const RETENTION_OVERRIDE_COLUMNS: Record<
  RetentionOverrideLeftoverKind,
  ReadonlyArray<string>
> = {
  [RetentionOverrideLeftoverKind.Resource]: [
    "retainTelemetryDataForDays",
    "telemetryRetentionConfig",
  ],
  [RetentionOverrideLeftoverKind.Project]: ["telemetryRetentionConfig"],
};

export interface RetentionOverrideLeftoverCopyForKind {
  title: string;
  // A template: the card fills in the plan's name.
  description: string;
  confirmDescription: string;
  removed: string;
}

export const RETENTION_OVERRIDE_LEFTOVER_COPY: Record<
  RetentionOverrideLeftoverKind,
  RetentionOverrideLeftoverCopyForKind
> = {
  [RetentionOverrideLeftoverKind.Resource]: {
    title: translationKey("Retention Override"),
    description: translationKey(
      "Telemetry from here is kept for its own retention, not the project's. Your plan does not include retention overrides: you can remove this one, but setting one again needs the {{planName}} plan.",
    ),
    confirmDescription: translationKey(
      "From now on, telemetry from here is kept for the project's retention. What is already stored keeps the retention it was stored with.",
    ),
    removed: translationKey(
      "Removed. Telemetry from here is kept for the project's retention from now on.",
    ),
  },
  [RetentionOverrideLeftoverKind.Project]: {
    title: translationKey("Retention by Telemetry Type"),
    description: translationKey(
      "Some types of telemetry are kept for their own retention, not the project's default. Your plan does not include retention by telemetry type: you can remove it, but setting it again needs the {{planName}} plan.",
    ),
    confirmDescription: translationKey(
      "From now on, each type of telemetry is kept for the project's default retention, unless a service or resource has its own. What is already stored keeps the retention it was stored with.",
    ),
    removed: translationKey(
      "Removed. Telemetry is kept for the project's default retention from now on.",
    ),
  },
};

export const RetentionOverrideLeftoverCopy: {
  removeButton: string;
  confirmTitle: string;
} = {
  removeButton: translationKey("Remove Override"),
  confirmTitle: translationKey("Remove the retention override?"),
};

// Test ids.
export const RETENTION_OVERRIDE_LEFTOVER_TEST_ID: string =
  "retention-override-leftover";
export const RETENTION_OVERRIDE_LEFTOVER_REMOVED_TEST_ID: string =
  "retention-override-leftover-removed";

export default RetentionOverrideLeftoverCopy;
