import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../Models/DatabaseModels/AlertState";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentPostmortemStatus from "../../Models/DatabaseModels/IncidentPostmortemStatus";
import IncidentRole from "../../Models/DatabaseModels/IncidentRole";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import Label from "../../Models/DatabaseModels/Label";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "../../Models/DatabaseModels/ScheduledMaintenanceState";
import SecurityCasePriority from "../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../Models/DatabaseModels/SecurityCaseStatus";
import TableColumnType from "../../Types/Database/TableColumnType";
import {
  ARCHIVABLE_VALUES,
  ARCHIVABLE_VALUE_DEFINITIONS,
  ARCHIVABLE_VALUE_TABLE_NAMES,
  ARCHIVED_AT_COLUMN,
  ARCHIVED_BY_USER_ID_COLUMN,
  ARCHIVED_COLUMN,
  ArchivableValueDefinition,
  ArchivableValueProtection,
  ArchivableValueType,
  getArchivableValueByTableName,
  getArchivableValueProtectionColumns,
  getArchiveProtectionReason,
  getArchiveRefusal,
  getArchivedValueRefusalSentence,
  isArchivableValueTable,
  isArchivedValue,
} from "../../Utils/ArchivableValues";
import { STATE_LISTS, StateListType } from "../../Utils/StateOrder";
import { describe, expect, test } from "@jest/globals";

/*
 * The values records pick from, and the rules of archiving them
 * (Common/Utils/ArchivableValues): which tables hold them, the rows
 * OneUptime relies on and never lets go archived, the one kind a project
 * keeps a live value of, and the sentences the server and the dashboard
 * say. Pure functions: no database.
 */

type ModelType = { new (): BaseModel };

const MODEL_BY_TYPE: Record<ArchivableValueType, ModelType> = {
  [ArchivableValueType.IncidentState]: IncidentState,
  [ArchivableValueType.IncidentSeverity]: IncidentSeverity,
  [ArchivableValueType.AlertState]: AlertState,
  [ArchivableValueType.AlertSeverity]: AlertSeverity,
  [ArchivableValueType.MonitorStatus]: MonitorStatus,
  [ArchivableValueType.ScheduledMaintenanceState]: ScheduledMaintenanceState,
  [ArchivableValueType.Label]: Label,
  [ArchivableValueType.IncidentRole]: IncidentRole,
  [ArchivableValueType.IncidentPostmortemStatus]: IncidentPostmortemStatus,
  [ArchivableValueType.SecurityCaseStatus]: SecurityCaseStatus,
  [ArchivableValueType.SecurityCasePriority]: SecurityCasePriority,
};

const rowId: (n: number) => string = (n: number): string => {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
};

const getRowId: (row: unknown) => string = (row: unknown): string => {
  return String((row as Record<string, unknown>)["_id"]);
};

describe("the archivable values", () => {
  test("are the eleven values records pick from, each once", () => {
    expect(
      ARCHIVABLE_VALUE_DEFINITIONS.map(
        (definition: ArchivableValueDefinition): ArchivableValueType => {
          return definition.type;
        },
      ).sort(),
    ).toEqual(Object.values(ArchivableValueType).sort());
    expect(new Set(ARCHIVABLE_VALUE_TABLE_NAMES).size).toBe(11);
  });

  test.each(Object.values(ArchivableValueType))(
    "%s names its model's table and is keyed by its type",
    (type: ArchivableValueType) => {
      const definition: ArchivableValueDefinition = ARCHIVABLE_VALUES[type];
      const model: BaseModel = new MODEL_BY_TYPE[type]();

      expect(definition.type).toBe(type);
      expect(definition.tableName).toBe(model.tableName);
      expect(getArchivableValueByTableName(model.tableName)).toBe(definition);
      expect(isArchivableValueTable(model.tableName)).toBe(true);
    },
  );

  test.each(Object.values(ArchivableValueType))(
    "%s has the archive switch and its stamps on the model",
    (type: ArchivableValueType) => {
      const model: BaseModel = new MODEL_BY_TYPE[type]();

      expect(model.getTableColumnMetadata(ARCHIVED_COLUMN).type).toBe(
        TableColumnType.Boolean,
      );
      expect(model.getTableColumnMetadata(ARCHIVED_AT_COLUMN).type).toBe(
        TableColumnType.Date,
      );
      expect(
        model.getTableColumnMetadata(ARCHIVED_BY_USER_ID_COLUMN).type,
      ).toBe(TableColumnType.ObjectID);
    },
  );

  test.each(Object.values(ArchivableValueType))(
    "%s names a settings page and words for one value and several",
    (type: ArchivableValueType) => {
      const definition: ArchivableValueDefinition = ARCHIVABLE_VALUES[type];

      expect(definition.settingsPath).toContain(" > ");
      expect(definition.singular.length).toBeGreaterThan(2);
      expect(definition.plural.length).toBeGreaterThan(
        definition.singular.length - 2,
      );
      // Lower case: they are read in the middle of a sentence.
      expect(definition.singular).toBe(definition.singular.toLowerCase());
    },
  );

  test("other tables are not archivable values", () => {
    for (const tableName of [
      "Incident",
      "Monitor",
      "StatusPage",
      "IncidentTemplate",
      "",
      undefined,
      null,
    ]) {
      expect(isArchivableValueTable(tableName)).toBe(false);
      expect(getArchivableValueByTableName(tableName)).toBeNull();
    }
  });
});

describe("the rows OneUptime relies on", () => {
  test.each(Object.values(ArchivableValueType))(
    "%s protects only real boolean columns of its model",
    (type: ArchivableValueType) => {
      const model: BaseModel = new MODEL_BY_TYPE[type]();

      for (const protection of ARCHIVABLE_VALUES[type].protections) {
        expect(model.getTableColumnMetadata(protection.column).type).toBe(
          TableColumnType.Boolean,
        );
        expect(protection.reason).toMatch(/can't be archived\.$/);
      }
    },
  );

  test("every built-in row of the state lists is protected, by its flag", () => {
    const pairs: Array<[ArchivableValueType, StateListType]> = [
      [ArchivableValueType.IncidentState, StateListType.IncidentState],
      [ArchivableValueType.AlertState, StateListType.AlertState],
      [
        ArchivableValueType.ScheduledMaintenanceState,
        StateListType.ScheduledMaintenanceState,
      ],
      [ArchivableValueType.MonitorStatus, StateListType.MonitorStatus],
      [
        ArchivableValueType.IncidentPostmortemStatus,
        StateListType.IncidentPostmortemStatus,
      ],
      [ArchivableValueType.SecurityCaseStatus, StateListType.SecurityCaseStatus],
      [
        ArchivableValueType.SecurityCasePriority,
        StateListType.SecurityCasePriority,
      ],
    ];

    for (const [archivable, list] of pairs) {
      const protectedFlags: Array<string> = ARCHIVABLE_VALUES[
        archivable
      ].protections.map((protection: ArchivableValueProtection) => {
        return protection.column;
      });

      expect(protectedFlags.sort()).toEqual(
        STATE_LISTS[list].builtIns
          .map((builtIn: { flag: string }) => {
            return builtIn.flag;
          })
          .sort(),
      );
    }
  });

  test("the primary incident role, and any role that may not be deleted, is protected", () => {
    const definition: ArchivableValueDefinition =
      ARCHIVABLE_VALUES[ArchivableValueType.IncidentRole];

    expect(
      getArchiveProtectionReason({
        definition,
        row: { isPrimaryRole: true, isDeleteable: true },
      }),
    ).toContain("someone in charge");
    expect(
      getArchiveProtectionReason({
        definition,
        row: { isPrimaryRole: false, isDeleteable: false },
      }),
    ).toContain("someone in charge");
    expect(
      getArchiveProtectionReason({
        definition,
        row: { isPrimaryRole: false, isDeleteable: true },
      }),
    ).toBeNull();
  });

  test("a row read without the flag is not protected by it", () => {
    expect(
      getArchiveProtectionReason({
        definition: ARCHIVABLE_VALUES[ArchivableValueType.IncidentRole],
        row: { name: "Scribe" },
      }),
    ).toBeNull();
  });

  test("the reason comes from a model instance too", () => {
    const resolved: IncidentState = new IncidentState();
    resolved.isResolvedState = true;

    expect(
      getArchiveProtectionReason({
        definition: ARCHIVABLE_VALUES[ArchivableValueType.IncidentState],
        row: resolved,
      }),
    ).toBe(
      "Resolving an incident moves it to this state, so it can't be archived.",
    );
  });

  test("a model's false is read as false: a role that may not be deleted is protected", () => {
    // A model's getColumnValue reads a false as null; the check must not.
    const role: IncidentRole = new IncidentRole();
    role.isPrimaryRole = false;
    role.isDeleteable = false;

    expect(
      getArchiveProtectionReason({
        definition: ARCHIVABLE_VALUES[ArchivableValueType.IncidentRole],
        row: role,
      }),
    ).toBe(
      "Every incident needs someone in charge, so this role can't be archived.",
    );

    role.isDeleteable = true;

    expect(
      getArchiveProtectionReason({
        definition: ARCHIVABLE_VALUES[ArchivableValueType.IncidentRole],
        row: role,
      }),
    ).toBeNull();
  });

  test("severities and labels have no built-in rows", () => {
    for (const type of [
      ArchivableValueType.IncidentSeverity,
      ArchivableValueType.AlertSeverity,
      ArchivableValueType.Label,
    ]) {
      expect(ARCHIVABLE_VALUES[type].protections).toEqual([]);
    }
  });

  test("the protection columns are listed once each", () => {
    expect(
      getArchivableValueProtectionColumns(
        ARCHIVABLE_VALUES[ArchivableValueType.ScheduledMaintenanceState],
      ),
    ).toEqual([
      "isScheduledState",
      "isOngoingState",
      "isEndedState",
      "isResolvedState",
    ]);
    expect(
      getArchivableValueProtectionColumns(
        ARCHIVABLE_VALUES[ArchivableValueType.Label],
      ),
    ).toEqual([]);
  });
});

describe("getArchiveRefusal", () => {
  test("refuses a protected row, naming it", () => {
    expect(
      getArchiveRefusal({
        definition: ARCHIVABLE_VALUES[ArchivableValueType.IncidentState],
        rowsToArchive: [
          { _id: rowId(1), name: "Investigating" },
          { _id: rowId(2), name: "Resolved", isResolvedState: true },
        ],
        liveIds: [],
        getRowId,
      }),
    ).toBe(
      '"Resolved": Resolving an incident moves it to this state, so it can\'t be archived.',
    );
  });

  test("lets a custom state go", () => {
    expect(
      getArchiveRefusal({
        definition: ARCHIVABLE_VALUES[ArchivableValueType.IncidentState],
        rowsToArchive: [{ _id: rowId(1), name: "Investigating" }],
        liveIds: [],
        getRowId,
      }),
    ).toBeNull();
  });

  test("keeps one live severity", () => {
    const definition: ArchivableValueDefinition =
      ARCHIVABLE_VALUES[ArchivableValueType.IncidentSeverity];

    expect(
      getArchiveRefusal({
        definition,
        rowsToArchive: [{ _id: rowId(1), name: "Critical" }],
        liveIds: [rowId(1)],
        getRowId,
      }),
    ).toBe(definition.keepsOneLiveReason!);

    expect(
      getArchiveRefusal({
        definition,
        rowsToArchive: [{ _id: rowId(1) }, { _id: rowId(2) }],
        liveIds: [rowId(1), rowId(2)],
        getRowId,
      }),
    ).toBe(definition.keepsOneLiveReason!);

    expect(
      getArchiveRefusal({
        definition,
        rowsToArchive: [{ _id: rowId(1) }],
        liveIds: [rowId(1), rowId(2)],
        getRowId,
      }),
    ).toBeNull();
  });

  test("compares the live ids whatever their case", () => {
    expect(
      getArchiveRefusal({
        definition: ARCHIVABLE_VALUES[ArchivableValueType.AlertSeverity],
        rowsToArchive: [{ _id: rowId(1).toUpperCase() }],
        liveIds: [rowId(1)],
        getRowId,
      }),
    ).toBe(
      ARCHIVABLE_VALUES[ArchivableValueType.AlertSeverity].keepsOneLiveReason!,
    );
  });

  test("a kind with no minimum lets every value go", () => {
    expect(
      getArchiveRefusal({
        definition: ARCHIVABLE_VALUES[ArchivableValueType.Label],
        rowsToArchive: [{ _id: rowId(1) }],
        liveIds: [rowId(1)],
        getRowId,
      }),
    ).toBeNull();
  });
});

describe("isArchivedValue", () => {
  test("reads the switch off JSON and off a model", () => {
    const label: Label = new Label();
    label.isArchived = true;

    expect(isArchivedValue(label)).toBe(true);
    expect(isArchivedValue({ isArchived: true })).toBe(true);
    expect(isArchivedValue({ isArchived: false })).toBe(false);
    expect(isArchivedValue({})).toBe(false);
    expect(isArchivedValue(null)).toBe(false);
    expect(isArchivedValue("isArchived")).toBe(false);
  });
});

describe("getArchivedValueRefusalSentence", () => {
  test("one value: names it, says what to do and where", () => {
    expect(
      getArchivedValueRefusalSentence({
        definition: ARCHIVABLE_VALUES[ArchivableValueType.IncidentSeverity],
        names: ["[DONOTUSE] Very critical"],
      }),
    ).toBe(
      '"[DONOTUSE] Very critical" is an archived incident severity and can\'t be picked. Choose another, or unarchive it in Incidents > Settings > Incident Severity.',
    );
  });

  test("several values: names each once, in order", () => {
    expect(
      getArchivedValueRefusalSentence({
        definition: ARCHIVABLE_VALUES[ArchivableValueType.Label],
        names: ["legacy-db", "old-team", "legacy-db", "  ", "archive-me"],
      }),
    ).toBe(
      '"legacy-db", "old-team" and "archive-me" are archived labels and can\'t be picked. Choose others, or unarchive them in Project Settings > Labels.',
    );
  });

  test("two values are joined with and", () => {
    expect(
      getArchivedValueRefusalSentence({
        definition: ARCHIVABLE_VALUES[ArchivableValueType.MonitorStatus],
        names: ["Degraded", "Maintenance"],
      }),
    ).toBe(
      '"Degraded" and "Maintenance" are archived monitor statuses and can\'t be picked. Choose others, or unarchive them in Monitors > Settings > Monitor Status.',
    );
  });

  test("a value with no name is still refused, in words about its kind", () => {
    expect(
      getArchivedValueRefusalSentence({
        definition: ARCHIVABLE_VALUES[ArchivableValueType.IncidentRole],
        names: [""],
      }),
    ).toBe(
      "This incident role is archived and can't be picked. Choose another, or unarchive it in Incidents > Settings > Incident Roles.",
    );
  });
});
