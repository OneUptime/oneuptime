import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The Profiles monitor form's words, React-free so the extractor finds them
 * and the tests read the same strings the form draws.
 */

// The kind field's option that reads every kind of profile.
export const PROFILE_MONITOR_ANY_KIND: string = translationKey(
  "Every kind of profile",
);

export const PROFILE_MONITOR_PREVIEW_TITLE: string = translationKey(
  "What this monitor reads now",
);

export const PROFILE_MONITOR_PREVIEW_DESCRIPTION: string = translationKey(
  "Set the threshold above what the function takes today.",
);

export const PROFILE_MONITOR_PREVIEW_COUNT: PluralTemplate = {
  one: "{{count}} profile in the window.",
  other: "{{count}} profiles in the window.",
};

export const PROFILE_MONITOR_PREVIEW_SHARE: string = translationKey(
  "{{function}} takes {{share}} of the window.",
);

export const PROFILE_MONITOR_PREVIEW_NOTHING: string = translationKey(
  "Nothing was profiled in this window, so Function Share has nothing to judge yet.",
);
