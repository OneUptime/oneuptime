/*
 * What a Process Activity event (OCSF class 1007) says was done to its
 * process: launched, ended, opened, injected into, or something else.
 *
 * OCSF names it by `activity_id` and `activity_name`; Google SecOps' UDM by
 * its event type (PROCESS_LAUNCH, PROCESS_OPEN, ...), which the UDM
 * normalizer reads in as these names. The process fields are read by it -
 * in a launch the process that acted is the parent of the one launched,
 * in any other activity some other process (OcsfNormalizer) - and a
 * destination sends the event as the activity it is (GoogleSecOpsUdmMapper),
 * so all of them read an event's activity by the one rule below.
 *
 * https://schema.ocsf.io/classes/process_activity
 */

export const OCSF_PROCESS_ACTIVITY_CLASS_UID: number = 1007;

export enum OcsfProcessActivityId {
  Unknown = 0,
  Launch = 1,
  Terminate = 2,
  Open = 3,
  Inject = 4,
  SetUserId = 5,
  Other = 99,
}

// Each activity id as OCSF captions it, which is what activity_name holds.
export const OCSF_PROCESS_ACTIVITY_NAMES: Readonly<
  Record<OcsfProcessActivityId, string>
> = {
  [OcsfProcessActivityId.Unknown]: "Unknown",
  [OcsfProcessActivityId.Launch]: "Launch",
  [OcsfProcessActivityId.Terminate]: "Terminate",
  [OcsfProcessActivityId.Open]: "Open",
  [OcsfProcessActivityId.Inject]: "Inject",
  [OcsfProcessActivityId.SetUserId]: "Set User ID",
  [OcsfProcessActivityId.Other]: "Other",
};

function isProcessActivityId(value: number): value is OcsfProcessActivityId {
  return Object.prototype.hasOwnProperty.call(
    OCSF_PROCESS_ACTIVITY_NAMES,
    value,
  );
}

/*
 * The name of a Process Activity's activity id, for an event that gives
 * only the id; "" for an id OCSF does not define.
 */
export function ocsfProcessActivityName(
  activityId: number | null | undefined,
): string {
  if (
    activityId === null ||
    activityId === undefined ||
    !Number.isInteger(activityId) ||
    !isProcessActivityId(activityId)
  ) {
    return "";
  }

  return OCSF_PROCESS_ACTIVITY_NAMES[activityId];
}

/*
 * The kinds of process activity told apart downstream. Privilege
 * Escalation is UDM's own (PROCESS_PRIVILEGE_ESCALATION, read in under that
 * name); OCSF's Set User ID, Unknown and Other, and any name not listed
 * here, are Other.
 */
export enum ProcessActivityKind {
  Launch = "Launch",
  Terminate = "Terminate",
  Open = "Open",
  Inject = "Inject",
  PrivilegeEscalation = "PrivilegeEscalation",
  Other = "Other",
}

const KIND_BY_ID: Readonly<Record<OcsfProcessActivityId, ProcessActivityKind>> =
  {
    [OcsfProcessActivityId.Unknown]: ProcessActivityKind.Other,
    [OcsfProcessActivityId.Launch]: ProcessActivityKind.Launch,
    [OcsfProcessActivityId.Terminate]: ProcessActivityKind.Terminate,
    [OcsfProcessActivityId.Open]: ProcessActivityKind.Open,
    [OcsfProcessActivityId.Inject]: ProcessActivityKind.Inject,
    [OcsfProcessActivityId.SetUserId]: ProcessActivityKind.Other,
    [OcsfProcessActivityId.Other]: ProcessActivityKind.Other,
  };

/*
 * A Map, not an object: the name is the source's text, and an object would
 * answer "constructor" or "toString" with what every object inherits.
 */
const KIND_BY_NAME: ReadonlyMap<string, ProcessActivityKind> = new Map<
  string,
  ProcessActivityKind
>([
  ["launch", ProcessActivityKind.Launch],
  ["terminate", ProcessActivityKind.Terminate],
  ["open", ProcessActivityKind.Open],
  ["inject", ProcessActivityKind.Inject],
  ["privilege escalation", ProcessActivityKind.PrivilegeEscalation],
]);

/*
 * The kind of a process activity, from what its event says: its activity
 * id when it gives one (the id wins over the name, as OCSF has it), else
 * its activity name. An event that names no activity at all is a launch,
 * which is what nearly every process event is.
 */
export function getProcessActivityKind(data: {
  activityId?: number | null | undefined;
  activityName?: string | null | undefined;
}): ProcessActivityKind {
  const activityId: number | null | undefined = data.activityId;

  if (activityId !== null && activityId !== undefined) {
    return Number.isInteger(activityId) && isProcessActivityId(activityId)
      ? KIND_BY_ID[activityId]
      : ProcessActivityKind.Other;
  }

  const name: string = (data.activityName || "").trim().toLowerCase();

  if (!name) {
    return ProcessActivityKind.Launch;
  }

  return KIND_BY_NAME.get(name) || ProcessActivityKind.Other;
}

/*
 * An activity id as a stored event keeps it: a number, or the text its
 * flattened payload holds ("3"); null when it holds none, or no number.
 * The same reading ingest gave the payload's activity_id (readNumber), so
 * a stored event is sent as the activity its process fields were read by.
 */
export function readProcessActivityId(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const text: string = value.trim();

  if (!text) {
    return null;
  }

  const parsed: number = Number(text);

  return Number.isFinite(parsed) ? parsed : null;
}
