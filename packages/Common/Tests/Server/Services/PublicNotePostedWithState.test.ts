import IncidentPublicNoteService from "../../../Server/Services/IncidentPublicNoteService";
import ScheduledMaintenancePublicNoteService from "../../../Server/Services/ScheduledMaintenancePublicNoteService";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import StateChangePublicNote from "../../../Server/Utils/StatusPage/StateChangePublicNote";
import { AddPublicNotePostedWithState1798400000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1798400000000-AddPublicNotePostedWithState";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import ScheduledMaintenancePublicNote from "../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * A PUBLIC NOTE CARRIES THE STATE OF THE CHANGE IT WAS POSTED WITH, AND ONLY
 * THAT NOTE DOES.
 *
 * The public note a state change posts carries the state the event moved to
 * (IncidentPublicNote.postedWithIncidentState,
 * ScheduledMaintenancePublicNote.postedWithScheduledMaintenanceState), and
 * its subscriber messages name that state ("Status: Resolved"). Only the
 * state timeline service sets it, on the note it posts (StateChangePublicNote
 * .markPostedWith): a note from the Public Notes page, Slack, a workflow or
 * the API has none, whatever its create sends, so no message says a state
 * changed when it did not; and no update can write it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000002",
);
const EVENT_ID: ObjectID = new ObjectID("7d000000-0000-4000-8000-000000000003");
const STATE_ID: ObjectID = new ObjectID("7d000000-0000-4000-8000-000000000004");
const OTHER_STATE_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000005",
);

type Hook = (input: unknown) => Promise<unknown>;

function hookOf(service: unknown, name: string): Hook {
  return (service as Record<string, Hook>)[name]!.bind(service);
}

interface NoteCase {
  label: string;
  service: unknown;
  modelType: { new (): BaseModel };
  stateModelType: { new (): BaseModel };
  idColumn: string;
  relationColumn: string;
  // A note on its event, notifying, as a create would send it.
  newNote: () => BaseModel;
}

const NOTE_CASES: Array<NoteCase> = [
  {
    label: "IncidentPublicNote",
    service: IncidentPublicNoteService,
    modelType: IncidentPublicNote,
    stateModelType: IncidentState,
    idColumn: "postedWithIncidentStateId",
    relationColumn: "postedWithIncidentState",
    newNote: (): BaseModel => {
      const note: IncidentPublicNote = new IncidentPublicNote();
      note.incidentId = INCIDENT_ID;
      note.projectId = PROJECT_ID;
      note.note = "Rolled back.";
      note.shouldStatusPageSubscribersBeNotifiedOnNoteCreated = true;
      return note;
    },
  },
  {
    label: "ScheduledMaintenancePublicNote",
    service: ScheduledMaintenancePublicNoteService,
    modelType: ScheduledMaintenancePublicNote,
    stateModelType: ScheduledMaintenanceState,
    idColumn: "postedWithScheduledMaintenanceStateId",
    relationColumn: "postedWithScheduledMaintenanceState",
    newNote: (): BaseModel => {
      const note: ScheduledMaintenancePublicNote =
        new ScheduledMaintenancePublicNote();
      note.scheduledMaintenanceId = EVENT_ID;
      note.projectId = PROJECT_ID;
      note.note = "The upgrade has started.";
      note.shouldStatusPageSubscribersBeNotifiedOnNoteCreated = true;
      return note;
    },
  },
];

function memberProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: new ObjectID("7d000000-0000-4000-8000-0000000000aa"),
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        _type: "UserTenantAccessPermission",
        permissions: [
          Permission.CurrentUser,
          Permission.ProjectUser,
          ...permissions,
        ].map((permission: Permission): UserPermission => {
          return {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
            scope: PermissionScope.All,
          };
        }),
      },
    },
  };
}

beforeEach(() => {
  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(NOTE_CASES)("$label", (noteCase: NoteCase) => {
  async function create(
    note: BaseModel,
    props: DatabaseCommonInteractionProps = {
      isRoot: true,
      tenantId: PROJECT_ID,
    },
  ): Promise<Record<string, unknown>> {
    const result: { createBy: { data: BaseModel } } = (await hookOf(
      noteCase.service,
      "onBeforeCreate",
    )({ data: note, props: props })) as { createBy: { data: BaseModel } };

    return result.createBy.data as unknown as Record<string, unknown>;
  }

  test("the note a state change posts keeps the state it moved to", async () => {
    const note: BaseModel = noteCase.newNote();
    StateChangePublicNote.markPostedWith(note, STATE_ID);

    const created: Record<string, unknown> = await create(note);

    expect(String(created[noteCase.idColumn])).toBe(STATE_ID.toString());
    expect(created[noteCase.relationColumn]).toBeUndefined();
  });

  test("a note posted on its own has none", async () => {
    const created: Record<string, unknown> = await create(noteCase.newNote());

    expect(created[noteCase.idColumn]).toBeNull();
  });

  test("a state a create sends itself is not kept, under either name", async () => {
    const byId: BaseModel = noteCase.newNote();
    (byId as unknown as Record<string, unknown>)[noteCase.idColumn] = STATE_ID;

    expect((await create(byId))[noteCase.idColumn]).toBeNull();

    const byRelation: BaseModel = noteCase.newNote();
    const state: BaseModel = new noteCase.stateModelType();
    state._id = STATE_ID.toString();
    (byRelation as unknown as Record<string, unknown>)[
      noteCase.relationColumn
    ] = state;

    const created: Record<string, unknown> = await create(byRelation);
    expect(created[noteCase.idColumn]).toBeNull();
    expect(created[noteCase.relationColumn]).toBeUndefined();
  });

  test("a state change's note keeps its own state, whatever else the create carries", async () => {
    const note: BaseModel = noteCase.newNote();
    (note as unknown as Record<string, unknown>)[noteCase.idColumn] =
      OTHER_STATE_ID;
    StateChangePublicNote.markPostedWith(note, STATE_ID);

    expect(String((await create(note))[noteCase.idColumn])).toBe(
      STATE_ID.toString(),
    );
  });

  test("the mark is on that one note: another note, even one just like it, has none", async () => {
    const marked: BaseModel = noteCase.newNote();
    StateChangePublicNote.markPostedWith(marked, STATE_ID);

    expect(StateChangePublicNote.getStatePostedWith(marked)?.toString()).toBe(
      STATE_ID.toString(),
    );
    expect(StateChangePublicNote.getStatePostedWith(noteCase.newNote())).toBe(
      null,
    );
    expect(StateChangePublicNote.getStatePostedWith(null)).toBeNull();

    expect((await create(noteCase.newNote()))[noteCase.idColumn]).toBeNull();
  });

  test("a person's create, as well as OneUptime's own, has none unless it is a state change's note", async () => {
    const note: BaseModel = noteCase.newNote();
    (note as unknown as Record<string, unknown>)[noteCase.idColumn] = STATE_ID;

    const created: Record<string, unknown> = await create(
      note,
      memberProps([Permission.ProjectMember]),
    );

    expect(created[noteCase.idColumn]).toBeNull();
  });

  test("no update can write it", () => {
    const update: BaseModel = new noteCase.modelType();
    (update as unknown as Record<string, unknown>)[noteCase.idColumn] =
      STATE_ID;

    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        noteCase.modelType,
        update,
        memberProps([Permission.ProjectOwner]),
        DatabaseRequestType.Update,
      );
    }).toThrow(BadDataException);
  });

  describe("the columns", () => {
    const model: BaseModel = new noteCase.modelType();

    test("are computed, kept out of the API reference, and never created or updated by a request", () => {
      for (const column of [noteCase.idColumn, noteCase.relationColumn]) {
        const metadata: TableColumnMetadata =
          model.getTableColumnMetadata(column);

        expect({ column, computed: metadata.computed }).toEqual({
          column,
          computed: true,
        });
        expect(metadata.hideColumnInDocumentation).toBe(true);

        const access: {
          create?: Array<Permission>;
          update?: Array<Permission>;
          read?: Array<Permission>;
        } = model.getColumnAccessControlForAllColumns()[column] || {};

        expect(access.create).toEqual([]);
        expect(access.update).toEqual([]);
        // Read by whoever reads the note.
        expect([...(access.read || [])].sort()).toEqual(
          [...model.readRecordPermissions].sort(),
        );
      }
    });

    test("the relation names the event's state, by the ID column", () => {
      const relation: TableColumnMetadata = model.getTableColumnMetadata(
        noteCase.relationColumn,
      );

      expect(relation.type).toBe(TableColumnType.Entity);
      expect(relation.modelType).toBe(noteCase.stateModelType);
      expect(relation.manyToOneRelationColumn).toBe(noteCase.idColumn);
      expect(model.getTableColumnMetadata(noteCase.idColumn).type).toBe(
        TableColumnType.ObjectID,
      );
    });

    test("is nullable with no default, and a deleted state only clears it", () => {
      const column: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
        .columns.filter((args: ColumnMetadataArgs) => {
          return (
            args.target === noteCase.modelType &&
            args.propertyName === noteCase.idColumn
          );
        })
        .pop();

      expect(column?.options.nullable).toBe(true);
      expect(column?.options.default).toBeUndefined();

      const relation: RelationMetadataArgs | undefined =
        getMetadataArgsStorage()
          .relations.filter((args: RelationMetadataArgs) => {
            return (
              args.target === noteCase.modelType &&
              args.propertyName === noteCase.relationColumn
            );
          })
          .pop();

      expect(relation?.relationType).toBe("many-to-one");
      expect(relation?.options.onDelete).toBe("SET NULL");
      expect(relation?.options.nullable).toBe(true);
    });
  });
});

describe("AddPublicNotePostedWithState1798400000000", () => {
  function runnerRecording(): { runner: QueryRunner; sql: Array<string> } {
    const sql: Array<string> = [];

    return {
      runner: {
        query: async (statement: string): Promise<void> => {
          sql.push(statement);
        },
      } as unknown as QueryRunner,
      sql: sql,
    };
  }

  test("adds both columns, nullable with no default, each pointing at its state and cleared when the state goes", async () => {
    const { runner, sql } = runnerRecording();

    await new AddPublicNotePostedWithState1798400000000().up(runner);

    expect(sql).toEqual([
      `ALTER TABLE "IncidentPublicNote" ADD "postedWithIncidentStateId" uuid`,
      `ALTER TABLE "ScheduledMaintenancePublicNote" ADD "postedWithScheduledMaintenanceStateId" uuid`,
      `ALTER TABLE "IncidentPublicNote" ADD CONSTRAINT "FK_9a4587dd87c6a5d311330ce2047" FOREIGN KEY ("postedWithIncidentStateId") REFERENCES "IncidentState"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
      `ALTER TABLE "ScheduledMaintenancePublicNote" ADD CONSTRAINT "FK_42c99ea57184760261a21b6b721" FOREIGN KEY ("postedWithScheduledMaintenanceStateId") REFERENCES "ScheduledMaintenanceState"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    ]);
  });

  test("down() removes exactly what up() added, in reverse", async () => {
    const { runner, sql } = runnerRecording();

    await new AddPublicNotePostedWithState1798400000000().down(runner);

    expect(sql).toEqual([
      `ALTER TABLE "ScheduledMaintenancePublicNote" DROP CONSTRAINT "FK_42c99ea57184760261a21b6b721"`,
      `ALTER TABLE "IncidentPublicNote" DROP CONSTRAINT "FK_9a4587dd87c6a5d311330ce2047"`,
      `ALTER TABLE "ScheduledMaintenancePublicNote" DROP COLUMN "postedWithScheduledMaintenanceStateId"`,
      `ALTER TABLE "IncidentPublicNote" DROP COLUMN "postedWithIncidentStateId"`,
    ]);
  });

  test("is registered, so it runs on boot, and named for its timestamp", () => {
    expect(SchemaMigrations).toContain(
      AddPublicNotePostedWithState1798400000000,
    );
    expect(new AddPublicNotePostedWithState1798400000000().name).toBe(
      "AddPublicNotePostedWithState1798400000000",
    );
  });
});
