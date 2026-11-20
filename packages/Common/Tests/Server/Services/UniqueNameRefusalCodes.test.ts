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
import { getUniqueColumnBy } from "../../../Types/Database/UniqueColumnBy";
import BadDataException from "../../../Types/Exception/BadDataException";
import { getErrorDetails } from "../../../Types/Exception/BadDataExceptionWithDetails";
import NameTakenException, {
  NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
  NAME_TAKEN_REFUSAL_CODE,
  NAME_TAKEN_REFUSAL_CODES,
  REFUSAL_CODE_FIELD,
  getNameTakenRefusalCode,
} from "../../../Types/Exception/NameTakenException";
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
 * taken value of any other column (a domain, a host name) is no name, and
 * carries none.
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

describe("a taken value of a unique column that is not a name", () => {
  test("is refused as before, with no code: a domain, a host name", async () => {
    const domainService: DatabaseService<BaseModel> =
      new DatabaseService<BaseModel>(StatusPageDomain);

    jest
      .spyOn(domainService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));

    const domain: BaseModel = new StatusPageDomain();
    Object.assign(domain, {
      fullDomain: "status.example.com",
      projectId: PROJECT_ID,
    });

    const domainError: unknown = await refusalOf(create(domainService, domain));

    expect(domainError).toBeInstanceOf(BadDataException);
    expect(domainError).not.toBeInstanceOf(NameTakenException);
    expect((domainError as Error).message).toBe(
      "Status Page Domain with the same fullDomain already exists.",
    );
    expect(getErrorDetails(domainError)).toEqual({});

    const hostService: DatabaseService<BaseModel> =
      new DatabaseService<BaseModel>(Host);

    // Only the host name is taken: the record's name is free.
    jest
      .spyOn(hostService, "countBy")
      .mockImplementation(async (countBy: unknown): Promise<PositiveNumber> => {
        const query: Record<string, unknown> = (
          countBy as { query: Record<string, unknown> }
        ).query;

        return new PositiveNumber(
          Object.prototype.hasOwnProperty.call(query, "hostIdentifier") ? 1 : 0,
        );
      });

    const host: BaseModel = new Host();
    Object.assign(host, {
      name: "web-01",
      hostIdentifier: "web-01",
      projectId: PROJECT_ID,
    });

    const identifierError: unknown = await refusalOf(create(hostService, host));

    expect(identifierError).toBeInstanceOf(BadDataException);
    expect(identifierError).not.toBeInstanceOf(NameTakenException);
    expect((identifierError as Error).message).toBe(
      "Host with the same hostIdentifier already exists.",
    );
    expect(getErrorDetails(identifierError)).toEqual({});
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

  test("any other index's refusal carries no code", () => {
    const translated: unknown = PostgresErrorTranslator.translate(
      uniqueViolation(
        'Key ("projectId", "sessionId")=(0193c0de-d0d0-4aaa-8bbb-000000000001, abc) already exists.',
      ),
    );

    expect(translated).toBeInstanceOf(BadDataException);
    expect(translated).not.toBeInstanceOf(NameTakenException);
    expect(getErrorDetails(translated)).toEqual({});
  });
});
