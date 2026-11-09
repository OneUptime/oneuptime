import { ComponentArgumentSection } from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import { DashboardProfileTopFunctionsRank } from "../../../Types/Dashboard/DashboardComponents/DashboardProfileTopFunctionsComponent";
import ObjectID from "../../../Types/ObjectID";
import { translationKey } from "../../../Types/Translator";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { ProfileCategory } from "../../Profiles/ProfileTypes";

/*
 * WHAT A PROFILE WIDGET READS, AND HOW ITS SETTINGS SAY IT.
 *
 * Shared by the dashboard's two profile widgets, the Flame Graph and Top
 * Functions. Both read what the Profiler reads - one service's profiles
 * (or every profiled service's), of one kind, over the dashboard's time
 * range - so both settle a stored setting the same way here: a kind,
 * ranking or row count this version does not know reads as its default,
 * never as a request the server would refuse.
 *
 * The kinds and the rankings are offered in the Profiler's own words (its
 * kind picker and its Self / Total / Your code switch), so a reader meets
 * one vocabulary on the tile, in its settings and one click later in the
 * Profiler. App's ProfileWidgetData suite holds these to the Profiler's.
 *
 * Every word here is marked as a key: the Dashboard's string extractor
 * reads this file, and the settings dialog draws each in the reader's
 * language.
 */

/*
 * The kinds a widget can read, in the order the Profiler offers them.
 * "Other" is left out: it names no unit, and its raw types are picked one
 * by one on the Profiler.
 */
export const PROFILE_WIDGET_KINDS: ReadonlyArray<ProfileCategory> = [
  ProfileCategory.Cpu,
  ProfileCategory.Wall,
  ProfileCategory.Memory,
  ProfileCategory.Allocations,
  ProfileCategory.Locks,
  ProfileCategory.Goroutines,
];

// The kind a widget reads until its settings say otherwise.
export const PROFILE_WIDGET_DEFAULT_KIND: ProfileCategory = ProfileCategory.Cpu;

export const PROFILE_WIDGET_KIND_OPTIONS: ReadonlyArray<DropdownOption> = [
  {
    value: ProfileCategory.Cpu,
    label: translationKey("CPU time"),
    description: translationKey("Where the processor time goes"),
  },
  {
    value: ProfileCategory.Wall,
    label: translationKey("Wall time"),
    description: translationKey("Where the time goes, waiting included"),
  },
  {
    value: ProfileCategory.Memory,
    label: translationKey("Memory"),
    description: translationKey("What holds memory right now"),
  },
  {
    value: ProfileCategory.Allocations,
    label: translationKey("Allocations"),
    description: translationKey(
      "What allocates memory, and keeps the garbage collector busy",
    ),
  },
  {
    value: ProfileCategory.Locks,
    label: translationKey("Locks"),
    description: translationKey("Where code waits on a lock"),
  },
  {
    value: ProfileCategory.Goroutines,
    label: translationKey("Goroutines"),
    description: translationKey("Where the goroutines are waiting"),
  },
];

export const PROFILE_WIDGET_RANKS: ReadonlyArray<DashboardProfileTopFunctionsRank> =
  ["self", "total", "own"];

export const PROFILE_WIDGET_DEFAULT_RANK: DashboardProfileTopFunctionsRank =
  "self";

export const PROFILE_WIDGET_RANK_OPTIONS: ReadonlyArray<DropdownOption> = [
  {
    value: "self",
    label: translationKey("Self"),
    description: translationKey("Only the function's own code."),
  },
  {
    value: "total",
    label: translationKey("Total"),
    description: translationKey("The function and everything it calls."),
  },
  {
    value: "own",
    label: translationKey("Your code"),
    description: translationKey(
      "Your own functions, each with the library and runtime code it calls: what a change to it can win back.",
    ),
  },
];

// How many functions Top Functions lists, and the most it lists.
export const PROFILE_WIDGET_DEFAULT_ROWS: number = 10;
export const PROFILE_WIDGET_MAX_ROWS: number = 50;

export const PROFILE_WIDGET_DATA_SECTION: ComponentArgumentSection = {
  name: translationKey("Data Source"),
  description: translationKey(
    "Whose profiles to read, and what to analyze in them",
  ),
  order: 1,
};

export const PROFILE_WIDGET_DISPLAY_SECTION: ComponentArgumentSection = {
  name: translationKey("Display Options"),
  description: translationKey("The title shown above the widget"),
  order: 2,
};

// The settings both widgets share, in their words.
export const PROFILE_WIDGET_SERVICE_NAME: string = translationKey("Service");
export const PROFILE_WIDGET_SERVICE_DESCRIPTION: string = translationKey(
  "One service, or All services. With All services, the widget follows the dashboard's service variable when one is picked.",
);
export const PROFILE_WIDGET_KIND_NAME: string =
  translationKey("What to analyze");
export const PROFILE_WIDGET_KIND_DESCRIPTION: string = translationKey(
  "The kind of profile this widget reads.",
);
export const PROFILE_WIDGET_TITLE_NAME: string = translationKey("Title");
export const PROFILE_WIDGET_TITLE_DESCRIPTION: string = translationKey(
  "Leave it empty for a title that says what the widget shows.",
);
export const PROFILE_WIDGET_RANK_NAME: string = translationKey("Rank by");
export const PROFILE_WIDGET_RANK_DESCRIPTION: string = translationKey(
  "How the functions are ranked.",
);
export const PROFILE_WIDGET_ROWS_NAME: string = translationKey("Rows");
export const PROFILE_WIDGET_ROWS_DESCRIPTION: string = translationKey(
  "How many functions to list, up to 50.",
);

function isOneOf<T extends string>(
  value: unknown,
  choices: ReadonlyArray<T>,
): value is T {
  return (
    typeof value === "string" && (choices as ReadonlyArray<string>).includes(value)
  );
}

/*
 * The kind a stored setting names, read as the Profiler reads its address:
 * one of the kinds above, matched without regard to case or spaces, and
 * CPU time for anything else - nothing, a raw type, a misspelling.
 */
export function readProfileWidgetKind(value: unknown): ProfileCategory {
  const normalized: unknown =
    typeof value === "string" ? value.trim().toLowerCase() : value;

  return isOneOf(normalized, PROFILE_WIDGET_KINDS)
    ? normalized
    : PROFILE_WIDGET_DEFAULT_KIND;
}

// The ranking a stored setting names, by Self for anything else.
export function readProfileWidgetRank(
  value: unknown,
): DashboardProfileTopFunctionsRank {
  const normalized: unknown =
    typeof value === "string" ? value.trim().toLowerCase() : value;

  return isOneOf(normalized, PROFILE_WIDGET_RANKS)
    ? normalized
    : PROFILE_WIDGET_DEFAULT_RANK;
}

/*
 * How many functions to list: a whole number from 1 to 50, as a number or
 * as the text a form or the API wrote it as ("25"). Nothing, zero or text
 * that is no number reads as 10; more than 50 reads as 50.
 */
export function readProfileWidgetRows(value: unknown): number {
  const parsed: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value.trim())
        : NaN;

  if (!Number.isFinite(parsed) || parsed < 1) {
    return PROFILE_WIDGET_DEFAULT_ROWS;
  }

  return Math.min(PROFILE_WIDGET_MAX_ROWS, Math.floor(parsed));
}

/*
 * The service a widget is pinned to, or null for every service: a stored
 * id that is not one (an empty string, a name typed through the API) pins
 * nothing, so the widget reads every service rather than a request the
 * server refuses with "Invalid ID".
 */
export function readProfileWidgetServiceId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const id: string = value.trim();

  return id.length > 0 && ObjectID.isValidUUID(id) ? id : null;
}
