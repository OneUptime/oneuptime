import ArchivableValueGuard from "../../../../Server/Utils/Database/ArchivableValueGuard";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../../Server/Types/Database/UpdateBy";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentRole from "../../../../Models/DatabaseModels/IncidentRole";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import Label from "../../../../Models/DatabaseModels/Label";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import {
  ARCHIVABLE_VALUES,
  ArchivableValueDefinition,
  ArchivableValueType,
} from "../../../../Utils/ArchivableValues";
import { describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * ArchivableValueGuard: what each value's service checks around a create or
 * an update so archiving never takes away a value OneUptime moves records
 * into, never leaves a project without a severity to open incidents with,
 * and a name an archived value has is answered with where to unarchive it.
 * The service is faked - a project's rows in memory - so these pin the
 * guard's own decisions and the reads it makes.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-dddd-4ddd-8ddd-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-dddd-4ddd-8ddd-000000000002",
);

const id: (n: number) => string = (n: number): string => {
  return `0193c0de-eeee-4eee-8eee-${String(n).padStart(12, "0")}`;
};

type FakeRow = Record<string, unknown> & { _id: string; projectId: ObjectID };

interface FakeService {
  rows: Array<FakeRow>;
  findOneByQueries: Array<Record<string, unknown>>;
  findByQueries: Array<Record<string, unknown>>;
  holds: Array<{
    updateBy: UpdateBy<BaseModel>;
    select: Record<string, unknown>;
  }>;
  service: never;
}

// The text a findWithSameText operator compares with, lower-cased.
const sameTextOf: (value: unknown) => string | undefined = (
  value: unknown,
): string | undefined => {
  if (value instanceof FindOperator) {
    const parameters: Record<string, unknown> =
      (value.objectLiteralParameters as Record<string, unknown>) || {};
    const first: unknown = Object.values(parameters)[0];
    return typeof first === "string" ? first : undefined;
  }

  return typeof value === "string" ? value.toLowerCase() : undefined;
};

const fakeService: (
  modelType: { new (): BaseModel },
  rows: Array<FakeRow>,
) => FakeService = (
  modelType: { new (): BaseModel },
  rows: Array<FakeRow>,
): FakeService => {
  const fake: FakeService = {
    rows: rows,
    findOneByQueries: [],
    findByQueries: [],
    holds: [],
    service: undefined as never,
  };

  const toModel: (row: FakeRow) => BaseModel = (row: FakeRow): BaseModel => {
    const model: BaseModel = new modelType();
    for (const [key, value] of Object.entries(row)) {
      (model as unknown as Record<string, unknown>)[key] = value;
    }
    return model;
  };

  const matches: (row: FakeRow, query: Record<string, unknown>) => boolean = (
    row: FakeRow,
    query: Record<string, unknown>,
  ): boolean => {
    if (
      query["projectId"] !== undefined &&
      row.projectId.toString() !== (query["projectId"] as ObjectID).toString()
    ) {
      return false;
    }

    if (
      query["isArchived"] !== undefined &&
      (row["isArchived"] === true) !== query["isArchived"]
    ) {
      return false;
    }

    if (query["name"] !== undefined) {
      const text: string | undefined = sameTextOf(query["name"]);

      if (
        String(row["name"] || "")
          .toLowerCase()
          .trim() !== text
      ) {
        return false;
      }
    }

    return true;
  };

  fake.service = {
    getModel: (): BaseModel => {
      return new modelType();
    },
    findOneBy: async (args: {
      query: Record<string, unknown>;
      props: Record<string, unknown>;
    }): Promise<BaseModel | null> => {
      expect(args.props["isRoot"]).toBe(true);
      fake.findOneByQueries.push(args.query);
      const row: FakeRow | undefined = fake.rows.find((candidate: FakeRow) => {
        return matches(candidate, args.query);
      });
      return row ? toModel(row) : null;
    },
    findBy: async (args: {
      query: Record<string, unknown>;
      props: Record<string, unknown>;
    }): Promise<Array<BaseModel>> => {
      expect(args.props["isRoot"]).toBe(true);
      fake.findByQueries.push(args.query);
      return fake.rows
        .filter((row: FakeRow) => {
          return matches(row, args.query);
        })
        .map(toModel);
    },
    // The rows the update writes: those it names in the caller's project.
    findRowsAndHoldUpdateToThem: async (
      updateBy: UpdateBy<BaseModel>,
      select: Record<string, unknown>,
    ): Promise<Array<BaseModel>> => {
      fake.holds.push({ updateBy, select });
      const query: Record<string, unknown> = updateBy.query as Record<
        string,
        unknown
      >;
      const ids: Array<string> | undefined = Array.isArray(query["_ids"])
        ? (query["_ids"] as Array<string>)
        : undefined;

      return fake.rows
        .filter((row: FakeRow) => {
          if (
            updateBy.props.tenantId &&
            row.projectId.toString() !== updateBy.props.tenantId.toString()
          ) {
            return false;
          }

          if (ids) {
            return ids.includes(row._id);
          }

          return (
            query["_id"] === undefined || row._id === query["_id"]?.toString()
          );
        })
        .map(toModel);
    },
  } as never;

  return fake;
};

const row: (
  n: number,
  name: string,
  flags?: Record<string, unknown>,
) => FakeRow = (
  n: number,
  name: string,
  flags: Record<string, unknown> = {},
): FakeRow => {
  return {
    _id: id(n),
    name: name,
    projectId: PROJECT_ID,
    isArchived: false,
    ...flags,
  };
};

const severities: () => Array<FakeRow> = (): Array<FakeRow> => {
  return [
    row(1, "Critical"),
    row(2, "Major"),
    row(3, "[DONOTUSE] Very critical", { isArchived: true }),
  ];
};

const states: () => Array<FakeRow> = (): Array<FakeRow> => {
  return [
    row(10, "Identified", { isCreatedState: true }),
    row(11, "Investigating"),
    row(12, "Acknowledged", { isAcknowledgedState: true }),
    row(13, "Resolved", { isResolvedState: true }),
    row(14, "Monitoring fix", { isArchived: true }),
  ];
};

const definition: (type: ArchivableValueType) => ArchivableValueDefinition = (
  type: ArchivableValueType,
): ArchivableValueDefinition => {
  return ARCHIVABLE_VALUES[type];
};

const person: { tenantId: ObjectID; userId: ObjectID } = {
  tenantId: PROJECT_ID,
  userId: new ObjectID(id(99)),
};

const update: (
  query: Record<string, unknown>,
  data: Record<string, unknown>,
  props?: Record<string, unknown>,
) => UpdateBy<BaseModel> = (
  query: Record<string, unknown>,
  data: Record<string, unknown>,
  props: Record<string, unknown> = person,
): UpdateBy<BaseModel> => {
  return {
    query: query,
    data: data,
    props: props,
  } as unknown as UpdateBy<BaseModel>;
};

const create: (
  modelType: { new (): BaseModel },
  values: Record<string, unknown>,
  props?: Record<string, unknown>,
) => CreateBy<BaseModel> = (
  modelType: { new (): BaseModel },
  values: Record<string, unknown>,
  props: Record<string, unknown> = person,
): CreateBy<BaseModel> => {
  const model: BaseModel = new modelType();

  for (const [key, value] of Object.entries(values)) {
    (model as unknown as Record<string, unknown>)[key] = value;
  }

  return { data: model, props: props } as unknown as CreateBy<BaseModel>;
};

const refusalOf: (run: () => Promise<void>) => Promise<string | null> = async (
  run: () => Promise<void>,
): Promise<string | null> => {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  return null;
};

describe("archiving a value", () => {
  test("a value nothing relies on is archived", async () => {
    const fake: FakeService = fakeService(IncidentState, states());

    expect(
      await refusalOf(() => {
        return ArchivableValueGuard.beforeUpdate({
          service: fake.service,
          definition: definition(ArchivableValueType.IncidentState),
          updateBy: update({ _id: id(11) }, { isArchived: true }),
        });
      }),
    ).toBeNull();

    // Read in the caller's project, with what decides a refusal.
    expect(fake.holds).toHaveLength(1);
    expect(fake.holds[0]!.select).toEqual({
      _id: true,
      name: true,
      projectId: true,
      isArchived: true,
      isCreatedState: true,
      isAcknowledgedState: true,
      isResolvedState: true,
    });
    // States need no live one: nothing else is read.
    expect(fake.findByQueries).toEqual([]);
  });

  test("never one OneUptime moves records into, and says why", async () => {
    const fake: FakeService = fakeService(IncidentState, states());

    for (const [stateId, reason] of [
      [
        id(10),
        '"Identified": New incidents start in this state, so it can\'t be archived.',
      ],
      [
        id(12),
        '"Acknowledged": Acknowledging an incident moves it to this state, so it can\'t be archived.',
      ],
      [
        id(13),
        '"Resolved": Resolving an incident moves it to this state, so it can\'t be archived.',
      ],
    ]) {
      expect(
        await refusalOf(() => {
          return ArchivableValueGuard.beforeUpdate({
            service: fake.service,
            definition: definition(ArchivableValueType.IncidentState),
            updateBy: update({ _id: stateId }, { isArchived: true }),
          });
        }),
      ).toBe(reason);
    }
  });

  test("the operational and offline statuses and the primary incident role stay", async () => {
    const statuses: FakeService = fakeService(MonitorStatus, [
      row(20, "Operational", { isOperationalState: true }),
      row(21, "Offline", { isOfflineState: true }),
      row(22, "Degraded"),
    ]);

    expect(
      await refusalOf(() => {
        return ArchivableValueGuard.beforeUpdate({
          service: statuses.service,
          definition: definition(ArchivableValueType.MonitorStatus),
          updateBy: update({ _id: id(21) }, { isArchived: true }),
        });
      }),
    ).toBe(
      '"Offline": OneUptime treats a monitor in this status as down, so it can\'t be archived.',
    );

    expect(
      await refusalOf(() => {
        return ArchivableValueGuard.beforeUpdate({
          service: statuses.service,
          definition: definition(ArchivableValueType.MonitorStatus),
          updateBy: update({ _id: id(22) }, { isArchived: true }),
        });
      }),
    ).toBeNull();

    const roles: FakeService = fakeService(IncidentRole, [
      row(30, "Incident Commander", { isPrimaryRole: true }),
      row(31, "Scribe", { isDeleteable: false }),
      row(32, "Comms Lead", { isDeleteable: true }),
    ]);

    for (const roleId of [id(30), id(31)]) {
      expect(
        await refusalOf(() => {
          return ArchivableValueGuard.beforeUpdate({
            service: roles.service,
            definition: definition(ArchivableValueType.IncidentRole),
            updateBy: update({ _id: roleId }, { isArchived: true }),
          });
        }),
      ).toContain("so this role can't be archived.");
    }

    expect(
      await refusalOf(() => {
        return ArchivableValueGuard.beforeUpdate({
          service: roles.service,
          definition: definition(ArchivableValueType.IncidentRole),
          updateBy: update({ _id: id(32) }, { isArchived: true }),
        });
      }),
    ).toBeNull();
  });

  test("a project keeps one severity that is not archived", async () => {
    const fake: FakeService = fakeService(IncidentSeverity, severities());

    // Major goes; Critical is left.
    expect(
      await refusalOf(() => {
        return ArchivableValueGuard.beforeUpdate({
          service: fake.service,
          definition: definition(ArchivableValueType.IncidentSeverity),
          updateBy: update({ _id: id(2) }, { isArchived: true }),
        });
      }),
    ).toBeNull();

    // The live ones are read pinned to the project, as OneUptime.
    expect(fake.findByQueries).toEqual([
      { projectId: PROJECT_ID, isArchived: false },
    ]);

    // Both at once would leave none.
    expect(
      await refusalOf(() => {
        return ArchivableValueGuard.beforeUpdate({
          service: fake.service,
          definition: definition(ArchivableValueType.IncidentSeverity),
          updateBy: update({ _ids: [id(1), id(2)] }, { isArchived: true }),
        });
      }),
    ).toBe(
      "Every new incident needs a severity, so keep at least one that is not archived.",
    );
  });

  test("the last live severity of a project stays", async () => {
    const fake: FakeService = fakeService(IncidentSeverity, [
      row(1, "Critical"),
      row(3, "Old", { isArchived: true }),
    ]);

    expect(
      await refusalOf(() => {
        return ArchivableValueGuard.beforeUpdate({
          service: fake.service,
          definition: definition(ArchivableValueType.IncidentSeverity),
          updateBy: update({ _id: id(1) }, { isArchived: true }),
        });
      }),
    ).toBe(
      "Every new incident needs a severity, so keep at least one that is not archived.",
    );
  });

  test("archiving what is archived already changes nothing, and reads no more", async () => {
    const fake: FakeService = fakeService(IncidentSeverity, [
      row(3, "Old", { isArchived: true }),
    ]);

    expect(
      await refusalOf(() => {
        return ArchivableValueGuard.beforeUpdate({
          service: fake.service,
          definition: definition(ArchivableValueType.IncidentSeverity),
          updateBy: update({ _id: id(3) }, { isArchived: true }),
        });
      }),
    ).toBeNull();
    expect(fake.findByQueries).toEqual([]);
  });

  test("labels: any of them, all of them", async () => {
    const fake: FakeService = fakeService(Label, [
      row(40, "legacy-db"),
      row(41, "payments"),
    ]);

    expect(
      await refusalOf(() => {
        return ArchivableValueGuard.beforeUpdate({
          service: fake.service,
          definition: definition(ArchivableValueType.Label),
          updateBy: update({ _ids: [id(40), id(41)] }, { isArchived: true }),
        });
      }),
    ).toBeNull();
  });

  test("another project's row is never this caller's to archive", async () => {
    const fake: FakeService = fakeService(IncidentState, [
      {
        ...row(10, "Identified", { isCreatedState: true }),
        projectId: OTHER_PROJECT_ID,
      },
    ]);

    // The held read finds nothing in the caller's project: nothing to refuse.
    expect(
      await refusalOf(() => {
        return ArchivableValueGuard.beforeUpdate({
          service: fake.service,
          definition: definition(ArchivableValueType.IncidentState),
          updateBy: update({ _id: id(10) }, { isArchived: true }),
        });
      }),
    ).toBeNull();
    expect(fake.holds).toHaveLength(1);
  });
});

describe("what costs nothing", () => {
  test("an update that neither archives nor protects reads nothing", async () => {
    const fake: FakeService = fakeService(IncidentState, states());

    for (const data of [
      { name: "Investigating (team)" },
      { color: "#000000" },
      { isCreatedState: false },
      { isArchived: false },
      { isArchived: false, isCreatedState: true },
    ]) {
      expect(
        await refusalOf(() => {
          return ArchivableValueGuard.beforeUpdate({
            service: fake.service,
            definition: definition(ArchivableValueType.IncidentState),
            updateBy: update({ _id: id(14) }, data),
          });
        }),
      ).toBeNull();
    }

    expect(fake.holds).toEqual([]);
    expect(fake.findByQueries).toEqual([]);
    expect(fake.findOneByQueries).toEqual([]);
  });

  test("OneUptime's own writes (root) are trusted", async () => {
    const fake: FakeService = fakeService(IncidentState, states());

    expect(
      await refusalOf(() => {
        return ArchivableValueGuard.beforeUpdate({
          service: fake.service,
          definition: definition(ArchivableValueType.IncidentState),
          updateBy: update(
            { _id: id(10) },
            { isArchived: true },
            { isRoot: true },
          ),
        });
      }),
    ).toBeNull();

    expect(
      await refusalOf(() => {
        return ArchivableValueGuard.beforeCreate({
          service: fake.service,
          definition: definition(ArchivableValueType.IncidentState),
          createBy: create(
            IncidentState,
            {
              name: "Monitoring fix",
              projectId: PROJECT_ID,
              isArchived: true,
              isCreatedState: true,
            },
            { isRoot: true },
          ),
        });
      }),
    ).toBeNull();

    expect(fake.holds).toEqual([]);
    expect(fake.findOneByQueries).toEqual([]);
  });
});

describe("making a value one OneUptime relies on", () => {
  test("an archived value must be unarchived first", async () => {
    const fake: FakeService = fakeService(IncidentState, states());

    expect(
      await refusalOf(() => {
        return ArchivableValueGuard.beforeUpdate({
          service: fake.service,
          definition: definition(ArchivableValueType.IncidentState),
          updateBy: update({ _id: id(14) }, { isResolvedState: true }),
        });
      }),
    ).toBe(
      '"Monitoring fix" is archived. Unarchive it first: OneUptime moves records into this one, so it can\'t stay archived.',
    );
  });

  test("a live value may be", async () => {
    const fake: FakeService = fakeService(IncidentState, states());

    expect(
      await refusalOf(() => {
        return ArchivableValueGuard.beforeUpdate({
          service: fake.service,
          definition: definition(ArchivableValueType.IncidentState),
          updateBy: update({ _id: id(11) }, { isResolvedState: true }),
        });
      }),
    ).toBeNull();
  });

  test("unarchiving it in the same write is fine", async () => {
    const fake: FakeService = fakeService(IncidentState, states());

    expect(
      await refusalOf(() => {
        return ArchivableValueGuard.beforeUpdate({
          service: fake.service,
          definition: definition(ArchivableValueType.IncidentState),
          updateBy: update(
            { _id: id(14) },
            { isResolvedState: true, isArchived: false },
          ),
        });
      }),
    ).toBeNull();
  });

  test("archiving one and making it protected at once is refused", async () => {
    const fake: FakeService = fakeService(IncidentState, states());

    expect(
      await refusalOf(() => {
        return ArchivableValueGuard.beforeUpdate({
          service: fake.service,
          definition: definition(ArchivableValueType.IncidentState),
          updateBy: update(
            { _id: id(11) },
            { isArchived: true, isAcknowledgedState: true },
          ),
        });
      }),
    ).toBe(
      '"Investigating": Acknowledging an incident moves it to this state, so it can\'t be archived.',
    );
  });
});

describe("creating a value", () => {
  test("named like an archived one: unarchive it instead", async () => {
    const fake: FakeService = fakeService(IncidentSeverity, severities());

    expect(
      await refusalOf(() => {
        return ArchivableValueGuard.beforeCreate({
          service: fake.service,
          definition: definition(ArchivableValueType.IncidentSeverity),
          createBy: create(IncidentSeverity, {
            name: "  [donotuse] VERY critical ",
            projectId: PROJECT_ID,
          }),
        });
      }),
    ).toBe(
      'An archived incident severity is already called "[donotuse] VERY critical". Unarchive it in Incidents > Settings > Incident Severity, or choose another name.',
    );

    // Pinned to the caller's project, archived ones only.
    expect(fake.findOneByQueries[0]!["projectId"]).toBe(PROJECT_ID);
    expect(fake.findOneByQueries[0]!["isArchived"]).toBe(true);
  });

  test("a new name, or a live value's, is not this guard's to refuse", async () => {
    const fake: FakeService = fakeService(IncidentSeverity, severities());

    for (const name of ["Minor", "Critical"]) {
      expect(
        await refusalOf(() => {
          return ArchivableValueGuard.beforeCreate({
            service: fake.service,
            definition: definition(ArchivableValueType.IncidentSeverity),
            createBy: create(IncidentSeverity, {
              name: name,
              projectId: PROJECT_ID,
            }),
          });
        }),
      ).toBeNull();
    }
  });

  test("another project's archived value has nothing to do with it", async () => {
    const fake: FakeService = fakeService(Label, [
      {
        ...row(40, "legacy-db", { isArchived: true }),
        projectId: OTHER_PROJECT_ID,
      },
    ]);

    expect(
      await refusalOf(() => {
        return ArchivableValueGuard.beforeCreate({
          service: fake.service,
          definition: definition(ArchivableValueType.Label),
          createBy: create(Label, { name: "legacy-db", projectId: PROJECT_ID }),
        });
      }),
    ).toBeNull();
  });

  test("created archived: held to the same rules as one archived later", async () => {
    const states_: FakeService = fakeService(IncidentState, states());

    expect(
      await refusalOf(() => {
        return ArchivableValueGuard.beforeCreate({
          service: states_.service,
          definition: definition(ArchivableValueType.IncidentState),
          createBy: create(IncidentState, {
            name: "Triage",
            projectId: PROJECT_ID,
            isArchived: true,
            isCreatedState: true,
          }),
        });
      }),
    ).toBe(
      '"Triage": New incidents start in this state, so it can\'t be archived.',
    );

    // A project with no live severity cannot gain only an archived one.
    const none: FakeService = fakeService(IncidentSeverity, [
      row(3, "Old", { isArchived: true }),
    ]);

    expect(
      await refusalOf(() => {
        return ArchivableValueGuard.beforeCreate({
          service: none.service,
          definition: definition(ArchivableValueType.IncidentSeverity),
          createBy: create(IncidentSeverity, {
            name: "Unused",
            projectId: PROJECT_ID,
            isArchived: true,
          }),
        });
      }),
    ).toBe(
      "Every new incident needs a severity, so keep at least one that is not archived.",
    );

    // With a live one left, it may be created archived.
    const some: FakeService = fakeService(IncidentSeverity, severities());

    expect(
      await refusalOf(() => {
        return ArchivableValueGuard.beforeCreate({
          service: some.service,
          definition: definition(ArchivableValueType.IncidentSeverity),
          createBy: create(IncidentSeverity, {
            name: "Unused",
            projectId: PROJECT_ID,
            isArchived: true,
          }),
        });
      }),
    ).toBeNull();
  });

  test("the project is read off the record when the caller names none", async () => {
    const fake: FakeService = fakeService(Label, [
      row(40, "legacy-db", { isArchived: true }),
    ]);

    expect(
      await refusalOf(() => {
        return ArchivableValueGuard.beforeCreate({
          service: fake.service,
          definition: definition(ArchivableValueType.Label),
          createBy: create(
            Label,
            { name: "legacy-db", projectId: PROJECT_ID.toString() },
            { userId: new ObjectID(id(99)) },
          ),
        });
      }),
    ).toContain("An archived label is already called");
  });
});

describe("the live values of a project", () => {
  test("read as OneUptime, pinned to the project, archived ones left out", async () => {
    const fake: FakeService = fakeService(IncidentSeverity, [
      ...severities(),
      { ...row(4, "Elsewhere"), projectId: OTHER_PROJECT_ID },
    ]);

    expect(
      await ArchivableValueGuard.getLiveIds({
        service: fake.service,
        projectId: PROJECT_ID,
      }),
    ).toEqual([id(1), id(2)]);
  });
});
