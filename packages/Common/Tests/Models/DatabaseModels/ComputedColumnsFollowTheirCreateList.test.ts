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
 * declared. A value a caller may not create never reaches the record:
 *
 *   - it is refused, with the column's name, when the caller may not even
 *     read the column - the salts, tokens and verification state, which no
 *     record the caller could read carries - even to a member holding every
 *     permission a team can be given;
 *   - it is dropped, when the caller may read the column (a record read and
 *     sent back whole carries it), or the column is one whose value a create
 *     sends is replaced whoever sends it (ComputedColumnsReplacedOnCreate);
 *   - one some may create is taken from each permission that may create its
 *     table that the column's list names, and dropped or refused for each
 *     one it does not - and is one a creator chooses, named below with why
 *     (CHOSEN_ON_CREATE): every other computed column has an empty create
 *     list (#8907);
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
const EXCLUDED_COLUMNS: Array<string> =
  ColumnPermissions.getExcludedColumnNames();

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
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            };
          },
        ),
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
  read: Array<Permission>;
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
          read: accessControl?.read || [],
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

// Whether a member holding `permissions` holds one of `list`.
function holdsOneOf(
  list: Array<Permission>,
  permissions: Array<Permission>,
): boolean {
  return list.some((permission: Permission): boolean => {
    return (
      permissions.includes(permission) ||
      HELD_BY_EVERY_PERSON.includes(permission)
    );
  });
}

// Whether a member holding `permissions` holds one of the column's create list.
function isOnTheList(
  entry: ComputedColumn,
  permissions: Array<Permission>,
): boolean {
  return holdsOneOf(entry.create, permissions);
}

function isReplaced(entry: ComputedColumn): boolean {
  return ComputedColumnsReplacedOnCreate.isReplaced(entry.table, entry.column);
}

type Outcome = "taken" | "dropped" | "refused";

/*
 * What the rule says a create from a member holding `permissions` that gives
 * `entry` a value gets: taken from those on the column's create list;
 * dropped for those who may read the column, or for a column whose value is
 * replaced; refused to everyone else.
 */
function expectedOutcome(
  entry: ComputedColumn,
  permissions: Array<Permission>,
): Outcome {
  if (isOnTheList(entry, permissions)) {
    return "taken";
  }

  if (isReplaced(entry) || holdsOneOf(entry.read, permissions)) {
    return "dropped";
  }

  return "refused";
}

// What the ask before the hooks does with a create that gives `entry` a value.
function askBeforeHooks(
  entry: ComputedColumn,
  props: DatabaseCommonInteractionProps,
): Outcome {
  const record: DatabaseBaseModel = new entry.modelType();
  (record as unknown as Record<string, unknown>)[entry.column] = SENT;

  try {
    const sent: Array<string> =
      ColumnPermissions.checkComputedColumnsSentOnCreate(
        entry.modelType,
        record,
        props,
      );

    if (sent.includes(entry.column)) {
      expect((record as unknown as Record<string, unknown>)[entry.column]).toBe(
        SENT,
      );
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
        writtenBy: model.getSlugifyColumn()
          ? model.getSaveSlugToColumn()
          : null,
      }).toEqual({ column: nameOf(slug), writtenBy: slug.column });
    }
  });
});

/*
 * A reference has two names, its ID column and the relation over it
 * (`dataStoreId`, `dataStore`), and a create may send either: the ask before
 * the hooks fills the ID column in from the relation, and TypeORM stores the
 * relation in place of its ID column. Where one of the two is server-set, the
 * two take the same create list, so neither name lets in someone the other
 * keeps out: a value the rule drops under one name is refused under the
 * other, never stored.
 */
describe("the two names of a reference", () => {
  interface ReferenceNames {
    table: string;
    relation: string;
    idColumn: string;
    relationCreate: Array<Permission>;
    idColumnCreate: Array<Permission>;
  }

  const SERVER_SET_REFERENCES: Array<ReferenceNames> = (
    Models as Array<ModelType>
  ).flatMap((modelType: ModelType): Array<ReferenceNames> => {
    const model: DatabaseBaseModel = new modelType();

    return model
      .getTableColumns()
      .columns.flatMap((relation: string): Array<ReferenceNames> => {
        const idColumn: string | undefined =
          model.getTableColumnMetadata(relation)?.manyToOneRelationColumn;

        if (!idColumn || !model.getTableColumnMetadata(idColumn)) {
          return [];
        }

        if (
          !model.getTableColumnMetadata(relation).computed &&
          !model.getTableColumnMetadata(idColumn).computed
        ) {
          return [];
        }

        return [
          {
            table: tableOf(modelType),
            relation: relation,
            idColumn: idColumn,
            relationCreate: [
              ...(model.getColumnAccessControlFor(relation)?.create || []),
            ].sort(),
            idColumnCreate: [
              ...(model.getColumnAccessControlFor(idColumn)?.create || []),
            ].sort(),
          },
        ];
      });
  });

  test("where one is server-set, take the same create list", () => {
    expect(SERVER_SET_REFERENCES.length).toBeGreaterThan(0);

    const apart: Array<string> = SERVER_SET_REFERENCES.filter(
      (reference: ReferenceNames): boolean => {
        return (
          JSON.stringify(reference.relationCreate) !==
          JSON.stringify(reference.idColumnCreate)
        );
      },
    ).map((reference: ReferenceNames): string => {
      return `${reference.table}.${reference.relation} / ${reference.idColumn}`;
    });

    expect(apart).toEqual([]);
  });
});

describe("a create that gives a computed column nobody may create a value", () => {
  const NOBODY: Array<ComputedColumn> = WEIGHED.filter(
    (entry: ComputedColumn): boolean => {
      return entry.create.length === 0;
    },
  );

  const EVERYTHING: DatabaseCommonInteractionProps = memberWith(GRANTABLE);

  // The server's own, which no role reads: a value in one is made up.
  const NOBODY_READS: Array<ComputedColumn> = NOBODY.filter(
    (entry: ComputedColumn): boolean => {
      return entry.read.length === 0 && !isReplaced(entry);
    },
  );

  test("they are most of the computed columns", () => {
    expect(NOBODY.length).toBeGreaterThan(400);
  });

  test("never reaches the record from a member holding every permission: dropped where they may read it, refused where they may not", () => {
    const outcomes: Array<{ column: string; outcome: Outcome }> = NOBODY.map(
      (entry: ComputedColumn) => {
        return {
          column: nameOf(entry),
          outcome: askBeforeHooks(entry, EVERYTHING),
        };
      },
    );

    const expected: Array<{ column: string; outcome: Outcome }> = NOBODY.map(
      (entry: ComputedColumn) => {
        return {
          column: nameOf(entry),
          outcome: expectedOutcome(entry, GRANTABLE),
        };
      },
    );

    expect(outcomes).toEqual(expected);
  });

  /*
   * The salts, tokens, codes and the server's bookkeeping: no record a
   * caller could read carries them, so every create that sends one is told
   * so, whoever makes it.
   */
  test("one no role reads is refused with its name, even to a member holding every permission", () => {
    expect(NOBODY_READS.length).toBeGreaterThan(50);

    const notRefused: Array<string> = NOBODY_READS.filter(
      (entry: ComputedColumn): boolean => {
        return askBeforeHooks(entry, EVERYTHING) !== "refused";
      },
    ).map(nameOf);

    expect(notRefused).toEqual([]);

    for (const secret of [
      "User.passwordSalt",
      "StatusPagePrivateUser.passwordSalt",
      "StatusPage.masterPasswordSalt",
      "Dashboard.masterPasswordSalt",
      "StatusPageSubscriber.unsubscribeToken",
      "ProjectOnCallCalendarFeed.tokenHash",
      "UserSMS.verificationCodeExpiresAt",
      "UserEmail.verificationFailedAttempts",
      "Incident.createdNotificationHeldAt",
      "Label.nameSortKey",
    ]) {
      expect(NOBODY_READS.map(nameOf)).toContain(secret);
    }
  });

  test("is never taken from any permission that may create the column's table, and dropped only for one that may read it", () => {
    const wrong: Array<string> = [];

    for (const entry of NOBODY) {
      const creators: Array<Permission> = TablePermission.getTablePermission(
        entry.modelType,
        DatabaseRequestType.Create,
      );

      for (const creator of creators) {
        const outcome: Outcome = askBeforeHooks(entry, memberWith([creator]));
        const expected: Outcome = expectedOutcome(entry, [creator]);

        if (outcome === "taken" || outcome !== expected) {
          wrong.push(
            `${nameOf(entry)} from ${creator}: ${outcome}, not ${expected}`,
          );
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  /*
   * Asked as a member holding what creates the column's table, built once
   * per table: nobody may create these columns, so the answer is the same
   * for every member.
   */
  test("is refused again by the check of the record as written, unless the create's own steps wrote it, or OneUptime's code marked it", () => {
    const creators: Map<ModelType, DatabaseCommonInteractionProps> = new Map<
      ModelType,
      DatabaseCommonInteractionProps
    >();

    const creatorOf: (
      entry: ComputedColumn,
    ) => DatabaseCommonInteractionProps = (
      entry: ComputedColumn,
    ): DatabaseCommonInteractionProps => {
      let props: DatabaseCommonInteractionProps | undefined = creators.get(
        entry.modelType,
      );

      if (!props) {
        props = memberWith(
          TablePermission.getTablePermission(
            entry.modelType,
            DatabaseRequestType.Create,
          ),
        );
        creators.set(entry.modelType, props);
      }

      return props;
    };

    const wrong: Array<string> = [];

    for (const entry of NOBODY) {
      const props: DatabaseCommonInteractionProps = creatorOf(entry);

      if (askOfRecord(entry, props, {}) !== "refused") {
        wrong.push(`${nameOf(entry)}: a caller's value passed`);
      }

      if (askOfRecord(entry, props, { setByServer: true }) !== "passes") {
        wrong.push(`${nameOf(entry)}: a value the create wrote was refused`);
      }

      if (askOfRecord(entry, props, { marked: true }) !== "passes") {
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

  test("is taken from each permission that may create the table that the column's list names, and dropped or refused for each one it does not", () => {
    const wrong: Array<string> = [];

    for (const entry of SOME) {
      const creators: Array<Permission> = TablePermission.getTablePermission(
        entry.modelType,
        DatabaseRequestType.Create,
      );

      for (const creator of creators) {
        const outcome: Outcome = askBeforeHooks(entry, memberWith([creator]));
        const expected: Outcome = expectedOutcome(entry, [creator]);

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

/*
 * THE COMPUTED COLUMNS A CREATOR CHOOSES (#8907).
 *
 * Nobody may give a new record a value in a computed column - OneUptime's
 * number, record or decision - unless the column is here, with why the
 * person creating the record picks it. Every other computed column has an
 * empty create list, so a value sent there is dropped or refused (above):
 * a domain's certificate state, whether a record's subscribers or owners
 * were told, a record's number, what a service derives from the rest of the
 * write. A computed column given a create list fails this until it is
 * decided: its list emptied, or the column named here with its reason, in
 * the column's declaration too.
 */
const CHOSEN_ON_CREATE: ReadonlyArray<{ column: string; why: string }> = [
  {
    column: "Incident.currentIncidentState",
    why: "The state a new incident starts in is its declarer's pick: the declare form's Initial State sends it under this name, the API under currentIncidentStateId (the same reference, which takes the same list). IncidentService checks it is one of the project's states; OneUptime moves it on from there.",
  },
  {
    column: "StatusPage.downtimeMonitorStatuses",
    why: "A setting: the monitor statuses that count as downtime on the page. OneUptime fills it in only when the create names none (every status of the project that is not operational).",
  },
  {
    column: "ServiceLevelObjective.downtimeMonitorStatuses",
    why: "A setting: the monitor statuses that spend the SLO's error budget. OneUptime fills it in only when the create names none (every status of the project that is not operational).",
  },
];

describe("the computed columns a creator chooses", () => {
  const SOME: Array<ComputedColumn> = WEIGHED.filter(
    (entry: ComputedColumn): boolean => {
      return entry.create.length > 0;
    },
  );

  test("are the only computed columns anyone may create: every other one has an empty create list", () => {
    expect(SOME.map(nameOf).sort()).toEqual(
      CHOSEN_ON_CREATE.map((chosen: { column: string }): string => {
        return chosen.column;
      }).sort(),
    );
  });

  test("are few, each named once, each with why", () => {
    const names: Array<string> = CHOSEN_ON_CREATE.map(
      (chosen: { column: string }): string => {
        return chosen.column;
      },
    );

    expect(names.length).toBeLessThanOrEqual(5);
    expect(new Set(names).size).toBe(names.length);

    for (const chosen of CHOSEN_ON_CREATE) {
      expect([chosen.column, chosen.why.length > 80]).toEqual([
        chosen.column,
        true,
      ]);
    }
  });

  /*
   * Chosen by whoever creates the record: a list narrower than the table's
   * would refuse a creator's pick for no reason a column check can say, and
   * one wider would let in someone who may not create the record at all.
   */
  test.each(
    CHOSEN_ON_CREATE.map((chosen: { column: string }): [string] => {
      return [chosen.column];
    }),
  )("%s is created by exactly whoever may create its table", (name: string) => {
    const entry: ComputedColumn | undefined = SOME.find(
      (column: ComputedColumn): boolean => {
        return nameOf(column) === name;
      },
    );

    expect(entry).toBeDefined();
    expect([...entry!.create].sort()).toEqual(
      [
        ...TablePermission.getTablePermission(
          entry!.modelType,
          DatabaseRequestType.Create,
        ),
      ].sort(),
    );
  });

  // So whoever reads the model learns it too, where the list is.
  test.each(
    CHOSEN_ON_CREATE.map((chosen: { column: string }): [string] => {
      return [chosen.column];
    }),
  )("%s says why in its declaration", (name: string) => {
    const entry: ComputedColumn = SOME.find(
      (column: ComputedColumn): boolean => {
        return nameOf(column) === name;
      },
    )!;

    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "Models",
        "DatabaseModels",
        `${entry.modelType.name}.ts`,
      ),
      "utf8",
    );

    const declaration: number = source.search(
      new RegExp(`\\n  public ${entry.column}\\?`),
    );
    const decorator: number = source.lastIndexOf(
      "@ColumnAccessControl({",
      declaration,
    );
    const above: string = source.slice(0, decorator).trimEnd();

    expect(declaration).toBeGreaterThan(0);
    expect(above.endsWith("*/")).toBe(true);
    expect(above.slice(above.lastIndexOf("/*"))).toContain("#8907");
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
    /*
     * The rule drops what a caller may read; a column is named here only
     * when its declaration promises that a create's value is replaced for
     * everyone, those who cannot read it included.
     */
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
      (
        entry: ComputedColumnReplacedOnCreate,
      ): [string, ComputedColumnReplacedOnCreate] => {
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
  // A column no role may create or read: an unmarked value in it is refused.
  const entry: ComputedColumn = WEIGHED.find((column: ComputedColumn) => {
    return (
      column.create.length === 0 &&
      column.read.length === 0 &&
      !isReplaced(column)
    );
  })!;

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
    // How BaseAPI and Ask AI's Data Security actions read a write (#10378).
    "Server/Utils/Database/CrudRouteWrites.ts",
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

        if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
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
