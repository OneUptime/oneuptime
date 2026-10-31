import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import TelemetryExceptionActivity, {
  TelemetryExceptionActivityType,
} from "Common/Models/DatabaseModels/TelemetryExceptionActivity";
import Select from "Common/Types/BaseDatabase/Select";
import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * AN EXCEPTION'S ACTIVITY, AS THE TIMELINE ON ITS PAGE SAYS IT.
 *
 * Each entry (TelemetryExceptionActivity) is a fact - who, what, when, and
 * the person, team, release or other exception it names - and this turns it
 * into one sentence of the reader's language: "Priya Raman resolved this
 * exception", "OneUptime: it came back in v1.4.1, after it was resolved".
 * The sentence's names are slots (TranslatedSentence), so a language puts
 * them where its grammar does. The timeline ends with when the exception was
 * first seen, which is no entry: it is the exception's own first seen.
 */

// What the timeline reads of each entry.
export const EXCEPTION_ACTIVITY_SELECT: Select<TelemetryExceptionActivity> = {
  _id: true,
  activityType: true,
  createdAt: true,
  apiKeyName: true,
  release: true,
  userId: true,
  user: { _id: true, name: true, email: true },
  assigneeUserId: true,
  assigneeUser: { _id: true, name: true, email: true },
  assigneeTeamId: true,
  assigneeTeam: { _id: true, name: true },
  relatedTelemetryExceptionId: true,
  relatedTelemetryException: { _id: true, exceptionType: true, message: true },
} as Select<TelemetryExceptionActivity>;

// The most entries the timeline reads; the newest of them are shown first.
export const EXCEPTION_ACTIVITY_LIMIT: number = 100;

// Shown before "Show all": the newest few.
export const EXCEPTION_ACTIVITY_FOLDED_COUNT: number = 5;

export type ExceptionActivityTone =
  | "green"
  | "red"
  | "amber"
  | "indigo"
  | "gray";

export const EXCEPTION_ACTIVITY_TEMPLATES: Record<
  TelemetryExceptionActivityType,
  string
> = {
  [TelemetryExceptionActivityType.Resolved]: translationKey(
    "{{actor}} resolved this exception",
  ),
  [TelemetryExceptionActivityType.ResolvedInNextRelease]: translationKey(
    "{{actor}} resolved this exception in the next release, after {{release}}",
  ),
  [TelemetryExceptionActivityType.Reopened]: translationKey(
    "{{actor}} reopened this exception",
  ),
  [TelemetryExceptionActivityType.Regressed]: translationKey(
    "It came back after it was resolved",
  ),
  [TelemetryExceptionActivityType.Archived]: translationKey(
    "{{actor}} archived this exception",
  ),
  [TelemetryExceptionActivityType.Unarchived]: translationKey(
    "{{actor}} unarchived this exception",
  ),
  [TelemetryExceptionActivityType.Assigned]: translationKey(
    "{{actor}} assigned this exception to {{assignee}}",
  ),
  [TelemetryExceptionActivityType.Unassigned]: translationKey(
    "{{actor}} unassigned this exception from {{assignee}}",
  ),
  [TelemetryExceptionActivityType.Merged]: translationKey(
    "{{actor}} merged {{exception}} into this exception",
  ),
  [TelemetryExceptionActivityType.MergedInto]: translationKey(
    "{{actor}} merged this exception into {{exception}}",
  ),
  [TelemetryExceptionActivityType.Unmerged]: translationKey(
    "{{actor}} unmerged {{exception}} from this exception",
  ),
  [TelemetryExceptionActivityType.UnmergedFrom]: translationKey(
    "{{actor}} unmerged this exception from {{exception}}",
  ),
};

// A regression whose occurrence named its release.
export const REGRESSED_IN_RELEASE_TEMPLATE: string = translationKey(
  "It came back in {{release}}, after it was resolved",
);

export const FIRST_SEEN_TEMPLATE: string = translationKey("First seen");
export const FIRST_SEEN_IN_RELEASE_TEMPLATE: string = translationKey(
  "First seen in {{release}}",
);

// Who did it when no person did: an API key, or OneUptime itself.
export const API_KEY_ACTOR_TEMPLATE: string =
  translationKey("{{name}} (API key)");
export const ONEUPTIME_ACTOR: string = "OneUptime";
// A person or team that is no longer there.
export const SOMEONE: string = translationKey("someone");
export const ANOTHER_EXCEPTION: string = translationKey("another exception");

// The longest name of another exception the timeline writes out.
export const RELATED_EXCEPTION_NAME_MAX_LENGTH: number = 120;

export interface ExceptionActivityActor {
  // A person's name or email; an API key's name. Null: OneUptime.
  name: string | null;
  isApiKey: boolean;
}

export interface ExceptionActivityLine {
  key: string;
  activityType: TelemetryExceptionActivityType;
  icon: IconProp;
  tone: ExceptionActivityTone;
  template: string;
  actor: ExceptionActivityActor;
  // Assigned / Unassigned: the person or team. Null: no longer there.
  assigneeName: string | null;
  // Merges: the other exception, linked. Null: no longer there.
  relatedException: { id: string; name: string } | null;
  release: string | null;
  at: Date | null;
}

const LOOK: Record<
  TelemetryExceptionActivityType,
  { icon: IconProp; tone: ExceptionActivityTone }
> = {
  [TelemetryExceptionActivityType.Resolved]: {
    icon: IconProp.CheckCircle,
    tone: "green",
  },
  [TelemetryExceptionActivityType.ResolvedInNextRelease]: {
    icon: IconProp.CheckCircle,
    tone: "green",
  },
  [TelemetryExceptionActivityType.Reopened]: {
    icon: IconProp.Refresh,
    tone: "amber",
  },
  [TelemetryExceptionActivityType.Regressed]: {
    icon: IconProp.Alert,
    tone: "red",
  },
  [TelemetryExceptionActivityType.Archived]: {
    icon: IconProp.Archive,
    tone: "gray",
  },
  [TelemetryExceptionActivityType.Unarchived]: {
    icon: IconProp.Unarchive,
    tone: "gray",
  },
  [TelemetryExceptionActivityType.Assigned]: {
    icon: IconProp.UserPlus,
    tone: "indigo",
  },
  [TelemetryExceptionActivityType.Unassigned]: {
    icon: IconProp.UserMinus,
    tone: "gray",
  },
  [TelemetryExceptionActivityType.Merged]: {
    icon: IconProp.Link,
    tone: "indigo",
  },
  [TelemetryExceptionActivityType.MergedInto]: {
    icon: IconProp.Link,
    tone: "indigo",
  },
  [TelemetryExceptionActivityType.Unmerged]: {
    icon: IconProp.ArrowUturnLeft,
    tone: "gray",
  },
  [TelemetryExceptionActivityType.UnmergedFrom]: {
    icon: IconProp.ArrowUturnLeft,
    tone: "gray",
  },
};

// The rail's colours, by tone.
export const EXCEPTION_ACTIVITY_TONE_CLASS_NAMES: Record<
  ExceptionActivityTone,
  string
> = {
  green: "bg-emerald-50 text-emerald-600",
  red: "bg-red-50 text-red-600",
  amber: "bg-amber-50 text-amber-600",
  indigo: "bg-indigo-50 text-indigo-600",
  gray: "bg-gray-100 text-gray-500",
};

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  const date: Date = value instanceof Date ? value : new Date(value as string);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function isExceptionActivityType(
  value: unknown,
): value is TelemetryExceptionActivityType {
  return (
    typeof value === "string" &&
    (Object.values(TelemetryExceptionActivityType) as Array<string>).includes(
      value,
    )
  );
}

// "TypeError: x is undefined", the first line, cut to a length a line holds.
export function getRelatedExceptionName(
  exception: TelemetryException | null | undefined,
): string | null {
  if (!exception) {
    return null;
  }

  const type: string = readText(exception.exceptionType);
  const message: string = readText(
    (readText(exception.message).split("\n")[0] || "").slice(
      0,
      RELATED_EXCEPTION_NAME_MAX_LENGTH * 2,
    ),
  );
  const name: string =
    type && message ? `${type}: ${message}` : type || message;

  if (!name) {
    return null;
  }

  return name.length > RELATED_EXCEPTION_NAME_MAX_LENGTH
    ? `${name.slice(0, RELATED_EXCEPTION_NAME_MAX_LENGTH - 1).trimEnd()}…`
    : name;
}

export function getExceptionActivityActor(
  entry: TelemetryExceptionActivity,
): ExceptionActivityActor {
  const userName: string =
    readText(entry.user?.name?.toString()) ||
    readText(entry.user?.email?.toString());

  if (userName) {
    return { name: userName, isApiKey: false };
  }

  const apiKeyName: string = readText(entry.apiKeyName);

  if (apiKeyName) {
    return { name: apiKeyName, isApiKey: true };
  }

  return { name: null, isApiKey: false };
}

/*
 * One entry as the timeline draws it, or null for an entry of a kind this
 * Dashboard does not know (a newer server's): left out, never guessed at.
 */
export function getExceptionActivityLine(
  entry: TelemetryExceptionActivity,
): ExceptionActivityLine | null {
  const activityType: unknown = entry.activityType;

  if (!isExceptionActivityType(activityType)) {
    return null;
  }

  const release: string | null = readText(entry.release) || null;
  const relatedId: string =
    entry.relatedTelemetryExceptionId?.toString() ||
    entry.relatedTelemetryException?.id?.toString() ||
    "";
  const relatedName: string | null = getRelatedExceptionName(
    entry.relatedTelemetryException,
  );

  const assigneeName: string | null =
    readText(entry.assigneeUser?.name?.toString()) ||
    readText(entry.assigneeUser?.email?.toString()) ||
    readText(entry.assigneeTeam?.name) ||
    null;

  return {
    key: entry.id?.toString() || `${activityType}-${entry.createdAt}`,
    activityType,
    icon: LOOK[activityType].icon,
    tone: LOOK[activityType].tone,
    template:
      activityType === TelemetryExceptionActivityType.Regressed && release
        ? REGRESSED_IN_RELEASE_TEMPLATE
        : EXCEPTION_ACTIVITY_TEMPLATES[activityType],
    actor: getExceptionActivityActor(entry),
    assigneeName,
    relatedException: relatedId
      ? { id: relatedId, name: relatedName || "" }
      : null,
    release,
    at: toDate(entry.createdAt),
  };
}

/*
 * The timeline's lines, newest first, entries of kinds this Dashboard does
 * not know left out.
 */
export function getExceptionActivityLines(
  entries: ReadonlyArray<TelemetryExceptionActivity>,
): Array<ExceptionActivityLine> {
  return entries
    .map(getExceptionActivityLine)
    .filter(
      (line: ExceptionActivityLine | null): line is ExceptionActivityLine => {
        return line !== null;
      },
    )
    .sort((a: ExceptionActivityLine, b: ExceptionActivityLine): number => {
      return (b.at?.getTime() || 0) - (a.at?.getTime() || 0);
    });
}
