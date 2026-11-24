import DatabaseService from "../../../Server/Services/DatabaseService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import ArchivableValueGuard from "../../../Server/Utils/Database/ArchivableValueGuard";
import PostgresErrorTranslator, {
  TranslatedPostgresException,
} from "../../../Server/Utils/Database/PostgresErrorTranslator";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Host from "../../../Models/DatabaseModels/Host";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import {
  getUniqueColumnBy,
  getUniqueColumnsBy,
} from "../../../Types/Database/UniqueColumnBy";
import BadDataException from "../../../Types/Exception/BadDataException";
import { getErrorDetails } from "../../../Types/Exception/BadDataExceptionWithDetails";
import NameTakenException, {
  NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
  NAME_TAKEN_REFUSAL_CODE,
  NAME_TAKEN_REFUSAL_CODES,
  REFUSAL_CODE_FIELD,
  getNameTakenRefusalCode,
} from "../../../Types/Exception/NameTakenException";
import ValueTakenException, {
  TAKEN_FIELD_DETAIL,
  VALUE_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
  VALUE_TAKEN_REFUSAL_CODE,
  VALUE_TAKEN_REFUSAL_CODES,
  getValueTakenRefusalCode,
} from "../../../Types/Exception/ValueTakenException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  ARCHIVABLE_VALUES,
  ARCHIVED_COLUMN,
  ArchivableValueDefinition,
} from "../../../Utils/ArchivableValues";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * EVERY KIND WITH A NAME OF ITS OWN REFUSES A TAKEN NAME WITH ITS CODE
 * (#10065).
 *
 * Since #10049 a refusal of a team's, a label's, an on-call policy's or an
 * on-call schedule's taken name has carried `refusalCode`, which the
 * Terraform provider asks such a write again by. Some seventy other kinds
 * hold their name one of their kind with @UniqueColumnBy, and refused a
 * taken name in English alone, so a create onto the name of a resource the
 * same apply renamed away or deleted failed until a second apply.
 *
 * Every one of them now carries the code, read off the models themselves,
 * so a kind added later is held to it too, and the code says what has the
 * name: "name_taken" for a record in service, which an apply may be giving
 * up, "name_taken_by_archived" for an archived one, which it is not. A
 * taken value of any other column (a domain, a host name) is no name: it
 * carries the codes of a taken value instead, "value_taken" and
 * "value_taken_by_archived", with the field (#10319).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-d0d0-4aaa-8bbb-000000000001",
);
const PARENT_ID: ObjectID = new ObjectID(
  "0193c0de-d0d0-4aaa-8bbb-000000000002",
);

type ModelType = { new (): BaseModel };

// A kind whose name is one of its kind, and the columns it is one within.
interface NamedKind {
  type: ModelType;
  scope: Array<string>;
}

interface UniqueChecks {
  checkUniqueColumnBy: (createBy: CreateBy<BaseModel>) => Promise<unknown>;
}

// The kinds whose model holds its name one of its kind, and in what.
const NAMED_KINDS: Array<NamedKind> = AllModelTypes.map((type: ModelType) => {
  const scope: string | Array<string> | undefined = getUniqueColumnBy(
    new type(),
    "name",
  );

  return {
    type: type,
    scope: scope === undefined ? [] : Array.isArray(scope) ? scope : [scope],
  };
}).filter((kind: { scope: Array<string> }): boolean => {
  return kind.scope.length > 0;
});

const nameOf: (type: ModelType) => string = (type: ModelType): string => {
  return new type().tableName || type.name;
};

// A new record of the kind, named Primary, in its project and its parent.
function newRecord(kind: NamedKind): BaseModel {
  const record: BaseModel = new kind.type();
  const fields: Record<string, unknown> = record as unknown as Record<
    string,
    unknown
  >;

  fields["name"] = "Primary";

  for (const column of kind.scope) {
    fields[column] = column === "projectId" ? PROJECT_ID : PARENT_ID;
  }

  return record;
}

/*
 * The kind's service with its count answered: one record with the name,
 * archived or not, and none with any other value of a unique column.
 */
function serviceWith(
  type: ModelType,
  holder: { isArchived: boolean } | null,
): {
  service: DatabaseService<BaseModel>;
  queries: Array<Record<string, unknown>>;
} {
  const service: DatabaseService<BaseModel> = new DatabaseService<BaseModel>(
    type,
  );
  const queries: Array<Record<string, unknown>> = [];

  jest
    .spyOn(service, "countBy")
    .mockImplementation(async (countBy: unknown): Promise<PositiveNumber> => {
      const query: Record<string, unknown> = (
        countBy as { query: Record<string, unknown> }
      ).query;

      queries.push(query);

      if (!holder || !Object.prototype.hasOwnProperty.call(query, "name")) {
        return new PositiveNumber(0);
      }

      if (query[ARCHIVED_COLUMN] === true) {
        return new PositiveNumber(holder.isArchived ? 1 : 0);
      }

      return new PositiveNumber(1);
    });

  return { service, queries };
}

async function refusalOf(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
  } catch (error) {
    return error;
  }

  return null;
}

function create(
  service: DatabaseService<BaseModel>,
  record: BaseModel,
): Promise<unknown> {
  return (service as unknown as UniqueChecks).checkUniqueColumnBy({
    data: record,
    props: { isRoot: true },
  } as unknown as CreateBy<BaseModel>);
}

function expectCode(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(NameTakenException);
  // Still bad data, at 400, for everything that reads it as such.
  expect(error).toBeInstanceOf(BadDataException);
  expect((error as NameTakenException).code).toBe(400);
  expect(getErrorDetails(error)).toEqual({ [REFUSAL_CODE_FIELD]: code });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the codes", () => {
  test("say what has the name, and are part of the API: never reworded", () => {
    expect(NAME_TAKEN_REFUSAL_CODE).toBe("name_taken");
    expect(NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE).toBe("name_taken_by_archived");
    expect(NAME_TAKEN_REFUSAL_CODES).toEqual([
      "name_taken",
      "name_taken_by_archived",
    ]);
  });

  test("a record in service, or one nothing is known of, is name_taken; an archived one name_taken_by_archived", () => {
    expect(getNameTakenRefusalCode()).toBe(NAME_TAKEN_REFUSAL_CODE);
    expect(getNameTakenRefusalCode({})).toBe(NAME_TAKEN_REFUSAL_CODE);
    expect(getNameTakenRefusalCode({ isArchived: false })).toBe(
      NAME_TAKEN_REFUSAL_CODE,
    );
    expect(getNameTakenRefusalCode({ isArchived: true })).toBe(
      NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
    );

    const archived: NameTakenException = new NameTakenException("Taken.", {
      isArchived: true,
    });

    expect(archived.isTakenByArchived).toBe(true);
    expect(new NameTakenException("Taken.").isTakenByArchived).toBe(false);
    expectCode(archived, NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE);
  });
});

describe("a kind whose model holds its name one of its kind (@UniqueColumnBy)", () => {
  test("is read off the models: some seventy kinds, the ones people name in Terraform among them", () => {
    const tables: Array<string> = NAMED_KINDS.map(
      (kind: { type: ModelType }): string => {
        return nameOf(kind.type);
      },
    );

    expect(tables.length).toBeGreaterThanOrEqual(60);
    expect(tables).toEqual(
      expect.arrayContaining([
        "IncidentSeverity",
        "IncidentState",
        "AlertSeverity",
        "MonitorStatus",
        "StatusPage",
        "Workflow",
        "WorkflowVariable",
        "StatusPageGroup",
        "Service",
      ]),
    );
  });

  test.each(
    NAMED_KINDS.map((kind: NamedKind): [string, NamedKind] => {
      return [nameOf(kind.type), kind];
    }),
  )(
    "%s: a create onto a name a record in service has is refused with name_taken, in its words as before",
    async (_table: string, kind: NamedKind) => {
      const { service } = serviceWith(kind.type, { isArchived: false });

      const error: unknown = await refusalOf(create(service, newRecord(kind)));

      expectCode(error, NAME_TAKEN_REFUSAL_CODE);
      expect((error as Error).message).toBe(
        `${new kind.type().singularName} with the same name already exists.`,
      );
    },
  );

  test.each(
    NAMED_KINDS.filter((kind: NamedKind): boolean => {
      return new kind.type().hasColumn(ARCHIVED_COLUMN);
    }).map((kind: NamedKind): [string, NamedKind] => {
      return [nameOf(kind.type), kind];
    }),
  )(
    "%s: a create onto a name only an archived record has is refused with name_taken_by_archived, and says so",
    async (_table: string, kind: NamedKind) => {
      const { service } = serviceWith(kind.type, { isArchived: true });

      const error: unknown = await refusalOf(create(service, newRecord(kind)));

      expectCode(error, NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE);
      expect((error as Error).message).toBe(
        `${new kind.type().singularName} with the same name already exists, and it is archived. Unarchive it, or choose another name.`,
      );
    },
  );

  test("a kind that cannot be archived is never asked whether the other record is", async () => {
    const kind: NamedKind | undefined = NAMED_KINDS.find(
      (named: { type: ModelType }): boolean => {
        return !new named.type().hasColumn(ARCHIVED_COLUMN);
      },
    );

    expect(kind).toBeDefined();

    const { service, queries } = serviceWith(kind!.type, {
      isArchived: true,
    });

    expectCode(
      await refusalOf(create(service, newRecord(kind!))),
      NAME_TAKEN_REFUSAL_CODE,
    );
    expect(
      queries.some((query: Record<string, unknown>): boolean => {
        return Object.prototype.hasOwnProperty.call(query, ARCHIVED_COLUMN);
      }),
    ).toBe(false);
  });

  test("a record in service is named before an archived one with the same name", async () => {
    const service: DatabaseService<BaseModel> = new DatabaseService<BaseModel>(
      IncidentSeverity,
    );

    // Two records have the name: one archived, one in service.
    jest
      .spyOn(service, "countBy")
      .mockImplementation(async (countBy: unknown): Promise<PositiveNumber> => {
        const query: Record<string, unknown> = (
          countBy as { query: Record<string, unknown> }
        ).query;

        return new PositiveNumber(query[ARCHIVED_COLUMN] === true ? 1 : 2);
      });

    const error: unknown = await refusalOf(
      create(
        service,
        newRecord({ type: IncidentSeverity, scope: ["projectId"] }),
      ),
    );

    expectCode(error, NAME_TAKEN_REFUSAL_CODE);
    expect((error as Error).message).toBe(
      "Incident Severity with the same name already exists.",
    );
  });

  test("a name no record has goes on", async () => {
    const { service } = serviceWith(IncidentSeverity, null);

    await expect(
      create(
        service,
        newRecord({ type: IncidentSeverity, scope: ["projectId"] }),
      ),
    ).resolves.toBeDefined();
  });
});

/*
 * A TAKEN VALUE OF A UNIQUE COLUMN THAT IS NOT A NAME (#10319): a status
 * page's or a dashboard's domain, a host's identifier, an SSO provider's
 * sign-on URL. Refused in its words as before, now with the code a program
 * tells a taken value by and the field: a domain moved from one Terraform
 * resource to another in one apply converges, as a name does.
 */

interface ValueKind extends NamedKind {
  column: string;
}

// Every column a model holds unique that is not its name, and what in.
const VALUE_KINDS: Array<ValueKind> = AllModelTypes.flatMap(
  (type: ModelType): Array<ValueKind> => {
    const columns: Record<string, string | Array<string>> = getUniqueColumnsBy(
      new type(),
    ) as Record<string, string | Array<string>>;

    return Object.keys(columns)
      .filter((column: string): boolean => {
        return column !== "name";
      })
      .map((column: string): ValueKind => {
        const scope: string | Array<string> = columns[column]!;

        return {
          type: type,
          column: column,
          scope: Array.isArray(scope) ? scope : [scope],
        };
      });
  },
);

function valueCases(kinds: Array<ValueKind>): Array<[string, ValueKind]> {
  return kinds.map((kind: ValueKind): [string, ValueKind] => {
    return [`${nameOf(kind.type)}.${kind.column}`, kind];
  });
}

// A new record of the kind whose unique column holds a value, in its scope.
function newValueRecord(kind: ValueKind): BaseModel {
  const record: BaseModel = new kind.type();
  const fields: Record<string, unknown> = record as unknown as Record<
    string,
    unknown
  >;

  fields[kind.column] = "status.example.com";

  for (const column of kind.scope) {
    fields[column] = column === "projectId" ? PROJECT_ID : PARENT_ID;
  }

  return record;
}

/*
 * The kind's service with its count answered: one record with the value,
 * archived or not, and no record with the name.
 */
function serviceWithValue(
  kind: ValueKind,
  holder: { isArchived: boolean },
): {
  service: DatabaseService<BaseModel>;
  queries: Array<Record<string, unknown>>;
} {
  const service: DatabaseService<BaseModel> = new DatabaseService<BaseModel>(
    kind.type,
  );
  const queries: Array<Record<string, unknown>> = [];

  jest
    .spyOn(service, "countBy")
    .mockImplementation(async (countBy: unknown): Promise<PositiveNumber> => {
      const query: Record<string, unknown> = (
        countBy as { query: Record<string, unknown> }
      ).query;

      queries.push(query);

      if (!Object.prototype.hasOwnProperty.call(query, kind.column)) {
        return new PositiveNumber(0);
      }

      if (query[ARCHIVED_COLUMN] === true) {
        return new PositiveNumber(holder.isArchived ? 1 : 0);
      }

      return new PositiveNumber(1);
    });

  return { service, queries };
}

function expectValueTaken(error: unknown, code: string, field: string): void {
  expect(error).toBeInstanceOf(ValueTakenException);
  // A value, not a name: a client that tells names apart is not misled.
  expect(error).not.toBeInstanceOf(NameTakenException);
  expect(error).toBeInstanceOf(BadDataException);
  expect((error as ValueTakenException).code).toBe(400);
  expect((error as ValueTakenException).field).toBe(field);
  expect(getErrorDetails(error)).toEqual({
    [REFUSAL_CODE_FIELD]: code,
    [TAKEN_FIELD_DETAIL]: field,
  });
}

describe("a taken value of a unique column that is not a name", () => {
  test("the codes say what has the value, and are part of the API: never reworded", () => {
    expect(VALUE_TAKEN_REFUSAL_CODE).toBe("value_taken");
    expect(VALUE_TAKEN_BY_ARCHIVED_REFUSAL_CODE).toBe(
      "value_taken_by_archived",
    );
    expect(VALUE_TAKEN_REFUSAL_CODES).toEqual([
      "value_taken",
      "value_taken_by_archived",
    ]);
    expect(TAKEN_FIELD_DETAIL).toBe("field");
    expect(getValueTakenRefusalCode()).toBe(VALUE_TAKEN_REFUSAL_CODE);
    expect(getValueTakenRefusalCode({ isArchived: true })).toBe(
      VALUE_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
    );
    // No field when several fields' values together are taken.
    expect(getErrorDetails(new ValueTakenException("Taken."))).toEqual({
      [REFUSAL_CODE_FIELD]: VALUE_TAKEN_REFUSAL_CODE,
    });
    expect(new ValueTakenException("Taken.").field).toBeNull();
  });

  test("the columns are read off the models: the domains, identifiers and sign-on URLs among them", () => {
    expect(
      VALUE_KINDS.map((kind: ValueKind): string => {
        return `${nameOf(kind.type)}.${kind.column}`;
      }),
    ).toEqual(
      expect.arrayContaining([
        "StatusPageDomain.fullDomain",
        "DashboardDomain.fullDomain",
        "Domain.domain",
        "Host.hostIdentifier",
        "KubernetesCluster.clusterIdentifier",
        "ProjectSSO.signOnURL",
      ]),
    );
  });

  test.each(valueCases(VALUE_KINDS))(
    "%s: a create onto a value a record in service has is refused with value_taken and its field, in its words as before",
    async (_label: string, kind: ValueKind) => {
      const { service } = serviceWithValue(kind, { isArchived: false });

      const error: unknown = await refusalOf(
        create(service, newValueRecord(kind)),
      );

      expectValueTaken(error, VALUE_TAKEN_REFUSAL_CODE, kind.column);
      expect((error as Error).message).toBe(
        `${new kind.type().singularName} with the same ${kind.column} already exists.`,
      );
    },
  );

  test.each(
    valueCases(
      VALUE_KINDS.filter((kind: ValueKind): boolean => {
        return new kind.type().hasColumn(ARCHIVED_COLUMN);
      }),
    ),
  )(
    "%s: a create onto a value only an archived record has is refused with value_taken_by_archived, and says so",
    async (_label: string, kind: ValueKind) => {
      const { service } = serviceWithValue(kind, { isArchived: true });

      const error: unknown = await refusalOf(
        create(service, newValueRecord(kind)),
      );

      expectValueTaken(
        error,
        VALUE_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
        kind.column,
      );
      expect((error as Error).message).toBe(
        `${new kind.type().singularName} with the same ${kind.column} already exists, and it is archived. Unarchive it, or choose another ${kind.column}.`,
      );
    },
  );

  test("a status page domain, which cannot be archived, is never asked whether the other is", async () => {
    const kind: ValueKind = VALUE_KINDS.find((each: ValueKind): boolean => {
      return each.type === StatusPageDomain;
    })!;

    const { service, queries } = serviceWithValue(kind, { isArchived: true });

    expectValueTaken(
      await refusalOf(create(service, newValueRecord(kind))),
      VALUE_TAKEN_REFUSAL_CODE,
      "fullDomain",
    );
    expect(
      queries.some((query: Record<string, unknown>): boolean => {
        return Object.prototype.hasOwnProperty.call(query, ARCHIVED_COLUMN);
      }),
    ).toBe(false);
  });

  test("a host whose identifier alone is taken is refused for the identifier, as a value, never for its name", async () => {
    const hostService: DatabaseService<BaseModel> =
      new DatabaseService<BaseModel>(Host);

    // Only the host name is taken, by a host in service: the record's name is free.
    jest
      .spyOn(hostService, "countBy")
      .mockImplementation(async (countBy: unknown): Promise<PositiveNumber> => {
        const query: Record<string, unknown> = (
          countBy as { query: Record<string, unknown> }
        ).query;

        return new PositiveNumber(
          Object.prototype.hasOwnProperty.call(query, "hostIdentifier") &&
          query[ARCHIVED_COLUMN] !== true
            ? 1
            : 0,
        );
      });

    const host: BaseModel = new Host();
    Object.assign(host, {
      name: "web-01",
      hostIdentifier: "web-01",
      projectId: PROJECT_ID,
    });

    const identifierError: unknown = await refusalOf(create(hostService, host));

    expectValueTaken(
      identifierError,
      VALUE_TAKEN_REFUSAL_CODE,
      "hostIdentifier",
    );
    expect((identifierError as Error).message).toBe(
      "Host with the same hostIdentifier already exists.",
    );
  });
});

describe("a value named as an archived one (ArchivableValueGuard)", () => {
  test.each(
    Object.values(ARCHIVABLE_VALUES).map(
      (
        definition: ArchivableValueDefinition,
      ): [string, ArchivableValueDefinition] => {
        return [definition.tableName, definition];
      },
    ),
  )(
    "%s: refused with name_taken_by_archived, and where to unarchive it",
    async (_table: string, definition: ArchivableValueDefinition) => {
      const service: Record<string, unknown> = {
        findOneBy: jest.fn(async (): Promise<unknown> => {
          return { _id: PARENT_ID.toString(), isArchived: true };
        }),
      };

      const record: Record<string, unknown> = {
        name: "Sev 1",
        projectId: PROJECT_ID,
      };

      const error: unknown = await refusalOf(
        ArchivableValueGuard.beforeCreate({
          service: service as unknown as DatabaseService<BaseModel>,
          definition: definition,
          createBy: {
            data: record as unknown as BaseModel,
            props: { tenantId: PROJECT_ID },
          } as unknown as CreateBy<BaseModel>,
        }),
      );

      expectCode(error, NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE);
      expect((error as Error).message).toBe(
        ArchivableValueGuard.getArchivedNamesakeRefusal({
          definition: definition,
          name: "Sev 1",
        }),
      );
    },
  );
});

describe("a unique index that holds a name (PostgresErrorTranslator)", () => {
  function uniqueViolation(detail: string): unknown {
    return {
      code: "23505",
      table: "DataProduct",
      detail: detail,
      constraint: "UQ_DataProduct_projectId_name",
    };
  }

  test("a name the index holds one of its kind is refused with name_taken, still tagged as the unique violation it was", () => {
    const translated: unknown = PostgresErrorTranslator.translate(
      uniqueViolation(
        'Key ("projectId", name)=(0193c0de-d0d0-4aaa-8bbb-000000000001, Orders) already exists.',
      ),
    );

    expectCode(translated, NAME_TAKEN_REFUSAL_CODE);
    expect((translated as Error).message).toBe(
      "A Data Product with the same Project Id, Name already exists. Please use different values and try again.",
    );
    expect((translated as TranslatedPostgresException).postgresErrorCode).toBe(
      "23505",
    );
    expect(
      (translated as TranslatedPostgresException).postgresConstraintName,
    ).toBe("UQ_DataProduct_projectId_name");
  });

  /*
   * Any other index's refusal is a taken value (#10319): nothing was
   * written, so it carries value_taken, with the field when the index
   * holds one beside the project, still tagged as the unique violation it
   * was.
   */
  test("any other index's refusal carries value_taken, with the field it holds beside the project", () => {
    const translated: unknown = PostgresErrorTranslator.translate(
      uniqueViolation(
        'Key ("projectId", "sessionId")=(0193c0de-d0d0-4aaa-8bbb-000000000001, abc) already exists.',
      ),
    );

    expectValueTaken(translated, VALUE_TAKEN_REFUSAL_CODE, "sessionId");
    expect((translated as TranslatedPostgresException).postgresErrorCode).toBe(
      "23505",
    );
  });

  test("an index of several values, or one whose columns Postgres does not say, carries value_taken with no field", () => {
    for (const detail of [
      'Key ("projectId", "monitorId", "teamId")=(0193c0de-d0d0-4aaa-8bbb-000000000001, a, b) already exists.',
      "Key already exists.",
    ]) {
      const translated: unknown = PostgresErrorTranslator.translate(
        uniqueViolation(detail),
      );

      expect(translated).toBeInstanceOf(ValueTakenException);
      expect(getErrorDetails(translated)).toEqual({
        [REFUSAL_CODE_FIELD]: VALUE_TAKEN_REFUSAL_CODE,
      });
    }
  });

  test("a duplicate found before the write (@UniqueColumnsTogether) carries value_taken too, tagged as the index's would be", () => {
    const duplicate: unknown =
      PostgresErrorTranslator.createUniqueViolationException(
        "This team already owns this monitor.",
        "UQ_MonitorOwnerTeam_monitorId_teamId",
      );

    expect(duplicate).toBeInstanceOf(ValueTakenException);
    expect(getErrorDetails(duplicate)).toEqual({
      [REFUSAL_CODE_FIELD]: VALUE_TAKEN_REFUSAL_CODE,
    });
    expect(PostgresErrorTranslator.isUniqueViolation(duplicate)).toBe(true);
  });
});
