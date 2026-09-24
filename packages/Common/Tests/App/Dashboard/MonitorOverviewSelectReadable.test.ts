import { describe, expect, test } from "@jest/globals";
import {
  MONITOR_OVERVIEW_BASE_SELECT,
  MONITOR_OVERVIEW_PROBE_FULL_SELECT,
  MONITOR_OVERVIEW_PROBE_LIGHT_SELECT,
  MONITOR_OVERVIEW_STATUS_ROW_LIMIT,
  MONITOR_OVERVIEW_STATUS_ROW_SELECT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewSelect";
import {
  MONITOR_CREDENTIAL_COLUMNS,
  MONITOR_SECRET_KEY_COLUMNS,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/MonitorSecretKeySelect";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorProbe from "../../../Models/DatabaseModels/MonitorProbe";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import Probe from "../../../Models/DatabaseModels/Probe";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../../Types/Dictionary";
import Permission, { PermissionHelper } from "../../../Types/Permission";

/*
 * The monitor overview reads the Monitor row with one select, and one
 * unreadable column in a select is fatal, not degraded: ColumnPermission
 * throws and the WHOLE getItem fails. A Viewer, a MonitorViewer or a
 * ReadProjectMonitor holder would then get an error screen instead of a
 * monitor. The select is iterated rather than listed here, so a column added
 * to it later is checked automatically.
 *
 * The secret-key columns are the deliberate exception. They are gated on
 * the ability to rotate the key, so the data hook spreads
 * getReadableMonitorSecretKeySelect() at call time and the constant must
 * never name them.
 */

// The roles that may open a monitor but must never be handed a secret.
const READ_ONLY_ROLES: Array<Permission> = [
  Permission.Viewer,
  Permission.MonitorViewer,
  Permission.ReadProjectMonitor,
];

/*
 * _id and createdAt carry no column-level decorator. The model answers for
 * them with its record read permissions, which is what the server checks.
 */
const RECORD_LEVEL_COLUMNS: Array<string> = ["_id", "createdAt"];

type CanReadColumnFunction = (data: {
  model: DatabaseBaseModel;
  columnName: string;
  permissions: Array<Permission>;
}) => boolean;

/*
 * ColumnPermission's read rule, reduced to the question that matters: a
 * column with no declared read list is readable; otherwise one of the
 * caller's permissions must be on it.
 */
const canReadColumn: CanReadColumnFunction = (data: {
  model: DatabaseBaseModel;
  columnName: string;
  permissions: Array<Permission>;
}): boolean => {
  const accessControl: Dictionary<ColumnAccessControl> =
    data.model.getColumnAccessControlForAllColumns();
  const readPermissions: Array<Permission> =
    accessControl[data.columnName]?.read || [];

  if (readPermissions.length === 0) {
    return true;
  }

  return PermissionHelper.doesPermissionsIntersect(
    data.permissions,
    readPermissions,
  );
};

type SelectObject = Record<string, unknown>;

const getSelectKeys: (select: SelectObject) => Array<string> = (
  select: SelectObject,
): Array<string> => {
  return Object.keys(select);
};

const getRelationKeys: (
  select: SelectObject,
  relation: string,
) => Array<string> = (
  select: SelectObject,
  relation: string,
): Array<string> => {
  const nested: unknown = select[relation];

  if (!nested || typeof nested !== "object") {
    throw new Error(`The select has no ${relation} relation.`);
  }

  return Object.keys(nested as Record<string, unknown>);
};

describe("MONITOR_OVERVIEW_BASE_SELECT is readable by every read-only role", () => {
  const monitor: Monitor = new Monitor();
  const columns: Array<string> = getSelectKeys(MONITOR_OVERVIEW_BASE_SELECT);

  test("the select is not empty, so the loops below are not vacuous", () => {
    expect(columns.length).toBeGreaterThan(20);
    expect(columns).toEqual(
      expect.arrayContaining([
        "monitorType",
        "currentMonitorStatusId",
        "currentMonitorStatus",
        "monitorSteps",
        "monitoringInterval",
        "disableActiveMonitoring",
        "isNoProbeEnabledOnThisMonitor",
        "serverMonitorResponse",
        "incomingMonitorRequest",
      ]),
    );
  });

  test.each(READ_ONLY_ROLES)(
    "every column is readable by a %s-only principal",
    (role: Permission) => {
      const unreadable: Array<string> = columns.filter((columnName: string) => {
        if (RECORD_LEVEL_COLUMNS.includes(columnName)) {
          return false;
        }

        return !canReadColumn({
          model: monitor,
          columnName: columnName,
          permissions: [role],
        });
      });

      expect(unreadable).toEqual([]);
    },
  );

  test("every selected column is a real Monitor column", () => {
    // A misspelt column has no access control at all and would pass above.
    const unknownColumns: Array<string> = columns.filter(
      (columnName: string) => {
        return !monitor.hasColumn(columnName);
      },
    );

    expect(unknownColumns).toEqual([]);
  });

  test("the record-level columns fall back to the record read permissions, which admit all three roles", () => {
    for (const columnName of RECORD_LEVEL_COLUMNS) {
      expect(columns).toContain(columnName);
    }

    for (const role of READ_ONLY_ROLES) {
      expect(monitor.hasReadPermissions([role])).toBe(true);
    }
  });

  test("a read-only role would be caught: the guard fails for a secret-key column", () => {
    /*
     * Guard the guard: if canReadColumn said yes to everything, the tests
     * above would pass over a broken select.
     */
    for (const role of READ_ONLY_ROLES) {
      expect(
        canReadColumn({
          model: monitor,
          columnName: "serverMonitorSecretKey",
          permissions: [role],
        }),
      ).toBe(false);
    }
  });
});

describe("the overview selects never name a secret-key column", () => {
  test.each([
    ["MONITOR_OVERVIEW_BASE_SELECT", MONITOR_OVERVIEW_BASE_SELECT],
    [
      "MONITOR_OVERVIEW_PROBE_LIGHT_SELECT",
      MONITOR_OVERVIEW_PROBE_LIGHT_SELECT,
    ],
    ["MONITOR_OVERVIEW_PROBE_FULL_SELECT", MONITOR_OVERVIEW_PROBE_FULL_SELECT],
    ["MONITOR_OVERVIEW_STATUS_ROW_SELECT", MONITOR_OVERVIEW_STATUS_ROW_SELECT],
  ])("%s", (_name: string, select: SelectObject) => {
    const text: string = JSON.stringify(select);

    for (const secretColumn of MONITOR_CREDENTIAL_COLUMNS) {
      expect(text).not.toContain(secretColumn as string);
    }
  });

  test("the list being checked is the three secret columns", () => {
    expect([...MONITOR_SECRET_KEY_COLUMNS].sort()).toEqual([
      "incomingEmailSecretKey",
      "incomingRequestSecretKey",
      "serverMonitorSecretKey",
    ]);
  });

  test("the custom inbound email address is checked with them", () => {
    expect([...MONITOR_CREDENTIAL_COLUMNS].sort()).toEqual([
      "incomingEmailCustomLocalPart",
      "incomingEmailSecretKey",
      "incomingRequestSecretKey",
      "serverMonitorSecretKey",
    ]);
  });
});

describe("relation sub-selects only ask for columns exposed on relation queries", () => {
  test("every currentMonitorStatus subkey is canReadOnRelationQuery", () => {
    const status: MonitorStatus = new MonitorStatus();
    const keys: Array<string> = getRelationKeys(
      MONITOR_OVERVIEW_BASE_SELECT,
      "currentMonitorStatus",
    );

    expect(keys).toEqual(
      expect.arrayContaining([
        "_id",
        "name",
        "color",
        "isOperationalState",
        "isOfflineState",
        "priority",
      ]),
    );

    for (const key of keys) {
      expect({
        key: key,
        canReadOnRelationQuery:
          status.getTableColumnMetadata(key)?.canReadOnRelationQuery,
      }).toEqual({ key: key, canReadOnRelationQuery: true });
    }
  });

  test("every monitorStatus subkey of the status-row select is canReadOnRelationQuery", () => {
    const status: MonitorStatus = new MonitorStatus();

    for (const key of getRelationKeys(
      MONITOR_OVERVIEW_STATUS_ROW_SELECT,
      "monitorStatus",
    )) {
      expect({
        key: key,
        canReadOnRelationQuery:
          status.getTableColumnMetadata(key)?.canReadOnRelationQuery,
      }).toEqual({ key: key, canReadOnRelationQuery: true });
    }
  });

  test("every probe subkey of the probe select is canReadOnRelationQuery", () => {
    const probe: Probe = new Probe();
    const keys: Array<string> = getRelationKeys(
      MONITOR_OVERVIEW_PROBE_LIGHT_SELECT,
      "probe",
    );

    expect(keys.sort()).toEqual(["connectionStatus", "iconFileId", "name"]);

    for (const key of keys) {
      expect({
        key: key,
        canReadOnRelationQuery:
          probe.getTableColumnMetadata(key)?.canReadOnRelationQuery,
      }).toEqual({ key: key, canReadOnRelationQuery: true });
    }
  });
});

describe("the probe and status-row selects", () => {
  /*
   * MonitorProbe and MonitorStatusTimeline are not readable by
   * ReadProjectMonitor at all (the hook skips those reads), but a Viewer
   * and a MonitorViewer can read them, so every selected column must be
   * readable by those two.
   */
  const PROBE_AND_TIMELINE_READERS: Array<Permission> = [
    Permission.Viewer,
    Permission.MonitorViewer,
  ];

  test.each(PROBE_AND_TIMELINE_READERS)(
    "every MonitorProbe column in the full select is readable by %s",
    (role: Permission) => {
      const monitorProbe: MonitorProbe = new MonitorProbe();

      expect(monitorProbe.hasReadPermissions([role])).toBe(true);

      for (const columnName of getSelectKeys(
        MONITOR_OVERVIEW_PROBE_FULL_SELECT,
      )) {
        expect(monitorProbe.hasColumn(columnName)).toBe(true);
        expect({
          columnName: columnName,
          readable:
            RECORD_LEVEL_COLUMNS.includes(columnName) ||
            canReadColumn({
              model: monitorProbe,
              columnName: columnName,
              permissions: [role],
            }),
        }).toEqual({ columnName: columnName, readable: true });
      }
    },
  );

  test.each(PROBE_AND_TIMELINE_READERS)(
    "every MonitorStatusTimeline column in the row select is readable by %s",
    (role: Permission) => {
      const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();

      expect(timeline.hasReadPermissions([role])).toBe(true);

      for (const columnName of getSelectKeys(
        MONITOR_OVERVIEW_STATUS_ROW_SELECT,
      )) {
        expect(timeline.hasColumn(columnName)).toBe(true);
        expect({
          columnName: columnName,
          readable:
            RECORD_LEVEL_COLUMNS.includes(columnName) ||
            canReadColumn({
              model: timeline,
              columnName: columnName,
              permissions: [role],
            }),
        }).toEqual({ columnName: columnName, readable: true });
      }
    },
  );

  test("the light select leaves out the results and the full select adds only them", () => {
    expect(MONITOR_OVERVIEW_PROBE_LIGHT_SELECT).not.toHaveProperty(
      "lastMonitoringLog",
    );
    expect(MONITOR_OVERVIEW_PROBE_FULL_SELECT).toEqual({
      ...MONITOR_OVERVIEW_PROBE_LIGHT_SELECT,
      lastMonitoringLog: true,
    });
  });

  test("selects that join a relation also select their sort column", () => {
    /*
     * A list that pulls a relation goes down TypeORM's paginated join path,
     * which orders by a column the inner query only emits when selected.
     * The hook sorts probes by createdAt and status rows by startsAt.
     */
    expect(MONITOR_OVERVIEW_PROBE_LIGHT_SELECT).toHaveProperty(
      "createdAt",
      true,
    );
    expect(MONITOR_OVERVIEW_STATUS_ROW_SELECT).toHaveProperty("startsAt", true);
  });

  test("status rows are only the newest few, never a 90-day history", () => {
    expect(MONITOR_OVERVIEW_STATUS_ROW_LIMIT).toBe(5);
  });
});
