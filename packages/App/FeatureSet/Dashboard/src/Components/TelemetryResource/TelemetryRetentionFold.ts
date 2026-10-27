import TelemetryRetentionConfig from "Common/Types/Telemetry/TelemetryRetentionConfig";
import {
  FoldedSectionItem,
  foldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { getPageAnchorNameForTitle } from "Common/UI/Utils/PageAnchor";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * RETENTION, IN MORE SETTINGS.
 *
 * "Move custom roles to More settings because it is an advanced feature.
 * Please audit the entire project for advanced features just like these and
 * move them to More as well, so it is hidden by default and it doesn't
 * cause frustration and decision paralysis to users." - the maintainer.
 *
 * Retention overrides are such a feature: an Enterprise one (OneUptime
 * Cloud's Scale plan), which most projects never use - their telemetry is
 * kept for the project's retention. Yet every service's and telemetry
 * resource's Settings page drew them (or, without the plan, the card that
 * sells them) between its details and Archive. They wait folded under the
 * page's More settings now, as on Settings > Telemetry, where the project's
 * retention by type folds under its default retention:
 *
 *   - folded, the header names the cards in it, each with what it is set to
 *     while it overrides anything ("Telemetry Data Retention: 30 days",
 *     "Retention by Telemetry Type: 2"), so an override in force is never
 *     hidden;
 *   - where retention overrides cannot be set (the Community Edition, a
 *     project below the plan), it names the card that sells them, marked
 *     while a trial's override is still applied (the leftover card under
 *     it);
 *   - a link to a card (#telemetry-data-retention,
 *     #retention-by-telemetry-type, #retention-overrides) opens it there.
 *
 * Nothing changes what is stored or how long it is kept.
 *
 * React-free, so the pages, the Enterprise cards and the tests read the
 * same names and words.
 */

/*
 * What the retention cards hold, as each one tells its page (the plugin
 * contract, Enterprise/EnterprisePlugins, hands it on): left out until the
 * card has read it.
 */
export interface TelemetryRetentionFoldState {
  // A resource's own retention, in days: null while it uses the project's.
  retainTelemetryDataForDays?: number | null | undefined;
  // How many retention-by-type fields hold a value.
  typeOverrideCount?: number | undefined;
  // Where overrides cannot be set: whether one a trial left is still applied.
  isLeftoverOverrideSet?: boolean | undefined;
}

export type TelemetryRetentionFoldStateHandler = (
  state: TelemetryRetentionFoldState,
) => void;

// The cards' titles, as the Enterprise cards and the upsell draw them.
export const TELEMETRY_DATA_RETENTION_TITLE: string = translationKey(
  "Telemetry Data Retention",
);

export const RETENTION_BY_TELEMETRY_TYPE_TITLE: string = translationKey(
  "Retention by Telemetry Type",
);

export const RETENTION_OVERRIDES_TITLE: string = translationKey(
  "Retention Overrides",
);

// Each card's place on the page: its title's, as in any More settings.
export const TELEMETRY_DATA_RETENTION_PLACE: string = getPageAnchorNameForTitle(
  TELEMETRY_DATA_RETENTION_TITLE,
);

export const RETENTION_BY_TELEMETRY_TYPE_PLACE: string =
  getPageAnchorNameForTitle(RETENTION_BY_TELEMETRY_TYPE_TITLE);

export const RETENTION_OVERRIDES_PLACE: string = getPageAnchorNameForTitle(
  RETENTION_OVERRIDES_TITLE,
);

// A resource's own retention, as its chip says it: "30 days", "1 day".
export const RETENTION_DAYS: PluralTemplate = {
  one: "{{count}} day",
  other: "{{count}} days",
};

// What the folded More settings of a resource's Settings page holds, under its title once open.
export const RESOURCE_RETENTION_MORE_DESCRIPTION: string = translationKey(
  "How long telemetry from here is kept, when it should not follow the project's retention.",
);

/*
 * The same on a RUM application's Settings page, where how long its session
 * replays are kept (read-only there, set on its Replay Policy) waits
 * beside them.
 */
export const RUM_RETENTION_MORE_DESCRIPTION: string = translationKey(
  "How long telemetry and session replays from this application are kept.",
);

// The RUM application's replay retention card, as it is titled.
export const SESSION_REPLAY_RETENTION_TITLE: string = translationKey(
  "Session Replay Retention",
);

// The same, on Settings > Telemetry.
export const PROJECT_RETENTION_MORE_DESCRIPTION: string = translationKey(
  "How long each type of telemetry is kept, when it should not follow the default retention above.",
);

/*
 * The values a retention-by-type override holds: the logs', traces',
 * metrics' and profiles' own defaults, and the logs' by severity and the
 * traces' by status - the fields of the Retention by Telemetry Type card.
 * A blank (or zero) field holds nothing: it falls back.
 */
export const countRetentionTypeOverrides: (
  config: TelemetryRetentionConfig | null | undefined,
) => number = (config: TelemetryRetentionConfig | null | undefined): number => {
  if (!config) {
    return 0;
  }

  const values: Array<number | null | undefined> = [
    config.logs?.default,
    ...Object.values(config.logs?.bySeverity || {}),
    config.traces?.default,
    ...Object.values(config.traces?.byStatus || {}),
    config.metrics?.default,
    config.profiles?.default,
  ];

  return values.filter((value: number | null | undefined): boolean => {
    return typeof value === "number" && value > 0;
  }).length;
};

// A resource's own retention, as its card reads it: null for none.
export const readRetentionDays: (
  value: number | null | undefined,
) => number | null = (value: number | null | undefined): number | null => {
  return typeof value === "number" && value > 0 ? value : null;
};

export interface RetentionFoldedItemsInput {
  state: TelemetryRetentionFoldState;
  /*
   * Whether the Enterprise cards are drawn (the project may set overrides
   * and the build includes them); otherwise the card that sells them is.
   */
  isEnterpriseCardDrawn: boolean;
  /*
   * A resource has its own retention and its retention by type; the
   * project has only its retention by type (its own default is the card
   * above the fold).
   */
  hasOwnRetention: boolean;
  // Writes a day count the reader's way: the page's translator does.
  formatDays: (days: number) => string;
}

/*
 * The retention cards as a folded More settings header names them: the
 * Enterprise cards, each set while it overrides anything, or the card that
 * sells them, set while a trial's override is still applied.
 */
export const getRetentionFoldedItems: (
  input: RetentionFoldedItemsInput,
) => Array<FoldedSectionItem> = (
  input: RetentionFoldedItemsInput,
): Array<FoldedSectionItem> => {
  if (!input.isEnterpriseCardDrawn) {
    return [
      foldedSectionItem(RETENTION_OVERRIDES_TITLE, {
        key: RETENTION_OVERRIDES_PLACE,
        isSet: input.state.isLeftoverOverrideSet === true,
      }),
    ];
  }

  const items: Array<FoldedSectionItem> = [];

  if (input.hasOwnRetention) {
    const days: number | null = readRetentionDays(
      input.state.retainTelemetryDataForDays,
    );

    items.push(
      foldedSectionItem(TELEMETRY_DATA_RETENTION_TITLE, {
        key: TELEMETRY_DATA_RETENTION_PLACE,
        isSet: days !== null,
        value: days !== null ? input.formatDays(days) : undefined,
      }),
    );
  }

  const typeOverrideCount: number = input.state.typeOverrideCount || 0;

  items.push(
    foldedSectionItem(RETENTION_BY_TELEMETRY_TYPE_TITLE, {
      key: RETENTION_BY_TELEMETRY_TYPE_PLACE,
      isSet: typeOverrideCount > 0,
      value: typeOverrideCount > 0 ? String(typeOverrideCount) : undefined,
    }),
  );

  return items;
};
