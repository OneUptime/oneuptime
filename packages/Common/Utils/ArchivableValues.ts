/*
 * THE VALUES RECORDS PICK FROM CAN BE ARCHIVED.
 *
 * A project's incident and alert states and severities, its monitor
 * statuses, its scheduled maintenance states, its labels, its incident
 * roles, its postmortem statuses and its security case statuses and
 * priorities are values: an incident, an alert, a monitor, a maintenance
 * event or a security case picks one, and keeps pointing at it.
 * Deleting one used to be the only way
 * to retire it, and a delete reaches every record that ever picked it - the
 * state history of old incidents goes with a state, a label comes off every
 * monitor that had it, a delete is refused while incidents still point at a
 * severity. So teams renamed values they meant to retire ("[DONOTUSE] Very
 * critical") and hoped nobody picked them.
 *
 * Archiving retires a value without touching a single record:
 *
 *   - records that have it keep it, and are shown, filtered and reported on
 *     with it as before;
 *   - nobody can pick it again: every picker that sets a value on a record
 *     leaves it out, and the server refuses it on every create and update a
 *     person, an API key, Terraform or MCP makes (ArchivedValueCheck) - a
 *     record that already has it keeps it through every later edit;
 *   - OneUptime's automations - monitor criteria, rules, recurring
 *     maintenance, workflows - keep using the values they were set up with,
 *     so nothing stops opening incidents or paging the way it did. The
 *     archive dialog says what still uses a value, so it can be changed;
 *   - unarchiving puts it back, exactly as it was.
 *
 * Values OneUptime itself moves records into cannot be archived - the
 * created, acknowledged and resolved states, the operational and offline
 * statuses, the primary incident role, a security case's built-in statuses
 * and the priorities detections open cases at - and a project keeps at least one
 * severity that is not archived, because every new incident and alert needs
 * one.
 *
 * No database, no models and no React here: the server that enforces this,
 * the dashboard that shows it and the tests read the same rules.
 */

export enum ArchivableValueType {
  IncidentState = "IncidentState",
  IncidentSeverity = "IncidentSeverity",
  AlertState = "AlertState",
  AlertSeverity = "AlertSeverity",
  MonitorStatus = "MonitorStatus",
  ScheduledMaintenanceState = "ScheduledMaintenanceState",
  Label = "Label",
  IncidentRole = "IncidentRole",
  IncidentPostmortemStatus = "IncidentPostmortemStatus",
  SecurityCaseStatus = "SecurityCaseStatus",
  SecurityCasePriority = "SecurityCasePriority",
}

/*
 * A row OneUptime relies on, by the column that marks it: a row whose
 * `column` holds `value` cannot be archived, for `reason`.
 */
export interface ArchivableValueProtection {
  column: string;
  value: boolean;
  reason: string;
}

export interface ArchivableValueDefinition {
  type: ArchivableValueType;
  // The value's table, which is also its model's table name.
  tableName: string;
  // How a message names one value and several: "incident severity".
  singular: string;
  plural: string;
  // Where the value is managed, as the dashboard's menus name it.
  settingsPath: string;
  // The rows that cannot be archived, and why.
  protections: Array<ArchivableValueProtection>;
  /*
   * Set when a project must keep at least one value of this kind that is not
   * archived, and why: every new incident needs a severity.
   */
  keepsOneLiveReason?: string | undefined;
}

export const ARCHIVABLE_VALUES: Record<
  ArchivableValueType,
  ArchivableValueDefinition
> = {
  [ArchivableValueType.IncidentState]: {
    type: ArchivableValueType.IncidentState,
    tableName: "IncidentState",
    singular: "incident state",
    plural: "incident states",
    settingsPath: "Incidents > Settings > Incident State",
    protections: [
      {
        column: "isCreatedState",
        value: true,
        reason: "New incidents start in this state, so it can't be archived.",
      },
      {
        column: "isAcknowledgedState",
        value: true,
        reason:
          "Acknowledging an incident moves it to this state, so it can't be archived.",
      },
      {
        column: "isResolvedState",
        value: true,
        reason:
          "Resolving an incident moves it to this state, so it can't be archived.",
      },
    ],
  },
  [ArchivableValueType.IncidentSeverity]: {
    type: ArchivableValueType.IncidentSeverity,
    tableName: "IncidentSeverity",
    singular: "incident severity",
    plural: "incident severities",
    settingsPath: "Incidents > Settings > Incident Severity",
    protections: [],
    keepsOneLiveReason:
      "Every new incident needs a severity, so keep at least one that is not archived.",
  },
  [ArchivableValueType.AlertState]: {
    type: ArchivableValueType.AlertState,
    tableName: "AlertState",
    singular: "alert state",
    plural: "alert states",
    settingsPath: "Alerts > Settings > Alert State",
    protections: [
      {
        column: "isCreatedState",
        value: true,
        reason: "New alerts start in this state, so it can't be archived.",
      },
      {
        column: "isAcknowledgedState",
        value: true,
        reason:
          "Acknowledging an alert moves it to this state, so it can't be archived.",
      },
      {
        column: "isResolvedState",
        value: true,
        reason:
          "Resolving an alert moves it to this state, so it can't be archived.",
      },
    ],
  },
  [ArchivableValueType.AlertSeverity]: {
    type: ArchivableValueType.AlertSeverity,
    tableName: "AlertSeverity",
    singular: "alert severity",
    plural: "alert severities",
    settingsPath: "Alerts > Settings > Alert Severity",
    protections: [],
    keepsOneLiveReason:
      "Every new alert needs a severity, so keep at least one that is not archived.",
  },
  [ArchivableValueType.MonitorStatus]: {
    type: ArchivableValueType.MonitorStatus,
    tableName: "MonitorStatus",
    singular: "monitor status",
    plural: "monitor statuses",
    settingsPath: "Monitors > Settings > Monitor Status",
    protections: [
      {
        column: "isOperationalState",
        value: true,
        reason: "New monitors start in this status, so it can't be archived.",
      },
      {
        column: "isOfflineState",
        value: true,
        reason:
          "OneUptime treats a monitor in this status as down, so it can't be archived.",
      },
    ],
  },
  [ArchivableValueType.ScheduledMaintenanceState]: {
    type: ArchivableValueType.ScheduledMaintenanceState,
    tableName: "ScheduledMaintenanceState",
    singular: "scheduled maintenance state",
    plural: "scheduled maintenance states",
    settingsPath: "Scheduled Maintenance > Settings > Event State",
    protections: [
      {
        column: "isScheduledState",
        value: true,
        reason:
          "New maintenance events start in this state, so it can't be archived.",
      },
      {
        column: "isOngoingState",
        value: true,
        reason:
          "An event moves to this state when its maintenance starts, so it can't be archived.",
      },
      {
        column: "isEndedState",
        value: true,
        reason:
          "An event moves to this state when its maintenance ends, so it can't be archived.",
      },
      {
        column: "isResolvedState",
        value: true,
        reason:
          "Completing an event moves it to this state, so it can't be archived.",
      },
    ],
  },
  [ArchivableValueType.Label]: {
    type: ArchivableValueType.Label,
    tableName: "Label",
    singular: "label",
    plural: "labels",
    settingsPath: "Project Settings > Labels",
    protections: [],
  },
  [ArchivableValueType.IncidentRole]: {
    type: ArchivableValueType.IncidentRole,
    tableName: "IncidentRole",
    singular: "incident role",
    plural: "incident roles",
    settingsPath: "Incidents > Settings > Incident Roles",
    protections: [
      {
        column: "isPrimaryRole",
        value: true,
        reason:
          "Every incident needs someone in charge, so this role can't be archived.",
      },
      {
        column: "isDeleteable",
        value: false,
        reason:
          "Every incident needs someone in charge, so this role can't be archived.",
      },
    ],
  },
  [ArchivableValueType.IncidentPostmortemStatus]: {
    type: ArchivableValueType.IncidentPostmortemStatus,
    tableName: "IncidentPostmortemStatus",
    singular: "postmortem status",
    plural: "postmortem statuses",
    settingsPath: "Incidents > Settings > Postmortem Statuses",
    protections: [
      {
        column: "isNotStartedStatus",
        value: true,
        reason:
          "A new incident's postmortem starts in this status, so it can't be archived.",
      },
      {
        column: "isDraftStatus",
        value: true,
        reason:
          "Writing a postmortem moves it to this status, so it can't be archived.",
      },
      {
        column: "isCompletedStatus",
        value: true,
        reason:
          "Publishing a postmortem on a status page moves it to this status, so it can't be archived.",
      },
    ],
  },
  [ArchivableValueType.SecurityCaseStatus]: {
    type: ArchivableValueType.SecurityCaseStatus,
    tableName: "SecurityCaseStatus",
    singular: "security case status",
    plural: "security case statuses",
    settingsPath: "Security Events > Settings > Case Statuses",
    protections: [
      {
        column: "isNewStatus",
        value: true,
        reason: "New cases start in this status, so it can't be archived.",
      },
      {
        column: "isAcknowledgedStatus",
        value: true,
        reason:
          "Reopening a case moves it to this status, so it can't be archived.",
      },
      {
        column: "isContainedStatus",
        value: true,
        reason:
          "The time to contain is measured to this status, so it can't be archived.",
      },
      {
        column: "isClosedStatus",
        value: true,
        reason:
          "Closing a case moves it to this status, so it can't be archived.",
      },
    ],
  },
  [ArchivableValueType.SecurityCasePriority]: {
    type: ArchivableValueType.SecurityCasePriority,
    tableName: "SecurityCasePriority",
    singular: "security case priority",
    plural: "security case priorities",
    settingsPath: "Security Events > Settings > Case Priorities",
    protections: [
      {
        column: "isCriticalPriority",
        value: true,
        reason:
          "Critical detections open their cases at this priority, so it can't be archived.",
      },
      {
        column: "isHighPriority",
        value: true,
        reason:
          "High detections open their cases at this priority, so it can't be archived.",
      },
      {
        column: "isMediumPriority",
        value: true,
        reason:
          "Medium detections and the cases people open start at this priority, so it can't be archived.",
      },
      {
        column: "isLowPriority",
        value: true,
        reason:
          "Low detections open their cases at this priority, so it can't be archived.",
      },
      {
        column: "isInformationalPriority",
        value: true,
        reason:
          "Informational detections open their cases at this priority, so it can't be archived.",
      },
    ],
  },
};

// Every archivable value, in the order above.
export const ARCHIVABLE_VALUE_DEFINITIONS: Array<ArchivableValueDefinition> =
  Object.values(ARCHIVABLE_VALUES);

// The tables of every archivable value.
export const ARCHIVABLE_VALUE_TABLE_NAMES: Array<string> =
  ARCHIVABLE_VALUE_DEFINITIONS.map(
    (definition: ArchivableValueDefinition): string => {
      return definition.tableName;
    },
  );

// The switch, and the who and when the server stamps from it.
export const ARCHIVED_COLUMN: string = "isArchived";
export const ARCHIVED_AT_COLUMN: string = "archivedAt";
export const ARCHIVED_BY_USER_ID_COLUMN: string = "archivedByUserId";

/** The archivable value a table holds, or null for any other table. */
export const getArchivableValueByTableName: (
  tableName: string | null | undefined,
) => ArchivableValueDefinition | null = (
  tableName: string | null | undefined,
): ArchivableValueDefinition | null => {
  if (!tableName) {
    return null;
  }

  return (
    ARCHIVABLE_VALUE_DEFINITIONS.find(
      (definition: ArchivableValueDefinition): boolean => {
        return definition.tableName === tableName;
      },
    ) || null
  );
};

/** Whether a table holds values that can be archived. */
export const isArchivableValueTable: (
  tableName: string | null | undefined,
) => boolean = (tableName: string | null | undefined): boolean => {
  return getArchivableValueByTableName(tableName) !== null;
};

/*
 * The columns a check of the protections reads, beside the archive switch:
 * what decides whether a row can be archived.
 */
export const getArchivableValueProtectionColumns: (
  definition: ArchivableValueDefinition,
) => Array<string> = (definition: ArchivableValueDefinition): Array<string> => {
  const columns: Array<string> = [];

  for (const protection of definition.protections) {
    if (!columns.includes(protection.column)) {
      columns.push(protection.column);
    }
  }

  return columns;
};

/*
 * A column of a row, a model or its JSON: both hold each column as a
 * property of their own. Never through a model's getColumnValue, which
 * reads a false as null - a role's isDeleteable: false would never match.
 */
const readColumn: (row: unknown, column: string) => unknown = (
  row: unknown,
  column: string,
): unknown => {
  if (!row || typeof row !== "object") {
    return undefined;
  }

  return (row as Record<string, unknown>)[column];
};

/** Whether a row (a model or its JSON) is archived. */
export const isArchivedValue: (row: unknown) => boolean = (
  row: unknown,
): boolean => {
  return readColumn(row, ARCHIVED_COLUMN) === true;
};

/*
 * Why this row can never be archived - it is one OneUptime moves records
 * into - or null for a row that can be. A protection on a boolean column
 * matches only a value the row really holds: a row read without the column
 * is not protected by it.
 */
export const getArchiveProtectionReason: (data: {
  definition: ArchivableValueDefinition;
  row: unknown;
}) => string | null = (data: {
  definition: ArchivableValueDefinition;
  row: unknown;
}): string | null => {
  for (const protection of data.definition.protections) {
    if (readColumn(data.row, protection.column) === protection.value) {
      return protection.reason;
    }
  }

  return null;
};

/*
 * Why archiving these rows is refused, or null when it is not: a protected
 * row among them, or - for a kind a project keeps one of - no value left
 * that is not archived once they are. `liveIds` are the ids of the rows of
 * the project that are not archived now, these among them.
 */
export const getArchiveRefusal: (data: {
  definition: ArchivableValueDefinition;
  rowsToArchive: Array<unknown>;
  liveIds: Array<string>;
  getRowId: (row: unknown) => string;
}) => string | null = (data: {
  definition: ArchivableValueDefinition;
  rowsToArchive: Array<unknown>;
  liveIds: Array<string>;
  getRowId: (row: unknown) => string;
}): string | null => {
  for (const row of data.rowsToArchive) {
    const reason: string | null = getArchiveProtectionReason({
      definition: data.definition,
      row: row,
    });

    if (reason) {
      const name: unknown = readColumn(row, "name");

      return typeof name === "string" && name.trim()
        ? `"${name.trim()}": ${reason}`
        : reason;
    }
  }

  if (!data.definition.keepsOneLiveReason) {
    return null;
  }

  const archiving: Set<string> = new Set<string>(
    data.rowsToArchive.map((row: unknown): string => {
      return data.getRowId(row).toLowerCase();
    }),
  );

  const liveLeft: Array<string> = data.liveIds.filter((id: string): boolean => {
    return !archiving.has(id.toLowerCase());
  });

  return liveLeft.length === 0 ? data.definition.keepsOneLiveReason : null;
};

const quote: (name: string) => string = (name: string): string => {
  return `"${name}"`;
};

const joinNames: (names: Array<string>) => string = (
  names: Array<string>,
): string => {
  const quoted: Array<string> = names.map(quote);

  if (quoted.length <= 1) {
    return quoted.join("");
  }

  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
};

/*
 * Why a write that picks archived values is refused, for one kind of value:
 * which values, and the two ways on - pick another, or unarchive it.
 */
export const getArchivedValueRefusalSentence: (data: {
  definition: ArchivableValueDefinition;
  names: Array<string>;
}) => string = (data: {
  definition: ArchivableValueDefinition;
  names: Array<string>;
}): string => {
  const names: Array<string> = Array.from(
    new Set(
      data.names.map((name: string): string => {
        return name.trim();
      }),
    ),
  ).filter((name: string): boolean => {
    return name.length > 0;
  });

  if (names.length <= 1) {
    const subject: string = names[0]
      ? `${quote(names[0])} is an archived ${data.definition.singular}`
      : `This ${data.definition.singular} is archived`;

    return `${subject} and can't be picked. Choose another, or unarchive it in ${data.definition.settingsPath}.`;
  }

  return `${joinNames(names)} are archived ${data.definition.plural} and can't be picked. Choose others, or unarchive them in ${data.definition.settingsPath}.`;
};
