import { ProfileFrameOrigin } from "Common/Utils/Profiles/ProfileFrames";
import { ProfileCategory } from "Common/Utils/Profiles/ProfileTypes";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { ProfilesCompareMode } from "../../Utils/ProfilesUrlState";

/*
 * The Profiler's words, kept apart from its components (React-free) so the
 * extractor finds them and the tests read the same strings the page draws.
 */

// Whose code a frame runs, as the table and the panel name it.
export const PROFILE_ORIGIN_LABELS: Record<ProfileFrameOrigin, string> = {
  [ProfileFrameOrigin.Own]: translationKey("Your code"),
  [ProfileFrameOrigin.Dependency]: translationKey("Library"),
  [ProfileFrameOrigin.Runtime]: translationKey("Runtime"),
  [ProfileFrameOrigin.Native]: translationKey("System"),
  [ProfileFrameOrigin.Unknown]: translationKey("Unknown"),
};

/*
 * Self and total, explained where they are shown - in words that fit every
 * kind of profile (CPU time, memory, allocations, locks), not time alone.
 */
export const SELF_EXPLAINED: string = translationKey(
  "Only the function's own code.",
);
export const TOTAL_EXPLAINED: string = translationKey(
  "The function and everything it calls.",
);
export const SELF_AND_TOTAL_SENTENCE: string = translationKey(
  "{{self}} counts only the function's own code. {{total}} adds everything it calls.",
);

// The compare menu.
export const COMPARE_LABELS: Record<ProfilesCompareMode, string> = {
  [ProfilesCompareMode.Previous]: translationKey("The period before"),
  [ProfilesCompareMode.Day]: translationKey("The same time yesterday"),
  [ProfilesCompareMode.Week]: translationKey("The same time last week"),
  [ProfilesCompareMode.Change]: translationKey("Before this deploy"),
};

export const COMPARE_OFF: string = translationKey("Don't compare");

/*
 * The compare menu's group of recorded changes: deploys, and the config
 * changes, rollbacks and feature flags recorded beside them.
 */
export const COMPARE_CHANGES_HEADING: string = translationKey(
  "Before and after a change",
);

// The kinds' own row ends with the raw types they leave out.
export const MORE_PROFILE_TYPES: string = translationKey("More profile types");

// A raw profile type in the type picker: "samples (CPU time)".
export const RAW_TYPE_LABEL: string = translationKey("{{type}} ({{kind}})");

/*
 * What the headline says the window was compared with, after its sentence:
 * "parseOrder went from 10% to 45% of the CPU time, compared with the hour
 * before."
 */
export const COMPARED_WITH: Record<ProfilesCompareMode, string> = {
  [ProfilesCompareMode.Previous]: translationKey(
    "Compared with the period before.",
  ),
  [ProfilesCompareMode.Day]: translationKey(
    "Compared with the same time yesterday.",
  ),
  [ProfilesCompareMode.Week]: translationKey(
    "Compared with the same time last week.",
  ),
  [ProfilesCompareMode.Change]: translationKey(
    "Compared with before the change at {{time}}.",
  ),
};

/*
 * A change the page lists (the last week's) is named, and its time said the
 * way the compare menu says it: "Compared with before the change 40 minutes
 * ago (Deploy: v2.4.0)."
 */
export const COMPARED_WITH_NAMED_CHANGE: string = translationKey(
  "Compared with before the change {{when}} ({{change}}).",
);

/*
 * The headline. The function comes first, and "takes" is the verb of every
 * sentence in it - a share of the CPU time, of the memory, of the lock
 * waits or of the goroutines, which no service "spends".
 */
export const HEADLINE_LEADER: string = translationKey(
  "{{function}} takes {{share}} of the {{kind}} in {{service}}.",
);
export const HEADLINE_LEADER_ALL: string = translationKey(
  "{{function}} takes {{share}} of the {{kind}} across your services.",
);
export const HEADLINE_TOP_THREE: string = translationKey(
  "The top {{count}} functions take {{share}}.",
);
export const HEADLINE_TOP_OWN: string = translationKey(
  "In your own code, {{function}} takes the most: {{share}}, with the library and runtime code it calls.",
);
export const HEADLINE_SLOWER: string = translationKey(
  "{{function}} went from {{before}} to {{after}} of the {{kind}}.",
);
export const HEADLINE_OWN_GREW: string = translationKey(
  "In your own code, {{function}} grew the most: from {{before}} to {{after}}, with the library and runtime code it calls.",
);
export const HEADLINE_NOTHING_CHANGED: string = translationKey(
  "Nothing changed much: no function's share moved by more than 2 points.",
);
export const HEADLINE_NOT_FOOTED: string = translationKey(
  "One of the two windows has too few samples to compare. Pick a longer window.",
);
export const HEADLINE_NO_DATA: string = translationKey(
  "No {{kind}} profiles in this window.",
);
export const HEADLINE_CHANGE_TOO_RECENT: string = translationKey(
  "This change is only a few minutes old. Give it {{minutes}} minutes of profiles before comparing.",
);

// The flame graph's card.
export const FLAME_TITLES: Record<ProfileCategory, string> = {
  [ProfileCategory.Cpu]: translationKey("Where the CPU time goes"),
  [ProfileCategory.Wall]: translationKey("Where the time goes"),
  [ProfileCategory.Memory]: translationKey("What holds the memory"),
  [ProfileCategory.Allocations]: translationKey("What allocates memory"),
  [ProfileCategory.Locks]: translationKey("Where code waits on locks"),
  [ProfileCategory.Goroutines]: translationKey("Where goroutines wait"),
  [ProfileCategory.Other]: translationKey("Where the samples are"),
};
export const FLAME_DESCRIPTION: string = translationKey(
  "Every profile in the window, merged into one graph. The wider a frame, the bigger its share. Click a frame to zoom in.",
);
// Its legend says what the colours mean, so the card adds no sentence.
export const FLAME_COMPARE_TITLE: string = translationKey("What changed");

// The functions card.
export const FUNCTIONS_TITLE: string = translationKey("Functions");
export const FUNCTIONS_DESCRIPTION: string = translationKey(
  "The functions that take the most. Click one to see who calls it and what it calls.",
);
export const FUNCTIONS_COMPARE_TITLE: string = translationKey(
  "Functions that changed",
);
export const FUNCTIONS_COMPARE_DESCRIPTION: string = translationKey(
  "Each function's share of the window, before and after. Busier traffic alone moves nothing here.",
);
export const SORT_BY_SELF: string = translationKey("Self");
export const SORT_BY_TOTAL: string = translationKey("Total");
export const VIEW_YOUR_CODE: string = translationKey("Your code");
export const VIEW_ALL_FUNCTIONS: string = translationKey("All functions");
export const OWN_CODE_SENTENCE: string = translationKey(
  "Your own functions, each with the library and runtime code it calls: what a change to it can win back.",
);
export const OWN_CODE_COMPARE_DESCRIPTION: string = translationKey(
  "Your own functions, each with the library and runtime code it calls, as a share of the window before and after.",
);
export const OWN_CODE_EXPLAINED: string = translationKey(
  "The function with the library and runtime code it calls.",
);

// The list with nothing in it, for one window and for two.
export const FUNCTIONS_EMPTY: string = translationKey(
  "No functions were sampled in this window.",
);
export const FUNCTIONS_OWN_EMPTY: string = translationKey(
  "None of your own code ran in this window.",
);
export const CHANGES_EMPTY: string = translationKey(
  "No function's share moved between these windows.",
);
export const CHANGES_OWN_EMPTY: string = translationKey(
  "None of your own functions' shares moved between these windows.",
);

// The services card (every profiled service).
export const SERVICES_TITLE: string = translationKey("Services being profiled");
export const SERVICES_DESCRIPTION: string = translationKey(
  "Busiest first. Pick one to see where its time goes.",
);
export const SERVICE_SAMPLES: PluralTemplate = {
  one: "{{count}} sample",
  other: "{{count}} samples",
};
export const SHOW_KERNEL_THREADS: PluralTemplate = {
  one: "Show {{count}} kernel thread",
  other: "Show {{count}} kernel threads",
};
export const HIDE_KERNEL_THREADS: string = translationKey(
  "Hide kernel threads",
);

// The footer.
export const ALL_PROFILES_LINK: string = translationKey(
  "See each profile on its own",
);

// An empty window.
export const EMPTY_WINDOW_TITLE: string = translationKey(
  "No profiles in this window",
);
export const EMPTY_WINDOW_DESCRIPTION: string = translationKey(
  "Profiles came in during the last 30 days, but none in this window. Try a longer window.",
);

// The function panel.
export const PANEL_TITLE: string = translationKey("Function");
export const PANEL_DESCRIPTION: string = translationKey(
  "Its share of the window, who calls it and what it calls.",
);
export const PANEL_SELF_HINT: string = translationKey("in its own code");
export const PANEL_TOTAL_HINT: string = translationKey("with what it calls");
export const PANEL_OWN_HINT: string = translationKey(
  "with the library code it calls",
);
export const PANEL_SAMPLE_COUNT: PluralTemplate = {
  one: "Read from {{count}} sample in this window.",
  other: "Read from {{count}} samples in this window.",
};
export const PANEL_BEFORE_AFTER: string = translationKey(
  "Self: {{before}} before, {{after}} after.",
);
export const PANEL_BEFORE_AFTER_OWN: string = translationKey(
  "Your code: {{before}} before, {{after}} after.",
);
export const PANEL_CALLERS: string = translationKey("Who calls it");
export const PANEL_CALLERS_NONE: string = translationKey(
  "Nothing calls it: its call stacks start here.",
);
export const PANEL_CALLEES: string = translationKey("What it calls");
// Not "all its time is its own": memory and allocations are no time.
export const PANEL_CALLEES_NONE: string = translationKey(
  "It calls no other function.",
);
export const PANEL_OPEN_SOURCE: string = translationKey(
  "Open {{path}} in {{repository}}",
);
export const PANEL_HIGHLIGHT: string = translationKey(
  "Highlight in the flame graph",
);
export const PANEL_SHOW_GRAPHS: string = translationKey("Show as flame graphs");
export const PANEL_HIDE_GRAPHS: string = translationKey(
  "Hide the flame graphs",
);
export const PANEL_WATCH: string = translationKey(
  "Alert me when its share passes {{threshold}}",
);
export const PANEL_NOT_YOUR_CODE: string = translationKey(
  "This is not your code: change how your code calls it, starting with {{function}}.",
);
export const PANEL_PICK_SERVICE_TO_FIX: string = translationKey(
  "Pick its service above to fix it with AI.",
);

// The fix strip.
export const FIX_WITH_AI: string = translationKey("Fix with AI");
export const FIX_WITH_AI_TOOLTIP: string = translationKey(
  "OneUptime AI opens a pull request that makes this lighter, for you to review.",
);
export const FIX_HOT_SENTENCE: string = translationKey(
  "This is your code, and with the library code it calls it takes {{share}} of the {{kind}}. OneUptime AI can look for a lighter way to do the same work.",
);
export const FIX_GREW_SENTENCE: string = translationKey(
  "This is your code, and its share of the {{kind}} grew from {{before}} to {{after}}. OneUptime AI can look for what made it heavier.",
);
export const FIX_PICK_REPOSITORY: string = translationKey(
  "Which repository holds this code?",
);
export const FIX_PICK_REPOSITORY_PLACEHOLDER: string =
  translationKey("Pick a repository");
export const FIX_WORKING: string = translationKey(
  "OneUptime AI is working on it.",
);
export const FIX_VIEW_TASK: string = translationKey("View the task");
export const FIX_COULD_NOT_START: string = translationKey(
  "Could not start the fix: {{reason}}",
);
// A repository on any host Code connects, as the trace strip says it.
export const FIX_CONNECT_REPOSITORY: string = translationKey(
  "Connect a repository to fix this with AI",
);
