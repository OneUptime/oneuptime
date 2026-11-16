import Models from "../../../Models/DatabaseModels/Index";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import ComputedColumnsReplacedOnCreate, {
  COMPUTED_COLUMNS_REPLACED_ON_CREATE,
  ComputedColumnReplacedOnCreate,
} from "../../../Server/Types/Database/Permissions/ComputedColumnsReplacedOnCreate";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import ServerSetColumns from "../../../Server/Utils/Database/ServerSetColumns";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  PermissionProps,
  UserPermission,
} from "../../../Types/Permission";
import { ON_HIGHEST_PLAN } from "../../Server/TestingUtils/RequestPlan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A SERVER-SET COLUMN FOLLOWS ITS CREATE LIST, IN EVERY MODEL.
 *
 * A column marked computed is one OneUptime fills in. A create's column
 * check used to let every such column through, whatever its create list
 * said, because the check runs after the create's hooks, and the hooks fill
 * most of them in: a value the caller sent there was kept whenever the
 * service did not write over it (#6541). Now a value a create gives one is
 * held to the column's create list before the hooks run
 * (ColumnPermission.checkComputedColumnsSentOnCreate), and the check after
 * them lets through only what the create's own steps wrote
 * (checkDataColumnPermissions' columnsSetByServer) or OneUptime's own code
 * marked (ServerSetColumns).
 *
 * This holds every computed column of every model to that, as the models
 * declare them, so a column added tomorrow is held to it the day it is
 * declared:
 *
 *   - one nobody may create is refused, with its name, to a member holding
 *     every permission a team can be given - unless it is one of the columns
 *     whose value is replaced (ComputedColumnsReplacedOnCreate), which is
 *     dropped instead;
 *   - one some may create is taken from each permission that may create its
 *     table that the column's list names, and refused to each one it does
 *     not;
 *   - the check of the record as written lets it through only as one the
 *     create's own steps wrote, or one OneUptime's code marked;
 *   - the ones the check never weighs are ones OneUptime writes on every
 *     create anyway: a slug the model's slugify column writes, a forced
 *     default.
 */

type ModelType = DatabaseBaseModelType;

const PROJECT_ID: ObjectID = new ObjectID(
  "6541c0de-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("6541c0de-0000-4000-8000-000000000002");

// A value no column would hold by itself: what a caller made up.
const SENT: string = "a value the caller made up";

// Every permission a team can be given in a project.
const GRANTABLE: Array<Permission> = PermissionHelper.getTenantPermissionProps()
  .map((props: PermissionProps): Permission => {
    return props.permission;
  })
  .sort();

// Held by every signed-in person, whatever their project gives them.
const HELD_BY_EVERY_PERSON: ReadonlyArray<Permission> = [
  Permission.Public,
  Permission.CurrentUser,
  Permission.User,
  Permission.AuthenticatedRequest,
];

// The columns every model has, which no column check weighs.
const EXCLUDED_COLUMNS: Array<string> = ColumnPermissions.getExcludedColumnNames();

function memberWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    ...ON_HIGHEST_PLAN,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      globalPermissions: [...HELD_BY_EVERY_PERSON],
      projectIds: [PROJECT_ID],
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map((permission: Permission): UserPermission => {
          return {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          };
        }),
      },
    },
  };
}

interface ComputedColumn {
  table: string;
  column: string;
  modelType: ModelType;
  metadata: TableColumnMetadata;
  create: Array<Permission>;
}

function tableOf(modelType: ModelType): string {
  return new modelType().tableName || modelType.name;
}

// Every computed column of every model, as the models declare them.
const COMPUTED_COLUMNS: Array<ComputedColumn> = (Models as Array<ModelType>)
  .flatMap((modelType: ModelType): Array<ComputedColumn> => {
    const model: DatabaseBaseModel = new modelType();

    return model
      .getTableColumns()
      .columns.filter((column: string): boolean => {
        return Boolean(model.getTableColumnMetadata(column)?.computed);
      })
      .map((column: string): ComputedColumn => {
        const accessControl: ColumnAccessControl | null =
          model.getColumnAccessControlFor(column);

        return {
          table: tableOf(modelType),
          column: column,
          modelType: modelType,
          metadata: model.getTableColumnMetadata(column),
          create: accessControl?.create || [],
        };
      });
  })
  // A model listed twice in the index is one model.
  .filter(
    (entry: ComputedColumn, index: number, all: Array<ComputedColumn>) => {
      return (
        all.findIndex((other: ComputedColumn): boolean => {
          return other.table === entry.table && other.column === entry.column;
        }) === index
      );
    },
  );

// Whether the create's check weighs the column: what ColumnPermission asks of.
function isWeighed(entry: ComputedColumn): boolean {
  const model: DatabaseBaseModel = new entry.modelType();
  const record: DatabaseBaseModel = new entry.modelType();
  (record as unknown as Record<string, unknown>)[entry.column] = SENT;

  return ColumnPermissions.getComputedColumnsWithValue(model, record).includes(
    entry.column,
  );
}

const WEIGHED: Array<ComputedColumn> = COMPUTED_COLUMNS.filter(isWeighed);

const NOT_WEIGHED: Array<ComputedColumn> = COMPUTED_COLUMNS.filter(
  (entry: ComputedColumn): boolean => {
    return !isWeighed(entry);
  },
);

// Whether a member holding `permissions` holds one of the column's create list.
function isOnTheList(
  entry: ComputedColumn,
  permissions: Array<Permission>,
): boolean {
  return entry.create.some((permission: Permission): boolean => {
    return (
      permissions.includes(permission) ||
      HELD_BY_EVERY_PERSON.includes(permission)
    );
  });
}

type Outcome = "taken" | "dropped" | "refused";

// What the ask before the hooks does with a create that gives `entry` a value.
function askBeforeHooks(
  entry: ComputedColumn,
  props: DatabaseCommonInteractionProps,
): Outcome {
  const record: DatabaseBaseModel = new entry.modelType();
  (record as unknown as Record<string, unknown>)[entry.column] = SENT;

  try {
    const sent: Array<string> = ColumnPermissions.checkComputedColumnsSentOnCreate(
      entry.modelType,
      record,
      props,
    );

    if (sent.includes(entry.column)) {
      expect(
        (record as unknown as Record<string, unknown>)[entry.column],
      ).toBe(SENT);
      return "taken";
    }

    // Not taken and not refused: it may only have been dropped.
    expect(
      (record as unknown as Record<string, unknown>)[entry.column],
    ).toBeUndefined();
    return "dropped";
  } catch (error) {
    if (
      error instanceof ColumnWriteRefusedException &&
      error.columnName === entry.column
    ) {
      return "refused";
    }

    throw error;
  }
}

// What the check of the record as written does with the column's value.
function askOfRecord(
  entry: ComputedColumn,
  props: DatabaseCommonInteractionProps,
  options: { setByServer?: boolean; marked?: boolean },
): "passes" | "refused" {
  const record: DatabaseBaseModel = new entry.modelType();
  (record as unknown as Record<string, unknown>)[entry.column] = SENT;

  if (options.marked) {
    ServerSetColumns.mark(record, [entry.column]);
  }

  try {
    ColumnPermissions.checkDataColumnPermissions(
      entry.modelType,
      record,
      props,
      DatabaseRequestType.Create,
      options.setByServer ? [entry.column] : [],
    );
  } catch (error) {
    if (
      error instanceof ColumnWriteRefusedException &&
      error.columnName === entry.column
    ) {
      return "refused";
    }

    throw error;
  }

  return "passes";
}

function nameOf(entry: ComputedColumn): string {
  return `${entry.table}.${entry.column}`;
}

describe("the computed columns, as the models declare them", () => {
  test("there are hundreds, so a rule that misses one would go unseen", () => {
    expect(WEIGHED.length).toBeGreaterThan(500);
  });

  /*
   * The ones the check never weighs - every model's own bookkeeping
   * columns, a slug, a forced default - take no value from anyone on a
   * create: OneUptime writes each one itself.
   */
  test("a column the check never weighs is one OneUptime writes on every create", () => {
    const unexplained: Array<string> = NOT_WEIGHED.filter(
      (entry: ComputedColumn): boolean => {
        if (EXCLUDED_COLUMNS.includes(entry.column)) {
          return false;
        }

        if (entry.metadata.forceGetDefaultValueOnCreate) {
          return false;
        }

        // A slug is written by the model's slugify column (DatabaseService.generateSlug).
        if (
          entry.metadata.type === TableColumnType.Slug &&
          new entry.modelType().getSaveSlugToColumn() === entry.column
        ) {
          return false;
        }

        return true;
      },
    ).map(nameOf);

    expect(unexplained).toEqual([]);
  });

  test("a slug column is the one its model's slugify column writes", () => {
    const slugs: Array<ComputedColumn> = NOT_WEIGHED.filter(
      (entry: ComputedColumn): boolean => {
        return entry.metadata.type === TableColumnType.Slug;
      },
    );

    expect(slugs.length).toBeGreaterThan(0);

    for (const slug of slugs) {
      const model: DatabaseBaseModel = new slug.modelType();

      expect({
        column: nameOf(slug),
        writtenBy: model.getSlugifyColumn() ? model.getSaveSlugToColumn() : null,
      }).toEqual({ column: nameOf(slug), writtenBy: slug.column });
    }
  });
});

describe("a create that gives a computed column nobody may create a value", () => {
  const NOBODY: Array<ComputedColumn> = WEIGHED.filter(
    (entry: ComputedColumn): boolean => {
      return entry.create.length === 0;
    },
  );

  const EVERYTHING: DatabaseCommonInteractionProps = memberWith(GRANTABLE);

  test("they are most of the computed columns", () => {
    expect(NOBODY.length).toBeGreaterThan(400);
  });

  test("is refused with the column's name, even to a member who holds every permission - or the value is dropped, for a column whose value is replaced", () => {
    const outcomes: Array<{ column: string; outcome: Outcome }> = NOBODY.map(
      (entry: ComputedColumn) => {
        return {
          column: nameOf(entry),
          outcome: askBeforeHooks(entry, memberWith(GRANTABLE)),
        };
      },
    );

    const expected: Array<{ column: string; outcome: Outcome }> = NOBODY.map(
      (entry: ComputedColumn) => {
        return {
          column: nameOf(entry),
          outcome: ComputedColumnsReplacedOnCreate.isReplaced(
            entry.table,
            entry.column,
          )
            ? "dropped"
            : "refused",
        };
      },
    );

    expect(outcomes).toEqual(expected);
  });

  test("is refused to every permission that may create the column's table", () => {
    const taken: Array<string> = [];

    for (const entry of NOBODY) {
      const creators: Array<Permission> = TablePermission.getTablePermission(
        entry.modelType,
        DatabaseRequestType.Create,
      );

      for (const creator of creators) {
        const outcome: Outcome = askBeforeHooks(entry, memberWith([creator]));

        if (outcome === "taken") {
          taken.push(`${nameOf(entry)} from ${creator}`);
        }
      }
    }

    expect(taken).toEqual([]);
  });

  test("is refused again by the check of the record as written, unless the create's own steps wrote it, or OneUptime's code marked it", () => {
    const wrong: Array<string> = [];

    for (const entry of NOBODY) {
      if (askOfRecord(entry, EVERYTHING, {}) !== "refused") {
        wrong.push(`${nameOf(entry)}: a caller's value passed`);
      }

      if (askOfRecord(entry, EVERYTHING, { setByServer: true }) !== "passes") {
        wrong.push(`${nameOf(entry)}: a value the create wrote was refused`);
      }

      if (askOfRecord(entry, EVERYTHING, { marked: true }) !== "passes") {
        wrong.push(`${nameOf(entry)}: a value OneUptime marked was refused`);
      }
    }

    expect(wrong).toEqual([]);
  });
});

describe("a create that gives a computed column some may create a value", () => {
  const SOME: Array<ComputedColumn> = WEIGHED.filter(
    (entry: ComputedColumn): boolean => {
      return entry.create.length > 0;
    },
  );

  test("there are such columns", () => {
    expect(SOME.length).toBeGreaterThan(0);
  });

  test("is taken from each permission that may create the table that the column's list names, and refused to each one it does not", () => {
    const wrong: Array<string> = [];

    for (const entry of SOME) {
      const creators: Array<Permission> = TablePermission.getTablePermission(
        entry.modelType,
        DatabaseRequestType.Create,
      );

      for (const creator of creators) {
        const outcome: Outcome = askBeforeHooks(entry, memberWith([creator]));
        const expected: Outcome = isOnTheList(entry, [creator])
          ? "taken"
          : ComputedColumnsReplacedOnCreate.isReplaced(entry.table, entry.column)
            ? "dropped"
            : "refused";

        if (outcome !== expected) {
          wrong.push(
            `${nameOf(entry)} from ${creator}: ${outcome}, not ${expected}`,
          );
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  test("a permission on the list passes the check of the record as written too", () => {
    const wrong: Array<string> = [];

    for (const entry of SOME) {
      const onTheList: Array<Permission> = entry.create.filter(
        (permission: Permission): boolean => {
          return GRANTABLE.includes(permission);
        },
      );

      if (onTheList.length === 0) {
        continue;
      }

      if (askOfRecord(entry, memberWith(onTheList), {}) !== "passes") {
        wrong.push(nameOf(entry));
      }
    }

    expect(wrong).toEqual([]);
  });
});

describe("OneUptime itself and a server admin", () => {
  test.each([
    ["OneUptime itself", { isRoot: true }],
    ["a server admin", { isMasterAdmin: true, userId: USER_ID }],
  ])(
    "%s may give any computed column a value: no column check asks them",
    (_who: string, props: DatabaseCommonInteractionProps) => {
      for (const entry of WEIGHED) {
        const record: DatabaseBaseModel = new entry.modelType();
        (record as unknown as Record<string, unknown>)[entry.column] = SENT;

        expect(
          ColumnPermissions.checkComputedColumnsSentOnCreate(
            entry.modelType,
            record,
            props,
          ),
        ).toEqual([]);
        expect(
          (record as unknown as Record<string, unknown>)[entry.column],
        ).toBe(SENT);
      }
    },
  );
});

describe("the columns whose value a create sends is replaced", () => {
  test("are few, and each is named once", () => {
    const names: Array<string> = COMPUTED_COLUMNS_REPLACED_ON_CREATE.map(
      (entry: ComputedColumnReplacedOnCreate): string => {
        return `${entry.tableName}.${entry.column}`;
      },
    );

    expect(names.length).toBeLessThanOrEqual(5);
    expect(new Set(names).size).toBe(names.length);
  });

  test.each(
    COMPUTED_COLUMNS_REPLACED_ON_CREATE.map(
      (entry: ComputedColumnReplacedOnCreate) => {
        return [`${entry.tableName}.${entry.column}`, entry];
      },
    ),
  )(
    "%s is a computed column nobody may create, and says why it is replaced",
    (_name: string, replaced: ComputedColumnReplacedOnCreate) => {
      const entry: ComputedColumn | undefined = COMPUTED_COLUMNS.find(
        (column: ComputedColumn): boolean => {
          return (
            column.table === replaced.tableName &&
            column.column === replaced.column
          );
        },
      );

      expect(entry).toBeDefined();
      expect(entry!.create).toEqual([]);
      expect(isWeighed(entry!)).toBe(true);
      expect(replaced.why.length).toBeGreaterThan(40);
    },
  );
});

describe("what OneUptime's own code marks on a record", () => {
  const entry: ComputedColumn = WEIGHED.find((column: ComputedColumn) => {
    return column.create.length === 0 && !isReplacedEntry(column);
  })!;

  function isReplacedEntry(column: ComputedColumn): boolean {
    return ComputedColumnsReplacedOnCreate.isReplaced(
      column.table,
      column.column,
    );
  }

  test("passes on the record it marked, and on no other record", () => {
    const marked: DatabaseBaseModel = new entry.modelType();
    ServerSetColumns.set(marked, { [entry.column]: SENT });

    const unmarked: DatabaseBaseModel = new entry.modelType();
    (unmarked as unknown as Record<string, unknown>)[entry.column] = SENT;

    const props: DatabaseCommonInteractionProps = memberWith(GRANTABLE);

    expect(
      ColumnPermissions.checkComputedColumnsSentOnCreate(
        entry.modelType,
        marked,
        props,
      ),
    ).toEqual([]);
    expect(() => {
      ColumnPermissions.checkComputedColumnsSentOnCreate(
        entry.modelType,
        unmarked,
        props,
      );
    }).toThrow(ColumnWriteRefusedException);
  });
});

/*
 * A mark is made by OneUptime's own server code, on a record it builds: the
 * code that turns what a request sent into a record never makes one.
 */
describe("nothing that builds a record from what was sent marks one", () => {
  const COMMON: string = path.join(__dirname, "..", "..", "..");

  const BUILDERS_OF_SENT_RECORDS: Array<string> = [
    "Server/API/BaseAPI.ts",
    "Server/Types/Workflow/Components/BaseModel/CreateOneBaseModel.ts",
    "Server/Types/Workflow/Components/BaseModel/CreateManyBaseModel.ts",
    "Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel.ts",
    "Utils/ModelImportExport.ts",
  ];

  test.each(BUILDERS_OF_SENT_RECORDS)(
    "%s never marks a column as OneUptime's",
    (file: string) => {
      const source: string = fs.readFileSync(path.join(COMMON, file), "utf8");

      expect(source).not.toContain("ServerSetColumns");
    },
  );

  test("no browser code can make one", () => {
    const uiFiles: Array<string> = [];

    const walk: (directory: string) => void = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full: string = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          if (entry.name !== "node_modules") {
            walk(full);
          }
          continue;
        }

        if (/\.(ts|tsx)$/.test(entry.name)) {
          uiFiles.push(full);
        }
      }
    };

    walk(path.join(COMMON, "UI"));

    const marking: Array<string> = uiFiles.filter((file: string): boolean => {
      return fs.readFileSync(file, "utf8").includes("ServerSetColumns");
    });

    expect(uiFiles.length).toBeGreaterThan(100);
    expect(marking).toEqual([]);
  });
});
