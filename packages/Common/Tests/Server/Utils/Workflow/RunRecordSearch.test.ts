/*
 * Finding the record a workflow is run with, from what a person typed into
 * Run Workflow (Server/Utils/Workflow/RunRecordSearch): INC-8, 8, #8, part of
 * a title, or an ID.
 *
 * The service here is a fake that answers findBy from records in memory, the
 * way the database would answer the query the search builds: equality, an
 * ObjectID, every word anywhere in a name (ILIKE, read by
 * TestingUtils/QueryConditions), newest first, a limit.
 * So these check both what is asked of the database - always in the
 * workflow's project, always as the caller - and what comes back, for every
 * model that numbers its records.
 */

import DatabaseService from "../../../../Server/Services/DatabaseService";
import RunRecordSearch, {
  RunRecordSearchRequest,
} from "../../../../Server/Utils/Workflow/RunRecordSearch";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../../Models/DatabaseModels/AlertEpisode";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import Dictionary from "../../../../Types/Dictionary";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import UserType from "../../../../Types/UserType";
import {
  RUN_RECORD_SEARCH_LIMIT,
  RUN_RECORD_SEARCH_MAX_WORDS,
  RecordNumberColumns,
  RunRecordMatch,
  RunRecordOption,
  getRecordNumberColumns,
} from "../../../../Types/Workflow/RunRecord";
import {
  isQueryCondition,
  meetsCondition,
} from "../../TestingUtils/QueryConditions";
import { beforeEach, describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();

const CALLER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
  userType: UserType.User,
};

type StoredRecord = Dictionary<unknown>;

interface FindByCall {
  query: Dictionary<unknown>;
  select: Dictionary<unknown>;
  sort: Dictionary<unknown>;
  limit: number;
  props: DatabaseCommonInteractionProps;
}

interface FakeService {
  service: DatabaseService<BaseModel>;
  calls: Array<FindByCall>;
}

type MatchesFunction = (
  record: StoredRecord,
  query: Dictionary<unknown>,
) => boolean;

// The query, as the database reads it.
const matches: MatchesFunction = (
  record: StoredRecord,
  query: Dictionary<unknown>,
): boolean => {
  return Object.entries(query).every(
    ([column, expected]: [string, unknown]): boolean => {
      const actual: unknown = record[column];

      // A condition on a name: every word typed, anywhere in it.
      if (isQueryCondition(expected)) {
        return typeof actual === "string" && meetsCondition(expected, actual);
      }

      if (expected instanceof ObjectID) {
        return String(actual) === expected.toString();
      }

      return actual === expected;
    },
  );
};

type MakeServiceFunction = (data: {
  model: BaseModel;
  records: Array<StoredRecord>;
  refuse?: boolean;
}) => FakeService;

const makeService: MakeServiceFunction = (data: {
  model: BaseModel;
  records: Array<StoredRecord>;
  refuse?: boolean;
}): FakeService => {
  const calls: Array<FindByCall> = [];

  const fake: Dictionary<unknown> = {
    getModel: (): BaseModel => {
      return data.model;
    },
    findBy: async (args: FindByCall): Promise<Array<BaseModel>> => {
      calls.push(args);

      if (data.refuse) {
        throw new NotAuthorizedException(
          "You do not have permissions to read this.",
        );
      }

      return data.records
        .filter((record: StoredRecord): boolean => {
          return matches(record, args.query);
        })
        .sort((a: StoredRecord, b: StoredRecord): number => {
          return (
            (b["createdAt"] as Date).getTime() -
            (a["createdAt"] as Date).getTime()
          );
        })
        .slice(0, args.limit)
        .map((record: StoredRecord): BaseModel => {
          // What the select asked for, and nothing else.
          const selected: StoredRecord = {};

          for (const column of Object.keys(args.select)) {
            selected[column] = record[column];
          }

          return selected as unknown as BaseModel;
        });
    },
  };

  return {
    service: fake as unknown as DatabaseService<BaseModel>,
    calls: calls,
  };
};

type RequestFunction = (
  fake: FakeService,
  search: string,
  overrides?: Partial<RunRecordSearchRequest>,
) => RunRecordSearchRequest;

const request: RequestFunction = (
  fake: FakeService,
  search: string,
  overrides?: Partial<RunRecordSearchRequest>,
): RunRecordSearchRequest => {
  return {
    service: fake.service,
    projectId: PROJECT_ID,
    props: CALLER,
    search: search,
    ...overrides,
  };
};

interface NumberedModel {
  name: string;
  model: BaseModel;
  prefix: string;
  nameColumn: string;
}

// Every model that numbers its records, with the prefix new projects get.
const NUMBERED_MODELS: Array<NumberedModel> = [
  {
    name: "Incident",
    model: new Incident(),
    prefix: "INC-",
    nameColumn: "title",
  },
  { name: "Alert", model: new Alert(), prefix: "ALT-", nameColumn: "title" },
  {
    name: "ScheduledMaintenance",
    model: new ScheduledMaintenance(),
    prefix: "SM-",
    nameColumn: "title",
  },
  {
    name: "IncidentEpisode",
    model: new IncidentEpisode(),
    prefix: "IE-",
    nameColumn: "title",
  },
  {
    name: "AlertEpisode",
    model: new AlertEpisode(),
    prefix: "AE-",
    nameColumn: "title",
  },
];

let clock: number = Date.UTC(2026, 9, 1);

type RecordOfFunction = (data: {
  kind: NumberedModel;
  number: number;
  name: string;
  projectId?: ObjectID;
  prefix?: string;
}) => StoredRecord;

// A stored record of a numbered model, each one newer than the last.
const recordOf: RecordOfFunction = (data: {
  kind: NumberedModel;
  number: number;
  name: string;
  projectId?: ObjectID;
  prefix?: string;
}): StoredRecord => {
  const columns: RecordNumberColumns = getRecordNumberColumns(
    data.kind.model,
  ) as RecordNumberColumns;

  clock += 60 * 1000;

  return {
    _id: ObjectID.generate().toString(),
    projectId: data.projectId || PROJECT_ID,
    createdAt: new Date(clock),
    [columns.numberColumn]: data.number,
    [columns.numberWithPrefixColumn]: `${
      data.prefix === undefined ? data.kind.prefix : data.prefix
    }${data.number}`,
    [data.kind.nameColumn]: data.name,
  };
};

beforeEach(() => {
  clock = Date.UTC(2026, 9, 1);
});

describe.each(NUMBERED_MODELS)(
  "a record of $name is found by its number",
  (kind: NumberedModel) => {
    test("with its prefix, without one, and with #", async () => {
      const eight: StoredRecord = recordOf({
        kind: kind,
        number: 8,
        name: "Database is down",
      });
      const fake: FakeService = makeService({
        model: kind.model,
        records: [
          recordOf({ kind: kind, number: 7, name: "Disk full" }),
          eight,
          recordOf({ kind: kind, number: 80, name: "Queue backed up" }),
        ],
      });

      for (const typed of [
        `${kind.prefix}8`,
        `${kind.prefix.toLowerCase()}8`,
        "8",
        "#8",
      ]) {
        const found: Array<RunRecordOption> = await RunRecordSearch.search(
          request(fake, typed),
        );

        expect([typed, found[0]]).toEqual([
          typed,
          {
            id: eight["_id"],
            number: `${kind.prefix}8`,
            name: "Database is down",
            createdAt: (eight["createdAt"] as Date).toISOString(),
            matchedBy: RunRecordMatch.Number,
          },
        ]);

        const resolved: RunRecordOption | null = await RunRecordSearch.resolve(
          request(fake, typed),
        );

        expect(resolved?.id).toBe(eight["_id"]);
      }
    });

    test("never by another model's prefix", async () => {
      const fake: FakeService = makeService({
        model: kind.model,
        records: [
          recordOf({ kind: kind, number: 8, name: "Database is down" }),
        ],
      });

      const found: Array<RunRecordOption> = await RunRecordSearch.search(
        request(fake, "ZZZ-8"),
      );

      expect(found).toEqual([]);
      expect(await RunRecordSearch.resolve(request(fake, "ZZZ-8"))).toBeNull();
    });

    test("a number nothing has finds nothing", async () => {
      const fake: FakeService = makeService({
        model: kind.model,
        records: [
          recordOf({ kind: kind, number: 8, name: "Database is down" }),
        ],
      });

      expect(
        await RunRecordSearch.search(request(fake, `${kind.prefix}999`)),
      ).toEqual([]);
      expect(
        await RunRecordSearch.resolve(request(fake, `${kind.prefix}999`)),
      ).toBeNull();
    });

    test("another project's record with that number is never found", async () => {
      const elsewhere: StoredRecord = recordOf({
        kind: kind,
        number: 8,
        name: "Their outage",
        projectId: OTHER_PROJECT_ID,
      });
      const fake: FakeService = makeService({
        model: kind.model,
        records: [elsewhere],
      });

      expect(
        await RunRecordSearch.search(request(fake, `${kind.prefix}8`)),
      ).toEqual([]);
      expect(
        await RunRecordSearch.resolve(request(fake, `${kind.prefix}8`)),
      ).toBeNull();
      expect(
        await RunRecordSearch.resolve(
          request(fake, elsewhere["_id"] as string),
        ),
      ).toBeNull();

      // Its own record with the same number is the one found.
      const own: StoredRecord = recordOf({
        kind: kind,
        number: 8,
        name: "Our outage",
      });
      const both: FakeService = makeService({
        model: kind.model,
        records: [elsewhere, own],
      });

      expect(
        (await RunRecordSearch.resolve(request(both, `${kind.prefix}8`)))?.id,
      ).toBe(own["_id"]);
    });

    test("every read is in the workflow's project, as the caller", async () => {
      const fake: FakeService = makeService({
        model: kind.model,
        records: [
          recordOf({ kind: kind, number: 8, name: "Database is down" }),
        ],
      });

      await RunRecordSearch.search(request(fake, `${kind.prefix}8`));
      await RunRecordSearch.search(request(fake, "database"));
      await RunRecordSearch.search(request(fake, ""));

      expect(fake.calls.length).toBeGreaterThanOrEqual(3);

      for (const call of fake.calls) {
        expect(call.query["projectId"]).toEqual(PROJECT_ID);
        expect(call.props.isRoot).toBeUndefined();
        expect(call.props.userId).toEqual(USER_ID);
        expect(call.props.tenantId).toEqual(PROJECT_ID);
        expect(call.sort).toEqual({ createdAt: SortOrder.Descending });
        expect(call.limit).toBeLessThanOrEqual(RUN_RECORD_SEARCH_LIMIT);
      }
    });
  },
);

describe("finding a record by name", () => {
  const INCIDENT: NumberedModel = NUMBERED_MODELS[0] as NumberedModel;

  test("part of the title finds every record it is in, newest first", async () => {
    const older: StoredRecord = recordOf({
      kind: INCIDENT,
      number: 1,
      name: "Database is down",
    });
    const newer: StoredRecord = recordOf({
      kind: INCIDENT,
      number: 2,
      name: "Database replica lag",
    });
    const fake: FakeService = makeService({
      model: INCIDENT.model,
      records: [
        older,
        recordOf({ kind: INCIDENT, number: 3, name: "API latency" }),
        newer,
      ],
    });

    const found: Array<RunRecordOption> = await RunRecordSearch.search(
      request(fake, "DATABASE"),
    );

    expect(
      found.map((option: RunRecordOption): string => {
        return option.id;
      }),
    ).toEqual([newer["_id"], older["_id"]]);
    expect(
      found.every((option: RunRecordOption): boolean => {
        return option.matchedBy === RunRecordMatch.Name;
      }),
    ).toBe(true);
  });

  test("part of a title is never enough to run with", async () => {
    const fake: FakeService = makeService({
      model: INCIDENT.model,
      records: [recordOf({ kind: INCIDENT, number: 1, name: "Database" })],
    });

    expect(await RunRecordSearch.resolve(request(fake, "Database"))).toBeNull();
  });

  type FoundNamesFunction = (
    fake: FakeService,
    search: string,
  ) => Promise<Array<string | undefined>>;

  const foundNames: FoundNamesFunction = async (
    fake: FakeService,
    search: string,
  ): Promise<Array<string | undefined>> => {
    return (await RunRecordSearch.search(request(fake, search))).map(
      (option: RunRecordOption): string | undefined => {
        return option.name;
      },
    );
  };

  /*
   * A title half remembered is typed as its words, not as a run of them:
   * "database down" for "Database is down". One run of characters found
   * nothing for that.
   */
  test("every word typed has to be in the title, in any order", async () => {
    const fake: FakeService = makeService({
      model: INCIDENT.model,
      records: [
        recordOf({ kind: INCIDENT, number: 1, name: "Database is down" }),
        recordOf({ kind: INCIDENT, number: 2, name: "Database replica lag" }),
        recordOf({ kind: INCIDENT, number: 3, name: "API is down" }),
      ],
    });

    expect(await foundNames(fake, "database down")).toEqual([
      "Database is down",
    ]);
    expect(await foundNames(fake, "DOWN   database")).toEqual([
      "Database is down",
    ]);
    // One word of two is not enough.
    expect(await foundNames(fake, "database checkout")).toEqual([]);
    // A word is found inside a longer one, as part of a title is.
    expect(await foundNames(fake, "data repl")).toEqual([
      "Database replica lag",
    ]);
  });

  test("a % or an _ typed is that character, not anything at all", async () => {
    const fake: FakeService = makeService({
      model: INCIDENT.model,
      records: [
        recordOf({ kind: INCIDENT, number: 1, name: "CPU at 100% on db_1" }),
        recordOf({ kind: INCIDENT, number: 2, name: "CPU at 1000 on db-1" }),
      ],
    });

    expect(await foundNames(fake, "100%")).toEqual(["CPU at 100% on db_1"]);
    expect(await foundNames(fake, "db_1")).toEqual(["CPU at 100% on db_1"]);
    expect(await foundNames(fake, "%")).toEqual(["CPU at 100% on db_1"]);
    expect(await foundNames(fake, "_")).toEqual(["CPU at 100% on db_1"]);
  });

  test("the database is asked for each word on the name column, escaped, and for no more than twelve", async () => {
    const fake: FakeService = makeService({
      model: INCIDENT.model,
      records: [],
    });

    await RunRecordSearch.search(request(fake, "  50%  off_peak \\ load  "));

    const condition: unknown = fake.calls[0]!.query["title"];

    expect(condition).toBeInstanceOf(FindOperator);
    expect(
      Object.values(
        (condition as FindOperator<unknown>).objectLiteralParameters!,
      ),
    ).toEqual(["%50\\%%", "%off\\_peak%", "%\\\\%", "%load%"]);
    // In the workflow's project, like every other read.
    expect(fake.calls[0]!.query["projectId"]).toBe(PROJECT_ID);

    const many: string = Array.from(
      { length: RUN_RECORD_SEARCH_MAX_WORDS + 8 },
      (_value: unknown, index: number): string => {
        return `w${index}`;
      },
    ).join(" ");

    await RunRecordSearch.search(request(fake, many));

    // The last read: the words end in a number, which is looked up first.
    const lastRead: FindByCall = fake.calls[fake.calls.length - 1]!;

    expect(
      Object.values(
        (lastRead.query["title"] as FindOperator<unknown>)
          .objectLiteralParameters!,
      ),
    ).toHaveLength(RUN_RECORD_SEARCH_MAX_WORDS);
  });

  test("a number in a title is found too, after the record with that number, and once", async () => {
    const fiveHundred: StoredRecord = recordOf({
      kind: INCIDENT,
      number: 500,
      name: "Error 500 on checkout",
    });
    const titled: StoredRecord = recordOf({
      kind: INCIDENT,
      number: 12,
      name: "Another 500 error",
    });
    const fake: FakeService = makeService({
      model: INCIDENT.model,
      records: [titled, fiveHundred],
    });

    const found: Array<RunRecordOption> = await RunRecordSearch.search(
      request(fake, "500"),
    );

    expect(
      found.map((option: RunRecordOption): [string, string] => {
        return [option.id, option.matchedBy];
      }),
    ).toEqual([
      [fiveHundred["_id"], RunRecordMatch.Number],
      [titled["_id"], RunRecordMatch.Name],
    ]);
  });

  test("a model without numbers is looked up by name and ID only", async () => {
    const monitor: StoredRecord = {
      _id: ObjectID.generate().toString(),
      projectId: PROJECT_ID,
      createdAt: new Date(),
      name: "API 8",
    };
    const fake: FakeService = makeService({
      model: new Monitor(),
      records: [monitor],
    });

    const found: Array<RunRecordOption> = await RunRecordSearch.search(
      request(fake, "8"),
    );

    expect(found).toEqual([
      {
        id: monitor["_id"],
        name: "API 8",
        createdAt: (monitor["createdAt"] as Date).toISOString(),
        matchedBy: RunRecordMatch.Name,
      },
    ]);
    // Nothing was asked of a number column the model does not have.
    for (const call of fake.calls) {
      expect(Object.keys(call.select).sort()).toEqual(
        ["_id", "createdAt", "name"].sort(),
      );
    }
    expect(await RunRecordSearch.resolve(request(fake, "8"))).toBeNull();
  });
});

describe("finding a record by its ID", () => {
  const INCIDENT: NumberedModel = NUMBERED_MODELS[0] as NumberedModel;

  test("an ID finds that record exactly", async () => {
    const record: StoredRecord = recordOf({
      kind: INCIDENT,
      number: 4,
      name: "Disk full",
    });
    const fake: FakeService = makeService({
      model: INCIDENT.model,
      records: [record, recordOf({ kind: INCIDENT, number: 5, name: "x" })],
    });

    const found: Array<RunRecordOption> = await RunRecordSearch.search(
      request(fake, (record["_id"] as string).toUpperCase()),
    );

    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe(record["_id"]);
    expect(found[0]?.matchedBy).toBe(RunRecordMatch.Id);
  });
});

describe("with nothing typed", () => {
  test("the newest records, at most ten", async () => {
    const INCIDENT: NumberedModel = NUMBERED_MODELS[0] as NumberedModel;
    const records: Array<StoredRecord> = [];

    for (let number: number = 1; number <= 14; number++) {
      records.push(
        recordOf({
          kind: INCIDENT,
          number: number,
          name: `Incident ${number}`,
        }),
      );
    }

    const fake: FakeService = makeService({
      model: INCIDENT.model,
      records: records,
    });

    const found: Array<RunRecordOption> = await RunRecordSearch.search(
      request(fake, "  "),
    );

    expect(found).toHaveLength(RUN_RECORD_SEARCH_LIMIT);
    expect(found[0]?.number).toBe("INC-14");
    expect(found[9]?.number).toBe("INC-5");
    expect(
      found.every((option: RunRecordOption): boolean => {
        return option.matchedBy === RunRecordMatch.Recent;
      }),
    ).toBe(true);
    expect(await RunRecordSearch.resolve(request(fake, ""))).toBeNull();
  });

  test("a smaller limit is kept, a larger one is not", async () => {
    const INCIDENT: NumberedModel = NUMBERED_MODELS[0] as NumberedModel;
    const records: Array<StoredRecord> = [];

    for (let number: number = 1; number <= 14; number++) {
      records.push(recordOf({ kind: INCIDENT, number: number, name: "x" }));
    }

    const fake: FakeService = makeService({
      model: INCIDENT.model,
      records: records,
    });

    expect(
      await RunRecordSearch.search(request(fake, "", { limit: 3 })),
    ).toHaveLength(3);
    expect(
      await RunRecordSearch.search(request(fake, "", { limit: 500 })),
    ).toHaveLength(RUN_RECORD_SEARCH_LIMIT);
  });
});

describe("what the caller may not read", () => {
  test("a refused read is the caller's refusal, never read as someone else", async () => {
    const INCIDENT: NumberedModel = NUMBERED_MODELS[0] as NumberedModel;
    const fake: FakeService = makeService({
      model: INCIDENT.model,
      records: [recordOf({ kind: INCIDENT, number: 8, name: "x" })],
      refuse: true,
    });

    await expect(
      RunRecordSearch.search(request(fake, "INC-8")),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
    await expect(
      RunRecordSearch.resolve(request(fake, "INC-8")),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    for (const call of fake.calls) {
      expect(call.props).toEqual({ ...CALLER, tenantId: PROJECT_ID });
    }
  });
});
