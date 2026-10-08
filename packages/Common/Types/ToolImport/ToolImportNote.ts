/*
 * Something the preview or the report tells a person about one item, or
 * about the whole import: why it is skipped, what it is matched to, what
 * will not come over exactly as it was in the other tool.
 *
 * A note is a code and the values its sentence needs, never the sentence:
 * the page words each code in the reader's language
 * (Dashboard Components/ToolImport/ToolImportText). The values are data -
 * names, emails, dates, numbers - or one of the tokens the page translates
 * itself (a ToolImportResourceKind under `kind`). A code's values never
 * change once shipped, because stored reports keep them.
 */
export enum ToolImportNoteCode {
  // ---- Why an item is skipped.
  PersonNoEmail = "PersonNoEmail",
  PersonDeactivated = "PersonDeactivated",
  PersonNotInvited = "PersonNotInvited",
  NoPermission = "NoPermission",
  NeedsPlan = "NeedsPlan",
  OverLimit = "OverLimit",
  NothingToPage = "NothingToPage",
  PolicyTemplated = "PolicyTemplated",
  StateNotNeeded = "StateNotNeeded",
  RoleReporter = "RoleReporter",
  CustomFieldFromCatalog = "CustomFieldFromCatalog",
  CustomFieldTypeNotSupported = "CustomFieldTypeNotSupported",
  NotSelected = "NotSelected",
  StoppedPartWay = "StoppedPartWay",

  // ---- Why an item is matched to a record that is already in OneUptime.
  PersonAlreadyMember = "PersonAlreadyMember",
  NameExists = "NameExists",
  TeamNameExists = "TeamNameExists",
  AlreadyImported = "AlreadyImported",
  StateMatchedToCreated = "StateMatchedToCreated",
  StateMatchedToResolved = "StateMatchedToResolved",
  RoleMatchedToPrimary = "RoleMatchedToPrimary",

  // ---- What does not come over exactly as it was.
  ImportedBeforeDeletedSince = "ImportedBeforeDeletedSince",
  TurnedOffInSource = "TurnedOffInSource",
  NotOnAnything = "NotOnAnything",
  ScheduleSplit = "ScheduleSplit",
  TimezoneUnknown = "TimezoneUnknown",
  RotationEnded = "RotationEnded",
  RotationEnds = "RotationEnds",
  RotationNotStarted = "RotationNotStarted",
  RotationGaps = "RotationGaps",
  RotationNonPersonTurns = "RotationNonPersonTurns",
  RotationUnevenShifts = "RotationUnevenShifts",
  RotationScheduledChange = "RotationScheduledChange",
  RotationLayers = "RotationLayers",
  RotationNobody = "RotationNobody",
  PolicyFirstStepWaits = "PolicyFirstStepWaits",
  PolicyWaitsForClose = "PolicyWaitsForClose",
  PolicyNextOnCall = "PolicyNextOnCall",
  PolicyTeamAdmins = "PolicyTeamAdmins",
  PolicyBranch = "PolicyBranch",
  PolicyChannelStep = "PolicyChannelStep",
  PolicyHandsOver = "PolicyHandsOver",
  PolicyRoundRobin = "PolicyRoundRobin",
  PolicyLevelRepeats = "PolicyLevelRepeats",
  PolicyWorkingHours = "PolicyWorkingHours",
  PolicyRepeatsFromLater = "PolicyRepeatsFromLater",
  PolicyFreePlanOneLevel = "PolicyFreePlanOneLevel",
  PolicyLevelLeftOut = "PolicyLevelLeftOut",
  PolicyUnknownTarget = "PolicyUnknownTarget",
  PersonLeftOut = "PersonLeftOut",
  TeamLeftOut = "TeamLeftOut",
  ScheduleLeftOut = "ScheduleLeftOut",
  CustomFieldOptionsTrimmed = "CustomFieldOptionsTrimmed",
  PartNotAdded = "PartNotAdded",

  // ---- About the whole read.
  CouldNotRead = "CouldNotRead",
  ReadIncomplete = "ReadIncomplete",
  ReadLimitReached = "ReadLimitReached",
}

export type ToolImportNoteValue = string | number;

export interface ToolImportNote {
  code: ToolImportNoteCode;
  values?: Record<string, ToolImportNoteValue> | undefined;
}

export function makeToolImportNote(
  code: ToolImportNoteCode,
  values?: Record<string, ToolImportNoteValue> | undefined,
): ToolImportNote {
  return values && Object.keys(values).length > 0
    ? { code: code, values: values }
    : { code: code };
}

export function isToolImportNoteCode(
  value: unknown,
): value is ToolImportNoteCode {
  return (
    typeof value === "string" &&
    (Object.values(ToolImportNoteCode) as Array<string>).includes(value)
  );
}

/*
 * A note read back from a stored plan or report, or from a response. Notes
 * are written by OneUptime, but a stored row outlives the code that wrote
 * it, so a note whose code this build does not know, or whose values are
 * not plain strings and numbers, is dropped rather than shown half-worded.
 */
export function readToolImportNotes(value: unknown): Array<ToolImportNote> {
  if (!Array.isArray(value)) {
    return [];
  }

  const notes: Array<ToolImportNote> = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const code: unknown = (entry as Record<string, unknown>)["code"];

    if (!isToolImportNoteCode(code)) {
      continue;
    }

    const rawValues: unknown = (entry as Record<string, unknown>)["values"];
    const values: Record<string, ToolImportNoteValue> = {};

    if (
      rawValues &&
      typeof rawValues === "object" &&
      !Array.isArray(rawValues)
    ) {
      for (const [key, item] of Object.entries(
        rawValues as Record<string, unknown>,
      )) {
        if (typeof item === "string" || typeof item === "number") {
          values[key] = item;
        }
      }
    }

    notes.push(makeToolImportNote(code, values));
  }

  return notes;
}
