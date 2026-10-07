import CallerPlan from "../../../../../Server/Utils/Billing/CallerPlan";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import AccessControlPermission from "../../../../../Server/Types/Database/Permissions/AccessControlPermission";
import BasePermission from "../../../../../Server/Types/Database/Permissions/BasePermission";
import DeletePermission from "../../../../../Server/Types/Database/Permissions/DeletePermission";
import UpdatePermission from "../../../../../Server/Types/Database/Permissions/UpdatePermission";
import ReadPermission, {
  CheckReadPermissionType,
} from "../../../../../Server/Types/Database/Permissions/ReadPermission";
import TenantPermission from "../../../../../Server/Types/Database/Permissions/TenantPermission";
import Query from "../../../../../Server/Types/Database/Query";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../../../Models/DatabaseModels/IncidentInternalNote";
import Label from "../../../../../Models/DatabaseModels/Label";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { withLabelJoinTables } from "../../../TestingUtils/LabelJoinTables";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * ONE RULE FOR THE RECORDS A READ, AN UPDATE OR A DELETE REACHES
 * (BasePermission.addRecordScopeToQuery), asked with the permissions of the
 * operation at hand:
 *
 *   - a block with no labels on one of them takes the table away;
 *   - a block with labels leaves out the records carrying them, and the
 *     records of a label-less model that belong to such a record (an
 *     incident's internal notes);
 *   - grants limited to labels keep only the records carrying them, and the
 *     records of a label-less model whose records carry them;
 *   - in a read across projects, each project's rows are narrowed by that
 *     project's own rows, a few projects at a time;
 *   - a record checked by id is read in the caller's project only.
 *
 * The label join tables are named as a migrated database names them
 * (withLabelJoinTables); the conditions are checked as the SQL they become.
 */

type Operation =
  | DatabaseRequestType.Read
  | DatabaseRequestType.Update
  | DatabaseRequestType.Delete;

const OPERATIONS: Array<Operation> = [
  DatabaseRequestType.Read,
  DatabaseRequestType.Update,
  DatabaseRequestType.Delete,
];

// The note permission each operation asks for.
const NOTE_PERMISSION: Record<Operation, Permission> = {
  [DatabaseRequestType.Read]: Permission.ReadIncidentInternalNote,
  [DatabaseRequestType.Update]: Permission.EditIncidentInternalNote,
  [DatabaseRequestType.Delete]: Permission.DeleteIncidentInternalNote,
};

const projectId: ObjectID = ObjectID.generate();
const secondProjectId: ObjectID = ObjectID.generate();
const productionLabelId: ObjectID = ObjectID.generate();
const stagingLabelId: ObjectID = ObjectID.generate();

const row: (
  permission: Permission,
  data?: {
    labelIds?: Array<ObjectID>;
    isBlock?: boolean;
    scope?: PermissionScope;
  },
) => UserPermission = (
  permission: Permission,
  data?: {
    labelIds?: Array<ObjectID>;
    isBlock?: boolean;
    scope?: PermissionScope;
  },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: data?.labelIds || [],
    isBlockPermission: Boolean(data?.isBlock),
    ...(data?.scope ? { scope: data.scope } : {}),
  };
};

const tenantPermission: (
  forProjectId: ObjectID,
  permissions: Array<UserPermission>,
) => UserTenantAccessPermission = (
  forProjectId: ObjectID,
  permissions: Array<UserPermission>,
): UserTenantAccessPermission => {
  return {
    _type: "UserTenantAccessPermission",
    projectId: forProjectId,
    permissions: permissions,
  };
};

// A member acting in one project with these permission rows.
const member: (
  permissions: Array<UserPermission>,
) => DatabaseCommonInteractionProps = (
  permissions: Array<UserPermission>,
): DatabaseCommonInteractionProps => {
  return {
    userId: ObjectID.generate(),
    userType: UserType.User,
    tenantId: projectId,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [projectId],
      globalPermissions: [Permission.Public, Permission.User],
    },
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission(projectId, permissions),
    },
  };
};

// A member reading across projects, with each project's own rows.
const acrossProjects: (
  rowsByProject: Array<[ObjectID, Array<UserPermission>]>,
) => DatabaseCommonInteractionProps = (
  rowsByProject: Array<[ObjectID, Array<UserPermission>]>,
): DatabaseCommonInteractionProps => {
  return {
    userId: ObjectID.generate(),
    userType: UserType.User,
    isMultiTenantRequest: true,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: rowsByProject.map(
        ([id]: [ObjectID, Array<UserPermission>]): ObjectID => {
          return id;
        },
      ),
      globalPermissions: [Permission.Public, Permission.User],
    },
    userTenantAccessPermission: Object.fromEntries(
      rowsByProject.map(
        ([id, permissions]: [ObjectID, Array<UserPermission>]): [
          string,
          UserTenantAccessPermission,
        ] => {
          return [id.toString(), tenantPermission(id, permissions)];
        },
      ),
    ),
  };
};

// The SQL a condition becomes, an AND of conditions joined.
const sqlOf: (condition: unknown, alias?: string) => string = (
  condition: unknown,
  alias: string = "key",
): string => {
  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  expect(operator).toBeInstanceOf(FindOperator);

  if (operator.type === "and") {
    return (operator.value as unknown as Array<unknown>)
      .map((part: unknown): string => {
        return sqlOf(part, alias);
      })
      .join(" AND ");
  }

  if (operator.type === "equal") {
    return `${alias} = '${String(operator.value)}'`;
  }

  return (operator as unknown as { getSql: (alias: string) => string }).getSql(
    alias,
  );
};

// Every value a condition binds, an AND of conditions included.
const valuesOf: (condition: unknown) => Array<string> = (
  condition: unknown,
): Array<string> => {
  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  if (operator.type === "and") {
    return (operator.value as unknown as Array<unknown>).flatMap(valuesOf);
  }

  if (operator.type === "equal") {
    return [String(operator.value)];
  }

  return Object.values(
    (
      operator as unknown as {
        objectLiteralParameters?: Record<string, unknown>;
      }
    ).objectLiteralParameters || {},
  )
    .flat()
    .map(String);
};

describe("the record rule on every operation", () => {
  beforeEach(() => {
    withLabelJoinTables();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("BasePermission.addRecordScopeToQuery", () => {
    test.each([
      ["a root caller", { isRoot: true }],
      ["a master admin", { isMasterAdmin: true }],
    ] as Array<[string, DatabaseCommonInteractionProps]>)(
      "leaves %s alone",
      async (_label: string, props: DatabaseCommonInteractionProps) => {
        for (const operation of OPERATIONS) {
          const query: Query<IncidentInternalNote> =
            await BasePermission.addRecordScopeToQuery(
              IncidentInternalNote,
              {},
              null,
              {
                ...member([
                  row(Permission.IncidentMember),
                  row(NOTE_PERMISSION[operation], { isBlock: true }),
                ]),
                ...props,
              },
              operation,
            );

          expect(query).toEqual({});
        }
      },
    );

    test("leaves a create alone: it names no record yet", async () => {
      const query: Query<IncidentInternalNote> =
        await BasePermission.addRecordScopeToQuery(
          IncidentInternalNote,
          {},
          null,
          member([
            row(Permission.IncidentMember),
            row(Permission.CreateIncidentInternalNote, { isBlock: true }),
          ]),
          DatabaseRequestType.Create,
        );

      expect(query).toEqual({});
    });

    test.each(OPERATIONS)(
      "a block with no labels on the %s permission takes the table away",
      async (operation: Operation) => {
        await expect(
          BasePermission.addRecordScopeToQuery(
            IncidentInternalNote,
            {},
            null,
            member([
              row(Permission.IncidentMember),
              row(NOTE_PERMISSION[operation], { isBlock: true }),
            ]),
            operation,
          ),
        ).rejects.toThrow(
          `because ${NOTE_PERMISSION[operation]} is in your team's permission block list`,
        );
      },
    );

    test.each(OPERATIONS)(
      "a block on the %s permission leaves the other operations alone",
      async (blocked: Operation) => {
        for (const operation of OPERATIONS) {
          if (operation === blocked) {
            continue;
          }

          const query: Query<IncidentInternalNote> =
            await BasePermission.addRecordScopeToQuery(
              IncidentInternalNote,
              {},
              null,
              member([
                row(Permission.IncidentMember),
                row(NOTE_PERMISSION[blocked], { isBlock: true }),
                row(NOTE_PERMISSION[blocked], {
                  isBlock: true,
                  labelIds: [productionLabelId],
                }),
              ]),
              operation,
            );

          expect(query).toEqual({});
        }
      },
    );

    test.each(OPERATIONS)(
      "a block with labels on the %s permission leaves out the notes of incidents carrying them",
      async (operation: Operation) => {
        const query: Query<IncidentInternalNote> =
          await BasePermission.addRecordScopeToQuery(
            IncidentInternalNote,
            {},
            null,
            member([
              row(Permission.IncidentMember),
              row(NOTE_PERMISSION[operation], {
                isBlock: true,
                labelIds: [productionLabelId],
              }),
            ]),
            operation,
          );

        const sql: string = sqlOf(query.incidentId, "note.incidentId");

        expect(sql).toContain(
          'note.incidentId NOT IN (SELECT "IncidentLabel"."incidentId" FROM "IncidentLabel"',
        );
        expect(valuesOf(query.incidentId)).toEqual([
          productionLabelId.toString(),
        ]);
      },
    );

    test.each(OPERATIONS)(
      "a block with labels on the %s permission leaves out the incidents carrying them",
      async (operation: Operation) => {
        const incidentPermission: Record<Operation, Permission> = {
          [DatabaseRequestType.Read]: Permission.ReadProjectIncident,
          [DatabaseRequestType.Update]: Permission.EditProjectIncident,
          [DatabaseRequestType.Delete]: Permission.DeleteProjectIncident,
        };

        const query: Query<Incident> =
          await BasePermission.addRecordScopeToQuery(
            Incident,
            {},
            null,
            member([
              row(Permission.IncidentMember),
              row(incidentPermission[operation], {
                isBlock: true,
                labelIds: [productionLabelId],
              }),
            ]),
            operation,
          );

        expect(sqlOf(query._id, "incident._id")).toContain(
          'incident._id NOT IN (SELECT "IncidentLabel"."incidentId" FROM "IncidentLabel"',
        );
        expect(valuesOf(query._id)).toEqual([productionLabelId.toString()]);
      },
    );

    test.each(OPERATIONS)(
      "grants limited to labels keep only the notes of incidents carrying them, on %s",
      async (operation: Operation) => {
        const query: Query<IncidentInternalNote> =
          await BasePermission.addRecordScopeToQuery(
            IncidentInternalNote,
            {},
            null,
            member([
              row(Permission.IncidentMember, {
                labelIds: [productionLabelId, stagingLabelId],
                scope: PermissionScope.Labels,
              }),
            ]),
            operation,
          );

        /*
         * One condition on the note's id, over every record it names: it
         * stays when it names none, or when its incident carries a label.
         */
        const sql: string = sqlOf(query._id, "note._id");

        expect(sql).toContain('("note"."incidentId" IS NULL)');
        expect(sql).toContain(
          'OR "note"."incidentId" IN (SELECT "IncidentLabel"."incidentId" FROM "IncidentLabel"',
        );
        expect(valuesOf(query._id).sort()).toEqual(
          [productionLabelId.toString(), stagingLabelId.toString()].sort(),
        );
        // The key itself is left as the caller named it: not at all.
        expect(query.incidentId).toBeUndefined();

        // And the incident it is read through carries one of them.
        expect(
          (
            (query as unknown as { incident: { labels: Array<ObjectID> } })
              .incident.labels || []
          )
            .map(String)
            .sort(),
        ).toEqual(
          [productionLabelId.toString(), stagingLabelId.toString()].sort(),
        );
      },
    );

    test("a grant over the project narrows nothing, whatever other grants are limited to", async () => {
      for (const operation of OPERATIONS) {
        const query: Query<IncidentInternalNote> =
          await BasePermission.addRecordScopeToQuery(
            IncidentInternalNote,
            {},
            null,
            member([
              row(Permission.IncidentMember),
              row(Permission.IncidentViewer, {
                labelIds: [productionLabelId],
                scope: PermissionScope.Labels,
              }),
            ]),
            operation,
          );

        expect(query.incidentId).toBeUndefined();
        expect(query._id).toBeUndefined();
      }
    });

    test("a grant limited to labels keeps the caller's own filter on the id next to the rule", async () => {
      const noteId: string = ObjectID.generate().toString();

      const query: Query<IncidentInternalNote> =
        await BasePermission.addRecordScopeToQuery(
          IncidentInternalNote,
          { _id: noteId } as Query<IncidentInternalNote>,
          null,
          member([
            row(Permission.IncidentMember, {
              labelIds: [productionLabelId],
              scope: PermissionScope.Labels,
            }),
          ]),
          DatabaseRequestType.Delete,
        );

      expect((query._id as unknown as FindOperator<unknown>).type).toBe("and");
      expect(sqlOf(query._id, "note._id")).toContain(`note._id = '${noteId}'`);
      expect(valuesOf(query._id)).toEqual([
        noteId,
        productionLabelId.toString(),
      ]);
    });

    test("keeps the caller's own filter on the key next to the rule", async () => {
      const incidentId: string = ObjectID.generate().toString();

      const query: Query<IncidentInternalNote> =
        await BasePermission.addRecordScopeToQuery(
          IncidentInternalNote,
          { incidentId: incidentId } as Query<IncidentInternalNote>,
          null,
          member([
            row(Permission.IncidentMember),
            row(Permission.EditIncidentInternalNote, {
              isBlock: true,
              labelIds: [productionLabelId],
            }),
          ]),
          DatabaseRequestType.Update,
        );

      expect((query.incidentId as FindOperator<unknown>).type).toBe("and");
      expect(valuesOf(query.incidentId)).toEqual([
        incidentId,
        productionLabelId.toString(),
      ]);
    });
  });

  describe("DeletePermission.checkDeletePermission", () => {
    test("narrows a delete by the record rule of a delete", async () => {
      const recordScope: ReturnType<typeof jest.spyOn> = jest.spyOn(
        BasePermission,
        "addRecordScopeToQuery",
      );

      const query: Query<IncidentInternalNote> =
        await DeletePermission.checkDeletePermission(
          IncidentInternalNote,
          {},
          member([
            row(Permission.IncidentMember),
            row(Permission.DeleteIncidentInternalNote, {
              isBlock: true,
              labelIds: [productionLabelId],
            }),
          ]),
        );

      expect(recordScope).toHaveBeenCalledWith(
        IncidentInternalNote,
        expect.anything(),
        null,
        expect.anything(),
        DatabaseRequestType.Delete,
      );
      expect(String(query.projectId)).toBe(projectId.toString());
      expect(sqlOf(query.incidentId, "note.incidentId")).toContain(
        "note.incidentId NOT IN",
      );
    });

    test("a block with no labels on the delete permission refuses a delete by query", async () => {
      await expect(
        DeletePermission.checkDeletePermission(
          IncidentInternalNote,
          {},
          member([
            row(Permission.IncidentMember),
            row(Permission.DeleteIncidentInternalNote, { isBlock: true }),
          ]),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    });

    test("grants limited to labels narrow a delete as they narrow a read", async () => {
      const query: Query<Incident> =
        await DeletePermission.checkDeletePermission(
          Incident,
          {},
          member([
            row(Permission.IncidentMember, {
              labelIds: [productionLabelId],
              scope: PermissionScope.Labels,
            }),
          ]),
        );

      expect(
        ((query as unknown as { labels: Array<ObjectID> }).labels || []).map(
          String,
        ),
      ).toEqual([productionLabelId.toString()]);
    });
  });

  /*
   * A RECORD READ THROUGH ITS PARENT (an incident's note) keeps to the
   * incidents the caller may read, on an update and a delete as on a read.
   * An update also keeps to the incidents the caller may edit, as it always
   * has; a delete weighs no delete grant on incidents - deleting a note is
   * the note's own permission.
   */
  describe("a record read through its parent, changed or deleted", () => {
    type Write = {
      noteQuery: (
        props: DatabaseCommonInteractionProps,
      ) => Promise<Query<IncidentInternalNote>>;
      notePermission: Permission;
    };

    const update: Write = {
      noteQuery: (
        props: DatabaseCommonInteractionProps,
      ): Promise<Query<IncidentInternalNote>> => {
        return UpdatePermission.getUpdatableQuery(
          IncidentInternalNote,
          {},
          props,
        );
      },
      notePermission: Permission.EditIncidentInternalNote,
    };

    const remove: Write = {
      noteQuery: (
        props: DatabaseCommonInteractionProps,
      ): Promise<Query<IncidentInternalNote>> => {
        return DeletePermission.checkDeletePermission(
          IncidentInternalNote,
          {},
          props,
        );
      },
      notePermission: Permission.DeleteIncidentInternalNote,
    };

    // The condition on the note's incident, as the write sends it.
    const incidentFilterOf: (
      query: Query<IncidentInternalNote>,
    ) => { labels?: Array<ObjectID>; _id?: unknown } | undefined = (
      query: Query<IncidentInternalNote>,
    ): { labels?: Array<ObjectID>; _id?: unknown } | undefined => {
      return (query as Record<string, unknown>)["incident"] as
        | { labels?: Array<ObjectID>; _id?: unknown }
        | undefined;
    };

    test.each([
      ["an update", update],
      ["a delete", remove],
    ] as Array<[string, Write]>)(
      "%s of a note reaches only the incidents the caller may read",
      async (_label: string, write: Write) => {
        const query: Query<IncidentInternalNote> = await write.noteQuery(
          member([
            row(Permission.ReadProjectIncident, {
              labelIds: [productionLabelId],
              scope: PermissionScope.Labels,
            }),
            row(Permission.ReadIncidentInternalNote),
            row(write.notePermission),
          ]),
        );

        expect((incidentFilterOf(query)?.labels || []).map(String)).toEqual([
          productionLabelId.toString(),
        ]);
      },
    );

    test("a delete of a note is not narrowed by the incident's delete grants", async () => {
      const query: Query<IncidentInternalNote> = await remove.noteQuery(
        member([
          row(Permission.ReadProjectIncident),
          row(Permission.DeleteProjectIncident, {
            labelIds: [productionLabelId],
            scope: PermissionScope.Labels,
          }),
          row(Permission.DeleteIncidentInternalNote),
        ]),
      );

      expect(incidentFilterOf(query)).toBeUndefined();
      expect((query as Record<string, unknown>)["_id"]).toBeUndefined();
      expect(String(query.projectId)).toBe(projectId.toString());
    });

    test("an update of a note keeps to the incidents the caller may edit, as it always has", async () => {
      const query: Query<IncidentInternalNote> = await update.noteQuery(
        member([
          row(Permission.ReadProjectIncident),
          row(Permission.EditProjectIncident, {
            labelIds: [productionLabelId],
            scope: PermissionScope.Labels,
          }),
          row(Permission.ReadIncidentInternalNote),
          row(Permission.EditIncidentInternalNote),
        ]),
      );

      expect((incidentFilterOf(query)?.labels || []).map(String)).toEqual([
        productionLabelId.toString(),
      ]);
      expect(incidentFilterOf(query)?._id).toBeUndefined();
    });

    test("an update of a note keeps to the incidents the caller may both read and edit", async () => {
      const query: Query<IncidentInternalNote> = await update.noteQuery(
        member([
          row(Permission.ReadProjectIncident, {
            labelIds: [productionLabelId],
            scope: PermissionScope.Labels,
          }),
          row(Permission.EditProjectIncident, {
            labelIds: [stagingLabelId],
            scope: PermissionScope.Labels,
          }),
          row(Permission.ReadIncidentInternalNote),
          row(Permission.EditIncidentInternalNote),
        ]),
      );

      // The incident carries a label the caller may edit...
      expect((incidentFilterOf(query)?.labels || []).map(String)).toEqual([
        stagingLabelId.toString(),
      ]);
      // ...and one the caller may read.
      expect(valuesOf(incidentFilterOf(query)?._id)).toEqual([
        productionLabelId.toString(),
      ]);
      expect(sqlOf(incidentFilterOf(query)?._id, "incident._id")).toContain(
        'incident._id IN (SELECT "IncidentLabel"."incidentId" FROM "IncidentLabel"',
      );
    });

    test("an update of one note keeps the note's incident filter beside the rule", async () => {
      const incidentId: ObjectID = ObjectID.generate();

      const query: Query<IncidentInternalNote> =
        await UpdatePermission.getUpdatableQuery(
          IncidentInternalNote,
          { incident: incidentId } as Query<IncidentInternalNote>,
          member([
            row(Permission.ReadProjectIncident, {
              labelIds: [productionLabelId],
              scope: PermissionScope.Labels,
            }),
            row(Permission.EditProjectIncident, {
              labelIds: [stagingLabelId],
              scope: PermissionScope.Labels,
            }),
            row(Permission.ReadIncidentInternalNote),
            row(Permission.EditIncidentInternalNote),
          ]),
        );

      // The incident asked for, and the one the caller may read, together.
      expect(valuesOf(incidentFilterOf(query)?._id)).toEqual([
        incidentId.toString(),
        productionLabelId.toString(),
      ]);
    });
  });

  describe("DeletePermission.checkDeletePermission, as root", () => {
    test("a root delete keeps to the request's project only", async () => {
      const recordScope: ReturnType<typeof jest.spyOn> = jest.spyOn(
        BasePermission,
        "addRecordScopeToQuery",
      );

      const query: Query<IncidentInternalNote> =
        await DeletePermission.checkDeletePermission(
          IncidentInternalNote,
          {},
          { isRoot: true, tenantId: projectId },
        );

      expect(recordScope).not.toHaveBeenCalled();
      expect(String(query.projectId)).toBe(projectId.toString());
    });
  });

  describe("a read across projects", () => {
    const readIncidents: (
      props: DatabaseCommonInteractionProps,
    ) => Promise<Array<Query<Incident>>> = async (
      props: DatabaseCommonInteractionProps,
    ): Promise<Array<Query<Incident>>> => {
      const result: CheckReadPermissionType<Incident> =
        await ModelPermission.checkReadQueryPermission(
          Incident,
          {},
          { _id: true, title: true },
          props,
        );

      return result.query as unknown as Array<Query<Incident>>;
    };

    const queryOf: (
      queries: Array<Query<Incident>>,
      forProjectId: ObjectID,
    ) => Query<Incident> | undefined = (
      queries: Array<Query<Incident>>,
      forProjectId: ObjectID,
    ): Query<Incident> | undefined => {
      return queries.find((query: Query<Incident>): boolean => {
        return valuesOf(query.projectId).includes(forProjectId.toString());
      });
    };

    test("narrows each project's rows by that project's own blocks", async () => {
      const queries: Array<Query<Incident>> = await readIncidents(
        acrossProjects([
          [
            projectId,
            [
              row(Permission.IncidentMember),
              row(Permission.ReadProjectIncident, {
                isBlock: true,
                labelIds: [productionLabelId],
              }),
            ],
          ],
          [secondProjectId, [row(Permission.IncidentMember)]],
        ]),
      );

      expect(queries).toHaveLength(2);
      expect(valuesOf(queryOf(queries, projectId)!._id)).toEqual([
        productionLabelId.toString(),
      ]);
      expect(queryOf(queries, secondProjectId)!._id).toBeUndefined();
    });

    test("narrows each project's rows by that project's own grants", async () => {
      const queries: Array<Query<Incident>> = await readIncidents(
        acrossProjects([
          [projectId, [row(Permission.IncidentMember)]],
          [
            secondProjectId,
            [
              row(Permission.IncidentMember, {
                labelIds: [stagingLabelId],
                scope: PermissionScope.Labels,
              }),
            ],
          ],
        ]),
      );

      expect(
        (queryOf(queries, projectId) as unknown as { labels?: unknown }).labels,
      ).toBeUndefined();
      // Serialized as the labels' ids.
      expect(
        valuesOf(
          (
            queryOf(queries, secondProjectId) as unknown as {
              labels: { _id: unknown };
            }
          ).labels._id,
        ),
      ).toEqual([stagingLabelId.toString()]);
    });

    test("leaves out a project whose block refuses the read, and reads the others", async () => {
      const queries: Array<Query<Incident>> = await readIncidents(
        acrossProjects([
          [
            projectId,
            [
              row(Permission.IncidentMember),
              row(Permission.ReadProjectIncident, { isBlock: true }),
            ],
          ],
          [secondProjectId, [row(Permission.IncidentMember)]],
        ]),
      );

      expect(queries).toHaveLength(1);
      expect(valuesOf(queries[0]!.projectId)).toEqual([
        secondProjectId.toString(),
      ]);
    });

    test("refuses the read when every project refuses it", async () => {
      await expect(
        readIncidents(
          acrossProjects([
            [
              projectId,
              [
                row(Permission.IncidentMember),
                row(Permission.ReadProjectIncident, { isBlock: true }),
              ],
            ],
            [
              secondProjectId,
              [
                row(Permission.IncidentMember),
                row(Permission.ReadProjectIncident, { isBlock: true }),
              ],
            ],
          ]),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    });

    test("works the projects out a few at a time, every one of them", async () => {
      const projectIds: Array<ObjectID> = Array.from(
        { length: 11 },
        (): ObjectID => {
          return ObjectID.generate();
        },
      );

      let inFlight: number = 0;
      let mostInFlight: number = 0;

      const withPlanFor: typeof CallerPlan.withPlanFor =
        CallerPlan.withPlanFor.bind(CallerPlan);

      jest
        .spyOn(CallerPlan, "withPlanFor")
        .mockImplementation(
          async (
            data: Parameters<typeof CallerPlan.withPlanFor>[0],
          ): Promise<DatabaseCommonInteractionProps> => {
            inFlight++;
            mostInFlight = Math.max(mostInFlight, inFlight);

            await new Promise<void>((resolve: () => void) => {
              setTimeout(resolve, 5);
            });

            inFlight--;

            return await withPlanFor(data);
          },
        );

      const queries: Array<Query<Incident>> = await readIncidents(
        acrossProjects(
          projectIds.map((id: ObjectID): [ObjectID, Array<UserPermission>] => {
            return [id, [row(Permission.IncidentMember)]];
          }),
        ),
      );

      expect(queries).toHaveLength(projectIds.length);
      expect(mostInFlight).toBeGreaterThan(1);
      expect(mostInFlight).toBeLessThanOrEqual(
        TenantPermission.PROJECT_CONCURRENCY,
      );
    });
  });

  describe("a record checked by id", () => {
    const labelOf: (id: ObjectID, name: string) => Label = (
      id: ObjectID,
      name: string,
    ): Label => {
      const label: Label = new Label();
      label.id = id;
      label.name = name;
      return label;
    };

    const incidentIn: (
      inProjectId: ObjectID,
      labels: Array<Label>,
    ) => Incident = (inProjectId: ObjectID, labels: Array<Label>): Incident => {
      const incident: Incident = new Incident();
      incident.id = ObjectID.generate();
      incident.projectId = inProjectId;
      incident.labels = labels;
      return incident;
    };

    const noteIn: (inProjectId: ObjectID) => IncidentInternalNote = (
      inProjectId: ObjectID,
    ): IncidentInternalNote => {
      const note: IncidentInternalNote = new IncidentInternalNote();
      note.id = ObjectID.generate();
      note.projectId = inProjectId;
      return note;
    };

    test("another project's record is answered like a missing one, its labels unnamed", async () => {
      const otherProjectRecord: Incident = incidentIn(ObjectID.generate(), [
        labelOf(ObjectID.generate(), "Unrelated label name"),
      ]);

      for (const check of [
        (): Promise<void> => {
          return AccessControlPermission.checkAccessControlPermissionByModel({
            fetchModelWithAccessControlIds: async (): Promise<Incident> => {
              return otherProjectRecord;
            },
            modelType: Incident,
            props: member([
              row(Permission.IncidentMember, {
                labelIds: [productionLabelId],
                scope: PermissionScope.Labels,
              }),
            ]),
            type: DatabaseRequestType.Update,
          });
        },
        (): Promise<void> => {
          return AccessControlPermission.checkAccessControlBlockPermissionByModel(
            {
              fetchModelWithAccessControlIds: async (): Promise<Incident> => {
                return otherProjectRecord;
              },
              modelType: Incident,
              props: member([
                row(Permission.IncidentMember),
                row(Permission.DeleteProjectIncident, {
                  isBlock: true,
                  labelIds: [productionLabelId],
                }),
              ]),
              type: DatabaseRequestType.Delete,
            },
          );
        },
      ]) {
        const error: unknown = await check().catch((caught: unknown) => {
          return caught;
        });

        expect(error).toBeInstanceOf(BadDataException);
        expect((error as Error).message).toBe("Incident not found.");
        expect((error as Error).message).not.toContain("Unrelated label name");
      }
    });

    test("a record of the caller's project carrying a blocked label is refused", async () => {
      await expect(
        AccessControlPermission.checkAccessControlBlockPermissionByModel({
          fetchModelWithAccessControlIds: async (): Promise<Incident> => {
            return incidentIn(projectId, [
              labelOf(productionLabelId, "Production"),
            ]);
          },
          modelType: Incident,
          props: member([
            row(Permission.IncidentMember),
            row(Permission.EditProjectIncident, {
              isBlock: true,
              labelIds: [productionLabelId],
            }),
          ]),
          type: DatabaseRequestType.Update,
        }),
      ).rejects.toThrow(NotAuthorizedException);
    });

    test.each([
      [DatabaseRequestType.Update, Permission.EditIncidentInternalNote],
      [DatabaseRequestType.Delete, Permission.DeleteIncidentInternalNote],
    ] as Array<[Operation, Permission]>)(
      "a %s of a note whose incident carries a blocked label is refused",
      async (operation: Operation, permission: Permission) => {
        const note: IncidentInternalNote = noteIn(projectId);
        const asked: Array<Query<IncidentInternalNote>> = [];

        const check: (isFound: boolean) => Promise<void> = (
          isFound: boolean,
        ): Promise<void> => {
          return AccessControlPermission.checkAccessControlBlockPermissionByModel(
            {
              fetchModelWithAccessControlIds:
                async (): Promise<IncidentInternalNote> => {
                  return note;
                },
              isRecordFound: async (
                query: Query<IncidentInternalNote>,
              ): Promise<boolean> => {
                asked.push(query);
                return isFound;
              },
              modelType: IncidentInternalNote,
              props: member([
                row(Permission.IncidentMember),
                row(permission, {
                  isBlock: true,
                  labelIds: [productionLabelId],
                }),
              ]),
              type: operation,
            },
          );
        };

        await expect(check(false)).rejects.toThrow(
          `because ${permission} is in your team's permission block list`,
        );
        await expect(check(true)).resolves.toBeUndefined();

        // Asked for this note, under the block of the operation.
        expect(String(asked[0]!._id)).toBe(note.id!.toString());
        expect(valuesOf(asked[0]!.incidentId)).toEqual([
          productionLabelId.toString(),
        ]);
      },
    );

    test("a note is written under grants limited to labels only when its incident carries one", async () => {
      const note: IncidentInternalNote = noteIn(projectId);
      const asked: Array<Query<IncidentInternalNote>> = [];

      const check: (isFound: boolean) => Promise<void> = (
        isFound: boolean,
      ): Promise<void> => {
        return AccessControlPermission.checkAccessControlPermissionByModel({
          fetchModelWithAccessControlIds:
            async (): Promise<IncidentInternalNote> => {
              return note;
            },
          isRecordFound: async (
            query: Query<IncidentInternalNote>,
          ): Promise<boolean> => {
            asked.push(query);
            return isFound;
          },
          modelType: IncidentInternalNote,
          props: member([
            row(Permission.IncidentMember, {
              labelIds: [productionLabelId],
              scope: PermissionScope.Labels,
            }),
          ]),
          type: DatabaseRequestType.Update,
        });
      };

      await expect(check(false)).rejects.toThrow(
        "You do not have permission to update this Incident Internal Note.",
      );
      await expect(check(true)).resolves.toBeUndefined();

      expect(sqlOf(asked[0]!._id, "note._id")).toContain(
        'OR "note"."incidentId" IN (SELECT "IncidentLabel"."incidentId"',
      );
    });

    test("a note under a grant over the project is not looked up again", async () => {
      let lookups: number = 0;

      await AccessControlPermission.checkAccessControlPermissionByModel({
        fetchModelWithAccessControlIds:
          async (): Promise<IncidentInternalNote> => {
            return noteIn(projectId);
          },
        isRecordFound: async (): Promise<boolean> => {
          lookups++;
          return false;
        },
        modelType: IncidentInternalNote,
        props: member([row(Permission.IncidentMember)]),
        type: DatabaseRequestType.Update,
      });

      expect(lookups).toBe(0);
    });

    /*
     * The rule weighs every block row of the operation at once, so the
     * refusal names each of their permissions and says one of them holds.
     */
    test("a refusal under several block rows names each of their permissions", async () => {
      await expect(
        AccessControlPermission.checkAccessControlBlockPermissionByModel({
          fetchModelWithAccessControlIds:
            async (): Promise<IncidentInternalNote> => {
              return noteIn(projectId);
            },
          isRecordFound: async (): Promise<boolean> => {
            return false;
          },
          modelType: IncidentInternalNote,
          props: member([
            row(Permission.IncidentAdmin),
            row(Permission.EditIncidentInternalNote, {
              isBlock: true,
              labelIds: [productionLabelId],
            }),
            row(Permission.IncidentMember, {
              isBlock: true,
              labelIds: [stagingLabelId],
            }),
          ]),
          type: DatabaseRequestType.Update,
        }),
      ).rejects.toThrow(
        `because one of ${Permission.EditIncidentInternalNote}, ${Permission.IncidentMember} is in your team's permission block list`,
      );
    });

    test("a note's block check reads nothing when its caller cannot look the note up", async () => {
      let reads: number = 0;

      await AccessControlPermission.checkAccessControlBlockPermissionByModel({
        fetchModelWithAccessControlIds:
          async (): Promise<IncidentInternalNote> => {
            reads++;
            return noteIn(projectId);
          },
        modelType: IncidentInternalNote,
        props: member([
          row(Permission.IncidentMember),
          row(Permission.EditIncidentInternalNote, {
            isBlock: true,
            labelIds: [productionLabelId],
          }),
        ]),
        type: DatabaseRequestType.Update,
      });

      // The query the update runs with applies the rule instead.
      expect(reads).toBe(0);
    });

    test("an update by id reads the note once, for its blocks and its grants", async () => {
      let reads: number = 0;
      let lookups: number = 0;

      await AccessControlPermission.checkRecordByModel({
        fetchModelWithAccessControlIds:
          async (): Promise<IncidentInternalNote> => {
            reads++;
            return noteIn(projectId);
          },
        isRecordFound: async (): Promise<boolean> => {
          lookups++;
          return true;
        },
        modelType: IncidentInternalNote,
        props: member([
          row(Permission.IncidentMember, {
            labelIds: [productionLabelId],
            scope: PermissionScope.Labels,
          }),
          row(Permission.EditIncidentInternalNote, {
            isBlock: true,
            labelIds: [stagingLabelId],
          }),
        ]),
        type: DatabaseRequestType.Update,
      });

      expect(reads).toBe(1);
      // One question to the database per rule: the block, then the grant.
      expect(lookups).toBe(2);
    });
  });

  describe("the label rule's own reads", () => {
    test("reads the block rows of the operation's permissions only", () => {
      const props: DatabaseCommonInteractionProps = member([
        row(Permission.IncidentMember),
        row(Permission.ReadIncidentInternalNote, {
          isBlock: true,
          labelIds: [productionLabelId],
        }),
        row(Permission.DeleteIncidentInternalNote, {
          isBlock: true,
          labelIds: [stagingLabelId],
        }),
      ]);

      expect(
        ReadPermission.getBlockedLabelIds(
          IncidentInternalNote,
          props,
          DatabaseRequestType.Read,
        ).map(String),
      ).toEqual([productionLabelId.toString()]);
      expect(
        ReadPermission.getBlockedLabelIds(
          IncidentInternalNote,
          props,
          DatabaseRequestType.Delete,
        ).map(String),
      ).toEqual([stagingLabelId.toString()]);
      expect(
        ReadPermission.getBlockedLabelIds(
          IncidentInternalNote,
          props,
          DatabaseRequestType.Update,
        ),
      ).toEqual([]);
    });

    test("reads the labels grants are limited to, and none under a grant over the project", () => {
      expect(
        ReadPermission.getGrantedLabelIds(
          IncidentInternalNote,
          member([
            row(Permission.IncidentMember, {
              labelIds: [productionLabelId],
              scope: PermissionScope.Labels,
            }),
          ]),
          DatabaseRequestType.Update,
        ).map(String),
      ).toEqual([productionLabelId.toString()]);

      expect(
        ReadPermission.getGrantedLabelIds(
          IncidentInternalNote,
          member([
            row(Permission.IncidentMember, {
              labelIds: [productionLabelId],
              scope: PermissionScope.Labels,
            }),
            row(Permission.IncidentViewer),
          ]),
          DatabaseRequestType.Read,
        ),
      ).toEqual([]);

      // An owned-scope grant is weighed by owners, not labels.
      expect(
        ReadPermission.getGrantedLabelIds(
          IncidentInternalNote,
          member([
            row(Permission.IncidentMember, { scope: PermissionScope.Owned }),
          ]),
          DatabaseRequestType.Read,
        ),
      ).toEqual([]);
    });
  });
});
