import "../../TestingUtils/Init";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { AuditLogService } from "../../../../Server/Services/AuditLogService";
import LabelService from "../../../../Server/Services/LabelService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import ProbeService from "../../../../Server/Services/ProbeService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import UserService from "../../../../Server/Services/UserService";
import FindBy from "../../../../Server/Types/Database/FindBy";
import AuditLogRelatedNames, {
  MAX_AUDIT_LOG_RELATED_RECORDS_PER_TABLE,
} from "../../../../Server/Utils/AuditLog/AuditLogRelatedNames";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import AuditLog from "../../../../Models/AnalyticsModels/AuditLog";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import Probe from "../../../../Models/DatabaseModels/Probe";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import User from "../../../../Models/DatabaseModels/User";
import AuditLogAction from "../../../../Types/AuditLog/AuditLogAction";
import { hideAuditLogChange } from "../../../../Types/AuditLog/AuditLogHiddenValues";
import { AUDIT_LOG_SESSION_RESOURCE_TYPE } from "../../../../Types/AuditLog/AuditLogSessionEvent";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import { JSONArray } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import {
  AuditLogRelatedRecord,
  AuditLogRelatedRecordState,
  AuditLogRelatedRecords,
} from "../../../../Utils/AuditLog/AuditLogRelatedRecords";

// A refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../../Server/Utils/Logger");

/*
 * THE NAMES OF THE RECORDS AN AUDIT LOG ENTRY'S CHANGES NAME, AS ITS READER
 * MAY READ THEM (#10470).
 *
 * The changes dialog read a monitor's status as two UUIDs and its labels
 * as JSON. Here, with the real models, an entry is read as its reader is
 * handed it, and the records its changes name are read the way a row's
 * relation select reads them:
 *
 *   - a single reference (a monitor's status) and a list (its labels),
 *     whose names every reader of the relation reads: read in the project,
 *     one read per table, whatever the number of fields and rows;
 *   - a name held to its own read (a security case's title): read with the
 *     reader's own read - a Security Viewer finds the case, a Settings
 *     Admin is refused it and sees "Name hidden";
 *   - a record since deleted: "Deleted", with the name the entry recorded,
 *     where the reader was handed it - and "Name hidden" for a reader who
 *     cannot tell it from one kept from them;
 *   - a field whose value the reader may not read (#10642): nothing is
 *     looked up for it;
 *   - people as the project knows them, a record every project shares, and
 *     another project's record, which is never named.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10470000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10470000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("10470000-0000-4000-8000-000000000003");
const MONITOR_ID: string = "10470000-0000-4000-8000-0000000000a1";
const DEGRADED: string = "10470000-0000-4000-8000-0000000000b1";
const OPERATIONAL: string = "10470000-0000-4000-8000-0000000000b2";
const PRODUCTION: string = "10470000-0000-4000-8000-0000000000c1";
const EU: string = "10470000-0000-4000-8000-0000000000c2";
const GONE_LABEL: string = "10470000-0000-4000-8000-0000000000c3";
const CASE_ID: string = "10470000-0000-4000-8000-0000000000d1";
const ALICE: string = "10470000-0000-4000-8000-0000000000e1";
const INVITED: string = "10470000-0000-4000-8000-0000000000e2";

interface Row {
  permission: Permission;
}

function toPermissionRows(rows: Array<Row>): UserTenantAccessPermission {
  return {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: rows.map((row: Row): UserPermission => {
      return {
        _type: "UserPermission",
        permission: row.permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };
}

// A person in the project, with these permissions.
function memberWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: toPermissionRows(
        [Permission.CurrentUser, Permission.ProjectUser, ...permissions].map(
          (permission: Permission): Row => {
            return { permission };
          },
        ),
      ),
    },
    userTeamIds: [],
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  };
}

const PROJECT_ADMIN: DatabaseCommonInteractionProps = memberWith([
  Permission.ProjectAdmin,
]);

function entryOf(data: {
  resourceType: string;
  changes: JSONArray;
  action?: string;
}): AuditLog {
  const entry: AuditLog = new AuditLog();
  entry.projectId = PROJECT_ID;
  entry.resourceType = data.resourceType;
  entry.resourceId = new ObjectID(MONITOR_ID);
  entry.action = data.action || AuditLogAction.Update;
  entry.changes = data.changes;
  return entry;
}

function rowOf<TModel extends BaseModel>(
  modelType: { new (): TModel },
  values: Record<string, unknown>,
): TModel {
  const row: TModel = new modelType();

  for (const [key, value] of Object.entries(values)) {
    row.setColumnValue(key, value as never);
  }

  return row;
}

function stateOf(
  records: AuditLogRelatedRecords,
  field: string,
  id: string,
): AuditLogRelatedRecord | undefined {
  return records.get(field)?.get(id);
}

// The reads each service was asked, as they were asked.
let reads: Map<string, Array<FindBy<BaseModel>>>;

// The ids a read asks for: the values its `_id: QueryHelper.any(...)` holds.
function idsAsked(findBy: FindBy<BaseModel>): Array<string> {
  const condition: { objectLiteralParameters?: Record<string, unknown> } = (
    findBy.query as Record<string, unknown>
  )["_id"] as {
    objectLiteralParameters?: Record<string, unknown>;
  };
  const values: unknown = Object.values(
    condition?.objectLiteralParameters || {},
  )[0];

  return (Array.isArray(values) ? values : []).map((id: unknown): string => {
    return String(id).toLowerCase();
  });
}

function answer<TModel extends BaseModel>(
  service: { findBy: (findBy: FindBy<TModel>) => Promise<Array<TModel>> },
  name: string,
  rows: Array<TModel> | Error,
): void {
  jest
    .spyOn(service, "findBy")
    .mockImplementation(async (findBy: FindBy<TModel>) => {
      reads.set(name, [
        ...(reads.get(name) || []),
        findBy as unknown as FindBy<BaseModel>,
      ]);

      if (rows instanceof Error) {
        throw rows;
      }

      const asked: Array<string> = idsAsked(
        findBy as unknown as FindBy<BaseModel>,
      );

      return rows.filter((row: TModel): boolean => {
        return asked.includes(String(row.id).toLowerCase());
      });
    });
}

beforeEach(() => {
  reads = new Map();

  answer(MonitorStatusService, "MonitorStatus", [
    rowOf(MonitorStatus, {
      _id: DEGRADED,
      name: "Degraded",
      projectId: PROJECT_ID,
    }),
    rowOf(MonitorStatus, {
      _id: OPERATIONAL,
      name: "Operational",
      projectId: PROJECT_ID,
    }),
  ]);
  answer(LabelService, "Label", [
    rowOf(Label, {
      _id: PRODUCTION,
      name: "Production",
      projectId: PROJECT_ID,
    }),
    rowOf(Label, { _id: EU, name: "EU", projectId: PROJECT_ID }),
  ]);
  answer(UserService, "User", [
    rowOf(User, {
      _id: ALICE,
      name: "Alice Liddell",
      email: "alice@example.com",
    }),
    rowOf(User, {
      _id: INVITED,
      name: "Account Name",
      email: "moved@example.com",
    }),
  ]);
  jest
    .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
    .mockResolvedValue(
      new Map<string, WithheldProfile>([
        [
          INVITED,
          {
            inviteeName: "Bob (contractor)",
            inviteeEmail: "bob@contractor.example",
          } as WithheldProfile,
        ],
      ]),
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

const STATUS_CHANGE: JSONArray = [
  {
    field: "currentMonitorStatusId",
    oldValue: DEGRADED,
    newValue: OPERATIONAL,
  },
];

describe("the related model a field names", () => {
  test("an id is named by the Entity column whose manyToOneRelationColumn it is, a relation by its own", () => {
    const monitor: Monitor = new Monitor();

    expect(
      AuditLogRelatedNames.getRelatedModelTypeOf(
        monitor,
        "currentMonitorStatusId",
      ),
    ).toBe(MonitorStatus);
    expect(AuditLogRelatedNames.getRelatedModelTypeOf(monitor, "labels")).toBe(
      Label,
    );
    expect(
      AuditLogRelatedNames.getRelatedModelTypeOf(monitor, "name"),
    ).toBeNull();
    expect(
      AuditLogRelatedNames.getRelatedModelTypeOf(monitor, "noSuchColumn"),
    ).toBeNull();
  });
});

describe("a single reference and a list", () => {
  test("a monitor's status reads Degraded, then Operational", async () => {
    const records: AuditLogRelatedRecords =
      await AuditLogRelatedNames.readForHeldEntry({
        entry: entryOf({ resourceType: "Monitor", changes: STATUS_CHANGE }),
        props: PROJECT_ADMIN,
      });

    expect(stateOf(records, "currentMonitorStatusId", DEGRADED)).toEqual({
      state: AuditLogRelatedRecordState.Named,
      name: "Degraded",
    });
    expect(stateOf(records, "currentMonitorStatusId", OPERATIONAL)).toEqual({
      state: AuditLogRelatedRecordState.Named,
      name: "Operational",
    });
  });

  test("a list of labels reads each label by its name now, and one deleted since by the name the entry recorded", async () => {
    const records: AuditLogRelatedRecords =
      await AuditLogRelatedNames.readForHeldEntry({
        entry: entryOf({
          resourceType: "Monitor",
          changes: [
            {
              field: "labels",
              oldValue: [
                { _id: PRODUCTION, name: "Prod" },
                { _id: GONE_LABEL, name: "Legacy" },
              ],
              newValue: [{ _id: PRODUCTION }, { _id: EU }],
            },
          ],
        }),
        props: PROJECT_ADMIN,
      });

    // Its name now, not the one it had then.
    expect(stateOf(records, "labels", PRODUCTION)).toEqual({
      state: AuditLogRelatedRecordState.Named,
      name: "Production",
    });
    expect(stateOf(records, "labels", EU)).toEqual({
      state: AuditLogRelatedRecordState.Named,
      name: "EU",
    });
    expect(stateOf(records, "labels", GONE_LABEL)).toEqual({
      state: AuditLogRelatedRecordState.Deleted,
      name: "Legacy",
    });
  });

  test("a related record deleted since that the entry recorded no name for is Deleted, by its id", async () => {
    const records: AuditLogRelatedRecords =
      await AuditLogRelatedNames.readForHeldEntry({
        entry: entryOf({
          resourceType: "Monitor",
          changes: [
            {
              field: "currentMonitorStatusId",
              oldValue: "10470000-0000-4000-8000-0000000000b9",
              newValue: OPERATIONAL,
            },
          ],
        }),
        props: PROJECT_ADMIN,
      });

    expect(
      stateOf(
        records,
        "currentMonitorStatusId",
        "10470000-0000-4000-8000-0000000000b9",
      ),
    ).toEqual({ state: AuditLogRelatedRecordState.Deleted });
  });
});

describe("one read per table, however many fields and rows name its records", () => {
  test("every field and value naming a table's records is read together, once, in the entry's project", async () => {
    await AuditLogRelatedNames.readForHeldEntry({
      entry: entryOf({
        resourceType: "Monitor",
        changes: [
          ...STATUS_CHANGE,
          {
            field: "labels",
            oldValue: [{ _id: PRODUCTION }],
            newValue: [{ _id: PRODUCTION }, { _id: EU }, { _id: GONE_LABEL }],
          },
          {
            field: "createdByUserId",
            oldValue: null,
            newValue: ALICE,
          },
          {
            field: "deletedByUserId",
            oldValue: null,
            newValue: INVITED,
          },
        ],
      }),
      props: PROJECT_ADMIN,
    });

    expect(reads.get("MonitorStatus")).toHaveLength(1);
    expect(reads.get("Label")).toHaveLength(1);
    expect(reads.get("User")).toHaveLength(1);

    const labels: FindBy<BaseModel> = reads.get("Label")![0]!;

    expect(idsAsked(labels)).toEqual([PRODUCTION, EU, GONE_LABEL]);
    expect(labels.select).toEqual({ _id: true, name: true, projectId: true });
    expect(labels.limit).toBe(3);
  });

  test("a table's records are looked up to a bound", async () => {
    const many: Array<{ _id: string }> = Array.from(
      { length: MAX_AUDIT_LOG_RELATED_RECORDS_PER_TABLE + 20 },
      (_value: unknown, index: number): { _id: string } => {
        return {
          _id: `10470000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        };
      },
    );

    await AuditLogRelatedNames.readForHeldEntry({
      entry: entryOf({
        resourceType: "Monitor",
        changes: [{ field: "labels", oldValue: [], newValue: many }],
      }),
      props: PROJECT_ADMIN,
    });

    expect(reads.get("Label")![0]!.limit).toBe(
      MAX_AUDIT_LOG_RELATED_RECORDS_PER_TABLE,
    );
  });
});

describe("a name held to its own read: read as the reader", () => {
  const NOTE_CHANGE: JSONArray = [
    { field: "securityCaseId", oldValue: null, newValue: CASE_ID },
  ];

  test("a Security Viewer reads the case's title, with their own read", async () => {
    const viewer: DatabaseCommonInteractionProps = memberWith([
      Permission.SecurityViewer,
    ]);
    answer(SecurityCaseService, "SecurityCase", [
      rowOf(SecurityCase, { _id: CASE_ID, title: "Ransomware on payments-01" }),
    ]);

    const records: AuditLogRelatedRecords =
      await AuditLogRelatedNames.readForHeldEntry({
        entry: entryOf({
          resourceType: "Security Case Note",
          action: AuditLogAction.Create,
          changes: NOTE_CHANGE,
        }),
        props: viewer,
      });

    expect(stateOf(records, "securityCaseId", CASE_ID)).toEqual({
      state: AuditLogRelatedRecordState.Named,
      name: "Ransomware on payments-01",
    });

    // The reader's own read, by their permissions - never OneUptime's.
    const read: FindBy<BaseModel> = reads.get("SecurityCase")![0]!;

    expect(read.props).toBe(viewer);
    expect(read.props.isRoot).toBeFalsy();
    expect(read.select).toEqual({ _id: true, title: true });
  });

  test("a Settings Admin the case's read refuses sees Name hidden, not the title", async () => {
    answer(
      SecurityCaseService,
      "SecurityCase",
      new NotAuthorizedException("You do not have permission to read cases."),
    );

    const records: AuditLogRelatedRecords =
      await AuditLogRelatedNames.readForHeldEntry({
        entry: entryOf({
          resourceType: "Security Case Note",
          action: AuditLogAction.Create,
          changes: NOTE_CHANGE,
        }),
        props: memberWith([Permission.SettingsAdmin]),
      });

    expect(stateOf(records, "securityCaseId", CASE_ID)).toEqual({
      state: AuditLogRelatedRecordState.Hidden,
    });
    expect(
      JSON.stringify(Array.from(records.get("securityCaseId")!)),
    ).not.toContain("Ransomware");
  });

  test("a record the reader does not find is Deleted only when they read every record, so it would be there", async () => {
    answer(SecurityCaseService, "SecurityCase", []);
    const everyRecord: SpyInstance<
      typeof SecurityCaseService.readsEveryRecordInProject
    > = jest.spyOn(SecurityCaseService, "readsEveryRecordInProject");

    everyRecord.mockResolvedValue(true);

    const owner: AuditLogRelatedRecords =
      await AuditLogRelatedNames.readForHeldEntry({
        entry: entryOf({
          resourceType: "Security Case Note",
          changes: NOTE_CHANGE,
        }),
        props: memberWith([Permission.SecurityAdmin]),
      });

    expect(stateOf(owner, "securityCaseId", CASE_ID)).toEqual({
      state: AuditLogRelatedRecordState.Deleted,
    });

    everyRecord.mockResolvedValue(false);

    const narrowed: AuditLogRelatedRecords =
      await AuditLogRelatedNames.readForHeldEntry({
        entry: entryOf({
          resourceType: "Security Case Note",
          changes: NOTE_CHANGE,
        }),
        props: memberWith([Permission.SecurityViewer]),
      });

    // Gone, or kept from them: they may not tell which.
    expect(stateOf(narrowed, "securityCaseId", CASE_ID)).toEqual({
      state: AuditLogRelatedRecordState.Hidden,
    });
  });

  test("a reader who reads the table but not its name is not asked for it, and sees Name hidden", async () => {
    answer(SecurityCaseService, "SecurityCase", [
      rowOf(SecurityCase, { _id: CASE_ID }),
    ]);

    const records: AuditLogRelatedRecords =
      await AuditLogRelatedNames.readForHeldEntry({
        entry: entryOf({
          resourceType: "Security Case Note",
          changes: NOTE_CHANGE,
        }),
        // Reads no security case at all: the select never asks for the title.
        props: memberWith([Permission.ProjectMember]),
      });

    expect(reads.get("SecurityCase")![0]!.select).toEqual({ _id: true });
    expect(stateOf(records, "securityCaseId", CASE_ID)).toEqual({
      state: AuditLogRelatedRecordState.Hidden,
    });
  });
});

describe("what is never looked up, or never named", () => {
  test("a field whose value the reader may not read (#10642) names nothing, and nothing of it is read", async () => {
    const records: AuditLogRelatedRecords =
      await AuditLogRelatedNames.readForHeldEntry({
        entry: entryOf({
          resourceType: "Monitor",
          changes: [hideAuditLogChange(STATUS_CHANGE[0] as never)],
        }),
        props: memberWith([Permission.SettingsAdmin]),
      });

    expect(records.size).toBe(0);
    expect(reads.get("MonitorStatus")).toBeUndefined();
  });

  test("the audit log's own entries, and an entry with no changes, name nothing", async () => {
    expect(
      (
        await AuditLogRelatedNames.readForHeldEntry({
          entry: entryOf({
            resourceType: AUDIT_LOG_SESSION_RESOURCE_TYPE,
            changes: [{ field: "userId", oldValue: null, newValue: ALICE }],
          }),
          props: PROJECT_ADMIN,
        })
      ).size,
    ).toBe(0);
    expect(
      (
        await AuditLogRelatedNames.readForHeldEntry({
          entry: entryOf({ resourceType: "Monitor", changes: [] }),
          props: PROJECT_ADMIN,
        })
      ).size,
    ).toBe(0);
    expect(reads.size).toBe(0);
  });

  test("another project's record is never named; one every project shares is", async () => {
    const GLOBAL_PROBE: string = "10470000-0000-4000-8000-0000000000f1";
    const OTHER_PROBE: string = "10470000-0000-4000-8000-0000000000f2";
    answer(ProbeService, "Probe", [
      rowOf(Probe, { _id: GLOBAL_PROBE, name: "US East (global)" }),
      rowOf(Probe, {
        _id: OTHER_PROBE,
        name: "Another project's probe",
        projectId: OTHER_PROJECT_ID,
      }),
    ]);

    const records: AuditLogRelatedRecords =
      await AuditLogRelatedNames.readForHeldEntry({
        entry: entryOf({
          resourceType: "Monitor Probe",
          action: AuditLogAction.Create,
          changes: [
            { field: "probeId", oldValue: null, newValue: GLOBAL_PROBE },
          ],
        }),
        props: PROJECT_ADMIN,
      });

    expect(stateOf(records, "probeId", GLOBAL_PROBE)).toEqual({
      state: AuditLogRelatedRecordState.Named,
      name: "US East (global)",
    });

    const other: AuditLogRelatedRecords =
      await AuditLogRelatedNames.readForHeldEntry({
        entry: entryOf({
          resourceType: "Monitor Probe",
          action: AuditLogAction.Create,
          changes: [
            { field: "probeId", oldValue: null, newValue: OTHER_PROBE },
          ],
        }),
        props: PROJECT_ADMIN,
      });

    expect(stateOf(other, "probeId", OTHER_PROBE)).toEqual({
      state: AuditLogRelatedRecordState.Hidden,
    });
  });

  test("people are named as the project knows them: someone only invited by what they were invited as", async () => {
    const records: AuditLogRelatedRecords =
      await AuditLogRelatedNames.readForHeldEntry({
        entry: entryOf({
          resourceType: "Monitor",
          action: AuditLogAction.Create,
          changes: [
            { field: "createdByUserId", oldValue: null, newValue: ALICE },
            { field: "deletedByUserId", oldValue: null, newValue: INVITED },
          ],
        }),
        props: PROJECT_ADMIN,
      });

    expect(stateOf(records, "createdByUserId", ALICE)).toEqual({
      state: AuditLogRelatedRecordState.Named,
      name: "Alice Liddell",
    });
    expect(stateOf(records, "deletedByUserId", INVITED)).toEqual({
      state: AuditLogRelatedRecordState.Named,
      name: "Bob (contractor)",
    });
    expect(
      PendingInviteeProfiles.readWithheldProfilesInProject,
    ).toHaveBeenCalledWith({
      userIds: [ALICE, INVITED],
      projectId: PROJECT_ID,
    });
  });
});

describe("an entry, read as its reader reads it", () => {
  test("is read with the reader's own read of the audit log, and an entry they may not read is not found", async () => {
    const service: AuditLogService = new AuditLogService();
    const findOneById: SpyInstance<AuditLogService["findOneById"]> = jest
      .spyOn(service, "findOneById")
      .mockResolvedValue(
        entryOf({ resourceType: "Monitor", changes: STATUS_CHANGE }),
      );
    const reader: DatabaseCommonInteractionProps = memberWith([
      Permission.ReadAuditLog,
      Permission.MonitorViewer,
    ]);

    const records: AuditLogRelatedRecords =
      await AuditLogRelatedNames.readForEntry({
        auditLogId: new ObjectID("10470000-0000-4000-8000-0000000000aa"),
        props: reader,
        service,
      });

    expect(findOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: new ObjectID("10470000-0000-4000-8000-0000000000aa"),
        props: reader,
      }),
    );
    expect(stateOf(records, "currentMonitorStatusId", OPERATIONAL)?.name).toBe(
      "Operational",
    );

    findOneById.mockResolvedValue(null);

    await expect(
      AuditLogRelatedNames.readForEntry({
        auditLogId: new ObjectID("10470000-0000-4000-8000-0000000000aa"),
        props: reader,
        service,
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
